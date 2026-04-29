#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Studio Context Native Hook for claude.

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

PLATFORM = "claude"
MODE = "subagent"


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


def discover_active_task(root: Path) -> tuple[str | None, Path | None, Path | None]:
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
