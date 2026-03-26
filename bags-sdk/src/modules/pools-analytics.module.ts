import { PoolInfo, TokenAnalytics } from "../types"
import { BagsAdapter } from "../adapters/bags.adapter"
import { BirdeyeAdapter } from "../adapters/birdeye.adapter"

/**
 * Pool state module — get price, liquidity, and bonding curve info for any token.
 *
 * Merges data from Bags API and Birdeye (when configured) for richer pool snapshots.
 *
 * @example
 * ```ts
 * const pool = await sdk.pools.get(tokenMint)
 * console.log(`Price: $${pool.priceUsd}, Liquidity: ${pool.liquidity}`)
 * console.log(`Bonding curve: ${pool.bondingCurveProgress}% complete`)
 * ```
 */
export class PoolsModule {
  constructor(
    private bags: BagsAdapter,
    private birdeye: BirdeyeAdapter
  ) {}

  /**
   * Get full pool info for a token — price, liquidity, bonding curve progress, volume.
   * Merges Bags pool state with Birdeye price data when available.
   */
  async get(tokenMint: string): Promise<PoolInfo> {
    const [rawPool, birdeyePrice] = await Promise.all([
      this.bags.getPoolByMint(tokenMint),
      this.birdeye.getTokenPrice(tokenMint),
    ])

    const pool = rawPool as Partial<PoolInfo> & Record<string, unknown>
    const price = birdeyePrice?.priceUsd ?? (pool.price as number) ?? 0

    return {
      address: (pool.address as string) ?? "",
      tokenMint,
      price,
      priceUsd: price,
      liquidity: (pool.liquidity as number) ?? 0,
      volume24h: (pool.volume24h as number) ?? 0,
      bondingCurveProgress: (pool.bondingCurveProgress as number) ?? 0,
      bondingCurveRemaining: (pool.bondingCurveRemaining as number) ?? 0,
      graduated: (pool.graduated as boolean) ?? false,
      graduatedAt: pool.graduatedAt as number | undefined,
    }
  }
}

export class AnalyticsModule {
  constructor(
    private bags: BagsAdapter,
    private birdeye: BirdeyeAdapter,
    private pools: PoolsModule
  ) {}

  /**
   * Get comprehensive analytics for a token:
   * fees, holder count, volume, price history, pool state.
   */
  async token(mint: string): Promise<TokenAnalytics> {
    const [feeData, claimEvents, pool, priceHistory, volumeData] = await Promise.all([
      this.bags.getTokenLifetimeFees(mint),
      this.bags.getTokenClaimEvents(mint),
      this.pools.get(mint),
      this.birdeye.getPriceHistory(mint, "1H", 168), // 7 days
      this.birdeye.getTokenVolume(mint),
    ])

    const fee = feeData as { lifetimeFees: number; claimStats: unknown }
    const creators = await this.bags.getTokenFeed(1) as Array<{
      mint: string; name: string; symbol: string; creator: string; createdAt: number
    }>
    const tokenInfo = creators.find(t => t.mint === mint) ?? {
      name: "", symbol: "", creator: "", createdAt: 0
    }

    return {
      mint,
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      creator: tokenInfo.creator,
      createdAt: tokenInfo.createdAt,
      lifetimeFees: fee.lifetimeFees ?? 0,
      holders: 0, // requires on-chain holder query — extend with Helius DAS API
      transactions24h: (claimEvents as unknown[]).length,
      volume24h: volumeData?.volume24h ?? pool.volume24h,
      priceHistory,
      pool,
    }
  }
}
