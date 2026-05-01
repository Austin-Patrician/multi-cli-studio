<!-- STUDIO-WORKFLOW:MANAGED -->
# CLI Adapters Spec

Scope: Codex, Claude, Gemini command adapters, hooks, permissions, transport sessions, and prompt prelude rules.

## Context Selection

Context-curator should select this file when the current request touches this scope. Do not select it for unrelated turns.

## Rules

- All CLIs must consume the same `.studio` active context, manifest, and workflow contract.
- Adapter-specific prompts may differ, but active-context paths must stay shared.
- Resolve shared state through `.studio/runtime/context.md` and `.studio/runtime/active-context/`.
- Silent workflow agents must run with planning/read-only permissions unless they are an explicit retry repair.
