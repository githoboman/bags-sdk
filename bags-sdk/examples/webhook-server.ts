/**
 * Example: Webhook server for real-time Helius events
 *
 * Instead of polling or maintaining a WebSocket connection, you can
 * set up a Helius webhook that POSTs enhanced transaction data to
 * your server. The SDK parses it into normalized BagsEvent types.
 *
 * Setup:
 *   1. Go to helius.dev → Webhooks → Create webhook
 *   2. Set the URL to your server (e.g., https://yourapp.com/webhook/helius)
 *   3. Select "Enhanced" transaction type
 *   4. Add the Meteora DBC program: dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN
 *
 * Run: BAGS_API_KEY=... HELIUS_API_KEY=... ts-node examples/webhook-server.ts
 *
 * Note: This example uses a minimal HTTP server. In production, use Express/Fastify.
 */

import { createServer } from "http"
import { BagsSDK } from "../src"

async function main() {
  const sdk = new BagsSDK({
    bagsApiKey: process.env.BAGS_API_KEY!,
    heliusApiKey: process.env.HELIUS_API_KEY!,
  })

  // ─── Register event handlers (same API as streaming) ───────────────────────

  sdk.stream.on("trade:buy", (event) => {
    console.log(`[BUY]  ${event.amountSol.toFixed(4)} SOL → ${event.mint}`)
    console.log(`       wallet: ${event.wallet}`)
    console.log(`       sig:    ${event.signature.slice(0, 20)}...`)
  })

  sdk.stream.on("trade:sell", (event) => {
    console.log(`[SELL] ${event.amountToken} tokens → ${event.amountSol.toFixed(4)} SOL`)
    console.log(`       mint:   ${event.mint}`)
  })

  sdk.stream.on("fee:claimed", (event) => {
    console.log(`[FEE]  ${event.amount} SOL claimed by ${event.wallet}`)
  })

  // ─── HTTP server to receive webhook POSTs ──────────────────────────────────

  const PORT = parseInt(process.env.PORT ?? "3000")

  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/webhook/helius") {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => {
        try {
          const payload = JSON.parse(body)

          // This is the key line — SDK parses the Helius enhanced
          // transaction format and emits normalized events
          sdk.stream.ingestWebhook(payload)

          res.writeHead(200)
          res.end("OK")
        } catch {
          res.writeHead(400)
          res.end("Bad Request")
        }
      })
    } else {
      res.writeHead(404)
      res.end("Not Found")
    }
  })

  server.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`)
    console.log(`Configure Helius webhook URL: http://localhost:${PORT}/webhook/helius`)
    console.log()
  })

  process.on("SIGINT", () => {
    server.close()
    sdk.destroy()
    process.exit(0)
  })
}

main().catch(console.error)
