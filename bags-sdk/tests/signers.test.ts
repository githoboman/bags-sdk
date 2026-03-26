import { describe, it, expect, vi } from "vitest"
import { Keypair, Transaction, VersionedTransaction, TransactionMessage, PublicKey, SystemProgram } from "@solana/web3.js"
import { KeypairSigner, SessionKey, SessionKeyError, PrivySigner } from "../src/index"
import type { PrivyClientLike } from "../src/index"

// ─── KeypairSigner ───────────────────────────────────────────────────────────

describe("KeypairSigner", () => {
  it("from() creates a signer with correct publicKey", () => {
    const kp = Keypair.generate()
    const signer = KeypairSigner.from(kp)
    expect(signer.publicKey).toBe(kp.publicKey.toBase58())
  })

  it("fromBase58() creates a signer from a base58 private key", () => {
    const kp = Keypair.generate()
    const bs58Key = require("bs58").encode(kp.secretKey)
    const signer = KeypairSigner.fromBase58(bs58Key)
    expect(signer.publicKey).toBe(kp.publicKey.toBase58())
  })

  it("fromEnv() throws when no env var is set", () => {
    delete process.env.PRIVATE_KEY
    delete process.env.BAGS_PRIVATE_KEY
    expect(() => KeypairSigner.fromEnv()).toThrow("Set PRIVATE_KEY or BAGS_PRIVATE_KEY")
  })

  it("fromEnv() reads PRIVATE_KEY env var", () => {
    const kp = Keypair.generate()
    const bs58Key = require("bs58").encode(kp.secretKey)
    process.env.PRIVATE_KEY = bs58Key
    const signer = KeypairSigner.fromEnv()
    expect(signer.publicKey).toBe(kp.publicKey.toBase58())
    delete process.env.PRIVATE_KEY
  })

  it("signTransaction() signs a legacy transaction", async () => {
    const kp = Keypair.generate()
    const signer = KeypairSigner.from(kp)

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1000,
      })
    )
    tx.recentBlockhash = "GfVcyD4kkTrj4bY8BhtGMzfMoMsEhtSBVGQjm1F4Wzse"
    tx.feePayer = kp.publicKey

    const serialized = tx.serialize({ requireAllSignatures: false })
    const signed = await signer.signTransaction(serialized)
    expect(signed).toBeInstanceOf(Uint8Array)
    expect(signed.length).toBeGreaterThan(0)
  })
})

// ─── SessionKey ──────────────────────────────────────────────────────────────

