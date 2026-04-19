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

export type WorkspaceLocationKind = "local" | "ssh";
export type SshConnectionAuthMode = "agent" | "identityFile" | "password";

export interface CliPathsDetection {
  codex: string | null;
  claude: string | null;
  gemini: string | null;
}

export interface SshConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMode: SshConnectionAuthMode;
  identityFile: string;
  password: string;
  proxyJump: string;
  remoteShell: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string | null;
  detectedCliPaths?: CliPathsDetection;
}

export interface SshConnectionTestResult {
  reachable: boolean;
  authOk: boolean;
  pythonOk: boolean;
  shell: string | null;
  platform: string | null;
  detectedCliPaths: CliPathsDetection;
  errors: string[];
}

export interface WorkspaceRef {
  id: string;
  name: string;
  rootPath: string;
  locationKind: WorkspaceLocationKind;
  connectionId?: string | null;
  remotePath?: string | null;
  locationLabel?: string | null;
  branch: string;
  currentWriter: AgentId;
  activeAgent: AgentId;
  dirtyFiles: number;
  failingChecks: number;
  handoffReady: boolean;
  lastSnapshot?: string | null;
}

export type TerminalCliId = AgentId | "auto";

export interface SelectedCustomAgent {
  id: string;
  name: string;
  prompt?: string | null;
  icon?: string | null;
}

export interface CustomAgentConfig extends SelectedCustomAgent {
  createdAt?: number | null;
}

export interface TerminalCliContextBoundary {
  lastSeenMessageId: string | null;
  lastSeenAt: string | null;
  lastCompactedSummaryVersion: number | null;
  workingMemorySnapshot?: WorkingMemory | null;
}

export interface TerminalTab {
  id: string;
  title: string;
  workspaceId: string;
  selectedCli: TerminalCliId;
  selectedAgent?: SelectedCustomAgent | null;
  planMode: boolean;
  fastMode: boolean;
  effortLevel: string | null;
  modelOverrides: Partial<Record<AgentId, string>>;
  permissionOverrides: Partial<Record<AgentId, string>>;
  transportSessions: Partial<Record<AgentId, AgentTransportSession>>;
  contextBoundariesByCli: Partial<Record<AgentId, TerminalCliContextBoundary>>;
  draftPrompt: string;
  draftAttachments: ChatAttachment[];
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
export interface NotificationConfig {
  notifyOnCompletion: boolean;
  webhookUrl: string;
  webhookEnabled: boolean;
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  smtpFrom: string;
  emailRecipients: string[];
}

export interface UpdateConfig {
  autoCheckForUpdates: boolean;
  notifyOnUpdateAvailable: boolean;
}

export type ModelProviderServiceType = "openaiCompatible" | "claude" | "gemini";

export interface ModelProviderModel {
  id: string;
  name: string;
  label?: string | null;
}

export interface ModelProviderConfig {
  id: string;
  serviceType: ModelProviderServiceType;
  name: string;
  baseUrl: string;
  apiKey: string;
  websiteUrl: string;
  note: string;
  enabled: boolean;
  models: ModelProviderModel[];
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt?: string | null;
}

export interface ApiChatSelection {
  serviceType: ModelProviderServiceType;
  providerId: string;
  modelId: string;
}

export interface ApiChatGenerationMeta extends ApiChatSelection {
  providerName?: string | null;
  modelLabel?: string | null;
  requestedAt?: string | null;
  completedAt?: string | null;
}

export interface ApiChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  error?: boolean;
  attachments?: ChatAttachment[] | null;
  generationMeta?: ApiChatGenerationMeta | null;
  rawContent?: string | null;
  contentFormat?: AssistantContentFormat | null;
  blocks?: ChatMessageBlock[] | null;
  durationMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}

