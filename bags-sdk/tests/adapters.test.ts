import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { BagsAdapter } from "../src/adapters/bags.adapter"
import { DFlowAdapter } from "../src/adapters/dflow.adapter"
import { BirdeyeAdapter } from "../src/adapters/birdeye.adapter"

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

describe("BagsAdapter", () => {
  let adapter: BagsAdapter

  beforeEach(() => {
    adapter = new BagsAdapter({ bagsApiKey: "test-key", heliusApiKey: "h-key" })
    mockFetch.mockReset()
  })

  it("sends x-api-key header", async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: true, response: [] }),
      headers: new Map(),
    })

    await adapter.getTokenFeed()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/token/launch-feed"),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "test-key" }),
      })
    )
  })

  it("throws on API error response", async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: false, error: "Invalid token" }),
      headers: new Map(),
    })

    await expect(adapter.getPoolByMint("bad-mint")).rejects.toThrow("Invalid token")
  })

  it("throws on rate limit hit", async () => {
    // Simulate rate limit exhausted
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: true, response: "ok" }),
      headers: {
        get: (name: string) => {
          if (name === "X-RateLimit-Remaining") return "0"
          if (name === "X-RateLimit-Reset") return String(Math.floor(Date.now() / 1000) + 3600)
          return null
        },
      },
    })

    // First call succeeds but sets rate limit to 0
    await adapter.getTokenFeed()

    // Second call should throw rate limit error
    await expect(adapter.getTokenFeed()).rejects.toThrow("rate limit")
  })

  it("uploadImage returns URL directly for string input", async () => {
    const result = await adapter.uploadImage("https://example.com/image.png")
    expect(result).toBe("https://example.com/image.png")
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("uses custom base URL when provided", () => {
    const custom = new BagsAdapter({
      bagsApiKey: "key",
      heliusApiKey: "h-key",
      bagsBaseUrl: "https://custom-api.bags.fm/api/v1",
    })

    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: true, response: [] }),
      headers: new Map(),
    })

    custom.getTokenFeed()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("custom-api.bags.fm"),
      expect.any(Object)
    )
  })
})

describe("DFlowAdapter", () => {
  it("isEnabled() returns false when no API key", () => {
    const dflow = new DFlowAdapter({ bagsApiKey: "b", heliusApiKey: "h" })
    expect(dflow.isEnabled()).toBe(false)
  })

  it("isEnabled() returns true when API key provided", () => {
    const dflow = new DFlowAdapter({ bagsApiKey: "b", heliusApiKey: "h", dflowApiKey: "dflow-key" })
    expect(dflow.isEnabled()).toBe(true)
  })

  it("getSwapQuote() returns null when disabled", async () => {
    const dflow = new DFlowAdapter({ bagsApiKey: "b", heliusApiKey: "h" })
    const result = await dflow.getSwapQuote({ tokenMint: "mint", side: "buy", amount: 1.0 })
    expect(result).toBeNull()
  })

  it("getSwapQuote() returns null on API error (graceful fallback)", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"))
    const dflow = new DFlowAdapter({ bagsApiKey: "b", heliusApiKey: "h", dflowApiKey: "key" })
    const result = await dflow.getSwapQuote({ tokenMint: "mint", side: "buy", amount: 1.0 })
    expect(result).toBeNull()
  })
})

describe("BirdeyeAdapter", () => {
  beforeEach(() => mockFetch.mockReset())

  it("isEnabled() returns false when no API key", () => {
    const birdeye = new BirdeyeAdapter({ bagsApiKey: "b", heliusApiKey: "h" })
    expect(birdeye.isEnabled()).toBe(false)
  })

  it("getTokenPrice() returns null when disabled", async () => {
    const birdeye = new BirdeyeAdapter({ bagsApiKey: "b", heliusApiKey: "h" })
    const result = await birdeye.getTokenPrice("mint")
    expect(result).toBeNull()
  })

  it("getPriceHistory() returns empty array when disabled", async () => {
    const birdeye = new BirdeyeAdapter({ bagsApiKey: "b", heliusApiKey: "h" })
    const result = await birdeye.getPriceHistory("mint")
    expect(result).toEqual([])
  })

  it("getTokenVolume() returns null when disabled", async () => {
    const birdeye = new BirdeyeAdapter({ bagsApiKey: "b", heliusApiKey: "h" })
    const result = await birdeye.getTokenVolume("mint")
    expect(result).toBeNull()
  })

  it("getTokenPrice() returns null on API error (graceful)", async () => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    })
    const birdeye = new BirdeyeAdapter({ bagsApiKey: "b", heliusApiKey: "h", birdeyeApiKey: "key" })
    const result = await birdeye.getTokenPrice("mint")
    expect(result).toBeNull()
  })

  it("getPriceHistory() maps response correctly when enabled", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: {
          items: [
            { unixTime: 1700000, value: 0.05, volume: 1000 },
            { unixTime: 1700100, value: 0.06, volume: 2000 },
          ],
        },
      }),
    })

    const birdeye = new BirdeyeAdapter({ bagsApiKey: "b", heliusApiKey: "h", birdeyeApiKey: "key" })
    const result = await birdeye.getPriceHistory("mint", "1H", 10)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ timestamp: 1700000000, price: 0.05, volume: 1000 })
    expect(result[1]).toEqual({ timestamp: 1700100000, price: 0.06, volume: 2000 })
  })
})
