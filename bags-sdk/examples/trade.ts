/**
 * Example: Buy and sell a Bags token with best-execution routing
 *
 * Run: ts-node examples/trade.ts
 */

import { BagsSDK, KeypairSigner } from "../src"

const TOKEN_MINT = "YOUR_TOKEN_MINT_HERE"

async function main() {
  const sdk = new BagsSDK({
    bagsApiKey:   process.env.BAGS_API_KEY!,
    heliusApiKey: process.env.HELIUS_API_KEY!,
    dflowApiKey:  process.env.DFLOW_API_KEY, // if set, enables DFlow best-execution routing
  })

  const signer = KeypairSigner.fromEnv()

  // ─── Get a quote first (inspect before committing) ────────────────────────
  const quote = await sdk.trade.quote({
    tokenMint: TOKEN_MINT,
    side: "buy",
    amount: 0.5,      // 0.5 SOL
    slippage: 0.01,   // 1%
  })

  console.log("Quote:")
  console.log("  Route:       ", quote.route)   // "bags" | "dflow" | "best"
  console.log("  Input:       ", quote.inputAmount, "SOL")
  console.log("  Output:      ", quote.outputAmount, "tokens")
  console.log("  Price impact:", (quote.priceImpact * 100).toFixed(2), "%")
  console.log("  Expires at:  ", new Date(quote.expiresAt).toISOString())

  if (quote.priceImpact > 0.05) {
    console.warn("⚠ High price impact (>5%). Consider splitting the trade.")
    return
  }

  // ─── Execute the swap ─────────────────────────────────────────────────────
  const result = await sdk.trade.swap({ quote, signer })
  console.log("\n✓ Swap confirmed!")
  console.log("  Signature:", result.signature)

  // ─── Pool state after trade ───────────────────────────────────────────────
  const pool = await sdk.pools.get(TOKEN_MINT)
  console.log("\nPool state:")
  console.log("  Price:             ", pool.priceUsd.toFixed(8), "USD")
  console.log("  Liquidity:         ", pool.liquidity.toFixed(2), "SOL")
  console.log("  Bonding curve:     ", (pool.bondingCurveProgress * 100).toFixed(1), "%")
  console.log("  Until graduation:  ", pool.bondingCurveRemaining.toFixed(2), "SOL")

  // ─── Convenience helpers ──────────────────────────────────────────────────
  // Direct buy (quote + swap in one call)
  // await sdk.trade.buy(TOKEN_MINT, 0.1, signer)

  // Direct sell
  // await sdk.trade.sell(TOKEN_MINT, 1000000, signer) // sell 1M tokens

  sdk.destroy()
}

main().catch(console.error)
