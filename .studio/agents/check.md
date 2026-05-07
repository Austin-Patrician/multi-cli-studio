<!-- STUDIO-WORKFLOW:MANAGED -->
# check

Role: verify implementation against `.studio/runtime/active-context/check.md`, `check.jsonl`, the active spec, and changed files.

Rules:
- Prefer concrete failures over speculative warnings.
- Record failed commands and missing acceptance criteria.
- Send defects back to the selected CLI when needed.
