import {
  TradeQuoteParams,
  TradeQuote,
  TradeResult,
  BagsSigner,
  TxOptions,
} from "../types"
import { BagsAdapter } from "../adapters/bags.adapter"
import { HeliusAdapter } from "../adapters/helius.adapter"
import { DFlowAdapter } from "../adapters/dflow.adapter"
import { BagsTx } from "../core/tx-builder"

/**
 * Trading module — swap tokens with automatic best-execution routing.
 *
 * Compares quotes from Bags native route and DFlow (if configured)
 * and picks whichever gives a better output amount.
 *
 * @example
 * ```ts
 * // Quick buy
 * const result = await sdk.trade.buy(tokenMint, 0.5, signer)
 *
 * // Or step-by-step with quote inspection
 * const quote = await sdk.trade.quote({ tokenMint, side: "buy", amount: 1.0 })
 * console.log(`Route: ${quote.route}, Output: ${quote.outputAmount}`)
 * const result = await sdk.trade.swap({ quote, signer })
 * ```
 */
export class TradeModule {
  constructor(
    private bags: BagsAdapter,
    private helius: HeliusAdapter,
    private dflow: DFlowAdapter
  ) {}

  /**
   * Get the best available quote for a trade.
   *
   * Fetches quotes from both Bags native route and DFlow (if configured),
   * and returns whichever gives better output.
   */
  async quote(params: TradeQuoteParams): Promise<TradeQuote> {
    // Fetch both quotes concurrently
    const [bagsQuote, dflowQuote] = await Promise.allSettled([
      this.bags.getTradeQuote(params),
      this.dflow.getSwapQuote(params),
    ])

    const bagsResult = bagsQuote.status === "fulfilled" ? bagsQuote.value : null
    const dflowResult = dflowQuote.status === "fulfilled" ? dflowQuote.value : null

    // Pick the better output amount
    const useDflow =
      dflowResult &&
      dflowResult.outputAmount > (bagsResult?.outputAmount ?? 0)

    const chosen = useDflow ? dflowResult! : bagsResult!

    if (!chosen) {
      throw new Error("No quote available from either Bags or DFlow")
    }

    return {
      tokenMint: params.tokenMint,
      side: params.side,
      inputAmount: params.amount,
      outputAmount: chosen.outputAmount,
      priceImpact: chosen.priceImpact,
      route: useDflow ? "dflow" : "bags",
      estimatedFee: 0.000005, // ~5000 lamports base fee
      expiresAt: Date.now() + 30_000, // 30s validity
      _raw: chosen,
    }
  }

  /**
   * Execute a swap from a quote.
   *
   * Example:
   *   const quote = await bags.trade.quote({ tokenMint, side: "buy", amount: 1.0 })
   *   const result = await bags.trade.swap({ quote, signer })
   */
  async swap(
    params: { quote: TradeQuote; signer: BagsSigner },
    txOptions: TxOptions = {}
  ): Promise<TradeResult> {
    if (Date.now() > params.quote.expiresAt) {
      throw new Error("Quote has expired — call bags.trade.quote() again")
    }

    const tx = await this.swapTx(params.quote, params.signer.publicKey)
    const result = await tx
      .withPriorityFee(txOptions.priorityFee ?? "auto")
      .withSimulation()
      .send(params.signer)

    return {
      signature: result.signature,
      inputAmount: params.quote.inputAmount,
      outputAmount: params.quote.outputAmount,
      fee: params.quote.estimatedFee,
    }
  }

  /**
   * Build a swap transaction without sending it.
   */
  async swapTx(quote: TradeQuote, walletAddress: string): Promise<BagsTx> {
    const { transaction } = await this.bags.createSwapTransaction({
      tokenMint: quote.tokenMint,
      side: quote.side,
      amount: quote.inputAmount,
      slippage: 0.01,
      wallet: walletAddress,
    })
    return new BagsTx(transaction, this.helius)
  }

  /**
   * Buy tokens in one call — quotes + swaps automatically.
   *
   * @param tokenMint - The token's mint address
   * @param amountSOL - Amount of SOL to spend
   * @param signer - A BagsSigner (KeypairSigner, PrivySigner, or SessionKey)
   * @param options - Optional slippage and transaction options
   * @returns Trade result with signature, input/output amounts, and fee
   *
   * @example
   * ```ts
   * const result = await sdk.trade.buy("So1ana...", 0.5, signer, { slippage: 0.02 })
   * console.log(`Bought ${result.outputAmount} tokens — tx: ${result.signature}`)
   * ```
   */
  async buy(
    tokenMint: string,
    amountSOL: number,
    signer: BagsSigner,
    options: { slippage?: number } & TxOptions = {}
  ): Promise<TradeResult> {
    const quote = await this.quote({ tokenMint, side: "buy", amount: amountSOL, slippage: options.slippage })
    return this.swap({ quote, signer }, options)
  }

  /**
   * Sell tokens in one call — quotes + swaps automatically.
   *
   * @param tokenMint - The token's mint address
   * @param amountToken - Amount of tokens to sell
   * @param signer - A BagsSigner (KeypairSigner, PrivySigner, or SessionKey)
   * @param options - Optional slippage and transaction options
   * @returns Trade result with signature, input/output amounts, and fee
   */
  async sell(
    tokenMint: string,
    amountToken: number,
    signer: BagsSigner,
    options: { slippage?: number } & TxOptions = {}
  ): Promise<TradeResult> {
    const quote = await this.quote({ tokenMint, side: "sell", amount: amountToken, slippage: options.slippage })
    return this.swap({ quote, signer }, options)
  }
}
