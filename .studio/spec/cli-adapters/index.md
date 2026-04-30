<!-- STUDIO-WORKFLOW:MANAGED -->
# CLI Adapters Spec

Scope: Codex, Claude, Gemini command adapters, hooks, permissions, transport sessions, and prompt prelude rules.

## Context Selection

Context-curator should select this file when the current task touches this scope. Do not select it for unrelated turns.

## Rules

- All CLIs must consume the same `.studio` task, manifest, and workflow contract.
- Adapter-specific prompts may differ, but task identity and manifest paths must stay shared.
- Use `STUDIO_CONTEXT_ID` to resolve session-scoped runtime context in native hooks.
- Silent workflow agents must run with planning/read-only permissions unless they are an explicit retry repair.
