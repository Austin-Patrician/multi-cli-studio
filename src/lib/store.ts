import { create } from "zustand";
import { bridge } from "./bridge";
import {
  AgentId,
  AgentTransportKind,
  AgentTransportSession,
  AutoRouteAction,
  AppSettings,
  AppState,
  AssistantApprovalDecision,
  ChatMessage,
  ChatMessageBlock,
  ChatContextTurn,
  ContextStore,
  ConversationSession,
  FileMentionCandidate,
  GitPanelData,
  TerminalCliId,
  TerminalLine,
  TerminalTab,
  WorkspacePickResult,
  WorkspaceRef,
} from "./models";
import { ACP_COMMANDS, AcpCliCapabilities, AcpCommand } from "./acp";
import {
  detectAssistantContentFormat,
  normalizeAssistantContent,
  summarizeForContext,
} from "./messageFormatting";

const TERMINAL_STATE_KEY = "multi-cli-studio::terminal-state";
const DEFAULT_PROCESS_TIMEOUT_MS = 300000;
const STREAM_RUNTIME_STALE_GRACE_MS = 10000;
const STREAM_RUNTIME_STALE_MIN_MS = 60000;
const STREAM_STALE_CHECK_MS = 3000;
const INTERRUPTED_STREAM_TEXT = "Response interrupted before completion. You can retry this prompt.";
const PARTIAL_STREAM_TEXT = "Streaming stopped before completion. This response may be partial.";

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
  return {
    id: partial?.id ?? createId("workspace"),
    name: partial?.name ?? basename(rootPath),
    rootPath,
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
    planMode: partial?.planMode ?? false,
    fastMode: partial?.fastMode ?? false,
    effortLevel: partial?.effortLevel ?? null,
    modelOverrides: partial?.modelOverrides ?? {},
    permissionOverrides: partial?.permissionOverrides ?? {},
    transportSessions: partial?.transportSessions ?? {},
    draftPrompt: partial?.draftPrompt ?? "",
    status: partial?.status ?? "idle",
    lastActiveAt: partial?.lastActiveAt ?? nowIso(),
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
    createdAt: partial?.createdAt ?? nowIso(),
    updatedAt: partial?.updatedAt ?? nowIso(),
  };
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
      isStreaming: false,
    }));
}

interface PersistedTerminalState {
  workspaces: WorkspaceRef[];
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;
  chatSessions: Record<string, ConversationSession>;
}

type PersistableTerminalState = Pick<
  PersistedTerminalState,
  "workspaces" | "terminalTabs" | "activeTerminalTabId" | "chatSessions"
>;

let draftPromptPersistTimer: number | null = null;
let streamingRecoveryInterval: number | null = null;

function loadPersistedTerminalState(): PersistedTerminalState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(TERMINAL_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedTerminalState;
  } catch {
    return null;
  }
}

function persistTerminalState(
  workspaces: WorkspaceRef[],
  terminalTabs: TerminalTab[],
  activeTerminalTabId: string | null,
  chatSessions: Record<string, ConversationSession>
) {
  if (typeof window === "undefined") return;
  const payload: PersistedTerminalState = {
    workspaces,
    terminalTabs,
    activeTerminalTabId,
    chatSessions,
  };
  window.localStorage.setItem(TERMINAL_STATE_KEY, JSON.stringify(payload));
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

function buildRecentTabContextTurns(
  messages: ChatMessage[],
  fallbackCli: AgentId,
  limit = 4
): ChatContextTurn[] {
  const turns: ChatContextTurn[] = [];
  let pendingUser: ChatMessage | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      pendingUser = message;
      continue;
    }

    if (
      message.role !== "assistant" ||
      message.isStreaming ||
      !pendingUser ||
      (message.exitCode != null && message.exitCode !== 0)
    ) {
      continue;
    }

    turns.push({
      cliId: (message.cliId ?? fallbackCli) as AgentId,
      userPrompt: pendingUser.content,
      assistantReply: summarizeForContext(message.rawContent ?? message.content),
      timestamp: message.timestamp,
    });
    pendingUser = null;
  }

  return turns.slice(-limit);
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

