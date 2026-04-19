use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use chrono::Local;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use uuid::Uuid;

use crate::{AgentTransportSession, ChatMessageBlock, CompactedSummary, SelectedCustomAgent};

const COMPACT_KEEP_TURNS: usize = 4;
const AUTO_COMPACT_MAX_HOT_TURNS: usize = 8;
const AUTO_COMPACT_MAX_HOT_CHARS: usize = 12_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTerminalState {
    pub workspaces: Vec<PersistedWorkspaceRef>,
    pub terminal_tabs: Vec<PersistedTerminalTab>,
    pub active_terminal_tab_id: Option<String>,
    pub chat_sessions: BTreeMap<String, PersistedConversationSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWorkspaceRef {
    pub id: String,
    pub name: String,
    pub root_path: String,
    #[serde(default = "default_workspace_location_kind")]
    pub location_kind: String,
    #[serde(default)]
    pub connection_id: Option<String>,
    #[serde(default)]
    pub remote_path: Option<String>,
    #[serde(default)]
    pub location_label: Option<String>,
    pub branch: String,
    pub current_writer: String,
    pub active_agent: String,
    pub dirty_files: usize,
    pub failing_checks: usize,
    pub handoff_ready: bool,
    pub last_snapshot: Option<String>,
}

fn default_workspace_location_kind() -> String {
    "local".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWorkingMemorySnapshot {
    pub modified_files: Vec<String>,
    pub active_errors: Vec<String>,
    pub recent_commands: Vec<String>,
    pub build_status: String,
    pub key_decisions: Vec<String>,
    pub contributing_clis: Vec<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedCliContextBoundary {
    pub last_seen_message_id: Option<String>,
    pub last_seen_at: Option<String>,
    pub last_compacted_summary_version: Option<i64>,
    #[serde(default)]
    pub working_memory_snapshot: Option<PersistedWorkingMemorySnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedChatAttachment {
    pub id: String,
    pub kind: String,
    pub file_name: String,
    #[serde(default)]
    pub media_type: Option<String>,
    pub source: String,
    #[serde(default)]
    pub display_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTerminalTab {
    pub id: String,
    pub title: String,
    pub workspace_id: String,
    pub selected_cli: String,
    #[serde(default)]
    pub selected_agent: Option<SelectedCustomAgent>,
    pub plan_mode: bool,
    pub fast_mode: bool,
    pub effort_level: Option<String>,
    pub model_overrides: BTreeMap<String, String>,
    pub permission_overrides: BTreeMap<String, String>,
    pub transport_sessions: BTreeMap<String, AgentTransportSession>,
    #[serde(default)]
    pub context_boundaries_by_cli: BTreeMap<String, PersistedCliContextBoundary>,
    pub draft_prompt: String,
    #[serde(default)]
    pub draft_attachments: Vec<PersistedChatAttachment>,
    pub status: String,
    pub last_active_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedConversationSession {
    pub id: String,
    pub terminal_tab_id: String,
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub messages: Vec<PersistedChatMessage>,
    /// Accepts `CompactedSummary[]` from TypeScript; serialized to JSON for storage.
    #[serde(default)]
    pub compacted_summaries: Vec<CompactedSummary>,
    pub last_compacted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedChatMessage {
    pub id: String,
    pub role: String,
    pub cli_id: Option<String>,
    #[serde(default)]
    pub selected_agent: Option<SelectedCustomAgent>,
    #[serde(default)]
    pub automation_run_id: Option<String>,
    #[serde(default)]
    pub workflow_run_id: Option<String>,
    #[serde(default)]
    pub workflow_node_id: Option<String>,
    pub timestamp: String,
    pub content: String,
    pub raw_content: Option<String>,
    pub content_format: Option<String>,
    pub transport_kind: Option<String>,
    pub blocks: Option<Vec<ChatMessageBlock>>,
    #[serde(default)]
    pub attachments: Vec<PersistedChatAttachment>,
    pub is_streaming: bool,
    pub duration_ms: Option<u64>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskPacket {
    pub id: String,
    pub terminal_tab_id: String,
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub title: String,
    pub goal: String,
    pub status: String,
    pub current_owner_cli: String,
    pub latest_conclusion: Option<String>,
    pub open_questions: Vec<String>,
    pub risks: Vec<String>,
    pub next_step: Option<String>,
    pub relevant_files: Vec<String>,
    pub relevant_commands: Vec<String>,
    pub linked_session_ids: Vec<String>,
    pub latest_snapshot_id: Option<String>,
    pub updated_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HandoffEvent {
    pub id: String,
    pub task_id: String,
    pub terminal_tab_id: String,
    pub from_cli: String,
    pub to_cli: String,
    pub reason: Option<String>,
    pub latest_conclusion: Option<String>,
    pub files: Vec<String>,
    pub risks: Vec<String>,
    pub next_step: Option<String>,
    pub payload_json: Option<String>,
    pub delivery_state: String,
    pub delivered_at: Option<String>,
    pub delivered_message_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnapshot {
    pub id: String,
    pub task_id: String,
    pub trigger_reason: String,
    pub summary: String,
    pub facts_confirmed: Vec<String>,
    pub work_completed: Vec<String>,
    pub files_touched: Vec<String>,
    pub commands_run: Vec<String>,
    pub failures: Vec<String>,
    pub open_questions: Vec<String>,
    pub next_step: Option<String>,
    pub source_user_prompt: Option<String>,
    pub source_assistant_summary: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContextPack {
    pub id: String,
    pub task_id: String,
    pub terminal_tab_id: String,
    pub start_message_id: String,
    pub end_message_id: String,
    pub kind: String,
    pub summary: String,
    pub approx_chars: usize,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContextPackageLog {
    pub id: String,
    pub task_id: String,
    pub target_cli: String,
    pub profile_id: String,
    pub included_layers: Vec<String>,
    pub included_pack_ids: Vec<String>,
    pub approx_chars: usize,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompactBoundary {
    pub id: String,
    pub task_id: String,
    pub terminal_tab_id: String,
    pub boundary_message_id: String,
    pub snapshot_id: String,
    pub trigger_reason: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskContextBundle {
    pub task_packet: TaskPacket,
    pub latest_handoff: Option<HandoffEvent>,
    pub latest_snapshot: Option<ContextSnapshot>,
    pub latest_boundary: Option<CompactBoundary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KernelSessionRef {
    pub id: String,
    pub task_id: String,
    pub terminal_tab_id: String,
    pub cli_id: String,
    pub transport_kind: Option<String>,
    pub native_session_id: Option<String>,
    pub native_turn_id: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub resume_capable: bool,
    pub state: String,
    pub last_sync_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KernelFact {
    pub id: String,
    pub task_id: String,
    pub kind: String,
    pub subject: String,
    pub polarity: String,
    pub origin: String,
    pub statement: String,
    pub status: String,
    pub source_evidence_ids: Vec<String>,
    pub supersedes_fact_ids: Vec<String>,
    pub owner_cli: String,
    pub confidence: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KernelEvidence {
    pub id: String,
    pub task_id: String,
    pub message_id: String,
    pub terminal_tab_id: String,
    pub cli_id: String,
    pub evidence_type: String,
    pub summary: String,
    pub payload_ref: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskKernel {
    pub task_packet: TaskPacket,
    pub latest_handoff: Option<HandoffEvent>,
    pub latest_checkpoint: Option<ContextSnapshot>,
    pub active_plan: Option<KernelPlan>,
    pub work_items: Vec<KernelWorkItem>,
    pub current_work_item: Option<KernelWorkItem>,
    pub memory_entries: Vec<KernelMemoryEntry>,
    pub session_refs: Vec<KernelSessionRef>,
    pub facts: Vec<KernelFact>,
    pub evidence: Vec<KernelEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KernelPlan {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub goal: String,
    pub summary: Option<String>,
    pub status: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KernelWorkItem {
    pub id: String,
    pub task_id: String,
    pub step_id: Option<String>,
    pub owner_cli: String,
    pub title: String,
    pub summary: Option<String>,
    pub result: Option<String>,
    pub status: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KernelMemoryEntry {
    pub id: String,
    pub scope: String,
    pub scope_ref: String,
    pub kind: String,
    pub priority: String,
    pub pin_state: String,
    pub content: String,
    pub source_fact_id: Option<String>,
    pub source_evidence_ids: Vec<String>,
    pub last_used_at: Option<String>,
    pub use_count: usize,
    pub tags: Vec<String>,
    pub decay_eligible: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default)]
pub struct EnsureTaskPacketRequest {
    pub terminal_tab_id: String,
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub cli_id: String,
    pub initial_goal: String,
}

#[derive(Debug, Clone, Default)]
pub struct CliHandoffStorageRequest {
    pub terminal_tab_id: String,
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub from_cli: String,
    pub to_cli: String,
    pub reason: Option<String>,
    pub latest_user_prompt: Option<String>,
    pub latest_assistant_summary: Option<String>,
    pub relevant_files: Vec<String>,
    pub handoff_payload_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecentTurn {
    pub cli_id: String,
    pub user_prompt: String,
    pub assistant_reply: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Default)]
pub struct TaskTurnUpdate {
    pub terminal_tab_id: String,
    pub workspace_id: String,
    pub project_root: String,
    pub project_name: String,
    pub cli_id: String,
    pub user_prompt: String,
    pub assistant_summary: String,
    pub relevant_files: Vec<String>,
    pub recent_turns: Vec<TaskRecentTurn>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SemanticMemoryChunk {
    pub terminal_tab_id: String,
    pub cli_id: String,
    pub message_id: String,
    pub chunk_type: String,
    pub content: String,
    pub created_at: String,
    pub rank: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SemanticRecallRequest {
    pub query: String,
    pub terminal_tab_id: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Default)]
pub struct CompactContextResult {
    pub task_id: String,
    pub snapshot: ContextSnapshot,
    pub boundary: CompactBoundary,
    pub summarized_turn_count: usize,
    pub kept_turn_count: usize,
}

#[derive(Debug, Clone)]
struct CompletedTurn {
    user_message_id: String,
    assistant_message_id: String,
    cli_id: String,
    user_prompt: String,
    assistant_reply: String,
    timestamp: String,
}

#[derive(Debug, Clone, Default)]
pub struct ContextBudgetProfile {
    pub profile_id: String,
    pub max_chars: usize,
    pub max_hot_turns: usize,
    pub max_raw_turns: usize,
    pub allow_pack_expansion: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ContextAssemblyResult {
    pub prompt: String,
    pub approx_chars: usize,
    pub included_layers: Vec<String>,
    pub included_pack_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessageEventsAppendRequest {
    pub seeds: Vec<MessageSessionSeed>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSessionSeed {
    pub terminal_tab_id: String,
    pub session: PersistedConversationSession,
    pub messages: Vec<PersistedChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessageStreamUpdateRequest {
    pub terminal_tab_id: String,
    pub message_id: String,
    pub raw_content: String,
    pub content: String,
    pub content_format: Option<String>,
    pub blocks: Option<Vec<ChatMessageBlock>>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessageFinalizeRequest {
    pub terminal_tab_id: String,
    pub message_id: String,
    pub raw_content: String,
    pub content: String,
    pub content_format: Option<String>,
    pub blocks: Option<Vec<ChatMessageBlock>>,
    pub transport_kind: Option<String>,
    pub transport_session: Option<AgentTransportSession>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessageDeleteRequest {
    pub terminal_tab_id: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessageBlocksUpdateRequest {
    pub message_id: String,
    pub blocks: Option<Vec<ChatMessageBlock>>,
}

#[derive(Debug, Clone)]
pub struct TerminalStorage {
    db_path: PathBuf,
}

impl TerminalStorage {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let storage = Self { db_path };
        let conn = storage.open_connection()?;
        storage.init_schema(&conn)?;
        Ok(storage)
    }

    pub fn load_state(&self) -> Result<Option<PersistedTerminalState>, String> {
        let conn = self.open_connection()?;
        let workspaces = self.load_workspaces(&conn)?;
        let terminal_tabs = self.load_terminal_tabs(&conn)?;
        let active_terminal_tab_id = conn
            .query_row(
                "SELECT active_terminal_tab_id FROM terminal_state_meta WHERE id = 1",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|err| err.to_string())?
            .flatten();
        let chat_sessions = self.load_chat_sessions(&conn)?;

        if workspaces.is_empty() && terminal_tabs.is_empty() && chat_sessions.is_empty() {
            return Ok(None);
        }

        Ok(Some(PersistedTerminalState {
            workspaces,
            terminal_tabs,
            active_terminal_tab_id,
            chat_sessions,
        }))
    }

    pub fn append_chat_messages(&self, request: &MessageEventsAppendRequest) -> Result<(), String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        for seed in &request.seeds {
            self.ensure_session_metadata(&tx, &seed.session)?;
            self.append_messages_in_tx(
                &tx,
                &seed.session.id,
                &seed.terminal_tab_id,
                &seed.messages,
            )?;
        }
        tx.commit().map_err(|err| err.to_string())
    }

    pub fn update_chat_message_stream(
        &self,
        request: &MessageStreamUpdateRequest,
    ) -> Result<(), String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        tx.execute(
            "UPDATE chat_messages
             SET raw_content = ?1,
                 content = ?2,
                 content_format = ?3,
                 blocks_json = ?4
             WHERE id = ?5 AND terminal_tab_id = ?6",
            params![
                request.raw_content,
                request.content,
                request.content_format,
                option_to_json(&request.blocks)?,
                request.message_id,
                request.terminal_tab_id,
            ],
        )
        .map_err(|err| err.to_string())?;
        tx.execute(
            "UPDATE conversation_sessions SET updated_at = ?1 WHERE terminal_tab_id = ?2",
            params![request.updated_at, request.terminal_tab_id],
        )
        .map_err(|err| err.to_string())?;
        self.insert_message_event(
            &tx,
            &request.terminal_tab_id,
            None,
            &request.message_id,
            "stream_update",
            &request,
            Some(&request.updated_at),
        )?;
        tx.commit().map_err(|err| err.to_string())
    }

    pub fn finalize_chat_message(&self, request: &MessageFinalizeRequest) -> Result<(), String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        tx.execute(
            "UPDATE chat_messages
             SET raw_content = ?1,
                 content = ?2,
                 content_format = ?3,
                 blocks_json = ?4,
                 transport_kind = ?5,
                 is_streaming = 0,
                 duration_ms = ?6,
                 exit_code = ?7
             WHERE id = ?8 AND terminal_tab_id = ?9",
            params![
                request.raw_content,
                request.content,
                request.content_format,
                option_to_json(&request.blocks)?,
                request.transport_kind,
                request.duration_ms.map(|value| value as i64),
                request.exit_code,
                request.message_id,
                request.terminal_tab_id,
            ],
        )
        .map_err(|err| err.to_string())?;
        tx.execute(
            "UPDATE conversation_sessions SET updated_at = ?1 WHERE terminal_tab_id = ?2",
            params![request.updated_at, request.terminal_tab_id],
        )
        .map_err(|err| err.to_string())?;
        self.insert_message_event(
            &tx,
            &request.terminal_tab_id,
            None,
            &request.message_id,
            "finalize",
            &request,
            Some(&request.updated_at),
        )?;
        tx.commit().map_err(|err| err.to_string())?;
        self.sync_task_kernel_from_finalized_message(request)
    }

    fn sync_task_kernel_from_finalized_message(
        &self,
        request: &MessageFinalizeRequest,
    ) -> Result<(), String> {
        let conn = self.open_connection()?;
        let Some(session) =
            self.load_chat_session_by_terminal_tab(&conn, &request.terminal_tab_id)?
        else {
            return Ok(());
        };
        let Some(message_index) = session
            .messages
            .iter()
            .position(|message| message.id == request.message_id)
        else {
            return Ok(());
        };
        let message = session.messages[message_index].clone();
        if message.role != "assistant" || message.is_streaming {
            return Ok(());
        }

        let cli_id = request
            .transport_session
            .as_ref()
            .map(|session| session.cli_id.clone())
            .or_else(|| message.cli_id.clone())
            .unwrap_or_else(|| "codex".to_string());
        let latest_user_prompt = session.messages[..message_index]
            .iter()
            .rev()
            .find(|candidate| candidate.role == "user")
            .map(|candidate| {
                candidate
                    .raw_content
                    .clone()
                    .unwrap_or_else(|| candidate.content.clone())
            })
            .unwrap_or_else(|| format!("Continue work in {}", session.project_name));
        let assistant_summary = truncate_text(
            message
                .raw_content
                .as_deref()
                .unwrap_or(message.content.as_str()),
            600,
        );
        let relevant_files = collect_relevant_files_from_blocks_option(message.blocks.as_ref());
        let recent_turns = extract_completed_turns_from_messages(&session.messages, &cli_id)
            .into_iter()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|turn| TaskRecentTurn {
                cli_id: turn.cli_id,
                user_prompt: turn.user_prompt,
                assistant_reply: truncate_text(&turn.assistant_reply, 320),
                timestamp: turn.timestamp,
            })
            .collect::<Vec<_>>();

        let bundle = self.record_turn_progress(&TaskTurnUpdate {
            terminal_tab_id: request.terminal_tab_id.clone(),
            workspace_id: session.workspace_id.clone(),
            project_root: session.project_root.clone(),
            project_name: session.project_name.clone(),
            cli_id: cli_id.clone(),
            user_prompt: latest_user_prompt.clone(),
            assistant_summary: assistant_summary.clone(),
            relevant_files: relevant_files.clone(),
            recent_turns,
            exit_code: request.exit_code,
        })?;

        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;

        self.upsert_kernel_session_ref_in_tx(
            &tx,
            &bundle.task_packet.id,
            &request.terminal_tab_id,
            &cli_id,
            request
                .transport_kind
                .clone()
                .or(message.transport_kind.clone()),
            request.transport_session.as_ref(),
            &request.updated_at,
            request.exit_code,
        )?;

        let linked_session_ids = merge_string_lists(
            &bundle.task_packet.linked_session_ids,
            &[session.id.clone()],
        );
        tx.execute(
            "UPDATE task_packets
             SET linked_session_ids_json = ?1,
                 updated_at = ?2
             WHERE id = ?3",
            params![
                to_json(&linked_session_ids)?,
                request.updated_at,
                bundle.task_packet.id,
            ],
        )
        .map_err(|err| err.to_string())?;

        let evidence = build_kernel_evidence_records(
            &bundle.task_packet.id,
            &request.message_id,
            &request.terminal_tab_id,
            &cli_id,
            &assistant_summary,
            message.blocks.as_ref(),
            &message.timestamp,
        );
        for entry in &evidence {
            self.insert_kernel_evidence_in_tx(&tx, entry)?;
        }

        let facts = build_kernel_fact_records(
            &bundle.task_packet.id,
            &cli_id,
            &assistant_summary,
            request.exit_code,
            &evidence,
            &request.updated_at,
        );
        for fact in &facts {
            self.insert_kernel_fact_in_tx(&tx, fact)?;
        }

        if let Some(plan) = build_kernel_plan_record(
            &bundle.task_packet.id,
            message.blocks.as_ref(),
            &request.updated_at,
        ) {
            self.upsert_kernel_plan_in_tx(&tx, &plan)?;
        }

        let work_items = build_kernel_work_item_records(
            &bundle.task_packet.id,
            &cli_id,
            message.blocks.as_ref(),
            &request.updated_at,
        );
        for item in &work_items {
            self.upsert_kernel_work_item_in_tx(&tx, item)?;
        }

        let should_mark_handoff_delivered = request
            .transport_session
            .as_ref()
            .and_then(|session| session.thread_id.as_ref())
            .is_some()
            || request.exit_code == Some(0);
        if should_mark_handoff_delivered {
            self.mark_pending_handoff_delivered_in_tx(
                &tx,
                &bundle.task_packet.id,
                &cli_id,
                &request.message_id,
                &request.updated_at,
            )?;
        }

        // Index semantic memory chunks for FTS5-based recall
        self.index_semantic_chunks_for_message(
            &tx,
            &request.terminal_tab_id,
            &cli_id,
            &request.message_id,
            &latest_user_prompt,
            &assistant_summary,
            message.blocks.as_ref(),
            &request.updated_at,
        )?;

        tx.commit().map_err(|err| err.to_string())
    }

    fn index_semantic_chunks_for_message(
        &self,
        conn: &Connection,
        terminal_tab_id: &str,
        cli_id: &str,
        message_id: &str,
        user_prompt: &str,
        assistant_summary: &str,
        blocks: Option<&Vec<ChatMessageBlock>>,
        timestamp: &str,
    ) -> Result<(), String> {
        let insert_sql =
            "INSERT INTO semantic_memory_fts(terminal_tab_id, cli_id, message_id, chunk_type, created_at, content)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)";

        // Index user prompt
        if !user_prompt.trim().is_empty() {
            conn.execute(
                insert_sql,
                params![
                    terminal_tab_id,
                    cli_id,
                    message_id,
                    "user_prompt",
                    timestamp,
                    user_prompt
                ],
            )
            .map_err(|err| err.to_string())?;
        }

        // Index assistant summary
        if !assistant_summary.trim().is_empty() {
            conn.execute(
                insert_sql,
                params![
                    terminal_tab_id,
                    cli_id,
                    message_id,
                    "assistant_summary",
                    timestamp,
                    assistant_summary
                ],
            )
            .map_err(|err| err.to_string())?;
        }

        // Index structured chunks from message blocks
        if let Some(blocks) = blocks {
            for block in blocks {
                let chunk: Option<(&str, String)> = match block {
                    ChatMessageBlock::FileChange {
                        path, change_type, ..
                    } => Some(("file_change", format!("{} file: {}", change_type, path))),
                    ChatMessageBlock::Command {
                        command,
                        exit_code,
                        output,
                        label,
                        ..
                    } => {
                        let status = if *exit_code == Some(0) || exit_code.is_none() {
                            "ok"
                        } else {
                            "failed"
                        };
                        let label_str = if label.trim().is_empty() {
                            command.as_str()
                        } else {
                            label.as_str()
                        };
                        let output_snippet = output
                            .as_ref()
                            .map(|o| truncate_text(o, 300))
                            .unwrap_or_default();
                        Some((
                            "command",
                            format!(
                                "command {}: {}{}",
                                status,
                                label_str,
                                if output_snippet.is_empty() {
                                    String::new()
                                } else {
                                    format!("\n{}", output_snippet)
                                }
                            ),
                        ))
                    }
                    ChatMessageBlock::Tool { tool, summary, .. } => {
                        let summary_text = summary
                            .as_ref()
                            .filter(|s| !s.trim().is_empty())
                            .map(|s| format!(": {}", truncate_text(s, 200)))
                            .unwrap_or_default();
                        Some(("tool_use", format!("tool {}{}", tool, summary_text)))
                    }
                    ChatMessageBlock::Status { text, level } if level == "error" => {
                        Some(("error", format!("error: {}", truncate_text(text, 300))))
                    }
                    ChatMessageBlock::Text { text, .. } if text.len() > 80 => {
                        Some(("text", truncate_text(text, 600)))
                    }
                    _ => None,
                };

                if let Some((chunk_type, content)) = chunk {
                    conn.execute(
                        insert_sql,
                        params![
                            terminal_tab_id,
                            cli_id,
                            message_id,
                            chunk_type,
                            timestamp,
                            content
                        ],
                    )
                    .map_err(|err| err.to_string())?;
                }
            }
        }

        Ok(())
    }

    pub fn semantic_recall(
        &self,
        request: &SemanticRecallRequest,
    ) -> Result<Vec<SemanticMemoryChunk>, String> {
        let conn = self.open_connection()?;
        let limit = request.limit.unwrap_or(20).min(50) as i64;

        // Sanitize FTS5 query: escape special chars and wrap tokens for prefix matching
        let sanitized_query = sanitize_fts5_query(&request.query);
        if sanitized_query.is_empty() {
            return Ok(vec![]);
        }

        let (sql, use_tab_filter) = if request.terminal_tab_id.is_some() {
            (
                "SELECT terminal_tab_id, cli_id, message_id, chunk_type, created_at, content, rank
                 FROM semantic_memory_fts
                 WHERE semantic_memory_fts MATCH ?1
                 ORDER BY rank
                 LIMIT ?2",
                true,
            )
        } else {
            (
                "SELECT terminal_tab_id, cli_id, message_id, chunk_type, created_at, content, rank
                 FROM semantic_memory_fts
                 WHERE semantic_memory_fts MATCH ?1
                 ORDER BY rank
                 LIMIT ?2",
                false,
            )
        };

        let mut stmt = conn.prepare(sql).map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![sanitized_query, limit], |row| {
                Ok(SemanticMemoryChunk {
                    terminal_tab_id: row.get(0)?,
                    cli_id: row.get(1)?,
                    message_id: row.get(2)?,
                    chunk_type: row.get(3)?,
                    created_at: row.get(4)?,
                    content: row.get(5)?,
                    rank: row.get(6)?,
                })
            })
            .map_err(|err| err.to_string())?;

        let all_chunks: Vec<SemanticMemoryChunk> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;

        // Post-filter by terminal_tab_id if specified (UNINDEXED columns can't be WEHREd efficiently)
        if use_tab_filter {
            let tab_id = request.terminal_tab_id.as_deref().unwrap();
            Ok(all_chunks
                .into_iter()
                .filter(|c| c.terminal_tab_id == tab_id)
                .collect())
        } else {
            Ok(all_chunks)
        }
    }

    fn upsert_kernel_session_ref_in_tx(
        &self,
        tx: &Connection,
        task_id: &str,
        terminal_tab_id: &str,
        cli_id: &str,
        transport_kind: Option<String>,
        transport_session: Option<&AgentTransportSession>,
        updated_at: &str,
        exit_code: Option<i32>,
    ) -> Result<(), String> {
        tx.execute(
            "INSERT INTO kernel_session_refs (
                id, task_id, terminal_tab_id, cli_id, transport_kind, native_session_id,
                native_turn_id, model, permission_mode, resume_capable, state, last_sync_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(task_id, terminal_tab_id, cli_id) DO UPDATE SET
                transport_kind = excluded.transport_kind,
                native_session_id = excluded.native_session_id,
                native_turn_id = excluded.native_turn_id,
                model = excluded.model,
                permission_mode = excluded.permission_mode,
                resume_capable = excluded.resume_capable,
                state = excluded.state,
                last_sync_at = excluded.last_sync_at",
            params![
                new_id("ksr"),
                task_id,
                terminal_tab_id,
                cli_id,
                transport_kind,
                transport_session.and_then(|session| session.thread_id.clone()),
                transport_session.and_then(|session| session.turn_id.clone()),
                transport_session.and_then(|session| session.model.clone()),
                transport_session.and_then(|session| session.permission_mode.clone()),
                transport_session
                    .and_then(|session| session.thread_id.as_ref())
                    .map(|value| !value.trim().is_empty())
                    .unwrap_or(false),
                if exit_code == Some(0) {
                    "active"
                } else {
                    "stale"
                },
                updated_at,
            ],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    fn insert_kernel_evidence_in_tx(
        &self,
        tx: &Connection,
        entry: &KernelEvidence,
    ) -> Result<(), String> {
        tx.execute(
            "INSERT INTO kernel_evidence (
                id, task_id, message_id, terminal_tab_id, cli_id, evidence_type, summary, payload_ref, timestamp
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                entry.id,
                entry.task_id,
                entry.message_id,
                entry.terminal_tab_id,
                entry.cli_id,
                entry.evidence_type,
                entry.summary,
                entry.payload_ref,
                entry.timestamp,
            ],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    fn insert_kernel_fact_in_tx(&self, tx: &Connection, fact: &KernelFact) -> Result<(), String> {
        let mut supersedes_ids = Vec::new();
        let mut stmt = tx
            .prepare(
                "SELECT id, statement, status, polarity, confidence, source_evidence_ids_json
                 FROM kernel_facts
                 WHERE task_id = ?1 AND kind = ?2 AND subject = ?3",
            )
            .map_err(|err| err.to_string())?;
        let existing = stmt
            .query_map(params![fact.task_id, fact.kind, fact.subject], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    parse_json_default::<Vec<String>>(row.get::<_, String>(5)?),
                ))
            })
            .map_err(|err| err.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;

        for (
            existing_id,
            existing_statement,
            existing_status,
            existing_polarity,
            existing_confidence,
            existing_evidence_ids,
        ) in existing
        {
            if existing_statement == fact.statement {
                let merged_evidence =
                    merge_string_lists(&existing_evidence_ids, &fact.source_evidence_ids);
                tx.execute(
                    "UPDATE kernel_facts
                     SET status = ?1,
                         confidence = ?2,
                         source_evidence_ids_json = ?3,
                         updated_at = ?4,
                         polarity = ?5,
                         origin = ?6
                     WHERE id = ?7",
                    params![
                        merge_fact_status(&existing_status, &fact.status),
                        merge_fact_confidence(&existing_confidence, &fact.confidence),
                        to_json(&merged_evidence)?,
                        fact.updated_at,
                        fact.polarity,
                        fact.origin,
                        existing_id,
                    ],
                )
                .map_err(|err| err.to_string())?;
                return Ok(());
            }

            if fact.kind == "risk" {
                continue;
            }

            if fact.subject == "general"
                || fact.polarity == "neutral"
                || existing_polarity == "neutral"
            {
                continue;
            }

            let opposite_polarity = fact.polarity != existing_polarity;
            let can_supersede = fact.status == "verified" && fact.confidence == "high";
            let should_downgrade = fact.status == "inferred";

            if opposite_polarity && can_supersede {
                tx.execute(
                    "UPDATE kernel_facts
                     SET status = 'invalidated', updated_at = ?1
                     WHERE id = ?2 AND status != 'invalidated'",
                    params![fact.updated_at, existing_id],
                )
                .map_err(|err| err.to_string())?;
                supersedes_ids.push(existing_id);
            } else if opposite_polarity && should_downgrade {
                tx.execute(
                    "UPDATE kernel_facts
                     SET status = CASE
                         WHEN status = 'verified' THEN 'verified'
                         ELSE 'pending'
                     END,
                     updated_at = ?1
                     WHERE id = ?2 AND status != 'invalidated'",
                    params![fact.updated_at, existing_id],
                )
                .map_err(|err| err.to_string())?;
            }
        }

        tx.execute(
            "INSERT INTO kernel_facts (
                id, task_id, kind, subject, polarity, origin, statement, status,
                source_evidence_ids_json, supersedes_fact_ids_json, owner_cli, confidence, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                fact.id,
                fact.task_id,
                fact.kind,
                fact.subject,
                fact.polarity,
                fact.origin,
                fact.statement,
                fact.status,
                to_json(&fact.source_evidence_ids)?,
                to_json(&supersedes_ids)?,
                fact.owner_cli,
                fact.confidence,
                fact.updated_at,
            ],
        )
        .map_err(|err| err.to_string())?;

        if fact.status == "verified" && fact.confidence == "high" {
            let entry = KernelMemoryEntry {
                id: stable_memory_id("task", &fact.task_id, &fact.kind, &fact.statement),
                scope: "task".to_string(),
                scope_ref: fact.task_id.clone(),
                kind: fact.kind.clone(),
                priority: default_memory_priority_for_kind(&fact.kind).to_string(),
                pin_state: "auto".to_string(),
                content: fact.statement.clone(),
                source_fact_id: Some(fact.id.clone()),
                source_evidence_ids: fact.source_evidence_ids.clone(),
                last_used_at: None,
                use_count: 0,
                tags: default_memory_tags_for_fact(fact),
                decay_eligible: true,
                updated_at: fact.updated_at.clone(),
            };
            self.upsert_kernel_memory_in_tx(tx, &entry)?;
        }

        Ok(())
    }

    fn upsert_kernel_plan_in_tx(&self, tx: &Connection, plan: &KernelPlan) -> Result<(), String> {
        tx.execute(
            "INSERT INTO kernel_plans (
                id, task_id, title, goal, summary, status, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                goal = excluded.goal,
                summary = excluded.summary,
                status = excluded.status,
                updated_at = excluded.updated_at",
            params![
                plan.id,
                plan.task_id,
                plan.title,
                plan.goal,
                plan.summary,
                plan.status,
                plan.updated_at,
            ],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    fn upsert_kernel_work_item_in_tx(
        &self,
        tx: &Connection,
        item: &KernelWorkItem,
    ) -> Result<(), String> {
        tx.execute(
            "INSERT INTO kernel_work_items (
                id, task_id, step_id, owner_cli, title, summary, result, status, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
                summary = excluded.summary,
                result = excluded.result,
                status = excluded.status,
                updated_at = excluded.updated_at",
            params![
                item.id,
                item.task_id,
                item.step_id,
                item.owner_cli,
                item.title,
                item.summary,
                item.result,
                item.status,
                item.updated_at,
            ],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    fn upsert_kernel_memory_in_tx(
        &self,
        tx: &Connection,
        entry: &KernelMemoryEntry,
    ) -> Result<(), String> {
        tx.execute(
            "INSERT INTO kernel_memory_entries (
                id, scope, scope_ref, kind, priority, pin_state, content, source_fact_id,
                source_evidence_ids_json, last_used_at, use_count, tags_json, decay_eligible, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(id) DO UPDATE SET
                priority = excluded.priority,
                pin_state = excluded.pin_state,
                content = excluded.content,
                source_fact_id = excluded.source_fact_id,
                source_evidence_ids_json = excluded.source_evidence_ids_json,
                last_used_at = excluded.last_used_at,
                use_count = excluded.use_count,
                tags_json = excluded.tags_json,
                decay_eligible = excluded.decay_eligible,
                updated_at = excluded.updated_at",
            params![
                entry.id,
                entry.scope,
                entry.scope_ref,
                entry.kind,
                entry.priority,
                entry.pin_state,
                entry.content,
                entry.source_fact_id,
                to_json(&entry.source_evidence_ids)?,
                entry.last_used_at,
                entry.use_count as i64,
                to_json(&entry.tags)?,
                if entry.decay_eligible { 1 } else { 0 },
                entry.updated_at,
            ],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub fn delete_chat_message(&self, request: &MessageDeleteRequest) -> Result<(), String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        tx.execute(
            "DELETE FROM chat_messages WHERE id = ?1 AND terminal_tab_id = ?2",
            params![request.message_id, request.terminal_tab_id],
        )
        .map_err(|err| err.to_string())?;
        tx.execute(
            "UPDATE conversation_sessions SET updated_at = ?1 WHERE terminal_tab_id = ?2",
            params![now_rfc3339(), request.terminal_tab_id],
        )
        .map_err(|err| err.to_string())?;
        self.insert_message_event(
            &tx,
            &request.terminal_tab_id,
            None,
            &request.message_id,
            "delete",
            &request,
            None,
        )?;
        tx.commit().map_err(|err| err.to_string())
    }

    pub fn delete_chat_session_by_tab(&self, terminal_tab_id: &str) -> Result<(), String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        let task_id = tx
            .query_row(
                "SELECT id FROM task_packets WHERE terminal_tab_id = ?1",
                [terminal_tab_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|err| err.to_string())?;

        tx.execute(
            "DELETE FROM message_events WHERE terminal_tab_id = ?1",
            [terminal_tab_id],
        )
        .map_err(|err| err.to_string())?;
        tx.execute(
            "DELETE FROM chat_messages WHERE terminal_tab_id = ?1",
            [terminal_tab_id],
        )
        .map_err(|err| err.to_string())?;
        tx.execute(
            "DELETE FROM conversation_sessions WHERE terminal_tab_id = ?1",
            [terminal_tab_id],
        )
        .map_err(|err| err.to_string())?;

        if let Some(task_id) = task_id {
            tx.execute(
                "DELETE FROM compact_boundaries WHERE task_id = ?1",
                [&task_id],
            )
            .map_err(|err| err.to_string())?;
            tx.execute("DELETE FROM context_packs WHERE task_id = ?1", [&task_id])
                .map_err(|err| err.to_string())?;
            tx.execute(
                "DELETE FROM context_package_logs WHERE task_id = ?1",
                [&task_id],
            )
            .map_err(|err| err.to_string())?;
            tx.execute(
                "DELETE FROM context_snapshots WHERE task_id = ?1",
                [&task_id],
            )
            .map_err(|err| err.to_string())?;
            tx.execute("DELETE FROM handoff_events WHERE task_id = ?1", [&task_id])
                .map_err(|err| err.to_string())?;
            tx.execute("DELETE FROM task_packets WHERE id = ?1", [&task_id])
                .map_err(|err| err.to_string())?;
        }

        tx.commit().map_err(|err| err.to_string())
    }

    pub fn update_chat_message_blocks(
        &self,
        request: &MessageBlocksUpdateRequest,
    ) -> Result<(), String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        tx.execute(
            "UPDATE chat_messages
             SET blocks_json = ?1
             WHERE id = ?2",
            params![option_to_json(&request.blocks)?, request.message_id],
        )
        .map_err(|err| err.to_string())?;
        self.insert_message_event(
            &tx,
            "",
            None,
            &request.message_id,
            "blocks_update",
            &request,
            None,
        )?;
        tx.commit().map_err(|err| err.to_string())
    }

    pub fn save_state(&self, state: &PersistedTerminalState) -> Result<(), String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;

        tx.execute("DELETE FROM terminal_tabs", [])
            .map_err(|err| err.to_string())?;
        tx.execute("DELETE FROM workspaces", [])
            .map_err(|err| err.to_string())?;
        tx.execute("DELETE FROM terminal_state_meta", [])
            .map_err(|err| err.to_string())?;

        for (workspace_order, workspace) in state.workspaces.iter().enumerate() {
            tx.execute(
                "INSERT INTO workspaces (
                    id, name, root_path, location_kind, connection_id, remote_path, location_label, branch, current_writer, active_agent,
                    dirty_files, failing_checks, handoff_ready, last_snapshot, workspace_order
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    workspace.id,
                    workspace.name,
                    workspace.root_path,
                    workspace.location_kind,
                    workspace.connection_id,
                    workspace.remote_path,
                    workspace.location_label,
                    workspace.branch,
                    workspace.current_writer,
                    workspace.active_agent,
                    workspace.dirty_files as i64,
                    workspace.failing_checks as i64,
                    workspace.handoff_ready,
                    workspace.last_snapshot,
                    workspace_order as i64,
                ],
            )
            .map_err(|err| err.to_string())?;
        }

        for (tab_order, tab) in state.terminal_tabs.iter().enumerate() {
            tx.execute(
                "INSERT INTO terminal_tabs (
                    id, title, workspace_id, selected_cli, selected_agent_json, plan_mode, fast_mode, effort_level,
                    model_overrides_json, permission_overrides_json, transport_sessions_json,
                    context_boundaries_by_cli_json, draft_prompt, draft_attachments_json,
                    status, last_active_at, tab_order
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                params![
                    tab.id,
                    tab.title,
                    tab.workspace_id,
                    tab.selected_cli,
                    option_to_json(&tab.selected_agent)?,
                    tab.plan_mode,
                    tab.fast_mode,
                    tab.effort_level,
                    to_json(&tab.model_overrides)?,
                    to_json(&tab.permission_overrides)?,
                    to_json(&tab.transport_sessions)?,
                    to_json(&tab.context_boundaries_by_cli)?,
                    tab.draft_prompt,
                    to_json(&tab.draft_attachments)?,
                    tab.status,
                    tab.last_active_at,
                    tab_order as i64,
                ],
            )
            .map_err(|err| err.to_string())?;
        }

        tx.execute(
            "INSERT INTO terminal_state_meta (id, active_terminal_tab_id, updated_at)
             VALUES (1, ?1, datetime('now'))",
            params![state.active_terminal_tab_id],
        )
        .map_err(|err| err.to_string())?;

        tx.commit().map_err(|err| err.to_string())
    }

    fn open_connection(&self) -> Result<Connection, String> {
        let conn = Connection::open(&self.db_path).map_err(|err| err.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|err| err.to_string())?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|err| err.to_string())?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|err| err.to_string())?;
        conn.pragma_update(None, "temp_store", "MEMORY")
            .map_err(|err| err.to_string())?;
        self.init_schema(&conn)?;
        Ok(conn)
    }

    fn init_schema(&self, conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                root_path TEXT NOT NULL,
                location_kind TEXT NOT NULL DEFAULT 'local',
                connection_id TEXT,
                remote_path TEXT,
                location_label TEXT,
                branch TEXT NOT NULL,
                current_writer TEXT NOT NULL,
                active_agent TEXT NOT NULL,
                dirty_files INTEGER NOT NULL,
                failing_checks INTEGER NOT NULL,
                handoff_ready INTEGER NOT NULL,
                last_snapshot TEXT,
                workspace_order INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS terminal_tabs (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                selected_cli TEXT NOT NULL,
                selected_agent_json TEXT,
                plan_mode INTEGER NOT NULL,
                fast_mode INTEGER NOT NULL,
                effort_level TEXT,
                model_overrides_json TEXT NOT NULL,
                permission_overrides_json TEXT NOT NULL,
                transport_sessions_json TEXT NOT NULL,
                context_boundaries_by_cli_json TEXT NOT NULL DEFAULT '{}',
                draft_prompt TEXT NOT NULL,
                draft_attachments_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL,
                last_active_at TEXT NOT NULL,
                tab_order INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS conversation_sessions (
                id TEXT PRIMARY KEY,
                terminal_tab_id TEXT NOT NULL UNIQUE,
                workspace_id TEXT NOT NULL,
                project_root TEXT NOT NULL,
                project_name TEXT NOT NULL,
                compacted_summaries_json TEXT NOT NULL DEFAULT '[]',
                last_compacted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                terminal_tab_id TEXT NOT NULL,
                message_order INTEGER NOT NULL,
                role TEXT NOT NULL,
                cli_id TEXT,
                selected_agent_json TEXT,
                automation_run_id TEXT,
                workflow_run_id TEXT,
                workflow_node_id TEXT,
                timestamp TEXT NOT NULL,
                content TEXT NOT NULL,
                raw_content TEXT,
                content_format TEXT,
                transport_kind TEXT,
                blocks_json TEXT,
                attachments_json TEXT NOT NULL DEFAULT '[]',
                is_streaming INTEGER NOT NULL,
                duration_ms INTEGER,
                exit_code INTEGER
            );

            CREATE TABLE IF NOT EXISTS message_events (
                id TEXT PRIMARY KEY,
                terminal_tab_id TEXT NOT NULL,
                session_id TEXT,
                message_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS terminal_state_meta (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                active_terminal_tab_id TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS task_packets (
                id TEXT PRIMARY KEY,
                terminal_tab_id TEXT NOT NULL UNIQUE,
                workspace_id TEXT NOT NULL,
                project_root TEXT NOT NULL,
                project_name TEXT NOT NULL,
                title TEXT NOT NULL,
                goal TEXT NOT NULL,
                status TEXT NOT NULL,
                current_owner_cli TEXT NOT NULL,
                latest_conclusion TEXT,
                open_questions_json TEXT NOT NULL,
                risks_json TEXT NOT NULL,
                next_step TEXT,
                relevant_files_json TEXT NOT NULL,
                relevant_commands_json TEXT NOT NULL,
                linked_session_ids_json TEXT NOT NULL,
                latest_snapshot_id TEXT,
                updated_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS handoff_events (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                terminal_tab_id TEXT NOT NULL,
                from_cli TEXT NOT NULL,
                to_cli TEXT NOT NULL,
                reason TEXT,
                latest_conclusion TEXT,
                files_json TEXT NOT NULL,
                risks_json TEXT NOT NULL,
                next_step TEXT,
                payload_json TEXT,
                delivery_state TEXT NOT NULL DEFAULT 'delivered',
                delivered_at TEXT,
                delivered_message_id TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS context_snapshots (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                trigger_reason TEXT NOT NULL,
                summary TEXT NOT NULL,
                facts_confirmed_json TEXT NOT NULL,
                work_completed_json TEXT NOT NULL,
                files_touched_json TEXT NOT NULL,
                commands_run_json TEXT NOT NULL,
                failures_json TEXT NOT NULL,
                open_questions_json TEXT NOT NULL,
                next_step TEXT,
                source_user_prompt TEXT,
                source_assistant_summary TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS context_packs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                terminal_tab_id TEXT NOT NULL,
                start_message_id TEXT NOT NULL,
                end_message_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                summary TEXT NOT NULL,
                approx_chars INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS context_package_logs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                target_cli TEXT NOT NULL,
                profile_id TEXT NOT NULL,
                included_layers_json TEXT NOT NULL,
                included_pack_ids_json TEXT NOT NULL,
                approx_chars INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS compact_boundaries (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                terminal_tab_id TEXT NOT NULL,
                boundary_message_id TEXT NOT NULL,
                snapshot_id TEXT NOT NULL,
                trigger_reason TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS compacted_summaries (
                id TEXT PRIMARY KEY,
                terminal_tab_id TEXT NOT NULL,
                source_cli TEXT NOT NULL,
                intent TEXT NOT NULL DEFAULT '',
                technical_context TEXT NOT NULL DEFAULT '',
                changed_files TEXT NOT NULL DEFAULT '[]',
                errors_and_fixes TEXT NOT NULL DEFAULT '',
                current_state TEXT NOT NULL DEFAULT '',
                next_steps TEXT NOT NULL DEFAULT '',
                token_estimate INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS kernel_session_refs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                terminal_tab_id TEXT NOT NULL,
                cli_id TEXT NOT NULL,
                transport_kind TEXT,
                native_session_id TEXT,
                native_turn_id TEXT,
                model TEXT,
                permission_mode TEXT,
                resume_capable INTEGER NOT NULL DEFAULT 0,
                state TEXT NOT NULL,
                last_sync_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_kernel_session_refs_task_tab_cli
                ON kernel_session_refs(task_id, terminal_tab_id, cli_id);

            CREATE TABLE IF NOT EXISTS kernel_facts (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                subject TEXT NOT NULL DEFAULT 'general',
                polarity TEXT NOT NULL DEFAULT 'neutral',
                origin TEXT NOT NULL DEFAULT 'assistant',
                statement TEXT NOT NULL,
                status TEXT NOT NULL,
                source_evidence_ids_json TEXT NOT NULL,
                supersedes_fact_ids_json TEXT NOT NULL DEFAULT '[]',
                owner_cli TEXT NOT NULL,
                confidence TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS kernel_evidence (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                terminal_tab_id TEXT NOT NULL,
                cli_id TEXT NOT NULL,
                evidence_type TEXT NOT NULL,
                summary TEXT NOT NULL,
                payload_ref TEXT,
                timestamp TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS kernel_plans (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                title TEXT NOT NULL,
                goal TEXT NOT NULL,
                summary TEXT,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS kernel_work_items (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                step_id TEXT,
                owner_cli TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT,
                result TEXT,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS kernel_memory_entries (
                id TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                scope_ref TEXT NOT NULL,
                kind TEXT NOT NULL,
                priority TEXT NOT NULL DEFAULT 'medium',
                pin_state TEXT NOT NULL DEFAULT 'auto',
                content TEXT NOT NULL,
                source_fact_id TEXT,
                source_evidence_ids_json TEXT NOT NULL,
                last_used_at TEXT,
                use_count INTEGER NOT NULL DEFAULT 0,
                tags_json TEXT NOT NULL DEFAULT '[]',
                decay_eligible INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_terminal_tabs_workspace ON terminal_tabs(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session_order
                ON chat_messages(session_id, message_order);
            CREATE INDEX IF NOT EXISTS idx_chat_messages_tab_timestamp
                ON chat_messages(terminal_tab_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_message_events_tab_created
                ON message_events(terminal_tab_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_message_events_message_created
                ON message_events(message_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_task_packets_workspace ON task_packets(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_handoff_events_task_created
                ON handoff_events(task_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_context_snapshots_task_created
                ON context_snapshots(task_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_context_packs_task_created
                ON context_packs(task_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_context_package_logs_task_created
                ON context_package_logs(task_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_compact_boundaries_task_created
                ON compact_boundaries(task_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_compacted_summaries_tab
                ON compacted_summaries(terminal_tab_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_kernel_facts_task_updated
                ON kernel_facts(task_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_kernel_evidence_task_timestamp
                ON kernel_evidence(task_id, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_kernel_plans_task_updated
                ON kernel_plans(task_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_kernel_work_items_task_updated
                ON kernel_work_items(task_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_kernel_memory_scope_updated
                ON kernel_memory_entries(scope, scope_ref, updated_at DESC);
            ",
        )
        .map_err(|err| err.to_string())?;

        // FTS5 virtual table for semantic memory search (Mem0-inspired)
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS semantic_memory_fts USING fts5(
                terminal_tab_id UNINDEXED,
                cli_id UNINDEXED,
                message_id UNINDEXED,
                chunk_type UNINDEXED,
                created_at UNINDEXED,
                content,
                tokenize='porter unicode61'
            );",
        )
        .map_err(|err| err.to_string())?;

        ensure_column_exists(conn, "chat_messages", "automation_run_id", "TEXT")?;
        ensure_column_exists(conn, "chat_messages", "workflow_run_id", "TEXT")?;
        ensure_column_exists(conn, "chat_messages", "workflow_node_id", "TEXT")?;
        ensure_column_exists(conn, "terminal_tabs", "selected_agent_json", "TEXT")?;
        ensure_column_exists(
            conn,
            "terminal_tabs",
            "context_boundaries_by_cli_json",
            "TEXT NOT NULL DEFAULT '{}'",
        )?;
        ensure_column_exists(
            conn,
            "terminal_tabs",
            "draft_attachments_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        ensure_column_exists(
            conn,
            "workspaces",
            "location_kind",
            "TEXT NOT NULL DEFAULT 'local'",
        )?;
        ensure_column_exists(conn, "workspaces", "connection_id", "TEXT")?;
        ensure_column_exists(conn, "workspaces", "remote_path", "TEXT")?;
        ensure_column_exists(conn, "workspaces", "location_label", "TEXT")?;
        ensure_column_exists(
            conn,
            "chat_messages",
            "selected_agent_json",
            "TEXT",
        )?;
        ensure_column_exists(
            conn,
            "chat_messages",
            "attachments_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        ensure_column_exists(conn, "handoff_events", "payload_json", "TEXT")?;
        ensure_column_exists(
            conn,
            "handoff_events",
            "delivery_state",
            "TEXT NOT NULL DEFAULT 'delivered'",
        )?;
        ensure_column_exists(conn, "handoff_events", "delivered_at", "TEXT")?;
        ensure_column_exists(conn, "handoff_events", "delivered_message_id", "TEXT")?;

        ensure_column_exists(
            conn,
            "kernel_facts",
            "subject",
            "TEXT NOT NULL DEFAULT 'general'",
        )?;
        ensure_column_exists(
            conn,
            "kernel_facts",
            "polarity",
            "TEXT NOT NULL DEFAULT 'neutral'",
        )?;
        ensure_column_exists(
            conn,
            "kernel_facts",
            "origin",
            "TEXT NOT NULL DEFAULT 'assistant'",
        )?;
        ensure_column_exists(
            conn,
            "kernel_facts",
            "supersedes_fact_ids_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;

        ensure_column_exists(
            conn,
            "kernel_memory_entries",
            "priority",
            "TEXT NOT NULL DEFAULT 'medium'",
        )?;
        ensure_column_exists(
            conn,
            "kernel_memory_entries",
            "pin_state",
            "TEXT NOT NULL DEFAULT 'auto'",
        )?;
        ensure_column_exists(conn, "kernel_memory_entries", "last_used_at", "TEXT")?;
        ensure_column_exists(
            conn,
            "kernel_memory_entries",
            "use_count",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column_exists(
            conn,
            "kernel_memory_entries",
            "tags_json",
            "TEXT NOT NULL DEFAULT '[]'",
        )?;
        ensure_column_exists(
            conn,
            "kernel_memory_entries",
            "decay_eligible",
            "INTEGER NOT NULL DEFAULT 1",
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_kernel_facts_task_kind_subject
             ON kernel_facts(task_id, kind, subject, updated_at DESC)",
            [],
        )
        .map_err(|err| err.to_string())?;

        Ok(())
    }

    fn load_workspaces(&self, conn: &Connection) -> Result<Vec<PersistedWorkspaceRef>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, root_path, location_kind, connection_id, remote_path, location_label,
                        branch, current_writer, active_agent, dirty_files, failing_checks, handoff_ready, last_snapshot
                 FROM workspaces
                 ORDER BY workspace_order ASC",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(PersistedWorkspaceRef {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    root_path: row.get(2)?,
                    location_kind: row.get(3)?,
                    connection_id: row.get(4)?,
                    remote_path: row.get(5)?,
                    location_label: row.get(6)?,
                    branch: row.get(7)?,
                    current_writer: row.get(8)?,
                    active_agent: row.get(9)?,
                    dirty_files: row.get::<_, i64>(10)? as usize,
                    failing_checks: row.get::<_, i64>(11)? as usize,
                    handoff_ready: row.get(12)?,
                    last_snapshot: row.get(13)?,
                })
            })
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    pub fn load_workspace_ref_by_id(
        &self,
        workspace_id: &str,
    ) -> Result<Option<PersistedWorkspaceRef>, String> {
        let conn = self.open_connection()?;
        conn.query_row(
            "SELECT id, name, root_path, location_kind, connection_id, remote_path, location_label,
                    branch, current_writer, active_agent, dirty_files, failing_checks, handoff_ready, last_snapshot
             FROM workspaces
             WHERE id = ?1
             LIMIT 1",
            [workspace_id],
            |row| {
                Ok(PersistedWorkspaceRef {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    root_path: row.get(2)?,
                    location_kind: row.get(3)?,
                    connection_id: row.get(4)?,
                    remote_path: row.get(5)?,
                    location_label: row.get(6)?,
                    branch: row.get(7)?,
                    current_writer: row.get(8)?,
                    active_agent: row.get(9)?,
                    dirty_files: row.get::<_, i64>(10)? as usize,
                    failing_checks: row.get::<_, i64>(11)? as usize,
                    handoff_ready: row.get(12)?,
                    last_snapshot: row.get(13)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
    }

    fn load_terminal_tabs(&self, conn: &Connection) -> Result<Vec<PersistedTerminalTab>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, workspace_id, selected_cli, selected_agent_json, plan_mode, fast_mode, effort_level,
                        model_overrides_json, permission_overrides_json, transport_sessions_json,
                        context_boundaries_by_cli_json, draft_prompt, draft_attachments_json,
                        status, last_active_at
                 FROM terminal_tabs
                 ORDER BY tab_order ASC",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(PersistedTerminalTab {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    workspace_id: row.get(2)?,
                    selected_cli: row.get(3)?,
                    selected_agent: row
                        .get::<_, Option<String>>(4)?
                        .and_then(|raw| serde_json::from_str::<SelectedCustomAgent>(&raw).ok()),
                    plan_mode: row.get(5)?,
                    fast_mode: row.get(6)?,
                    effort_level: row.get(7)?,
                    model_overrides: parse_json_default(row.get::<_, String>(8)?),
                    permission_overrides: parse_json_default(row.get::<_, String>(9)?),
                    transport_sessions: parse_json_default(row.get::<_, String>(10)?),
                    context_boundaries_by_cli: parse_json_default(row.get::<_, String>(11)?),
                    draft_prompt: row.get(12)?,
                    draft_attachments: parse_json_default(row.get::<_, String>(13)?),
                    status: row.get(14)?,
                    last_active_at: row.get(15)?,
                })
            })
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    fn load_chat_sessions(
        &self,
        conn: &Connection,
    ) -> Result<BTreeMap<String, PersistedConversationSession>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, terminal_tab_id, workspace_id, project_root, project_name,
                        compacted_summaries_json, last_compacted_at, created_at, updated_at
                 FROM conversation_sessions",
            )
            .map_err(|err| err.to_string())?;
        let mut rows = stmt.query([]).map_err(|err| err.to_string())?;
        let mut sessions = BTreeMap::new();

        while let Some(row) = rows.next().map_err(|err| err.to_string())? {
            let session_id: String = row.get(0).map_err(|err| err.to_string())?;
            let terminal_tab_id: String = row.get(1).map_err(|err| err.to_string())?;
            let compacted_json: String = row.get(5).map_err(|err| err.to_string())?;
            let compacted_summaries: Vec<CompactedSummary> =
                serde_json::from_str(&compacted_json).unwrap_or_default();
            let session = PersistedConversationSession {
                id: session_id.clone(),
                terminal_tab_id: terminal_tab_id.clone(),
                workspace_id: row.get(2).map_err(|err| err.to_string())?,
                project_root: row.get(3).map_err(|err| err.to_string())?,
                project_name: row.get(4).map_err(|err| err.to_string())?,
                compacted_summaries,
                last_compacted_at: row.get(6).map_err(|err| err.to_string())?,
                messages: self.load_messages(conn, &session_id)?,
                created_at: row.get(7).map_err(|err| err.to_string())?,
                updated_at: row.get(8).map_err(|err| err.to_string())?,
            };
            sessions.insert(terminal_tab_id, session);
        }

        Ok(sessions)
    }

    fn load_messages(
        &self,
        conn: &Connection,
        session_id: &str,
    ) -> Result<Vec<PersistedChatMessage>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, role, cli_id, selected_agent_json, automation_run_id, workflow_run_id, workflow_node_id,
                        timestamp, content, raw_content, content_format,
                        transport_kind, blocks_json, attachments_json, is_streaming, duration_ms, exit_code
                 FROM chat_messages
                 WHERE session_id = ?1
                 ORDER BY message_order ASC",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map([session_id], |row| {
                let blocks_json = row.get::<_, Option<String>>(12)?;
                let attachments_json = row.get::<_, String>(13)?;
                Ok(PersistedChatMessage {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    cli_id: row.get(2)?,
                    selected_agent: row
                        .get::<_, Option<String>>(3)?
                        .and_then(|raw| serde_json::from_str::<SelectedCustomAgent>(&raw).ok()),
                    automation_run_id: row.get(4)?,
                    workflow_run_id: row.get(5)?,
                    workflow_node_id: row.get(6)?,
                    timestamp: row.get(7)?,
                    content: row.get(8)?,
                    raw_content: row.get(9)?,
                    content_format: row.get(10)?,
                    transport_kind: row.get(11)?,
                    blocks: blocks_json
                        .as_deref()
                        .and_then(|raw| serde_json::from_str::<Vec<ChatMessageBlock>>(raw).ok()),
                    attachments: parse_json_default(attachments_json),
                    is_streaming: row.get(14)?,
                    duration_ms: row.get::<_, Option<i64>>(15)?.map(|value| value as u64),
                    exit_code: row.get(16)?,
                })
            })
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    fn load_chat_session_by_terminal_tab(
        &self,
        conn: &Connection,
        terminal_tab_id: &str,
    ) -> Result<Option<PersistedConversationSession>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, terminal_tab_id, workspace_id, project_root, project_name,
                        compacted_summaries_json, last_compacted_at, created_at, updated_at
                 FROM conversation_sessions
                 WHERE terminal_tab_id = ?1
                 LIMIT 1",
            )
            .map_err(|err| err.to_string())?;
        let mut rows = stmt
            .query([terminal_tab_id])
            .map_err(|err| err.to_string())?;
        let Some(row) = rows.next().map_err(|err| err.to_string())? else {
            return Ok(None);
        };
        let session_id: String = row.get(0).map_err(|err| err.to_string())?;
        let compacted_json: String = row.get(5).map_err(|err| err.to_string())?;
        let compacted_summaries: Vec<CompactedSummary> =
            serde_json::from_str(&compacted_json).unwrap_or_default();
        Ok(Some(PersistedConversationSession {
            id: session_id.clone(),
            terminal_tab_id: row.get(1).map_err(|err| err.to_string())?,
            workspace_id: row.get(2).map_err(|err| err.to_string())?,
            project_root: row.get(3).map_err(|err| err.to_string())?,
            project_name: row.get(4).map_err(|err| err.to_string())?,
            compacted_summaries,
            last_compacted_at: row.get(6).map_err(|err| err.to_string())?,
            messages: self.load_messages(conn, &session_id)?,
            created_at: row.get(7).map_err(|err| err.to_string())?,
            updated_at: row.get(8).map_err(|err| err.to_string())?,
        }))
    }

    fn load_prompt_turns_for_task(
        &self,
        conn: &Connection,
        task: &TaskPacket,
        limit: usize,
    ) -> Result<Vec<CompletedTurn>, String> {
        let Some(session) = self.load_chat_session_by_terminal_tab(conn, &task.terminal_tab_id)?
        else {
            return Ok(Vec::new());
        };
        let turns =
            extract_completed_turns_from_messages(&session.messages, &task.current_owner_cli);
        let boundary = self.load_latest_boundary_for_task(conn, &task.id)?;
        let filtered = if let Some(boundary) = boundary {
            if let Some(index) = turns
                .iter()
                .position(|turn| turn.user_message_id == boundary.boundary_message_id)
            {
                turns.into_iter().skip(index).collect::<Vec<_>>()
            } else {
                turns
            }
        } else {
            turns
        };
        if filtered.len() > limit {
            Ok(filtered[filtered.len() - limit..].to_vec())
        } else {
            Ok(filtered)
        }
    }

    pub fn ensure_task_bundle(
        &self,
        request: &EnsureTaskPacketRequest,
    ) -> Result<TaskContextBundle, String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        let task = self.ensure_task_packet_in_tx(&tx, request)?;
        let latest_handoff = self.load_latest_handoff_for_task(&tx, &task.id)?;
        let latest_snapshot = self.load_latest_snapshot_for_task(&tx, &task.id)?;
        let latest_boundary = self.load_latest_boundary_for_task(&tx, &task.id)?;
        tx.commit().map_err(|err| err.to_string())?;
        Ok(TaskContextBundle {
            task_packet: task,
            latest_handoff,
            latest_snapshot,
            latest_boundary,
        })
    }

    pub fn switch_cli_for_task(
        &self,
        request: &CliHandoffStorageRequest,
    ) -> Result<TaskContextBundle, String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;

        let mut task = self.ensure_task_packet_in_tx(
            &tx,
            &EnsureTaskPacketRequest {
                terminal_tab_id: request.terminal_tab_id.clone(),
                workspace_id: request.workspace_id.clone(),
                project_root: request.project_root.clone(),
                project_name: request.project_name.clone(),
                cli_id: request.from_cli.clone(),
                initial_goal: request
                    .latest_user_prompt
                    .clone()
                    .unwrap_or_else(|| format!("Continue work in {}", request.project_name)),
            },
        )?;

        if request.from_cli != request.to_cli {
            let now = now_rfc3339();
            let active_plan = self.load_kernel_plan_for_task(&tx, &task.id)?;
            let work_items = self.load_kernel_work_items_for_task(&tx, &task.id, 8)?;
            let current_work_item = select_current_work_item(&work_items);
            let latest_conclusion = request
                .latest_assistant_summary
                .clone()
                .or_else(|| {
                    current_work_item
                        .as_ref()
                        .and_then(|item| item.summary.clone())
                })
                .or_else(|| active_plan.as_ref().and_then(|plan| plan.summary.clone()))
                .or_else(|| task.latest_conclusion.clone());
            let merged_files = merge_string_lists(&task.relevant_files, &request.relevant_files);
            let next_step = Some(
                current_work_item
                    .as_ref()
                    .map(|item| {
                        format!("Continue work item '{}' in {}.", item.title, request.to_cli)
                    })
                    .or_else(|| task.next_step.clone())
                    .unwrap_or_else(|| format!("Continue the active task in {}.", request.to_cli)),
            );

            tx.execute(
                "UPDATE handoff_events
                 SET delivery_state = 'superseded'
                 WHERE task_id = ?1 AND delivery_state = 'pending'",
                params![task.id],
            )
            .map_err(|err| err.to_string())?;

            tx.execute(
                "INSERT INTO handoff_events (
                    id, task_id, terminal_tab_id, from_cli, to_cli, reason, latest_conclusion,
                    files_json, risks_json, next_step, payload_json, delivery_state,
                    delivered_at, delivered_message_id, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    new_id("handoff"),
                    task.id,
                    request.terminal_tab_id,
                    request.from_cli,
                    request.to_cli,
                    request.reason,
                    latest_conclusion,
                    to_json(&merged_files)?,
                    to_json(&task.risks)?,
                    next_step,
                    request.handoff_payload_json,
                    "pending",
                    Option::<String>::None,
                    Option::<String>::None,
                    now,
                ],
            )
            .map_err(|err| err.to_string())?;

            tx.execute(
                "UPDATE task_packets
                 SET current_owner_cli = ?1,
                     latest_conclusion = ?2,
                     relevant_files_json = ?3,
                     next_step = ?4,
                     updated_at = ?5
                 WHERE id = ?6",
                params![
                    request.to_cli,
                    latest_conclusion,
                    to_json(&merged_files)?,
                    next_step,
                    now,
                    task.id,
                ],
            )
            .map_err(|err| err.to_string())?;

            task.current_owner_cli = request.to_cli.clone();
            task.latest_conclusion = request
                .latest_assistant_summary
                .clone()
                .or(task.latest_conclusion);
            task.relevant_files = merged_files;
            task.next_step = Some(format!("Continue the active task in {}.", request.to_cli));
            task.updated_at = now;
        }

        let latest_handoff = self.load_latest_handoff_for_task(&tx, &task.id)?;
        let latest_snapshot = self.load_latest_snapshot_for_task(&tx, &task.id)?;
        let latest_boundary = self.load_latest_boundary_for_task(&tx, &task.id)?;
        tx.commit().map_err(|err| err.to_string())?;
        Ok(TaskContextBundle {
            task_packet: task,
            latest_handoff,
            latest_snapshot,
            latest_boundary,
        })
    }

    pub fn record_turn_progress(
        &self,
        update: &TaskTurnUpdate,
    ) -> Result<TaskContextBundle, String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;

        let mut task = self.ensure_task_packet_in_tx(
            &tx,
            &EnsureTaskPacketRequest {
                terminal_tab_id: update.terminal_tab_id.clone(),
                workspace_id: update.workspace_id.clone(),
                project_root: update.project_root.clone(),
                project_name: update.project_name.clone(),
                cli_id: update.cli_id.clone(),
                initial_goal: update.user_prompt.clone(),
            },
        )?;

        let now = now_rfc3339();
        let merged_files = merge_string_lists(&task.relevant_files, &update.relevant_files);
        let next_step = if update.exit_code == Some(0) {
            Some(
                "Continue the active task or switch to another CLI for a focused follow-up."
                    .to_string(),
            )
        } else {
            Some("Investigate the latest failure, update the task summary, and retry with the best-suited CLI.".to_string())
        };

        let snapshot = ContextSnapshot {
            id: new_id("snapshot"),
            task_id: task.id.clone(),
            trigger_reason: if update.exit_code == Some(0) {
                "turn_complete".to_string()
            } else {
                "turn_failure".to_string()
            },
            summary: build_snapshot_summary(&task, update),
            facts_confirmed: if update.assistant_summary.trim().is_empty() {
                Vec::new()
            } else {
                vec![update.assistant_summary.clone()]
            },
            work_completed: if update.exit_code == Some(0)
                && !update.assistant_summary.trim().is_empty()
            {
                vec![update.assistant_summary.clone()]
            } else {
                Vec::new()
            },
            files_touched: merged_files.clone(),
            commands_run: Vec::new(),
            failures: if update.exit_code == Some(0) || update.assistant_summary.trim().is_empty() {
                Vec::new()
            } else {
                vec![update.assistant_summary.clone()]
            },
            open_questions: task.open_questions.clone(),
            next_step: next_step.clone(),
            source_user_prompt: Some(update.user_prompt.clone()),
            source_assistant_summary: Some(update.assistant_summary.clone()),
            created_at: now.clone(),
        };

        tx.execute(
            "INSERT INTO context_snapshots (
                id, task_id, trigger_reason, summary, facts_confirmed_json, work_completed_json,
                files_touched_json, commands_run_json, failures_json, open_questions_json,
                next_step, source_user_prompt, source_assistant_summary, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                snapshot.id,
                snapshot.task_id,
                snapshot.trigger_reason,
                snapshot.summary,
                to_json(&snapshot.facts_confirmed)?,
                to_json(&snapshot.work_completed)?,
                to_json(&snapshot.files_touched)?,
                to_json(&snapshot.commands_run)?,
                to_json(&snapshot.failures)?,
                to_json(&snapshot.open_questions)?,
                snapshot.next_step,
                snapshot.source_user_prompt,
                snapshot.source_assistant_summary,
                snapshot.created_at,
            ],
        )
        .map_err(|err| err.to_string())?;

        tx.execute(
            "UPDATE task_packets
             SET current_owner_cli = ?1,
                 latest_conclusion = ?2,
                 next_step = ?3,
                 relevant_files_json = ?4,
                 latest_snapshot_id = ?5,
                 updated_at = ?6
             WHERE id = ?7",
            params![
                update.cli_id,
                update.assistant_summary,
                next_step,
                to_json(&merged_files)?,
                snapshot.id,
                now,
                task.id,
            ],
        )
        .map_err(|err| err.to_string())?;

        task.current_owner_cli = update.cli_id.clone();
        task.latest_conclusion = Some(update.assistant_summary.clone());
        task.next_step = next_step;
        task.relevant_files = merged_files;
        task.latest_snapshot_id = Some(snapshot.id.clone());
        task.updated_at = now;

        let latest_handoff = self.load_latest_handoff_for_task(&tx, &task.id)?;
        let latest_boundary = self.load_latest_boundary_for_task(&tx, &task.id)?;
        tx.commit().map_err(|err| err.to_string())?;

        Ok(TaskContextBundle {
            task_packet: task,
            latest_handoff,
            latest_snapshot: Some(snapshot),
            latest_boundary,
        })
    }

    pub fn load_task_context_bundle(
        &self,
        terminal_tab_id: &str,
    ) -> Result<Option<TaskContextBundle>, String> {
        let conn = self.open_connection()?;
        let Some(task) = self.load_task_packet_by_terminal_tab(&conn, terminal_tab_id)? else {
            return Ok(None);
        };
        let latest_handoff = self.load_latest_handoff_for_task(&conn, &task.id)?;
        let latest_snapshot = self.load_latest_snapshot_for_task(&conn, &task.id)?;
        let latest_boundary = self.load_latest_boundary_for_task(&conn, &task.id)?;
        Ok(Some(TaskContextBundle {
            task_packet: task,
            latest_handoff,
            latest_snapshot,
            latest_boundary,
        }))
    }

    pub fn load_task_kernel_by_terminal_tab(
        &self,
        terminal_tab_id: &str,
    ) -> Result<Option<TaskKernel>, String> {
        let conn = self.open_connection()?;
        let Some(task) = self.load_task_packet_by_terminal_tab(&conn, terminal_tab_id)? else {
            return Ok(None);
        };
        let latest_handoff = self.load_latest_handoff_for_task(&conn, &task.id)?;
        let latest_checkpoint = self.load_latest_snapshot_for_task(&conn, &task.id)?;
        let active_plan = self.load_kernel_plan_for_task(&conn, &task.id)?;
        let work_items = self.load_kernel_work_items_for_task(&conn, &task.id, 24)?;
        let current_work_item = select_current_work_item(&work_items);
        let mut memory_entries = self.load_kernel_memory_for_scope(&conn, "task", &task.id, 12)?;
        let workspace_memory =
            self.load_kernel_memory_for_scope(&conn, "workspace", &task.workspace_id, 8)?;
        memory_entries.extend(workspace_memory);
        let global_memory = self.load_kernel_memory_for_scope(&conn, "global", "global", 8)?;
        memory_entries.extend(global_memory);
        let session_refs = self.load_kernel_session_refs_for_task(&conn, &task.id)?;
        let facts = self.load_kernel_facts_for_task(&conn, &task.id, 24)?;
        let evidence = self.load_kernel_evidence_for_task(&conn, &task.id, 36)?;

        Ok(Some(TaskKernel {
            task_packet: task,
            latest_handoff,
            latest_checkpoint,
            active_plan,
            work_items,
            current_work_item,
            memory_entries,
            session_refs,
            facts,
            evidence,
        }))
    }

    pub fn mark_kernel_fact_status(
        &self,
        fact_id: &str,
        status: &str,
    ) -> Result<Option<TaskKernel>, String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        let task_row = tx
            .query_row(
                "SELECT task_id FROM kernel_facts WHERE id = ?1",
                [fact_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|err| err.to_string())?;
        let Some(task_id) = task_row else {
            tx.commit().map_err(|err| err.to_string())?;
            return Ok(None);
        };
        tx.execute(
            "UPDATE kernel_facts SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now_rfc3339(), fact_id],
        )
        .map_err(|err| err.to_string())?;
        let terminal_tab_id = self
            .load_terminal_tab_id_for_task(&tx, &task_id)?
            .ok_or_else(|| "Task kernel not found.".to_string())?;
        tx.commit().map_err(|err| err.to_string())?;
        self.load_task_kernel_by_terminal_tab(&terminal_tab_id)
    }

    pub fn pin_kernel_memory(&self, fact_id: &str) -> Result<Option<TaskKernel>, String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        let fact = tx
            .query_row(
                "SELECT id, task_id, kind, statement, source_evidence_ids_json FROM kernel_facts WHERE id = ?1",
                [fact_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        parse_json_default::<Vec<String>>(row.get::<_, String>(4)?),
                    ))
                },
            )
            .optional()
            .map_err(|err| err.to_string())?;
        let Some((fact_id_value, task_id, kind, statement, source_evidence_ids)) = fact else {
            tx.commit().map_err(|err| err.to_string())?;
            return Ok(None);
        };
        let terminal_tab_id = self
            .load_terminal_tab_id_for_task(&tx, &task_id)?
            .ok_or_else(|| "Task kernel not found.".to_string())?;
        let task = self
            .load_task_packet_by_terminal_tab(&tx, &terminal_tab_id)?
            .ok_or_else(|| "Task packet not found.".to_string())?;
        let task_entry = KernelMemoryEntry {
            id: stable_memory_id("task", &task_id, &kind, &statement),
            scope: "task".to_string(),
            scope_ref: task_id.clone(),
            kind: kind.clone(),
            priority: "high".to_string(),
            pin_state: "manual".to_string(),
            content: statement.clone(),
            source_fact_id: Some(fact_id_value.clone()),
            source_evidence_ids: source_evidence_ids.clone(),
            last_used_at: None,
            use_count: 0,
            tags: default_memory_tags_from_kind(&kind),
            decay_eligible: false,
            updated_at: now_rfc3339(),
        };
        self.upsert_kernel_memory_in_tx(&tx, &task_entry)?;
        let workspace_entry = KernelMemoryEntry {
            id: stable_memory_id("workspace", &task.workspace_id, &kind, &statement),
            scope: "workspace".to_string(),
            scope_ref: task.workspace_id.clone(),
            kind,
            priority: "high".to_string(),
            pin_state: "manual".to_string(),
            content: statement,
            source_fact_id: Some(fact_id_value),
            source_evidence_ids,
            last_used_at: None,
            use_count: 0,
            tags: default_memory_tags_from_kind(&task_entry.kind),
            decay_eligible: false,
            updated_at: now_rfc3339(),
        };
        self.upsert_kernel_memory_in_tx(&tx, &workspace_entry)?;
        if matches!(
            workspace_entry.kind.as_str(),
            "decision" | "requirement" | "risk"
        ) {
            let global_entry = KernelMemoryEntry {
                id: stable_memory_id(
                    "global",
                    "global",
                    &workspace_entry.kind,
                    &workspace_entry.content,
                ),
                scope: "global".to_string(),
                scope_ref: "global".to_string(),
                kind: workspace_entry.kind.clone(),
                priority: "medium".to_string(),
                pin_state: "manual".to_string(),
                content: workspace_entry.content.clone(),
                source_fact_id: workspace_entry.source_fact_id.clone(),
                source_evidence_ids: workspace_entry.source_evidence_ids.clone(),
                last_used_at: None,
                use_count: 0,
                tags: workspace_entry.tags.clone(),
                decay_eligible: false,
                updated_at: now_rfc3339(),
            };
            self.upsert_kernel_memory_in_tx(&tx, &global_entry)?;
        }
        tx.commit().map_err(|err| err.to_string())?;
        self.load_task_kernel_by_terminal_tab(&terminal_tab_id)
    }

    pub fn create_manual_kernel_checkpoint(
        &self,
        terminal_tab_id: &str,
    ) -> Result<Option<TaskKernel>, String> {
        let conn = self.open_connection()?;
        let Some(task) = self.load_task_packet_by_terminal_tab(&conn, terminal_tab_id)? else {
            return Ok(None);
        };
        let facts = self.load_kernel_facts_for_task(&conn, &task.id, 8)?;
        let evidence = self.load_kernel_evidence_for_task(&conn, &task.id, 8)?;
        let recent_turns = evidence
            .iter()
            .filter(|entry| entry.evidence_type == "assistantMessage")
            .take(4)
            .map(|entry| TaskRecentTurn {
                cli_id: task.current_owner_cli.clone(),
                user_prompt: task.goal.clone(),
                assistant_reply: entry.summary.clone(),
                timestamp: entry.timestamp.clone(),
            })
            .collect::<Vec<_>>();
        let bundle = self.record_turn_progress(&TaskTurnUpdate {
            terminal_tab_id: terminal_tab_id.to_string(),
            workspace_id: task.workspace_id.clone(),
            project_root: task.project_root.clone(),
            project_name: task.project_name.clone(),
            cli_id: task.current_owner_cli.clone(),
            user_prompt: task.goal.clone(),
            assistant_summary: facts
                .first()
                .map(|fact| fact.statement.clone())
                .unwrap_or_else(|| task.latest_conclusion.clone().unwrap_or_default()),
            relevant_files: task.relevant_files.clone(),
            recent_turns,
            exit_code: Some(0),
        })?;
        self.load_task_kernel_by_terminal_tab(&bundle.task_packet.terminal_tab_id)
    }

    pub fn load_conversation_session_by_terminal_tab(
        &self,
        terminal_tab_id: &str,
    ) -> Result<Option<PersistedConversationSession>, String> {
        let conn = self.open_connection()?;
        self.load_chat_session_by_terminal_tab(&conn, terminal_tab_id)
    }

    pub fn compact_active_context(&self) -> Result<Option<CompactContextResult>, String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;

        let active_terminal_tab_id = tx
            .query_row(
                "SELECT active_terminal_tab_id FROM terminal_state_meta WHERE id = 1",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|err| err.to_string())?
            .flatten();
        let Some(active_terminal_tab_id) = active_terminal_tab_id else {
            return Ok(None);
        };
        let result =
            self.compact_terminal_tab_in_tx(&tx, &active_terminal_tab_id, "manual-compact", true)?;
        tx.commit().map_err(|err| err.to_string())?;
        Ok(result)
    }

    pub fn maybe_auto_compact_terminal_tab(
        &self,
        terminal_tab_id: &str,
    ) -> Result<Option<CompactContextResult>, String> {
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|err| err.to_string())?;
        let result = self.compact_terminal_tab_in_tx(&tx, terminal_tab_id, "auto-budget", false)?;
        tx.commit().map_err(|err| err.to_string())?;
        Ok(result)
    }

    pub fn load_prompt_turns_for_terminal_tab(
        &self,
        terminal_tab_id: &str,
        _fallback_cli: &str,
        limit: usize,
    ) -> Result<Vec<TaskRecentTurn>, String> {
        let conn = self.open_connection()?;
        let Some(task) = self.load_task_packet_by_terminal_tab(&conn, terminal_tab_id)? else {
            return Ok(Vec::new());
        };
        let turns = self.load_prompt_turns_for_task(&conn, &task, limit)?;
        Ok(turns
            .into_iter()
            .map(|turn| TaskRecentTurn {
                cli_id: turn.cli_id,
                user_prompt: turn.user_prompt,
                assistant_reply: turn.assistant_reply,
                timestamp: turn.timestamp,
            })
            .collect())
    }

    fn ensure_session_metadata(
        &self,
        tx: &Connection,
        session: &PersistedConversationSession,
    ) -> Result<(), String> {
        let compacted_json = to_json(&session.compacted_summaries)?;
        tx.execute(
            "INSERT INTO conversation_sessions (
                id, terminal_tab_id, workspace_id, project_root, project_name,
                compacted_summaries_json, last_compacted_at, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(terminal_tab_id) DO UPDATE SET
                id = excluded.id,
                workspace_id = excluded.workspace_id,
                project_root = excluded.project_root,
                project_name = excluded.project_name,
                compacted_summaries_json = excluded.compacted_summaries_json,
                last_compacted_at = excluded.last_compacted_at,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at",
            params![
                session.id,
                session.terminal_tab_id,
                session.workspace_id,
                session.project_root,
                session.project_name,
                compacted_json,
                session.last_compacted_at,
                session.created_at,
                session.updated_at,
            ],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    fn count_messages_for_session(
        &self,
        tx: &Connection,
        session_id: &str,
    ) -> Result<usize, String> {
        let count = tx
            .query_row(
                "SELECT COUNT(*) FROM chat_messages WHERE session_id = ?1",
                [session_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|err| err.to_string())?;
        Ok(count as usize)
    }

    fn append_messages_in_tx(
        &self,
        tx: &Connection,
        session_id: &str,
        terminal_tab_id: &str,
        messages: &[PersistedChatMessage],
    ) -> Result<(), String> {
        let mut next_order = tx
            .query_row(
                "SELECT COALESCE(MAX(message_order), -1) + 1 FROM chat_messages WHERE session_id = ?1",
                [session_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|err| err.to_string())?;

        for message in messages {
            let inserted = tx.execute(
                "INSERT OR IGNORE INTO chat_messages (
                    id, session_id, terminal_tab_id, message_order, role, cli_id,
                    selected_agent_json, automation_run_id, workflow_run_id, workflow_node_id, timestamp,
                    content, raw_content, content_format, transport_kind, blocks_json,
                    attachments_json, is_streaming, duration_ms, exit_code
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
                params![
                    message.id,
                    session_id,
                    terminal_tab_id,
                    next_order,
                    message.role,
                    message.cli_id,
                    option_to_json(&message.selected_agent)?,
                    message.automation_run_id,
                    message.workflow_run_id,
                    message.workflow_node_id,
                    message.timestamp,
                    message.content,
                    message.raw_content,
                    message.content_format,
                    message.transport_kind,
                    option_to_json(&message.blocks)?,
                    to_json(&message.attachments)?,
                    message.is_streaming,
                    message.duration_ms.map(|value| value as i64),
                    message.exit_code,
                ],
            )
            .map_err(|err| err.to_string())?;
            if inserted > 0 {
                self.insert_message_event(
                    tx,
                    terminal_tab_id,
                    Some(session_id),
                    &message.id,
                    "append",
                    &message,
                    Some(&message.timestamp),
                )?;
                next_order += 1;
            }
        }
        Ok(())
    }

    fn insert_message_event<T: Serialize>(
        &self,
        tx: &Connection,
        terminal_tab_id: &str,
        session_id: Option<&str>,
        message_id: &str,
        event_type: &str,
        payload: &T,
        created_at: Option<&str>,
    ) -> Result<(), String> {
        tx.execute(
            "INSERT INTO message_events (
                id, terminal_tab_id, session_id, message_id, event_type, payload_json, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                new_id("event"),
                terminal_tab_id,
                session_id,
                message_id,
                event_type,
                to_json(payload)?,
                created_at.unwrap_or(&now_rfc3339()),
            ],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub fn build_context_assembly(
        &self,
        request: &EnsureTaskPacketRequest,
        target_cli: &str,
        prompt: &str,
        workspace_preamble: &str,
        fallback_recent_turns: &[TaskRecentTurn],
        write_mode: bool,
    ) -> Result<ContextAssemblyResult, String> {
        let conn = self.open_connection()?;
        let bundle = self.ensure_task_bundle(request)?;
        let profile = self.context_budget_profile(target_cli, write_mode);
        let hot_turns = self.load_prompt_turns_for_terminal_tab(
            &request.terminal_tab_id,
            target_cli,
            profile.max_hot_turns,
        )?;
        let raw_turns = self.load_prompt_turns_for_terminal_tab(
            &request.terminal_tab_id,
            target_cli,
            profile.max_raw_turns,
        )?;
        let packs = if profile.allow_pack_expansion {
            self.load_context_packs_for_task(&conn, &bundle.task_packet.id, 8)?
        } else {
            Vec::new()
        };

        let mut lines = Vec::new();
        let mut included_layers = Vec::new();
        let mut included_pack_ids = Vec::new();

        push_layer(
            &mut lines,
            &mut included_layers,
            "workspace",
            workspace_preamble,
        );
        push_layer(
            &mut lines,
            &mut included_layers,
            "task",
            &format!(
                "--- Shared task context ---\nTask: {}\nGoal: {}\nCurrent owner: {}\nStatus: {}\nLatest conclusion: {}\nNext step: {}\nRelevant files: {}",
                bundle.task_packet.title,
                bundle.task_packet.goal,
                bundle.task_packet.current_owner_cli,
                bundle.task_packet.status,
                bundle.task_packet.latest_conclusion.as_deref().unwrap_or("none"),
                bundle.task_packet.next_step.as_deref().unwrap_or("none"),
                if bundle.task_packet.relevant_files.is_empty() {
                    "none".to_string()
                } else {
                    bundle.task_packet.relevant_files.join(", ")
                }
            ),
        );

        if let Some(handoff) = bundle.latest_handoff.as_ref() {
            push_layer(
                &mut lines,
                &mut included_layers,
                "handoff",
                &format!(
                    "--- Latest CLI handoff ---\nFrom: {}\nTo: {}\nReason: {}\nConclusion: {}\nFiles: {}\nNext step: {}",
                    handoff.from_cli,
                    handoff.to_cli,
                    handoff.reason.as_deref().unwrap_or("switch"),
                    handoff.latest_conclusion.as_deref().unwrap_or("none"),
                    if handoff.files.is_empty() {
                        "none".to_string()
                    } else {
                        handoff.files.join(", ")
                    },
                    handoff.next_step.as_deref().unwrap_or("none")
                ),
            );
        }

        if let Some(snapshot) = bundle.latest_snapshot.as_ref() {
            push_layer(
                &mut lines,
                &mut included_layers,
                "snapshot",
                &format!(
                    "--- Latest compacted task snapshot ---\n{}",
                    snapshot.summary
                ),
            );
        }

        let kernel_facts = self.load_kernel_facts_for_task(&conn, &bundle.task_packet.id, 8)?;
        let kernel_evidence =
            self.load_kernel_evidence_for_task(&conn, &bundle.task_packet.id, 8)?;
        let active_plan = self.load_kernel_plan_for_task(&conn, &bundle.task_packet.id)?;
        let work_items = self.load_kernel_work_items_for_task(&conn, &bundle.task_packet.id, 8)?;
        let current_work_item = select_current_work_item(&work_items);
        let mut memory_entries =
            self.load_kernel_memory_for_scope(&conn, "task", &bundle.task_packet.id, 6)?;
        memory_entries.extend(self.load_kernel_memory_for_scope(
            &conn,
            "workspace",
            &bundle.task_packet.workspace_id,
            4,
        )?);
        memory_entries.extend(self.load_kernel_memory_for_scope(&conn, "global", "global", 4)?);
        let selected_work_items = select_work_items_for_cli(&work_items, target_cli);
        let selected_facts = select_kernel_facts_for_cli(&kernel_facts, target_cli);
        let selected_evidence = select_kernel_evidence_for_cli(&kernel_evidence, target_cli);
        let selected_memory = select_memory_for_cli_with_budget(
            &memory_entries,
            target_cli,
            current_work_item.as_ref(),
            &bundle.task_packet.relevant_files,
        );

        if let Some(plan) = active_plan.as_ref() {
            push_layer(
                &mut lines,
                &mut included_layers,
                "active_plan",
                &format!(
                    "--- Active plan ---\nTitle: {}\nGoal: {}\nStatus: {}\nSummary: {}",
                    plan.title,
                    plan.goal,
                    plan.status,
                    plan.summary.as_deref().unwrap_or("none")
                ),
            );
        }

        if let Some(item) = current_work_item.as_ref() {
            push_layer(
                &mut lines,
                &mut included_layers,
                "current_work_item",
                &format!(
                    "--- Current work item ---\nOwner: {}\nStatus: {}\nTitle: {}\nSummary: {}",
                    item.owner_cli,
                    item.status,
                    item.title,
                    item.summary.as_deref().unwrap_or("none")
                ),
            );
        }

        if !selected_work_items.is_empty() {
            let work_item_lines = selected_work_items
                .iter()
                .map(|item| {
                    format!(
                        "- [{} / {}] {}{}{}",
                        item.owner_cli,
                        item.status,
                        item.title,
                        item.summary
                            .as_ref()
                            .map(|summary| format!(" | {}", truncate_text(summary, 180)))
                            .unwrap_or_default(),
                        item.result
                            .as_ref()
                            .map(|result| format!(" | result: {}", truncate_text(result, 140)))
                            .unwrap_or_default()
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            if !work_item_lines.is_empty() {
                push_layer(
                    &mut lines,
                    &mut included_layers,
                    "work_items",
                    &format!("--- Current work items ---\n{}", work_item_lines),
                );
            }
        }

        if !selected_facts.is_empty() {
            let fact_lines = selected_facts
                .iter()
                .map(|fact| {
                    format!(
                        "- [{} / {}] {}",
                        fact.status,
                        fact.kind,
                        truncate_text(&fact.statement, 500)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            push_layer(
                &mut lines,
                &mut included_layers,
                "kernel_facts",
                &format!("--- Verified and inferred task facts ---\n{}", fact_lines),
            );
        }

        if !selected_evidence.is_empty() {
            let evidence_lines = selected_evidence
                .iter()
                .map(|entry| {
                    format!(
                        "- [{}] {}",
                        entry.evidence_type,
                        truncate_text(&entry.summary, 500)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            push_layer(
                &mut lines,
                &mut included_layers,
                "kernel_evidence",
                &format!("--- Recent evidence ledger ---\n{}", evidence_lines),
            );
        }

        if !selected_memory.is_empty() {
            let memory_lines = selected_memory
                .iter()
                .map(|entry| {
                    format!(
                        "- [{} / {}] {}",
                        entry.scope,
                        entry.kind,
                        truncate_text(&entry.content, 500)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            push_layer(
                &mut lines,
                &mut included_layers,
                "kernel_memory",
                &format!("--- Durable memory ---\n{}", memory_lines),
            );
        }

        if !hot_turns.is_empty() {
            let hot_text =
                format_turns_block("--- Active hot turns after compaction ---", &hot_turns);
            push_layer(&mut lines, &mut included_layers, "hot_turns", &hot_text);
        } else if !fallback_recent_turns.is_empty() {
            let fallback_text = format_turns_block(
                "--- Recent conversation in this terminal tab only ---",
                fallback_recent_turns,
            );
            push_layer(
                &mut lines,
                &mut included_layers,
                "fallback_recent_turns",
                &fallback_text,
            );
        }

        if profile.allow_pack_expansion {
            for pack in packs {
                let candidate = format!(
                    "--- Historical context pack ({}) ---\n{}",
                    pack.kind, pack.summary
                );
                if estimate_joined_len(&lines, &candidate, prompt) > profile.max_chars {
                    break;
                }
                lines.push(candidate);
                included_layers.push("context_pack".to_string());
                included_pack_ids.push(pack.id);
            }
        }

        if raw_turns.len() > hot_turns.len()
            && estimate_joined_len(&lines, "", prompt) < profile.max_chars
        {
            let older_raw = raw_turns
                .into_iter()
                .rev()
                .take(profile.max_raw_turns)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>();
            let raw_text = format_turns_block("--- Expanded raw turn window ---", &older_raw);
            if estimate_joined_len(&lines, &raw_text, prompt) <= profile.max_chars {
                push_layer(
                    &mut lines,
                    &mut included_layers,
                    "expanded_raw_turns",
                    &raw_text,
                );
            }
        }

        // Inject semantic memory recall (FTS5-based) for cross-CLI context
        if estimate_joined_len(&lines, "", prompt) < profile.max_chars {
            let semantic_request = SemanticRecallRequest {
                query: prompt.to_string(),
                terminal_tab_id: Some(request.terminal_tab_id.clone()),
                limit: Some(15),
            };
            if let Ok(chunks) = self.semantic_recall(&semantic_request) {
                if !chunks.is_empty() {
                    let semantic_lines: Vec<String> = chunks
                        .iter()
                        .map(|c| {
                            format!(
                                "- [{}/{}] {}",
                                c.cli_id,
                                c.chunk_type,
                                truncate_text(&c.content, 600)
                            )
                        })
                        .collect();
                    let semantic_section = format!(
                        "--- Semantic memory recall ---\n{}",
                        semantic_lines.join("\n")
                    );
                    if estimate_joined_len(&lines, &semantic_section, prompt) <= profile.max_chars {
                        push_layer(
                            &mut lines,
                            &mut included_layers,
                            "semantic_recall",
                            &semantic_section,
                        );
                    }
                }
            }
        }

        push_layer(
            &mut lines,
            &mut included_layers,
            "user_request",
            &format!("--- User request ---\n{}", prompt),
        );

        let assembled = lines.join("\n\n");
        let approx_chars = assembled.len();

        self.write_context_package_log(
            &conn,
            &bundle.task_packet.id,
            target_cli,
            &profile.profile_id,
            &included_layers,
            &included_pack_ids,
            approx_chars,
        )?;

        self.touch_memory_usage(
            &conn,
            &selected_memory
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<Vec<_>>(),
        )?;

        Ok(ContextAssemblyResult {
            prompt: assembled,
            approx_chars,
            included_layers,
            included_pack_ids,
        })
    }

    fn compact_terminal_tab_in_tx(
        &self,
        tx: &Connection,
        terminal_tab_id: &str,
        trigger_reason: &str,
        force: bool,
    ) -> Result<Option<CompactContextResult>, String> {
        let Some(mut task) = self.load_task_packet_by_terminal_tab(tx, terminal_tab_id)? else {
            return Ok(None);
        };
        let Some(_session) = self.load_chat_session_by_terminal_tab(tx, terminal_tab_id)? else {
            return Ok(None);
        };
        let previous_snapshot = self.load_latest_snapshot_for_task(tx, &task.id)?;
        let turns = self.load_prompt_turns_for_task(tx, &task, 10_000)?;
        if turns.len() <= COMPACT_KEEP_TURNS {
            return Ok(None);
        }

        let hot_turn_chars = turns
            .iter()
            .map(|turn| turn.user_prompt.len() + turn.assistant_reply.len())
            .sum::<usize>();
        if !force
            && turns.len() <= AUTO_COMPACT_MAX_HOT_TURNS
            && hot_turn_chars <= AUTO_COMPACT_MAX_HOT_CHARS
        {
            return Ok(None);
        }

        let split_index = turns.len() - COMPACT_KEEP_TURNS;
        let summarized_turns = &turns[..split_index];
        let kept_turns = &turns[split_index..];
        let Some(boundary_turn) = kept_turns.first() else {
            return Ok(None);
        };

        let now = now_rfc3339();
        let snapshot = ContextSnapshot {
            id: new_id("snapshot"),
            task_id: task.id.clone(),
            trigger_reason: trigger_reason.to_string(),
            summary: build_manual_compaction_summary(
                &task,
                previous_snapshot.as_ref(),
                summarized_turns,
            ),
            facts_confirmed: summarized_turns
                .iter()
                .map(|turn| truncate_text(&turn.assistant_reply, 500))
                .collect(),
            work_completed: summarized_turns
                .iter()
                .map(|turn| {
                    format!(
                        "[{}] {}",
                        turn.cli_id,
                        truncate_text(&turn.assistant_reply, 400)
                    )
                })
                .collect(),
            files_touched: task.relevant_files.clone(),
            commands_run: task.relevant_commands.clone(),
            failures: Vec::new(),
            open_questions: task.open_questions.clone(),
            next_step: Some(
                "Continue from the latest hot turns after the compact boundary.".to_string(),
            ),
            source_user_prompt: summarized_turns.last().map(|turn| turn.user_prompt.clone()),
            source_assistant_summary: summarized_turns
                .last()
                .map(|turn| truncate_text(&turn.assistant_reply, 500)),
            created_at: now.clone(),
        };

        tx.execute(
            "INSERT INTO context_snapshots (
                id, task_id, trigger_reason, summary, facts_confirmed_json, work_completed_json,
                files_touched_json, commands_run_json, failures_json, open_questions_json,
                next_step, source_user_prompt, source_assistant_summary, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                snapshot.id,
                snapshot.task_id,
                snapshot.trigger_reason,
                snapshot.summary,
                to_json(&snapshot.facts_confirmed)?,
                to_json(&snapshot.work_completed)?,
                to_json(&snapshot.files_touched)?,
                to_json(&snapshot.commands_run)?,
                to_json(&snapshot.failures)?,
                to_json(&snapshot.open_questions)?,
                snapshot.next_step,
                snapshot.source_user_prompt,
                snapshot.source_assistant_summary,
                snapshot.created_at,
            ],
        )
        .map_err(|err| err.to_string())?;

        let boundary = CompactBoundary {
            id: new_id("boundary"),
            task_id: task.id.clone(),
            terminal_tab_id: terminal_tab_id.to_string(),
            boundary_message_id: boundary_turn.user_message_id.clone(),
            snapshot_id: snapshot.id.clone(),
            trigger_reason: trigger_reason.to_string(),
            created_at: now.clone(),
        };

        tx.execute(
            "INSERT INTO compact_boundaries (
                id, task_id, terminal_tab_id, boundary_message_id, snapshot_id, trigger_reason, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                boundary.id,
                boundary.task_id,
                boundary.terminal_tab_id,
                boundary.boundary_message_id,
                boundary.snapshot_id,
                boundary.trigger_reason,
                boundary.created_at,
            ],
        )
        .map_err(|err| err.to_string())?;

        let pack = ContextPack {
            id: new_id("pack"),
            task_id: task.id.clone(),
            terminal_tab_id: terminal_tab_id.to_string(),
            start_message_id: summarized_turns
                .first()
                .map(|turn| turn.user_message_id.clone())
                .unwrap_or_else(|| boundary.boundary_message_id.clone()),
            end_message_id: summarized_turns
                .last()
                .map(|turn| turn.assistant_message_id.clone())
                .unwrap_or_else(|| boundary.boundary_message_id.clone()),
            kind: "historical".to_string(),
            summary: snapshot.summary.clone(),
            approx_chars: snapshot.summary.len(),
            created_at: now.clone(),
        };

        tx.execute(
            "INSERT INTO context_packs (
                id, task_id, terminal_tab_id, start_message_id, end_message_id, kind, summary, approx_chars, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                pack.id,
                pack.task_id,
                pack.terminal_tab_id,
                pack.start_message_id,
                pack.end_message_id,
                pack.kind,
                pack.summary,
                pack.approx_chars as i64,
                pack.created_at,
            ],
        )
        .map_err(|err| err.to_string())?;

        tx.execute(
            "UPDATE task_packets
             SET latest_snapshot_id = ?1,
                 next_step = ?2,
                 updated_at = ?3
             WHERE id = ?4",
            params![
                snapshot.id,
                "Continue from the newest hot turns after compaction.",
                now,
                task.id,
            ],
        )
        .map_err(|err| err.to_string())?;

        task.latest_snapshot_id = Some(snapshot.id.clone());
        task.next_step = Some("Continue from the newest hot turns after compaction.".to_string());
        task.updated_at = now;

        Ok(Some(CompactContextResult {
            task_id: task.id,
            snapshot,
            boundary,
            summarized_turn_count: summarized_turns.len(),
            kept_turn_count: kept_turns.len(),
        }))
    }

    fn ensure_task_packet_in_tx(
        &self,
        conn: &Connection,
        request: &EnsureTaskPacketRequest,
    ) -> Result<TaskPacket, String> {
        if let Some(existing) =
            self.load_task_packet_by_terminal_tab(conn, &request.terminal_tab_id)?
        {
            return Ok(existing);
        }

        let now = now_rfc3339();
        let goal = if request.initial_goal.trim().is_empty() {
            format!("Continue work in {}", request.project_name)
        } else {
            request.initial_goal.trim().to_string()
        };
        let task = TaskPacket {
            id: new_id("task"),
            terminal_tab_id: request.terminal_tab_id.clone(),
            workspace_id: request.workspace_id.clone(),
            project_root: request.project_root.clone(),
            project_name: request.project_name.clone(),
            title: title_from_goal(&goal, &request.project_name),
            goal,
            status: "active".to_string(),
            current_owner_cli: request.cli_id.clone(),
            latest_conclusion: None,
            open_questions: Vec::new(),
            risks: Vec::new(),
            next_step: Some("Continue the active task.".to_string()),
            relevant_files: Vec::new(),
            relevant_commands: Vec::new(),
            linked_session_ids: Vec::new(),
            latest_snapshot_id: None,
            updated_at: now.clone(),
            created_at: now.clone(),
        };

        conn.execute(
            "INSERT INTO task_packets (
                id, terminal_tab_id, workspace_id, project_root, project_name, title, goal,
                status, current_owner_cli, latest_conclusion, open_questions_json, risks_json,
                next_step, relevant_files_json, relevant_commands_json, linked_session_ids_json,
                latest_snapshot_id, updated_at, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                task.id,
                task.terminal_tab_id,
                task.workspace_id,
                task.project_root,
                task.project_name,
                task.title,
                task.goal,
                task.status,
                task.current_owner_cli,
                task.latest_conclusion,
                to_json(&task.open_questions)?,
                to_json(&task.risks)?,
                task.next_step,
                to_json(&task.relevant_files)?,
                to_json(&task.relevant_commands)?,
                to_json(&task.linked_session_ids)?,
                task.latest_snapshot_id,
                task.updated_at,
                task.created_at,
            ],
        )
        .map_err(|err| err.to_string())?;

        Ok(task)
    }

    fn load_task_packet_by_terminal_tab(
        &self,
        conn: &Connection,
        terminal_tab_id: &str,
    ) -> Result<Option<TaskPacket>, String> {
        conn.query_row(
            "SELECT id, terminal_tab_id, workspace_id, project_root, project_name, title, goal, status,
                    current_owner_cli, latest_conclusion, open_questions_json, risks_json, next_step,
                    relevant_files_json, relevant_commands_json, linked_session_ids_json, latest_snapshot_id,
                    updated_at, created_at
             FROM task_packets
             WHERE terminal_tab_id = ?1",
            [terminal_tab_id],
            |row| {
                Ok(TaskPacket {
                    id: row.get(0)?,
                    terminal_tab_id: row.get(1)?,
                    workspace_id: row.get(2)?,
                    project_root: row.get(3)?,
                    project_name: row.get(4)?,
                    title: row.get(5)?,
                    goal: row.get(6)?,
                    status: row.get(7)?,
                    current_owner_cli: row.get(8)?,
                    latest_conclusion: row.get(9)?,
                    open_questions: parse_json_default(row.get::<_, String>(10)?),
                    risks: parse_json_default(row.get::<_, String>(11)?),
                    next_step: row.get(12)?,
                    relevant_files: parse_json_default(row.get::<_, String>(13)?),
                    relevant_commands: parse_json_default(row.get::<_, String>(14)?),
                    linked_session_ids: parse_json_default(row.get::<_, String>(15)?),
                    latest_snapshot_id: row.get(16)?,
                    updated_at: row.get(17)?,
                    created_at: row.get(18)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
    }

    fn load_latest_handoff_for_task(
        &self,
        conn: &Connection,
        task_id: &str,
    ) -> Result<Option<HandoffEvent>, String> {
        conn.query_row(
            "SELECT id, task_id, terminal_tab_id, from_cli, to_cli, reason, latest_conclusion,
                    files_json, risks_json, next_step, payload_json, delivery_state,
                    delivered_at, delivered_message_id, created_at
             FROM handoff_events
             WHERE task_id = ?1
             ORDER BY created_at DESC
             LIMIT 1",
            [task_id],
            |row| {
                Ok(HandoffEvent {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    terminal_tab_id: row.get(2)?,
                    from_cli: row.get(3)?,
                    to_cli: row.get(4)?,
                    reason: row.get(5)?,
                    latest_conclusion: row.get(6)?,
                    files: parse_json_default(row.get::<_, String>(7)?),
                    risks: parse_json_default(row.get::<_, String>(8)?),
                    next_step: row.get(9)?,
                    payload_json: row.get(10)?,
                    delivery_state: row.get(11)?,
                    delivered_at: row.get(12)?,
                    delivered_message_id: row.get(13)?,
                    created_at: row.get(14)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
    }

    pub fn load_pending_handoff_for_terminal_tab(
        &self,
        terminal_tab_id: &str,
        target_cli: &str,
    ) -> Result<Option<HandoffEvent>, String> {
        let conn = self.open_connection()?;
        let Some(task) = self.load_task_packet_by_terminal_tab(&conn, terminal_tab_id)? else {
            return Ok(None);
        };
        self.load_pending_handoff_for_task_and_cli(&conn, &task.id, target_cli)
    }

    fn load_pending_handoff_for_task_and_cli(
        &self,
        conn: &Connection,
        task_id: &str,
        target_cli: &str,
    ) -> Result<Option<HandoffEvent>, String> {
        conn.query_row(
            "SELECT id, task_id, terminal_tab_id, from_cli, to_cli, reason, latest_conclusion,
                    files_json, risks_json, next_step, payload_json, delivery_state,
                    delivered_at, delivered_message_id, created_at
             FROM handoff_events
             WHERE task_id = ?1 AND to_cli = ?2 AND delivery_state = 'pending'
             ORDER BY created_at DESC
             LIMIT 1",
            params![task_id, target_cli],
            |row| {
                Ok(HandoffEvent {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    terminal_tab_id: row.get(2)?,
                    from_cli: row.get(3)?,
                    to_cli: row.get(4)?,
                    reason: row.get(5)?,
                    latest_conclusion: row.get(6)?,
                    files: parse_json_default(row.get::<_, String>(7)?),
                    risks: parse_json_default(row.get::<_, String>(8)?),
                    next_step: row.get(9)?,
                    payload_json: row.get(10)?,
                    delivery_state: row.get(11)?,
                    delivered_at: row.get(12)?,
                    delivered_message_id: row.get(13)?,
                    created_at: row.get(14)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
    }

    fn mark_pending_handoff_delivered_in_tx(
        &self,
        tx: &Connection,
        task_id: &str,
        cli_id: &str,
        message_id: &str,
        delivered_at: &str,
    ) -> Result<(), String> {
        tx.execute(
            "UPDATE handoff_events
             SET delivery_state = 'delivered',
                 delivered_at = ?1,
                 delivered_message_id = ?2
             WHERE id IN (
                 SELECT id
                 FROM handoff_events
                 WHERE task_id = ?3 AND to_cli = ?4 AND delivery_state = 'pending'
                 ORDER BY created_at DESC
                 LIMIT 1
             )",
            params![delivered_at, message_id, task_id, cli_id],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    fn load_latest_snapshot_for_task(
        &self,
        conn: &Connection,
        task_id: &str,
    ) -> Result<Option<ContextSnapshot>, String> {
        conn.query_row(
            "SELECT id, task_id, trigger_reason, summary, facts_confirmed_json, work_completed_json,
                    files_touched_json, commands_run_json, failures_json, open_questions_json,
                    next_step, source_user_prompt, source_assistant_summary, created_at
             FROM context_snapshots
             WHERE task_id = ?1
             ORDER BY created_at DESC
             LIMIT 1",
            [task_id],
            |row| {
                Ok(ContextSnapshot {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    trigger_reason: row.get(2)?,
                    summary: row.get(3)?,
                    facts_confirmed: parse_json_default(row.get::<_, String>(4)?),
                    work_completed: parse_json_default(row.get::<_, String>(5)?),
                    files_touched: parse_json_default(row.get::<_, String>(6)?),
                    commands_run: parse_json_default(row.get::<_, String>(7)?),
                    failures: parse_json_default(row.get::<_, String>(8)?),
                    open_questions: parse_json_default(row.get::<_, String>(9)?),
                    next_step: row.get(10)?,
                    source_user_prompt: row.get(11)?,
                    source_assistant_summary: row.get(12)?,
                    created_at: row.get(13)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
    }

    fn load_latest_boundary_for_task(
        &self,
        conn: &Connection,
        task_id: &str,
    ) -> Result<Option<CompactBoundary>, String> {
        conn.query_row(
            "SELECT id, task_id, terminal_tab_id, boundary_message_id, snapshot_id, trigger_reason, created_at
             FROM compact_boundaries
             WHERE task_id = ?1
             ORDER BY created_at DESC
             LIMIT 1",
            [task_id],
            |row| {
                Ok(CompactBoundary {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    terminal_tab_id: row.get(2)?,
                    boundary_message_id: row.get(3)?,
                    snapshot_id: row.get(4)?,
                    trigger_reason: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
    }

    fn load_kernel_session_refs_for_task(
        &self,
        conn: &Connection,
        task_id: &str,
    ) -> Result<Vec<KernelSessionRef>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, terminal_tab_id, cli_id, transport_kind, native_session_id,
                        native_turn_id, model, permission_mode, resume_capable, state, last_sync_at
                 FROM kernel_session_refs
                 WHERE task_id = ?1
                 ORDER BY last_sync_at DESC",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map([task_id], |row| {
                Ok(KernelSessionRef {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    terminal_tab_id: row.get(2)?,
                    cli_id: row.get(3)?,
                    transport_kind: row.get(4)?,
                    native_session_id: row.get(5)?,
                    native_turn_id: row.get(6)?,
                    model: row.get(7)?,
                    permission_mode: row.get(8)?,
                    resume_capable: row.get::<_, i64>(9)? != 0,
                    state: row.get(10)?,
                    last_sync_at: row.get(11)?,
                })
            })
            .map_err(|err| err.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    fn load_kernel_facts_for_task(
        &self,
        conn: &Connection,
        task_id: &str,
        limit: usize,
    ) -> Result<Vec<KernelFact>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, kind, statement, status, source_evidence_ids_json,
                        subject, polarity, origin, owner_cli, confidence, updated_at, supersedes_fact_ids_json
                 FROM kernel_facts
                 WHERE task_id = ?1
                 ORDER BY updated_at DESC
                 LIMIT ?2",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![task_id, limit as i64], |row| {
                Ok(KernelFact {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    kind: row.get(2)?,
                    statement: row.get(3)?,
                    status: row.get(4)?,
                    source_evidence_ids: parse_json_default(row.get::<_, String>(5)?),
                    subject: row.get(6)?,
                    polarity: row.get(7)?,
                    origin: row.get(8)?,
                    owner_cli: row.get(9)?,
                    confidence: row.get(10)?,
                    updated_at: row.get(11)?,
                    supersedes_fact_ids: parse_json_default(row.get::<_, String>(12)?),
                })
            })
            .map_err(|err| err.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    fn load_kernel_evidence_for_task(
        &self,
        conn: &Connection,
        task_id: &str,
        limit: usize,
    ) -> Result<Vec<KernelEvidence>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, message_id, terminal_tab_id, cli_id, evidence_type,
                        summary, payload_ref, timestamp
                 FROM kernel_evidence
                 WHERE task_id = ?1
                 ORDER BY timestamp DESC
                 LIMIT ?2",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![task_id, limit as i64], |row| {
                Ok(KernelEvidence {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    message_id: row.get(2)?,
                    terminal_tab_id: row.get(3)?,
                    cli_id: row.get(4)?,
                    evidence_type: row.get(5)?,
                    summary: row.get(6)?,
                    payload_ref: row.get(7)?,
                    timestamp: row.get(8)?,
                })
            })
            .map_err(|err| err.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    fn load_kernel_plan_for_task(
        &self,
        conn: &Connection,
        task_id: &str,
    ) -> Result<Option<KernelPlan>, String> {
        conn.query_row(
            "SELECT id, task_id, title, goal, summary, status, updated_at
             FROM kernel_plans
             WHERE task_id = ?1
             ORDER BY updated_at DESC
             LIMIT 1",
            [task_id],
            |row| {
                Ok(KernelPlan {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    title: row.get(2)?,
                    goal: row.get(3)?,
                    summary: row.get(4)?,
                    status: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
    }

    fn load_kernel_work_items_for_task(
        &self,
        conn: &Connection,
        task_id: &str,
        limit: usize,
    ) -> Result<Vec<KernelWorkItem>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, step_id, owner_cli, title, summary, result, status, updated_at
                 FROM kernel_work_items
                 WHERE task_id = ?1
                 ORDER BY updated_at DESC
                 LIMIT ?2",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![task_id, limit as i64], |row| {
                Ok(KernelWorkItem {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    step_id: row.get(2)?,
                    owner_cli: row.get(3)?,
                    title: row.get(4)?,
                    summary: row.get(5)?,
                    result: row.get(6)?,
                    status: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|err| err.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    fn load_kernel_memory_for_scope(
        &self,
        conn: &Connection,
        scope: &str,
        scope_ref: &str,
        limit: usize,
    ) -> Result<Vec<KernelMemoryEntry>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, scope, scope_ref, kind, content, source_fact_id, source_evidence_ids_json, updated_at
                        , priority, pin_state, last_used_at, use_count, tags_json, decay_eligible
                 FROM kernel_memory_entries
                 WHERE scope = ?1 AND scope_ref = ?2
                   AND (
                        source_fact_id IS NULL
                        OR source_fact_id IN (
                            SELECT id FROM kernel_facts WHERE status != 'invalidated'
                        )
                   )
                 ORDER BY updated_at DESC
                 LIMIT ?3",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![scope, scope_ref, limit as i64], |row| {
                Ok(KernelMemoryEntry {
                    id: row.get(0)?,
                    scope: row.get(1)?,
                    scope_ref: row.get(2)?,
                    kind: row.get(3)?,
                    content: row.get(4)?,
                    source_fact_id: row.get(5)?,
                    source_evidence_ids: parse_json_default(row.get::<_, String>(6)?),
                    updated_at: row.get(7)?,
                    priority: row.get(8)?,
                    pin_state: row.get(9)?,
                    last_used_at: row.get(10)?,
                    use_count: row.get::<_, i64>(11)? as usize,
                    tags: parse_json_default(row.get::<_, String>(12)?),
                    decay_eligible: row.get::<_, i64>(13)? != 0,
                })
            })
            .map_err(|err| err.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    fn touch_memory_usage(&self, conn: &Connection, ids: &[String]) -> Result<(), String> {
        let now = now_rfc3339();
        for id in ids {
            conn.execute(
                "UPDATE kernel_memory_entries
                 SET last_used_at = ?1,
                     use_count = use_count + 1
                 WHERE id = ?2",
                params![now, id],
            )
            .map_err(|err| err.to_string())?;
        }
        Ok(())
    }

    fn load_terminal_tab_id_for_task(
        &self,
        conn: &Connection,
        task_id: &str,
    ) -> Result<Option<String>, String> {
        conn.query_row(
            "SELECT terminal_tab_id FROM task_packets WHERE id = ?1",
            [task_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| err.to_string())
    }

    fn load_context_packs_for_task(
        &self,
        conn: &Connection,
        task_id: &str,
        limit: usize,
    ) -> Result<Vec<ContextPack>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, task_id, terminal_tab_id, start_message_id, end_message_id, kind, summary, approx_chars, created_at
                 FROM context_packs
                 WHERE task_id = ?1
                 ORDER BY created_at DESC
                 LIMIT ?2",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![task_id, limit as i64], |row| {
                Ok(ContextPack {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    terminal_tab_id: row.get(2)?,
                    start_message_id: row.get(3)?,
                    end_message_id: row.get(4)?,
                    kind: row.get(5)?,
                    summary: row.get(6)?,
                    approx_chars: row.get::<_, i64>(7)? as usize,
                    created_at: row.get(8)?,
                })
            })
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    fn write_context_package_log(
        &self,
        conn: &Connection,
        task_id: &str,
        target_cli: &str,
        profile_id: &str,
        included_layers: &[String],
        included_pack_ids: &[String],
        approx_chars: usize,
    ) -> Result<(), String> {
        conn.execute(
            "INSERT INTO context_package_logs (
                id, task_id, target_cli, profile_id, included_layers_json, included_pack_ids_json, approx_chars, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                new_id("package"),
                task_id,
                target_cli,
                profile_id,
                to_json(&included_layers)?,
                to_json(&included_pack_ids)?,
                approx_chars as i64,
                now_rfc3339(),
            ],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    fn context_budget_profile(&self, target_cli: &str, write_mode: bool) -> ContextBudgetProfile {
        let max_chars = if write_mode {
            400_000
        } else if target_cli == "claude" {
            500_000
        } else {
            400_000
        };
        ContextBudgetProfile {
            profile_id: if max_chars >= 500_000 {
                "xlarge".to_string()
            } else if max_chars >= 400_000 {
                "large".to_string()
            } else {
                "medium".to_string()
            },
            max_chars,
            max_hot_turns: 20,
            max_raw_turns: 40,
            allow_pack_expansion: true,
        }
    }
}

fn to_json<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|err| err.to_string())
}

fn option_to_json<T: Serialize>(value: &Option<T>) -> Result<Option<String>, String> {
    value
        .as_ref()
        .map(|inner| serde_json::to_string(inner).map_err(|err| err.to_string()))
        .transpose()
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({})", table);
    let mut stmt = conn.prepare(&pragma).map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| err.to_string())?;
    for item in rows {
        let name = item.map_err(|err| err.to_string())?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ensure_column_exists(
    conn: &Connection,
    table: &str,
    column: &str,
    definition_sql: &str,
) -> Result<(), String> {
    if table_has_column(conn, table, column)? {
        return Ok(());
    }
    let sql = format!(
        "ALTER TABLE {} ADD COLUMN {} {}",
        table, column, definition_sql
    );
    conn.execute(&sql, []).map_err(|err| err.to_string())?;
    Ok(())
}

fn parse_json_default<T: DeserializeOwned + Default>(raw: String) -> T {
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn default_terminal_db_path(base_dir: &Path) -> PathBuf {
    base_dir.join("terminal-state.db")
}

fn new_id(prefix: &str) -> String {
    format!("{}-{}", prefix, Uuid::new_v4())
}

fn now_rfc3339() -> String {
    Local::now().to_rfc3339()
}

fn title_from_goal(goal: &str, fallback: &str) -> String {
    let trimmed = goal.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    truncate_text(&trimmed.replace('\n', " "), 72)
}

fn merge_string_lists(current: &[String], incoming: &[String]) -> Vec<String> {
    let mut merged = current.to_vec();
    for item in incoming {
        if !item.trim().is_empty() && !merged.iter().any(|existing| existing == item) {
            merged.push(item.clone());
        }
    }
    merged
}

fn build_snapshot_summary(task: &TaskPacket, update: &TaskTurnUpdate) -> String {
    let mut parts = Vec::new();
    parts.push(format!("Task goal: {}", task.goal));
    parts.push(format!("Current owner: {}", update.cli_id));

    if !update.assistant_summary.trim().is_empty() {
        parts.push(format!(
            "Latest conclusion: {}",
            update.assistant_summary.trim()
        ));
    }

    if !update.relevant_files.is_empty() {
        parts.push(format!(
            "Relevant files: {}",
            update.relevant_files.join(", ")
        ));
    }

    if !update.recent_turns.is_empty() {
        parts.push("Recent shared turns:".to_string());
        for turn in update.recent_turns.iter().rev().take(4).rev() {
            parts.push(format!(
                "- [{} at {}] User: {} | Summary: {}",
                turn.cli_id, turn.timestamp, turn.user_prompt, turn.assistant_reply
            ));
        }
    }

    parts.push(format!(
        "Latest user request: {}",
        update.user_prompt.trim()
    ));
    parts.join("\n")
}

fn extract_completed_turns_from_messages(
    messages: &[PersistedChatMessage],
    fallback_cli: &str,
) -> Vec<CompletedTurn> {
    let mut turns = Vec::new();
    let mut pending_user: Option<&PersistedChatMessage> = None;

    for message in messages {
        if message.role == "user" {
            pending_user = Some(message);
            continue;
        }

        if message.role != "assistant" || message.is_streaming {
            continue;
        }

        let Some(user) = pending_user else {
            continue;
        };

        turns.push(CompletedTurn {
            user_message_id: user.id.clone(),
            assistant_message_id: message.id.clone(),
            cli_id: message
                .cli_id
                .clone()
                .unwrap_or_else(|| fallback_cli.to_string()),
            user_prompt: user
                .raw_content
                .clone()
                .unwrap_or_else(|| user.content.clone()),
            assistant_reply: message
                .raw_content
                .clone()
                .unwrap_or_else(|| message.content.clone()),
            timestamp: message.timestamp.clone(),
        });
        pending_user = None;
    }

    turns
}

fn build_manual_compaction_summary(
    task: &TaskPacket,
    previous_snapshot: Option<&ContextSnapshot>,
    summarized_turns: &[CompletedTurn],
) -> String {
    let mut parts = Vec::new();
    parts.push(format!("Task goal: {}", task.goal));

    if let Some(snapshot) = previous_snapshot {
        parts.push("Previously compacted context:".to_string());
        parts.push(snapshot.summary.clone());
    }

    parts.push("Newly compacted turns:".to_string());
    for turn in summarized_turns.iter().rev().take(16).rev() {
        parts.push(format!(
            "- [{} at {}] User: {} | Summary: {}",
            turn.cli_id,
            turn.timestamp,
            truncate_text(&turn.user_prompt, 400),
            truncate_text(&turn.assistant_reply, 500)
        ));
    }

    if let Some(conclusion) = task.latest_conclusion.as_ref() {
        if !conclusion.trim().is_empty() {
            parts.push(format!("Latest conclusion before compact: {}", conclusion));
        }
    }
    if !task.relevant_files.is_empty() {
        parts.push(format!(
            "Relevant files: {}",
            task.relevant_files.join(", ")
        ));
    }
    if let Some(next_step) = task.next_step.as_ref() {
        if !next_step.trim().is_empty() {
            parts.push(format!("Next step: {}", next_step));
        }
    }

    parts.join("\n")
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    let normalized = text.replace('\n', " ");
    let trimmed = normalized.trim();
    let mut chars = trimmed.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        let mut value = truncated;
        value.push('…');
        value
    } else {
        truncated
    }
}

/// Sanitize user input for FTS5 MATCH queries.
/// Strips FTS5 operators, wraps tokens with quotes, joins with OR for broad matching.
fn sanitize_fts5_query(raw: &str) -> String {
    let tokens: Vec<String> = raw
        .split_whitespace()
        .map(|token| {
            // Strip FTS5 special chars: * " ( ) : ^ { } -
            let cleaned: String = token
                .chars()
                .filter(|c| !matches!(c, '*' | '"' | '(' | ')' | ':' | '^' | '{' | '}' | '-'))
                .collect();
            cleaned
        })
        .filter(|t| !t.is_empty() && !matches!(t.as_str(), "AND" | "OR" | "NOT" | "NEAR"))
        .map(|t| format!("\"{}\"", t))
        .collect();

    if tokens.is_empty() {
        return String::new();
    }
    tokens.join(" OR ")
}

fn push_layer(
    lines: &mut Vec<String>,
    included_layers: &mut Vec<String>,
    layer_name: &str,
    content: &str,
) {
    if content.trim().is_empty() {
        return;
    }
    lines.push(content.to_string());
    included_layers.push(layer_name.to_string());
}

fn estimate_joined_len(lines: &[String], candidate: &str, prompt: &str) -> usize {
    let mut total = lines.iter().map(|line| line.len() + 2).sum::<usize>();
    if !candidate.is_empty() {
        total += candidate.len() + 2;
    }
    total + prompt.len() + 32
}

fn format_turns_block(title: &str, turns: &[TaskRecentTurn]) -> String {
    let mut lines = vec![title.to_string()];
    for turn in turns {
        lines.push(format!(
            "[{} at {}] User: {}\nAssistant summary: {}",
            turn.cli_id,
            turn.timestamp,
            turn.user_prompt,
            truncate_text(&turn.assistant_reply, 1200)
        ));
    }
    lines.join("\n")
}

fn normalized_identity_key(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>()
        .split('_')
        .filter(|part| !part.is_empty())
        .take(18)
        .collect::<Vec<_>>()
        .join("_")
}

fn stable_fact_id(task_id: &str, kind: &str, subject: &str, statement: &str) -> String {
    format!(
        "fact::{}::{}::{}::{}",
        task_id,
        normalized_identity_key(kind),
        normalized_identity_key(subject),
        normalized_identity_key(statement)
    )
}

fn stable_memory_id(scope: &str, scope_ref: &str, kind: &str, content: &str) -> String {
    format!(
        "memory::{}::{}::{}::{}",
        normalized_identity_key(scope),
        scope_ref,
        normalized_identity_key(kind),
        normalized_identity_key(content)
    )
}

fn select_current_work_item(items: &[KernelWorkItem]) -> Option<KernelWorkItem> {
    let priority = |status: &str| match status {
        "running" => 0,
        "blocked" => 1,
        "planned" => 2,
        "pending" => 3,
        "failed" => 4,
        "completed" => 5,
        _ => 6,
    };

    items
        .iter()
        .min_by_key(|item| {
            (
                priority(&item.status),
                std::cmp::Reverse(item.updated_at.clone()),
            )
        })
        .cloned()
}

fn select_work_items_for_cli<'a>(
    items: &'a [KernelWorkItem],
    target_cli: &str,
) -> Vec<&'a KernelWorkItem> {
    items
        .iter()
        .filter(|item| {
            target_cli == "claude"
                || item.owner_cli == target_cli
                || matches!(item.status.as_str(), "running" | "blocked")
        })
        .take(6)
        .collect()
}

fn select_kernel_facts_for_cli<'a>(
    facts: &'a [KernelFact],
    target_cli: &str,
) -> Vec<&'a KernelFact> {
    let limit = if target_cli == "claude" { 8 } else { 6 };
    facts
        .iter()
        .filter(|fact| {
            if target_cli == "claude" {
                true
            } else if target_cli == "gemini" {
                matches!(fact.kind.as_str(), "decision" | "codebase" | "output")
            } else {
                matches!(
                    fact.kind.as_str(),
                    "runtime" | "codebase" | "output" | "decision"
                )
            }
        })
        .take(limit)
        .collect()
}

fn select_kernel_evidence_for_cli<'a>(
    evidence: &'a [KernelEvidence],
    target_cli: &str,
) -> Vec<&'a KernelEvidence> {
    evidence
        .iter()
        .filter(|entry| {
            if target_cli == "claude" {
                true
            } else if target_cli == "gemini" {
                matches!(
                    entry.evidence_type.as_str(),
                    "fileChange" | "assistantMessage" | "toolCall"
                )
            } else {
                matches!(
                    entry.evidence_type.as_str(),
                    "command" | "fileChange" | "assistantMessage"
                )
            }
        })
        .take(if target_cli == "claude" { 8 } else { 5 })
        .collect()
}

fn select_memory_for_cli_with_budget<'a>(
    memory_entries: &'a [KernelMemoryEntry],
    target_cli: &str,
    current_work_item: Option<&KernelWorkItem>,
    relevant_files: &[String],
) -> Vec<&'a KernelMemoryEntry> {
    let mut scored = memory_entries
        .iter()
        .filter_map(|entry| {
            let score = score_memory_for_cli(entry, target_cli, current_work_item, relevant_files);
            if score > 0 {
                Some((score, entry))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    scored.sort_by(|left, right| right.0.cmp(&left.0));
    let budget = if target_cli == "claude" { 8 } else { 4 };
    scored
        .into_iter()
        .take(budget)
        .map(|(_, entry)| entry)
        .collect()
}

fn extract_fact_subject(kind: &str, entry: &KernelEvidence, assistant_summary: &str) -> String {
    if let Some(payload) = entry
        .payload_ref
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return normalized_identity_key(payload);
    }
    if entry.evidence_type == "assistantMessage" {
        if let Some(backtick) = assistant_summary
            .split('`')
            .nth(1)
            .filter(|value| !value.trim().is_empty())
        {
            return normalized_identity_key(backtick);
        }
    }
    if kind == "output" {
        return "current_turn".to_string();
    }
    "general".to_string()
}

fn detect_fact_polarity(kind: &str, summary: &str, status: &str) -> String {
    let lowered = summary.to_ascii_lowercase();
    if kind == "risk" {
        return "negative".to_string();
    }
    if lowered.contains("failed")
        || lowered.contains("error")
        || lowered.contains("unable")
        || lowered.contains("denied")
    {
        return "negative".to_string();
    }
    if status == "verified"
        || lowered.contains("succeeded")
        || lowered.contains("completed")
        || lowered.contains("fixed")
    {
        return "positive".to_string();
    }
    "neutral".to_string()
}

fn default_memory_priority_for_kind(kind: &str) -> &'static str {
    match kind {
        "decision" | "requirement" => "high",
        "codebase" | "runtime" => "medium",
        _ => "low",
    }
}

fn default_memory_tags_from_kind(kind: &str) -> Vec<String> {
    match kind {
        "decision" => vec!["decision".to_string(), "workflow".to_string()],
        "requirement" => vec!["requirement".to_string()],
        "codebase" => vec!["codebase".to_string()],
        "runtime" => vec!["runtime".to_string()],
        "risk" => vec!["risk".to_string()],
        _ => vec!["output".to_string()],
    }
}

fn default_memory_tags_for_fact(fact: &KernelFact) -> Vec<String> {
    let mut tags = default_memory_tags_from_kind(&fact.kind);
    if fact.subject != "general" {
        tags.push(fact.subject.clone());
    }
    tags
}

fn parse_rfc3339_millis(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|item| item.timestamp_millis())
        .unwrap_or(0)
}

fn score_memory_for_cli(
    entry: &KernelMemoryEntry,
    target_cli: &str,
    current_work_item: Option<&KernelWorkItem>,
    relevant_files: &[String],
) -> i64 {
    let scope_score = match entry.scope.as_str() {
        "task" => 40,
        "workspace" => 24,
        "global" => 12,
        _ => 0,
    };
    let pin_score = match entry.pin_state.as_str() {
        "manual" => 100,
        "auto" => 20,
        _ => 0,
    };
    let priority_score = match entry.priority.as_str() {
        "high" => 30,
        "medium" => 15,
        _ => 5,
    };
    let affinity_score = if target_cli == "claude" {
        if matches!(entry.kind.as_str(), "decision" | "requirement" | "risk") {
            24
        } else {
            10
        }
    } else if target_cli == "gemini" {
        if matches!(entry.kind.as_str(), "decision" | "requirement" | "codebase") {
            20
        } else {
            6
        }
    } else if matches!(entry.kind.as_str(), "codebase" | "runtime" | "output") {
        20
    } else {
        8
    };
    let freshness_score = {
        let age_ms = Local::now().timestamp_millis() - parse_rfc3339_millis(&entry.updated_at);
        if age_ms <= 86_400_000 {
            20
        } else if age_ms <= 604_800_000 {
            10
        } else if age_ms <= 2_592_000_000 {
            4
        } else {
            0
        }
    };
    let usage_score = (entry.use_count.min(5) as i64) * 2;
    let relevance_score = current_work_item
        .map(|item| {
            let title = item.title.to_ascii_lowercase();
            let summary = item
                .summary
                .clone()
                .unwrap_or_default()
                .to_ascii_lowercase();
            let content = entry.content.to_ascii_lowercase();
            if content.contains(&title) || (!summary.is_empty() && content.contains(&summary)) {
                20
            } else {
                0
            }
        })
        .unwrap_or(0)
        + if relevant_files.iter().any(|file| {
            let key = std::path::Path::new(file)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(file)
                .to_ascii_lowercase();
            entry.content.to_ascii_lowercase().contains(&key)
        }) {
            16
        } else {
            0
        };
    let decay_penalty =
        if entry.decay_eligible && entry.pin_state != "manual" && freshness_score == 0 {
            12
        } else {
            0
        };

    scope_score
        + pin_score
        + priority_score
        + affinity_score
        + freshness_score
        + usage_score
        + relevance_score
        - decay_penalty
}

fn merge_fact_status(existing: &str, incoming: &str) -> String {
    match (existing, incoming) {
        ("verified", _) | (_, "verified") => "verified".to_string(),
        ("invalidated", "pending") => "pending".to_string(),
        (_, "pending") => "pending".to_string(),
        _ => incoming.to_string(),
    }
}

fn merge_fact_confidence(existing: &str, incoming: &str) -> String {
    let score = |value: &str| match value {
        "high" => 3,
        "medium" => 2,
        _ => 1,
    };
    if score(existing) >= score(incoming) {
        existing.to_string()
    } else {
        incoming.to_string()
    }
}

fn collect_relevant_files_from_blocks_option(
    blocks: Option<&Vec<ChatMessageBlock>>,
) -> Vec<String> {
    let mut files = Vec::new();
    let Some(blocks) = blocks else {
        return files;
    };
    for block in blocks {
        if let ChatMessageBlock::FileChange { path, .. } = block {
            if !path.trim().is_empty() && !files.iter().any(|existing| existing == path) {
                files.push(path.clone());
            }
        }
    }
    files
}

fn build_kernel_evidence_records(
    task_id: &str,
    message_id: &str,
    terminal_tab_id: &str,
    cli_id: &str,
    assistant_summary: &str,
    blocks: Option<&Vec<ChatMessageBlock>>,
    timestamp: &str,
) -> Vec<KernelEvidence> {
    let mut records = vec![KernelEvidence {
        id: new_id("evidence"),
        task_id: task_id.to_string(),
        message_id: message_id.to_string(),
        terminal_tab_id: terminal_tab_id.to_string(),
        cli_id: cli_id.to_string(),
        evidence_type: "assistantMessage".to_string(),
        summary: truncate_text(assistant_summary, 320),
        payload_ref: Some(message_id.to_string()),
        timestamp: timestamp.to_string(),
    }];

    let Some(blocks) = blocks else {
        return records;
    };

    for block in blocks {
        let entry = match block {
            ChatMessageBlock::Command {
                label,
                command,
                exit_code,
                ..
            } => Some(KernelEvidence {
                id: new_id("evidence"),
                task_id: task_id.to_string(),
                message_id: message_id.to_string(),
                terminal_tab_id: terminal_tab_id.to_string(),
                cli_id: cli_id.to_string(),
                evidence_type: "command".to_string(),
                summary: format!(
                    "Command {}: {}",
                    if exit_code.unwrap_or(0) == 0 {
                        "succeeded"
                    } else {
                        "failed"
                    },
                    truncate_text(
                        if label.trim().is_empty() {
                            command
                        } else {
                            label
                        },
                        180
                    )
                ),
                payload_ref: Some(truncate_text(command, 220)),
                timestamp: timestamp.to_string(),
            }),
            ChatMessageBlock::FileChange {
                path, change_type, ..
            } => Some(KernelEvidence {
                id: new_id("evidence"),
                task_id: task_id.to_string(),
                message_id: message_id.to_string(),
                terminal_tab_id: terminal_tab_id.to_string(),
                cli_id: cli_id.to_string(),
                evidence_type: "fileChange".to_string(),
                summary: format!("File {}: {}", change_type, path),
                payload_ref: Some(path.clone()),
                timestamp: timestamp.to_string(),
            }),
            ChatMessageBlock::Tool {
                tool,
                summary,
                source,
                ..
            } => Some(KernelEvidence {
                id: new_id("evidence"),
                task_id: task_id.to_string(),
                message_id: message_id.to_string(),
                terminal_tab_id: terminal_tab_id.to_string(),
                cli_id: cli_id.to_string(),
                evidence_type: "toolCall".to_string(),
                summary: format!(
                    "Tool {}{}",
                    tool,
                    summary
                        .as_ref()
                        .filter(|value| !value.trim().is_empty())
                        .map(|value| format!(": {}", truncate_text(value, 180)))
                        .unwrap_or_default()
                ),
                payload_ref: source.clone(),
                timestamp: timestamp.to_string(),
            }),
            ChatMessageBlock::Status { level, text } => Some(KernelEvidence {
                id: new_id("evidence"),
                task_id: task_id.to_string(),
                message_id: message_id.to_string(),
                terminal_tab_id: terminal_tab_id.to_string(),
                cli_id: cli_id.to_string(),
                evidence_type: "status".to_string(),
                summary: format!("Status {}: {}", level, truncate_text(text, 180)),
                payload_ref: None,
                timestamp: timestamp.to_string(),
            }),
            _ => None,
        };
        if let Some(entry) = entry {
            records.push(entry);
        }
    }

    records
}

fn build_kernel_fact_records(
    task_id: &str,
    cli_id: &str,
    assistant_summary: &str,
    exit_code: Option<i32>,
    evidence: &[KernelEvidence],
    updated_at: &str,
) -> Vec<KernelFact> {
    let mut facts = Vec::new();
    let assistant_evidence_ids = evidence
        .iter()
        .filter(|entry| entry.evidence_type == "assistantMessage")
        .map(|entry| entry.id.clone())
        .collect::<Vec<_>>();

    if !assistant_summary.trim().is_empty() {
        let subject = if let Some(primary) = evidence
            .iter()
            .find(|entry| entry.evidence_type != "assistantMessage")
        {
            extract_fact_subject("output", primary, assistant_summary)
        } else {
            "current_turn".to_string()
        };
        let status = if exit_code == Some(0) {
            "inferred".to_string()
        } else {
            "pending".to_string()
        };
        facts.push(KernelFact {
            id: stable_fact_id(task_id, "output", &subject, assistant_summary),
            task_id: task_id.to_string(),
            kind: "output".to_string(),
            subject,
            polarity: detect_fact_polarity("output", assistant_summary, &status),
            origin: "assistant".to_string(),
            statement: truncate_text(assistant_summary, 320),
            status,
            source_evidence_ids: assistant_evidence_ids,
            supersedes_fact_ids: Vec::new(),
            owner_cli: cli_id.to_string(),
            confidence: "medium".to_string(),
            updated_at: updated_at.to_string(),
        });
    }

    for entry in evidence {
        if entry.evidence_type == "assistantMessage" {
            continue;
        }
        let (kind, status, confidence) = match entry.evidence_type.as_str() {
            "fileChange" => ("codebase", "verified", "high"),
            "command" if entry.summary.contains("failed") => ("runtime", "pending", "high"),
            "command" => ("runtime", "verified", "high"),
            "status" if entry.summary.to_ascii_lowercase().contains("error") => {
                ("risk", "pending", "medium")
            }
            "toolCall" => ("decision", "inferred", "medium"),
            _ => ("output", "inferred", "low"),
        };
        let subject = extract_fact_subject(kind, entry, assistant_summary);
        facts.push(KernelFact {
            id: stable_fact_id(task_id, kind, &subject, &entry.summary),
            task_id: task_id.to_string(),
            kind: kind.to_string(),
            subject,
            polarity: detect_fact_polarity(kind, &entry.summary, status),
            origin: match entry.evidence_type.as_str() {
                "command" => "command".to_string(),
                "fileChange" => "file".to_string(),
                "toolCall" => "tool".to_string(),
                "status" => "assistant".to_string(),
                _ => "assistant".to_string(),
            },
            statement: entry.summary.clone(),
            status: status.to_string(),
            source_evidence_ids: vec![entry.id.clone()],
            supersedes_fact_ids: Vec::new(),
            owner_cli: cli_id.to_string(),
            confidence: confidence.to_string(),
            updated_at: updated_at.to_string(),
        });
    }

    facts
}

fn build_kernel_plan_record(
    task_id: &str,
    blocks: Option<&Vec<ChatMessageBlock>>,
    updated_at: &str,
) -> Option<KernelPlan> {
    let blocks = blocks?;
    for block in blocks {
        match block {
            ChatMessageBlock::OrchestrationPlan {
                title,
                goal,
                summary,
                status,
            } => {
                return Some(KernelPlan {
                    id: format!("plan::{}", task_id),
                    task_id: task_id.to_string(),
                    title: title.clone(),
                    goal: goal.clone(),
                    summary: summary.clone(),
                    status: status.clone().unwrap_or_else(|| "active".to_string()),
                    updated_at: updated_at.to_string(),
                });
            }
            ChatMessageBlock::Plan { text } => {
                return Some(KernelPlan {
                    id: format!("plan::{}", task_id),
                    task_id: task_id.to_string(),
                    title: "Active plan".to_string(),
                    goal: truncate_text(text, 180),
                    summary: Some(text.clone()),
                    status: "active".to_string(),
                    updated_at: updated_at.to_string(),
                });
            }
            _ => {}
        }
    }
    None
}

fn build_kernel_work_item_records(
    task_id: &str,
    fallback_cli: &str,
    blocks: Option<&Vec<ChatMessageBlock>>,
    updated_at: &str,
) -> Vec<KernelWorkItem> {
    let mut items = Vec::new();
    let Some(blocks) = blocks else {
        return items;
    };

    for block in blocks {
        match block {
            ChatMessageBlock::OrchestrationStep {
                step_id,
                owner,
                title,
                summary,
                result,
                status,
            } => items.push(KernelWorkItem {
                id: format!("workitem::{}::{}", task_id, step_id),
                task_id: task_id.to_string(),
                step_id: Some(step_id.clone()),
                owner_cli: owner.clone(),
                title: title.clone(),
                summary: summary.clone(),
                result: result.clone(),
                status: status.clone().unwrap_or_else(|| "planned".to_string()),
                updated_at: updated_at.to_string(),
            }),
            ChatMessageBlock::AutoRoute {
                target_cli,
                title,
                reason,
                state,
                ..
            } => items.push(KernelWorkItem {
                id: format!("workitem::{}::autoroute::{}", task_id, title),
                task_id: task_id.to_string(),
                step_id: None,
                owner_cli: target_cli.clone(),
                title: title.clone(),
                summary: Some(reason.clone()),
                result: None,
                status: state.clone().unwrap_or_else(|| "pending".to_string()),
                updated_at: updated_at.to_string(),
            }),
            ChatMessageBlock::Plan { text } => items.push(KernelWorkItem {
                id: format!("workitem::{}::plan-text", task_id),
                task_id: task_id.to_string(),
                step_id: None,
                owner_cli: fallback_cli.to_string(),
                title: "Planned next action".to_string(),
                summary: Some(truncate_text(text, 220)),
                result: None,
                status: "planned".to_string(),
                updated_at: updated_at.to_string(),
            }),
            _ => {}
        }
    }

    items
}
