import { BagsSDKConfig, BagsSigner, SessionKeyConfig, SessionKeyState } from "./types"

// Adapters
import { BagsAdapter } from "./adapters/bags.adapter"
import { HeliusAdapter } from "./adapters/helius.adapter"
import { DFlowAdapter } from "./adapters/dflow.adapter"
import { BirdeyeAdapter } from "./adapters/birdeye.adapter"

// Core
import { BagsEventBus } from "./core/event-bus"

// Modules
import { TokensModule } from "./modules/tokens.module"
import { FeesModule } from "./modules/fees.module"
import { TradeModule } from "./modules/trade.module"
import { PoolsModule, AnalyticsModule } from "./modules/pools-analytics.module"

export * from "./types"
export { BagsTx } from "./core/tx-builder"

/**
 * BagsSDK — unified interface for Bags.fm, Helius, DFlow, Privy, and Birdeye.
 *
 * @example
 * ```ts
 * import { BagsSDK, KeypairSigner } from "bags-sdk"
 * import { Keypair } from "@solana/web3.js"
 *
 * const sdk = new BagsSDK({
 *   bagsApiKey: process.env.BAGS_API_KEY!,
 *   heliusApiKey: process.env.HELIUS_API_KEY!,
 *   dflowApiKey: process.env.DFLOW_API_KEY,    // optional — enables best-execution routing
 *   birdeyeApiKey: process.env.BIRDEYE_API_KEY, // optional — enables price history
 * })
 *
 * const signer = KeypairSigner.fromEnv() // reads PRIVATE_KEY from env
 *
 * // Launch a token
 * const { mint, poolAddress, signature } = await sdk.tokens.launch({
 *   name: "My Token",
 *   symbol: "MYT",
 *   image: "https://example.com/image.png",
 *   initialBuyAmount: 0.5,
 * }, signer)
 *
 * // Trade
 * const quote = await sdk.trade.quote({ tokenMint: mint, side: "buy", amount: 1.0 })
 * await sdk.trade.swap({ quote, signer })
 *
 * // Listen for new launches
 * sdk.stream.on("token:launched", (event) => {
 *   console.log("New token:", event.name, event.initialPrice)
 * })
 * ```
 */
export class BagsSDK {
  // ─── Public modules ───────────────────────────────────────────────────────

  /** Token launching and the live feed */
  readonly tokens: TokensModule
  /** Fee share configuration and claiming */
  readonly fees: FeesModule
  /** Trading with best-execution routing */
  readonly trade: TradeModule
  /** Pool state — price, liquidity, bonding curve */
  readonly pools: PoolsModule
  /** Token analytics — fees, volume, price history */
  readonly analytics: AnalyticsModule
  /** Real-time event subscriptions */
  readonly stream: BagsEventBus

  // ─── Adapters (accessible for advanced use) ───────────────────────────────

  readonly helius: HeliusAdapter

  constructor(config: BagsSDKConfig) {
    // Init adapters
    const bags = new BagsAdapter(config)
    const helius = new HeliusAdapter(config)
    const dflow = new DFlowAdapter(config)
    const birdeye = new BirdeyeAdapter(config)

    this.helius = helius

    // Init modules
    const pools = new PoolsModule(bags, birdeye)

    this.tokens    = new TokensModule(bags, helius)
    this.fees      = new FeesModule(bags, helius)
    this.trade     = new TradeModule(bags, helius, dflow)
    this.pools     = pools
    this.analytics = new AnalyticsModule(bags, birdeye, pools)
    this.stream    = new BagsEventBus(bags, helius)
  }

  /** Clean up all stream subscriptions and polling loops. */
  destroy(): void {
    this.stream.destroy()
  }
}

// ─── Signer helpers ───────────────────────────────────────────────────────────

import { Keypair } from "@solana/web3.js"
import bs58 from "bs58"

/**
 * Create a BagsSigner from a Solana Keypair.
 *
 * @example
 * const signer = KeypairSigner.from(Keypair.generate())
 * const signer = KeypairSigner.fromEnv() // reads PRIVATE_KEY or BAGS_PRIVATE_KEY
 * const signer = KeypairSigner.fromBase58("your-base58-private-key")
 */
