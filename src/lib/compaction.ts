/**
 * compaction.ts — Multi-layer conversation compaction for multi-cli-studio.
 *
 * Three compression layers (inspired by Claude Code):
 *   1. Micro-compact  — truncate rawContent of old messages in-place
 *   2. Turn-compact   — summarise early turns into a CompactedSummary
 *   3. Full-compact   — emergency: summarise everything, keep only recent turns
 *
 * Plus cross-tab context helpers.
 */

import type {
  AgentId,
  ChatMessage,
  ChatMessageBlock,
  CompactedSummary,
  ConversationSession,
  SharedContextEntry,
  TerminalTab,
} from "./models";
import { summarizeForContext } from "./messageFormatting";
import {
  estimateMessageTokens,
  estimateSessionTokens,
  estimateTokens,
  MICRO_COMPACT_MAX_RAW_CHARS,
  MICRO_COMPACT_PRESERVE_COUNT,
  TURN_COMPACT_THRESHOLD,
  TURN_COMPACT_PRESERVE_TURNS,
  FULL_COMPACT_THRESHOLD,
  FULL_COMPACT_PRESERVE_TURNS,
  CROSS_TAB_SUMMARY_MAX_CHARS,
  CROSS_TAB_MAX_ENTRIES,
} from "./tokenEstimation";

// ── helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function compactId(prefix: string) {
  _idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${_idCounter}`;
}

function nowIso() {
  return new Date().toISOString();
}

/** Group messages into user→assistant turn pairs */
function groupIntoTurns(messages: ChatMessage[]): Array<{ user: ChatMessage; assistant: ChatMessage }> {
  const turns: Array<{ user: ChatMessage; assistant: ChatMessage }> = [];
  let pendingUser: ChatMessage | null = null;

  for (const msg of messages) {
    if (msg.role === "user") {
      pendingUser = msg;
    } else if (msg.role === "assistant" && pendingUser && !msg.isStreaming) {
      turns.push({ user: pendingUser, assistant: msg });
      pendingUser = null;
    }
  }
  return turns;
}

/** Collect changed file paths from message blocks */
function extractChangedFiles(messages: ChatMessage[]): string[] {
  const files = new Set<string>();
  for (const msg of messages) {
    if (!msg.blocks) continue;
    for (const block of msg.blocks) {
      if (block.kind === "fileChange") {
        files.add(block.path);
      }
    }
  }
  return [...files];
}

/** Extract the last error block from messages */
function extractErrors(messages: ChatMessage[]): string {
  const errors: string[] = [];
  for (const msg of messages) {
    if (msg.exitCode && msg.exitCode !== 0) {
      const snippet = summarizeForContext(msg.rawContent ?? msg.content, 300);
      errors.push(snippet);
    }
    if (!msg.blocks) continue;
    for (const block of msg.blocks) {
      if (block.kind === "command" && block.exitCode && block.exitCode !== 0) {
        errors.push(`${block.command}: ${block.output?.slice(0, 200) ?? "failed"}`);
      }
      if (block.kind === "status" && block.level === "error") {
        errors.push(block.text.slice(0, 200));
      }
    }
  }
  if (errors.length === 0) return "";
  return errors.slice(-5).join("\n");
}

// ── Layer 1: Micro Compaction ────────────────────────────────────────

/**
 * Truncate `rawContent` of older messages to reduce memory & token footprint.
 * Returns a new messages array (original is not mutated).
 */
export function microCompact(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MICRO_COMPACT_PRESERVE_COUNT) return messages;

  const cutoff = messages.length - MICRO_COMPACT_PRESERVE_COUNT;
  return messages.map((msg, idx) => {
    if (idx >= cutoff) return msg;
    if (!msg.rawContent || msg.rawContent.length <= MICRO_COMPACT_MAX_RAW_CHARS) return msg;

    return {
      ...msg,
      rawContent: msg.rawContent.slice(0, MICRO_COMPACT_MAX_RAW_CHARS) + "\n[...truncated]",
    };
  });
}

// ── Layer 2: Turn Compaction ─────────────────────────────────────────

/**
 * Build a structured `CompactedSummary` from a slice of messages.
 * This is a **local** summariser — no LLM call.
 * For higher quality, an LLM-based summariser can be plugged in later.
 */
export function buildCompactedSummary(
  messages: ChatMessage[],
  sourceTabId: string,
  sourceCli: AgentId,
  existingVersion = 0
): CompactedSummary {
  const turns = groupIntoTurns(messages);

  // Intent: first user prompt
  const firstUserMsg = messages.find((m) => m.role === "user");
  const intent = firstUserMsg
    ? summarizeForContext(firstUserMsg.content, 600)
    : "Unknown intent";

  // Technical context: collect unique file changes + tool mentions
  const changedFiles = extractChangedFiles(messages);
  const toolMentions = new Set<string>();
  for (const msg of messages) {
    if (!msg.blocks) continue;
    for (const block of msg.blocks) {
      if (block.kind === "tool") toolMentions.add(block.tool);
      if (block.kind === "command") toolMentions.add(block.label);
    }
  }
  const technicalContext = [
    changedFiles.length > 0 ? `Files: ${changedFiles.join(", ")}` : "",
    toolMentions.size > 0 ? `Tools: ${[...toolMentions].join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Errors
  const errorsAndFixes = extractErrors(messages);

  // Current state: last assistant message summary
  const lastAssistant = [...messages].reverse().find(
    (m) => m.role === "assistant" && !m.isStreaming
  );
  const currentState = lastAssistant
    ? summarizeForContext(lastAssistant.rawContent ?? lastAssistant.content, 600)
    : "";

  // Next steps: from last user message (if it looks like a follow-up)
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const nextSteps = lastUser ? summarizeForContext(lastUser.content, 400) : "";

  const summary: CompactedSummary = {
    id: compactId("cs"),
    sourceTabId,
    sourceCli,
    timestamp: nowIso(),
    intent,
    technicalContext,
    changedFiles,
    errorsAndFixes,
    currentState,
    nextSteps,
    tokenEstimate: 0,
    version: existingVersion + 1,
  };

  // Self-measure
  summary.tokenEstimate = estimateTokens(compactedSummaryToText(summary));
  return summary;
}

