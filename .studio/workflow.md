<!-- STUDIO-WORKFLOW:MANAGED -->
# Studio Context Workflow

This project uses a Studio-native shared-context workflow. Each user turn runs exactly one selected CLI, while Codex, Claude, and Gemini read and write the same project-local context contract.

## Three Layers

1. `spec` - durable project rules under `.studio/spec/`.
2. `memory` - durable project memory and journals under `.studio/workspace/`.
3. `active_context` - generated runtime state under `.studio/runtime/active-context/`.

## Active Context Files

- `.studio/runtime/context.md` is the startup pointer for every CLI.
- `.studio/runtime/active-context/current.md` is the current request snapshot.
- `.studio/runtime/active-context/context.json` is the machine-readable active state.
- `.studio/runtime/active-context/prd.md` remains a compact compatibility summary of the current request.
- `.studio/runtime/active-context/spec.md`, `plan.md`, `tasks.md`, and `check.md` are the primary runtime artifact chain for the current request.
- `.studio/runtime/active-context/manifest.jsonl` and `check.jsonl` list curated spec/research references.
- `.studio/runtime/active-context/research/` stores request-specific research notes.

## Machine Gates

- `context_curated`: manifests contain managed entries or an explicit fallback reason.
- `checking`: checker consumes `check.jsonl`, writes `checker-report.md`, and updates `check.md`.
- `memory_distilled`: long-term updates include provenance, confidence, supersedes, and a policy decision.
- Runtime traces, command successes, and generic file-update facts must not auto-promote into durable workspace memory.
- Durable `.studio/spec/` and `.studio/workspace/` updates are automatic only when policy-check permits them; otherwise they remain candidates.

## CLI Policy

- Only the user-selected CLI handles the current request.
- Switching CLI keeps the same active context instead of creating or archiving work units.
- CLI-specific prompts may differ, but they must read the same active-context files and generated manifests.
- Prefer file references over prompt stuffing.
