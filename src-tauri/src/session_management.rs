use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use dirs::{data_local_dir, home_dir};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::local_usage::{
    scan_claude_session_summaries, scan_codex_session_summaries, scan_gemini_session_summaries,
    LocalUsageSessionSummary,
};
use crate::storage::PersistedWorkspaceRef;

const SESSION_CATALOG_DEFAULT_LIMIT: usize = 50;
const SESSION_CATALOG_MAX_LIMIT: usize = 200;
const SESSION_CATALOG_CURSOR_PREFIX: &str = "offset:";
const SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID: &str = "__global_unassigned__";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogEntry {
    pub(crate) session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) canonical_session_id: Option<String>,
    pub(crate) workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) workspace_label: Option<String>,
    pub(crate) engine: String,
    pub(crate) title: String,
    pub(crate) updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) archived_at: Option<i64>,
    pub(crate) thread_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) attribution_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) attribution_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) attribution_confidence: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) matched_workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) matched_workspace_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogQuery {
    #[serde(default)]
    pub(crate) keyword: Option<String>,
    #[serde(default)]
    pub(crate) engine: Option<String>,
    #[serde(default)]
    pub(crate) status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogPage {
    pub(crate) data: Vec<WorkspaceSessionCatalogEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) next_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) partial_source: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum WorkspaceSessionProjectionScopeKind {
    Project,
    Worktree,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionProjectionSummary {
    pub(crate) scope_kind: WorkspaceSessionProjectionScopeKind,
    pub(crate) owner_workspace_ids: Vec<String>,
    pub(crate) active_total: usize,
    pub(crate) archived_total: usize,
    pub(crate) all_total: usize,
    pub(crate) filtered_total: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) partial_sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionBatchMutationResult {
    pub(crate) session_id: String,
    pub(crate) ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) archived_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionBatchMutationResponse {
    pub(crate) results: Vec<WorkspaceSessionBatchMutationResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SessionManagementMetadata {
    #[serde(default)]
    archived_at_by_session_key: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionStatusFilter {
    Active,
    Archived,
    All,
}

#[derive(Debug, Clone)]
struct SessionRecord {
    entry: WorkspaceSessionCatalogEntry,
    source_path: Option<String>,
}

#[tauri::command]
pub(crate) async fn list_workspace_sessions(
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
    store: State<'_, crate::AppStore>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    let workspaces = load_workspaces(&store)?;
    let metadata = load_metadata()?;
    let workspace = find_workspace(&workspaces, &workspace_id)?;
    let entries = build_workspace_entries(workspace, &metadata)?;
    Ok(build_page(
        apply_query(entries, query.as_ref()),
        cursor.as_deref(),
        limit,
    ))
}

#[tauri::command]
pub(crate) async fn list_global_codex_sessions(
    query: Option<WorkspaceSessionCatalogQuery>,
    cursor: Option<String>,
    limit: Option<u32>,
    store: State<'_, crate::AppStore>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    let workspaces = load_workspaces(&store)?;
    let metadata = load_metadata()?;
    let entries = build_global_codex_entries(&workspaces, &metadata)?;
    Ok(build_page(
        apply_query(entries, query.as_ref()),
        cursor.as_deref(),
        limit,
    ))
}

#[tauri::command]
pub(crate) async fn list_project_related_codex_sessions(
    _workspace_id: String,
    _query: Option<WorkspaceSessionCatalogQuery>,
    _cursor: Option<String>,
    _limit: Option<u32>,
    _store: State<'_, crate::AppStore>,
) -> Result<WorkspaceSessionCatalogPage, String> {
    Ok(WorkspaceSessionCatalogPage {
        data: Vec::new(),
        next_cursor: None,
        partial_source: None,
    })
}

#[tauri::command]
pub(crate) async fn get_workspace_session_projection_summary(
    workspace_id: String,
    query: Option<WorkspaceSessionCatalogQuery>,
    store: State<'_, crate::AppStore>,
) -> Result<WorkspaceSessionProjectionSummary, String> {
    let workspaces = load_workspaces(&store)?;
    let metadata = load_metadata()?;
    let workspace = find_workspace(&workspaces, &workspace_id)?;
    let entries = build_workspace_entries(workspace, &metadata)?;
    let active_total = entries
        .iter()
        .filter(|record| record.entry.archived_at.is_none())
        .count();
    let archived_total = entries
        .iter()
        .filter(|record| record.entry.archived_at.is_some())
        .count();
    let filtered_total = apply_query(entries.clone(), query.as_ref()).len();
    Ok(WorkspaceSessionProjectionSummary {
        scope_kind: WorkspaceSessionProjectionScopeKind::Project,
        owner_workspace_ids: vec![workspace_id],
        active_total,
        archived_total,
        all_total: entries.len(),
        filtered_total,
        partial_sources: Vec::new(),
    })
}

#[tauri::command]
pub(crate) async fn archive_workspace_sessions(
    workspace_id: String,
    session_ids: Vec<String>,
    store: State<'_, crate::AppStore>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    mutate_workspace_sessions(&store, &workspace_id, &session_ids, MutationKind::Archive)
}

#[tauri::command]
pub(crate) async fn unarchive_workspace_sessions(
    workspace_id: String,
    session_ids: Vec<String>,
    store: State<'_, crate::AppStore>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    mutate_workspace_sessions(&store, &workspace_id, &session_ids, MutationKind::Unarchive)
}

#[tauri::command]
pub(crate) async fn delete_workspace_sessions(
    workspace_id: String,
    session_ids: Vec<String>,
    store: State<'_, crate::AppStore>,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    mutate_workspace_sessions(&store, &workspace_id, &session_ids, MutationKind::Delete)
}

#[derive(Debug, Clone, Copy)]
enum MutationKind {
    Archive,
    Unarchive,
    Delete,
}

fn mutate_workspace_sessions(
    store: &State<'_, crate::AppStore>,
    workspace_id: &str,
    session_ids: &[String],
    kind: MutationKind,
) -> Result<WorkspaceSessionBatchMutationResponse, String> {
    let workspaces = load_workspaces(store)?;
    let workspace = find_workspace(&workspaces, workspace_id)?;
    let entries = build_workspace_entries(workspace, &load_metadata()?)?;
    let entries_by_session_id = entries
        .into_iter()
        .map(|record| (record.entry.session_id.clone(), record))
        .collect::<HashMap<_, _>>();
    let mut metadata = load_metadata()?;
    let mut results = Vec::new();

    for session_id in session_ids {
        let Some(record) = entries_by_session_id.get(session_id) else {
            results.push(WorkspaceSessionBatchMutationResult {
                session_id: session_id.clone(),
                ok: false,
                archived_at: None,
                error: Some("会话不存在或已不可见。".to_string()),
                code: Some("SESSION_NOT_FOUND".to_string()),
            });
            continue;
        };

        let session_key = session_key(&record.entry.engine, &record.entry.session_id);
        let source_path = record.source_path.as_deref().unwrap_or("");
        let outcome = match kind {
            MutationKind::Archive => archive_record(source_path, &record.entry.engine, &session_key, &mut metadata),
            MutationKind::Unarchive => unarchive_record(source_path, &record.entry.engine, &session_key, &mut metadata),
            MutationKind::Delete => delete_record(source_path, &session_key, &mut metadata),
        };

        match outcome {
            Ok(archived_at) => results.push(WorkspaceSessionBatchMutationResult {
                session_id: record.entry.session_id.clone(),
                ok: true,
                archived_at,
                error: None,
                code: None,
            }),
            Err(error) => results.push(WorkspaceSessionBatchMutationResult {
                session_id: record.entry.session_id.clone(),
                ok: false,
                archived_at: None,
                error: Some(error),
                code: Some("MUTATION_FAILED".to_string()),
            }),
        }
    }

    save_metadata(&metadata)?;
    Ok(WorkspaceSessionBatchMutationResponse { results })
}

fn load_workspaces(store: &State<'_, crate::AppStore>) -> Result<Vec<PersistedWorkspaceRef>, String> {
    Ok(store
        .terminal_storage
        .load_state()?
        .map(|state| state.workspaces)
        .unwrap_or_default())
}

fn find_workspace<'a>(
    workspaces: &'a [PersistedWorkspaceRef],
    workspace_id: &str,
) -> Result<&'a PersistedWorkspaceRef, String> {
    workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or_else(|| format!("Workspace not found: {}", workspace_id))
}

fn build_workspace_entries(
    workspace: &PersistedWorkspaceRef,
    metadata: &SessionManagementMetadata,
) -> Result<Vec<SessionRecord>, String> {
    if workspace.location_kind == "ssh" {
        return Ok(Vec::new());
    }

    let workspace_path = Path::new(&workspace.root_path);
    let mut entries = Vec::new();
    for summary in scan_codex_session_summaries(Some(workspace_path), &codex_history_roots())? {
        entries.push(record_from_summary(
            &summary,
            workspace.id.clone(),
            Some(workspace.name.clone()),
            metadata,
            Some(("strict-match", None, None, None, None)),
        ));
    }
    for summary in scan_claude_session_summaries(Some(workspace_path))? {
        entries.push(record_from_summary(
            &summary,
            workspace.id.clone(),
            Some(workspace.name.clone()),
            metadata,
            Some(("strict-match", None, None, None, None)),
        ));
    }
    for summary in scan_gemini_session_summaries(Some(workspace_path))? {
        entries.push(record_from_summary(
            &summary,
            workspace.id.clone(),
            Some(workspace.name.clone()),
            metadata,
            Some(("strict-match", None, None, None, None)),
        ));
    }
    entries.sort_by(|left, right| right.entry.updated_at.cmp(&left.entry.updated_at));
    Ok(entries)
}

fn build_global_codex_entries(
    workspaces: &[PersistedWorkspaceRef],
    metadata: &SessionManagementMetadata,
) -> Result<Vec<SessionRecord>, String> {
    let mut entries = Vec::new();
    for summary in scan_codex_session_summaries(None, &codex_history_roots())? {
        let inferred = infer_workspace_for_summary(&summary, workspaces);
        let (workspace_id, workspace_label, attribution_status, matched_workspace_id, matched_workspace_label) =
            inferred.unwrap_or((
                SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID.to_string(),
                Some("未归属历史".to_string()),
                Some("unassigned"),
                None,
                None,
            ));
        entries.push(record_from_summary(
            &summary,
            workspace_id,
            workspace_label,
            metadata,
            Some((
                attribution_status.unwrap_or("unassigned"),
                None,
                None,
                matched_workspace_id,
                matched_workspace_label,
            )),
        ));
    }
    entries.sort_by(|left, right| right.entry.updated_at.cmp(&left.entry.updated_at));
    Ok(entries)
}

fn infer_workspace_for_summary(
    summary: &LocalUsageSessionSummary,
    workspaces: &[PersistedWorkspaceRef],
) -> Option<(
    String,
    Option<String>,
    Option<&'static str>,
    Option<String>,
    Option<String>,
)> {
    let cwd = summary.cwd.as_deref()?;
    let mut matches = workspaces
        .iter()
        .filter(|workspace| workspace.location_kind != "ssh")
        .filter(|workspace| path_matches_workspace(cwd, Path::new(&workspace.root_path)))
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return None;
    }
    let workspace = matches.remove(0);
    Some((
        workspace.id.clone(),
        Some(workspace.name.clone()),
        Some("strict-match"),
        Some(workspace.id.clone()),
        Some(workspace.name.clone()),
    ))
}

