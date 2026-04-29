<!-- STUDIO-WORKFLOW:MANAGED -->
# Studio Spec Index

This directory stores durable project rules used by the Studio Autonomous Workflow.

## Policy

- Spec updates are automatic only after `memory-distill` and `policy-check` accept provenance, confidence, conflict, and supersedes requirements.
- Context manifests may reference this index as a discovery entry.
- Keep concrete implementation contracts in topic-specific Markdown files under `.studio/spec/`.
