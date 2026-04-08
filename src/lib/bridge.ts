import { browserRuntime } from "./browserRuntime";
import {
  AgentId,
  AgentPromptRequest,
  AutomationJob,
  AutomationJobDraft,
  AutomationGoalRuleConfig,
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
  ChatPromptRequest,
  AssistantApprovalDecision,
  CliHandoffRequest,
  ContextStore,
  ConversationTurn,
  CreateAutomationRunFromJobRequest,
  CreateAutomationRunRequest,
  CliSkillItem,
  FileMentionCandidate,
  GitFileDiff,
  GitPanelData,
  NotificationConfig,
  PersistedTerminalState,
  StreamEvent,
  TerminalEvent,
  WorkspacePickResult,
} from "./models";
import type {
  AcpCliCapabilities,
  AcpCommand,
  AcpCommandDef,
  AcpCommandResult,
  AcpSession,
} from "./acp";

type Unlisten = () => void;

export interface RuntimeBridge {
  loadAppState: (projectRoot?: string) => Promise<AppState>;
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
  sendTestEmailNotification: (config: NotificationConfig) => Promise<string>;
  loadTerminalState: () => Promise<PersistedTerminalState | null>;
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
  listAutomationJobRuns: (jobId?: string | null) => Promise<AutomationRunRecord[]>;
  getAutomationRunDetail: (runId: string) => Promise<AutomationRunDetail>;
  listAutomationRuns: () => Promise<AutomationRun[]>;
  getAutomationRuleProfile: () => Promise<AutomationRuleProfile>;
  updateAutomationRuleProfile: (profile: AutomationRuleProfile) => Promise<AutomationRuleProfile>;
  updateAutomationGoalRuleConfig: (goalId: string, ruleConfig: AutomationGoalRuleConfig) => Promise<AutomationRun>;
  createAutomationRun: (request: CreateAutomationRunRequest) => Promise<AutomationRun>;
  createAutomationRunFromJob: (request: CreateAutomationRunFromJobRequest) => Promise<AutomationRunRecord>;
  startAutomationRun: (runId: string) => Promise<AutomationRun>;
  pauseAutomationRun: (runId: string) => Promise<AutomationRun>;
  resumeAutomationRun: (runId: string) => Promise<AutomationRun>;
  restartAutomationRun: (runId: string) => Promise<AutomationRun>;
  pauseAutomationGoal: (goalId: string) => Promise<AutomationRun>;
  resumeAutomationGoal: (goalId: string) => Promise<AutomationRun>;
  cancelAutomationRun: (runId: string) => Promise<AutomationRun>;
  deleteAutomationRun: (runId: string) => Promise<void>;
  saveTextToDownloads: (fileName: string, content: string) => Promise<string>;
  // Chat methods
  sendChatMessage: (request: ChatPromptRequest) => Promise<string>;
  runAutoOrchestration: (request: AutoOrchestrationRequest) => Promise<string>;
  respondAssistantApproval: (requestId: string, decision: AssistantApprovalDecision) => Promise<boolean>;
  getGitPanel: (projectRoot: string) => Promise<GitPanelData>;
  getGitFileDiff: (projectRoot: string, path: string) => Promise<GitFileDiff>;
  openWorkspaceFile: (projectRoot: string, path: string) => Promise<boolean>;
  onStream: (listener: (event: StreamEvent) => void) => Promise<Unlisten>;
  pickWorkspaceFolder: () => Promise<WorkspacePickResult | null>;
  searchWorkspaceFiles: (projectRoot: string, query: string) => Promise<FileMentionCandidate[]>;
  getCliSkills: (cliId: AgentId, projectRoot: string) => Promise<CliSkillItem[]>;
  // ACP methods
  executeAcpCommand: (command: AcpCommand, cliId: AgentId) => Promise<AcpCommandResult>;
  getAcpCommands: (cliId: AgentId) => Promise<AcpCommandDef[]>;
  getAcpSession: () => Promise<AcpSession>;
  getAcpCapabilities: (cliId: AgentId) => Promise<AcpCliCapabilities>;
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
  async loadAppState(projectRoot) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AppState>("load_app_state", { projectRoot });
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
  async sendTestEmailNotification(config) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("send_test_email_notification", { config });
  },
  async loadTerminalState() {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<PersistedTerminalState | null>("load_terminal_state");
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
  async saveTextToDownloads(fileName, content) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("save_text_to_downloads", { fileName, content });
  },
  async sendChatMessage(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("send_chat_message", { request });
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
  async getGitPanel(projectRoot) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitPanelData>("get_git_panel", { projectRoot });
  },
  async getGitFileDiff(projectRoot, path) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitFileDiff>("get_git_file_diff", { projectRoot, path });
  },
  async openWorkspaceFile(projectRoot, path) {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ opened: boolean }>("open_workspace_file", { projectRoot, path });
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
  async searchWorkspaceFiles(projectRoot, query) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<FileMentionCandidate[]>("search_workspace_files", { projectRoot, query });
  },
  async getCliSkills(cliId, projectRoot) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<CliSkillItem[]>("get_cli_skills", { cliId, projectRoot });
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
};

export const bridge = new Proxy({} as RuntimeBridge, {
  get(_target, prop) {
    const runtime = getRuntimeBridge() as Record<PropertyKey, unknown>;
    const value = runtime[prop];
    if (typeof value === "function") {
      return (...args: unknown[]) =>
        (value as (...innerArgs: unknown[]) => unknown).apply(runtime, args);
    }
    return value;
  },
}) as RuntimeBridge;
