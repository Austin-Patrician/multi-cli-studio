import { create } from "zustand";
import { bridge } from "./bridge";
import {
  AgentId,
  ChatAttachment,
  AgentTransportKind,
  AgentTransportSession,
  AutoRouteAction,
  AppSettings,
  AppState,
  AssistantApprovalDecision,
  ChatMessage,
  ChatMessageBlock,
  ChatContextTurn,
  CliSkillItem,
  ContextStore,
  ConversationSession,
  TerminalCliContextBoundary,
  FileMentionCandidate,
  GitPanelData,
  GitFileStatus,
  PersistedTerminalState,
  PickedChatAttachment,
  SelectedCustomAgent,
  SharedContextEntry,
  TerminalCliId,
  TerminalLine,
  TerminalTab,
  WorkspacePickResult,
  WorkspaceRef,
} from "./models";
import {
  autoCompact,
  buildDynamicContextTurns,
  buildHandoffDocument,
  buildSharedContextEntry,
  buildWorkingMemory,
  buildDeltaHandoffDocument,
  formatCrossTabContext,
  formatCompactedSummaries,
  formatDeltaHandoffDocument,
  formatHandoffDocument,
  recallSearch,
  diffWorkingMemory,
} from "./compaction";
import {
  buildPromptWithAttachments,
  cloneChatAttachments,
  createChatAttachment,
} from "./chatAttachments";
import {
  injectSelectedAgentPrompt,
  normalizeSelectedCustomAgent,
  resolveSelectedCustomAgent,
} from "./customAgents";
import { estimateSessionTokens } from "./tokenEstimation";
import { ACP_COMMANDS, AcpCliCapabilities, AcpCommand } from "./acp";
import {
  detectAssistantContentFormat,
  normalizeAssistantContent,
  summarizeForContext,
} from "./messageFormatting";
import { notifyTerminalCompletion, type TerminalCompletionNotice } from "./desktopNotifications";
import {
  loadWorkspaceFileIndex,
  searchWorkspaceFileIndex,
} from "./workspaceFileIndex";

const DEFAULT_PROCESS_TIMEOUT_MS = 300000;
const STREAM_RUNTIME_STALE_GRACE_MS = 10000;
const STREAM_RUNTIME_STALE_MIN_MS = 60000;
const STREAM_STALE_CHECK_MS = 3000;
const INTERRUPTED_STREAM_TEXT = "Response interrupted before completion. You can retry this prompt.";
const PARTIAL_STREAM_TEXT = "Streaming stopped before completion. This response may be partial.";
const UNSUPPORTED_IMAGE_ATTACHMENT_MESSAGE = "当前仅 Codex 支持图片附件，请切换到 Codex 后发送。";

type PersistenceScope = "terminalState" | "chatMessages";

interface QueuedChatMessage {
  text: string;
  attachments: ChatAttachment[];
  cliId: TerminalCliId;
  selectedAgent: SelectedCustomAgent | null;
  queuedAt: string;
}

