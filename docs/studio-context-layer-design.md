# Studio Autonomous Workflow Engine

## Background

Multi CLI Studio should not stop at a lightweight context export layer. Trellis has proven that production AI coding workflows need durable task files, agent-curated context, research artifacts, implementation/check separation, and finish-time knowledge capture. Studio has a stronger position than Trellis in one area: it owns the UI, session state, prompt assembly, and Codex/Claude/Gemini runners. Therefore Studio should borrow Trellis' workflow contract while implementing it as a Studio-native autonomous runtime.

## Product Goal

- Keep Codex, Claude, and Gemini on one task-centric workflow.
- Make context/spec curation automatic and agent-owned, not manually approved.
- Persist research, manifests, memory candidates, and policy decisions as files.
- Treat runtime prompts as projections of durable task state, not as the source of truth.
- Keep SQLite as runtime index, evidence graph, UI state, and fallback search.
- Avoid returning to large prompt handoff packages.

## File Structure

```text
.studio/
  workflow.md                         # managed workflow state machine and agent contract
  agents/                             # managed built-in Studio agent contracts
    context-curator.md
    research.md
    implement.md
    check.md
    memory-distill.md
    policy-check.md
  spec/                               # durable project rules and conventions
    index.md
  tasks/                              # durable task source of truth
    <task-id>/
      task.json
      prd.md
      research/
        <topic>.md
      implement.jsonl
      check.jsonl
      context-selection-report.md
      memory-candidates.jsonl
      memory-distill-report.md
      policy-check.json
  workspace/                          # durable journals and session traces
    index.md
  runtime/                            # generated, ignored by git
    context.md
    tasks/<task-id>/
      task.md
      implement.jsonl
      check.jsonl
    sessions/<context-key>.json
```

## Workflow State Machine

Studio uses a Trellis-class phase model, but Studio owns execution.

1. `planning`: maintain `prd.md`, task metadata, and current goal.
2. `context_curated`: run `context-curator`; write manifests and selection report.
3. `implementing`: dispatch the best CLI with `implement.jsonl` and PRD.
4. `checking`: dispatch checker with `check.jsonl`, acceptance criteria, and changed files.
5. `memory_distilled`: run memory distill over facts, evidence, failures, diffs, and decisions.
6. `completed`: runtime projection is stable; task can continue, archive, or become workspace journal.

## Built-In Agents

- `context-curator`: reads PRD, spec index, research files, runtime hints, and changed-file hints; writes `implement.jsonl`, `check.jsonl`, and `context-selection-report.md`.
- `research`: writes source-backed findings to `.studio/tasks/<task-id>/research/*.md`; research must not live only in chat.
- `implement`: consumes `implement.jsonl`, PRD, and runtime context before editing.
- `check`: consumes `check.jsonl`, PRD, changed files, and command results; records concrete failures.
- `memory-distill`: converts task facts and evidence into durable knowledge candidates with provenance and confidence.
- `policy-check`: decides whether automatic durable writes are safe or should remain candidates.

## Context Curation Policy

- Context/spec curation is fully automatic.
- `implement.jsonl` and `check.jsonl` are generated projections, not canonical state.
- Source files to edit are not pre-registered in manifests; agents read source files during implementation/checking.
- Research files and spec files are valid manifest entries.
- Heuristic spec selection is fallback only when no stronger curated entries exist.
- Every selected file gets a reason and score in `context-selection-report.md`.

## Memory Policy

- Only durable candidate kinds (`decision`, `constraint`, `rule`, `failure`, `checkpoint`, `progress`) are exported as `memory-candidates.jsonl`.
- Runtime command successes and generic file-update traces are kept as runtime evidence only; they must not auto-promote.
- `memory-distill-report.md` records the distillation inputs and target contract.
- `policy-check.json` records whether automatic promotion is safe.
- Durable `.studio/spec/` writes require provenance, confidence, no direct conflict, and supersedes metadata when replacing guidance.
- If policy does not pass, knowledge remains a candidate rather than polluting long-term rules.

## Runtime Projection

Each local turn refreshes:

- `.studio/workflow.md` and `.studio/agents/*.md` if missing or managed.
- `.studio/tasks/<task-id>/task.json` and `prd.md`.
- `.studio/tasks/<task-id>/implement.jsonl` and `check.jsonl`.
- `.studio/tasks/<task-id>/context-selection-report.md`.
- `.studio/tasks/<task-id>/memory-candidates.jsonl`, `memory-distill-report.md`, and `policy-check.json` when evidence exists.
- `.studio/runtime/context.md`, runtime manifests, and session bindings.

The prompt still injects only workspace metadata, response rules, Studio prelude, and user request. Detailed context is loaded from files.

## Current Implementation

- `send_chat_message` exports Studio workflow files before dispatching Codex/Claude/Gemini.
- Studio now generates real project-local native hook assets instead of simulating hooks inside the send path:
  - Codex: `.codex/hooks.json`, `.codex/hooks/session-start.py`, `.codex/hooks/inject-workflow-state.py`, and `.codex/agents/studio-{implement,check,research}.toml`.
  - Claude Code: `.claude/settings.json`, `.claude/hooks/session-start.py`, `.claude/hooks/inject-workflow-state.py`, `.claude/hooks/inject-subagent-context.py`, and `.claude/agents/studio-{implement,check,research}.md`.
  - Gemini: `.gemini/settings.json`, `.gemini/hooks/session-start.py`, `.gemini/hooks/inject-workflow-state.py`, `.gemini/hooks/inject-subagent-context.py`, and `.gemini/agents/studio-{implement,check,research}.md`.
- `SessionStart` hooks inject workflow, active task, spec/workspace indexes, research artifacts, and manifest references.
- `UserPromptSubmit` hooks inject a lightweight workflow breadcrumb and active task file pointers before each turn.
- `PreToolUse`/sub-agent hooks inject implement/check/research manifest context for named agents, matching the Trellis separation of main session, implementation agent, check agent, and research agent.
- Context curation is host-validated during Studio file projection: only existing `.studio/spec/**/*.md` and `.studio/tasks/<task-id>/research/*.md` files are accepted.
- Research artifacts are produced by native `studio-research` agents and stored under `.studio/tasks/<task-id>/research/*.md`.
- A post-turn background `check` job writes `checker-report.md`; failed checks trigger one focused retry round without delaying the stream completion.
- `policy-check.json` can trigger background spec/task/journal promotion only for promotable candidates with provenance; runtime traces stay held.
- The right workspace panel exposes a `Workflow` tab showing task phase, manifests, reports, research artifacts, and promotion status.
- Studio Context bypasses the old `build_context_assembly` large prompt package when local file projection succeeds.
- `switch_cli_for_task` still records switch events, but `handoff_payload_json` remains empty.
- Managed adapters `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` point native CLIs back to Studio files.
- Managed `.studio/spec/index.md` and `.studio/workspace/index.md` are created when missing or still Studio-managed.
- Runtime context stores file references and task pointers, not raw working-memory dumps or failed patch bodies.
- Memory candidates are filtered before export and guarded again at promotion time.

## Next Engineering Steps

- Add deeper UI controls for approving/inspecting individual promoted memory entries.
