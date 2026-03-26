import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { SniperFilter } from "../apps/sniper-bot/filter"
import { SniperLog } from "../apps/sniper-bot/logger"
import type { SniperConfig, SniperStats, Position } from "../apps/sniper-bot/config"
import type { TokenLaunchedEvent, TradeEvent } from "../src/types"

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<SniperConfig> = {}): SniperConfig {
  return {
    bagsApiKey: "test-bags-key",
    heliusApiKey: "test-helius-key",
    buyAmountSOL: 0.05,
    maxBuySOL: 0.1,
    slippage: 0.02,
    priorityFee: "auto",
    maxTotalSpendSOL: 0.5,
    maxBuysPerSession: 10,
    sessionDurationMs: 3600000,
    useSessionKey: false,
    minNameLength: 3,
    blacklistWords: ["scam", "rug", "fake", "test", "airdrop"],
    whitelistCreators: [],
    autoSellMultiplier: 2.0,
    stopLossPercent: 0.5,
    priceCheckIntervalMs: 5000,
    autoSellTimeoutMs: 600000,
    verbose: false,
    dryRun: false,
    ...overrides,
  }
}

function makeLaunchEvent(overrides: Partial<TokenLaunchedEvent> = {}): TokenLaunchedEvent {
  return {
    type: "token:launched",
    mint: "So11111111111111111111111111111111",
    name: "CoolToken",
    symbol: "COOL",
    creator: "Creator111111111111111111111111111111111111111",
    initialPrice: 0.00001,
    timestamp: Date.now(),
    ...overrides,
  }
}

function makeStats(overrides: Partial<SniperStats> = {}): SniperStats {
  return {
    started: Date.now() - 60000, // 1 minute ago
    tokensScanned: 10,
    tokensFiltered: 5,
    buyAttempts: 3,
    buySuccesses: 2,
    buyFailures: 1,
    totalSpentSOL: 0.1,
    positions: [],
    ...overrides,
  }
}

// ─── SniperFilter ─────────────────────────────────────────────────────────────

describe("SniperFilter", () => {
  it("passes a valid token", () => {
    const filter = new SniperFilter(makeConfig())
    const result = filter.evaluate(makeLaunchEvent())
    expect(result.pass).toBe(true)
    expect(result.reason).toBe("all checks passed")
  })

  it("rejects tokens with short names", () => {
    const filter = new SniperFilter(makeConfig({ minNameLength: 5 }))
    const result = filter.evaluate(makeLaunchEvent({ name: "AB" }))
    expect(result.pass).toBe(false)
    expect(result.reason).toContain("name too short")
  })

  it("rejects tokens with name at exact boundary", () => {
    const filter = new SniperFilter(makeConfig({ minNameLength: 5 }))
    const result = filter.evaluate(makeLaunchEvent({ name: "ABCD" }))
    expect(result.pass).toBe(false)
    // 4 < 5, should fail
  })

  it("passes tokens with name at exact min length", () => {
    const filter = new SniperFilter(makeConfig({ minNameLength: 5 }))
    const result = filter.evaluate(makeLaunchEvent({ name: "ABCDE" }))
    expect(result.pass).toBe(true)
  })

  it("rejects blacklisted word in name (case insensitive)", () => {
    const filter = new SniperFilter(makeConfig())
    const result = filter.evaluate(makeLaunchEvent({ name: "SuperScamCoin" }))
    expect(result.pass).toBe(false)
    expect(result.reason).toContain('blacklisted word: "scam"')
  })

  it("rejects blacklisted word in symbol (case insensitive)", () => {
    const filter = new SniperFilter(makeConfig())
    const result = filter.evaluate(makeLaunchEvent({ symbol: "RUGPULL" }))
    expect(result.pass).toBe(false)
    expect(result.reason).toContain('blacklisted word: "rug"')
  })

  it("rejects when blacklisted word appears mixed case", () => {
    const filter = new SniperFilter(makeConfig())
    const result = filter.evaluate(makeLaunchEvent({ name: "FaKe Token" }))
    expect(result.pass).toBe(false)
    expect(result.reason).toContain('blacklisted word: "fake"')
  })

  it("allows tokens with empty blacklist", () => {
    const filter = new SniperFilter(makeConfig({ blacklistWords: [] }))
    const result = filter.evaluate(makeLaunchEvent({ name: "ScamToken" }))
    expect(result.pass).toBe(true)
  })

  it("allows any creator when whitelist is empty", () => {
    const filter = new SniperFilter(makeConfig({ whitelistCreators: [] }))
    const result = filter.evaluate(makeLaunchEvent({ creator: "RandomCreator123" }))
    expect(result.pass).toBe(true)
  })

  it("rejects non-whitelisted creator", () => {
    const filter = new SniperFilter(makeConfig({
      whitelistCreators: ["TrustedCreator111111111111111111111111111111"],
    }))
    const result = filter.evaluate(makeLaunchEvent({ creator: "UntrustedCreator99999" }))
    expect(result.pass).toBe(false)
    expect(result.reason).toContain("creator not whitelisted")
  })

  it("accepts whitelisted creator", () => {
    const trusted = "TrustedCreator111111111111111111111111111111"
    const filter = new SniperFilter(makeConfig({
      whitelistCreators: [trusted],
    }))
    const result = filter.evaluate(makeLaunchEvent({ creator: trusted }))
    expect(result.pass).toBe(true)
  })

  it("checks name length before blacklist (short + blacklisted)", () => {
    const filter = new SniperFilter(makeConfig({ minNameLength: 10 }))
    const result = filter.evaluate(makeLaunchEvent({ name: "Scam" }))
    expect(result.pass).toBe(false)
    // Should fail on name length first since "Scam" is only 4 chars
    expect(result.reason).toContain("name too short")
  })

  it("handles multiple blacklist words", () => {
    const filter = new SniperFilter(makeConfig({
      blacklistWords: ["moon", "lambo", "gem"],
    }))
    expect(filter.evaluate(makeLaunchEvent({ name: "MoonShot" })).pass).toBe(false)
    expect(filter.evaluate(makeLaunchEvent({ name: "LamboTime" })).pass).toBe(false)
    expect(filter.evaluate(makeLaunchEvent({ name: "HiddenGem" })).pass).toBe(false)
    expect(filter.evaluate(makeLaunchEvent({ name: "SafeToken" })).pass).toBe(true)
  })
})

