# Multi CLI Studio Context And Workflow Design

## 1. Overview

Multi CLI Studio already has three strong foundations:

- A desktop control plane built with Tauri and React.
- Multi-CLI execution and session management for Codex, Claude, and Gemini.
- A SQLite-backed task kernel with facts, evidence, handoff records, compaction, and semantic recall.

What it does not yet have is a production-grade, task-driven workflow layer that makes those capabilities durable, inspectable, and predictable across CLIs and sessions.

Trellis proves the value of a project-local workflow runtime:

- task directories
- PRD-driven work
- spec injection through JSONL manifests
- session-scoped active task resolution
- research persistence
- implementation/check separation
- finish-time memory distillation

This design does not copy Trellis wholesale. Multi CLI Studio should reuse the parts that are contract-level good ideas while keeping Studio-native execution, routing, state, and UI.

The target architecture is:

- SQLite is the runtime source of truth.
- `.studio/` is the durable file contract and cross-CLI projection layer.
- The Studio app owns orchestration, routing, validation, and presentation.

## 2. Goals

- Make task state first-class and independent from terminal tabs.
- Ensure Codex, Claude, and Gemini read the same task, PRD, spec manifests, and reports.
- Replace heuristic-only context selection with validated, task-specific curation.
- Unify existing SQLite kernel memory with `.studio/` durable files.
- Support production-grade handoff, checking, retry, and memory promotion.
- Eliminate Windows shell encoding behavior that pollutes task state and prompt context.

## 3. Non-Goals

- Do not reimplement Trellis as a Python-first runtime inside Studio.
- Do not treat `.studio/` as a raw transcript archive.
- Do not force every workflow into sub-agent-only execution.
- Do not replace SQLite with Markdown files as the primary live state store.

## 4. Design Principles

- Task-centric, not tab-centric.
- File-projected, not prompt-stuffed.
- Durable facts must be validated before promotion.
- Runtime context should be minimal and layered.
- CLI routing should be explicit, inspectable, and replayable.
- Fallback behavior must be visible, not silently treated as success.

## 5. System Model

Studio should be modeled as three coordinated layers.

### 5.1 Runtime Layer

Owned by the app and backed by SQLite:

- live chat sessions
- terminal tabs
- transport sessions
- task kernel
- facts and evidence
- handoff records
- semantic recall
- compaction summaries
- CLI runtime capability detection

This layer is authoritative for live execution.

### 5.2 Durable Workflow Layer

Stored in `.studio/`:

- workflow state machine
- task directories
- PRD and design docs
- implement/check manifests
- research artifacts
- checker reports
- memory candidates
- policy-check results
- promotion reports

This layer is authoritative for cross-session and cross-CLI workflow continuity.

### 5.3 Integration Layer

Generated hook and agent assets:

- `.codex/`
- `.claude/`
- `.gemini/`
- root adapter files such as `AGENTS.md`

This layer makes each CLI consume the same workflow contract using platform-specific mechanisms.

## 6. Directory Structure

```text
.studio/
  workflow.md
  config.json
  agents/
    context-curator.md
    research.md
    implement.md
    check.md
    memory-distill.md
    policy-check.md
  spec/
    index.md
    frontend/
    tauri-runtime/
    cli-adapters/
    storage/
    automation/
    windows-runtime/
  tasks/
    <task-id>/
      task.json
      prd.md
      info.md
      implement.jsonl
      check.jsonl
      context-selection-report.md
      checker-report.md
      memory-candidates.jsonl
      memory-distill-report.md
      policy-check.json
      promotion-report.md
      handoff-log.jsonl
      research/
        <timestamp>-<topic>.md
  workspace/
    index.md
    journal/
    tasks/
  runtime/
    context.md
    sessions/
      <studio-context-id>.json
    tasks/
      <task-id>/
        task.md
        implement.jsonl
        check.jsonl
```

## 7. Identity Model

