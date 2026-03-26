import { describe, it, expect, vi, beforeEach } from "vitest"
import { BagsTx } from "../src/core/tx-builder"
import { Keypair, Transaction, SystemProgram } from "@solana/web3.js"
import type { HeliusAdapter } from "../src/adapters/helius.adapter"
import type { BagsSigner } from "../src/types"

function createMockHelius(overrides: Partial<HeliusAdapter> = {}): HeliusAdapter {
  return {
    estimatePriorityFee: vi.fn().mockResolvedValue(10000),
    simulateTransaction: vi.fn().mockResolvedValue({ success: true, logs: [], unitsConsumed: 5000 }),
    sendTransaction: vi.fn().mockResolvedValue({ signature: "mock-sig-abc123" }),
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: "GfVcyD4kkTrj4bY8BhtGMzfMoMsEhtSBVGQjm1F4Wzse", lastValidBlockHeight: 100 }),
    ...overrides,
  } as unknown as HeliusAdapter
}

function createMockSigner(): { signer: BagsSigner; keypair: Keypair } {
  const keypair = Keypair.generate()
  return {
    keypair,
    signer: {
      publicKey: keypair.publicKey.toBase58(),
      signTransaction: async (serializedTx: Uint8Array) => {
        const tx = Transaction.from(Buffer.from(serializedTx))
        tx.partialSign(keypair)
        return tx.serialize({ requireAllSignatures: false })
      },
    },
  }
}

function createSerializedTx(feePayer: Keypair): string {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: feePayer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1000,
    })
  )
  tx.recentBlockhash = "GfVcyD4kkTrj4bY8BhtGMzfMoMsEhtSBVGQjm1F4Wzse"
  tx.feePayer = feePayer.publicKey
  return Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64")
}

describe("BagsTx", () => {
  let helius: HeliusAdapter
  let signer: BagsSigner
  let keypair: Keypair
  let serializedTx: string

  beforeEach(() => {
    helius = createMockHelius()
    const mock = createMockSigner()
    signer = mock.signer
    keypair = mock.keypair
    serializedTx = createSerializedTx(keypair)
  })

  it("creates with serialized transaction and metadata", () => {
    const tx = new BagsTx(serializedTx, helius, { mint: "mint123", poolAddress: "pool456" })
    expect(tx.getRawTransaction()).toBe(serializedTx)
  })

  it("withPriorityFee() returns self for chaining", () => {
    const tx = new BagsTx(serializedTx, helius)
    const result = tx.withPriorityFee("auto")
    expect(result).toBe(tx)
  })

  it("withSimulation() returns self for chaining", () => {
    const tx = new BagsTx(serializedTx, helius)
    const result = tx.withSimulation()
    expect(result).toBe(tx)
  })

  it("withRetry() returns self for chaining", () => {
    const tx = new BagsTx(serializedTx, helius)
    const result = tx.withRetry(5)
    expect(result).toBe(tx)
  })

  it("withCommitment() returns self for chaining", () => {
    const tx = new BagsTx(serializedTx, helius)
    const result = tx.withCommitment("finalized")
    expect(result).toBe(tx)
  })

  it("send() signs and submits the transaction", async () => {
    const tx = new BagsTx(serializedTx, helius, { mint: "mint123", poolAddress: "pool456" })
    const result = await tx.send(signer)

    expect(result.signature).toBe("mock-sig-abc123")
    expect(result.mint).toBe("mint123")
    expect(result.poolAddress).toBe("pool456")
    expect(helius.sendTransaction).toHaveBeenCalledTimes(1)
  })

  it("send() with simulation runs simulation first", async () => {
    const tx = new BagsTx(serializedTx, helius)
    await tx.withSimulation().send(signer)

    expect(helius.simulateTransaction).toHaveBeenCalledTimes(1)
    expect(helius.sendTransaction).toHaveBeenCalledTimes(1)
  })

  it("send() throws when simulation fails", async () => {
    helius = createMockHelius({
      simulateTransaction: vi.fn().mockResolvedValue({
        success: false,
        logs: ["Program log: Error"],
        error: "InstructionError",
      }),
    } as unknown as Partial<HeliusAdapter>)

    const tx = new BagsTx(serializedTx, helius)
    await expect(tx.withSimulation().send(signer)).rejects.toThrow("simulation failed")
  })

  it("getRawTransaction() returns the base64 tx", () => {
    const tx = new BagsTx("base64txdata", helius)
    expect(tx.getRawTransaction()).toBe("base64txdata")
  })
})