fn record_from_summary(
    summary: &LocalUsageSessionSummary,
    workspace_id: String,
    workspace_label: Option<String>,
    metadata: &SessionManagementMetadata,
    attribution: Option<(
        &str,
        Option<&str>,
        Option<&str>,
        Option<String>,
        Option<String>,
    )>,
) -> SessionRecord {
    let engine = normalize_engine(summary);
    let archived_at = resolve_archived_at(summary, &engine, metadata);
    let (attribution_status, attribution_reason, attribution_confidence, matched_workspace_id, matched_workspace_label) =
        attribution
            .map(|(status, reason, confidence, matched_id, matched_label)| {
                (
                    Some(status.to_string()),
                    reason.map(|value| value.to_string()),
                    confidence.map(|value| value.to_string()),
                    matched_id,
                    matched_label,
                )
            })
            .unwrap_or((None, None, None, None, None));
    SessionRecord {
        source_path: summary.source_path.clone(),
        entry: WorkspaceSessionCatalogEntry {
            session_id: summary.session_id.clone(),
            canonical_session_id: summary.session_id_aliases.first().cloned(),
            workspace_id,
            workspace_label,
            engine: engine.clone(),
            title: summary
                .summary
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| format!("{} {}", engine_label(&engine), summary.session_id)),
            updated_at: summary.timestamp,
            archived_at,
            thread_kind: "cli-history".to_string(),
            source: summary.source.clone(),
            source_label: Some(engine_label(&engine).to_string()),
            size_bytes: summary.file_size_bytes,
            cwd: summary.cwd.clone(),
            attribution_status,
            attribution_reason,
            attribution_confidence,
            matched_workspace_id,
            matched_workspace_label,
        },
    }
}