interface StoreState {
  appState: AppState | null;
  contextStore: ContextStore | null;
  settings: AppSettings | null;
  busyAction: string | null;
  acpCapabilitiesByCli: Partial<Record<AgentId, AcpCliCapabilities>>;
  acpCapabilityStatusByCli: Partial<Record<AgentId, "idle" | "loading" | "ready" | "error">>;

  workspaces: WorkspaceRef[];
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;
  chatSessions: Record<string, ConversationSession>;
  gitPanelsByWorkspace: Record<string, GitPanelData>;

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

  openWorkspaceFolder: () => Promise<void>;
  createTerminalTab: (workspaceId?: string) => void;
  cloneTerminalTab: (sourceTabId?: string) => void;
  closeTerminalTab: (tabId: string) => void;
  setActiveTerminalTab: (tabId: string) => void;
  setTabSelectedCli: (tabId: string, cliId: TerminalCliId) => void;
  setTabDraftPrompt: (tabId: string, prompt: string) => void;
  togglePlanMode: (tabId?: string) => void;

  sendChatMessage: (tabId: string, prompt?: string) => Promise<void>;
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
    transportKind?: AgentTransportKind | null
  ) => void;
  loadGitPanel: (workspaceId: string, projectRoot: string) => Promise<void>;
  refreshGitPanel: (workspaceId?: string) => Promise<void>;
  searchWorkspaceFiles: (workspaceId: string, query: string) => Promise<FileMentionCandidate[]>;
  loadAcpCapabilities: (cliId: AgentId, force?: boolean) => Promise<AcpCliCapabilities | null>;
  respondAssistantApproval: (requestId: string, decision: AssistantApprovalDecision) => Promise<void>;

  executeAcpCommand: (command: AcpCommand, tabId?: string) => Promise<void>;
}