interface SendChatMessageOptions {
  cliIdOverride?: TerminalCliId;
  attachmentsOverride?: ChatAttachment[] | null;
  selectedAgentOverride?: SelectedCustomAgent | null;
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function basename(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function samePath(left: string, right: string) {
  return left.replace(/\//g, "\\").toLowerCase() === right.replace(/\//g, "\\").toLowerCase();
}

function attachmentKey(attachment: ChatAttachment) {
  const normalizedSource = attachment.source.startsWith("data:")
    ? attachment.source
    : attachment.source.toLowerCase();
  return `${attachment.kind}:${normalizedSource}`;
}

function mergeChatAttachments(
  current: ChatAttachment[] | null | undefined,
  additions: ChatAttachment[] | null | undefined
) {
  const merged: ChatAttachment[] = [];
  const seen = new Set<string>();

  [...(current ?? []), ...(additions ?? [])].forEach((attachment) => {
    const key = attachmentKey(attachment);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(attachment);
  });

  return merged;
}

function hasImageAttachments(attachments: ChatAttachment[] | null | undefined) {
  return attachments?.some((attachment) => attachment.kind === "image") ?? false;
}

function defaultTransportKind(cliId: AgentId): AgentTransportKind {
  switch (cliId) {
    case "codex":
      return "codex-app-server";
    case "claude":
      return "claude-cli";
    case "gemini":
      return "gemini-acp";
    default:
      return "browser-fallback";
  }
}

function resolveTerminalCliId(
  cliId: TerminalCliId | undefined | null,
  fallback: AgentId
): AgentId {
  return cliId === "auto" || !cliId ? fallback : cliId;
}

function createCliSkillCacheKey(cliId: AgentId, workspaceId: string) {
  return `${cliId}:${workspaceId}`;
}

function createTransportSession(
  cliId: AgentId,
  partial?: Partial<AgentTransportSession>
): AgentTransportSession {
  return {
    cliId,
    kind: partial?.kind ?? defaultTransportKind(cliId),
    threadId: partial?.threadId ?? null,
    turnId: partial?.turnId ?? null,
    model: partial?.model ?? null,
    permissionMode: partial?.permissionMode ?? null,
    lastSyncAt: partial?.lastSyncAt ?? null,
  };
}

function invalidateTransportSession(
  cliId: AgentId,
  existing?: AgentTransportSession | null
): AgentTransportSession {
  return createTransportSession(cliId, {
    ...existing,
    threadId: null,
    turnId: null,
    lastSyncAt: null,
  });
}

function normalizeAutoRouteTarget(value: string): AgentId {
  if (value === "claude" || value === "gemini") return value;
  return "codex";
}

function inferAutoRoute(
  prompt: string
): { targetCli: AgentId; reason: string; modeHint: string | null } {
  const text = prompt.toLowerCase();

  const wantsUi =
    /(ui|design|layout|spacing|visual|style|landing page|page design|css|frontend)/.test(text);
  if (wantsUi) {
    return {
      targetCli: "gemini",
      reason: "UI and presentation work route best to Gemini.",
      modeHint: null,
    };
  }

  const wantsAnalysis =
    /(review|analy[sz]e|why|reason|root cause|compare|tradeoff|architecture|refactor plan|investigate)/.test(text);
  if (wantsAnalysis) {
    return {
      targetCli: "claude",
      reason: "Analysis, review, and architecture requests route best to Claude.",
      modeHint: "plan",
    };
  }

  return {
    targetCli: "codex",
    reason: "Implementation and code-change requests route best to Codex.",
    modeHint: "execute",
  };
}

function createWorkspaceRef(
  rootPath: string,
  partial?: Partial<WorkspaceRef>
): WorkspaceRef {
  const locationKind = partial?.locationKind ?? "local";
  return {
    id: partial?.id ?? createId("workspace"),
    name: partial?.name ?? basename(rootPath),
    rootPath,
    locationKind,
    connectionId: partial?.connectionId ?? null,
    remotePath: partial?.remotePath ?? (locationKind === "ssh" ? rootPath : null),
    locationLabel: partial?.locationLabel ?? null,
    branch: partial?.branch ?? "workspace",
    currentWriter: partial?.currentWriter ?? "codex",
    activeAgent: partial?.activeAgent ?? "codex",
    dirtyFiles: partial?.dirtyFiles ?? 0,
    failingChecks: partial?.failingChecks ?? 0,
    handoffReady: partial?.handoffReady ?? true,
    lastSnapshot: partial?.lastSnapshot ?? null,
  };
}

function createTerminalTab(
  workspace: WorkspaceRef,
  partial?: Partial<TerminalTab>
): TerminalTab {
  return {
    id: partial?.id ?? createId("tab"),
    title: partial?.title ?? workspace.name,
    workspaceId: workspace.id,
    selectedCli: partial?.selectedCli ?? workspace.activeAgent ?? workspace.currentWriter,
    selectedAgent: normalizeSelectedCustomAgent(partial?.selectedAgent) ?? null,
    planMode: partial?.planMode ?? false,
    fastMode: partial?.fastMode ?? false,
    effortLevel: partial?.effortLevel ?? null,
    modelOverrides: partial?.modelOverrides ?? {},
    permissionOverrides: partial?.permissionOverrides ?? {},
    transportSessions: normalizeTransportSessions(partial ?? {}),
    contextBoundariesByCli: normalizeContextBoundariesByCli(partial ?? {}),
    draftPrompt: partial?.draftPrompt ?? "",
    draftAttachments: cloneChatAttachments(partial?.draftAttachments) ?? [],
    status: partial?.status ?? "idle",
    lastActiveAt: partial?.lastActiveAt ?? nowIso(),
  };
}

function createCliContextBoundary(
  partial?: Partial<TerminalCliContextBoundary> | null
): TerminalCliContextBoundary {
  return {
    lastSeenMessageId: partial?.lastSeenMessageId ?? null,
    lastSeenAt: partial?.lastSeenAt ?? null,
    lastCompactedSummaryVersion: partial?.lastCompactedSummaryVersion ?? null,
    workingMemorySnapshot: partial?.workingMemorySnapshot ?? null,
  };
}

function createConversationSession(
  tab: TerminalTab,
  workspace: WorkspaceRef,
  partial?: Partial<ConversationSession>
): ConversationSession {
  return {
    id: partial?.id ?? createId("session"),
    terminalTabId: tab.id,
    workspaceId: workspace.id,
    projectRoot: workspace.rootPath,
    projectName: workspace.name,
    messages:
      partial?.messages ?? [
        {
          id: createId("msg"),
          role: "system",
          cliId: null,
          timestamp: nowIso(),
          content: `Session started for ${workspace.name}. Open a folder, choose a CLI, and send a prompt.`,
          transportKind: null,
          blocks: null,
          isStreaming: false,
          durationMs: null,
          exitCode: null,
        },
      ],
    compactedSummaries: partial?.compactedSummaries ?? [],
    lastCompactedAt: partial?.lastCompactedAt ?? null,
    estimatedTokens: partial?.estimatedTokens ?? 0,
    createdAt: partial?.createdAt ?? nowIso(),
    updatedAt: partial?.updatedAt ?? nowIso(),
  };
}

function normalizeConversationSession(
  tab: TerminalTab,
  workspace: WorkspaceRef | null | undefined,
  partial?: Partial<ConversationSession> | null
): ConversationSession {
  const resolvedWorkspace =
    workspace ??
    createWorkspaceRef(partial?.projectRoot ?? tab.workspaceId, {
      id: partial?.workspaceId ?? tab.workspaceId,
      name: partial?.projectName ?? tab.title,
      rootPath: partial?.projectRoot ?? tab.workspaceId,
    });

  return createConversationSession(tab, resolvedWorkspace, {
    ...partial,
    terminalTabId: tab.id,
    workspaceId: resolvedWorkspace.id,
    projectRoot: resolvedWorkspace.rootPath,
    projectName: resolvedWorkspace.name,
    compactedSummaries: partial?.compactedSummaries ?? [],
    lastCompactedAt: partial?.lastCompactedAt ?? null,
    estimatedTokens: partial?.estimatedTokens ?? 0,
  });
}

function nextClonedTabTitle(baseTitle: string, existingTitles: string[]) {
  const normalizedBase = baseTitle.replace(/\s·\s\d+$/, "");
  let nextIndex = 2;

  while (existingTitles.includes(`${normalizedBase} · ${nextIndex}`)) {
    nextIndex += 1;
  }

  return `${normalizedBase} · ${nextIndex}`;
}

function cloneChatBlocks(blocks: ChatMessageBlock[] | null | undefined) {
  if (!blocks) return blocks ?? null;
  return blocks.map((block) => ({ ...block }));
}

function cloneConversationMessages(messages: ChatMessage[]) {
  return messages
    .filter((message) => !message.isStreaming)
    .map<ChatMessage>((message) => ({
      ...message,
      id: createId("msg"),
      blocks: cloneChatBlocks(message.blocks),
      attachments: cloneChatAttachments(message.attachments),
      isStreaming: false,
    }));
}

type PersistableTerminalState = Pick<
  PersistedTerminalState,
  "workspaces" | "terminalTabs" | "activeTerminalTabId" | "chatSessions"
>;

let draftPromptPersistTimer: number | null = null;
let streamingRecoveryInterval: number | null = null;
let terminalStatePersistInFlight = false;
let queuedTerminalState: PersistedTerminalState | null = null;
let messagePersistenceInFlight = false;
const queuedMessagePersistence: Array<() => Promise<void>> = [];
const persistenceIssues = new Map<PersistenceScope, string>();
let persistenceIssueReporter: ((message: string | null) => void) | null = null;

function formatPersistenceError(scope: PersistenceScope, error: unknown) {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown persistence error";
  return `${scope === "terminalState" ? "Terminal state" : "Chat persistence"} failed: ${detail}`;
}

function updatePersistenceIssue(scope: PersistenceScope, error: unknown | null) {
  if (error == null) {
    persistenceIssues.delete(scope);
  } else {
    const message = formatPersistenceError(scope, error);
    persistenceIssues.set(scope, message);
    console.error(`[multi-cli-studio] ${message}`, error);
  }
  persistenceIssueReporter?.(
    persistenceIssues.size > 0 ? Array.from(persistenceIssues.values()).join(" | ") : null
  );
}

async function flushTerminalStatePersistence() {
  while (queuedTerminalState) {
    const snapshot = queuedTerminalState;
    queuedTerminalState = null;
    try {
      await bridge.saveTerminalState(snapshot);
      updatePersistenceIssue("terminalState", null);
    } catch (error) {
      updatePersistenceIssue("terminalState", error);
    }
  }
  terminalStatePersistInFlight = false;
}

async function flushMessagePersistenceQueue() {
  while (queuedMessagePersistence.length > 0) {
    const next = queuedMessagePersistence.shift();
    if (!next) continue;
    try {
      await next();
      updatePersistenceIssue("chatMessages", null);
    } catch (error) {
      updatePersistenceIssue("chatMessages", error);
    }
  }
  messagePersistenceInFlight = false;
}

function enqueueMessagePersistence(operation: () => Promise<void>) {
  queuedMessagePersistence.push(operation);
  if (messagePersistenceInFlight) return;
  messagePersistenceInFlight = true;
  void flushMessagePersistenceQueue();
}

function persistTerminalState(
  workspaces: WorkspaceRef[],
  terminalTabs: TerminalTab[],
  activeTerminalTabId: string | null,
  chatSessions: Record<string, ConversationSession>
) {
  queuedTerminalState = {
    workspaces,
    terminalTabs,
    activeTerminalTabId,
    chatSessions,
  };
  if (terminalStatePersistInFlight) return;
  terminalStatePersistInFlight = true;
  void flushTerminalStatePersistence();
}

function scheduleDraftPromptPersistence(getState: () => PersistableTerminalState) {
  if (typeof window === "undefined") return;
  if (draftPromptPersistTimer !== null) {
    window.clearTimeout(draftPromptPersistTimer);
  }
  draftPromptPersistTimer = window.setTimeout(() => {
    draftPromptPersistTimer = null;
    const state = getState();
    persistTerminalState(
      state.workspaces,
      state.terminalTabs,
      state.activeTerminalTabId,
      state.chatSessions
    );
  }, 180);
}

function hasStreamingActivity(
  terminalTabs: TerminalTab[],
  chatSessions: Record<string, ConversationSession>
) {
  return terminalTabs.some((tab) => {
    const session = chatSessions[tab.id];
    return tab.status === "streaming" || session?.messages.some((message) => message.isStreaming) === true;
  });
}

function getRuntimeStreamStaleTimeoutMs(settings: AppSettings | null) {
  const configuredTimeoutMs = settings?.processTimeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
  return Math.max(configuredTimeoutMs + STREAM_RUNTIME_STALE_GRACE_MS, STREAM_RUNTIME_STALE_MIN_MS);
}

function isStreamingSessionStale(
  session: ConversationSession,
  staleTimeoutMs: number,
  nowMs = Date.now()
) {
  const updatedAtMs = Date.parse(session.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return true;
  return nowMs - updatedAtMs >= staleTimeoutMs;
}

function recoverInterruptedAssistantMessage(message: ChatMessage): ChatMessage {
  const rawText = (message.rawContent ?? message.content).trim();
  const statusText = rawText ? PARTIAL_STREAM_TEXT : INTERRUPTED_STREAM_TEXT;
  const nextRawContent = rawText ? message.rawContent ?? message.content : statusText;
  const hasMatchingStatus =
    message.blocks?.some(
      (block) => block.kind === "status" && block.level === "warning" && block.text === statusText
    ) ?? false;

  return {
    ...message,
    rawContent: nextRawContent,
    content: normalizeAssistantContent(nextRawContent),
    contentFormat: rawText
      ? message.contentFormat ?? detectAssistantContentFormat(nextRawContent)
      : "log",
    blocks: hasMatchingStatus
      ? message.blocks ?? null
      : [
          ...(message.blocks ?? []),
          {
            kind: "status",
            level: "warning",
            text: statusText,
          } satisfies ChatMessageBlock,
        ],
    isStreaming: false,
    exitCode: message.exitCode ?? 1,
  };
}

function recoverStaleStreamingSessions(
  terminalTabs: TerminalTab[],
  chatSessions: Record<string, ConversationSession>,
  staleTimeoutMs: number,
  forceRecover = false,
  nowMs = Date.now()
) {
  const staleTabIds = new Set<string>();
  const nextChatSessions = { ...chatSessions };

  Object.entries(chatSessions).forEach(([tabId, session]) => {
    const tab = terminalTabs.find((item) => item.id === tabId) ?? null;
    const hasStreamingMessage = session.messages.some((message) => message.isStreaming);
    const isStreaming = tab?.status === "streaming" || hasStreamingMessage;
    if (!isStreaming) return;
    if (!forceRecover && !isStreamingSessionStale(session, staleTimeoutMs, nowMs)) return;

    staleTabIds.add(tabId);
    if (!hasStreamingMessage) return;

    nextChatSessions[tabId] = {
      ...session,
      messages: session.messages.map((message) =>
        message.isStreaming ? recoverInterruptedAssistantMessage(message) : message
      ),
      updatedAt: nowIso(),
    };
  });

  terminalTabs.forEach((tab) => {
    if (tab.status === "streaming" && !chatSessions[tab.id]) {
      staleTabIds.add(tab.id);
    }
  });

  if (staleTabIds.size === 0) {
    return {
      recovered: false,
      terminalTabs,
      chatSessions,
    };
  }

  return {
    recovered: true,
    terminalTabs: terminalTabs.map((tab) =>
      staleTabIds.has(tab.id) ? { ...tab, status: "idle" as const } : tab
    ),
    chatSessions: nextChatSessions,
  };
}

function stopStreamingRecoveryWatch() {
  if (typeof window === "undefined") return;
  if (streamingRecoveryInterval !== null) {
    window.clearInterval(streamingRecoveryInterval);
    streamingRecoveryInterval = null;
  }
}

function syncStreamingRecoveryWatch(
  getState: () => {
    workspaces: WorkspaceRef[];
    terminalTabs: TerminalTab[];
    activeTerminalTabId: string | null;
    chatSessions: Record<string, ConversationSession>;
    settings: AppSettings | null;
    busyAction: string | null;
  },
  applyRecovery: (
    terminalTabs: TerminalTab[],
    chatSessions: Record<string, ConversationSession>
  ) => void
) {
  if (typeof window === "undefined") return;

  const current = getState();
  if (!hasStreamingActivity(current.terminalTabs, current.chatSessions)) {
    stopStreamingRecoveryWatch();
    return;
  }

  if (streamingRecoveryInterval !== null) {
    return;
  }

  streamingRecoveryInterval = window.setInterval(() => {
    const state = getState();
    const recovered = recoverStaleStreamingSessions(
      state.terminalTabs,
      state.chatSessions,
      getRuntimeStreamStaleTimeoutMs(state.settings)
    );
    const nextTerminalTabs = recovered.recovered ? recovered.terminalTabs : state.terminalTabs;
    const nextChatSessions = recovered.recovered ? recovered.chatSessions : state.chatSessions;

    if (recovered.recovered) {
      applyRecovery(nextTerminalTabs, nextChatSessions);
      persistTerminalState(
        state.workspaces,
        nextTerminalTabs,
        state.activeTerminalTabId,
        nextChatSessions
      );
    }

    if (!hasStreamingActivity(nextTerminalTabs, nextChatSessions)) {
      stopStreamingRecoveryWatch();
    }
  }, STREAM_STALE_CHECK_MS);
}

function deriveActiveWorkspaceState(
  appState: AppState | null,
  workspaces: WorkspaceRef[],
  tabs: TerminalTab[],
  activeTabId: string | null
) {
  if (!appState) return null;
  const activeTab =
    tabs.find((tab) => tab.id === activeTabId) ??
    (tabs.length > 0 ? tabs[0] : null);
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeTab?.workspaceId) ??
    (workspaces.length > 0 ? workspaces[0] : null);

  if (!activeWorkspace) return appState;

  return {
    ...appState,
    workspace: {
      projectName: activeWorkspace.name,
      projectRoot: activeWorkspace.rootPath,
      branch: activeWorkspace.branch,
      currentWriter: activeWorkspace.currentWriter,
      activeAgent: resolveTerminalCliId(activeTab?.selectedCli, activeWorkspace.activeAgent),
      dirtyFiles: activeWorkspace.dirtyFiles,
      failingChecks: activeWorkspace.failingChecks,
      handoffReady: activeWorkspace.handoffReady,
      lastSnapshot: activeWorkspace.lastSnapshot ?? null,
    },
  };
}

function formatSlashHelp(cliId: AgentId) {
  return [
    "Available commands:",
    ...ACP_COMMANDS.map((cmd) => {
      const supported = cmd.supportedClis.includes(cliId) ? "" : " (not available)";
      return `  ${cmd.slash} ${cmd.argsHint ?? ""} - ${cmd.description}${supported}`;
    }),
  ].join("\n");
}

function formatDiffSummary(gitPanel?: GitPanelData | null) {
  if (!gitPanel || !gitPanel.isGitRepo) {
    return "This workspace is not a Git repository.";
  }
  if (gitPanel.recentChanges.length === 0) {
    return "No uncommitted changes detected.";
  }
  return gitPanel.recentChanges
    .map((change) => `${change.status.padEnd(8, " ")} ${change.path}`)
    .join("\n");
}

function normalizeTransportSessions(
  tab: Pick<TerminalTab, "selectedCli" | "transportSessions"> | Partial<TerminalTab>
) {
  const next = { ...(tab.transportSessions ?? {}) } as Partial<Record<AgentId, AgentTransportSession>>;
  const cliIds: AgentId[] = ["codex", "claude", "gemini"];
  cliIds.forEach((cliId) => {
    if (next[cliId]) {
      next[cliId] = createTransportSession(cliId, next[cliId] ?? undefined);
    }
  });
  return next;
}

function normalizeContextBoundariesByCli(
  tab: Pick<TerminalTab, "contextBoundariesByCli"> | Partial<TerminalTab>
) {
  const next = {
    ...(tab.contextBoundariesByCli ?? {}),
  } as Partial<Record<AgentId, TerminalCliContextBoundary>>;
  const cliIds: AgentId[] = ["codex", "claude", "gemini"];
  cliIds.forEach((cliId) => {
    if (next[cliId]) {
      next[cliId] = createCliContextBoundary(next[cliId] ?? undefined);
    }
  });
  return next;
}

function latestCompactedSummaryVersion(session: ConversationSession) {
  if (session.compactedSummaries.length === 0) return null;
  return Math.max(...session.compactedSummaries.map((summary) => summary.version));
}

function rebuildSharedContextMap(
  chatSessions: Record<string, ConversationSession>,
  terminalTabs: TerminalTab[],
  workspaces: WorkspaceRef[]
): Record<string, SharedContextEntry> {
  const sharedContext: Record<string, SharedContextEntry> = {};

  for (const tab of terminalTabs) {
    const session = chatSessions[tab.id];
    const workspace = workspaces.find((item) => item.id === tab.workspaceId);
    if (!session || !workspace) continue;

    const effectiveCli = resolveTerminalCliId(tab.selectedCli, workspace.activeAgent);
    const entry = buildSharedContextEntry(session, tab, effectiveCli);
    if (entry) {
      sharedContext[tab.id] = entry;
    }
  }

  return sharedContext;
}

function buildRecentTabContextTurns(
  messages: ChatMessage[],
  fallbackCli: AgentId,
  _limit?: number
): ChatContextTurn[] {
  // Delegate to token-budget-aware dynamic version with CLI-specific budget
  return buildDynamicContextTurns(messages, fallbackCli, fallbackCli);
}

function extractLatestTaskContext(
  messages: ChatMessage[],
  fallbackCli: AgentId
): {
  latestUserPrompt: string | null;
  latestAssistantSummary: string | null;
  relevantFiles: string[];
} {
  let latestUserPrompt: string | null = null;
  let latestAssistantSummary: string | null = null;
  let relevantFiles: string[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      !latestAssistantSummary &&
      message.role === "assistant" &&
      !message.isStreaming &&
      (!message.exitCode || message.exitCode === 0)
    ) {
      latestAssistantSummary = summarizeForContext(message.rawContent ?? message.content);
      relevantFiles =
        message.blocks
          ?.filter(
            (block): block is Extract<ChatMessageBlock, { kind: "fileChange" }> =>
              block.kind === "fileChange"
          )
          .map((block) => block.path) ?? [];

      for (let userIndex = index - 1; userIndex >= 0; userIndex -= 1) {
        const candidate = messages[userIndex];
        if (candidate.role === "user") {
          latestUserPrompt = candidate.rawContent ?? candidate.content;
          break;
        }
      }
      break;
    }
  }

  if (!latestUserPrompt) {
    const latestUser = [...messages].reverse().find((message) => message.role === "user");
    latestUserPrompt = latestUser?.rawContent ?? latestUser?.content ?? null;
  }

  return { latestUserPrompt, latestAssistantSummary, relevantFiles };
}

function shouldRequestSemanticRecallForHandoff(
  prompt: string,
  hasExistingSession: boolean,
  initialDeltaContext: string | null
) {
  if (!hasExistingSession) return true;
  if (!initialDeltaContext?.trim()) return true;
  return /(刚才|之前|上次|继续|那个问题|改到哪|where we left off|earlier|previous|continue|resume)/i.test(
    prompt
  );
}

function updateCliContextBoundary(
  tab: TerminalTab,
  cliId: AgentId,
  session: ConversationSession,
  messageId: string
) {
  const currentWorkingMemory = buildWorkingMemory(session.messages);
  return {
    ...normalizeContextBoundariesByCli(tab),
    [cliId]: createCliContextBoundary({
      lastSeenMessageId: messageId,
      lastSeenAt: session.updatedAt,
      lastCompactedSummaryVersion: latestCompactedSummaryVersion(session),
      workingMemorySnapshot: currentWorkingMemory,
    }),
  } satisfies Partial<Record<AgentId, TerminalCliContextBoundary>>;
}

function resolveStreamingAssistantMessageId(
  session: ConversationSession,
  messageId: string
) {
  const explicitMatch = session.messages.find((message) => message.id === messageId);
  if (explicitMatch) return messageId;

  const streamingAssistantMessages = session.messages.filter(
    (message) => message.role === "assistant" && message.isStreaming
  );

  if (streamingAssistantMessages.length === 1) {
    return streamingAssistantMessages[0].id;
  }

  return null;
}

function appendSystemMessageToSession(
  chatSessions: Record<string, ConversationSession>,
  tabId: string,
  cliId: AgentId,
  content: string,
  exitCode = 0
) {
  const session = chatSessions[tabId];
  if (!session) return chatSessions;

  return {
    ...chatSessions,
    [tabId]: {
      ...session,
      messages: [
        ...session.messages,
        {
          id: createId("msg"),
          role: "system" as const,
          cliId,
          timestamp: nowIso(),
          content,
          transportKind: defaultTransportKind(cliId),
          blocks: null,
          isStreaming: false,
          durationMs: null,
          exitCode,
        },
      ],
      updatedAt: nowIso(),
    },
  };
}

function toPersistedSessionSeed(
  session: ConversationSession,
  terminalTabId: string,
  messages: ChatMessage[]
) {
  return {
    terminalTabId,
    session,
    messages,
  };
}

function buildTerminalCompletionNotice(
  state: Pick<StoreState, "settings" | "terminalTabs" | "workspaces" | "chatSessions">,
  tabId: string,
  messageId: string,
  exitCode: number | null,
  durationMs: number,
  finalContent?: string | null
): TerminalCompletionNotice | null {
  if (!state.settings?.notifyOnTerminalCompletion) return null;

  const session = state.chatSessions[tabId];
  if (!session) return null;

  const targetMessageId = resolveStreamingAssistantMessageId(session, messageId);
  if (!targetMessageId) return null;

  const message = session.messages.find((item) => item.id === targetMessageId);
  const tab = state.terminalTabs.find((item) => item.id === tabId);
  const workspace = state.workspaces.find((item) => item.id === tab?.workspaceId);
  if (!message || message.role !== "assistant" || !tab || !workspace) return null;

  const fallbackCli = resolveTerminalCliId(tab.selectedCli, workspace.activeAgent);
  return {
    cliId: (message.cliId ?? fallbackCli) as AgentId,
    workspaceName: workspace.name || basename(workspace.rootPath),
    tabTitle: tab.title,
    exitCode,
    content: finalContent ?? message.rawContent ?? message.content,
    durationMs,
  };
}

interface StoreState {
  appState: AppState | null;
  contextStore: ContextStore | null;
  settings: AppSettings | null;
  busyAction: string | null;
  persistenceIssue: string | null;
  acpCapabilitiesByCli: Partial<Record<AgentId, AcpCliCapabilities>>;
  acpCapabilityStatusByCli: Partial<Record<AgentId, "idle" | "loading" | "ready" | "error">>;
  cliSkillsByContext: Record<string, CliSkillItem[]>;
  cliSkillStatusByContext: Record<string, "idle" | "loading" | "ready" | "error">;

  workspaces: WorkspaceRef[];
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;
  chatSessions: Record<string, ConversationSession>;
  gitPanelsByWorkspace: Record<string, GitPanelData>;
  gitCommitMessageByWorkspace: Record<string, string>;
  gitCommitLoadingByWorkspace: Record<string, boolean>;
  gitCommitErrorByWorkspace: Record<string, string | null>;
  gitWorkbenchOpen: boolean;
  sharedContext: Record<string, SharedContextEntry>;
  queuedChatByTab: Record<string, QueuedChatMessage>;

  loadInitialState: (projectRoot?: string) => Promise<void>;
  switchAgent: (agentId: AgentId) => Promise<void>;
  takeOverWriter: (agentId: AgentId) => Promise<void>;
  submitPrompt: (agentId: AgentId, prompt: string) => Promise<void>;
  requestReview: (agentId: AgentId) => Promise<void>;
  snapshotWorkspace: () => Promise<void>;
  runChecks: () => Promise<void>;
  loadContextStore: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;

  setAppState: (state: AppState) => void;
  appendTerminalLine: (agentId: AgentId, line: TerminalLine) => void;
  setBusyAction: (action: string | null) => void;
  appendChatSystemMessage: (tabId: string, cliId: AgentId, content: string, exitCode?: number) => void;
  deleteChatMessage: (tabId: string, messageId: string) => void;
  hydrateTerminalSession: (tabId: string) => Promise<void>;

  openWorkspaceFolder: () => Promise<void>;
  addRemoteWorkspace: (input: {
    name?: string;
    remotePath: string;
    connectionId: string;
    locationLabel?: string | null;
  }) => string | null;
  createTerminalTab: (workspaceId?: string) => void;
  cloneTerminalTab: (sourceTabId?: string) => void;
  reorderTerminalTabs: (sourceTabId: string, targetTabId: string) => void;
  closeTerminalTab: (tabId: string) => void;
  setActiveTerminalTab: (tabId: string) => void;
  setTabSelectedCli: (tabId: string, cliId: TerminalCliId) => void;
  setTabSelectedAgent: (tabId: string, agent: SelectedCustomAgent | null) => void;
  setTabDraftPrompt: (tabId: string, prompt: string) => void;
  addDraftChatAttachments: (
    tabId: string,
    workspaceRoot: string,
    picked: PickedChatAttachment[]
  ) => { added: number; rejected: number };
  removeDraftChatAttachment: (tabId: string, attachmentId: string) => void;
  togglePlanMode: (tabId?: string) => void;
  queueChatMessage: (
    tabId: string,
    prompt?: string,
    cliIdOverride?: TerminalCliId
  ) => "queued" | "full" | "empty" | "unavailable" | "unsupportedAttachments";
  clearQueuedChatMessage: (tabId: string) => void;
  editQueuedChatMessage: (tabId: string) => boolean;
  interruptChatTurn: (tabId?: string) => Promise<boolean>;

  sendChatMessage: (tabId: string, prompt?: string, options?: SendChatMessageOptions) => Promise<void>;
  respondAutoRoute: (tabId: string, action: AutoRouteAction) => Promise<void>;
  appendStreamChunk: (
    tabId: string,
    messageId: string,
    chunk: string,
    blocks?: ChatMessageBlock[] | null
  ) => void;
  finalizeStream: (
    tabId: string,
    messageId: string,
    exitCode: number | null,
    durationMs: number,
    finalContent?: string | null,
    contentFormat?: ChatMessage["contentFormat"],
    blocks?: ChatMessageBlock[] | null,
    transportSession?: AgentTransportSession | null,
    transportKind?: AgentTransportKind | null,
    interruptedByUser?: boolean | null
  ) => void;
  applyGitPanel: (workspaceId: string, gitPanel: GitPanelData) => void;
  loadGitPanel: (workspaceId: string, projectRoot: string) => Promise<void>;
  refreshGitPanel: (workspaceId?: string) => Promise<void>;
  setGitCommitMessage: (workspaceId: string, message: string) => void;
  stageGitFile: (workspaceId: string, path: string) => Promise<void>;
  unstageGitFile: (workspaceId: string, path: string) => Promise<void>;
  discardGitFile: (workspaceId: string, path: string) => Promise<void>;
  commitGitChanges: (workspaceId: string, options?: { stageAll?: boolean }) => Promise<void>;
  openGitWorkbench: () => void;
  closeGitWorkbench: () => void;
  toggleGitWorkbench: () => void;
  searchWorkspaceFiles: (workspaceId: string, query: string) => Promise<FileMentionCandidate[]>;
  loadCliSkills: (cliId: AgentId, workspaceId: string, force?: boolean) => Promise<CliSkillItem[]>;
  loadAcpCapabilities: (cliId: AgentId, force?: boolean) => Promise<AcpCliCapabilities | null>;
  respondAssistantApproval: (requestId: string, decision: AssistantApprovalDecision) => Promise<void>;

  executeAcpCommand: (command: AcpCommand, tabId?: string) => Promise<void>;

  publishTabContext: (tabId: string) => void;
  getRelatedTabContexts: (tabId: string) => SharedContextEntry[];
  runAutoCompact: (tabId: string) => void;
}

export const useStore = create<StoreState>((set, get) => {
  persistenceIssueReporter = (message) => {
    set((state) => (state.persistenceIssue === message ? {} : { persistenceIssue: message }));
  };

  const consumeQueuedChatMessage = (tabId: string) => {
    const queued = get().queuedChatByTab[tabId] ?? null;
    if (!queued) return;

    set((state) => {
      if (!state.queuedChatByTab[tabId]) return {};
      const queuedChatByTab = { ...state.queuedChatByTab };
      delete queuedChatByTab[tabId];
      return { queuedChatByTab };
    });

    queueMicrotask(() => {
      void get().sendChatMessage(tabId, queued.text, {
        cliIdOverride: queued.cliId,
        attachmentsOverride: queued.attachments,
        selectedAgentOverride: queued.selectedAgent,
      });
    });
  };

  return {
  appState: null,
  contextStore: null,
  settings: null,
  busyAction: null,
  persistenceIssue: null,
  acpCapabilitiesByCli: {},
  acpCapabilityStatusByCli: {},
  cliSkillsByContext: {},
  cliSkillStatusByContext: {},
  workspaces: [],
  terminalTabs: [],
  activeTerminalTabId: null,
  chatSessions: {},
  gitPanelsByWorkspace: {},
  gitCommitMessageByWorkspace: {},
  gitCommitLoadingByWorkspace: {},
  gitCommitErrorByWorkspace: {},
  gitWorkbenchOpen: false,
  sharedContext: {},
  queuedChatByTab: {},

  setAppState: (state) =>
    set((current) => ({
      appState: deriveActiveWorkspaceState(
        state,
        current.workspaces,
        current.terminalTabs,
        current.activeTerminalTabId
      ),
    })),

  appendTerminalLine: (agentId, line) => {
    const current = get().appState;
    if (!current) return;
    const nextLines = [...(current.terminalByAgent[agentId] ?? []), line].slice(-200);
    set({
      appState: {
        ...current,
        terminalByAgent: {
          ...current.terminalByAgent,
          [agentId]: nextLines,
        },
      },
    });
  },

  setBusyAction: (action) => set({ busyAction: action }),

  appendChatSystemMessage: (tabId, cliId, content, exitCode = 0) => {
    const message: ChatMessage = {
      id: createId("msg"),
      role: "system",
      cliId,
      timestamp: nowIso(),
      content,
      transportKind: defaultTransportKind(cliId),
      blocks: null,
      isStreaming: false,
      durationMs: null,
      exitCode,
    };
    set((state) => {
      const session = state.chatSessions[tabId];
      if (!session) return {};
      const chatSessions = {
        ...state.chatSessions,
        [tabId]: {
          ...session,
          messages: [...session.messages, message],
          updatedAt: message.timestamp,
        },
      };
      persistTerminalState(state.workspaces, state.terminalTabs, state.activeTerminalTabId, chatSessions);
      return { chatSessions };
    });
    const session = get().chatSessions[tabId];
    if (session) {
      enqueueMessagePersistence(() =>
        bridge.appendChatMessages({
          seeds: [toPersistedSessionSeed(session, tabId, [message])],
        })
      );
    }
  },

  deleteChatMessage: (tabId, messageId) => {
    set((state) => {
      const session = state.chatSessions[tabId];
      if (!session) return {};

      const target = session.messages.find((message) => message.id === messageId);
      if (!target || target.isStreaming) return {};

      const messages = session.messages.filter((message) => message.id !== messageId);
      if (messages.length === session.messages.length) return {};

      const chatSessions = {
        ...state.chatSessions,
        [tabId]: {
          ...session,
          messages,
          updatedAt: nowIso(),
        },
      };
      persistTerminalState(state.workspaces, state.terminalTabs, state.activeTerminalTabId, chatSessions);
      return { chatSessions };
    });
    enqueueMessagePersistence(() =>
      bridge.deleteChatMessage({
        terminalTabId: tabId,
        messageId,
      })
    );
  },

  hydrateTerminalSession: async (tabId) => {
    try {
      const persistedSession = await bridge.loadTerminalSession(tabId);
      updatePersistenceIssue("terminalState", null);
      if (!persistedSession) return;
      const current = get();
      const tab = current.terminalTabs.find((item) => item.id === tabId);
      if (!tab) return;
      const workspace = current.workspaces.find((item) => item.id === tab.workspaceId) ?? null;
      const normalizedSession = normalizeConversationSession(tab, workspace, persistedSession);

      set((state) => {
        const currentSession = state.chatSessions[tabId] ?? null;
        const shouldReplace =
          !currentSession ||
          normalizedSession.messages.length > currentSession.messages.length ||
          Date.parse(normalizedSession.updatedAt) > Date.parse(currentSession.updatedAt);

        if (!shouldReplace) return {};

        const chatSessions = {
          ...state.chatSessions,
          [tabId]: normalizedSession,
        };
        return {
          chatSessions,
          sharedContext: rebuildSharedContextMap(chatSessions, state.terminalTabs, state.workspaces),
        };
      });
    } catch (error) {
      updatePersistenceIssue("terminalState", error);
    }
  },

  loadInitialState: async (projectRoot) => {
    const state = await bridge.loadAppState(projectRoot);
    let workspaces: WorkspaceRef[] = [];
    let terminalTabs: TerminalTab[] = [];
    let chatSessions: Record<string, ConversationSession> = {};
    let activeTerminalTabId: string | null = null;
    let shouldSeedSessions = false;

    let persisted: PersistedTerminalState | null = null;
    try {
      persisted = await bridge.loadTerminalState();
      updatePersistenceIssue("terminalState", null);
    } catch (error) {
      updatePersistenceIssue("terminalState", error);
    }
    if (persisted && persisted.workspaces.length > 0 && persisted.terminalTabs.length > 0) {
      workspaces = persisted.workspaces;
      terminalTabs = persisted.terminalTabs.map((tab) =>
        createTerminalTab(
          workspaces.find((workspace) => workspace.id === tab.workspaceId) ??
            createWorkspaceRef(tab.workspaceId, { id: tab.workspaceId, name: tab.title, rootPath: tab.workspaceId }),
          {
            ...tab,
            transportSessions: normalizeTransportSessions(tab),
            contextBoundariesByCli: normalizeContextBoundariesByCli(tab),
          }
        )
      );
      activeTerminalTabId = persisted.activeTerminalTabId;
      chatSessions = persisted.chatSessions ?? {};
    } else {
      const workspace = createWorkspaceRef(state.workspace.projectRoot, {
        name: state.workspace.projectName,
        branch: state.workspace.branch,
        currentWriter: state.workspace.currentWriter,
        activeAgent: state.workspace.activeAgent,
        dirtyFiles: state.workspace.dirtyFiles,
        failingChecks: state.workspace.failingChecks,
        handoffReady: state.workspace.handoffReady,
        lastSnapshot: state.workspace.lastSnapshot ?? null,
      });
      const tab = createTerminalTab(workspace, {
        title: workspace.name,
        selectedCli: state.workspace.activeAgent,
      });
      const session = createConversationSession(tab, workspace);
      workspaces = [workspace];
      terminalTabs = [tab];
      activeTerminalTabId = tab.id;
      chatSessions = { [tab.id]: session };
      shouldSeedSessions = true;
    }

    workspaces = workspaces.map((workspace) => {
      if (samePath(workspace.rootPath, state.workspace.projectRoot)) {
        return {
          ...workspace,
          branch: state.workspace.branch,
          currentWriter: state.workspace.currentWriter,
          activeAgent: state.workspace.activeAgent,
          dirtyFiles: state.workspace.dirtyFiles,
          failingChecks: state.workspace.failingChecks,
          handoffReady: state.workspace.handoffReady,
          lastSnapshot: state.workspace.lastSnapshot ?? workspace.lastSnapshot ?? null,
        };
      }
      return workspace;
    });

    terminalTabs = terminalTabs.filter((tab) =>
      workspaces.some((workspace) => workspace.id === tab.workspaceId)
    );
    if (terminalTabs.length === 0) {
      const fallbackWorkspace = workspaces[0];
      if (fallbackWorkspace) {
        const fallbackTab = createTerminalTab(fallbackWorkspace);
        terminalTabs = [fallbackTab];
        chatSessions[fallbackTab.id] = createConversationSession(fallbackTab, fallbackWorkspace);
        activeTerminalTabId = fallbackTab.id;
      }
    }

    chatSessions = Object.fromEntries(
      terminalTabs.flatMap((tab) => {
        const workspace = workspaces.find((item) => item.id === tab.workspaceId);
        if (!workspace) return [];
        const persistedSession = chatSessions[tab.id] ?? null;
        return [[
          tab.id,
          persistedSession
            ? normalizeConversationSession(tab, workspace, persistedSession)
            : createConversationSession(tab, workspace),
        ]];
      })
    );

    const recoveredStreamingState = recoverStaleStreamingSessions(
      terminalTabs,
      chatSessions,
      0,
      true
    );
    if (recoveredStreamingState.recovered) {
      terminalTabs = recoveredStreamingState.terminalTabs;
      chatSessions = recoveredStreamingState.chatSessions;
    }

    const derived = deriveActiveWorkspaceState(
      state,
      workspaces,
      terminalTabs,
      activeTerminalTabId
    );

    set({
      appState: derived,
      workspaces,
      terminalTabs,
      activeTerminalTabId,
      chatSessions,
      gitPanelsByWorkspace: {},
      sharedContext: rebuildSharedContextMap(chatSessions, terminalTabs, workspaces),
      queuedChatByTab: {},
    });

    persistTerminalState(workspaces, terminalTabs, activeTerminalTabId, chatSessions);
    if (shouldSeedSessions) {
      const seeds = Object.entries(chatSessions).map(([terminalTabId, session]) =>
        toPersistedSessionSeed(session, terminalTabId, session.messages)
      );
      enqueueMessagePersistence(() => bridge.appendChatMessages({ seeds }));
    }
    syncStreamingRecoveryWatch(
      () => {
        const current = get();
        return {
          workspaces: current.workspaces,
          terminalTabs: current.terminalTabs,
          activeTerminalTabId: current.activeTerminalTabId,
          chatSessions: current.chatSessions,
          settings: current.settings,
          busyAction: current.busyAction,
        };
      },
      (nextTerminalTabs, nextChatSessions) => {
        set((state) => ({
          terminalTabs: nextTerminalTabs,
          chatSessions: nextChatSessions,
          busyAction: state.busyAction === "chat" ? null : state.busyAction,
        }));
      }
    );

    try {
      const ctx = await bridge.getContextStore();
      set({ contextStore: ctx });
    } catch {
      // context store is optional in browser fallback
    }
    try {
      const s = await bridge.getSettings();
      set({ settings: s });
    } catch {
      // settings are optional in browser fallback
    }

    const loadPanels = workspaces.map((workspace) =>
      get().loadGitPanel(workspace.id, workspace.rootPath)
    );
    await Promise.all(loadPanels);
  },

  switchAgent: async (agentId) => {
    set({ busyAction: `attach-${agentId}` });
    try {
      const state = await bridge.switchActiveAgent(agentId);
      get().setAppState(state);
      const activeTabId = get().activeTerminalTabId;
      if (activeTabId) {
        get().setTabSelectedCli(activeTabId, agentId);
      }
    } finally {
      set({ busyAction: null });
    }
  },

  takeOverWriter: async (agentId) => {
    set({ busyAction: `takeover-${agentId}` });
    try {
      const state = await bridge.takeOverWriter(agentId);
      const activeTabId = get().activeTerminalTabId;
      const activeTab = get().terminalTabs.find((tab) => tab.id === activeTabId);

      set((current) => {
        const workspaces = current.workspaces.map((workspace) =>
          workspace.id === activeTab?.workspaceId
            ? { ...workspace, currentWriter: agentId, activeAgent: agentId, handoffReady: true }
            : workspace
        );
        const appState = deriveActiveWorkspaceState(
          state,
          workspaces,
          current.terminalTabs,
          current.activeTerminalTabId
        );
        persistTerminalState(
          workspaces,
          current.terminalTabs,
          current.activeTerminalTabId,
          current.chatSessions
        );
        return { appState, workspaces };
      });

      try {
        const ctx = await bridge.getContextStore();
        set({ contextStore: ctx });
      } catch {
        // ignore context refresh failures
      }
    } finally {
      set({ busyAction: null });
    }
  },

  submitPrompt: async (agentId, prompt) => {
    set({ busyAction: "prompt" });
    try {
      await bridge.submitPrompt({ agentId, prompt });
    } finally {
      set({ busyAction: null });
    }
  },

  requestReview: async (agentId) => {
    set({ busyAction: `review-${agentId}` });
    try {
      await bridge.requestReview(agentId);
    } finally {
      set({ busyAction: null });
    }
  },

  snapshotWorkspace: async () => {
    const activeTab = get().terminalTabs.find((tab) => tab.id === get().activeTerminalTabId);
    const workspace = get().workspaces.find((item) => item.id === activeTab?.workspaceId);
    if (!activeTab || !workspace) return;
    const effectiveCli = resolveTerminalCliId(activeTab.selectedCli, workspace.activeAgent);

    const timestamp = nowIso();
    const systemMessage: ChatMessage = {
      id: createId("msg"),
      role: "system",
      cliId: effectiveCli,
      timestamp,
      content: "Workspace snapshot captured and attached to this terminal session.",
      isStreaming: false,
      durationMs: null,
      exitCode: 0,
    };

    set((current) => {
      const workspaces = current.workspaces.map((item) =>
        item.id === workspace.id ? { ...item, handoffReady: true, lastSnapshot: timestamp } : item
      );
      const chatSessions = {
        ...current.chatSessions,
        [activeTab.id]: {
          ...current.chatSessions[activeTab.id],
          messages: [...current.chatSessions[activeTab.id].messages, systemMessage],
          updatedAt: timestamp,
        },
      };
      const appState = current.appState
        ? deriveActiveWorkspaceState(
            current.appState,
            workspaces,
            current.terminalTabs,
            current.activeTerminalTabId
          )
        : null;
      persistTerminalState(workspaces, current.terminalTabs, current.activeTerminalTabId, chatSessions);
      return { workspaces, chatSessions, appState };
    });
    const session = get().chatSessions[activeTab.id];
    if (session) {
      enqueueMessagePersistence(() =>
        bridge.appendChatMessages({
          seeds: [toPersistedSessionSeed(session, activeTab.id, [systemMessage])],
        })
      );
    }
  },

  runChecks: async () => {
    const activeTab = get().terminalTabs.find((tab) => tab.id === get().activeTerminalTabId);
    const workspace = get().workspaces.find((item) => item.id === activeTab?.workspaceId);
    if (!activeTab || !workspace) return;
    const effectiveCli = resolveTerminalCliId(activeTab.selectedCli, workspace.activeAgent);

    const intro: ChatMessage = {
      id: createId("msg"),
      role: "system",
      cliId: effectiveCli,
      timestamp: nowIso(),
      content: `Running workspace checks for ${workspace.name}...`,
      isStreaming: false,
      durationMs: null,
      exitCode: null,
    };

    set((current) => {
      const chatSessions = {
        ...current.chatSessions,
        [activeTab.id]: {
          ...current.chatSessions[activeTab.id],
          messages: [...current.chatSessions[activeTab.id].messages, intro],
          updatedAt: nowIso(),
        },
      };
      persistTerminalState(
        current.workspaces,
        current.terminalTabs,
        current.activeTerminalTabId,
        chatSessions
      );
      return { busyAction: "checks", chatSessions };
    });
    const seededSession = get().chatSessions[activeTab.id];
    if (seededSession) {
      enqueueMessagePersistence(() =>
        bridge.appendChatMessages({
          seeds: [toPersistedSessionSeed(seededSession, activeTab.id, [intro])],
        })
      );
    }

    try {
      await bridge.runChecks(workspace.rootPath, effectiveCli, activeTab.id);
      await get().refreshGitPanel(workspace.id);
    } finally {
      set({ busyAction: null });
    }
  },

  loadContextStore: async () => {
    try {
      const ctx = await bridge.getContextStore();
      set({ contextStore: ctx });
    } catch {
      // ignore
    }
  },

  updateSettings: async (settings) => {
    try {
      const updated = await bridge.updateSettings(settings);
      set({ settings: updated });
    } catch {
      // ignore
    }
  },

  openWorkspaceFolder: async () => {
    const picked: WorkspacePickResult | null = await bridge.pickWorkspaceFolder();
    if (!picked) return;

    const existing = get().workspaces.find((workspace) => samePath(workspace.rootPath, picked.rootPath));
    if (existing) {
      get().createTerminalTab(existing.id);
      return;
    }

    const workspace = createWorkspaceRef(picked.rootPath, { name: picked.name });
    const tab = createTerminalTab(workspace);
    const session = createConversationSession(tab, workspace);

    set((current) => {
      const workspaces = [...current.workspaces, workspace];
      const terminalTabs = [...current.terminalTabs, tab];
      const chatSessions = { ...current.chatSessions, [tab.id]: session };
      const appState = current.appState
        ? deriveActiveWorkspaceState(current.appState, workspaces, terminalTabs, tab.id)
        : null;
      persistTerminalState(workspaces, terminalTabs, tab.id, chatSessions);
      return {
        appState,
        workspaces,
        terminalTabs,
        activeTerminalTabId: tab.id,
        chatSessions,
      };
    });
    enqueueMessagePersistence(() =>
      bridge.appendChatMessages({
        seeds: [toPersistedSessionSeed(session, tab.id, session.messages)],
      })
    );

    await get().loadGitPanel(workspace.id, workspace.rootPath);
  },

  addRemoteWorkspace: ({ name, remotePath, connectionId, locationLabel }) => {
    const trimmedPath = remotePath.trim();
    if (!trimmedPath || !connectionId.trim()) {
      return null;
    }

    const existing = get().workspaces.find(
      (workspace) =>
        workspace.locationKind === "ssh" &&
        workspace.connectionId === connectionId &&
        workspace.remotePath === trimmedPath
    );
    if (existing) {
      get().createTerminalTab(existing.id);
      return existing.id;
    }

    const workspace = createWorkspaceRef(trimmedPath, {
      name: name?.trim() || basename(trimmedPath),
      locationKind: "ssh",
      connectionId,
      remotePath: trimmedPath,
      locationLabel: locationLabel ?? null,
      branch: "workspace",
    });
    const tab = createTerminalTab(workspace);
    const session = createConversationSession(tab, workspace);

    set((current) => {
      const workspaces = [...current.workspaces, workspace];
      const terminalTabs = [...current.terminalTabs, tab];
      const chatSessions = { ...current.chatSessions, [tab.id]: session };
      const appState = current.appState
        ? deriveActiveWorkspaceState(current.appState, workspaces, terminalTabs, tab.id)
        : null;
      persistTerminalState(workspaces, terminalTabs, tab.id, chatSessions);
      return {
        appState,
        workspaces,
        terminalTabs,
        activeTerminalTabId: tab.id,
        chatSessions,
      };
    });
    enqueueMessagePersistence(() =>
      bridge.appendChatMessages({
        seeds: [toPersistedSessionSeed(session, tab.id, session.messages)],
      })
    );
    void get().loadGitPanel(workspace.id, workspace.rootPath);
    return workspace.id;
  },

  createTerminalTab: (workspaceId) => {
    const current = get();
    const sourceTab =
      current.terminalTabs.find((tab) => tab.id === current.activeTerminalTabId) ?? null;
    const workspace =
      current.workspaces.find((item) => item.id === workspaceId) ??
      current.workspaces.find((item) => item.id === sourceTab?.workspaceId) ??
      current.workspaces[0];

    if (!workspace) return;

    const tab = createTerminalTab(workspace, {
      selectedCli: sourceTab?.selectedCli ?? workspace.activeAgent,
      selectedAgent: sourceTab?.selectedAgent ?? null,
      contextBoundariesByCli: {},
    });
    const session = createConversationSession(tab, workspace);

    set((state) => {
      const terminalTabs = [...state.terminalTabs, tab];
      const chatSessions = { ...state.chatSessions, [tab.id]: session };
      const appState = state.appState
        ? deriveActiveWorkspaceState(state.appState, state.workspaces, terminalTabs, tab.id)
        : null;
      persistTerminalState(state.workspaces, terminalTabs, tab.id, chatSessions);
      return {
        appState,
        terminalTabs,
        activeTerminalTabId: tab.id,
        chatSessions,
      };
    });
    enqueueMessagePersistence(() =>
      bridge.appendChatMessages({
        seeds: [toPersistedSessionSeed(session, tab.id, session.messages)],
      })
    );
  },

  cloneTerminalTab: (sourceTabId) => {
    const current = get();
    const sourceTab =
      current.terminalTabs.find((tab) => tab.id === (sourceTabId ?? current.activeTerminalTabId)) ??
      null;
    if (!sourceTab || sourceTab.status === "streaming") return;

    const workspace = current.workspaces.find((item) => item.id === sourceTab.workspaceId);
    const sourceSession = current.chatSessions[sourceTab.id];
    if (!workspace || !sourceSession) return;

    const tab = createTerminalTab(workspace, {
      title: nextClonedTabTitle(sourceTab.title || workspace.name, current.terminalTabs.map((item) => item.title)),
      selectedCli: sourceTab.selectedCli,
      selectedAgent: sourceTab.selectedAgent ?? null,
      planMode: sourceTab.planMode,
      fastMode: sourceTab.fastMode,
      effortLevel: sourceTab.effortLevel,
      modelOverrides: { ...sourceTab.modelOverrides },
      permissionOverrides: { ...sourceTab.permissionOverrides },
      transportSessions: {},
      contextBoundariesByCli: {},
      draftPrompt: "",
      draftAttachments: [],
      status: "idle",
    });
    const session = createConversationSession(tab, workspace, {
      messages: cloneConversationMessages(sourceSession.messages),
    });

    set((state) => {
      const terminalTabs = [...state.terminalTabs, tab];
      const chatSessions = { ...state.chatSessions, [tab.id]: session };
      const appState = state.appState
        ? deriveActiveWorkspaceState(state.appState, state.workspaces, terminalTabs, tab.id)
        : null;
      persistTerminalState(state.workspaces, terminalTabs, tab.id, chatSessions);
      return {
        appState,
        terminalTabs,
        activeTerminalTabId: tab.id,
        chatSessions,
      };
    });
    enqueueMessagePersistence(() =>
      bridge.appendChatMessages({
        seeds: [toPersistedSessionSeed(session, tab.id, session.messages)],
      })
    );
  },

  reorderTerminalTabs: (sourceTabId, targetTabId) => {
    if (!sourceTabId || !targetTabId || sourceTabId === targetTabId) return;

    set((state) => {
      const sourceIndex = state.terminalTabs.findIndex((tab) => tab.id === sourceTabId);
      const targetIndex = state.terminalTabs.findIndex((tab) => tab.id === targetTabId);

      if (sourceIndex < 0 || targetIndex < 0) {
        return {};
      }

      const nextTerminalTabs = [...state.terminalTabs];
      const [movedTab] = nextTerminalTabs.splice(sourceIndex, 1);
      nextTerminalTabs.splice(targetIndex, 0, movedTab);

      const appState = state.appState
        ? deriveActiveWorkspaceState(
            state.appState,
            state.workspaces,
            nextTerminalTabs,
            state.activeTerminalTabId,
          )
        : null;

      persistTerminalState(
        state.workspaces,
        nextTerminalTabs,
        state.activeTerminalTabId,
        state.chatSessions,
      );

      return {
        appState,
        terminalTabs: nextTerminalTabs,
      };
    });
  },

  closeTerminalTab: (tabId) => {
    const current = get();
    if (current.terminalTabs.length <= 1) return;

    const remainingTabs = current.terminalTabs.filter((tab) => tab.id !== tabId);
    const nextActive =
      current.activeTerminalTabId === tabId
        ? remainingTabs[Math.max(remainingTabs.length - 1, 0)]?.id ?? null
        : current.activeTerminalTabId;

    const chatSessions = { ...current.chatSessions };
    delete chatSessions[tabId];
    const sharedContext = { ...current.sharedContext };
    delete sharedContext[tabId];

    set((state) => {
      const appState = state.appState
        ? deriveActiveWorkspaceState(state.appState, state.workspaces, remainingTabs, nextActive)
        : null;
      persistTerminalState(state.workspaces, remainingTabs, nextActive, chatSessions);
      const queuedChatByTab = { ...state.queuedChatByTab };
      delete queuedChatByTab[tabId];
      return {
        appState,
        terminalTabs: remainingTabs,
        activeTerminalTabId: nextActive,
        chatSessions,
        sharedContext,
        queuedChatByTab,
      };
    });
    enqueueMessagePersistence(() => bridge.deleteChatSessionByTab(tabId));
  },

  setActiveTerminalTab: (tabId) => {
    set((state) => {
      const terminalTabs = state.terminalTabs.map((tab) =>
        tab.id === tabId ? { ...tab, lastActiveAt: nowIso() } : tab
      );
      const appState = state.appState
        ? deriveActiveWorkspaceState(state.appState, state.workspaces, terminalTabs, tabId)
        : null;
      persistTerminalState(state.workspaces, terminalTabs, tabId, state.chatSessions);
      return { appState, terminalTabs, activeTerminalTabId: tabId };
    });
    void get().hydrateTerminalSession(tabId);
  },

  setTabSelectedCli: (tabId, cliId) => {
    const current = get();
    const currentTab = current.terminalTabs.find((tab) => tab.id === tabId);
    const workspace = current.workspaces.find((item) => item.id === currentTab?.workspaceId) ?? null;
    const session = current.chatSessions[tabId] ?? null;
    const fromCli = resolveTerminalCliId(currentTab?.selectedCli, workspace?.activeAgent ?? "codex");

    set((state) => {
      const terminalTabs = state.terminalTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              selectedCli: cliId,
              transportSessions: normalizeTransportSessions(tab),
            }
          : tab
      );
      const activeTab = terminalTabs.find((tab) => tab.id === tabId);
      const workspaces = state.workspaces.map((nextWorkspace) =>
        nextWorkspace.id === activeTab?.workspaceId && cliId !== "auto"
          ? { ...nextWorkspace, activeAgent: cliId }
          : nextWorkspace
      );
      const appState = state.appState
        ? deriveActiveWorkspaceState(state.appState, workspaces, terminalTabs, state.activeTerminalTabId)
        : null;
      persistTerminalState(workspaces, terminalTabs, state.activeTerminalTabId, state.chatSessions);
      return { appState, workspaces, terminalTabs };
    });

    const targetCli = cliId === "auto" ? null : cliId;
    if (!workspace || !session || !targetCli || targetCli === fromCli) return;

    const latest = extractLatestTaskContext(session.messages, fromCli);
    const compactedHistory = session.compactedSummaries.length > 0
      ? session.compactedSummaries[session.compactedSummaries.length - 1]
      : null;
    const crossTabContextEntries = get().getRelatedTabContexts(tabId);
    const handoffDocument = buildHandoffDocument(
      session,
      fromCli,
      targetCli,
      crossTabContextEntries
    );

    // Enrich handoff with semantic recall — fire handoff with results when ready
    const doHandoff = async () => {
      try {
        const semanticQuery = latest.latestUserPrompt || workspace.name;
        if (semanticQuery) {
          const chunks = await bridge.semanticRecall({
            query: semanticQuery,
            terminalTabId: tabId,
            limit: 12,
          });
          if (chunks.length > 0) {
            handoffDocument.semanticContext = chunks;
          }
        }
      } catch {
        // Semantic recall failure is non-critical
      }
      await bridge.switchCliForTask({
        terminalTabId: tabId,
        workspaceId: workspace.id,
        projectRoot: workspace.rootPath,
        projectName: workspace.name,
        fromCli,
        toCli: targetCli,
        reason: "manual-switch",
        latestUserPrompt: latest.latestUserPrompt,
        latestAssistantSummary: latest.latestAssistantSummary,
        relevantFiles: latest.relevantFiles,
        compactedHistory,
        crossTabContext: crossTabContextEntries.length > 0 ? crossTabContextEntries : null,
        handoffDocument,
      });
    };
    void doHandoff();
  },

  setTabSelectedAgent: (tabId, agent) => {
    const normalizedAgent = normalizeSelectedCustomAgent(agent);
    set((state) => {
      const terminalTabs = state.terminalTabs.map((tab) =>
        tab.id === tabId ? { ...tab, selectedAgent: normalizedAgent } : tab
      );
      persistTerminalState(state.workspaces, terminalTabs, state.activeTerminalTabId, state.chatSessions);
      return { terminalTabs };
    });
  },

  setTabDraftPrompt: (tabId, prompt) => {
    const currentTab = get().terminalTabs.find((tab) => tab.id === tabId);
    if (!currentTab || currentTab.draftPrompt === prompt) return;

    set((state) => {
      const terminalTabs = state.terminalTabs.map((tab) =>
        tab.id === tabId ? { ...tab, draftPrompt: prompt } : tab
      );
      return { terminalTabs };
    });

    scheduleDraftPromptPersistence(() => {
      const state = get();
      return {
        workspaces: state.workspaces,
        terminalTabs: state.terminalTabs,
        activeTerminalTabId: state.activeTerminalTabId,
        chatSessions: state.chatSessions,
      };
    });
  },

  addDraftChatAttachments: (tabId, workspaceRoot, picked) => {
    const nextAttachments = picked
      .map((item) => createChatAttachment(item, workspaceRoot))
      .filter((item): item is ChatAttachment => Boolean(item));

    if (nextAttachments.length === 0) {
      return { added: 0, rejected: picked.length };
    }

    let added = 0;
    set((state) => {
      const currentTab = state.terminalTabs.find((tab) => tab.id === tabId) ?? null;
      if (!currentTab) return {};
      const mergedAttachments = mergeChatAttachments(
        currentTab.draftAttachments,
        nextAttachments
      );
      added = mergedAttachments.length - currentTab.draftAttachments.length;
      if (added <= 0) return {};
      const terminalTabs = state.terminalTabs.map((tab) =>
        tab.id === tabId ? { ...tab, draftAttachments: mergedAttachments } : tab
      );
      return { terminalTabs };
    });

    if (added > 0) {
      scheduleDraftPromptPersistence(() => {
        const state = get();
        return {
          workspaces: state.workspaces,
          terminalTabs: state.terminalTabs,
          activeTerminalTabId: state.activeTerminalTabId,
          chatSessions: state.chatSessions,
        };
      });
    }

    return {
      added,
      rejected: Math.max(0, picked.length - added),
    };
  },

  removeDraftChatAttachment: (tabId, attachmentId) => {
    let changed = false;
    set((state) => {
      const currentTab = state.terminalTabs.find((tab) => tab.id === tabId) ?? null;
      if (!currentTab) return {};
      const draftAttachments = currentTab.draftAttachments.filter(
        (attachment) => attachment.id !== attachmentId
      );
      changed = draftAttachments.length !== currentTab.draftAttachments.length;
      if (!changed) return {};
      const terminalTabs = state.terminalTabs.map((tab) =>
        tab.id === tabId ? { ...tab, draftAttachments } : tab
      );
      return { terminalTabs };
    });

    if (changed) {
      scheduleDraftPromptPersistence(() => {
        const state = get();
        return {
          workspaces: state.workspaces,
          terminalTabs: state.terminalTabs,
          activeTerminalTabId: state.activeTerminalTabId,
          chatSessions: state.chatSessions,
        };
      });
    }
  },

  queueChatMessage: (tabId, prompt, cliIdOverride) => {
    const state = get();
    const tab = state.terminalTabs.find((item) => item.id === tabId) ?? null;
    if (!tab) return "unavailable";

    const text = (prompt ?? tab.draftPrompt).trim();
    const attachments = cloneChatAttachments(tab.draftAttachments) ?? [];
    const targetCli = cliIdOverride ?? tab.selectedCli;
    if (!text && attachments.length === 0) return "empty";
    if (hasImageAttachments(attachments) && targetCli !== "codex") {
      return "unsupportedAttachments";
    }
    if (state.queuedChatByTab[tabId]) return "full";

    set((current) => {
      const currentTab = current.terminalTabs.find((item) => item.id === tabId) ?? null;
      if (!currentTab) return {};
      const terminalTabs = current.terminalTabs.map((item) =>
        item.id === tabId
          ? { ...item, draftPrompt: "", draftAttachments: [], selectedAgent: null }
          : item
      );
      return {
        terminalTabs,
        queuedChatByTab: {
          ...current.queuedChatByTab,
          [tabId]: {
            text,
            attachments,
            cliId: cliIdOverride ?? currentTab.selectedCli,
            selectedAgent: normalizeSelectedCustomAgent(currentTab.selectedAgent) ?? null,
            queuedAt: nowIso(),
          },
        },
      };
    });

    scheduleDraftPromptPersistence(() => {
      const current = get();
      return {
        workspaces: current.workspaces,
        terminalTabs: current.terminalTabs,
        activeTerminalTabId: current.activeTerminalTabId,
        chatSessions: current.chatSessions,
      };
    });

    return "queued";
  },

  clearQueuedChatMessage: (tabId) => {
    set((state) => {
      if (!state.queuedChatByTab[tabId]) return {};
      const queuedChatByTab = { ...state.queuedChatByTab };
      delete queuedChatByTab[tabId];
      return { queuedChatByTab };
    });
  },

  editQueuedChatMessage: (tabId) => {
    const queued = get().queuedChatByTab[tabId] ?? null;
    if (!queued) return false;

    set((state) => {
      const currentTab = state.terminalTabs.find((item) => item.id === tabId) ?? null;
      if (!currentTab) return {};
      const terminalTabs = state.terminalTabs.map((item) =>
        item.id === tabId
          ? {
              ...item,
              draftPrompt: queued.text,
              draftAttachments: cloneChatAttachments(queued.attachments) ?? [],
              selectedAgent: normalizeSelectedCustomAgent(queued.selectedAgent) ?? null,
            }
          : item
      );
      const queuedChatByTab = { ...state.queuedChatByTab };
      delete queuedChatByTab[tabId];
      return { terminalTabs, queuedChatByTab };
    });

    scheduleDraftPromptPersistence(() => {
      const current = get();
      return {
        workspaces: current.workspaces,
        terminalTabs: current.terminalTabs,
        activeTerminalTabId: current.activeTerminalTabId,
        chatSessions: current.chatSessions,
      };
    });

    return true;
  },

  interruptChatTurn: async (tabId) => {
    const targetTabId = tabId ?? get().activeTerminalTabId;
    if (!targetTabId) return false;

    const state = get();
    const tab = state.terminalTabs.find((item) => item.id === targetTabId) ?? null;
    const session = state.chatSessions[targetTabId] ?? null;
    if (!tab || tab.status !== "streaming" || !session) return false;

    const activeMessage =
      [...session.messages]
        .reverse()
        .find((message) => message.role === "assistant" && message.isStreaming) ?? null;
    if (!activeMessage) return false;

    try {
      const result = await bridge.interruptChatTurn(targetTabId, activeMessage.id);
      return result.accepted;
    } catch {
      return false;
    }
  },

  togglePlanMode: (tabId) => {
    const targetTabId = tabId ?? get().activeTerminalTabId;
    if (!targetTabId) return;
    let systemMessage: ChatMessage | null = null;
    set((state) => {
      const terminalTabs = state.terminalTabs.map((tab) =>
        tab.id === targetTabId ? { ...tab, planMode: !tab.planMode } : tab
      );
      const activeTab = terminalTabs.find((tab) => tab.id === targetTabId);
      const activeWorkspace = state.workspaces.find((workspace) => workspace.id === activeTab?.workspaceId);
      const effectiveCli = resolveTerminalCliId(
        activeTab?.selectedCli,
        activeWorkspace?.activeAgent ?? "codex"
      );
      if (activeTab) {
        systemMessage = {
          id: createId("msg"),
          role: "system" as const,
          cliId: effectiveCli,
          timestamp: nowIso(),
          content: `Plan mode: ${activeTab.planMode ? "ON" : "OFF"}`,
          isStreaming: false,
          durationMs: null,
          exitCode: 0,
        };
      }
      const chatSessions = activeTab
        ? {
            ...state.chatSessions,
            [targetTabId]: {
              ...state.chatSessions[targetTabId],
              messages: [
                ...state.chatSessions[targetTabId].messages,
                systemMessage!,
              ],
              updatedAt: nowIso(),
            },
          }
        : state.chatSessions;
      persistTerminalState(state.workspaces, terminalTabs, state.activeTerminalTabId, chatSessions);
      return { terminalTabs, chatSessions };
    });
    const session = get().chatSessions[targetTabId];
    if (session && systemMessage) {
      enqueueMessagePersistence(() =>
        bridge.appendChatMessages({
          seeds: [toPersistedSessionSeed(session, targetTabId, [systemMessage!])],
        })
      );
    }
  },

  respondAutoRoute: async (tabId, action) => {
    const current = get();
    const tab = current.terminalTabs.find((item) => item.id === tabId);
    const session = current.chatSessions[tabId];
    if (!tab || !session) return;

    const pendingRoute = [...session.messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          !message.isStreaming &&
          message.blocks?.some(
            (block) => block.kind === "autoRoute" && (!block.state || block.state === "pending")
          )
      );
    if (!pendingRoute) return;

    const routeBlock = pendingRoute.blocks?.find(
      (block): block is Extract<ChatMessageBlock, { kind: "autoRoute" }> =>
        block.kind === "autoRoute" && (!block.state || block.state === "pending")
    );
    if (!routeBlock) return;

    const nextState =
      action === "run" ? "accepted" : action === "switch" ? "switched" : "cancelled";

    set((state) => {
      const terminalTabs = state.terminalTabs;
      const chatSessions = {
        ...state.chatSessions,
        [tabId]: {
          ...state.chatSessions[tabId],
          messages: state.chatSessions[tabId].messages.map<ChatMessage>((message) =>
            message.id === pendingRoute.id
              ? {
                  ...message,
                  blocks:
                    message.blocks?.map((block) =>
                      block.kind === "autoRoute"
                        ? { ...block, state: nextState }
                        : block
                    ) ?? message.blocks ?? null,
                }
              : message
          ),
          updatedAt: nowIso(),
        },
      };
      persistTerminalState(state.workspaces, terminalTabs, state.activeTerminalTabId, chatSessions);
      return { terminalTabs, chatSessions };
    });
    const updatedMessage = get()
      .chatSessions[tabId]
      ?.messages.find((message) => message.id === pendingRoute.id);
    if (updatedMessage) {
      enqueueMessagePersistence(() =>
        bridge.updateChatMessageBlocks({
          messageId: updatedMessage.id,
          blocks: updatedMessage.blocks ?? null,
        })
      );
    }

    if (action === "run") {
      get().setTabSelectedCli(tabId, routeBlock.targetCli);
      await get().sendChatMessage(tabId, pendingRoute.content);
      return;
    }

    if (action === "switch") {
      get().setTabSelectedCli(tabId, routeBlock.targetCli);
      get().appendChatSystemMessage(
        tabId,
        routeBlock.targetCli,
        `Switched to ${routeBlock.targetCli}.`
      );
      return;
    }

    get().appendChatSystemMessage(
      tabId,
      routeBlock.targetCli,
      "Auto routing cancelled."
    );
  },

  sendChatMessage: async (tabId, prompt, options) => {
    const state = get();
    const tab = state.terminalTabs.find((item) => item.id === tabId);
    const workspace = state.workspaces.find((item) => item.id === tab?.workspaceId);
    const session = state.chatSessions[tabId];
    const settings = state.settings;
    if (!tab || !workspace || !session) return;
    const selectedCliForSend = options?.cliIdOverride ?? tab.selectedCli;
    const effectiveCli = resolveTerminalCliId(selectedCliForSend, workspace.activeAgent);
    const shouldClearDraft = prompt == null;
    const draftAttachments = cloneChatAttachments(
      options?.attachmentsOverride ?? tab.draftAttachments
    ) ?? [];
    const text = (prompt ?? tab.draftPrompt).trim();
    const visiblePrompt = buildPromptWithAttachments(text, draftAttachments);
    const resolvedSelectedAgent = resolveSelectedCustomAgent(
      options?.selectedAgentOverride ?? tab.selectedAgent ?? null,
      settings?.customAgents
    );
    const actualPrompt = injectSelectedAgentPrompt(visiblePrompt, resolvedSelectedAgent);
    const imageAttachments = draftAttachments
      .filter((attachment) => attachment.kind === "image")
      .map((attachment) => attachment.source);
    if ((!text && draftAttachments.length === 0) || tab.status === "streaming") return;
    if (imageAttachments.length > 0 && selectedCliForSend !== "codex") {
      throw new Error(UNSUPPORTED_IMAGE_ATTACHMENT_MESSAGE);
    }

    if (selectedCliForSend === "auto") {
      const userMessage: ChatMessage = {
        id: createId("msg"),
        role: "user",
        cliId: null,
        selectedAgent: resolvedSelectedAgent,
        timestamp: nowIso(),
        content: visiblePrompt,
        rawContent: actualPrompt,
        transportKind: null,
        blocks: null,
        attachments: cloneChatAttachments(draftAttachments),
        isStreaming: false,
        durationMs: null,
        exitCode: null,
      };
      const pendingMessage: ChatMessage = {
        id: createId("msg"),
        role: "assistant",
        cliId: "claude",
        timestamp: nowIso(),
        content: "",
        rawContent: "",
        contentFormat: "plain",
        transportKind: "claude-cli",
        blocks: [
          {
            kind: "orchestrationPlan",
            title: "Auto orchestration by Claude",
            goal: actualPrompt,
            summary: "Preparing the execution plan.",
            status: "planning",
          },
        ],
        isStreaming: true,
        durationMs: null,
        exitCode: null,
      };

      set((current) => {
        const terminalTabs = current.terminalTabs.map((item) =>
          item.id === tabId
            ? {
                ...item,
                draftPrompt: shouldClearDraft ? "" : item.draftPrompt,
                draftAttachments: shouldClearDraft ? [] : item.draftAttachments,
                selectedAgent: shouldClearDraft ? null : item.selectedAgent,
                status: "streaming" as const,
              }
            : item
        );
        const chatSessions = {
          ...current.chatSessions,
          [tabId]: {
            ...current.chatSessions[tabId],
            messages: [
              ...current.chatSessions[tabId].messages,
              userMessage,
              pendingMessage,
            ],
            updatedAt: nowIso(),
          },
        };
        persistTerminalState(current.workspaces, terminalTabs, current.activeTerminalTabId, chatSessions);
        return { busyAction: "chat", terminalTabs, chatSessions };
      });
      const seededSession = get().chatSessions[tabId];
      if (seededSession) {
        enqueueMessagePersistence(() =>
          bridge.appendChatMessages({
            seeds: [toPersistedSessionSeed(seededSession, tabId, [userMessage, pendingMessage])],
          })
        );
      }

      syncStreamingRecoveryWatch(
        () => {
          const current = get();
          return {
            workspaces: current.workspaces,
            terminalTabs: current.terminalTabs,
            activeTerminalTabId: current.activeTerminalTabId,
            chatSessions: current.chatSessions,
            settings: current.settings,
            busyAction: current.busyAction,
          };
        },
        (nextTerminalTabs, nextChatSessions) => {
          set((state) => ({
            terminalTabs: nextTerminalTabs,
            chatSessions: nextChatSessions,
            busyAction: state.busyAction === "chat" ? null : state.busyAction,
          }));
        }
      );

      try {
        const messageId = await bridge.runAutoOrchestration({
          terminalTabId: tab.id,
          workspaceId: workspace.id,
          assistantMessageId: pendingMessage.id,
          prompt: actualPrompt,
          projectRoot: workspace.rootPath,
          projectName: workspace.name,
          recentTurns: buildRecentTabContextTurns(session.messages, "claude"),
          planMode: tab.planMode,
          fastMode: tab.fastMode,
          effortLevel: tab.effortLevel,
          modelOverrides: tab.modelOverrides,
          permissionOverrides: tab.permissionOverrides,
        });

        if (messageId !== pendingMessage.id) {
          set((current) => {
            const chatSessions = {
              ...current.chatSessions,
              [tabId]: {
                ...current.chatSessions[tabId],
                messages: current.chatSessions[tabId].messages.map((message) =>
                  message.id === pendingMessage.id ? { ...message, id: messageId } : message
                ),
                updatedAt: nowIso(),
              },
            };
            persistTerminalState(current.workspaces, current.terminalTabs, current.activeTerminalTabId, chatSessions);
            return { chatSessions };
          });
        }
      } catch {
        set((current) => {
          const terminalTabs = current.terminalTabs.map((item) =>
            item.id === tabId ? { ...item, status: "idle" as const } : item
          );
          const chatSessions = {
            ...current.chatSessions,
            [tabId]: {
              ...current.chatSessions[tabId],
              messages: current.chatSessions[tabId].messages.map<ChatMessage>((message) =>
                message.id === pendingMessage.id
                  ? {
                      ...message,
                      content: "Error: failed to start auto orchestration",
                      rawContent: "Error: failed to start auto orchestration",
                      contentFormat: "log",
                      blocks: [
                        {
                          kind: "status",
                          level: "error",
                          text: "Error: failed to start auto orchestration",
                        },
                      ] satisfies ChatMessageBlock[],
                      isStreaming: false,
                      exitCode: 1,
                    }
                  : message
              ),
              updatedAt: nowIso(),
            },
          };
          persistTerminalState(current.workspaces, terminalTabs, current.activeTerminalTabId, chatSessions);
          return { busyAction: null, terminalTabs, chatSessions };
        });
        const failureSession = get().chatSessions[tabId];
        const failureMessage =
          failureSession?.messages.find((message) => message.id === pendingMessage.id) ?? null;
        if (failureSession && failureMessage) {
          enqueueMessagePersistence(() =>
            bridge.finalizeChatMessage({
              terminalTabId: tabId,
              messageId: failureMessage.id,
              rawContent: failureMessage.rawContent ?? failureMessage.content,
              content: failureMessage.content,
              contentFormat: failureMessage.contentFormat ?? null,
              blocks: failureMessage.blocks ?? null,
              transportKind: failureMessage.transportKind ?? null,
              transportSession: null,
              exitCode: failureMessage.exitCode,
              durationMs: failureMessage.durationMs,
              updatedAt: failureSession.updatedAt,
            })
          );
        }
        syncStreamingRecoveryWatch(
          () => {
            const current = get();
            return {
              workspaces: current.workspaces,
              terminalTabs: current.terminalTabs,
              activeTerminalTabId: current.activeTerminalTabId,
              chatSessions: current.chatSessions,
              settings: current.settings,
              busyAction: current.busyAction,
            };
          },
          (nextTerminalTabs, nextChatSessions) => {
            set((state) => ({
              terminalTabs: nextTerminalTabs,
              chatSessions: nextChatSessions,
              busyAction: state.busyAction === "chat" ? null : state.busyAction,
            }));
          }
        );
        consumeQueuedChatMessage(tabId);
      }
      return;
    }

      const userMessage: ChatMessage = {
        id: createId("msg"),
        role: "user",
        cliId: effectiveCli,
        selectedAgent: resolvedSelectedAgent,
        timestamp: nowIso(),
        content: visiblePrompt,
        rawContent: actualPrompt,
        transportKind: tab.transportSessions[effectiveCli]?.kind ?? defaultTransportKind(effectiveCli),
        blocks: null,
        attachments: cloneChatAttachments(draftAttachments),
        isStreaming: false,
        durationMs: null,
        exitCode: null,
    };
    const pendingMessage: ChatMessage = {
      id: createId("msg"),
      role: "assistant",
      cliId: effectiveCli,
      timestamp: nowIso(),
      content: "",
      rawContent: "",
      contentFormat: "plain",
      transportKind: tab.transportSessions[effectiveCli]?.kind ?? defaultTransportKind(effectiveCli),
      blocks: null,
      isStreaming: true,
      durationMs: null,
      exitCode: null,
    };

    set((current) => {
      const terminalTabs = current.terminalTabs.map((item) =>
        item.id === tabId
          ? {
              ...item,
              draftPrompt: shouldClearDraft ? "" : item.draftPrompt,
              draftAttachments: shouldClearDraft ? [] : item.draftAttachments,
              selectedAgent: shouldClearDraft ? null : item.selectedAgent,
              status: "streaming" as const,
            }
          : item
      );
      const chatSessions = {
        ...current.chatSessions,
        [tabId]: {
          ...current.chatSessions[tabId],
          messages: [...current.chatSessions[tabId].messages, userMessage, pendingMessage],
          updatedAt: nowIso(),
        },
      };
      persistTerminalState(current.workspaces, terminalTabs, current.activeTerminalTabId, chatSessions);
      return { busyAction: "chat", terminalTabs, chatSessions };
    });
    const seededSession = get().chatSessions[tabId];
    if (seededSession) {
      enqueueMessagePersistence(() =>
        bridge.appendChatMessages({
          seeds: [toPersistedSessionSeed(seededSession, tabId, [userMessage, pendingMessage])],
        })
      );
    }
    syncStreamingRecoveryWatch(
      () => {
        const current = get();
        return {
          workspaces: current.workspaces,
          terminalTabs: current.terminalTabs,
          activeTerminalTabId: current.activeTerminalTabId,
          chatSessions: current.chatSessions,
          settings: current.settings,
          busyAction: current.busyAction,
        };
      },
      (nextTerminalTabs, nextChatSessions) => {
        set((state) => ({
          terminalTabs: nextTerminalTabs,
          chatSessions: nextChatSessions,
          busyAction: state.busyAction === "chat" ? null : state.busyAction,
        }));
      }
    );

    try {
      const writeMode = !tab.planMode;
      const recentTurns = buildRecentTabContextTurns(session.messages, effectiveCli);
      const crossTabContextEntries = get().getRelatedTabContexts(tab.id);
      const workingMemory = buildWorkingMemory(session.messages);
      const existingTransportSession = tab.transportSessions[effectiveCli] ?? null;
      const existingBoundary = tab.contextBoundariesByCli[effectiveCli] ?? null;
      const hasExistingSession = Boolean(existingTransportSession?.threadId);

      const otherCliMessages = session.messages.filter(
        (m) => m.role !== "system" && m.cliId && m.cliId !== effectiveCli
      );
      let fullHandoffContext: string | null = null;
      if (otherCliMessages.length > 0) {
        const previousCli = otherCliMessages[otherCliMessages.length - 1].cliId ?? effectiveCli;
        const handoffDoc = buildHandoffDocument(session, previousCli, effectiveCli, crossTabContextEntries);
        fullHandoffContext = formatHandoffDocument(handoffDoc);
      }
      const deltaHandoffContext =
        hasExistingSession && existingBoundary
          ? formatDeltaHandoffDocument(
              buildDeltaHandoffDocument(
                session,
                effectiveCli,
                existingBoundary,
                crossTabContextEntries
              )
            ) || null
          : null;
      const initialHandoffContext =
        hasExistingSession && existingBoundary ? deltaHandoffContext : fullHandoffContext;
      if (otherCliMessages.length > 0 && shouldRequestSemanticRecallForHandoff(text, hasExistingSession, initialHandoffContext)) {
        const previousCli = otherCliMessages[otherCliMessages.length - 1].cliId ?? effectiveCli;
        const latest = extractLatestTaskContext(session.messages, previousCli);
        try {
          const semanticQuery = latest.latestUserPrompt || workspace.name;
          if (semanticQuery) {
            const chunks = await bridge.semanticRecall({
              query: semanticQuery,
              terminalTabId: tab.id,
              limit: 3,
            });
            if (chunks.length > 0 && !hasExistingSession) {
              const handoffDoc = buildHandoffDocument(session, previousCli, effectiveCli, crossTabContextEntries);
              handoffDoc.semanticContext = chunks;
              fullHandoffContext = formatHandoffDocument(handoffDoc);
            }
          }
        } catch {
          // Semantic recall is optional for handoff generation.
        }
      }
      const finalInitialHandoffContext =
        hasExistingSession && existingBoundary ? deltaHandoffContext : fullHandoffContext;

      const baseChatRequest = {
        cliId: effectiveCli,
        terminalTabId: tab.id,
        workspaceId: workspace.id,
        assistantMessageId: pendingMessage.id,
        prompt: actualPrompt,
        projectRoot: workspace.rootPath,
        projectName: workspace.name,
        recentTurns,
        writeMode,
        planMode: tab.planMode,
        fastMode: tab.fastMode,
        effortLevel: tab.effortLevel,
        modelOverride: tab.modelOverrides[effectiveCli] ?? null,
        permissionOverride: tab.permissionOverrides[effectiveCli] ?? null,
        imageAttachments: imageAttachments.length > 0 ? imageAttachments : null,
        compactedSummaries: session.compactedSummaries.length > 0 ? session.compactedSummaries : null,
        crossTabContext: crossTabContextEntries.length > 0 ? crossTabContextEntries : null,
        workingMemory: workingMemory.modifiedFiles.length > 0 || workingMemory.activeErrors.length > 0
          ? workingMemory
          : null,
      };

      let messageId: string;
      try {
        messageId = await bridge.sendChatMessage({
          ...baseChatRequest,
          transportSession: existingTransportSession,
          handoffContext: finalInitialHandoffContext,
        });
      } catch (initialError) {
        if (!hasExistingSession || !existingTransportSession?.threadId) {
          throw initialError;
        }

        set((state) => {
          const terminalTabs = state.terminalTabs.map((currentTab) =>
            currentTab.id === tab.id
              ? {
                  ...currentTab,
                  transportSessions: {
                    ...normalizeTransportSessions(currentTab),
                    [effectiveCli]: invalidateTransportSession(
                      effectiveCli,
                      normalizeTransportSessions(currentTab)[effectiveCli] ?? null
                    ),
                  },
                }
              : currentTab
          );
          persistTerminalState(state.workspaces, terminalTabs, state.activeTerminalTabId, state.chatSessions);
          return { terminalTabs };
        });

        messageId = await bridge.sendChatMessage({
          ...baseChatRequest,
          transportSession: null,
          handoffContext: fullHandoffContext ?? finalInitialHandoffContext,
        });
      }

      if (messageId !== pendingMessage.id) {
        set((current) => {
          const chatSessions = {
            ...current.chatSessions,
            [tabId]: {
              ...current.chatSessions[tabId],
              messages: current.chatSessions[tabId].messages.map((message) =>
                message.id === pendingMessage.id ? { ...message, id: messageId } : message
              ),
              updatedAt: nowIso(),
            },
          };
          persistTerminalState(current.workspaces, current.terminalTabs, current.activeTerminalTabId, chatSessions);
          return { chatSessions };
        });
      }
    } catch {
      set((current) => {
        const terminalTabs = current.terminalTabs.map((item) =>
          item.id === tabId ? { ...item, status: "idle" as const } : item
        );
        const chatSessions = {
          ...current.chatSessions,
          [tabId]: {
            ...current.chatSessions[tabId],
            messages: current.chatSessions[tabId].messages.map<ChatMessage>((message) =>
              message.id === pendingMessage.id
                ? {
                    ...message,
                    content: "Error: failed to send message",
                    rawContent: "Error: failed to send message",
                    contentFormat: "log",
                    blocks: [
                      {
                        kind: "status",
                        level: "error",
                        text: "Error: failed to send message",
                      },
                    ] satisfies ChatMessageBlock[],
                    isStreaming: false,
                    exitCode: 1,
                  }
                : message
            ),
            updatedAt: nowIso(),
          },
        };
        persistTerminalState(current.workspaces, terminalTabs, current.activeTerminalTabId, chatSessions);
        return { busyAction: null, terminalTabs, chatSessions };
      });
      const failureSession = get().chatSessions[tabId];
      const failureMessage =
        failureSession?.messages.find((message) => message.id === pendingMessage.id) ?? null;
      if (failureSession && failureMessage) {
        enqueueMessagePersistence(() =>
          bridge.finalizeChatMessage({
            terminalTabId: tabId,
            messageId: failureMessage.id,
            rawContent: failureMessage.rawContent ?? failureMessage.content,
            content: failureMessage.content,
            contentFormat: failureMessage.contentFormat ?? null,
            blocks: failureMessage.blocks ?? null,
            transportKind: failureMessage.transportKind ?? null,
            transportSession: null,
            exitCode: failureMessage.exitCode,
            durationMs: failureMessage.durationMs,
            updatedAt: failureSession.updatedAt,
          })
        );
      }
      syncStreamingRecoveryWatch(
        () => {
          const current = get();
          return {
            workspaces: current.workspaces,
            terminalTabs: current.terminalTabs,
            activeTerminalTabId: current.activeTerminalTabId,
            chatSessions: current.chatSessions,
            settings: current.settings,
            busyAction: current.busyAction,
          };
        },
        (nextTerminalTabs, nextChatSessions) => {
          set((state) => ({
            terminalTabs: nextTerminalTabs,
            chatSessions: nextChatSessions,
            busyAction: state.busyAction === "chat" ? null : state.busyAction,
          }));
        }
      );
      consumeQueuedChatMessage(tabId);
    }
  },

  appendStreamChunk: (tabId, messageId, chunk, blocks) => {
    set((state) => {
      const session = state.chatSessions[tabId];
      if (!session) return {};
      const targetMessageId = resolveStreamingAssistantMessageId(session, messageId);
      if (!targetMessageId) return {};
      const chatSessions = {
        ...state.chatSessions,
        [tabId]: {
          ...session,
          messages: session.messages.map<ChatMessage>((message) =>
            message.id === targetMessageId
              ? {
                  ...message,
                  rawContent: (message.rawContent ?? message.content) + chunk,
                  content: normalizeAssistantContent(
                    (message.rawContent ?? message.content) + chunk
                  ),
                  contentFormat: "plain",
                  blocks: blocks ?? message.blocks ?? null,
                }
              : message
          ),
          updatedAt: nowIso(),
        },
      };
      return { chatSessions };
    });
    const session = get().chatSessions[tabId];
    if (!session) return;
    const targetMessageId = resolveStreamingAssistantMessageId(session, messageId);
    if (!targetMessageId) return;
    const message = session.messages.find((item) => item.id === targetMessageId);
    if (!message) return;
    enqueueMessagePersistence(() =>
      bridge.updateChatMessageStream({
        terminalTabId: tabId,
        messageId: targetMessageId,
        rawContent: message.rawContent ?? message.content,
        content: message.content,
        contentFormat: message.contentFormat ?? null,
        blocks: message.blocks ?? null,
        updatedAt: session.updatedAt,
      })
    );
  },

  finalizeStream: (
    tabId,
    messageId,
    exitCode,
    durationMs,
    finalContent,
    contentFormat,
    blocks,
    transportSession,
    transportKind,
    interruptedByUser
  ) => {
    const completionNotice = interruptedByUser
      ? null
      : buildTerminalCompletionNotice(
          get(),
          tabId,
          messageId,
          exitCode,
          durationMs,
          finalContent
        );
    const systemMessage = interruptedByUser
      ? ({
          id: createId("msg"),
          role: "system" as const,
          cliId:
            get().chatSessions[tabId]?.messages.find((message) => message.id === messageId)?.cliId ??
            null,
          timestamp: nowIso(),
          content: "用户中断回复",
          transportKind: null,
          blocks: null,
          isStreaming: false,
          durationMs: null,
          exitCode: 130,
        } satisfies ChatMessage)
      : null;

    set((state) => {
      const session = state.chatSessions[tabId];
      if (!session) return {};
      const targetMessageId = resolveStreamingAssistantMessageId(session, messageId);
      if (!targetMessageId) return {};
      const terminalTabs = state.terminalTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              status: "idle" as const,
              transportSessions: transportSession
                ? {
                    ...normalizeTransportSessions(tab),
                    [transportSession.cliId]: createTransportSession(
                      transportSession.cliId,
                      transportSession
                    ),
                  }
                : normalizeTransportSessions(tab),
            }
          : tab
      );
      const effectiveTransportKind =
        transportKind ??
        session.messages.find((message) => message.id === targetMessageId)?.transportKind ??
        null;
      const resolvedBlocks = blocks ?? session.messages.find((message) => message.id === targetMessageId)?.blocks ?? null;
      const finalizedSession: ConversationSession = {
        ...session,
        messages: [
          ...session.messages.map<ChatMessage>((message) => {
            if (message.id !== targetMessageId) {
              return message;
            }

            const resolvedRawContent = finalContent ?? message.rawContent ?? message.content;
            const needsInterruptedFallback =
              Boolean(interruptedByUser) &&
              !resolvedRawContent.trim() &&
              (resolvedBlocks?.length ?? 0) === 0;

            return {
              ...message,
              rawContent: needsInterruptedFallback ? INTERRUPTED_STREAM_TEXT : resolvedRawContent,
              content: normalizeAssistantContent(
                needsInterruptedFallback ? INTERRUPTED_STREAM_TEXT : resolvedRawContent
              ),
              contentFormat:
                needsInterruptedFallback
                  ? "log"
                  : contentFormat ?? detectAssistantContentFormat(resolvedRawContent),
              transportKind: effectiveTransportKind,
              blocks: needsInterruptedFallback
                ? [
                    {
                      kind: "status",
                      level: "warning",
                      text: INTERRUPTED_STREAM_TEXT,
                    } satisfies ChatMessageBlock,
                  ]
                : resolvedBlocks,
              isStreaming: false,
              exitCode,
              durationMs,
            };
          }),
          ...(systemMessage ? [systemMessage] : []),
        ],
        updatedAt: systemMessage?.timestamp ?? nowIso(),
      };
      const finalizedMessage = finalizedSession.messages.find((message) => message.id === targetMessageId) ?? null;
      const finalizedCliId = (transportSession?.cliId ?? finalizedMessage?.cliId ?? null) as AgentId | null;
      const nextTerminalTabs = terminalTabs.map((tab) =>
        tab.id === tabId && finalizedCliId
          ? {
              ...tab,
              contextBoundariesByCli: updateCliContextBoundary(
                tab,
                finalizedCliId,
                finalizedSession,
                targetMessageId
              ),
            }
          : tab
      );
      const chatSessions = {
        ...state.chatSessions,
        [tabId]: finalizedSession,
      };
      persistTerminalState(state.workspaces, nextTerminalTabs, state.activeTerminalTabId, chatSessions);
      return {
        busyAction: null,
        terminalTabs: nextTerminalTabs,
        chatSessions,
      };
    });
    const session = get().chatSessions[tabId];
    if (session) {
      const targetMessageId = resolveStreamingAssistantMessageId(session, messageId);
      const message = targetMessageId
        ? session.messages.find((item) => item.id === targetMessageId) ?? null
        : null;
      if (message) {
        enqueueMessagePersistence(() =>
          bridge.finalizeChatMessage({
            terminalTabId: tabId,
            messageId: message.id,
            rawContent: message.rawContent ?? message.content,
            content: message.content,
            contentFormat: message.contentFormat ?? null,
            blocks: message.blocks ?? null,
            transportKind: message.transportKind ?? null,
            transportSession: transportSession ?? null,
            exitCode,
            durationMs,
            updatedAt: session.updatedAt,
          })
        );
      }
      if (systemMessage) {
        enqueueMessagePersistence(() =>
          bridge.appendChatMessages({
            seeds: [toPersistedSessionSeed(session, tabId, [systemMessage])],
          })
        );
      }
    }
    syncStreamingRecoveryWatch(
      () => {
        const current = get();
        return {
          workspaces: current.workspaces,
          terminalTabs: current.terminalTabs,
          activeTerminalTabId: current.activeTerminalTabId,
          chatSessions: current.chatSessions,
          settings: current.settings,
          busyAction: current.busyAction,
        };
      },
      (nextTerminalTabs, nextChatSessions) => {
        set((state) => ({
          terminalTabs: nextTerminalTabs,
          chatSessions: nextChatSessions,
          busyAction: state.busyAction === "chat" ? null : state.busyAction,
        }));
      }
    );

    const tab = get().terminalTabs.find((item) => item.id === tabId);
    if (tab) {
      // Run auto-compaction and publish cross-tab context after stream finalization
      get().runAutoCompact(tabId);
      get().publishTabContext(tabId);
      void get().refreshGitPanel(tab.workspaceId);
      void get().loadContextStore();
    }
    if (completionNotice) {
      void notifyTerminalCompletion(completionNotice);
    }
    consumeQueuedChatMessage(tabId);
  },