fn apply_query(
    entries: Vec<SessionRecord>,
    query: Option<&WorkspaceSessionCatalogQuery>,
) -> Vec<SessionRecord> {
    let keyword = query
        .and_then(|value| value.keyword.as_deref())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let engine = query
        .and_then(|value| value.engine.as_deref())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let status = parse_status_filter(query.and_then(|value| value.status.as_deref()));

    entries
        .into_iter()
        .filter(|record| match status {
            SessionStatusFilter::Active => record.entry.archived_at.is_none(),
            SessionStatusFilter::Archived => record.entry.archived_at.is_some(),
            SessionStatusFilter::All => true,
        })
        .filter(|record| {
            if let Some(engine) = engine.as_ref() {
                record.entry.engine.eq_ignore_ascii_case(engine)
            } else {
                true
            }
        })
        .filter(|record| {
            let Some(keyword) = keyword.as_ref() else {
                return true;
            };
            let haystacks = [
                record.entry.title.as_str(),
                record.entry.session_id.as_str(),
                record.entry.source_label.as_deref().unwrap_or(""),
            ];
            haystacks
                .iter()
                .any(|value| value.to_ascii_lowercase().contains(keyword))
        })
        .collect()
}

fn build_page(
    records: Vec<SessionRecord>,
    cursor: Option<&str>,
    limit: Option<u32>,
) -> WorkspaceSessionCatalogPage {
    let offset = parse_cursor(cursor);
    let limit = normalize_limit(limit);
    let total = records.len();
    let next_offset = offset.saturating_add(limit);
    WorkspaceSessionCatalogPage {
        data: records
            .into_iter()
            .skip(offset)
            .take(limit)
            .map(|record| record.entry)
            .collect(),
        next_cursor: (next_offset < total).then_some(format!("{}{}", SESSION_CATALOG_CURSOR_PREFIX, next_offset)),
        partial_source: None,
    }
}