The current implementation binds task identity too closely to terminal tab identity. That is sufficient for a prototype, but it is not sufficient for production.

The correct model is:

- A `StudioTask` is the work unit.
- A terminal tab is one interaction surface bound to a task.
- A transport session is one CLI-native continuation thread within a tab.
- A `studio-context-id` identifies the task-binding visible to hooks and subprocesses.

This allows:

- multiple tabs on one task
- one tab switching CLIs without losing task identity
- multiple tasks in the same workspace
- session-safe recovery after app restart

## 8. Core Data Models

### 8.1 StudioTask

```ts
type StudioTaskStatus =
  | "planning"
  | "context_curated"
  | "implementing"
  | "checking"
  | "memory_distilled"
  | "completed";

type StudioTask = {
  id: string;
  title: string;
  status: StudioTaskStatus;
  workspaceId: string;
  branch: string;
  ownerCli: "codex" | "claude" | "gemini" | "auto";
  activeTabIds: string[];
  relevantFiles: string[];
  currentPhase: string;
  nextStep: string;
  acceptanceCriteria: string[];
  latestConclusion?: string | null;
  createdAt: string;
  updatedAt: string;
};
```

### 8.2 StudioSessionBinding

```ts
type StudioSessionBinding = {
  contextKey: string;
  taskId: string;
  terminalTabId: string;
  cliId: "codex" | "claude" | "gemini";
  workspaceId: string;
  transportThreadId?: string | null;
  updatedAt: string;
};
```

### 8.3 Curated Manifest Entry

```ts
type CuratedManifestEntry = {
  file: string;
  reason: string;
  confidence: number;
  curatedBy: "context-curator";
};
```

### 8.4 Memory Candidate

```ts
type MemoryCandidate = {
  kind: "decision" | "constraint" | "rule" | "failure" | "checkpoint" | "progress";
  content: string;
  confidence: "low" | "medium" | "high";
  provenance: string[];
  target: "spec" | "task" | "journal" | "hold";
  supersedes?: string[];
};
```

## 9. Workflow State Machine

Studio should use a fixed workflow model.

### 9.1 Planning

Purpose:

- define the task
- write or refine the PRD
- establish acceptance criteria
- identify whether research is needed

Required outputs:

- `task.json`
- `prd.md`
- optional `info.md`

### 9.2 Context Curated

Purpose:

- derive the minimal spec/research context needed for implementation and checking

Required outputs:

- `implement.jsonl`
- `check.jsonl`
- `context-selection-report.md`

### 9.3 Implementing

Purpose:

- route the task to the best CLI
- apply changes
- record resulting files, conclusions, and failures

Required outputs:

- updated task state
- relevant file set
- handoff events where applicable

### 9.4 Checking

Purpose:

- validate the latest implementation against PRD, manifests, and changed files
- distinguish actionable failures from non-issues

Required outputs:

- `checker-report.md`
- retry decision

### 9.5 Memory Distilled

Purpose:

- extract durable learnings from the task

Required outputs:

- `memory-candidates.jsonl`
- `memory-distill-report.md`
- `policy-check.json`

### 9.6 Completed

Purpose:

- finalize the durable task package
- optionally promote spec or workspace memory
- archive or continue

Required outputs:

- `promotion-report.md`

## 10. Task Lifecycle

### 10.1 Create Task

A new task is created either from explicit user intent or from UI actions.

Studio should:

- allocate a stable task id
- create the durable task directory
- write an initial `task.json`
- write an initial `prd.md`
- bind the current terminal tab to the task

### 10.2 Bind Tab To Task

When a tab becomes associated with a task, Studio must:

- create or update `runtime/sessions/<context-id>.json`
- update SQLite linkage from tab to task
- refresh runtime projection files

### 10.3 Switch CLI

Switching from one CLI to another must preserve the same task id.

Studio should record:

- from CLI
- to CLI
- reason
- latest summary
- relevant files
- next step

That event goes to both:

