import { describe, it, expect, vi } from "vitest"
import { BagsSDK } from "../src/index"

// Mock fetch for adapter initialization
vi.stubGlobal("fetch", vi.fn())

describe("BagsSDK", () => {
  it("initializes all modules", () => {
    const sdk = new BagsSDK({
      bagsApiKey: "test-bags-key",
      heliusApiKey: "test-helius-key",
    })

    expect(sdk.tokens).toBeDefined()
    expect(sdk.fees).toBeDefined()
    expect(sdk.trade).toBeDefined()
    expect(sdk.pools).toBeDefined()
    expect(sdk.analytics).toBeDefined()
    expect(sdk.stream).toBeDefined()
    expect(sdk.helius).toBeDefined()

    sdk.destroy()
  })

  it("initializes with optional adapters", () => {
    const sdk = new BagsSDK({
      bagsApiKey: "test-bags-key",
      heliusApiKey: "test-helius-key",
      dflowApiKey: "test-dflow-key",
      birdeyeApiKey: "test-birdeye-key",
    })

    expect(sdk.tokens).toBeDefined()
    expect(sdk.trade).toBeDefined()

    sdk.destroy()
  })

  it("destroy() cleans up without errors", () => {
    const sdk = new BagsSDK({
      bagsApiKey: "test-bags-key",
      heliusApiKey: "test-helius-key",
    })

    expect(() => sdk.destroy()).not.toThrow()
  })

  it("destroy() can be called multiple times safely", () => {
    const sdk = new BagsSDK({
      bagsApiKey: "test-bags-key",
      heliusApiKey: "test-helius-key",
    })

    expect(() => {
      sdk.destroy()
      sdk.destroy()
    }).not.toThrow()
  })
})
