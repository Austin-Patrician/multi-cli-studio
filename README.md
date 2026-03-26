# Multi CLI Studio

Desktop orchestration shell for Codex CLI, Claude Code, and Gemini CLI, designed around one dominant terminal surface with a secondary collaboration rail.

## What is implemented

- `React + TypeScript + Vite` workbench with a restrained terminal-first UI
- `Tauri-ready` project structure with Rust command host under [`src-tauri`](./src-tauri)
- shared app-session model covering:
  - active agent
  - writer lock ownership
  - handoff packets
  - artifact stream
  - activity timeline
  - per-agent terminal output buffers
- browser fallback runtime for fast UI development and interaction testing
- Tauri bridge that swaps browser simulation for real desktop commands at runtime
- Rust host commands for:
  - loading and persisting app state
  - switching active agent
  - taking over writer lock
  - capturing workspace snapshots
  - running checks
  - dispatching headless prompts to Codex, Claude, and Gemini
  - dispatching review requests to side agents
- background process streaming from the Rust host back into the frontend event layer

## Commands

```bash
npm install
npm run build
npm run tauri:dev
npm run tauri:build
```

## Current Windows blocker

The project now has a real Tauri host, but this machine still lacks the Microsoft C++ linker toolchain required by the `x86_64-pc-windows-msvc` Rust target.

You need Visual Studio Build Tools with the C++ workload before the native Tauri app can compile successfully.

## Validation performed

- `npm install`
- `npm run build`
- browser runtime interaction checks for:
  - writer takeover
  - review requests
  - artifact creation
  - activity updates
