/**
 * compaction.ts — Multi-layer conversation compaction for multi-cli-studio.
 *
 * Three compression layers (inspired by Claude Code):
 *   1. Micro-compact  — truncate rawContent of old messages in-place
 *   2. Turn-compact   — summarise early turns into a CompactedSummary
 *   3. Full-compact   — emergency: summarise everything, keep only recent turns
 *
 * Plus cross-tab context helpers, working memory, and handoff document generation.
 */

import type {
  AgentId,
  ChatMessage,
  ChatMessageBlock,
  ChatContextTurn,
  TerminalCliContextBoundary,
  CompactedSummary,
  ConversationSession,
  HandoffDocument,
  SharedContextEntry,
  TerminalTab,
  WorkingMemory,
} from "./models";
import { summarizeForContext } from "./messageFormatting";
import {
  CONTEXT_TURNS_BUDGET_BY_CLI,
  CONTEXT_TURNS_MAX_BUDGET,
  CONTEXT_TURNS_MAX_COUNT,
  CONTEXT_TURNS_MIN_COUNT,
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
    if (s.intent) lines.push(`Intent: ${truncate(s.intent, 240)}`);
    if (s.changedFiles.length > 0)
      lines.push(`Changed: ${s.changedFiles.slice(0, 6).join(", ")}`);
    if (s.currentState) lines.push(`State: ${truncate(s.currentState, 240)}`);

    return truncate(lines.join("\n"), CROSS_TAB_SUMMARY_MAX_CHARS);
  });

  return `<cross-tab-context>\n${blocks.join("\n\n")}\n</cross-tab-context>`;
}

/**
 * Format compacted summaries for prompt injection.
 */
export function formatCompactedSummaries(summaries: CompactedSummary[]): string {
  if (summaries.length === 0) return "";

  const limited = summaries.slice(0, 2);
  const blocks = limited.map((s, i) => {
    const lines: string[] = [`[Compacted segment ${i + 1} (v${s.version})]`];
    if (s.intent) lines.push(`Intent: ${truncate(s.intent, 220)}`);
    if (s.changedFiles.length > 0) lines.push(`Changed files: ${s.changedFiles.slice(0, 8).join(", ")}`);
    if (s.currentState) lines.push(`State: ${truncate(s.currentState, 260)}`);
    if (s.nextSteps) lines.push(`Next steps: ${truncate(s.nextSteps, 200)}`);
    return lines.join("\n");
  });

  return `<compacted-history>\n${blocks.join("\n\n")}\n</compacted-history>`;
}

// ── Working Memory ───────────────────────────────────────────────────

/**
 * Build a live WorkingMemory snapshot from a conversation session.
 * Scans all messages to extract structured project state.
 */
export function buildWorkingMemory(
  messages: ChatMessage[],
  existingMemory?: WorkingMemory | null
): WorkingMemory {
  const modifiedFiles = new Set<string>(existingMemory?.modifiedFiles ?? []);
  const activeErrors: string[] = [];
  const recentCommands: string[] = [];
  const keyDecisions = new Set<string>(existingMemory?.keyDecisions ?? []);
  const contributingClis = new Set<AgentId>(existingMemory?.contributingClis ?? []);
  let buildStatus: WorkingMemory["buildStatus"] = existingMemory?.buildStatus ?? "unknown";

  for (const msg of messages) {
    if (msg.cliId) contributingClis.add(msg.cliId);
    if (!msg.blocks) continue;

    for (const block of msg.blocks) {
      if (block.kind === "fileChange") {
        modifiedFiles.add(block.path);
      }
      if (block.kind === "command") {
        recentCommands.push(block.command);
        if (block.exitCode != null && block.exitCode !== 0) {
          activeErrors.push(`${block.command}: exit ${block.exitCode}`);
          // A failing command involving build/test/check keywords
          if (/\b(build|compile|test|check|lint)\b/i.test(block.command)) {
            buildStatus = "failing";
          }
        } else if (block.exitCode === 0 && /\b(build|compile|test|check|lint)\b/i.test(block.command)) {
          buildStatus = "passing";
        }
      }
      if (block.kind === "status" && block.level === "error") {
        activeErrors.push(block.text.slice(0, 200));
      }
    }
  }

  // Keep only the most recent errors (resolved ones may be stale)
  const latestErrors = activeErrors.slice(-8);

  return {
    modifiedFiles: [...modifiedFiles].slice(-30),
    activeErrors: latestErrors,
    recentCommands: recentCommands.slice(-10),
    buildStatus,
    keyDecisions: [...keyDecisions].slice(-10),
    contributingClis: [...contributingClis],
    updatedAt: nowIso(),
  };
}

