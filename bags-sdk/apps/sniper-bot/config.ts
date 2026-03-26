/**
 * Sniper bot configuration — loaded from env vars with sensible defaults.
 */

export interface SniperConfig {
  // ─── API Keys ──────────────────────────────────────────────────────────
  bagsApiKey: string
  heliusApiKey: string
  dflowApiKey?: string
  birdeyeApiKey?: string

  // ─── Buy settings ──────────────────────────────────────────────────────
  /** Amount of SOL to spend per buy */
  buyAmountSOL: number
  /** Maximum SOL per single buy (hard cap) */
  maxBuySOL: number
  /** Slippage tolerance (decimal, e.g. 0.02 = 2%) */
  slippage: number
  /** Priority fee level */
  priorityFee: "auto" | "low" | "medium" | "high"

  // ─── Safety limits ─────────────────────────────────────────────────────
  /** Max total SOL to spend across all buys */
  maxTotalSpendSOL: number
  /** Max number of buys per session */
  maxBuysPerSession: number
  /** Session key duration in ms */
  sessionDurationMs: number
  /** Use session key (true) or master signer (false) */
  useSessionKey: boolean

  // ─── Filters ───────────────────────────────────────────────────────────
  /** Minimum name length to filter spam */
  minNameLength: number
  /** Blacklisted words in token name/symbol (lowercased) */
  blacklistWords: string[]
  /** Only buy tokens from these creators (empty = any) */
  whitelistCreators: string[]

  // ─── Auto-sell ─────────────────────────────────────────────────────────
  /** Auto-sell at this multiple of buy price (0 = disabled) */
  autoSellMultiplier: number
  /** Stop-loss as a percent (0.5 = sell at 50% loss, 0 = disabled) */
  stopLossPercent: number
  /** How often to check price for auto-sell (ms) */
  priceCheckIntervalMs: number
  /** Cancel price monitor after this long (ms) */
  autoSellTimeoutMs: number

  // ─── Display ───────────────────────────────────────────────────────────
  verbose: boolean

  // ─── Dry run ─────────────────────────────────────────────────────────
  /** When true, logs everything but does NOT submit buy/sell transactions */
  dryRun: boolean
}

export interface SniperStats {
  started: number
  tokensScanned: number
  tokensFiltered: number
  buyAttempts: number
  buySuccesses: number
  buyFailures: number
  totalSpentSOL: number
  positions: Position[]
}

export interface Position {
  mint: string
  name: string
  symbol: string
  buyPrice: number
  amountSOL: number
  tokensReceived: number
  signature: string
  timestamp: number
  soldAt?: number
  sellSignature?: string
}

const DEFAULT_CONFIG: Omit<SniperConfig, "bagsApiKey" | "heliusApiKey"> = {
  buyAmountSOL: 0.05,
  maxBuySOL: 0.1,
  slippage: 0.02,
  priorityFee: "auto",

  maxTotalSpendSOL: 0.5,
  maxBuysPerSession: 10,
  sessionDurationMs: 60 * 60 * 1000, // 1 hour
  useSessionKey: false,

  minNameLength: 3,
  blacklistWords: ["scam", "rug", "fake", "test", "airdrop"],
  whitelistCreators: [],

  autoSellMultiplier: 2.0,   // sell at 2x
  stopLossPercent: 0.5,      // sell at 50% loss
  priceCheckIntervalMs: 5000, // check every 5s
  autoSellTimeoutMs: 10 * 60 * 1000, // 10 min monitor

  verbose: false,
  dryRun: false,
}

export function loadConfig(): SniperConfig {
  const bagsApiKey = requireEnv("BAGS_API_KEY")
  const heliusApiKey = requireEnv("HELIUS_API_KEY")

  return {
    ...DEFAULT_CONFIG,
    bagsApiKey,
    heliusApiKey,
    dflowApiKey: process.env.DFLOW_API_KEY,
    birdeyeApiKey: process.env.BIRDEYE_API_KEY,

    buyAmountSOL: parseFloat(process.env.SNIPER_BUY_AMOUNT ?? String(DEFAULT_CONFIG.buyAmountSOL)),
    maxBuySOL: parseFloat(process.env.SNIPER_MAX_BUY ?? String(DEFAULT_CONFIG.maxBuySOL)),
    slippage: parseFloat(process.env.SNIPER_SLIPPAGE ?? String(DEFAULT_CONFIG.slippage)),
    maxTotalSpendSOL: parseFloat(process.env.SNIPER_MAX_TOTAL ?? String(DEFAULT_CONFIG.maxTotalSpendSOL)),
    maxBuysPerSession: parseInt(process.env.SNIPER_MAX_BUYS ?? String(DEFAULT_CONFIG.maxBuysPerSession)),
    autoSellMultiplier: parseFloat(process.env.SNIPER_SELL_MULT ?? String(DEFAULT_CONFIG.autoSellMultiplier)),
    stopLossPercent: parseFloat(process.env.SNIPER_STOP_LOSS ?? String(DEFAULT_CONFIG.stopLossPercent)),
    useSessionKey: process.env.SNIPER_USE_SESSION_KEY === "true",
    verbose: process.env.SNIPER_VERBOSE === "true",
    dryRun: process.env.SNIPER_DRY_RUN === "true",
  }
}

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return val
}
