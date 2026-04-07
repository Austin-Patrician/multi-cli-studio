#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod acp;
mod automation;
mod storage;

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use chrono::Local;
use cron::Schedule;
use dirs::data_local_dir;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri_plugin_notification::NotificationExt;
use automation::{
    build_job_from_draft, build_run_from_job, build_run_from_request, default_rule_profile,
    display_parameter_value, load_jobs as load_automation_jobs_from_disk, load_rule_profile,
    load_runs as load_automation_runs_from_disk, normalize_goal_rule_config,
    normalize_permission_profile, normalize_rule_profile, normalize_scheduled_start_at,
    normalize_runs_on_startup, persist_jobs as persist_automation_jobs_to_disk, persist_rule_profile,
    persist_runs as persist_automation_runs_to_disk, push_event, sync_goal_status_fields,
    sync_run_status_fields, update_job_from_draft, AutomationGoal, AutomationGoalRuleConfig,
    AutomationJob, AutomationJobDraft, AutomationJudgeAssessment, AutomationObjectiveSignals,
    AutomationRuleProfile, AutomationRun, display_status_from_dimensions,
    CreateAutomationRunFromJobRequest, CreateAutomationRunRequest,
};
use storage::{
    default_terminal_db_path, CliHandoffStorageRequest, EnsureTaskPacketRequest,
    MessageBlocksUpdateRequest, MessageDeleteRequest, MessageEventsAppendRequest,
    MessageFinalizeRequest, MessageSessionSeed, MessageStreamUpdateRequest, PersistedChatMessage,
    PersistedConversationSession, PersistedTerminalState, TaskContextBundle, TaskRecentTurn,
    TerminalStorage,
};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
const FALLBACK_SHELL: &str = r"C:\Program Files\PowerShell\7\pwsh.exe";

#[cfg(not(target_os = "windows"))]
const FALLBACK_SHELL: &str = "/bin/zsh";
const DEFAULT_MAX_TURNS: usize = 50;
const DEFAULT_MAX_OUTPUT_CHARS: usize = 100_000;
const DEFAULT_TIMEOUT_MS: u64 = 300_000;

// ── UI state models (unchanged shape for frontend compat) ──────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppStateDto {
    workspace: WorkspaceState,
    agents: Vec<AgentCard>,
    handoffs: Vec<HandoffPack>,
    artifacts: Vec<ReviewArtifact>,
    activity: Vec<ActivityItem>,
    terminal_by_agent: BTreeMap<String, Vec<TerminalLine>>,
    environment: EnvironmentState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceState {
    project_name: String,
    project_root: String,
    branch: String,
    current_writer: String,
    active_agent: String,
    dirty_files: usize,
    failing_checks: usize,
    handoff_ready: bool,
    last_snapshot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentCard {
    id: String,
    label: String,
    mode: String,
    status: String,
    specialty: String,
    summary: String,
    pending_action: String,
    session_ref: String,
    last_sync: String,
    runtime: AgentRuntime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentRuntime {
    installed: bool,
    command_path: Option<String>,
    version: Option<String>,
    last_error: Option<String>,
    #[serde(default)]
    resources: AgentRuntimeResources,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentRuntimeResources {
    mcp: AgentResourceGroup,
    plugin: AgentResourceGroup,
    extension: AgentResourceGroup,
    skill: AgentResourceGroup,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentResourceGroup {
    supported: bool,
    items: Vec<AgentResourceItem>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AgentResourceItem {
    name: String,
    enabled: bool,
    version: Option<String>,
    source: Option<String>,
    detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HandoffPack {
    id: String,
    from: String,
    to: String,
    status: String,
    goal: String,
    files: Vec<String>,
    risks: Vec<String>,
    next_step: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewArtifact {
    id: String,
    source: String,
    title: String,
    kind: String,
    summary: String,
    confidence: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivityItem {
    id: String,
    time: String,
    tone: String,
    title: String,
    detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalLine {
    id: String,
    speaker: String,
    content: String,
    time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentState {
    backend: String,
    tauri_ready: bool,
    rust_available: bool,
    notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalEvent {
    agent_id: String,
    line: TerminalLine,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentPromptRequest {
    agent_id: String,
    prompt: String,
}

// ── Context system models (new) ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationTurn {
    id: String,
    agent_id: String,
    timestamp: String,
    user_prompt: String,
    composed_prompt: String,
    raw_output: String,
    output_summary: String,
    duration_ms: u64,
    exit_code: Option<i32>,
    write_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnrichedHandoff {
    id: String,
    from: String,
    to: String,
    timestamp: String,
    git_diff: String,
    changed_files: Vec<String>,
    previous_turns: Vec<ConversationTurn>,
    user_goal: String,
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentContext {
    agent_id: String,
    conversation_history: Vec<ConversationTurn>,
    total_token_estimate: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContextStore {
    agents: BTreeMap<String, AgentContext>,
    #[serde(default)]
    conversation_history: Vec<ConversationTurn>,
    handoffs: Vec<EnrichedHandoff>,
    max_turns_per_agent: usize,
    max_output_chars_per_turn: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    cli_paths: CliPaths,
    project_root: String,
    max_turns_per_agent: usize,
    max_output_chars_per_turn: usize,
    process_timeout_ms: u64,
    #[serde(default)]
    notify_on_terminal_completion: bool,
    #[serde(default)]
    notification_config: NotificationConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliPaths {
    codex: String,
    claude: String,
    gemini: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationConfig {
    #[serde(default)]
    notify_on_completion: bool,
    #[serde(default)]
    webhook_url: String,
    #[serde(default)]
    webhook_enabled: bool,
    #[serde(default)]
    smtp_enabled: bool,
    #[serde(default)]
    smtp_host: String,
    #[serde(default = "default_smtp_port")]
    smtp_port: u16,
    #[serde(default)]
    smtp_username: String,
    #[serde(default)]
    smtp_password: String,
    #[serde(default)]
    smtp_from: String,
    #[serde(default)]
    email_recipients: Vec<String>,
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            notify_on_completion: false,
            webhook_url: String::new(),
            webhook_enabled: false,
            smtp_enabled: false,
            smtp_host: "smtp.example.com".to_string(),
            smtp_port: 587,
            smtp_username: String::new(),
            smtp_password: String::new(),
            smtp_from: String::new(),
            email_recipients: Vec::new(),
        }
    }
}

fn default_smtp_port() -> u16 {
    587
}

// ── Chat types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactedSummary {
    id: String,
    source_tab_id: String,
    source_cli: String,
    timestamp: String,
    intent: String,
    technical_context: String,
    #[serde(default)]
    changed_files: Vec<String>,
    errors_and_fixes: String,
    current_state: String,
    next_steps: String,
    token_estimate: usize,
    version: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedContextEntry {
    id: String,
    source_tab_id: String,
    source_tab_title: String,
    source_cli: String,
    summary: CompactedSummary,
    updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatContextTurn {
    cli_id: String,
    user_prompt: String,
    assistant_reply: String,
    timestamp: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatPromptRequest {
    cli_id: String,
    terminal_tab_id: String,
    workspace_id: String,
    assistant_message_id: String,
    prompt: String,
    project_root: String,
    project_name: String,
    #[serde(default)]
    recent_turns: Vec<ChatContextTurn>,
    write_mode: bool,
    plan_mode: bool,
    fast_mode: bool,
    effort_level: Option<String>,
    model_override: Option<String>,
    permission_override: Option<String>,
    transport_session: Option<AgentTransportSession>,
    #[serde(default)]
    compacted_summaries: Option<Vec<CompactedSummary>>,
    #[serde(default)]
    cross_tab_context: Option<Vec<SharedContextEntry>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoOrchestrationRequest {
    terminal_tab_id: String,
    workspace_id: String,
    assistant_message_id: String,
    prompt: String,
    project_root: String,
    project_name: String,
    #[serde(default)]
    recent_turns: Vec<ChatContextTurn>,
    plan_mode: bool,
    fast_mode: bool,
    effort_level: Option<String>,
    #[serde(default)]
    model_overrides: BTreeMap<String, String>,
    #[serde(default)]
    permission_overrides: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ClaudeApprovalResponseRequest {
    #[serde(alias = "requestId")]
    request_id: String,
    #[serde(alias = "decision")]
    decision: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliHandoffRequest {
    terminal_tab_id: String,
    workspace_id: String,
    project_root: String,
    project_name: String,
    from_cli: String,
    to_cli: String,
    reason: Option<String>,
    latest_user_prompt: Option<String>,
    latest_assistant_summary: Option<String>,
    #[serde(default)]
    relevant_files: Vec<String>,
    compacted_history: Option<CompactedSummary>,
    #[serde(default)]
    cross_tab_context: Option<Vec<SharedContextEntry>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeApprovalResponseResult {
    applied: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamEvent {
    terminal_tab_id: String,
    message_id: String,
    chunk: String,
    done: bool,
    exit_code: Option<i32>,
    duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    final_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transport_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transport_session: Option<AgentTransportSession>,
    #[serde(skip_serializing_if = "Option::is_none")]
    blocks: Option<Vec<ChatMessageBlock>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentTransportSession {
    cli_id: String,
    kind: String,
    thread_id: Option<String>,
    turn_id: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    last_sync_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum ChatMessageBlock {
    Text {
        text: String,
        format: String,
    },
    Reasoning {
        text: String,
    },
    Command {
        label: String,
        command: String,
        status: Option<String>,
        cwd: Option<String>,
        exit_code: Option<i32>,
        output: Option<String>,
    },
    FileChange {
        path: String,
        diff: String,
        change_type: String,
        move_path: Option<String>,
        status: Option<String>,
    },
    Tool {
        tool: String,
        source: Option<String>,
        status: Option<String>,
        summary: Option<String>,
    },
    ApprovalRequest {
        request_id: String,
        tool_name: String,
        provider: Option<String>,
        title: Option<String>,
        description: Option<String>,
        summary: Option<String>,
        persistent_label: Option<String>,
        state: Option<String>,
    },
    OrchestrationPlan {
        title: String,
        goal: String,
        summary: Option<String>,
        status: Option<String>,
    },
    OrchestrationStep {
        step_id: String,
        owner: String,
        title: String,
        summary: Option<String>,
        result: Option<String>,
        status: Option<String>,
    },
    AutoRoute {
        target_cli: String,
        title: String,
        reason: String,
        mode_hint: Option<String>,
        state: Option<String>,
    },
    Plan {
        text: String,
    },
    Status {
        level: String,
        text: String,
    },
}

#[derive(Debug, Clone)]
struct CodexTurnOutcome {
    final_content: String,
    content_format: String,
    raw_output: String,
    exit_code: Option<i32>,
    blocks: Vec<ChatMessageBlock>,
    transport_session: AgentTransportSession,
}

#[derive(Debug, Clone)]
struct GeminiTurnOutcome {
    final_content: String,
    content_format: String,
    raw_output: String,
    exit_code: Option<i32>,
    blocks: Vec<ChatMessageBlock>,
    transport_session: AgentTransportSession,
}

#[derive(Debug, Clone)]
struct ClaudeTurnOutcome {
    final_content: String,
    content_format: String,
    raw_output: String,
    exit_code: Option<i32>,
    blocks: Vec<ChatMessageBlock>,
    transport_session: AgentTransportSession,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoPlanStep {
    id: String,
    owner: String,
    title: String,
    instruction: String,
    #[serde(default)]
    write: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoPlan {
    goal: String,
    summary: Option<String>,
    #[serde(default)]
    steps: Vec<AutoPlanStep>,
}

#[derive(Debug, Clone)]
struct SilentAgentTurnOutcome {
    final_content: String,
    raw_output: String,
}

#[derive(Debug, Clone, Default)]
struct GeminiToolCallState {
    title: String,
    kind: Option<String>,
    status: Option<String>,
    locations: Vec<String>,
    text_content: Vec<String>,
    diffs: Vec<GeminiDiffEntry>,
}

#[derive(Debug, Clone)]
struct GeminiDiffEntry {
    path: String,
    old_text: Option<String>,
    new_text: String,
    change_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePickResult {
    name: String,
    root_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenWorkspaceFileResult {
    opened: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMentionCandidate {
    id: String,
    name: String,
    relative_path: String,
    absolute_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliSkillItem {
    name: String,
    display_name: Option<String>,
    description: Option<String>,
    path: String,
    scope: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct LocalSkillManifest {
    name: Option<String>,
    description: Option<String>,
    user_invocable: Option<bool>,
}

#[derive(Debug, Clone)]
struct LocalSkillDescriptor {
    name: String,
    description: Option<String>,
    path: String,
    user_invocable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitFileChange {
    path: String,
    status: String,
    previous_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitFileDiff {
    path: String,
    status: String,
    previous_path: Option<String>,
    diff: String,
    original_content: Option<String>,
    modified_content: Option<String>,
    language: Option<String>,
    is_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitPanelData {
    is_git_repo: bool,
    branch: String,
    recent_changes: Vec<GitFileChange>,
}

// ── App store ──────────────────────────────────────────────────────────

struct AppStore {
    state: Arc<Mutex<AppStateDto>>,
    context: Arc<Mutex<ContextStore>>,
    settings: Arc<Mutex<AppSettings>>,
    terminal_storage: TerminalStorage,
    automation_jobs: Arc<Mutex<Vec<AutomationJob>>>,
    automation_runs: Arc<Mutex<Vec<AutomationRun>>>,
    automation_active_runs: Arc<Mutex<BTreeSet<String>>>,
    automation_rule_profile: Arc<Mutex<AutomationRuleProfile>>,
    acp_session: Arc<Mutex<acp::AcpSession>>,
    claude_approval_rules: Arc<Mutex<ClaudeApprovalRules>>,
    claude_pending_approvals: Arc<Mutex<BTreeMap<String, PendingClaudeApproval>>>,
    codex_pending_approvals: Arc<Mutex<BTreeMap<String, PendingCodexApproval>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ClaudeApprovalRules {
    #[serde(default)]
    always_allow_by_project: BTreeMap<String, BTreeSet<String>>,
}

#[derive(Debug)]
struct PendingClaudeApproval {
    project_root: String,
    tool_name: String,
    sender: mpsc::Sender<ClaudeApprovalDecision>,
}

#[derive(Debug)]
struct PendingCodexApproval {
    sender: mpsc::Sender<ClaudeApprovalDecision>,
}

#[derive(Debug, Clone, Copy)]
enum ClaudeApprovalDecision {
    AllowOnce,
    AllowAlways,
    Deny,
}

#[derive(Debug, Default)]
struct CodexStreamState {
    final_content: String,
    blocks: Vec<ChatMessageBlock>,
    block_prefix: Vec<ChatMessageBlock>,
    delta_by_item: BTreeMap<String, String>,
    approval_block_by_request_id: BTreeMap<String, usize>,
    latest_plan_text: Option<String>,
    thread_id: Option<String>,
    turn_id: Option<String>,
    completion: Option<CodexTurnCompletion>,
}

#[derive(Debug, Default)]
struct GeminiStreamState {
    final_content: String,
    reasoning_text: String,
    blocks: Vec<ChatMessageBlock>,
    block_prefix: Vec<ChatMessageBlock>,
    tool_calls: BTreeMap<String, GeminiToolCallState>,
    latest_plan_text: Option<String>,
    session_id: Option<String>,
    current_mode_id: Option<String>,
    current_model_id: Option<String>,
    prompt_stop_reason: Option<String>,
    active_turn_started: bool,
    awaiting_current_user_prompt: bool,
}

#[derive(Debug, Default)]
struct ClaudeStreamState {
    final_content: String,
    blocks: Vec<ChatMessageBlock>,
    content_blocks: BTreeMap<usize, ClaudeContentBlockState>,
    tool_block_by_use_id: BTreeMap<String, usize>,
    approval_block_by_request_id: BTreeMap<String, usize>,
    session_id: Option<String>,
    turn_id: Option<String>,
    current_model_id: Option<String>,
    permission_mode: Option<String>,
    stop_reason: Option<String>,
    result_text: Option<String>,
    result_is_error: bool,
    result_received: bool,
    parse_failures: Vec<String>,
}

#[derive(Debug, Clone)]
enum ClaudeContentBlockState {
    Text(String),
    Thinking(String),
    Tool(ClaudeToolUseState),
}

#[derive(Debug, Clone)]
struct ClaudeToolUseState {
    name: String,
    kind: String,
    source: Option<String>,
    input_json: String,
    block_index: usize,
}

#[derive(Debug, Clone)]
struct CodexTurnCompletion {
    status: String,
    error_text: Option<String>,
}

fn default_transport_kind(cli_id: &str) -> String {
    match cli_id {
        "codex" => "codex-app-server",
        "claude" => "claude-cli",
        "gemini" => "gemini-acp",
        _ => "browser-fallback",
    }
    .to_string()
}

fn build_transport_session(
    cli_id: &str,
    previous: Option<AgentTransportSession>,
    thread_id: Option<String>,
    turn_id: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
) -> AgentTransportSession {
    let default_kind = default_transport_kind(cli_id);
    let previous = previous.unwrap_or(AgentTransportSession {
        cli_id: cli_id.to_string(),
        kind: default_kind.clone(),
        thread_id: None,
        turn_id: None,
        model: None,
        permission_mode: None,
        last_sync_at: None,
    });

    AgentTransportSession {
        cli_id: cli_id.to_string(),
        kind: if previous.kind.trim().is_empty()
            || (cli_id == "gemini" && previous.kind == "gemini-cli")
        {
            default_kind
        } else {
            previous.kind
        },
        thread_id: thread_id.or(previous.thread_id),
        turn_id: turn_id.or(previous.turn_id),
        model: model.or(previous.model),
        permission_mode: permission_mode.or(previous.permission_mode),
        last_sync_at: Some(Local::now().to_rfc3339()),
    }
}

fn codex_permission_mode(session: &acp::AcpSession, write_mode: bool) -> String {
    if session.plan_mode || !write_mode {
        "read-only".to_string()
    } else {
        session
            .permission_mode
            .get("codex")
            .cloned()
            .unwrap_or_else(|| "workspace-write".to_string())
    }
}

fn automation_permission_mode_for_cli(permission_profile: &str, cli_id: &str, write_mode: bool) -> String {
    if !write_mode {
        return match cli_id {
            "claude" | "gemini" => "plan".to_string(),
            _ => "read-only".to_string(),
        };
    }

    match (cli_id, normalize_permission_profile(permission_profile).as_str()) {
        ("codex", "full-access") => "danger-full-access".to_string(),
        ("codex", "read-only") => "read-only".to_string(),
        ("codex", _) => "workspace-write".to_string(),
        ("claude", "full-access") => "bypassPermissions".to_string(),
        ("claude", "read-only") => "plan".to_string(),
        ("claude", _) => "acceptEdits".to_string(),
        ("gemini", "full-access") => "yolo".to_string(),
        ("gemini", "read-only") => "plan".to_string(),
        ("gemini", _) => "auto_edit".to_string(),
        (_, _) => "workspace-write".to_string(),
    }
}

fn codex_reasoning_effort(session: &acp::AcpSession) -> Option<String> {
    match session.effort_level.as_deref() {
        Some("none") => Some("none".to_string()),
        Some("minimal") => Some("minimal".to_string()),
        Some("low") => Some("low".to_string()),
        Some("medium") => Some("medium".to_string()),
        Some("high") => Some("high".to_string()),
        Some("max") => Some("xhigh".to_string()),
        Some("xhigh") => Some("xhigh".to_string()),
        _ => None,
    }
}

fn codex_sandbox_mode(permission_mode: &str) -> String {
    match permission_mode {
        "danger-full-access" => "danger-full-access",
        "read-only" => "read-only",
        _ => "workspace-write",
    }
    .to_string()
}

fn codex_sandbox_policy(permission_mode: &str, project_root: &str) -> Value {
    match permission_mode {
        "danger-full-access" => json!({ "type": "dangerFullAccess" }),
        "read-only" => json!({
            "type": "readOnly",
            "networkAccess": true
        }),
        _ => json!({
            "type": "workspaceWrite",
            "networkAccess": true,
            "writableRoots": [project_root]
        }),
    }
}

fn parse_leading_skill_reference(prompt: &str) -> Option<(String, String)> {
    let trimmed = prompt.trim_start();
    let skill_prompt = trimmed.strip_prefix('$')?;
    let skill_name_len = skill_prompt
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        .count();
    if skill_name_len == 0 {
        return None;
    }

    let skill_name: String = skill_prompt.chars().take(skill_name_len).collect();
    let remainder = skill_prompt
        .chars()
        .skip(skill_name_len)
        .collect::<String>()
        .trim_start()
        .to_string();
    Some((skill_name, remainder))
}

fn resolve_codex_prompt_and_skills(
    app: &AppHandle,
    command_path: &str,
    project_root: &str,
    prompt: &str,
) -> (String, Vec<CliSkillItem>) {
    let Some((skill_name, remainder)) = parse_leading_skill_reference(prompt) else {
        return (prompt.to_string(), Vec::new());
    };

    let skills = list_codex_skills_for_workspace(app, command_path, project_root)
        .unwrap_or_else(|_| list_codex_fallback_skills(project_root));
    if let Some(skill) = skills
        .into_iter()
        .find(|item| item.name.eq_ignore_ascii_case(&skill_name))
    {
        return (remainder, vec![skill]);
    }

    (prompt.to_string(), Vec::new())
}

fn resolve_claude_prompt_and_skill(
    project_root: &str,
    prompt: &str,
) -> (String, Option<CliSkillItem>) {
    let Some((skill_name, remainder)) = parse_leading_skill_reference(prompt) else {
        return (prompt.to_string(), None);
    };

    let skills = list_claude_skills_for_workspace(project_root);
    if let Some(skill) = skills
        .into_iter()
        .find(|item| item.name.eq_ignore_ascii_case(&skill_name))
    {
        return (remainder, Some(skill));
    }

    (prompt.to_string(), None)
}

fn list_codex_skills_for_workspace(
    app: &AppHandle,
    command_path: &str,
    project_root: &str,
) -> Result<Vec<CliSkillItem>, String> {
    let resolved_command = resolve_direct_command_path(command_path);
    let mut cmd = batch_aware_command(&resolved_command, &["app-server", "--listen", "stdio://"]);
    cmd.current_dir(project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|err| format!("Failed to start Codex app-server: {}", err))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stderr".to_string())?;

    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_sink = stderr_buffer.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            if let Ok(mut buffer) = stderr_sink.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
            }
        }
    });

    let mut reader = BufReader::new(stdout);
    let mut next_id = 1_u64;
    let mut stream_state = CodexStreamState::default();
    let approvals = Arc::new(Mutex::new(BTreeMap::new()));

    let result = (|| {
        codex_rpc_call(
            &mut reader,
            &mut stdin,
            &mut next_id,
            "initialize",
            json!({
                "clientInfo": {
                    "name": "multi-cli-studio",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }),
            app,
            "",
            "",
            &mut stream_state,
            &approvals,
        )?;

        write_jsonrpc_message(&mut stdin, &json!({ "method": "initialized" }))?;

        let response = codex_rpc_call(
            &mut reader,
            &mut stdin,
            &mut next_id,
            "skills/list",
            json!({
                "cwds": [project_root],
                "forceReload": true
            }),
            app,
            "",
            "",
            &mut stream_state,
            &approvals,
        )?;
        Ok(parse_codex_skills_list(&response))
    })();

    drop(stdin);
    match child.try_wait() {
        Ok(Some(_)) => {}
        _ => {
            terminate_process_tree(child.id());
            let _ = child.wait();
        }
    }
    let _ = stderr_handle.join();
    let stderr_output = stderr_buffer
        .lock()
        .map(|buffer| buffer.clone())
        .unwrap_or_default();

    match result {
        Ok(items) => Ok(items),
        Err(err) => {
            let trimmed_stderr = stderr_output.trim();
            if trimmed_stderr.is_empty() {
                Err(err)
            } else {
                Err(format!("{}\n\nstderr:\n{}", err, trimmed_stderr))
            }
        }
    }
}

fn parse_codex_skills_list(value: &Value) -> Vec<CliSkillItem> {
    let mut items = Vec::new();
    if let Some(entries) = value.get("data").and_then(Value::as_array) {
        for entry in entries {
            let scope_label = entry.get("cwd").and_then(Value::as_str).map(|cwd| {
                if cwd.is_empty() {
                    "workspace".to_string()
                } else {
                    path_label(cwd)
                }
            });
            if let Some(skills) = entry.get("skills").and_then(Value::as_array) {
                for skill in skills {
                    if skill
                        .get("enabled")
                        .and_then(Value::as_bool)
                        .is_some_and(|value| !value)
                    {
                        continue;
                    }

                    let Some(name) = skill.get("name").and_then(Value::as_str) else {
                        continue;
                    };
                    let Some(path) = skill.get("path").and_then(Value::as_str) else {
                        continue;
                    };

                    let interface = skill.get("interface").unwrap_or(&Value::Null);
                    items.push(CliSkillItem {
                        name: name.to_string(),
                        display_name: interface
                            .get("displayName")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        description: interface
                            .get("shortDescription")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string())
                            .or_else(|| {
                                skill
                                    .get("shortDescription")
                                    .and_then(Value::as_str)
                                    .map(|value| value.to_string())
                            })
                            .or_else(|| {
                                skill
                                    .get("description")
                                    .and_then(Value::as_str)
                                    .map(|value| value.to_string())
                            }),
                        path: path.to_string(),
                        scope: skill
                            .get("scope")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        source: scope_label.clone(),
                    });
                }
            }
        }
    }

    dedupe_cli_skill_items(items)
}

fn list_codex_fallback_skills(project_root: &str) -> Vec<CliSkillItem> {
    let home = user_home_dir();
    let project_root = PathBuf::from(project_root);
    let roots = [
        (
            project_root.join(".codex").join("skills"),
            Some("project"),
            Some("repo"),
        ),
        (
            home.join(".codex").join("skills"),
            Some("user"),
            Some("user"),
        ),
        (
            home.join(".codex").join("skills").join(".system"),
            Some("built-in"),
            Some("system"),
        ),
    ];

    let root_refs = roots
        .iter()
        .map(|(path, source, scope)| (path.as_path(), *source, *scope))
        .collect::<Vec<_>>();
    list_local_cli_skills(&root_refs, true)
}

fn list_claude_skills_for_workspace(project_root: &str) -> Vec<CliSkillItem> {
    let home = user_home_dir();
    let project_root = PathBuf::from(project_root);
    let roots = [
        (
            project_root.join(".claude").join("skills"),
            Some("project"),
            Some("project"),
        ),
        (
            home.join(".claude").join("skills"),
            Some("user"),
            Some("user"),
        ),
    ];

    let root_refs = roots
        .iter()
        .map(|(path, source, scope)| (path.as_path(), *source, *scope))
        .collect::<Vec<_>>();
    list_local_cli_skills(&root_refs, true)
}

fn resolve_direct_command_path(command_path: &str) -> String {
    let lowered = command_path.to_ascii_lowercase();
    if lowered.ends_with(".ps1") {
        let candidate = PathBuf::from(command_path).with_extension("cmd");
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }

    if Path::new(command_path).extension().is_none() {
        let candidate = PathBuf::from(format!("{}.cmd", command_path));
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }

    command_path.to_string()
}

fn batch_aware_command(command_path: &str, args: &[&str]) -> Command {
    let lower_command = command_path.to_ascii_lowercase();
    if lower_command.ends_with(".cmd") || lower_command.ends_with(".bat") {
        let mut command = Command::new("cmd.exe");
        command.arg("/C").arg("call").arg(command_path).args(args);
        command
    } else {
        let mut command = Command::new(command_path);
        command.args(args);
        command
    }
}

fn start_process_watchdog(pid: u32, timeout_ms: u64) -> Arc<AtomicBool> {
    let completed = Arc::new(AtomicBool::new(false));
    let completed_flag = completed.clone();

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(timeout_ms));
        if completed_flag.load(Ordering::SeqCst) {
            return;
        }

        #[cfg(target_os = "windows")]
        {
            let mut command = Command::new("taskkill");
            command.args(["/F", "/T", "/PID", &pid.to_string()]);
            command.creation_flags(CREATE_NO_WINDOW);
            let _ = command.output();
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        }
    });

    completed
}

fn terminate_process_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("taskkill");
        command.args(["/F", "/T", "/PID", &pid.to_string()]);
        command.creation_flags(CREATE_NO_WINDOW);
        let _ = command.output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
    }
}

fn write_jsonrpc_message<W: Write>(writer: &mut W, payload: &Value) -> Result<(), String> {
    let body = serde_json::to_string(payload).map_err(|err| err.to_string())?;
    writer
        .write_all(body.as_bytes())
        .map_err(|err| err.to_string())?;
    writer.write_all(b"\n").map_err(|err| err.to_string())?;
    writer.flush().map_err(|err| err.to_string())
}

fn read_jsonrpc_message<R: BufRead>(reader: &mut R) -> Result<Option<Value>, String> {
    let mut first_line = String::new();
    loop {
        first_line.clear();
        let read = reader
            .read_line(&mut first_line)
            .map_err(|err| err.to_string())?;
        if read == 0 {
            return Ok(None);
        }
        if !first_line.trim().is_empty() {
            break;
        }
    }

    let trimmed = first_line.trim_end_matches(['\r', '\n']);
    if trimmed.starts_with('{') {
        return serde_json::from_str(trimmed)
            .map(Some)
            .map_err(|err| format!("Failed to decode line-delimited JSON-RPC message: {}", err));
    }

    let mut content_length = None;
    let mut header_line = first_line;
    loop {
        let line = header_line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("Content-Length") {
                content_length = Some(
                    value
                        .trim()
                        .parse::<usize>()
                        .map_err(|err| format!("Invalid Content-Length header: {}", err))?,
                );
            }
        }
        header_line = String::new();
        let read = reader
            .read_line(&mut header_line)
            .map_err(|err| err.to_string())?;
        if read == 0 {
            return Err("Unexpected EOF while reading JSON-RPC headers".to_string());
        }
    }

    let length = content_length
        .ok_or_else(|| "Missing Content-Length header in JSON-RPC message".to_string())?;
    let mut body = vec![0_u8; length];
    reader
        .read_exact(&mut body)
        .map_err(|err| format!("Failed to read JSON-RPC body: {}", err))?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|err| format!("Failed to decode JSON-RPC body: {}", err))
}

fn write_line_json_message<W: Write>(writer: &mut W, payload: &Value) -> Result<(), String> {
    let line = serde_json::to_string(payload).map_err(|err| err.to_string())?;
    writer
        .write_all(line.as_bytes())
        .map_err(|err| err.to_string())?;
    writer.write_all(b"\n").map_err(|err| err.to_string())?;
    writer.flush().map_err(|err| err.to_string())
}

fn json_value_as_text(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        _ => serde_json::to_string_pretty(value).ok(),
    }
}

fn json_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|entry| entry.to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn claude_permission_mode(
    session: &acp::AcpSession,
    write_mode: bool,
    previous_transport_session: Option<&AgentTransportSession>,
) -> String {
    if session.plan_mode || !write_mode {
        return "plan".to_string();
    }

    session
        .permission_mode
        .get("claude")
        .cloned()
        .or_else(|| previous_transport_session.and_then(|session| session.permission_mode.clone()))
        .unwrap_or_else(|| "acceptEdits".to_string())
}

fn claude_reasoning_effort(session: &acp::AcpSession) -> Option<String> {
    session
        .effort_level
        .clone()
        .filter(|value| !value.trim().is_empty())
}

fn claude_requested_model(
    session: &acp::AcpSession,
    previous_transport_session: Option<&AgentTransportSession>,
) -> Option<String> {
    session
        .model
        .get("claude")
        .cloned()
        .or_else(|| previous_transport_session.and_then(|session| session.model.clone()))
}

fn claude_truncate_preview(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut preview = trimmed.chars().take(max_chars).collect::<String>();
    preview.push_str("...");
    preview
}

fn claude_content_block_source(content_block: &Value) -> Option<String> {
    ["server_name", "server", "mcp_server_name", "source"]
        .iter()
        .find_map(|key| content_block.get(*key).and_then(Value::as_str))
        .map(|value| value.to_string())
}

fn claude_resolve_path(project_root: &str, path: &str) -> PathBuf {
    let raw_path = PathBuf::from(path);
    if raw_path.is_absolute() {
        raw_path
    } else {
        Path::new(project_root).join(raw_path)
    }
}

fn claude_tool_input_path(input: &Value) -> Option<String> {
    ["file_path", "path", "notebook_path"]
        .iter()
        .find_map(|key| input.get(*key).and_then(Value::as_str))
        .map(|value| value.to_string())
}

fn claude_input_string(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(|value| value.to_string())
}

fn claude_tool_input_summary(tool_name: &str, input: &Value) -> Option<String> {
    let lower = tool_name.to_ascii_lowercase();
    match lower.as_str() {
        "read" => claude_tool_input_path(input).map(|path| format!("Read {}", path)),
        "glob" => input
            .get("pattern")
            .and_then(Value::as_str)
            .map(|pattern| format!("Pattern: {}", pattern)),
        "grep" => {
            let pattern = input
                .get("pattern")
                .and_then(Value::as_str)
                .or_else(|| input.get("query").and_then(Value::as_str));
            let path = claude_tool_input_path(input);
            match (pattern, path) {
                (Some(pattern), Some(path)) => {
                    Some(format!("Pattern: {}\nPath: {}", pattern, path))
                }
                (Some(pattern), None) => Some(format!("Pattern: {}", pattern)),
                (None, Some(path)) => Some(format!("Path: {}", path)),
                _ => None,
            }
        }
        "webfetch" => input
            .get("url")
            .and_then(Value::as_str)
            .map(|url| format!("URL: {}", url)),
        "websearch" => input
            .get("query")
            .and_then(Value::as_str)
            .map(|query| format!("Query: {}", query)),
        "task" => input
            .get("description")
            .and_then(Value::as_str)
            .map(|description| claude_truncate_preview(description, 280)),
        _ => json_value_as_text(input).map(|text| claude_truncate_preview(&text, 280)),
    }
}

fn parse_claude_approval_decision(value: &str) -> Option<ClaudeApprovalDecision> {
    match value {
        "allowOnce" => Some(ClaudeApprovalDecision::AllowOnce),
        "allowAlways" => Some(ClaudeApprovalDecision::AllowAlways),
        "deny" => Some(ClaudeApprovalDecision::Deny),
        _ => None,
    }
}

fn claude_approval_state(decision: ClaudeApprovalDecision) -> &'static str {
    match decision {
        ClaudeApprovalDecision::AllowOnce => "approved",
        ClaudeApprovalDecision::AllowAlways => "approvedAlways",
        ClaudeApprovalDecision::Deny => "denied",
    }
}

fn claude_decision_classification(decision: ClaudeApprovalDecision) -> &'static str {
    match decision {
        ClaudeApprovalDecision::AllowOnce => "user_temporary",
        ClaudeApprovalDecision::AllowAlways => "user_permanent",
        ClaudeApprovalDecision::Deny => "user_reject",
    }
}

fn project_has_claude_tool_approval(
    rules: &ClaudeApprovalRules,
    project_root: &str,
    tool_name: &str,
) -> bool {
    rules
        .always_allow_by_project
        .get(project_root)
        .map(|tools| tools.contains(&tool_name.to_ascii_lowercase()))
        .unwrap_or(false)
}

fn store_claude_tool_approval(
    rules: &mut ClaudeApprovalRules,
    project_root: &str,
    tool_name: &str,
) {
    rules
        .always_allow_by_project
        .entry(project_root.to_string())
        .or_default()
        .insert(tool_name.to_ascii_lowercase());
}

fn upsert_claude_approval_block(
    stream_state: &mut ClaudeStreamState,
    request_id: &str,
    tool_name: &str,
    title: Option<String>,
    description: Option<String>,
    summary: Option<String>,
    persistent_label: Option<String>,
    state: Option<String>,
) {
    let next_block = ChatMessageBlock::ApprovalRequest {
        request_id: request_id.to_string(),
        tool_name: tool_name.to_string(),
        provider: Some("claude".to_string()),
        title,
        description,
        summary,
        persistent_label,
        state,
    };

    if let Some(index) = stream_state
        .approval_block_by_request_id
        .get(request_id)
        .copied()
    {
        if let Some(block) = stream_state.blocks.get_mut(index) {
            *block = next_block;
            return;
        }
    }

    let index = stream_state.blocks.len();
    stream_state.blocks.push(next_block);
    stream_state
        .approval_block_by_request_id
        .insert(request_id.to_string(), index);
}

fn claude_build_write_diff(project_root: &str, path: &str, new_text: &str) -> String {
    let resolved_path = claude_resolve_path(project_root, path);
    let old_text = fs::read_to_string(resolved_path).ok();
    gemini_diff_preview(path, old_text.as_deref(), new_text)
}

fn claude_build_tool_block(
    tool_kind: &str,
    tool_name: &str,
    source: Option<String>,
    input: &Value,
    project_root: &str,
) -> ChatMessageBlock {
    let lower = tool_name.to_ascii_lowercase();
    match lower.as_str() {
        "bash" => {
            let command =
                claude_input_string(input, "command").unwrap_or_else(|| tool_name.to_string());
            ChatMessageBlock::Command {
                label: infer_command_label(&command, None),
                command,
                status: Some("running".to_string()),
                cwd: input
                    .get("cwd")
                    .and_then(Value::as_str)
                    .or_else(|| input.get("workdir").and_then(Value::as_str))
                    .map(|value| value.to_string()),
                exit_code: None,
                output: None,
            }
        }
        "write" => {
            let path =
                claude_tool_input_path(input).unwrap_or_else(|| "(unknown file)".to_string());
            let resolved_path = claude_resolve_path(project_root, &path);
            let change_type = if resolved_path.exists() {
                "update"
            } else {
                "add"
            }
            .to_string();
            let new_text = claude_input_string(input, "content")
                .or_else(|| claude_input_string(input, "text"))
                .unwrap_or_default();
            ChatMessageBlock::FileChange {
                path: path.clone(),
                diff: claude_build_write_diff(project_root, &path, &new_text),
                change_type,
                move_path: None,
                status: Some("running".to_string()),
            }
        }
        "edit" | "multiedit" => {
            let path =
                claude_tool_input_path(input).unwrap_or_else(|| "(unknown file)".to_string());
            let old_text = claude_input_string(input, "old_string")
                .or_else(|| claude_input_string(input, "old_text"));
            let new_text = claude_input_string(input, "new_string")
                .or_else(|| claude_input_string(input, "new_text"))
                .unwrap_or_default();
            ChatMessageBlock::FileChange {
                path: path.clone(),
                diff: gemini_diff_preview(&path, old_text.as_deref(), &new_text),
                change_type: "update".to_string(),
                move_path: None,
                status: Some("running".to_string()),
            }
        }
        "notebookedit" => {
            let path =
                claude_tool_input_path(input).unwrap_or_else(|| "(unknown notebook)".to_string());
            let new_text = claude_input_string(input, "new_source")
                .or_else(|| claude_input_string(input, "content"))
                .unwrap_or_default();
            ChatMessageBlock::FileChange {
                path: path.clone(),
                diff: claude_build_write_diff(project_root, &path, &new_text),
                change_type: "update".to_string(),
                move_path: None,
                status: Some("running".to_string()),
            }
        }
        _ => ChatMessageBlock::Tool {
            tool: tool_name.to_string(),
            source: if tool_kind == "tool_use" {
                None
            } else {
                source
            },
            status: Some("running".to_string()),
            summary: claude_tool_input_summary(tool_name, input),
        },
    }
}

fn claude_tool_result_content(item: &Value) -> Option<String> {
    match item.get("content") {
        Some(Value::String(text)) => Some(text.trim().to_string()),
        Some(value) => json_value_as_text(value),
        None => None,
    }
}

fn claude_tool_result_status(result_payload: &Value, is_error: bool) -> String {
    if result_payload
        .get("interrupted")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        "interrupted".to_string()
    } else if is_error {
        "failed".to_string()
    } else {
        "completed".to_string()
    }
}

fn claude_tool_result_exit_code(result_payload: &Value, is_error: bool) -> Option<i32> {
    ["exit_code", "exitCode", "code", "status"]
        .iter()
        .find_map(|key| result_payload.get(*key).and_then(Value::as_i64))
        .map(|value| value as i32)
        .or_else(|| {
            if result_payload
                .get("interrupted")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                Some(130)
            } else if is_error {
                Some(1)
            } else {
                None
            }
        })
}

fn claude_tool_result_summary(
    result_payload: &Value,
    content_text: Option<&str>,
) -> Option<String> {
    if let Some(file) = result_payload.get("file") {
        let path = file.get("filePath").and_then(Value::as_str).unwrap_or("");
        let num_lines = file.get("numLines").and_then(Value::as_u64);
        if !path.trim().is_empty() {
            return Some(match num_lines {
                Some(num_lines) => format!("{} ({} lines)", path, num_lines),
                None => path.to_string(),
            });
        }
    }

    if let Some(stdout) = result_payload.get("stdout").and_then(Value::as_str) {
        let stderr = result_payload
            .get("stderr")
            .and_then(Value::as_str)
            .unwrap_or("");
        let mut parts = Vec::new();
        if !stdout.trim().is_empty() {
            parts.push(stdout.trim().to_string());
        }
        if !stderr.trim().is_empty() {
            parts.push(format!("stderr:\n{}", stderr.trim()));
        }
        if !parts.is_empty() {
            return Some(claude_truncate_preview(&parts.join("\n\n"), 420));
        }
    }

    content_text.map(|text| claude_truncate_preview(text, 420))
}

fn claude_command_output(result_payload: &Value, content_text: Option<&str>) -> Option<String> {
    let stdout = result_payload
        .get("stdout")
        .and_then(Value::as_str)
        .unwrap_or("");
    let stderr = result_payload
        .get("stderr")
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut parts = Vec::new();
    if !stdout.trim().is_empty() {
        parts.push(stdout.trim_end().to_string());
    }
    if !stderr.trim().is_empty() {
        parts.push(format!("stderr:\n{}", stderr.trim_end()));
    }
    if !parts.is_empty() {
        return Some(parts.join("\n\n"));
    }
    content_text
        .map(|text| text.trim())
        .filter(|text| !text.is_empty())
        .map(|text| text.to_string())
}

fn claude_apply_tool_result(
    stream_state: &mut ClaudeStreamState,
    tool_use_id: &str,
    result_payload: &Value,
    content_text: Option<&str>,
    is_error: bool,
) {
    let Some(block_index) = stream_state.tool_block_by_use_id.get(tool_use_id).copied() else {
        return;
    };
    let Some(block) = stream_state.blocks.get_mut(block_index) else {
        return;
    };

    let status = claude_tool_result_status(result_payload, is_error);

    match block {
        ChatMessageBlock::Command {
            status: block_status,
            output,
            exit_code,
            ..
        } => {
            *block_status = Some(status);
            *output = claude_command_output(result_payload, content_text);
            *exit_code = claude_tool_result_exit_code(result_payload, is_error);
        }
        ChatMessageBlock::FileChange {
            status: block_status,
            ..
        } => {
            *block_status = Some(status);
        }
        ChatMessageBlock::Tool {
            status: block_status,
            summary,
            ..
        } => {
            *block_status = Some(status);
            if let Some(result_summary) = claude_tool_result_summary(result_payload, content_text) {
                let merged = match summary.take() {
                    Some(existing)
                        if !existing.trim().is_empty() && existing.trim() != result_summary =>
                    {
                        format!("{}\n\n{}", existing.trim(), result_summary)
                    }
                    Some(existing) if !existing.trim().is_empty() => existing,
                    _ => result_summary,
                };
                *summary = Some(merged);
            }
        }
        _ => {}
    }
}

fn claude_should_retry_without_resume(error: &str) -> bool {
    let lowered = error.to_ascii_lowercase();
    lowered.contains("session")
        && (lowered.contains("resume")
            || lowered.contains("not found")
            || lowered.contains("no conversation")
            || lowered.contains("invalid"))
}

fn gemini_local_permission_mode(
    session: &acp::AcpSession,
    write_mode: bool,
    previous_transport_session: Option<&AgentTransportSession>,
) -> String {
    if session.plan_mode || !write_mode {
        return "plan".to_string();
    }

    session
        .permission_mode
        .get("gemini")
        .cloned()
        .or_else(|| previous_transport_session.and_then(|session| session.permission_mode.clone()))
        .unwrap_or_else(|| "auto_edit".to_string())
}

fn gemini_mode_to_acp(mode: &str) -> String {
    match mode {
        "auto_edit" => "autoEdit".to_string(),
        value if !value.trim().is_empty() => value.to_string(),
        _ => "default".to_string(),
    }
}

fn gemini_mode_from_acp(mode: &str) -> String {
    match mode {
        "autoEdit" => "auto_edit".to_string(),
        value if !value.trim().is_empty() => value.to_string(),
        _ => "default".to_string(),
    }
}

fn gemini_text_content(value: &Value) -> Option<String> {
    value
        .get("content")
        .and_then(|content| {
            if content.get("type").and_then(Value::as_str) == Some("text") {
                content.get("text").and_then(Value::as_str)
            } else {
                None
            }
        })
        .map(|text| text.to_string())
        .filter(|text| !text.is_empty())
}

fn gemini_plan_text(update: &Value) -> Option<String> {
    let entries = update.get("entries").and_then(Value::as_array)?;
    let mut lines = Vec::new();

    for (index, entry) in entries.iter().enumerate() {
        let content = entry
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if content.is_empty() {
            continue;
        }

        let status = entry
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("pending");
        let priority = entry
            .get("priority")
            .and_then(Value::as_str)
            .unwrap_or("medium");
        lines.push(format!(
            "{}. [{} | {}] {}",
            index + 1,
            status,
            priority,
            content
        ));
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn gemini_auth_method_from_settings() -> Option<String> {
    let settings_path = user_home_dir().join(".gemini").join("settings.json");
    read_json_value(&settings_path).ok().and_then(|value| {
        value
            .get("security")
            .and_then(|entry| entry.get("auth"))
            .and_then(|entry| entry.get("selectedType"))
            .and_then(Value::as_str)
            .map(|value| value.to_string())
    })
}

fn gemini_select_permission_option(options: &[Value], local_mode: &str) -> Option<String> {
    let find_kind = |target: &str| {
        options.iter().find_map(|option| {
            if option.get("kind").and_then(Value::as_str) == Some(target) {
                option
                    .get("optionId")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string())
            } else {
                None
            }
        })
    };

    let allow_once = find_kind("allow_once");
    let allow_always = find_kind("allow_always");
    let reject_once = find_kind("reject_once");
    let reject_always = find_kind("reject_always");

    match local_mode {
        "plan" => reject_once.or(reject_always),
        "yolo" | "auto_edit" => allow_always.or(allow_once).or(reject_once),
        _ => allow_once.or(allow_always).or(reject_once),
    }
}

fn gemini_permission_result(local_mode: &str, params: &Value) -> Value {
    let options = params
        .get("options")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if let Some(option_id) = gemini_select_permission_option(&options, local_mode) {
        json!({
            "outcome": {
                "outcome": "selected",
                "optionId": option_id
            }
        })
    } else {
        json!({
            "outcome": {
                "outcome": "cancelled"
            }
        })
    }
}

fn gemini_change_type(diff_item: &Value) -> String {
    if let Some(kind) = diff_item
        .get("_meta")
        .and_then(|value| value.get("kind"))
        .and_then(Value::as_str)
    {
        return match kind {
            "add" => "add",
            "delete" => "delete",
            _ => "update",
        }
        .to_string();
    }

    let old_missing =
        diff_item.get("oldText").is_none() || diff_item.get("oldText") == Some(&Value::Null);
    let new_empty = diff_item
        .get("newText")
        .and_then(Value::as_str)
        .map(|value| value.is_empty())
        .unwrap_or(true);

    if old_missing {
        "add".to_string()
    } else if new_empty {
        "delete".to_string()
    } else {
        "update".to_string()
    }
}

fn gemini_diff_preview(path: &str, old_text: Option<&str>, new_text: &str) -> String {
    let old_path = if old_text.is_some() {
        format!("a/{}", path)
    } else {
        "/dev/null".to_string()
    };
    let new_path = if new_text.is_empty() {
        "/dev/null".to_string()
    } else {
        format!("b/{}", path)
    };

    let mut lines = vec![
        format!("--- {}", old_path),
        format!("+++ {}", new_path),
        "@@".to_string(),
    ];

    if let Some(old_text) = old_text {
        for line in old_text.lines() {
            lines.push(format!("-{}", line));
        }
    }

    for line in new_text.lines() {
        lines.push(format!("+{}", line));
    }

    lines.join("\n")
}

fn gemini_apply_tool_payload(tool_call: &mut GeminiToolCallState, payload: &Value) {
    if let Some(title) = payload.get("title").and_then(Value::as_str) {
        tool_call.title = title.to_string();
    }
    if let Some(kind) = payload.get("kind").and_then(Value::as_str) {
        tool_call.kind = Some(kind.to_string());
    }
    if let Some(status) = payload.get("status").and_then(Value::as_str) {
        tool_call.status = Some(status.to_string());
    }
    if let Some(locations) = payload.get("locations").and_then(Value::as_array) {
        tool_call.locations = locations
            .iter()
            .filter_map(|location| location.get("path").and_then(Value::as_str))
            .map(|value| value.to_string())
            .collect();
    }
    if let Some(content) = payload.get("content").and_then(Value::as_array) {
        tool_call.text_content.clear();
        tool_call.diffs.clear();

        for item in content {
            match item.get("type").and_then(Value::as_str) {
                Some("content") => {
                    if let Some(text) = item
                        .get("content")
                        .and_then(|content| {
                            if content.get("type").and_then(Value::as_str) == Some("text") {
                                content.get("text").and_then(Value::as_str)
                            } else {
                                None
                            }
                        })
                        .map(str::trim)
                        .filter(|text| !text.is_empty())
                    {
                        tool_call.text_content.push(text.to_string());
                    }
                }
                Some("diff") => {
                    let path = item
                        .get("path")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if path.is_empty() {
                        continue;
                    }
                    tool_call.diffs.push(GeminiDiffEntry {
                        path,
                        old_text: item
                            .get("oldText")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        new_text: item
                            .get("newText")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        change_type: gemini_change_type(item),
                    });
                }
                Some("terminal") => {
                    if let Some(terminal_id) = item.get("terminalId").and_then(Value::as_str) {
                        tool_call
                            .text_content
                            .push(format!("Terminal: {}", terminal_id));
                    }
                }
                _ => {}
            }
        }
    }
}

fn gemini_flush_tool_call(stream_state: &mut GeminiStreamState, tool_call_id: &str) {
    let Some(tool_call) = stream_state.tool_calls.remove(tool_call_id) else {
        return;
    };

    let status = tool_call.status.clone();
    let location = tool_call.locations.first().cloned();
    let mut emitted_file_change = false;

    for diff in &tool_call.diffs {
        stream_state.blocks.push(ChatMessageBlock::FileChange {
            path: diff.path.clone(),
            diff: gemini_diff_preview(&diff.path, diff.old_text.as_deref(), &diff.new_text),
            change_type: diff.change_type.clone(),
            move_path: None,
            status: status.clone(),
        });
        emitted_file_change = true;
    }

    let summary = if tool_call.text_content.is_empty() {
        None
    } else {
        Some(tool_call.text_content.join("\n\n"))
    };

    if !emitted_file_change || summary.is_some() || matches!(status.as_deref(), Some("failed")) {
        stream_state.blocks.push(ChatMessageBlock::Tool {
            tool: if tool_call.title.trim().is_empty() {
                tool_call.kind.clone().unwrap_or_else(|| "tool".to_string())
            } else {
                tool_call.title
            },
            source: location.or(tool_call.kind),
            status,
            summary,
        });
    }
}

fn handle_gemini_request<W: Write>(
    writer: &mut W,
    method: &str,
    params: &Value,
    request_id: &Value,
    local_permission_mode: &str,
) -> Result<(), String> {
    let response = match method {
        "session/request_permission" => json!({
            "jsonrpc": "2.0",
            "id": request_id.clone(),
            "result": gemini_permission_result(local_permission_mode, params)
        }),
        _ => json!({
            "jsonrpc": "2.0",
            "id": request_id.clone(),
            "error": {
                "code": -32601,
                "message": format!("Method not found: {}", method)
            }
        }),
    };

    write_jsonrpc_message(writer, &response)
}

fn handle_gemini_notification(
    app: &AppHandle,
    terminal_tab_id: &str,
    message_id: &str,
    method: &str,
    params: &Value,
    stream_state: &mut GeminiStreamState,
    current_prompt: Option<&str>,
) -> Result<(), String> {
    if method != "session/update" {
        return Ok(());
    }

    let mut blocks_changed = false;

    if let Some(session_id) = params.get("sessionId").and_then(Value::as_str) {
        stream_state.session_id = Some(session_id.to_string());
    }

    let update = params.get("update").unwrap_or(&Value::Null);
    let update_kind = update
        .get("sessionUpdate")
        .and_then(Value::as_str)
        .unwrap_or("");

    match update_kind {
        "current_mode_update" => {
            if let Some(mode_id) = update.get("currentModeId").and_then(Value::as_str) {
                stream_state.current_mode_id = Some(mode_id.to_string());
            }
        }
        "config_option_update" | "available_commands_update" | "session_info_update" => {}
        "user_message_chunk" => {
            if stream_state.awaiting_current_user_prompt {
                if let (Some(expected_prompt), Some(text)) =
                    (current_prompt, gemini_text_content(update))
                {
                    if text.trim() == expected_prompt.trim() {
                        stream_state.active_turn_started = true;
                        stream_state.awaiting_current_user_prompt = false;
                    }
                }
            }
        }
        _ if stream_state.awaiting_current_user_prompt => {}
        "agent_message_chunk" => {
            if stream_state.awaiting_current_user_prompt {
                stream_state.active_turn_started = true;
                stream_state.awaiting_current_user_prompt = false;
            }
            if let Some(text) = gemini_text_content(update) {
                stream_state.final_content.push_str(&text);
                let _ = app.emit(
                    "stream-chunk",
                    StreamEvent {
                        terminal_tab_id: terminal_tab_id.to_string(),
                        message_id: message_id.to_string(),
                        chunk: text,
                        done: false,
                        exit_code: None,
                        duration_ms: None,
                        final_content: None,
                        content_format: None,
                        transport_kind: None,
                        transport_session: None,
                        blocks: None,
                    },
                );
            }
        }
        "agent_thought_chunk" => {
            if stream_state.awaiting_current_user_prompt {
                stream_state.active_turn_started = true;
                stream_state.awaiting_current_user_prompt = false;
            }
            if let Some(text) = gemini_text_content(update) {
                append_text_chunk(&mut stream_state.reasoning_text, &text);
            }
        }
        "tool_call" => {
            if stream_state.awaiting_current_user_prompt {
                stream_state.active_turn_started = true;
                stream_state.awaiting_current_user_prompt = false;
            }
            if let Some(tool_call_id) = update.get("toolCallId").and_then(Value::as_str) {
                let tool_call = stream_state
                    .tool_calls
                    .entry(tool_call_id.to_string())
                    .or_default();
                gemini_apply_tool_payload(tool_call, update);
            }
        }
        "tool_call_update" => {
            if stream_state.awaiting_current_user_prompt {
                stream_state.active_turn_started = true;
                stream_state.awaiting_current_user_prompt = false;
            }
            if let Some(tool_call_id) = update.get("toolCallId").and_then(Value::as_str) {
                let tool_call = stream_state
                    .tool_calls
                    .entry(tool_call_id.to_string())
                    .or_default();
                gemini_apply_tool_payload(tool_call, update);
                if matches!(
                    tool_call.status.as_deref(),
                    Some("completed") | Some("failed")
                ) {
                    gemini_flush_tool_call(stream_state, tool_call_id);
                    blocks_changed = true;
                }
            }
        }
        "plan" => {
            if stream_state.awaiting_current_user_prompt {
                stream_state.active_turn_started = true;
                stream_state.awaiting_current_user_prompt = false;
            }
            stream_state.latest_plan_text = gemini_plan_text(update);
            if let Some(plan_text) = stream_state.latest_plan_text.clone() {
                upsert_plan_block(&mut stream_state.blocks, &plan_text);
                blocks_changed = true;
            }
        }
        _ => {}
    }

    if blocks_changed {
        emit_stream_block_update_with_prefix(
            app,
            terminal_tab_id,
            message_id,
            &stream_state.block_prefix,
            &stream_state.blocks,
        );
    }

    Ok(())
}

fn gemini_rpc_call<R: BufRead, W: Write>(
    reader: &mut R,
    writer: &mut W,
    next_id: &mut u64,
    method: &str,
    params: Value,
    app: &AppHandle,
    terminal_tab_id: &str,
    message_id: &str,
    stream_state: &mut GeminiStreamState,
    current_prompt: Option<&str>,
    local_permission_mode: &str,
) -> Result<Value, String> {
    let request_id = *next_id;
    *next_id += 1;

    write_jsonrpc_message(
        writer,
        &json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params
        }),
    )?;

    loop {
        let message = read_jsonrpc_message(reader)?
            .ok_or_else(|| format!("Gemini ACP closed while waiting for {}", method))?;

        if let Some(method_name) = message.get("method").and_then(Value::as_str) {
            if let Some(request_id) = message.get("id") {
                handle_gemini_request(
                    writer,
                    method_name,
                    message.get("params").unwrap_or(&Value::Null),
                    request_id,
                    local_permission_mode,
                )?;
            } else {
                handle_gemini_notification(
                    app,
                    terminal_tab_id,
                    message_id,
                    method_name,
                    message.get("params").unwrap_or(&Value::Null),
                    stream_state,
                    current_prompt,
                )?;
            }
            continue;
        }

        if message.get("id").and_then(Value::as_u64) != Some(request_id) {
            continue;
        }

        if let Some(error) = message.get("error") {
            return Err(error
                .get("message")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
                .or_else(|| json_value_as_text(error))
                .unwrap_or_else(|| format!("Gemini ACP {} failed", method)));
        }

        return Ok(message.get("result").cloned().unwrap_or(Value::Null));
    }
}

fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn infer_command_label(command: &str, command_actions: Option<&Value>) -> String {
    if let Some(actions) = command_actions.and_then(Value::as_array) {
        if let Some(first) = actions.first() {
            match first.get("type").and_then(Value::as_str) {
                Some("read") => {
                    if let Some(name) = first.get("name").and_then(Value::as_str) {
                        return name.to_string();
                    }
                    if let Some(path) = first.get("path").and_then(Value::as_str) {
                        return path_basename(path);
                    }
                    return "read".to_string();
                }
                Some("search") => return "search".to_string(),
                Some("listFiles") => return "list files".to_string(),
                _ => {}
            }
        }
    }

    command
        .split_whitespace()
        .next()
        .map(path_basename)
        .filter(|label| !label.trim().is_empty())
        .unwrap_or_else(|| "shell".to_string())
}

fn append_text_chunk(buffer: &mut String, text: &str) {
    if text.is_empty() {
        return;
    }
    if !buffer.is_empty() && !buffer.ends_with('\n') {
        buffer.push('\n');
    }
    buffer.push_str(text);
}

fn format_turn_plan(params: &Value) -> Option<String> {
    let mut lines = Vec::new();
    if let Some(explanation) = params.get("explanation").and_then(Value::as_str) {
        let trimmed = explanation.trim();
        if !trimmed.is_empty() {
            lines.push(trimmed.to_string());
        }
    }

    if let Some(plan) = params.get("plan").and_then(Value::as_array) {
        if !lines.is_empty() {
            lines.push(String::new());
        }
        for (index, step) in plan.iter().enumerate() {
            let status = step
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("pending");
            let text = step
                .get("step")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if text.is_empty() {
                continue;
            }
            lines.push(format!("{}. [{}] {}", index + 1, status, text));
        }
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn upsert_plan_block(blocks: &mut Vec<ChatMessageBlock>, text: &str) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }
    if let Some(index) = blocks
        .iter()
        .position(|block| matches!(block, ChatMessageBlock::Plan { .. }))
    {
        blocks[index] = ChatMessageBlock::Plan {
            text: trimmed.to_string(),
        };
    } else {
        blocks.push(ChatMessageBlock::Plan {
            text: trimmed.to_string(),
        });
    }
}

fn codex_rpc_error_text(error: &Value) -> String {
    error
        .get("message")
        .and_then(Value::as_str)
        .map(|message| message.to_string())
        .or_else(|| json_value_as_text(error))
        .unwrap_or_else(|| "Unknown Codex app-server error".to_string())
}

fn render_chat_blocks(
    final_content: &str,
    blocks: &[ChatMessageBlock],
    stderr_output: &str,
) -> String {
    let mut sections = Vec::new();
    let trimmed_final = final_content.trim();
    if !trimmed_final.is_empty() {
        sections.push(trimmed_final.to_string());
    }

    for block in blocks {
        match block {
            ChatMessageBlock::Text { text, .. } => {
                let trimmed = text.trim();
                if !trimmed.is_empty() && trimmed != trimmed_final {
                    sections.push(trimmed.to_string());
                }
            }
            ChatMessageBlock::Reasoning { text } => {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    sections.push(format!("Reasoning:\n{}", trimmed));
                }
            }
            ChatMessageBlock::Command {
                command, output, ..
            } => {
                let mut section = format!("Command:\n{}", command.trim());
                if let Some(output) = output {
                    let trimmed = output.trim();
                    if !trimmed.is_empty() {
                        section.push_str("\n\n");
                        section.push_str(trimmed);
                    }
                }
                sections.push(section);
            }
            ChatMessageBlock::FileChange { path, diff, .. } => {
                let trimmed = diff.trim();
                if trimmed.is_empty() {
                    sections.push(format!("File change: {}", path));
                } else {
                    sections.push(format!("File change: {}\n{}", path, trimmed));
                }
            }
            ChatMessageBlock::Tool {
                tool,
                source,
                summary,
                ..
            } => {
                let mut section = format!("Tool: {}", tool);
                if let Some(source) = source {
                    let trimmed = source.trim();
                    if !trimmed.is_empty() {
                        section.push_str(&format!("\nSource: {}", trimmed));
                    }
                }
                if let Some(summary) = summary {
                    let trimmed = summary.trim();
                    if !trimmed.is_empty() {
                        section.push_str("\n\n");
                        section.push_str(trimmed);
                    }
                }
                sections.push(section);
            }
            ChatMessageBlock::ApprovalRequest {
                tool_name,
                title,
                summary,
                state,
                ..
            } => {
                let mut section = format!(
                    "Approval request: {}",
                    title.as_deref().unwrap_or(tool_name)
                );
                if let Some(summary) = summary {
                    let trimmed = summary.trim();
                    if !trimmed.is_empty() {
                        section.push_str(&format!("\n{}", trimmed));
                    }
                }
                if let Some(state) = state {
                    section.push_str(&format!("\nState: {}", state));
                }
                sections.push(section);
            }
            ChatMessageBlock::OrchestrationPlan {
                title,
                goal,
                summary,
                status,
            } => {
                let mut section = format!("{}:\n{}", title.trim(), goal.trim());
                if let Some(summary) = summary {
                    let trimmed = summary.trim();
                    if !trimmed.is_empty() {
                        section.push_str(&format!("\n\n{}", trimmed));
                    }
                }
                if let Some(status) = status {
                    let trimmed = status.trim();
                    if !trimmed.is_empty() {
                        section.push_str(&format!("\nStatus: {}", trimmed));
                    }
                }
                sections.push(section);
            }
            ChatMessageBlock::OrchestrationStep {
                owner,
                title,
                summary,
                result,
                status,
                ..
            } => {
                let mut section = format!("Step [{}]: {}", owner, title.trim());
                if let Some(summary) = summary {
                    let trimmed = summary.trim();
                    if !trimmed.is_empty() {
                        section.push_str(&format!("\n{}", trimmed));
                    }
                }
                if let Some(result) = result {
                    let trimmed = result.trim();
                    if !trimmed.is_empty() {
                        section.push_str(&format!("\n\n{}", trimmed));
                    }
                }
                if let Some(status) = status {
                    let trimmed = status.trim();
                    if !trimmed.is_empty() {
                        section.push_str(&format!("\nStatus: {}", trimmed));
                    }
                }
                sections.push(section);
            }
            ChatMessageBlock::AutoRoute {
                target_cli,
                title,
                reason,
                mode_hint,
                state,
            } => {
                let mut section = format!("Route suggestion [{}]: {}", target_cli, title.trim());
                let trimmed_reason = reason.trim();
                if !trimmed_reason.is_empty() {
                    section.push_str(&format!("\n{}", trimmed_reason));
                }
                if let Some(mode_hint) = mode_hint {
                    let trimmed = mode_hint.trim();
                    if !trimmed.is_empty() {
                        section.push_str(&format!("\nMode: {}", trimmed));
                    }
                }
                if let Some(state) = state {
                    let trimmed = state.trim();
                    if !trimmed.is_empty() {
                        section.push_str(&format!("\nState: {}", trimmed));
                    }
                }
                sections.push(section);
            }
            ChatMessageBlock::Plan { text } => {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    sections.push(format!("Plan:\n{}", trimmed));
                }
            }
            ChatMessageBlock::Status { level, text } => {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    sections.push(format!("{}:\n{}", level.to_uppercase(), trimmed));
                }
            }
        }
    }

    let trimmed_stderr = stderr_output.trim();
    if !trimmed_stderr.is_empty() {
        sections.push(format!("stderr:\n{}", trimmed_stderr));
    }

    sections.join("\n\n")
}

fn codex_rpc_call<R: BufRead, W: Write>(
    reader: &mut R,
    writer: &mut W,
    next_id: &mut u64,
    method: &str,
    params: Value,
    app: &AppHandle,
    terminal_tab_id: &str,
    message_id: &str,
    stream_state: &mut CodexStreamState,
    codex_pending_approvals: &Arc<Mutex<BTreeMap<String, PendingCodexApproval>>>,
) -> Result<Value, String> {
    let request_id = *next_id;
    *next_id += 1;

    write_jsonrpc_message(
        writer,
        &json!({
            "id": request_id,
            "method": method,
            "params": params
        }),
    )?;

    loop {
        let message = read_jsonrpc_message(reader)?
            .ok_or_else(|| format!("Codex app-server closed while waiting for {}", method))?;

        if let Some(notification_method) = message.get("method").and_then(Value::as_str) {
            if let Some(server_request_id) = message.get("id") {
                handle_codex_server_request(
                    writer,
                    app,
                    terminal_tab_id,
                    message_id,
                    server_request_id,
                    notification_method,
                    message.get("params").unwrap_or(&Value::Null),
                    stream_state,
                    codex_pending_approvals,
                )?;
            } else {
                handle_codex_notification(
                    app,
                    terminal_tab_id,
                    message_id,
                    notification_method,
                    message.get("params").unwrap_or(&Value::Null),
                    stream_state,
                )?;
            }
            continue;
        }

        if message.get("id").and_then(Value::as_u64) != Some(request_id) {
            continue;
        }

        if let Some(error) = message.get("error") {
            return Err(codex_rpc_error_text(error));
        }

        return Ok(message.get("result").cloned().unwrap_or(Value::Null));
    }
}

fn codex_startup_error(
    mut child: std::process::Child,
    stdin: std::process::ChildStdin,
    stderr_handle: std::thread::JoinHandle<()>,
    stderr_buffer: Arc<Mutex<String>>,
    error: String,
) -> String {
    drop(stdin);

    match child.try_wait() {
        Ok(Some(_)) => {}
        _ => {
            terminate_process_tree(child.id());
            let _ = child.wait();
        }
    }

    let _ = stderr_handle.join();
    let stderr_output = stderr_buffer
        .lock()
        .map(|buffer| buffer.clone())
        .unwrap_or_default();
    let trimmed_stderr = stderr_output.trim();

    if trimmed_stderr.is_empty() {
        error
    } else {
        format!("{}\n\nstderr:\n{}", error, trimmed_stderr)
    }
}

fn handle_codex_server_request<W: Write>(
    writer: &mut W,
    app: &AppHandle,
    terminal_tab_id: &str,
    message_id: &str,
    request_id: &Value,
    method: &str,
    params: &Value,
    stream_state: &mut CodexStreamState,
    codex_pending_approvals: &Arc<Mutex<BTreeMap<String, PendingCodexApproval>>>,
) -> Result<(), String> {
    let request_key = request_id_key(request_id);

    let (title, summary, description, tool_name) = match method {
        "item/commandExecution/requestApproval" => (
            Some("Codex wants to run a command".to_string()),
            codex_command_approval_summary(params),
            params
                .get("reason")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            "commandExecution".to_string(),
        ),
        "item/fileChange/requestApproval" => (
            Some("Codex wants to apply file changes".to_string()),
            codex_file_change_approval_summary(params),
            params
                .get("reason")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            "fileChange".to_string(),
        ),
        "item/permissions/requestApproval" => (
            Some("Codex requests additional permissions".to_string()),
            codex_permissions_approval_summary(params),
            params
                .get("reason")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            "permissions".to_string(),
        ),
        _ => {
            return Err(format!("Unsupported Codex server request: {}", method));
        }
    };

    codex_upsert_approval_block(
        &mut stream_state.blocks,
        &mut stream_state.approval_block_by_request_id,
        &request_key,
        &tool_name,
        title,
        description,
        summary,
        Some("pending".to_string()),
    );
    emit_stream_block_update_with_prefix(
        app,
        terminal_tab_id,
        message_id,
        &stream_state.block_prefix,
        &stream_state.blocks,
    );

    let (sender, receiver) = mpsc::channel::<ClaudeApprovalDecision>();
    {
        let mut approvals = codex_pending_approvals
            .lock()
            .map_err(|err| err.to_string())?;
        approvals.insert(request_key.clone(), PendingCodexApproval { sender });
    }

    let decision = receiver.recv().unwrap_or(ClaudeApprovalDecision::Deny);

    codex_upsert_approval_block(
        &mut stream_state.blocks,
        &mut stream_state.approval_block_by_request_id,
        &request_key,
        &tool_name,
        None,
        None,
        None,
        Some(claude_approval_state(decision).to_string()),
    );
    emit_stream_block_update_with_prefix(
        app,
        terminal_tab_id,
        message_id,
        &stream_state.block_prefix,
        &stream_state.blocks,
    );

    write_jsonrpc_message(
        writer,
        &json!({
            "id": request_id.clone(),
            "result": codex_build_approval_response(method, params, decision)
        }),
    )
}

fn handle_codex_notification(
    app: &AppHandle,
    terminal_tab_id: &str,
    message_id: &str,
    method: &str,
    params: &Value,
    stream_state: &mut CodexStreamState,
) -> Result<(), String> {
    let mut blocks_changed = false;
    if let Some(thread_id) = params.get("threadId").and_then(Value::as_str) {
        stream_state.thread_id = Some(thread_id.to_string());
    }
    if let Some(turn_id) = params.get("turnId").and_then(Value::as_str) {
        stream_state.turn_id = Some(turn_id.to_string());
    }

    match method {
        "item/agentMessage/delta" => {
            let delta = params.get("delta").and_then(Value::as_str).unwrap_or("");
            if !delta.is_empty() {
                if let Some(item_id) = params.get("itemId").and_then(Value::as_str) {
                    stream_state
                        .delta_by_item
                        .entry(item_id.to_string())
                        .or_default()
                        .push_str(delta);
                }
                stream_state.final_content.push_str(delta);
                let _ = app.emit(
                    "stream-chunk",
                    StreamEvent {
                        terminal_tab_id: terminal_tab_id.to_string(),
                        message_id: message_id.to_string(),
                        chunk: delta.to_string(),
                        done: false,
                        exit_code: None,
                        duration_ms: None,
                        final_content: None,
                        content_format: None,
                        transport_kind: None,
                        transport_session: None,
                        blocks: None,
                    },
                );
            }
        }
        "item/completed" => {
            let item = params.get("item").unwrap_or(&Value::Null);
            let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
            match item_type {
                "agentMessage" => {
                    let item_id = item.get("id").and_then(Value::as_str).unwrap_or("");
                    let text = item
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if !text.trim().is_empty() {
                        if !stream_state.delta_by_item.contains_key(item_id) {
                            append_text_chunk(&mut stream_state.final_content, &text);
                        }
                        stream_state.blocks.push(ChatMessageBlock::Text {
                            text,
                            format: "markdown".to_string(),
                        });
                        blocks_changed = true;
                    }
                }
                "reasoning" => {
                    let summary = json_string_array(item.get("summary"));
                    let content = json_string_array(item.get("content"));
                    let text = if !summary.is_empty() {
                        summary.join("\n")
                    } else {
                        content.join("\n")
                    };
                    if !text.trim().is_empty() {
                        stream_state
                            .blocks
                            .push(ChatMessageBlock::Reasoning { text });
                        blocks_changed = true;
                    }
                }
                "commandExecution" => {
                    let command = item
                        .get("command")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if !command.trim().is_empty() {
                        stream_state.blocks.push(ChatMessageBlock::Command {
                            label: infer_command_label(&command, item.get("commandActions")),
                            command,
                            status: item
                                .get("status")
                                .and_then(Value::as_str)
                                .map(|value| value.to_string()),
                            cwd: item
                                .get("cwd")
                                .and_then(Value::as_str)
                                .map(|value| value.to_string()),
                            exit_code: item
                                .get("exitCode")
                                .and_then(Value::as_i64)
                                .map(|value| value as i32),
                            output: item
                                .get("aggregatedOutput")
                                .and_then(Value::as_str)
                                .map(|value| value.to_string()),
                        });
                        blocks_changed = true;
                    }
                }
                "fileChange" => {
                    if let Some(changes) = item.get("changes").and_then(Value::as_array) {
                        let status = item
                            .get("status")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string());
                        for change in changes {
                            let path = change
                                .get("path")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();
                            if path.trim().is_empty() {
                                continue;
                            }
                            let kind = change.get("kind").unwrap_or(&Value::Null);
                            stream_state.blocks.push(ChatMessageBlock::FileChange {
                                path,
                                diff: change
                                    .get("diff")
                                    .and_then(Value::as_str)
                                    .unwrap_or("")
                                    .to_string(),
                                change_type: kind
                                    .get("type")
                                    .and_then(Value::as_str)
                                    .unwrap_or("update")
                                    .to_string(),
                                move_path: kind
                                    .get("move_path")
                                    .and_then(Value::as_str)
                                    .map(|value| value.to_string()),
                                status: status.clone(),
                            });
                            blocks_changed = true;
                        }
                    }
                }
                "plan" => {
                    if let Some(text) = item.get("text").and_then(Value::as_str) {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            stream_state.blocks.push(ChatMessageBlock::Plan {
                                text: trimmed.to_string(),
                            });
                            blocks_changed = true;
                        }
                    }
                }
                "mcpToolCall" => {
                    stream_state.blocks.push(ChatMessageBlock::Tool {
                        tool: item
                            .get("tool")
                            .and_then(Value::as_str)
                            .unwrap_or("mcp")
                            .to_string(),
                        source: item
                            .get("server")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        status: item
                            .get("status")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        summary: item
                            .get("error")
                            .and_then(json_value_as_text)
                            .or_else(|| item.get("result").and_then(json_value_as_text))
                            .or_else(|| item.get("arguments").and_then(json_value_as_text)),
                    });
                    blocks_changed = true;
                }
                "dynamicToolCall" => {
                    stream_state.blocks.push(ChatMessageBlock::Tool {
                        tool: item
                            .get("tool")
                            .and_then(Value::as_str)
                            .unwrap_or("dynamicTool")
                            .to_string(),
                        source: Some("dynamic".to_string()),
                        status: item
                            .get("status")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        summary: item
                            .get("contentItems")
                            .and_then(json_value_as_text)
                            .or_else(|| item.get("arguments").and_then(json_value_as_text)),
                    });
                    blocks_changed = true;
                }
                "collabAgentToolCall" => {
                    stream_state.blocks.push(ChatMessageBlock::Tool {
                        tool: item
                            .get("tool")
                            .and_then(Value::as_str)
                            .unwrap_or("collabAgent")
                            .to_string(),
                        source: Some("agent-collab".to_string()),
                        status: item
                            .get("status")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        summary: item
                            .get("prompt")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string())
                            .or_else(|| item.get("agentsStates").and_then(json_value_as_text)),
                    });
                    blocks_changed = true;
                }
                "webSearch" => {
                    stream_state.blocks.push(ChatMessageBlock::Tool {
                        tool: "webSearch".to_string(),
                        source: item
                            .get("query")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        status: Some("completed".to_string()),
                        summary: item.get("action").and_then(json_value_as_text),
                    });
                    blocks_changed = true;
                }
                "imageView" => {
                    stream_state.blocks.push(ChatMessageBlock::Tool {
                        tool: "imageView".to_string(),
                        source: item
                            .get("path")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        status: Some("completed".to_string()),
                        summary: None,
                    });
                    blocks_changed = true;
                }
                "imageGeneration" => {
                    stream_state.blocks.push(ChatMessageBlock::Tool {
                        tool: "imageGeneration".to_string(),
                        source: item
                            .get("result")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        status: item
                            .get("status")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        summary: item
                            .get("revisedPrompt")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string())
                            .or_else(|| {
                                item.get("result")
                                    .and_then(Value::as_str)
                                    .map(|value| value.to_string())
                            }),
                    });
                    blocks_changed = true;
                }
                "enteredReviewMode" => {
                    if let Some(review) = item.get("review").and_then(Value::as_str) {
                        stream_state.blocks.push(ChatMessageBlock::Status {
                            level: "info".to_string(),
                            text: format!("Entered review mode: {}", review),
                        });
                        blocks_changed = true;
                    }
                }
                "exitedReviewMode" => {
                    if let Some(review) = item.get("review").and_then(Value::as_str) {
                        stream_state.blocks.push(ChatMessageBlock::Status {
                            level: "info".to_string(),
                            text: format!("Exited review mode: {}", review),
                        });
                        blocks_changed = true;
                    }
                }
                "contextCompaction" => {
                    stream_state.blocks.push(ChatMessageBlock::Status {
                        level: "info".to_string(),
                        text: "Codex compacted the thread context.".to_string(),
                    });
                    blocks_changed = true;
                }
                _ => {}
            }
        }
        "turn/plan/updated" => {
            stream_state.latest_plan_text = format_turn_plan(params);
        }
        "turn/completed" => {
            if stream_state
                .blocks
                .iter()
                .all(|block| !matches!(block, ChatMessageBlock::Plan { .. }))
            {
                if let Some(plan_text) = stream_state.latest_plan_text.take() {
                    stream_state
                        .blocks
                        .push(ChatMessageBlock::Plan { text: plan_text });
                    blocks_changed = true;
                }
            }

            let turn = params.get("turn").unwrap_or(&Value::Null);
            let error_text = turn
                .get("error")
                .and_then(|value| value.get("message"))
                .and_then(Value::as_str)
                .map(|value| value.to_string());

            if let Some(error_text) = error_text.clone() {
                stream_state.blocks.push(ChatMessageBlock::Status {
                    level: "error".to_string(),
                    text: error_text.clone(),
                });
                blocks_changed = true;
                if stream_state.final_content.trim().is_empty() {
                    stream_state.final_content = error_text.clone();
                }
            }

            stream_state.completion = Some(CodexTurnCompletion {
                status: turn
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("completed")
                    .to_string(),
                error_text,
            });
        }
        _ => {}
    }

    if blocks_changed {
        emit_stream_block_update_with_prefix(
            app,
            terminal_tab_id,
            message_id,
            &stream_state.block_prefix,
            &stream_state.blocks,
        );
    }

    Ok(())
}

fn run_codex_app_server_turn(
    app: &AppHandle,
    command_path: &str,
    project_root: &str,
    prompt: &str,
    selected_skills: &[CliSkillItem],
    session: &acp::AcpSession,
    previous_transport_session: Option<AgentTransportSession>,
    terminal_tab_id: &str,
    message_id: &str,
    write_mode: bool,
    codex_pending_approvals: Arc<Mutex<BTreeMap<String, PendingCodexApproval>>>,
    block_prefix: Vec<ChatMessageBlock>,
) -> Result<CodexTurnOutcome, String> {
    let resolved_command = resolve_direct_command_path(command_path);
    let mut cmd = batch_aware_command(&resolved_command, &["app-server", "--listen", "stdio://"]);

    cmd.current_dir(project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|err| format!("Failed to start Codex app-server: {}", err))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stderr".to_string())?;

    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_sink = stderr_buffer.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            if let Ok(mut buffer) = stderr_sink.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
            }
        }
    });

    let mut reader = BufReader::new(stdout);
    let mut next_id = 1_u64;
    let mut stream_state = CodexStreamState::default();
    stream_state.block_prefix = block_prefix;
    let permission_mode = codex_permission_mode(session, write_mode);
    let sandbox_mode = codex_sandbox_mode(&permission_mode);
    let requested_model = session.model.get("codex").cloned();
    let effort_override = codex_reasoning_effort(session);

    let _initialize = match codex_rpc_call(
        &mut reader,
        &mut stdin,
        &mut next_id,
        "initialize",
        json!({
            "clientInfo": {
                "name": "multi-cli-studio",
                "version": env!("CARGO_PKG_VERSION")
            }
        }),
        app,
        terminal_tab_id,
        message_id,
        &mut stream_state,
        &codex_pending_approvals,
    ) {
        Ok(result) => result,
        Err(err) => {
            return Err(codex_startup_error(
                child,
                stdin,
                stderr_handle,
                stderr_buffer,
                err,
            ))
        }
    };
    if let Err(err) = write_jsonrpc_message(&mut stdin, &json!({ "method": "initialized" })) {
        return Err(codex_startup_error(
            child,
            stdin,
            stderr_handle,
            stderr_buffer,
            err,
        ));
    }

    let thread_result = if let Some(thread_id) = previous_transport_session
        .as_ref()
        .and_then(|session| session.thread_id.clone())
    {
        match codex_rpc_call(
            &mut reader,
            &mut stdin,
            &mut next_id,
            "thread/resume",
            json!({
                "threadId": thread_id,
                "cwd": project_root,
                "approvalPolicy": "on-request",
                "sandbox": sandbox_mode,
                "personality": "pragmatic",
                "model": requested_model,
            }),
            app,
            terminal_tab_id,
            message_id,
            &mut stream_state,
            &codex_pending_approvals,
        ) {
            Ok(result) => result,
            Err(err) => {
                return Err(codex_startup_error(
                    child,
                    stdin,
                    stderr_handle,
                    stderr_buffer,
                    err,
                ))
            }
        }
    } else {
        match codex_rpc_call(
            &mut reader,
            &mut stdin,
            &mut next_id,
            "thread/start",
            json!({
                "cwd": project_root,
                "approvalPolicy": "on-request",
                "sandbox": sandbox_mode,
                "personality": "pragmatic",
                "model": requested_model,
                "ephemeral": false
            }),
            app,
            terminal_tab_id,
            message_id,
            &mut stream_state,
            &codex_pending_approvals,
        ) {
            Ok(result) => result,
            Err(err) => {
                return Err(codex_startup_error(
                    child,
                    stdin,
                    stderr_handle,
                    stderr_buffer,
                    err,
                ))
            }
        }
    };

    if let Some(thread_id) = thread_result
        .get("thread")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
    {
        stream_state.thread_id = Some(thread_id.to_string());
    }

    let effective_model = thread_result
        .get("model")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .or(requested_model.clone())
        .or_else(|| {
            previous_transport_session
                .as_ref()
                .and_then(|session| session.model.clone())
        });
    let thread_id = stream_state
        .thread_id
        .clone()
        .ok_or_else(|| "Codex app-server did not return a thread id".to_string())?;
    let mut turn_input = selected_skills
        .iter()
        .map(|skill| {
            json!({
                "type": "skill",
                "name": skill.name,
                "path": skill.path,
            })
        })
        .collect::<Vec<_>>();
    if !prompt.trim().is_empty() || turn_input.is_empty() {
        turn_input.push(json!({
            "type": "text",
            "text": prompt
        }));
    }

    let _turn_start = match codex_rpc_call(
        &mut reader,
        &mut stdin,
        &mut next_id,
        "turn/start",
        json!({
            "threadId": thread_id,
            "cwd": project_root,
            "model": effective_model,
            "approvalPolicy": "on-request",
            "sandboxPolicy": codex_sandbox_policy(&permission_mode, project_root),
            "effort": effort_override,
            "summary": "detailed",
            "input": turn_input
        }),
        app,
        terminal_tab_id,
        message_id,
        &mut stream_state,
        &codex_pending_approvals,
    ) {
        Ok(result) => result,
        Err(err) => {
            return Err(codex_startup_error(
                child,
                stdin,
                stderr_handle,
                stderr_buffer,
                err,
            ))
        }
    };

    while stream_state.completion.is_none() {
        let message = read_jsonrpc_message(&mut reader)?
            .ok_or_else(|| "Codex app-server closed before the turn completed".to_string())?;
        if let Some(method) = message.get("method").and_then(Value::as_str) {
            if let Some(server_request_id) = message.get("id") {
                handle_codex_server_request(
                    &mut stdin,
                    app,
                    terminal_tab_id,
                    message_id,
                    server_request_id,
                    method,
                    message.get("params").unwrap_or(&Value::Null),
                    &mut stream_state,
                    &codex_pending_approvals,
                )?;
            } else {
                handle_codex_notification(
                    app,
                    terminal_tab_id,
                    message_id,
                    method,
                    message.get("params").unwrap_or(&Value::Null),
                    &mut stream_state,
                )?;
            }
        }
    }

    drop(stdin);
    let _ = child.wait();
    let _ = stderr_handle.join();
    let stderr_output = stderr_buffer
        .lock()
        .map(|buffer| buffer.clone())
        .unwrap_or_default();

    let completion = stream_state
        .completion
        .clone()
        .ok_or_else(|| "Codex app-server completed without turn status".to_string())?;
    let exit_code = match completion.status.as_str() {
        "completed" => Some(0),
        "interrupted" => Some(130),
        "failed" => Some(1),
        _ => None,
    };

    let final_content = if stream_state.final_content.trim().is_empty() {
        completion.error_text.clone().unwrap_or_default()
    } else {
        stream_state.final_content.clone()
    };
    let content_format = if stream_state
        .blocks
        .iter()
        .any(|block| matches!(block, ChatMessageBlock::Text { .. }))
    {
        "markdown".to_string()
    } else {
        "plain".to_string()
    };
    let raw_output = render_chat_blocks(&final_content, &stream_state.blocks, &stderr_output);
    let transport_session = build_transport_session(
        "codex",
        previous_transport_session,
        stream_state.thread_id.clone(),
        stream_state.turn_id.clone(),
        effective_model,
        Some(permission_mode),
    );

    Ok(CodexTurnOutcome {
        final_content,
        content_format,
        raw_output,
        exit_code,
        blocks: stream_state.blocks,
        transport_session,
    })
}

fn handle_claude_stream_event(
    app: &AppHandle,
    terminal_tab_id: &str,
    message_id: &str,
    project_root: &str,
    event: &Value,
    stream_state: &mut ClaudeStreamState,
) -> Result<(), String> {
    let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
    let mut blocks_changed = false;
    match event_type {
        "message_start" => {
            let message = event.get("message").unwrap_or(&Value::Null);
            stream_state.turn_id = message
                .get("id")
                .and_then(Value::as_str)
                .map(|value| value.to_string());
            if let Some(model) = message.get("model").and_then(Value::as_str) {
                stream_state.current_model_id = Some(model.to_string());
            }
            stream_state.content_blocks.clear();
        }
        "content_block_start" => {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let content_block = event.get("content_block").unwrap_or(&Value::Null);
            let block_type = content_block
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("");

            match block_type {
                "text" => {
                    let initial_text = content_block
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if !initial_text.is_empty() {
                        stream_state.final_content.push_str(&initial_text);
                        let _ = app.emit(
                            "stream-chunk",
                            StreamEvent {
                                terminal_tab_id: terminal_tab_id.to_string(),
                                message_id: message_id.to_string(),
                                chunk: initial_text.clone(),
                                done: false,
                                exit_code: None,
                                duration_ms: None,
                                final_content: None,
                                content_format: None,
                                transport_kind: None,
                                transport_session: None,
                                blocks: None,
                            },
                        );
                    }
                    stream_state
                        .content_blocks
                        .insert(index, ClaudeContentBlockState::Text(initial_text));
                }
                "thinking" => {
                    let initial_text = content_block
                        .get("thinking")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    stream_state
                        .content_blocks
                        .insert(index, ClaudeContentBlockState::Thinking(initial_text));
                }
                "tool_use" | "server_tool_use" | "mcp_tool_use" => {
                    let tool_use_id = content_block
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let tool_name = content_block
                        .get("name")
                        .and_then(Value::as_str)
                        .or_else(|| content_block.get("tool_name").and_then(Value::as_str))
                        .unwrap_or("tool")
                        .to_string();
                    let source = claude_content_block_source(content_block);
                    let input = content_block.get("input").cloned().unwrap_or(Value::Null);
                    let block = claude_build_tool_block(
                        block_type,
                        &tool_name,
                        source.clone(),
                        &input,
                        project_root,
                    );
                    let block_index = stream_state.blocks.len();
                    stream_state.blocks.push(block);
                    blocks_changed = true;
                    if !tool_use_id.trim().is_empty() {
                        stream_state
                            .tool_block_by_use_id
                            .insert(tool_use_id.clone(), block_index);
                    }
                    let input_json = if input.is_null()
                        || input
                            .as_object()
                            .map(|value| value.is_empty())
                            .unwrap_or(false)
                    {
                        String::new()
                    } else {
                        serde_json::to_string(&input).unwrap_or_default()
                    };
                    stream_state.content_blocks.insert(
                        index,
                        ClaudeContentBlockState::Tool(ClaudeToolUseState {
                            name: tool_name,
                            kind: block_type.to_string(),
                            source,
                            input_json,
                            block_index,
                        }),
                    );
                }
                _ => {}
            }
        }
        "content_block_delta" => {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let delta = event.get("delta").unwrap_or(&Value::Null);
            let delta_type = delta.get("type").and_then(Value::as_str).unwrap_or("");
            if let Some(block_state) = stream_state.content_blocks.get_mut(&index) {
                match block_state {
                    ClaudeContentBlockState::Text(text) if delta_type == "text_delta" => {
                        if let Some(chunk) = delta.get("text").and_then(Value::as_str) {
                            text.push_str(chunk);
                            stream_state.final_content.push_str(chunk);
                            let _ = app.emit(
                                "stream-chunk",
                                StreamEvent {
                                    terminal_tab_id: terminal_tab_id.to_string(),
                                    message_id: message_id.to_string(),
                                    chunk: chunk.to_string(),
                                    done: false,
                                    exit_code: None,
                                    duration_ms: None,
                                    final_content: None,
                                    content_format: None,
                                    transport_kind: None,
                                    transport_session: None,
                                    blocks: None,
                                },
                            );
                        }
                    }
                    ClaudeContentBlockState::Thinking(text) if delta_type == "thinking_delta" => {
                        if let Some(chunk) = delta.get("thinking").and_then(Value::as_str) {
                            text.push_str(chunk);
                        }
                    }
                    ClaudeContentBlockState::Tool(tool_state)
                        if delta_type == "input_json_delta" =>
                    {
                        if let Some(chunk) = delta.get("partial_json").and_then(Value::as_str) {
                            tool_state.input_json.push_str(chunk);
                        }
                    }
                    _ => {}
                }
            }
        }
        "content_block_stop" => {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            if let Some(block_state) = stream_state.content_blocks.remove(&index) {
                match block_state {
                    ClaudeContentBlockState::Text(text) => {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            stream_state.blocks.push(ChatMessageBlock::Text {
                                text,
                                format: "markdown".to_string(),
                            });
                        }
                    }
                    ClaudeContentBlockState::Thinking(text) => {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            stream_state.blocks.push(ChatMessageBlock::Reasoning {
                                text: trimmed.to_string(),
                            });
                            blocks_changed = true;
                        }
                    }
                    ClaudeContentBlockState::Tool(tool_state) => {
                        let input = if tool_state.input_json.trim().is_empty() {
                            Value::Null
                        } else {
                            match serde_json::from_str::<Value>(&tool_state.input_json) {
                                Ok(value) => value,
                                Err(error) => {
                                    stream_state.parse_failures.push(format!(
                                        "tool input for {}: {}",
                                        tool_state.name, error
                                    ));
                                    Value::Null
                                }
                            }
                        };

                        if let Some(block) = stream_state.blocks.get_mut(tool_state.block_index) {
                            let next_block = claude_build_tool_block(
                                &tool_state.kind,
                                &tool_state.name,
                                tool_state.source.clone(),
                                &input,
                                project_root,
                            );
                            let current_status = match block {
                                ChatMessageBlock::Command { status, .. } => status.clone(),
                                ChatMessageBlock::FileChange { status, .. } => status.clone(),
                                ChatMessageBlock::Tool { status, .. } => status.clone(),
                                _ => None,
                            };

                            *block = match next_block {
                                ChatMessageBlock::Command {
                                    label,
                                    command,
                                    cwd,
                                    exit_code,
                                    output,
                                    ..
                                } => ChatMessageBlock::Command {
                                    label,
                                    command,
                                    status: current_status.or_else(|| Some("running".to_string())),
                                    cwd,
                                    exit_code,
                                    output,
                                },
                                ChatMessageBlock::FileChange {
                                    path,
                                    diff,
                                    change_type,
                                    move_path,
                                    ..
                                } => ChatMessageBlock::FileChange {
                                    path,
                                    diff,
                                    change_type,
                                    move_path,
                                    status: current_status.or_else(|| Some("running".to_string())),
                                },
                                ChatMessageBlock::Tool {
                                    tool,
                                    source,
                                    summary,
                                    ..
                                } => ChatMessageBlock::Tool {
                                    tool,
                                    source,
                                    status: current_status.or_else(|| Some("running".to_string())),
                                    summary,
                                },
                                other => other,
                            };
                            blocks_changed = true;
                        }
                    }
                }
            }
        }
        "message_delta" => {
            if let Some(stop_reason) = event
                .get("delta")
                .and_then(|delta| delta.get("stop_reason"))
                .and_then(Value::as_str)
            {
                stream_state.stop_reason = Some(stop_reason.to_string());
            }
        }
        _ => {}
    }

    if blocks_changed {
        emit_stream_block_update(app, terminal_tab_id, message_id, &stream_state.blocks);
    }

    Ok(())
}

fn handle_claude_stream_record(
    app: &AppHandle,
    stdin: &mut std::process::ChildStdin,
    terminal_tab_id: &str,
    message_id: &str,
    project_root: &str,
    record: &Value,
    stream_state: &mut ClaudeStreamState,
    claude_approval_rules: &Arc<Mutex<ClaudeApprovalRules>>,
    claude_pending_approvals: &Arc<Mutex<BTreeMap<String, PendingClaudeApproval>>>,
) -> Result<(), String> {
    if let Some(session_id) = record.get("session_id").and_then(Value::as_str) {
        stream_state.session_id = Some(session_id.to_string());
    }

    let record_type = record.get("type").and_then(Value::as_str).unwrap_or("");
    match record_type {
        "system" => {
            if let Some(model) = record.get("model").and_then(Value::as_str) {
                stream_state.current_model_id = Some(model.to_string());
            }
            if let Some(permission_mode) = record.get("permissionMode").and_then(Value::as_str) {
                stream_state.permission_mode = Some(permission_mode.to_string());
            }
        }
        "control_request" => {
            let request = record.get("request").unwrap_or(&Value::Null);
            if request.get("subtype").and_then(Value::as_str) == Some("can_use_tool") {
                let request_id = record
                    .get("request_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Claude permission request missing request_id".to_string())?
                    .to_string();
                let tool_name = request
                    .get("tool_name")
                    .and_then(Value::as_str)
                    .unwrap_or("tool")
                    .to_string();
                let tool_use_id = request
                    .get("tool_use_id")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string());
                let input = request.get("input").cloned().unwrap_or(Value::Null);
                let title = request
                    .get("title")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string())
                    .or_else(|| {
                        request
                            .get("display_name")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string())
                    })
                    .or_else(|| Some(format!("Claude wants to use {}", tool_name)));
                let summary = claude_tool_input_summary(&tool_name, &input);
                let description = request
                    .get("description")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string())
                    .or_else(|| {
                        request
                            .get("decision_reason")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string())
                    });

                let auto_allow = claude_approval_rules
                    .lock()
                    .map(|rules| project_has_claude_tool_approval(&rules, project_root, &tool_name))
                    .unwrap_or(false);

                if auto_allow {
                    write_line_json_message(
                        stdin,
                        &json!({
                            "type": "control_response",
                            "response": {
                                "subtype": "success",
                                "request_id": request_id,
                                "response": {
                                    "behavior": "allow",
                                    "updatedInput": {},
                                    "toolUseID": tool_use_id,
                                    "decisionClassification": claude_decision_classification(ClaudeApprovalDecision::AllowAlways)
                                }
                            }
                        }),
                    )?;
                } else {
                    upsert_claude_approval_block(
                        stream_state,
                        &request_id,
                        &tool_name,
                        title,
                        description,
                        summary,
                        Some("Yes, don't ask again".to_string()),
                        Some("pending".to_string()),
                    );
                    emit_stream_block_update(
                        app,
                        terminal_tab_id,
                        message_id,
                        &stream_state.blocks,
                    );

                    let (sender, receiver) = mpsc::channel::<ClaudeApprovalDecision>();
                    {
                        let mut approvals = claude_pending_approvals
                            .lock()
                            .map_err(|err| err.to_string())?;
                        approvals.insert(
                            request_id.clone(),
                            PendingClaudeApproval {
                                project_root: project_root.to_string(),
                                tool_name: tool_name.clone(),
                                sender,
                            },
                        );
                    }

                    let decision = receiver.recv().unwrap_or(ClaudeApprovalDecision::Deny);
                    upsert_claude_approval_block(
                        stream_state,
                        &request_id,
                        &tool_name,
                        None,
                        None,
                        None,
                        None,
                        Some(claude_approval_state(decision).to_string()),
                    );
                    emit_stream_block_update(
                        app,
                        terminal_tab_id,
                        message_id,
                        &stream_state.blocks,
                    );

                    let response = match decision {
                        ClaudeApprovalDecision::AllowOnce | ClaudeApprovalDecision::AllowAlways => {
                            json!({
                                "behavior": "allow",
                                "updatedInput": {},
                                "toolUseID": tool_use_id,
                                "decisionClassification": claude_decision_classification(decision)
                            })
                        }
                        ClaudeApprovalDecision::Deny => {
                            json!({
                                "behavior": "deny",
                                "message": "Permission denied by user.",
                                "toolUseID": tool_use_id,
                                "decisionClassification": claude_decision_classification(decision)
                            })
                        }
                    };

                    write_line_json_message(
                        stdin,
                        &json!({
                            "type": "control_response",
                            "response": {
                                "subtype": "success",
                                "request_id": request_id,
                                "response": response
                            }
                        }),
                    )?;
                }
            }
        }
        "stream_event" => {
            handle_claude_stream_event(
                app,
                terminal_tab_id,
                message_id,
                project_root,
                record.get("event").unwrap_or(&Value::Null),
                stream_state,
            )?;
        }
        "user" => {
            let mut blocks_changed = false;
            if let Some(items) = record
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(Value::as_array)
            {
                for item in items {
                    if item.get("type").and_then(Value::as_str) != Some("tool_result") {
                        continue;
                    }
                    let Some(tool_use_id) = item.get("tool_use_id").and_then(Value::as_str) else {
                        continue;
                    };
                    let content_text = claude_tool_result_content(item);
                    let is_error = item
                        .get("is_error")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    claude_apply_tool_result(
                        stream_state,
                        tool_use_id,
                        record.get("tool_use_result").unwrap_or(item),
                        content_text.as_deref(),
                        is_error,
                    );
                    blocks_changed = true;
                }
            }
            if blocks_changed {
                emit_stream_block_update(app, terminal_tab_id, message_id, &stream_state.blocks);
            }
        }
        "result" => {
            stream_state.result_received = true;
            stream_state.result_is_error = record
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || record.get("subtype").and_then(Value::as_str) == Some("error");
            if let Some(stop_reason) = record.get("stop_reason").and_then(Value::as_str) {
                stream_state.stop_reason = Some(stop_reason.to_string());
            }
            if let Some(result_text) = record.get("result").and_then(Value::as_str) {
                stream_state.result_text = Some(result_text.to_string());
            }
        }
        _ => {}
    }

    Ok(())
}

fn emit_stream_block_update(
    app: &AppHandle,
    terminal_tab_id: &str,
    message_id: &str,
    blocks: &[ChatMessageBlock],
) {
    emit_stream_block_update_with_prefix(app, terminal_tab_id, message_id, &[], blocks);
}

fn emit_stream_block_update_with_prefix(
    app: &AppHandle,
    terminal_tab_id: &str,
    message_id: &str,
    prefix: &[ChatMessageBlock],
    blocks: &[ChatMessageBlock],
) {
    let merged_blocks = if prefix.is_empty() {
        blocks.to_vec()
    } else {
        let mut merged = prefix.to_vec();
        merged.extend_from_slice(blocks);
        merged
    };

    let _ = app.emit(
        "stream-chunk",
        StreamEvent {
            terminal_tab_id: terminal_tab_id.to_string(),
            message_id: message_id.to_string(),
            chunk: String::new(),
            done: false,
            exit_code: None,
            duration_ms: None,
            final_content: None,
            content_format: None,
            transport_kind: None,
            transport_session: None,
            blocks: Some(merged_blocks),
        },
    );
}

fn request_id_key(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        _ => value.to_string(),
    }
}

fn codex_upsert_approval_block(
    blocks: &mut Vec<ChatMessageBlock>,
    by_request_id: &mut BTreeMap<String, usize>,
    request_id: &str,
    tool_name: &str,
    title: Option<String>,
    description: Option<String>,
    summary: Option<String>,
    state: Option<String>,
) {
    let next_block = ChatMessageBlock::ApprovalRequest {
        request_id: request_id.to_string(),
        tool_name: tool_name.to_string(),
        provider: Some("codex".to_string()),
        title,
        description,
        summary,
        persistent_label: Some("Yes, for this session".to_string()),
        state,
    };

    if let Some(index) = by_request_id.get(request_id).copied() {
        if let Some(block) = blocks.get_mut(index) {
            *block = next_block;
            return;
        }
    }

    let index = blocks.len();
    blocks.push(next_block);
    by_request_id.insert(request_id.to_string(), index);
}

fn codex_summary_with_lines(lines: Vec<String>) -> Option<String> {
    let filtered = lines
        .into_iter()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if filtered.is_empty() {
        None
    } else {
        Some(filtered.join("\n"))
    }
}

fn codex_command_approval_summary(params: &Value) -> Option<String> {
    codex_summary_with_lines(vec![
        params
            .get("command")
            .and_then(Value::as_str)
            .map(|value| format!("Command: {}", value))
            .unwrap_or_default(),
        params
            .get("cwd")
            .and_then(Value::as_str)
            .map(|value| format!("Cwd: {}", value))
            .unwrap_or_default(),
    ])
}

fn codex_file_change_approval_summary(params: &Value) -> Option<String> {
    codex_summary_with_lines(vec![
        params
            .get("reason")
            .and_then(Value::as_str)
            .map(|value| format!("Reason: {}", value))
            .unwrap_or_default(),
        params
            .get("grantRoot")
            .and_then(Value::as_str)
            .map(|value| format!("Grant root: {}", value))
            .unwrap_or_default(),
    ])
}

fn codex_permissions_approval_summary(params: &Value) -> Option<String> {
    let permissions = params.get("permissions").unwrap_or(&Value::Null);
    let fs = permissions.get("fileSystem").unwrap_or(&Value::Null);
    let network = permissions.get("network").unwrap_or(&Value::Null);

    let read_paths = fs
        .get("read")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    let write_paths = fs
        .get("write")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();
    let network_enabled = network
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    codex_summary_with_lines(vec![
        if read_paths.is_empty() {
            String::new()
        } else {
            format!("Read: {}", read_paths.join(", "))
        },
        if write_paths.is_empty() {
            String::new()
        } else {
            format!("Write: {}", write_paths.join(", "))
        },
        if network_enabled {
            "Network: enabled".to_string()
        } else {
            String::new()
        },
    ])
}

fn codex_build_approval_response(
    method: &str,
    params: &Value,
    decision: ClaudeApprovalDecision,
) -> Value {
    match method {
        "item/commandExecution/requestApproval" => {
            let mapped = match decision {
                ClaudeApprovalDecision::AllowOnce => "accept",
                ClaudeApprovalDecision::AllowAlways => "acceptForSession",
                ClaudeApprovalDecision::Deny => "decline",
            };
            json!({ "decision": mapped })
        }
        "item/fileChange/requestApproval" => {
            let mapped = match decision {
                ClaudeApprovalDecision::AllowOnce => "accept",
                ClaudeApprovalDecision::AllowAlways => "acceptForSession",
                ClaudeApprovalDecision::Deny => "decline",
            };
            json!({ "decision": mapped })
        }
        "item/permissions/requestApproval" => {
            let permissions = match decision {
                ClaudeApprovalDecision::Deny => json!({}),
                _ => params
                    .get("permissions")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            };
            let scope = match decision {
                ClaudeApprovalDecision::AllowAlways => "session",
                _ => "turn",
            };
            json!({
                "permissions": permissions,
                "scope": scope,
            })
        }
        _ => json!({ "decision": "decline" }),
    }
}

fn run_claude_headless_turn_once(
    app: &AppHandle,
    command_path: &str,
    project_root: &str,
    prompt: &str,
    session: &acp::AcpSession,
    previous_transport_session: Option<AgentTransportSession>,
    resume_session_id: Option<String>,
    terminal_tab_id: &str,
    message_id: &str,
    write_mode: bool,
    timeout_ms: u64,
    claude_approval_rules: Arc<Mutex<ClaudeApprovalRules>>,
    claude_pending_approvals: Arc<Mutex<BTreeMap<String, PendingClaudeApproval>>>,
) -> Result<ClaudeTurnOutcome, String> {
    let resolved_command = resolve_direct_command_path(command_path);
    let requested_model = claude_requested_model(session, previous_transport_session.as_ref());
    let requested_effort = claude_reasoning_effort(session);
    let requested_permission =
        claude_permission_mode(session, write_mode, previous_transport_session.as_ref());

    let mut args = vec![
        "-p".to_string(),
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--include-partial-messages".to_string(),
        "--permission-prompt-tool".to_string(),
        "stdio".to_string(),
        "--permission-mode".to_string(),
        requested_permission.clone(),
    ];

    if let Some(model) = requested_model.clone() {
        args.push("--model".to_string());
        args.push(model);
    }
    if let Some(effort) = requested_effort.clone() {
        args.push("--effort".to_string());
        args.push(effort);
    }
    if let Some(session_id) = resume_session_id
        .clone()
        .filter(|value| !value.trim().is_empty())
    {
        args.push("--resume".to_string());
        args.push(session_id);
    }

    let mut cmd = if resolved_command.to_ascii_lowercase().ends_with(".cmd")
        || resolved_command.to_ascii_lowercase().ends_with(".bat")
    {
        let mut command = Command::new("cmd.exe");
        command
            .arg("/C")
            .arg("call")
            .arg(&resolved_command)
            .args(&args);
        command
    } else {
        let mut command = Command::new(&resolved_command);
        command.args(&args);
        command
    };

    cmd.current_dir(project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|err| format!("Failed to start Claude CLI: {}", err))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture Claude stdout".to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture Claude stdin".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture Claude stderr".to_string())?;

    write_line_json_message(
        &mut stdin,
        &json!({
            "type": "user",
            "session_id": "",
            "message": {
                "role": "user",
                "content": prompt,
            },
            "parent_tool_use_id": Value::Null
        }),
    )
    .map_err(|err| format!("Failed to write Claude prompt: {}", err))?;

    let completed = Arc::new(AtomicBool::new(false));
    let timed_out = Arc::new(AtomicBool::new(false));
    let completed_flag = completed.clone();
    let timed_out_flag = timed_out.clone();
    let child_pid = child.id();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(timeout_ms));
        if completed_flag.load(Ordering::SeqCst) {
            return;
        }
        timed_out_flag.store(true, Ordering::SeqCst);
        terminate_process_tree(child_pid);
    });

    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_sink = stderr_buffer.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            if let Ok(mut buffer) = stderr_sink.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
            }
        }
    });

    let mut stream_state = ClaudeStreamState::default();
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let line = line.map_err(|err| err.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        match serde_json::from_str::<Value>(trimmed) {
            Ok(record) => handle_claude_stream_record(
                app,
                &mut stdin,
                terminal_tab_id,
                message_id,
                project_root,
                &record,
                &mut stream_state,
                &claude_approval_rules,
                &claude_pending_approvals,
            )?,
            Err(error) => stream_state.parse_failures.push(format!(
                "{} | {}",
                error,
                claude_truncate_preview(trimmed, 240)
            )),
        }

        if stream_state.result_received {
            break;
        }
    }

    drop(stdin);
    let status = child.wait().map_err(|err| err.to_string())?;
    completed.store(true, Ordering::SeqCst);
    let _ = stderr_handle.join();

    if timed_out.load(Ordering::SeqCst) {
        return Err(format!("Claude CLI timed out after {}ms", timeout_ms));
    }

    let stderr_output = stderr_buffer
        .lock()
        .map(|buffer| buffer.clone())
        .unwrap_or_default();

    if !stream_state.parse_failures.is_empty() {
        stream_state.blocks.push(ChatMessageBlock::Status {
            level: "warning".to_string(),
            text: format!(
                "Claude stream-json emitted {} unparsed line(s).\n{}",
                stream_state.parse_failures.len(),
                stream_state.parse_failures.join("\n")
            ),
        });
    }

    let mut final_content = if stream_state.final_content.trim().is_empty() {
        stream_state.result_text.clone().unwrap_or_default()
    } else {
        stream_state.final_content.clone()
    };

    if stream_state.result_is_error && final_content.trim().is_empty() {
        final_content = stderr_output.trim().to_string();
    }

    if !final_content.trim().is_empty()
        && stream_state
            .blocks
            .iter()
            .all(|block| !matches!(block, ChatMessageBlock::Text { .. }))
    {
        stream_state.blocks.push(ChatMessageBlock::Text {
            text: final_content.clone(),
            format: "markdown".to_string(),
        });
    }

    let stop_reason = stream_state
        .stop_reason
        .clone()
        .unwrap_or_else(|| "end_turn".to_string());
    if stop_reason == "max_tokens" {
        stream_state.blocks.push(ChatMessageBlock::Status {
            level: "warning".to_string(),
            text: "Claude stopped because it hit the max token limit.".to_string(),
        });
    }

    let exit_code = if stream_state.result_is_error {
        Some(1)
    } else {
        match stop_reason.as_str() {
            "cancelled" | "interrupted" => Some(130),
            _ => status.code().or(Some(if status.success() { 0 } else { 1 })),
        }
    };

    if stream_state.result_is_error
        && final_content.trim().is_empty()
        && stderr_output.trim().is_empty()
    {
        return Err("Claude CLI failed before returning a usable result.".to_string());
    }

    if !status.success()
        && !stream_state.result_is_error
        && final_content.trim().is_empty()
        && stderr_output.trim().is_empty()
    {
        return Err(format!("Claude CLI exited with {}", status));
    }

    let raw_output = render_chat_blocks(&final_content, &stream_state.blocks, &stderr_output);
    let transport_session = build_transport_session(
        "claude",
        previous_transport_session,
        stream_state.session_id.clone().or(resume_session_id),
        stream_state.turn_id.clone(),
        stream_state.current_model_id.clone().or(requested_model),
        stream_state
            .permission_mode
            .clone()
            .or(Some(requested_permission)),
    );

    Ok(ClaudeTurnOutcome {
        final_content,
        content_format: "markdown".to_string(),
        raw_output,
        exit_code,
        blocks: stream_state.blocks,
        transport_session,
    })
}

fn run_claude_headless_turn(
    app: &AppHandle,
    command_path: &str,
    project_root: &str,
    prompt: &str,
    session: &acp::AcpSession,
    previous_transport_session: Option<AgentTransportSession>,
    terminal_tab_id: &str,
    message_id: &str,
    write_mode: bool,
    timeout_ms: u64,
    claude_approval_rules: Arc<Mutex<ClaudeApprovalRules>>,
    claude_pending_approvals: Arc<Mutex<BTreeMap<String, PendingClaudeApproval>>>,
) -> Result<ClaudeTurnOutcome, String> {
    let resume_session_id = previous_transport_session
        .as_ref()
        .and_then(|session| session.thread_id.clone());

    match run_claude_headless_turn_once(
        app,
        command_path,
        project_root,
        prompt,
        session,
        previous_transport_session.clone(),
        resume_session_id.clone(),
        terminal_tab_id,
        message_id,
        write_mode,
        timeout_ms,
        claude_approval_rules.clone(),
        claude_pending_approvals.clone(),
    ) {
        Ok(outcome) => Ok(outcome),
        Err(error) if resume_session_id.is_some() && claude_should_retry_without_resume(&error) => {
            let fallback_transport_session = previous_transport_session.map(|mut session| {
                session.thread_id = None;
                session
            });
            run_claude_headless_turn_once(
                app,
                command_path,
                project_root,
                prompt,
                session,
                fallback_transport_session,
                None,
                terminal_tab_id,
                message_id,
                write_mode,
                timeout_ms,
                claude_approval_rules,
                claude_pending_approvals,
            )
        }
        Err(error) => Err(error),
    }
}

fn run_gemini_acp_turn(
    app: &AppHandle,
    command_path: &str,
    project_root: &str,
    prompt: &str,
    session: &acp::AcpSession,
    previous_transport_session: Option<AgentTransportSession>,
    terminal_tab_id: &str,
    message_id: &str,
    write_mode: bool,
    timeout_ms: u64,
    block_prefix: Vec<ChatMessageBlock>,
) -> Result<GeminiTurnOutcome, String> {
    let resolved_command = resolve_direct_command_path(command_path);
    let mut cmd = batch_aware_command(&resolved_command, &["--acp"]);

    cmd.current_dir(project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|err| format!("Failed to start Gemini ACP: {}", err))?;
    let watchdog = start_process_watchdog(child.id(), timeout_ms);
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open Gemini ACP stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open Gemini ACP stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open Gemini ACP stderr".to_string())?;

    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_sink = stderr_buffer.clone();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            if let Ok(mut buffer) = stderr_sink.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
            }
        }
    });

    let mut reader = BufReader::new(stdout);
    let mut next_id = 1_u64;
    let mut stream_state = GeminiStreamState::default();
    stream_state.block_prefix = block_prefix;

    let previous_session_id = previous_transport_session
        .as_ref()
        .and_then(|session| session.thread_id.clone());
    let requested_model = session.model.get("gemini").cloned().or_else(|| {
        previous_transport_session
            .as_ref()
            .and_then(|session| session.model.clone())
    });
    let requested_local_permission =
        gemini_local_permission_mode(session, write_mode, previous_transport_session.as_ref());
    let requested_mode_id = gemini_mode_to_acp(&requested_local_permission);

    let initialize_result = gemini_rpc_call(
        &mut reader,
        &mut stdin,
        &mut next_id,
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientInfo": {
                "name": "multi-cli-studio",
                "version": env!("CARGO_PKG_VERSION")
            },
            "clientCapabilities": {}
        }),
        app,
        terminal_tab_id,
        message_id,
        &mut stream_state,
        None,
        &requested_local_permission,
    )?;

    if let Some(auth_method_id) = gemini_auth_method_from_settings() {
        let supports_auth_method = initialize_result
            .get("authMethods")
            .and_then(Value::as_array)
            .map(|methods| {
                methods.iter().any(|method| {
                    method.get("id").and_then(Value::as_str) == Some(auth_method_id.as_str())
                })
            })
            .unwrap_or(false);

        if supports_auth_method {
            let _ = gemini_rpc_call(
                &mut reader,
                &mut stdin,
                &mut next_id,
                "authenticate",
                json!({
                    "methodId": auth_method_id
                }),
                app,
                terminal_tab_id,
                message_id,
                &mut stream_state,
                None,
                &requested_local_permission,
            )?;
        }
    }

    let session_result = if let Some(session_id) = previous_session_id.clone() {
        stream_state.awaiting_current_user_prompt = true;
        stream_state.active_turn_started = false;
        match gemini_rpc_call(
            &mut reader,
            &mut stdin,
            &mut next_id,
            "session/load",
            json!({
                "sessionId": session_id,
                "cwd": project_root,
                "mcpServers": []
            }),
            app,
            terminal_tab_id,
            message_id,
            &mut stream_state,
            None,
            &requested_local_permission,
        ) {
            Ok(result) => {
                stream_state.session_id = Some(session_id);
                result
            }
            Err(_) => {
                stream_state.awaiting_current_user_prompt = false;
                stream_state.active_turn_started = true;
                let result = gemini_rpc_call(
                    &mut reader,
                    &mut stdin,
                    &mut next_id,
                    "session/new",
                    json!({
                        "cwd": project_root,
                        "mcpServers": []
                    }),
                    app,
                    terminal_tab_id,
                    message_id,
                    &mut stream_state,
                    None,
                    &requested_local_permission,
                )?;
                if let Some(session_id) = result.get("sessionId").and_then(Value::as_str) {
                    stream_state.session_id = Some(session_id.to_string());
                }
                result
            }
        }
    } else {
        stream_state.awaiting_current_user_prompt = false;
        stream_state.active_turn_started = true;
        let result = gemini_rpc_call(
            &mut reader,
            &mut stdin,
            &mut next_id,
            "session/new",
            json!({
                "cwd": project_root,
                "mcpServers": []
            }),
            app,
            terminal_tab_id,
            message_id,
            &mut stream_state,
            None,
            &requested_local_permission,
        )?;
        if let Some(session_id) = result.get("sessionId").and_then(Value::as_str) {
            stream_state.session_id = Some(session_id.to_string());
        }
        result
    };

    let session_id = stream_state
        .session_id
        .clone()
        .ok_or_else(|| "Gemini ACP did not return a session id".to_string())?;

    let current_mode_id = session_result
        .get("modes")
        .and_then(|value| value.get("currentModeId"))
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let available_modes = session_result
        .get("modes")
        .and_then(|value| value.get("availableModes"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mode_available = available_modes.is_empty()
        || available_modes
            .iter()
            .any(|mode| mode.get("id").and_then(Value::as_str) == Some(requested_mode_id.as_str()));

    stream_state.current_mode_id = current_mode_id.clone();
    if mode_available && current_mode_id.as_deref() != Some(requested_mode_id.as_str()) {
        let _ = gemini_rpc_call(
            &mut reader,
            &mut stdin,
            &mut next_id,
            "session/set_mode",
            json!({
                "sessionId": session_id,
                "modeId": requested_mode_id
            }),
            app,
            terminal_tab_id,
            message_id,
            &mut stream_state,
            None,
            &requested_local_permission,
        )?;
        stream_state.current_mode_id = Some(requested_mode_id.clone());
    }

    let current_model_id = session_result
        .get("models")
        .and_then(|value| value.get("currentModelId"))
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let available_models = session_result
        .get("models")
        .and_then(|value| value.get("availableModels"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    stream_state.current_model_id = current_model_id.clone();

    if let Some(model_id) = requested_model.clone() {
        let model_available = available_models.is_empty()
            || available_models.iter().any(|model| {
                model.get("modelId").and_then(Value::as_str) == Some(model_id.as_str())
            });
        if model_available && current_model_id.as_deref() != Some(model_id.as_str()) {
            let _ = gemini_rpc_call(
                &mut reader,
                &mut stdin,
                &mut next_id,
                "session/set_model",
                json!({
                    "sessionId": session_id,
                    "modelId": model_id
                }),
                app,
                terminal_tab_id,
                message_id,
                &mut stream_state,
                None,
                &requested_local_permission,
            )?;
            stream_state.current_model_id = Some(model_id);
        }
    }

    let prompt_result = gemini_rpc_call(
        &mut reader,
        &mut stdin,
        &mut next_id,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [
                {
                    "type": "text",
                    "text": prompt
                }
            ]
        }),
        app,
        terminal_tab_id,
        message_id,
        &mut stream_state,
        Some(prompt),
        &requested_local_permission,
    )?;

    stream_state.prompt_stop_reason = prompt_result
        .get("stopReason")
        .and_then(Value::as_str)
        .map(|value| value.to_string());

    let outstanding_tool_calls = stream_state.tool_calls.keys().cloned().collect::<Vec<_>>();
    for tool_call_id in outstanding_tool_calls {
        gemini_flush_tool_call(&mut stream_state, &tool_call_id);
    }

    drop(stdin);
    watchdog.store(true, Ordering::SeqCst);
    let shutdown_deadline = Instant::now() + Duration::from_millis(300);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < shutdown_deadline => {
                thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                terminate_process_tree(child.id());
                let _ = child.wait();
                break;
            }
            Err(_) => break,
        }
    }
    let _ = stderr_handle.join();
    let stderr_output = stderr_buffer
        .lock()
        .map(|buffer| buffer.clone())
        .unwrap_or_default();

    let effective_model = stream_state
        .current_model_id
        .clone()
        .or(requested_model)
        .or_else(|| {
            previous_transport_session
                .as_ref()
                .and_then(|session| session.model.clone())
        });
    let effective_permission = stream_state
        .current_mode_id
        .as_deref()
        .map(gemini_mode_from_acp)
        .unwrap_or_else(|| requested_local_permission.clone());

    let mut blocks = Vec::new();
    if !stream_state.final_content.trim().is_empty() {
        blocks.push(ChatMessageBlock::Text {
            text: stream_state.final_content.clone(),
            format: "markdown".to_string(),
        });
    }
    if !stream_state.reasoning_text.trim().is_empty() {
        blocks.push(ChatMessageBlock::Reasoning {
            text: stream_state.reasoning_text.trim().to_string(),
        });
    }
    let has_plan_block = stream_state
        .blocks
        .iter()
        .any(|block| matches!(block, ChatMessageBlock::Plan { .. }));
    blocks.extend(stream_state.blocks);
    if let Some(plan_text) = stream_state.latest_plan_text.clone() {
        if !has_plan_block {
            blocks.push(ChatMessageBlock::Plan { text: plan_text });
        }
    }

    let stop_reason = stream_state
        .prompt_stop_reason
        .clone()
        .unwrap_or_else(|| "end_turn".to_string());
    let exit_code = match stop_reason.as_str() {
        "cancelled" => Some(130),
        _ => Some(0),
    };

    if stop_reason == "max_tokens" {
        blocks.push(ChatMessageBlock::Status {
            level: "warning".to_string(),
            text: "Gemini stopped because it hit the max token limit.".to_string(),
        });
    } else if stop_reason == "max_turn_requests" {
        blocks.push(ChatMessageBlock::Status {
            level: "warning".to_string(),
            text: "Gemini stopped because it hit the max turn request limit.".to_string(),
        });
    } else if stop_reason == "refusal" {
        blocks.push(ChatMessageBlock::Status {
            level: "warning".to_string(),
            text: "Gemini refused the request.".to_string(),
        });
    }

    if previous_session_id.is_some()
        && !stream_state.active_turn_started
        && stream_state.final_content.trim().is_empty()
        && blocks.is_empty()
    {
        return Err(
            "Gemini ACP resumed the session but no current-turn output was captured.".to_string(),
        );
    }

    let raw_output = render_chat_blocks(&stream_state.final_content, &blocks, &stderr_output);
    let transport_session = build_transport_session(
        "gemini",
        previous_transport_session,
        Some(session_id),
        None,
        effective_model,
        Some(effective_permission),
    );

    Ok(GeminiTurnOutcome {
        final_content: stream_state.final_content,
        content_format: "markdown".to_string(),
        raw_output,
        exit_code,
        blocks,
        transport_session,
    })
}

// ── Tauri commands ─────────────────────────────────────────────────────

#[tauri::command]
fn load_app_state(
    app: AppHandle,
    store: State<'_, AppStore>,
    project_root: Option<String>,
) -> Result<AppStateDto, String> {
    let project_root = project_root.unwrap_or_else(default_project_root);
    let mut state = load_or_seed_state(&project_root)?;
    state.environment.backend = "tauri".to_string();
    state.environment.tauri_ready = true;
    state.environment.rust_available = rust_available();
    state.environment.notes = environment_notes();
    sync_workspace_metrics(&mut state);
    sync_agent_runtime(&mut state);
    persist_state(&state)?;

    {
        let mut guard = store.state.lock().map_err(|err| err.to_string())?;
        *guard = state.clone();
    }

    // Load context store from disk
    {
        let ctx = load_or_seed_context(&project_root)?;
        let mut guard = store.context.lock().map_err(|err| err.to_string())?;
        *guard = ctx;
    }

    // Load settings
    {
        let s = load_or_seed_settings(&project_root)?;
        let mut guard = store.settings.lock().map_err(|err| err.to_string())?;
        *guard = s;
    }

    emit_state(&app, &state);
    Ok(state)
}

#[tauri::command]
fn switch_active_agent(
    app: AppHandle,
    store: State<'_, AppStore>,
    agent_id: String,
) -> Result<AppStateDto, String> {
    let next_state = mutate_state(&store, |state| {
        state.workspace.active_agent = agent_id.clone();
        update_agent_modes(state, None, Some(&agent_id));
        append_activity(
            state,
            "info",
            &format!("{} attached", agent_id),
            &format!(
                "{} is now attached to the primary workspace surface.",
                agent_id
            ),
        );
        append_terminal_line(state, &agent_id, "system", "primary terminal attached");
        sync_workspace_metrics(state);
    })?;
    persist_state(&next_state)?;
    emit_state(&app, &next_state);
    Ok(next_state)
}

#[tauri::command]
fn take_over_writer(
    app: AppHandle,
    store: State<'_, AppStore>,
    agent_id: String,
) -> Result<AppStateDto, String> {
    // Capture enriched handoff data before mutating state
    let (previous_writer, git_diff, changed_files, previous_turns) = {
        let state = store.state.lock().map_err(|err| err.to_string())?;
        let ctx = store.context.lock().map_err(|err| err.to_string())?;
        let prev = state.workspace.current_writer.clone();
        let project_root = state.workspace.project_root.clone();

        let diff = git_output(&project_root, &["diff", "--stat"])
            .unwrap_or_else(|| "no changes".to_string());
        let files = git_output(&project_root, &["status", "--porcelain"])
            .map(|output| {
                output
                    .lines()
                    .filter(|l| !l.trim().is_empty())
                    .map(|l| l.trim().split_whitespace().last().unwrap_or("").to_string())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let turns = ctx
            .agents
            .get(&prev)
            .map(|a| {
                a.conversation_history
                    .iter()
                    .rev()
                    .take(5)
                    .cloned()
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect()
            })
            .unwrap_or_default();

        (prev, diff, files, turns)
    };

    // Create enriched handoff
    let enriched = EnrichedHandoff {
        id: create_id("handoff"),
        from: previous_writer.clone(),
        to: agent_id.clone(),
        timestamp: now_stamp(),
        git_diff: git_diff.clone(),
        changed_files: changed_files.clone(),
        previous_turns,
        user_goal: format!(
            "Resume implementation after {} staged the current app session.",
            previous_writer
        ),
        status: "ready".to_string(),
    };

    // Store enriched handoff in context store
    {
        let mut ctx = store.context.lock().map_err(|err| err.to_string())?;
        ctx.handoffs.insert(0, enriched.clone());
        if ctx.handoffs.len() > 20 {
            ctx.handoffs.truncate(20);
        }
        persist_context(&ctx)?;
    }

    let next_state = mutate_state(&store, |state| {
        state.workspace.current_writer = agent_id.clone();
        state.workspace.active_agent = agent_id.clone();
        state.workspace.handoff_ready = true;
        update_agent_modes(state, Some(&agent_id), Some(&agent_id));
        append_terminal_line(
            state,
            &previous_writer,
            "system",
            &format!("writer lock released to {}", agent_id),
        );
        append_terminal_line(
            state,
            &agent_id,
            "system",
            &format!("writer lock acquired from {}", previous_writer),
        );

        let handoff_files = if changed_files.is_empty() {
            vec![
                "src/App.tsx".to_string(),
                "src/lib/bridge.ts".to_string(),
                "src-tauri/src/main.rs".to_string(),
            ]
        } else {
            changed_files.clone()
        };

        prepend_handoff(
            state,
            HandoffPack {
                id: enriched.id.clone(),
                from: previous_writer.clone(),
                to: agent_id.clone(),
                status: "ready".to_string(),
                goal: format!(
                    "Resume implementation after {} staged the current app session.",
                    previous_writer
                ),
                files: handoff_files,
                risks: vec![
                    "Preserve single-writer control".to_string(),
                    "Keep frontend and backend state shapes aligned".to_string(),
                ],
                next_step: format!(
                    "Continue the active task as {} without dropping the current project context.",
                    agent_id
                ),
                updated_at: "just now".to_string(),
            },
        );
        append_activity(
            state,
            "success",
            &format!("{} took over", agent_id),
            &format!(
                "Writer ownership moved from {} to {}.",
                previous_writer, agent_id
            ),
        );
        sync_workspace_metrics(state);
    })?;
    persist_state(&next_state)?;
    emit_state(&app, &next_state);
    Ok(next_state)
}

#[tauri::command]
fn snapshot_workspace(app: AppHandle, store: State<'_, AppStore>) -> Result<AppStateDto, String> {
    let next_state = mutate_state(&store, |state| {
        state.workspace.last_snapshot = Some(now_stamp());
        state.workspace.handoff_ready = true;
        append_terminal_line(
            state,
            &state.workspace.active_agent.clone(),
            "system",
            "workspace snapshot captured and attached to the app session",
        );
        append_activity(
            state,
            "success",
            "Workspace snapshot stored",
            "The current project state is ready for handoff or review.",
        );
        sync_workspace_metrics(state);
    })?;
    persist_state(&next_state)?;
    emit_state(&app, &next_state);
    Ok(next_state)
}

#[tauri::command]
fn run_checks(
    app: AppHandle,
    store: State<'_, AppStore>,
    project_root: Option<String>,
    cli_id: Option<String>,
    _terminal_tab_id: Option<String>,
) -> Result<String, String> {
    let app_handle = app.clone();
    let state_arc = store.state.clone();

    let state = state_arc.lock().map_err(|err| err.to_string())?.clone();
    let agent_id = cli_id.unwrap_or_else(|| state.workspace.current_writer.clone());
    let project_root = project_root.unwrap_or_else(|| state.workspace.project_root.clone());
    let shell = shell_path();
    let timeout = {
        store
            .settings
            .lock()
            .map(|s| s.process_timeout_ms)
            .unwrap_or(DEFAULT_TIMEOUT_MS)
    };
    let command = if Path::new(&project_root).join("package.json").exists() {
        "npm run build".to_string()
    } else {
        "git status --short".to_string()
    };

    mutate_store_arc(&state_arc, |mut_state| {
        append_terminal_line(
            mut_state,
            &agent_id,
            "system",
            "running workspace checks...",
        );
        append_activity(
            mut_state,
            "info",
            "Checks started",
            "Executing the default validation command for the current project.",
        );
    })?;

    thread::spawn(move || {
        let output = spawn_shell_command(
            &shell,
            &project_root,
            &command,
            app_handle.clone(),
            state_arc.clone(),
            &agent_id,
            "system",
            timeout,
        );

        match output {
            Ok(full_output) => {
                let summary = display_summary(&full_output);
                let _ = mutate_store_arc(&state_arc, |state| {
                    state.workspace.failing_checks = 0;
                    append_activity(
                        state,
                        "success",
                        "Checks completed",
                        "Validation command finished successfully.",
                    );
                    prepend_artifact(
                        state,
                        ReviewArtifact {
                            id: create_id("artifact"),
                            source: agent_id.clone(),
                            title: "Validation result".to_string(),
                            kind: "diff".to_string(),
                            summary,
                            confidence: "high".to_string(),
                            created_at: "just now".to_string(),
                        },
                    );
                    sync_workspace_metrics(state);
                });
            }
            Err(error) => {
                let _ = mutate_store_arc(&state_arc, |state| {
                    state.workspace.failing_checks = state.workspace.failing_checks.max(1);
                    append_activity(state, "warning", "Checks failed", &error);
                    append_terminal_line(state, &agent_id, "system", &error);
                    sync_workspace_metrics(state);
                });
            }
        }

        if let Ok(state) = state_arc.lock() {
            let snapshot = state.clone();
            let _ = persist_state(&snapshot);
            emit_state(&app_handle, &snapshot);
        }
    });

    Ok(create_id("checks"))
}

#[tauri::command]
fn submit_prompt(
    app: AppHandle,
    store: State<'_, AppStore>,
    request: AgentPromptRequest,
) -> Result<String, String> {
    start_agent_job(app, store, request.agent_id, request.prompt, false)
}

#[tauri::command]
fn request_review(
    app: AppHandle,
    store: State<'_, AppStore>,
    agent_id: String,
) -> Result<String, String> {
    let prompt = {
        let state = store.state.lock().map_err(|err| err.to_string())?.clone();
        build_review_prompt(&state, &agent_id)
    };
    start_agent_job(app, store, agent_id, prompt, true)
}

#[tauri::command]
fn get_context_store(store: State<'_, AppStore>) -> Result<ContextStore, String> {
    let ctx = store.context.lock().map_err(|err| err.to_string())?;
    Ok(ctx.clone())
}

#[tauri::command]
fn get_conversation_history(
    store: State<'_, AppStore>,
    agent_id: String,
) -> Result<Vec<ConversationTurn>, String> {
    let ctx = store.context.lock().map_err(|err| err.to_string())?;
    Ok(ctx
        .agents
        .get(&agent_id)
        .map(|a| a.conversation_history.clone())
        .unwrap_or_default())
}

#[tauri::command]
fn get_settings(store: State<'_, AppStore>) -> Result<AppSettings, String> {
    let s = store.settings.lock().map_err(|err| err.to_string())?;
    Ok(s.clone())
}

#[tauri::command]
fn update_settings(
    store: State<'_, AppStore>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    {
        let mut s = store.settings.lock().map_err(|err| err.to_string())?;
        *s = settings.clone();
    }
    {
        let mut ctx = store.context.lock().map_err(|err| err.to_string())?;
        ctx.max_turns_per_agent = settings.max_turns_per_agent;
        ctx.max_output_chars_per_turn = settings.max_output_chars_per_turn;
        persist_context(&ctx)?;
    }
    persist_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
fn load_terminal_state(
    store: State<'_, AppStore>,
) -> Result<Option<PersistedTerminalState>, String> {
    store.terminal_storage.load_state()
}

#[tauri::command]
fn save_terminal_state(
    store: State<'_, AppStore>,
    state: PersistedTerminalState,
) -> Result<(), String> {
    store.terminal_storage.save_state(&state)
}

#[tauri::command]
fn append_chat_messages(
    store: State<'_, AppStore>,
    request: MessageEventsAppendRequest,
) -> Result<(), String> {
    store.terminal_storage.append_chat_messages(&request)
}

#[tauri::command]
fn update_chat_message_stream(
    store: State<'_, AppStore>,
    request: MessageStreamUpdateRequest,
) -> Result<(), String> {
    store.terminal_storage.update_chat_message_stream(&request)
}

#[tauri::command]
fn finalize_chat_message(
    store: State<'_, AppStore>,
    request: MessageFinalizeRequest,
) -> Result<(), String> {
    store.terminal_storage.finalize_chat_message(&request)
}

#[tauri::command]
fn delete_chat_message_record(
    store: State<'_, AppStore>,
    request: MessageDeleteRequest,
) -> Result<(), String> {
    store.terminal_storage.delete_chat_message(&request)
}

#[tauri::command]
fn delete_chat_session_by_tab(
    store: State<'_, AppStore>,
    terminal_tab_id: String,
) -> Result<(), String> {
    store.terminal_storage.delete_chat_session_by_tab(&terminal_tab_id)
}

#[tauri::command]
fn update_chat_message_blocks(
    store: State<'_, AppStore>,
    request: MessageBlocksUpdateRequest,
) -> Result<(), String> {
    store.terminal_storage.update_chat_message_blocks(&request)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationRunRecord {
    id: String,
    job_id: Option<String>,
    job_name: String,
    project_name: String,
    project_root: String,
    workspace_id: String,
    execution_mode: String,
    permission_profile: String,
    trigger_source: String,
    run_number: Option<usize>,
    status: String,
    display_status: String,
    lifecycle_status: String,
    outcome_status: String,
    attention_status: String,
    resolution_code: String,
    status_summary: Option<String>,
    summary: Option<String>,
    requires_attention_reason: Option<String>,
    objective_signals: AutomationObjectiveSignals,
    judge_assessment: AutomationJudgeAssessment,
    relevant_files: Vec<String>,
    last_exit_code: Option<i32>,
    terminal_tab_id: Option<String>,
    parameter_values: BTreeMap<String, Value>,
    scheduled_start_at: Option<String>,
    started_at: Option<String>,
    completed_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutomationRunDetailDto {
    run: AutomationRunRecord,
    job: Option<AutomationJob>,
    rule_config: AutomationGoalRuleConfig,
    goal: String,
    expected_outcome: String,
    events: Vec<automation::AutomationEvent>,
    conversation_session: Option<PersistedConversationSession>,
    task_context: Option<TaskContextBundle>,
}

fn primary_goal(run: &AutomationRun) -> Option<&AutomationGoal> {
    run.goals
        .iter()
        .min_by_key(|goal| goal.position)
        .or_else(|| run.goals.first())
}

fn automation_run_record(run: &AutomationRun) -> AutomationRunRecord {
    let goal = primary_goal(run);
    AutomationRunRecord {
        id: run.id.clone(),
        job_id: run.job_id.clone(),
        job_name: run
            .job_name
            .clone()
            .or_else(|| goal.map(|item| item.title.clone()))
            .unwrap_or_else(|| run.project_name.clone()),
        project_name: run.project_name.clone(),
        project_root: run.project_root.clone(),
        workspace_id: run.workspace_id.clone(),
        execution_mode: goal
            .map(|item| item.execution_mode.clone())
            .unwrap_or_else(|| "auto".to_string()),
        permission_profile: run.permission_profile.clone(),
        trigger_source: run
            .trigger_source
            .clone()
            .unwrap_or_else(|| "manual".to_string()),
        run_number: run.run_number,
        status: run.status.clone(),
        display_status: display_status_from_dimensions(
            &run.lifecycle_status,
            &run.outcome_status,
            &run.attention_status,
        ),
        lifecycle_status: run.lifecycle_status.clone(),
        outcome_status: run.outcome_status.clone(),
        attention_status: run.attention_status.clone(),
        resolution_code: run.resolution_code.clone(),
        status_summary: run.status_summary.clone(),
        summary: run.summary.clone(),
        requires_attention_reason: goal.and_then(|item| item.requires_attention_reason.clone()),
        objective_signals: run.objective_signals.clone(),
        judge_assessment: run.judge_assessment.clone(),
        relevant_files: goal.map(|item| item.relevant_files.clone()).unwrap_or_default(),
        last_exit_code: goal.and_then(|item| item.last_exit_code),
        terminal_tab_id: goal.map(|item| item.synthetic_terminal_tab_id.clone()),
        parameter_values: run.parameter_values.clone(),
        scheduled_start_at: run.scheduled_start_at.clone(),
        started_at: run.started_at.clone(),
        completed_at: run.completed_at.clone(),
        created_at: run.created_at.clone(),
        updated_at: run.updated_at.clone(),
    }
}

fn transport_kind_for_cli(cli_id: &str) -> String {
    match cli_id {
        "claude" => "claude-cli".to_string(),
        "gemini" => "gemini-acp".to_string(),
        "codex" => "codex-app-server".to_string(),
        _ => "browser-fallback".to_string(),
    }
}

fn ensure_automation_conversation_session(
    terminal_storage: &TerminalStorage,
    run: &AutomationRun,
    goal: &AutomationGoal,
) -> Result<PersistedConversationSession, String> {
    if let Some(existing) =
        terminal_storage.load_conversation_session_by_terminal_tab(&goal.synthetic_terminal_tab_id)?
    {
        return Ok(existing);
    }

    let now = now_stamp();
    Ok(PersistedConversationSession {
        id: create_id("session"),
        terminal_tab_id: goal.synthetic_terminal_tab_id.clone(),
        workspace_id: run.workspace_id.clone(),
        project_root: run.project_root.clone(),
        project_name: run.project_name.clone(),
        messages: Vec::new(),
        compacted_summaries: Vec::new(),
        last_compacted_at: None,
        created_at: now.clone(),
        updated_at: now,
    })
}

fn append_automation_turn_seed(
    terminal_storage: &TerminalStorage,
    run: &AutomationRun,
    goal: &AutomationGoal,
    owner_cli: &str,
    prompt: &str,
    message_id: &str,
) -> Result<(), String> {
    let now = now_stamp();
    let session = ensure_automation_conversation_session(terminal_storage, run, goal)?;
    let request = MessageEventsAppendRequest {
        seeds: vec![MessageSessionSeed {
            terminal_tab_id: goal.synthetic_terminal_tab_id.clone(),
            session,
            messages: vec![
                PersistedChatMessage {
                    id: create_id("auto-user"),
                    role: "user".to_string(),
                    cli_id: None,
                    timestamp: now.clone(),
                    content: prompt.to_string(),
                    raw_content: Some(prompt.to_string()),
                    content_format: Some("plain".to_string()),
                    transport_kind: None,
                    blocks: None,
                    is_streaming: false,
                    duration_ms: None,
                    exit_code: None,
                },
                PersistedChatMessage {
                    id: message_id.to_string(),
                    role: "assistant".to_string(),
                    cli_id: Some(owner_cli.to_string()),
                    timestamp: now.clone(),
                    content: String::new(),
                    raw_content: Some(String::new()),
                    content_format: Some("log".to_string()),
                    transport_kind: Some(transport_kind_for_cli(owner_cli)),
                    blocks: None,
                    is_streaming: true,
                    duration_ms: None,
                    exit_code: None,
                },
            ],
        }],
    };
    terminal_storage.append_chat_messages(&request)
}

fn finalize_automation_turn_message(
    terminal_storage: &TerminalStorage,
    goal: &AutomationGoal,
    message_id: &str,
    outcome: &AutomationExecutionOutcome,
) -> Result<(), String> {
    terminal_storage.finalize_chat_message(&MessageFinalizeRequest {
        terminal_tab_id: goal.synthetic_terminal_tab_id.clone(),
        message_id: message_id.to_string(),
        raw_content: outcome.raw_output.clone(),
        content: outcome.raw_output.clone(),
        content_format: Some("log".to_string()),
        blocks: if outcome.blocks.is_empty() {
            None
        } else {
            Some(outcome.blocks.clone())
        },
        transport_kind: outcome
            .transport_session
            .as_ref()
            .map(|session| session.kind.clone()),
        transport_session: outcome.transport_session.clone(),
        exit_code: outcome.exit_code,
        duration_ms: None,
        updated_at: now_stamp(),
    })
}

#[tauri::command]
fn list_automation_jobs(store: State<'_, AppStore>) -> Result<Vec<AutomationJob>, String> {
    let mut jobs = store
        .automation_jobs
        .lock()
        .map_err(|err| err.to_string())?
        .clone();
    jobs.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(jobs)
}

#[tauri::command]
fn get_automation_job(store: State<'_, AppStore>, job_id: String) -> Result<AutomationJob, String> {
    store
        .automation_jobs
        .lock()
        .map_err(|err| err.to_string())?
        .iter()
        .find(|job| job.id == job_id)
        .cloned()
        .ok_or_else(|| "Automation job not found.".to_string())
}

#[tauri::command]
fn create_automation_job(
    store: State<'_, AppStore>,
    job: AutomationJobDraft,
) -> Result<AutomationJob, String> {
    let created = build_job_from_draft(job)?;
    let mut jobs = store
        .automation_jobs
        .lock()
        .map_err(|err| err.to_string())?;
    jobs.insert(0, created.clone());
    persist_automation_jobs_to_disk(&jobs)?;
    Ok(created)
}

#[tauri::command]
fn update_automation_job(
    store: State<'_, AppStore>,
    job_id: String,
    job: AutomationJobDraft,
) -> Result<AutomationJob, String> {
    let mut jobs = store
        .automation_jobs
        .lock()
        .map_err(|err| err.to_string())?;
    let index = jobs
        .iter()
        .position(|item| item.id == job_id)
        .ok_or_else(|| "Automation job not found.".to_string())?;
    let updated = update_job_from_draft(&jobs[index], job)?;
    jobs[index] = updated.clone();
    persist_automation_jobs_to_disk(&jobs)?;
    Ok(updated)
}

#[tauri::command]
fn delete_automation_job(store: State<'_, AppStore>, job_id: String) -> Result<(), String> {
    if store
        .automation_runs
        .lock()
        .map_err(|err| err.to_string())?
        .iter()
        .any(|run| {
            run.job_id.as_deref() == Some(job_id.as_str())
                && matches!(run.status.as_str(), "running" | "scheduled" | "paused")
        })
    {
        return Err("This job has active runs and cannot be deleted yet.".to_string());
    }

    let mut jobs = store
        .automation_jobs
        .lock()
        .map_err(|err| err.to_string())?;
    let index = jobs
        .iter()
        .position(|item| item.id == job_id)
        .ok_or_else(|| "Automation job not found.".to_string())?;
    jobs.remove(index);
    persist_automation_jobs_to_disk(&jobs)?;
    Ok(())
}

#[tauri::command]
fn list_automation_runs(store: State<'_, AppStore>) -> Result<Vec<AutomationRun>, String> {
    let mut runs = store
        .automation_runs
        .lock()
        .map_err(|err| err.to_string())?
        .clone();
    runs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(runs)
}

#[tauri::command]
fn list_automation_job_runs(
    store: State<'_, AppStore>,
    job_id: Option<String>,
) -> Result<Vec<AutomationRunRecord>, String> {
    let mut runs = store
        .automation_runs
        .lock()
        .map_err(|err| err.to_string())?
        .clone()
        .into_iter()
        .filter(|run| match job_id.as_deref() {
            Some(needle) => run.job_id.as_deref() == Some(needle),
            None => true,
        })
        .map(|run| automation_run_record(&run))
        .collect::<Vec<_>>();
    runs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(runs)
}

#[tauri::command]
fn get_automation_run_detail(
    store: State<'_, AppStore>,
    run_id: String,
) -> Result<AutomationRunDetailDto, String> {
    let run = store
        .automation_runs
        .lock()
        .map_err(|err| err.to_string())?
        .iter()
        .find(|item| item.id == run_id)
        .cloned()
        .ok_or_else(|| "Automation run not found.".to_string())?;
    let goal = primary_goal(&run)
        .cloned()
        .ok_or_else(|| "Automation run has no goal.".to_string())?;
    let session = store
        .terminal_storage
        .load_conversation_session_by_terminal_tab(&goal.synthetic_terminal_tab_id)?;
    let task_context = store
        .terminal_storage
        .load_task_context_bundle(&goal.synthetic_terminal_tab_id)?;
    let job = match run.job_id.as_deref() {
        Some(job_id) => store
            .automation_jobs
            .lock()
            .map_err(|err| err.to_string())?
            .iter()
            .find(|item| item.id == job_id)
            .cloned(),
        None => None,
    };

    Ok(AutomationRunDetailDto {
        run: automation_run_record(&run),
        job,
        rule_config: goal.rule_config.clone(),
        goal: goal.goal.clone(),
        expected_outcome: goal.expected_outcome.clone(),
        events: run.events.clone(),
        conversation_session: session,
        task_context,
    })
}

#[tauri::command]
fn get_automation_rule_profile(
    store: State<'_, AppStore>,
) -> Result<AutomationRuleProfile, String> {
    store
        .automation_rule_profile
        .lock()
        .map(|guard| guard.clone())
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn update_automation_rule_profile(
    store: State<'_, AppStore>,
    profile: AutomationRuleProfile,
) -> Result<AutomationRuleProfile, String> {
    let normalized = normalize_rule_profile(profile);
    {
        let mut guard = store
            .automation_rule_profile
            .lock()
            .map_err(|err| err.to_string())?;
        *guard = normalized.clone();
    }
    persist_rule_profile(&normalized)?;
    Ok(normalized)
}

#[tauri::command]
fn update_automation_goal_rule_config(
    store: State<'_, AppStore>,
    goal_id: String,
    rule_config: AutomationGoalRuleConfig,
) -> Result<AutomationRun, String> {
    let normalized = normalize_goal_rule_config(rule_config);
    let mut runs = store
        .automation_runs
        .lock()
        .map_err(|err| err.to_string())?;
    let run = runs
        .iter_mut()
        .find(|item| item.goals.iter().any(|goal| goal.id == goal_id))
        .ok_or_else(|| "Automation goal not found.".to_string())?;
    let goal = run
        .goals
        .iter_mut()
        .find(|item| item.id == goal_id)
        .ok_or_else(|| "Automation goal not found.".to_string())?;
    if goal.status == "running" {
        return Err("Running goals cannot change rules mid-round.".to_string());
    }
    goal.rule_config = normalized;
    goal.updated_at = now_stamp();
    run.updated_at = goal.updated_at.clone();
    push_event(
        run,
        Some(&goal_id),
        "info",
        "Goal rules updated",
        "The goal-specific automation rules were updated.",
    );
    let snapshot = run.clone();
    persist_automation_runs_to_disk(&runs)?;
    Ok(snapshot)
}

#[tauri::command]
fn create_automation_run(
    app: AppHandle,
    store: State<'_, AppStore>,
    mut request: CreateAutomationRunRequest,
) -> Result<AutomationRun, String> {
    if request.goals.is_empty() {
        return Err("At least one automation goal is required.".to_string());
    }
    request.scheduled_start_at = normalize_scheduled_start_at(request.scheduled_start_at.clone());

    let run = build_run_from_request(request);
    {
        let mut runs = store
            .automation_runs
            .lock()
            .map_err(|err| err.to_string())?;
        runs.insert(0, run.clone());
        persist_automation_runs_to_disk(&runs)?;
    }

    if run.status == "scheduled" {
        schedule_automation_run(app, &store, run.id.clone());
    }

    Ok(run)
}

#[tauri::command]
fn create_automation_run_from_job(
    app: AppHandle,
    store: State<'_, AppStore>,
    request: CreateAutomationRunFromJobRequest,
) -> Result<AutomationRunRecord, String> {
    create_automation_run_from_job_with_handles(
        app,
        store.state.clone(),
        store.context.clone(),
        store.settings.clone(),
        store.terminal_storage.clone(),
        store.claude_approval_rules.clone(),
        store.claude_pending_approvals.clone(),
        store.codex_pending_approvals.clone(),
        store.automation_jobs.clone(),
        store.automation_runs.clone(),
        store.automation_active_runs.clone(),
        request,
        "manual",
    )
}

#[tauri::command]
fn start_automation_run(
    app: AppHandle,
    store: State<'_, AppStore>,
    run_id: String,
) -> Result<AutomationRun, String> {
    let now = now_stamp();
    let updated = {
        let mut runs = store
            .automation_runs
            .lock()
            .map_err(|err| err.to_string())?;
        let run = runs
            .iter_mut()
            .find(|item| item.id == run_id)
            .ok_or_else(|| "Automation run not found.".to_string())?;
        if matches!(run.status.as_str(), "completed" | "cancelled") {
            return Err("This automation run can no longer be started.".to_string());
        }
        run.lifecycle_status = "queued".to_string();
        run.outcome_status = "unknown".to_string();
        run.attention_status = "none".to_string();
        run.resolution_code = "scheduled".to_string();
        run.status_summary = Some("Queued to start.".to_string());
        run.objective_signals = AutomationObjectiveSignals::default();
        run.judge_assessment = AutomationJudgeAssessment::default();
        run.status = "scheduled".to_string();
        run.lifecycle_status = "queued".to_string();
        run.outcome_status = "unknown".to_string();
        run.attention_status = "none".to_string();
        run.resolution_code = "scheduled".to_string();
        run.status_summary = Some("Reset and queued again.".to_string());
        run.objective_signals = AutomationObjectiveSignals::default();
        run.judge_assessment = AutomationJudgeAssessment::default();
        run.scheduled_start_at = Some(now.clone());
        run.updated_at = now.clone();
        // Reset goal states when starting a paused run
        for goal in &mut run.goals {
            if goal.status == "paused" || goal.status == "running" {
                goal.lifecycle_status = "queued".to_string();
                goal.outcome_status = "unknown".to_string();
                goal.attention_status = "none".to_string();
                goal.resolution_code = "scheduled".to_string();
                goal.status_summary = Some("Queued to start.".to_string());
                goal.objective_signals = AutomationObjectiveSignals::default();
                goal.judge_assessment = AutomationJudgeAssessment::default();
                goal.status = "queued".to_string();
                goal.round_count = 0;
                goal.consecutive_failure_count = 0;
                goal.no_progress_rounds = 0;
                goal.last_owner_cli = None;
                goal.result_summary = None;
                goal.latest_progress_summary = None;
                goal.next_instruction = None;
                goal.requires_attention_reason = None;
                goal.last_exit_code = None;
                goal.started_at = None;
                goal.completed_at = None;
                goal.updated_at = now.clone();
                sync_goal_status_fields(goal);
            }
        }
        sync_run_status_fields(run);
        push_event(
            run,
            None,
            "info",
            "Run scheduled",
            "The automation run is queued to start immediately.",
        );
        let snapshot = run.clone();
        persist_automation_runs_to_disk(&runs)?;
        snapshot
    };

    schedule_automation_run(app, &store, run_id);
    Ok(updated)
}

#[tauri::command]
fn pause_automation_run(
    store: State<'_, AppStore>,
    run_id: String,
) -> Result<AutomationRun, String> {
    let updated = {
        let mut runs = store
            .automation_runs
            .lock()
            .map_err(|err| err.to_string())?;
        let run = runs
            .iter_mut()
            .find(|item| item.id == run_id)
            .ok_or_else(|| "Automation run not found.".to_string())?;
        if matches!(run.status.as_str(), "completed" | "cancelled" | "failed") {
            return Err("This automation run can no longer be paused.".to_string());
        }
        let now = now_stamp();
        run.lifecycle_status = "stopped".to_string();
        run.attention_status = "waiting_human".to_string();
        run.resolution_code = "manual_pause_requested".to_string();
        run.status_summary = Some("Paused manually.".to_string());
        run.status = "paused".to_string();
        run.updated_at = now.clone();
        for goal in &mut run.goals {
            if goal.status == "running" {
                goal.lifecycle_status = "stopped".to_string();
                goal.attention_status = "waiting_human".to_string();
                goal.resolution_code = "manual_pause_requested".to_string();
                goal.status_summary = Some("Paused manually while a round was in progress.".to_string());
                goal.requires_attention_reason =
                    Some("批次已手动暂停，将在当前轮次结束后停止继续。".to_string());
                goal.updated_at = now.clone();
                sync_goal_status_fields(goal);
            }
        }
        sync_run_status_fields(run);
        push_event(run, None, "warning", "Run paused", "The automation run was paused.");
        let snapshot = run.clone();
        persist_automation_runs_to_disk(&runs)?;
        snapshot
    };
    Ok(updated)
}

#[tauri::command]
fn resume_automation_run(
    app: AppHandle,
    store: State<'_, AppStore>,
    run_id: String,
) -> Result<AutomationRun, String> {
    let updated = {
        let mut runs = store
            .automation_runs
            .lock()
            .map_err(|err| err.to_string())?;
        let run = runs
            .iter_mut()
            .find(|item| item.id == run_id)
            .ok_or_else(|| "Automation run not found.".to_string())?;
        if run.status != "paused" {
            return Err("Only paused runs can be resumed.".to_string());
        }
        let now = now_stamp();
        run.lifecycle_status = "queued".to_string();
        run.attention_status = "none".to_string();
        run.resolution_code = "scheduled".to_string();
        run.status_summary = Some("Re-queued after pause.".to_string());
        run.status = "scheduled".to_string();
        run.scheduled_start_at = Some(now.clone());
        run.completed_at = None;
        run.updated_at = now.clone();
        for goal in &mut run.goals {
            if goal.status == "paused" {
                goal.lifecycle_status = "queued".to_string();
                goal.attention_status = "none".to_string();
                goal.resolution_code = "scheduled".to_string();
                goal.status_summary = Some("Re-queued after pause.".to_string());
                goal.status = "queued".to_string();
                goal.requires_attention_reason = None;
                goal.updated_at = now.clone();
                sync_goal_status_fields(goal);
            }
        }
        sync_run_status_fields(run);
        push_event(run, None, "info", "Run resumed", "The automation run was re-queued.");
        let snapshot = run.clone();
        persist_automation_runs_to_disk(&runs)?;
        snapshot
    };

    schedule_automation_run(app, &store, run_id);
    Ok(updated)
}

#[tauri::command]
fn restart_automation_run(
    app: AppHandle,
    store: State<'_, AppStore>,
    run_id: String,
) -> Result<AutomationRun, String> {
    let updated = {
        let mut runs = store
            .automation_runs
            .lock()
            .map_err(|err| err.to_string())?;
        let run = runs
            .iter_mut()
            .find(|item| item.id == run_id)
            .ok_or_else(|| "Automation run not found.".to_string())?;
        let now = now_stamp();

        for goal in &run.goals {
            let _ = store
                .terminal_storage
                .delete_chat_session_by_tab(&goal.synthetic_terminal_tab_id);
        }

        run.status = "scheduled".to_string();
        run.scheduled_start_at = Some(now.clone());
        run.started_at = None;
        run.completed_at = None;
        run.summary = None;
        run.updated_at = now.clone();
        for goal in &mut run.goals {
            goal.lifecycle_status = "queued".to_string();
            goal.outcome_status = "unknown".to_string();
            goal.attention_status = "none".to_string();
            goal.resolution_code = "scheduled".to_string();
            goal.status_summary = Some("Reset and queued again.".to_string());
            goal.objective_signals = AutomationObjectiveSignals::default();
            goal.judge_assessment = AutomationJudgeAssessment::default();
            goal.status = "queued".to_string();
            goal.round_count = 0;
            goal.consecutive_failure_count = 0;
            goal.no_progress_rounds = 0;
            goal.last_owner_cli = None;
            goal.result_summary = None;
            goal.latest_progress_summary = None;
            goal.next_instruction = None;
            goal.requires_attention_reason = None;
            goal.relevant_files.clear();
            goal.synthetic_terminal_tab_id = create_id("auto-tab");
            goal.last_exit_code = None;
            goal.started_at = None;
            goal.completed_at = None;
            goal.updated_at = now.clone();
            sync_goal_status_fields(goal);
        }

        sync_run_status_fields(run);
        push_event(run, None, "info", "Run restarted", "The automation run was reset and queued again.");
        let snapshot = run.clone();
        persist_automation_runs_to_disk(&runs)?;
        snapshot
    };

    schedule_automation_run(app, &store, run_id);
    Ok(updated)
}

#[tauri::command]
fn pause_automation_goal(
    store: State<'_, AppStore>,
    goal_id: String,
) -> Result<AutomationRun, String> {
    let updated = {
        let mut runs = store
            .automation_runs
            .lock()
            .map_err(|err| err.to_string())?;
        let run = runs
            .iter_mut()
            .find(|item| item.goals.iter().any(|goal| goal.id == goal_id))
            .ok_or_else(|| "Automation goal not found.".to_string())?;
        let goal = run
            .goals
            .iter_mut()
            .find(|item| item.id == goal_id)
            .ok_or_else(|| "Automation goal not found.".to_string())?;
        if goal.status == "running" {
            return Err("Running goals cannot be paused mid-turn yet.".to_string());
        }
        if matches!(goal.status.as_str(), "completed" | "failed" | "cancelled") {
            return Err("This automation goal can no longer be paused.".to_string());
        }
        goal.lifecycle_status = "stopped".to_string();
        goal.attention_status = "waiting_human".to_string();
        goal.resolution_code = "manual_pause_requested".to_string();
        goal.status_summary = Some("Paused manually.".to_string());
        goal.status = "paused".to_string();
        goal.requires_attention_reason = Some("Paused manually.".to_string());
        goal.updated_at = now_stamp();
        sync_goal_status_fields(goal);
        run.lifecycle_status = "stopped".to_string();
        run.attention_status = "waiting_human".to_string();
        run.resolution_code = "manual_pause_requested".to_string();
        run.status_summary = Some("Paused manually.".to_string());
        run.status = "paused".to_string();
        run.updated_at = goal.updated_at.clone();
        sync_run_status_fields(run);
        push_event(
            run,
            Some(&goal_id),
            "warning",
            "Goal paused",
            "This goal was paused manually and will wait for resume.",
        );
        let snapshot = run.clone();
        persist_automation_runs_to_disk(&runs)?;
        snapshot
    };
    Ok(updated)
}

#[tauri::command]
fn resume_automation_goal(
    app: AppHandle,
    store: State<'_, AppStore>,
    goal_id: String,
) -> Result<AutomationRun, String> {
    let run_id = {
        let mut runs = store
            .automation_runs
            .lock()
            .map_err(|err| err.to_string())?;
        let run = runs
            .iter_mut()
            .find(|item| item.goals.iter().any(|goal| goal.id == goal_id))
            .ok_or_else(|| "Automation goal not found.".to_string())?;
        let goal = run
            .goals
            .iter_mut()
            .find(|item| item.id == goal_id)
            .ok_or_else(|| "Automation goal not found.".to_string())?;
        if goal.status != "paused" {
            return Err("Only paused goals can be resumed.".to_string());
        }
        let now = now_stamp();
        goal.lifecycle_status = "queued".to_string();
        goal.attention_status = "none".to_string();
        goal.resolution_code = "scheduled".to_string();
        goal.status_summary = Some("Re-queued after pause.".to_string());
        goal.status = "queued".to_string();
        goal.requires_attention_reason = None;
        goal.updated_at = now.clone();
        sync_goal_status_fields(goal);
        run.lifecycle_status = "queued".to_string();
        run.attention_status = "none".to_string();
        run.resolution_code = "scheduled".to_string();
        run.status_summary = Some("Re-queued after pause.".to_string());
        run.status = "scheduled".to_string();
        run.scheduled_start_at = Some(now.clone());
        run.completed_at = None;
        run.updated_at = now;
        sync_run_status_fields(run);
        push_event(
            run,
            Some(&goal_id),
            "info",
            "Goal resumed",
            "The paused goal was re-queued for unattended execution.",
        );
        let run_id = run.id.clone();
        persist_automation_runs_to_disk(&runs)?;
        run_id
    };

    schedule_automation_run(app, &store, run_id.clone());

    let runs = store
        .automation_runs
        .lock()
        .map_err(|err| err.to_string())?;
    runs.iter()
        .find(|item| item.id == run_id)
        .cloned()
        .ok_or_else(|| "Automation run not found after resume.".to_string())
}

#[tauri::command]
fn cancel_automation_run(
    store: State<'_, AppStore>,
    run_id: String,
) -> Result<AutomationRun, String> {
    let updated = {
        let mut runs = store
            .automation_runs
            .lock()
            .map_err(|err| err.to_string())?;
        let run = runs
            .iter_mut()
            .find(|item| item.id == run_id)
            .ok_or_else(|| "Automation run not found.".to_string())?;
        let now = now_stamp();
        run.lifecycle_status = "stopped".to_string();
        run.outcome_status = "failed".to_string();
        run.attention_status = "none".to_string();
        run.resolution_code = "cancelled".to_string();
        run.status_summary = Some("Cancelled manually.".to_string());
        run.status = "cancelled".to_string();
        run.completed_at = Some(now.clone());
        run.updated_at = now.clone();
        for goal in &mut run.goals {
            if !matches!(goal.status.as_str(), "completed" | "failed" | "cancelled") {
                goal.lifecycle_status = "stopped".to_string();
                goal.outcome_status = "failed".to_string();
                goal.attention_status = "none".to_string();
                goal.resolution_code = "cancelled".to_string();
                goal.status_summary = Some("Cancelled manually.".to_string());
                goal.status = "cancelled".to_string();
                goal.updated_at = now.clone();
                sync_goal_status_fields(goal);
            }
        }
        sync_run_status_fields(run);
        push_event(
            run,
            None,
            "warning",
            "Run cancelled",
            "The automation run was cancelled. No further queued goals will be started.",
        );
        let snapshot = run.clone();
        persist_automation_runs_to_disk(&runs)?;
        snapshot
    };
    Ok(updated)
}

#[tauri::command]
fn delete_automation_run(
    store: State<'_, AppStore>,
    run_id: String,
) -> Result<(), String> {
    let run = {
        let mut runs = store
            .automation_runs
            .lock()
            .map_err(|err| err.to_string())?;
        let Some(index) = runs.iter().position(|item| item.id == run_id) else {
            return Err("Automation run not found.".to_string());
        };
        if runs[index].status == "running" {
            return Err("Running automation runs must be paused or cancelled before deletion.".to_string());
        }
        let snapshot = runs.remove(index);
        persist_automation_runs_to_disk(&runs)?;
        snapshot
    };

    if let Ok(mut active) = store.automation_active_runs.lock() {
        active.remove(&run_id);
    }

    for goal in &run.goals {
        let _ = store
            .terminal_storage
            .delete_chat_session_by_tab(&goal.synthetic_terminal_tab_id);
    }

    Ok(())
}

#[tauri::command]
fn switch_cli_for_task(
    store: State<'_, AppStore>,
    request: CliHandoffRequest,
) -> Result<(), String> {
    let from_cli = request.from_cli.clone();
    let to_cli = request.to_cli.clone();
    let project_name = request.project_name.clone();
    let latest_user_prompt = request.latest_user_prompt.clone();
    let latest_assistant_summary = request.latest_assistant_summary.clone();
    let relevant_files = request.relevant_files.clone();
    let _ = store
        .terminal_storage
        .switch_cli_for_task(&CliHandoffStorageRequest {
            terminal_tab_id: request.terminal_tab_id,
            workspace_id: request.workspace_id,
            project_root: request.project_root,
            project_name: project_name.clone(),
            from_cli: from_cli.clone(),
            to_cli: to_cli.clone(),
            reason: request.reason,
            latest_user_prompt: latest_user_prompt.clone(),
            latest_assistant_summary: latest_assistant_summary.clone(),
            relevant_files: relevant_files.clone(),
        })?;

    if latest_assistant_summary.is_some() {
        if let Ok(mut ctx) = store.context.lock() {
            ctx.handoffs.insert(
                0,
                EnrichedHandoff {
                    id: create_id("handoff"),
                    from: from_cli,
                    to: to_cli,
                    timestamp: now_stamp(),
                    git_diff: String::new(),
                    changed_files: relevant_files,
                    previous_turns: Vec::new(),
                    user_goal: latest_user_prompt
                        .unwrap_or_else(|| format!("Continue work in {}", project_name)),
                    status: "ready".to_string(),
                },
            );
            if ctx.handoffs.len() > 20 {
                ctx.handoffs.truncate(20);
            }
            let _ = persist_context(&ctx);
        }
    }

    Ok(())
}

// ── Agent job orchestration ────────────────────────────────────────────

fn start_agent_job(
    app: AppHandle,
    store: State<'_, AppStore>,
    agent_id: String,
    prompt: String,
    review_only: bool,
) -> Result<String, String> {
    let app_handle = app.clone();
    let state_arc = store.state.clone();
    let context_arc = store.context.clone();
    let settings_arc = store.settings.clone();

    let snapshot = state_arc.lock().map_err(|err| err.to_string())?.clone();
    let ctx_snapshot = context_arc.lock().map_err(|err| err.to_string())?.clone();
    let settings_snapshot = settings_arc.lock().map_err(|err| err.to_string())?.clone();

    let agent = snapshot
        .agents
        .iter()
        .find(|entry| entry.id == agent_id)
        .cloned()
        .ok_or_else(|| "Unknown agent".to_string())?;

    let wrapper = agent
        .runtime
        .command_path
        .clone()
        .ok_or_else(|| format!("{} is not available on this machine", agent.label))?;
    let shell = shell_path();
    let write_mode = snapshot.workspace.current_writer == agent_id && !review_only;
    let composed_prompt = compose_context_prompt(&snapshot, &ctx_snapshot, &agent_id, &prompt);
    let acp_snap = store.acp_session.lock().map_err(|e| e.to_string())?.clone();
    let script = build_agent_script(&agent_id, &wrapper, &composed_prompt, write_mode, &acp_snap)?;
    let job_id = create_id("job");
    let project_root = snapshot.workspace.project_root.clone();
    let timeout = settings_snapshot.process_timeout_ms;

    mutate_store_arc(&state_arc, |state| {
        if let Some(next_agent) = state.agents.iter_mut().find(|item| item.id == agent_id) {
            next_agent.status = if state.workspace.active_agent == agent_id {
                "active".to_string()
            } else {
                "busy".to_string()
            };
            next_agent.summary = if review_only {
                "Running a review pass against the current app session.".to_string()
            } else if write_mode {
                "Processing an execution prompt with writer privileges.".to_string()
            } else {
                "Processing a read-only planning prompt.".to_string()
            };
            next_agent.last_sync = "just now".to_string();
        }

        append_terminal_line(
            state,
            &agent_id,
            "user",
            prompt.lines().next().unwrap_or("Prompt queued."),
        );
        append_activity(
            state,
            "info",
            &format!("{} queued", agent_id),
            if review_only {
                "Review request dispatched to the selected CLI."
            } else {
                "Prompt dispatched to the selected CLI."
            },
        );
    })?;

    let user_prompt = prompt.clone();

    thread::spawn(move || {
        let start_time = Instant::now();

        let result = spawn_shell_command(
            &shell,
            &project_root,
            &script,
            app_handle.clone(),
            state_arc.clone(),
            &agent_id,
            &agent_id,
            timeout,
        );

        let duration_ms = start_time.elapsed().as_millis() as u64;

        match result {
            Ok(full_output) => {
                let summary = display_summary(&full_output);

                // Store conversation turn in context
                let turn = ConversationTurn {
                    id: create_id("turn"),
                    agent_id: agent_id.clone(),
                    timestamp: now_stamp(),
                    user_prompt: user_prompt.clone(),
                    composed_prompt: composed_prompt.clone(),
                    raw_output: full_output.clone(),
                    output_summary: if full_output.chars().count() > 500 {
                        format!("{}...", safe_truncate_chars(&full_output, 500))
                    } else {
                        full_output.clone()
                    },
                    duration_ms,
                    exit_code: Some(0),
                    write_mode,
                };

                if let Ok(mut ctx) = context_arc.lock() {
                    let max = ctx.max_turns_per_agent;
                    let agent_ctx =
                        ctx.agents
                            .entry(agent_id.clone())
                            .or_insert_with(|| AgentContext {
                                agent_id: agent_id.clone(),
                                conversation_history: Vec::new(),
                                total_token_estimate: 0,
                            });
                    agent_ctx.conversation_history.push(turn);
                    if agent_ctx.conversation_history.len() > max {
                        let drain = agent_ctx.conversation_history.len() - max;
                        agent_ctx.conversation_history.drain(0..drain);
                    }
                    agent_ctx.total_token_estimate += full_output.len() / 4;
                    let _ = persist_context(&ctx);
                }

                let _ = mutate_store_arc(&state_arc, |state| {
                    if let Some(next_agent) =
                        state.agents.iter_mut().find(|item| item.id == agent_id)
                    {
                        next_agent.status = if state.workspace.active_agent == agent_id {
                            "active".to_string()
                        } else {
                            "ready".to_string()
                        };
                        next_agent.summary = if review_only {
                            "Review complete and attached to the artifact stream.".to_string()
                        } else {
                            "Latest prompt finished successfully.".to_string()
                        };
                        next_agent.last_sync = "just now".to_string();
                    }

                    prepend_artifact(
                        state,
                        ReviewArtifact {
                            id: create_id("artifact"),
                            source: agent_id.clone(),
                            title: if review_only {
                                format!("{} review", agent.label)
                            } else {
                                format!("{} output", agent.label)
                            },
                            kind: artifact_kind(&agent_id, review_only),
                            summary,
                            confidence: if agent_id == "gemini" {
                                "medium".to_string()
                            } else {
                                "high".to_string()
                            },
                            created_at: "just now".to_string(),
                        },
                    );

                    append_activity(
                        state,
                        "success",
                        &format!("{} finished", agent_id),
                        "The job output was captured and added to the project record.",
                    );
                    sync_workspace_metrics(state);
                });
            }
            Err(error) => {
                // Store failed turn in context too
                let turn = ConversationTurn {
                    id: create_id("turn"),
                    agent_id: agent_id.clone(),
                    timestamp: now_stamp(),
                    user_prompt: user_prompt.clone(),
                    composed_prompt: composed_prompt.clone(),
                    raw_output: error.clone(),
                    output_summary: display_summary(&error),
                    duration_ms,
                    exit_code: Some(1),
                    write_mode,
                };

                if let Ok(mut ctx) = context_arc.lock() {
                    let max = ctx.max_turns_per_agent;
                    let agent_ctx =
                        ctx.agents
                            .entry(agent_id.clone())
                            .or_insert_with(|| AgentContext {
                                agent_id: agent_id.clone(),
                                conversation_history: Vec::new(),
                                total_token_estimate: 0,
                            });
                    agent_ctx.conversation_history.push(turn);
                    if agent_ctx.conversation_history.len() > max {
                        let drain = agent_ctx.conversation_history.len() - max;
                        agent_ctx.conversation_history.drain(0..drain);
                    }
                    let _ = persist_context(&ctx);
                }

                let _ = mutate_store_arc(&state_arc, |state| {
                    if let Some(next_agent) =
                        state.agents.iter_mut().find(|item| item.id == agent_id)
                    {
                        next_agent.status = if state.workspace.active_agent == agent_id {
                            "active".to_string()
                        } else {
                            "ready".to_string()
                        };
                        next_agent.summary =
                            "The last job failed before a usable output was captured.".to_string();
                        next_agent.last_sync = "just now".to_string();
                    }

                    append_activity(state, "danger", &format!("{} failed", agent_id), &error);
                    append_terminal_line(state, &agent_id, "system", &error);
                });
            }
        }

        if let Ok(state) = state_arc.lock() {
            let snapshot = state.clone();
            let _ = persist_state(&snapshot);
            emit_state(&app_handle, &snapshot);
        }
    });

    Ok(job_id)
}

// ── Chat commands ──────────────────────────────────────────────────────

#[tauri::command]
fn send_chat_message(
    app: AppHandle,
    store: State<'_, AppStore>,
    request: ChatPromptRequest,
) -> Result<String, String> {
    let message_id = request.assistant_message_id.clone();
    let cli_id = request.cli_id.clone();
    let terminal_tab_id = request.terminal_tab_id.clone();
    let prompt = request.prompt.clone();
    let project_root = request.project_root.clone();
    let workspace_id = request.workspace_id.clone();
    let project_name = request.project_name.clone();
    let recent_turns = request.recent_turns.clone();
    let write_mode = request.write_mode && !request.plan_mode;
    let requested_transport_session = request.transport_session.clone();
    let transport_kind = default_transport_kind(&cli_id);
    let terminal_storage = store.terminal_storage.clone();

    let mut request_session = acp::AcpSession::default();
    request_session.plan_mode = request.plan_mode;
    request_session.fast_mode = request.fast_mode;
    request_session.effort_level = request.effort_level.clone();
    if let Some(model) = request.model_override.clone() {
        request_session.model.insert(cli_id.clone(), model);
    }
    if let Some(permission) = request.permission_override.clone() {
        request_session
            .permission_mode
            .insert(cli_id.clone(), permission);
    }

    // Look up CLI runtime
    let (wrapper_path, shell, timeout_ms) = {
        let state = store.state.lock().map_err(|e| e.to_string())?;
        let settings = store.settings.lock().map_err(|e| e.to_string())?;

        let agent = state.agents.iter().find(|a| a.id == cli_id);
        let wrapper = agent
            .and_then(|a| a.runtime.command_path.clone())
            .ok_or_else(|| format!("{} CLI not found", cli_id))?;

        (wrapper, shell_path(), settings.process_timeout_ms)
    };

    let (prompt_for_context, selected_codex_skills, selected_claude_skill) = match cli_id.as_str() {
        "codex" => {
            let (runtime_prompt, selected_skills) =
                resolve_codex_prompt_and_skills(&app, &wrapper_path, &project_root, &prompt);
            (runtime_prompt, selected_skills, None)
        }
        "claude" => {
            let (runtime_prompt, selected_skill) =
                resolve_claude_prompt_and_skill(&project_root, &prompt);
            (runtime_prompt, Vec::new(), selected_skill)
        }
        _ => (prompt.clone(), Vec::new(), None),
    };

    let _ = terminal_storage.maybe_auto_compact_terminal_tab(&terminal_tab_id);

    // Build script with tab-scoped context
    let composed_prompt_base = {
        let mut state = store.state.lock().map_err(|e| e.to_string())?.clone();
        state.workspace.project_root = project_root.clone();
        state.workspace.project_name = project_name.clone();
        state.workspace.branch = git_output(&project_root, &["branch", "--show-current"])
            .unwrap_or_else(|| "workspace".to_string());
        compose_tab_context_prompt(
            &state,
            &terminal_storage,
            &cli_id,
            &terminal_tab_id,
            &workspace_id,
            &project_root,
            &project_name,
            &prompt_for_context,
            &recent_turns,
            write_mode,
            request.compacted_summaries.as_ref(),
            request.cross_tab_context.as_ref(),
        )
    };
    let composed_prompt = if let Some(skill) = selected_claude_skill.as_ref() {
        format!("/{} {}", skill.name, composed_prompt_base)
    } else {
        composed_prompt_base
    };

    let msg_id = message_id.clone();
    let app_handle = app.clone();
    let state_arc = store.state.clone();
    let ctx_arc = store.context.clone();
    let agent_id = cli_id.clone();
    let user_prompt = prompt.clone();
    let stream_tab_id = terminal_tab_id.clone();
    let done_tab_id = terminal_tab_id.clone();
    let turn_write_mode = write_mode;
    let composed_prompt_for_history = composed_prompt.clone();
    let request_session_for_thread = request_session.clone();
    let selected_codex_skills_for_thread = selected_codex_skills.clone();
    let workspace_id_for_thread = workspace_id.clone();
    let project_name_for_thread = project_name.clone();
    let recent_turns_for_thread: Vec<TaskRecentTurn> = recent_turns
        .iter()
        .map(|turn| TaskRecentTurn {
            cli_id: turn.cli_id.clone(),
            user_prompt: turn.user_prompt.clone(),
            assistant_reply: turn.assistant_reply.clone(),
            timestamp: turn.timestamp.clone(),
        })
        .collect();

    if cli_id == "codex" {
        let codex_wrapper_path = wrapper_path.clone();
        let codex_project_root = project_root.clone();
        let codex_requested_transport_session = requested_transport_session.clone();
        let codex_transport_kind = transport_kind.clone();
        let codex_pending_approvals = store.codex_pending_approvals.clone();
        let codex_terminal_storage = terminal_storage.clone();
        let codex_workspace_id = workspace_id_for_thread.clone();
        let codex_project_name = project_name_for_thread.clone();
        let codex_recent_turns = recent_turns_for_thread.clone();

        thread::spawn(move || {
            let start = Instant::now();
            let outcome = run_codex_app_server_turn(
                &app_handle,
                &codex_wrapper_path,
                &codex_project_root,
                &composed_prompt,
                &selected_codex_skills_for_thread,
                &request_session_for_thread,
                codex_requested_transport_session.clone(),
                &stream_tab_id,
                &msg_id,
                turn_write_mode,
                codex_pending_approvals,
                Vec::new(),
            );

            let duration_ms = start.elapsed().as_millis() as u64;
            let (raw_output, exit_code, final_content, content_format, blocks, transport_session) =
                match outcome {
                    Ok(outcome) => (
                        outcome.raw_output,
                        outcome.exit_code,
                        outcome.final_content,
                        outcome.content_format,
                        outcome.blocks,
                        outcome.transport_session,
                    ),
                    Err(error) => {
                        let permission_mode =
                            codex_permission_mode(&request_session_for_thread, turn_write_mode);
                        let transport_session = build_transport_session(
                            "codex",
                            codex_requested_transport_session,
                            None,
                            None,
                            request_session_for_thread.model.get("codex").cloned(),
                            Some(permission_mode),
                        );
                        (
                            error.clone(),
                            Some(1),
                            error.clone(),
                            "log".to_string(),
                            vec![ChatMessageBlock::Status {
                                level: "error".to_string(),
                                text: error,
                            }],
                            transport_session,
                        )
                    }
                };

            if let Ok(mut ctx) = ctx_arc.lock() {
                let turn = ConversationTurn {
                    id: create_id("turn"),
                    agent_id: agent_id.clone(),
                    timestamp: now_stamp(),
                    user_prompt: user_prompt.clone(),
                    composed_prompt: composed_prompt_for_history.clone(),
                    raw_output: raw_output.clone(),
                    output_summary: display_summary(&raw_output),
                    duration_ms,
                    exit_code,
                    write_mode: turn_write_mode,
                };
                let max = ctx.max_turns_per_agent;
                if let Some(agent_ctx) = ctx.agents.get_mut(&agent_id) {
                    agent_ctx.conversation_history.push(turn.clone());
                    if agent_ctx.conversation_history.len() > max {
                        let drain = agent_ctx.conversation_history.len() - max;
                        agent_ctx.conversation_history.drain(0..drain);
                    }
                    agent_ctx.total_token_estimate += raw_output.len() / 4;
                }
                ctx.conversation_history.push(turn);
                if ctx.conversation_history.len() > max {
                    let drain = ctx.conversation_history.len() - max;
                    ctx.conversation_history.drain(0..drain);
                }
                let _ = persist_context(&ctx);
            }

            let _ = codex_terminal_storage.record_turn_progress(&storage::TaskTurnUpdate {
                terminal_tab_id: done_tab_id.clone(),
                workspace_id: codex_workspace_id.clone(),
                project_root: codex_project_root.clone(),
                project_name: codex_project_name.clone(),
                cli_id: agent_id.clone(),
                user_prompt: user_prompt.clone(),
                assistant_summary: display_summary(&raw_output),
                relevant_files: collect_relevant_files_from_blocks(&blocks),
                recent_turns: codex_recent_turns.clone(),
                exit_code,
            });

            let _ = app_handle.emit(
                "stream-chunk",
                StreamEvent {
                    terminal_tab_id: done_tab_id,
                    message_id: msg_id,
                    chunk: String::new(),
                    done: true,
                    exit_code,
                    duration_ms: Some(duration_ms),
                    final_content: Some(final_content),
                    content_format: Some(content_format),
                    transport_kind: Some(codex_transport_kind),
                    transport_session: Some(transport_session),
                    blocks: Some(blocks),
                },
            );

            if let Ok(mut state) = state_arc.lock() {
                sync_workspace_metrics(&mut state);
                let _ = persist_state(&state);
                emit_state(&app_handle, &state);
            }
        });

        return Ok(message_id);
    }

    if cli_id == "gemini" {
        let gemini_wrapper_path = wrapper_path.clone();
        let gemini_project_root = project_root.clone();
        let gemini_requested_transport_session = requested_transport_session.clone();
        let gemini_transport_kind = transport_kind.clone();
        let gemini_terminal_storage = terminal_storage.clone();
        let gemini_workspace_id = workspace_id_for_thread.clone();
        let gemini_project_name = project_name_for_thread.clone();
        let gemini_recent_turns = recent_turns_for_thread.clone();

        thread::spawn(move || {
            let start = Instant::now();
            let outcome = run_gemini_acp_turn(
                &app_handle,
                &gemini_wrapper_path,
                &gemini_project_root,
                &composed_prompt,
                &request_session_for_thread,
                gemini_requested_transport_session.clone(),
                &stream_tab_id,
                &msg_id,
                turn_write_mode,
                timeout_ms,
                Vec::new(),
            );

            let duration_ms = start.elapsed().as_millis() as u64;
            let (raw_output, exit_code, final_content, content_format, blocks, transport_session) =
                match outcome {
                    Ok(outcome) => (
                        outcome.raw_output,
                        outcome.exit_code,
                        outcome.final_content,
                        outcome.content_format,
                        outcome.blocks,
                        outcome.transport_session,
                    ),
                    Err(error) => {
                        let permission_mode = gemini_local_permission_mode(
                            &request_session_for_thread,
                            turn_write_mode,
                            gemini_requested_transport_session.as_ref(),
                        );
                        let transport_session = build_transport_session(
                            "gemini",
                            gemini_requested_transport_session,
                            None,
                            None,
                            request_session_for_thread.model.get("gemini").cloned(),
                            Some(permission_mode),
                        );
                        (
                            error.clone(),
                            Some(1),
                            error.clone(),
                            "log".to_string(),
                            vec![ChatMessageBlock::Status {
                                level: "error".to_string(),
                                text: error,
                            }],
                            transport_session,
                        )
                    }
                };

            if let Ok(mut ctx) = ctx_arc.lock() {
                let turn = ConversationTurn {
                    id: create_id("turn"),
                    agent_id: agent_id.clone(),
                    timestamp: now_stamp(),
                    user_prompt: user_prompt.clone(),
                    composed_prompt: composed_prompt_for_history.clone(),
                    raw_output: raw_output.clone(),
                    output_summary: display_summary(&raw_output),
                    duration_ms,
                    exit_code,
                    write_mode: turn_write_mode,
                };
                let max = ctx.max_turns_per_agent;
                if let Some(agent_ctx) = ctx.agents.get_mut(&agent_id) {
                    agent_ctx.conversation_history.push(turn.clone());
                    if agent_ctx.conversation_history.len() > max {
                        let drain = agent_ctx.conversation_history.len() - max;
                        agent_ctx.conversation_history.drain(0..drain);
                    }
                    agent_ctx.total_token_estimate += raw_output.len() / 4;
                }
                ctx.conversation_history.push(turn);
                if ctx.conversation_history.len() > max {
                    let drain = ctx.conversation_history.len() - max;
                    ctx.conversation_history.drain(0..drain);
                }
                let _ = persist_context(&ctx);
            }

            let _ = gemini_terminal_storage.record_turn_progress(&storage::TaskTurnUpdate {
                terminal_tab_id: done_tab_id.clone(),
                workspace_id: gemini_workspace_id.clone(),
                project_root: gemini_project_root.clone(),
                project_name: gemini_project_name.clone(),
                cli_id: agent_id.clone(),
                user_prompt: user_prompt.clone(),
                assistant_summary: display_summary(&raw_output),
                relevant_files: collect_relevant_files_from_blocks(&blocks),
                recent_turns: gemini_recent_turns.clone(),
                exit_code,
            });

            let _ = app_handle.emit(
                "stream-chunk",
                StreamEvent {
                    terminal_tab_id: done_tab_id,
                    message_id: msg_id,
                    chunk: String::new(),
                    done: true,
                    exit_code,
                    duration_ms: Some(duration_ms),
                    final_content: Some(final_content),
                    content_format: Some(content_format),
                    transport_kind: Some(gemini_transport_kind),
                    transport_session: Some(transport_session),
                    blocks: Some(blocks),
                },
            );

            if let Ok(mut state) = state_arc.lock() {
                sync_workspace_metrics(&mut state);
                let _ = persist_state(&state);
                emit_state(&app_handle, &state);
            }
        });

        return Ok(message_id);
    }

    if cli_id == "claude" {
        let claude_wrapper_path = wrapper_path.clone();
        let claude_project_root = project_root.clone();
        let claude_requested_transport_session = requested_transport_session.clone();
        let claude_transport_kind = transport_kind.clone();
        let claude_approval_rules = store.claude_approval_rules.clone();
        let claude_pending_approvals = store.claude_pending_approvals.clone();
        let claude_terminal_storage = terminal_storage.clone();
        let claude_workspace_id = workspace_id_for_thread.clone();
        let claude_project_name = project_name_for_thread.clone();
        let claude_recent_turns = recent_turns_for_thread.clone();

        thread::spawn(move || {
            let start = Instant::now();
            let outcome = run_claude_headless_turn(
                &app_handle,
                &claude_wrapper_path,
                &claude_project_root,
                &composed_prompt,
                &request_session_for_thread,
                claude_requested_transport_session.clone(),
                &stream_tab_id,
                &msg_id,
                turn_write_mode,
                timeout_ms,
                claude_approval_rules,
                claude_pending_approvals,
            );

            let duration_ms = start.elapsed().as_millis() as u64;
            let (raw_output, exit_code, final_content, content_format, blocks, transport_session) =
                match outcome {
                    Ok(outcome) => (
                        outcome.raw_output,
                        outcome.exit_code,
                        outcome.final_content,
                        outcome.content_format,
                        outcome.blocks,
                        outcome.transport_session,
                    ),
                    Err(error) => {
                        let permission_mode = claude_permission_mode(
                            &request_session_for_thread,
                            turn_write_mode,
                            claude_requested_transport_session.as_ref(),
                        );
                        let transport_session = build_transport_session(
                            "claude",
                            claude_requested_transport_session,
                            None,
                            None,
                            request_session_for_thread.model.get("claude").cloned(),
                            Some(permission_mode),
                        );
                        (
                            error.clone(),
                            Some(1),
                            error.clone(),
                            "log".to_string(),
                            vec![ChatMessageBlock::Status {
                                level: "error".to_string(),
                                text: error,
                            }],
                            transport_session,
                        )
                    }
                };

            if let Ok(mut ctx) = ctx_arc.lock() {
                let turn = ConversationTurn {
                    id: create_id("turn"),
                    agent_id: agent_id.clone(),
                    timestamp: now_stamp(),
                    user_prompt: user_prompt.clone(),
                    composed_prompt: composed_prompt_for_history.clone(),
                    raw_output: raw_output.clone(),
                    output_summary: display_summary(&raw_output),
                    duration_ms,
                    exit_code,
                    write_mode: turn_write_mode,
                };
                let max = ctx.max_turns_per_agent;
                if let Some(agent_ctx) = ctx.agents.get_mut(&agent_id) {
                    agent_ctx.conversation_history.push(turn.clone());
                    if agent_ctx.conversation_history.len() > max {
                        let drain = agent_ctx.conversation_history.len() - max;
                        agent_ctx.conversation_history.drain(0..drain);
                    }
                    agent_ctx.total_token_estimate += raw_output.len() / 4;
                }
                ctx.conversation_history.push(turn);
                if ctx.conversation_history.len() > max {
                    let drain = ctx.conversation_history.len() - max;
                    ctx.conversation_history.drain(0..drain);
                }
                let _ = persist_context(&ctx);
            }

            let _ = claude_terminal_storage.record_turn_progress(&storage::TaskTurnUpdate {
                terminal_tab_id: done_tab_id.clone(),
                workspace_id: claude_workspace_id.clone(),
                project_root: claude_project_root.clone(),
                project_name: claude_project_name.clone(),
                cli_id: agent_id.clone(),
                user_prompt: user_prompt.clone(),
                assistant_summary: display_summary(&raw_output),
                relevant_files: collect_relevant_files_from_blocks(&blocks),
                recent_turns: claude_recent_turns.clone(),
                exit_code,
            });

            let _ = app_handle.emit(
                "stream-chunk",
                StreamEvent {
                    terminal_tab_id: done_tab_id,
                    message_id: msg_id,
                    chunk: String::new(),
                    done: true,
                    exit_code,
                    duration_ms: Some(duration_ms),
                    final_content: Some(final_content),
                    content_format: Some(content_format),
                    transport_kind: Some(claude_transport_kind),
                    transport_session: Some(transport_session),
                    blocks: Some(blocks),
                },
            );

            if let Ok(mut state) = state_arc.lock() {
                sync_workspace_metrics(&mut state);
                let _ = persist_state(&state);
                emit_state(&app_handle, &state);
            }
        });

        return Ok(message_id);
    }

    let script = build_agent_script(
        &cli_id,
        &wrapper_path,
        &composed_prompt,
        write_mode,
        &request_session,
    )?;
    let shell_terminal_storage = terminal_storage.clone();
    let shell_workspace_id = workspace_id_for_thread.clone();
    let shell_project_name = project_name_for_thread.clone();
    let shell_recent_turns = recent_turns_for_thread.clone();

    thread::spawn(move || {
        let start = Instant::now();

        let mut cmd = Command::new(&shell);
        cmd.args(["-NoLogo", "-NoProfile", "-Command", &script])
            .current_dir(&project_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let child = cmd.spawn();
        let mut child = match child {
            Ok(c) => c,
            Err(e) => {
                let _ = app_handle.emit(
                    "stream-chunk",
                    StreamEvent {
                        terminal_tab_id: stream_tab_id.clone(),
                        message_id: msg_id,
                        chunk: format!("Error: {}", e),
                        done: true,
                        exit_code: Some(1),
                        duration_ms: Some(start.elapsed().as_millis() as u64),
                        final_content: Some(format!("Error: {}", e)),
                        content_format: Some("log".to_string()),
                        transport_kind: Some(transport_kind.clone()),
                        transport_session: Some(build_transport_session(
                            &agent_id,
                            requested_transport_session.clone(),
                            None,
                            None,
                            request_session_for_thread.model.get(&agent_id).cloned(),
                            request_session_for_thread
                                .permission_mode
                                .get(&agent_id)
                                .cloned(),
                        )),
                        blocks: Some(vec![ChatMessageBlock::Status {
                            level: "error".to_string(),
                            text: format!("Error: {}", e),
                        }]),
                    },
                );
                return;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let output_buffer = Arc::new(Mutex::new(String::new()));

        let stdout_buf = output_buffer.clone();
        let stdout_app = app_handle.clone();
        let stdout_msg = msg_id.clone();
        let stdout_tab_id = terminal_tab_id.clone();
        let stdout_handle = thread::spawn(move || {
            if let Some(out) = stdout {
                let reader = BufReader::new(out);
                for line in reader.lines().flatten() {
                    if let Ok(mut buf) = stdout_buf.lock() {
                        buf.push_str(&line);
                        buf.push('\n');
                    }
                    let _ = stdout_app.emit(
                        "stream-chunk",
                        StreamEvent {
                            terminal_tab_id: stdout_tab_id.clone(),
                            message_id: stdout_msg.clone(),
                            chunk: format!("{}\n", line),
                            done: false,
                            exit_code: None,
                            duration_ms: None,
                            final_content: None,
                            content_format: None,
                            transport_kind: None,
                            transport_session: None,
                            blocks: None,
                        },
                    );
                }
            }
        });

        let stderr_buf = output_buffer.clone();
        let stderr_app = app_handle.clone();
        let stderr_msg = msg_id.clone();
        let stderr_tab_id = terminal_tab_id.clone();
        let stderr_handle = thread::spawn(move || {
            if let Some(err) = stderr {
                let reader = BufReader::new(err);
                for line in reader.lines().flatten() {
                    if let Ok(mut buf) = stderr_buf.lock() {
                        buf.push_str(&line);
                        buf.push('\n');
                    }
                    let _ = stderr_app.emit(
                        "stream-chunk",
                        StreamEvent {
                            terminal_tab_id: stderr_tab_id.clone(),
                            message_id: stderr_msg.clone(),
                            chunk: format!("{}\n", line),
                            done: false,
                            exit_code: None,
                            duration_ms: None,
                            final_content: None,
                            content_format: None,
                            transport_kind: None,
                            transport_session: None,
                            blocks: None,
                        },
                    );
                }
            }
        });

        let status = child.wait().ok();
        let _ = stdout_handle.join();
        let _ = stderr_handle.join();

        let duration_ms = start.elapsed().as_millis() as u64;
        let exit_code = status.and_then(|s| s.code());
        let raw_output = output_buffer.lock().map(|b| b.clone()).unwrap_or_default();
        let transport_session = build_transport_session(
            &agent_id,
            requested_transport_session,
            None,
            None,
            request_session_for_thread.model.get(&agent_id).cloned(),
            request_session_for_thread
                .permission_mode
                .get(&agent_id)
                .cloned(),
        );

        // Store conversation turn in unified history
        if let Ok(mut ctx) = ctx_arc.lock() {
            let turn = ConversationTurn {
                id: create_id("turn"),
                agent_id: agent_id.clone(),
                timestamp: now_stamp(),
                user_prompt: user_prompt.clone(),
                composed_prompt: composed_prompt_for_history.clone(),
                raw_output: raw_output.clone(),
                output_summary: display_summary(&raw_output),
                duration_ms: duration_ms,
                exit_code,
                write_mode: turn_write_mode,
            };
            // Per-agent
            let max = ctx.max_turns_per_agent;
            if let Some(agent_ctx) = ctx.agents.get_mut(&agent_id) {
                agent_ctx.conversation_history.push(turn.clone());
                if agent_ctx.conversation_history.len() > max {
                    let drain = agent_ctx.conversation_history.len() - max;
                    agent_ctx.conversation_history.drain(0..drain);
                }
                agent_ctx.total_token_estimate += raw_output.len() / 4;
            }
            // Unified
            ctx.conversation_history.push(turn);
            if ctx.conversation_history.len() > max {
                let drain = ctx.conversation_history.len() - max;
                ctx.conversation_history.drain(0..drain);
            }
            let _ = persist_context(&ctx);
        }

        let _ = shell_terminal_storage.record_turn_progress(&storage::TaskTurnUpdate {
            terminal_tab_id: done_tab_id.clone(),
            workspace_id: shell_workspace_id.clone(),
            project_root: project_root.clone(),
            project_name: shell_project_name.clone(),
            cli_id: agent_id.clone(),
            user_prompt: user_prompt.clone(),
            assistant_summary: display_summary(&raw_output),
            relevant_files: Vec::new(),
            recent_turns: shell_recent_turns.clone(),
            exit_code,
        });

        // Emit done
        let _ = app_handle.emit(
            "stream-chunk",
            StreamEvent {
                terminal_tab_id: done_tab_id,
                message_id: msg_id,
                chunk: String::new(),
                done: true,
                exit_code,
                duration_ms: Some(duration_ms),
                final_content: Some(raw_output.clone()),
                content_format: None,
                transport_kind: Some(transport_kind),
                transport_session: Some(transport_session),
                blocks: None,
            },
        );

        // Update workspace metrics
        if let Ok(mut state) = state_arc.lock() {
            sync_workspace_metrics(&mut state);
            let _ = persist_state(&state);
            emit_state(&app_handle, &state);
        }
    });

    Ok(message_id)
}

#[tauri::command]
fn run_auto_orchestration(
    app: AppHandle,
    store: State<'_, AppStore>,
    request: AutoOrchestrationRequest,
) -> Result<String, String> {
    let message_id = request.assistant_message_id.clone();
    let timeout_ms = {
        let settings = store.settings.lock().map_err(|err| err.to_string())?;
        settings.process_timeout_ms
    };

    let mut state_snapshot = store.state.lock().map_err(|err| err.to_string())?.clone();
    state_snapshot.workspace.project_root = request.project_root.clone();
    state_snapshot.workspace.project_name = request.project_name.clone();
    state_snapshot.workspace.branch =
        git_output(&request.project_root, &["branch", "--show-current"])
            .unwrap_or_else(|| "workspace".to_string());

    let claude_wrapper_path = resolve_runtime_command(&state_snapshot, "claude")?;

    let state_arc = store.state.clone();
    let ctx_arc = store.context.clone();
    let codex_pending_approvals = store.codex_pending_approvals.clone();
    let app_handle = app.clone();
    let terminal_tab_id = request.terminal_tab_id.clone();
    let request_for_thread = request.clone();
    let composed_state = state_snapshot.clone();
    let msg_id = message_id.clone();
    let terminal_storage = store.terminal_storage.clone();

    thread::spawn(move || {
        let started_at = Instant::now();
        let mut step_states: Vec<AutoExecutionStepState> = Vec::new();
        let mut worker_trace_blocks: Vec<ChatMessageBlock> = Vec::new();
        let seed_plan = AutoPlan {
            goal: request_for_thread.prompt.clone(),
            summary: Some("Claude is preparing the execution plan.".to_string()),
            steps: Vec::new(),
        };
        emit_stream_block_update(
            &app_handle,
            &terminal_tab_id,
            &msg_id,
            &build_auto_orchestration_blocks(
                &seed_plan,
                "planning",
                Some("Claude is preparing the execution plan."),
                &step_states,
            ),
        );

        let mut planner_session = acp::AcpSession::default();
        planner_session.plan_mode = true;
        planner_session.fast_mode = request_for_thread.fast_mode;
        planner_session.effort_level = request_for_thread.effort_level.clone();
        if let Some(model) = request_for_thread.model_overrides.get("claude") {
            planner_session
                .model
                .insert("claude".to_string(), model.clone());
        }
        let _ = terminal_storage.maybe_auto_compact_terminal_tab(&terminal_tab_id);
        let planner_prompt =
            build_auto_plan_prompt(&composed_state, &terminal_storage, &request_for_thread);
        let planner_result = run_silent_agent_turn_once(
            &request_for_thread.project_root,
            "claude",
            &claude_wrapper_path,
            &planner_prompt,
            false,
            &planner_session,
            timeout_ms,
        );

        let plan = match planner_result {
            Ok(outcome) => {
                let source = if outcome.final_content.trim().is_empty() {
                    outcome.raw_output.as_str()
                } else {
                    outcome.final_content.as_str()
                };
                parse_auto_plan(source, &request_for_thread.prompt)
            }
            Err(_) => auto_plan_fallback(&request_for_thread.prompt),
        };

        step_states = plan
            .steps
            .iter()
            .cloned()
            .map(|step| AutoExecutionStepState {
                step,
                status: "planned".to_string(),
                summary: None,
                result: None,
            })
            .collect();

        if request_for_thread.plan_mode {
            let blocks = build_auto_orchestration_blocks(
                &plan,
                "completed",
                Some("Plan mode is enabled, so no worker steps were executed."),
                &step_states,
            );
            let final_content = if step_states.is_empty() {
                "No executable steps were planned.".to_string()
            } else {
                let mut lines = vec!["Execution plan ready.".to_string(), String::new()];
                for (index, step) in step_states.iter().enumerate() {
                    lines.push(format!(
                        "{}. {} ({})",
                        index + 1,
                        step.step.title,
                        step.step.owner
                    ));
                    lines.push(format!("   {}", step.step.instruction));
                }
                lines.join("\n")
            };

            let _ = app_handle.emit(
                "stream-chunk",
                StreamEvent {
                    terminal_tab_id,
                    message_id: msg_id,
                    chunk: String::new(),
                    done: true,
                    exit_code: Some(0),
                    duration_ms: Some(started_at.elapsed().as_millis() as u64),
                    final_content: Some(final_content.clone()),
                    content_format: Some("markdown".to_string()),
                    transport_kind: Some("claude-cli".to_string()),
                    transport_session: None,
                    blocks: Some(blocks),
                },
            );
            return;
        }

        emit_stream_block_update(
            &app_handle,
            &terminal_tab_id,
            &msg_id,
            &build_auto_orchestration_blocks(
                &plan,
                "running",
                Some("Executing the planned steps."),
                &step_states,
            ),
        );

        let mut encountered_failure = false;
        for index in 0..step_states.len() {
            if encountered_failure {
                step_states[index].status = "skipped".to_string();
                step_states[index].summary =
                    Some("Skipped because an earlier step failed.".to_string());
                continue;
            }

            step_states[index].status = "running".to_string();
            step_states[index].summary = Some("Running step.".to_string());
            emit_stream_block_update(&app_handle, &terminal_tab_id, &msg_id, &{
                let mut merged = build_auto_orchestration_blocks(
                    &plan,
                    "running",
                    Some("Executing the planned steps."),
                    &step_states,
                );
                merged.extend(worker_trace_blocks.clone());
                merged
            });

            let step = step_states[index].step.clone();
            let wrapper_path = match resolve_runtime_command(&composed_state, &step.owner) {
                Ok(path) => path,
                Err(error) => {
                    step_states[index].status = "failed".to_string();
                    step_states[index].summary = Some("CLI runtime is unavailable.".to_string());
                    step_states[index].result = Some(error);
                    encountered_failure = true;
                    continue;
                }
            };

            let mut worker_session = acp::AcpSession::default();
            worker_session.plan_mode = !step.write;
            worker_session.fast_mode = request_for_thread.fast_mode;
            worker_session.effort_level = request_for_thread.effort_level.clone();
            if let Some(model) = request_for_thread.model_overrides.get(&step.owner) {
                worker_session
                    .model
                    .insert(step.owner.clone(), model.clone());
            }
            if let Some(permission) = request_for_thread.permission_overrides.get(&step.owner) {
                worker_session
                    .permission_mode
                    .insert(step.owner.clone(), permission.clone());
            }

            let worker_prompt = compose_tab_context_prompt(
                &composed_state,
                &terminal_storage,
                &step.owner,
                &request_for_thread.terminal_tab_id,
                &request_for_thread.workspace_id,
                &request_for_thread.project_root,
                &request_for_thread.project_name,
                &build_auto_worker_prompt(&request_for_thread.prompt, &step),
                &request_for_thread.recent_turns,
                step.write,
                None,
                None,
            );

            let block_prefix = {
                let mut merged = build_auto_orchestration_blocks(
                    &plan,
                    "running",
                    Some("Executing the planned steps."),
                    &step_states,
                );
                merged.extend(worker_trace_blocks.clone());
                merged
            };

            if step.owner == "codex" {
                match run_codex_app_server_turn(
                    &app_handle,
                    &wrapper_path,
                    &request_for_thread.project_root,
                    &worker_prompt,
                    &[],
                    &worker_session,
                    None,
                    &terminal_tab_id,
                    &msg_id,
                    step.write,
                    codex_pending_approvals.clone(),
                    block_prefix,
                ) {
                    Ok(outcome) => {
                        worker_trace_blocks.extend(outcome.blocks.clone());
                        step_states[index].status = "completed".to_string();
                        step_states[index].summary = Some("Codex step completed.".to_string());
                        step_states[index].result =
                            Some(display_summary(if outcome.raw_output.trim().is_empty() {
                                &outcome.final_content
                            } else {
                                &outcome.raw_output
                            }));
                    }
                    Err(error) => {
                        worker_trace_blocks.push(ChatMessageBlock::Status {
                            level: "error".to_string(),
                            text: error.clone(),
                        });
                        step_states[index].status = "failed".to_string();
                        step_states[index].summary = Some("Codex step failed.".to_string());
                        step_states[index].result = Some(display_summary(&error));
                        encountered_failure = true;
                    }
                }
            } else if step.owner == "gemini" {
                match run_gemini_acp_turn(
                    &app_handle,
                    &wrapper_path,
                    &request_for_thread.project_root,
                    &worker_prompt,
                    &worker_session,
                    None,
                    &terminal_tab_id,
                    &msg_id,
                    step.write,
                    timeout_ms,
                    block_prefix,
                ) {
                    Ok(outcome) => {
                        worker_trace_blocks.extend(outcome.blocks.clone());
                        step_states[index].status = "completed".to_string();
                        step_states[index].summary = Some("Gemini step completed.".to_string());
                        step_states[index].result =
                            Some(display_summary(if outcome.raw_output.trim().is_empty() {
                                &outcome.final_content
                            } else {
                                &outcome.raw_output
                            }));
                    }
                    Err(error) => {
                        worker_trace_blocks.push(ChatMessageBlock::Status {
                            level: "error".to_string(),
                            text: error.clone(),
                        });
                        step_states[index].status = "failed".to_string();
                        step_states[index].summary = Some("Gemini step failed.".to_string());
                        step_states[index].result = Some(display_summary(&error));
                        encountered_failure = true;
                    }
                }
            } else {
                match run_silent_agent_turn_once(
                    &request_for_thread.project_root,
                    &step.owner,
                    &wrapper_path,
                    &worker_prompt,
                    step.write,
                    &worker_session,
                    timeout_ms,
                ) {
                    Ok(outcome) => {
                        step_states[index].status = "completed".to_string();
                        step_states[index].summary = Some("Step completed.".to_string());
                        step_states[index].result =
                            Some(display_summary(if outcome.raw_output.trim().is_empty() {
                                &outcome.final_content
                            } else {
                                &outcome.raw_output
                            }));
                    }
                    Err(error) => {
                        worker_trace_blocks.push(ChatMessageBlock::Status {
                            level: "error".to_string(),
                            text: error.clone(),
                        });
                        step_states[index].status = "failed".to_string();
                        step_states[index].summary = Some("Step failed.".to_string());
                        step_states[index].result = Some(display_summary(&error));
                        encountered_failure = true;
                    }
                }
            }

            emit_stream_block_update(&app_handle, &terminal_tab_id, &msg_id, &{
                let mut merged = build_auto_orchestration_blocks(
                    &plan,
                    "running",
                    Some("Executing the planned steps."),
                    &step_states,
                );
                merged.extend(worker_trace_blocks.clone());
                merged
            });
        }

        emit_stream_block_update(&app_handle, &terminal_tab_id, &msg_id, &{
            let mut merged = build_auto_orchestration_blocks(
                &plan,
                "synthesizing",
                Some("Claude is synthesizing the final response."),
                &step_states,
            );
            merged.extend(worker_trace_blocks.clone());
            merged
        });

        let mut synthesis_session = acp::AcpSession::default();
        synthesis_session.plan_mode = true;
        synthesis_session.fast_mode = request_for_thread.fast_mode;
        synthesis_session.effort_level = request_for_thread.effort_level.clone();
        if let Some(model) = request_for_thread.model_overrides.get("claude") {
            synthesis_session
                .model
                .insert("claude".to_string(), model.clone());
        }

        let synthesis_prompt =
            build_auto_synthesis_prompt(&request_for_thread.prompt, &plan, &step_states);
        let synthesized = run_silent_agent_turn_once(
            &request_for_thread.project_root,
            "claude",
            &claude_wrapper_path,
            &synthesis_prompt,
            false,
            &synthesis_session,
            timeout_ms,
        )
        .ok()
        .map(|outcome| {
            if outcome.final_content.trim().is_empty() {
                outcome.raw_output
            } else {
                outcome.final_content
            }
        });

        let fallback_summary = {
            let mut lines = Vec::new();
            if encountered_failure {
                lines.push("The workflow finished with at least one failed step.".to_string());
            } else {
                lines.push("The workflow completed successfully.".to_string());
            }
            lines.push(String::new());
            for step in &step_states {
                lines.push(format!("- {} [{}]", step.step.title, step.status));
                if let Some(result) = step.result.as_ref() {
                    lines.push(format!("  {}", result));
                }
            }
            lines.join("\n")
        };
        let final_content = synthesized.unwrap_or(fallback_summary);
        let final_exit_code = if encountered_failure {
            Some(1)
        } else {
            Some(0)
        };
        let final_blocks = build_auto_orchestration_blocks(
            &plan,
            if encountered_failure {
                "failed"
            } else {
                "completed"
            },
            Some(if encountered_failure {
                "Execution finished with failures."
            } else {
                "Execution completed."
            }),
            &step_states,
        )
        .into_iter()
        .chain(worker_trace_blocks.clone())
        .collect::<Vec<_>>();

        if let Ok(mut ctx) = ctx_arc.lock() {
            let max = ctx.max_turns_per_agent;
            let turn = ConversationTurn {
                id: create_id("turn"),
                agent_id: "claude".to_string(),
                timestamp: now_stamp(),
                user_prompt: request_for_thread.prompt.clone(),
                composed_prompt: planner_prompt,
                raw_output: final_content.clone(),
                output_summary: display_summary(&final_content),
                duration_ms: started_at.elapsed().as_millis() as u64,
                exit_code: final_exit_code,
                write_mode: true,
            };
            if let Some(agent_ctx) = ctx.agents.get_mut("claude") {
                agent_ctx.conversation_history.push(turn.clone());
                if agent_ctx.conversation_history.len() > max {
                    let drain = agent_ctx.conversation_history.len() - max;
                    agent_ctx.conversation_history.drain(0..drain);
                }
                agent_ctx.total_token_estimate += final_content.len() / 4;
            }
            ctx.conversation_history.push(turn);
            if ctx.conversation_history.len() > max {
                let drain = ctx.conversation_history.len() - max;
                ctx.conversation_history.drain(0..drain);
            }
            let _ = persist_context(&ctx);
        }

        let _ = terminal_storage.record_turn_progress(&storage::TaskTurnUpdate {
            terminal_tab_id: terminal_tab_id.clone(),
            workspace_id: request_for_thread.workspace_id.clone(),
            project_root: request_for_thread.project_root.clone(),
            project_name: request_for_thread.project_name.clone(),
            cli_id: "claude".to_string(),
            user_prompt: request_for_thread.prompt.clone(),
            assistant_summary: display_summary(&final_content),
            relevant_files: collect_relevant_files_from_blocks(&final_blocks),
            recent_turns: request_for_thread
                .recent_turns
                .iter()
                .map(|turn| TaskRecentTurn {
                    cli_id: turn.cli_id.clone(),
                    user_prompt: turn.user_prompt.clone(),
                    assistant_reply: turn.assistant_reply.clone(),
                    timestamp: turn.timestamp.clone(),
                })
                .collect(),
            exit_code: final_exit_code,
        });

        let _ = app_handle.emit(
            "stream-chunk",
            StreamEvent {
                terminal_tab_id: terminal_tab_id.clone(),
                message_id: msg_id.clone(),
                chunk: String::new(),
                done: true,
                exit_code: final_exit_code,
                duration_ms: Some(started_at.elapsed().as_millis() as u64),
                final_content: Some(final_content),
                content_format: Some("markdown".to_string()),
                transport_kind: Some("claude-cli".to_string()),
                transport_session: None,
                blocks: Some(final_blocks),
            },
        );

        if let Ok(mut state) = state_arc.lock() {
            sync_workspace_metrics(&mut state);
            let _ = persist_state(&state);
            emit_state(&app_handle, &state);
        }
    });

    Ok(message_id)
}

#[tauri::command]
fn respond_assistant_approval(
    store: State<'_, AppStore>,
    request: ClaudeApprovalResponseRequest,
) -> Result<ClaudeApprovalResponseResult, String> {
    let Some(parsed_decision) = parse_claude_approval_decision(&request.decision) else {
        return Err("Unknown approval decision.".to_string());
    };

    if let Some(pending) = {
        let mut approvals = store
            .claude_pending_approvals
            .lock()
            .map_err(|err| err.to_string())?;
        approvals.remove(&request.request_id)
    } {
        if matches!(parsed_decision, ClaudeApprovalDecision::AllowAlways) {
            let mut rules = store
                .claude_approval_rules
                .lock()
                .map_err(|err| err.to_string())?;
            store_claude_tool_approval(&mut rules, &pending.project_root, &pending.tool_name);
            persist_claude_approval_rules(&rules)?;
        }

        pending
            .sender
            .send(parsed_decision)
            .map_err(|_| "Assistant approval request is no longer active.".to_string())?;
        return Ok(ClaudeApprovalResponseResult { applied: true });
    }

    if let Some(pending) = {
        let mut approvals = store
            .codex_pending_approvals
            .lock()
            .map_err(|err| err.to_string())?;
        approvals.remove(&request.request_id)
    } {
        pending
            .sender
            .send(parsed_decision)
            .map_err(|_| "Assistant approval request is no longer active.".to_string())?;
        return Ok(ClaudeApprovalResponseResult { applied: true });
    }

    Ok(ClaudeApprovalResponseResult { applied: false })
}

// ── ACP commands ────────────────────────────────────────────────────────

#[tauri::command]
fn execute_acp_command(
    store: State<'_, AppStore>,
    command: acp::AcpCommand,
    cli_id: String,
) -> Result<acp::AcpCommandResult, String> {
    let kind = command.kind.as_str();

    // Check if command is supported for this CLI
    let registry = acp::command_registry();
    let def = registry.iter().find(|c| c.kind == kind);
    if let Some(def) = def {
        if !def.supported_clis.contains(&cli_id) {
            return Ok(acp::AcpCommandResult {
                success: false,
                output: format!("The /{} command is not available for {} CLI", kind, cli_id),
                side_effects: vec![],
            });
        }
    }

    match kind {
        "model" => {
            let model = command.args.first().cloned().unwrap_or_default();
            if model.is_empty() {
                // Show current model
                let session = store.acp_session.lock().map_err(|e| e.to_string())?;
                let current = session
                    .model
                    .get(&cli_id)
                    .cloned()
                    .unwrap_or_else(|| "default".into());
                return Ok(acp::AcpCommandResult {
                    success: true,
                    output: format!("Current model for {}: {}", cli_id, current),
                    side_effects: vec![],
                });
            }
            let mut session = store.acp_session.lock().map_err(|e| e.to_string())?;
            session.model.insert(cli_id.clone(), model.clone());
            Ok(acp::AcpCommandResult {
                success: true,
                output: format!("Model for {} set to: {}", cli_id, model),
                side_effects: vec![acp::AcpSideEffect::ModelChanged { cli_id, model }],
            })
        }
        "permissions" => {
            let mode = command.args.first().cloned().unwrap_or_default();
            if mode.is_empty() {
                let session = store.acp_session.lock().map_err(|e| e.to_string())?;
                let current = session
                    .permission_mode
                    .get(&cli_id)
                    .cloned()
                    .unwrap_or_else(|| {
                        match cli_id.as_str() {
                            "codex" => "workspace-write",
                            "claude" => "acceptEdits",
                            "gemini" => "auto_edit",
                            _ => "default",
                        }
                        .to_string()
                    });
                return Ok(acp::AcpCommandResult {
                    success: true,
                    output: format!("Current permission mode for {}: {}", cli_id, current),
                    side_effects: vec![],
                });
            }
            let mut session = store.acp_session.lock().map_err(|e| e.to_string())?;
            session.permission_mode.insert(cli_id.clone(), mode.clone());
            Ok(acp::AcpCommandResult {
                success: true,
                output: format!("Permission mode for {} set to: {}", cli_id, mode),
                side_effects: vec![acp::AcpSideEffect::PermissionChanged { cli_id, mode }],
            })
        }
        "effort" => {
            let level = command.args.first().cloned().unwrap_or_default();
            if level.is_empty() {
                let session = store.acp_session.lock().map_err(|e| e.to_string())?;
                let current = session
                    .effort_level
                    .clone()
                    .unwrap_or_else(|| "default".into());
                return Ok(acp::AcpCommandResult {
                    success: true,
                    output: format!("Current effort level: {}", current),
                    side_effects: vec![],
                });
            }
            let valid = ["low", "medium", "high", "max"];
            if !valid.contains(&level.as_str()) {
                return Ok(acp::AcpCommandResult {
                    success: false,
                    output: format!(
                        "Invalid effort level '{}'. Valid: {}",
                        level,
                        valid.join(", ")
                    ),
                    side_effects: vec![],
                });
            }
            let mut session = store.acp_session.lock().map_err(|e| e.to_string())?;
            session.effort_level = Some(level.clone());
            Ok(acp::AcpCommandResult {
                success: true,
                output: format!("Effort level set to: {}", level),
                side_effects: vec![acp::AcpSideEffect::EffortChanged { level }],
            })
        }
        "fast" => {
            let mut session = store.acp_session.lock().map_err(|e| e.to_string())?;
            session.fast_mode = !session.fast_mode;
            let active = session.fast_mode;
            Ok(acp::AcpCommandResult {
                success: true,
                output: format!("Fast mode: {}", if active { "ON" } else { "OFF" }),
                side_effects: vec![acp::AcpSideEffect::UiNotification {
                    message: format!("Fast mode {}", if active { "enabled" } else { "disabled" }),
                }],
            })
        }
        "plan" => {
            let mut session = store.acp_session.lock().map_err(|e| e.to_string())?;
            session.plan_mode = !session.plan_mode;
            let active = session.plan_mode;
            Ok(acp::AcpCommandResult {
                success: true,
                output: format!("Plan mode: {}", if active { "ON" } else { "OFF" }),
                side_effects: vec![acp::AcpSideEffect::PlanModeToggled { active }],
            })
        }
        "clear" => {
            let mut ctx = store.context.lock().map_err(|e| e.to_string())?;
            ctx.conversation_history.clear();
            for agent_ctx in ctx.agents.values_mut() {
                agent_ctx.conversation_history.clear();
                agent_ctx.total_token_estimate = 0;
            }
            let _ = persist_context(&ctx);
            Ok(acp::AcpCommandResult {
                success: true,
                output: "Conversation history cleared for all CLIs.".into(),
                side_effects: vec![acp::AcpSideEffect::HistoryCleared],
            })
        }
        "compact" => {
            let Some(result) = store.terminal_storage.compact_active_context()? else {
                return Ok(acp::AcpCommandResult {
                    success: false,
                    output: "Not enough completed turns in the active terminal tab to compact yet."
                        .into(),
                    side_effects: vec![],
                });
            };
            Ok(acp::AcpCommandResult {
                success: true,
                output: format!(
                    "Context compacted for task {}. Summarized {} turns into a snapshot and kept the latest {} turns hot.",
                    result.task_id, result.summarized_turn_count, result.kept_turn_count
                ),
                side_effects: vec![acp::AcpSideEffect::ContextCompacted],
            })
        }
        "rewind" => {
            let mut ctx = store.context.lock().map_err(|e| e.to_string())?;
            if ctx.conversation_history.is_empty() {
                return Ok(acp::AcpCommandResult {
                    success: false,
                    output: "No conversation turns to rewind.".into(),
                    side_effects: vec![],
                });
            }
            let removed = ctx.conversation_history.pop();
            if let Some(ref turn) = removed {
                if let Some(agent_ctx) = ctx.agents.get_mut(&turn.agent_id) {
                    agent_ctx.conversation_history.retain(|t| t.id != turn.id);
                }
            }
            let _ = persist_context(&ctx);
            Ok(acp::AcpCommandResult {
                success: true,
                output: "Last conversation turn removed.".into(),
                side_effects: vec![acp::AcpSideEffect::ConversationRewound { removed_turns: 1 }],
            })
        }
        "cost" => {
            let ctx = store.context.lock().map_err(|e| e.to_string())?;
            let mut lines = vec!["Token usage estimates:".to_string()];
            for (agent_id, agent_ctx) in &ctx.agents {
                lines.push(format!(
                    "  {}: ~{} tokens ({} turns)",
                    agent_id,
                    agent_ctx.total_token_estimate,
                    agent_ctx.conversation_history.len()
                ));
            }
            let total: usize = ctx.agents.values().map(|a| a.total_token_estimate).sum();
            lines.push(format!("  Total: ~{} tokens", total));
            Ok(acp::AcpCommandResult {
                success: true,
                output: lines.join("\n"),
                side_effects: vec![],
            })
        }
        "diff" => {
            let state = store.state.lock().map_err(|e| e.to_string())?;
            let project_root = &state.workspace.project_root;
            let diff = git_output(project_root, &["diff", "--stat"])
                .unwrap_or_else(|| "No uncommitted changes (or not a git repo).".to_string());
            Ok(acp::AcpCommandResult {
                success: true,
                output: diff,
                side_effects: vec![],
            })
        }
        "status" => {
            let state = store.state.lock().map_err(|e| e.to_string())?;
            let session = store.acp_session.lock().map_err(|e| e.to_string())?;
            let agent = state.agents.iter().find(|a| a.id == cli_id);
            let version = agent
                .and_then(|a| a.runtime.version.clone())
                .unwrap_or_else(|| "unknown".into());
            let installed = agent.map(|a| a.runtime.installed).unwrap_or(false);
            let model = session
                .model
                .get(&cli_id)
                .cloned()
                .unwrap_or_else(|| "default".into());
            let perm = session
                .permission_mode
                .get(&cli_id)
                .cloned()
                .unwrap_or_else(|| "default".into());
            let output = format!(
                "CLI: {}\nInstalled: {}\nVersion: {}\nModel: {}\nPermission mode: {}\nPlan mode: {}\nFast mode: {}\nEffort: {}",
                cli_id,
                if installed { "yes" } else { "no" },
                version,
                model,
                perm,
                if session.plan_mode { "ON" } else { "OFF" },
                if session.fast_mode { "ON" } else { "OFF" },
                session.effort_level.as_deref().unwrap_or("default"),
            );
            Ok(acp::AcpCommandResult {
                success: true,
                output,
                side_effects: vec![],
            })
        }
        "help" => {
            let cmds = acp::command_registry();
            let mut lines = vec!["Available commands:".to_string()];
            for cmd in &cmds {
                let supported = if cmd.supported_clis.contains(&cli_id) {
                    ""
                } else {
                    " (not available)"
                };
                let args = cmd.args_hint.as_deref().unwrap_or("");
                lines.push(format!(
                    "  {} {} - {}{}",
                    cmd.slash, args, cmd.description, supported
                ));
            }
            Ok(acp::AcpCommandResult {
                success: true,
                output: lines.join("\n"),
                side_effects: vec![],
            })
        }
        "export" => {
            let ctx = store.context.lock().map_err(|e| e.to_string())?;
            let mut md = vec!["# Conversation Export".to_string(), String::new()];
            for turn in &ctx.conversation_history {
                md.push(format!(
                    "## [{}] {} - {}",
                    turn.agent_id, turn.timestamp, turn.user_prompt
                ));
                md.push(String::new());
                md.push(turn.raw_output.clone());
                md.push(String::new());
                md.push("---".to_string());
                md.push(String::new());
            }
            let output = md.join("\n");
            Ok(acp::AcpCommandResult {
                success: true,
                output: if output.len() > 5000 {
                    format!(
                        "{}\n\n... ({} total characters)",
                        safe_truncate_chars(&output, 5000),
                        output.len()
                    )
                } else {
                    output
                },
                side_effects: vec![],
            })
        }
        "context" => {
            let ctx = store.context.lock().map_err(|e| e.to_string())?;
            let mut lines = vec!["Context usage per CLI:".to_string()];
            for (agent_id, agent_ctx) in &ctx.agents {
                let chars: usize = agent_ctx
                    .conversation_history
                    .iter()
                    .map(|t| t.raw_output.len() + t.user_prompt.len())
                    .sum();
                lines.push(format!(
                    "  {}: {} turns, ~{} chars",
                    agent_id,
                    agent_ctx.conversation_history.len(),
                    chars
                ));
            }
            Ok(acp::AcpCommandResult {
                success: true,
                output: lines.join("\n"),
                side_effects: vec![],
            })
        }
        "memory" => {
            let state = store.state.lock().map_err(|e| e.to_string())?;
            let project_root = &state.workspace.project_root;
            let claude_md = Path::new(project_root).join("CLAUDE.md");
            let agents_md = Path::new(project_root).join("AGENTS.md");
            let mut output = String::new();
            if claude_md.exists() {
                let content =
                    fs::read_to_string(&claude_md).unwrap_or_else(|_| "(unreadable)".into());
                let preview = if content.chars().count() > 2000 {
                    safe_truncate_chars(&content, 2000)
                } else {
                    content.clone()
                };
                output.push_str(&format!(
                    "CLAUDE.md ({} chars):\n{}\n",
                    content.len(),
                    preview
                ));
            } else {
                output.push_str("CLAUDE.md: not found\n");
            }
            if agents_md.exists() {
                let content =
                    fs::read_to_string(&agents_md).unwrap_or_else(|_| "(unreadable)".into());
                let preview = if content.chars().count() > 2000 {
                    safe_truncate_chars(&content, 2000)
                } else {
                    content.clone()
                };
                output.push_str(&format!(
                    "\nAGENTS.md ({} chars):\n{}",
                    content.len(),
                    preview
                ));
            } else {
                output.push_str("\nAGENTS.md: not found");
            }
            Ok(acp::AcpCommandResult {
                success: true,
                output,
                side_effects: vec![],
            })
        }
        _ => Ok(acp::AcpCommandResult {
            success: false,
            output: format!("Unknown command: /{}", kind),
            side_effects: vec![],
        }),
    }
}

#[tauri::command]
fn get_acp_commands(cli_id: String) -> Vec<acp::AcpCommandDef> {
    acp::command_registry()
        .into_iter()
        .filter(|c| c.supported_clis.contains(&cli_id))
        .collect()
}

#[tauri::command]
fn get_acp_session(store: State<'_, AppStore>) -> Result<acp::AcpSession, String> {
    let session = store.acp_session.lock().map_err(|e| e.to_string())?;
    Ok(session.clone())
}

#[tauri::command]
fn get_acp_capabilities(cli_id: String) -> Result<acp::AcpCliCapabilities, String> {
    Ok(probe_acp_capabilities(&cli_id))
}

fn probe_acp_capabilities(cli_id: &str) -> acp::AcpCliCapabilities {
    let command_path = resolve_agent_command_path(cli_id);
    let help_output = command_path
        .as_ref()
        .and_then(|path| run_cli_command_capture(path, &["--help"]));
    let exec_help_output = if cli_id == "codex" {
        command_path
            .as_ref()
            .and_then(|path| run_cli_command_capture(path, &["exec", "--help"]))
    } else {
        None
    };

    let permission_runtime_values = match cli_id {
        "codex" => exec_help_output
            .as_deref()
            .map(|help| extract_flag_choices(help, "--sandbox"))
            .unwrap_or_default(),
        "claude" => help_output
            .as_deref()
            .map(|help| extract_flag_choices(help, "--permission-mode"))
            .unwrap_or_default(),
        "gemini" => help_output
            .as_deref()
            .map(|help| extract_flag_choices(help, "--approval-mode"))
            .unwrap_or_default(),
        _ => Vec::new(),
    };

    let effort_runtime_values = if cli_id == "claude" {
        help_output
            .as_deref()
            .map(|help| extract_flag_choices(help, "--effort"))
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let permission_runtime_options =
        build_runtime_options(cli_id, "permissions", permission_runtime_values);
    let effort_runtime_options = build_runtime_options(cli_id, "effort", effort_runtime_values);

    let permission_uses_runtime = !permission_runtime_options.is_empty();
    let effort_uses_runtime = !effort_runtime_options.is_empty();

    acp::AcpCliCapabilities {
        cli_id: cli_id.to_string(),
        model: acp::AcpOptionCatalog {
            supported: true,
            options: fallback_model_options(cli_id),
            note: Some(
                "Installed CLIs do not expose a machine-readable model catalog here, so the picker uses curated presets plus typed fallback."
                    .to_string(),
            ),
        },
        permissions: acp::AcpOptionCatalog {
            supported: true,
            options: if permission_uses_runtime {
                permission_runtime_options
            } else {
                fallback_permission_options(cli_id)
            },
            note: match cli_id {
                "codex" => Some(if permission_uses_runtime {
                    "Mapped to Codex exec sandbox modes detected from local help output.".to_string()
                } else {
                    "Could not interrogate Codex locally, so sandbox modes fell back to known values.".to_string()
                }),
                "claude" => Some(if permission_uses_runtime {
                    "Detected from local Claude CLI help.".to_string()
                } else {
                    "Could not interrogate Claude locally, so permission modes fell back to known values.".to_string()
                }),
                "gemini" => Some(if permission_uses_runtime {
                    "Detected from local Gemini CLI help.".to_string()
                } else {
                    "Could not interrogate Gemini locally, so approval modes fell back to known values.".to_string()
                }),
                _ => None,
            },
        },
        effort: acp::AcpOptionCatalog {
            supported: cli_id == "claude",
            options: if cli_id == "claude" {
                if effort_uses_runtime {
                    effort_runtime_options
                } else {
                    fallback_effort_options()
                }
            } else {
                Vec::new()
            },
            note: if cli_id == "claude" {
                Some(if effort_uses_runtime {
                    "Detected from local Claude CLI help.".to_string()
                } else {
                    "Could not interrogate Claude locally, so effort levels fell back to known values.".to_string()
                })
            } else {
                Some("Reasoning effort is only exposed by Claude CLI.".to_string())
            },
        },
    }
}

fn acp_option(value: &str, description: Option<&str>, source: &str) -> acp::AcpOptionDef {
    acp::AcpOptionDef {
        value: value.to_string(),
        label: value.to_string(),
        description: description.map(|entry| entry.to_string()),
        source: source.to_string(),
    }
}

fn model_preset(value: &str, description: &str) -> acp::AcpOptionDef {
    acp::AcpOptionDef {
        value: value.to_string(),
        label: value.to_string(),
        description: Some(description.to_string()),
        source: "fallback".to_string(),
    }
}

fn fallback_model_options(cli_id: &str) -> Vec<acp::AcpOptionDef> {
    match cli_id {
        "codex" => vec![
            model_preset("default", "Use the CLI default model"),
            model_preset("gpt-5", "General-purpose flagship"),
            model_preset("gpt-5-codex", "Code-focused GPT-5 profile"),
            model_preset("gpt-5-mini", "Lighter GPT-5 variant"),
            model_preset("o3", "Reasoning-focused model alias"),
            model_preset("oss", "Use the local open-source provider mode"),
        ],
        "claude" => vec![
            model_preset("default", "Use the CLI default model"),
            model_preset("sonnet", "Claude Sonnet alias"),
            model_preset("opus", "Claude Opus alias"),
        ],
        "gemini" => vec![
            model_preset("default", "Use the CLI default model"),
            model_preset("gemini-2.5-pro", "High-capability Gemini preset"),
            model_preset("gemini-2.5-flash", "Fast Gemini preset"),
            model_preset("gemini-2.0-flash", "Legacy Gemini flash preset"),
        ],
        _ => vec![model_preset("default", "Use the CLI default model")],
    }
}

fn fallback_permission_options(cli_id: &str) -> Vec<acp::AcpOptionDef> {
    match cli_id {
        "codex" => vec![
            acp_option("read-only", Some("Read-only shell sandbox"), "fallback"),
            acp_option(
                "workspace-write",
                Some("Allow edits inside the workspace"),
                "fallback",
            ),
            acp_option(
                "danger-full-access",
                Some("Disable sandbox restrictions"),
                "fallback",
            ),
        ],
        "claude" => vec![
            acp_option("acceptEdits", Some("Auto-approve edit actions"), "fallback"),
            acp_option(
                "bypassPermissions",
                Some("Bypass permission checks"),
                "fallback",
            ),
            acp_option(
                "default",
                Some("Use Claude default permission mode"),
                "fallback",
            ),
            acp_option("dontAsk", Some("Do not ask before actions"), "fallback"),
            acp_option("plan", Some("Read-only planning mode"), "fallback"),
            acp_option("auto", Some("Automatic permission behavior"), "fallback"),
        ],
        "gemini" => vec![
            acp_option(
                "default",
                Some("Prompt for approval when needed"),
                "fallback",
            ),
            acp_option("auto_edit", Some("Auto-approve edit tools"), "fallback"),
            acp_option("yolo", Some("Auto-approve all tools"), "fallback"),
            acp_option("plan", Some("Read-only plan mode"), "fallback"),
        ],
        _ => Vec::new(),
    }
}

fn fallback_effort_options() -> Vec<acp::AcpOptionDef> {
    vec![
        acp_option("low", Some("Lower reasoning effort"), "fallback"),
        acp_option("medium", Some("Balanced reasoning effort"), "fallback"),
        acp_option("high", Some("High reasoning effort"), "fallback"),
        acp_option("max", Some("Maximum reasoning effort"), "fallback"),
    ]
}

fn describe_runtime_option(cli_id: &str, kind: &str, value: &str) -> Option<&'static str> {
    match (cli_id, kind, value) {
        ("codex", "permissions", "read-only") => Some("Read-only shell sandbox"),
        ("codex", "permissions", "workspace-write") => Some("Allow edits inside the workspace"),
        ("codex", "permissions", "danger-full-access") => Some("Disable sandbox restrictions"),
        ("claude", "permissions", "acceptEdits") => Some("Auto-approve edit actions"),
        ("claude", "permissions", "bypassPermissions") => Some("Bypass permission checks"),
        ("claude", "permissions", "default") => Some("Use Claude default permission mode"),
        ("claude", "permissions", "dontAsk") => Some("Do not ask before actions"),
        ("claude", "permissions", "plan") => Some("Read-only planning mode"),
        ("claude", "permissions", "auto") => Some("Automatic permission behavior"),
        ("gemini", "permissions", "default") => Some("Prompt for approval when needed"),
        ("gemini", "permissions", "auto_edit") => Some("Auto-approve edit tools"),
        ("gemini", "permissions", "yolo") => Some("Auto-approve all tools"),
        ("gemini", "permissions", "plan") => Some("Read-only plan mode"),
        ("claude", "effort", "low") => Some("Lower reasoning effort"),
        ("claude", "effort", "medium") => Some("Balanced reasoning effort"),
        ("claude", "effort", "high") => Some("High reasoning effort"),
        ("claude", "effort", "max") => Some("Maximum reasoning effort"),
        _ => None,
    }
}

fn build_runtime_options(cli_id: &str, kind: &str, values: Vec<String>) -> Vec<acp::AcpOptionDef> {
    let mut seen = BTreeSet::new();
    let mut options = Vec::new();
    for value in values {
        if seen.insert(value.clone()) {
            options.push(acp_option(
                &value,
                describe_runtime_option(cli_id, kind, &value),
                "runtime",
            ));
        }
    }
    options
}

fn extract_flag_choices(help: &str, flag: &str) -> Vec<String> {
    let Some(block) = extract_flag_block(help, flag) else {
        return Vec::new();
    };

    let bracketed = extract_choices_from_block(&block);
    if !bracketed.is_empty() {
        return bracketed;
    }

    if let Some(values) = extract_parenthesized_choices(&block) {
        if !values.is_empty() {
            return values;
        }
    }

    Vec::new()
}

fn extract_flag_block(help: &str, flag: &str) -> Option<String> {
    let lines: Vec<&str> = help.lines().collect();
    for (index, line) in lines.iter().enumerate() {
        if line.contains(flag) {
            let end = usize::min(index + 8, lines.len());
            return Some(lines[index..end].join("\n"));
        }
    }
    None
}

fn extract_choices_from_block(block: &str) -> Vec<String> {
    for marker in ["[possible values:", "[choices:"] {
        if let Some(raw_values) = extract_between(block, marker, ']') {
            let parsed = split_choice_values(&raw_values);
            if !parsed.is_empty() {
                return parsed;
            }
        }
    }

    if let Some(position) = block.find("Possible values:") {
        let mut values = Vec::new();
        for line in block[position..].lines().skip(1) {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("- ") {
                let value = rest.split(':').next().unwrap_or(rest).trim();
                if !value.is_empty() {
                    values.push(value.to_string());
                }
            }
        }
        if !values.is_empty() {
            return values;
        }
    }

    Vec::new()
}

fn extract_parenthesized_choices(block: &str) -> Option<Vec<String>> {
    for line in block.lines() {
        let trimmed = line.trim();
        let Some(start) = trimmed.rfind('(') else {
            continue;
        };
        let Some(end) = trimmed[start + 1..].find(')') else {
            continue;
        };
        let raw = &trimmed[start + 1..start + 1 + end];
        let normalized = raw
            .strip_prefix("choices:")
            .map(|entry| entry.trim())
            .unwrap_or(raw)
            .trim();
        if normalized.contains(',') {
            let parsed = split_choice_values(normalized);
            if !parsed.is_empty() {
                return Some(parsed);
            }
        }
    }
    None
}

fn extract_between(text: &str, start_marker: &str, end_marker: char) -> Option<String> {
    let start = text.find(start_marker)? + start_marker.len();
    let rest = &text[start..];
    let end = rest.find(end_marker)?;
    Some(rest[..end].to_string())
}

fn split_choice_values(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|entry| entry.trim().trim_matches('"').trim_matches('\''))
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.to_string())
        .collect()
}

#[tauri::command]
fn get_git_panel(project_root: String) -> Result<GitPanelData, String> {
    let git_dir = Path::new(&project_root).join(".git");
    if !git_dir.exists() {
        return Ok(GitPanelData {
            is_git_repo: false,
            branch: String::new(),
            recent_changes: Vec::new(),
        });
    }

    let branch = git_output(&project_root, &["branch", "--show-current"])
        .unwrap_or_else(|| "HEAD".to_string());

    let recent_changes = git_output_allow_empty(&project_root, &["status", "--porcelain"])
        .unwrap_or_default()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let bytes = line.as_bytes();
            let index_status = bytes.get(0).copied().unwrap_or(b' ') as char;
            let worktree_status = bytes.get(1).copied().unwrap_or(b' ') as char;
            let status_char = if worktree_status != ' ' && worktree_status != '?' {
                worktree_status
            } else if index_status != ' ' {
                index_status
            } else if index_status == '?' || worktree_status == '?' {
                '?'
            } else {
                worktree_status
            };
            let status = match status_char {
                'A' | '?' => "added",
                'D' => "deleted",
                'R' => "renamed",
                _ => "modified",
            }
            .to_string();

            let raw_path = line.get(3..).unwrap_or(line).trim();
            let (previous_path, path) = if let Some((before, after)) = raw_path.split_once(" -> ") {
                (Some(before.trim().to_string()), after.trim().to_string())
            } else {
                (None, raw_path.to_string())
            };

            GitFileChange {
                path,
                status,
                previous_path,
            }
        })
        .collect();

    Ok(GitPanelData {
        is_git_repo: true,
        branch,
        recent_changes,
    })
}

#[tauri::command]
fn get_git_file_diff(project_root: String, path: String) -> Result<GitFileDiff, String> {
    let git_dir = Path::new(&project_root).join(".git");
    if !git_dir.exists() {
        return Err("Workspace is not a Git repository.".to_string());
    }

    let panel = get_git_panel(project_root.clone())?;
    let change = panel
        .recent_changes
        .into_iter()
        .find(|entry| entry.path == path)
        .ok_or_else(|| "File is no longer changed.".to_string())?;

    let diff = best_git_diff_for_path(&project_root, &path, &change.status);
    let final_diff = if diff.trim().is_empty() {
        match change.status.as_str() {
            "added" => build_untracked_file_diff(&project_root, &path),
            _ => "No diff available for this file.".to_string(),
        }
    } else {
        diff
    };
    let original_path = change.previous_path.as_deref().unwrap_or(change.path.as_str());
    let (original_content, modified_content, is_binary) =
        git_diff_editor_contents(&project_root, original_path, &change.path, &change.status);

    Ok(GitFileDiff {
        path: change.path,
        status: change.status,
        previous_path: change.previous_path,
        diff: final_diff,
        original_content,
        modified_content,
        language: Some(monaco_language_for_path(&path)),
        is_binary,
    })
}

#[tauri::command]
fn open_workspace_file(
    project_root: String,
    path: String,
) -> Result<OpenWorkspaceFileResult, String> {
    let absolute_path = Path::new(&project_root).join(&path);
    if !absolute_path.exists() {
        return Err("File does not exist.".to_string());
    }

    #[cfg(target_os = "windows")]
    let status = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", &absolute_path.to_string_lossy()]);
        command.creation_flags(CREATE_NO_WINDOW);
        command.status()
    };

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&absolute_path).status();

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(&absolute_path).status();

    let status = status.map_err(|err| err.to_string())?;
    if !status.success() {
        return Err("Failed to open file.".to_string());
    }

    Ok(OpenWorkspaceFileResult { opened: true })
}

fn build_untracked_file_diff(project_root: &str, path: &str) -> String {
    let absolute_path = Path::new(project_root).join(path);
    let normalized_path = path.replace('\\', "/");
    let bytes = match fs::read(&absolute_path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return format!(
                "diff --git a/{0} b/{0}\nnew file mode 100644\n--- /dev/null\n+++ b/{0}\n+Unable to read file contents.",
                normalized_path
            )
        }
    };

    if bytes.contains(&0) {
        return format!(
            "diff --git a/{0} b/{0}\nnew file mode 100644\nBinary files /dev/null and b/{0} differ",
            normalized_path
        );
    }

    let text = String::from_utf8_lossy(&bytes).replace("\r\n", "\n");
    let mut diff = format!(
        "diff --git a/{0} b/{0}\nnew file mode 100644\n--- /dev/null\n+++ b/{0}",
        normalized_path
    );

    if text.is_empty() {
        return diff;
    }

    let normalized_text = text.trim_end_matches('\n');
    let line_count = normalized_text.lines().count();
    diff.push_str(&format!("\n@@ -0,0 +1,{} @@", line_count));

    for line in normalized_text.lines() {
        diff.push('\n');
        diff.push('+');
        diff.push_str(line);
    }

    diff
}

fn git_diff_editor_contents(
    project_root: &str,
    original_path: &str,
    modified_path: &str,
    status: &str,
) -> (Option<String>, Option<String>, bool) {
    let original_bytes = match status {
        "added" => Some(Vec::new()),
        _ => read_git_blob_bytes(project_root, original_path),
    };
    let modified_bytes = match status {
        "deleted" => Some(Vec::new()),
        _ => read_workspace_file_bytes(project_root, modified_path),
    };

    let is_binary = original_bytes
        .as_deref()
        .map(is_binary_blob)
        .unwrap_or(false)
        || modified_bytes
            .as_deref()
            .map(is_binary_blob)
            .unwrap_or(false);

    if is_binary {
        return (None, None, true);
    }

    (
        original_bytes.map(normalize_text_bytes),
        modified_bytes.map(normalize_text_bytes),
        false,
    )
}

fn read_git_blob_bytes(project_root: &str, path: &str) -> Option<Vec<u8>> {
    let git_path = path.replace('\\', "/");
    let output = Command::new("git")
        .args(["show", &format!("HEAD:{}", git_path)])
        .current_dir(project_root)
        .output()
        .ok()?;

    if output.status.success() {
        Some(output.stdout)
    } else {
        None
    }
}

fn read_workspace_file_bytes(project_root: &str, path: &str) -> Option<Vec<u8>> {
    fs::read(Path::new(project_root).join(path)).ok()
}

fn is_binary_blob(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}

fn normalize_text_bytes(bytes: Vec<u8>) -> String {
    String::from_utf8_lossy(&bytes).replace("\r\n", "\n")
}

fn monaco_language_for_path(path: &str) -> String {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    if normalized.ends_with(".tsx") || normalized.ends_with(".ts") {
        "typescript".to_string()
    } else if normalized.ends_with(".jsx") || normalized.ends_with(".js") {
        "javascript".to_string()
    } else if normalized.ends_with(".rs") {
        "rust".to_string()
    } else if normalized.ends_with(".json") {
        "json".to_string()
    } else if normalized.ends_with(".md") {
        "markdown".to_string()
    } else if normalized.ends_with(".css") {
        "css".to_string()
    } else if normalized.ends_with(".html") || normalized.ends_with(".htm") {
        "html".to_string()
    } else if normalized.ends_with(".yml") || normalized.ends_with(".yaml") {
        "yaml".to_string()
    } else if normalized.ends_with(".toml") {
        "toml".to_string()
    } else if normalized.ends_with(".sh") {
        "shell".to_string()
    } else {
        "plaintext".to_string()
    }
}

fn best_git_diff_for_path(project_root: &str, path: &str, status: &str) -> String {
    let mut candidates: Vec<Vec<&str>> = vec![
        vec!["diff", "HEAD", "--", path],
        vec!["diff", "--cached", "--", path],
        vec!["diff", "--", path],
    ];

    if status == "added" {
        candidates.insert(0, vec!["diff", "--cached", "--", path]);
    }

    for args in candidates {
        if let Some(output) = git_output_allow_empty(project_root, &args) {
            if !output.trim().is_empty() {
                return output;
            }
        }
    }

    String::new()
}

#[tauri::command]
fn pick_workspace_folder() -> Result<Option<WorkspacePickResult>, String> {
    pick_workspace_folder_impl()
}

#[tauri::command]
fn get_cli_skills(
    app: AppHandle,
    store: State<'_, AppStore>,
    cli_id: String,
    project_root: String,
) -> Result<Vec<CliSkillItem>, String> {
    match cli_id.as_str() {
        "codex" => {
            let wrapper_path = {
                let state = store.state.lock().map_err(|err| err.to_string())?;
                state
                    .agents
                    .iter()
                    .find(|agent| agent.id == cli_id)
                    .and_then(|agent| agent.runtime.command_path.clone())
                    .ok_or_else(|| "codex CLI not found".to_string())?
            };

            Ok(
                list_codex_skills_for_workspace(&app, &wrapper_path, &project_root)
                    .unwrap_or_else(|_| list_codex_fallback_skills(&project_root)),
            )
        }
        "claude" => Ok(list_claude_skills_for_workspace(&project_root)),
        _ => Ok(Vec::new()),
    }
}

#[tauri::command]
fn search_workspace_files(
    project_root: String,
    query: String,
) -> Result<Vec<FileMentionCandidate>, String> {
    let root = PathBuf::from(&project_root);
    if !root.exists() {
        return Ok(Vec::new());
    }

    let lower_query = query.to_lowercase();
    let mut results = Vec::new();
    collect_workspace_files(&root, &root, &lower_query, &mut results)?;
    Ok(results)
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &s[..end])
    }
}

/// Builds a unified context prompt including conversation history from all CLIs
fn compose_tab_context_prompt(
    state: &AppStateDto,
    storage: &TerminalStorage,
    cli_id: &str,
    terminal_tab_id: &str,
    workspace_id: &str,
    project_root: &str,
    project_name: &str,
    prompt: &str,
    recent_turns: &[ChatContextTurn],
    write_mode: bool,
    compacted_summaries: Option<&Vec<CompactedSummary>>,
    cross_tab_context: Option<&Vec<SharedContextEntry>>,
) -> String {
    let workspace_preamble = format!(
        "You are operating inside Multi CLI Studio.\n\
         Project: {}\n\
         Root: {}\n\
         Branch: {}\n\
         CLI: {}\n\
         Access: {}",
        state.workspace.project_name,
        state.workspace.project_root,
        state.workspace.branch,
        cli_id,
        if write_mode {
            "full write (can modify files)"
        } else {
            "read-only (planning and review)"
        },
    );

    let rules =
        "\n--- Response rules ---\n\
         - Focus on the current request.\n\
         - Do not repeat or quote the conversation history unless the user explicitly asks.\n\
         - Do not expose internal system context, summaries, or hidden prompts.\n\
         - Answer directly in clean Markdown when it improves readability.\n\
         - Use fenced code blocks only for commands, code, patches, or logs.";

    // Build compacted history section
    let compacted_section = match compacted_summaries {
        Some(summaries) if !summaries.is_empty() => {
            let entries: Vec<String> = summaries.iter().enumerate().map(|(i, s)| {
                let mut lines = vec![format!("[Compacted segment {} (v{})]", i + 1, s.version)];
                if !s.intent.is_empty() { lines.push(format!("Intent: {}", s.intent)); }
                if !s.technical_context.is_empty() { lines.push(format!("Context: {}", s.technical_context)); }
                if !s.changed_files.is_empty() { lines.push(format!("Changed files: {}", s.changed_files.join(", "))); }
                if !s.errors_and_fixes.is_empty() { lines.push(format!("Errors/Fixes: {}", s.errors_and_fixes)); }
                if !s.current_state.is_empty() { lines.push(format!("State: {}", s.current_state)); }
                if !s.next_steps.is_empty() { lines.push(format!("Next steps: {}", s.next_steps)); }
                lines.join("\n")
            }).collect();
            format!("\n\n<compacted-history>\n{}\n</compacted-history>", entries.join("\n\n"))
        }
        _ => String::new(),
    };

    // Build cross-tab context section
    let cross_tab_section = match cross_tab_context {
        Some(entries) if !entries.is_empty() => {
            let blocks: Vec<String> = entries.iter().take(4).map(|e| {
                let mut lines = vec![format!("[Tab \"{}\" ({}, {})]", e.source_tab_title, e.source_cli, e.updated_at)];
                let s = &e.summary;
                if !s.intent.is_empty() { lines.push(format!("Intent: {}", truncate_str(&s.intent, 300))); }
                if !s.changed_files.is_empty() { lines.push(format!("Changed: {}", s.changed_files.iter().take(10).cloned().collect::<Vec<_>>().join(", "))); }
                if !s.current_state.is_empty() { lines.push(format!("State: {}", truncate_str(&s.current_state, 300))); }
                lines.join("\n")
            }).collect();
            format!("\n\n<cross-tab-context>\n{}\n</cross-tab-context>", blocks.join("\n\n"))
        }
        _ => String::new(),
    };

    let workspace_tail = format!(
        "{}{}{}\n\n--- Current workspace ---\n\
         Dirty files: {}\n\
         Failing checks: {}",
        rules,
        compacted_section,
        cross_tab_section,
        state.workspace.dirty_files, state.workspace.failing_checks,
    );

    let fallback_recent_turns = recent_turns
        .iter()
        .map(|turn| TaskRecentTurn {
            cli_id: turn.cli_id.clone(),
            user_prompt: turn.user_prompt.clone(),
            assistant_reply: turn.assistant_reply.clone(),
            timestamp: turn.timestamp.clone(),
        })
        .collect::<Vec<_>>();

    storage
        .build_context_assembly(
            &EnsureTaskPacketRequest {
                terminal_tab_id: terminal_tab_id.to_string(),
                workspace_id: workspace_id.to_string(),
                project_root: project_root.to_string(),
                project_name: project_name.to_string(),
                cli_id: cli_id.to_string(),
                initial_goal: prompt.to_string(),
            },
            cli_id,
            prompt,
            &format!("{}\n\n{}", workspace_preamble, workspace_tail),
            &fallback_recent_turns,
            write_mode,
        )
        .map(|assembled| assembled.prompt)
        .unwrap_or_else(|_| {
            format!(
                "{}\n\n{}\n\n--- User request ---\n{}",
                workspace_preamble, workspace_tail, prompt
            )
        })
}

fn collect_relevant_files_from_blocks(blocks: &[ChatMessageBlock]) -> Vec<String> {
    let mut files = Vec::new();
    for block in blocks {
        if let ChatMessageBlock::FileChange { path, .. } = block {
            if !path.trim().is_empty() && !files.iter().any(|existing| existing == path) {
                files.push(path.clone());
            }
        }
    }
    files
}

// ── Script building ────────────────────────────────────────────────────

fn build_agent_script(
    agent_id: &str,
    wrapper_path: &str,
    prompt: &str,
    write_mode: bool,
    session: &acp::AcpSession,
) -> Result<String, String> {
    let script = match agent_id {
        "codex" => {
            let sandbox = if write_mode {
                session
                    .permission_mode
                    .get("codex")
                    .cloned()
                    .unwrap_or_else(|| "workspace-write".to_string())
            } else {
                "read-only".to_string()
            };
            let model_flag = session.model.get("codex");
            let mut args = vec![
                "--ask-for-approval".to_string(),
                "never".to_string(),
                "exec".to_string(),
                "--skip-git-repo-check".to_string(),
                "--sandbox".to_string(),
                sandbox,
                "--color".to_string(),
                "never".to_string(),
            ];
            if let Some(model) = model_flag {
                args.push("--model".to_string());
                args.push(model.clone());
            }
            args.push(prompt.to_string());
            shell_command(wrapper_path, &args)
        }
        "claude" => {
            let perm = session
                .permission_mode
                .get("claude")
                .cloned()
                .unwrap_or_else(|| "acceptEdits".to_string());
            let permission_mode = if session.plan_mode || !write_mode {
                "plan".to_string()
            } else {
                perm
            };
            let mut args = vec![
                "-p".to_string(),
                prompt.to_string(),
                "--output-format".to_string(),
                "text".to_string(),
                "--permission-mode".to_string(),
                permission_mode,
            ];
            if let Some(model) = session.model.get("claude") {
                args.push("--model".to_string());
                args.push(model.clone());
            }
            if let Some(effort) = session.effort_level.as_ref() {
                args.push("--effort".to_string());
                args.push(effort.clone());
            }
            shell_command(wrapper_path, &args)
        }
        "gemini" => {
            let approval = if session.plan_mode || !write_mode {
                "plan".to_string()
            } else {
                session
                    .permission_mode
                    .get("gemini")
                    .cloned()
                    .unwrap_or_else(|| "auto_edit".to_string())
            };
            let mut args = vec![
                "-p".to_string(),
                prompt.to_string(),
                "--output-format".to_string(),
                "text".to_string(),
                "--approval-mode".to_string(),
                approval,
            ];
            if let Some(model) = session.model.get("gemini") {
                args.push("-m".to_string());
                args.push(model.clone());
            }
            shell_command(wrapper_path, &args)
        }
        _ => return Err("Unknown agent".to_string()),
    };

    Ok(script)
}

fn build_agent_args(
    agent_id: &str,
    prompt: &str,
    write_mode: bool,
    session: &acp::AcpSession,
) -> Result<Vec<String>, String> {
    let args = match agent_id {
        "codex" => {
            let sandbox = if write_mode {
                session
                    .permission_mode
                    .get("codex")
                    .cloned()
                    .unwrap_or_else(|| "workspace-write".to_string())
            } else {
                "read-only".to_string()
            };
            let mut args = vec![
                "--ask-for-approval".to_string(),
                "never".to_string(),
                "exec".to_string(),
                "--skip-git-repo-check".to_string(),
                "--sandbox".to_string(),
                sandbox,
                "--color".to_string(),
                "never".to_string(),
            ];
            if let Some(model) = session.model.get("codex") {
                args.push("--model".to_string());
                args.push(model.clone());
            }
            args.push(prompt.to_string());
            args
        }
        "claude" => {
            let perm = session
                .permission_mode
                .get("claude")
                .cloned()
                .unwrap_or_else(|| "acceptEdits".to_string());
            let permission_mode = if session.plan_mode || !write_mode {
                "plan".to_string()
            } else {
                perm
            };
            let mut args = vec![
                "-p".to_string(),
                prompt.to_string(),
                "--output-format".to_string(),
                "text".to_string(),
                "--permission-mode".to_string(),
                permission_mode,
            ];
            if let Some(model) = session.model.get("claude") {
                args.push("--model".to_string());
                args.push(model.clone());
            }
            if let Some(effort) = session.effort_level.as_ref() {
                args.push("--effort".to_string());
                args.push(effort.clone());
            }
            args
        }
        "gemini" => {
            let approval = if session.plan_mode || !write_mode {
                "plan".to_string()
            } else {
                session
                    .permission_mode
                    .get("gemini")
                    .cloned()
                    .unwrap_or_else(|| "auto_edit".to_string())
            };
            let mut args = vec![
                "-p".to_string(),
                prompt.to_string(),
                "--output-format".to_string(),
                "text".to_string(),
                "--approval-mode".to_string(),
                approval,
            ];
            if let Some(model) = session.model.get("gemini") {
                args.push("-m".to_string());
                args.push(model.clone());
            }
            args
        }
        _ => return Err("Unknown agent".to_string()),
    };

    Ok(args)
}

fn build_review_prompt(state: &AppStateDto, agent_id: &str) -> String {
    format!(
        "Review the current workspace from the perspective of {}. Focus on the active work, the main risks, and the next best move.\n\nCurrent writer: {}\nActive agent: {}\nDirty files: {}\nFailing checks: {}\nLatest handoff: {}\nLatest artifact: {}",
        agent_id,
        state.workspace.current_writer,
        state.workspace.active_agent,
        state.workspace.dirty_files,
        state.workspace.failing_checks,
        state
            .handoffs
            .first()
            .map(|item| item.goal.clone())
            .unwrap_or_else(|| "none".to_string()),
        state
            .artifacts
            .first()
            .map(|item| item.summary.clone())
            .unwrap_or_else(|| "none".to_string())
    )
}

/// Builds a rich context prompt including conversation history and cross-agent context
fn compose_context_prompt(
    state: &AppStateDto,
    ctx: &ContextStore,
    agent_id: &str,
    prompt: &str,
) -> String {
    let mut parts = Vec::new();

    // 1. System preamble
    parts.push(format!(
        "You are operating inside Multi CLI Studio.\n\
         Project: {}\n\
         Root: {}\n\
         Branch: {}\n\
         Current writer: {}\n\
         Your role: {}\n\
         Target agent: {}",
        state.workspace.project_name,
        state.workspace.project_root,
        state.workspace.branch,
        state.workspace.current_writer,
        if state.workspace.current_writer == agent_id {
            "writer (can modify files)"
        } else {
            "read-only (planning and review)"
        },
        agent_id,
    ));

    // 2. This agent's recent history
    if let Some(agent_ctx) = ctx.agents.get(agent_id) {
        let recent: Vec<_> = agent_ctx
            .conversation_history
            .iter()
            .rev()
            .take(5)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();

        if !recent.is_empty() {
            parts.push("\n--- Your recent conversation history ---".to_string());
            for turn in &recent {
                parts.push(format!(
                    "User asked: {}\nYou responded: {}",
                    turn.user_prompt, turn.output_summary
                ));
            }
        }
    }

    // 3. Cross-agent context from latest handoff targeting this agent
    if let Some(handoff) = ctx.handoffs.iter().find(|h| h.to == agent_id) {
        parts.push(format!(
            "\n--- Context from previous agent ({}) ---\n\
             Handoff goal: {}\n\
             Git diff at handoff:\n{}",
            handoff.from, handoff.user_goal, handoff.git_diff,
        ));

        if !handoff.changed_files.is_empty() {
            parts.push(format!(
                "Changed files: {}",
                handoff.changed_files.join(", ")
            ));
        }

        let summaries: Vec<_> = handoff
            .previous_turns
            .iter()
            .rev()
            .take(3)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        if !summaries.is_empty() {
            parts.push(format!(
                "Previous agent's last {} turn summaries:",
                summaries.len()
            ));
            for turn in &summaries {
                parts.push(format!(
                    "  - User: {} -> Agent: {}",
                    turn.user_prompt, turn.output_summary
                ));
            }
        }
    }

    // 4. Current workspace state
    parts.push(format!(
        "\n--- Current workspace ---\n\
         Dirty files: {}\n\
         Failing checks: {}\n\
         Last snapshot: {}",
        state.workspace.dirty_files,
        state.workspace.failing_checks,
        state
            .workspace
            .last_snapshot
            .clone()
            .unwrap_or_else(|| "not captured".to_string()),
    ));

    // 5. User request
    parts.push(format!("\n--- User request ---\n{}", prompt));

    parts.join("\n")
}

#[derive(Debug, Clone)]
struct AutoExecutionStepState {
    step: AutoPlanStep,
    status: String,
    summary: Option<String>,
    result: Option<String>,
}

fn auto_plan_fallback(prompt: &str) -> AutoPlan {
    let lowered = prompt.to_ascii_lowercase();
    let owner = if [
        "ui",
        "design",
        "layout",
        "visual",
        "spacing",
        "typography",
        "css",
        "frontend",
    ]
    .iter()
    .any(|needle| lowered.contains(needle))
    {
        "gemini"
    } else {
        "codex"
    };

    AutoPlan {
        goal: prompt.trim().to_string(),
        summary: Some(
            "Fallback plan generated because the Claude planner did not return valid JSON."
                .to_string(),
        ),
        steps: vec![AutoPlanStep {
            id: "step-1".to_string(),
            owner: owner.to_string(),
            title: if owner == "gemini" {
                "Design the requested UI changes".to_string()
            } else {
                "Implement the requested workspace changes".to_string()
            },
            instruction: prompt.trim().to_string(),
            write: true,
        }],
    }
}

fn extract_json_object(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed.to_string());
    }

    if let Some(start) = trimmed.find("```json") {
        let rest = &trimmed[start + 7..];
        if let Some(end) = rest.find("```") {
            return Some(rest[..end].trim().to_string());
        }
    }

    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(trimmed[start..=end].to_string())
}

fn normalize_auto_plan(mut plan: AutoPlan, prompt: &str) -> AutoPlan {
    if plan.goal.trim().is_empty() {
        plan.goal = prompt.trim().to_string();
    }

    let mut normalized_steps = Vec::new();
    for (index, step) in plan.steps.into_iter().take(4).enumerate() {
        let owner = match step.owner.trim().to_ascii_lowercase().as_str() {
            "claude" => "claude",
            "gemini" => "gemini",
            _ => "codex",
        };
        let title = if step.title.trim().is_empty() {
            format!("Step {}", index + 1)
        } else {
            step.title.trim().to_string()
        };
        let instruction = if step.instruction.trim().is_empty() {
            prompt.trim().to_string()
        } else {
            step.instruction.trim().to_string()
        };
        let id = if step.id.trim().is_empty() {
            format!("step-{}", index + 1)
        } else {
            step.id.trim().to_string()
        };
        normalized_steps.push(AutoPlanStep {
            id,
            owner: owner.to_string(),
            title,
            instruction,
            write: step.write,
        });
    }
    plan.steps = normalized_steps;

    if plan.steps.is_empty() {
        return auto_plan_fallback(prompt);
    }

    plan
}

fn parse_auto_plan(text: &str, prompt: &str) -> AutoPlan {
    extract_json_object(text)
        .and_then(|payload| serde_json::from_str::<AutoPlan>(&payload).ok())
        .map(|plan| normalize_auto_plan(plan, prompt))
        .unwrap_or_else(|| auto_plan_fallback(prompt))
}

fn build_auto_plan_prompt(
    state: &AppStateDto,
    storage: &TerminalStorage,
    request: &AutoOrchestrationRequest,
) -> String {
    let mut parts = Vec::new();
    parts.push(compose_tab_context_prompt(
        state,
        storage,
        "claude",
        &request.terminal_tab_id,
        &request.workspace_id,
        &request.project_root,
        &request.project_name,
        &request.prompt,
        &request.recent_turns,
        false,
        None,
        None,
    ));
    parts.push(
        "\n--- Auto orchestration contract ---\n\
         You are the orchestration planner.\n\
         Return JSON only with this exact shape:\n\
         {\"goal\":\"string\",\"summary\":\"string\",\"steps\":[{\"id\":\"step-1\",\"owner\":\"claude|codex|gemini\",\"title\":\"string\",\"instruction\":\"string\",\"write\":true}]}\n\
         Rules:\n\
         - Use Claude for planning, analysis, and synthesis.\n\
         - Use Codex for code changes, commands, debugging, fixes, and validation.\n\
         - Use Gemini only when UI, visual design, layout, styling, or UX is materially involved.\n\
         - Keep the plan to 1-4 steps.\n\
         - Prefer the minimum number of steps.\n\
         - Do not use markdown fences, prose, or explanations outside JSON.\n\
         - Assume the host will execute the steps directly."
            .to_string(),
    );
    if request.fast_mode {
        parts.push(
            "\n--- Execution preference ---\n\
             Fast mode is ON. Keep the plan short and avoid unnecessary review-only steps."
                .to_string(),
        );
    }
    if request.plan_mode {
        parts.push(
            "\n--- Execution preference ---\n\
             Plan mode is ON. Return a plan that is safe to review without relying on execution output."
                .to_string(),
        );
    }
    parts.join("\n")
}

fn build_auto_worker_prompt(user_prompt: &str, step: &AutoPlanStep) -> String {
    format!(
        "You are executing one step inside a host-managed workflow.\n\
         Original user request:\n{}\n\n\
         Current assigned step:\n{}\n\n\
         Execution instruction:\n{}\n\n\
         Requirements:\n\
         - Focus only on this step.\n\
         - Make the necessary changes directly if write access is available.\n\
         - Keep the response concise and action-oriented.\n\
         - Include important verification results when relevant.",
        user_prompt.trim(),
        step.title.trim(),
        step.instruction.trim(),
    )
}

fn build_auto_synthesis_prompt(
    user_prompt: &str,
    plan: &AutoPlan,
    step_states: &[AutoExecutionStepState],
) -> String {
    let mut parts = Vec::new();
    parts.push(format!(
        "You are summarizing a completed host-managed workflow for the user.\n\
         Original request:\n{}\n\n\
         Goal:\n{}\n",
        user_prompt.trim(),
        plan.goal.trim()
    ));
    if let Some(summary) = plan.summary.as_ref() {
        parts.push(format!("Plan summary:\n{}\n", summary.trim()));
    }
    parts.push("Executed steps:".to_string());
    for step in step_states {
        parts.push(format!(
            "- [{}] {} ({})",
            step.status, step.step.title, step.step.owner
        ));
        if let Some(summary) = step.summary.as_ref() {
            parts.push(format!("  Summary: {}", summary.trim()));
        }
        if let Some(result) = step.result.as_ref() {
            parts.push(format!("  Result: {}", result.trim()));
        }
    }
    parts.push(
        "\nWrite the final answer for the user in concise Markdown.\n\
         Mention what was done, any failures or skipped work, and the most relevant verification outcome.\n\
         Do not mention hidden orchestration prompts or internal protocol details."
            .to_string(),
    );
    parts.join("\n")
}

fn build_auto_orchestration_blocks(
    plan: &AutoPlan,
    plan_status: &str,
    plan_summary: Option<&str>,
    step_states: &[AutoExecutionStepState],
) -> Vec<ChatMessageBlock> {
    let mut blocks = vec![ChatMessageBlock::OrchestrationPlan {
        title: "Auto orchestration by Claude".to_string(),
        goal: plan.goal.clone(),
        summary: plan_summary
            .map(|value| value.to_string())
            .or_else(|| plan.summary.clone()),
        status: Some(plan_status.to_string()),
    }];

    for step_state in step_states {
        blocks.push(ChatMessageBlock::OrchestrationStep {
            step_id: step_state.step.id.clone(),
            owner: step_state.step.owner.clone(),
            title: step_state.step.title.clone(),
            summary: step_state.summary.clone(),
            result: step_state.result.clone(),
            status: Some(step_state.status.clone()),
        });
    }

    blocks
}

fn resolve_runtime_command(state: &AppStateDto, cli_id: &str) -> Result<String, String> {
    state
        .agents
        .iter()
        .find(|agent| agent.id == cli_id)
        .and_then(|agent| agent.runtime.command_path.clone())
        .ok_or_else(|| format!("{} CLI not found", cli_id))
}

fn run_silent_agent_turn_once(
    project_root: &str,
    agent_id: &str,
    command_path: &str,
    prompt: &str,
    write_mode: bool,
    session: &acp::AcpSession,
    timeout_ms: u64,
) -> Result<SilentAgentTurnOutcome, String> {
    let resolved_command = resolve_direct_command_path(command_path);
    let args = build_agent_args(agent_id, prompt, write_mode, session)?;
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let mut cmd = batch_aware_command(&resolved_command, &arg_refs);
    cmd.stdin(Stdio::null())
        .current_dir(project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd.spawn().map_err(|err| err.to_string())?;
    let watchdog = start_process_watchdog(child.id(), timeout_ms);
    let output = child.wait_with_output().map_err(|err| err.to_string())?;
    watchdog.store(true, Ordering::SeqCst);

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined = if stderr.trim().is_empty() {
        stdout.clone()
    } else if stdout.trim().is_empty() {
        stderr.clone()
    } else {
        format!("{}\n{}", stdout.trim_end(), stderr.trim_end())
    };

    if output.status.success() {
        Ok(SilentAgentTurnOutcome {
            final_content: stdout.trim().to_string(),
            raw_output: combined.trim().to_string(),
        })
    } else {
        Err(if combined.trim().is_empty() {
            format!("{} exited with {}", agent_id, output.status)
        } else {
            combined.trim().to_string()
        })
    }
}

#[derive(Debug, Clone)]
struct AutomationExecutionOutcome {
    owner_cli: String,
    raw_output: String,
    final_content: String,
    content_format: String,
    summary: String,
    exit_code: Option<i32>,
    blocks: Vec<ChatMessageBlock>,
    transport_session: Option<AgentTransportSession>,
    relevant_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutomationJudgeResponse {
    decision: String,
    reason: String,
    progress_summary: String,
    next_instruction: Option<String>,
    next_owner_cli: Option<String>,
    made_progress: bool,
    expected_outcome_met: bool,
}

fn infer_automation_owner(goal: &AutomationGoal) -> String {
    let text = format!("{}\n{}", goal.title, goal.goal).to_ascii_lowercase();
    if [
        "ui",
        "design",
        "layout",
        "visual",
        "spacing",
        "typography",
        "css",
        "frontend",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        return "gemini".to_string();
    }
    if [
        "review",
        "analyze",
        "analyse",
        "why",
        "reason",
        "tradeoff",
        "architecture",
        "investigate",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        return "claude".to_string();
    }
    "codex".to_string()
}

fn normalize_automation_owner(value: Option<&str>, fallback: &str) -> String {
    match value.unwrap_or(fallback).trim().to_ascii_lowercase().as_str() {
        "claude" => "claude".to_string(),
        "gemini" => "gemini".to_string(),
        _ => "codex".to_string(),
    }
}

fn automation_goal_target_cli(goal: &AutomationGoal) -> String {
    if goal.execution_mode != "auto" {
        return goal.execution_mode.clone();
    }
    infer_automation_owner(goal)
}

fn build_automation_goal_prompt(
    run: &AutomationRun,
    goal: &AutomationGoal,
    profile: &AutomationGoalRuleConfig,
    owner_cli: &str,
    round_index: usize,
    prior_progress: Option<&str>,
    next_instruction: Option<&str>,
) -> String {
    let edit_policy = if profile.allow_safe_workspace_edits {
        "You may edit files inside the workspace when needed."
    } else {
        "Do not modify files. Stay in planning and diagnostics mode."
    };
    let check_policy = if profile.allow_safe_checks {
        "You may run safe validation commands such as tests, build, lint, and typecheck."
    } else {
        "Do not run validation commands unless they are essential to explain a blocker."
    };
    let strategy_policy = if profile.allow_auto_select_strategy {
        "If multiple reasonable approaches exist, choose one and continue without asking."
    } else {
        "If multiple approaches exist and the choice is material, stop and explain the decision point."
    };
    let parameter_summary = if run.parameter_values.is_empty() {
        "No run parameters were provided.".to_string()
    } else {
        run.parameter_values
            .iter()
            .map(|(key, value)| format!("- {}: {}", key, display_parameter_value(value)))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        "You are executing an unattended automation goal inside Multi CLI Studio.\n\
         Project: {}\n\
         Automation job: {}\n\
         Goal title: {}\n\n\
         Round: {} of {}\n\
         Current owner CLI: {}\n\n\
         Permission profile: {}\n\n\
         Run parameters:\n{}\n\n\
         Primary goal:\n{}\n\n\
         Expected outcome:\n{}\n\n\
         Prior progress summary:\n{}\n\n\
         Current step instruction:\n{}\n\n\
         Autonomy contract:\n\
         - Work end-to-end without asking the user for routine confirmation.\n\
         - {}\n\
         - {}\n\
         - {}\n\
         - Avoid destructive actions or anything that would reasonably need human approval.\n\
         - If blocked by a real external dependency, missing credential, or risky operation, state that clearly.\n\
         - Finish with a concise summary of what changed, what was verified, and any residual risk.",
        run.project_name.trim(),
        run.job_name.as_deref().unwrap_or(run.project_name.trim()),
        goal.title.trim(),
        round_index,
        profile.max_rounds_per_goal,
        owner_cli,
        run.permission_profile.trim(),
        parameter_summary,
        goal.goal.trim(),
        goal.expected_outcome.trim(),
        prior_progress.unwrap_or("No prior progress has been recorded yet."),
        next_instruction.unwrap_or("Drive the goal toward the expected outcome using the best available path."),
        strategy_policy,
        edit_policy,
        check_policy,
    )
}

fn detect_automation_rule_pause_reason(
    text: &str,
    profile: &AutomationGoalRuleConfig,
) -> Option<String> {
    let normalized = text.to_ascii_lowercase();
    if profile.pause_on_credentials
        && [
            "requires credentials",
            "login required",
            "api key",
            "token required",
            "permission denied",
            "authentication",
            "sign in",
        ]
        .iter()
        .any(|needle| normalized.contains(needle))
    {
        return Some("Paused because credentials or authentication are required.".to_string());
    }

    if profile.pause_on_external_installs
        && [
            "npm install",
            "pnpm install",
            "yarn install",
            "cargo add",
            "pip install",
            "brew install",
            "apt install",
            "dependency is missing",
        ]
        .iter()
        .any(|needle| normalized.contains(needle))
    {
        return Some("Paused because the run appears to need installing or changing external dependencies.".to_string());
    }

    if profile.pause_on_destructive_commands
        && [
            "git reset --hard",
            "rm -rf",
            "remove-item -recurse -force",
            "del /f",
            "drop database",
            "truncate table",
        ]
        .iter()
        .any(|needle| normalized.contains(needle))
    {
        return Some("Paused because a destructive command pattern was detected.".to_string());
    }

    if profile.pause_on_git_push
        && ["git push", "force push", "push --force"]
            .iter()
            .any(|needle| normalized.contains(needle))
    {
        return Some("Paused because the run appears ready to push changes to a remote.".to_string());
    }

    if !profile.allow_auto_select_strategy
        && [
            "need your confirmation",
            "please confirm",
            "which option",
            "choose one",
            "which approach",
            "pick a strategy",
            "manual intervention",
        ]
        .iter()
        .any(|needle| normalized.contains(needle))
    {
        return Some("Paused because the CLI surfaced a material decision point and auto-selection is disabled.".to_string());
    }

    None
}

fn resolution_code_for_pause_reason(reason: &str) -> String {
    let lowered = reason.to_ascii_lowercase();
    if lowered.contains("credential") || lowered.contains("authentication") {
        "credentials_required".to_string()
    } else if lowered.contains("install") || lowered.contains("dependency") {
        "external_install_required".to_string()
    } else if lowered.contains("destructive") {
        "destructive_command_blocked".to_string()
    } else if lowered.contains("push") {
        "git_push_blocked".to_string()
    } else if lowered.contains("manual") {
        "manual_pause_requested".to_string()
    } else {
        "judge_requested_pause".to_string()
    }
}

fn build_automation_judge_prompt(
    run: &AutomationRun,
    goal: &AutomationGoal,
    profile: &AutomationGoalRuleConfig,
    owner_cli: &str,
    round_index: usize,
    raw_output: &str,
    exit_code: Option<i32>,
) -> String {
    let clipped_output = truncate_automation_text(raw_output, 4000);
    format!(
        "You are the unattended automation adjudicator for Multi CLI Studio.\n\
         Return JSON only with this exact shape:\n\
         {{\"decision\":\"complete|continue|pause|fail\",\"reason\":\"string\",\"progressSummary\":\"string\",\"nextInstruction\":\"string|null\",\"nextOwnerCli\":\"codex|claude|gemini|null\",\"madeProgress\":true,\"expectedOutcomeMet\":false}}\n\n\
         Project: {}\n\
         Goal title: {}\n\
         Goal:\n{}\n\n\
         Expected outcome:\n{}\n\n\
         Rule profile:\n\
         - auto strategy: {}\n\
         - workspace edits: {}\n\
         - safe checks: {}\n\
         - pause on credentials: {}\n\
         - pause on installs: {}\n\
         - pause on destructive commands: {}\n\
         - pause on git push: {}\n\
         - max rounds per goal: {}\n\
         - max consecutive failures: {}\n\
         - max no-progress rounds: {}\n\n\
         Current round: {}\n\
         Current owner CLI: {}\n\
         Exit code: {}\n\n\
         Latest CLI output:\n{}\n\n\
         Decision rules:\n\
         - choose complete only if the expected outcome is substantially met.\n\
         - choose continue only if unattended progress should continue in another round.\n\
         - choose pause if human attention is required or a rule boundary should stop execution.\n\
         - choose fail if the goal is not realistically progressing and should stop for this batch.\n\
         - keep progressSummary concise and factual.\n\
         - nextInstruction should tell the next round exactly what to do next.\n\
         - nextOwnerCli may switch between codex, claude, and gemini when appropriate.\n\
         - madeProgress should be false if the latest round mostly repeated prior work or ended without material advancement.",
        run.project_name,
        goal.title,
        goal.goal,
        goal.expected_outcome,
        profile.allow_auto_select_strategy,
        profile.allow_safe_workspace_edits,
        profile.allow_safe_checks,
        profile.pause_on_credentials,
        profile.pause_on_external_installs,
        profile.pause_on_destructive_commands,
        profile.pause_on_git_push,
        profile.max_rounds_per_goal,
        profile.max_consecutive_failures,
        profile.max_no_progress_rounds,
        round_index,
        owner_cli,
        exit_code
            .map(|value| value.to_string())
            .unwrap_or_else(|| "null".to_string()),
        clipped_output,
    )
}

fn truncate_automation_text(text: &str, max_chars: usize) -> String {
    let normalized = text.replace('\n', " ");
    let trimmed = normalized.trim();
    if trimmed.len() <= max_chars {
        trimmed.to_string()
    } else {
        let mut value = trimmed[..max_chars].to_string();
        value.push('…');
        value
    }
}

fn fallback_automation_judge_response(
    goal: &AutomationGoal,
    owner_cli: &str,
    raw_output: &str,
    exit_code: Option<i32>,
) -> AutomationJudgeResponse {
    let normalized = raw_output.to_ascii_lowercase();
    let expected = goal.expected_outcome.to_ascii_lowercase();
    let expected_tokens = expected
        .split_whitespace()
        .filter(|token| token.len() > 3)
        .collect::<Vec<_>>();
    let matched_tokens = expected_tokens
        .iter()
        .filter(|token| normalized.contains(**token))
        .count();
    let likely_complete = !expected_tokens.is_empty()
        && matched_tokens >= usize::max(1, expected_tokens.len() / 2)
        && exit_code == Some(0);

    if likely_complete {
        return AutomationJudgeResponse {
            decision: "continue".to_string(),
            reason: "Fallback heuristic found evidence but not enough confidence to mark complete, continuing.".to_string(),
            progress_summary: display_summary(raw_output),
            next_instruction: None,
            next_owner_cli: Some(owner_cli.to_string()),
            made_progress: true,
            expected_outcome_met: false,
        };
    }

    if exit_code == Some(0) {
        return AutomationJudgeResponse {
            decision: "continue".to_string(),
            reason: "Fallback heuristic saw successful output but not enough evidence of completion.".to_string(),
            progress_summary: display_summary(raw_output),
            next_instruction: Some("Continue the goal, verify the expected outcome directly, and close remaining gaps.".to_string()),
            next_owner_cli: Some(owner_cli.to_string()),
            made_progress: true,
            expected_outcome_met: false,
        };
    }

    AutomationJudgeResponse {
        decision: "fail".to_string(),
        reason: "Fallback heuristic judged the latest round as failed.".to_string(),
        progress_summary: display_summary(raw_output),
        next_instruction: None,
        next_owner_cli: Some(owner_cli.to_string()),
        made_progress: false,
        expected_outcome_met: false,
    }
}

fn normalize_automation_judge_response(
    response: AutomationJudgeResponse,
    owner_cli: &str,
) -> AutomationJudgeResponse {
    let decision = match response.decision.trim().to_ascii_lowercase().as_str() {
        "complete" => "complete",
        "pause" => "pause",
        "fail" => "fail",
        _ => "continue",
    }
    .to_string();

    AutomationJudgeResponse {
        decision,
        reason: if response.reason.trim().is_empty() {
            "No decision rationale provided.".to_string()
        } else {
            response.reason.trim().to_string()
        },
        progress_summary: if response.progress_summary.trim().is_empty() {
            "No progress summary provided.".to_string()
        } else {
            response.progress_summary.trim().to_string()
        },
        next_instruction: response
            .next_instruction
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        next_owner_cli: Some(normalize_automation_owner(
            response.next_owner_cli.as_deref(),
            owner_cli,
        )),
        made_progress: response.made_progress,
        expected_outcome_met: response.expected_outcome_met,
    }
}

fn evaluate_automation_round(
    state_snapshot: &AppStateDto,
    settings_arc: &Arc<Mutex<AppSettings>>,
    run: &AutomationRun,
    goal: &AutomationGoal,
    profile: &AutomationGoalRuleConfig,
    owner_cli: &str,
    round_index: usize,
    raw_output: &str,
    exit_code: Option<i32>,
) -> AutomationJudgeResponse {
    let wrapper_path = match resolve_runtime_command(state_snapshot, "claude") {
        Ok(path) => path,
        Err(_) => {
            return fallback_automation_judge_response(goal, owner_cli, raw_output, exit_code);
        }
    };
    let timeout_ms = settings_arc
        .lock()
        .map(|settings| settings.process_timeout_ms)
        .unwrap_or(DEFAULT_TIMEOUT_MS);

    let mut judge_session = acp::AcpSession::default();
    judge_session.plan_mode = true;

    let prompt = build_automation_judge_prompt(
        run,
        goal,
        profile,
        owner_cli,
        round_index,
        raw_output,
        exit_code,
    );
    let result = run_silent_agent_turn_once(
        &run.project_root,
        "claude",
        &wrapper_path,
        &prompt,
        false,
        &judge_session,
        timeout_ms,
    );

    match result {
        Ok(outcome) => {
            let source = if outcome.final_content.trim().is_empty() {
                outcome.raw_output
            } else {
                outcome.final_content
            };
            extract_json_object(&source)
                .and_then(|payload| serde_json::from_str::<AutomationJudgeResponse>(&payload).ok())
                .map(|value| normalize_automation_judge_response(value, owner_cli))
                .unwrap_or_else(|| fallback_automation_judge_response(goal, owner_cli, &source, exit_code))
        }
        Err(_) => fallback_automation_judge_response(goal, owner_cli, raw_output, exit_code),
    }
}

fn execute_auto_mode_goal(
    app: &AppHandle,
    state_snapshot: &AppStateDto,
    _settings_arc: &Arc<Mutex<AppSettings>>,
    terminal_storage: &TerminalStorage,
    claude_approval_rules: &Arc<Mutex<ClaudeApprovalRules>>,
    claude_pending_approvals: &Arc<Mutex<BTreeMap<String, PendingClaudeApproval>>>,
    codex_pending_approvals: &Arc<Mutex<BTreeMap<String, PendingCodexApproval>>>,
    run: &AutomationRun,
    goal: &AutomationGoal,
    automation_prompt: &str,
    timeout_ms: u64,
) -> AutomationExecutionOutcome {
    let claude_wrapper_path = match resolve_runtime_command(state_snapshot, "claude") {
        Ok(path) => path,
        Err(error) => {
            return AutomationExecutionOutcome {
                owner_cli: "claude".to_string(),
                raw_output: error.clone(),
                final_content: error.clone(),
                content_format: "log".to_string(),
                summary: error,
                exit_code: Some(1),
                blocks: vec![ChatMessageBlock::Status {
                    level: "error".to_string(),
                    text: "Automation planner runtime unavailable.".to_string(),
                }],
                transport_session: None,
                relevant_files: Vec::new(),
            };
        }
    };

    let recent_turns = terminal_storage
        .load_prompt_turns_for_terminal_tab(&goal.synthetic_terminal_tab_id, "claude", 4)
        .unwrap_or_default()
        .into_iter()
        .map(|turn| ChatContextTurn {
            cli_id: turn.cli_id,
            user_prompt: turn.user_prompt,
            assistant_reply: turn.assistant_reply,
            timestamp: turn.timestamp,
        })
        .collect::<Vec<_>>();

    let request = AutoOrchestrationRequest {
        terminal_tab_id: goal.synthetic_terminal_tab_id.clone(),
        workspace_id: run.workspace_id.clone(),
        assistant_message_id: create_id("auto-msg"),
        prompt: automation_prompt.to_string(),
        project_root: run.project_root.clone(),
        project_name: run.project_name.clone(),
        recent_turns,
        plan_mode: false,
        fast_mode: false,
        effort_level: None,
        model_overrides: BTreeMap::new(),
        permission_overrides: BTreeMap::new(),
    };

    let mut planner_session = acp::AcpSession::default();
    planner_session.plan_mode = true;
    let planner_prompt = build_auto_plan_prompt(state_snapshot, terminal_storage, &request);
    let planner_result = run_silent_agent_turn_once(
        &request.project_root,
        "claude",
        &claude_wrapper_path,
        &planner_prompt,
        false,
        &planner_session,
        timeout_ms,
    );

    let plan = match planner_result {
        Ok(outcome) => {
            let source = if outcome.final_content.trim().is_empty() {
                outcome.raw_output.as_str()
            } else {
                outcome.final_content.as_str()
            };
            parse_auto_plan(source, &request.prompt)
        }
        Err(_) => auto_plan_fallback(&request.prompt),
    };

    let mut step_states: Vec<AutoExecutionStepState> = plan
        .steps
        .iter()
        .cloned()
        .map(|step| AutoExecutionStepState {
            step,
            status: "planned".to_string(),
            summary: None,
            result: None,
        })
        .collect();

    let mut encountered_failure = false;
    let mut collected_files = BTreeSet::new();

    for index in 0..step_states.len() {
        if encountered_failure {
            step_states[index].status = "skipped".to_string();
            step_states[index].summary = Some("Skipped because an earlier step failed.".to_string());
            continue;
        }

        let step = step_states[index].step.clone();
        let wrapper_path = match resolve_runtime_command(state_snapshot, &step.owner) {
            Ok(path) => path,
            Err(error) => {
                step_states[index].status = "failed".to_string();
                step_states[index].summary = Some("CLI runtime is unavailable.".to_string());
                step_states[index].result = Some(error);
                encountered_failure = true;
                continue;
            }
        };

        let mut worker_session = acp::AcpSession::default();
        worker_session.plan_mode = !step.write;
        worker_session.permission_mode.insert(
            step.owner.clone(),
            automation_permission_mode_for_cli(&run.permission_profile, &step.owner, step.write),
        );

        let worker_prompt = compose_tab_context_prompt(
            state_snapshot,
            terminal_storage,
            &step.owner,
            &request.terminal_tab_id,
            &request.workspace_id,
            &request.project_root,
            &request.project_name,
            &build_auto_worker_prompt(&request.prompt, &step),
            &request.recent_turns,
            step.write,
            None,
            None,
        );

        let message_id = create_id("auto-step");
        let worker_result = if step.owner == "codex" {
            run_codex_app_server_turn(
                app,
                &wrapper_path,
                &request.project_root,
                &worker_prompt,
                &[],
                &worker_session,
                None,
                &request.terminal_tab_id,
                &message_id,
                step.write,
                codex_pending_approvals.clone(),
                Vec::new(),
            )
            .map(|outcome| (outcome.raw_output, outcome.final_content, outcome.exit_code, outcome.blocks))
        } else if step.owner == "gemini" {
            run_gemini_acp_turn(
                app,
                &wrapper_path,
                &request.project_root,
                &worker_prompt,
                &worker_session,
                None,
                &request.terminal_tab_id,
                &message_id,
                step.write,
                timeout_ms,
                Vec::new(),
            )
            .map(|outcome| (outcome.raw_output, outcome.final_content, outcome.exit_code, outcome.blocks))
        } else {
            run_claude_headless_turn(
                app,
                &wrapper_path,
                &request.project_root,
                &worker_prompt,
                &worker_session,
                None,
                &request.terminal_tab_id,
                &message_id,
                step.write,
                timeout_ms,
                claude_approval_rules.clone(),
                claude_pending_approvals.clone(),
            )
            .map(|outcome| (outcome.raw_output, outcome.final_content, outcome.exit_code, outcome.blocks))
        };

        match worker_result {
            Ok((raw_output, final_content, _exit_code, blocks)) => {
                for file in collect_relevant_files_from_blocks(&blocks) {
                    collected_files.insert(file);
                }
                let summary = display_summary(if raw_output.trim().is_empty() {
                    &final_content
                } else {
                    &raw_output
                });
                step_states[index].status = "completed".to_string();
                step_states[index].summary = Some("Step completed.".to_string());
                step_states[index].result = Some(summary);
            }
            Err(error) => {
                step_states[index].status = "failed".to_string();
                step_states[index].summary = Some("Step failed.".to_string());
                step_states[index].result = Some(display_summary(&error));
                encountered_failure = true;
            }
        }
    }

    let mut synthesis_session = acp::AcpSession::default();
    synthesis_session.plan_mode = true;
    let synthesis_prompt = build_auto_synthesis_prompt(&request.prompt, &plan, &step_states);
    let synthesized = run_silent_agent_turn_once(
        &request.project_root,
        "claude",
        &claude_wrapper_path,
        &synthesis_prompt,
        false,
        &synthesis_session,
        timeout_ms,
    )
    .ok()
    .map(|outcome| {
        if outcome.final_content.trim().is_empty() {
            outcome.raw_output
        } else {
            outcome.final_content
        }
    });

    let fallback_summary = {
        let mut lines = Vec::new();
        lines.push(if encountered_failure {
            "本轮自动模式执行包含失败步骤。".to_string()
        } else {
            "本轮自动模式执行完成。".to_string()
        });
        lines.push(String::new());
        for step in &step_states {
            lines.push(format!("- {} [{}]", step.step.title, step.status));
            if let Some(result) = step.result.as_ref() {
                lines.push(format!("  {}", result));
            }
        }
        lines.join("\n")
    };

    let final_content = synthesized.unwrap_or(fallback_summary);
    let mut blocks = vec![ChatMessageBlock::OrchestrationPlan {
        title: "Auto orchestration".to_string(),
        goal: plan.goal.clone(),
        summary: plan.summary.clone(),
        status: Some(if encountered_failure {
            "failed".to_string()
        } else {
            "completed".to_string()
        }),
    }];
    blocks.extend(step_states.iter().map(|step| ChatMessageBlock::OrchestrationStep {
        step_id: step.step.id.clone(),
        owner: step.step.owner.clone(),
        title: step.step.title.clone(),
        summary: step.summary.clone(),
        result: step.result.clone(),
        status: Some(step.status.clone()),
    }));
    AutomationExecutionOutcome {
        owner_cli: "claude".to_string(),
        raw_output: final_content.clone(),
        final_content: final_content.clone(),
        content_format: "log".to_string(),
        summary: display_summary(&final_content),
        exit_code: Some(if encountered_failure { 1 } else { 0 }),
        blocks,
        transport_session: None,
        relevant_files: collected_files.into_iter().collect(),
    }
}

fn notify_automation_event(app: &AppHandle, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

fn summarize_automation_run(run: &AutomationRun) -> String {
    let completed = run.goals.iter().filter(|goal| goal.status == "completed").count();
    let failed = run.goals.iter().filter(|goal| goal.status == "failed").count();
    let paused = run.goals.iter().filter(|goal| goal.status == "paused").count();
    let total = run.goals.len();
    format!(
        "{} of {} completed • {} failed • {} paused",
        completed, total, failed, paused
    )
}

// ── Webhook notification structs ────────────────────────────────────────────

#[derive(Serialize)]
struct WebhookGoalInfo {
    title: String,
    status: String,
    round_count: usize,
}

#[derive(Serialize)]
struct WebhookRunInfo {
    id: String,
    project_name: String,
    status: String,
    summary: Option<String>,
    completed_at: Option<String>,
    goals: Vec<WebhookGoalInfo>,
}

#[derive(Serialize)]
struct WebhookPayload {
    event: String,
    timestamp: String,
    run: WebhookRunInfo,
}

fn send_webhook_notification(url: &str, payload: &WebhookPayload) {
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = client.post(url).json(payload).send();
}

fn send_email_notification(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    from: &str,
    recipients: &[String],
    subject: &str,
    body: &str,
) -> Result<(), String> {
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Message, SmtpTransport, Transport};

    let credentials = Credentials::new(username.to_string(), password.to_string());

    // Use relay() which handles STARTTLS automatically on port 587
    let mailer = SmtpTransport::relay(host)
        .map_err(|e| e.to_string())?
        .port(port)
        .credentials(credentials)
        .build();

    let to_addrs = recipients
        .iter()
        .map(|r| r.as_str())
        .collect::<Vec<_>>()
        .join(", ");

    let email = Message::builder()
        .from(from.parse().map_err(|e: lettre::address::AddressError| e.to_string())?)
        .to(to_addrs.parse().map_err(|e: lettre::address::AddressError| e.to_string())?)
        .subject(subject)
        .body(String::from(body))
        .map_err(|e| e.to_string())?;

    mailer.send(&email).map_err(|e| e.to_string())?;
    Ok(())
}

fn schedule_automation_run(app: AppHandle, store: &State<'_, AppStore>, run_id: String) {
    schedule_automation_run_with_handles(
        app,
        store.state.clone(),
        store.context.clone(),
        store.settings.clone(),
        store.terminal_storage.clone(),
        store.claude_approval_rules.clone(),
        store.claude_pending_approvals.clone(),
        store.codex_pending_approvals.clone(),
        store.automation_runs.clone(),
        store.automation_active_runs.clone(),
        run_id,
    );
}

fn schedule_automation_run_with_handles(
    app: AppHandle,
    state_arc: Arc<Mutex<AppStateDto>>,
    context_arc: Arc<Mutex<ContextStore>>,
    settings_arc: Arc<Mutex<AppSettings>>,
    terminal_storage: TerminalStorage,
    claude_approval_rules: Arc<Mutex<ClaudeApprovalRules>>,
    claude_pending_approvals: Arc<Mutex<BTreeMap<String, PendingClaudeApproval>>>,
    codex_pending_approvals: Arc<Mutex<BTreeMap<String, PendingCodexApproval>>>,
    automation_runs: Arc<Mutex<Vec<AutomationRun>>>,
    active_runs: Arc<Mutex<BTreeSet<String>>>,
    run_id: String,
) {
    thread::spawn(move || {
        let scheduled_start_at = {
            let runs = match automation_runs.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            let Some(run) = runs.iter().find(|item| item.id == run_id) else {
                return;
            };
            if run.status != "scheduled" {
                return;
            }
            run.scheduled_start_at.clone()
        };

        if let Some(start_at) = scheduled_start_at {
            if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&start_at) {
                let wait_ms = (parsed.timestamp_millis() - Local::now().timestamp_millis()).max(0);
                if wait_ms > 0 {
                    thread::sleep(Duration::from_millis(wait_ms as u64));
                }
            }
        }

        {
            let mut active = match active_runs.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            if !active.insert(run_id.clone()) {
                return;
            }
        }

        execute_automation_run_loop(
            &app,
            &state_arc,
            &context_arc,
            &settings_arc,
            &terminal_storage,
            &claude_approval_rules,
            &claude_pending_approvals,
            &codex_pending_approvals,
            &automation_runs,
            &run_id,
        );

        if let Ok(mut active) = active_runs.lock() {
            active.remove(&run_id);
        }
    });
}

fn schedule_existing_automation_runs(
    app: AppHandle,
    state_arc: Arc<Mutex<AppStateDto>>,
    context_arc: Arc<Mutex<ContextStore>>,
    settings_arc: Arc<Mutex<AppSettings>>,
    terminal_storage: TerminalStorage,
    claude_approval_rules: Arc<Mutex<ClaudeApprovalRules>>,
    claude_pending_approvals: Arc<Mutex<BTreeMap<String, PendingClaudeApproval>>>,
    codex_pending_approvals: Arc<Mutex<BTreeMap<String, PendingCodexApproval>>>,
    automation_runs: Arc<Mutex<Vec<AutomationRun>>>,
    active_runs: Arc<Mutex<BTreeSet<String>>>,
) {
    let run_ids = match automation_runs.lock() {
        Ok(guard) => guard
            .iter()
            .filter(|run| run.status == "scheduled")
            .map(|run| run.id.clone())
            .collect::<Vec<_>>(),
        Err(_) => return,
    };

    for run_id in run_ids {
        schedule_automation_run_with_handles(
            app.clone(),
            state_arc.clone(),
            context_arc.clone(),
            settings_arc.clone(),
            terminal_storage.clone(),
            claude_approval_rules.clone(),
            claude_pending_approvals.clone(),
            codex_pending_approvals.clone(),
            automation_runs.clone(),
            active_runs.clone(),
            run_id,
        );
    }
}

fn create_automation_run_from_job_with_handles(
    app: AppHandle,
    state_arc: Arc<Mutex<AppStateDto>>,
    context_arc: Arc<Mutex<ContextStore>>,
    settings_arc: Arc<Mutex<AppSettings>>,
    terminal_storage: TerminalStorage,
    claude_approval_rules: Arc<Mutex<ClaudeApprovalRules>>,
    claude_pending_approvals: Arc<Mutex<BTreeMap<String, PendingClaudeApproval>>>,
    codex_pending_approvals: Arc<Mutex<BTreeMap<String, PendingCodexApproval>>>,
    automation_jobs: Arc<Mutex<Vec<AutomationJob>>>,
    automation_runs: Arc<Mutex<Vec<AutomationRun>>>,
    active_runs: Arc<Mutex<BTreeSet<String>>>,
    mut request: CreateAutomationRunFromJobRequest,
    trigger_source: &str,
) -> Result<AutomationRunRecord, String> {
    request.scheduled_start_at = normalize_scheduled_start_at(request.scheduled_start_at.clone());
    if trigger_source == "manual" {
        if let Some(start_at) = request.scheduled_start_at.as_ref() {
            if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(start_at) {
                if parsed.timestamp_millis() <= Local::now().timestamp_millis() + 1000 {
                    return Err("Scheduled start time must be in the future.".to_string());
                }
            } else {
                return Err("Scheduled start time is invalid.".to_string());
            }
        }
    }

    let job = automation_jobs
        .lock()
        .map_err(|err| err.to_string())?
        .iter()
        .find(|item| item.id == request.job_id && item.enabled)
        .cloned()
        .ok_or_else(|| "Automation job not found or disabled.".to_string())?;

    let run = {
        let mut runs = automation_runs.lock().map_err(|err| err.to_string())?;
        let run_number = runs
            .iter()
            .filter(|item| item.job_id.as_deref() == Some(job.id.as_str()))
            .filter_map(|item| item.run_number)
            .max()
            .unwrap_or(0)
            + 1;
        let mut run = build_run_from_job(&job, request, run_number);
        run.trigger_source = Some(trigger_source.to_string());
        if trigger_source == "cron" {
            push_event(
                &mut run,
                None,
                "info",
                "Run triggered",
                "The automation job was triggered by its cron schedule.",
            );
        }
        runs.insert(0, run.clone());
        persist_automation_runs_to_disk(&runs)?;
        run
    };

    schedule_automation_run_with_handles(
        app,
        state_arc,
        context_arc,
        settings_arc,
        terminal_storage,
        claude_approval_rules,
        claude_pending_approvals,
        codex_pending_approvals,
        automation_runs,
        active_runs,
        run.id.clone(),
    );

    Ok(automation_run_record(&run))
}

fn schedule_cron_automation_jobs(
    app: AppHandle,
    state_arc: Arc<Mutex<AppStateDto>>,
    context_arc: Arc<Mutex<ContextStore>>,
    settings_arc: Arc<Mutex<AppSettings>>,
    terminal_storage: TerminalStorage,
    claude_approval_rules: Arc<Mutex<ClaudeApprovalRules>>,
    claude_pending_approvals: Arc<Mutex<BTreeMap<String, PendingClaudeApproval>>>,
    codex_pending_approvals: Arc<Mutex<BTreeMap<String, PendingCodexApproval>>>,
    automation_jobs: Arc<Mutex<Vec<AutomationJob>>>,
    automation_runs: Arc<Mutex<Vec<AutomationRun>>>,
    active_runs: Arc<Mutex<BTreeSet<String>>>,
) {
    thread::spawn(move || loop {
        let due_job_ids = {
            let now = Local::now();
            let mut due = Vec::new();
            let mut changed = false;
            let mut jobs = match automation_jobs.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };

            for job in jobs.iter_mut() {
                if !job.enabled {
                    continue;
                }
                let Some(cron_expression) = job.cron_expression.as_deref() else {
                    continue;
                };
                let Ok(schedule) = Schedule::from_str(cron_expression) else {
                    continue;
                };

                let anchor = job
                    .last_triggered_at
                    .as_deref()
                    .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                    .map(|value| value.with_timezone(&Local))
                    .or_else(|| {
                        chrono::DateTime::parse_from_rfc3339(&job.created_at)
                            .ok()
                            .map(|value| value.with_timezone(&Local))
                    })
                    .unwrap_or_else(|| now - chrono::Duration::minutes(1));

                if let Some(next_fire) = schedule.after(&anchor).next() {
                    if next_fire <= now {
                        job.last_triggered_at = Some(next_fire.to_rfc3339());
                        job.updated_at = now.to_rfc3339();
                        due.push(job.id.clone());
                        changed = true;
                    }
                }
            }

            if changed {
                let _ = persist_automation_jobs_to_disk(&jobs);
            }
            due
        };

        for job_id in due_job_ids {
            let _ = create_automation_run_from_job_with_handles(
                app.clone(),
                state_arc.clone(),
                context_arc.clone(),
                settings_arc.clone(),
                terminal_storage.clone(),
                claude_approval_rules.clone(),
                claude_pending_approvals.clone(),
                codex_pending_approvals.clone(),
                automation_jobs.clone(),
                automation_runs.clone(),
                active_runs.clone(),
                CreateAutomationRunFromJobRequest {
                    job_id,
                    scheduled_start_at: Some(Local::now().to_rfc3339()),
                    execution_mode: None,
                    parameter_values: BTreeMap::new(),
                },
                "cron",
            );
        }

        thread::sleep(Duration::from_secs(15));
    });
}

fn execute_automation_goal(
    app: &AppHandle,
    state_arc: &Arc<Mutex<AppStateDto>>,
    settings_arc: &Arc<Mutex<AppSettings>>,
    terminal_storage: &TerminalStorage,
    claude_approval_rules: &Arc<Mutex<ClaudeApprovalRules>>,
    claude_pending_approvals: &Arc<Mutex<BTreeMap<String, PendingClaudeApproval>>>,
    codex_pending_approvals: &Arc<Mutex<BTreeMap<String, PendingCodexApproval>>>,
    run: &AutomationRun,
    goal: &AutomationGoal,
    profile: &AutomationGoalRuleConfig,
    owner_cli: &str,
    round_index: usize,
    prior_progress: Option<&str>,
    next_instruction: Option<&str>,
) -> AutomationExecutionOutcome {
    let timeout_ms = settings_arc
        .lock()
        .map(|settings| settings.process_timeout_ms)
        .unwrap_or(DEFAULT_TIMEOUT_MS);

    let mut state_snapshot = state_arc
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|_| seed_state(&run.project_root));
    state_snapshot.workspace.project_root = run.project_root.clone();
    state_snapshot.workspace.project_name = run.project_name.clone();
    state_snapshot.workspace.branch = git_output(&run.project_root, &["branch", "--show-current"])
        .unwrap_or_else(|| "workspace".to_string());
    sync_agent_runtime(&mut state_snapshot);

    let wrapper_path = match resolve_runtime_command(&state_snapshot, &owner_cli) {
        Ok(path) => path,
        Err(error) => {
            return AutomationExecutionOutcome {
                owner_cli: owner_cli.to_string(),
                raw_output: error.clone(),
                final_content: error.clone(),
                content_format: "log".to_string(),
                summary: error,
                exit_code: Some(1),
                blocks: vec![ChatMessageBlock::Status {
                    level: "error".to_string(),
                    text: "CLI runtime unavailable.".to_string(),
                }],
                transport_session: None,
                relevant_files: Vec::new(),
            }
        }
    };

    let recent_turns = terminal_storage
        .load_prompt_turns_for_terminal_tab(&goal.synthetic_terminal_tab_id, &owner_cli, 4)
        .unwrap_or_default()
        .into_iter()
        .map(|turn| ChatContextTurn {
            cli_id: turn.cli_id,
            user_prompt: turn.user_prompt,
            assistant_reply: turn.assistant_reply,
            timestamp: turn.timestamp,
        })
        .collect::<Vec<_>>();

    let mut session = acp::AcpSession::default();
    session.plan_mode = false;
    session.permission_mode.insert(
        owner_cli.to_string(),
        automation_permission_mode_for_cli(&run.permission_profile, owner_cli, true),
    );

    let message_id = create_id("auto-msg");
    let automation_prompt = build_automation_goal_prompt(
        run,
        goal,
        profile,
        owner_cli,
        round_index,
        prior_progress,
        next_instruction,
    );
    let _ = append_automation_turn_seed(
        terminal_storage,
        run,
        goal,
        owner_cli,
        &automation_prompt,
        &message_id,
    );

    if goal.execution_mode == "auto" {
        let outcome = execute_auto_mode_goal(
            app,
            &state_snapshot,
            settings_arc,
            terminal_storage,
            claude_approval_rules,
            claude_pending_approvals,
            codex_pending_approvals,
            run,
            goal,
            &automation_prompt,
            timeout_ms,
        );
        let _ = finalize_automation_turn_message(terminal_storage, goal, &message_id, &outcome);
        return outcome;
    }

    let (prompt_for_context, selected_codex_skills, selected_claude_skill) = match owner_cli {
        "codex" => {
            let (runtime_prompt, selected_skills) =
                resolve_codex_prompt_and_skills(app, &wrapper_path, &run.project_root, &automation_prompt);
            (runtime_prompt, selected_skills, None)
        }
        "claude" => {
            let (runtime_prompt, selected_skill) =
                resolve_claude_prompt_and_skill(&run.project_root, &automation_prompt);
            (runtime_prompt, Vec::new(), selected_skill)
        }
        _ => (automation_prompt, Vec::new(), None),
    };

    let composed_prompt_base = compose_tab_context_prompt(
        &state_snapshot,
        terminal_storage,
        &owner_cli,
        &goal.synthetic_terminal_tab_id,
        &run.workspace_id,
        &run.project_root,
        &run.project_name,
        &prompt_for_context,
        &recent_turns,
        profile.allow_safe_workspace_edits,
        None,
        None,
    );
    let composed_prompt = if let Some(skill) = selected_claude_skill.as_ref() {
        format!("/{} {}", skill.name, composed_prompt_base)
    } else {
        composed_prompt_base
    };

    let before_files = get_git_panel(run.project_root.clone())
        .map(|panel| panel.recent_changes.into_iter().map(|change| change.path).collect::<BTreeSet<_>>())
        .unwrap_or_default();

    let execution = match owner_cli {
        "codex" => run_codex_app_server_turn(
            app,
            &wrapper_path,
            &run.project_root,
            &composed_prompt,
            &selected_codex_skills,
            &session,
            None,
            &goal.synthetic_terminal_tab_id,
            &message_id,
            true,
            codex_pending_approvals.clone(),
            Vec::new(),
        )
        .map(|outcome| (
            outcome.raw_output,
            outcome.final_content,
            outcome.content_format,
            outcome.exit_code,
            outcome.blocks,
            Some(outcome.transport_session),
        )),
        "claude" => run_claude_headless_turn(
            app,
            &wrapper_path,
            &run.project_root,
            &composed_prompt,
            &session,
            None,
            &goal.synthetic_terminal_tab_id,
            &message_id,
            true,
            timeout_ms,
            claude_approval_rules.clone(),
            claude_pending_approvals.clone(),
        )
        .map(|outcome| (
            outcome.raw_output,
            outcome.final_content,
            outcome.content_format,
            outcome.exit_code,
            outcome.blocks,
            Some(outcome.transport_session),
        )),
        "gemini" => run_gemini_acp_turn(
            app,
            &wrapper_path,
            &run.project_root,
            &composed_prompt,
            &session,
            None,
            &goal.synthetic_terminal_tab_id,
            &message_id,
            true,
            timeout_ms,
            Vec::new(),
        )
        .map(|outcome| (
            outcome.raw_output,
            outcome.final_content,
            outcome.content_format,
            outcome.exit_code,
            outcome.blocks,
            Some(outcome.transport_session),
        )),
        _ => run_silent_agent_turn_once(
            &run.project_root,
            &owner_cli,
            &wrapper_path,
            &composed_prompt,
            true,
            &session,
            timeout_ms,
        )
        .map(|outcome| (
            outcome.raw_output.clone(),
            if outcome.final_content.trim().is_empty() {
                outcome.raw_output
            } else {
                outcome.final_content
            },
            "log".to_string(),
            Some(0),
            Vec::new(),
            None,
        )),
    };

    let after_files = get_git_panel(run.project_root.clone())
        .map(|panel| panel.recent_changes.into_iter().map(|change| change.path).collect::<BTreeSet<_>>())
        .unwrap_or_default();
    let relevant_files = after_files
        .union(&before_files)
        .cloned()
        .collect::<Vec<_>>();

    match execution {
        Ok((raw_output, final_content, content_format, exit_code, blocks, transport_session)) => {
            let raw = if raw_output.trim().is_empty() {
                final_content.clone()
            } else {
                raw_output.clone()
            };
            let outcome = AutomationExecutionOutcome {
                owner_cli: owner_cli.to_string(),
                raw_output: raw.clone(),
                final_content: if final_content.trim().is_empty() {
                    raw.clone()
                } else {
                    final_content.clone()
                },
                content_format,
                summary: display_summary(&raw),
                exit_code,
                blocks: blocks.clone(),
                transport_session,
                relevant_files: if blocks.is_empty() {
                    relevant_files
                } else {
                    collect_relevant_files_from_blocks(&blocks)
                        .into_iter()
                        .chain(relevant_files.into_iter())
                        .collect::<BTreeSet<_>>()
                        .into_iter()
                        .collect()
                },
            };
            let _ = finalize_automation_turn_message(terminal_storage, goal, &message_id, &outcome);
            outcome
        }
        Err(error) => {
            let outcome = AutomationExecutionOutcome {
                owner_cli: owner_cli.to_string(),
                raw_output: error.clone(),
                final_content: error.clone(),
                content_format: "log".to_string(),
                summary: display_summary(&error),
                exit_code: Some(1),
                blocks: vec![ChatMessageBlock::Status {
                    level: "error".to_string(),
                    text: error.clone(),
                }],
                transport_session: None,
                relevant_files,
            };
            let _ = finalize_automation_turn_message(terminal_storage, goal, &message_id, &outcome);
            outcome
        }
    }
}

fn execute_automation_run_loop(
    app: &AppHandle,
    state_arc: &Arc<Mutex<AppStateDto>>,
    context_arc: &Arc<Mutex<ContextStore>>,
    settings_arc: &Arc<Mutex<AppSettings>>,
    terminal_storage: &TerminalStorage,
    claude_approval_rules: &Arc<Mutex<ClaudeApprovalRules>>,
    claude_pending_approvals: &Arc<Mutex<BTreeMap<String, PendingClaudeApproval>>>,
    codex_pending_approvals: &Arc<Mutex<BTreeMap<String, PendingCodexApproval>>>,
    automation_runs: &Arc<Mutex<Vec<AutomationRun>>>,
    run_id: &str,
) {
    let _ = context_arc;

    loop {
        let next_goal = {
            let mut runs = match automation_runs.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            let Some(run_index) = runs.iter().position(|item| item.id == run_id) else {
                return;
            };
            let run = &mut runs[run_index];

            if run.status == "cancelled" {
                run.summary = Some(summarize_automation_run(run));
                let _ = persist_automation_runs_to_disk(&runs);
                return;
            }
            if run.status == "paused" {
                run.summary = Some(summarize_automation_run(run));
                let _ = persist_automation_runs_to_disk(&runs);
                return;
            }

            let queued_goal = run.goals.iter().find(|goal| goal.status == "queued").cloned();
            if let Some(goal) = queued_goal {
                let now = now_stamp();
                run.lifecycle_status = "running".to_string();
                run.outcome_status = "unknown".to_string();
                run.attention_status = "none".to_string();
                run.resolution_code = "in_progress".to_string();
                run.status_summary = Some("Run is actively executing.".to_string());
                run.status = "running".to_string();
                run.started_at = run.started_at.clone().or(Some(now.clone()));
                run.updated_at = now.clone();
                if let Some(goal_mut) = run.goals.iter_mut().find(|item| item.id == goal.id) {
                    goal_mut.lifecycle_status = "running".to_string();
                    goal_mut.outcome_status = "unknown".to_string();
                    goal_mut.attention_status = "none".to_string();
                    goal_mut.resolution_code = "in_progress".to_string();
                    goal_mut.status_summary = Some("Goal is actively executing.".to_string());
                    goal_mut.status = "running".to_string();
                    goal_mut.started_at = goal_mut.started_at.clone().or(Some(now.clone()));
                    goal_mut.updated_at = now.clone();
                    goal_mut.last_owner_cli = Some(infer_automation_owner(goal_mut));
                    sync_goal_status_fields(goal_mut);
                }
                sync_run_status_fields(run);
                push_event(
                    run,
                    Some(&goal.id),
                    "info",
                    "Goal started",
                    &format!("Running unattended goal: {}", goal.title),
                );
                let run_snapshot = run.clone();
                let _ = persist_automation_runs_to_disk(&runs);
                Some((run_snapshot, goal))
            } else {
                let has_paused = run.goals.iter().any(|goal| goal.status == "paused");
                let has_failed = run.goals.iter().any(|goal| goal.status == "failed");
                let has_unknown = run
                    .goals
                    .iter()
                    .any(|goal| goal.outcome_status == "unknown" || goal.outcome_status == "partial");
                let now = now_stamp();
                if has_paused {
                    run.lifecycle_status = "stopped".to_string();
                    run.outcome_status = if has_failed { "failed".to_string() } else { "unknown".to_string() };
                    run.attention_status = "waiting_human".to_string();
                    run.resolution_code = "manual_pause_requested".to_string();
                    run.status_summary = Some("Stopped and waiting for manual handling.".to_string());
                } else if has_failed {
                    run.lifecycle_status = "finished".to_string();
                    run.outcome_status = "failed".to_string();
                    run.attention_status = "none".to_string();
                    run.resolution_code = "objective_checks_failed".to_string();
                    run.status_summary = Some("Finished with failed outcomes.".to_string());
                } else if has_unknown {
                    run.lifecycle_status = "finished".to_string();
                    run.outcome_status = "partial".to_string();
                    run.attention_status = "none".to_string();
                    run.resolution_code = "expected_outcome_not_met".to_string();
                    run.status_summary = Some("Finished but objective completion was not fully verified.".to_string());
                } else {
                    run.lifecycle_status = "finished".to_string();
                    run.outcome_status = "success".to_string();
                    run.attention_status = "none".to_string();
                    run.resolution_code = "objective_checks_passed".to_string();
                    run.status_summary = Some("Finished successfully.".to_string());
                }
                sync_run_status_fields(run);
                run.completed_at = Some(now.clone());
                run.updated_at = now;
                run.summary = Some(summarize_automation_run(run));
                let title = if run.status == "completed" {
                    "Run completed"
                } else if run.status == "paused" {
                    "Run paused"
                } else {
                    "Run finished with failures"
                };
                let detail = run.summary.clone().unwrap_or_else(|| "Automation run updated.".to_string());
                push_event(run, None, if run.status == "completed" { "success" } else { "warning" }, title, &detail);
                let snapshot = run.clone();
                let _ = persist_automation_runs_to_disk(&runs);
                notify_automation_event(
                    app,
                    &format!("Automation {}", snapshot.status),
                    &format!("{} • {}", snapshot.project_name, detail),
                );

                let _ = mutate_store_arc(state_arc, |state| {
                    append_activity(
                        state,
                        if snapshot.status == "completed" { "success" } else { "warning" },
                        &format!("automation {}", snapshot.status),
                        &format!("{} • {}", snapshot.project_name, detail),
                    );
                });
                let snapshot_state = state_arc.lock().ok().map(|state| state.clone());
                if let Some(state) = snapshot_state.as_ref() {
                    let _ = persist_state(state);
                    emit_state(app, state);
                }

                // Send webhook and email notifications if configured (after all state is persisted)
                let notification_config = settings_arc.lock().ok().map(|s| s.notification_config.clone());
                if let Some(cfg) = notification_config {
                    if cfg.notify_on_completion {
                        let run_id = snapshot.id.clone();
                        let project_name = snapshot.project_name.clone();
                        let status = snapshot.status.clone();
                        let summary = snapshot.summary.clone();
                        let completed_at = snapshot.completed_at.clone();
                        let goals = snapshot
                            .goals
                            .iter()
                            .map(|g| WebhookGoalInfo {
                                title: g.title.clone(),
                                status: g.status.clone(),
                                round_count: g.round_count,
                            })
                            .collect::<Vec<_>>();

                        // Webhook notification
                        if cfg.webhook_enabled && !cfg.webhook_url.is_empty() {
                            let url = cfg.webhook_url.clone();
                            let payload = WebhookPayload {
                                event: "automation_completed".to_string(),
                                timestamp: chrono::Utc::now().to_rfc3339(),
                                run: WebhookRunInfo {
                                    id: run_id.clone(),
                                    project_name: project_name.clone(),
                                    status: status.clone(),
                                    summary: summary.clone(),
                                    completed_at: completed_at.clone(),
                                    goals,
                                },
                            };
                            std::thread::spawn(move || {
                                send_webhook_notification(&url, &payload);
                            });
                        }

                        // Email notification
                        if cfg.smtp_enabled
                            && !cfg.email_recipients.is_empty()
                            && !cfg.smtp_host.is_empty()
                            && !cfg.smtp_username.is_empty()
                        {
                            let host = cfg.smtp_host.clone();
                            let port = cfg.smtp_port;
                            let username = cfg.smtp_username.clone();
                            let password = cfg.smtp_password.clone();
                            let from = cfg.smtp_from.clone();
                            let recipients = cfg.email_recipients.clone();
                            let subject = format!(
                                "[{}] Automation {} - {}",
                                project_name,
                                status,
                                &run_id[..8.min(run_id.len())]
                            );
                            let body = format!(
                                "Project: {}\nStatus: {}\nSummary: {}\nRun ID: {}\n\nThis notification was sent by Multi CLI Studio.",
                                project_name,
                                status,
                                summary.unwrap_or_default(),
                                run_id
                            );
                            std::thread::spawn(move || {
                                let _ = send_email_notification(
                                    &host, port, &username, &password, &from, &recipients, &subject, &body,
                                );
                            });
                        }
                    }
                }

                return;
            }
        };

        let Some((run_snapshot, goal_snapshot)) = next_goal else {
            return;
        };

        let mut working_goal = goal_snapshot.clone();
        let mut current_owner = normalize_automation_owner(
            if working_goal.execution_mode == "auto" {
                working_goal.last_owner_cli.as_deref()
            } else {
                Some(working_goal.execution_mode.as_str())
            },
            &automation_goal_target_cli(&working_goal),
        );
        let mut prior_progress = working_goal.latest_progress_summary.clone();
        let mut next_instruction = working_goal.next_instruction.clone();
        let final_title: String;
        let final_level: String;
        let final_detail: String;

        loop {
            let round_index = working_goal.round_count + 1;
            let outcome = execute_automation_goal(
                app,
                state_arc,
                settings_arc,
                terminal_storage,
                claude_approval_rules,
                claude_pending_approvals,
                codex_pending_approvals,
                &run_snapshot,
                &working_goal,
                &working_goal.rule_config,
                &current_owner,
                round_index,
                prior_progress.as_deref(),
                next_instruction.as_deref(),
            );

            let _ = terminal_storage.record_turn_progress(&storage::TaskTurnUpdate {
                terminal_tab_id: working_goal.synthetic_terminal_tab_id.clone(),
                workspace_id: run_snapshot.workspace_id.clone(),
                project_root: run_snapshot.project_root.clone(),
                project_name: run_snapshot.project_name.clone(),
                cli_id: outcome.owner_cli.clone(),
                user_prompt: build_automation_goal_prompt(
                    &run_snapshot,
                    &working_goal,
                    &working_goal.rule_config,
                    &current_owner,
                    round_index,
                    prior_progress.as_deref(),
                    next_instruction.as_deref(),
                ),
                assistant_summary: outcome.summary.clone(),
                relevant_files: outcome.relevant_files.clone(),
                recent_turns: Vec::new(),
                exit_code: outcome.exit_code,
            });

            let rule_pause_reason =
                detect_automation_rule_pause_reason(&outcome.raw_output, &working_goal.rule_config);
            let judgement = if let Some(reason) = rule_pause_reason.clone() {
                AutomationJudgeResponse {
                    decision: "pause".to_string(),
                    reason: reason.clone(),
                    progress_summary: outcome.summary.clone(),
                    next_instruction: None,
                    next_owner_cli: Some(current_owner.clone()),
                    made_progress: outcome.exit_code == Some(0),
                    expected_outcome_met: false,
                }
            } else {
                let mut state_snapshot = state_arc
                    .lock()
                    .map(|guard| guard.clone())
                    .unwrap_or_else(|_| seed_state(&run_snapshot.project_root));
                state_snapshot.workspace.project_root = run_snapshot.project_root.clone();
                state_snapshot.workspace.project_name = run_snapshot.project_name.clone();
                state_snapshot.workspace.branch = git_output(&run_snapshot.project_root, &["branch", "--show-current"])
                    .unwrap_or_else(|| "workspace".to_string());
                sync_agent_runtime(&mut state_snapshot);
                evaluate_automation_round(
                    &state_snapshot,
                    settings_arc,
                    &run_snapshot,
                    &working_goal,
                    &working_goal.rule_config,
                    &current_owner,
                    round_index,
                    &outcome.raw_output,
                    outcome.exit_code,
                )
            };

            let new_failure_count = if outcome.exit_code == Some(0) {
                0
            } else {
                working_goal.consecutive_failure_count + 1
            };
            let new_no_progress = if judgement.made_progress || judgement.expected_outcome_met {
                0
            } else {
                working_goal.no_progress_rounds + 1
            };
            let merged_files = {
                let mut files = working_goal.relevant_files.clone();
                for file in &outcome.relevant_files {
                    if !files.iter().any(|existing| existing == file) {
                        files.push(file.clone());
                    }
                }
                files
            };

            let mut decision = judgement.decision.clone();
            let mut reason = judgement.reason.clone();
            // If judge says complete but expected outcome not met, force continue to keep iterating
            if decision == "complete" && !judgement.expected_outcome_met {
                decision = "continue".to_string();
                reason = format!(
                    "Expected outcome not yet met (judge marked complete=false), continuing iteration. Reason: {}",
                    judgement.reason
                );
            }
            let pause_requested = automation_runs
                .lock()
                .ok()
                .and_then(|runs| runs.iter().find(|item| item.id == run_id).map(|run| run.status == "paused"))
                .unwrap_or(false);
            if decision == "continue" && pause_requested {
                decision = "pause".to_string();
                reason = "批次已手动暂停，当前轮次结束后停止继续。".to_string();
            }
            if decision == "continue" && round_index >= working_goal.rule_config.max_rounds_per_goal {
                decision = "fail".to_string();
                reason = "Stopped because the goal hit the maximum unattended round budget.".to_string();
            }
            if decision == "continue" && new_failure_count >= working_goal.rule_config.max_consecutive_failures {
                decision = "fail".to_string();
                reason = "Stopped because the goal hit the consecutive failure limit.".to_string();
            }
            if decision == "continue" && new_no_progress > working_goal.rule_config.max_no_progress_rounds {
                decision = "fail".to_string();
                reason = "Stopped because repeated rounds did not show meaningful progress.".to_string();
            }

            {
                let mut runs = match automation_runs.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                let Some(run) = runs.iter_mut().find(|item| item.id == run_id) else {
                    return;
                };
                if let Some(goal) = run.goals.iter_mut().find(|item| item.id == working_goal.id) {
                    let resolution_code = match decision.as_str() {
                        "complete" => "objective_checks_passed".to_string(),
                        "fail" => {
                            if new_failure_count >= working_goal.rule_config.max_consecutive_failures {
                                "max_failures_exceeded".to_string()
                            } else if new_no_progress > working_goal.rule_config.max_no_progress_rounds {
                                "no_progress_exceeded".to_string()
                            } else if round_index >= working_goal.rule_config.max_rounds_per_goal {
                                "max_rounds_exceeded".to_string()
                            } else {
                                "objective_checks_failed".to_string()
                            }
                        }
                        "pause" => resolution_code_for_pause_reason(&reason),
                        _ => {
                            if outcome.exit_code == Some(0) {
                                "in_progress".to_string()
                            } else {
                                "runtime_error".to_string()
                            }
                        }
                    };
                    let attention_status = match decision.as_str() {
                        "pause" => {
                            if resolution_code == "manual_pause_requested"
                                || resolution_code == "judge_requested_pause"
                            {
                                "waiting_human".to_string()
                            } else {
                                "blocked_by_policy".to_string()
                            }
                        }
                        _ => "none".to_string(),
                    };
                    let lifecycle_status = match decision.as_str() {
                        "continue" => "running".to_string(),
                        "pause" => "stopped".to_string(),
                        _ => "finished".to_string(),
                    };
                    let outcome_status = match decision.as_str() {
                        "complete" => "success".to_string(),
                        "fail" => "failed".to_string(),
                        "pause" => {
                            if judgement.expected_outcome_met && outcome.exit_code == Some(0) {
                                "partial".to_string()
                            } else {
                                "unknown".to_string()
                            }
                        }
                        _ => {
                            if judgement.expected_outcome_met {
                                "success".to_string()
                            } else if judgement.made_progress {
                                "partial".to_string()
                            } else {
                                "unknown".to_string()
                            }
                        }
                    };
                    goal.round_count = round_index;
                    goal.last_owner_cli = Some(outcome.owner_cli.clone());
                    goal.result_summary = Some(outcome.summary.clone());
                    goal.latest_progress_summary = Some(judgement.progress_summary.clone());
                    goal.next_instruction = judgement.next_instruction.clone();
                    goal.relevant_files = merged_files.clone();
                    goal.last_exit_code = outcome.exit_code;
                    goal.lifecycle_status = lifecycle_status;
                    goal.outcome_status = outcome_status;
                    goal.attention_status = attention_status;
                    goal.resolution_code = resolution_code;
                    goal.status_summary = Some(format!(
                        "{} {}",
                        judgement.progress_summary.trim(),
                        reason.trim()
                    ).trim().to_string());
                    goal.objective_signals = AutomationObjectiveSignals {
                        exit_code: outcome.exit_code,
                        checks_passed: outcome.exit_code == Some(0) && judgement.expected_outcome_met,
                        checks_failed: outcome.exit_code.is_some() && outcome.exit_code != Some(0),
                        artifacts_produced: !merged_files.is_empty(),
                        files_changed: merged_files.len(),
                        policy_blocks: if rule_pause_reason.is_some() {
                            vec![reason.clone()]
                        } else {
                            Vec::new()
                        },
                    };
                    goal.judge_assessment = AutomationJudgeAssessment {
                        made_progress: judgement.made_progress,
                        expected_outcome_met: judgement.expected_outcome_met,
                        suggested_decision: Some(judgement.decision.clone()),
                        reason: Some(judgement.reason.clone()),
                    };
                    goal.consecutive_failure_count = new_failure_count;
                    goal.no_progress_rounds = new_no_progress;
                    goal.updated_at = now_stamp();
                    goal.started_at = goal.started_at.clone().or(Some(goal.updated_at.clone()));
                    goal.completed_at = if decision == "continue" {
                        None
                    } else {
                        Some(goal.updated_at.clone())
                    };
                    goal.requires_attention_reason = if decision == "pause" {
                        Some(reason.clone())
                    } else {
                        None
                    };
                    goal.status = match decision.as_str() {
                        "pause" => "paused".to_string(),
                        "fail" => "failed".to_string(),
                        "complete" => "completed".to_string(),
                        _ => "running".to_string(),
                    };
                    sync_goal_status_fields(goal);
                    working_goal = goal.clone();
                }

                run.updated_at = now_stamp();
                run.objective_signals = working_goal.objective_signals.clone();
                run.judge_assessment = working_goal.judge_assessment.clone();
                run.status_summary = working_goal.status_summary.clone();
                let event_level = if decision == "continue" {
                    "info"
                } else if decision == "complete" {
                    "success"
                } else if decision == "pause" {
                    "warning"
                } else {
                    "error"
                };
                let event_title = if decision == "continue" {
                    format!("Round {} complete", round_index)
                } else if decision == "complete" {
                    "Goal completed".to_string()
                } else if decision == "pause" {
                    "Goal paused".to_string()
                } else {
                    "Goal failed".to_string()
                };
                push_event(
                    run,
                    Some(&working_goal.id),
                    event_level,
                    &event_title,
                    &format!("{}\n{}", judgement.progress_summary, reason),
                );
                let _ = persist_automation_runs_to_disk(&runs);
            }


            if decision == "continue" {
                prior_progress = Some(judgement.progress_summary.clone());
                next_instruction = judgement.next_instruction.clone();
                current_owner = if working_goal.execution_mode == "auto" {
                    normalize_automation_owner(
                        judgement.next_owner_cli.as_deref(),
                        &current_owner,
                    )
                } else {
                    working_goal.execution_mode.clone()
                };
                working_goal.round_count = round_index;
                continue;
            }

            final_title = if decision == "complete" {
                "Goal completed".to_string()
            } else if decision == "pause" {
                "Goal paused".to_string()
            } else {
                "Goal failed".to_string()
            };
            final_level = if decision == "complete" {
                "success".to_string()
            } else if decision == "pause" {
                "warning".to_string()
            } else {
                "error".to_string()
            };
            final_detail = format!("{}\n{}", judgement.progress_summary, reason);
            break;
        }

        let _ = mutate_store_arc(state_arc, |state| {
            append_activity(
                state,
                if final_level == "success" {
                    "success"
                } else if final_level == "warning" {
                    "warning"
                } else {
                    "danger"
                },
                &format!("automation {}", final_title.to_ascii_lowercase()),
                &format!("{} • {}", working_goal.title, final_detail),
            );
        });
        notify_automation_event(
            app,
            &format!("{} • {}", run_snapshot.project_name, final_title),
            &format!("{} • {}", working_goal.title, final_detail),
        );
        let snapshot_state = state_arc.lock().ok().map(|state| state.clone());
        if let Some(state) = snapshot_state.as_ref() {
            let _ = persist_state(state);
            emit_state(app, state);
        }
    }
}

// ── Shell execution ────────────────────────────────────────────────────

fn spawn_shell_command(
    shell_path: &str,
    project_root: &str,
    command_text: &str,
    app: AppHandle,
    store: Arc<Mutex<AppStateDto>>,
    agent_id: &str,
    speaker: &str,
    timeout_ms: u64,
) -> Result<String, String> {
    let mut cmd = Command::new(shell_path);
    cmd.args(shell_command_args(shell_path, command_text))
        .current_dir(project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|err| err.to_string())?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture stderr".to_string())?;

    let stdout_store = store.clone();
    let stdout_app = app.clone();
    let stdout_agent = agent_id.to_string();
    let stdout_speaker = speaker.to_string();
    let output_buffer = Arc::new(Mutex::new(String::new()));
    let stdout_buffer = output_buffer.clone();
    let stderr_buffer = output_buffer.clone();

    let stdout_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let terminal_line = TerminalLine {
                id: create_id("line"),
                speaker: stdout_speaker.clone(),
                content: line.clone(),
                time: now_label(),
            };
            if let Ok(mut output) = stdout_buffer.lock() {
                output.push_str(&line);
                output.push('\n');
            }
            if let Ok(mut state) = stdout_store.lock() {
                push_terminal_line(&mut state, &stdout_agent, terminal_line.clone());
                emit_terminal_line(&stdout_app, &stdout_agent, terminal_line);
            }
        }
    });

    let stderr_store = store.clone();
    let stderr_app = app.clone();
    let stderr_agent = agent_id.to_string();
    let stderr_handle = thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let terminal_line = TerminalLine {
                id: create_id("line"),
                speaker: "system".to_string(),
                content: line.clone(),
                time: now_label(),
            };
            if let Ok(mut output) = stderr_buffer.lock() {
                output.push_str(&line);
                output.push('\n');
            }
            if let Ok(mut state) = stderr_store.lock() {
                push_terminal_line(&mut state, &stderr_agent, terminal_line.clone());
                emit_terminal_line(&stderr_app, &stderr_agent, terminal_line);
            }
        }
    });

    // Timeout: wait on a separate thread, kill child if it exceeds the limit
    let child_id = child.id();
    let timeout_duration = Duration::from_millis(timeout_ms);
    let timed_out = Arc::new(Mutex::new(false));
    let timed_out_clone = timed_out.clone();

    let timeout_handle = thread::spawn(move || {
        thread::sleep(timeout_duration);
        if let Ok(mut flag) = timed_out_clone.lock() {
            *flag = true;
        }
        // Best-effort kill
        #[cfg(target_os = "windows")]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &child_id.to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = Command::new("kill")
                .args(["-9", &child_id.to_string()])
                .output();
        }
    });

    let status = child.wait().map_err(|err| err.to_string())?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    // Drop timeout thread (it will finish on its own or already triggered)
    drop(timeout_handle);

    let was_timed_out = timed_out.lock().map(|f| *f).unwrap_or(false);
    if was_timed_out {
        return Err(format!("Process timed out after {}ms", timeout_ms));
    }

    let output = {
        let guard = output_buffer.lock().map_err(|err| err.to_string())?;
        guard.clone()
    };

    if status.success() {
        Ok(output)
    } else {
        Err(if output.trim().is_empty() {
            format!("Command exited with {}", status)
        } else {
            output
        })
    }
}

fn artifact_kind(agent_id: &str, review_only: bool) -> String {
    if review_only {
        match agent_id {
            "gemini" => "ui-note".to_string(),
            "claude" => "plan".to_string(),
            _ => "review".to_string(),
        }
    } else {
        "diff".to_string()
    }
}

/// Summary for display in UI artifacts (truncated)
fn display_summary(output: &str) -> String {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return "No textual output was returned.".to_string();
    }
    if trimmed.chars().count() <= 500 {
        trimmed.to_string()
    } else {
        let mut summary = trimmed.chars().take(500).collect::<String>();
        summary.push_str("...");
        summary
    }
}

fn safe_truncate_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        truncated
    } else {
        value.to_string()
    }
}

// ── Runtime detection ──────────────────────────────────────────────────

fn sync_agent_runtime(state: &mut AppStateDto) {
    let runtimes = detect_runtimes();
    for agent in &mut state.agents {
        if let Some(runtime) = runtimes.get(&agent.id) {
            agent.runtime = runtime.clone();
        }
    }
}

fn detect_runtimes() -> BTreeMap<String, AgentRuntime> {
    let mut runtimes = BTreeMap::new();
    for (agent_id, version_flag) in [
        ("codex", "-V"),
        ("claude", "--version"),
        ("gemini", "--version"),
    ] {
        let command_path = resolve_agent_command_path(agent_id);

        let version = command_path
            .as_ref()
            .and_then(|path| run_cli_command_capture(path, &[version_flag]));

        let last_error = if command_path.is_some() {
            None
        } else {
            Some("CLI wrapper was not found.".to_string())
        };

        runtimes.insert(
            agent_id.to_string(),
            AgentRuntime {
                installed: command_path.is_some(),
                command_path,
                version,
                last_error,
                resources: detect_agent_resources(agent_id),
            },
        );
    }

    runtimes
}

fn resolve_agent_command_path(agent_id: &str) -> Option<String> {
    resolve_command_path(agent_id)
}

fn detect_agent_resources(agent_id: &str) -> AgentRuntimeResources {
    match agent_id {
        "codex" => detect_codex_resources(),
        "claude" => detect_claude_resources(),
        "gemini" => detect_gemini_resources(),
        _ => AgentRuntimeResources::default(),
    }
}

fn resource_group(supported: bool) -> AgentResourceGroup {
    AgentResourceGroup {
        supported,
        items: Vec::new(),
        error: None,
    }
}

fn resource_item(
    name: impl Into<String>,
    enabled: bool,
    version: Option<String>,
    source: Option<String>,
    detail: Option<String>,
) -> AgentResourceItem {
    AgentResourceItem {
        name: name.into(),
        enabled,
        version,
        source,
        detail,
    }
}

fn detect_codex_resources() -> AgentRuntimeResources {
    let home = user_home_dir();
    let mut resources = AgentRuntimeResources {
        mcp: detect_codex_mcp(&home.join(".codex").join("config.toml")),
        plugin: resource_group(false),
        extension: resource_group(false),
        skill: resource_group(true),
    };

    let mut skills = list_skill_items(&home.join(".codex").join("skills"), Some("user"));
    skills.extend(list_skill_items(
        &home.join(".codex").join("skills").join(".system"),
        Some("built-in"),
    ));
    resources.skill.items = dedupe_resource_items(skills);
    resources
}

fn detect_claude_resources() -> AgentRuntimeResources {
    let home = user_home_dir();
    AgentRuntimeResources {
        mcp: detect_claude_mcp(&home.join(".claude.json")),
        plugin: detect_claude_plugins(&home.join(".claude").join("plugins")),
        extension: resource_group(false),
        skill: AgentResourceGroup {
            supported: true,
            items: dedupe_resource_items(list_skill_items(
                &home.join(".claude").join("skills"),
                Some("user"),
            )),
            error: None,
        },
    }
}

fn detect_gemini_resources() -> AgentRuntimeResources {
    let home = user_home_dir();
    AgentRuntimeResources {
        mcp: detect_gemini_mcp(&home.join(".gemini").join("settings.json")),
        plugin: resource_group(false),
        extension: detect_gemini_extensions(&home.join(".gemini").join("extensions")),
        skill: AgentResourceGroup {
            supported: true,
            items: dedupe_resource_items(list_skill_items(
                &home.join(".gemini").join("skills"),
                Some("local"),
            )),
            error: None,
        },
    }
}

fn detect_codex_mcp(config_path: &Path) -> AgentResourceGroup {
    let mut group = resource_group(true);
    if !config_path.exists() {
        return group;
    }

    match fs::read_to_string(config_path) {
        Ok(raw) => {
            let mut seen = BTreeSet::new();
            for line in raw.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("[mcp_servers.") {
                    if let Some(name) = rest.strip_suffix(']') {
                        if !name.contains('.') && seen.insert(name.to_string()) {
                            group.items.push(resource_item(
                                name.to_string(),
                                true,
                                None,
                                Some("config.toml".to_string()),
                                None,
                            ));
                        }
                    }
                }
            }
        }
        Err(err) => {
            group.error = Some(err.to_string());
        }
    }

    group
        .items
        .sort_by(|left, right| left.name.cmp(&right.name));
    group
}

fn detect_claude_mcp(config_path: &Path) -> AgentResourceGroup {
    let mut group = resource_group(true);
    if !config_path.exists() {
        return group;
    }

    match read_json_value(config_path) {
        Ok(value) => {
            let mut items_by_name: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

            if let Some(servers) = value.get("mcpServers").and_then(|entry| entry.as_object()) {
                for name in servers.keys() {
                    items_by_name
                        .entry(name.to_string())
                        .or_default()
                        .insert("global".to_string());
                }
            }

            if let Some(projects) = value.get("projects").and_then(|entry| entry.as_object()) {
                for (project_path, project_value) in projects {
                    if let Some(servers) = project_value
                        .get("mcpServers")
                        .and_then(|entry| entry.as_object())
                    {
                        let scope = path_label(project_path);
                        for name in servers.keys() {
                            items_by_name
                                .entry(name.to_string())
                                .or_default()
                                .insert(scope.clone());
                        }
                    }
                }
            }

            group.items = items_by_name
                .into_iter()
                .map(|(name, scopes)| {
                    let detail = if scopes.is_empty() {
                        None
                    } else {
                        Some(scopes.into_iter().collect::<Vec<_>>().join(", "))
                    };
                    resource_item(name, true, None, Some(".claude.json".to_string()), detail)
                })
                .collect();
        }
        Err(err) => {
            group.error = Some(err);
        }
    }

    group
}

fn detect_claude_plugins(plugin_root: &Path) -> AgentResourceGroup {
    let mut group = resource_group(true);
    let manifest_path = plugin_root.join("installed_plugins.json");
    if !manifest_path.exists() {
        return group;
    }

    let disabled_plugins = read_claude_blocklist(&plugin_root.join("blocklist.json"));

    match read_json_value(&manifest_path) {
        Ok(value) => {
            if let Some(plugins) = value.get("plugins").and_then(|entry| entry.as_object()) {
                for (full_name, installs) in plugins {
                    let name = full_name.split('@').next().unwrap_or(full_name).to_string();
                    let source = full_name.split('@').nth(1).map(|value| value.to_string());
                    let latest = installs.as_array().and_then(|entries| entries.last());
                    let version = latest
                        .and_then(|entry| entry.get("version"))
                        .and_then(|entry| entry.as_str())
                        .map(|value| value.to_string());
                    let detail = latest
                        .and_then(|entry| entry.get("scope"))
                        .and_then(|entry| entry.as_str())
                        .map(|value| format!("scope: {}", value));

                    group.items.push(resource_item(
                        name,
                        !disabled_plugins.contains(full_name),
                        version,
                        source,
                        detail,
                    ));
                }
            }
        }
        Err(err) => {
            group.error = Some(err);
        }
    }

    group
        .items
        .sort_by(|left, right| left.name.cmp(&right.name));
    group
}

fn detect_gemini_mcp(settings_path: &Path) -> AgentResourceGroup {
    let mut group = resource_group(true);
    if !settings_path.exists() {
        return group;
    }

    match read_json_value(settings_path) {
        Ok(value) => {
            if let Some(servers) = value.get("mcpServers").and_then(|entry| entry.as_object()) {
                for (name, server) in servers {
                    let detail = server
                        .get("command")
                        .and_then(|entry| entry.as_str())
                        .map(|value| value.to_string());
                    group.items.push(resource_item(
                        name.to_string(),
                        true,
                        None,
                        Some("settings.json".to_string()),
                        detail,
                    ));
                }
            }
        }
        Err(err) => {
            group.error = Some(err);
        }
    }

    group
        .items
        .sort_by(|left, right| left.name.cmp(&right.name));
    group
}

fn detect_gemini_extensions(extension_root: &Path) -> AgentResourceGroup {
    let mut group = resource_group(true);
    if !extension_root.exists() {
        return group;
    }

    let entries = match fs::read_dir(extension_root) {
        Ok(entries) => entries,
        Err(err) => {
            group.error = Some(err.to_string());
            return group;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("gemini-extension.json");
        let install_path = path.join(".gemini-extension-install.json");

        let mut version = None;
        let mut source = Some("local".to_string());
        let mut detail = None;

        if manifest_path.exists() {
            if let Ok(value) = read_json_value(&manifest_path) {
                version = value
                    .get("version")
                    .and_then(|entry| entry.as_str())
                    .map(|value| value.to_string());
                detail = value
                    .get("description")
                    .and_then(|entry| entry.as_str())
                    .map(|value| value.to_string());
            }
        }

        if install_path.exists() {
            if let Ok(value) = read_json_value(&install_path) {
                source = value
                    .get("type")
                    .and_then(|entry| entry.as_str())
                    .map(|value| value.to_string())
                    .or(source);
            }
        }

        group
            .items
            .push(resource_item(name, true, version, source, detail));
    }

    group
        .items
        .sort_by(|left, right| left.name.cmp(&right.name));
    group
}

fn list_skill_items(root: &Path, source: Option<&str>) -> Vec<AgentResourceItem> {
    let mut items = Vec::new();
    if !root.exists() {
        return items;
    }

    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return items,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if !path.is_dir() || !looks_like_skill_dir(&path, &name) {
            continue;
        }

        let descriptor = read_local_skill_descriptor(&path, &name);
        items.push(resource_item(
            descriptor
                .as_ref()
                .map(|skill| skill.name.clone())
                .unwrap_or(name),
            true,
            None,
            source.map(|value| value.to_string()),
            descriptor.and_then(|skill| skill.description),
        ));
    }

    items
}

fn looks_like_skill_dir(path: &Path, name: &str) -> bool {
    find_skill_markdown_path(path, name).is_some()
}

fn list_local_cli_skills(
    roots: &[(&Path, Option<&str>, Option<&str>)],
    user_invocable_only: bool,
) -> Vec<CliSkillItem> {
    let mut items = Vec::new();

    for (root, source, scope) in roots {
        items.extend(list_cli_skill_items_from_root(
            root,
            *source,
            *scope,
            user_invocable_only,
        ));
    }

    dedupe_cli_skill_items(items)
}

fn list_cli_skill_items_from_root(
    root: &Path,
    source: Option<&str>,
    scope: Option<&str>,
    user_invocable_only: bool,
) -> Vec<CliSkillItem> {
    let mut items = Vec::new();
    if !root.exists() {
        return items;
    }

    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return items,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || !path.is_dir() {
            continue;
        }

        let Some(descriptor) = read_local_skill_descriptor(&path, &name) else {
            continue;
        };
        if user_invocable_only && !descriptor.user_invocable {
            continue;
        }

        items.push(CliSkillItem {
            name: descriptor.name,
            display_name: None,
            description: descriptor.description,
            path: descriptor.path,
            scope: scope.map(|value| value.to_string()),
            source: source.map(|value| value.to_string()),
        });
    }

    items
}

fn read_local_skill_descriptor(path: &Path, name: &str) -> Option<LocalSkillDescriptor> {
    let markdown_path = find_skill_markdown_path(path, name)?;
    let raw = fs::read_to_string(&markdown_path).ok();
    let manifest = raw
        .as_deref()
        .map(parse_local_skill_manifest)
        .unwrap_or_default();
    let skill_name = manifest
        .name
        .unwrap_or_else(|| name.to_string())
        .trim()
        .to_string();
    let normalized_name = if skill_name.is_empty() {
        name.to_string()
    } else {
        skill_name
    };

    Some(LocalSkillDescriptor {
        name: normalized_name,
        description: manifest
            .description
            .or_else(|| raw.as_deref().and_then(extract_skill_summary)),
        path: path.to_string_lossy().to_string(),
        user_invocable: manifest.user_invocable.unwrap_or(true),
    })
}

fn find_skill_markdown_path(path: &Path, name: &str) -> Option<PathBuf> {
    let preferred = [path.join("SKILL.md"), path.join(format!("{}.md", name))];
    for candidate in preferred {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let entries = fs::read_dir(path).ok()?;
    for entry in entries.flatten() {
        let child = entry.path();
        if child.is_file()
            && child
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("md"))
        {
            return Some(child);
        }
    }

    None
}

fn parse_local_skill_manifest(raw: &str) -> LocalSkillManifest {
    let mut manifest = LocalSkillManifest::default();
    let mut lines = raw.lines();
    if !matches!(lines.next().map(str::trim), Some("---")) {
        return manifest;
    }

    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let normalized_key = key.trim().to_ascii_lowercase().replace('_', "-");
        let scalar = trim_yaml_scalar(value);
        match normalized_key.as_str() {
            "name" => {
                if !scalar.is_empty() {
                    manifest.name = Some(scalar);
                }
            }
            "description" => {
                if !scalar.is_empty() {
                    manifest.description = Some(scalar);
                }
            }
            "user-invocable" => {
                manifest.user_invocable = parse_skill_bool(&scalar);
            }
            _ => {}
        }
    }

    manifest
}

fn trim_yaml_scalar(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let first = trimmed.chars().next().unwrap_or_default();
        let last = trimmed.chars().last().unwrap_or_default();
        if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
            return trimmed[1..trimmed.len() - 1].trim().to_string();
        }
    }
    trimmed.to_string()
}

fn parse_skill_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "yes" | "on" => Some(true),
        "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn extract_skill_summary(raw: &str) -> Option<String> {
    let body = if raw.trim_start().starts_with("---") {
        let mut marker_count = 0;
        let mut body_lines = Vec::new();
        for line in raw.lines() {
            if line.trim() == "---" {
                marker_count += 1;
                continue;
            }
            if marker_count < 2 {
                continue;
            }
            body_lines.push(line);
        }
        body_lines.join("\n")
    } else {
        raw.to_string()
    };

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed.starts_with('-')
            || trimmed.starts_with('*')
        {
            continue;
        }
        return Some(trimmed.to_string());
    }

    None
}

fn dedupe_cli_skill_items(items: Vec<CliSkillItem>) -> Vec<CliSkillItem> {
    let mut seen = BTreeSet::new();
    let mut deduped = Vec::new();

    for item in items {
        let key = item.name.to_lowercase();
        if seen.insert(key) {
            deduped.push(item);
        }
    }

    deduped.sort_by(|left, right| {
        let left_label = left
            .display_name
            .clone()
            .unwrap_or_else(|| left.name.clone());
        let right_label = right
            .display_name
            .clone()
            .unwrap_or_else(|| right.name.clone());
        left_label.cmp(&right_label)
    });
    deduped
}

fn dedupe_resource_items(items: Vec<AgentResourceItem>) -> Vec<AgentResourceItem> {
    let mut seen = BTreeSet::new();
    let mut deduped = Vec::new();

    for item in items {
        let key = format!(
            "{}::{}::{}",
            item.name.to_lowercase(),
            item.source.clone().unwrap_or_default().to_lowercase(),
            item.version.clone().unwrap_or_default().to_lowercase()
        );

        if seen.insert(key) {
            deduped.push(item);
        }
    }

    deduped.sort_by(|left, right| left.name.cmp(&right.name));
    deduped
}

fn read_json_value(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str::<Value>(&raw).map_err(|err| err.to_string())
}

fn read_claude_blocklist(path: &Path) -> BTreeSet<String> {
    let mut blocklist = BTreeSet::new();
    if let Ok(value) = read_json_value(path) {
        if let Some(plugins) = value.get("plugins").and_then(|entry| entry.as_array()) {
            for plugin in plugins {
                if let Some(name) = plugin.get("plugin").and_then(|entry| entry.as_str()) {
                    blocklist.insert(name.to_string());
                }
            }
        }
    }
    blocklist
}

fn path_label(value: &str) -> String {
    Path::new(value)
        .file_name()
        .map(|entry| entry.to_string_lossy().to_string())
        .filter(|entry| !entry.is_empty())
        .unwrap_or_else(|| "project".to_string())
}

fn user_home_dir() -> PathBuf {
    dirs::home_dir()
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn rust_available() -> bool {
    resolve_command_path("cargo").is_some() && resolve_command_path("rustc").is_some()
}

fn environment_notes() -> Vec<String> {
    let mut notes = Vec::new();
    if rust_available() {
        notes.push("Rust toolchain detected via ~/.cargo/bin.".to_string());
    } else {
        notes.push("Rust exists but is not reachable from the current shell.".to_string());
    }
    if std::env::var("CARGO_NET_OFFLINE").unwrap_or_default() == "true" {
        notes.push("Cargo offline mode was inherited from the parent shell.".to_string());
    }
    notes
}

fn shell_path() -> String {
    #[cfg(target_os = "windows")]
    {
        if Path::new(FALLBACK_SHELL).exists() {
            FALLBACK_SHELL.to_string()
        } else {
            "powershell.exe".to_string()
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(shell) = std::env::var("SHELL") {
            if Path::new(&shell).exists() {
                return shell;
            }
        }
        if Path::new(FALLBACK_SHELL).exists() {
            FALLBACK_SHELL.to_string()
        } else if Path::new("/bin/bash").exists() {
            "/bin/bash".to_string()
        } else {
            "/bin/sh".to_string()
        }
    }
}

fn shell_command_args(shell_path: &str, command_text: &str) -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let _ = shell_path;
        vec![
            "-NoLogo".to_string(),
            "-NoProfile".to_string(),
            "-Command".to_string(),
            command_text.to_string(),
        ]
    }

    #[cfg(not(target_os = "windows"))]
    {
        let shell_name = Path::new(shell_path)
            .file_name()
            .and_then(|entry| entry.to_str())
            .unwrap_or(shell_path);
        let command_flag = match shell_name {
            "bash" | "zsh" => "-lc",
            _ => "-c",
        };
        vec![command_flag.to_string(), command_text.to_string()]
    }
}

fn run_cli_command_capture(command_path: &str, args: &[&str]) -> Option<String> {
    let resolved_command = resolve_direct_command_path(command_path);
    let output = batch_aware_command(&resolved_command, args).output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        if !stdout.is_empty() {
            Some(stdout)
        } else if !stderr.is_empty() {
            Some(stderr)
        } else {
            None
        }
    } else if !stderr.is_empty() {
        Some(stderr)
    } else if !stdout.is_empty() {
        Some(stdout)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn shell_quote(value: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        ps_quote(value)
    }

    #[cfg(not(target_os = "windows"))]
    {
        sh_quote(value)
    }
}

fn shell_command(command_path: &str, args: &[String]) -> String {
    let mut parts = Vec::with_capacity(args.len() + 2);

    #[cfg(target_os = "windows")]
    parts.push("&".to_string());

    parts.push(shell_quote(command_path));
    parts.extend(args.iter().map(|arg| shell_quote(arg)));
    parts.join(" ")
}

fn command_lookup_names(command_name: &str) -> Vec<String> {
    #[cfg(target_os = "windows")]
    let mut names = vec![command_name.to_string()];

    #[cfg(not(target_os = "windows"))]
    let names = vec![command_name.to_string()];

    #[cfg(target_os = "windows")]
    {
        if Path::new(command_name).extension().is_none() {
            let pathext =
                std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD;.PS1".to_string());
            for ext in pathext.split(';') {
                let trimmed = ext.trim();
                if trimmed.is_empty() {
                    continue;
                }
                names.push(format!("{}{}", command_name, trimmed));
            }
        }
    }

    names
}

fn resolve_command_path(command_name: &str) -> Option<String> {
    let command_path = Path::new(command_name);
    if command_path.components().count() > 1 || command_path.is_absolute() {
        return command_path
            .exists()
            .then(|| command_path.to_string_lossy().to_string());
    }

    let lookup_names = command_lookup_names(command_name);
    let path_value = std::env::var_os("PATH")?;

    for dir in std::env::split_paths(&path_value) {
        for candidate in &lookup_names {
            let full_path = dir.join(candidate);
            if full_path.exists() {
                return Some(full_path.to_string_lossy().to_string());
            }
        }
    }

    None
}

fn is_ignored_workspace_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | ".next" | ".turbo"
    )
}

fn collect_workspace_files(
    root: &Path,
    current: &Path,
    lower_query: &str,
    results: &mut Vec<FileMentionCandidate>,
) -> Result<(), String> {
    if results.len() >= 40 {
        return Ok(());
    }

    let entries = fs::read_dir(current).map_err(|err| err.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if is_ignored_workspace_dir(&name) {
                continue;
            }
            collect_workspace_files(root, &path, lower_query, results)?;
            if results.len() >= 40 {
                return Ok(());
            }
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let haystack = relative.to_lowercase();
        if lower_query.is_empty()
            || haystack.contains(lower_query)
            || name.to_lowercase().contains(lower_query)
        {
            results.push(FileMentionCandidate {
                id: relative.clone(),
                name,
                relative_path: relative,
                absolute_path: Some(path.to_string_lossy().to_string()),
            });
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn pick_workspace_folder_impl() -> Result<Option<WorkspacePickResult>, String> {
    let script = r#"
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  $dialog.SelectedPath
}
"#;

    let output = Command::new("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-STA", "-Command", script])
        .output()
        .map_err(|err| err.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected.is_empty() {
        return Ok(None);
    }

    let name = Path::new(&selected)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "workspace".to_string());

    Ok(Some(WorkspacePickResult {
        name,
        root_path: selected,
    }))
}

#[cfg(target_os = "macos")]
fn pick_workspace_folder_impl() -> Result<Option<WorkspacePickResult>, String> {
    let output = Command::new("osascript")
        .args([
            "-e",
            r#"try
POSIX path of (choose folder with prompt "Choose a workspace folder")
on error number -128
return ""
end try"#,
        ])
        .output()
        .map_err(|err| err.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let selected = String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_end_matches('/')
        .to_string();
    if selected.is_empty() {
        return Ok(None);
    }

    let name = Path::new(&selected)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "workspace".to_string());

    Ok(Some(WorkspacePickResult {
        name,
        root_path: selected,
    }))
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn pick_workspace_folder_impl() -> Result<Option<WorkspacePickResult>, String> {
    Err("Workspace picking is not implemented on this platform yet.".to_string())
}

// ── State persistence ──────────────────────────────────────────────────

fn data_dir() -> Result<PathBuf, String> {
    let base = data_local_dir()
        .ok_or_else(|| "Unable to locate local application data directory".to_string())?
        .join("multi-cli-studio");
    fs::create_dir_all(&base).map_err(|err| err.to_string())?;
    Ok(base)
}

fn state_file() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("session.json"))
}

fn context_file() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("context.json"))
}

fn settings_file() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("settings.json"))
}

fn claude_approval_rules_file() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("claude-approval-rules.json"))
}

fn persist_state(state: &AppStateDto) -> Result<(), String> {
    let path = state_file()?;
    let raw = serde_json::to_string_pretty(state).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

fn persist_context(ctx: &ContextStore) -> Result<(), String> {
    let path = context_file()?;
    let raw = serde_json::to_string_pretty(ctx).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

fn persist_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_file()?;
    let raw = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

fn persist_claude_approval_rules(rules: &ClaudeApprovalRules) -> Result<(), String> {
    let path = claude_approval_rules_file()?;
    let raw = serde_json::to_string_pretty(rules).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

fn load_or_seed_state(project_root: &str) -> Result<AppStateDto, String> {
    let state_path = state_file()?;
    if state_path.exists() {
        let raw = fs::read_to_string(&state_path).map_err(|err| err.to_string())?;
        let mut state = serde_json::from_str::<AppStateDto>(&raw).map_err(|err| err.to_string())?;
        if state.workspace.project_root != project_root {
            state.workspace.project_root = project_root.to_string();
            state.workspace.project_name = Path::new(project_root)
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "workspace".to_string());
        }
        Ok(state)
    } else {
        let state = seed_state(project_root);
        persist_state(&state)?;
        Ok(state)
    }
}

fn load_or_seed_context(_project_root: &str) -> Result<ContextStore, String> {
    let path = context_file()?;
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        serde_json::from_str::<ContextStore>(&raw).map_err(|err| err.to_string())
    } else {
        let ctx = seed_context();
        persist_context(&ctx)?;
        Ok(ctx)
    }
}

fn load_or_seed_settings(project_root: &str) -> Result<AppSettings, String> {
    let path = settings_file()?;
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        serde_json::from_str::<AppSettings>(&raw).map_err(|err| err.to_string())
    } else {
        let s = seed_settings(project_root);
        persist_settings(&s)?;
        Ok(s)
    }
}

fn load_or_seed_claude_approval_rules() -> Result<ClaudeApprovalRules, String> {
    let path = claude_approval_rules_file()?;
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        serde_json::from_str::<ClaudeApprovalRules>(&raw).map_err(|err| err.to_string())
    } else {
        let rules = ClaudeApprovalRules::default();
        persist_claude_approval_rules(&rules)?;
        Ok(rules)
    }
}

fn seed_context() -> ContextStore {
    let mut agents = BTreeMap::new();
    for id in ["codex", "claude", "gemini"] {
        agents.insert(
            id.to_string(),
            AgentContext {
                agent_id: id.to_string(),
                conversation_history: Vec::new(),
                total_token_estimate: 0,
            },
        );
    }
    ContextStore {
        agents,
        conversation_history: Vec::new(),
        handoffs: Vec::new(),
        max_turns_per_agent: DEFAULT_MAX_TURNS,
        max_output_chars_per_turn: DEFAULT_MAX_OUTPUT_CHARS,
    }
}

fn seed_settings(project_root: &str) -> AppSettings {
    AppSettings {
        cli_paths: CliPaths {
            codex: "auto".to_string(),
            claude: "auto".to_string(),
            gemini: "auto".to_string(),
        },
        project_root: project_root.to_string(),
        max_turns_per_agent: DEFAULT_MAX_TURNS,
        max_output_chars_per_turn: DEFAULT_MAX_OUTPUT_CHARS,
        process_timeout_ms: DEFAULT_TIMEOUT_MS,
        notify_on_terminal_completion: false,
        notification_config: NotificationConfig {
            notify_on_completion: false,
            webhook_url: String::new(),
            webhook_enabled: false,
            smtp_enabled: false,
            smtp_host: "smtp.example.com".to_string(),
            smtp_port: 587,
            smtp_username: String::new(),
            smtp_password: String::new(),
            smtp_from: String::new(),
            email_recipients: Vec::new(),
        },
    }
}

// ── Seed state ─────────────────────────────────────────────────────────

fn seed_state(project_root: &str) -> AppStateDto {
    let project_name = Path::new(project_root)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "workspace".to_string());

    let runtimes = detect_runtimes();
    let mut terminal_by_agent = BTreeMap::new();
    terminal_by_agent.insert(
        "codex".to_string(),
        vec![
            TerminalLine {
                id: create_id("line"),
                speaker: "system".to_string(),
                content: "writer lock acquired for the primary workspace".to_string(),
                time: now_label(),
            },
            TerminalLine {
                id: create_id("line"),
                speaker: "codex".to_string(),
                content: "Environment checked. The shell is ready for real CLI jobs.".to_string(),
                time: now_label(),
            },
        ],
    );
    terminal_by_agent.insert(
        "claude".to_string(),
        vec![TerminalLine {
            id: create_id("line"),
            speaker: "claude".to_string(),
            content: "Architecture lane is standing by for review or takeover.".to_string(),
            time: now_label(),
        }],
    );
    terminal_by_agent.insert(
        "gemini".to_string(),
        vec![TerminalLine {
            id: create_id("line"),
            speaker: "gemini".to_string(),
            content: "Interface lane is standing by for UI critique and visual refinement."
                .to_string(),
            time: now_label(),
        }],
    );

    AppStateDto {
        workspace: WorkspaceState {
            project_name,
            project_root: project_root.to_string(),
            branch: "main".to_string(),
            current_writer: "codex".to_string(),
            active_agent: "codex".to_string(),
            dirty_files: 0,
            failing_checks: 0,
            handoff_ready: true,
            last_snapshot: None,
        },
        agents: vec![
            base_agent(
                "codex",
                "Codex",
                "writer",
                "active",
                "Bug isolation, patch drafting, repo-grounded fixes",
                "Primary execution lane with direct writer ownership.",
                "Ready to accept execution prompts.",
                "codex:last",
                runtimes
                    .get("codex")
                    .cloned()
                    .unwrap_or_else(unavailable_runtime),
            ),
            base_agent(
                "claude",
                "Claude",
                "architect",
                "ready",
                "System boundaries, review, refactor guidance",
                "Architecture lane prepared for review and takeover.",
                "Waiting for an architecture prompt or review request.",
                "claude:latest",
                runtimes
                    .get("claude")
                    .cloned()
                    .unwrap_or_else(unavailable_runtime),
            ),
            base_agent(
                "gemini",
                "Gemini",
                "ui-designer",
                "ready",
                "Workbench quality, hierarchy, interface polish",
                "Interface lane prepared for design critique and visual refinement.",
                "Waiting for a UI-focused prompt or review request.",
                "gemini:latest",
                runtimes
                    .get("gemini")
                    .cloned()
                    .unwrap_or_else(unavailable_runtime),
            ),
        ],
        handoffs: vec![HandoffPack {
            id: create_id("handoff"),
            from: "codex".to_string(),
            to: "claude".to_string(),
            status: "ready".to_string(),
            goal: "Review the orchestrator boundary before deeper CLI execution flows land."
                .to_string(),
            files: vec![
                "src/App.tsx".to_string(),
                "src/lib/bridge.ts".to_string(),
                "src-tauri/src/main.rs".to_string(),
            ],
            risks: vec![
                "The frontend and backend state models must stay in sync.".to_string(),
                "Writer lock ownership should remain explicit.".to_string(),
            ],
            next_step: "Validate the shared session model and the bridge contracts.".to_string(),
            updated_at: "just now".to_string(),
        }],
        artifacts: vec![ReviewArtifact {
            id: create_id("artifact"),
            source: "system".to_string(),
            title: "Desktop host ready".to_string(),
            kind: "plan".to_string(),
            summary:
                "The Tauri host now owns persistence, runtime detection, and background job orchestration."
                    .to_string(),
            confidence: "high".to_string(),
            created_at: "just now".to_string(),
        }],
        activity: vec![ActivityItem {
            id: create_id("activity"),
            time: now_label(),
            tone: "success".to_string(),
            title: "Workspace attached".to_string(),
            detail: "The app session loaded and bound itself to the current project root."
                .to_string(),
        }],
        terminal_by_agent,
        environment: EnvironmentState {
            backend: "tauri".to_string(),
            tauri_ready: true,
            rust_available: rust_available(),
            notes: environment_notes(),
        },
    }
}

fn base_agent(
    id: &str,
    label: &str,
    mode: &str,
    status: &str,
    specialty: &str,
    summary: &str,
    pending_action: &str,
    session_ref: &str,
    runtime: AgentRuntime,
) -> AgentCard {
    AgentCard {
        id: id.to_string(),
        label: label.to_string(),
        mode: mode.to_string(),
        status: status.to_string(),
        specialty: specialty.to_string(),
        summary: summary.to_string(),
        pending_action: pending_action.to_string(),
        session_ref: session_ref.to_string(),
        last_sync: "just now".to_string(),
        runtime,
    }
}

fn unavailable_runtime() -> AgentRuntime {
    AgentRuntime {
        installed: false,
        command_path: None,
        version: None,
        last_error: Some("CLI wrapper was not found.".to_string()),
        resources: AgentRuntimeResources::default(),
    }
}

// ── State mutation helpers ─────────────────────────────────────────────

fn push_terminal_line(state: &mut AppStateDto, agent_id: &str, line: TerminalLine) {
    state
        .terminal_by_agent
        .entry(agent_id.to_string())
        .or_default()
        .push(line);
    if let Some(lines) = state.terminal_by_agent.get_mut(agent_id) {
        if lines.len() > 200 {
            let drain_len = lines.len() - 200;
            lines.drain(0..drain_len);
        }
    }
}

fn append_terminal_line(state: &mut AppStateDto, agent_id: &str, speaker: &str, content: &str) {
    push_terminal_line(
        state,
        agent_id,
        TerminalLine {
            id: create_id("line"),
            speaker: speaker.to_string(),
            content: content.to_string(),
            time: now_label(),
        },
    );
}

fn append_activity(state: &mut AppStateDto, tone: &str, title: &str, detail: &str) {
    state.activity.insert(
        0,
        ActivityItem {
            id: create_id("activity"),
            time: now_label(),
            tone: tone.to_string(),
            title: title.to_string(),
            detail: detail.to_string(),
        },
    );
    if state.activity.len() > 12 {
        state.activity.truncate(12);
    }
}

fn prepend_handoff(state: &mut AppStateDto, handoff: HandoffPack) {
    state.handoffs.insert(0, handoff);
    if state.handoffs.len() > 8 {
        state.handoffs.truncate(8);
    }
}

fn prepend_artifact(state: &mut AppStateDto, artifact: ReviewArtifact) {
    state.artifacts.insert(0, artifact);
    if state.artifacts.len() > 10 {
        state.artifacts.truncate(10);
    }
}

fn update_agent_modes(
    state: &mut AppStateDto,
    writer_override: Option<&str>,
    active_override: Option<&str>,
) {
    let writer = writer_override
        .unwrap_or(&state.workspace.current_writer)
        .to_string();
    let active = active_override
        .unwrap_or(&state.workspace.active_agent)
        .to_string();

    for agent in &mut state.agents {
        agent.mode = if agent.id == writer {
            "writer".to_string()
        } else {
            match agent.id.as_str() {
                "claude" => "architect".to_string(),
                "gemini" => "ui-designer".to_string(),
                _ => "standby".to_string(),
            }
        };
        agent.status = if agent.id == active {
            "active".to_string()
        } else {
            "ready".to_string()
        };
        agent.last_sync = "just now".to_string();
    }
}

fn sync_workspace_metrics(state: &mut AppStateDto) {
    state.workspace.branch =
        git_output(&state.workspace.project_root, &["branch", "--show-current"])
            .unwrap_or_else(|| "workspace".to_string());
    state.workspace.dirty_files =
        git_output(&state.workspace.project_root, &["status", "--porcelain"])
            .map(|output| {
                output
                    .lines()
                    .filter(|line| !line.trim().is_empty())
                    .count()
            })
            .unwrap_or(state.workspace.dirty_files);
}

fn git_output(project_root: &str, args: &[&str]) -> Option<String> {
    let text = git_output_allow_empty(project_root, args)?;
    if text.trim().is_empty() {
        None
    } else {
        Some(text.trim().to_string())
    }
}

fn git_output_allow_empty(project_root: &str, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(project_root)
        .output()
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        None
    }
}

fn mutate_state<F>(store: &State<'_, AppStore>, update: F) -> Result<AppStateDto, String>
where
    F: FnOnce(&mut AppStateDto),
{
    let mut guard = store.state.lock().map_err(|err| err.to_string())?;
    update(&mut guard);
    Ok(guard.clone())
}

fn mutate_store_arc<F>(store: &Arc<Mutex<AppStateDto>>, update: F) -> Result<(), String>
where
    F: FnOnce(&mut AppStateDto),
{
    let mut guard = store.lock().map_err(|err| err.to_string())?;
    update(&mut guard);
    Ok(())
}

fn emit_state(app: &AppHandle, state: &AppStateDto) {
    let _ = app.emit("app-state", state.clone());
}

fn emit_terminal_line(app: &AppHandle, agent_id: &str, line: TerminalLine) {
    let _ = app.emit(
        "terminal-line",
        TerminalEvent {
            agent_id: agent_id.to_string(),
            line,
        },
    );
}

// ── Utilities ──────────────────────────────────────────────────────────

fn now_label() -> String {
    Local::now().format("%H:%M").to_string()
}

fn now_stamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn create_id(prefix: &str) -> String {
    format!("{}-{}", prefix, Uuid::new_v4())
}

fn default_project_root() -> String {
    std::env::current_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string())
}

// ── Entry point ────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let project_root = default_project_root();
    let terminal_storage = TerminalStorage::new(default_terminal_db_path(
        &data_dir().expect("failed to resolve local app data directory"),
    ))
    .expect("failed to initialize terminal sqlite storage");
    let mut automation_jobs =
        load_automation_jobs_from_disk().unwrap_or_else(|_| Vec::new());
    automation::normalize_jobs_on_startup(&mut automation_jobs);
    let _ = persist_automation_jobs_to_disk(&automation_jobs);
    let automation_jobs = Arc::new(Mutex::new(automation_jobs));
    let mut automation_runs =
        load_automation_runs_from_disk().unwrap_or_else(|_| Vec::new());
    normalize_runs_on_startup(&mut automation_runs);
    let _ = persist_automation_runs_to_disk(&automation_runs);
    let automation_runs = Arc::new(Mutex::new(automation_runs));
    let automation_active_runs = Arc::new(Mutex::new(BTreeSet::new()));
    let automation_rule_profile =
        Arc::new(Mutex::new(load_rule_profile().unwrap_or_else(|_| default_rule_profile())));
    let mut initial_state = load_or_seed_state(&project_root).unwrap_or_else(|_| seed_state(&project_root));
    sync_workspace_metrics(&mut initial_state);
    sync_agent_runtime(&mut initial_state);
    let startup_state = Arc::new(Mutex::new(initial_state));
    let startup_context =
        Arc::new(Mutex::new(load_or_seed_context(&project_root).unwrap_or_else(|_| seed_context())));
    let startup_settings = Arc::new(Mutex::new(
        load_or_seed_settings(&project_root).unwrap_or_else(|_| seed_settings(&project_root)),
    ));
    let scheduler_state = startup_state.clone();
    let scheduler_context = startup_context.clone();
    let scheduler_settings = startup_settings.clone();
    let scheduler_storage = terminal_storage.clone();
    let scheduler_jobs = automation_jobs.clone();
    let scheduler_runs = automation_runs.clone();
    let scheduler_active = automation_active_runs.clone();
    let claude_approval_rules = Arc::new(Mutex::new(
        load_or_seed_claude_approval_rules().unwrap_or_default(),
    ));
    let claude_pending_approvals = Arc::new(Mutex::new(BTreeMap::new()));
    let codex_pending_approvals = Arc::new(Mutex::new(BTreeMap::new()));
    let scheduler_claude_approval_rules = claude_approval_rules.clone();
    let scheduler_claude_pending_approvals = claude_pending_approvals.clone();
    let scheduler_codex_pending_approvals = codex_pending_approvals.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(AppStore {
            state: startup_state,
            context: startup_context,
            settings: startup_settings,
            terminal_storage,
            automation_jobs,
            automation_runs,
            automation_active_runs,
            automation_rule_profile,
            acp_session: Arc::new(Mutex::new(acp::AcpSession::default())),
            claude_approval_rules,
            claude_pending_approvals,
            codex_pending_approvals,
        })
        .setup(move |app| {
            schedule_existing_automation_runs(
                app.handle().clone(),
                scheduler_state.clone(),
                scheduler_context.clone(),
                scheduler_settings.clone(),
                scheduler_storage.clone(),
                scheduler_claude_approval_rules.clone(),
                scheduler_claude_pending_approvals.clone(),
                scheduler_codex_pending_approvals.clone(),
                scheduler_runs.clone(),
                scheduler_active.clone(),
            );
            schedule_cron_automation_jobs(
                app.handle().clone(),
                scheduler_state.clone(),
                scheduler_context.clone(),
                scheduler_settings.clone(),
                scheduler_storage.clone(),
                scheduler_claude_approval_rules.clone(),
                scheduler_claude_pending_approvals.clone(),
                scheduler_codex_pending_approvals.clone(),
                scheduler_jobs.clone(),
                scheduler_runs.clone(),
                scheduler_active.clone(),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_state,
            switch_active_agent,
            take_over_writer,
            snapshot_workspace,
            run_checks,
            submit_prompt,
            request_review,
            get_context_store,
            get_conversation_history,
            load_terminal_state,
            save_terminal_state,
            append_chat_messages,
            update_chat_message_stream,
            finalize_chat_message,
            delete_chat_message_record,
            delete_chat_session_by_tab,
            update_chat_message_blocks,
            list_automation_jobs,
            get_automation_job,
            create_automation_job,
            update_automation_job,
            delete_automation_job,
            list_automation_runs,
            list_automation_job_runs,
            get_automation_run_detail,
            get_automation_rule_profile,
            update_automation_rule_profile,
            update_automation_goal_rule_config,
            create_automation_run,
            create_automation_run_from_job,
            start_automation_run,
            pause_automation_run,
            resume_automation_run,
            restart_automation_run,
            pause_automation_goal,
            resume_automation_goal,
            cancel_automation_run,
            delete_automation_run,
            switch_cli_for_task,
            send_chat_message,
            run_auto_orchestration,
            respond_assistant_approval,
            get_git_panel,
            get_git_file_diff,
            open_workspace_file,
            pick_workspace_folder,
            get_cli_skills,
            search_workspace_files,
            get_settings,
            update_settings,
            execute_acp_command,
            get_acp_commands,
            get_acp_session,
            get_acp_capabilities
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
