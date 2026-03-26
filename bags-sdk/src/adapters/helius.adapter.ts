import { BagsSDKConfig, TxOptions, SendTxResult } from "../types"
import { Connection } from "@solana/web3.js"

export class HeliusAdapter {
  private apiKey: string
  private cluster: string
  private rpcUrl: string
  private senderUrl: string
  readonly connection: Connection

  constructor(config: BagsSDKConfig) {
    this.apiKey = config.heliusApiKey
    this.cluster = config.cluster ?? "mainnet-beta"
    this.rpcUrl = `https://${this.cluster === "devnet" ? "devnet" : "mainnet"}.helius-rpc.com/?api-key=${this.apiKey}`
    this.senderUrl = `https://sender.helius-rpc.com/?api-key=${this.apiKey}`
    this.connection = new Connection(this.rpcUrl, "confirmed")
  }

  // ─── Priority Fee Estimation ──────────────────────────────────────────────

  async estimatePriorityFee(
    level: "low" | "medium" | "high" | "auto"
  ): Promise<number> {
    if (typeof level === "number") return level

    const res = await fetch(`${this.rpcUrl}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getPriorityFeeEstimate",
        params: [{ options: { priorityLevel: level === "auto" ? "MEDIUM" : level.toUpperCase() } }],
      }),
    })
    const data = await res.json() as { result?: { priorityFeeEstimate?: number } }
    return data.result?.priorityFeeEstimate ?? 10000
  }

  // ─── Transaction Simulation ───────────────────────────────────────────────

  async simulateTransaction(serializedTx: string): Promise<{
    success: boolean
    logs: string[]
    unitsConsumed?: number
    error?: string
  }> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "simulateTransaction",
        params: [serializedTx, { encoding: "base64", replaceRecentBlockhash: true }],
      }),
    })
    const data = await res.json() as {
      result?: {
        value?: {
          err: unknown
          logs: string[]
          unitsConsumed?: number
        }
      }
    }
    const value = data.result?.value
    return {
      success: !value?.err,
      logs: value?.logs ?? [],
      unitsConsumed: value?.unitsConsumed,
      error: value?.err ? JSON.stringify(value.err) : undefined,
    }
  }

  // ─── Transaction Sending (via Helius Sender for fast landing) ─────────────

  async sendTransaction(
    signedTxBase64: string,
    options: TxOptions = {}
  ): Promise<SendTxResult> {
    const commitment = options.commitment ?? "confirmed"
    const maxRetries = options.maxRetries ?? 3

    // Use Helius Sender endpoint for optimized landing
    const res = await fetch(this.senderUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [
          signedTxBase64,
          {
            encoding: "base64",
            skipPreflight: true, // Required for Sender
            maxRetries: 0,       // Sender handles retries internally
          },
        ],
      }),
    })
    const data = await res.json() as { result?: string; error?: { message: string } }

    if (data.error) {
      throw new Error(`Helius Sender error: ${data.error.message}`)
    }

    const signature = data.result!

    // Wait for confirmation
    const { value } = await this.connection.confirmTransaction(
      signature,
      commitment
    )

    if (value.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(value.err)}`)
    }

    return { signature }
  }

  // ─── Recent Blockhash ─────────────────────────────────────────────────────

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    const result = await this.connection.getLatestBlockhash("confirmed")
    return { blockhash: result.blockhash, lastValidBlockHeight: result.lastValidBlockHeight }
  }

  // ─── Webhooks (for event streaming) ──────────────────────────────────────

  async createWebhook(params: {
    accountAddresses: string[]
    webhookURL: string
    transactionTypes?: string[]
  }): Promise<{ webhookId: string }> {
    const res = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookURL: params.webhookURL,
        transactionTypes: params.transactionTypes ?? ["Any"],
        accountAddresses: params.accountAddresses,
        webhookType: "enhanced",
      }),
    })
    const data = await res.json() as { webhookID?: string }
    return { webhookId: data.webhookID ?? "" }
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await fetch(`https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${this.apiKey}`, {
      method: "DELETE",
    })
  }

  // ─── LaserStream gRPC ──────────────────────────────────────────────────────

  /**
   * Connect to Helius LaserStream via WebSocket for real-time transaction streaming.
   * Filters for specific program IDs (e.g. Meteora DBC) and emits parsed tx data.
   *
   * Returns a controller to stop the stream.
   */
  subscribeLaserStream(params: {
    programIds: string[]
    onTransaction: (tx: LaserStreamTransaction) => void
    onError?: (error: Error) => void
    onDisconnect?: () => void
  }): LaserStreamSubscription {
    const wsUrl = `wss://laserstream-${this.cluster === "devnet" ? "devnet" : "mainnet"}.helius-rpc.com/?api-key=${this.apiKey}`

    let ws: import("ws") | null = null
    let alive = true
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = async () => {
      if (!alive) return

      // Dynamic import — ws is only needed at runtime for LaserStream
      const { default: WebSocket } = await import("ws")
      ws = new WebSocket(wsUrl)

      ws.on("open", () => {
        ws!.send(JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "transactionSubscribe",
          params: [{
            accountInclude: params.programIds,
          }, {
            commitment: "confirmed",
            encoding: "jsonParsed",
            transactionDetails: "full",
            maxSupportedTransactionVersion: 0,
          }],
        }))
      })

      ws.on("message", (raw: Buffer | string) => {
        try {
          const data = JSON.parse(typeof raw === "string" ? raw : raw.toString())

          // Skip subscription confirmation
          if (data.result !== undefined && !data.params) return

          const notification = data.params?.result
          if (!notification) return

          const tx = parseLaserStreamTx(notification)
          if (tx) params.onTransaction(tx)
        } catch (err) {
          params.onError?.(err instanceof Error ? err : new Error(String(err)))
        }
      })

      ws.on("error", (err: Error) => {
        params.onError?.(new Error(`LaserStream WebSocket error: ${err.message}`))
      })

      ws.on("close", () => {
        if (!alive) return
        params.onDisconnect?.()
        reconnectTimer = setTimeout(connect, 3000)
      })
    }

    connect()

    return {
      stop: () => {
        alive = false
        if (reconnectTimer) clearTimeout(reconnectTimer)
        if (ws) ws.close()
      },
    }
  }

  getRpcUrl(): string {
    return this.rpcUrl
  }

  getApiKey(): string {
    return this.apiKey
  }

  getCluster(): string {
    return this.cluster
  }
}

