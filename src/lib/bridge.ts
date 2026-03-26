import { browserRuntime } from "./browserRuntime";
import {
  AgentId,
  AgentPromptRequest,
  AppSettings,
  AppState,
  ChatPromptRequest,
  ContextStore,
  ConversationTurn,
  FileMentionCandidate,
  GitFileDiff,
  GitPanelData,
  StreamEvent,
  TerminalEvent,
  WorkspacePickResult,
} from "./models";
import type { AcpCommand, AcpCommandDef, AcpCommandResult, AcpSession } from "./acp";

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
  // Chat methods
  sendChatMessage: (request: ChatPromptRequest) => Promise<string>;
  getGitPanel: (projectRoot: string) => Promise<GitPanelData>;
  getGitFileDiff: (projectRoot: string, path: string) => Promise<GitFileDiff>;
  openWorkspaceFile: (projectRoot: string, path: string) => Promise<boolean>;
  onStream: (listener: (event: StreamEvent) => void) => Promise<Unlisten>;
  pickWorkspaceFolder: () => Promise<WorkspacePickResult | null>;
  searchWorkspaceFiles: (projectRoot: string, query: string) => Promise<FileMentionCandidate[]>;
  // ACP methods
  executeAcpCommand: (command: AcpCommand, cliId: AgentId) => Promise<AcpCommandResult>;
  getAcpCommands: (cliId: AgentId) => Promise<AcpCommandDef[]>;
  getAcpSession: () => Promise<AcpSession>;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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
  async sendChatMessage(request) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("send_chat_message", { request });
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
};

export const bridge: RuntimeBridge = isTauriRuntime() ? tauriRuntime : browserRuntime;
