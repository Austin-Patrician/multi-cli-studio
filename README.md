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

## macOS notes

- `npm run tauri:dev` now uses a cross-platform launcher. On macOS it runs the local Tauri CLI directly instead of the Windows PowerShell wrapper.
- The desktop host uses the native macOS shell path and supports folder selection through `osascript`.
- You still need the normal macOS native prerequisites for Tauri: Xcode Command Line Tools and a recent Rust toolchain.

## Rust toolchain requirement

The current Tauri dependency graph requires a newer Rust toolchain than the one that shipped on this machine. This repo now pins `rust-toolchain.toml` to Rust `1.88.0`.

If your local toolchain is older, run:

```bash
rustup toolchain install 1.88.0
rustup default 1.88.0
```

## Validation performed

- `npm install`
- `npm run build`
- browser runtime interaction checks for:
  - writer takeover
  - review requests
  - artifact creation
  - activity updates