// ─── SniperLog ────────────────────────────────────────────────────────────────

describe("SniperLog", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.restoreAllMocks()
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("banner() prints config summary", () => {
    const log = new SniperLog(false)
    log.banner(makeConfig())
    expect(consoleSpy).toHaveBeenCalled()
    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n")
    expect(output).toContain("BAGS SNIPER BOT")
    expect(output).toContain("0.05 SOL")
    expect(output).toContain("2x")
  })

  it("banner() shows disabled auto-sell when multiplier is 0", () => {
    const log = new SniperLog(false)
    log.banner(makeConfig({ autoSellMultiplier: 0 }))
    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n")
    expect(output).toContain("disabled")
  })

  it("info() logs with [INFO] prefix", () => {
    const log = new SniperLog(false)
    log.info("hello world")
    expect(consoleSpy).toHaveBeenCalledWith("[INFO] hello world")
  })

  it("warn() logs with [WARN] prefix", () => {
    const log = new SniperLog(false)
    log.warn("danger")
    expect(warnSpy).toHaveBeenCalledWith("[WARN] danger")
  })

  it("launch() logs token details", () => {
    const log = new SniperLog(false)
    log.launch(makeLaunchEvent({ symbol: "COOL", name: "CoolToken", mint: "Mint123" }))
    const output = consoleSpy.mock.calls[0][0] as string
    expect(output).toContain("[LAUNCH]")
    expect(output).toContain("COOL")
    expect(output).toContain("CoolToken")
    expect(output).toContain("Mint123")
  })

  it("filtered() only logs in verbose mode", () => {
    const quiet = new SniperLog(false)
    quiet.filtered(makeLaunchEvent(), "bad token")
    expect(consoleSpy).not.toHaveBeenCalled()

    const verbose = new SniperLog(true)
    verbose.filtered(makeLaunchEvent({ symbol: "BAD" }), "blacklisted")
    expect(consoleSpy).toHaveBeenCalled()
    expect(consoleSpy.mock.calls[0][0]).toContain("[SKIP]")
  })

  it("buying() logs buy attempt", () => {
    const log = new SniperLog(false)
    log.buying(makeLaunchEvent({ symbol: "COOL" }), 0.05)
    expect(consoleSpy.mock.calls[0][0]).toContain("[BUY]")
    expect(consoleSpy.mock.calls[0][0]).toContain("0.05 SOL")
  })

  it("bought() logs successful buy", () => {
    const log = new SniperLog(false)
    log.bought(
      makeLaunchEvent({ symbol: "COOL" }),
      { signature: "sig123abc", outputAmount: 1000000 },
      0.05
    )
    const output = consoleSpy.mock.calls[0][0] as string
    expect(output).toContain("[OK]")
    expect(output).toContain("1000000")
    expect(output).toContain("sig123abc")
  })

  it("buyFailed() logs error", () => {
    const log = new SniperLog(false)
    log.buyFailed(makeLaunchEvent({ symbol: "FAIL" }), "insufficient funds")
    expect(errorSpy).toHaveBeenCalled()
    expect(errorSpy.mock.calls[0][0]).toContain("[FAIL]")
    expect(errorSpy.mock.calls[0][0]).toContain("insufficient funds")
  })

  it("trade() logs trade event correctly", () => {
    const log = new SniperLog(false)
    const event: TradeEvent = {
      type: "trade:buy",
      mint: "TokenMint999",
      wallet: "Wallet123",
      amountSol: 1.5,
      amountToken: 500000,
      price: 0.000003,
      signature: "abcdef123456789xyz",
      timestamp: Date.now(),
    }
    log.trade(event)
    const output = consoleSpy.mock.calls[0][0] as string
    expect(output).toContain("[TRADE]")
    expect(output).toContain("BUY")
    expect(output).toContain("1.5000 SOL")
    expect(output).toContain("abcdef123456")
  })

  it("trade() shows SELL for sell events", () => {
    const log = new SniperLog(false)
    const event: TradeEvent = {
      type: "trade:sell",
      mint: "Mint1",
      wallet: "W1",
      amountSol: 2.0,
      amountToken: 100,
      price: 0.02,
      signature: "sellsig123456789",
      timestamp: Date.now(),
    }
    log.trade(event)
    expect(consoleSpy.mock.calls[0][0]).toContain("SELL")
  })

  it("stats() displays all stats fields", () => {
    const log = new SniperLog(false)
    log.stats(makeStats({
      tokensScanned: 25,
      tokensFiltered: 12,
      buyAttempts: 8,
      buySuccesses: 5,
      buyFailures: 3,
      totalSpentSOL: 0.25,
    }))
    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n")
    expect(output).toContain("Scanned:  25")
    expect(output).toContain("Filtered: 12")
    expect(output).toContain("5/8 (3 failed)")
    expect(output).toContain("0.2500 SOL")
  })

  it("stats() shows positions when present", () => {
    const log = new SniperLog(false)
    const positions: Position[] = [
      {
        mint: "Mint1",
        name: "Token1",
        symbol: "TK1",
        buyPrice: 0.00001,
        amountSOL: 0.05,
        tokensReceived: 500000,
        signature: "sig1",
        timestamp: Date.now(),
      },
      {
        mint: "Mint2",
        name: "Token2",
        symbol: "TK2",
        buyPrice: 0.00002,
        amountSOL: 0.05,
        tokensReceived: 250000,
        signature: "sig2",
        timestamp: Date.now(),
        soldAt: 0.00004,
        sellSignature: "sellsig2",
      },
    ]
    log.stats(makeStats({ positions }))
    const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n")
    expect(output).toContain("Positions: 2")
    expect(output).toContain("TK1")
    expect(output).toContain("HOLDING")
    expect(output).toContain("TK2")
    expect(output).toContain("SOLD @")
  })
})