/** Serialize a CompactedSummary to a text block for prompt injection */
export function compactedSummaryToText(summary: CompactedSummary): string {
  const lines: string[] = [];
  if (summary.intent) lines.push(`Intent: ${summary.intent}`);
  if (summary.technicalContext) lines.push(`Context: ${summary.technicalContext}`);
  if (summary.changedFiles.length > 0)
    lines.push(`Changed files: ${summary.changedFiles.join(", ")}`);
  if (summary.errorsAndFixes) lines.push(`Errors/Fixes: ${summary.errorsAndFixes}`);
  if (summary.currentState) lines.push(`Current state: ${summary.currentState}`);
  if (summary.nextSteps) lines.push(`Next steps: ${summary.nextSteps}`);
  return lines.join("\n");
}

/**
 * Turn-level compaction. Summarises the oldest turns, preserving recent ones.
 * Returns updated session fields (messages, compactedSummaries, etc.).
 */
export function turnCompact(session: ConversationSession, cli: AgentId): {
  messages: ChatMessage[];
  compactedSummaries: CompactedSummary[];
  lastCompactedAt: string;
  estimatedTokens: number;
} | null {
  const tokens = estimateSessionTokens(session);
  if (tokens < TURN_COMPACT_THRESHOLD) return null;

  const turns = groupIntoTurns(session.messages);
  if (turns.length <= TURN_COMPACT_PRESERVE_TURNS) return null;

  // Split: compact early turns, preserve recent ones
  const compactCount = turns.length - TURN_COMPACT_PRESERVE_TURNS;
  const earlyTurns = turns.slice(0, compactCount);

  // Collect all messages that belong to early turns
  const earlyMsgIds = new Set<string>();
  for (const t of earlyTurns) {
    earlyMsgIds.add(t.user.id);
    earlyMsgIds.add(t.assistant.id);
  }
  const earlyMessages = session.messages.filter((m) => earlyMsgIds.has(m.id));

  // Build summary
  const latestVersion =
    session.compactedSummaries.length > 0
      ? Math.max(...session.compactedSummaries.map((s) => s.version))
      : 0;
  const summary = buildCompactedSummary(
    earlyMessages,
    session.terminalTabId,
    cli,
    latestVersion
  );

  // Create boundary marker message
  const boundaryMsg: ChatMessage = {
    id: compactId("boundary"),
    role: "system",
    cliId: null,
    timestamp: nowIso(),
    content: `[Context compacted — ${compactCount} turns summarised. See compacted summary for prior context.]`,
    isStreaming: false,
    durationMs: null,
    exitCode: null,
  };

  // Keep: system messages before first turn + boundary + preserved messages
  const preservedMessages = session.messages.filter((m) => !earlyMsgIds.has(m.id));
  // Put boundary right before the preserved messages (after any leading system msgs)
  const leadingSystem = preservedMessages.filter(
    (m) => m.role === "system" && m.timestamp <= (earlyTurns[0]?.user.timestamp ?? "")
  );
  const rest = preservedMessages.filter((m) => !leadingSystem.includes(m));
  const newMessages = [...leadingSystem, boundaryMsg, ...rest];

  const newSummaries = [...session.compactedSummaries, summary];
  const newTokens = newMessages.reduce((s, m) => s + estimateMessageTokens(m), 0) +
    newSummaries.reduce((s, cs) => s + cs.tokenEstimate, 0);

  return {
    messages: newMessages,
    compactedSummaries: newSummaries,
    lastCompactedAt: nowIso(),
    estimatedTokens: newTokens,
  };
}