fn parse_cursor(cursor: Option<&str>) -> usize {
    cursor
        .and_then(|value| value.strip_prefix(SESSION_CATALOG_CURSOR_PREFIX))
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0)
}

fn normalize_limit(limit: Option<u32>) -> usize {
    limit
        .map(|value| value as usize)
        .unwrap_or(SESSION_CATALOG_DEFAULT_LIMIT)
        .clamp(1, SESSION_CATALOG_MAX_LIMIT)
}

fn parse_status_filter(value: Option<&str>) -> SessionStatusFilter {
    match value.unwrap_or("active") {
        "archived" => SessionStatusFilter::Archived,
        "all" => SessionStatusFilter::All,
        _ => SessionStatusFilter::Active,
    }
}

fn normalize_engine(summary: &LocalUsageSessionSummary) -> String {
    match summary.source.as_deref() {
        Some("claude") => "claude".to_string(),
        Some("gemini") => "gemini".to_string(),
        Some("opencode") => "opencode".to_string(),
        _ => "codex".to_string(),
    }
}

fn engine_label(engine: &str) -> &'static str {
    match engine {
        "claude" => "Claude",
        "gemini" => "Gemini",
        "opencode" => "OpenCode",
        _ => "Codex",
    }
}

fn resolve_archived_at(
    summary: &LocalUsageSessionSummary,
    engine: &str,
    metadata: &SessionManagementMetadata,
) -> Option<i64> {
    let key = session_key(engine, &summary.session_id);
    if let Some(value) = metadata.archived_at_by_session_key.get(&key) {
        return Some(*value);
    }
    if engine == "codex"
        && summary
            .source_path
            .as_deref()
            .map(|value| value.replace('\\', "/").contains("/.codex/archived_sessions/"))
            .unwrap_or(false)
    {
        return Some(summary.timestamp);
    }
    None
}

