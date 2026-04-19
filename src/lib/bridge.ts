import { browserRuntime } from "./browserRuntime";
import {
  AgentId,
  AgentPromptRequest,
  ApiChatRequest,
  ApiChatResponse,
  ApiChatStreamEvent,
  AutomationJob,
  AutomationJobDraft,
  AutomationGoalRuleConfig,
  AutomationWorkflow,
  AutomationWorkflowDraft,
  AutomationWorkflowRun,
  AutomationWorkflowRunDetail,
  AutomationRunDetail,
  AutomationRunRecord,
  AutomationRun,
  AutomationRuleProfile,
  AutoOrchestrationRequest,
  AppSettings,
  AppState,
  ChatMessageBlocksUpdateRequest,
  ChatMessageDeleteRequest,
  ChatMessageFinalizeRequest,
  ChatMessagesAppendRequest,
  ChatMessageStreamUpdateRequest,
  ChatInterruptResult,
  ChatPromptRequest,
  PickedChatAttachment,
  AssistantApprovalDecision,
  CliHandoffRequest,
  ContextStore,
  ConversationSession,
  ConversationTurn,
  CreateAutomationRunFromJobRequest,
  CreateAutomationRunRequest,
  CreateAutomationWorkflowRunRequest,
  CliSkillItem,
  ExternalDirectoryEntry,
  ExternalTextFile,
  FileMentionCandidate,
  GlobalMcpServerEntry,
  GitFileDiff,
  GitBranchListResponse,
  GitCommitDetails,
  GitHubIssuesResponse,
  GitHubPullRequestsResponse,
  GitHistoryResponse,
  GitPushPreviewResponse,
  GitLogResponse,
  GitOverviewResponse,
  GitFileStatus,
  GitPanelData,
  NotificationConfig,
  ModelProviderConfig,
  ModelProviderServiceType,
  LocalUsageStatistics,
  PersistedTerminalState,
  SemanticMemoryChunk,
  SemanticRecallRequest,
  CodexRuntimeReloadResult,
  SettingsEngineStatus,
  SshConnectionConfig,
  SshConnectionTestResult,
  StreamEvent,
  TerminalEvent,
  WorkspacePickResult,
  WorkspaceTextSearchResponse,
  WorkspaceFileIndexResponse,
  WorkspaceTreeEntry,
} from "./models";
import type {
  AcpCliCapabilities,
  AcpCommand,
  AcpCommandDef,
  AcpCommandResult,
  AcpSession,
} from "./acp";

type Unlisten = () => void;

export type RuntimeLogOutputEvent = {
  workspaceId: string;
  terminalId: string;
  data: string;
};

export type RuntimeLogSessionStatus =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export type RuntimeLogSessionSnapshot = {
  workspaceId: string;
  terminalId: string;
  status: RuntimeLogSessionStatus;
  commandPreview: string | null;
  profileId?: string | null;
  detectedStack?: string | null;
  startedAtMs: number | null;
  stoppedAtMs: number | null;
  exitCode: number | null;
  error: string | null;
};

export type RuntimeProfileDescriptor = {
  id: string;
  defaultCommand: string;
  detectedStack: string;
};