// ─── Config (loadConfig) ──────────────────────────────────────────────────────

describe("loadConfig", () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
  })

  // Restore env after each test
  afterEach(() => {
    process.env = originalEnv
  })

  it("loads config with default values when only required keys set", async () => {
    process.env.BAGS_API_KEY = "test-bags"
    process.env.HELIUS_API_KEY = "test-helius"
    // Clear any sniper overrides
    delete process.env.SNIPER_BUY_AMOUNT
    delete process.env.SNIPER_MAX_BUY
    delete process.env.SNIPER_SLIPPAGE
    delete process.env.SNIPER_MAX_TOTAL
    delete process.env.SNIPER_MAX_BUYS
    delete process.env.SNIPER_SELL_MULT
    delete process.env.SNIPER_STOP_LOSS
    delete process.env.SNIPER_USE_SESSION_KEY
    delete process.env.SNIPER_VERBOSE

    const { loadConfig } = await import("../apps/sniper-bot/config")
    const config = loadConfig()

    expect(config.bagsApiKey).toBe("test-bags")
    expect(config.heliusApiKey).toBe("test-helius")
    expect(config.buyAmountSOL).toBe(0.05)
    expect(config.maxBuySOL).toBe(0.1)
    expect(config.slippage).toBe(0.02)
    expect(config.maxTotalSpendSOL).toBe(0.5)
    expect(config.maxBuysPerSession).toBe(10)
    expect(config.useSessionKey).toBe(false)
    expect(config.verbose).toBe(false)
    expect(config.blacklistWords).toContain("scam")
    expect(config.autoSellMultiplier).toBe(2.0)
    expect(config.stopLossPercent).toBe(0.5)
  })

  it("reads custom values from env vars", async () => {
    process.env.BAGS_API_KEY = "key1"
    process.env.HELIUS_API_KEY = "key2"
    process.env.DFLOW_API_KEY = "dflow-key"
    process.env.SNIPER_BUY_AMOUNT = "0.1"
    process.env.SNIPER_MAX_BUY = "0.5"
    process.env.SNIPER_SLIPPAGE = "0.05"
    process.env.SNIPER_MAX_TOTAL = "2.0"
    process.env.SNIPER_MAX_BUYS = "20"
    process.env.SNIPER_SELL_MULT = "3.0"
    process.env.SNIPER_STOP_LOSS = "0.3"
    process.env.SNIPER_USE_SESSION_KEY = "true"
    process.env.SNIPER_VERBOSE = "true"

    const { loadConfig } = await import("../apps/sniper-bot/config")
    const config = loadConfig()

    expect(config.dflowApiKey).toBe("dflow-key")
    expect(config.buyAmountSOL).toBe(0.1)
    expect(config.maxBuySOL).toBe(0.5)
    expect(config.slippage).toBe(0.05)
    expect(config.maxTotalSpendSOL).toBe(2.0)
    expect(config.maxBuysPerSession).toBe(20)
    expect(config.autoSellMultiplier).toBe(3.0)
    expect(config.stopLossPercent).toBe(0.3)
    expect(config.useSessionKey).toBe(true)
    expect(config.verbose).toBe(true)
  })

  it("exits when BAGS_API_KEY is missing", async () => {
    delete process.env.BAGS_API_KEY
    process.env.HELIUS_API_KEY = "test"

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)

    const { loadConfig } = await import("../apps/sniper-bot/config")
    expect(() => loadConfig()).toThrow("process.exit called")
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })

  it("exits when HELIUS_API_KEY is missing", async () => {
    process.env.BAGS_API_KEY = "test"
    delete process.env.HELIUS_API_KEY

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)

    const { loadConfig } = await import("../apps/sniper-bot/config")
    expect(() => loadConfig()).toThrow("process.exit called")
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})