describe("SessionKey", () => {
  it("create() generates a session with correct config", () => {
    const session = SessionKey.create({
      allowedPrograms: ["11111111111111111111111111111111"],
      maxSpendPerTx: 100000,
      expiresIn: 60000,
      label: "test-session",
    })

    expect(session.publicKey).toBeTruthy()
    expect(session.signer.publicKey).toBe(session.publicKey)

    const state = session.state()
    expect(state.config.allowedPrograms).toEqual(["11111111111111111111111111111111"])
    expect(state.config.maxSpendPerTx).toBe(100000)
    expect(state.transactionCount).toBe(0)
    expect(state.revoked).toBe(false)
    expect(state.expiresAt).toBeGreaterThan(Date.now())
  })

  it("revoke() prevents further signing", async () => {
    const session = SessionKey.create({
      allowedPrograms: ["11111111111111111111111111111111"],
      maxSpendPerTx: 100000,
      expiresIn: 60000,
    })

    session.revoke()
    expect(session.state().revoked).toBe(true)

    const kp = Keypair.generate()
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1000,
      })
    )
    tx.recentBlockhash = "GfVcyD4kkTrj4bY8BhtGMzfMoMsEhtSBVGQjm1F4Wzse"
    tx.feePayer = kp.publicKey

    const serialized = tx.serialize({ requireAllSignatures: false })
    await expect(session.signer.signTransaction(serialized)).rejects.toThrow("revoked")
  })

  it("rejects expired session keys", async () => {
    const session = SessionKey.create({
      allowedPrograms: ["11111111111111111111111111111111"],
      maxSpendPerTx: 100000,
      expiresIn: 1, // 1ms — will be expired immediately
    })

    // Wait for it to expire
    await new Promise(r => setTimeout(r, 10))

    const kp = Keypair.generate()
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1000,
      })
    )
    tx.recentBlockhash = "GfVcyD4kkTrj4bY8BhtGMzfMoMsEhtSBVGQjm1F4Wzse"
    tx.feePayer = kp.publicKey

    const serialized = tx.serialize({ requireAllSignatures: false })
    await expect(session.signer.signTransaction(serialized)).rejects.toThrow("expired")
  })

  it("rejects unauthorized programs", async () => {
    const session = SessionKey.create({
      allowedPrograms: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"], // SPL Token only
      maxSpendPerTx: 100000,
      expiresIn: 60000,
    })

    const kp = Keypair.generate()
    const tx = new Transaction().add(
      SystemProgram.transfer({ // System Program — not in allowlist
        fromPubkey: kp.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1000,
      })
    )
    tx.recentBlockhash = "GfVcyD4kkTrj4bY8BhtGMzfMoMsEhtSBVGQjm1F4Wzse"
    tx.feePayer = kp.publicKey

    const serialized = tx.serialize({ requireAllSignatures: false })
    await expect(session.signer.signTransaction(serialized)).rejects.toThrow("not authorized")
  })

  it("signs when program is in allowlist", async () => {
    const session = SessionKey.create({
      allowedPrograms: ["11111111111111111111111111111111"], // System Program
      maxSpendPerTx: 100000,
      expiresIn: 60000,
    })

    // Use the session's own public key as feePayer so partialSign works
    const sessionPubkey = new PublicKey(session.publicKey)
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sessionPubkey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1000,
      })
    )
    tx.recentBlockhash = "GfVcyD4kkTrj4bY8BhtGMzfMoMsEhtSBVGQjm1F4Wzse"
    tx.feePayer = sessionPubkey

    const serialized = tx.serialize({ requireAllSignatures: false })
    const signed = await session.signer.signTransaction(serialized)
    expect(signed).toBeInstanceOf(Uint8Array)
    expect(session.state().transactionCount).toBe(1)
  })

  it("SessionKeyError has correct name", () => {
    const err = new SessionKeyError("test")
    expect(err.name).toBe("SessionKeyError")
    expect(err.message).toBe("test")
    expect(err).toBeInstanceOf(Error)
  })
})

// ─── PrivySigner ─────────────────────────────────────────────────────────────

describe("PrivySigner", () => {
  const mockPrivyClient: PrivyClientLike = {
    walletApi: {
      solana: {
        signTransaction: vi.fn().mockResolvedValue({
          data: { signedTransaction: Buffer.from("signed-tx-data").toString("base64") },
        }),
      },
    },
  }

  it("fromUser() extracts Solana wallet from linkedAccounts", () => {
    const signer = PrivySigner.fromUser(
      {
        id: "user-123",
        linkedAccounts: [
          { type: "wallet", address: "SoLaNaWaLLeTaDdReSs111111111111111111111", chainType: "solana" },
          { type: "wallet", address: "0xethwallet", chainType: "ethereum" },
        ],
      },
      mockPrivyClient
    )
    expect(signer.publicKey).toBe("SoLaNaWaLLeTaDdReSs111111111111111111111")
  })

  it("fromUser() falls back to wallet field", () => {
    const signer = PrivySigner.fromUser(
      {
        id: "user-123",
        wallet: { address: "FaLLbAcKwAlLeT1111111111111111111111111111" },
      },
      mockPrivyClient
    )
    expect(signer.publicKey).toBe("FaLLbAcKwAlLeT1111111111111111111111111111")
  })

  it("fromUser() throws when no Solana wallet found", () => {
    expect(() =>
      PrivySigner.fromUser(
        {
          id: "user-123",
          linkedAccounts: [
            { type: "wallet", address: "0xethwallet", chainType: "ethereum" },
          ],
        },
        mockPrivyClient
      )
    ).toThrow("no linked Solana wallet")
  })

  it("fromWallet() creates signer that calls Privy API", async () => {
    const signer = PrivySigner.fromWallet({
      privyClient: mockPrivyClient,
      walletAddress: "TestWallet111111111111111111111111111111111",
      userId: "user-456",
    })

    expect(signer.publicKey).toBe("TestWallet111111111111111111111111111111111")

    const fakeTx = new Uint8Array([1, 2, 3, 4])
    const result = await signer.signTransaction(fakeTx)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(mockPrivyClient.walletApi.solana.signTransaction).toHaveBeenCalledWith({
      address: "TestWallet111111111111111111111111111111111",
      transaction: Buffer.from(fakeTx).toString("base64"),
    })
  })
})