/**
 * Full session compaction — emergency mode.
 * Summarises *all* history into one summary, keeps only the most recent turns.
 */
export function fullCompact(session: ConversationSession, cli: AgentId): {
  messages: ChatMessage[];
  compactedSummaries: CompactedSummary[];
  lastCompactedAt: string;
  estimatedTokens: number;
} | null {
  const tokens = estimateSessionTokens(session);
  if (tokens < FULL_COMPACT_THRESHOLD) return null;

  // Merge all existing summaries + all messages into one big summary
  const latestVersion =
    session.compactedSummaries.length > 0
      ? Math.max(...session.compactedSummaries.map((s) => s.version))
      : 0;

  const fullSummary = buildCompactedSummary(
    session.messages,
    session.terminalTabId,
    cli,
    latestVersion
  );

  // Merge intent from prior summaries
  if (session.compactedSummaries.length > 0) {
    const priorIntents = session.compactedSummaries.map((s) => s.intent).filter(Boolean);
    if (priorIntents.length > 0) {
      fullSummary.intent = [...priorIntents, fullSummary.intent].join(" → ");
    }
    // Merge changed files
    const allFiles = new Set<string>();
    for (const s of session.compactedSummaries) {
      for (const f of s.changedFiles) allFiles.add(f);
    }
    for (const f of fullSummary.changedFiles) allFiles.add(f);
    fullSummary.changedFiles = [...allFiles];
  }

  fullSummary.tokenEstimate = estimateTokens(compactedSummaryToText(fullSummary));

  // Keep only recent turns
  const turns = groupIntoTurns(session.messages);
  const preservedTurns = turns.slice(-FULL_COMPACT_PRESERVE_TURNS);
  const preservedIds = new Set<string>();
  for (const t of preservedTurns) {
    preservedIds.add(t.user.id);
    preservedIds.add(t.assistant.id);
  }

  const boundaryMsg: ChatMessage = {
    id: compactId("fullboundary"),
    role: "system",
    cliId: null,
    timestamp: nowIso(),
    content: `[Full context compaction — entire history summarised. ${session.messages.length} messages compressed.]`,
    isStreaming: false,
    durationMs: null,
    exitCode: null,
  };

  const keptMessages = session.messages.filter((m) => preservedIds.has(m.id));
  const newMessages = [boundaryMsg, ...keptMessages];
  const newSummaries = [fullSummary]; // replace all prior summaries with one

  const newTokens = newMessages.reduce((s, m) => s + estimateMessageTokens(m), 0) +
    fullSummary.tokenEstimate;

  return {
    messages: newMessages,
    compactedSummaries: newSummaries,
    lastCompactedAt: nowIso(),
    estimatedTokens: newTokens,
  };
}

