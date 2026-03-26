import {
  TokenLaunchParams,
  TokenLaunchResult,
  LaunchedToken,
  BagsSigner,
  TxOptions,
} from "../types"
import { BagsAdapter } from "../adapters/bags.adapter"
import { HeliusAdapter } from "../adapters/helius.adapter"
import { BagsTx } from "../core/tx-builder"
import {
  TransactionMessage,
  VersionedTransaction,
  Transaction,
  PublicKey,
} from "@solana/web3.js"

/**
 * Token launching module — create and launch tokens on Bags.fm.
 *
 * Handles the full lifecycle: image upload, metadata creation, transaction building,
 * and optional atomic fee configuration.
 *
 * @example
 * ```ts
 * // Launch a token
 * const { mint, signature } = await sdk.tokens.launch({
 *   name: "My Token",
 *   symbol: "MYT",
 *   image: "https://example.com/logo.png",
 *   initialBuyAmount: 0.5,
 * }, signer)
 *
 * // Launch + fee config in one atomic transaction
 * const result = await sdk.tokens.launchWithFeeConfig({
 *   name: "My Token", symbol: "MYT",
 *   image: "https://example.com/logo.png",
 *   initialBuyAmount: 0.5,
 *   feeConfig: {
 *     splits: [
 *       { wallet: creatorWallet, share: 0.6 },
 *       { wallet: daoWallet, share: 0.4 },
 *     ],
 *   },
 * }, signer)
 * ```
 */
export class TokensModule {
  constructor(
    private bags: BagsAdapter,
    private helius: HeliusAdapter
  ) {}

  /**
   * Launch a token in one call.
   *
   * Handles: image upload -> metadata creation -> launch tx -> sign -> send.
   * Returns confirmed mint address, pool address, and signature.
   */
  async launch(
    params: TokenLaunchParams,
    signer: BagsSigner,
    txOptions: TxOptions = {}
  ): Promise<TokenLaunchResult> {
    const tx = await this.launchTx(params)
    const result = await tx
      .withPriorityFee(txOptions.priorityFee ?? "auto")
      .withSimulation()
      .send(signer)

    return {
      mint: result.mint!,
      poolAddress: result.poolAddress!,
      signature: result.signature,
      metadataUri: "",
    }
  }

  /**
   * Build a launch transaction without sending it.
   * Chain .withPriorityFee(), .withSimulation(), .withRetry() before .send(signer).
   */
  async launchTx(params: TokenLaunchParams): Promise<BagsTx> {
    // Step 1: Upload image (skipped if already a URL)
    const imageUri = await this.bags.uploadImage(params.image)

    // Step 2: Create metadata and get URI
    const { metadataUri } = await this.bags.createTokenMetadata({
      name: params.name,
      symbol: params.symbol,
      description: params.description,
      imageUri,
      twitter: params.twitter,
      telegram: params.telegram,
      website: params.website,
    })

    // Step 3: Build the launch transaction
    const { transaction, mint, poolAddress } = await this.bags.createLaunchTransaction({
      name: params.name,
      symbol: params.symbol,
      metadataUri,
      creatorWallet: "SIGNER_WALLET",
      initialBuyAmount: params.initialBuyAmount,
      feeShareWallet: params.feeShareWallet,
    })

    return new BagsTx(transaction, this.helius, { mint, poolAddress })
  }