// ─── LaserStream types ─────────────────────────────────────────────────────────

export interface LaserStreamTransaction {
  signature: string
  slot: number
  timestamp: number
  programIds: string[]
  accounts: string[]
  logMessages: string[]
  innerInstructions: Array<{
    programId: string
    accounts: string[]
    data: string
  }>
  nativeTransfers: Array<{
    from: string
    to: string
    lamports: number
  }>
  tokenTransfers: Array<{
    from: string
    to: string
    mint: string
    amount: number
  }>
}

export interface LaserStreamSubscription {
  stop: () => void
}

function parseLaserStreamTx(notification: Record<string, unknown>): LaserStreamTransaction | null {
  try {
    const sig = notification.signature as string
    const slot = notification.slot as number ?? 0
    const blockTime = notification.blockTime as number ?? Math.floor(Date.now() / 1000)

    const txMeta = notification.transaction as Record<string, unknown> | undefined
    if (!txMeta) return null

    const meta = txMeta.meta as Record<string, unknown> ?? {}
    const transaction = txMeta.transaction as Record<string, unknown> ?? {}
    const message = transaction.message as Record<string, unknown> ?? {}

    const accountKeys = (message.accountKeys as Array<{ pubkey: string }> ?? [])
      .map((a: { pubkey: string } | string) => typeof a === "string" ? a : a.pubkey)

    const programIds = (message.instructions as Array<{ programId: string }> ?? [])
      .map((ix: { programId: string }) => ix.programId)
      .filter(Boolean)

    const logMessages = (meta.logMessages as string[]) ?? []

    const innerIxs = (meta.innerInstructions as Array<{
      instructions: Array<{ programId: string; accounts: string[]; data: string }>
    }> ?? []).flatMap(group =>
      (group.instructions ?? []).map(ix => ({
        programId: ix.programId,
        accounts: ix.accounts ?? [],
        data: ix.data ?? "",
      }))
    )

    // Parse native SOL transfers from pre/post balances
    const preBalances = (meta.preBalances as number[]) ?? []
    const postBalances = (meta.postBalances as number[]) ?? []
    const nativeTransfers: LaserStreamTransaction["nativeTransfers"] = []
    for (let i = 0; i < accountKeys.length; i++) {
      const diff = (postBalances[i] ?? 0) - (preBalances[i] ?? 0)
      if (diff < 0) {
        for (let j = 0; j < accountKeys.length; j++) {
          const jDiff = (postBalances[j] ?? 0) - (preBalances[j] ?? 0)
          if (jDiff > 0) {
            nativeTransfers.push({ from: accountKeys[i], to: accountKeys[j], lamports: jDiff })
          }
        }
        break
      }
    }

    // Parse token transfers from pre/post token balances
    const preTokenBalances = (meta.preTokenBalances as Array<{
      accountIndex: number; mint: string; uiTokenAmount: { uiAmount: number }
    }>) ?? []
    const postTokenBalances = (meta.postTokenBalances as Array<{
      accountIndex: number; mint: string; uiTokenAmount: { uiAmount: number }
    }>) ?? []

    const tokenTransfers: LaserStreamTransaction["tokenTransfers"] = []
    for (const post of postTokenBalances) {
      const pre = preTokenBalances.find(
        p => p.accountIndex === post.accountIndex && p.mint === post.mint
      )
      const preAmt = pre?.uiTokenAmount?.uiAmount ?? 0
      const postAmt = post.uiTokenAmount?.uiAmount ?? 0
      const diff = postAmt - preAmt
      if (diff > 0) {
        tokenTransfers.push({
          from: "",
          to: accountKeys[post.accountIndex] ?? "",
          mint: post.mint,
          amount: diff,
        })
      }
    }

    return {
      signature: sig,
      slot,
      timestamp: blockTime * 1000,
      programIds,
      accounts: accountKeys,
      logMessages,
      innerInstructions: innerIxs,
      nativeTransfers,
      tokenTransfers,
    }
  } catch {
    return null
  }
}
