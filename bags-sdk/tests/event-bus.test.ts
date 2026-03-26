import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { BagsEventBus } from "../src/core/event-bus"
import type { BagsAdapter } from "../src/adapters/bags.adapter"
import type { HeliusAdapter } from "../src/adapters/helius.adapter"
import type { HeliusEnhancedTransaction, TradeEvent, FeeClaimedEvent } from "../src/types"

function createMockBags(): BagsAdapter {
  return {
    getTokenFeed: vi.fn().mockResolvedValue([]),
  } as unknown as BagsAdapter
}

function createMockHelius(): HeliusAdapter {
  return {
    subscribeLaserStream: vi.fn().mockReturnValue({ stop: vi.fn() }),
  } as unknown as HeliusAdapter
}

describe("BagsEventBus", () => {
  let bus: BagsEventBus
  let bags: BagsAdapter
  let helius: HeliusAdapter

  beforeEach(() => {
    bags = createMockBags()
    helius = createMockHelius()
    bus = new BagsEventBus(bags, helius)
  })

  afterEach(() => {
    bus.destroy()
  })

  it("starts launch feed polling on token:launched subscription", () => {
    const handler = vi.fn()
    bus.on("token:launched", handler)

    expect(bags.getTokenFeed).toHaveBeenCalled()
  })

  it("starts LaserStream on trade:buy subscription", () => {
    const handler = vi.fn()
    bus.on("trade:buy", handler)

    expect(helius.subscribeLaserStream).toHaveBeenCalledWith(
      expect.objectContaining({
        programIds: expect.arrayContaining([expect.any(String)]),
        onTransaction: expect.any(Function),
      })
    )
  })

  it("starts LaserStream on trade:sell subscription", () => {
    const handler = vi.fn()
    bus.on("trade:sell", handler)

    expect(helius.subscribeLaserStream).toHaveBeenCalled()
  })

  it("starts LaserStream only once for multiple trade subscriptions", () => {
    bus.on("trade:buy", vi.fn())
    bus.on("trade:sell", vi.fn())
    bus.on("fee:claimed", vi.fn())

    expect(helius.subscribeLaserStream).toHaveBeenCalledTimes(1)
  })

  it("destroy() stops LaserStream and clears listeners", () => {
    bus.on("trade:buy", vi.fn())
    const stopFn = (helius.subscribeLaserStream as ReturnType<typeof vi.fn>).mock.results[0]?.value?.stop

    bus.destroy()

    expect(stopFn).toHaveBeenCalled()
  })

  it("emits token:launched events from feed polling", async () => {
    ;(bags.getTokenFeed as ReturnType<typeof vi.fn>).mockResolvedValue([
      { mint: "newmint1", name: "Token A", symbol: "TKA", creator: "creator1", initialPrice: 0.001, createdAt: 1700000000 },
    ])

    const events: unknown[] = []
    bus.on("token:launched", (e: unknown) => events.push(e))

    // Wait for the poll to complete
    await new Promise(r => setTimeout(r, 100))

    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0]).toMatchObject({
      type: "token:launched",
      mint: "newmint1",
      name: "Token A",
      symbol: "TKA",
    })
  })

  it("deduplicates events by mint/signature", async () => {
    ;(bags.getTokenFeed as ReturnType<typeof vi.fn>).mockResolvedValue([
      { mint: "dupmint", name: "Dup", symbol: "DUP", creator: "c1" },
    ])

    const events: unknown[] = []
    bus.on("token:launched", (e: unknown) => events.push(e))

    await new Promise(r => setTimeout(r, 200))

    // Even though the feed returns the same mint every time, it should only emit once
    expect(events.length).toBe(1)
  })

  describe("ingestWebhook()", () => {
    it("parses a swap webhook into a trade event", () => {
      const events: TradeEvent[] = []
      bus.on("trade:buy", (e: TradeEvent) => events.push(e))

      const webhookPayload: Partial<HeliusEnhancedTransaction> = {
        signature: "webhook-sig-1",
        timestamp: 1700000,
        type: "SWAP",
        feePayer: "buyer-wallet",
        nativeTransfers: [
          { fromUserAccount: "buyer-wallet", toUserAccount: "pool", amount: 1_000_000_000 },
        ],
        tokenTransfers: [
          {
            fromUserAccount: "pool",
            toUserAccount: "buyer-wallet",
            fromTokenAccount: "from-ata",
            toTokenAccount: "to-ata",
            tokenAmount: 50000,
            mint: "token-mint-123",
            tokenStandard: "Fungible",
          },
        ],
        instructions: [
          {
            programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
            accounts: [],
            data: "",
            innerInstructions: [],
          },
        ],
        accountData: [],
      }

      bus.ingestWebhook(webhookPayload)

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("trade:buy")
      expect(events[0].mint).toBe("token-mint-123")
      expect(events[0].signature).toBe("webhook-sig-1")
    })

    it("parses a fee claim webhook", () => {
      const events: FeeClaimedEvent[] = []
      bus.on("fee:claimed", (e: FeeClaimedEvent) => events.push(e))

      const webhookPayload: Partial<HeliusEnhancedTransaction> = {
        signature: "claim-sig-1",
        timestamp: 1700000,
        type: "CLAIM_FEE",
        feePayer: "claimer",
        nativeTransfers: [
          { fromUserAccount: "pool", toUserAccount: "claimer", amount: 500_000_000 },
        ],
        tokenTransfers: [],
        instructions: [
          {
            programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
            accounts: [],
            data: "",
            innerInstructions: [],
          },
        ],
        accountData: [],
      }

      bus.ingestWebhook(webhookPayload)

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("fee:claimed")
      expect(events[0].wallet).toBe("claimer")
    })

    it("handles array payloads (Helius sends arrays)", () => {
      const events: TradeEvent[] = []
      bus.on("trade:buy", (e: TradeEvent) => events.push(e))

      const payload = [
        {
          signature: "arr-sig-1",
          timestamp: 1700000,
          type: "SWAP",
          feePayer: "buyer",
          nativeTransfers: [{ fromUserAccount: "buyer", toUserAccount: "pool", amount: 1e9 }],
          tokenTransfers: [{ fromUserAccount: "pool", toUserAccount: "buyer", fromTokenAccount: "", toTokenAccount: "", tokenAmount: 100, mint: "m1", tokenStandard: "Fungible" }],
          instructions: [{ programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", accounts: [], data: "", innerInstructions: [] }],
          accountData: [],
        },
        {
          signature: "arr-sig-2",
          timestamp: 1700001,
          type: "SWAP",
          feePayer: "buyer2",
          nativeTransfers: [{ fromUserAccount: "buyer2", toUserAccount: "pool", amount: 2e9 }],
          tokenTransfers: [{ fromUserAccount: "pool", toUserAccount: "buyer2", fromTokenAccount: "", toTokenAccount: "", tokenAmount: 200, mint: "m2", tokenStandard: "Fungible" }],
          instructions: [{ programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", accounts: [], data: "", innerInstructions: [] }],
          accountData: [],
        },
      ]

      bus.ingestWebhook(payload)

      expect(events.length).toBe(2)
    })

    it("deduplicates webhook payloads", () => {
      const events: TradeEvent[] = []
      bus.on("trade:buy", (e: TradeEvent) => events.push(e))

      const payload = {
        signature: "dup-webhook-sig",
        timestamp: 1700000,
        type: "SWAP",
        feePayer: "buyer",
        nativeTransfers: [{ fromUserAccount: "buyer", toUserAccount: "pool", amount: 1e9 }],
        tokenTransfers: [{ fromUserAccount: "pool", toUserAccount: "buyer", fromTokenAccount: "", toTokenAccount: "", tokenAmount: 100, mint: "m1", tokenStandard: "Fungible" }],
        instructions: [{ programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", accounts: [], data: "", innerInstructions: [] }],
        accountData: [],
      }

      bus.ingestWebhook(payload)
      bus.ingestWebhook(payload) // same payload again

      expect(events.length).toBe(1)
    })

    it("ignores transactions not involving Meteora DBC", () => {
      const events: TradeEvent[] = []
      bus.on("trade:buy", (e: TradeEvent) => events.push(e))

      bus.ingestWebhook({
        signature: "non-dbc-sig",
        timestamp: 1700000,
        type: "SWAP",
        feePayer: "buyer",
        nativeTransfers: [],
        tokenTransfers: [],
        instructions: [
          { programId: "SomeOtherProgram11111111111111111111111111", accounts: [], data: "", innerInstructions: [] },
        ],
        accountData: [],
      })

      expect(events.length).toBe(0)
    })
  })
})
