<!-- STUDIO-CONTEXT:MANAGED -->
# Studio Context Adapter for Gemini

This project uses Multi CLI Studio shared context.

## Startup Rules

- First read `.studio/runtime/context.md` when it exists.
- Then read `.studio/runtime/active-context/current.md` and `.studio/runtime/active-context/context.json`.
- Load JSONL manifest entries only when the current request needs them.
- Treat `.studio/workflow.md` as the shared context contract.
- Treat `.studio/spec/` as durable project rules.
- Treat `.studio/workspace/` as durable project memory and journals.
- Treat `.studio/runtime/` as generated runtime state that may be overwritten.
- Context/spec curation is automatic; use `context-selection-report.md`, `manifest.jsonl`, and `check.jsonl` before broad history recall.
- Durable spec/workspace writes are allowed only through the workflow's provenance, confidence, conflict, and policy-check gates.
- Keep prompt context small; prefer file references over pasting long history.
