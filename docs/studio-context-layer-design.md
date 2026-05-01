# Multi CLI Studio Shared Context Design

## 1. Decision

Multi CLI Studio uses a shared-context model, not a task-management model.

Each user request is executed by exactly one selected CLI. Codex, Claude, and Gemini do not concurrently own different pieces of work inside one conversation. The product goal is continuity: whichever CLI is selected should see the same project rules, durable memory, and current runtime context.

The implementation therefore uses a three-layer architecture:

1. **Spec**: durable project rules under `.studio/spec/`.
2. **Memory**: durable project memory and journals under `.studio/workspace/`.
3. **Active Context**: generated per-turn runtime state under `.studio/runtime/active-context/`.

Old task lifecycle concepts such as “new task”, “split/rebind”, and “archive old task” are intentionally not part of the user-facing model.

## 2. Goals

- Let the selected CLI continue from a shared project context without asking the user to paste prior CLI history.
- Keep durable project rules separate from transient runtime state.
- Keep durable memory gated by provenance, confidence, conflict checks, and policy-check approval.
- Keep prompt context small by passing file references instead of raw chat history.
- Make context state inspectable in the UI without exposing task management concepts.

## 3. Non-Goals

- Do not introduce first-class user-facing tasks.
- Do not create or archive work units based on prompts like “new task”.
- Do not support concurrent multi-CLI ownership inside one request.
- Do not preserve compatibility with the old task-first runtime protocol.

## 4. Directory Contract

```text
.studio/
  workflow.md
  spec/
    index.md
    frontend/
    tauri-runtime/
    cli-adapters/
    storage/
    automation/
    windows-runtime/
  workspace/
    index.md
    memory/
    journal/
  runtime/
    context.md
    sessions/
      <context-key>.json
    active-context/
      context.json
      current.md
      prd.md
      manifest.jsonl
      check.jsonl
      context-selection-report.md
      checker-report.md
      checker-retry-report.md
      memory-candidates.jsonl
      memory-distill-report.md
      policy-check.json
      promotion-report.md
      research/
        <timestamp>-<topic>.md
```

## 5. Layer Semantics

### 5.1 Spec

`.studio/spec/` contains durable rules for the project. These files should be stable, narrow, and reusable across future requests.

Examples:

- frontend UI conventions
- Rust/Tauri runtime rules
- CLI adapter behavior
- storage/migration rules
- platform-specific pitfalls

Spec updates require policy-check approval before automatic writes.

### 5.2 Memory

`.studio/workspace/` contains durable project memory that is useful beyond the current turn.

Examples:

- decisions worth preserving
- recurring implementation constraints
- known failures and their fixes
- project-level journals

Generic runtime facts, command successes, and one-off file-change notes should not be promoted automatically.

### 5.3 Active Context

`.studio/runtime/active-context/` is generated runtime state for the current request and selected CLI. It may be overwritten on future turns.

Key files:

- `current.md`: human-readable current context snapshot
- `context.json`: machine-readable active state
- `prd.md`: current request goal and acceptance criteria
- `manifest.jsonl`: curated files for implementation context
- `check.jsonl`: curated files for verification context
- `context-selection-report.md`: why context was selected or why fallback was used

## 6. Runtime Flow

1. User sends a prompt and chooses one CLI.
2. Studio refreshes `.studio/runtime/context.md` and `.studio/runtime/active-context/`.
3. Studio curates relevant spec/research references into `manifest.jsonl` and `check.jsonl`.
4. The selected CLI receives a compact prelude with file references.
5. Checker and memory-distill gates may write reports and candidates under `active-context/`.
6. Policy-check may promote durable knowledge into `.studio/spec/` or `.studio/workspace/`.

## 7. CLI Switching

Switching from Codex to Claude or Gemini does not create a new work unit. It only changes which CLI consumes the same active context.

Session bindings under `.studio/runtime/sessions/` are adapter pointers so native hooks can find the shared active context. They are not task bindings.

## 8. UI Model

The right-side panel should present this as “Context”, not “Task”.

Recommended labels:

- 当前上下文
- 项目规则
- 项目记忆
- 上下文清单
- 检查报告
- 记忆候选
- 写入项目记忆

Avoid labels such as:

- 新任务
- 归档任务
- task split
- task rebind
- task lifecycle

## 9. Current Implementation Notes

- Backend context export writes primary runtime files to `.studio/runtime/active-context/`.
- `load_studio_workflow_state` returns `contextId` and `contextPath` for the UI.
- Manual archive APIs and UI controls for Studio tasks are removed.
- Manual promotion supports `spec`, `memory`, and `journal`; memory writes go to `.studio/workspace/memory/`.
- Prompt text like “新任务 / 另起任务 / /task new” is treated as ordinary user intent and does not create a new task container.

## 10. Migration Policy

No compatibility layer is required for the old task-first protocol. Old generated task artifacts are legacy state and should not drive the new context flow.
