import { BagsSDKConfig, TxOptions } from "../types"

const DEFAULT_BASE_URL = "https://public-api-v2.bags.fm/api/v1"

interface RateLimiter {
  remaining: number
  resetAt: number
}

export class BagsAdapter {
  private baseUrl: string
  private apiKey: string
  private rateLimiter: RateLimiter = { remaining: 1000, resetAt: Date.now() + 3600000 }

  constructor(config: BagsSDKConfig) {
    this.baseUrl = config.bagsBaseUrl ?? DEFAULT_BASE_URL
    this.apiKey = config.bagsApiKey
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    // Check rate limit
    if (this.rateLimiter.remaining <= 0 && Date.now() < this.rateLimiter.resetAt) {
      const waitMs = this.rateLimiter.resetAt - Date.now()
      throw new Error(`Bags API rate limit hit. Resets in ${Math.ceil(waitMs / 1000)}s`)
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    // Update rate limit state from response headers
    const remaining = res.headers.get("X-RateLimit-Remaining")
    const resetAt = res.headers.get("X-RateLimit-Reset")
    if (remaining) this.rateLimiter.remaining = parseInt(remaining)
    if (resetAt) this.rateLimiter.resetAt = parseInt(resetAt) * 1000

    const json = await res.json() as { success: boolean; response?: T; error?: string }

    if (!json.success) {
      throw new Error(`Bags API error on ${method} ${path}: ${json.error ?? "unknown error"}`)
    }

    return json.response as T
  }

  // ─── Token Launch ─────────────────────────────────────────────────────────

  async uploadImage(image: File | string): Promise<string> {
    if (typeof image === "string") {
      // Already a URL — skip upload
      return image
    }
    // Convert File to base64 for upload
    const arrayBuffer = await image.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString("base64")
    const result = await this.request<{ uri: string }>("POST", "/token/upload-image", {
      data: base64,
      contentType: image.type,
      filename: image.name,
    })
    return result.uri
  }

  async createTokenMetadata(params: {
    name: string
    symbol: string
    description?: string
    imageUri: string
    twitter?: string
    telegram?: string
    website?: string
  }): Promise<{ metadataUri: string }> {
    return this.request("POST", "/token/create-token-info", params)
  }

  async createLaunchTransaction(params: {
    name: string
    symbol: string
    metadataUri: string
    creatorWallet: string
    initialBuyAmount?: number
    feeShareWallet?: string
  }): Promise<{ transaction: string; mint: string; poolAddress: string }> {
    return this.request("POST", "/token/create-token-launch-transaction", params)
  }

  async getTokenFeed(limit = 20): Promise<unknown[]> {
    return this.request("GET", `/token/launch-feed?limit=${limit}`)
  }

  // ─── Fee Share ────────────────────────────────────────────────────────────

  async getFeeShareWallet(mint: string): Promise<{ wallet: string; config: unknown }> {
    return this.request("GET", `/fee-share/wallet?mint=${mint}`)
  }

  async createFeeShareConfig(params: {
    mint: string
    splits: Array<{ wallet: string; share: number }>
    signerWallet: string
  }): Promise<{ transaction: string }> {
    return this.request("POST", "/fee-share/create-config", params)
  }

  async getClaimablePositions(wallet: string): Promise<unknown[]> {
    return this.request("GET", `/fee/claimable?wallet=${wallet}`)
  }

  async createClaimTransactions(params: {
    wallet: string
    mints?: string[]
  }): Promise<{ transactions: string[] }> {
    return this.request("POST", "/fee/claim-transactions-v3", params)
  }

  // ─── Analytics ────────────────────────────────────────────────────────────

  async getTokenLifetimeFees(mint: string): Promise<{
    lifetimeFees: number
    claimStats: unknown
  }> {
    return this.request("GET", `/analytics/token-lifetime-fees?mint=${mint}`)
  }

  async getTokenClaimEvents(mint: string): Promise<unknown[]> {
    return this.request("GET", `/analytics/token-claim-events?mint=${mint}`)
  }

  // ─── Pool State ───────────────────────────────────────────────────────────

  async getPoolByMint(mint: string): Promise<unknown> {
    return this.request("GET", `/state/pool?mint=${mint}`)
  }

  async getAllPools(): Promise<unknown[]> {
    return this.request("GET", "/state/pools")
  }

  // ─── Trade ────────────────────────────────────────────────────────────────

  async getTradeQuote(params: {
    tokenMint: string
    side: "buy" | "sell"
    amount: number
    slippage?: number
  }): Promise<{
    inputAmount: number
    outputAmount: number
    priceImpact: number
    transaction?: string
  }> {
    const qs = new URLSearchParams({
      tokenMint: params.tokenMint,
      side: params.side,
      amount: params.amount.toString(),
      slippage: (params.slippage ?? 0.01).toString(),
    })
    return this.request("GET", `/trade/quote?${qs}`)
  }

  async createSwapTransaction(params: {
    tokenMint: string
    side: "buy" | "sell"
    amount: number
    slippage?: number
    wallet: string
  }): Promise<{ transaction: string }> {
    return this.request("POST", "/trade/create-swap-transaction", params)
  }

  // ─── Solana / Send ────────────────────────────────────────────────────────

  async sendTransaction(signedTx: string): Promise<{ signature: string }> {
    return this.request("POST", "/solana/send-transaction", { transaction: signedTx })
  }
}
