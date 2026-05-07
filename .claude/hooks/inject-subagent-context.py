#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Studio Context Native Hook for claude.

Modes:
- session: emits SessionStart additional context
- prompt: emits UserPromptSubmit (Codex/Claude) or BeforeAgent (Gemini)
- subagent: emits SubagentStart for Claude; currently not registered for Gemini
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

PLATFORM = "claude"
MODE = "subagent"


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


def discover_active_context(root: Path) -> Path | None:
    context_dir = root / ".studio" / "runtime" / "active-context"
    if context_dir.is_dir():
        return context_dir
    return None


def read_json(path: Path) -> dict:
    try:
        payload = json.loads(read_text(path, "{}"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def write_json(path: Path, payload: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def resolve_context_key(root: Path, input_data: dict) -> str:
    for value in (
        os.environ.get("STUDIO_CONTEXT_KEY"),
        os.environ.get("STUDIO_CONTEXT_ID"),
        input_data.get("studioContextKey"),
        input_data.get("contextKey"),
    ):
        if isinstance(value, str) and value.strip():
            return value.strip()
    sessions_dir = root / ".studio" / "runtime" / "sessions"
    if not sessions_dir.is_dir():
        return ""
    candidates = sorted(sessions_dir.glob(f"*-{PLATFORM}.json"))
    if not candidates:
        return ""
    return candidates[-1].stem


def load_session_binding(root: Path, input_data: dict) -> dict:
    context_key = resolve_context_key(root, input_data)
    if not context_key:
        return {}
    binding = read_json(root / ".studio" / "runtime" / "sessions" / f"{context_key}.json")
    if "contextKey" not in binding:
        binding["contextKey"] = context_key
    return binding


def hook_state_path(root: Path, context_key: str) -> Path:
    return root / ".studio" / "runtime" / "hook-state" / f"{context_key}.json"


def load_hook_state(root: Path, context_key: str) -> dict:
    if not context_key:
        return {}
    return read_json(hook_state_path(root, context_key))


def store_hook_state(root: Path, context_key: str, version: str, mode: str) -> None:
    if not context_key:
        return
    state = load_hook_state(root, context_key)
    state["contextKey"] = context_key
    if version:
        state["lastPromptVersion"] = version
    if mode == "full" and version:
        state["lastFullVersion"] = version
    state["lastInjectionMode"] = mode
    write_json(hook_state_path(root, context_key), state)


def shared_context(binding: dict) -> dict:
    value = binding.get("sharedContext")
    return value if isinstance(value, dict) else {}


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


def build_session_context(root: Path, binding: dict) -> str:
    active_context = discover_active_context(root)
    shared = shared_context(binding)
    parts = [
        "<studio-context-native-hook>",
        f"Platform: {PLATFORM}",
        "Studio Context Native Hook 已注入：active context artifact chain、spec/workspace 索引和 manifest 文件引用已加载。",
        f"Shared context version: {shared.get('version') or 'unknown'}",
        "Rules:",
        "- Read `.studio/runtime/context.md` first; it is the active runtime snapshot.",
        "- Treat `.studio/workflow.md` as the context injection contract.",
        "- Treat `.studio/spec/` as durable project rules and `.studio/workspace/` as durable memory.",
        "- Use manifest file references before broad history recall; keep prompt context small.",
    ]
    for ref in (
        ".studio/runtime/context.md",
        ".studio/workflow.md",
        ".studio/runtime/active-context/current.md",
        ".studio/runtime/active-context/context.json",
        ".studio/runtime/active-context/prd.md",
        ".studio/runtime/active-context/spec.md",
        ".studio/runtime/active-context/plan.md",
        ".studio/runtime/active-context/tasks.md",
        ".studio/runtime/active-context/check.md",
        ".studio/runtime/active-context/context-selection-report.md",
        ".studio/runtime/active-context/manifest.jsonl",
        ".studio/runtime/active-context/check.jsonl",
        ".studio/spec/index.md",
        ".studio/workspace/index.md",
    ):
        if ref:
            parts.append(f"- `{ref}`")
    if active_context and active_context.is_dir():
        research = sorted((active_context / "research").glob("*.md"))[:8]
        if research:
            parts.append("Research artifacts:")
            parts.extend(f"- `{path.relative_to(root)}`" for path in research)
        implement_refs = read_jsonl_manifest(root, active_context / "manifest.jsonl")
        check_refs = read_jsonl_manifest(root, active_context / "check.jsonl")
        if implement_refs:
            parts.append("Implement manifest:")
            parts.extend(implement_refs)
        if check_refs:
            parts.append("Check manifest:")
            parts.extend(check_refs)
    parts.append("</studio-context-native-hook>")
    return "\n".join(parts)


def build_delta_context(binding: dict) -> str:
    shared = shared_context(binding)
    version = shared.get("version") or "unknown"
    changed_layers = shared.get("changedLayers")
    if not isinstance(changed_layers, list):
        changed_layers = []
    layer_text = ", ".join(
        item for item in changed_layers if isinstance(item, str) and item.strip()
    )
    parts = [
        "<studio-context-delta>",
        f"Platform: {PLATFORM}",
        f"Shared context version: {version}",
    ]
    if layer_text:
        parts.append(f"Changed layers: {layer_text}")
    hint = shared.get("versionHint")
    if isinstance(hint, str) and hint.strip():
        parts.append(hint.strip())
    else:
        parts.append(
            "Reload `.studio/runtime/context.md`, `.studio/runtime/active-context/current.md`, `.studio/runtime/active-context/spec.md`, `.studio/runtime/active-context/plan.md`, `.studio/runtime/active-context/tasks.md`, `.studio/runtime/active-context/check.md`, and the latest active-context manifests before continuing."
        )
    parts.append("</studio-context-delta>")
    return "\n".join(parts)


def build_prompt_context(root: Path, input_data: dict) -> tuple[str, str]:
    binding = load_session_binding(root, input_data)
    context_key = binding.get("contextKey")
    if not isinstance(context_key, str):
        context_key = ""
    version = shared_context(binding).get("version")
    if not isinstance(version, str):
        version = ""
    if not context_key or not version:
        return build_session_context(root, binding), "full"
    state = load_hook_state(root, context_key)
    last_prompt_version = state.get("lastPromptVersion") or state.get("lastFullVersion")
    if not isinstance(last_prompt_version, str) or not last_prompt_version.strip():
        return build_session_context(root, binding), "full"
    if last_prompt_version == version:
        return "", "none"
    return build_delta_context(binding), "delta"


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
    active_context = discover_active_context(root)
    manifest = None
    if active_context:
        if "check" in agent:
            manifest = active_context / "check.jsonl"
        elif "research" in agent:
            manifest = None
        else:
            manifest = active_context / "manifest.jsonl"
    parts = [
        "<studio-subagent-context>",
        f"Platform: {PLATFORM}",
        f"Agent: {agent or 'unknown'}",
        "Context: active-context",
        "Required files:",
    ]
    if active_context:
        parts.append("- `.studio/runtime/active-context/current.md`")
        parts.append("- `.studio/runtime/active-context/context.json`")
        parts.append("- `.studio/runtime/active-context/prd.md`")
        parts.append("- `.studio/runtime/active-context/spec.md`")
        parts.append("- `.studio/runtime/active-context/plan.md`")
        parts.append("- `.studio/runtime/active-context/tasks.md`")
        parts.append("- `.studio/runtime/active-context/check.md`")
        parts.append("- `.studio/runtime/active-context/context-selection-report.md`")
    if manifest:
        parts.append(f"- `{manifest.relative_to(root)}`")
        refs = read_jsonl_manifest(root, manifest)
        if refs:
            parts.append("Selected context:")
            parts.extend(refs)
    if active_context and "research" in agent:
        parts.append(f"Research output directory: `{(active_context / 'research').relative_to(root)}`")
    parts.append("Keep output file-referenced; do not paste large unrelated history.")
    parts.append("</studio-subagent-context>")
    return "\n".join(parts)


def emit(additional_context: str) -> int:
    if MODE == "session":
        event = "SessionStart"
    elif MODE == "prompt":
        event = "BeforeAgent" if PLATFORM == "gemini" else "UserPromptSubmit"
    elif MODE == "subagent":
        event = "SubagentStart" if PLATFORM == "claude" else "BeforeTool"
    else:
        event = MODE
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
        binding = load_session_binding(root, input_data)
        context_key = binding.get("contextKey")
        shared = shared_context(binding)
        version = shared.get("version")
        if isinstance(context_key, str) and isinstance(version, str):
            store_hook_state(root, context_key, version, "full")
        return emit(build_session_context(root, binding))
    if MODE == "subagent":
        return emit(build_subagent_context(root, input_data))
    additional_context, mode = build_prompt_context(root, input_data)
    binding = load_session_binding(root, input_data)
    context_key = binding.get("contextKey")
    shared = shared_context(binding)
    version = shared.get("version")
    if isinstance(context_key, str) and isinstance(version, str):
        store_hook_state(root, context_key, version, mode)
    return emit(additional_context)


if __name__ == "__main__":
    raise SystemExit(main())