export interface RuntimeBridge {
  loadAppState: (projectRoot?: string, refreshRuntime?: boolean) => Promise<AppState>;
  switchActiveAgent: (agentId: AgentId) => Promise<AppState>;
  takeOverWriter: (agentId: AgentId) => Promise<AppState>;
  snapshotWorkspace: () => Promise<AppState>;
  runChecks: (projectRoot?: string, cliId?: AgentId, terminalTabId?: string) => Promise<string>;
  submitPrompt: (request: AgentPromptRequest) => Promise<string>;
  requestReview: (agentId: AgentId) => Promise<string>;
  onState: (listener: (state: AppState) => void) => Promise<Unlisten>;
  onTerminal: (listener: (event: TerminalEvent) => void) => Promise<Unlisten>;
  getContextStore: () => Promise<ContextStore>;
  getConversationHistory: (agentId: AgentId) => Promise<ConversationTurn[]>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: AppSettings) => Promise<AppSettings>;
  refreshProviderModels: (
    serviceType: ModelProviderServiceType,
    providerId: string
  ) => Promise<ModelProviderConfig>;
  sendApiChatMessage: (request: ApiChatRequest) => Promise<ApiChatResponse>;
  onApiChatStream: (listener: (event: ApiChatStreamEvent) => void) => Promise<Unlisten>;
  sendTestEmailNotification: (config: NotificationConfig) => Promise<string>;
  loadTerminalState: () => Promise<PersistedTerminalState | null>;
  loadTerminalSession: (terminalTabId: string) => Promise<ConversationSession | null>;
  saveTerminalState: (state: PersistedTerminalState) => Promise<void>;
  switchCliForTask: (request: CliHandoffRequest) => Promise<void>;
  appendChatMessages: (request: ChatMessagesAppendRequest) => Promise<void>;
  updateChatMessageStream: (request: ChatMessageStreamUpdateRequest) => Promise<void>;
  finalizeChatMessage: (request: ChatMessageFinalizeRequest) => Promise<void>;
  deleteChatMessage: (request: ChatMessageDeleteRequest) => Promise<void>;
  deleteChatSessionByTab: (terminalTabId: string) => Promise<void>;
  updateChatMessageBlocks: (request: ChatMessageBlocksUpdateRequest) => Promise<void>;
  listAutomationJobs: () => Promise<AutomationJob[]>;
  getAutomationJob: (jobId: string) => Promise<AutomationJob>;
  createAutomationJob: (job: AutomationJobDraft) => Promise<AutomationJob>;
  updateAutomationJob: (jobId: string, job: AutomationJobDraft) => Promise<AutomationJob>;
  deleteAutomationJob: (jobId: string) => Promise<void>;
  listAutomationWorkflows: () => Promise<AutomationWorkflow[]>;
  getAutomationWorkflow: (workflowId: string) => Promise<AutomationWorkflow>;
  createAutomationWorkflow: (workflow: AutomationWorkflowDraft) => Promise<AutomationWorkflow>;
  updateAutomationWorkflow: (workflowId: string, workflow: AutomationWorkflowDraft) => Promise<AutomationWorkflow>;
  deleteAutomationWorkflow: (workflowId: string) => Promise<void>;
  listAutomationJobRuns: (jobId?: string | null) => Promise<AutomationRunRecord[]>;
  getAutomationRunDetail: (runId: string) => Promise<AutomationRunDetail>;
  listAutomationRuns: () => Promise<AutomationRun[]>;
  listAutomationWorkflowRuns: (workflowId?: string | null) => Promise<AutomationWorkflowRun[]>;
  getAutomationWorkflowRunDetail: (workflowRunId: string) => Promise<AutomationWorkflowRunDetail>;
  getAutomationRuleProfile: () => Promise<AutomationRuleProfile>;
  updateAutomationRuleProfile: (profile: AutomationRuleProfile) => Promise<AutomationRuleProfile>;
  updateAutomationGoalRuleConfig: (goalId: string, ruleConfig: AutomationGoalRuleConfig) => Promise<AutomationRun>;
  createAutomationRun: (request: CreateAutomationRunRequest) => Promise<AutomationRun>;
  createAutomationRunFromJob: (request: CreateAutomationRunFromJobRequest) => Promise<AutomationRunRecord>;
  createAutomationWorkflowRun: (request: CreateAutomationWorkflowRunRequest) => Promise<AutomationWorkflowRun>;
  startAutomationRun: (runId: string) => Promise<AutomationRun>;
  pauseAutomationRun: (runId: string) => Promise<AutomationRun>;
  resumeAutomationRun: (runId: string) => Promise<AutomationRun>;
  resumeAutomationWorkflowRun: (workflowRunId: string) => Promise<AutomationWorkflowRun>;
  restartAutomationRun: (runId: string) => Promise<AutomationRun>;
  pauseAutomationGoal: (goalId: string) => Promise<AutomationRun>;
  resumeAutomationGoal: (goalId: string) => Promise<AutomationRun>;
  cancelAutomationRun: (runId: string) => Promise<AutomationRun>;
  deleteAutomationRun: (runId: string) => Promise<void>;
  cancelAutomationWorkflowRun: (workflowRunId: string) => Promise<AutomationWorkflowRun>;
  deleteAutomationWorkflowRun: (workflowRunId: string) => Promise<void>;
  saveTextToDownloads: (fileName: string, content: string) => Promise<string>;
  // Chat methods
  sendChatMessage: (request: ChatPromptRequest) => Promise<string>;
  interruptChatTurn: (terminalTabId: string, messageId: string) => Promise<ChatInterruptResult>;
  runAutoOrchestration: (request: AutoOrchestrationRequest) => Promise<string>;
  respondAssistantApproval: (requestId: string, decision: AssistantApprovalDecision) => Promise<boolean>;
  getGitPanel: (projectRoot: string, workspaceId?: string | null) => Promise<GitPanelData>;
  getGitOverview: (projectRoot: string, workspaceId?: string | null) => Promise<GitOverviewResponse>;
  getGitFileDiff: (projectRoot: string, path: string, workspaceId?: string | null) => Promise<GitFileDiff>;
  getGitLog: (projectRoot: string, workspaceId?: string | null) => Promise<GitLogResponse>;
  getGitCommitHistory: (
    projectRoot: string,
    options?: {
      branch?: string | null;
      query?: string | null;
      offset?: number;
      limit?: number;
      snapshotId?: string | null;
    },
    workspaceId?: string | null
  ) => Promise<GitHistoryResponse>;
  getGitPushPreview: (
    projectRoot: string,
    options: {
      remote: string;
      branch: string;
      limit?: number;
    },
    workspaceId?: string | null
  ) => Promise<GitPushPreviewResponse>;
  getGitCommitDetails: (
    projectRoot: string,
    commitHash: string,
    maxDiffLines?: number,
    workspaceId?: string | null
  ) => Promise<GitCommitDetails>;
  listGitBranches: (projectRoot: string, workspaceId?: string | null) => Promise<GitBranchListResponse>;
  checkoutGitBranch: (projectRoot: string, name: string, workspaceId?: string | null) => Promise<void>;
  createGitBranch: (
    projectRoot: string,
    name: string,
    sourceRef?: string | null,
    checkoutAfterCreate?: boolean,
    workspaceId?: string | null
  ) => Promise<void>;
  renameGitBranch: (
    projectRoot: string,
    oldName: string,
    newName: string,
    workspaceId?: string | null
  ) => Promise<void>;
  deleteGitBranch: (projectRoot: string, name: string, force?: boolean, workspaceId?: string | null) => Promise<void>;
  mergeGitBranch: (projectRoot: string, sourceBranch: string, workspaceId?: string | null) => Promise<void>;
  fetchGit: (projectRoot: string, remote?: string | null, workspaceId?: string | null) => Promise<void>;
  pullGit: (
    projectRoot: string,
    remote?: string | null,
    targetBranch?: string | null,
    pullOption?: string | null,
    workspaceId?: string | null,
  ) => Promise<void>;
  syncGit: (
    projectRoot: string,
    remote?: string | null,
    targetBranch?: string | null,
    workspaceId?: string | null
  ) => Promise<void>;
  pushGit: (
    projectRoot: string,
    remote?: string | null,
    targetBranch?: string | null,
    options?: {
      pushTags?: boolean;
      noVerify?: boolean;
      forceWithLease?: boolean;
      pushToGerrit?: boolean;
      topic?: string | null;
      reviewers?: string | null;
      cc?: string | null;
    },
    workspaceId?: string | null
  ) => Promise<void>;
  getGitHubIssues: (projectRoot: string, workspaceId?: string | null) => Promise<GitHubIssuesResponse>;
  getGitHubPullRequests: (projectRoot: string, workspaceId?: string | null) => Promise<GitHubPullRequestsResponse>;
  stageGitFile: (projectRoot: string, path: string, workspaceId?: string | null) => Promise<void>;
  unstageGitFile: (projectRoot: string, path: string, workspaceId?: string | null) => Promise<void>;
  discardGitFile: (projectRoot: string, path: string, workspaceId?: string | null) => Promise<void>;
  commitGitChanges: (
    projectRoot: string,
    message: string,
    options?: { stageAll?: boolean },
    workspaceId?: string | null
  ) => Promise<{ commitSha: string | null }>;
  openWorkspaceIn: (
    path: string,
    options?: {
      appName?: string | null;
      command?: string | null;
      args?: string[];
    }
  ) => Promise<void>;
  openWorkspaceFile: (projectRoot: string, path: string, workspaceId?: string | null) => Promise<boolean>;
  onStream: (listener: (event: StreamEvent) => void) => Promise<Unlisten>;
  pickWorkspaceFolder: () => Promise<WorkspacePickResult | null>;
  pickChatAttachments: () => Promise<PickedChatAttachment[]>;
  searchWorkspaceFiles: (
    projectRoot: string,
    query: string,
    workspaceId?: string | null
  ) => Promise<FileMentionCandidate[]>;
  searchWorkspaceText: (
    projectRoot: string,
    options: {
      query: string;
      caseSensitive: boolean;
      wholeWord: boolean;
      isRegex: boolean;
      includePattern?: string | null;
      excludePattern?: string | null;
    },
    workspaceId?: string | null
  ) => Promise<WorkspaceTextSearchResponse>;
  createWorkspaceFile: (projectRoot: string, relativePath: string, workspaceId?: string | null) => Promise<void>;
  createWorkspaceDirectory: (projectRoot: string, relativePath: string, workspaceId?: string | null) => Promise<void>;
  trashWorkspaceItem: (projectRoot: string, relativePath: string, workspaceId?: string | null) => Promise<void>;
  listWorkspaceEntries: (
    projectRoot: string,
    relativePath?: string | null,
    workspaceId?: string | null
  ) => Promise<WorkspaceTreeEntry[]>;
  getWorkspaceFileIndex: (
    projectRoot: string,
    workspaceId?: string | null
  ) => Promise<WorkspaceFileIndexResponse>;
  getCliSkills: (cliId: AgentId, projectRoot: string, workspaceId?: string | null) => Promise<CliSkillItem[]>;
  detectEngines: () => Promise<SettingsEngineStatus[]>;
  testSshConnection: (connection: SshConnectionConfig) => Promise<SshConnectionTestResult>;
  getClaudeSettingsPath: () => Promise<string | null>;
  getCodexConfigPath: () => Promise<string | null>;
  reloadCodexRuntimeConfig: () => Promise<CodexRuntimeReloadResult>;
  listGlobalMcpServers: () => Promise<GlobalMcpServerEntry[]>;
  listCodexMcpRuntimeServers: (workspaceId?: string | null) => Promise<unknown>;
  listExternalAbsoluteDirectoryChildren: (
    directoryPath: string
  ) => Promise<ExternalDirectoryEntry[]>;
  readExternalAbsoluteFile: (path: string) => Promise<ExternalTextFile>;
  writeExternalAbsoluteFile: (path: string, content: string) => Promise<void>;
  localUsageStatistics: (input: {
    scope: "current" | "all";
    provider?: string | null;
    dateRange: "7d" | "30d" | "all";
    workspacePath?: string | null;
  }) => Promise<LocalUsageStatistics>;
  ensurePtySession: (request: {
    terminalTabId: string;
    workspaceId?: string | null;
    cwd?: string | null;
    cols: number;
    rows: number;
  }) => Promise<void>;
  writePtyInput: (request: { terminalTabId: string; data: string }) => Promise<void>;
  resizePtySession: (request: { terminalTabId: string; cols: number; rows: number }) => Promise<void>;
  closePtySession: (terminalTabId: string) => Promise<void>;
  onPtyOutput: (
    listener: (event: { terminalTabId: string; data: string; stream: string }) => void
  ) => Promise<Unlisten>;
  runtimeLogDetectProfiles: (workspaceId: string) => Promise<RuntimeProfileDescriptor[]>;
  runtimeLogStart: (
    workspaceId: string,
    options?: {
      profileId?: string | null;
      commandOverride?: string | null;
    }
  ) => Promise<RuntimeLogSessionSnapshot>;
  runtimeLogStop: (workspaceId: string) => Promise<RuntimeLogSessionSnapshot>;
  runtimeLogGetSession: (workspaceId: string) => Promise<RuntimeLogSessionSnapshot | null>;
  runtimeLogMarkExit: (workspaceId: string, exitCode: number) => Promise<RuntimeLogSessionSnapshot>;
  onRuntimeLogOutput: (listener: (event: RuntimeLogOutputEvent) => void) => Promise<Unlisten>;
  onRuntimeLogStatus: (listener: (event: RuntimeLogSessionSnapshot) => void) => Promise<Unlisten>;
  onRuntimeLogExited: (listener: (event: RuntimeLogSessionSnapshot) => void) => Promise<Unlisten>;
  // ACP methods
  executeAcpCommand: (command: AcpCommand, cliId: AgentId) => Promise<AcpCommandResult>;
  getAcpCommands: (cliId: AgentId) => Promise<AcpCommandDef[]>;
  getAcpSession: () => Promise<AcpSession>;
  getAcpCapabilities: (cliId: AgentId) => Promise<AcpCliCapabilities>;
  // Semantic memory
  semanticRecall: (request: SemanticRecallRequest) => Promise<SemanticMemoryChunk[]>;
}

