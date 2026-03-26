import EventEmitter from "eventemitter3"
import {
  BagsEvent,
  BagsEventType,
  TokenLaunchedEvent,
  TradeEvent,
  FeeClaimedEvent,
  PoolGraduatedEvent,
  PoolUpdatedEvent,
  HeliusEnhancedTransaction,
} from "../types"
import { BagsAdapter } from "../adapters/bags.adapter"
import { HeliusAdapter, LaserStreamSubscription, LaserStreamTransaction } from "../adapters/helius.adapter"

// Meteora Dynamic Bonding Curve program ID (Bags token program)
const METEORA_DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"

type EventHandler<T extends BagsEvent> = (event: T) => void

export class BagsEventBus extends EventEmitter {
  private bags: BagsAdapter
  private helius: HeliusAdapter
  private pollingIntervals: ReturnType<typeof setInterval>[] = []
  private laserStreamSub: LaserStreamSubscription | null = null
  private seenSignatures = new Set<string>()

  constructor(bags: BagsAdapter, helius: HeliusAdapter) {
    super()
    this.bags = bags
    this.helius = helius
  }

  /**
   * Subscribe to a normalized Bags event.
   *
   * Internally, this chooses the best source:
   * - token:launched → polls the Bags launch feed
   * - trade:buy / trade:sell → Helius LaserStream (real-time gRPC)
   * - pool:updated → polls Bags pool state
   * - fee:claimed / pool:graduated → LaserStream or webhook
   */
  on<T extends BagsEvent>(
    event: T["type"],
    handler: EventHandler<T>
  ): this {
    super.on(event, handler)
    this.ensureSourceFor(event)
    return this
  }

  off<T extends BagsEvent>(event: T["type"], handler: EventHandler<T>): this {
    super.off(event, handler)
    return this
  }

  /** Stop all polling loops, LaserStream connections, and clean up. */
  destroy(): void {
    for (const interval of this.pollingIntervals) {
      clearInterval(interval)
    }
    this.pollingIntervals = []
    if (this.laserStreamSub) {
      this.laserStreamSub.stop()
      this.laserStreamSub = null
    }
    this.removeAllListeners()
  }

  // ─── Internal source setup ────────────────────────────────────────────────

  private activeSources = new Set<BagsEventType>()

  private ensureSourceFor(eventType: BagsEventType): void {
    if (this.activeSources.has(eventType)) return
    this.activeSources.add(eventType)

    switch (eventType) {
      case "token:launched":
        this.startLaunchFeedPolling()
        break
      case "trade:buy":
      case "trade:sell":
        this.startLaserStream()
        break
      case "pool:updated":
        // Pool state polling — acceptable for non-latency-sensitive use cases
        break
      case "fee:claimed":
      case "pool:graduated":
        // These also come through LaserStream when connected
        this.startLaserStream()
        break
    }
  }

  // ─── LaserStream (real-time trade events) ─────────────────────────────────

  private laserStreamStarted = false

  private startLaserStream(): void {
    if (this.laserStreamStarted) return
    this.laserStreamStarted = true

    this.laserStreamSub = this.helius.subscribeLaserStream({
      programIds: [METEORA_DBC_PROGRAM],
      onTransaction: (tx) => this.handleLaserStreamTx(tx),
      onError: (err) => {
        this.emit("error", err)
      },
      onDisconnect: () => {
        // Reconnection is handled internally by the adapter
      },
    })
  }

  private handleLaserStreamTx(tx: LaserStreamTransaction): void {
    // Deduplicate
    if (this.seenSignatures.has(tx.signature)) return
    this.seenSignatures.add(tx.signature)

    // Cap the seen set to prevent unbounded memory growth
    if (this.seenSignatures.size > 10000) {
      const entries = Array.from(this.seenSignatures)
      for (let i = 0; i < 5000; i++) {
        this.seenSignatures.delete(entries[i])
      }
    }

    // Classify the transaction by inspecting log messages and transfers
    const logs = tx.logMessages.join(" ")

    if (logs.includes("InitializePool") || logs.includes("CreatePool")) {
      // Likely a new token launch — but we rely on the feed poller for richer data
      return
    }

    if (logs.includes("GraduatePool") || logs.includes("Graduated")) {
      this.emitPoolGraduated(tx)
      return
    }

    if (logs.includes("ClaimFee") || logs.includes("claim_fee")) {
      this.emitFeeClaimed(tx)
      return
    }

    // Default: trade event (swap on the bonding curve)
    if (tx.tokenTransfers.length > 0 || tx.nativeTransfers.length > 0) {
      this.emitTradeEvent(tx)
    }
  }

  private emitTradeEvent(tx: LaserStreamTransaction): void {
    const solTransfer = tx.nativeTransfers[0]
    const tokenTransfer = tx.tokenTransfers[0]

    if (!tokenTransfer) return

    const amountSol = solTransfer
      ? solTransfer.lamports / 1e9
      : 0

    // Determine buy vs sell: if SOL flows toward the pool, it's a buy
    // (user sends SOL, receives tokens)
    const isBuy = tokenTransfer.amount > 0 && solTransfer && solTransfer.lamports > 0
    const side: "trade:buy" | "trade:sell" = isBuy ? "trade:buy" : "trade:sell"

    const event: TradeEvent = {
      type: side,
      mint: tokenTransfer.mint,
      wallet: solTransfer?.from ?? tx.accounts[0] ?? "",
      amountSol: Math.abs(amountSol),
      amountToken: Math.abs(tokenTransfer.amount),
      price: amountSol !== 0 ? Math.abs(tokenTransfer.amount / amountSol) : 0,
      signature: tx.signature,
      timestamp: tx.timestamp,
    }

    this.emit(side, event)
  }