/**
 * Format working memory as a prompt-injectable block.
 */
export function formatWorkingMemory(wm: WorkingMemory): string {
  const lines: string[] = [];
  if (wm.modifiedFiles.length > 0)
    lines.push(`Modified files: ${wm.modifiedFiles.join(", ")}`);
  if (wm.activeErrors.length > 0)
    lines.push(`Active errors:\n${wm.activeErrors.map((e) => `  - ${e}`).join("\n")}`);
  if (wm.recentCommands.length > 0)
    lines.push(`Recent commands: ${wm.recentCommands.slice(-5).join(", ")}`);
  if (wm.buildStatus !== "unknown")
    lines.push(`Build status: ${wm.buildStatus}`);
  if (wm.keyDecisions.length > 0)
    lines.push(`Key decisions:\n${wm.keyDecisions.map((d) => `  - ${d}`).join("\n")}`);
  if (wm.contributingClis.length > 0)
    lines.push(`Contributing CLIs: ${wm.contributingClis.join(", ")}`);

  if (lines.length === 0) return "";
  return `<working-memory>\n${lines.join("\n")}\n</working-memory>`;
}

type ScoredTurn = {
  turn: ChatContextTurn;
  tokens: number;
  score: number;
  recencyRank: number;
};

export interface WorkingMemoryDelta {
  modifiedFiles: string[];
  activeErrors: string[];
  recentCommands: string[];
  keyDecisions: string[];
  buildStatusChanged: boolean;
  buildStatus: WorkingMemory["buildStatus"];
  contributingClis: AgentId[];
  updatedAt: string;
}

export function diffWorkingMemory(
  previous: WorkingMemory | null | undefined,
  current: WorkingMemory
): WorkingMemoryDelta | null {
  if (!previous) {
    return {
      modifiedFiles: current.modifiedFiles,
      activeErrors: current.activeErrors,
      recentCommands: current.recentCommands,
      keyDecisions: current.keyDecisions,
      buildStatusChanged: current.buildStatus !== "unknown",
      buildStatus: current.buildStatus,
      contributingClis: current.contributingClis,
      updatedAt: current.updatedAt,
    };
  }

  const previousModifiedFiles = new Set(previous.modifiedFiles);
  const previousErrors = new Set(previous.activeErrors);
  const previousCommands = new Set(previous.recentCommands);
  const previousDecisions = new Set(previous.keyDecisions);
  const previousClis = new Set(previous.contributingClis);

  const delta: WorkingMemoryDelta = {
    modifiedFiles: current.modifiedFiles.filter((file) => !previousModifiedFiles.has(file)),
    activeErrors: current.activeErrors.filter((error) => !previousErrors.has(error)),
    recentCommands: current.recentCommands.filter((command) => !previousCommands.has(command)),
    keyDecisions: current.keyDecisions.filter((decision) => !previousDecisions.has(decision)),
    buildStatusChanged: previous.buildStatus !== current.buildStatus,
    buildStatus: current.buildStatus,
    contributingClis: current.contributingClis.filter((cli) => !previousClis.has(cli)),
    updatedAt: current.updatedAt,
  };

  return delta.modifiedFiles.length > 0 ||
    delta.activeErrors.length > 0 ||
    delta.recentCommands.length > 0 ||
    delta.keyDecisions.length > 0 ||
    delta.buildStatusChanged ||
    delta.contributingClis.length > 0
    ? delta
    : null;
}