  respondAssistantApproval: async (requestId, decision) => {
    const activeTabForApproval =
      get().terminalTabs.find((tab) => tab.id === get().activeTerminalTabId) ?? null;
    const activeWorkspaceForApproval =
      get().workspaces.find((workspace) => workspace.id === activeTabForApproval?.workspaceId) ?? null;
    const approvalCli = resolveTerminalCliId(
      activeTabForApproval?.selectedCli,
      activeWorkspaceForApproval?.activeAgent ?? "codex"
    );
    const nextState =
      decision === "allowAlways"
        ? "approvedAlways"
        : decision === "allowOnce"
          ? "approved"
          : "denied";

    const updateApprovalState = (stateValue: "pending" | "approved" | "approvedAlways" | "denied") =>
      set((state) => {
        const chatSessions = Object.fromEntries(
          Object.entries(state.chatSessions).map(([tabId, session]) => [
            tabId,
            {
              ...session,
              messages: session.messages.map<ChatMessage>((message) => ({
                ...message,
                blocks:
                  message.blocks?.map((block) =>
                    block.kind === "approvalRequest" && block.requestId === requestId
                      ? { ...block, state: stateValue }
                      : block
                  ) ?? message.blocks ?? null,
              })),
            },
          ])
        );
        persistTerminalState(state.workspaces, state.terminalTabs, state.activeTerminalTabId, chatSessions);
        return { chatSessions };
      });

    updateApprovalState(nextState);
    const messagesToUpdate = Object.values(get().chatSessions).flatMap((session) =>
      session.messages.filter((message) =>
        message.blocks?.some(
          (block) => block.kind === "approvalRequest" && block.requestId === requestId
        )
      )
    );
    messagesToUpdate.forEach((message) => {
      enqueueMessagePersistence(() =>
        bridge.updateChatMessageBlocks({
          messageId: message.id,
          blocks:
            message.blocks?.map((block) =>
              block.kind === "approvalRequest" && block.requestId === requestId
                ? { ...block, state: nextState }
                : block
            ) ?? null,
        })
      );
    });

    try {
      const applied = await bridge.respondAssistantApproval(requestId, decision);
      if (!applied) {
        updateApprovalState("pending");
        set((state) => {
          const chatSessions = appendSystemMessageToSession(
            state.chatSessions,
            state.activeTerminalTabId ?? "",
            approvalCli,
            "Approval request was no longer pending.",
            1
          );
          persistTerminalState(state.workspaces, state.terminalTabs, state.activeTerminalTabId, chatSessions);
          return { chatSessions };
        });
      }
    } catch (error) {
      updateApprovalState("pending");
      const detail =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Unknown error";
      set((state) => {
        const chatSessions = appendSystemMessageToSession(
          state.chatSessions,
          state.activeTerminalTabId ?? "",
          approvalCli,
          `Failed to send approval response: ${detail}`,
          1
        );
        persistTerminalState(state.workspaces, state.terminalTabs, state.activeTerminalTabId, chatSessions);
        return { chatSessions };
      });
    }
  },

