import { BagsSDKConfig, PricePoint } from "../types"

const BIRDEYE_BASE = "https://public-api.birdeye.so"

export class BirdeyeAdapter {
  private apiKey: string
  private enabled: boolean

  constructor(config: BagsSDKConfig) {
    this.apiKey = config.birdeyeApiKey ?? ""
    this.enabled = !!config.birdeyeApiKey
  }

  isEnabled(): boolean {
    return this.enabled
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${BIRDEYE_BASE}${path}`, {
      headers: {
        "X-API-KEY": this.apiKey,
        "x-chain": "solana",
      },
    })
    if (!res.ok) throw new Error(`Birdeye API ${res.status}: ${await res.text()}`)
    const json = await res.json() as { success: boolean; data: T }
    return json.data
  }

  async getTokenPrice(mint: string): Promise<{ price: number; priceUsd: number } | null> {
    if (!this.enabled) return null
    try {
      const data = await this.request<{ value: number }>(`/defi/price?address=${mint}`)
      return { price: data.value, priceUsd: data.value }
    } catch {
      return null
    }
  }

  async getPriceHistory(
    mint: string,
    resolution: "15m" | "1H" | "4H" | "1D" = "1H",
    limit = 100
  ): Promise<PricePoint[]> {
    if (!this.enabled) return []
    try {
      const data = await this.request<{ items: Array<{ unixTime: number; value: number; volume: number }> }>(
        `/defi/history_price?address=${mint}&address_type=token&type=${resolution}&limit=${limit}`
      )
      return data.items.map(p => ({
        timestamp: p.unixTime * 1000,
        price: p.value,
        volume: p.volume ?? 0,
      }))
    } catch {
      return []
    }
  }

  async getTokenVolume(mint: string): Promise<{ volume24h: number; volumeChange24h: number } | null> {
    if (!this.enabled) return null
    try {
      const data = await this.request<{ v24hUSD: number; v24hChangePercent: number }>(
        `/defi/token_overview?address=${mint}`
      )
      return { volume24h: data.v24hUSD, volumeChange24h: data.v24hChangePercent }
    } catch {
      return null
    }
  }
}
