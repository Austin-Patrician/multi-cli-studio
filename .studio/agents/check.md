<!-- STUDIO-WORKFLOW:MANAGED -->
# check

Role: verify implementation against `.studio/tasks/<task-id>/check.jsonl`, PRD, and changed files.

Rules:
- Prefer concrete failures over speculative warnings.
- Record failed commands and missing acceptance criteria.
- Send defects back to implementing or planning when needed.