  /**
   * Atomic: launch a token AND configure fee sharing in a single VersionedTransaction.
   *
   * Both instructions land in the same transaction — or neither does.
   * This prevents the race condition where a launch succeeds but fee config fails.
   *
   * Under the hood:
   * 1. Builds both the launch and fee-config serialized transactions via the API
   * 2. Extracts instructions from both
   * 3. Combines them into a single VersionedTransaction with a fresh blockhash
   * 4. Signs and sends atomically
   */
  async launchWithFeeConfig(
    params: TokenLaunchParams & {
      feeConfig: {
        splits: Array<{ wallet: string; share: number }>
      }
    },
    signer: BagsSigner,
    txOptions: TxOptions = {}
  ): Promise<TokenLaunchResult> {
    // Validate fee splits sum to 1.0
    const total = params.feeConfig.splits.reduce((sum, s) => sum + s.share, 0)
    if (Math.abs(total - 1.0) > 0.001) {
      throw new Error(`Fee splits must sum to 1.0 (got ${total.toFixed(3)})`)
    }

    // Step 1: Build the launch transaction (handles image upload + metadata)
    const imageUri = await this.bags.uploadImage(params.image)
    const { metadataUri } = await this.bags.createTokenMetadata({
      name: params.name,
      symbol: params.symbol,
      description: params.description,
      imageUri,
      twitter: params.twitter,
      telegram: params.telegram,
      website: params.website,
    })

    const launchData = await this.bags.createLaunchTransaction({
      name: params.name,
      symbol: params.symbol,
      metadataUri,
      creatorWallet: signer.publicKey,
      initialBuyAmount: params.initialBuyAmount,
      feeShareWallet: params.feeShareWallet,
    })

    // Step 2: Build the fee config transaction
    const feeConfigData = await this.bags.createFeeShareConfig({
      mint: launchData.mint,
      splits: params.feeConfig.splits,
      signerWallet: signer.publicKey,
    })

    // Step 3: Extract instructions from both serialized transactions
    const launchIxs = extractInstructions(launchData.transaction)
    const feeIxs = extractInstructions(feeConfigData.transaction)

    // Step 4: Combine into a single VersionedTransaction
    const { blockhash } = await this.helius.getLatestBlockhash()

    const message = new TransactionMessage({
      payerKey: new PublicKey(signer.publicKey),
      recentBlockhash: blockhash,
      instructions: [...launchIxs, ...feeIxs],
    }).compileToV0Message()

    const combinedTx = new VersionedTransaction(message)
    const serialized = Buffer.from(combinedTx.serialize()).toString("base64")

    // Step 5: Wrap in BagsTx for consistent priority fee / simulation / send flow
    const tx = new BagsTx(serialized, this.helius, {
      mint: launchData.mint,
      poolAddress: launchData.poolAddress,
    })

    const result = await tx
      .withPriorityFee(txOptions.priorityFee ?? "auto")
      .withSimulation()
      .send(signer)

    return {
      mint: launchData.mint,
      poolAddress: launchData.poolAddress,
      signature: result.signature,
      metadataUri,
    }
  }

  /**
   * Stream the live token launch feed as an async generator.
   */
  async *feed(pollIntervalMs = 3000): AsyncGenerator<LaunchedToken> {
    const seenMints = new Set<string>()

    while (true) {
      try {
        const rawFeed = await this.bags.getTokenFeed(20) as LaunchedToken[]
        for (const token of rawFeed) {
          if (!seenMints.has(token.mint)) {
            seenMints.add(token.mint)
            yield token
          }
        }
      } catch {
        // Retry on next iteration
      }
      await sleep(pollIntervalMs)
    }
  }
}

/**
 * Extract instructions from a base64-serialized transaction.
 * Handles both legacy Transaction and VersionedTransaction formats.
 */
function extractInstructions(base64Tx: string) {
  const txBytes = Buffer.from(base64Tx, "base64")

  // Try VersionedTransaction first
  try {
    const vtx = VersionedTransaction.deserialize(txBytes)
    const keys = vtx.message.staticAccountKeys
    return vtx.message.compiledInstructions.map(ix => ({
      programId: keys[ix.programIdIndex],
      keys: ix.accountKeyIndexes.map(idx => ({
        pubkey: keys[idx],
        isSigner: vtx.message.isAccountSigner(idx),
        isWritable: vtx.message.isAccountWritable(idx),
      })),
      data: Buffer.from(ix.data),
    }))
  } catch {
    // Fall back to legacy Transaction
    const tx = Transaction.from(txBytes)
    return tx.instructions
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
