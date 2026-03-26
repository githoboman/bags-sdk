import { describe, it, expect, vi } from "vitest"
import { FeesModule } from "../src/modules/fees.module"
import type { BagsAdapter } from "../src/adapters/bags.adapter"
import type { HeliusAdapter } from "../src/adapters/helius.adapter"

function createMockBags(): BagsAdapter {
  return {
    createFeeShareConfig: vi.fn().mockResolvedValue({ transaction: "base64feetx" }),
    getTokenLifetimeFees: vi.fn().mockResolvedValue({
      lifetimeFees: 12.5,
      claimStats: { claimable: 3.2 },
    }),
    getTokenClaimEvents: vi.fn().mockResolvedValue([
      { signature: "sig1", amount: 1.5, timestamp: 1700000000, wallet: "wallet1" },
      { signature: "sig2", amount: 2.0, timestamp: 1700001000, wallet: "wallet2" },
    ]),
    getClaimablePositions: vi.fn().mockResolvedValue([{ mint: "mint1", amount: 1.0 }]),
    createClaimTransactions: vi.fn().mockResolvedValue({ transactions: [] }),
  } as unknown as BagsAdapter
}

function createMockHelius(): HeliusAdapter {
  return {
    sendTransaction: vi.fn().mockResolvedValue({ signature: "fee-sig-456" }),
    simulateTransaction: vi.fn().mockResolvedValue({ success: true, logs: [] }),
    estimatePriorityFee: vi.fn().mockResolvedValue(5000),
  } as unknown as HeliusAdapter
}

describe("FeesModule", () => {
  describe("createConfig()", () => {
    it("rejects splits that don't sum to 1.0", async () => {
      const fees = new FeesModule(createMockBags(), createMockHelius())
      const signer = { publicKey: "wallet", signTransaction: vi.fn() }

      await expect(
        fees.createConfig(
          {
            mint: "mint123",
            splits: [
              { wallet: "a", share: 0.5 },
              { wallet: "b", share: 0.3 },
              // Only 0.8 total
            ],
          },
          signer
        )
      ).rejects.toThrow("must sum to 1.0")
    })

    it("rejects splits over 1.0", async () => {
      const fees = new FeesModule(createMockBags(), createMockHelius())
      const signer = { publicKey: "wallet", signTransaction: vi.fn() }

      await expect(
        fees.createConfig(
          {
            mint: "mint123",
            splits: [
              { wallet: "a", share: 0.7 },
              { wallet: "b", share: 0.5 },
            ],
          },
          signer
        )
      ).rejects.toThrow("must sum to 1.0")
    })

    it("accepts splits that sum to exactly 1.0", async () => {
      const bags = createMockBags()
      const fees = new FeesModule(bags, createMockHelius())
      const signer = { publicKey: "wallet", signTransaction: vi.fn() }

      // Will fail at tx signing but not at validation
      await expect(
        fees.createConfig(
          {
            mint: "mint123",
            splits: [
              { wallet: "a", share: 0.6 },
              { wallet: "b", share: 0.2 },
              { wallet: "c", share: 0.2 },
            ],
          },
          signer
        )
      ).rejects.not.toThrow("must sum to 1.0")

      expect(bags.createFeeShareConfig).toHaveBeenCalledWith({
        mint: "mint123",
        splits: [
          { wallet: "a", share: 0.6 },
          { wallet: "b", share: 0.2 },
          { wallet: "c", share: 0.2 },
        ],
        signerWallet: "wallet",
      })
    })
  })

  describe("getStats()", () => {
    it("returns aggregated fee stats", async () => {
      const fees = new FeesModule(createMockBags(), createMockHelius())
      const stats = await fees.getStats("mint123")

      expect(stats.mint).toBe("mint123")
      expect(stats.lifetimeFees).toBe(12.5)
      expect(stats.claimableNow).toBe(3.2)
      expect(stats.claimEvents).toHaveLength(2)
      expect(stats.claimEvents[0].signature).toBe("sig1")
      expect(stats.claimEvents[1].amount).toBe(2.0)
    })
  })

  describe("claimAll()", () => {
    it("returns empty when no claimable positions", async () => {
      const bags = createMockBags()
      ;(bags.getClaimablePositions as ReturnType<typeof vi.fn>).mockResolvedValue([])

      const fees = new FeesModule(bags, createMockHelius())
      const result = await fees.claimAll("wallet", { publicKey: "wallet", signTransaction: vi.fn() })

      expect(result.totalClaimed).toBe(0)
      expect(result.signatures).toEqual([])
    })
  })
})
