use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const STUDIO_MANAGED_MARKER: &str = "<!-- STUDIO-CONTEXT:MANAGED -->";
const STUDIO_WORKFLOW_MARKER: &str = "<!-- STUDIO-WORKFLOW:MANAGED -->";
const MAX_OPTIONAL_SECTION_CHARS: usize = 16_000;
const MAX_CONTEXT_CHARS: usize = 64_000;
const MAX_TASK_CHARS: usize = 24_000;
const MAX_ADAPTER_CHARS: usize = 8_000;
const MAX_REPORT_CHARS: usize = 24_000;
const MAX_MANIFEST_ENTRIES: usize = 12;
const MAX_SPEC_SCAN_FILES: usize = 256;
const MAX_MEMORY_CANDIDATE_CHARS: usize = 12_000;
const KEEP_RUNTIME_TASKS: usize = 24;
const KEEP_SESSION_BINDINGS: usize = 64;
const PYTHON_NATIVE_HOOK: &str = r#"#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Studio Context Native Hook for __STUDIO_PLATFORM__.

Modes:
- session: SessionStart additional context
- prompt: UserPromptSubmit workflow breadcrumb
- subagent: PreToolUse Task/Agent manifest injection
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

PLATFORM = "__STUDIO_PLATFORM__"
MODE = "__STUDIO_MODE__"


def configure_stdio() -> None:
    if os.name != "nt":
        return
    for name in ("stdin", "stdout", "stderr"):
        stream = getattr(sys, name, None)
        if not hasattr(stream, "reconfigure"):
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def read_stdin_json() -> dict:
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            return {}
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def read_text(path: Path, fallback: str = "") -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return fallback


def project_root(input_data: dict) -> Path:
    for key in ("cwd", "projectRoot", "project_root", "workspaceRoot"):
        value = input_data.get(key)
        if isinstance(value, str) and value.strip():
            path = Path(value).expanduser()
            if path.is_dir():
                return path
    for env in (
        "CODEX_PROJECT_DIR",
        "CLAUDE_PROJECT_DIR",
        "GEMINI_PROJECT_DIR",
        "PWD",
    ):
        value = os.environ.get(env)
        if value:
            path = Path(value).expanduser()
            if path.is_dir():
                return path
    return Path.cwd()


def load_context(root: Path) -> str:
    return read_text(root / ".studio" / "runtime" / "context.md")


