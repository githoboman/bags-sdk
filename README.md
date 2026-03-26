# bags-sdk

Unified TypeScript SDK for [Bags.fm](https://bags.fm). One install wraps **Bags API**, **Helius**, **DFlow**, **Privy**, and **Birdeye** into a single, type-safe interface.

```ts
const { mint } = await sdk.tokens.launch({ name, symbol, image, initialBuyAmount: 0.5 }, signer)
const result   = await sdk.trade.buy(mint, 1.0, signer)
sdk.stream.on("token:launched", (e) => console.log("New:", e.name))
```

## Install

```bash
npm install bags-sdk
```

## Quick Start

```ts
import { BagsSDK, KeypairSigner } from "bags-sdk"

const sdk = new BagsSDK({
  bagsApiKey:    process.env.BAGS_API_KEY!,
  heliusApiKey:  process.env.HELIUS_API_KEY!,
  dflowApiKey:   process.env.DFLOW_API_KEY,     // optional — best-execution routing
  birdeyeApiKey: process.env.BIRDEYE_API_KEY,   // optional — price history
})

const signer = KeypairSigner.fromEnv() // reads PRIVATE_KEY from env
```

## Modules

### `sdk.tokens` — launch and feed

```ts
// Launch a token (image upload -> metadata -> tx -> sign -> confirm)
const { mint, poolAddress, signature } = await sdk.tokens.launch({
  name: "My Token",
  symbol: "MYT",
  image: imageFileOrUrl,
  initialBuyAmount: 0.5,
  feeShareWallet: creatorWallet,
}, signer)

// Launch + configure fee sharing atomically (single transaction)
const result = await sdk.tokens.launchWithFeeConfig({
  name: "Club Token", symbol: "CLUB", image: "...",
  initialBuyAmount: 0.5,
  feeConfig: {
    splits: [
      { wallet: creatorWallet, share: 0.6 },
      { wallet: modWallet,     share: 0.2 },
      { wallet: daoWallet,     share: 0.2 },
    ]
  }
}, signer)

// Build tx with full control before sending
const result = await sdk.tokens
  .launchTx({ name, symbol, image })
  .withPriorityFee("auto")
  .withSimulation()
  .withRetry(5)
  .send(signer)

// Stream the live launch feed
for await (const token of sdk.tokens.feed()) {
  console.log("New token:", token.name, token.currentPrice)
}
```

### `sdk.trade` — best-execution swaps

```ts
// Convenience: quote + swap in one call
await sdk.trade.buy(mint, 0.5, signer, { slippage: 0.02 })
await sdk.trade.sell(mint, 1_000_000, signer)

// Step-by-step with quote inspection
const quote = await sdk.trade.quote({
  tokenMint: mint,
  side: "buy",
  amount: 1.0,
  slippage: 0.01,
})
console.log(quote.route)        // "bags" | "dflow"
console.log(quote.priceImpact)  // 0.003 = 0.3%

await sdk.trade.swap({ quote, signer })
```

Best-execution routing automatically compares Bags native and DFlow quotes, picking the better output.

### `sdk.fees` — fee share and claiming

```ts
// Configure multi-party fee splits (must sum to 1.0)
await sdk.fees.createConfig({
  mint,
  splits: [
    { wallet: creatorWallet, share: 0.7 },
    { wallet: communityWallet, share: 0.3 },
  ]
}, signer)

// Get fee stats
const stats = await sdk.fees.getStats(mint)
console.log(stats.lifetimeFees, stats.claimableNow)

// Claim all fees across all tokens
const { signatures } = await sdk.fees.claimAll(walletAddress, signer)
```

### `sdk.pools` — pool state

```ts
const pool = await sdk.pools.get(mint)
console.log(pool.priceUsd)
console.log(pool.bondingCurveProgress)  // 0-1
console.log(pool.bondingCurveRemaining) // SOL until graduation
console.log(pool.graduated)
```

### `sdk.analytics` — token stats

```ts
const stats = await sdk.analytics.token(mint)
console.log(stats.lifetimeFees)
console.log(stats.volume24h)
console.log(stats.priceHistory) // 7 days of OHLCV
```

### `sdk.stream` — real-time events

```ts
// Token launches (polls Bags feed)
sdk.stream.on("token:launched", (e) => console.log("New:", e.name))

// Trades (real-time via Helius LaserStream)
sdk.stream.on("trade:buy",  (e) => console.log("Buy:", e.amountSol, "SOL"))
sdk.stream.on("trade:sell", (e) => console.log("Sell:", e.amountToken, "tokens"))

// Fee claims and pool graduations (LaserStream)
sdk.stream.on("fee:claimed",    (e) => console.log("Fee claimed:", e.amount))
sdk.stream.on("pool:graduated", (e) => console.log("Graduated:", e.mint))

// Webhook ingestion (server-side)
app.post("/webhook/helius", (req, res) => {
  sdk.stream.ingestWebhook(req.body)
  res.sendStatus(200)
})

// Clean up
sdk.destroy()
```

## Transaction Builder

Every SDK method that produces a transaction returns a `BagsTx` with fluent chaining:

```ts
const tx = await sdk.tokens.launchTx(params)
const result = await tx
  .withPriorityFee("auto")   // "auto" | "low" | "medium" | "high"
  .withSimulation()           // simulate before sending, throws if it would fail
  .withRetry(5)               // retry up to 5 times
  .withCommitment("confirmed")
  .send(signer)

// Inspect without sending
const raw = tx.getRawTransaction() // base64
```

## Signers

### KeypairSigner (bots & scripts)

```ts
import { KeypairSigner } from "bags-sdk"

const signer = KeypairSigner.fromEnv()                    // PRIVATE_KEY env var
const signer = KeypairSigner.fromBase58("your-base58-key") // base58 string
const signer = KeypairSigner.from(Keypair.generate())      // Keypair object
```

### PrivySigner (consumer apps — no private key exposure)

Uses Privy's delegated signing via secure enclave. Requires `@privy-io/server-auth` as a peer dependency.

```ts
import { PrivySigner } from "bags-sdk"

// From a Privy user object (after authentication)
const signer = PrivySigner.fromUser(privyUser, privyClient)

// From wallet address directly
const signer = PrivySigner.fromWallet({
  privyClient,
  walletAddress: "So1ana...",
  userId: "user-123",
})

await sdk.trade.buy(tokenMint, 0.5, signer)
```

### SessionKey (scoped, time-limited, auto-expiring)

Ephemeral keypairs with program allowlists, spend limits, and expiration. No wallet pop-ups.

```ts
import { SessionKey } from "bags-sdk"

const session = SessionKey.create({
  allowedPrograms: [METEORA_DBC_PROGRAM],
  maxSpendPerTx: 0.1 * 1e9, // 0.1 SOL in lamports
  expiresIn: 60 * 60 * 1000, // 1 hour
  label: "trading-session",
})

// Use like any signer — guards enforced automatically
await sdk.trade.buy(tokenMint, 0.05, session.signer)

// Check state
const state = session.state()
console.log(state.transactionCount, state.expiresAt, state.revoked)

// Revoke early
session.revoke()
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BAGS_API_KEY` | Yes | From [dev.bags.fm](https://dev.bags.fm) |
| `HELIUS_API_KEY` | Yes | From [helius.dev](https://helius.dev) |
| `DFLOW_API_KEY` | No | Enables best-execution routing via DFlow |
| `BIRDEYE_API_KEY` | No | Enables price history and volume data |
| `PRIVATE_KEY` | For signing | Base58 Solana private key |

## Testing

```bash
npm test           # run all 102 tests
npm run test:watch # watch mode
```

## Architecture

```
BagsSDK
 ├── tokens     — Token launching (image upload -> metadata -> tx -> send)
 ├── trade      — Swap with best-execution routing (Bags + DFlow)
 ├── fees       — Fee share configuration and claiming
 ├── pools      — Pool state (price, liquidity, bonding curve)
 ├── analytics  — Token analytics (fees, volume, price history)
 └── stream     — Real-time events (LaserStream + polling + webhooks)

Adapters (internal)
 ├── BagsAdapter     — Bags REST API
 ├── HeliusAdapter   — Helius RPC, Sender, LaserStream WebSocket
 ├── DFlowAdapter    — DFlow swap routing (optional)
 └── BirdeyeAdapter  — Birdeye price/volume (optional)
```

## Demo App: Sniper Bot

See `apps/sniper-bot/` for a full demo app built entirely on the SDK. Features:

- Watches for token launches via `sdk.stream.on("token:launched")`
- Configurable filters (name length, blacklist words, creator whitelist)
- Session key scoped signing with spend limits
- Auto-buy with configurable amount and slippage
- Auto-sell with take-profit and stop-loss
- Dry-run mode for safe testing (`SNIPER_DRY_RUN=true`)

```bash
BAGS_API_KEY=... HELIUS_API_KEY=... PRIVATE_KEY=... SNIPER_DRY_RUN=true npx ts-node apps/sniper-bot/index.ts
```

## License

MIT
