<!-- STUDIO-WORKFLOW:MANAGED -->
# Tauri Runtime Spec

Scope: Rust commands, subprocess lifecycle, app state, environment propagation, and local execution safety.

## Context Selection

Context-curator should select this file when the current task touches this scope. Do not select it for unrelated turns.

## Rules

- Keep Tauri commands responsive; long work should run in bounded background jobs or child processes.
- Propagate Studio context through explicit environment variables instead of relying on global process state.
- Child processes must have bounded timeouts and clear error logging.
- Generated runtime files are projections and may be overwritten; durable state belongs under `.studio/tasks/` or SQLite.
