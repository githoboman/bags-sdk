import { BagsSDKConfig, TradeQuoteParams } from "../types"

const DFLOW_BASE = "https://api.dflow.net"

export class DFlowAdapter {
  private apiKey: string
  private enabled: boolean

  constructor(config: BagsSDKConfig) {
    this.apiKey = config.dflowApiKey ?? ""
    this.enabled = !!config.dflowApiKey
  }

  isEnabled(): boolean {
    return this.enabled
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${DFLOW_BASE}${path}`, {
      headers: { "Authorization": `Bearer ${this.apiKey}` },
    })
    if (!res.ok) throw new Error(`DFlow API ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  }

  // ─── Quote ────────────────────────────────────────────────────────────────

  async getSwapQuote(params: TradeQuoteParams): Promise<{
    inputAmount: number
    outputAmount: number
    priceImpact: number
    route: string
    serializedTx?: string
  } | null> {
    if (!this.enabled) return null

    try {
      const qs = new URLSearchParams({
        inputMint: params.side === "buy" ? "So11111111111111111111111111111111111111112" : params.tokenMint,
        outputMint: params.side === "buy" ? params.tokenMint : "So11111111111111111111111111111111111111112",
        amount: String(Math.round(params.amount * 1e9)), // lamports
        slippage: String((params.slippage ?? 0.01) * 100), // bps
      })
      return await this.request(`/v1/quote?${qs}`)
    } catch {
      // DFlow unavailable — fall back gracefully to Bags native route
      return null
    }
  }
}