- SQLite handoff storage
- `.studio/tasks/<task-id>/handoff-log.jsonl`

### 10.4 Finish Or Archive

Completion must not merely close the tab. A completed task should have:

- stable PRD
- stable manifests
- checker report
- memory candidates
- promotion decision

Only then should it be marked complete or archived.

## 11. Context Architecture

Studio should assemble context in ordered layers.

### 11.1 Layer 1: Runtime Identity

- project root
- project name
- branch
- workspace id
- terminal tab id
- CLI id
- access mode
- task id

### 11.2 Layer 2: Task State

- task title
- status
- next step
- latest conclusion
- acceptance criteria
- relevant files

### 11.3 Layer 3: Curated Files

Referenced through:

- `implement.jsonl`
- `check.jsonl`
- research files

This is the primary durable context contract.

### 11.4 Layer 4: Runtime Kernel Context

Pulled from SQLite only as supporting context:

- latest handoff
- active plan
- current work item
- selected facts
- selected evidence
- selected kernel memory
- hot turns after compaction
- semantic recall

### 11.5 Layer 5: Current User Request

The current prompt must always remain last and explicit.

## 12. Context Assembly Rules

- Fresh CLI turn: inject Studio prelude plus file references.
- Resumed native CLI turn: inject only workflow breadcrumb plus active task references.
- Sub-agent turn: inject PRD, context report, and the correct manifest for that agent.
- Fallback mode: allowed only when curated context is unavailable; must be labeled as fallback.
- Prompt assembly should avoid duplicating large raw history when `.studio/` projection is available.

## 13. Context Curator Design

The current heuristic scanner is not enough for production. Studio needs a real curation pipeline.

### 13.1 Inputs

- `prd.md`
- `task.json`
- `.studio/spec/**/*.md`
- `.studio/tasks/<task-id>/research/*.md`
- latest conclusion
- next step
- relevant files
- failing checks
- route target

### 13.2 Outputs

`implement.jsonl`

```jsonl
{"_studioManaged":true,"curatedBy":"context-curator","file":".studio/spec/tauri-runtime/index.md","reason":"Rust backend workflow and command runner constraints.","confidence":0.92}
```

`check.jsonl`

```jsonl
{"_studioManaged":true,"curatedBy":"context-curator","file":".studio/spec/windows-runtime/index.md","reason":"Windows shell and encoding regression rules for verification.","confidence":0.88}
```

### 13.3 Validation Rules

- path must exist
- path must be under `.studio/spec/` or task `research/`
- no source files
- no lockfiles
- no build artifacts
- no absolute paths
- no empty manifests unless fallback reason is explicit

### 13.4 Report Requirements

`context-selection-report.md` must include:

- selection strategy
- selected implement entries
- selected check entries
- fallback usage if any
- rejected invalid entries if returned by the agent

## 14. Spec System

Production use requires real project-local specs, not only `.studio/spec/index.md`.

Recommended initial spec layers:

- `frontend/`
- `tauri-runtime/`
- `cli-adapters/`
- `storage/`
- `automation/`
- `windows-runtime/`
- `guides/`

Each layer should have:

- `index.md`
- concrete conventions
- known pitfalls
- testing expectations
- forbidden patterns

Examples:

- `windows-runtime/index.md`
  Documents PowerShell constrained language limitations and encoding rules.
- `cli-adapters/index.md`
  Documents how Codex, Claude, and Gemini hooks, agents, and session identities are resolved.
- `storage/index.md`
  Documents what belongs in SQLite kernel memory versus `.studio/` durable files.

## 15. Research System

Research should be treated as a first-class durable artifact.

Rules:

- only create when it helps implementation or checking
- every file must have sources
- findings must be concise and task-relevant
- no research should live only in chat

Naming:

- `<timestamp>-<slug>.md`

Template:

```md
# Title

Generated: <timestamp>
Agent: research
Task: <task-id>

## Sources

- source 1
- source 2

## Findings

...
```