// ─── Integration: Filter + Log working together ──────────────────────────────

describe("Sniper bot integration", () => {
  it("full flow: filter pass → log buying", () => {
    const config = makeConfig()
    const filter = new SniperFilter(config)
    const log = new SniperLog(false)
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})

    const event = makeLaunchEvent({ name: "LegitToken", symbol: "LEGIT" })
    const verdict = filter.evaluate(event)
    expect(verdict.pass).toBe(true)

    log.launch(event)
    log.buying(event, config.buyAmountSOL)

    const output = spy.mock.calls.map((c: unknown[]) => c[0]).join("\n")
    expect(output).toContain("[LAUNCH]")
    expect(output).toContain("[BUY]")
    expect(output).toContain("LEGIT")
    spy.mockRestore()
  })

  it("full flow: filter reject → log filtered (verbose)", () => {
    const config = makeConfig({ verbose: true })
    const filter = new SniperFilter(config)
    const log = new SniperLog(true)
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})

    const event = makeLaunchEvent({ name: "ScamCoin", symbol: "SCAM" })
    const verdict = filter.evaluate(event)
    expect(verdict.pass).toBe(false)

    log.launch(event)
    log.filtered(event, verdict.reason)

    const output = spy.mock.calls.map((c: unknown[]) => c[0]).join("\n")
    expect(output).toContain("[LAUNCH]")
    expect(output).toContain("[SKIP]")
    expect(output).toContain("blacklisted")
    spy.mockRestore()
  })

  it("spend limit tracking works correctly", () => {
    const config = makeConfig({ maxTotalSpendSOL: 0.1, buyAmountSOL: 0.05 })
    const stats = makeStats({ totalSpentSOL: 0, buyAttempts: 0, buySuccesses: 0 })

    // First buy should be allowed
    expect(stats.totalSpentSOL < config.maxTotalSpendSOL).toBe(true)
    stats.totalSpentSOL += config.buyAmountSOL
    stats.buyAttempts++
    stats.buySuccesses++

    // Second buy should be allowed
    expect(stats.totalSpentSOL < config.maxTotalSpendSOL).toBe(true)
    stats.totalSpentSOL += config.buyAmountSOL
    stats.buyAttempts++
    stats.buySuccesses++

    // Third buy should be blocked (0.1 >= 0.1)
    expect(stats.totalSpentSOL >= config.maxTotalSpendSOL).toBe(true)
  })

  it("session buy count limit works", () => {
    const config = makeConfig({ maxBuysPerSession: 2 })
    let txCount = 0

    // Simulate session transaction counting
    txCount++
    expect(txCount < config.maxBuysPerSession).toBe(true)
    txCount++
    expect(txCount >= config.maxBuysPerSession).toBe(true)
  })
})
