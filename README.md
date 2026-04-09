# Multi CLI Studio

Desktop orchestration shell for Codex CLI, Claude Code, and Gemini CLI, with one primary terminal surface and a secondary collaboration rail.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Scripts](#scripts)
- [Platform Notes](#platform-notes)
- [Data Storage](#data-storage)
- [Roadmap Ideas](#roadmap-ideas)
- [Contributing](#contributing)
- [License](#license)
- [Star History](#star-history)

## Overview

**Multi CLI Studio** is a Tauri desktop app that unifies multiple AI coding CLIs into one workspace.  
It focuses on:

- Multi-agent orchestration (Codex / Claude / Gemini)
- Persistent session state and context
- Automation workflows and scheduled jobs
- Real-time streaming output from backend to UI

## Features

- **Unified terminal experience** for multiple agent sessions
- **Workspace-aware flow** with project and activity context
- **Automation center** for jobs/workflows and execution tracking
- **Persistent storage** through SQLite and JSON-backed runtime data
- **Cross-platform launcher support** for local development

## Tech Stack

### Frontend (`src`)

- React 19
- TypeScript
- Vite 7
- React Router DOM 7
- Zustand
- Tailwind CSS 4
- Monaco Editor
- ECharts
- react-markdown + remark-gfm

### Backend (`src-tauri`)

- Rust (edition 2021, `rust-version = 1.88`)
- Tauri 2
- rusqlite (bundled SQLite)
- serde / serde_json
- chrono / uuid
- reqwest / lettre
- cron

## Project Structure

```text
multi-cli-studio/
├─ src/                        # React frontend
│  ├─ components/              # Reusable UI modules
│  │  ├─ chat/                 # Chat-specific components
│  │  ├─ Sidebar.tsx
│  │  ├─ TerminalOutput.tsx
│  │  └─ ...
│  ├─ pages/                   # Route-level pages
│  │  ├─ TerminalPage.tsx
│  │  ├─ DashboardPage.tsx
│  │  ├─ Automation*.tsx
│  │  └─ SettingsPage.tsx
│  ├─ layouts/
│  ├─ lib/
│  └─ styles/
├─ src-tauri/                  # Rust + Tauri backend
│  ├─ src/
│  │  ├─ main.rs
│  │  ├─ automation.rs
│  │  ├─ storage.rs
│  │  └─ acp.rs
│  ├─ tauri.conf.json
│  └─ Cargo.toml
├─ scripts/
│  ├─ run-tauri.mjs
│  └─ run-tauri.ps1
├─ dist/                       # Frontend build output
└─ package.json
```

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
- Rust 1.88.0+
- Tauri CLI v2
- Windows users: Microsoft C++ Build Tools (MSVC toolchain)
- macOS users: Xcode Command Line Tools

### Install

```bash
npm install
```

### Run (frontend only)

```bash
npm run dev
```

### Run (desktop app)

```bash
npm run tauri:dev
```

### Build

```bash
npm run build
npm run tauri:build
```

## Scripts

From `package.json`:

- `npm run dev` - Start Vite dev server
- `npm run build` - Type-check + production frontend build
- `npm run preview` - Preview built frontend
- `npm run tauri:dev` - Start Tauri desktop development mode
- `npm run tauri:build` - Build desktop bundle
- `npm run tauri:android` - Android target flow via script wrapper

## Platform Notes

- This repo includes cross-platform Tauri launch scripts in `scripts/`.
- On macOS, the launcher uses native shell behavior and supports `osascript`-based folder selection.
- Rust toolchain is pinned via `rust-toolchain.toml` to ensure compatibility.

If needed:

```bash
rustup toolchain install 1.88.0
rustup default 1.88.0
```

## Data Storage

Application data is stored in platform app-data directories:

- Windows: `%LOCALAPPDATA%\multi-cli-studio`
- Linux: `~/.local/share/multi-cli-studio`
- macOS: `~/Library/Application Support/multi-cli-studio`

Common files:

- `automation-jobs.json` - Automation job definitions
- `automation-runs.json` - Automation run history
- `automation-rules.json` - Rule profiles
- `terminal-state.db` - SQLite persistence for sessions/context

## Roadmap Ideas

- Plugin-like integration model for additional CLIs
- Enhanced run analytics and dashboard visualizations
- Better workflow templates and sharing
- More granular context-control strategies

## Contributing

Contributions are welcome.  
Recommended workflow:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Open a Pull Request with clear change notes

Please ensure your branch builds locally before submitting.

## License

This project is licensed under the **MIT License**.  
See [`LICENSE`](./LICENSE) for full text.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Austin-Patrician/multi-cli-studio&type=Date)](https://star-history.com/#Austin-Patrician/multi-cli-studio&Date)
