/**
 * Sniper bot logger — structured console output.
 */

import type { TokenLaunchedEvent, TradeEvent } from "../../src/types"
import type { SniperConfig, SniperStats } from "./config"

export class SniperLog {
  constructor(private verbose: boolean) {}

  banner(config: SniperConfig) {
    console.log("╔══════════════════════════════════════╗")
    console.log("║         BAGS SNIPER BOT              ║")
    console.log("╚══════════════════════════════════════╝")
    console.log(`  Buy amount:   ${config.buyAmountSOL} SOL`)
    console.log(`  Max buy:      ${config.maxBuySOL} SOL`)
    console.log(`  Slippage:     ${(config.slippage * 100).toFixed(1)}%`)
    console.log(`  Max spend:    ${config.maxTotalSpendSOL} SOL`)
    console.log(`  Max buys:     ${config.maxBuysPerSession}`)
    console.log(`  Auto-sell:    ${config.autoSellMultiplier > 0 ? `${config.autoSellMultiplier}x` : "disabled"}`)
    console.log(`  Stop-loss:    ${config.stopLossPercent > 0 ? `${((1 - config.stopLossPercent) * 100).toFixed(0)}%` : "disabled"}`)
    console.log(`  Session key:  ${config.useSessionKey ? "yes" : "no"}`)
    console.log(`  Dry run:      ${config.dryRun ? "YES — no real transactions" : "no"}`)
    console.log("")
  }

  info(message: string) {
    console.log(`[INFO] ${message}`)
  }

  warn(message: string) {
    console.warn(`[WARN] ${message}`)
  }

  launch(event: TokenLaunchedEvent) {
    const price = event.initialPrice?.toFixed(8) ?? "?"
    console.log(`[LAUNCH] ${event.symbol} (${event.name}) — mint: ${event.mint} — price: ${price}`)
  }

  filtered(event: TokenLaunchedEvent, reason: string) {
    if (this.verbose) {
      console.log(`[SKIP] ${event.symbol}: ${reason}`)
    }
  }

  buying(event: TokenLaunchedEvent, amountSOL: number) {
    console.log(`[BUY] Buying ${amountSOL} SOL of ${event.symbol} (${event.mint})...`)
  }

  bought(event: TokenLaunchedEvent, result: { signature: string; outputAmount: number }, amountSOL: number) {
    console.log(`[OK] Bought ${result.outputAmount} ${event.symbol} for ${amountSOL} SOL — tx: ${result.signature}`)
  }

  buyFailed(event: TokenLaunchedEvent, error: string) {
    console.error(`[FAIL] Buy failed for ${event.symbol}: ${error}`)
  }

  trade(event: TradeEvent) {
    const side = event.type === "trade:buy" ? "BUY" : "SELL"
    console.log(`[TRADE] ${side} ${event.mint} — ${event.amountSol.toFixed(4)} SOL — ${event.signature.slice(0, 12)}...`)
  }

  stats(stats: SniperStats) {
    const uptime = Math.round((Date.now() - stats.started) / 1000)
    const mins = Math.floor(uptime / 60)
    const secs = uptime % 60
    console.log(`\n── Stats (${mins}m ${secs}s) ──`)
    console.log(`  Scanned:  ${stats.tokensScanned}`)
    console.log(`  Filtered: ${stats.tokensFiltered}`)
    console.log(`  Buys:     ${stats.buySuccesses}/${stats.buyAttempts} (${stats.buyFailures} failed)`)
    console.log(`  Spent:    ${stats.totalSpentSOL.toFixed(4)} SOL`)
    console.log(`  Positions: ${stats.positions.length}`)
    if (stats.positions.length > 0) {
      for (const pos of stats.positions) {
        const status = pos.soldAt ? `SOLD @ ${pos.soldAt.toFixed(8)}` : "HOLDING"
        console.log(`    ${pos.symbol}: ${pos.amountSOL} SOL → ${pos.tokensReceived} tokens [${status}]`)
      }
    }
    console.log("")
  }
}