function formatWorkingMemoryDelta(delta: WorkingMemoryDelta): string {
  const lines: string[] = [];
  if (delta.modifiedFiles.length > 0) {
    lines.push(`Modified files since last session: ${delta.modifiedFiles.join(", ")}`);
  }
  if (delta.activeErrors.length > 0) {
    lines.push(`New active errors:\n${delta.activeErrors.map((entry) => `  - ${entry}`).join("\n")}`);
  }
  if (delta.recentCommands.length > 0) {
    lines.push(`New commands: ${delta.recentCommands.join(", ")}`);
  }
  if (delta.keyDecisions.length > 0) {
    lines.push(`New decisions:\n${delta.keyDecisions.map((entry) => `  - ${entry}`).join("\n")}`);
  }
  if (delta.buildStatusChanged) {
    lines.push(`Build status changed to: ${delta.buildStatus}`);
  }
  if (delta.contributingClis.length > 0) {
    lines.push(`Other contributing CLIs: ${delta.contributingClis.join(", ")}`);
  }
  return lines.length > 0
    ? `<working-memory-delta>\n${lines.join("\n")}\n</working-memory-delta>`
    : "";
}

// ── Handoff Document ─────────────────────────────────────────────────

/**
 * Build a token-budget-aware list of recent turns for context injection.
 * Unlike the fixed-limit version, this fits as many turns as the budget allows.
 */
export function buildDynamicContextTurns(
  messages: ChatMessage[],
  fallbackCli: AgentId,
  targetCli?: AgentId
): ChatContextTurn[] {
  const rawTurns: ScoredTurn[] = [];
  let pendingUser: ChatMessage | null = null;
  const budget = CONTEXT_TURNS_BUDGET_BY_CLI[targetCli ?? fallbackCli] ?? CONTEXT_TURNS_MAX_BUDGET;
  let assistantRecencyCounter = 0;

  for (const message of messages) {
    if (message.role === "user") {
      pendingUser = message;
      continue;
    }
    if (
      message.role !== "assistant" ||
      message.isStreaming ||
      !pendingUser
    ) {
      continue;
    }

    const failed = message.exitCode != null && message.exitCode !== 0;
    const userContent = pendingUser.rawContent ?? pendingUser.content;
    const assistantContent = message.rawContent ?? message.content;
    const summaryLimit = failed ? 1500 : 3000;
    const replyText = summarizeForContext(assistantContent, summaryLimit);
    const turn: ChatContextTurn = {
      cliId: (message.cliId ?? fallbackCli) as AgentId,
      userPrompt: userContent,
      assistantReply: failed ? `[FAILED exit=${message.exitCode}] ${replyText}` : replyText,
      timestamp: message.timestamp,
    };
    const tokens = estimateTokens(userContent) + estimateTokens(turn.assistantReply) + 8;
    const hasFileChanges = Boolean(
      message.blocks?.some((block) => block.kind === "fileChange")
    );
    const hasCommand = Boolean(
      message.blocks?.some((block) => block.kind === "command" || block.kind === "tool")
    );
    const hasErrorStatus = Boolean(
      message.blocks?.some((block) => block.kind === "status" && block.level === "error")
    );
    const normalizedReply = turn.assistantReply.toLowerCase();
    const hasDecisionCue =
      /(root cause|decision|resolved|fixed|changed|updated|recommend|next step|结论|原因|修复|建议|下一步)/i
        .test(turn.assistantReply);
    const looksLowSignal =
      normalizedReply.length < 120 &&
      !failed &&
      !hasFileChanges &&
      !hasCommand &&
      !hasErrorStatus &&
      !hasDecisionCue;
    const foreignCli = turn.cliId !== (targetCli ?? fallbackCli);
    const recencyRank = assistantRecencyCounter;
    assistantRecencyCounter += 1;
    const recencyBonus = recencyRank < 3 ? 3 : recencyRank < 6 ? 1.5 : 0;
    const rawScore =
      (foreignCli ? 4 : -3) +
      (failed || hasErrorStatus ? 4 : 0) +
      (hasFileChanges ? 3 : 0) +
      (hasCommand ? 2 : 0) +
      (hasDecisionCue ? 2 : 0) +
      recencyBonus +
      (looksLowSignal ? -4 : 0);
    const score = rawScore / Math.max(tokens, 1);
    rawTurns.push({ turn, tokens, score, recencyRank });
    pendingUser = null;
  }

  if (rawTurns.length === 0) return [];

  const selected = new Set<number>();
  const latestIndex = rawTurns.length - 1;
  selected.add(latestIndex);
  let used = rawTurns[latestIndex]?.tokens ?? 0;

  const rankedCandidates = rawTurns
    .map((candidate, index) => ({ ...candidate, index }))
    .filter((candidate) => candidate.index !== latestIndex)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.recencyRank - right.recencyRank;
    });

  for (const candidate of rankedCandidates) {
    if (selected.size >= CONTEXT_TURNS_MAX_COUNT) break;
    if (selected.size >= CONTEXT_TURNS_MIN_COUNT && used + candidate.tokens > budget) {
      continue;
    }
    selected.add(candidate.index);
    used += candidate.tokens;
  }

  return rawTurns
    .filter((_, index) => selected.has(index))
    .map((candidate) => candidate.turn);
}

