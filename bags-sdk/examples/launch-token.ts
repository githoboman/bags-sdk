/**
 * Example: Launch a token on Bags.fm
 *
 * Run: ts-node examples/launch-token.ts
 *
 * Required env vars:
 *   BAGS_API_KEY     — from dev.bags.fm
 *   HELIUS_API_KEY   — from helius.dev
 *   PRIVATE_KEY      — base58 encoded Solana private key (the creator wallet)
 */

import { BagsSDK, KeypairSigner } from "../src"

async function main() {
  const sdk = new BagsSDK({
    bagsApiKey:   process.env.BAGS_API_KEY!,
    heliusApiKey: process.env.HELIUS_API_KEY!,
    dflowApiKey:  process.env.DFLOW_API_KEY,    // optional
    birdeyeApiKey: process.env.BIRDEYE_API_KEY, // optional
  })

  const signer = KeypairSigner.fromEnv()
  console.log("Launching from wallet:", signer.publicKey)

  // ─── Option A: One-liner launch ───────────────────────────────────────────
  const result = await sdk.tokens.launch(
    {
      name: "Hackathon Token",
      symbol: "HACK",
      description: "Launched via bags-sdk at the Bags Hackathon",
      image: "https://example.com/hack-token.png",
      initialBuyAmount: 0.1,   // buy 0.1 SOL worth at launch
      feeShareWallet: signer.publicKey,
    },
    signer,
    { priorityFee: "auto" }
  )

  console.log("\n✓ Token launched!")
  console.log("  Mint:        ", result.mint)
  console.log("  Pool:        ", result.poolAddress)
  console.log("  Signature:   ", result.signature)
  console.log("  View on Bags:", `https://bags.fm/token/${result.mint}`)

  // ─── Option B: Build transaction with full control ────────────────────────
  // const tx = await sdk.tokens.launchTx({ name: "...", symbol: "...", image: "..." })
  // const rawTx = tx.getRawTransaction()   // inspect before signing
  // const sig = await tx
  //   .withPriorityFee("high")
  //   .withSimulation()                    // throws if simulation fails
  //   .withRetry(5)
  //   .send(signer)

  // ─── Option C: Launch + fee config atomically ─────────────────────────────
  // const result = await sdk.tokens.launchWithFeeConfig(
  //   {
  //     name: "Club Token",
  //     symbol: "CLUB",
  //     image: "https://example.com/club.png",
  //     initialBuyAmount: 0.5,
  //     feeConfig: {
  //       splits: [
  //         { wallet: "creator111...", share: 0.6 },
  //         { wallet: "modwallet...",  share: 0.2 },
  //         { wallet: "daovault...",   share: 0.2 },
  //       ]
  //     }
  //   },
  //   signer
  // )

  sdk.destroy()
}

main().catch(console.error)
