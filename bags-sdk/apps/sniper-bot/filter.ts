/**
 * Token filter — evaluates launches against configurable criteria.
 */

import type { TokenLaunchedEvent } from "../../src/types"
import type { SniperConfig } from "./config"

export interface FilterResult {
  pass: boolean
  reason: string
}

export class SniperFilter {
  constructor(private config: SniperConfig) {}

  evaluate(event: TokenLaunchedEvent): FilterResult {
    // Name length check
    if (event.name.length < this.config.minNameLength) {
      return { pass: false, reason: `name too short (${event.name.length} < ${this.config.minNameLength})` }
    }

    // Blacklist word check
    const nameLower = event.name.toLowerCase()
    const symbolLower = event.symbol.toLowerCase()
    for (const word of this.config.blacklistWords) {
      if (nameLower.includes(word) || symbolLower.includes(word)) {
        return { pass: false, reason: `blacklisted word: "${word}"` }
      }
    }

    // Creator whitelist check (empty = allow all)
    if (this.config.whitelistCreators.length > 0) {
      if (!this.config.whitelistCreators.includes(event.creator)) {
        return { pass: false, reason: `creator not whitelisted: ${event.creator}` }
      }
    }

    return { pass: true, reason: "all checks passed" }
  }
}
