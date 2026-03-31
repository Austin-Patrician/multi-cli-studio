export type AgentId = "codex" | "claude" | "gemini";

export type AgentMode =
  | "writer"
  | "reviewer"
  | "architect"
  | "ui-designer"
  | "standby";

export type AgentStatus = "active" | "ready" | "busy" | "offline";

export type ActivityTone = "info" | "success" | "warning" | "danger";

export type AgentResourceKind = "mcp" | "plugin" | "extension" | "skill";

export interface AgentResourceItem {
  name: string;
  enabled: boolean;
  version?: string | null;
  source?: string | null;
  detail?: string | null;
}

export interface AgentResourceGroup {
  supported: boolean;
  items: AgentResourceItem[];
  error?: string | null;
}

export interface AgentRuntimeResources {
  mcp: AgentResourceGroup;
  plugin: AgentResourceGroup;
  extension: AgentResourceGroup;
  skill: AgentResourceGroup;
}

export interface AgentRuntime {
  installed: boolean;
  commandPath?: string | null;
  version?: string | null;
  lastError?: string | null;
  resources: AgentRuntimeResources;
}

export interface AgentCard {
  id: AgentId;
  label: string;
  mode: AgentMode;
  status: AgentStatus;
  specialty: string;
  summary: string;
  pendingAction: string;
  sessionRef: string;
  lastSync: string;
  runtime: AgentRuntime;
}

export interface WorkspaceState {
  projectName: string;
  projectRoot: string;
  branch: string;
  currentWriter: AgentId;
  activeAgent: AgentId;
  dirtyFiles: number;
  failingChecks: number;
  handoffReady: boolean;
  lastSnapshot?: string | null;
}

export interface TerminalLine {
  id: string;
  speaker: "system" | AgentId | "user";
  content: string;
  time?: string;
}

export interface HandoffPack {
  id: string;
  from: AgentId;
  to: AgentId;
  status: "ready" | "draft" | "blocked";
  goal: string;
  files: string[];
  risks: string[];
  nextStep: string;
  updatedAt: string;
}

export interface ReviewArtifact {
  id: string;
  source: AgentId | "system";
  title: string;
  kind: "diff" | "review" | "plan" | "ui-note";
  summary: string;
  confidence: "high" | "medium" | "low";
  createdAt?: string;
}

export interface ActivityItem {
  id: string;
  time: string;
  tone: ActivityTone;
  title: string;
  detail: string;
}

export interface EnvironmentState {
  backend: "browser" | "tauri";
  tauriReady: boolean;
  rustAvailable: boolean;
  notes: string[];
}

export interface WorkspaceRef {
  id: string;
  name: string;
  rootPath: string;
  branch: string;
  currentWriter: AgentId;
  activeAgent: AgentId;
  dirtyFiles: number;
  failingChecks: number;
  handoffReady: boolean;
  lastSnapshot?: string | null;
}

export type TerminalCliId = AgentId | "auto";

export interface TerminalTab {
  id: string;
  title: string;
  workspaceId: string;
  selectedCli: TerminalCliId;
  planMode: boolean;
  fastMode: boolean;
  effortLevel: string | null;
  modelOverrides: Partial<Record<AgentId, string>>;
  permissionOverrides: Partial<Record<AgentId, string>>;
  transportSessions: Partial<Record<AgentId, AgentTransportSession>>;
  draftPrompt: string;
  status: "idle" | "streaming";
  lastActiveAt: string;
}

export interface AppState {
  workspace: WorkspaceState;
  agents: AgentCard[];
  handoffs: HandoffPack[];
  artifacts: ReviewArtifact[];
  activity: ActivityItem[];
  terminalByAgent: Record<AgentId, TerminalLine[]>;
  environment: EnvironmentState;
}

export interface AgentPromptRequest {
  agentId: AgentId;
  prompt: string;
}

export interface ChatContextTurn {
  cliId: AgentId;
  userPrompt: string;
  assistantReply: string;
  timestamp: string;
}

export interface TerminalEvent {
  terminalTabId?: string;
  agentId: AgentId;
  line: TerminalLine;
}

/** Full record of one prompt->response interaction */
export interface ConversationTurn {
  id: string;
  agentId: AgentId;
  timestamp: string;
  userPrompt: string;
  composedPrompt: string;
  rawOutput: string;
  outputSummary: string;
  durationMs: number;
  exitCode: number | null;
  writeMode: boolean;
}

/** Handoff with real data */
export interface EnrichedHandoff {
  id: string;
  from: AgentId;
  to: AgentId;
  timestamp: string;
  gitDiff: string;
  changedFiles: string[];
  previousTurns: ConversationTurn[];
  userGoal: string;
  status: "ready" | "draft" | "completed";
}

/** Per-agent conversation memory */
export interface AgentContext {
  agentId: AgentId;
  conversationHistory: ConversationTurn[];
  totalTokenEstimate: number;
}

/** Source of truth for context across agent switches */
export interface ContextStore {
  agents: Record<AgentId, AgentContext>;
  conversationHistory: ConversationTurn[];
  handoffs: EnrichedHandoff[];
  maxTurnsPerAgent: number;
  maxOutputCharsPerTurn: number;
}

