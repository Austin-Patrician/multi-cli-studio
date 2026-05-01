<!-- STUDIO-WORKFLOW:MANAGED -->
# Storage Spec

Scope: SQLite context kernel, terminal state, facts, evidence, migrations, and semantic recall.

## Context Selection

Context-curator should select this file when the current request touches this scope. Do not select it for unrelated turns.

## Rules

- The user-selected CLI handles one request at a time; no task split/rebind lifecycle is exposed.
- Terminal tabs are interaction surfaces that contribute to the single active context.
- Schema migrations must preserve existing local user state.
- Durable memory promotion requires evidence, confidence, and policy approval.