export function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

function getRuntimeBridge() {
  return isTauriRuntime() ? tauriRuntime : browserRuntime;
}

const tauriRuntime: RuntimeBridge = {
  async loadAppState(projectRoot, refreshRuntime) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AppState>("load_app_state", { projectRoot, refreshRuntime });
  },
  async switchActiveAgent(agentId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AppState>("switch_active_agent", { agentId });
  },
  async takeOverWriter(agentId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AppState>("take_over_writer", { agentId });
  },
  async snapshotWorkspace() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AppState>("snapshot_workspace");
  },
  async runChecks(projectRoot, cliId, terminalTabId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("run_checks", { projectRoot, cliId, terminalTabId });
  },
  async submitPrompt(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("submit_prompt", { request });
  },
  async requestReview(agentId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("request_review", { agentId });
  },
  async onState(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<AppState>("app-state", (event) => {
      listener(event.payload);
    });
    return unlisten;
  },
  async onTerminal(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<TerminalEvent>("terminal-line", (event) => {
      listener(event.payload);
    });
    return unlisten;
  },
  async getContextStore() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ContextStore>("get_context_store");
  },
  async getConversationHistory(agentId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ConversationTurn[]>("get_conversation_history", { agentId });
  },
  async getSettings() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AppSettings>("get_settings");
  },
  async updateSettings(settings) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AppSettings>("update_settings", { settings });
  },
  async refreshProviderModels(serviceType, providerId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ModelProviderConfig>("refresh_provider_models", { serviceType, providerId });
  },
  async sendApiChatMessage(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ApiChatResponse>("send_api_chat_message", { request });
  },
  async onApiChatStream(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<ApiChatStreamEvent>("api-chat-stream", (event) => {
      listener(event.payload);
    });
    return unlisten;
  },
  async sendTestEmailNotification(config) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("send_test_email_notification", { config });
  },
  async loadTerminalState() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<PersistedTerminalState | null>("load_terminal_state");
  },
  async loadTerminalSession(terminalTabId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ConversationSession | null>("load_terminal_session", { terminalTabId });
  },
  async saveTerminalState(state) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_terminal_state", { state });
  },
  async switchCliForTask(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("switch_cli_for_task", { request });
  },
  async appendChatMessages(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("append_chat_messages", { request });
  },
  async updateChatMessageStream(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("update_chat_message_stream", { request });
  },
  async finalizeChatMessage(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("finalize_chat_message", { request });
  },
  async deleteChatMessage(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_chat_message_record", { request });
  },
  async deleteChatSessionByTab(terminalTabId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_chat_session_by_tab", { terminalTabId });
  },
  async updateChatMessageBlocks(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("update_chat_message_blocks", { request });
  },
  async listAutomationJobs() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationJob[]>("list_automation_jobs");
  },
  async getAutomationJob(jobId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationJob>("get_automation_job", { jobId });
  },
  async createAutomationJob(job) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationJob>("create_automation_job", { job });
  },
  async updateAutomationJob(jobId, job) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationJob>("update_automation_job", { jobId, job });
  },
  async deleteAutomationJob(jobId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_automation_job", { jobId });
  },
  async listAutomationWorkflows() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationWorkflow[]>("list_automation_workflows");
  },
  async getAutomationWorkflow(workflowId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationWorkflow>("get_automation_workflow", { workflowId });
  },
  async createAutomationWorkflow(workflow) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationWorkflow>("create_automation_workflow", { workflow });
  },
  async updateAutomationWorkflow(workflowId, workflow) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationWorkflow>("update_automation_workflow", { workflowId, workflow });
  },
  async deleteAutomationWorkflow(workflowId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_automation_workflow", { workflowId });
  },
  async listAutomationJobRuns(jobId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRunRecord[]>("list_automation_job_runs", { jobId });
  },
  async getAutomationRunDetail(runId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRunDetail>("get_automation_run_detail", { runId });
  },
  async listAutomationRuns() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRun[]>("list_automation_runs");
  },
  async listAutomationWorkflowRuns(workflowId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationWorkflowRun[]>("list_automation_workflow_runs", { workflowId });
  },
  async getAutomationWorkflowRunDetail(workflowRunId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationWorkflowRunDetail>("get_automation_workflow_run_detail", {
      workflowRunId,
    });
  },
  async getAutomationRuleProfile() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRuleProfile>("get_automation_rule_profile");
  },
  async updateAutomationRuleProfile(profile) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRuleProfile>("update_automation_rule_profile", { profile });
  },
  async updateAutomationGoalRuleConfig(goalId, ruleConfig) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRun>("update_automation_goal_rule_config", { goalId, ruleConfig });
  },
  async createAutomationRun(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRun>("create_automation_run", { request });
  },
  async createAutomationRunFromJob(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRunRecord>("create_automation_run_from_job", { request });
  },
  async createAutomationWorkflowRun(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationWorkflowRun>("create_automation_workflow_run", { request });
  },
  async startAutomationRun(runId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRun>("start_automation_run", { runId });
  },
  async pauseAutomationRun(runId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRun>("pause_automation_run", { runId });
  },
  async resumeAutomationRun(runId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRun>("resume_automation_run", { runId });
  },
  async resumeAutomationWorkflowRun(workflowRunId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationWorkflowRun>("resume_automation_workflow_run", { workflowRunId });
  },
  async restartAutomationRun(runId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRun>("restart_automation_run", { runId });
  },
  async pauseAutomationGoal(goalId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRun>("pause_automation_goal", { goalId });
  },
  async resumeAutomationGoal(goalId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRun>("resume_automation_goal", { goalId });
  },
  async cancelAutomationRun(runId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationRun>("cancel_automation_run", { runId });
  },
  async deleteAutomationRun(runId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_automation_run", { runId });
  },
  async cancelAutomationWorkflowRun(workflowRunId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AutomationWorkflowRun>("cancel_automation_workflow_run", { workflowRunId });
  },
  async deleteAutomationWorkflowRun(workflowRunId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_automation_workflow_run", { workflowRunId });
  },
  async saveTextToDownloads(fileName, content) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("save_text_to_downloads", { fileName, content });
  },
  async sendChatMessage(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("send_chat_message", { request });
  },
  async interruptChatTurn(terminalTabId, messageId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ChatInterruptResult>("interrupt_chat_turn", { terminalTabId, messageId });
  },
  async runAutoOrchestration(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("run_auto_orchestration", { request });
  },
  async respondAssistantApproval(requestId, decision) {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ applied: boolean }>("respond_assistant_approval", {
      request: {
        requestId,
        decision,
      },
    });
    return result.applied;
  },
  async getGitPanel(projectRoot, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitPanelData>("get_git_panel", { projectRoot, workspaceId: workspaceId ?? null });
  },
  async getGitOverview(projectRoot, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitOverviewResponse>("get_git_overview", {
      projectRoot,
      workspaceId: workspaceId ?? null,
    });
  },
  async getGitFileDiff(projectRoot, path, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitFileDiff>("get_git_file_diff", {
      projectRoot,
      path,
      workspaceId: workspaceId ?? null,
    });
  },
  async getGitLog(projectRoot, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitLogResponse>("get_git_log", { projectRoot, workspaceId: workspaceId ?? null });
  },
  async getGitCommitHistory(projectRoot, options, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitHistoryResponse>("get_git_commit_history", {
      projectRoot,
      branch: options?.branch ?? null,
      query: options?.query ?? null,
      offset: options?.offset ?? 0,
      limit: options?.limit ?? 100,
      snapshotId: options?.snapshotId ?? null,
      workspaceId: workspaceId ?? null,
    });
  },
  async getGitPushPreview(projectRoot, options, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitPushPreviewResponse>("get_git_push_preview", {
      projectRoot,
      remote: options.remote,
      branch: options.branch,
      limit: options.limit ?? 120,
      workspaceId: workspaceId ?? null,
    });
  },
  async getGitCommitDetails(projectRoot, commitHash, maxDiffLines, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitCommitDetails>("get_git_commit_details", {
      projectRoot,
      commitHash,
      maxDiffLines: maxDiffLines ?? 10000,
      workspaceId: workspaceId ?? null,
    });
  },
  async listGitBranches(projectRoot, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitBranchListResponse>("list_git_branches", { projectRoot, workspaceId: workspaceId ?? null });
  },
  async checkoutGitBranch(projectRoot, name, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("checkout_git_branch", { projectRoot, name, workspaceId: workspaceId ?? null });
  },
  async createGitBranch(projectRoot, name, sourceRef, checkoutAfterCreate, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("create_git_branch", {
      projectRoot,
      name,
      sourceRef: sourceRef ?? null,
      checkoutAfterCreate: checkoutAfterCreate ?? false,
      workspaceId: workspaceId ?? null,
    });
  },
  async renameGitBranch(projectRoot, oldName, newName, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("rename_git_branch", { projectRoot, oldName, newName, workspaceId: workspaceId ?? null });
  },
  async deleteGitBranch(projectRoot, name, force, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_git_branch", { projectRoot, name, force: force ?? false, workspaceId: workspaceId ?? null });
  },
  async mergeGitBranch(projectRoot, sourceBranch, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("merge_git_branch", { projectRoot, sourceBranch, workspaceId: workspaceId ?? null });
  },
  async fetchGit(projectRoot, remote, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("fetch_git", { projectRoot, remote: remote ?? null, workspaceId: workspaceId ?? null });
  },
  async pullGit(
    projectRoot: string,
    remote?: string | null,
    targetBranch?: string | null,
    pullOption?: string | null,
    workspaceId?: string | null,
  ) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("pull_git", {
      projectRoot,
      remote: remote ?? null,
      targetBranch: targetBranch ?? null,
      pullOption: pullOption ?? null,
      workspaceId: workspaceId ?? null,
    });
  },
  async syncGit(projectRoot, remote, targetBranch, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("sync_git", {
      projectRoot,
      remote: remote ?? null,
      targetBranch: targetBranch ?? null,
      workspaceId: workspaceId ?? null,
    });
  },
  async pushGit(projectRoot, remote, targetBranch, options, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("push_git", {
      projectRoot,
      remote: remote ?? null,
      targetBranch: targetBranch ?? null,
      workspaceId: workspaceId ?? null,
      pushTags: options?.pushTags ?? false,
      noVerify: options?.noVerify ?? false,
      forceWithLease: options?.forceWithLease ?? false,
      pushToGerrit: options?.pushToGerrit ?? false,
      topic: options?.topic ?? null,
      reviewers: options?.reviewers ?? null,
      cc: options?.cc ?? null,
    });
  },
  async getGitHubIssues(projectRoot, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitHubIssuesResponse>("get_github_issues", { projectRoot, workspaceId: workspaceId ?? null });
  },
  async getGitHubPullRequests(projectRoot, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitHubPullRequestsResponse>("get_github_pull_requests", { projectRoot, workspaceId: workspaceId ?? null });
  },
  async stageGitFile(projectRoot, path, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stage_git_file", { projectRoot, path, workspaceId: workspaceId ?? null });
  },
  async unstageGitFile(projectRoot, path, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("unstage_git_file", { projectRoot, path, workspaceId: workspaceId ?? null });
  },
  async discardGitFile(projectRoot, path, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("discard_git_file", { projectRoot, path, workspaceId: workspaceId ?? null });
  },
  async commitGitChanges(projectRoot, message, options, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<{ commitSha: string | null }>("commit_git_changes", {
      projectRoot,
      message,
      workspaceId: workspaceId ?? null,
      stageAll: options?.stageAll ?? false,
    });
  },
  async openWorkspaceIn(path, options) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_workspace_in", {
      path,
      app: options?.appName ?? null,
      command: options?.command ?? null,
      args: options?.args ?? [],
    });
  },
  async openWorkspaceFile(projectRoot, path, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ opened: boolean }>("open_workspace_file", {
      projectRoot,
      path,
      workspaceId: workspaceId ?? null,
    });
    return result.opened;
  },
  async onStream(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<StreamEvent>("stream-chunk", (event) => {
      listener(event.payload);
    });
    return unlisten;
  },
  async pickWorkspaceFolder() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<WorkspacePickResult | null>("pick_workspace_folder");
  },
  async pickChatAttachments() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<PickedChatAttachment[]>("pick_chat_attachments");
  },
  async searchWorkspaceFiles(projectRoot, query, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<FileMentionCandidate[]>("search_workspace_files", {
      projectRoot,
      query,
      workspaceId: workspaceId ?? null,
    });
  },
  async searchWorkspaceText(projectRoot, options, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<WorkspaceTextSearchResponse>("search_workspace_text", {
      projectRoot,
      query: options.query,
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      isRegex: options.isRegex,
      includePattern: options.includePattern ?? null,
      excludePattern: options.excludePattern ?? null,
      workspaceId: workspaceId ?? null,
    });
  },
  async createWorkspaceFile(projectRoot, relativePath, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("create_workspace_file", {
      projectRoot,
      relativePath,
      workspaceId: workspaceId ?? null,
    });
  },
  async createWorkspaceDirectory(projectRoot, relativePath, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("create_workspace_directory", {
      projectRoot,
      relativePath,
      workspaceId: workspaceId ?? null,
    });
  },
  async trashWorkspaceItem(projectRoot, relativePath, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("trash_workspace_item", {
      projectRoot,
      relativePath,
      workspaceId: workspaceId ?? null,
    });
  },
  async listWorkspaceEntries(projectRoot, relativePath, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<WorkspaceTreeEntry[]>("list_workspace_entries", {
      projectRoot,
      relativePath,
      workspaceId: workspaceId ?? null,
    });
  },
  async getWorkspaceFileIndex(projectRoot, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<WorkspaceFileIndexResponse>("get_workspace_file_index", {
      projectRoot,
      workspaceId: workspaceId ?? null,
    });
  },
  async getCliSkills(cliId, projectRoot, workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<CliSkillItem[]>("get_cli_skills", { cliId, projectRoot, workspaceId: workspaceId ?? null });
  },
  async detectEngines() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SettingsEngineStatus[]>("detect_engines");
  },
  async testSshConnection(connection) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SshConnectionTestResult>("test_ssh_connection", { connection });
  },
  async getClaudeSettingsPath() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("get_claude_settings_path");
  },
  async getCodexConfigPath() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("get_codex_config_path");
  },
  async reloadCodexRuntimeConfig() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<CodexRuntimeReloadResult>("reload_codex_runtime_config");
  },
  async listGlobalMcpServers() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GlobalMcpServerEntry[]>("list_global_mcp_servers");
  },
  async listCodexMcpRuntimeServers(workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<unknown>("list_codex_mcp_runtime_servers", { workspaceId: workspaceId ?? null });
  },
  async listExternalAbsoluteDirectoryChildren(directoryPath) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ExternalDirectoryEntry[]>("list_external_absolute_directory_children", {
      directoryPath,
    });
  },
  async readExternalAbsoluteFile(path) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ExternalTextFile>("read_external_absolute_file", { path });
  },
  async writeExternalAbsoluteFile(path, content) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_external_absolute_file", { path, content });
  },
  async localUsageStatistics(input) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LocalUsageStatistics>("local_usage_statistics", {
      scope: input.scope,
      provider: input.provider ?? "all",
      dateRange: input.dateRange,
      workspacePath: input.workspacePath ?? null,
    });
  },
  async ensurePtySession(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ensure_pty_session", { request });
  },
  async writePtyInput(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_pty_input", { request });
  },
  async resizePtySession(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("resize_pty_session", { request });
  },
  async closePtySession(terminalTabId) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("close_pty_session", { terminalTabId });
  },
  async onPtyOutput(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<{
      terminalTabId: string;
      data: string;
      stream: string;
    }>("pty-output", (event) => {
      listener(event.payload);
    });
    return unlisten;
  },
  async runtimeLogDetectProfiles(workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<RuntimeProfileDescriptor[]>("runtime_log_detect_profiles", { workspaceId });
  },
  async runtimeLogStart(workspaceId, options) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<RuntimeLogSessionSnapshot>("runtime_log_start", {
      workspaceId,
      profileId: options?.profileId ?? null,
      commandOverride: options?.commandOverride ?? null,
    });
  },
  async runtimeLogStop(workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<RuntimeLogSessionSnapshot>("runtime_log_stop", { workspaceId });
  },
  async runtimeLogGetSession(workspaceId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<RuntimeLogSessionSnapshot | null>("runtime_log_get_session", { workspaceId });
  },
  async runtimeLogMarkExit(workspaceId, exitCode) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<RuntimeLogSessionSnapshot>("runtime_log_mark_exit", { workspaceId, exitCode });
  },
  async onRuntimeLogOutput(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<RuntimeLogOutputEvent>("runtime-log:line-appended", (event) => {
      listener(event.payload);
    });
  },
  async onRuntimeLogStatus(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<RuntimeLogSessionSnapshot>("runtime-log:status-changed", (event) => {
      listener(event.payload);
    });
  },
  async onRuntimeLogExited(listener) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<RuntimeLogSessionSnapshot>("runtime-log:session-exited", (event) => {
      listener(event.payload);
    });
  },
  async executeAcpCommand(command, cliId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AcpCommandResult>("execute_acp_command", { command, cliId });
  },
  async getAcpCommands(cliId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AcpCommandDef[]>("get_acp_commands", { cliId });
  },
  async getAcpSession() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AcpSession>("get_acp_session");
  },
  async getAcpCapabilities(cliId) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AcpCliCapabilities>("get_acp_capabilities", { cliId });
  },
  async semanticRecall(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SemanticMemoryChunk[]>("semantic_recall", { request });
  },
};

export const bridge = new Proxy({} as RuntimeBridge, {
  get(_target, prop) {
    const runtime = getRuntimeBridge() as unknown as Record<PropertyKey, unknown>;
    const value = runtime[prop];
    if (typeof value === "function") {
      return (...args: unknown[]) =>
        (value as (...innerArgs: unknown[]) => unknown).apply(runtime, args);
    }
    return value;
  },
}) as RuntimeBridge;