/**
 * Build a structured handoff document when switching CLIs.
 * This provides deep context to the incoming CLI, far beyond a simple summary.
 */
export function buildHandoffDocument(
  session: ConversationSession,
  fromCli: AgentId,
  toCli: AgentId,
  crossTabEntries: SharedContextEntry[]
): HandoffDocument {
  const recentTurns = buildDynamicContextTurns(session.messages, fromCli, toCli);

  const workingMemory = buildWorkingMemory(session.messages);

  // Extract high-confidence facts from messages (heuristic: error resolutions, key findings)
  const kernelFacts: string[] = [];
  for (const msg of session.messages) {
    if (msg.role !== "assistant" || !msg.blocks) continue;
    for (const block of msg.blocks) {
      if (block.kind === "status" && block.level === "error") {
        kernelFacts.push(`Error: ${block.text.slice(0, 200)}`);
      }
      if (block.kind === "fileChange") {
        kernelFacts.push(`${block.changeType}: ${block.path}`);
      }
    }
  }

  return {
    fromCli,
    toCli,
    recentTurns,
    workingMemory,
    kernelFacts: kernelFacts.slice(-20),
    compactedSummaries: session.compactedSummaries,
    crossTabEntries,
    timestamp: nowIso(),
  };
}

function findBoundaryStartIndex(
  messages: ChatMessage[],
  boundary: TerminalCliContextBoundary | null | undefined
): number {
  if (!boundary) return 0;
  if (boundary.lastSeenMessageId) {
    const index = messages.findIndex((message) => message.id === boundary.lastSeenMessageId);
    if (index >= 0) return index + 1;
  }
  if (boundary.lastSeenAt) {
    const boundaryTime = Date.parse(boundary.lastSeenAt);
    if (Number.isFinite(boundaryTime)) {
      const index = messages.findIndex((message) => Date.parse(message.timestamp) > boundaryTime);
      if (index >= 0) return index;
    }
  }
  return 0;
}

export function buildDeltaHandoffDocument(
  session: ConversationSession,
  targetCli: AgentId,
  boundary: TerminalCliContextBoundary | null | undefined,
  crossTabEntries: SharedContextEntry[]
) {
  const startIndex = findBoundaryStartIndex(session.messages, boundary);
  const incrementalMessages = session.messages
    .slice(startIndex)
    .filter((message) => message.role !== "system" && message.cliId && message.cliId !== targetCli);
  const recentTurns = buildDynamicContextTurns(incrementalMessages, targetCli, targetCli);
  const compactedSummaries = session.compactedSummaries.filter((summary) => {
    if (summary.sourceCli === targetCli) return false;
    if (boundary?.lastCompactedSummaryVersion == null) return true;
    return summary.version > boundary.lastCompactedSummaryVersion;
  });
  const crossTabDelta = crossTabEntries.filter((entry) => {
    if (entry.sourceCli === targetCli) return false;
    if (!boundary?.lastSeenAt) return true;
    return Date.parse(entry.updatedAt) > Date.parse(boundary.lastSeenAt);
  });
  const hasExternalChanges =
    recentTurns.length > 0 ||
    compactedSummaries.length > 0 ||
    crossTabDelta.length > 0;
  if (!hasExternalChanges) {
    return null;
  }
  const currentWorkingMemory = buildWorkingMemory(session.messages);
  const workingMemoryDelta = diffWorkingMemory(boundary?.workingMemorySnapshot, currentWorkingMemory);

  const hasDelta = hasExternalChanges || Boolean(workingMemoryDelta);

  return hasDelta
    ? {
        targetCli,
        summary: buildDeltaSummary(
          targetCli,
          recentTurns,
          compactedSummaries,
          crossTabDelta,
          workingMemoryDelta
        ),
        recentTurns,
        compactedSummaries: compactedSummaries.slice(0, 2),
        crossTabEntries: crossTabDelta.slice(0, CROSS_TAB_MAX_ENTRIES),
        workingMemoryDelta,
        timestamp: nowIso(),
      }
    : null;
}

