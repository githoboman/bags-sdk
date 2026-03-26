/**
 * Example: Privy embedded wallet signer
 *
 * PrivySigner lets consumer apps sign Solana transactions without
 * exposing private keys. Users sign in with email/social, and Privy
 * handles the wallet in a secure enclave.
 *
 * Requires: npm install @privy-io/server-auth
 *
 * This example shows server-side usage. For client-side React apps,
 * use @privy-io/react-auth and pass the wallet to PrivySigner.fromUser().
 */

import { BagsSDK, PrivySigner } from "../src"
// import { PrivyClient } from "@privy-io/server-auth"  // uncomment when installed

async function main() {
  const sdk = new BagsSDK({
    bagsApiKey: process.env.BAGS_API_KEY!,
    heliusApiKey: process.env.HELIUS_API_KEY!,
  })

  // ─── Option A: From a Privy user object ────────────────────────────────────
  // After authenticating a user via Privy, you get a user object with
  // linked accounts. PrivySigner automatically finds their Solana wallet.

  /*
  const privyClient = new PrivyClient(
    process.env.PRIVY_APP_ID!,
    process.env.PRIVY_APP_SECRET!,
  )

  // Authenticate user (from your auth middleware)
  const { user } = await privyClient.verifyAuthToken(req.headers.authorization)

  // Create signer — finds the user's Solana embedded wallet automatically
  const signer = PrivySigner.fromUser(user, privyClient)

  // Now use it like any other signer
  const result = await sdk.trade.buy("TOKEN_MINT", 0.1, signer)
  console.log("Bought tokens:", result.signature)
  */

  // ─── Option B: From a known wallet address ─────────────────────────────────
  // If you already know the user's wallet address:

  /*
  const signer = PrivySigner.fromWallet({
    privyClient,
    walletAddress: "So1ana...",
    userId: "privy-user-id",
  })

  await sdk.trade.buy("TOKEN_MINT", 0.1, signer)
  */

  // ─── When to use which signer ──────────────────────────────────────────────
  //
  // KeypairSigner  → bots, scripts, backend services (you own the private key)
  // PrivySigner    → consumer apps (user signs in with email/social, no key exposure)
  // SessionKey     → delegated actions (time-limited, program-scoped, auto-expiring)

  console.log("PrivySigner example — uncomment the code above with your Privy credentials")

  sdk.destroy()
}

main().catch(console.error)