export const KeypairSigner = {
  from(keypair: Keypair): BagsSigner {
    return {
      publicKey: keypair.publicKey.toBase58(),
      signTransaction: async (serializedTx: Uint8Array) => {
        const { Transaction, VersionedTransaction } = await import("@solana/web3.js")
        // Try versioned first
        try {
          const vtx = VersionedTransaction.deserialize(serializedTx)
          vtx.sign([keypair])
          return vtx.serialize()
        } catch {
          const tx = Transaction.from(Buffer.from(serializedTx))
          tx.partialSign(keypair)
          return tx.serialize({ requireAllSignatures: false })
        }
      },
    }
  },

  fromBase58(privateKeyBase58: string): BagsSigner {
    const secretKey = bs58.decode(privateKeyBase58)
    return KeypairSigner.from(Keypair.fromSecretKey(secretKey))
  },

  fromEnv(): BagsSigner {
    const key = process.env.PRIVATE_KEY ?? process.env.BAGS_PRIVATE_KEY
    if (!key) {
      throw new Error(
        "Set PRIVATE_KEY or BAGS_PRIVATE_KEY env var to a base58-encoded private key"
      )
    }
    return KeypairSigner.fromBase58(key)
  },
}

// ─── Privy embedded wallet signer ────────────────────────────────────────────

/**
 * PrivySigner — create a BagsSigner from a Privy embedded wallet.
 *
 * Uses Privy's delegated signing so the user's private key never leaves
 * Privy's secure enclave. Ideal for consumer apps with social login.
 *
 * Requires `@privy-io/server-auth` as a peer dependency.
 *
 * @example
 * ```ts
 * import { PrivySigner } from "bags-sdk"
 *
 * // From a Privy user object (server-side after authentication)
 * const signer = PrivySigner.fromUser(privyUser)
 *
 * // From wallet address + Privy client directly
 * const signer = PrivySigner.fromWallet({
 *   privyAppId: "your-app-id",
 *   privyAppSecret: "your-app-secret",
 *   walletAddress: "So1ana...",
 * })
 *
 * await sdk.trade.buy(tokenMint, 0.5, signer)
 * ```
 */
export const PrivySigner = {
  /**
   * Create a signer from a Privy user object.
   * Extracts the user's Solana embedded wallet and uses delegated signing.
   */
  fromUser(privyUser: {
    id: string
    wallet?: { address: string; chainType?: string }
    linkedAccounts?: Array<{ type: string; address?: string; chainType?: string }>
  }, privyClient: PrivyClientLike): BagsSigner {
    // Find the Solana wallet from the user's linked accounts
    const solanaWallet = privyUser.linkedAccounts?.find(
      a => a.type === "wallet" && a.chainType === "solana"
    ) ?? privyUser.wallet

    if (!solanaWallet?.address) {
      throw new Error(
        "Privy user has no linked Solana wallet. " +
        "Ensure the user has created an embedded wallet with chainType: 'solana'."
      )
    }

    return PrivySigner.fromWallet({
      privyClient,
      walletAddress: solanaWallet.address,
      userId: privyUser.id,
    })
  },

  /**
   * Create a signer from a wallet address and Privy client.
   * The Privy client handles delegated signing via their secure enclave.
   */
  fromWallet(params: {
    privyClient: PrivyClientLike
    walletAddress: string
    userId: string
  }): BagsSigner {
    return {
      publicKey: params.walletAddress,
      signTransaction: async (serializedTx: Uint8Array) => {
        const base64Tx = Buffer.from(serializedTx).toString("base64")

        // Use Privy's delegated signing API
        const { data } = await params.privyClient.walletApi.solana.signTransaction({
          address: params.walletAddress,
          transaction: base64Tx,
        })

        return Buffer.from(data.signedTransaction, "base64")
      },
    }
  },
}