/**
 * Run all applicable compaction layers on a session.
 * Returns null if no compaction was needed.
 */
export function autoCompact(session: ConversationSession, cli: AgentId): {
  messages: ChatMessage[];
  compactedSummaries: CompactedSummary[];
  lastCompactedAt: string;
  estimatedTokens: number;
} | null {
  // Try full compact first (highest priority)
  const full = fullCompact(session, cli);
  if (full) {
    // Apply micro-compact on the result
    full.messages = microCompact(full.messages);
    return full;
  }

  // Try turn compact
  const turn = turnCompact(session, cli);
  if (turn) {
    turn.messages = microCompact(turn.messages);
    return turn;
  }

  // Try micro-compact alone
  const micro = microCompact(session.messages);
  if (micro !== session.messages) {
    return {
      messages: micro,
      compactedSummaries: session.compactedSummaries,
      lastCompactedAt: session.lastCompactedAt ?? nowIso(),
      estimatedTokens: estimateSessionTokens({ ...session, messages: micro }),
    };
  }

  return null;
}

// ── Cross-Tab Context ────────────────────────────────────────────────

/**
 * Build a SharedContextEntry from a session + its tab.
 * Called after each assistant message finalize.
 */
export function buildSharedContextEntry(
  session: ConversationSession,
  tab: TerminalTab,
  cli: AgentId
): SharedContextEntry | null {
  // Need at least one completed turn
  const turns = groupIntoTurns(session.messages);
  if (turns.length === 0) return null;

  const summary = buildCompactedSummary(
    session.messages,
    session.terminalTabId,
    cli
  );

  return {
    id: `sce_${session.terminalTabId}`,
    sourceTabId: session.terminalTabId,
    sourceTabTitle: tab.title,
    sourceCli: cli,
    summary,
    updatedAt: nowIso(),
  };
}

/**
 * Format cross-tab context entries for prompt injection.
 */
export function formatCrossTabContext(entries: SharedContextEntry[]): string {
  if (entries.length === 0) return "";

  const limited = entries.slice(0, CROSS_TAB_MAX_ENTRIES);
  const blocks = limited.map((entry) => {
    const ago = formatRelativeTime(entry.updatedAt);
    const lines: string[] = [];
    lines.push(`[Tab "${entry.sourceTabTitle}" (${entry.sourceCli}, ${ago})]`);

    const s = entry.summary;
    if (s.intent) lines.push(`Intent: ${truncate(s.intent, 300)}`);
    if (s.changedFiles.length > 0)
      lines.push(`Changed: ${s.changedFiles.slice(0, 10).join(", ")}`);
    if (s.currentState) lines.push(`State: ${truncate(s.currentState, 300)}`);

    return lines.join("\n");
  });

  return `<cross-tab-context>\n${blocks.join("\n\n")}\n</cross-tab-context>`;
}

/**
 * Format compacted summaries for prompt injection.
 */
export function formatCompactedSummaries(summaries: CompactedSummary[]): string {
  if (summaries.length === 0) return "";

  const blocks = summaries.map((s, i) => {
    return `[Compacted segment ${i + 1} (v${s.version})]\n${compactedSummaryToText(s)}`;
  });

  return `<compacted-history>\n${blocks.join("\n\n")}\n</compacted-history>`;
}

// ── Utilities ────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "...";
}

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
