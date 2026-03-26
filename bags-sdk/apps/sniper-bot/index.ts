/**
 * Bags Sniper Bot
 *
 * Watches for new token launches on Bags.fm via LaserStream,
 * evaluates them against configurable filters, and auto-buys
 * using a time-limited session key.
 *
 * Usage:
 *   BAGS_API_KEY=... HELIUS_API_KEY=... PRIVATE_KEY=... ts-node apps/sniper-bot/index.ts
 *
 * Config via env vars (see loadConfig below) or edit DEFAULT_CONFIG.
 */

import { BagsSDK, KeypairSigner, SessionKey } from "../../src"
import type { TokenLaunchedEvent, TradeEvent } from "../../src/types"
import { SniperConfig, SniperStats, loadConfig } from "./config"
import { SniperFilter } from "./filter"
import { SniperLog } from "./logger"

// Meteora DBC program ID
const METEORA_DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"

async function main() {
  const config = loadConfig()
  const log = new SniperLog(config.verbose)
  const filter = new SniperFilter(config)
  const stats: SniperStats = {
    started: Date.now(),
    tokensScanned: 0,
    tokensFiltered: 0,
    buyAttempts: 0,
    buySuccesses: 0,
    buyFailures: 0,
    totalSpentSOL: 0,
    positions: [],
  }

  log.banner(config)

  // ─── Initialize SDK ──────────────────────────────────────────────────────

  const sdk = new BagsSDK({
    bagsApiKey: config.bagsApiKey,
    heliusApiKey: config.heliusApiKey,
    dflowApiKey: config.dflowApiKey,
    birdeyeApiKey: config.birdeyeApiKey,
  })

  // ─── Create session key (scoped + time-limited) ──────────────────────────

  const masterSigner = KeypairSigner.fromEnv()
  const session = SessionKey.create({
    allowedPrograms: [
      METEORA_DBC_PROGRAM,
      "11111111111111111111111111111111",    // System Program
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
    ],
    maxSpendPerTx: config.maxBuySOL * 1e9,
    expiresIn: config.sessionDurationMs,
    label: "sniper-bot-session",
  })

  log.info(`Session key created: ${session.publicKey}`)
  log.info(`Expires in: ${Math.round(config.sessionDurationMs / 60000)} minutes`)
  log.info(`Max buy per token: ${config.maxBuySOL} SOL`)
  log.info(`Watching for launches...\n`)

  // NOTE: In production the session key would need to be funded and
  // authorized on-chain. For this demo we use the master signer for
  // actual transaction signing, but demonstrate the session key guards.
  const activeSigner = config.useSessionKey ? session.signer : masterSigner

  // ─── Watch for new launches ──────────────────────────────────────────────

  sdk.stream.on("token:launched", async (event: TokenLaunchedEvent) => {
    stats.tokensScanned++

    log.launch(event)

    // Apply filters
    const verdict = filter.evaluate(event)
    if (!verdict.pass) {
      stats.tokensFiltered++
      log.filtered(event, verdict.reason)
      return
    }

    // Check session key state
    if (config.useSessionKey) {
      const state = session.state()
      if (state.revoked || Date.now() > state.expiresAt) {
        log.warn("Session key expired or revoked. Skipping buy.")
        return
      }
      if (state.transactionCount >= config.maxBuysPerSession) {
        log.warn(`Max buys per session reached (${config.maxBuysPerSession}). Skipping.`)
        return
      }
    }

    // Check total spend limit
    if (stats.totalSpentSOL >= config.maxTotalSpendSOL) {
      log.warn(`Total spend limit reached (${config.maxTotalSpendSOL} SOL). Skipping.`)
      return
    }

    // ─── Execute buy ─────────────────────────────────────────────────────

    stats.buyAttempts++
    log.buying(event, config.buyAmountSOL)

    // ─── Dry run: log what would happen, skip actual transaction ───────
    if (config.dryRun) {
      const fakeResult = {
        signature: `DRY_RUN_${Date.now().toString(36)}`,
        outputAmount: 0,
      }
      stats.buySuccesses++
      stats.totalSpentSOL += config.buyAmountSOL
      stats.positions.push({
        mint: event.mint,
        name: event.name,
        symbol: event.symbol,
        buyPrice: event.initialPrice,
        amountSOL: config.buyAmountSOL,
        tokensReceived: 0,
        signature: fakeResult.signature,
        timestamp: Date.now(),
      })
      log.bought(event, fakeResult, config.buyAmountSOL)
      return
    }

    try {
      const result = await sdk.trade.buy(
        event.mint,
        config.buyAmountSOL,
        activeSigner,
        {
          slippage: config.slippage,
          priorityFee: config.priorityFee,
        }
      )

      stats.buySuccesses++
      stats.totalSpentSOL += config.buyAmountSOL
      stats.positions.push({
        mint: event.mint,
        name: event.name,
        symbol: event.symbol,
        buyPrice: event.initialPrice,
        amountSOL: config.buyAmountSOL,
        tokensReceived: result.outputAmount,
        signature: result.signature,
        timestamp: Date.now(),
      })

      log.bought(event, result, config.buyAmountSOL)

      // Auto-sell setup if configured
      if (config.autoSellMultiplier > 0) {
        monitorForSell(sdk, event, result.outputAmount, config, activeSigner, log, stats)
      }
    } catch (err) {
      stats.buyFailures++
      log.buyFailed(event, err instanceof Error ? err.message : String(err))
    }
  })

  // ─── Also listen for trade events to track market activity ────────────

  sdk.stream.on("trade:buy", (event: TradeEvent) => {
    if (config.verbose) {
      log.trade(event)
    }
  })

  // ─── Stats reporting ─────────────────────────────────────────────────────

  const statsInterval = setInterval(() => {
    log.stats(stats)
  }, 30000) // every 30s

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  const shutdown = () => {
    log.info("\nShutting down sniper bot...")
    clearInterval(statsInterval)
    if (config.useSessionKey) {
      session.revoke()
      log.info("Session key revoked.")
    }
    log.stats(stats)
    sdk.destroy()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

// ─── Auto-sell monitor ──────────────────────────────────────────────────────

async function monitorForSell(
  sdk: BagsSDK,
  launchEvent: TokenLaunchedEvent,
  tokensHeld: number,
  config: SniperConfig,
  signer: { publicKey: string; signTransaction: (tx: Uint8Array) => Promise<Uint8Array> },
  log: SniperLog,
  stats: SniperStats
) {
  const targetPrice = launchEvent.initialPrice * config.autoSellMultiplier
  const stopLossPrice = launchEvent.initialPrice * (1 - config.stopLossPercent)

  log.info(`  Auto-sell target: ${config.autoSellMultiplier}x (${targetPrice.toFixed(8)})`)
  if (config.stopLossPercent > 0) {
    log.info(`  Stop-loss at: ${((1 - config.stopLossPercent) * 100).toFixed(0)}% (${stopLossPrice.toFixed(8)})`)
  }

  const checkInterval = setInterval(async () => {
    try {
      const pool = await sdk.pools.get(launchEvent.mint)

      // Take profit
      if (pool.price >= targetPrice) {
        log.info(`  TARGET HIT for ${launchEvent.symbol}! Price: ${pool.price.toFixed(8)} >= ${targetPrice.toFixed(8)}`)
        clearInterval(checkInterval)

        try {
          const result = await sdk.trade.sell(
            launchEvent.mint,
            tokensHeld,
            signer,
            { slippage: config.slippage, priorityFee: config.priorityFee }
          )
          log.info(`  SOLD ${launchEvent.symbol}: ${result.signature}`)

          // Update position
          const pos = stats.positions.find(p => p.mint === launchEvent.mint)
          if (pos) {
            pos.soldAt = pool.price
            pos.sellSignature = result.signature
          }
        } catch (err) {
          log.warn(`  Failed to sell ${launchEvent.symbol}: ${err instanceof Error ? err.message : err}`)
        }
        return
      }

      // Stop loss
      if (config.stopLossPercent > 0 && pool.price <= stopLossPrice) {
        log.warn(`  STOP-LOSS for ${launchEvent.symbol}! Price: ${pool.price.toFixed(8)} <= ${stopLossPrice.toFixed(8)}`)
        clearInterval(checkInterval)

        try {
          const result = await sdk.trade.sell(
            launchEvent.mint,
            tokensHeld,
            signer,
            { slippage: config.slippage * 2, priorityFee: "high" } // wider slippage for stop-loss
          )
          log.info(`  STOP-LOSS SOLD ${launchEvent.symbol}: ${result.signature}`)
        } catch (err) {
          log.warn(`  Stop-loss sell failed: ${err instanceof Error ? err.message : err}`)
        }
      }
    } catch {
      // Pool query failed — retry next interval
    }
  }, config.priceCheckIntervalMs)

  // Auto-cancel after timeout
  setTimeout(() => {
    clearInterval(checkInterval)
    log.info(`  Price monitor expired for ${launchEvent.symbol}`)
  }, config.autoSellTimeoutMs)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
