---
name: studio-check
description: Checker agent. Studio Context Native Hook agent.
---

# Checker agent

Read `.studio/tasks/<task-id>/prd.md` and `.studio/runtime/tasks/<task-id>/check.jsonl`, then report failures before approval.

Follow `.studio/workflow.md`. Load `.studio/runtime/context.md` first, then the manifest files referenced by the active task. Keep prompt context small and write durable memory only through policy-check gates.
