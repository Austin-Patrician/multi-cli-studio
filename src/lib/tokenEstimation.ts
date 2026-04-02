import type { ChatMessage, ConversationSession } from "./models";

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;

/**
 * Rough token estimate.
 * English ~4 chars/token, CJK ~2 chars/token, JSON overhead ~2 chars/token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkMatches = text.match(CJK_RANGE);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount / 2 + otherCount / 4);
}

export function estimateMessageTokens(msg: ChatMessage): number {
  let total = estimateTokens(msg.content);
  if (msg.rawContent) {
    total = Math.max(total, estimateTokens(msg.rawContent));
  }
  // role/metadata overhead
  total += 4;
  return total;
}

export function estimateSessionTokens(session: ConversationSession): number {
  return session.messages.reduce(
    (sum, msg) => sum + estimateMessageTokens(msg),
    0
  );
}

// ── Thresholds (tokens) ──────────────────────────────────────────────

/** Micro-compact: truncate rawContent of old messages */
export const MICRO_COMPACT_PRESERVE_COUNT = 10;
export const MICRO_COMPACT_MAX_RAW_CHARS = 2000;

/** Turn-compact: summarise early turns when session grows large */
export const TURN_COMPACT_THRESHOLD = 80_000;
export const TURN_COMPACT_PRESERVE_TURNS = 8;

/** Full-compact: emergency summarise everything */
export const FULL_COMPACT_THRESHOLD = 150_000;
export const FULL_COMPACT_PRESERVE_TURNS = 6;

/** Cross-tab context: max chars per sibling summary */
export const CROSS_TAB_SUMMARY_MAX_CHARS = 1200;
/** Max sibling summaries injected */
export const CROSS_TAB_MAX_ENTRIES = 4;
