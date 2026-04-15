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
export const TURN_COMPACT_THRESHOLD = 200_000;
export const TURN_COMPACT_PRESERVE_TURNS = 20;

/** Full-compact: emergency summarise everything */
export const FULL_COMPACT_THRESHOLD = 400_000;
export const FULL_COMPACT_PRESERVE_TURNS = 12;

/** Cross-tab context: max chars per sibling summary */
export const CROSS_TAB_SUMMARY_MAX_CHARS = 1600;
/** Max sibling summaries injected */
export const CROSS_TAB_MAX_ENTRIES = 2;

// ── Dynamic context budget ───────────────────────────────────────────

/** Maximum tokens allocated for recent turn context injection */
export const CONTEXT_TURNS_MAX_BUDGET = 10_000;
/** Per-CLI budgets — Claude has larger context window, Codex/Gemini smaller */
export const CONTEXT_TURNS_BUDGET_BY_CLI: Record<string, number> = {
  claude: 16_000,
  codex: 10_000,
  gemini: 10_000,
};
/** Minimum turns to always include (even if over budget) */
export const CONTEXT_TURNS_MIN_COUNT = 1;
/** Absolute upper limit of turns regardless of budget */
export const CONTEXT_TURNS_MAX_COUNT = 12;

/**
 * Compute how many recent turns can fit within a token budget.
 * Walks backward from most recent, accumulating token costs.
 */
export function computeDynamicTurnLimit(
  turnTokenCosts: number[],
  budget: number = CONTEXT_TURNS_MAX_BUDGET
): number {
  let used = 0;
  let count = 0;
  for (let i = turnTokenCosts.length - 1; i >= 0; i--) {
    const cost = turnTokenCosts[i];
    if (count >= CONTEXT_TURNS_MIN_COUNT && used + cost > budget) break;
    if (count >= CONTEXT_TURNS_MAX_COUNT) break;
    used += cost;
    count++;
  }
  return Math.max(count, Math.min(CONTEXT_TURNS_MIN_COUNT, turnTokenCosts.length));
}