## 16. CLI Routing

Studio should route by capability, not by hardcoded preference.

### 16.1 Capability Registry

```ts
type CliCapability = {
  cliId: "codex" | "claude" | "gemini";
  installed: boolean;
  commandPath?: string | null;
  supportsImages: boolean;
  supportsSubagents: boolean;
  supportsPlanMode: boolean;
  supportsWriteMode: boolean;
  recentFailureRate: number;
  averageLatencyMs: number;
  strengths: string[];
};
```

### 16.2 Recommended Routing Bias

- Codex: focused implementation, patches, structured tool execution
- Claude: planning, architecture review, high-context checking
- Gemini: broad analysis, alternate checker, synthesis-heavy review

### 16.3 Auto Route Contract

When Studio proposes or executes auto-routing, it must record:

- route title
- reason
- source CLI
- target CLI
- state
- files
- conclusion

This should map cleanly to:

- UI auto-route blocks
- SQLite work items
- `handoff-log.jsonl`

## 17. Handoff Design

Handoff should no longer be an implicit side effect.

Required handoff package fields:

- current task id
- source CLI
- target CLI
- latest conclusion
- relevant files
- active failures
- current phase
- next step
- manifest references

Durable file format:

```jsonl
{"timestamp":"...","fromCli":"codex","toCli":"claude","reason":"checker review","latestConclusion":"Implemented prompt assembly refactor.","files":["src-tauri/src/main.rs"],"nextStep":"Validate Windows shell behavior."}
```

## 18. Checker Design

The checker is not just a reviewer message. It is a structured workflow gate.

### 18.1 Inputs

- PRD
- `check.jsonl`
- changed files
- implementation output
- relevant command results
- task state

### 18.2 Outputs

`checker-report.md`

```md
# Checker Report

Status: fail
Needs Retry: yes

## Summary

...

## Issues

- issue 1
- issue 2
```

### 18.3 Retry Policy

- one focused retry round only
- retry prompt must include checker summary and issues
- retry must not silently loop
- if retry fails, task remains in checking with explicit failure state

## 19. Memory Distillation

Studio already has strong kernel structures. They should feed the durable memory pipeline instead of bypassing it.

### 19.1 Candidate Sources

- verified facts
- high-confidence decisions
- persistent constraints
- repeated failures
- accepted work checkpoints
- user-confirmed rules

### 19.2 Candidate Exclusions

- command success noise
- generic file update messages
- transport metadata
- transient shell errors with no lasting relevance

### 19.3 Candidate Example

```jsonl
{"kind":"rule","content":"Do not set [Console]::OutputEncoding inside PowerShell constrained language mode.","confidence":"high","provenance":["task:tab-...","checker-report.md"],"target":"spec","supersedes":[]}
```

## 20. Policy Check

Policy-check decides whether a candidate becomes durable knowledge.

Required gates:

- provenance exists
- confidence is high enough
- no direct conflict with existing rule
- supersedes relation exists if replacing prior guidance
- target category is valid

Output:

```json
{
  "_studioManaged": true,
  "agent": "policy-check",
  "allowAutoPromote": false,
  "decision": "hold",
  "reason": "...",
  "requires": ["provenance", "confidence", "no_conflict", "supersedes_when_replacing"]
}
```

## 21. Durable Promotion Targets

Three durable targets are enough:

- `spec`
- `task`
- `journal`

Rules:

- project-wide engineering rule goes to `spec`
- task-specific retrospective goes to `workspace/tasks`
- session/process record goes to `workspace/journal`

## 22. Windows And Encoding Design

This is a product issue, not just a shell annoyance.

Current failure mode:

- PowerShell child process may run in `ConstrainedLanguage`
- setting `[Console]::OutputEncoding` throws
- the exception text leaks into task title, PRD, report, and runtime context

### 22.1 Requirements

- no unconditional `.NET` property set in PowerShell wrappers
- UTF-8 output for Python hooks
- stable Git UTF-8 output
- no encoding initialization error may be persisted into task files

