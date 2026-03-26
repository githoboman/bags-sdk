// ─── Config ───────────────────────────────────────────────────────────────────

export interface BagsSDKConfig {
  /** Bags API key from dev.bags.fm */
  bagsApiKey: string
  /** Helius API key from helius.dev — used for RPC, Sender, and webhooks */
  heliusApiKey: string
  /** DFlow API key — used for best-execution swap routing */
  dflowApiKey?: string
  /** Birdeye API key — used for price/volume/metadata */
  birdeyeApiKey?: string
  /** Optional: Privy app ID for embedded wallet support */
  privyAppId?: string
  /** Optional: override Bags base URL (defaults to production) */
  bagsBaseUrl?: string
  /** Optional: "mainnet-beta" | "devnet" — defaults to mainnet-beta */
  cluster?: "mainnet-beta" | "devnet"
}

// ─── Signer ───────────────────────────────────────────────────────────────────

export interface BagsSigner {
  publicKey: string
  signTransaction: (serializedTx: Uint8Array) => Promise<Uint8Array>
  signAllTransactions?: (txs: Uint8Array[]) => Promise<Uint8Array[]>
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

export interface TokenLaunchParams {
  name: string
  symbol: string
  description?: string
  /** File object or URL string pointing to the token image */
  image: File | string
  /** Amount of SOL to buy at launch */
  initialBuyAmount?: number
  /** Wallet address that will receive creator fees */
  feeShareWallet?: string
  twitter?: string
  telegram?: string
  website?: string
}

export interface TokenLaunchResult {
  mint: string
  poolAddress: string
  signature: string
  metadataUri: string
}

export interface LaunchedToken {
  mint: string
  name: string
  symbol: string
  description?: string
  image: string
  creator: string
  poolAddress: string
  createdAt: number
  currentPrice: number
  marketCap: number
  bondingCurveProgress: number
}

// ─── Fee Share ────────────────────────────────────────────────────────────────

export interface FeeSplit {
  wallet: string
  /** Share as a decimal — e.g. 0.6 = 60% */
  share: number
}

export interface FeeConfigParams {
  mint: string
  splits: FeeSplit[]
}

export interface FeeStats {
  mint: string
  lifetimeFees: number
  claimableNow: number
  lastClaimed?: number
  claimEvents: FeeClaimEvent[]
}

export interface FeeClaimEvent {
  signature: string
  amount: number
  timestamp: number
  wallet: string
}

// ─── Trade ────────────────────────────────────────────────────────────────────

export type TradeSide = "buy" | "sell"

export interface TradeQuoteParams {
  tokenMint: string
  side: TradeSide
  /** Amount in SOL (buy) or token units (sell) */
  amount: number
  /** Max acceptable slippage as decimal — e.g. 0.01 = 1%. Defaults to 0.01 */
  slippage?: number
}

export interface TradeQuote {
  tokenMint: string
  side: TradeSide
  inputAmount: number
  outputAmount: number
  priceImpact: number
  route: "bags" | "dflow" | "best"
  estimatedFee: number
  /** Expiry timestamp — quote is valid for ~30s */
  expiresAt: number
  _raw: unknown
}

export interface TradeResult {
  signature: string
  inputAmount: number
  outputAmount: number
  fee: number
}

// ─── Pools ────────────────────────────────────────────────────────────────────

export interface PoolInfo {
  address: string
  tokenMint: string
  price: number
  priceUsd: number
  liquidity: number
  volume24h: number
  bondingCurveProgress: number
  /** How many SOL remain before graduation to open market */
  bondingCurveRemaining: number
  graduated: boolean
  graduatedAt?: number
}

// ─── Streaming / Events ───────────────────────────────────────────────────────

export type BagsEventType =
  | "token:launched"
  | "trade:buy"
  | "trade:sell"
  | "fee:claimed"
  | "pool:graduated"
  | "pool:updated"

export interface TokenLaunchedEvent {
  type: "token:launched"
  mint: string
  name: string
  symbol: string
  creator: string
  initialPrice: number
  timestamp: number
}

export interface TradeEvent {
  type: "trade:buy" | "trade:sell"
  mint: string
  wallet: string
  amountSol: number
  amountToken: number
  price: number
  signature: string
  timestamp: number
}

export interface FeeClaimedEvent {
  type: "fee:claimed"
  mint: string
  wallet: string
  amount: number
  signature: string
  timestamp: number
}

export interface PoolGraduatedEvent {
  type: "pool:graduated"
  mint: string
  poolAddress: string
  finalBondingPrice: number
  timestamp: number
}

export interface PoolUpdatedEvent {
  type: "pool:updated"
  mint: string
  price: number
  volume24h: number
  liquidity: number
  timestamp: number
}

export type BagsEvent =
  | TokenLaunchedEvent
  | TradeEvent
  | FeeClaimedEvent
  | PoolGraduatedEvent
  | PoolUpdatedEvent

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface TokenAnalytics {
  mint: string
  name: string
  symbol: string
  creator: string
  createdAt: number
  lifetimeFees: number
  holders: number
  transactions24h: number
  volume24h: number
  priceHistory: PricePoint[]
  pool: PoolInfo
}

export interface PricePoint {
  timestamp: number
  price: number
  volume: number
}

// ─── Session Key ─────────────────────────────────────────────────────────────

export interface SessionKeyConfig {
  /** Programs this session key is allowed to interact with */
  allowedPrograms: string[]
  /** Maximum lamports per transaction (prevents draining) */
  maxSpendPerTx: number
  /** Session expiration in milliseconds from creation */
  expiresIn: number
  /** Optional label for UI display */
  label?: string
}

export interface SessionKeyState {
  publicKey: string
  config: SessionKeyConfig
  createdAt: number
  expiresAt: number
  transactionCount: number
  totalSpent: number
  revoked: boolean
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

export interface HeliusEnhancedTransaction {
  signature: string
  timestamp: number
  type: string
  source: string
  fee: number
  feePayer: string
  nativeTransfers: Array<{
    fromUserAccount: string
    toUserAccount: string
    amount: number
  }>
  tokenTransfers: Array<{
    fromUserAccount: string
    toUserAccount: string
    fromTokenAccount: string
    toTokenAccount: string
    tokenAmount: number
    mint: string
    tokenStandard: string
  }>
  accountData: Array<{
    account: string
    nativeBalanceChange: number
    tokenBalanceChanges: Array<{
      userAccount: string
      tokenAccount: string
      mint: string
      rawTokenAmount: { tokenAmount: string; decimals: number }
    }>
  }>
  instructions: Array<{
    programId: string
    accounts: string[]
    data: string
    innerInstructions: Array<{
      programId: string
      accounts: string[]
      data: string
    }>
  }>
}

// ─── Transaction ──────────────────────────────────────────────────────────────

export interface TxOptions {
  priorityFee?: "auto" | "low" | "medium" | "high" | number
  simulate?: boolean
  maxRetries?: number
  commitment?: "processed" | "confirmed" | "finalized"
}

export interface SendTxResult {
  signature: string
  slot?: number
}
