<!-- STUDIO-WORKFLOW:MANAGED -->
# Studio Workspace Index

This directory stores durable project memory and journals that should survive chat compaction.

## Layers

- `.studio/workspace/memory/` stores durable project facts, codebase knowledge, decisions, and risks.
- `.studio/workspace/journal/` stores dated failures, checkpoints, and progress notes.

## Policy

- Workspace memory is written by the Studio workflow, not pasted from ad hoc chat history.
- Promote only durable lessons here; transient request state belongs in `.studio/runtime/active-context/`.
