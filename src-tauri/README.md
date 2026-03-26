# src-tauri

Native desktop host for Multi CLI Studio.

## Responsibilities

- own the persisted app session
- detect installed Codex, Claude, and Gemini CLI wrappers
- manage writer lock and active-agent state
- spawn background CLI jobs
- stream CLI output into the frontend through Tauri events
- keep workspace metadata current

## Current limitation

This host is implemented, but native compilation on this machine still requires Microsoft C++ build tools (`link.exe`) for the MSVC Rust target.
