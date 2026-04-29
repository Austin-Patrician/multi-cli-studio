use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use chrono::Local;
use serde::{Deserialize, Serialize};

const STUDIO_MANAGED_MARKER: &str = "<!-- STUDIO-CONTEXT:MANAGED -->";
const MAX_OPTIONAL_SECTION_CHARS: usize = 16_000;
const MAX_CONTEXT_CHARS: usize = 64_000;
const MAX_TASK_CHARS: usize = 24_000;
const MAX_ADAPTER_CHARS: usize = 8_000;
const KEEP_RUNTIME_TASKS: usize = 24;
const KEEP_SESSION_BINDINGS: usize = 64;

#[derive(Debug, Clone, Default)]
pub struct StudioContextExportInput {
    pub project_root: String,
    pub project_name: String,
    pub workspace_id: String,
    pub terminal_tab_id: String,
    pub cli_id: String,
    pub branch: String,
    pub dirty_files: usize,
    pub failing_checks: usize,
    pub write_mode: bool,
    pub is_session_resuming: bool,
    pub user_prompt: String,
    pub handoff_summary: Option<String>,
    pub handoff_files: Vec<String>,
    pub handoff_next_step: Option<String>,
    pub compacted_context: Option<String>,
    pub cross_tab_context: Option<String>,
    pub working_memory: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StudioContextExport {
    pub prelude: String,
    pub metrics: StudioContextMetrics,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioContextMetrics {
    pub prelude_chars: usize,
    pub runtime_context_chars: usize,
    pub task_chars: usize,
    pub final_prompt_chars: usize,
    pub adapter_files: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioPromoteRequest {
    pub project_root: String,
    pub kind: String,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioPromoteResult {
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StudioSessionBinding {
    context_key: String,
    active_task: String,
    cli_id: String,
    terminal_tab_id: String,
    workspace_id: String,
    updated_at: String,
}

pub fn export_studio_context(
    input: &StudioContextExportInput,
) -> Result<Option<StudioContextExport>, String> {
    let project_root = Path::new(input.project_root.trim());
    if input.project_root.trim().is_empty() || !project_root.is_dir() {
        return Ok(None);
    }

    let runtime_dir = project_root.join(".studio").join("runtime");
    let tasks_dir = runtime_dir.join("tasks");
    let sessions_dir = runtime_dir.join("sessions");

    fs::create_dir_all(&tasks_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&sessions_dir).map_err(|err| err.to_string())?;

    let task_id = format!("tab-{}", stable_slug(&input.terminal_tab_id, "default"));
    let task_dir = tasks_dir.join(&task_id);
    fs::create_dir_all(&task_dir).map_err(|err| err.to_string())?;

    let task_path = task_dir.join("task.md");
    let task_content = trim_to_limit(&render_task(input, &task_id), MAX_TASK_CHARS);
    atomic_write(&task_path, &task_content)?;

    write_manifest_if_missing(
        &task_dir.join("implement.jsonl"),
        ".studio/spec/index.md",
        "Optional durable project spec index. If missing, continue with runtime context and ask before creating durable spec files.",
    )?;
    write_manifest_if_missing(
        &task_dir.join("check.jsonl"),
        ".studio/spec/index.md",
        "Optional durable project verification spec index. If missing, continue with runtime context and ask before creating durable spec files.",
    )?;

    let context_path = runtime_dir.join("context.md");
    let context_content = trim_to_limit(&render_context(input, &task_id), MAX_CONTEXT_CHARS);
    atomic_write(&context_path, &context_content)?;

    let context_key = format!(
        "{}-{}",
        stable_slug(&input.terminal_tab_id, "terminal"),
        stable_slug(&input.cli_id, "cli")
    );
    let binding = StudioSessionBinding {
        context_key: context_key.clone(),
        active_task: format!(".studio/runtime/tasks/{task_id}"),
        cli_id: input.cli_id.clone(),
        terminal_tab_id: input.terminal_tab_id.clone(),
        workspace_id: input.workspace_id.clone(),
        updated_at: Local::now().to_rfc3339(),
    };
    let binding_json = serde_json::to_string_pretty(&binding).map_err(|err| err.to_string())?;
    atomic_write(&sessions_dir.join(format!("{context_key}.json")), &binding_json)?;

    let adapter_files = ensure_adapters(project_root)?;
    cleanup_old_entries(&tasks_dir, KEEP_RUNTIME_TASKS)?;
    cleanup_old_entries(&sessions_dir, KEEP_SESSION_BINDINGS)?;

    let prelude = render_prelude(input, &task_id);
    let metrics = StudioContextMetrics {
        prelude_chars: prelude.chars().count(),
        runtime_context_chars: context_content.chars().count(),
        task_chars: task_content.chars().count(),
        final_prompt_chars: 0,
        adapter_files,
    };

    Ok(Some(StudioContextExport {
        prelude,
        metrics,
    }))
}

pub fn promote_studio_context(request: &StudioPromoteRequest) -> Result<StudioPromoteResult, String> {
    let project_root = Path::new(request.project_root.trim());
    if request.project_root.trim().is_empty() || !project_root.is_dir() {
        return Err("Project root is missing or not a local directory.".to_string());
    }
    let title = non_empty(&request.title, "Studio Memory");
    let slug = stable_slug(title, "studio-memory");
    let now = Local::now();
    let source = request
        .source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("manual promotion");
    let body = format!(
        "# {}\n\nPromoted: {}\nSource: {}\n\n{}\n",
        title,
        now.to_rfc3339(),
        source,
        request.content.trim()
    );
    let (kind, dir, file_name) = match request.kind.trim().to_ascii_lowercase().as_str() {
        "spec" => ("spec", project_root.join(".studio").join("spec"), format!("{slug}.md")),
        "task" => (
            "task",
            project_root.join(".studio").join("workspace").join("tasks"),
            format!("{slug}.md"),
        ),
        "journal" => (
            "journal",
            project_root.join(".studio").join("workspace").join("journal"),
            format!("{}-{slug}.md", now.format("%Y%m%d-%H%M%S")),
        ),
        other => return Err(format!("Unsupported promote kind: {other}")),
    };
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let path = dir.join(file_name);
    atomic_write(&path, &body)?;
    update_index(&dir, &path, title)?;
    Ok(StudioPromoteResult {
        path: path.to_string_lossy().to_string(),
        kind: kind.to_string(),
    })
}

fn write_manifest_if_missing(path: &Path, file: &str, reason: &str) -> Result<(), String> {
    if path.is_file() {
        return Ok(());
    }
    let line = serde_json::json!({ "file": file, "reason": reason }).to_string();
    atomic_write(path, &format!("{line}\n"))
}

fn render_prelude(input: &StudioContextExportInput, task_id: &str) -> String {
    let access = if input.write_mode {
        "full write"
    } else {
        "read-only"
    };
    let resume_hint = if input.is_session_resuming {
        "This native CLI session is resuming; use the Studio files for project state, not repeated chat history."
    } else {
        "This is a fresh or switched CLI turn; start from the Studio files instead of relying on chat history."
    };

    format!(
        "<studio-context>\n\
Studio Context Layer is enabled for this project.\n\
{resume_hint}\n\n\
Read these files first when you need project or task context:\n\
- .studio/runtime/context.md\n\
- .studio/runtime/tasks/{task_id}/task.md\n\
- .studio/runtime/tasks/{task_id}/implement.jsonl\n\
- .studio/runtime/tasks/{task_id}/check.jsonl\n\
- .studio/spec/index.md if it exists\n\n\
Rules:\n\
- Do not ask the user to paste prior CLI history unless these files are insufficient.\n\
- Treat .studio/spec as durable project rules.\n\
- Treat .studio/runtime/tasks/{task_id} as the active runtime task snapshot.\n\
- Do not create durable .studio/spec or .studio/workspace files unless the user asks you to preserve knowledge.\n\
- Treat SQLite/semantic recall as optional fallback only.\n\n\
Current CLI: {}\n\
Access: {}\n\
</studio-context>",
        input.cli_id, access
    )
}

fn render_context(input: &StudioContextExportInput, task_id: &str) -> String {
    format!(
        "# Studio Context\n\n\
Updated: {}\n\n\
## Project\n\n\
- Name: {}\n\
- Root: {}\n\
- Branch: {}\n\n\
## Active Runtime Task\n\n\
- Path: .studio/runtime/tasks/{task_id}/\n\
- Task: .studio/runtime/tasks/{task_id}/task.md\n\
- Implement manifest: .studio/runtime/tasks/{task_id}/implement.jsonl\n\
- Check manifest: .studio/runtime/tasks/{task_id}/check.jsonl\n\n\
## Workspace\n\n\
- Dirty files: {}\n\
- Failing checks: {}\n\
- Current CLI: {}\n\
- Terminal tab: {}\n\n\
## Next Action\n\n\
{}\n\n\
{}{}{}\
## Loading Policy\n\n\
Start with this file and the active runtime task. Load detailed spec files from the JSONL manifests only when needed. Avoid injecting unrelated historical chat into the current turn.\n",
        Local::now().to_rfc3339(),
        input.project_name,
        input.project_root,
        input.branch,
        input.dirty_files,
        input.failing_checks,
        input.cli_id,
        input.terminal_tab_id,
        input
            .handoff_next_step
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Continue the current user request with the active task context."),
        optional_section("Working Memory", input.working_memory.as_deref()),
        optional_section("Compacted Context", input.compacted_context.as_deref()),
        optional_section("Cross Tab Context", input.cross_tab_context.as_deref())
    )
}

fn render_task(input: &StudioContextExportInput, task_id: &str) -> String {
    let files = if input.handoff_files.is_empty() {
        "- (none captured yet)".to_string()
    } else {
        input
            .handoff_files
            .iter()
            .map(|file| format!("- {file}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "# Active Studio Task: {task_id}\n\n\
Updated: {}\n\n\
## Goal\n\n\
{}\n\n\
## Runtime Identity\n\n\
- Workspace ID: {}\n\
- Terminal tab: {}\n\
- Current CLI: {}\n\
- Branch: {}\n\n\
## Latest Conclusion\n\n\
{}\n\n\
## Relevant Files\n\n\
{}\n\n\
## Next Step\n\n\
{}\n\n\
## Context Manifests\n\n\
- Implement: .studio/runtime/tasks/{task_id}/implement.jsonl\n\
- Check: .studio/runtime/tasks/{task_id}/check.jsonl\n\n\
## Maintenance Rules\n\n\
- This is a generated runtime snapshot and may be overwritten.\n\
- Promote durable rules to .studio/spec/ only when the user asks to preserve knowledge.\n\
- Move session/process notes to .studio/workspace/ only when they should become durable memory.\n\
",
        Local::now().to_rfc3339(),
        non_empty(&input.user_prompt, "Continue the active task."),
        input.workspace_id,
        input.terminal_tab_id,
        input.cli_id,
        input.branch,
        input
            .handoff_summary
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("No assistant conclusion captured yet."),
        files,
        input
            .handoff_next_step
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Continue from the latest user request."),
    )
}

fn non_empty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value.trim()
    }
}

fn optional_section(title: &str, value: Option<&str>) -> String {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return String::new();
    };
    format!("## {title}\n\n{}\n\n", trim_to_limit(value, MAX_OPTIONAL_SECTION_CHARS))
}

fn stable_slug(value: &str, fallback: &str) -> String {
    let mut slug = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '_' {
            slug.push(ch);
        } else if ch.is_whitespace() || ch == '/' || ch == '\\' || ch == ':' {
            slug.push('-');
        }
        if slug.len() >= 80 {
            break;
        }
    }

    let normalized = slug
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .trim_matches('_')
        .to_string();

    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    }
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("studio-context");
    let temp_path = path.with_file_name(format!(".{file_name}.tmp-{}", Local::now().timestamp_nanos_opt().unwrap_or_default()));
    fs::write(&temp_path, content).map_err(|err| err.to_string())?;
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&temp_path, path).map_err(|err| {
        let _ = fs::remove_file(&temp_path);
        err.to_string()
    })
}

fn trim_to_limit(value: &str, limit: usize) -> String {
    let count = value.chars().count();
    if count <= limit {
        return value.to_string();
    }
    let keep = limit.saturating_sub(160);
    let mut output = value.chars().take(keep).collect::<String>();
    output.push_str(&format!(
        "\n\n[Studio Context truncated: original_chars={}, limit={}]\n",
        count, limit
    ));
    output
}

fn ensure_adapters(project_root: &Path) -> Result<Vec<String>, String> {
    let adapters = [
        ("AGENTS.md", render_adapter("Codex")),
        ("CLAUDE.md", render_adapter("Claude")),
        ("GEMINI.md", render_adapter("Gemini")),
    ];
    let mut written = Vec::new();
    for (file_name, content) in adapters {
        let path = project_root.join(file_name);
        if should_write_managed_file(&path)? {
            atomic_write(&path, &trim_to_limit(&content, MAX_ADAPTER_CHARS))?;
            written.push(file_name.to_string());
        }
    }
    Ok(written)
}

fn should_write_managed_file(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(true);
    }
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    Ok(content.contains(STUDIO_MANAGED_MARKER))
}

