<!-- STUDIO-WORKFLOW:MANAGED -->
# Windows Runtime Spec

Scope: PowerShell, cmd.exe, UTF-8 output, path quoting, hidden process windows, and constrained-language compatibility.

## Context Selection

Context-curator should select this file when the current task touches this scope. Do not select it for unrelated turns.

## Rules

- Do not unconditionally set .NET static properties such as `[Console]::OutputEncoding` in PowerShell wrappers.
- Prefer environment-level UTF-8 controls for Python and CLI subprocesses.
- Windows child processes launched by Studio should avoid visible console windows unless the user asks for one.
- Normalize shell bootstrap errors before they become task titles, PRDs, context reports, or memory candidates.