function buildDeltaSummary(
  targetCli: AgentId,
  recentTurns: ChatContextTurn[],
  compactedSummaries: CompactedSummary[],
  crossTabEntries: SharedContextEntry[],
  workingMemoryDelta: WorkingMemoryDelta | null
) {
  const lines: string[] = [`Updates since ${targetCli} was last active:`];
  if (workingMemoryDelta?.modifiedFiles.length) {
    lines.push(`- Files changed: ${workingMemoryDelta.modifiedFiles.slice(0, 6).join(", ")}`);
  }
  if (workingMemoryDelta?.activeErrors.length) {
    lines.push(`- New errors: ${workingMemoryDelta.activeErrors.slice(0, 2).join(" | ")}`);
  }
  if (workingMemoryDelta?.buildStatusChanged) {
    lines.push(`- Build status is now ${workingMemoryDelta.buildStatus}`);
  }
  if (workingMemoryDelta?.keyDecisions.length) {
    lines.push(`- New decisions: ${workingMemoryDelta.keyDecisions.slice(0, 2).join(" | ")}`);
  }
  if (recentTurns.length) {
    const latestForeignTurn = recentTurns[recentTurns.length - 1];
    if (latestForeignTurn) {
      lines.push(
        `- Latest ${latestForeignTurn.cliId} turn: ${truncate(latestForeignTurn.assistantReply, 220)}`
      );
    }
  }
  if (compactedSummaries.length) {
    const latestSummary = compactedSummaries[compactedSummaries.length - 1];
    if (latestSummary?.currentState) {
      lines.push(`- Summary state: ${truncate(latestSummary.currentState, 220)}`);
    }
  }
  if (crossTabEntries.length) {
    lines.push(`- Related workspace tabs updated: ${crossTabEntries.slice(0, 2).map((entry) => entry.sourceTabTitle).join(", ")}`);
  }
  return lines.slice(0, 6).join("\n");
}

export function formatDeltaHandoffDocument(
  doc: ReturnType<typeof buildDeltaHandoffDocument>
): string {
  if (!doc) return "";

  const sections: string[] = [`[Context sync for ${doc.targetCli}]`];
  if (doc.summary) {
    sections.push(`<delta-summary>\n${doc.summary}\n</delta-summary>`);
  }

  const workingMemoryText = doc.workingMemoryDelta
    ? formatWorkingMemoryDelta(doc.workingMemoryDelta)
    : "";
  if (workingMemoryText) sections.push(workingMemoryText);

  if (doc.recentTurns.length > 0) {
    const turnLines = doc.recentTurns.map((turn) => {
      const ago = formatRelativeTime(turn.timestamp);
      return `[${turn.cliId}, ${ago}] User: ${truncate(turn.userPrompt, 400)}\nAssistant: ${truncate(turn.assistantReply, 800)}`;
    });
    sections.push(
      `<recent-updates count="${doc.recentTurns.length}">\n${turnLines.join("\n\n")}\n</recent-updates>`
    );
  }

  if (doc.compactedSummaries.length > 0) {
    sections.push(formatCompactedSummaries(doc.compactedSummaries));
  }

  if (doc.crossTabEntries.length > 0) {
    sections.push(formatCrossTabContext(doc.crossTabEntries));
  }

  return `<handoff-delta>\n${sections.join("\n\n")}\n</handoff-delta>`;
}

/**
 * Format a HandoffDocument as a prompt-injectable block.
 */
