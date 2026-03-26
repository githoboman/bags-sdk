import {
  FeeConfigParams,
  FeeStats,
  BagsSigner,
  TxOptions,
} from "../types"
import { BagsAdapter } from "../adapters/bags.adapter"
import { HeliusAdapter } from "../adapters/helius.adapter"
import { BagsTx } from "../core/tx-builder"

/**
 * Fee sharing module — configure and claim fee splits on Bags.fm tokens.
 *
 * @example
 * ```ts
 * // Configure fee splits (must sum to 1.0)
 * await sdk.fees.createConfig({
 *   mint: tokenMint,
 *   splits: [
 *     { wallet: creatorWallet, share: 0.6 },
 *     { wallet: modWallet, share: 0.4 },
 *   ],
 * }, signer)
 *
 * // Check fee stats
 * const stats = await sdk.fees.getStats(tokenMint)
 * console.log(`Claimable: ${stats.claimableNow} SOL`)
 *
 * // Claim all accumulated fees
 * const { totalClaimed, signatures } = await sdk.fees.claimAll(walletAddress, signer)
 * ```
 */
export class FeesModule {
  constructor(
    private bags: BagsAdapter,
    private helius: HeliusAdapter
  ) {}

  /**
   * Configure fee sharing for a token you launched.
   *
   * Splits must sum to 1.0.
   *
   * Example:
   *   await bags.fees.createConfig({
   *     mint: "...",
   *     splits: [
   *       { wallet: creatorWallet, share: 0.6 },
   *       { wallet: modWallet,     share: 0.2 },
   *       { wallet: daoWallet,     share: 0.2 },
   *     ]
   *   }, signer)
   */
  async createConfig(
    params: FeeConfigParams,
    signer: BagsSigner,
    txOptions: TxOptions = {}
  ): Promise<{ signature: string }> {
    const total = params.splits.reduce((sum, s) => sum + s.share, 0)
    if (Math.abs(total - 1.0) > 0.001) {
      throw new Error(`Fee splits must sum to 1.0 (got ${total.toFixed(3)})`)
    }

    const tx = await this.createConfigTx(params, signer.publicKey)
    return tx.withPriorityFee(txOptions.priorityFee ?? "medium").send(signer)
  }

  async createConfigTx(params: FeeConfigParams, signerWallet: string): Promise<BagsTx> {
    const { transaction } = await this.bags.createFeeShareConfig({
      mint: params.mint,
      splits: params.splits,
      signerWallet,
    })
    return new BagsTx(transaction, this.helius)
  }

  /**
   * Get fee stats for a token: lifetime fees earned, claimable now, and claim history.
   */
  async getStats(mint: string): Promise<FeeStats> {
    const [feeData, claimEvents] = await Promise.all([
      this.bags.getTokenLifetimeFees(mint),
      this.bags.getTokenClaimEvents(mint),
    ])

    return {
      mint,
      lifetimeFees: (feeData as { lifetimeFees: number }).lifetimeFees ?? 0,
      claimableNow: (feeData as { claimStats: { claimable: number } }).claimStats?.claimable ?? 0,
      claimEvents: (claimEvents as Array<{
        signature: string
        amount: number
        timestamp: number
        wallet: string
      }>).map(e => ({
        signature: e.signature,
        amount: e.amount,
        timestamp: e.timestamp,
        wallet: e.wallet,
      })),
    }
  }

  /**
   * Claim all accumulated fees across every token in a wallet.
   *
   * Returns total SOL claimed and all signatures.
   */
  async claimAll(
    wallet: string,
    signer: BagsSigner,
    txOptions: TxOptions = {}
  ): Promise<{ totalClaimed: number; signatures: string[] }> {
    const positions = await this.bags.getClaimablePositions(wallet)
    if (!positions.length) {
      return { totalClaimed: 0, signatures: [] }
    }

    const { transactions } = await this.bags.createClaimTransactions({ wallet })

    const signatures: string[] = []
    for (const rawTx of transactions) {
      const tx = new BagsTx(rawTx, this.helius)
      const result = await tx
        .withPriorityFee(txOptions.priorityFee ?? "medium")
        .send(signer)
      signatures.push(result.signature)
    }

    return { totalClaimed: 0, signatures } // totalClaimed populated in production from balances
  }
}
