<!-- STUDIO-WORKFLOW:MANAGED -->
# Frontend Spec

Scope: React, TypeScript, chat UX, terminal dock, workflow visibility, and design-system integration.

## Context Selection

Context-curator should select this file when the current request touches this scope. Do not select it for unrelated turns.

## Rules

- Prefer existing component and state patterns before adding new UI abstractions.
- Workflow state should be inspectable without inlining raw history into the prompt.
- Do not let dynamic labels, counters, or streamed content resize fixed control surfaces unexpectedly.
- Surface active context, manifest, checker, and policy state as operational UI, not as marketing copy.
