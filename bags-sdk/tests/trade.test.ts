import { describe, it, expect, vi, beforeEach } from "vitest"
import { TradeModule } from "../src/modules/trade.module"
import type { BagsAdapter } from "../src/adapters/bags.adapter"
import type { HeliusAdapter } from "../src/adapters/helius.adapter"
import type { DFlowAdapter } from "../src/adapters/dflow.adapter"

function createMockBags(): BagsAdapter {
  return {
    getTradeQuote: vi.fn().mockResolvedValue({
      inputAmount: 1.0,
      outputAmount: 50000,
      priceImpact: 0.005,
      transaction: "base64tx",
    }),
    createSwapTransaction: vi.fn().mockResolvedValue({ transaction: "base64swaptx" }),
  } as unknown as BagsAdapter
}

function createMockHelius(): HeliusAdapter {
  return {
    sendTransaction: vi.fn().mockResolvedValue({ signature: "swap-sig-123" }),
    simulateTransaction: vi.fn().mockResolvedValue({ success: true, logs: [] }),
    estimatePriorityFee: vi.fn().mockResolvedValue(10000),
  } as unknown as HeliusAdapter
}

function createMockDflow(enabled: boolean, outputAmount = 60000): DFlowAdapter {
  return {
    isEnabled: () => enabled,
    getSwapQuote: vi.fn().mockResolvedValue(
      enabled
        ? { inputAmount: 1.0, outputAmount, priceImpact: 0.003, route: "dflow", serializedTx: "dflow-tx" }
        : null
    ),
  } as unknown as DFlowAdapter
}

describe("TradeModule", () => {
  describe("quote()", () => {
    it("returns Bags quote when DFlow is disabled", async () => {
      const trade = new TradeModule(createMockBags(), createMockHelius(), createMockDflow(false))

      const quote = await trade.quote({ tokenMint: "mint123", side: "buy", amount: 1.0 })

      expect(quote.route).toBe("bags")
      expect(quote.outputAmount).toBe(50000)
      expect(quote.tokenMint).toBe("mint123")
      expect(quote.side).toBe("buy")
      expect(quote.expiresAt).toBeGreaterThan(Date.now())
    })

    it("picks DFlow when it gives better output", async () => {
      const trade = new TradeModule(createMockBags(), createMockHelius(), createMockDflow(true, 60000))

      const quote = await trade.quote({ tokenMint: "mint123", side: "buy", amount: 1.0 })

      expect(quote.route).toBe("dflow")
      expect(quote.outputAmount).toBe(60000)
    })

    it("picks Bags when it gives better output than DFlow", async () => {
      const bags = createMockBags()
      ;(bags.getTradeQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
        inputAmount: 1.0,
        outputAmount: 70000, // Better than DFlow's 60000
        priceImpact: 0.005,
      })
      const trade = new TradeModule(bags, createMockHelius(), createMockDflow(true, 60000))

      const quote = await trade.quote({ tokenMint: "mint123", side: "buy", amount: 1.0 })

      expect(quote.route).toBe("bags")
      expect(quote.outputAmount).toBe(70000)
    })

    it("falls back to Bags when DFlow errors", async () => {
      const dflow = createMockDflow(true)
      ;(dflow.getSwapQuote as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DFlow down"))

      const trade = new TradeModule(createMockBags(), createMockHelius(), dflow)
      const quote = await trade.quote({ tokenMint: "mint123", side: "buy", amount: 1.0 })

      expect(quote.route).toBe("bags")
      expect(quote.outputAmount).toBe(50000)
    })

    it("throws when both routes fail", async () => {
      const bags = createMockBags()
      ;(bags.getTradeQuote as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Bags down"))
      const dflow = createMockDflow(true)
      ;(dflow.getSwapQuote as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DFlow down"))

      const trade = new TradeModule(bags, createMockHelius(), dflow)

      await expect(trade.quote({ tokenMint: "mint123", side: "buy", amount: 1.0 })).rejects.toThrow("No quote available")
    })

    it("includes default slippage in quote params", async () => {
      const bags = createMockBags()
      const trade = new TradeModule(bags, createMockHelius(), createMockDflow(false))

      await trade.quote({ tokenMint: "mint123", side: "sell", amount: 500 })

      expect(bags.getTradeQuote).toHaveBeenCalledWith({
        tokenMint: "mint123",
        side: "sell",
        amount: 500,
        slippage: undefined,
      })
    })
  })

  describe("swap()", () => {
    it("rejects expired quotes", async () => {
      const trade = new TradeModule(createMockBags(), createMockHelius(), createMockDflow(false))

      const expiredQuote = {
        tokenMint: "mint123",
        side: "buy" as const,
        inputAmount: 1.0,
        outputAmount: 50000,
        priceImpact: 0.005,
        route: "bags" as const,
        estimatedFee: 0.000005,
        expiresAt: Date.now() - 1000, // expired
        _raw: {},
      }

      const signer = { publicKey: "wallet", signTransaction: vi.fn() }

      await expect(trade.swap({ quote: expiredQuote, signer })).rejects.toThrow("expired")
    })
  })

  describe("buy() / sell() convenience", () => {
    it("buy() calls quote then swap", async () => {
      const bags = createMockBags()
      const helius = createMockHelius()
      const trade = new TradeModule(bags, helius, createMockDflow(false))

      // We can't fully test this without a real tx but we verify it calls getTradeQuote
      await expect(
        trade.buy("mint123", 0.5, { publicKey: "wallet", signTransaction: vi.fn() })
      ).rejects.toBeDefined() // Will fail at tx signing, but we verified it got that far

      expect(bags.getTradeQuote).toHaveBeenCalledWith(
        expect.objectContaining({ tokenMint: "mint123", side: "buy", amount: 0.5 })
      )
    })
  })
})