### 22.2 Strategy

- use `PYTHONIOENCODING=utf-8` for Python subprocesses
- use Python-side `sys.stdout.reconfigure(..., errors="replace")`
- use `git -c i18n.logOutputEncoding=UTF-8`
- if PowerShell-specific encoding tweak is needed, gate it behind language-mode detection
- sanitize task inputs before writing them to `.studio`

### 22.3 Sanitization Requirement

If the incoming user prompt or shell output contains wrapper-level bootstrap errors, Studio should not directly use that raw content as task title or PRD body.

## 23. UI Requirements

Studio should expose workflow state as a first-class UI surface.

### 23.1 Workflow Panel

Show:

- current task
- current phase
- owner CLI
- next step
- latest conclusion

### 23.2 Manifest Viewer

Show:

- implement entries
- check entries
- reason
- confidence
- curated or fallback state

### 23.3 Handoff Timeline

Show:

- from CLI
- to CLI
- reason
- files
- state
- timestamp

### 23.4 Checker Surface

Show:

- pass or fail
- retry performed or not
- outstanding issues
- link to checker report

### 23.5 Memory Surface

Show:

- candidates
- target
- confidence
- promote or hold result
- policy-check reason

## 24. Runtime Projection Rules

On each eligible turn, Studio should refresh:

- `runtime/context.md`
- `runtime/tasks/<task-id>/task.md`
- runtime manifests
- session binding file

On meaningful task transitions, Studio should refresh:

- `task.json`
- `prd.md`
- `context-selection-report.md`
- checker report
- memory candidates
- policy-check
- promotion report

Projection should be idempotent and overwrite only Studio-managed files.

## 25. File Ownership Rules

- `.studio/runtime/**` is always app-managed
- `.studio/agents/**` is managed unless explicitly customized outside Studio markers
- `.studio/spec/**` may be user-edited and should not be blindly overwritten
- `.studio/tasks/<task-id>/prd.md` is task-owned and must be preserved
- hook files under `.codex`, `.claude`, `.gemini` are managed only when identified as Studio-generated

## 26. Migration Plan

### Phase 1: Stabilize Runtime

Status: started.

- [x] Native Python hooks reconfigure stdio as UTF-8 on Windows without using PowerShell .NET property setters.
- [x] Local CLI subprocesses receive `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1`.
- [x] Studio exports a `STUDIO_CONTEXT_ID` and passes it into Codex, Claude, Gemini, shell fallback, and post-turn checker/retry jobs.
- [x] Native hooks use `.studio/runtime/sessions/<context-id>.json` before falling back to the latest runtime task.
- [x] Studio projection filters known PowerShell encoding bootstrap noise before writing task/runtime context.
- [ ] Remove or replace the external command wrapper that still attempts `[Console]::OutputEncoding=...` before Studio commands.

### Phase 2: Decouple Task From Tab

Status: completed for the backend/runtime projection layer.

- [x] Studio Context uses the real SQLite `task_packets.id` as `.studio/tasks/<task-id>` and `.studio/runtime/tasks/<task-id>`.
- [x] Chat requests accept an optional `taskId`, allowing future UI flows to bind another tab to an existing task.
- [x] SQLite has an explicit `task_tab_bindings` table so terminal tabs bind to tasks instead of defining task identity.
- [x] Existing terminal-tab task lookup now resolves through active task bindings, with legacy tab-owned task fallback.
- [x] `.studio/runtime/sessions/<context-id>.json` includes both `taskId` and active task path.
- [x] Workflow panel state resolution uses session bindings before falling back to legacy tab-derived task ids.
- [x] Durable `task.json` tracks `activeTabIds`.
- [x] Durable `prd.md` is created once and no longer rewritten from every prompt.
- [ ] Add first-class UI controls for creating/switching/binding tasks across tabs.

### Phase 3: Productionize Context

Status: completed for backend/runtime context curation.