def discover_bound_task(root: Path) -> tuple[str | None, Path | None, Path | None] | None:
    context_id = os.environ.get("STUDIO_CONTEXT_ID", "").strip()
    if not context_id or "/" in context_id or "\\" in context_id or ".." in context_id:
        return None
    binding_path = root / ".studio" / "runtime" / "sessions" / f"{context_id}.json"
    try:
        data = json.loads(binding_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    task_id_value = data.get("taskId") or data.get("task_id")
    if isinstance(task_id_value, str) and task_id_value.strip():
        task_id = Path(task_id_value.strip()).name
        runtime_task = root / ".studio" / "runtime" / "tasks" / task_id
        durable_task = root / ".studio" / "tasks" / task_id
        if runtime_task.is_dir() or durable_task.is_dir():
            return task_id, runtime_task, durable_task
    active_task = data.get("activeTask") or data.get("active_task")
    if not isinstance(active_task, str) or not active_task.strip():
        return None
    durable_task = root / active_task.strip().rstrip("/")
    task_id = durable_task.name
    if not task_id:
        return None
    runtime_task = root / ".studio" / "runtime" / "tasks" / task_id
    if runtime_task.is_dir() or durable_task.is_dir():
        return task_id, runtime_task, durable_task
    return None


def discover_active_task(root: Path) -> tuple[str | None, Path | None, Path | None]:
    bound_task = discover_bound_task(root)
    if bound_task:
        return bound_task
    context = load_context(root)
    runtime_task = None
    durable_task = None
    for line in context.splitlines():
        stripped = line.strip()
        if stripped.startswith("- Path: .studio/runtime/tasks/"):
            runtime_task = root / stripped.split(": ", 1)[1].rstrip("/")
        elif stripped.startswith("- Durable task: .studio/tasks/"):
            durable_file = root / stripped.split(": ", 1)[1]
            durable_task = durable_file.parent
    if runtime_task and runtime_task.is_dir():
        return runtime_task.name, runtime_task, durable_task
    candidates = sorted(
        (root / ".studio" / "runtime" / "tasks").glob("*/task.md"),
        key=lambda path: path.stat().st_mtime if path.exists() else 0,
        reverse=True,
    )
    if candidates:
        task_dir = candidates[0].parent
        return task_dir.name, task_dir, root / ".studio" / "tasks" / task_dir.name
    return None, None, None


def read_jsonl_manifest(root: Path, manifest: Path | None, limit: int = 12) -> list[str]:
    if manifest is None or not manifest.is_file():
        return []
    refs: list[str] = []
    for line in read_text(manifest).splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if not isinstance(row, dict):
            continue
        file_ref = row.get("file") or row.get("path")
        if not isinstance(file_ref, str) or not file_ref.strip():
            continue
        reason = row.get("reason") or row.get("curatedBy") or "selected context"
        refs.append(f"- `{file_ref}` — {reason}")
        if len(refs) >= limit:
            break
    return refs


def build_session_context(root: Path) -> str:
    task_id, runtime_task, durable_task = discover_active_task(root)
    parts = [
        "<studio-context-native-hook>",
        f"Platform: {PLATFORM}",
        "Studio Context Native Hook 已注入：workflow、active task、spec/workspace 索引和 manifest 文件引用已加载。",
        "Rules:",
        "- Read `.studio/runtime/context.md` first; it is the active runtime snapshot.",
        "- Treat `.studio/workflow.md` as the task state machine and agent contract.",
        "- Treat `.studio/spec/` as durable project rules and `.studio/workspace/` as durable memory.",
        "- Use manifest file references before broad history recall; keep prompt context small.",
    ]
    if task_id:
        parts.append(f"Active task: `{task_id}`")
    for ref in (
        ".studio/runtime/context.md",
        ".studio/workflow.md",
        f".studio/runtime/tasks/{task_id}/task.md" if task_id else None,
        f".studio/tasks/{task_id}/prd.md" if task_id else None,
        f".studio/tasks/{task_id}/context-selection-report.md" if task_id else None,
        f".studio/runtime/tasks/{task_id}/implement.jsonl" if task_id else None,
        f".studio/runtime/tasks/{task_id}/check.jsonl" if task_id else None,
        ".studio/spec/index.md",
        ".studio/workspace/index.md",
    ):
        if ref:
            parts.append(f"- `{ref}`")
    if durable_task and durable_task.is_dir():
        research = sorted((durable_task / "research").glob("*.md"))[:8]
        if research:
            parts.append("Research artifacts:")
            parts.extend(f"- `{path.relative_to(root)}`" for path in research)
    if runtime_task and runtime_task.is_dir():
        implement_refs = read_jsonl_manifest(root, runtime_task / "implement.jsonl")
        check_refs = read_jsonl_manifest(root, runtime_task / "check.jsonl")
        if implement_refs:
            parts.append("Implement manifest:")
            parts.extend(implement_refs)
        if check_refs:
            parts.append("Check manifest:")
            parts.extend(check_refs)
    parts.append("</studio-context-native-hook>")
    return "\n".join(parts)


def build_prompt_context(root: Path) -> str:
    task_id, runtime_task, durable_task = discover_active_task(root)
    parts = [
        "<studio-workflow-state>",
        f"Platform: {PLATFORM}",
        f"Task: {task_id or 'none'}",
        "Before responding, load the active Studio files and follow `.studio/workflow.md`.",
    ]
    if task_id:
        parts.extend([
            f"Runtime task: `.studio/runtime/tasks/{task_id}/task.md`",
            f"PRD: `.studio/tasks/{task_id}/prd.md`",
            f"Context report: `.studio/tasks/{task_id}/context-selection-report.md`",
            f"Implement manifest: `.studio/runtime/tasks/{task_id}/implement.jsonl`",
            f"Check manifest: `.studio/runtime/tasks/{task_id}/check.jsonl`",
        ])
    policy = durable_task / "policy-check.json" if durable_task else None
    if policy and policy.is_file():
        parts.append(f"Policy check: `{policy.relative_to(root)}`")
    parts.append("</studio-workflow-state>")
    return "\n".join(parts)


def detect_agent_name(input_data: dict) -> str:
    candidates = [
        input_data.get("agent"),
        input_data.get("agentName"),
        input_data.get("agent_name"),
        input_data.get("subagent_type"),
    ]
    tool_input = input_data.get("tool_input")
    if isinstance(tool_input, dict):
        candidates.extend([
            tool_input.get("subagent_type"),
            tool_input.get("agent"),
            tool_input.get("agentName"),
            tool_input.get("description"),
        ])
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip().lower()
    return ""


def build_subagent_context(root: Path, input_data: dict) -> str:
    agent = detect_agent_name(input_data)
    task_id, runtime_task, durable_task = discover_active_task(root)
    manifest = None
    if runtime_task:
        if "check" in agent:
            manifest = runtime_task / "check.jsonl"
        elif "research" in agent:
            manifest = None
        else:
            manifest = runtime_task / "implement.jsonl"
    parts = [
        "<studio-subagent-context>",
        f"Platform: {PLATFORM}",
        f"Agent: {agent or 'unknown'}",
        f"Task: {task_id or 'none'}",
        "Required files:",
    ]
    if task_id:
        parts.append(f"- `.studio/tasks/{task_id}/prd.md`")
        parts.append(f"- `.studio/tasks/{task_id}/context-selection-report.md`")
    if manifest:
        parts.append(f"- `{manifest.relative_to(root)}`")
        refs = read_jsonl_manifest(root, manifest)
        if refs:
            parts.append("Selected context:")
            parts.extend(refs)
    if durable_task and "research" in agent:
        parts.append(f"Research output directory: `{(durable_task / 'research').relative_to(root)}`")
    parts.append("Keep output file-referenced; do not paste large unrelated history.")
    parts.append("</studio-subagent-context>")
    return "\n".join(parts)


def emit(additional_context: str) -> int:
    event = {
        "session": "SessionStart",
        "prompt": "UserPromptSubmit",
        "subagent": "PreToolUse",
    }.get(MODE, MODE)
    payload = {
        "hookSpecificOutput": {
            "hookEventName": event,
            "additionalContext": additional_context,
        }
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def main() -> int:
    configure_stdio()
    non_interactive = f"{PLATFORM.upper()}_NON_INTERACTIVE"
    if os.environ.get(non_interactive) == "1":
        return 0
    input_data = read_stdin_json()
    root = project_root(input_data)
    if MODE == "session":
        return emit(build_session_context(root))
    if MODE == "subagent":
        return emit(build_subagent_context(root, input_data))
    return emit(build_prompt_context(root))


if __name__ == "__main__":
    raise SystemExit(main())
"#;

#[derive(Debug, Clone, Default)]
pub struct StudioContextExportInput {
    pub project_root: String,
    pub project_name: String,
    pub workspace_id: String,
    pub task_id: Option<String>,
    pub task_title: Option<String>,
    pub task_goal: Option<String>,
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
    pub memory_candidates: Option<String>,
}

#[derive(Debug, Clone)]
struct ManifestEntry {
    file: String,
    reason: String,
    score: i64,
}

#[derive(Debug, Clone)]
struct ContextCuration {
    implement_entries: Vec<ManifestEntry>,
    check_entries: Vec<ManifestEntry>,
    report: String,
}

#[derive(Debug, Clone)]
struct CuratedManifestEntry {
    file: String,
    reason: String,
    confidence: f64,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ContextCuratorOutput {
    #[serde(default, alias = "implementation")]
    implement: Vec<ContextCuratorEntry>,
    #[serde(default, alias = "verification")]
    check: Vec<ContextCuratorEntry>,
    #[serde(default)]
    report: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ContextCuratorEntry {
    #[serde(default, alias = "path")]
    file: String,
    #[serde(default, alias = "why")]
    reason: String,
    #[serde(default)]
    confidence: Option<f64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ResearchAgentOutput {
    #[serde(default)]
    artifacts: Vec<ResearchArtifactOutput>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct ResearchArtifactOutput {
    #[serde(default)]
    title: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    sources: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct CheckerAgentOutput {
    #[serde(default)]
    status: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    issues: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct StudioContextCurationApplyResult {
    pub implement_entries: usize,
    pub check_entries: usize,
    pub report_path: String,
}

#[derive(Debug, Clone)]
pub struct StudioResearchApplyResult {
    pub artifacts: usize,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioCheckerApplyResult {
    pub status: String,
    pub summary: String,
    pub issues: Vec<String>,
    pub report_path: String,
    pub needs_retry: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioCheckerRetryResult {
    pub status: String,
    pub report_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioPolicyPromotionResult {
    pub promoted: usize,
    pub skipped: usize,
    pub paths: Vec<String>,
    pub report_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioMemoryDistillApplyResult {
    pub candidate_entries: usize,
    pub promotable_entries: usize,
    pub rejected_entries: usize,
    pub allow_auto_promote: bool,
    pub decision: String,
    pub report_path: String,
    pub policy_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioWorkflowState {
    pub project_root: String,
    pub task_id: Option<String>,
    pub phase: String,
    pub task_path: Option<String>,
    pub prd_path: Option<String>,
    pub context_report_path: Option<String>,
    pub implement_manifest_path: Option<String>,
    pub check_manifest_path: Option<String>,
    pub checker_report_path: Option<String>,
    pub policy_check_path: Option<String>,
    pub promotion_report_path: Option<String>,
    pub research_artifacts: Vec<String>,
    pub implement_entries: usize,
    pub check_entries: usize,
    pub checker_status: Option<String>,
    pub checker_summary: Option<String>,
    pub checker_issues: Vec<String>,
    pub checker_needs_retry: bool,
    pub checker_retry_performed: bool,
    pub checker_retry_status: Option<String>,
    pub checker_retry_report_path: Option<String>,
    pub policy_decision: Option<String>,
    pub allow_auto_promote: bool,
    pub last_updated: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StudioContextExport {
    pub task_id: String,
    pub context_key: String,
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
    task_id: String,
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
    ensure_workflow_files(project_root)?;

    let task_id = input
        .task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| stable_slug(value, "task"))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("task-{}", stable_slug(&input.terminal_tab_id, "default")));
    let task_dir = tasks_dir.join(&task_id);
    fs::create_dir_all(&task_dir).map_err(|err| err.to_string())?;

    let task_path = task_dir.join("task.md");
    let task_content = trim_to_limit(&render_task(input, &task_id), MAX_TASK_CHARS);
    atomic_write(&task_path, &task_content)?;

    let durable_task_dir = project_root.join(".studio").join("tasks").join(&task_id);
    fs::create_dir_all(&durable_task_dir).map_err(|err| err.to_string())?;
    let durable_task_json_path = durable_task_dir.join("task.json");
    let existing_task_json = read_json_file(&durable_task_json_path).ok();
    let active_tab_ids = load_active_tab_ids(&durable_task_json_path, &input.terminal_tab_id);
    atomic_write(
        &durable_task_json_path,
        &render_durable_task_json(
            input,
            &task_id,
            &active_tab_ids,
            existing_task_json.as_ref(),
        )?,
    )?;
    write_durable_prd_if_missing(&durable_task_dir.join("prd.md"), input, &task_id)?;

    if let Some(memory_candidates) = input
        .memory_candidates
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let distill = sanitize_memory_candidates(memory_candidates);
        let candidates_content = if distill.accepted.is_empty() {
            String::new()
        } else {
            format!("{}\n", distill.accepted.join("\n"))
        };
        let has_promotable_candidates = distill.promotable_entries > 0;
        atomic_write(
            &durable_task_dir.join("memory-candidates.jsonl"),
            &trim_to_limit(&candidates_content, MAX_MEMORY_CANDIDATE_CHARS),
        )?;
        atomic_write(
            &durable_task_dir.join("memory-distill-report.md"),
            &render_memory_distill_report(input, &task_id, &distill, false, "pending_checker"),
        )?;
        atomic_write(
            &durable_task_dir.join("policy-check.json"),
            &render_policy_check_json(input, &task_id, has_promotable_candidates)?,
        )?;
    } else {
        atomic_write(
            &durable_task_dir.join("policy-check.json"),
            &render_policy_check_json(input, &task_id, false)?,
        )?;
    }

    let curation = curate_context(project_root, input, &task_id)?;
    atomic_write(
        &durable_task_dir.join("context-selection-report.md"),
        &trim_to_limit(&curation.report, MAX_REPORT_CHARS),
    )?;
    write_manifest(
        &task_dir.join("implement.jsonl"),
        &curation.implement_entries,
        ManifestEntry {
            file: ".studio/spec/index.md".to_string(),
            reason: "Optional durable project spec index. If missing, continue with runtime context and keep durable spec writes behind policy-check.".to_string(),
            score: 0,
        },
    )?;
    write_manifest(
        &task_dir.join("check.jsonl"),
        &curation.check_entries,
        ManifestEntry {
            file: ".studio/spec/index.md".to_string(),
            reason: "Optional durable project verification spec index. If missing, continue with runtime context and keep durable spec writes behind policy-check.".to_string(),
            score: 0,
        },
    )?;
    sync_manifest_to_durable_task(
        &durable_task_dir.join("implement.jsonl"),
        &task_dir.join("implement.jsonl"),
    )?;
    sync_manifest_to_durable_task(
        &durable_task_dir.join("check.jsonl"),
        &task_dir.join("check.jsonl"),
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
        task_id: task_id.clone(),
        active_task: format!(".studio/tasks/{task_id}"),
        cli_id: input.cli_id.clone(),
        terminal_tab_id: input.terminal_tab_id.clone(),
        workspace_id: input.workspace_id.clone(),
        updated_at: Local::now().to_rfc3339(),
    };
    let binding_json = serde_json::to_string_pretty(&binding).map_err(|err| err.to_string())?;
    atomic_write(
        &sessions_dir.join(format!("{context_key}.json")),
        &binding_json,
    )?;

    let mut adapter_files = ensure_adapters(project_root)?;
    adapter_files.extend(ensure_native_cli_hooks(project_root)?);
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
        task_id,
        context_key,
        prelude,
        metrics,
    }))
}

pub fn build_context_curator_prompt(input: &StudioContextExportInput, task_id: &str) -> String {
    let request = clean_studio_text(&input.user_prompt);
    let latest_conclusion = clean_studio_option(input.handoff_summary.as_deref())
        .unwrap_or_else(|| "No assistant conclusion captured yet.".to_string());
    let next_step = clean_studio_option(input.handoff_next_step.as_deref())
        .unwrap_or_else(|| "Continue from the latest user request.".to_string());
    format!(
        "You are Studio's context-curator subagent. Curate task-specific spec/research context automatically.\n\n\
Return only a single JSON object with this shape:\n\
{{\"implement\":[{{\"file\":\".studio/spec/index.md\",\"reason\":\"why implementation needs it\",\"confidence\":0.8}}],\"check\":[{{\"file\":\".studio/spec/index.md\",\"reason\":\"why verification needs it\",\"confidence\":0.8}}],\"report\":\"short markdown summary\"}}\n\n\
Rules:\n\
- Do not ask for human confirmation.\n\
- Select only existing `.studio/spec/**/*.md` or `.studio/tasks/{task_id}/research/*.md` files.\n\
- Never include source files, files to edit, package files, build artifacts, or absolute paths.\n\
- Keep each list small and task-specific.\n\
- Use `implement` for implementation rules/research and `check` for verification/quality rules/research.\n\
- If no specific file is relevant, use `.studio/spec/index.md` only if it exists.\n\n\
Candidate spec layers:\n\
- `.studio/spec/index.md` - workflow-wide discovery and policy.\n\
- `.studio/spec/frontend/index.md` - React UI, chat surfaces, terminal dock, and workflow panel behavior.\n\
- `.studio/spec/tauri-runtime/index.md` - Rust commands, process orchestration, state, and app runtime rules.\n\
- `.studio/spec/cli-adapters/index.md` - Codex, Claude, Gemini adapters, hooks, sessions, and permissions.\n\
- `.studio/spec/storage/index.md` - SQLite task kernel, task bindings, facts, evidence, and migrations.\n\
- `.studio/spec/automation/index.md` - automation goals, workflow runs, validation, retry, and routing.\n\
- `.studio/spec/windows-runtime/index.md` - Windows shells, encoding, path handling, and constrained-language safety.\n\n\
Task ID: {task_id}\n\
Project: {}\n\
Root: {}\n\
Branch: {}\n\
CLI: {}\n\
Dirty files: {}\n\
Failing checks: {}\n\n\
User request:\n{}\n\n\
Latest conclusion:\n{}\n\n\
Next step:\n{}\n\n\
Relevant files:\n{}\n",
        input.project_name,
        input.project_root,
        input.branch,
        input.cli_id,
        input.dirty_files,
        input.failing_checks,
        non_empty(&request, "Continue the active task."),
        latest_conclusion,
        next_step,
        if input.handoff_files.is_empty() {
            "- (none captured yet)".to_string()
        } else {
            input
                .handoff_files
                .iter()
                .map(|file| format!("- {file}"))
                .collect::<Vec<_>>()
                .join("\n")
        },
    )
}

pub fn build_research_agent_prompt(input: &StudioContextExportInput, task_id: &str) -> String {
    let request = clean_studio_text(&input.user_prompt);
    let latest_conclusion = clean_studio_option(input.handoff_summary.as_deref())
        .unwrap_or_else(|| "No assistant conclusion captured yet.".to_string());
    format!(
        "You are Studio's research subagent. Create durable task research artifacts only when they help implementation or checking.\n\n\
Return only JSON: {{\"artifacts\":[{{\"title\":\"short topic\",\"content\":\"markdown finding\",\"sources\":[\"repo/spec/user prompt/source\"]}}]}}\n\n\
Rules:\n\
- Do not ask for human confirmation.\n\
- Keep artifacts source-backed and concise.\n\
- Do not invent external facts; if no research is needed, return an empty artifacts array.\n\
- Focus on constraints, APIs, design decisions, or verification evidence relevant to this task.\n\n\
Task ID: {task_id}\n\
Project: {}\n\
Root: {}\n\
Request:\n{}\n\n\
Latest conclusion:\n{}\n\n\
Relevant files:\n{}\n",
        input.project_name,
        input.project_root,
        non_empty(&request, "Continue the active task."),
        latest_conclusion,
        if input.handoff_files.is_empty() {
            "- (none captured yet)".to_string()
        } else {
            input
                .handoff_files
                .iter()
                .map(|file| format!("- {file}"))
                .collect::<Vec<_>>()
                .join("\n")
        },
    )
}

pub fn apply_research_agent_output(
    project_root: &str,
    task_id: &str,
    raw_output: &str,
) -> Result<StudioResearchApplyResult, String> {
    let project_root = Path::new(project_root.trim());
    if project_root.as_os_str().is_empty() || !project_root.is_dir() {
        return Err("Project root is missing or not a local directory.".to_string());
    }
    let parsed = parse_research_agent_output(raw_output)?;
    let research_dir = project_root
        .join(".studio")
        .join("tasks")
        .join(task_id)
        .join("research");
    fs::create_dir_all(&research_dir).map_err(|err| err.to_string())?;
    let mut paths = Vec::new();
    for artifact in parsed.artifacts.into_iter().take(8) {
        let title = non_empty(&artifact.title, "Studio Research");
        let body = artifact.content.trim();
        if body.is_empty() {
            continue;
        }
        let slug = stable_slug(title, "research");
        let path = research_dir.join(format!(
            "{}-{slug}.md",
            Local::now().format("%Y%m%d-%H%M%S")
        ));
        let sources = if artifact.sources.is_empty() {
            "- Studio task context".to_string()
        } else {
            artifact
                .sources
                .iter()
                .map(|source| format!("- {source}"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let content = format!(
            "# {title}\n\nGenerated: {}\nAgent: research\nTask: {task_id}\n\n## Sources\n\n{}\n\n## Findings\n\n{}\n",
            Local::now().to_rfc3339(),
            sources,
            body,
        );
        atomic_write(&path, &trim_to_limit(&content, MAX_REPORT_CHARS))?;
        paths.push(path.to_string_lossy().to_string());
    }
    Ok(StudioResearchApplyResult {
        artifacts: paths.len(),
        paths,
    })
}

pub fn build_checker_agent_prompt(
    input: &StudioContextExportInput,
    task_id: &str,
    implementation_output: &str,
) -> String {
    let request = clean_studio_text(&input.user_prompt);
    format!(
        "You are Studio's checker subagent. Verify the latest implementation against PRD, check manifest, and task state.\n\n\
Return only JSON: {{\"status\":\"pass|fail\",\"summary\":\"short result\",\"issues\":[\"concrete issue or missing check\"]}}\n\n\
Rules:\n\
- Do not ask for human confirmation.\n\
- Prefer concrete failures over speculative warnings.\n\
- If retry is needed, issues must be actionable for the same CLI.\n\n\
Task ID: {task_id}\n\
PRD: .studio/tasks/{task_id}/prd.md\n\
Check manifest: .studio/tasks/{task_id}/check.jsonl\n\
Context report: .studio/tasks/{task_id}/context-selection-report.md\n\n\
Request:\n{}\n\n\
Implementation output:\n{}\n",
        non_empty(&request, "Continue the active task."),
        trim_to_limit(implementation_output, MAX_OPTIONAL_SECTION_CHARS),
    )
}

pub fn apply_checker_agent_output(
    project_root: &str,
    task_id: &str,
    raw_output: &str,
) -> Result<StudioCheckerApplyResult, String> {
    let project_root = Path::new(project_root.trim());
    if project_root.as_os_str().is_empty() || !project_root.is_dir() {
        return Err("Project root is missing or not a local directory.".to_string());
    }
    let parsed = parse_checker_agent_output(raw_output)?;
    let status = normalize_checker_status(&parsed.status, &parsed.issues);
    let needs_retry = status == "fail";
    let checked_at = Local::now().to_rfc3339();
    let summary = non_empty(
        &parsed.summary,
        if needs_retry {
            "Checker found issues."
        } else {
            "Checker passed."
        },
    )
    .to_string();
    let task_dir = project_root.join(".studio").join("tasks").join(task_id);
    fs::create_dir_all(&task_dir).map_err(|err| err.to_string())?;
    let report_path = task_dir.join("checker-report.md");
    let report = render_checker_report(
        task_id,
        &status,
        &summary,
        &parsed.issues,
        needs_retry,
        &checked_at,
    );
    atomic_write(&report_path, &report)?;
    update_checker_task_state(
        &task_dir.join("task.json"),
        task_id,
        &status,
        &summary,
        &parsed.issues,
        needs_retry,
        &checked_at,
    )?;
    Ok(StudioCheckerApplyResult {
        status,
        summary,
        issues: parsed.issues,
        report_path: report_path.to_string_lossy().to_string(),
        needs_retry,
    })
}

pub fn record_checker_retry_result(
    project_root: &str,
    task_id: &str,
    succeeded: bool,
    raw_output: &str,
) -> Result<StudioCheckerRetryResult, String> {
    let project_root = Path::new(project_root.trim());
    if project_root.as_os_str().is_empty() || !project_root.is_dir() {
        return Err("Project root is missing or not a local directory.".to_string());
    }
    let task_dir = project_root.join(".studio").join("tasks").join(task_id);
    fs::create_dir_all(&task_dir).map_err(|err| err.to_string())?;
    let completed_at = Local::now().to_rfc3339();
    let status = if succeeded { "completed" } else { "failed" };
    let report_path = task_dir.join("checker-retry-report.md");
    let report = render_checker_retry_report(task_id, status, raw_output, &completed_at);
    atomic_write(&report_path, &trim_to_limit(&report, MAX_REPORT_CHARS))?;
    update_checker_retry_task_state(
        &task_dir.join("task.json"),
        task_id,
        status,
        raw_output,
        &completed_at,
    )?;
    append_checker_retry_to_report(
        &task_dir.join("checker-report.md"),
        task_id,
        status,
        &completed_at,
    )?;
    Ok(StudioCheckerRetryResult {
        status: status.to_string(),
        report_path: report_path.to_string_lossy().to_string(),
    })
}

pub fn apply_memory_distill_candidates(
    project_root: &str,
    task_id: &str,
    input: &StudioContextExportInput,
    raw_candidates: Option<&str>,
    checker_passed: bool,
) -> Result<StudioMemoryDistillApplyResult, String> {
    let project_root = Path::new(project_root.trim());
    if project_root.as_os_str().is_empty() || !project_root.is_dir() {
        return Err("Project root is missing or not a local directory.".to_string());
    }
    let task_dir = project_root.join(".studio").join("tasks").join(task_id);
    fs::create_dir_all(&task_dir).map_err(|err| err.to_string())?;

    let distill = sanitize_memory_candidates(raw_candidates.unwrap_or_default());
    let candidates_path = task_dir.join("memory-candidates.jsonl");
    let candidates_content = if distill.accepted.is_empty() {
        String::new()
    } else {
        format!("{}\n", distill.accepted.join("\n"))
    };
    atomic_write(
        &candidates_path,
        &trim_to_limit(&candidates_content, MAX_MEMORY_CANDIDATE_CHARS),
    )?;

    let allow_auto_promote = checker_passed && distill.promotable_entries > 0;
    let decision = if allow_auto_promote {
        "candidate_ready"
    } else if checker_passed {
        "hold"
    } else {
        "pending_checker"
    }
    .to_string();
    let report_path = task_dir.join("memory-distill-report.md");
    let report = render_memory_distill_report(input, task_id, &distill, checker_passed, &decision);
    atomic_write(&report_path, &trim_to_limit(&report, MAX_REPORT_CHARS))?;

    let policy_path = task_dir.join("policy-check.json");
    let policy = render_post_checker_policy_check_json(
        task_id,
        checker_passed,
        &distill,
        allow_auto_promote,
        &decision,
    )?;
    atomic_write(&policy_path, &policy)?;
    update_memory_distill_task_state(
        &task_dir.join("task.json"),
        task_id,
        checker_passed,
        distill.accepted.len(),
        distill.promotable_entries,
        &decision,
    )?;

    Ok(StudioMemoryDistillApplyResult {
        candidate_entries: distill.accepted.len(),
        promotable_entries: distill.promotable_entries,
        rejected_entries: distill.rejected_entries,
        allow_auto_promote,
        decision,
        report_path: report_path.to_string_lossy().to_string(),
        policy_path: policy_path.to_string_lossy().to_string(),
    })
}

pub fn auto_promote_studio_memory(
    project_root: &str,
    task_id: &str,
) -> Result<StudioPolicyPromotionResult, String> {
    let project_root = Path::new(project_root.trim());
    if project_root.as_os_str().is_empty() || !project_root.is_dir() {
        return Err("Project root is missing or not a local directory.".to_string());
    }
    let task_dir = project_root.join(".studio").join("tasks").join(task_id);
    let policy_path = task_dir.join("policy-check.json");
    let candidates_path = task_dir.join("memory-candidates.jsonl");
    let report_path = task_dir.join("promotion-report.md");
    let policy = read_json_file(&policy_path).unwrap_or(Value::Null);
    let allow = policy
        .get("allowAutoPromote")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let checker_passed = policy
        .get("checkerStatus")
        .and_then(Value::as_str)
        .map(|status| status == "pass")
        .unwrap_or(false);
    if !allow || !checker_passed || !candidates_path.is_file() {
        let report = format!(
            "# Promotion Report\n\nGenerated: {}\nTask: {task_id}\nDecision: hold\nReason: policy-check did not allow promotion, checker has not passed, or no candidates exist.\n",
            Local::now().to_rfc3339()
        );
        atomic_write(&report_path, &report)?;
        return Ok(StudioPolicyPromotionResult {
            promoted: 0,
            skipped: 0,
            paths: Vec::new(),
            report_path: report_path.to_string_lossy().to_string(),
        });
    }

    let mut promoted_paths = Vec::new();
    let mut skipped = 0;
    let content = fs::read_to_string(&candidates_path).map_err(|err| err.to_string())?;
    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(24)
    {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            skipped += 1;
            continue;
        };
        if !candidate_is_auto_promotable(&value) {
            skipped += 1;
            continue;
        }
        if !candidate_has_promotion_evidence(&value) {
            skipped += 1;
            continue;
        }
        if !candidate_confidence_allows_promotion(&value) {
            skipped += 1;
            continue;
        }
        let promotion_hint = value
            .get("promotionHint")
            .and_then(Value::as_str)
            .unwrap_or("task");
        let target_kind = match promotion_hint {
            "spec" => "spec",
            "journal" => "journal",
            _ => "task",
        };
        let title = candidate_title(&value);
        let body = render_promoted_candidate(task_id, &value);
        let request = StudioPromoteRequest {
            project_root: project_root.to_string_lossy().to_string(),
            kind: target_kind.to_string(),
            title,
            content: body,
            source: Some(format!(".studio/tasks/{task_id}/memory-candidates.jsonl")),
        };
        match promote_studio_context(&request) {
            Ok(result) if promoted_paths.contains(&result.path) => skipped += 1,
            Ok(result) => promoted_paths.push(result.path),
            Err(_) => skipped += 1,
        }
    }
    let report = format!(
        "# Promotion Report\n\nGenerated: {}\nTask: {task_id}\nDecision: {}\nPromoted: {}\nSkipped: {}\n\n{}\n",
        Local::now().to_rfc3339(),
        if promoted_paths.is_empty() { "hold" } else { "promoted" },
        promoted_paths.len(),
        skipped,
        if promoted_paths.is_empty() {
            "No candidates passed promotion gates.".to_string()
        } else {
            promoted_paths
                .iter()
                .map(|path| format!("- {path}"))
                .collect::<Vec<_>>()
                .join("\n")
        }
    );
    atomic_write(&report_path, &report)?;
    update_promotion_task_state(
        &task_dir.join("task.json"),
        task_id,
        promoted_paths.len(),
        skipped,
        &report_path,
    )?;
    Ok(StudioPolicyPromotionResult {
        promoted: promoted_paths.len(),
        skipped,
        paths: promoted_paths,
        report_path: report_path.to_string_lossy().to_string(),
    })
}

pub fn load_studio_workflow_state(
    project_root: &str,
    terminal_tab_id: Option<&str>,
) -> Result<StudioWorkflowState, String> {
    let project_root_path = Path::new(project_root.trim());
    if project_root_path.as_os_str().is_empty() || !project_root_path.is_dir() {
        return Err("Project root is missing or not a local directory.".to_string());
    }
    let task_id = terminal_tab_id
        .and_then(|tab| task_id_for_terminal_tab(project_root_path, tab))
        .or_else(|| {
            terminal_tab_id
                .map(|tab| format!("tab-{}", stable_slug(tab, "default")))
                .filter(|legacy| {
                    project_root_path
                        .join(".studio")
                        .join("tasks")
                        .join(legacy)
                        .is_dir()
                })
        })
        .or_else(|| latest_task_id(project_root_path));
    let Some(task_id) = task_id else {
        return Ok(StudioWorkflowState::empty(project_root));
    };
    let task_dir = project_root_path
        .join(".studio")
        .join("tasks")
        .join(&task_id);
    if !task_dir.is_dir() {
        return Ok(StudioWorkflowState::empty(project_root));
    }
    let task_json = read_json_file(&task_dir.join("task.json")).unwrap_or(Value::Null);
    let phase = task_json
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_else(|| infer_phase_from_files(&task_dir))
        .to_string();
    let checker = task_json.get("checker").unwrap_or(&Value::Null);
    let policy = read_json_file(&task_dir.join("policy-check.json")).unwrap_or(Value::Null);
    let research_artifacts = list_markdown_files(&task_dir.join("research"))?;
    Ok(StudioWorkflowState {
        project_root: project_root.to_string(),
        task_id: Some(task_id.clone()),
        phase,
        task_path: Some(format!(".studio/tasks/{task_id}/task.json")),
        prd_path: Some(format!(".studio/tasks/{task_id}/prd.md")),
        context_report_path: file_ref_if_exists(
            &task_dir.join("context-selection-report.md"),
            project_root_path,
        ),
        implement_manifest_path: file_ref_if_exists(
            &task_dir.join("implement.jsonl"),
            project_root_path,
        ),
        check_manifest_path: file_ref_if_exists(&task_dir.join("check.jsonl"), project_root_path),
        checker_report_path: file_ref_if_exists(
            &task_dir.join("checker-report.md"),
            project_root_path,
        ),
        policy_check_path: file_ref_if_exists(
            &task_dir.join("policy-check.json"),
            project_root_path,
        ),
        promotion_report_path: file_ref_if_exists(
            &task_dir.join("promotion-report.md"),
            project_root_path,
        ),
        research_artifacts,
        implement_entries: count_jsonl_entries(&task_dir.join("implement.jsonl")),
        check_entries: count_jsonl_entries(&task_dir.join("check.jsonl")),
        checker_status: checker
            .get("status")
            .and_then(Value::as_str)
            .map(str::to_string),
        checker_summary: checker
            .get("summary")
            .and_then(Value::as_str)
            .map(str::to_string),
        checker_issues: checker
            .get("issues")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        checker_needs_retry: checker
            .get("needsRetry")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        checker_retry_performed: checker
            .get("retryPerformed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        checker_retry_status: checker
            .get("retryStatus")
            .and_then(Value::as_str)
            .map(str::to_string),
        checker_retry_report_path: file_ref_if_exists(
            &task_dir.join("checker-retry-report.md"),
            project_root_path,
        ),
        policy_decision: policy
            .get("decision")
            .and_then(Value::as_str)
            .map(str::to_string),
        allow_auto_promote: policy
            .get("allowAutoPromote")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        last_updated: task_json
            .get("updatedAt")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

pub fn apply_context_curator_output(
    project_root: &str,
    task_id: &str,
    raw_output: &str,
) -> Result<StudioContextCurationApplyResult, String> {
    let project_root = Path::new(project_root.trim());
    if project_root.as_os_str().is_empty() || !project_root.is_dir() {
        return Err("Project root is missing or not a local directory.".to_string());
    }
    let parsed = parse_context_curator_output(raw_output)?;
    let implement_entries = sanitize_curator_entries(project_root, task_id, parsed.implement)?;
    let check_entries = sanitize_curator_entries(project_root, task_id, parsed.check)?;
    if implement_entries.is_empty() && check_entries.is_empty() {
        return Err("Context curator returned no valid spec or research entries.".to_string());
    }
    let implement_manifest_entries = if implement_entries.is_empty() {
        vec![fallback_curated_entry(
            "Curator did not select an implementation-specific file; keeping the managed spec index fallback.",
        )]
    } else {
        implement_entries.clone()
    };
    let check_manifest_entries = if check_entries.is_empty() {
        vec![fallback_curated_entry(
            "Curator did not select a verification-specific file; keeping the managed spec index fallback.",
        )]
    } else {
        check_entries.clone()
    };

    let durable_task_dir = project_root.join(".studio").join("tasks").join(task_id);
    let runtime_task_dir = project_root
        .join(".studio")
        .join("runtime")
        .join("tasks")
        .join(task_id);
    fs::create_dir_all(&durable_task_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&runtime_task_dir).map_err(|err| err.to_string())?;

    write_curated_manifest(
        &durable_task_dir.join("implement.jsonl"),
        &implement_manifest_entries,
    )?;
    write_curated_manifest(
        &durable_task_dir.join("check.jsonl"),
        &check_manifest_entries,
    )?;
    sync_manifest_to_durable_task(
        &runtime_task_dir.join("implement.jsonl"),
        &durable_task_dir.join("implement.jsonl"),
    )?;
    sync_manifest_to_durable_task(
        &runtime_task_dir.join("check.jsonl"),
        &durable_task_dir.join("check.jsonl"),
    )?;

    let report_path = durable_task_dir.join("context-selection-report.md");
    let report = render_curated_context_selection_report(
        task_id,
        parsed.report.as_deref(),
        &implement_manifest_entries,
        &check_manifest_entries,
    );
    atomic_write(&report_path, &trim_to_limit(&report, MAX_REPORT_CHARS))?;

    Ok(StudioContextCurationApplyResult {
        implement_entries: implement_manifest_entries.len(),
        check_entries: check_manifest_entries.len(),
        report_path: report_path.to_string_lossy().to_string(),
    })
}

pub fn promote_studio_context(
    request: &StudioPromoteRequest,
) -> Result<StudioPromoteResult, String> {
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
        "spec" => (
            "spec",
            project_root.join(".studio").join("spec"),
            format!("{slug}.md"),
        ),
        "task" => (
            "task",
            project_root.join(".studio").join("workspace").join("tasks"),
            format!("{slug}.md"),
        ),
        "journal" => (
            "journal",
            project_root
                .join(".studio")
                .join("workspace")
                .join("journal"),
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

fn write_manifest(
    path: &Path,
    entries: &[ManifestEntry],
    fallback: ManifestEntry,
) -> Result<(), String> {
    if !should_write_managed_jsonl(path)? {
        return Ok(());
    }
    let selected = if entries.is_empty() {
        vec![fallback]
    } else {
        entries.to_vec()
    };
    let mut content = String::new();
    for entry in selected.into_iter().take(MAX_MANIFEST_ENTRIES) {
        let line = serde_json::json!({
            "_studioManaged": true,
            "file": entry.file,
            "reason": entry.reason,
            "score": entry.score,
        })
        .to_string();
        content.push_str(&line);
        content.push('\n');
    }
    atomic_write(path, &content)
}

fn fallback_curated_entry(reason: &str) -> CuratedManifestEntry {
    CuratedManifestEntry {
        file: ".studio/spec/index.md".to_string(),
        reason: reason.to_string(),
        confidence: 0.4,
    }
}

fn write_curated_manifest(path: &Path, entries: &[CuratedManifestEntry]) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }
    if !should_write_managed_jsonl(path)? {
        return Ok(());
    }
    let mut content = String::new();
    for entry in entries.iter().take(MAX_MANIFEST_ENTRIES) {
        let line = serde_json::json!({
            "_studioManaged": true,
            "curatedBy": "context-curator",
            "file": entry.file,
            "reason": entry.reason,
            "confidence": entry.confidence,
        })
        .to_string();
        content.push_str(&line);
        content.push('\n');
    }
    atomic_write(path, &content)
}

fn sync_manifest_to_durable_task(target: &Path, source: &Path) -> Result<(), String> {
    if !should_write_managed_jsonl(target)? {
        return Ok(());
    }
    let content = fs::read_to_string(source).map_err(|err| err.to_string())?;
    atomic_write(target, &content)
}

fn ensure_workflow_files(project_root: &Path) -> Result<(), String> {
    let studio_dir = project_root.join(".studio");
    atomic_write_if_managed(
        &studio_dir.join("workflow.md"),
        &render_studio_workflow(),
        STUDIO_WORKFLOW_MARKER,
    )?;
    let agents_dir = studio_dir.join("agents");
    let agents = [
        ("context-curator.md", render_agent_context_curator()),
        ("research.md", render_agent_research()),
        ("implement.md", render_agent_implement()),
        ("check.md", render_agent_check()),
        ("memory-distill.md", render_agent_memory_distill()),
        ("policy-check.md", render_agent_policy_check()),
    ];
    for (file_name, content) in agents {
        atomic_write_if_managed(
            &agents_dir.join(file_name),
            &content,
            STUDIO_WORKFLOW_MARKER,
        )?;
    }
    atomic_write_if_managed(
        &studio_dir.join("spec").join("index.md"),
        &render_spec_index(),
        STUDIO_WORKFLOW_MARKER,
    )?;
    let spec_dir = studio_dir.join("spec");
    for (file_name, content) in render_spec_layers() {
        atomic_write_if_managed(&spec_dir.join(file_name), &content, STUDIO_WORKFLOW_MARKER)?;
    }
    atomic_write_if_managed(
        &studio_dir.join("workspace").join("index.md"),
        &render_workspace_index(),
        STUDIO_WORKFLOW_MARKER,
    )?;
    Ok(())
}

fn atomic_write_if_managed(path: &Path, content: &str, marker: &str) -> Result<(), String> {
    if !path.exists() {
        return atomic_write(path, content);
    }
    let existing = fs::read_to_string(path).map_err(|err| err.to_string())?;
    if existing.contains(marker) {
        atomic_write(path, content)?;
    }
    Ok(())
}

fn render_studio_workflow() -> String {
    format!(
        "{STUDIO_WORKFLOW_MARKER}\n# Studio Autonomous Workflow\n\nThis project uses a Studio-native, Trellis-class workflow. Studio owns task state, context curation, runtime projection, and CLI routing across Codex, Claude, and Gemini.\n\n## Phases\n\n1. `planning` - maintain `.studio/tasks/<task-id>/prd.md` and task intent.\n2. `context_curated` - run `context-curator`; write `implement.jsonl`, `check.jsonl`, and `context-selection-report.md`.\n3. `implementing` - dispatch the best CLI with the implement manifest.\n4. `checking` - dispatch checker with the check manifest and acceptance criteria.\n5. `memory_distilled` - run memory distill over facts, evidence, diffs, failures, and decisions.\n6. `completed` - runtime projection is stable; archive or continue from the durable task.\n\n## Automatic Context Contract\n\n- Context/spec curation is automatic and agent-owned; no manual approval is required.\n- The main Studio turn does not inline research, raw working memory, or long history. Research belongs in `.studio/tasks/<task-id>/research/`.\n- `implement.jsonl` and `check.jsonl` are projections, not the source of truth. The durable task, evidence graph, research files, and spec files are canonical.\n- Heuristic spec selection is fallback only when no curated entries exist.\n\n## Machine Gates\n\n- `context_curated`: manifests contain managed entries or an explicit fallback reason.\n- `checking`: checker consumes `check.jsonl` and records failures before retry.\n- `memory_distilled`: long-term updates include provenance, confidence, supersedes, and a policy decision.\n- Runtime traces, command successes, and generic file-update facts must not auto-promote into durable workspace memory.\n- Durable `.studio/spec/` updates are automatic only when policy-check permits them; otherwise they remain candidates.\n\n## CLI Policy\n\n- Codex, Claude, and Gemini follow the same task state machine.\n- CLI-specific prompts may differ, but they must read the same durable task and generated manifests.\n- Prefer file references over prompt stuffing.\n"
    )
}

fn render_agent_context_curator() -> String {
    format!(
        "{STUDIO_WORKFLOW_MARKER}\n# context-curator\n\nRole: select the minimal task-specific context for implementation and checking.\n\nInputs:\n- `.studio/tasks/<task-id>/prd.md`\n- `.studio/spec/**/index.md` and relevant spec files\n- `.studio/tasks/<task-id>/research/*.md`\n- current runtime context and changed-file hints\n\nOutputs:\n- `.studio/tasks/<task-id>/implement.jsonl`\n- `.studio/tasks/<task-id>/check.jsonl`\n- `.studio/tasks/<task-id>/context-selection-report.md`\n\nRules:\n- Run automatically; do not ask for human confirmation.\n- Add only spec or research files, never source files to edit.\n- Explain every selected file with a reason and confidence.\n- Prefer stable curated entries over per-turn heuristic matches.\n"
    )
}

fn render_agent_research() -> String {
    format!(
        "{STUDIO_WORKFLOW_MARKER}\n# research\n\nRole: gather project and external evidence for the task.\n\nOutputs go under `.studio/tasks/<task-id>/research/`. Do not leave research only in chat. Each file should include source, finding, evidence, and relevance to implementation/checking.\n"
    )
}

fn render_agent_implement() -> String {
    format!(
        "{STUDIO_WORKFLOW_MARKER}\n# implement\n\nRole: implement the task using `.studio/tasks/<task-id>/implement.jsonl`.\n\nRules:\n- Read PRD and selected manifest before editing.\n- Keep changes scoped to the task.\n- Record relevant files and decisions in the task state through Studio outputs.\n"
    )
}

fn render_agent_check() -> String {
    format!(
        "{STUDIO_WORKFLOW_MARKER}\n# check\n\nRole: verify implementation against `.studio/tasks/<task-id>/check.jsonl`, PRD, and changed files.\n\nRules:\n- Prefer concrete failures over speculative warnings.\n- Record failed commands and missing acceptance criteria.\n- Send defects back to implementing or planning when needed.\n"
    )
}

fn render_agent_memory_distill() -> String {
    format!(
        "{STUDIO_WORKFLOW_MARKER}\n# memory-distill\n\nRole: convert task evidence into durable knowledge candidates.\n\nInputs include decisions, constraints, rules, failures, checkpoints, progress, diffs, and final conclusions. Runtime command successes and generic file-update events are not durable knowledge. Outputs must include provenance, confidence, tags, and suggested target: spec, task, journal, or hold.\n"
    )
}

fn render_agent_policy_check() -> String {
    format!(
        "{STUDIO_WORKFLOW_MARKER}\n# policy-check\n\nRole: decide whether an automatic memory/spec update is safe.\n\nAllow durable writes only when the update has provenance, high confidence, no direct conflict with existing spec, and a clear supersedes relation when replacing guidance. Otherwise keep it as a candidate.\n"
    )
}

fn render_spec_index() -> String {
    format!(
        "{STUDIO_WORKFLOW_MARKER}\n# Studio Spec Index\n\nThis directory stores durable project rules used by the Studio Autonomous Workflow.\n\n## Layers\n\n- `.studio/spec/frontend/index.md` - React UI, chat surfaces, terminal dock, and workflow panel behavior.\n- `.studio/spec/tauri-runtime/index.md` - Rust commands, process orchestration, state, and app runtime rules.\n- `.studio/spec/cli-adapters/index.md` - Codex, Claude, Gemini adapters, hooks, sessions, and permissions.\n- `.studio/spec/storage/index.md` - SQLite task kernel, task bindings, facts, evidence, and migrations.\n- `.studio/spec/automation/index.md` - automation goals, workflow runs, validation, retry, and routing.\n- `.studio/spec/windows-runtime/index.md` - Windows shells, encoding, path handling, and constrained-language safety.\n\n## Policy\n\n- Spec updates are automatic only after `memory-distill` and `policy-check` accept provenance, confidence, conflict, and supersedes requirements.\n- Context manifests may reference this index as a discovery entry.\n- Context-curator should select the narrowest relevant layer index instead of injecting every spec file.\n- Keep concrete implementation contracts in topic-specific Markdown files under `.studio/spec/`.\n"
    )
}

fn render_spec_layers() -> [(&'static str, String); 6] {
    [
        (
            "frontend/index.md",
            render_spec_layer_index(
                "Frontend Spec",
                "React, TypeScript, chat UX, terminal dock, workflow visibility, and design-system integration.",
                &[
                    "Prefer existing component and state patterns before adding new UI abstractions.",
                    "Workflow state should be inspectable without inlining raw history into the prompt.",
                    "Do not let dynamic labels, counters, or streamed content resize fixed control surfaces unexpectedly.",
                    "Surface task, manifest, checker, and policy state as operational UI, not as marketing copy.",
                ],
            ),
        ),
        (
            "tauri-runtime/index.md",
            render_spec_layer_index(
                "Tauri Runtime Spec",
                "Rust commands, subprocess lifecycle, app state, environment propagation, and local execution safety.",
                &[
                    "Keep Tauri commands responsive; long work should run in bounded background jobs or child processes.",
                    "Propagate Studio context through explicit environment variables instead of relying on global process state.",
                    "Child processes must have bounded timeouts and clear error logging.",
                    "Generated runtime files are projections and may be overwritten; durable state belongs under `.studio/tasks/` or SQLite.",
                ],
            ),
        ),
        (
            "cli-adapters/index.md",
            render_spec_layer_index(
                "CLI Adapters Spec",
                "Codex, Claude, Gemini command adapters, hooks, permissions, transport sessions, and prompt prelude rules.",
                &[
                    "All CLIs must consume the same `.studio` task, manifest, and workflow contract.",
                    "Adapter-specific prompts may differ, but task identity and manifest paths must stay shared.",
                    "Use `STUDIO_CONTEXT_ID` to resolve session-scoped runtime context in native hooks.",
                    "Silent workflow agents must run with planning/read-only permissions unless they are an explicit retry repair.",
                ],
            ),
        ),
        (
            "storage/index.md",
            render_spec_layer_index(
                "Storage Spec",
                "SQLite task kernel, terminal state, task-tab bindings, facts, evidence, migrations, and semantic recall.",
                &[
                    "Task identity is independent from terminal tab identity.",
                    "Terminal tabs are interaction surfaces bound to tasks through explicit binding records.",
                    "Schema migrations must preserve existing local user state.",
                    "Durable memory promotion requires evidence, confidence, and policy approval.",
                ],
            ),
        ),
        (
            "automation/index.md",
            render_spec_layer_index(
                "Automation Spec",
                "Automation goals, workflow runs, validation gates, owner routing, retry behavior, and event logs.",
                &[
                    "Automation should route by capability and record why a CLI was selected.",
                    "Checker and validator failures should produce actionable evidence, not silent loops.",
                    "Retries are bounded and focused; repeated failures remain visible in workflow state.",
                    "Automation outputs should feed the same task, manifest, and memory pipeline as manual turns.",
                ],
            ),
        ),
        (
            "windows-runtime/index.md",
            render_spec_layer_index(
                "Windows Runtime Spec",
                "PowerShell, cmd.exe, UTF-8 output, path quoting, hidden process windows, and constrained-language compatibility.",
                &[
                    "Do not unconditionally set .NET static properties such as `[Console]::OutputEncoding` in PowerShell wrappers.",
                    "Prefer environment-level UTF-8 controls for Python and CLI subprocesses.",
                    "Windows child processes launched by Studio should avoid visible console windows unless the user asks for one.",
                    "Normalize shell bootstrap errors before they become task titles, PRDs, context reports, or memory candidates.",
                ],
            ),
        ),
    ]
}

fn render_spec_layer_index(title: &str, scope: &str, rules: &[&str]) -> String {
    let rule_lines = rules
        .iter()
        .map(|rule| format!("- {rule}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "{STUDIO_WORKFLOW_MARKER}\n# {title}\n\nScope: {scope}\n\n## Context Selection\n\nContext-curator should select this file when the current task touches this scope. Do not select it for unrelated turns.\n\n## Rules\n\n{rule_lines}\n"
    )
}

fn render_workspace_index() -> String {
    format!(
        "{STUDIO_WORKFLOW_MARKER}\n# Studio Workspace Index\n\nThis directory stores durable journals, session traces, and task-level memory that should survive chat compaction.\n\n## Policy\n\n- Workspace memory is written by the Studio workflow, not pasted from ad hoc chat history.\n- Prefer task directories for active work and promote only durable lessons here.\n"
    )
}

fn clean_studio_text(value: &str) -> String {
    let stripped = strip_ansi_sequences(value);
    let mut lines = Vec::new();
    let mut blank_count = 0usize;
    for line in stripped.lines() {
        if is_powershell_encoding_bootstrap_noise(line) {
            continue;
        }
        if line.trim().is_empty() {
            blank_count += 1;
            if blank_count <= 1 {
                lines.push(String::new());
            }
            continue;
        }
        blank_count = 0;
        lines.push(line.to_string());
    }
    lines.join("\n").trim().to_string()
}

fn clean_studio_option(value: Option<&str>) -> Option<String> {
    value
        .map(clean_studio_text)
        .map(|cleaned| cleaned.trim().to_string())
        .filter(|cleaned| !cleaned.is_empty())
}

fn studio_task_title(input: &StudioContextExportInput) -> String {
    clean_studio_option(input.task_title.as_deref())
        .or_else(|| clean_studio_option(input.task_goal.as_deref()))
        .unwrap_or_else(|| clean_studio_text(&input.user_prompt))
}

fn studio_task_goal(input: &StudioContextExportInput) -> String {
    clean_studio_option(input.task_goal.as_deref())
        .unwrap_or_else(|| clean_studio_text(&input.user_prompt))
}

fn strip_ansi_sequences(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
            continue;
        }
        output.push(ch);
    }
    output
}

fn is_powershell_encoding_bootstrap_noise(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    trimmed.contains("[Console]::OutputEncoding")
        || trimmed.contains("无法设置属性")
        || trimmed.contains("此语言模式仅支持核心类型")
        || trimmed.starts_with("所在位置")
        || trimmed.starts_with("+ ~")
        || lower.contains("propertysetternotsupportedinconstrainedlanguage")
        || lower.contains("cannot set property")
        || lower.contains("categoryinfo")
        || lower.contains("fullyqualifiederrorid")
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
- .studio/workflow.md\n\
- .studio/runtime/tasks/{task_id}/task.md\n\
- .studio/tasks/{task_id}/task.json\n\
- .studio/tasks/{task_id}/prd.md\n\
- .studio/tasks/{task_id}/context-selection-report.md\n\
- .studio/runtime/tasks/{task_id}/implement.jsonl\n\
- .studio/runtime/tasks/{task_id}/check.jsonl\n\
- .studio/spec/index.md if it exists\n\n\
Rules:\n\
- Do not ask the user to paste prior CLI history unless these files are insufficient.\n\
- Treat .studio/spec as durable project rules.\n\
- Treat .studio/workflow.md as the task state machine and agent contract.\n\
- Treat .studio/runtime/tasks/{task_id} as the active runtime task snapshot.\n\
- Context/spec curation is automatic; use the generated manifests before broad history recall.\n\
- Treat SQLite/semantic recall as optional fallback only.\n\n\
Current CLI: {}\n\
Access: {}\n\
</studio-context>",
        input.cli_id, access
    )
}

fn render_context(input: &StudioContextExportInput, task_id: &str) -> String {
    let next_action =
        clean_studio_option(input.handoff_next_step.as_deref()).unwrap_or_else(|| {
            "Continue the current user request with the active task context.".to_string()
        });
    let compacted_context = clean_studio_option(input.compacted_context.as_deref());
    let cross_tab_context = clean_studio_option(input.cross_tab_context.as_deref());
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
- Durable task: .studio/tasks/{task_id}/task.json\n\
- PRD: .studio/tasks/{task_id}/prd.md\n\
- Workflow: .studio/workflow.md\n\
- Context selection report: .studio/tasks/{task_id}/context-selection-report.md\n\
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
Start with this file, .studio/workflow.md, and the active runtime task. Load detailed spec/research files from the JSONL manifests only when needed. Avoid injecting unrelated historical chat into the current turn.\n",
        Local::now().to_rfc3339(),
        input.project_name,
        input.project_root,
        input.branch,
        input.dirty_files,
        input.failing_checks,
        input.cli_id,
        input.terminal_tab_id,
        next_action,
        render_runtime_working_memory_reference(input, task_id),
        optional_section("Compacted Context", compacted_context.as_deref()),
        optional_section("Cross Tab Context", cross_tab_context.as_deref())
    )
}

fn render_runtime_working_memory_reference(
    input: &StudioContextExportInput,
    task_id: &str,
) -> String {
    if input
        .working_memory
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        return String::new();
    }
    format!(
        "## Working Memory\n\nWorking memory is intentionally not inlined here to avoid prompt pollution. Use `.studio/runtime/tasks/{task_id}/task.md`, `.studio/tasks/{task_id}/task.json`, manifests, and durable reports as the source of truth.\n\n"
    )
}

fn render_task(input: &StudioContextExportInput, task_id: &str) -> String {
    let goal = studio_task_goal(input);
    let current_request = clean_studio_text(&input.user_prompt);
    let latest_conclusion = clean_studio_option(input.handoff_summary.as_deref())
        .unwrap_or_else(|| "No assistant conclusion captured yet.".to_string());
    let next_step = clean_studio_option(input.handoff_next_step.as_deref())
        .unwrap_or_else(|| "Continue from the latest user request.".to_string());
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
## Current Request\n\n\
{}\n\n\
## Runtime Identity\n\n\
- Workspace ID: {}\n\
- Task ID: {task_id}\n\
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
        non_empty(&goal, "Continue the active task."),
        non_empty(&current_request, "Continue the active task."),
        input.workspace_id,
        input.terminal_tab_id,
        input.cli_id,
        input.branch,
        latest_conclusion,
        files,
        next_step,
    )
}

fn render_durable_task_json(
    input: &StudioContextExportInput,
    task_id: &str,
    active_tab_ids: &[String],
    existing_task: Option<&Value>,
) -> Result<String, String> {
    let title = studio_task_title(input);
    let goal = studio_task_goal(input);
    let latest_conclusion = clean_studio_option(input.handoff_summary.as_deref());
    let next_step = clean_studio_option(input.handoff_next_step.as_deref())
        .unwrap_or_else(|| "Continue from the latest user request.".to_string());
    let mut value = serde_json::json!({
        "id": task_id,
        "title": non_empty(&title, "Studio Task"),
        "status": infer_task_status(input),
        "workflow": ".studio/workflow.md",
        "phaseOrder": ["planning", "context_curated", "implementing", "checking", "memory_distilled", "completed"],
        "agents": {
            "contextCurator": ".studio/agents/context-curator.md",
            "research": ".studio/agents/research.md",
            "implement": ".studio/agents/implement.md",
            "check": ".studio/agents/check.md",
            "memoryDistill": ".studio/agents/memory-distill.md",
            "policyCheck": ".studio/agents/policy-check.md"
        },
        "projectName": input.project_name.as_str(),
        "workspaceId": input.workspace_id.as_str(),
        "goal": non_empty(&goal, "Continue the active task."),
        "terminalTabId": input.terminal_tab_id.as_str(),
        "activeTabIds": active_tab_ids,
        "currentCli": input.cli_id.as_str(),
        "branch": input.branch.as_str(),
        "latestConclusion": latest_conclusion.as_deref(),
        "nextStep": next_step,
        "relevantFiles": input.handoff_files.as_slice(),
        "runtimeTask": format!(".studio/runtime/tasks/{task_id}/task.md"),
        "contextSelectionReport": format!(".studio/tasks/{task_id}/context-selection-report.md"),
        "implementManifest": format!(".studio/runtime/tasks/{task_id}/implement.jsonl"),
        "checkManifest": format!(".studio/runtime/tasks/{task_id}/check.jsonl"),
        "checkerReport": format!(".studio/tasks/{task_id}/checker-report.md"),
        "checkerRetryReport": format!(".studio/tasks/{task_id}/checker-retry-report.md"),
        "memoryCandidates": format!(".studio/tasks/{task_id}/memory-candidates.jsonl"),
        "memoryDistillReport": format!(".studio/tasks/{task_id}/memory-distill-report.md"),
        "policyCheck": format!(".studio/tasks/{task_id}/policy-check.json"),
        "updatedAt": Local::now().to_rfc3339(),
        "studioManaged": true,
    });
    if let Some(object) = value.as_object_mut() {
        for key in ["checker", "memoryDistill", "promotion"] {
            if let Some(existing_value) = existing_task.and_then(|task| task.get(key)).cloned() {
                object.insert(key.to_string(), existing_value);
            }
        }
    }
    serde_json::to_string_pretty(&value).map_err(|err| err.to_string())
}

fn write_durable_prd_if_missing(
    path: &Path,
    input: &StudioContextExportInput,
    task_id: &str,
) -> Result<(), String> {
    if path.is_file() {
        return Ok(());
    }
    let goal = studio_task_goal(input);
    let content = format!(
        "# {task_id}\n\n## Goal\n\n{}\n\n## Acceptance Criteria\n\n- Use `.studio/workflow.md` as the autonomous workflow contract.\n- Curate context automatically through `.studio/tasks/{task_id}/context-selection-report.md`.\n- Follow relevant specs/research from `implement.jsonl` and `check.jsonl`.\n- Distill durable lessons with provenance, confidence, and policy-check output.\n\n## Notes\n\nCreated by Studio Autonomous Workflow for cross-CLI continuity.\n",
        non_empty(&goal, "Continue the active task."),
    );
    atomic_write(path, &content)
}

fn load_active_tab_ids(task_json_path: &Path, current_tab_id: &str) -> Vec<String> {
    let mut tabs = read_json_file(task_json_path)
        .ok()
        .and_then(|value| value.get("activeTabIds").cloned())
        .and_then(|value| value.as_array().cloned())
        .map(|values| {
            values
                .into_iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !current_tab_id.trim().is_empty() && !tabs.iter().any(|tab| tab == current_tab_id) {
        tabs.push(current_tab_id.to_string());
    }
    tabs.sort();
    tabs.dedup();
    tabs
}

fn render_memory_distill_report(
    input: &StudioContextExportInput,
    task_id: &str,
    distill: &MemoryDistillSanitization,
    checker_passed: bool,
    decision: &str,
) -> String {
    let latest_conclusion = clean_studio_option(input.handoff_summary.as_deref())
        .unwrap_or_else(|| "No assistant conclusion captured yet.".to_string());
    format!(
        "# Memory Distill Report\n\nGenerated: {}\nTask: {task_id}\nAgent: memory-distill\nDecision: {decision}\nChecker Passed: {}\n\n## Inputs\n\n- Kernel memory entries and high-confidence facts from the Studio task kernel.\n- Latest conclusion: {}\n- Relevant files: {}\n\n## Candidate Summary\n\n- Accepted candidates: {}\n- Promotable candidates: {}\n- Rejected candidates: {}\n\n## Policy\n\nCandidates are written to `memory-candidates.jsonl`. Each accepted candidate must keep provenance and a promotion hint. Automatic durable writes are gated by `policy-check.json` and require checker pass.\n",
        Local::now().to_rfc3339(),
        if checker_passed { "yes" } else { "no" },
        latest_conclusion,
        if input.handoff_files.is_empty() {
            "none".to_string()
        } else {
            input.handoff_files.join(", ")
        },
        distill.accepted.len(),
        distill.promotable_entries,
        distill.rejected_entries,
    )
}

fn render_policy_check_json(
    input: &StudioContextExportInput,
    task_id: &str,
    has_promotable_candidates: bool,
) -> Result<String, String> {
    let value = serde_json::json!({
        "_studioManaged": true,
        "taskId": task_id,
        "agent": "policy-check",
        "allowAutoPromote": false,
        "decision": if has_promotable_candidates { "pending_checker" } else { "hold" },
        "checkerStatus": "not_run",
        "reason": if has_promotable_candidates {
            "Promotable candidates exist, but automatic promotion waits for the checker gate."
        } else {
            "No promotable durable memory candidates are available for this turn. Runtime traces and file-update noise are held."
        },
        "candidateCounts": {
            "promotable": if has_promotable_candidates { 1 } else { 0 },
            "rejected": 0
        },
        "failingChecks": input.failing_checks,
        "requires": ["provenance", "confidence", "no_conflict", "supersedes_when_replacing"],
        "updatedAt": Local::now().to_rfc3339(),
    });
    serde_json::to_string_pretty(&value).map_err(|err| err.to_string())
}

fn render_post_checker_policy_check_json(
    task_id: &str,
    checker_passed: bool,
    distill: &MemoryDistillSanitization,
    allow_auto_promote: bool,
    decision: &str,
) -> Result<String, String> {
    let value = serde_json::json!({
        "_studioManaged": true,
        "taskId": task_id,
        "agent": "policy-check",
        "allowAutoPromote": allow_auto_promote,
        "decision": decision,
        "checkerStatus": if checker_passed { "pass" } else { "not_passed" },
        "reason": if allow_auto_promote {
            "Checker passed and at least one candidate satisfied provenance, confidence, conflict, and target gates."
        } else if !checker_passed {
            "Checker has not passed; durable memory promotion is held."
        } else {
            "Checker passed, but no candidate satisfied the promotion gates."
        },
        "candidateCounts": {
            "accepted": distill.accepted.len(),
            "promotable": distill.promotable_entries,
            "rejected": distill.rejected_entries,
        },
        "requires": ["provenance", "confidence", "no_conflict", "supersedes_when_replacing"],
        "updatedAt": Local::now().to_rfc3339(),
    });
    serde_json::to_string_pretty(&value).map_err(|err| err.to_string())
}

#[derive(Debug, Clone, Default)]
struct MemoryDistillSanitization {
    accepted: Vec<String>,
    promotable_entries: usize,
    rejected_entries: usize,
}

fn sanitize_memory_candidates(raw_candidates: &str) -> MemoryDistillSanitization {
    let mut distill = MemoryDistillSanitization::default();
    let mut seen = HashSet::new();
    for line in raw_candidates
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(64)
    {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            distill.rejected_entries += 1;
            continue;
        };
        if !candidate_has_promotion_content(&value)
            || candidate_is_runtime_noise(&value)
            || !candidate_has_promotion_evidence(&value)
        {
            distill.rejected_entries += 1;
            continue;
        }
        let content_key = value
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if content_key.is_empty() || !seen.insert(content_key) {
            distill.rejected_entries += 1;
            continue;
        }
        if candidate_is_auto_promotable(&value) && candidate_confidence_allows_promotion(&value) {
            distill.promotable_entries += 1;
        }
        match serde_json::to_string(&value) {
            Ok(line) => distill.accepted.push(line),
            Err(_) => distill.rejected_entries += 1,
        }
    }
    distill
}

fn curate_context(
    project_root: &Path,
    input: &StudioContextExportInput,
    task_id: &str,
) -> Result<ContextCuration, String> {
    let mut entries = select_spec_manifest_entries(project_root, input)?;
    let research_entries = select_research_manifest_entries(project_root, task_id)?;
    entries.extend(research_entries.clone());
    entries.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.file.cmp(&right.file))
    });
    entries.truncate(MAX_MANIFEST_ENTRIES);

    let mut check_entries = entries.clone();
    prioritize_check_entries(&mut check_entries);
    check_entries.truncate(MAX_MANIFEST_ENTRIES);

    let report = render_context_selection_report(input, task_id, &entries, &check_entries);
    Ok(ContextCuration {
        implement_entries: entries,
        check_entries,
        report,
    })
}

fn select_spec_manifest_entries(
    project_root: &Path,
    input: &StudioContextExportInput,
) -> Result<Vec<ManifestEntry>, String> {
    let spec_dir = project_root.join(".studio").join("spec");
    if !spec_dir.is_dir() {
        return Ok(Vec::new());
    }

    let query = build_query_terms(input);
    let relevant_files = input
        .handoff_files
        .iter()
        .map(|file| file.to_ascii_lowercase())
        .collect::<Vec<_>>();
    let mut entries = Vec::new();
    collect_spec_entries(
        project_root,
        &spec_dir,
        &query,
        &relevant_files,
        &mut entries,
    )?;
    entries.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.file.cmp(&right.file))
    });
    entries.truncate(MAX_MANIFEST_ENTRIES);
    Ok(entries)
}

fn select_research_manifest_entries(
    project_root: &Path,
    task_id: &str,
) -> Result<Vec<ManifestEntry>, String> {
    let research_dir = project_root
        .join(".studio")
        .join("tasks")
        .join(task_id)
        .join("research");
    if !research_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let mut children = fs::read_dir(&research_dir)
        .map_err(|err| err.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    children.sort();
    for path in children.into_iter().take(MAX_MANIFEST_ENTRIES) {
        if path.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }
        let relative = path
            .strip_prefix(project_root)
            .unwrap_or(path.as_path())
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(ManifestEntry {
            file: relative,
            reason: "Task research artifact produced for autonomous context curation.".to_string(),
            score: 25,
        });
    }
    Ok(entries)
}

fn prioritize_check_entries(entries: &mut [ManifestEntry]) {
    for entry in entries.iter_mut() {
        let file = entry.file.to_ascii_lowercase();
        if file.contains("check")
            || file.contains("test")
            || file.contains("quality")
            || file.contains("review")
            || file.contains("verification")
        {
            entry.score += 10;
            entry.reason = format!("{} Check-phase priority boost.", entry.reason);
        }
    }
    entries.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.file.cmp(&right.file))
    });
}

fn render_context_selection_report(
    input: &StudioContextExportInput,
    task_id: &str,
    implement_entries: &[ManifestEntry],
    check_entries: &[ManifestEntry],
) -> String {
    let request = clean_studio_text(&input.user_prompt);
    format!(
        "# Context Selection Report\n\nGenerated: {}\nTask: {task_id}\nCurator: Studio automatic context-curator\nStrategy: Trellis-class agent-curated projection with heuristic fallback.\n\n## Request\n\n{}\n\n## Implement Manifest\n\n{}\n\n## Check Manifest\n\n{}\n\n## Policy Gates\n\n- Context curation is automatic; no human approval is required.\n- Source files to edit are not pre-registered in manifests.\n- Long-term spec/workspace writes require provenance, confidence, and policy-check output.\n- If no curated spec/research exists, fallback entries point to `.studio/spec/index.md` when available.\n",
        Local::now().to_rfc3339(),
        non_empty(&request, "Continue the active task."),
        render_manifest_report_entries(implement_entries),
        render_manifest_report_entries(check_entries),
    )
}

fn render_manifest_report_entries(entries: &[ManifestEntry]) -> String {
    if entries.is_empty() {
        return "- No specific entries selected; fallback manifest will be used.".to_string();
    }
    entries
        .iter()
        .map(|entry| {
            format!(
                "- `{}` (score {}): {}",
                entry.file, entry.score, entry.reason
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn infer_task_status(input: &StudioContextExportInput) -> &'static str {
    if input.failing_checks > 0 {
        "checking"
    } else if input.write_mode {
        "implementing"
    } else {
        "context_curated"
    }
}

fn collect_spec_entries(
    project_root: &Path,
    dir: &Path,
    query: &HashSet<String>,
    relevant_files: &[String],
    entries: &mut Vec<ManifestEntry>,
) -> Result<(), String> {
    if entries.len() >= MAX_SPEC_SCAN_FILES || !dir.is_dir() {
        return Ok(());
    }
    let mut children = fs::read_dir(dir)
        .map_err(|err| err.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    children.sort();
    for path in children {
        if entries.len() >= MAX_SPEC_SCAN_FILES {
            break;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_spec_entries(project_root, &path, query, relevant_files, entries)?;
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }
        let relative = path
            .strip_prefix(project_root)
            .unwrap_or(path.as_path())
            .to_string_lossy()
            .replace('\\', "/");
        let content = fs::read_to_string(&path).unwrap_or_default();
        let score = score_spec_candidate(&relative, &content, query, relevant_files);
        if score > 0 || name == "index.md" {
            let reason = if score > 0 {
                format!("Matched current task, files, or request terms (score {score}).")
            } else {
                "Spec index for discovering durable project rules.".to_string()
            };
            entries.push(ManifestEntry {
                file: relative,
                reason,
                score,
            });
        }
    }
    Ok(())
}

fn build_query_terms(input: &StudioContextExportInput) -> HashSet<String> {
    let mut terms = HashSet::new();
    let values = [
        clean_studio_text(&input.user_prompt),
        clean_studio_option(input.handoff_summary.as_deref()).unwrap_or_default(),
        clean_studio_option(input.handoff_next_step.as_deref()).unwrap_or_default(),
    ];
    for value in values {
        for token in tokenize(&value) {
            terms.insert(token);
        }
    }
    for file in &input.handoff_files {
        for token in tokenize(file) {
            terms.insert(token);
        }
    }
    terms
}

fn tokenize(value: &str) -> Vec<String> {
    value
        .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_' && ch != '-')
        .map(|token| token.trim_matches('-').to_ascii_lowercase())
        .filter(|token| token.chars().count() >= 3)
        .take(80)
        .collect()
}

fn score_spec_candidate(
    relative: &str,
    content: &str,
    query: &HashSet<String>,
    relevant_files: &[String],
) -> i64 {
    let haystack = format!(
        "{}\n{}",
        relative,
        content.chars().take(4_000).collect::<String>()
    )
    .to_ascii_lowercase();
    let mut score = if relative.ends_with("/index.md") || relative == ".studio/spec/index.md" {
        2
    } else {
        0
    };
    for term in query {
        if haystack.contains(term) {
            score += 5;
        }
    }
    for file in relevant_files {
        for segment in file.split('/') {
            let segment = segment.to_ascii_lowercase();
            if segment.len() >= 3 && haystack.contains(&segment) {
                score += 3;
            }
        }
    }
    score
}

fn should_write_managed_jsonl(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(true);
    }
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    if content.trim().is_empty() {
        return Ok(true);
    }
    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            return Ok(false);
        };
        if value
            .get("_studioManaged")
            .and_then(|marker| marker.as_bool())
            != Some(true)
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn parse_context_curator_output(raw_output: &str) -> Result<ContextCuratorOutput, String> {
    let trimmed = raw_output.trim();
    if trimmed.is_empty() {
        return Err("Context curator returned empty output.".to_string());
    }
    if let Ok(parsed) = serde_json::from_str::<ContextCuratorOutput>(trimmed) {
        return Ok(parsed);
    }
    if let Some(json_slice) = extract_json_object(trimmed) {
        return serde_json::from_str::<ContextCuratorOutput>(json_slice)
            .map_err(|err| format!("Context curator output was not valid JSON: {err}"));
    }
    Err("Context curator output did not contain a JSON object.".to_string())
}

fn parse_research_agent_output(raw_output: &str) -> Result<ResearchAgentOutput, String> {
    let trimmed = raw_output.trim();
    if trimmed.is_empty() {
        return Ok(ResearchAgentOutput::default());
    }
    if let Ok(parsed) = serde_json::from_str::<ResearchAgentOutput>(trimmed) {
        return Ok(parsed);
    }
    if let Some(json_slice) = extract_json_object(trimmed) {
        return serde_json::from_str::<ResearchAgentOutput>(json_slice)
            .map_err(|err| format!("Research output was not valid JSON: {err}"));
    }
    Ok(ResearchAgentOutput::default())
}

fn parse_checker_agent_output(raw_output: &str) -> Result<CheckerAgentOutput, String> {
    let trimmed = raw_output.trim();
    if trimmed.is_empty() {
        return Ok(CheckerAgentOutput {
            status: "pass".to_string(),
            summary: "Checker returned no issues.".to_string(),
            issues: Vec::new(),
        });
    }
    if let Ok(parsed) = serde_json::from_str::<CheckerAgentOutput>(trimmed) {
        return Ok(parsed);
    }
    if let Some(json_slice) = extract_json_object(trimmed) {
        return serde_json::from_str::<CheckerAgentOutput>(json_slice)
            .map_err(|err| format!("Checker output was not valid JSON: {err}"));
    }
    Ok(CheckerAgentOutput {
        status: "fail".to_string(),
        summary: "Checker output was not machine-readable.".to_string(),
        issues: vec![trim_to_limit(trimmed, 2_000)],
    })
}

fn extract_json_object(value: &str) -> Option<&str> {
    let start = value.find('{')?;
    let end = value.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&value[start..=end])
}

fn sanitize_curator_entries(
    project_root: &Path,
    task_id: &str,
    entries: Vec<ContextCuratorEntry>,
) -> Result<Vec<CuratedManifestEntry>, String> {
    let mut selected = Vec::new();
    let mut seen = HashSet::new();
    for entry in entries {
        if selected.len() >= MAX_MANIFEST_ENTRIES {
            break;
        }
        let Ok(file) = normalize_curator_file(&entry.file) else {
            continue;
        };
        if !seen.insert(file.clone()) {
            continue;
        }
        if !is_allowed_curator_file(task_id, &file) {
            continue;
        }
        let path = project_root.join(&file);
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }
        selected.push(CuratedManifestEntry {
            file,
            reason: non_empty(&entry.reason, "Selected by automatic context-curator.").to_string(),
            confidence: entry.confidence.unwrap_or(0.7).clamp(0.0, 1.0),
        });
    }
    Ok(selected)
}

fn normalize_curator_file(file: &str) -> Result<String, String> {
    let normalized = file.trim().trim_matches('`').replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.contains('\0')
        || normalized.contains("://")
    {
        return Err("Context curator returned an invalid path.".to_string());
    }
    let path = Path::new(&normalized);
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("Context curator returned an unsafe path.".to_string());
    }
    Ok(normalized.trim_start_matches("./").to_string())
}

fn is_allowed_curator_file(task_id: &str, file: &str) -> bool {
    let task_research_prefix = format!(".studio/tasks/{task_id}/research/");
    (file.starts_with(".studio/spec/") || file.starts_with(&task_research_prefix))
        && file.ends_with(".md")
}

fn render_curated_context_selection_report(
    task_id: &str,
    curator_report: Option<&str>,
    implement_entries: &[CuratedManifestEntry],
    check_entries: &[CuratedManifestEntry],
) -> String {
    format!(
        "# Context Selection Report\n\nGenerated: {}\nTask: {task_id}\nCurator: Studio silent context-curator\nStrategy: Trellis-class automatic agent-curated projection.\n\n## Curator Summary\n\n{}\n\n## Implement Manifest\n\n{}\n\n## Check Manifest\n\n{}\n\n## Policy Gates\n\n- Context curation ran automatically; no human approval was required.\n- Curator output was host-validated before writing manifests.\n- Only existing `.studio/spec/**/*.md` and task research files were accepted.\n- Source files and absolute/parent paths were rejected.\n",
        Local::now().to_rfc3339(),
        curator_report
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Curator selected task-specific durable context."),
        render_curated_report_entries(implement_entries),
        render_curated_report_entries(check_entries),
    )
}

fn render_curated_report_entries(entries: &[CuratedManifestEntry]) -> String {
    if entries.is_empty() {
        return "- No valid curator entries selected.".to_string();
    }
    entries
        .iter()
        .map(|entry| {
            format!(
                "- `{}` (confidence {:.2}): {}",
                entry.file, entry.confidence, entry.reason
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_checker_status(status: &str, issues: &[String]) -> String {
    let normalized = status.trim().to_ascii_lowercase();
    if normalized == "pass" || normalized == "passed" || normalized == "ok" {
        "pass".to_string()
    } else if normalized == "fail" || normalized == "failed" || normalized == "retry" {
        "fail".to_string()
    } else if issues.is_empty() {
        "pass".to_string()
    } else {
        "fail".to_string()
    }
}

fn render_checker_report(
    task_id: &str,
    status: &str,
    summary: &str,
    issues: &[String],
    needs_retry: bool,
    checked_at: &str,
) -> String {
    let issue_lines = if issues.is_empty() {
        "- No concrete issues reported.".to_string()
    } else {
        issues
            .iter()
            .map(|issue| format!("- {issue}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "# Checker Report\n\nGenerated: {checked_at}\nTask: {task_id}\nStatus: {status}\nNeeds Retry: {}\nRetry Performed: no\n\n## Summary\n\n{}\n\n## Issues\n\n{}\n",
        if needs_retry { "yes" } else { "no" },
        summary,
        issue_lines,
    )
}

fn render_checker_retry_report(
    task_id: &str,
    status: &str,
    raw_output: &str,
    completed_at: &str,
) -> String {
    format!(
        "# Checker Retry Report\n\nGenerated: {completed_at}\nTask: {task_id}\nStatus: {status}\n\n## Output\n\n{}\n",
        non_empty(
            &trim_to_limit(raw_output, MAX_OPTIONAL_SECTION_CHARS),
            "Retry produced no output."
        ),
    )
}

fn update_checker_task_state(
    task_json_path: &Path,
    task_id: &str,
    status: &str,
    summary: &str,
    issues: &[String],
    needs_retry: bool,
    checked_at: &str,
) -> Result<(), String> {
    let mut task_json = read_json_file(task_json_path).unwrap_or_else(|_| {
        serde_json::json!({
            "id": task_id,
            "studioManaged": true,
        })
    });
    let object = ensure_json_object(&mut task_json);
    object
        .entry("id".to_string())
        .or_insert_with(|| Value::String(task_id.to_string()));
    object.insert(
        "status".to_string(),
        Value::String(if needs_retry { "checking" } else { "completed" }.to_string()),
    );
    object.insert(
        "checkerReport".to_string(),
        Value::String(format!(".studio/tasks/{task_id}/checker-report.md")),
    );
    object.insert(
        "checkerRetryReport".to_string(),
        Value::String(format!(".studio/tasks/{task_id}/checker-retry-report.md")),
    );
    object.insert(
        "checker".to_string(),
        serde_json::json!({
            "status": status,
            "summary": summary,
            "issues": issues,
            "needsRetry": needs_retry,
            "retryPerformed": false,
            "retryStatus": null,
            "retryReport": null,
            "checkedAt": checked_at,
            "report": format!(".studio/tasks/{task_id}/checker-report.md"),
        }),
    );
    object.insert(
        "updatedAt".to_string(),
        Value::String(checked_at.to_string()),
    );
    let content = serde_json::to_string_pretty(&task_json).map_err(|err| err.to_string())?;
    atomic_write(task_json_path, &content)
}

fn update_checker_retry_task_state(
    task_json_path: &Path,
    task_id: &str,
    status: &str,
    raw_output: &str,
    completed_at: &str,
) -> Result<(), String> {
    let mut task_json = read_json_file(task_json_path).unwrap_or_else(|_| {
        serde_json::json!({
            "id": task_id,
            "studioManaged": true,
        })
    });
    let object = ensure_json_object(&mut task_json);
    object
        .entry("id".to_string())
        .or_insert_with(|| Value::String(task_id.to_string()));
    object.insert("status".to_string(), Value::String("checking".to_string()));
    object.insert(
        "nextStep".to_string(),
        Value::String(if status == "completed" {
            "Review the retry output and rerun verification if needed.".to_string()
        } else {
            "Resolve the checker retry failure before continuing.".to_string()
        }),
    );
    object.insert(
        "updatedAt".to_string(),
        Value::String(completed_at.to_string()),
    );

    let checker = object
        .entry("checker".to_string())
        .or_insert_with(|| serde_json::json!({}));
    let checker_object = ensure_json_object(checker);
    checker_object.insert("retryPerformed".to_string(), Value::Bool(true));
    checker_object.insert("retryStatus".to_string(), Value::String(status.to_string()));
    checker_object.insert(
        "retryReport".to_string(),
        Value::String(format!(".studio/tasks/{task_id}/checker-retry-report.md")),
    );
    checker_object.insert(
        "retryCompletedAt".to_string(),
        Value::String(completed_at.to_string()),
    );
    checker_object.insert(
        "retrySummary".to_string(),
        Value::String(trim_to_limit(raw_output, 1_000)),
    );

    let content = serde_json::to_string_pretty(&task_json).map_err(|err| err.to_string())?;
    atomic_write(task_json_path, &content)
}

fn update_memory_distill_task_state(
    task_json_path: &Path,
    task_id: &str,
    checker_passed: bool,
    candidate_entries: usize,
    promotable_entries: usize,
    decision: &str,
) -> Result<(), String> {
    let updated_at = Local::now().to_rfc3339();
    let mut task_json = read_json_file(task_json_path).unwrap_or_else(|_| {
        serde_json::json!({
            "id": task_id,
            "studioManaged": true,
        })
    });
    let object = ensure_json_object(&mut task_json);
    object
        .entry("id".to_string())
        .or_insert_with(|| Value::String(task_id.to_string()));
    if checker_passed {
        object.insert(
            "status".to_string(),
            Value::String("memory_distilled".to_string()),
        );
    }
    object.insert(
        "memoryCandidates".to_string(),
        Value::String(format!(".studio/tasks/{task_id}/memory-candidates.jsonl")),
    );
    object.insert(
        "memoryDistillReport".to_string(),
        Value::String(format!(".studio/tasks/{task_id}/memory-distill-report.md")),
    );
    object.insert(
        "policyCheck".to_string(),
        Value::String(format!(".studio/tasks/{task_id}/policy-check.json")),
    );
    object.insert(
        "memoryDistill".to_string(),
        serde_json::json!({
            "candidateEntries": candidate_entries,
            "promotableEntries": promotable_entries,
            "decision": decision,
            "checkerPassed": checker_passed,
            "report": format!(".studio/tasks/{task_id}/memory-distill-report.md"),
            "policyCheck": format!(".studio/tasks/{task_id}/policy-check.json"),
            "updatedAt": updated_at,
        }),
    );
    object.insert("updatedAt".to_string(), Value::String(updated_at));
    let content = serde_json::to_string_pretty(&task_json).map_err(|err| err.to_string())?;
    atomic_write(task_json_path, &content)
}

fn update_promotion_task_state(
    task_json_path: &Path,
    task_id: &str,
    promoted: usize,
    skipped: usize,
    report_path: &Path,
) -> Result<(), String> {
    let updated_at = Local::now().to_rfc3339();
    let mut task_json = read_json_file(task_json_path).unwrap_or_else(|_| {
        serde_json::json!({
            "id": task_id,
            "studioManaged": true,
        })
    });
    let object = ensure_json_object(&mut task_json);
    object
        .entry("id".to_string())
        .or_insert_with(|| Value::String(task_id.to_string()));
    object.insert("status".to_string(), Value::String("completed".to_string()));
    object.insert(
        "promotionReport".to_string(),
        Value::String(format!(".studio/tasks/{task_id}/promotion-report.md")),
    );
    object.insert(
        "promotion".to_string(),
        serde_json::json!({
            "promoted": promoted,
            "skipped": skipped,
            "report": report_path.to_string_lossy(),
            "updatedAt": updated_at,
        }),
    );
    object.insert("updatedAt".to_string(), Value::String(updated_at));
    let content = serde_json::to_string_pretty(&task_json).map_err(|err| err.to_string())?;
    atomic_write(task_json_path, &content)
}

fn append_checker_retry_to_report(
    checker_report_path: &Path,
    task_id: &str,
    status: &str,
    completed_at: &str,
) -> Result<(), String> {
    if !checker_report_path.exists() {
        return Ok(());
    }
    let mut content = fs::read_to_string(checker_report_path).map_err(|err| err.to_string())?;
    if content.contains("\n## Retry\n") {
        return Ok(());
    }
    content.push_str(&format!(
        "\n## Retry\n\nStatus: {status}\nPerformed: yes\nCompleted: {completed_at}\nReport: .studio/tasks/{task_id}/checker-retry-report.md\n"
    ));
    atomic_write(checker_report_path, &content)
}

fn ensure_json_object(value: &mut Value) -> &mut serde_json::Map<String, Value> {
    if !value.is_object() {
        *value = Value::Object(serde_json::Map::new());
    }
    value.as_object_mut().expect("value was forced to object")
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&content).map_err(|err| err.to_string())
}

fn candidate_has_promotion_evidence(value: &Value) -> bool {
    let has_evidence = value
        .get("sourceEvidenceIds")
        .and_then(Value::as_array)
        .map(|items| !items.is_empty())
        .unwrap_or(false)
        || value.get("sourceFactId").and_then(Value::as_str).is_some();
    candidate_has_promotion_content(value) && has_evidence
}

fn candidate_has_promotion_content(value: &Value) -> bool {
    value
        .get("content")
        .and_then(Value::as_str)
        .map(|content| !content.trim().is_empty())
        .unwrap_or(false)
}

fn candidate_is_runtime_noise(value: &Value) -> bool {
    let kind = value
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let content = value
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    kind == "runtime"
        || content.starts_with("command succeeded:")
        || content.starts_with("command ok")
        || content.contains("generic file update")
        || content.contains("no assistant conclusion captured yet")
}

fn candidate_confidence_allows_promotion(value: &Value) -> bool {
    match value.get("confidence").and_then(Value::as_str) {
        Some("high") => true,
        Some("medium") | Some("low") => false,
        Some(_) => false,
        None => value
            .get("candidateType")
            .and_then(Value::as_str)
            .map(|candidate_type| candidate_type == "kernelMemory")
            .unwrap_or(false),
    }
}

fn candidate_is_auto_promotable(value: &Value) -> bool {
    let kind = value
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let promotion_hint = value
        .get("promotionHint")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if promotion_hint == "hold" || candidate_is_runtime_noise(value) {
        return false;
    }
    matches!(
        kind,
        "decision" | "constraint" | "rule" | "failure" | "checkpoint" | "progress"
    ) || matches!(promotion_hint, "spec" | "journal")
}

fn candidate_title(value: &Value) -> String {
    let kind = value
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("memory");
    let content = value
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("Studio Memory")
        .replace('\n', " ");
    let preview = content.chars().take(64).collect::<String>();
    format!("{} - {}", kind, non_empty(&preview, "Studio Memory"))
}

fn render_promoted_candidate(task_id: &str, value: &Value) -> String {
    let content = value
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let candidate_type = value
        .get("candidateType")
        .and_then(Value::as_str)
        .unwrap_or("memory");
    let evidence = serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string());
    format!(
        "## Source\n\n- Task: `.studio/tasks/{task_id}`\n- Candidate type: `{candidate_type}`\n- Promoted automatically after policy-check.\n\n## Content\n\n{}\n\n## Evidence\n\n```json\n{}\n```\n",
        content.trim(),
        evidence,
    )
}

impl StudioWorkflowState {
    fn empty(project_root: &str) -> Self {
        Self {
            project_root: project_root.to_string(),
            task_id: None,
            phase: "not_started".to_string(),
            task_path: None,
            prd_path: None,
            context_report_path: None,
            implement_manifest_path: None,
            check_manifest_path: None,
            checker_report_path: None,
            policy_check_path: None,
            promotion_report_path: None,
            research_artifacts: Vec::new(),
            implement_entries: 0,
            check_entries: 0,
            checker_status: None,
            checker_summary: None,
            checker_issues: Vec::new(),
            checker_needs_retry: false,
            checker_retry_performed: false,
            checker_retry_status: None,
            checker_retry_report_path: None,
            policy_decision: None,
            allow_auto_promote: false,
            last_updated: None,
        }
    }
}

fn latest_task_id(project_root: &Path) -> Option<String> {
    let tasks_dir = project_root.join(".studio").join("tasks");
    let mut entries = fs::read_dir(tasks_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            Some((name, modified))
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|(_, modified)| *modified);
    entries.pop().map(|(name, _)| name)
}

fn task_id_for_terminal_tab(project_root: &Path, terminal_tab_id: &str) -> Option<String> {
    let sessions_dir = project_root
        .join(".studio")
        .join("runtime")
        .join("sessions");
    let mut matches = fs::read_dir(sessions_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            let value = read_json_file(&path).ok()?;
            let binding_tab = value
                .get("terminalTabId")
                .or_else(|| value.get("terminal_tab_id"))
                .and_then(Value::as_str)?;
            if binding_tab != terminal_tab_id {
                return None;
            }
            let task_id = value
                .get("taskId")
                .or_else(|| value.get("task_id"))
                .and_then(Value::as_str)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .or_else(|| {
                    value
                        .get("activeTask")
                        .or_else(|| value.get("active_task"))
                        .and_then(Value::as_str)
                        .and_then(|active_task| {
                            Path::new(active_task)
                                .file_name()
                                .and_then(|name| name.to_str())
                                .map(str::to_string)
                        })
                })?;
            Some((task_id, modified))
        })
        .collect::<Vec<_>>();
    matches.sort_by_key(|(_, modified)| *modified);
    matches.pop().map(|(task_id, _)| task_id)
}

fn infer_phase_from_files(task_dir: &Path) -> &'static str {
    if task_dir.join("promotion-report.md").is_file() {
        "completed"
    } else if task_dir.join("checker-report.md").is_file() {
        "checking"
    } else if task_dir.join("context-selection-report.md").is_file() {
        "context_curated"
    } else {
        "planning"
    }
}

fn file_ref_if_exists(path: &Path, project_root: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    Some(
        path.strip_prefix(project_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/"),
    )
}

fn list_markdown_files(dir: &Path) -> Result<Vec<String>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let project_root = dir
        .ancestors()
        .find(|path| path.file_name().and_then(|name| name.to_str()) == Some(".studio"))
        .and_then(Path::parent)
        .unwrap_or(dir);
    let mut files = fs::read_dir(dir)
        .map_err(|err| err.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("md"))
        .map(|path| {
            path.strip_prefix(project_root)
                .unwrap_or(path.as_path())
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

fn count_jsonl_entries(path: &Path) -> usize {
    fs::read_to_string(path)
        .ok()
        .map(|content| {
            content
                .lines()
                .filter(|line| !line.trim().is_empty())
                .count()
        })
        .unwrap_or(0)
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
    format!(
        "## {title}\n\n{}\n\n",
        trim_to_limit(value, MAX_OPTIONAL_SECTION_CHARS)
    )
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
    if path.exists() {
        if let Ok(existing) = fs::read_to_string(path) {
            if existing == content {
                return Ok(());
            }
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("studio-context");
    let temp_path = path.with_file_name(format!(
        ".{file_name}.tmp-{}",
        Local::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    fs::write(&temp_path, content).map_err(|err| err.to_string())?;
    fs::rename(&temp_path, path).map_err(|err| {
        let _ = fs::remove_file(&temp_path);
        err.to_string()
    })
}

fn file_content_matches(path: &Path, content: &str) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let existing = fs::read_to_string(path).map_err(|err| err.to_string())?;
    Ok(existing == content)
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
        let content = trim_to_limit(&content, MAX_ADAPTER_CHARS);
        if should_write_managed_file(&path)? && !file_content_matches(&path, &content)? {
            atomic_write(&path, &content)?;
            written.push(file_name.to_string());
        }
    }
    Ok(written)
}

fn ensure_native_cli_hooks(project_root: &Path) -> Result<Vec<String>, String> {
    let files = [
        (".codex/hooks.json", render_codex_hooks_json()),
        (".codex/hooks/session-start.py", render_session_start_hook("codex")),
        (
            ".codex/hooks/inject-workflow-state.py",
            render_prompt_submit_hook("codex"),
        ),
        (
            ".codex/agents/studio-implement.toml",
            render_codex_agent(
                "studio-implement",
                "Implementation agent. Reads PRD plus implement.jsonl and performs the code change.",
            ),
        ),
        (
            ".codex/agents/studio-check.toml",
            render_codex_agent(
                "studio-check",
                "Checker agent. Reads PRD plus check.jsonl and verifies the implementation.",
            ),
        ),
        (
            ".codex/agents/studio-research.toml",
            render_codex_agent(
                "studio-research",
                "Research agent. Writes research artifacts under .studio/tasks/<task-id>/research/.",
            ),
        ),
        (".claude/settings.json", render_claude_settings_json()),
        (".claude/hooks/session-start.py", render_session_start_hook("claude")),
        (
            ".claude/hooks/inject-workflow-state.py",
            render_prompt_submit_hook("claude"),
        ),
        (
            ".claude/hooks/inject-subagent-context.py",
            render_subagent_context_hook("claude"),
        ),
        (
            ".claude/agents/studio-implement.md",
            render_markdown_agent(
                "studio-implement",
                "Implementation agent",
                "Read `.studio/tasks/<task-id>/prd.md` and `.studio/runtime/tasks/<task-id>/implement.jsonl` before editing.",
            ),
        ),
        (
            ".claude/agents/studio-check.md",
            render_markdown_agent(
                "studio-check",
                "Checker agent",
                "Read `.studio/tasks/<task-id>/prd.md` and `.studio/runtime/tasks/<task-id>/check.jsonl`, then report failures before approval.",
            ),
        ),
        (
            ".claude/agents/studio-research.md",
            render_markdown_agent(
                "studio-research",
                "Research agent",
                "Write focused research notes under `.studio/tasks/<task-id>/research/`; do not inline long research in the main session.",
            ),
        ),
        (".gemini/settings.json", render_gemini_settings_json()),
        (".gemini/hooks/session-start.py", render_session_start_hook("gemini")),
        (
            ".gemini/hooks/inject-workflow-state.py",
            render_prompt_submit_hook("gemini"),
        ),
        (
            ".gemini/hooks/inject-subagent-context.py",
            render_subagent_context_hook("gemini"),
        ),
        (
            ".gemini/agents/studio-implement.md",
            render_markdown_agent(
                "studio-implement",
                "Implementation agent",
                "Read `.studio/tasks/<task-id>/prd.md` and `.studio/runtime/tasks/<task-id>/implement.jsonl` before editing.",
            ),
        ),
        (
            ".gemini/agents/studio-check.md",
            render_markdown_agent(
                "studio-check",
                "Checker agent",
                "Read `.studio/tasks/<task-id>/prd.md` and `.studio/runtime/tasks/<task-id>/check.jsonl`, then report failures before approval.",
            ),
        ),
        (
            ".gemini/agents/studio-research.md",
            render_markdown_agent(
                "studio-research",
                "Research agent",
                "Write focused research notes under `.studio/tasks/<task-id>/research/`; do not inline long research in the main session.",
            ),
        ),
    ];
    let mut written = Vec::new();
    for (relative_path, content) in files {
        let path = project_root.join(relative_path);
        if should_write_studio_hook_file(&path)? && !file_content_matches(&path, &content)? {
            atomic_write(&path, &content)?;
            written.push(relative_path.to_string());
        }
    }
    Ok(written)
}

fn should_write_studio_hook_file(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(true);
    }
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    Ok(content.contains("Studio Context Native Hook")
        || content.contains("Studio native hook")
        || content.contains("studio-implement")
        || content.contains(".studio/runtime/context.md"))
}

fn render_codex_hooks_json() -> String {
    r#"{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 .codex/hooks/session-start.py",
            "timeout": 15,
            "statusMessage": "Loading Studio Context Native Hook..."
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 .codex/hooks/inject-workflow-state.py",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
"#
    .to_string()
}

fn render_claude_settings_json() -> String {
    r#"{
  "env": {
    "CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR": "1"
  },
  "hooks": {
    "SessionStart": [
      { "matcher": "startup", "hooks": [{ "type": "command", "command": "python3 .claude/hooks/session-start.py", "timeout": 10 }] },
      { "matcher": "clear", "hooks": [{ "type": "command", "command": "python3 .claude/hooks/session-start.py", "timeout": 10 }] },
      { "matcher": "compact", "hooks": [{ "type": "command", "command": "python3 .claude/hooks/session-start.py", "timeout": 10 }] }
    ],
    "PreToolUse": [
      { "matcher": "Task", "hooks": [{ "type": "command", "command": "python3 .claude/hooks/inject-subagent-context.py", "timeout": 30 }] },
      { "matcher": "Agent", "hooks": [{ "type": "command", "command": "python3 .claude/hooks/inject-subagent-context.py", "timeout": 30 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "python3 .claude/hooks/inject-workflow-state.py", "timeout": 5 }] }
    ]
  },
  "enabledPlugins": {}
}
"#
    .to_string()
}

fn render_gemini_settings_json() -> String {
    r#"{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "python3 .gemini/hooks/session-start.py", "timeout": 10 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "python3 .gemini/hooks/inject-workflow-state.py", "timeout": 5 }] }
    ],
    "PreToolUse": [
      { "matcher": "Task", "hooks": [{ "type": "command", "command": "python3 .gemini/hooks/inject-subagent-context.py", "timeout": 30 }] }
    ]
  }
}
"#
    .to_string()
}

fn render_codex_agent(name: &str, description: &str) -> String {
    format!(
        "# Studio Context Native Hook agent\nname = \"{name}\"\ndescription = \"{description}\"\n\ninstructions = \"\"\"\nUse `.studio/workflow.md` as the state machine. Read `.studio/runtime/context.md` first, then the active task files and JSONL manifests referenced there. Keep context small and prefer file references. Durable `.studio/spec` and `.studio/workspace` updates require provenance, confidence, conflict checks, and policy-check approval.\n\"\"\"\n"
    )
}

fn render_markdown_agent(name: &str, title: &str, body: &str) -> String {
    format!(
        "---\nname: {name}\ndescription: {title}. Studio Context Native Hook agent.\n---\n\n# {title}\n\n{body}\n\nFollow `.studio/workflow.md`. Load `.studio/runtime/context.md` first, then the manifest files referenced by the active task. Keep prompt context small and write durable memory only through policy-check gates.\n"
    )
}

fn render_session_start_hook(platform: &str) -> String {
    render_python_hook(platform, "session")
}

fn render_prompt_submit_hook(platform: &str) -> String {
    render_python_hook(platform, "prompt")
}

fn render_subagent_context_hook(platform: &str) -> String {
    render_python_hook(platform, "subagent")
}

fn render_python_hook(platform: &str, mode: &str) -> String {
    PYTHON_NATIVE_HOOK
        .replace("__STUDIO_PLATFORM__", platform)
        .replace("__STUDIO_MODE__", mode)
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
        "{STUDIO_MANAGED_MARKER}\n# Studio Context Adapter for {cli_name}\n\nThis project uses Multi CLI Studio Autonomous Workflow.\n\n## Startup Rules\n\n- First read `.studio/runtime/context.md` when it exists.\n- Then read the active task file listed there.\n- Load JSONL manifest entries only when the current task needs them.\n- Treat `.studio/workflow.md` as the task state machine and agent contract.\n- Treat `.studio/spec/` as durable project rules.\n- Treat `.studio/workspace/` as durable project memory and journals.\n- Treat `.studio/runtime/` as generated runtime state that may be overwritten.\n- Context/spec curation is automatic; use `context-selection-report.md`, `implement.jsonl`, and `check.jsonl` before broad history recall.\n- Durable spec/workspace writes are allowed only through the workflow's provenance, confidence, conflict, and policy-check gates.\n- Keep prompt context small; prefer file references over pasting long history.\n"
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