export interface ApiChatSession {
  id: string;
  title: string;
  defaultSelection?: ApiChatSelection | null;
  messages: ApiChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiChatRequest {
  selection: ApiChatSelection;
  messages: ApiChatMessage[];
  streamId?: string | null;
}

export interface ApiChatResponse {
  selection: ApiChatSelection;
  message: ApiChatMessage;
}

export interface ApiChatStreamEvent {
  streamId: string;
  messageId: string;
  chunk: string;
  done: boolean;
  rawContent?: string | null;
  content?: string | null;
  contentFormat?: AssistantContentFormat | null;
  blocks?: ChatMessageBlock[] | null;
  durationMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}

export interface AppSettings {
  cliPaths: { codex: string; claude: string; gemini: string };
  sshConnections: SshConnectionConfig[];
  customAgents: CustomAgentConfig[];
  projectRoot: string;
  maxTurnsPerAgent: number;
  maxOutputCharsPerTurn: number;
  modelChatContextTurnLimit: number;
  processTimeoutMs: number;
  notifyOnTerminalCompletion: boolean;
  notificationConfig: NotificationConfig;
  updateConfig: UpdateConfig;
  openaiCompatibleProviders: ModelProviderConfig[];
  claudeProviders: ModelProviderConfig[];
  geminiProviders: ModelProviderConfig[];
}

export type AutomationRunStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type AutomationGoalStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type AutomationEventLevel = "info" | "success" | "warning" | "error";
export type AutomationExecutionMode = TerminalCliId;
export type AutomationPermissionProfile = "standard" | "full-access" | "read-only";
export type AutomationLifecycleStatus = "queued" | "running" | "validating" | "stopped" | "finished";
export type AutomationOutcomeStatus = "unknown" | "success" | "failed" | "partial";
export type AutomationAttentionStatus = "none" | "waiting_human" | "blocked_by_policy" | "blocked_by_environment";

export interface AutomationGoalDraft {
  title?: string | null;
  goal: string;
  expectedOutcome: string;
  executionMode?: AutomationExecutionMode | null;
  ruleConfig?: AutomationGoalRuleConfig | null;
}

export interface AutomationEvent {
  id: string;
  runId: string;
  goalId?: string | null;
  level: AutomationEventLevel;
  title: string;
  detail: string;
  createdAt: string;
}

export interface AutomationGoal {
  id: string;
  runId: string;
  title: string;
  goal: string;
  expectedOutcome: string;
  executionMode: AutomationExecutionMode;
  lifecycleStatus?: AutomationLifecycleStatus;
  outcomeStatus?: AutomationOutcomeStatus;
  attentionStatus?: AutomationAttentionStatus;
  resolutionCode?: string | null;
  statusSummary?: string | null;
  objectiveSignals?: AutomationObjectiveSignals | null;
  judgeAssessment?: AutomationJudgeAssessment | null;
  validationResult?: AutomationValidationResult | null;
  status: AutomationGoalStatus;
  position: number;
  roundCount: number;
  consecutiveFailureCount: number;
  noProgressRounds: number;
  ruleConfig: AutomationGoalRuleConfig;
  lastOwnerCli?: AgentId | null;
  resultSummary?: string | null;
  latestProgressSummary?: string | null;
  nextInstruction?: string | null;
  requiresAttentionReason?: string | null;
  relevantFiles: string[];
  syntheticTerminalTabId: string;
  lastExitCode?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  jobId?: string | null;
  jobName?: string | null;
  triggerSource?: string | null;
  runNumber?: number | null;
  workflowRunId?: string | null;
  workflowNodeId?: string | null;
  permissionProfile?: AutomationPermissionProfile;
  parameterValues?: Record<string, AutomationParameterValue>;
  workspaceId: string;
  projectRoot: string;
  projectName: string;
  ruleProfileId: string;
  lifecycleStatus?: AutomationLifecycleStatus;
  outcomeStatus?: AutomationOutcomeStatus;
  attentionStatus?: AutomationAttentionStatus;
  resolutionCode?: string | null;
  statusSummary?: string | null;
  objectiveSignals?: AutomationObjectiveSignals | null;
  judgeAssessment?: AutomationJudgeAssessment | null;
  validationResult?: AutomationValidationResult | null;
  status: AutomationRunStatus;
  scheduledStartAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  summary?: string | null;
  createdAt: string;
  updatedAt: string;
  goals: AutomationGoal[];
  events: AutomationEvent[];
}

export interface AutomationGoalRuleConfig {
  allowAutoSelectStrategy: boolean;
  allowSafeWorkspaceEdits: boolean;
  allowSafeChecks: boolean;
  pauseOnCredentials: boolean;
  pauseOnExternalInstalls: boolean;
  pauseOnDestructiveCommands: boolean;
  pauseOnGitPush: boolean;
  maxRoundsPerGoal: number;
  maxConsecutiveFailures: number;
  maxNoProgressRounds: number;
}

export interface AutomationRuleProfile {
  id: string;
  label: string;
}
export interface AutomationRuleProfile extends AutomationGoalRuleConfig {}

export interface CreateAutomationRunRequest {
  workspaceId: string;
  projectRoot: string;
  projectName: string;
  scheduledStartAt?: string | null;
  ruleProfileId?: string | null;
  goals: AutomationGoalDraft[];
}

export type AutomationParameterValue = string | number | boolean | null;
export type AutomationParameterKind = "string" | "boolean" | "enum";

export interface AutomationParameterDefinition {
  id: string;
  key: string;
  label: string;
  kind: AutomationParameterKind;
  description?: string | null;
  required: boolean;
  options: string[];
  defaultValue?: AutomationParameterValue;
}

export interface AutomationJobDraft {
  workspaceId: string;
  projectRoot: string;
  projectName: string;
  name: string;
  description?: string | null;
  goal: string;
  expectedOutcome: string;
  defaultExecutionMode: AutomationExecutionMode;
  permissionProfile: AutomationPermissionProfile;
  ruleConfig: AutomationGoalRuleConfig;
  parameterDefinitions: AutomationParameterDefinition[];
  defaultParameterValues: Record<string, AutomationParameterValue>;
  cronExpression?: string | null;
  emailNotificationEnabled: boolean;
  enabled: boolean;
}

export interface AutomationJob extends AutomationJobDraft {
  id: string;
  lastTriggeredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutomationRunFromJobRequest {
  jobId: string;
  scheduledStartAt?: string | null;
  executionMode?: AutomationExecutionMode | null;
  parameterValues?: Record<string, AutomationParameterValue> | null;
}

export type AutomationWorkflowContextStrategy =
  | "resume-per-cli"
  | "kernel-only"
  | "session-pool";

export type AutomationWorkflowBranchResult = "success" | "fail";

export interface AutomationWorkflowNodeLayout {
  x: number;
  y: number;
}

export interface AutomationWorkflowNodeDraft {
  id?: string | null;
  label?: string | null;
  goal: string;
  expectedOutcome: string;
  executionMode: AutomationExecutionMode | "inherit";
  permissionProfile: AutomationPermissionProfile | "inherit";
  reuseSession: boolean;
  layout?: AutomationWorkflowNodeLayout | null;
}

export interface AutomationWorkflowEdgeDraft {
  fromNodeId: string;
  on: AutomationWorkflowBranchResult;
  toNodeId: string;
}

export interface AutomationWorkflowDraft {
  workspaceId: string;
  projectRoot: string;
  projectName: string;
  name: string;
  description?: string | null;
  cronExpression?: string | null;
  emailNotificationEnabled: boolean;
  enabled: boolean;
  entryNodeId?: string | null;
  defaultContextStrategy: AutomationWorkflowContextStrategy;
  defaultExecutionMode: AutomationExecutionMode;
  defaultPermissionProfile: AutomationPermissionProfile;
  nodes: AutomationWorkflowNodeDraft[];
  edges: AutomationWorkflowEdgeDraft[];
}

export interface AutomationWorkflowNode {
  id: string;
  label: string;
  goal: string;
  expectedOutcome: string;
  executionMode: AutomationExecutionMode | "inherit";
  permissionProfile: AutomationPermissionProfile | "inherit";
  reuseSession: boolean;
  layout: AutomationWorkflowNodeLayout;
}

export interface AutomationWorkflowEdge {
  fromNodeId: string;
  on: AutomationWorkflowBranchResult;
  toNodeId: string;
}

export interface WorkflowCliSessionRef {
  cliId: AgentId;
  kind: AgentTransportKind;
  threadId?: string | null;
  turnId?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  lastSyncAt?: string | null;
}

export interface AutomationWorkflow extends AutomationWorkflowDraft {
  id: string;
  entryNodeId: string;
  nodes: AutomationWorkflowNode[];
  edges: AutomationWorkflowEdge[];
  lastTriggeredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutomationWorkflowRunRequest {
  workflowId: string;
  scheduledStartAt?: string | null;
}

export interface AutomationWorkflowNodeRun {
  id: string;
  workflowRunId: string;
  nodeId: string;
  label: string;
  goal: string;
  automationRunId?: string | null;
  status: string;
  branchResult?: AutomationWorkflowBranchResult | null;
  usedCli?: AgentId | null;
  transportSession?: WorkflowCliSessionRef | null;
  statusSummary?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt: string;
}

export interface AutomationWorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  triggerSource: string;
  workspaceId: string;
  projectRoot: string;
  projectName: string;
  status: string;
  statusSummary?: string | null;
  scheduledStartAt?: string | null;
  sharedTerminalTabId: string;
  entryNodeId: string;
  currentNodeId?: string | null;
  emailNotificationEnabled: boolean;
  cliSessions: WorkflowCliSessionRef[];
  nodeRuns: AutomationWorkflowNodeRun[];
  events: AutomationEvent[];
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunRecord {
  id: string;
  jobId?: string | null;
  jobName: string;
  projectName: string;
  projectRoot: string;
  workspaceId: string;
  executionMode: AutomationExecutionMode;
  permissionProfile: AutomationPermissionProfile;
  triggerSource: string;
  runNumber?: number | null;
  status: AutomationRunStatus;
  displayStatus: string;
  lifecycleStatus: AutomationLifecycleStatus;
  outcomeStatus: AutomationOutcomeStatus;
  attentionStatus: AutomationAttentionStatus;
  resolutionCode: string;
  statusSummary?: string | null;
  summary?: string | null;
  requiresAttentionReason?: string | null;
  objectiveSignals: AutomationObjectiveSignals;
  judgeAssessment: AutomationJudgeAssessment;
  validationResult: AutomationValidationResult;
  relevantFiles: string[];
  lastExitCode?: number | null;
  terminalTabId?: string | null;
  parameterValues: Record<string, AutomationParameterValue>;
  scheduledStartAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunDetail {
  run: AutomationRunRecord;
  job?: AutomationJob | null;
  ruleConfig: AutomationGoalRuleConfig;
  goal: string;
  expectedOutcome: string;
  events: AutomationEvent[];
  conversationSession?: {
    id: string;
    terminalTabId: string;
    workspaceId: string;
    projectRoot: string;
    projectName: string;
    messages: ChatMessage[];
    compactedSummaries: CompactedSummary[];
    lastCompactedAt?: string | null;
    estimatedTokens?: number;
    createdAt: string;
    updatedAt: string;
  } | null;
  taskContext?: {
    taskPacket: {
      id: string;
      terminalTabId: string;
      workspaceId: string;
      projectRoot: string;
      projectName: string;
      title: string;
      goal: string;
      status: string;
      currentOwnerCli: string;
      latestConclusion?: string | null;
      openQuestions: string[];
      risks: string[];
      nextStep?: string | null;
      relevantFiles: string[];
      relevantCommands: string[];
      linkedSessionIds: string[];
      latestSnapshotId?: string | null;
      updatedAt: string;
      createdAt: string;
    };
    latestHandoff?: unknown;
    latestSnapshot?: {
      id: string;
      taskId: string;
      triggerReason: string;
      summary: string;
      factsConfirmed: string[];
      workCompleted: string[];
      filesTouched: string[];
      commandsRun: string[];
      failures: string[];
      openQuestions: string[];
      nextStep?: string | null;
      sourceUserPrompt?: string | null;
      sourceAssistantSummary?: string | null;
      createdAt: string;
    } | null;
    latestBoundary?: unknown;
  } | null;
}

export interface AutomationWorkflowRunDetail {
  run: AutomationWorkflowRun;
  workflow?: AutomationWorkflow | null;
  childRuns: AutomationRunRecord[];
  conversationSession?: AutomationRunDetail["conversationSession"] | null;
  taskContext?: AutomationRunDetail["taskContext"] | null;
}

export interface AutomationObjectiveSignals {
  exitCode?: number | null;
  checksPassed: boolean;
  checksFailed: boolean;
  artifactsProduced: boolean;
  filesChanged: number;
  policyBlocks: string[];
}

export interface AutomationJudgeAssessment {
  madeProgress: boolean;
  expectedOutcomeMet: boolean;
  suggestedDecision?: string | null;
  reason?: string | null;
}

export interface AutomationValidationResult {
  decision?: "pass" | "fail_with_feedback" | "blocked" | null;
  reason?: string | null;
  feedback?: string | null;
  evidenceSummary?: string | null;
  missingChecks?: string[];
  verificationSteps?: string[];
  madeProgress: boolean;
  expectedOutcomeMet: boolean;
}

// ── New chat types ──────────────────────────────────────────────────────

/** A single chat message in the unified conversation */
export type ChatAttachmentKind = "image" | "fileReference";

export interface ChatAttachment {
  id: string;
  kind: ChatAttachmentKind;
  fileName: string;
  mediaType?: string | null;
  source: string;
  displayPath?: string | null;
}

export interface PickedChatAttachment {
  fileName: string;
  mediaType?: string | null;
  path?: string | null;
  source?: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  cliId: AgentId | null;
  selectedAgent?: SelectedCustomAgent | null;
  automationRunId?: string | null;
  workflowRunId?: string | null;
  workflowNodeId?: string | null;
  timestamp: string;
  content: string;
  rawContent?: string | null;
  contentFormat?: "markdown" | "plain" | "log" | null;
  transportKind?: AgentTransportKind | null;
  blocks?: ChatMessageBlock[] | null;
  attachments?: ChatAttachment[] | null;
  isStreaming: boolean;
  durationMs: number | null;
  exitCode: number | null;
}

// ── Compaction types ──────────────────────────────────────────────────

/** Structured summary produced by compacting a conversation segment */
export interface CompactedSummary {
  id: string;
  sourceTabId: string;
  sourceCli: AgentId;
  timestamp: string;
  /** User's primary goal / intent */
  intent: string;
  /** Files, functions, architecture decisions involved */
  technicalContext: string;
  /** File paths modified during the compacted segment */
  changedFiles: string[];
  /** Errors encountered and how they were resolved */
  errorsAndFixes: string;
  /** Where work stood when segment was compacted */
  currentState: string;
  /** Remaining work / next actions */
  nextSteps: string;
  /** Rough token count of the summary itself */
  tokenEstimate: number;
  /** Monotonic version — bumped on re-compaction */
  version: number;
}

/** A cross-tab context entry published by one tab for consumption by siblings */
export interface SharedContextEntry {
  id: string;
  sourceTabId: string;
  sourceTabTitle: string;
  sourceCli: AgentId;
  summary: CompactedSummary;
  /** When the entry was last refreshed */
  updatedAt: string;
}

/** Live working memory — structured project state updated after every finalize */
export interface WorkingMemory {
  modifiedFiles: string[];
  activeErrors: string[];
  recentCommands: string[];
  buildStatus: "unknown" | "passing" | "failing";
  keyDecisions: string[];
  /** Which CLIs contributed to this working memory */
  contributingClis: AgentId[];
  updatedAt: string;
}

/** Structured handoff document generated on CLI switch for deep context injection */
export interface HandoffDocument {
  fromCli: AgentId;
  toCli: AgentId;
  /** Full recent turns (token-budget-aware, not fixed count) */
  recentTurns: ChatContextTurn[];
  /** Structured working memory snapshot */
  workingMemory: WorkingMemory;
  /** High-confidence kernel facts */
  kernelFacts: string[];
  /** Compacted history summaries */
  compactedSummaries: CompactedSummary[];
  /** Cross-tab context entries */
  crossTabEntries: SharedContextEntry[];
  /** Semantic memory recall results for deep context (from FTS5 search) */
  semanticContext?: SemanticMemoryChunk[];
  timestamp: string;
}

/** A chunk returned from semantic FTS5-based recall search */
export interface SemanticMemoryChunk {
  terminalTabId: string;
  cliId: string;
  messageId: string;
  chunkType: string;
  content: string;
  createdAt: string;
  rank: number;
}

/** Request payload for semantic recall queries */
export interface SemanticRecallRequest {
  query: string;
  terminalTabId?: string | null;
  limit?: number | null;
}

export interface KernelSessionRef {
  id: string;
  taskId: string;
  terminalTabId: string;
  cliId: AgentId;
  transportKind?: AgentTransportKind | null;
  nativeSessionId?: string | null;
  nativeTurnId?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  resumeCapable: boolean;
  state: "active" | "stale" | "broken" | "archived";
  lastSyncAt: string;
}

export interface KernelFact {
  id: string;
  taskId: string;
  kind:
    | "requirement"
    | "environment"
    | "codebase"
    | "runtime"
    | "decision"
    | "risk"
    | "output";
  statement: string;
  status: "verified" | "inferred" | "pending" | "invalidated";
  sourceEvidenceIds: string[];
  ownerCli: AgentId;
  confidence: "high" | "medium" | "low";
  updatedAt: string;
}

export interface KernelEvidence {
  id: string;
  taskId: string;
  messageId: string;
  terminalTabId: string;
  cliId: AgentId;
  evidenceType: "command" | "fileChange" | "toolCall" | "assistantMessage" | "status";
  summary: string;
  payloadRef?: string | null;
  timestamp: string;
}

export interface TaskKernel {
  taskPacket: {
    id: string;
    terminalTabId: string;
    workspaceId: string;
    projectRoot: string;
    projectName: string;
    title: string;
    goal: string;
    status: string;
    currentOwnerCli: string;
    latestConclusion?: string | null;
    openQuestions: string[];
    risks: string[];
    nextStep?: string | null;
    relevantFiles: string[];
    relevantCommands: string[];
    linkedSessionIds: string[];
    latestSnapshotId?: string | null;
    updatedAt: string;
    createdAt: string;
  };
  latestHandoff?: unknown;
  latestCheckpoint?: {
    id: string;
    taskId: string;
    triggerReason: string;
    summary: string;
    factsConfirmed: string[];
    workCompleted: string[];
    filesTouched: string[];
    commandsRun: string[];
    failures: string[];
    openQuestions: string[];
    nextStep?: string | null;
    sourceUserPrompt?: string | null;
    sourceAssistantSummary?: string | null;
    createdAt: string;
  } | null;
  activePlan?: {
    id: string;
    taskId: string;
    title: string;
    goal: string;
    summary?: string | null;
    status: string;
    updatedAt: string;
  } | null;
  workItems: Array<{
    id: string;
    taskId: string;
    stepId?: string | null;
    ownerCli: AgentId;
    title: string;
    summary?: string | null;
    result?: string | null;
    status: string;
    updatedAt: string;
  }>;
  currentWorkItem?: {
    id: string;
    taskId: string;
    stepId?: string | null;
    ownerCli: AgentId;
    title: string;
    summary?: string | null;
    result?: string | null;
    status: string;
    updatedAt: string;
  } | null;
  memoryEntries: Array<{
    id: string;
    scope: "task" | "workspace" | "global";
    scopeRef: string;
    kind: string;
    content: string;
    sourceFactId?: string | null;
    sourceEvidenceIds: string[];
    updatedAt: string;
  }>;
  sessionRefs: KernelSessionRef[];
  facts: KernelFact[];
  evidence: KernelEvidence[];
}

/** Project-scoped conversation session */
export interface ConversationSession {
  id: string;
  terminalTabId: string;
  workspaceId: string;
  projectRoot: string;
  projectName: string;
  messages: ChatMessage[];
  /** Compacted summaries from earlier conversation segments */
  compactedSummaries: CompactedSummary[];
  /** ISO timestamp of last compaction, null if never compacted */
  lastCompactedAt: string | null;
  /** Estimated total token count for prompt-construction budgeting */
  estimatedTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedTerminalState {
  workspaces: WorkspaceRef[];
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;
  chatSessions: Record<string, ConversationSession>;
}

export interface ChatSessionSeed {
  terminalTabId: string;
  session: ConversationSession;
  messages: ChatMessage[];
}

export interface ChatMessagesAppendRequest {
  seeds: ChatSessionSeed[];
}

export interface ChatMessageStreamUpdateRequest {
  terminalTabId: string;
  messageId: string;
  rawContent: string;
  content: string;
  contentFormat?: ChatMessage["contentFormat"];
  blocks?: ChatMessageBlock[] | null;
  updatedAt: string;
}

export interface ChatMessageFinalizeRequest {
  terminalTabId: string;
  messageId: string;
  rawContent: string;
  content: string;
  contentFormat?: ChatMessage["contentFormat"];
  blocks?: ChatMessageBlock[] | null;
  transportKind?: AgentTransportKind | null;
  transportSession?: AgentTransportSession | null;
  exitCode: number | null;
  durationMs: number | null;
  updatedAt: string;
}

export interface ChatMessageDeleteRequest {
  terminalTabId: string;
  messageId: string;
}

export interface ChatMessageBlocksUpdateRequest {
  messageId: string;
  blocks?: ChatMessageBlock[] | null;
}

/** Replaces AgentPromptRequest for chat */
export interface ChatPromptRequest {
  cliId: AgentId;
  terminalTabId: string;
  workspaceId: string;
  assistantMessageId: string;
  prompt: string;
  projectRoot: string;
  projectName: string;
  recentTurns: ChatContextTurn[];
  writeMode: boolean;
  planMode: boolean;
  fastMode: boolean;
  effortLevel: string | null;
  modelOverride?: string | null;
  permissionOverride?: string | null;
  imageAttachments?: string[] | null;
  transportSession?: AgentTransportSession | null;
  /** Compacted history from this tab's earlier conversation segments */
  compactedSummaries?: CompactedSummary[] | null;
  /** Summaries from sibling tabs in the same workspace */
  crossTabContext?: SharedContextEntry[] | null;
  /** Structured working memory for context continuity */
  workingMemory?: WorkingMemory | null;
  /** Handoff document injected on the first turn after a CLI switch */
  handoffContext?: string | null;
}

export interface AutoOrchestrationRequest {
  terminalTabId: string;
  workspaceId: string;
  assistantMessageId: string;
  prompt: string;
  projectRoot: string;
  projectName: string;
  recentTurns: ChatContextTurn[];
  planMode: boolean;
  fastMode: boolean;
  effortLevel: string | null;
  modelOverrides?: Partial<Record<AgentId, string>>;
  permissionOverrides?: Partial<Record<AgentId, string>>;
}

export interface CliHandoffRequest {
  terminalTabId: string;
  workspaceId: string;
  projectRoot: string;
  projectName: string;
  fromCli: AgentId;
  toCli: AgentId;
  reason?: string | null;
  latestUserPrompt?: string | null;
  latestAssistantSummary?: string | null;
  relevantFiles?: string[];
  /** Compressed history from the outgoing CLI */
  compactedHistory?: CompactedSummary | null;
  /** Summaries from sibling tabs */
  crossTabContext?: SharedContextEntry[] | null;
  /** Structured handoff document for deep context injection */
  handoffDocument?: HandoffDocument | null;
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
  interruptedByUser?: boolean | null;
}

export interface ChatInterruptResult {
  status: "accepted" | "notRunning" | "failed";
  accepted: boolean;
  pending: boolean;
  message?: string | null;
}

export interface FileMentionCandidate {
  id: string;
  name: string;
  relativePath: string;
  absolutePath?: string | null;
}

export interface WorkspaceTextSearchMatch {
  line: number;
  column: number;
  endColumn: number;
  preview: string;
}

export interface WorkspaceTextSearchFileResult {
  path: string;
  matchCount: number;
  matches: WorkspaceTextSearchMatch[];
}

export interface WorkspaceTextSearchResponse {
  files: WorkspaceTextSearchFileResult[];
  fileCount: number;
  matchCount: number;
  limitHit: boolean;
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

export interface WorkspaceTreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  hasChildren: boolean;
}

export interface WorkspaceFileIndexResponse {
  entriesByParent: Record<string, WorkspaceTreeEntry[]>;
  files: FileMentionCandidate[];
}

export type SettingsEngineType = "claude" | "codex" | "gemini";

export interface SettingsEngineStatus {
  engineType: SettingsEngineType;
  installed: boolean;
  version: string | null;
  binPath: string | null;
  error: string | null;
}

export interface CodexRuntimeReloadResult {
  status: string;
  stage: string;
  restartedSessions: number;
  message?: string | null;
}

export interface GlobalMcpServerEntry {
  name: string;
  enabled: boolean;
  transport?: string | null;
  command?: string | null;
  url?: string | null;
  argsCount: number;
  source: "claude_json" | "ccgui_config";
}

export interface ExternalDirectoryEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
}

export interface ExternalTextFile {
  exists: boolean;
  content: string;
  truncated: boolean;
}

export interface VendorConfigField {
  label: string;
  value: string;
  tone?: "default" | "muted" | "warn" | "success";
  monospace?: boolean;
}

export interface VendorLocalConfigEntry {
  id: string;
  name: string;
  sourcePath: string;
  summary: string;
  meta?: string | null;
  badgeLabel?: string | null;
  badgeTone?: "default" | "muted" | "warn" | "success";
  fields: VendorConfigField[];
}

export interface GitFileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  previousPath?: string | null;
}

export interface GitFileStatus extends GitFileChange {
  additions: number;
  deletions: number;
}

export interface GitFileDiff {
  path: string;
  status: GitFileChange["status"];
  previousPath?: string | null;
  diff: string;
  originalContent?: string | null;
  modifiedContent?: string | null;
  language?: string | null;
  isBinary?: boolean;
}

export interface GitPanelData {
  isGitRepo: boolean;
  branch: string;
  fileStatus: string;
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  recentChanges: GitFileChange[];
}

export interface GitLogEntry {
  sha: string;
  summary: string;
  author: string;
  timestamp: number;
}

export interface GitLogResponse {
  total: number;
  entries: GitLogEntry[];
  ahead: number;
  behind: number;
  aheadEntries: GitLogEntry[];
  behindEntries: GitLogEntry[];
  upstream: string | null;
}

export interface GitOverviewResponse {
  panel: GitPanelData;
  log: GitLogResponse;
}

export interface GitHistoryCommit {
  sha: string;
  shortSha: string;
  summary: string;
  message: string;
  author: string;
  authorEmail: string;
  timestamp: number;
  parents: string[];
  refs: string[];
}

export interface GitHistoryResponse {
  snapshotId: string;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  commits: GitHistoryCommit[];
}

export interface GitPushPreviewResponse {
  sourceBranch: string;
  targetRemote: string;
  targetBranch: string;
  targetRef: string;
  targetFound: boolean;
  hasMore: boolean;
  commits: GitHistoryCommit[];
}

export interface GitCommitFileChange {
  path: string;
  oldPath?: string | null;
  status: string;
  additions: number;
  deletions: number;
  isBinary?: boolean;
  isImage?: boolean;
  diff: string;
  lineCount: number;
  truncated: boolean;
}

export interface GitCommitDetails {
  sha: string;
  summary: string;
  message: string;
  author: string;
  authorEmail: string;
  committer: string;
  committerEmail: string;
  authorTime: number;
  commitTime: number;
  parents: string[];
  files: GitCommitFileChange[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface GitBranchListItem {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  remote?: string | null;
  upstream?: string | null;
  lastCommit: number;
  headSha?: string | null;
  ahead: number;
  behind: number;
}

export interface GitBranchListResponse {
  localBranches: GitBranchListItem[];
  remoteBranches: GitBranchListItem[];
  currentBranch?: string | null;
}

export interface GitHubUser {
  login: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
}

export interface GitHubIssuesResponse {
  total: number;
  issues: GitHubIssue[];
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  createdAt: string;
  body: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  author: GitHubUser | null;
}

export interface GitHubPullRequestsResponse {
  total: number;
  pullRequests: GitHubPullRequest[];
}

export type LocalUsageUsageData = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
};

export type LocalUsageSessionSummary = {
  sessionId: string;
  sessionIdAliases?: string[];
  timestamp: number;
  model: string;
  usage: LocalUsageUsageData;
  cost: number;
  summary?: string | null;
  source?: string | null;
  provider?: string | null;
  fileSizeBytes?: number;
  modifiedLines?: number;
};

export type LocalUsageDailyUsage = {
  date: string;
  sessions: number;
  usage: LocalUsageUsageData;
  cost: number;
  modelsUsed: string[];
};

export type LocalUsageModelUsage = {
  model: string;
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  sessionCount: number;
};

export type LocalUsageEngineUsage = {
  engine: string;
  count: number;
};

export type LocalUsageDailyCodeChange = {
  date: string;
  modifiedLines: number;
};

export type LocalUsageWeekData = {
  sessions: number;
  cost: number;
  tokens: number;
};

export type LocalUsageTrends = {
  sessions: number;
  cost: number;
  tokens: number;
};

export type LocalUsageWeeklyComparison = {
  currentWeek: LocalUsageWeekData;
  lastWeek: LocalUsageWeekData;
  trends: LocalUsageTrends;
};

export type LocalUsageStatistics = {
  projectPath: string;
  projectName: string;
  totalSessions: number;
  totalUsage: LocalUsageUsageData;
  estimatedCost: number;
  sessions: LocalUsageSessionSummary[];
  dailyUsage: LocalUsageDailyUsage[];
  weeklyComparison: LocalUsageWeeklyComparison;
  byModel: LocalUsageModelUsage[];
  totalEngineUsageCount: number;
  engineUsage: LocalUsageEngineUsage[];
  aiCodeModifiedLines: number;
  dailyCodeChanges: LocalUsageDailyCodeChange[];
  lastUpdated: number;
};

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
