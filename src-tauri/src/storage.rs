use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use chrono::Local;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use uuid::Uuid;

use crate::{AgentTransportSession, ChatMessageBlock};

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
    pub branch: String,
    pub current_writer: String,
    pub active_agent: String,
    pub dirty_files: usize,
    pub failing_checks: usize,
    pub handoff_ready: bool,
    pub last_snapshot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTerminalTab {
    pub id: String,
    pub title: String,
    pub workspace_id: String,
    pub selected_cli: String,
    pub plan_mode: bool,
    pub fast_mode: bool,
    pub effort_level: Option<String>,
    pub model_overrides: BTreeMap<String, String>,
    pub permission_overrides: BTreeMap<String, String>,
    pub transport_sessions: BTreeMap<String, AgentTransportSession>,
    pub draft_prompt: String,
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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedChatMessage {
    pub id: String,
    pub role: String,
    pub cli_id: Option<String>,
    pub timestamp: String,
    pub content: String,
    pub raw_content: Option<String>,
    pub content_format: Option<String>,
    pub transport_kind: Option<String>,
    pub blocks: Option<Vec<ChatMessageBlock>>,
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

    pub fn append_chat_messages(
        &self,
        request: &MessageEventsAppendRequest,
    ) -> Result<(), String> {
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
        tx.commit().map_err(|err| err.to_string())
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
            tx.execute("DELETE FROM compact_boundaries WHERE task_id = ?1", [&task_id])
                .map_err(|err| err.to_string())?;
            tx.execute("DELETE FROM context_packs WHERE task_id = ?1", [&task_id])
                .map_err(|err| err.to_string())?;
            tx.execute("DELETE FROM context_package_logs WHERE task_id = ?1", [&task_id])
                .map_err(|err| err.to_string())?;
            tx.execute("DELETE FROM context_snapshots WHERE task_id = ?1", [&task_id])
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
                    id, name, root_path, branch, current_writer, active_agent,
                    dirty_files, failing_checks, handoff_ready, last_snapshot, workspace_order
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    workspace.id,
                    workspace.name,
                    workspace.root_path,
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
                    id, title, workspace_id, selected_cli, plan_mode, fast_mode, effort_level,
                    model_overrides_json, permission_overrides_json, transport_sessions_json,
                    draft_prompt, status, last_active_at, tab_order
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    tab.id,
                    tab.title,
                    tab.workspace_id,
                    tab.selected_cli,
                    tab.plan_mode,
                    tab.fast_mode,
                    tab.effort_level,
                    to_json(&tab.model_overrides)?,
                    to_json(&tab.permission_overrides)?,
                    to_json(&tab.transport_sessions)?,
                    tab.draft_prompt,
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
                plan_mode INTEGER NOT NULL,
                fast_mode INTEGER NOT NULL,
                effort_level TEXT,
                model_overrides_json TEXT NOT NULL,
                permission_overrides_json TEXT NOT NULL,
                transport_sessions_json TEXT NOT NULL,
                draft_prompt TEXT NOT NULL,
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
                timestamp TEXT NOT NULL,
                content TEXT NOT NULL,
                raw_content TEXT,
                content_format TEXT,
                transport_kind TEXT,
                blocks_json TEXT,
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
            ",
        )
        .map_err(|err| err.to_string())
    }

    fn load_workspaces(&self, conn: &Connection) -> Result<Vec<PersistedWorkspaceRef>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, root_path, branch, current_writer, active_agent,
                        dirty_files, failing_checks, handoff_ready, last_snapshot
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
                    branch: row.get(3)?,
                    current_writer: row.get(4)?,
                    active_agent: row.get(5)?,
                    dirty_files: row.get::<_, i64>(6)? as usize,
                    failing_checks: row.get::<_, i64>(7)? as usize,
                    handoff_ready: row.get(8)?,
                    last_snapshot: row.get(9)?,
                })
            })
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())
    }

    fn load_terminal_tabs(&self, conn: &Connection) -> Result<Vec<PersistedTerminalTab>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, workspace_id, selected_cli, plan_mode, fast_mode, effort_level,
                        model_overrides_json, permission_overrides_json, transport_sessions_json,
                        draft_prompt, status, last_active_at
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
                    plan_mode: row.get(4)?,
                    fast_mode: row.get(5)?,
                    effort_level: row.get(6)?,
                    model_overrides: parse_json_default(row.get::<_, String>(7)?),
                    permission_overrides: parse_json_default(row.get::<_, String>(8)?),
                    transport_sessions: parse_json_default(row.get::<_, String>(9)?),
                    draft_prompt: row.get(10)?,
                    status: row.get(11)?,
                    last_active_at: row.get(12)?,
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
                "SELECT id, terminal_tab_id, workspace_id, project_root, project_name, created_at, updated_at
                 FROM conversation_sessions",
            )
            .map_err(|err| err.to_string())?;
        let mut rows = stmt.query([]).map_err(|err| err.to_string())?;
        let mut sessions = BTreeMap::new();

        while let Some(row) = rows.next().map_err(|err| err.to_string())? {
            let session_id: String = row.get(0).map_err(|err| err.to_string())?;
            let terminal_tab_id: String = row.get(1).map_err(|err| err.to_string())?;
            let session = PersistedConversationSession {
                id: session_id.clone(),
                terminal_tab_id: terminal_tab_id.clone(),
                workspace_id: row.get(2).map_err(|err| err.to_string())?,
                project_root: row.get(3).map_err(|err| err.to_string())?,
                project_name: row.get(4).map_err(|err| err.to_string())?,
                messages: self.load_messages(conn, &session_id)?,
                created_at: row.get(5).map_err(|err| err.to_string())?,
                updated_at: row.get(6).map_err(|err| err.to_string())?,
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
                "SELECT id, role, cli_id, timestamp, content, raw_content, content_format,
                        transport_kind, blocks_json, is_streaming, duration_ms, exit_code
                 FROM chat_messages
                 WHERE session_id = ?1
                 ORDER BY message_order ASC",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map([session_id], |row| {
                let blocks_json = row.get::<_, Option<String>>(8)?;
                Ok(PersistedChatMessage {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    cli_id: row.get(2)?,
                    timestamp: row.get(3)?,
                    content: row.get(4)?,
                    raw_content: row.get(5)?,
                    content_format: row.get(6)?,
                    transport_kind: row.get(7)?,
                    blocks: blocks_json
                        .as_deref()
                        .and_then(|raw| serde_json::from_str::<Vec<ChatMessageBlock>>(raw).ok()),
                    is_streaming: row.get(9)?,
                    duration_ms: row.get::<_, Option<i64>>(10)?.map(|value| value as u64),
                    exit_code: row.get(11)?,
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
                "SELECT id, terminal_tab_id, workspace_id, project_root, project_name, created_at, updated_at
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
        Ok(Some(PersistedConversationSession {
            id: session_id.clone(),
            terminal_tab_id: row.get(1).map_err(|err| err.to_string())?,
            workspace_id: row.get(2).map_err(|err| err.to_string())?,
            project_root: row.get(3).map_err(|err| err.to_string())?,
            project_name: row.get(4).map_err(|err| err.to_string())?,
            messages: self.load_messages(conn, &session_id)?,
            created_at: row.get(5).map_err(|err| err.to_string())?,
            updated_at: row.get(6).map_err(|err| err.to_string())?,
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
            let latest_conclusion = request
                .latest_assistant_summary
                .clone()
                .or_else(|| task.latest_conclusion.clone());
            let merged_files = merge_string_lists(&task.relevant_files, &request.relevant_files);
            let next_step = Some(format!("Continue the active task in {}.", request.to_cli));

            tx.execute(
                "INSERT INTO handoff_events (
                    id, task_id, terminal_tab_id, from_cli, to_cli, reason, latest_conclusion,
                    files_json, risks_json, next_step, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
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
        let result =
            self.compact_terminal_tab_in_tx(&tx, terminal_tab_id, "auto-budget", false)?;
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
        tx.execute(
            "INSERT INTO conversation_sessions (
                id, terminal_tab_id, workspace_id, project_root, project_name, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(terminal_tab_id) DO UPDATE SET
                id = excluded.id,
                workspace_id = excluded.workspace_id,
                project_root = excluded.project_root,
                project_name = excluded.project_name,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at",
            params![
                session.id,
                session.terminal_tab_id,
                session.workspace_id,
                session.project_root,
                session.project_name,
                session.created_at,
                session.updated_at,
            ],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    }

    fn count_messages_for_session(&self, tx: &Connection, session_id: &str) -> Result<usize, String> {
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
                    id, session_id, terminal_tab_id, message_order, role, cli_id, timestamp,
                    content, raw_content, content_format, transport_kind, blocks_json,
                    is_streaming, duration_ms, exit_code
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    message.id,
                    session_id,
                    terminal_tab_id,
                    next_order,
                    message.role,
                    message.cli_id,
                    message.timestamp,
                    message.content,
                    message.raw_content,
                    message.content_format,
                    message.transport_kind,
                    option_to_json(&message.blocks)?,
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

        push_layer(&mut lines, &mut included_layers, "workspace", workspace_preamble);
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
                &format!("--- Latest compacted task snapshot ---\n{}", snapshot.summary),
            );
        }

        if !hot_turns.is_empty() {
            let hot_text = format_turns_block("--- Active hot turns after compaction ---", &hot_turns);
            push_layer(&mut lines, &mut included_layers, "hot_turns", &hot_text);
        } else if !fallback_recent_turns.is_empty() {
            let fallback_text =
                format_turns_block("--- Recent conversation in this terminal tab only ---", fallback_recent_turns);
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

        if raw_turns.len() > hot_turns.len() && estimate_joined_len(&lines, "", prompt) < profile.max_chars {
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
                .map(|turn| truncate_text(&turn.assistant_reply, 240))
                .collect(),
            work_completed: summarized_turns
                .iter()
                .map(|turn| {
                    format!(
                        "[{}] {}",
                        turn.cli_id,
                        truncate_text(&turn.assistant_reply, 180)
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
                .map(|turn| truncate_text(&turn.assistant_reply, 240)),
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
                    files_json, risks_json, next_step, created_at
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
                    created_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())
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
            180_000
        } else if target_cli == "claude" {
            240_000
        } else {
            160_000
        };
        ContextBudgetProfile {
            profile_id: if max_chars >= 240_000 {
                "xlarge".to_string()
            } else if max_chars >= 180_000 {
                "large".to_string()
            } else {
                "medium".to_string()
            },
            max_chars,
            max_hot_turns: 6,
            max_raw_turns: 12,
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
            user_prompt: user.content.clone(),
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
    for turn in summarized_turns.iter().rev().take(8).rev() {
        parts.push(format!(
            "- [{} at {}] User: {} | Summary: {}",
            turn.cli_id,
            turn.timestamp,
            truncate_text(&turn.user_prompt, 160),
            truncate_text(&turn.assistant_reply, 220)
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
            truncate_text(&turn.assistant_reply, 280)
        ));
    }
    lines.join("\n")
}