fn render_adapter(cli_name: &str) -> String {
    format!(
        "{STUDIO_MANAGED_MARKER}\n# Studio Context Adapter for {cli_name}\n\nThis project uses Multi CLI Studio Context Layer.\n\n## Startup Rules\n\n- First read `.studio/runtime/context.md` when it exists.\n- Then read the active task file listed there.\n- Load JSONL manifest entries only when the current task needs them.\n- Treat `.studio/spec/` as durable project rules.\n- Treat `.studio/workspace/` as durable project memory and journals.\n- Treat `.studio/runtime/` as generated runtime state that may be overwritten.\n- Do not create or edit durable `.studio/spec/` or `.studio/workspace/` files unless the user explicitly asks to preserve knowledge.\n- Keep prompt context small; prefer file references over pasting long history.\n"
    )
}

fn cleanup_old_entries(dir: &Path, keep: usize) -> Result<(), String> {
    let mut entries = Vec::<(PathBuf, SystemTime)>::new();
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        entries.push((path, modified));
    }
    if entries.len() <= keep {
        return Ok(());
    }
    entries.sort_by_key(|(_, modified)| *modified);
    let remove_count = entries.len().saturating_sub(keep);
    for (path, _) in entries.into_iter().take(remove_count) {
        if path.is_dir() {
            let _ = fs::remove_dir_all(path);
        } else {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

fn update_index(dir: &Path, path: &Path, title: &str) -> Result<(), String> {
    let index_path = dir.join("index.md");
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("memory.md");
    let line = format!("- [{}]({})", title.trim(), file_name);
    let mut content = if index_path.is_file() {
        fs::read_to_string(&index_path).map_err(|err| err.to_string())?
    } else {
        "# Studio Memory Index\n\n".to_string()
    };
    if !content.lines().any(|existing| existing.trim() == line) {
        if !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&line);
        content.push('\n');
        atomic_write(&index_path, &content)?;
    }
    Ok(())
}