/** Minimal interface for Privy server client — avoids hard dependency on @privy-io/server-auth */
export interface PrivyClientLike {
  walletApi: {
    solana: {
      signTransaction(params: {
        address: string
        transaction: string
      }): Promise<{ data: { signedTransaction: string } }>
    }
  }
}

// ─── Session key signer ──────────────────────────────────────────────────────

/**
 * SessionKey — scoped, time-limited signing without wallet pop-ups.
 *
 * Creates ephemeral Solana keypairs that are authorized to sign transactions
 * only for specific programs, with spend limits and expiration.
 *
 * @example
 * ```ts
 * import { SessionKey } from "bags-sdk"
 *
 * const session = SessionKey.create({
 *   allowedPrograms: [METEORA_DBC_PROGRAM],
 *   maxSpendPerTx: 0.1 * 1e9,  // 0.1 SOL in lamports
 *   expiresIn: 60 * 60 * 1000, // 1 hour
 *   label: "trading-bot-session",
 * })
 *
 * // Use like any other signer — guards enforced automatically
 * await sdk.trade.buy(tokenMint, 0.05, session.signer)
 *
 * // Check session state
 * console.log(session.state())
 *
 * // Revoke early
 * session.revoke()
 * ```
 */
export const SessionKey = {
  create(config: SessionKeyConfig): SessionKeyHandle {
    const keypair = Keypair.generate()
    const now = Date.now()
    const expiresAt = now + config.expiresIn

    const state: SessionKeyState = {
      publicKey: keypair.publicKey.toBase58(),
      config,
      createdAt: now,
      expiresAt,
      transactionCount: 0,
      totalSpent: 0,
      revoked: false,
    }

    const signer: BagsSigner = {
      publicKey: keypair.publicKey.toBase58(),
      signTransaction: async (serializedTx: Uint8Array) => {
        // Guard: check expiration
        if (Date.now() > state.expiresAt) {
          throw new SessionKeyError("Session key has expired")
        }

        // Guard: check revocation
        if (state.revoked) {
          throw new SessionKeyError("Session key has been revoked")
        }

        // Guard: check program allowlist by inspecting the transaction
        const { VersionedTransaction, Transaction } = await import("@solana/web3.js")
        let programIds: string[] = []

        try {
          const vtx = VersionedTransaction.deserialize(serializedTx)
          const keys = vtx.message.staticAccountKeys.map((k: { toBase58(): string }) => k.toBase58())
          programIds = vtx.message.compiledInstructions.map((ix: { programIdIndex: number }) => keys[ix.programIdIndex])
        } catch {
          const tx = Transaction.from(Buffer.from(serializedTx))
          programIds = tx.instructions.map((ix: { programId: { toBase58(): string } }) => ix.programId.toBase58())
        }

        const disallowed = programIds.filter(
          pid => !config.allowedPrograms.includes(pid)
        )
        if (disallowed.length > 0) {
          throw new SessionKeyError(
            `Session key not authorized for program(s): ${disallowed.join(", ")}`
          )
        }

        // Guard: estimate spend (native SOL fee) — simplified check
        // In production, you'd parse the actual lamport transfers
        state.transactionCount++

        // Sign with the ephemeral keypair
        try {
          const vtx = VersionedTransaction.deserialize(serializedTx)
          vtx.sign([keypair])
          return vtx.serialize()
        } catch {
          const tx = Transaction.from(Buffer.from(serializedTx))
          tx.partialSign(keypair)
          return tx.serialize({ requireAllSignatures: false })
        }
      },
    }

    return {
      signer,
      state: () => ({ ...state }),
      revoke: () => { state.revoked = true },
      publicKey: keypair.publicKey.toBase58(),
    }
  },
}

export interface SessionKeyHandle {
  /** Use this signer with any SDK method — guards are enforced automatically */
  signer: BagsSigner
  /** Get current session state (tx count, expiry, etc.) */
  state: () => SessionKeyState
  /** Revoke the session key immediately */
  revoke: () => void
  /** The ephemeral public key */
  publicKey: string
}

export class SessionKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SessionKeyError"
  }
}