- [x] Bootstrap managed topic spec layers under `.studio/spec/` for frontend, Tauri runtime, CLI adapters, storage, automation, and Windows runtime.
- [x] Run the selected CLI as a bounded silent `context-curator` before the main local chat turn is composed.
- [x] Apply curator output only after host-side JSON parsing, path normalization, existence checks, and `.studio/spec/**` or task research allow-list validation.
- [x] Preserve the existing heuristic manifest as fallback when curator execution fails or produces no valid selection.
- [ ] Add UI visibility for curated-vs-fallback manifest status and curator errors.

### Phase 4: Close The Check Loop

Status: completed for backend/runtime gate and the existing Workflow Panel.

- [x] Generate durable `checker-report.md` with status, retry requirement, summary, and issues.
- [x] Write checker status, summary, issues, retry flags, and report links into `.studio/tasks/<task-id>/task.json`.
- [x] Support one controlled retry round and write `checker-retry-report.md`.
- [x] Skip automatic memory promotion unless the checker completed with `pass`.
- [x] Surface checker status, retry state, outstanding issue count, and issue excerpts in the Studio Workflow Panel.
- [ ] Add live event streaming for checker progress while the post-turn job is running.

### Phase 5: Close The Memory Loop

Status: completed for backend/runtime memory gates.

- [x] Generate post-turn memory candidates after `record_turn_progress` and checker pass, so candidates use the latest task kernel state.
- [x] Sanitize `memory-candidates.jsonl` to keep only candidates with content, provenance evidence, and non-runtime durable kinds.
- [x] Run `policy-check.json` after checker pass; export-time policy remains `pending_checker` or `hold`.
- [x] Require checker `pass` in policy-check before automatic promotion can run.
- [x] Promote only candidates that satisfy durable kind, confidence, provenance, and noise filters.
- [x] Record memory distill and promotion results back into `.studio/tasks/<task-id>/task.json`.
- [ ] Add richer policy conflict detection against existing `.studio/spec/**` beyond current provenance/noise gates.

### Phase 6: Operational Visibility

- add workflow panel
- manifest viewer
- handoff timeline
- checker surface
- memory promotion surface

## 27. Acceptance Criteria

- multiple tabs can work on separate tasks without active-task collision
- a tab can switch CLI without losing task identity
- new sessions read the correct task through session binding
- `implement.jsonl` and `check.jsonl` contain only valid spec or research files
- fallback manifests are clearly marked in report and UI
- checker produces durable reports and at most one retry round
- memory promotion never auto-promotes runtime command noise
- Windows constrained PowerShell no longer injects encoding bootstrap failures into `.studio`
- completed tasks leave behind a coherent durable package

## 28. Risks

- If PRD remains auto-derived from raw prompts, durable task quality will stay low.
- If SQLite and `.studio` diverge without reconciliation rules, debugging will become harder.
- If hooks rely on latest-file fallback too often, cross-session correctness will remain fragile.
- If spec bootstrap is not done, curator quality will stay shallow even with agent execution.
- If checker is allowed to retry repeatedly, Studio can enter silent loops.

## 29. Recommended Immediate Next Steps

1. Fix Windows encoding initialization and sanitize task input persistence.
2. Introduce real task identity separate from terminal tab identity.
3. Add `STUDIO_CONTEXT_ID` propagation and session-scoped task resolution.
4. Seed project-specific `.studio/spec/` layers for runtime, storage, adapters, and Windows behavior.
5. Replace heuristic-only curation with validated curator-agent output.
6. Persist structured handoff logs and checker reports.

## 30. Summary

The correct end state is not "Trellis inside Studio." It is:

- Trellis-grade workflow discipline
- Studio-native runtime orchestration
- SQLite-backed live task intelligence
- `.studio/` as the durable contract all CLIs can read

That architecture fits Multi CLI Studio's real strengths and is the shortest path to production-grade task-driven multi-CLI development.
