import { BagsSigner, TxOptions, SendTxResult } from "../types"
import { HeliusAdapter } from "../adapters/helius.adapter"

/**
 * BagsTx — a lazily-evaluated transaction object.
 *
 * You receive one of these from every module method that produces a transaction.
 * Chain modifiers before calling .send(signer) to commit.
 *
 * Example:
 *   const sig = await bags.tokens
 *     .launchTx(params)
 *     .withPriorityFee("auto")
 *     .withSimulation()
 *     .send(signer)
 */
export class BagsTx {
  private serializedTx: string
  private helius: HeliusAdapter
  private options: TxOptions = {}
  private _mint?: string
  private _poolAddress?: string

  constructor(
    serializedTx: string,
    helius: HeliusAdapter,
    meta?: { mint?: string; poolAddress?: string }
  ) {
    this.serializedTx = serializedTx
    this.helius = helius
    this._mint = meta?.mint
    this._poolAddress = meta?.poolAddress
  }

  /** Set priority fee. "auto" uses Helius fee estimation. */
  withPriorityFee(level: TxOptions["priorityFee"]): BagsTx {
    this.options.priorityFee = level
    return this
  }

  /** Simulate the transaction before sending. Throws if simulation fails. */
  withSimulation(): BagsTx {
    this.options.simulate = true
    return this
  }

  /** Override max send retries (default: 3). */
  withRetry(maxRetries: number): BagsTx {
    this.options.maxRetries = maxRetries
    return this
  }

  /** Override commitment level. */
  withCommitment(level: TxOptions["commitment"]): BagsTx {
    this.options.commitment = level
    return this
  }

  /**
   * Sign and send the transaction.
   * Returns the confirmed signature (and any extra metadata if applicable).
   */
  async send(signer: BagsSigner): Promise<SendTxResult & { mint?: string; poolAddress?: string }> {
    // Step 1: Optional simulation
    if (this.options.simulate) {
      const sim = await this.helius.simulateTransaction(this.serializedTx)
      if (!sim.success) {
        throw new Error(
          `Transaction simulation failed: ${sim.error}\nLogs:\n${sim.logs.join("\n")}`
        )
      }
    }

    // Step 2: Sign
    const txBytes = Buffer.from(this.serializedTx, "base64")
    const signedBytes = await signer.signTransaction(txBytes)
    const signedBase64 = Buffer.from(signedBytes).toString("base64")

    // Step 3: Send via Helius Sender
    const result = await this.helius.sendTransaction(signedBase64, this.options)

    return {
      ...result,
      mint: this._mint,
      poolAddress: this._poolAddress,
    }
  }

  /** Inspect the raw serialized transaction (base64) without sending. */
  getRawTransaction(): string {
    return this.serializedTx
  }
}
