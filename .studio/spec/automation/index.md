<!-- STUDIO-WORKFLOW:MANAGED -->
# Automation Spec

Scope: Automation goals, workflow runs, validation gates, owner routing, retry behavior, and event logs.

## Context Selection

Context-curator should select this file when the current request touches this scope. Do not select it for unrelated turns.

## Rules

- Automation should route by capability and record why a CLI was selected.
- Checker and validator failures should produce actionable evidence, not silent loops.
- Retries are bounded and focused; repeated failures remain visible in workflow state.
- Automation outputs should feed the same active-context manifest and memory pipeline as manual turns.