  private emitFeeClaimed(tx: LaserStreamTransaction): void {
    const solTransfer = tx.nativeTransfers[0]
    const event: FeeClaimedEvent = {
      type: "fee:claimed",
      mint: tx.tokenTransfers[0]?.mint ?? "",
      wallet: solTransfer?.to ?? tx.accounts[0] ?? "",
      amount: solTransfer ? solTransfer.lamports / 1e9 : 0,
      signature: tx.signature,
      timestamp: tx.timestamp,
    }
    this.emit("fee:claimed", event)
  }

  private emitPoolGraduated(tx: LaserStreamTransaction): void {
    const event: PoolGraduatedEvent = {
      type: "pool:graduated",
      mint: tx.tokenTransfers[0]?.mint ?? "",
      poolAddress: tx.accounts[1] ?? "",
      finalBondingPrice: 0, // would need pool state lookup for exact price
      timestamp: tx.timestamp,
    }
    this.emit("pool:graduated", event)
  }

  // ─── Launch feed polling ──────────────────────────────────────────────────

  private startLaunchFeedPolling(): void {
    let lastSeenMint: string | null = null

    const poll = async () => {
      try {
        const feed = await this.bags.getTokenFeed(10) as Array<{
          mint: string
          name: string
          symbol: string
          creator: string
          initialPrice?: number
          createdAt?: number
        }>

        for (const token of feed.reverse()) {
          if (lastSeenMint && token.mint === lastSeenMint) break
          if (this.seenSignatures.has(token.mint)) continue

          this.seenSignatures.add(token.mint)
          lastSeenMint = token.mint

          const event: TokenLaunchedEvent = {
            type: "token:launched",
            mint: token.mint,
            name: token.name,
            symbol: token.symbol,
            creator: token.creator,
            initialPrice: token.initialPrice ?? 0,
            timestamp: token.createdAt ?? Date.now(),
          }
          this.emit("token:launched", event)
        }
      } catch {
        // Swallow polling errors — will retry next interval
      }
    }

    const interval = setInterval(poll, 3000)
    this.pollingIntervals.push(interval)
    poll()
  }

  // ─── Webhook ingestion ────────────────────────────────────────────────────

  /**
   * Ingest a raw webhook payload from Helius and emit normalized event(s).
   *
   * Use this in your webhook handler endpoint:
   *   app.post("/webhook/helius", (req, res) => {
   *     sdk.stream.ingestWebhook(req.body)
   *     res.sendStatus(200)
   *   })
   *
   * Accepts a single enhanced transaction or an array of them (Helius sends arrays).
   */
  ingestWebhook(payload: unknown): void {
    const transactions = Array.isArray(payload) ? payload : [payload]

    for (const raw of transactions) {
      const tx = raw as HeliusEnhancedTransaction
      if (!tx.signature) continue

      // Deduplicate
      if (this.seenSignatures.has(tx.signature)) continue
      this.seenSignatures.add(tx.signature)

      // Determine event type from the Helius-enriched data
      const events = this.parseWebhookTransaction(tx)
      for (const event of events) {
        this.emit(event.type, event)
      }
    }
  }

  private parseWebhookTransaction(tx: HeliusEnhancedTransaction): BagsEvent[] {
    const events: BagsEvent[] = []

    // Check if this involves Meteora DBC program
    const involvesDBC = tx.instructions?.some(
      ix => ix.programId === METEORA_DBC_PROGRAM ||
            ix.innerInstructions?.some(inner => inner.programId === METEORA_DBC_PROGRAM)
    )
    if (!involvesDBC) return events

    // Classify by Helius transaction type
    const type = tx.type?.toUpperCase() ?? ""

    if (type.includes("SWAP") || type.includes("TRADE")) {
      const tokenXfer = tx.tokenTransfers?.[0]
      const solXfer = tx.nativeTransfers?.[0]

      if (tokenXfer) {
        const amountSol = solXfer ? solXfer.amount / 1e9 : 0
        const isBuy = tokenXfer.tokenAmount > 0 && amountSol > 0

        const event: TradeEvent = {
          type: isBuy ? "trade:buy" : "trade:sell",
          mint: tokenXfer.mint,
          wallet: tx.feePayer,
          amountSol: Math.abs(amountSol),
          amountToken: Math.abs(tokenXfer.tokenAmount),
          price: amountSol !== 0 ? Math.abs(tokenXfer.tokenAmount / amountSol) : 0,
          signature: tx.signature,
          timestamp: tx.timestamp * 1000,
        }
        events.push(event)
      }
    }

    if (type.includes("CLAIM") || type.includes("FEE")) {
      const solXfer = tx.nativeTransfers?.[0]
      const event: FeeClaimedEvent = {
        type: "fee:claimed",
        mint: tx.tokenTransfers?.[0]?.mint ?? "",
        wallet: solXfer?.toUserAccount ?? tx.feePayer,
        amount: solXfer ? solXfer.amount / 1e9 : 0,
        signature: tx.signature,
        timestamp: tx.timestamp * 1000,
      }
      events.push(event)
    }

    return events
  }
}