export const useStore = create<StoreState>((set, get) => ({
  appState: null,
  contextStore: null,
  settings: null,
  busyAction: null,
  acpCapabilitiesByCli: {},
  acpCapabilityStatusByCli: {},
  workspaces: [],
  terminalTabs: [],
  activeTerminalTabId: null,
  chatSessions: {},
  gitPanelsByWorkspace: {},

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
    set((state) => {
      const chatSessions = appendSystemMessageToSession(
        state.chatSessions,
        tabId,
        cliId,
        content,
        exitCode
      );
      persistTerminalState(state.workspaces, state.terminalTabs, state.activeTerminalTabId, chatSessions);
      return { chatSessions };
    });
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
  },

  loadInitialState: async (projectRoot) => {
    const state = await bridge.loadAppState(projectRoot);
    let workspaces: WorkspaceRef[] = [];
    let terminalTabs: TerminalTab[] = [];
    let chatSessions: Record<string, ConversationSession> = {};
    let activeTerminalTabId: string | null = null;

    const persisted = loadPersistedTerminalState();
    if (persisted && persisted.workspaces.length > 0 && persisted.terminalTabs.length > 0) {
      workspaces = persisted.workspaces;
      terminalTabs = persisted.terminalTabs.map((tab) =>
        createTerminalTab(
          workspaces.find((workspace) => workspace.id === tab.workspaceId) ??
            createWorkspaceRef(tab.workspaceId, { id: tab.workspaceId, name: tab.title, rootPath: tab.workspaceId }),
          {
            ...tab,
            transportSessions: normalizeTransportSessions(tab),
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

    terminalTabs.forEach((tab) => {
      if (!chatSessions[tab.id]) {
        const workspace = workspaces.find((item) => item.id === tab.workspaceId);
        if (workspace) {
          chatSessions[tab.id] = createConversationSession(tab, workspace);
        }
      }
    });

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
    });

    persistTerminalState(workspaces, terminalTabs, activeTerminalTabId, chatSessions);
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

    await get().loadGitPanel(workspace.id, workspace.rootPath);
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
      planMode: sourceTab.planMode,
      fastMode: sourceTab.fastMode,
      effortLevel: sourceTab.effortLevel,
      modelOverrides: { ...sourceTab.modelOverrides },
      permissionOverrides: { ...sourceTab.permissionOverrides },
      transportSessions: {},
      draftPrompt: "",
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

    set((state) => {
      const appState = state.appState
        ? deriveActiveWorkspaceState(state.appState, state.workspaces, remainingTabs, nextActive)
        : null;
      persistTerminalState(state.workspaces, remainingTabs, nextActive, chatSessions);
      return {
        appState,
        terminalTabs: remainingTabs,
        activeTerminalTabId: nextActive,
        chatSessions,
      };
    });
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
  },

  setTabSelectedCli: (tabId, cliId) => {
    set((state) => {
      const terminalTabs = state.terminalTabs.map((tab) =>
        tab.id === tabId ? { ...tab, selectedCli: cliId } : tab
      );
      const activeTab = terminalTabs.find((tab) => tab.id === tabId);
      const workspaces = state.workspaces.map((workspace) =>
        workspace.id === activeTab?.workspaceId && cliId !== "auto"
          ? { ...workspace, activeAgent: cliId }
          : workspace
      );
      const appState = state.appState
        ? deriveActiveWorkspaceState(state.appState, workspaces, terminalTabs, state.activeTerminalTabId)
        : null;
      persistTerminalState(workspaces, terminalTabs, state.activeTerminalTabId, state.chatSessions);
      return { appState, workspaces, terminalTabs };
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

  togglePlanMode: (tabId) => {
    const targetTabId = tabId ?? get().activeTerminalTabId;
    if (!targetTabId) return;
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
      const chatSessions = activeTab
        ? {
            ...state.chatSessions,
            [targetTabId]: {
              ...state.chatSessions[targetTabId],
              messages: [
                ...state.chatSessions[targetTabId].messages,
                {
                  id: createId("msg"),
                  role: "system" as const,
                  cliId: effectiveCli,
                  timestamp: nowIso(),
                  content: `Plan mode: ${activeTab.planMode ? "ON" : "OFF"}`,
                  isStreaming: false,
                  durationMs: null,
                  exitCode: 0,
                },
              ],
              updatedAt: nowIso(),
            },
          }
        : state.chatSessions;
      persistTerminalState(state.workspaces, terminalTabs, state.activeTerminalTabId, chatSessions);
      return { terminalTabs, chatSessions };
    });
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
      const terminalTabs = state.terminalTabs.map((item) =>
        item.id === tabId && action === "switch"
          ? { ...item, selectedCli: routeBlock.targetCli }
          : item
      );
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

    if (action === "run") {
      set((state) => {
        const terminalTabs = state.terminalTabs.map((item) =>
          item.id === tabId ? { ...item, selectedCli: routeBlock.targetCli } : item
        );
        persistTerminalState(state.workspaces, terminalTabs, state.activeTerminalTabId, state.chatSessions);
        return { terminalTabs };
      });
      await get().sendChatMessage(tabId, pendingRoute.content);
      return;
    }

    if (action === "switch") {
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

  sendChatMessage: async (tabId, prompt) => {
    const state = get();
    const tab = state.terminalTabs.find((item) => item.id === tabId);
    const workspace = state.workspaces.find((item) => item.id === tab?.workspaceId);
    const session = state.chatSessions[tabId];
    if (!tab || !workspace || !session) return;
    const effectiveCli = resolveTerminalCliId(tab.selectedCli, workspace.activeAgent);

    const text = (prompt ?? tab.draftPrompt).trim();
    if (!text || tab.status === "streaming") return;

    if (tab.selectedCli === "auto") {
      const userMessage: ChatMessage = {
        id: createId("msg"),
        role: "user",
        cliId: null,
        timestamp: nowIso(),
        content: text,
        transportKind: null,
        blocks: null,
        isStreaming: false,
        durationMs: null,
        exitCode: null,
      };
      const pendingMessage: ChatMessage = {
        id: createId("msg-pending"),
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
            goal: text,
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
          item.id === tabId ? { ...item, draftPrompt: "", status: "streaming" as const } : item
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
          prompt: text,
          projectRoot: workspace.rootPath,
          recentTurns: buildRecentTabContextTurns(session.messages, "claude"),
          planMode: tab.planMode,
          fastMode: tab.fastMode,
          effortLevel: tab.effortLevel,
          modelOverrides: tab.modelOverrides,
          permissionOverrides: tab.permissionOverrides,
        });

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
      }
      return;
    }

      const userMessage: ChatMessage = {
        id: createId("msg"),
        role: "user",
        cliId: effectiveCli,
        timestamp: nowIso(),
        content: text,
        transportKind: tab.transportSessions[effectiveCli]?.kind ?? defaultTransportKind(effectiveCli),
        blocks: null,
        isStreaming: false,
        durationMs: null,
        exitCode: null,
    };
    const pendingMessage: ChatMessage = {
      id: createId("msg-pending"),
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
        item.id === tabId ? { ...item, draftPrompt: "", status: "streaming" as const } : item
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
      const messageId = await bridge.sendChatMessage({
        cliId: effectiveCli,
        terminalTabId: tab.id,
        prompt: text,
        projectRoot: workspace.rootPath,
        recentTurns,
        writeMode,
        planMode: tab.planMode,
        fastMode: tab.fastMode,
        effortLevel: tab.effortLevel,
        modelOverride: tab.modelOverrides[effectiveCli] ?? null,
        permissionOverride: tab.permissionOverrides[effectiveCli] ?? null,
        transportSession: tab.transportSessions[effectiveCli] ?? null,
      });

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
    transportKind
  ) => {
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
      const chatSessions = {
        ...state.chatSessions,
        [tabId]: {
          ...session,
          messages: session.messages.map<ChatMessage>((message) =>
            message.id === targetMessageId
              ? {
                  ...message,
                  rawContent: finalContent ?? message.rawContent ?? message.content,
                  content: normalizeAssistantContent(
                    finalContent ?? message.rawContent ?? message.content
                  ),
                  contentFormat:
                    contentFormat ??
                    detectAssistantContentFormat(finalContent ?? message.rawContent ?? message.content),
                  transportKind: effectiveTransportKind,
                  blocks: blocks ?? message.blocks ?? null,
                  isStreaming: false,
                  exitCode,
                  durationMs,
                }
              : message
          ),
          updatedAt: nowIso(),
        },
      };
      persistTerminalState(state.workspaces, terminalTabs, state.activeTerminalTabId, chatSessions);
      return { busyAction: null, terminalTabs, chatSessions };
    });
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
      void get().refreshGitPanel(tab.workspaceId);
      void get().loadContextStore();
    }
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

  loadGitPanel: async (workspaceId, projectRoot) => {
    try {
      const gitPanel = await bridge.getGitPanel(projectRoot);
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

  searchWorkspaceFiles: async (workspaceId, query) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace || !query.trim()) return [];
    try {
      return await bridge.searchWorkspaceFiles(workspace.rootPath, query);
    } catch {
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
        set((state) => {
          const terminalTabs = state.terminalTabs.map((item) =>
            item.id === tab.id ? { ...item, fastMode: !item.fastMode } : item
          );
          const nextTab = terminalTabs.find((item) => item.id === tab.id);
          const chatSessions = {
            ...state.chatSessions,
            [tab.id]: {
              ...state.chatSessions[tab.id],
              messages: [
                ...state.chatSessions[tab.id].messages,
                {
                  id: createId("msg"),
                  role: "system" as const,
                  cliId: effectiveCli,
                  timestamp: nowIso(),
                  content: `Fast mode: ${nextTab?.fastMode ? "ON" : "OFF"}`,
                  isStreaming: false,
                  durationMs: null,
                  exitCode: 0,
                },
              ],
              updatedAt: nowIso(),
            },
          };
          persistTerminalState(state.workspaces, terminalTabs, state.activeTerminalTabId, chatSessions);
          return { terminalTabs, chatSessions };
        });
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
}));
