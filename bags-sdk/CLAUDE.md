# bags-sdk — Claude Code Guide

Unified TypeScript SDK for Bags.fm. Wraps Bags API, Helius, DFlow, Privy, and Birdeye into one interface.

## Project structure

```
src/
  index.ts                      ← BagsSDK class + KeypairSigner helpers (main entry)
  types/index.ts                ← All TypeScript types (start here for any new feature)
  adapters/
    bags.adapter.ts             ← Wraps Bags REST API (https://docs.bags.fm)
    helius.adapter.ts           ← Wraps Helius RPC, Sender, webhooks
    dflow.adapter.ts            ← Wraps DFlow swap routing (optional)
    birdeye.adapter.ts          ← Wraps Birdeye price/volume data (optional)
  core/
    tx-builder.ts               ← BagsTx — fluent transaction builder
    event-bus.ts                ← BagsEventBus — normalized event subscriptions
  modules/
    tokens.module.ts            ← Token launching, launch feed
    fees.module.ts              ← Fee share config and claiming
    trade.module.ts             ← Swap with best-execution routing
    pools-analytics.module.ts   ← Pool state + token analytics
examples/
  launch-token.ts
  trade.ts
  stream-events.ts
```

## How to add a new module

1. Add types to `src/types/index.ts`
2. Add any new external API calls to the relevant adapter in `src/adapters/`
3. Create `src/modules/yourmodule.module.ts` — inject adapters via constructor
4. Instantiate in `src/index.ts` and expose on `BagsSDK`
5. Add an example to `examples/`

## Bags API reference

Base URL: `https://public-api-v2.bags.fm/api/v1`
Auth: `x-api-key` header
Rate limit: 1000 req/hour
Full docs: https://docs.bags.fm

Key endpoint groups (all implemented in BagsAdapter):
- Token Launch: upload image → create metadata → create launch tx
- Fee Share: create config, admin management
- Analytics: lifetime fees, claim events
- State: pool info by mint
- Fee Claiming: claimable positions, claim transactions
- Trade: quote, create swap tx
- Partner: partner stats and config
- Agent: agent auth and wallet management

## Transaction flow

Every action goes through BagsTx:
1. Adapter builds an UNSIGNED serialized transaction (base64)
2. BagsTx wraps it with optional: priority fee estimation, simulation, retry
3. .send(signer) → signs → submits via Helius Sender → waits for confirmation

## Key design decisions

- DFlow is optional: if no dflowApiKey, trade.quote() falls back to Bags native routing
- Birdeye is optional: pools.get() and analytics.token() degrade gracefully without it
- stream events currently use polling — replace poll loops with Helius LaserStream gRPC
  for production-grade latency. See src/core/event-bus.ts for the TODO comments.
- BagsTx is immutable-ish: each .withX() returns `this` for chaining

## Environment variables

```
BAGS_API_KEY       required — from dev.bags.fm
HELIUS_API_KEY     required — from helius.dev
DFLOW_API_KEY      optional — enables best-execution swap routing
BIRDEYE_API_KEY    optional — enables price history and volume data
PRIVATE_KEY        required for examples — base58 Solana private key
```

## What needs to be built next (priority order)

1. **Helius LaserStream gRPC subscription** in `src/core/event-bus.ts`
   - Replace the polling-based trade event source
   - Filter for Meteora DBC program instructions (Bags token program)
   - See: https://www.helius.dev/docs/laserstream

2. **Privy embedded wallet signer** in `src/index.ts`
   - Add `PrivySigner.fromUser(privyUser)` alongside `KeypairSigner`
   - Uses Privy delegated signing for consumer apps (no private key exposure)

3. **Session key signer** — scoped, time-limited signing without wallet pop-ups
   - `SessionKey.create({ allowedPrograms, maxSpendPerTx, expiresIn })`

4. **Atomic launch + fee config** — combine into a single VersionedTransaction
   - Currently sequential in `tokens.launchWithFeeConfig()`
   - Use `TransactionMessage` to bundle both instructions

5. **Webhook ingestion parser** in `src/core/event-bus.ts`
   - Implement `ingestWebhook()` to parse Helius enhanced transaction format
   - Map to normalized BagsEvent types

6. **Fee router program** — separate Solana program (Anchor) for composable fee splits
   - Multi-party splits with vesting and conditional routing
   - This is a separate repo/program, not part of the SDK client
