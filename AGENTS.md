<!-- STUDIO-CONTEXT:MANAGED -->
# Studio Context Adapter for Codex

This project uses Multi CLI Studio Autonomous Workflow.

## Startup Rules

- First read `.studio/runtime/context.md` when it exists.
- Then read the active task file listed there.
- Load JSONL manifest entries only when the current task needs them.
- Treat `.studio/workflow.md` as the task state machine and agent contract.
- Treat `.studio/spec/` as durable project rules.
- Treat `.studio/workspace/` as durable project memory and journals.
- Treat `.studio/runtime/` as generated runtime state that may be overwritten.
- Context/spec curation is automatic; use `context-selection-report.md`, `implement.jsonl`, and `check.jsonl` before broad history recall.
- Durable spec/workspace writes are allowed only through the workflow's provenance, confidence, conflict, and policy-check gates.
- Keep prompt context small; prefer file references over pasting long history.
