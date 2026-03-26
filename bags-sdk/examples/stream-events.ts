/**
 * Example: Subscribe to real-time Bags events
 *
 * Run: ts-node examples/stream-events.ts
 */

import { BagsSDK } from "../src"
import { TokenLaunchedEvent, TradeEvent, PoolGraduatedEvent } from "../src/types"

async function main() {
  const sdk = new BagsSDK({
    bagsApiKey:   process.env.BAGS_API_KEY!,
    heliusApiKey: process.env.HELIUS_API_KEY!,
    birdeyeApiKey: process.env.BIRDEYE_API_KEY,
  })

  console.log("Listening for Bags events...\n")

  // ─── New token launches ───────────────────────────────────────────────────
  sdk.stream.on("token:launched", (event: TokenLaunchedEvent) => {
    console.log(`🚀 New token: ${event.name} (${event.symbol})`)
    console.log(`   Mint:    ${event.mint}`)
    console.log(`   Creator: ${event.creator}`)
    console.log(`   Price:   ${event.initialPrice}`)
    console.log()
  })

  // ─── Buy/sell events ──────────────────────────────────────────────────────
  sdk.stream.on("trade:buy", (event: TradeEvent) => {
    console.log(`💰 Buy  ${event.amountSol.toFixed(3)} SOL → ${event.amountToken} tokens`)
    console.log(`   Token: ${event.mint}`)
    console.log(`   Sig:   ${event.signature}`)
    console.log()
  })

  sdk.stream.on("trade:sell", (event: TradeEvent) => {
    console.log(`📤 Sell ${event.amountToken} tokens → ${event.amountSol.toFixed(3)} SOL`)
    console.log()
  })

  // ─── Pool graduation ──────────────────────────────────────────────────────
  sdk.stream.on("pool:graduated", (event: PoolGraduatedEvent) => {
    console.log(`🎓 Pool graduated! Token: ${event.mint}`)
    console.log(`   Final bonding price: ${event.finalBondingPrice}`)
    console.log()
  })

  // ─── Async generator alternative ─────────────────────────────────────────
  // Use this in a data pipeline instead of event listeners:
  //
  // for await (const token of sdk.tokens.feed()) {
  //   await db.insert(token)
  //   console.log("Indexed:", token.name)
  // }

  // Keep process alive
  process.on("SIGINT", () => {
    console.log("\nShutting down...")
    sdk.destroy()
    process.exit(0)
  })
}

main().catch(console.error)