fn session_key(engine: &str, session_id: &str) -> String {
    format!("{}::{}", engine, session_id)
}

fn archive_record(
    source_path: &str,
    engine: &str,
    session_key: &str,
    metadata: &mut SessionManagementMetadata,
) -> Result<Option<i64>, String> {
    if engine == "codex" {
        move_codex_session(source_path, true)?;
    }
    let archived_at = now_millis();
    metadata
        .archived_at_by_session_key
        .insert(session_key.to_string(), archived_at);
    Ok(Some(archived_at))
}

fn unarchive_record(
    source_path: &str,
    engine: &str,
    session_key: &str,
    metadata: &mut SessionManagementMetadata,
) -> Result<Option<i64>, String> {
    if engine == "codex" {
        move_codex_session(source_path, false)?;
    }
    metadata.archived_at_by_session_key.remove(session_key);
    Ok(None)
}

fn delete_record(
    source_path: &str,
    session_key: &str,
    metadata: &mut SessionManagementMetadata,
) -> Result<Option<i64>, String> {
    if source_path.trim().is_empty() {
        return Err("无法定位历史文件路径。".to_string());
    }
    let path = PathBuf::from(source_path);
    if path.exists() {
        fs::remove_file(&path).map_err(|err| err.to_string())?;
    }
    metadata.archived_at_by_session_key.remove(session_key);
    Ok(None)
}

fn move_codex_session(source_path: &str, archive: bool) -> Result<(), String> {
    if source_path.trim().is_empty() {
        return Err("无法定位 Codex 历史文件路径。".to_string());
    }
    let source = PathBuf::from(source_path);
    if !source.exists() {
        return Err("Codex 历史文件不存在。".to_string());
    }
    let home = home_dir().ok_or_else(|| "Unable to locate home directory".to_string())?;
    let sessions_root = home.join(".codex").join("sessions");
    let archived_root = home.join(".codex").join("archived_sessions");
    let target_root = if archive {
        archived_root.clone()
    } else {
        sessions_root.clone()
    };
    let current_root = if source.starts_with(&archived_root) {
        archived_root
    } else {
        sessions_root
    };
    let relative = source
        .strip_prefix(&current_root)
        .map_err(|_| "无法识别 Codex 历史文件所属目录。".to_string())?;
    let target = target_root.join(relative);
    if source == target {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::rename(&source, &target).map_err(|err| err.to_string())
}

fn load_metadata() -> Result<SessionManagementMetadata, String> {
    let path = metadata_path()?;
    if !path.exists() {
        return Ok(SessionManagementMetadata::default());
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn save_metadata(metadata: &SessionManagementMetadata) -> Result<(), String> {
    let path = metadata_path()?;
    let raw = serde_json::to_string_pretty(metadata).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

fn metadata_path() -> Result<PathBuf, String> {
    let base = data_local_dir()
        .ok_or_else(|| "Unable to locate local application data directory".to_string())?
        .join("multi-cli-studio");
    fs::create_dir_all(&base).map_err(|err| err.to_string())?;
    Ok(base.join("session-management.json"))
}

fn codex_history_roots() -> Vec<PathBuf> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };
    vec![
        home.join(".codex").join("sessions"),
        home.join(".codex").join("archived_sessions"),
    ]
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(windows)]
fn path_matches_workspace(cwd: &str, workspace_path: &Path) -> bool {
    let cwd_path = cwd
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    let workspace = workspace_path
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    if cwd_path.is_empty() || workspace.is_empty() {
        return false;
    }
    cwd_path == workspace
        || cwd_path.starts_with(&(workspace.clone() + "/"))
        || workspace.starts_with(&(cwd_path + "/"))
}

#[cfg(not(windows))]
fn path_matches_workspace(cwd: &str, workspace_path: &Path) -> bool {
    let cwd_path = cwd.trim().trim_end_matches('/');
    let workspace = workspace_path
        .to_string_lossy()
        .trim()
        .trim_end_matches('/')
        .to_string();
    if cwd_path.is_empty() || workspace.is_empty() {
        return false;
    }
    cwd_path == workspace
        || cwd_path.starts_with(&(workspace.clone() + "/"))
        || workspace.starts_with(&(cwd_path.to_string() + "/"))
}
