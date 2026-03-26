/**
 * Example: Session keys — scoped, time-limited signing
 *
 * Session keys let bots and apps sign transactions without exposing
 * the master wallet. They auto-expire and only work with programs
 * you explicitly allow.
 *
 * Run: BAGS_API_KEY=... HELIUS_API_KEY=... PRIVATE_KEY=... ts-node examples/session-key.ts
 */

import { BagsSDK, KeypairSigner, SessionKey, SessionKeyError } from "../src"

// Meteora DBC program (Bags token bonding curve)
const METEORA_DBC = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"

async function main() {
  const sdk = new BagsSDK({
    bagsApiKey: process.env.BAGS_API_KEY!,
    heliusApiKey: process.env.HELIUS_API_KEY!,
  })

  // ─── Create a session key ──────────────────────────────────────────────────
  // This generates an ephemeral Keypair that can ONLY sign transactions
  // targeting the programs you specify, and expires after the time limit.

  const session = SessionKey.create({
    allowedPrograms: [
      METEORA_DBC,
      "11111111111111111111111111111111",                    // System Program
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",       // SPL Token
    ],
    maxSpendPerTx: 0.1 * 1e9,    // 0.1 SOL max per transaction
    expiresIn: 30 * 60 * 1000,   // 30 minutes
    label: "example-session",
  })

  console.log("Session key created:")
  console.log("  Public key:", session.publicKey)
  console.log("  Expires at:", new Date(session.state().expiresAt).toISOString())
  console.log()

  // ─── Use session.signer like any other signer ──────────────────────────────

  // The session signer enforces guards automatically:
  // - Rejects transactions to non-allowed programs
  // - Rejects after expiration
  // - Rejects after revocation

  try {
    // This would work if the session key was funded on-chain:
    // await sdk.trade.buy("TOKEN_MINT", 0.05, session.signer)
    console.log("Session signer ready for transactions")
  } catch (err) {
    if (err instanceof SessionKeyError) {
      console.log("Session guard blocked:", err.message)
    }
  }

  // ─── Monitor session state ─────────────────────────────────────────────────

  const state = session.state()
  console.log("\nSession state:")
  console.log("  Transactions:", state.transactionCount)
  console.log("  Total spent: ", state.totalSpent, "lamports")
  console.log("  Revoked:     ", state.revoked)
  console.log("  Expired:     ", Date.now() > state.expiresAt)

  // ─── Revoke when done ──────────────────────────────────────────────────────

  session.revoke()
  console.log("\nSession revoked. Any further signing attempts will throw.")

  // Verify: this would throw SessionKeyError("Session key has been revoked")
  // await session.signer.signTransaction(someTransaction)

  sdk.destroy()
}

main().catch(console.error)
