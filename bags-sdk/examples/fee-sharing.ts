/**
 * Example: Configure fee sharing and claim fees
 *
 * Bags.fm tokens generate trading fees. As a token creator, you can
 * split those fees across multiple wallets (team, DAO, mods, etc.)
 *
 * Run: BAGS_API_KEY=... HELIUS_API_KEY=... PRIVATE_KEY=... ts-node examples/fee-sharing.ts
 */

import { BagsSDK, KeypairSigner } from "../src"

const TOKEN_MINT = "YOUR_TOKEN_MINT_HERE"

async function main() {
  const sdk = new BagsSDK({
    bagsApiKey: process.env.BAGS_API_KEY!,
    heliusApiKey: process.env.HELIUS_API_KEY!,
  })

  const signer = KeypairSigner.fromEnv()

  // ─── Step 1: Configure fee splits ──────────────────────────────────────────
  // Splits MUST sum to exactly 1.0. The SDK validates this before sending.

  await sdk.fees.createConfig(
    {
      mint: TOKEN_MINT,
      splits: [
        { wallet: signer.publicKey, share: 0.5 }, // 50% to creator
        { wallet: "MOD_WALLET_HERE", share: 0.3 }, // 30% to mods
        { wallet: "DAO_WALLET_HERE", share: 0.2 }, // 20% to DAO
      ],
    },
    signer
  )
  console.log("Fee sharing configured!")

  // ─── Step 2: Check accumulated fees ────────────────────────────────────────

  const stats = await sdk.fees.getStats(TOKEN_MINT)
  console.log("\nFee stats:")
  console.log("  Lifetime fees:", stats.lifetimeFees, "SOL")
  console.log("  Claimable now:", stats.claimableNow, "SOL")
  console.log("  Claim events: ", stats.claimEvents.length)

  // Show recent claims
  for (const claim of stats.claimEvents.slice(0, 5)) {
    console.log(`    ${claim.wallet}: ${claim.amount} SOL (${claim.signature.slice(0, 12)}...)`)
  }

  // ─── Step 3: Claim all fees ────────────────────────────────────────────────

  if (stats.claimableNow > 0) {
    const { totalClaimed, signatures } = await sdk.fees.claimAll(
      signer.publicKey,
      signer,
      { priorityFee: "medium" }
    )
    console.log(`\nClaimed ${totalClaimed} SOL in ${signatures.length} transactions`)
    for (const sig of signatures) {
      console.log("  tx:", sig)
    }
  } else {
    console.log("\nNo fees to claim right now.")
  }

  sdk.destroy()
}

main().catch(console.error)