  applyGitPanel: (workspaceId, gitPanel) => {
    set((state) => {
      const workspaces = state.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? {
              ...workspace,
              branch: gitPanel.branch || workspace.branch,
            }
          : workspace
      );
      const appState = state.appState
        ? deriveActiveWorkspaceState(
            state.appState,
            workspaces,
            state.terminalTabs,
            state.activeTerminalTabId
          )
        : null;
      return {
        appState,
        workspaces,
        gitPanelsByWorkspace: {
          ...state.gitPanelsByWorkspace,
          [workspaceId]: gitPanel,
        },
      };
    });
  },

  loadGitPanel: async (workspaceId, projectRoot) => {
    try {
      const gitPanel = await bridge.getGitPanel(projectRoot, workspaceId);
      get().applyGitPanel(workspaceId, gitPanel);
    } catch {
      // ignore
    }
  },

  refreshGitPanel: async (workspaceId) => {
    const targetWorkspaceId =
      workspaceId ??
      get().workspaces.find((workspace) => workspace.id === get().terminalTabs.find((tab) => tab.id === get().activeTerminalTabId)?.workspaceId)?.id;
    const workspace = get().workspaces.find((item) => item.id === targetWorkspaceId);
    if (!workspace) return;
    await get().loadGitPanel(workspace.id, workspace.rootPath);
  },

  setGitCommitMessage: (workspaceId, message) => {
    set((state) => ({
      gitCommitMessageByWorkspace: {
        ...state.gitCommitMessageByWorkspace,
        [workspaceId]: message,
      },
      gitCommitErrorByWorkspace: {
        ...state.gitCommitErrorByWorkspace,
        [workspaceId]: null,
      },
    }));
  },

  stageGitFile: async (workspaceId, path) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    set((state) => ({
      gitCommitErrorByWorkspace: {
        ...state.gitCommitErrorByWorkspace,
        [workspaceId]: null,
      },
    }));
    try {
      await bridge.stageGitFile(workspace.rootPath, path, workspace.id);
      await get().refreshGitPanel(workspaceId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to stage file.";
      set((state) => ({
        gitCommitErrorByWorkspace: {
          ...state.gitCommitErrorByWorkspace,
          [workspaceId]: detail,
        },
      }));
    }
  },

  unstageGitFile: async (workspaceId, path) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    set((state) => ({
      gitCommitErrorByWorkspace: {
        ...state.gitCommitErrorByWorkspace,
        [workspaceId]: null,
      },
    }));
    try {
      await bridge.unstageGitFile(workspace.rootPath, path, workspace.id);
      await get().refreshGitPanel(workspaceId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to unstage file.";
      set((state) => ({
        gitCommitErrorByWorkspace: {
          ...state.gitCommitErrorByWorkspace,
          [workspaceId]: detail,
        },
      }));
    }
  },

  discardGitFile: async (workspaceId, path) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    set((state) => ({
      gitCommitErrorByWorkspace: {
        ...state.gitCommitErrorByWorkspace,
        [workspaceId]: null,
      },
    }));
    try {
      await bridge.discardGitFile(workspace.rootPath, path, workspace.id);
      await get().refreshGitPanel(workspaceId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to discard file changes.";
      set((state) => ({
        gitCommitErrorByWorkspace: {
          ...state.gitCommitErrorByWorkspace,
          [workspaceId]: detail,
        },
      }));
    }
  },

  commitGitChanges: async (workspaceId, options) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    const message = get().gitCommitMessageByWorkspace[workspaceId]?.trim() ?? "";
    if (!message) {
      set((state) => ({
        gitCommitErrorByWorkspace: {
          ...state.gitCommitErrorByWorkspace,
          [workspaceId]: "Commit message cannot be empty.",
        },
      }));
      return;
    }
    set((state) => ({
      gitCommitLoadingByWorkspace: {
        ...state.gitCommitLoadingByWorkspace,
        [workspaceId]: true,
      },
      gitCommitErrorByWorkspace: {
        ...state.gitCommitErrorByWorkspace,
        [workspaceId]: null,
      },
    }));
    try {
      await bridge.commitGitChanges(
        workspace.rootPath,
        message,
        {
          stageAll: options?.stageAll ?? false,
        },
        workspace.id
      );
      set((state) => ({
        gitCommitMessageByWorkspace: {
          ...state.gitCommitMessageByWorkspace,
          [workspaceId]: "",
        },
      }));
      await get().refreshGitPanel(workspaceId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to commit changes.";
      set((state) => ({
        gitCommitErrorByWorkspace: {
          ...state.gitCommitErrorByWorkspace,
          [workspaceId]: detail,
        },
      }));
    } finally {
      set((state) => ({
        gitCommitLoadingByWorkspace: {
          ...state.gitCommitLoadingByWorkspace,
          [workspaceId]: false,
        },
      }));
    }
  },

  openGitWorkbench: () => set({ gitWorkbenchOpen: true }),

  closeGitWorkbench: () => set({ gitWorkbenchOpen: false }),

  toggleGitWorkbench: () =>
    set((state) => ({
      gitWorkbenchOpen: !state.gitWorkbenchOpen,
    })),

  searchWorkspaceFiles: async (workspaceId, query) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace || !query.trim()) return [];
    try {
      const cached = searchWorkspaceFileIndex(workspace.id, query);
      if (cached.length > 0) {
        return cached;
      }
      const index = await loadWorkspaceFileIndex({
        workspaceId: workspace.id,
        projectRoot: workspace.rootPath,
      });
      const normalized = query.trim().toLowerCase();
      return index.files
        .filter((item) => {
          const relativePath = item.relativePath.toLowerCase();
          return relativePath.includes(normalized) || item.name.toLowerCase().includes(normalized);
        })
        .slice(0, 40);
    } catch {
      return [];
    }
  },

  loadCliSkills: async (cliId, workspaceId, force = false) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return [];

    const cacheKey = createCliSkillCacheKey(cliId, workspaceId);
    const current = get();
    const status = current.cliSkillStatusByContext[cacheKey];
    if (!force && status === "ready") {
      return current.cliSkillsByContext[cacheKey] ?? [];
    }
    if (!force && status === "loading") {
      return current.cliSkillsByContext[cacheKey] ?? [];
    }

    set((state) => ({
      cliSkillStatusByContext: {
        ...state.cliSkillStatusByContext,
        [cacheKey]: "loading",
      },
    }));

    try {
      const skills = await bridge.getCliSkills(cliId, workspace.rootPath, workspace.id);
      set((state) => ({
        cliSkillsByContext: {
          ...state.cliSkillsByContext,
          [cacheKey]: skills,
        },
        cliSkillStatusByContext: {
          ...state.cliSkillStatusByContext,
          [cacheKey]: "ready",
        },
      }));
      return skills;
    } catch {
      set((state) => ({
        cliSkillsByContext: {
          ...state.cliSkillsByContext,
          [cacheKey]: [],
        },
        cliSkillStatusByContext: {
          ...state.cliSkillStatusByContext,
          [cacheKey]: "error",
        },
      }));
      return [];
    }
  },

  loadAcpCapabilities: async (cliId, force = false) => {
    const current = get();
    const status = current.acpCapabilityStatusByCli[cliId];
    if (!force && status === "ready" && current.acpCapabilitiesByCli[cliId]) {
      return current.acpCapabilitiesByCli[cliId] ?? null;
    }
    if (!force && status === "loading") {
      return current.acpCapabilitiesByCli[cliId] ?? null;
    }

    set((state) => ({
      acpCapabilityStatusByCli: {
        ...state.acpCapabilityStatusByCli,
        [cliId]: "loading",
      },
    }));

    try {
      const capabilities = await bridge.getAcpCapabilities(cliId);
      set((state) => ({
        acpCapabilitiesByCli: {
          ...state.acpCapabilitiesByCli,
          [cliId]: capabilities,
        },
        acpCapabilityStatusByCli: {
          ...state.acpCapabilityStatusByCli,
          [cliId]: "ready",
        },
      }));
      return capabilities;
    } catch {
      set((state) => ({
        acpCapabilityStatusByCli: {
          ...state.acpCapabilityStatusByCli,
          [cliId]: "error",
        },
      }));
      return null;
    }
  },

  executeAcpCommand: async (command, tabId) => {
    const activeTabId = tabId ?? get().activeTerminalTabId;
    const tab = get().terminalTabs.find((item) => item.id === activeTabId);
    const workspace = get().workspaces.find((item) => item.id === tab?.workspaceId);
    if (!tab || !workspace) return;
    const effectiveCli = resolveTerminalCliId(tab.selectedCli, workspace.activeAgent);

    const pushSystemMessage = (content: string, exitCode = 0) =>
      get().appendChatSystemMessage(tab.id, effectiveCli, content, exitCode);

    switch (command.kind) {
      case "plan": {
        get().togglePlanMode(tab.id);
        return;
      }
      case "model": {
        const model = command.args[0]?.trim() ?? "";
        if (!model) {
          pushSystemMessage(
            `Current model for ${effectiveCli}: ${tab.modelOverrides[effectiveCli] ?? "default"}`
          );
          return;
        }
        set((state) => {
          const terminalTabs = state.terminalTabs.map((item) =>
            item.id === tab.id
              ? {
                  ...item,
                  modelOverrides: {
                    ...item.modelOverrides,
                    [effectiveCli]: model,
                  },
                }
              : item
          );
          persistTerminalState(state.workspaces, terminalTabs, state.activeTerminalTabId, state.chatSessions);
          return { terminalTabs };
        });
        pushSystemMessage(`Model for ${effectiveCli} set to: ${model}`);
        return;
      }
      case "permissions": {
        const mode = command.args[0]?.trim() ?? "";
        if (!mode) {
          pushSystemMessage(
            `Current permission mode for ${effectiveCli}: ${tab.permissionOverrides[effectiveCli] ?? "default"}`
          );
          return;
        }
        set((state) => {
          const terminalTabs = state.terminalTabs.map((item) =>
            item.id === tab.id
              ? {
                  ...item,
                  permissionOverrides: {
                    ...item.permissionOverrides,
                    [effectiveCli]: mode,
                  },
                }
              : item
          );
          persistTerminalState(state.workspaces, terminalTabs, state.activeTerminalTabId, state.chatSessions);
          return { terminalTabs };
        });
        pushSystemMessage(`Permission mode for ${effectiveCli} set to: ${mode}`);
        return;
      }
      case "effort": {
        const level = command.args[0]?.trim() ?? "";
        if (!level) {
          pushSystemMessage(`Current effort level: ${tab.effortLevel ?? "default"}`);
          return;
        }
        if (!["low", "medium", "high", "max"].includes(level)) {
          pushSystemMessage(`Invalid effort level '${level}'. Valid: low, medium, high, max`, 1);
          return;
        }
        set((state) => {
          const terminalTabs = state.terminalTabs.map((item) =>
            item.id === tab.id ? { ...item, effortLevel: level } : item
          );
          persistTerminalState(state.workspaces, terminalTabs, state.activeTerminalTabId, state.chatSessions);
          return { terminalTabs };
        });
        pushSystemMessage(`Effort level set to: ${level}`);
        return;
      }
      case "fast": {
        let systemMessage: ChatMessage | null = null;
        set((state) => {
          const terminalTabs = state.terminalTabs.map((item) =>
            item.id === tab.id ? { ...item, fastMode: !item.fastMode } : item
          );
          const nextTab = terminalTabs.find((item) => item.id === tab.id);
          systemMessage = {
            id: createId("msg"),
            role: "system" as const,
            cliId: effectiveCli,
            timestamp: nowIso(),
            content: `Fast mode: ${nextTab?.fastMode ? "ON" : "OFF"}`,
            isStreaming: false,
            durationMs: null,
            exitCode: 0,
          };
          const chatSessions = {
            ...state.chatSessions,
            [tab.id]: {
              ...state.chatSessions[tab.id],
              messages: [
                ...state.chatSessions[tab.id].messages,
                systemMessage!,
              ],
              updatedAt: nowIso(),
            },
          };
          persistTerminalState(state.workspaces, terminalTabs, state.activeTerminalTabId, chatSessions);
          return { terminalTabs, chatSessions };
        });
        const session = get().chatSessions[tab.id];
        if (session && systemMessage) {
          enqueueMessagePersistence(() =>
            bridge.appendChatMessages({
              seeds: [toPersistedSessionSeed(session, tab.id, [systemMessage!])],
            })
          );
        }
        return;
      }
      case "status": {
        const runtime = get().appState?.agents.find((agent) => agent.id === effectiveCli)?.runtime;
        pushSystemMessage(
          [
            `CLI: ${effectiveCli}`,
            `Workspace: ${workspace.name}`,
            `Installed: ${runtime?.installed ? "yes" : "no"}`,
            `Version: ${runtime?.version ?? "unknown"}`,
            `Model: ${tab.modelOverrides[effectiveCli] ?? "default"}`,
            `Permission mode: ${tab.permissionOverrides[effectiveCli] ?? "default"}`,
            `Plan mode: ${tab.planMode ? "ON" : "OFF"}`,
            `Fast mode: ${tab.fastMode ? "ON" : "OFF"}`,
            `Effort: ${tab.effortLevel ?? "default"}`,
          ].join("\n")
        );
        return;
      }
      case "help": {
        pushSystemMessage(formatSlashHelp(effectiveCli));
        return;
      }
      case "diff": {
        pushSystemMessage(formatDiffSummary(get().gitPanelsByWorkspace[workspace.id]));
        return;
      }
      case "recall": {
        const query = command.args.join(" ").trim();
        if (!query) {
          pushSystemMessage("Usage: /recall <search-query>", 1);
          return;
        }
        const session = get().chatSessions[tab.id];
        if (!session) {
          pushSystemMessage("No conversation history to search.", 1);
          return;
        }
        // Try semantic FTS5 search first, fall back to keyword search
        try {
          const chunks = await bridge.semanticRecall({
            query,
            terminalTabId: tab.id,
            limit: 15,
          });
          if (chunks.length > 0) {
            const lines = [`Semantic recall for "${query}" (${chunks.length} results):`];
            for (const chunk of chunks) {
              const cli = chunk.cliId ?? "system";
              const type = chunk.chunkType;
              lines.push(`  [${cli}/${type}] ${chunk.content.slice(0, 300)}`);
            }
            pushSystemMessage(lines.join("\n"));
          } else {
            // Fall back to local keyword search
            const results = recallSearch(session, query);
            pushSystemMessage(results);
          }
        } catch {
          // Fall back to local keyword search on bridge error
          const results = recallSearch(session, query);
          pushSystemMessage(results);
        }
        return;
      }
      default: {
        try {
          const result = await bridge.executeAcpCommand(command, effectiveCli);
          pushSystemMessage(result.output, result.success ? 0 : 1);
          if (["clear", "compact", "rewind"].includes(command.kind)) {
            await get().loadContextStore();
          }
        } catch {
          pushSystemMessage(`Error executing /${command.kind}`, 1);
        }
      }
    }
  },

  publishTabContext: (tabId) => {
    const session = get().chatSessions[tabId];
    const tab = get().terminalTabs.find((t) => t.id === tabId);
    const workspace = get().workspaces.find((w) => w.id === tab?.workspaceId);
    if (!session || !tab || !workspace) return;

    const effectiveCli = resolveTerminalCliId(tab.selectedCli, workspace.activeAgent);
    const entry = buildSharedContextEntry(session, tab, effectiveCli);
    if (!entry) return;

    set((state) => ({
      sharedContext: {
        ...state.sharedContext,
        [tabId]: entry,
      },
    }));
  },

  getRelatedTabContexts: (tabId) => {
    const state = get();
    const tab = state.terminalTabs.find((t) => t.id === tabId);
    if (!tab) return [];

    // Return entries from other tabs in the same workspace
    return Object.values(state.sharedContext).filter(
      (entry) => {
        if (entry.sourceTabId === tabId) return false;
        const sourceTab = state.terminalTabs.find((t) => t.id === entry.sourceTabId);
        return sourceTab?.workspaceId === tab.workspaceId;
      }
    );
  },

  runAutoCompact: (tabId) => {
    const session = get().chatSessions[tabId];
    const tab = get().terminalTabs.find((t) => t.id === tabId);
    const workspace = get().workspaces.find((w) => w.id === tab?.workspaceId);
    if (!session || !tab || !workspace) return;

    const effectiveCli = resolveTerminalCliId(tab.selectedCli, workspace.activeAgent);
    const result = autoCompact(session, effectiveCli);
    if (!result) return;

    set((state) => {
      const compactedSession: ConversationSession = {
        ...state.chatSessions[tabId],
        messages: result.messages,
        compactedSummaries: result.compactedSummaries,
        lastCompactedAt: result.lastCompactedAt,
        estimatedTokens: result.estimatedTokens,
        updatedAt: nowIso(),
      };
      const nextTerminalTabs = state.terminalTabs.map((currentTab) => {
        if (currentTab.id !== tabId) return currentTab;
        const currentBoundary = currentTab.contextBoundariesByCli[effectiveCli] ?? null;
        if (!currentBoundary) return currentTab;
        return {
          ...currentTab,
          contextBoundariesByCli: {
            ...normalizeContextBoundariesByCli(currentTab),
            [effectiveCli]: createCliContextBoundary({
              ...currentBoundary,
              lastCompactedSummaryVersion: latestCompactedSummaryVersion(compactedSession),
              workingMemorySnapshot: buildWorkingMemory(compactedSession.messages),
            }),
          },
        };
      });
      const chatSessions = {
        ...state.chatSessions,
        [tabId]: compactedSession,
      };
      persistTerminalState(state.workspaces, nextTerminalTabs, state.activeTerminalTabId, chatSessions);
      return { terminalTabs: nextTerminalTabs, chatSessions };
    });
  },
  };
});
