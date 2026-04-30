<!-- STUDIO-WORKFLOW:MANAGED -->
# Studio Autonomous Workflow

This project uses a Studio-native, Trellis-class workflow. Studio owns task state, context curation, runtime projection, and CLI routing across Codex, Claude, and Gemini.

## Phases

1. `planning` - maintain `.studio/tasks/<task-id>/prd.md` and task intent.
2. `context_curated` - run `context-curator`; write `implement.jsonl`, `check.jsonl`, and `context-selection-report.md`.
3. `implementing` - dispatch the best CLI with the implement manifest.
4. `checking` - dispatch checker with the check manifest and acceptance criteria.
5. `memory_distilled` - run memory distill over facts, evidence, diffs, failures, and decisions.
6. `completed` - runtime projection is stable; archive or continue from the durable task.

## Automatic Context Contract

- Context/spec curation is automatic and agent-owned; no manual approval is required.
- The main Studio turn does not inline research, raw working memory, or long history. Research belongs in `.studio/tasks/<task-id>/research/`.
- `implement.jsonl` and `check.jsonl` are projections, not the source of truth. The durable task, evidence graph, research files, and spec files are canonical.
- Heuristic spec selection is fallback only when no curated entries exist.

## Machine Gates

- `context_curated`: manifests contain managed entries or an explicit fallback reason.
- `checking`: checker consumes `check.jsonl` and records failures before retry.
- `memory_distilled`: long-term updates include provenance, confidence, supersedes, and a policy decision.
- Runtime traces, command successes, and generic file-update facts must not auto-promote into durable workspace memory.
- Durable `.studio/spec/` updates are automatic only when policy-check permits them; otherwise they remain candidates.

## CLI Policy

- Codex, Claude, and Gemini follow the same task state machine.
- CLI-specific prompts may differ, but they must read the same durable task and generated manifests.
- Prefer file references over prompt stuffing.
