<!-- STUDIO-WORKFLOW:MANAGED -->
# Studio Spec Index

This directory stores durable project rules used by the Studio Autonomous Workflow.

## Layers

- `.studio/spec/frontend/index.md` - React UI, chat surfaces, terminal dock, and workflow panel behavior.
- `.studio/spec/tauri-runtime/index.md` - Rust commands, process orchestration, state, and app runtime rules.
- `.studio/spec/cli-adapters/index.md` - Codex, Claude, Gemini adapters, hooks, sessions, and permissions.
- `.studio/spec/storage/index.md` - SQLite task kernel, task bindings, facts, evidence, and migrations.
- `.studio/spec/automation/index.md` - automation goals, workflow runs, validation, retry, and routing.
- `.studio/spec/windows-runtime/index.md` - Windows shells, encoding, path handling, and constrained-language safety.

## Policy

- Spec updates are automatic only after `memory-distill` and `policy-check` accept provenance, confidence, conflict, and supersedes requirements.
- Context manifests may reference this index as a discovery entry.
- Context-curator should select the narrowest relevant layer index instead of injecting every spec file.
- Keep concrete implementation contracts in topic-specific Markdown files under `.studio/spec/`.
