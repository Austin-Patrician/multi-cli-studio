<!-- STUDIO-WORKFLOW:MANAGED -->
# Storage Spec

Scope: SQLite task kernel, terminal state, task-tab bindings, facts, evidence, migrations, and semantic recall.

## Context Selection

Context-curator should select this file when the current task touches this scope. Do not select it for unrelated turns.

## Rules

- Task identity is independent from terminal tab identity.
- Terminal tabs are interaction surfaces bound to tasks through explicit binding records.
- Schema migrations must preserve existing local user state.
- Durable memory promotion requires evidence, confidence, and policy approval.