/** User-configurable settings */
export interface AppSettings {
  cliPaths: { codex: string; claude: string; gemini: string };
  projectRoot: string;
  maxTurnsPerAgent: number;
  maxOutputCharsPerTurn: number;
  processTimeoutMs: number;
  notifyOnTerminalCompletion: boolean;
}

// ── New chat types ──────────────────────────────────────────────────────

/** A single chat message in the unified conversation */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  cliId: AgentId | null;
  timestamp: string;
  content: string;
  rawContent?: string | null;
  contentFormat?: "markdown" | "plain" | "log" | null;
  transportKind?: AgentTransportKind | null;
  blocks?: ChatMessageBlock[] | null;
  isStreaming: boolean;
  durationMs: number | null;
  exitCode: number | null;
}

/** Project-scoped conversation session */
export interface ConversationSession {
  id: string;
  terminalTabId: string;
  workspaceId: string;
  projectRoot: string;
  projectName: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/** Replaces AgentPromptRequest for chat */
export interface ChatPromptRequest {
  cliId: AgentId;
  terminalTabId: string;
  prompt: string;
  projectRoot: string;
  recentTurns: ChatContextTurn[];
  writeMode: boolean;
  planMode: boolean;
  fastMode: boolean;
  effortLevel: string | null;
  modelOverride?: string | null;
  permissionOverride?: string | null;
  transportSession?: AgentTransportSession | null;
}

export interface AutoOrchestrationRequest {
  terminalTabId: string;
  prompt: string;
  projectRoot: string;
  recentTurns: ChatContextTurn[];
  planMode: boolean;
  fastMode: boolean;
  effortLevel: string | null;
  modelOverrides?: Partial<Record<AgentId, string>>;
  permissionOverrides?: Partial<Record<AgentId, string>>;
}

export type AssistantApprovalDecision = "allowOnce" | "allowAlways" | "deny";
export type AutoRouteAction = "run" | "switch" | "cancel";

export type AssistantContentFormat = NonNullable<ChatMessage["contentFormat"]>;

/** Streaming event from backend */
export interface StreamEvent {
  terminalTabId: string;
  messageId: string;
  chunk: string;
  done: boolean;
  exitCode?: number | null;
  durationMs?: number;
  finalContent?: string | null;
  contentFormat?: AssistantContentFormat | null;
  transportKind?: AgentTransportKind | null;
  transportSession?: AgentTransportSession | null;
  blocks?: ChatMessageBlock[] | null;
}

export interface FileMentionCandidate {
  id: string;
  name: string;
  relativePath: string;
  absolutePath?: string | null;
}

export interface CliSkillItem {
  name: string;
  displayName?: string | null;
  description?: string | null;
  path: string;
  scope?: string | null;
  source?: string | null;
}

export interface WorkspacePickResult {
  name: string;
  rootPath: string;
}

export interface GitFileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  previousPath?: string | null;
}

export interface GitFileDiff {
  path: string;
  status: GitFileChange["status"];
  previousPath?: string | null;
  diff: string;
}

export interface GitPanelData {
  isGitRepo: boolean;
  branch: string;
  recentChanges: GitFileChange[];
}

export type AgentTransportKind =
  | "codex-app-server"
  | "claude-cli"
  | "gemini-cli"
  | "gemini-acp"
  | "browser-fallback";

export interface AgentTransportSession {
  cliId: AgentId;
  kind: AgentTransportKind;
  threadId?: string | null;
  turnId?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  lastSyncAt?: string | null;
}

export type ChatMessageBlock =
  | {
      kind: "text";
      text: string;
      format: AssistantContentFormat;
    }
  | {
      kind: "reasoning";
      text: string;
    }
  | {
      kind: "command";
      label: string;
      command: string;
      status?: string | null;
      cwd?: string | null;
      exitCode?: number | null;
      output?: string | null;
    }
  | {
      kind: "fileChange";
      path: string;
      diff: string;
      changeType: "add" | "delete" | "update";
      movePath?: string | null;
      status?: string | null;
    }
  | {
      kind: "tool";
      tool: string;
      source?: string | null;
      status?: string | null;
      summary?: string | null;
    }
  | {
      kind: "approvalRequest";
      requestId: string;
      toolName: string;
      provider?: "claude" | "codex" | null;
      title?: string | null;
      description?: string | null;
      summary?: string | null;
      persistentLabel?: string | null;
      state?: "pending" | "approved" | "approvedAlways" | "denied" | null;
    }
  | {
      kind: "orchestrationPlan";
      title: string;
      goal: string;
      summary?: string | null;
      status?: "planning" | "running" | "synthesizing" | "completed" | "failed" | null;
    }
  | {
      kind: "orchestrationStep";
      stepId: string;
      owner: AgentId;
      title: string;
      summary?: string | null;
      result?: string | null;
      status?: "planned" | "running" | "completed" | "failed" | "skipped" | null;
    }
  | {
      kind: "autoRoute";
      targetCli: AgentId;
      title: string;
      reason: string;
      modeHint?: string | null;
      state?: "pending" | "accepted" | "switched" | "cancelled" | null;
    }
  | {
      kind: "plan";
      text: string;
    }
  | {
      kind: "status";
      level: "info" | "warning" | "error";
      text: string;
    };