export function formatHandoffDocument(doc: HandoffDocument): string {
  const sections: string[] = [];

  sections.push(`[CLI Handoff: ${doc.fromCli} → ${doc.toCli}]`);

  // Working memory
  const wmText = formatWorkingMemory(doc.workingMemory);
  if (wmText) sections.push(wmText);

  // Kernel facts
  if (doc.kernelFacts.length > 0) {
    sections.push(
      `<kernel-facts>\n${doc.kernelFacts.map((f) => `- ${f}`).join("\n")}\n</kernel-facts>`
    );
  }

  // Recent turns with CLI attribution
  if (doc.recentTurns.length > 0) {
    const turnLines = doc.recentTurns.map((t) => {
      const ago = formatRelativeTime(t.timestamp);
      return `[${t.cliId}, ${ago}] User: ${truncate(t.userPrompt, 600)}\nAssistant: ${truncate(t.assistantReply, 1200)}`;
    });
    sections.push(
      `<recent-conversation count="${doc.recentTurns.length}">\n${turnLines.join("\n\n")}\n</recent-conversation>`
    );
  }

  // Compacted summaries
  if (doc.compactedSummaries.length > 0) {
    sections.push(formatCompactedSummaries(doc.compactedSummaries));
  }

  if (doc.crossTabEntries.length > 0) {
    const crossTabLines = doc.crossTabEntries.map((entry) => {
      const parts = [
        `[Tab "${entry.sourceTabTitle}" (${entry.sourceCli}, ${formatRelativeTime(entry.updatedAt)})]`,
      ];
      if (entry.summary.intent) parts.push(`Intent: ${truncate(entry.summary.intent, 400)}`);
      if (entry.summary.technicalContext) {
        parts.push(`Context: ${truncate(entry.summary.technicalContext, 500)}`);
      }
      if (entry.summary.changedFiles.length > 0) {
        parts.push(`Changed: ${entry.summary.changedFiles.slice(0, 20).join(", ")}`);
      }
      if (entry.summary.currentState) {
        parts.push(`State: ${truncate(entry.summary.currentState, 500)}`);
      }
      if (entry.summary.nextSteps) {
        parts.push(`Next steps: ${truncate(entry.summary.nextSteps, 300)}`);
      }
      return parts.join("\n");
    });
    sections.push(
      `<cross-tab-context count="${doc.crossTabEntries.length}">\n${crossTabLines.join("\n\n")}\n</cross-tab-context>`
    );
  }

  // Semantic recall context (FTS5-based, Mem0-inspired)
  if (doc.semanticContext && doc.semanticContext.length > 0) {
    const semanticLines = doc.semanticContext.map((chunk) => {
      return `[${chunk.cliId}/${chunk.chunkType}] ${truncate(chunk.content, 400)}`;
    });
    sections.push(
      `<semantic-memory count="${doc.semanticContext.length}">\n${semanticLines.join("\n")}\n</semantic-memory>`
    );
  }

  return `<handoff-context>\n${sections.join("\n\n")}\n</handoff-context>`;
}

// ── Recall Search ────────────────────────────────────────────────────

/**
 * Search conversation history for messages matching a query string.
 * Returns formatted results for display or context injection.
 */
export function recallSearch(
  session: ConversationSession,
  query: string,
  maxResults = 10
): string {
  const queryLower = query.toLowerCase();
  const matches: { msg: ChatMessage; score: number }[] = [];

  for (const msg of session.messages) {
    if (msg.role === "system") continue;
    const content = (msg.rawContent ?? msg.content).toLowerCase();
    if (!content.includes(queryLower)) continue;

    // Simple relevance: count occurrences + recency bonus
    const occurrences = content.split(queryLower).length - 1;
    const recencyMs = Date.now() - new Date(msg.timestamp).getTime();
    const recencyBonus = Math.max(0, 1 - recencyMs / (7 * 24 * 3600 * 1000));
    matches.push({ msg, score: occurrences + recencyBonus });
  }

  // Also search compacted summaries
  const summaryMatches: string[] = [];
  for (const s of session.compactedSummaries) {
    const text = compactedSummaryToText(s).toLowerCase();
    if (text.includes(queryLower)) {
      summaryMatches.push(`[Compacted v${s.version}, ${s.sourceCli}] ${truncate(compactedSummaryToText(s), 400)}`);
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const topMatches = matches.slice(0, maxResults);

  if (topMatches.length === 0 && summaryMatches.length === 0) {
    return `No results found for "${query}" in this conversation.`;
  }

  const lines: string[] = [`Recall results for "${query}":`];

  for (const { msg } of topMatches) {
    const cli = msg.cliId ?? "system";
    const role = msg.role;
    const ago = formatRelativeTime(msg.timestamp);
    const snippet = summarizeForContext(msg.rawContent ?? msg.content, 300);
    lines.push(`  [${cli}/${role}, ${ago}] ${snippet}`);
  }

  if (summaryMatches.length > 0) {
    lines.push("  --- From compacted history ---");
    lines.push(...summaryMatches.map((s) => `  ${s}`));
  }

  return lines.join("\n");
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
