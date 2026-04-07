# Multi CLI Studio

Desktop orchestration shell for Codex CLI, Claude Code, and Gemini CLI, designed around one dominant terminal surface with a secondary collaboration rail.

## Project Overview

**Multi CLI Studio** is a desktop application that provides a unified terminal interface for orchestrating multiple AI CLI agents. It enables users to:

- Manage multiple workspaces with concurrent AI agent sessions
- Orchestrate Codex, Claude, and Gemini CLI agents
- Stream CLI output in real-time through Tauri events
- Schedule and run automation jobs with cron-based triggers
- Persist conversation sessions and context across restarts

## Tech Stack

### Frontend
- **Framework**: React 19
- **Build Tool**: Vite 7
- **Language**: TypeScript
- **Routing**: React Router DOM 7
- **State Management**: Zustand 5
- **Styling**: Tailwind CSS 4
- **Charts**: ECharts
- **Markdown**: react-markdown with GFM support

### Backend (src-tauri)
- **Language**: Rust
- **Framework**: Tauri 2 (desktop app framework)
- **Database**: SQLite (rusqlite with bundled SQLite)
- **Key Dependencies**:
  - `tauri` v2 - Desktop application framework
  - `rusqlite` - SQLite database bindings
  - `serde` / `serde_json` - Serialization
  - `chrono` - Date/time handling
  - `uuid` - UUID generation
  - `reqwest` - HTTP client
  - `lettre` - Email sending
  - `cron` - Cron expression parsing for scheduling

## Core Modules

### Frontend Pages (`src/pages`)
| Page | Description |
|------|-------------|
| `TerminalPage` | Main terminal interface with agent tabs and output |
| `DashboardPage` | Overview with recent activity and quick actions |
| `AutomationPage` | Automation job management and monitoring |
| `AutomationJobsPage` | List of automation job definitions |
| `AutomationJobEditorPage` | Create/edit automation job configurations |
| `AutomationRunDetailSections` | Detailed view of automation run results |
| `SettingsPage` | Application settings and preferences |

### Frontend Components (`src/components`)
- **Chat**: `ChatConversation`, `ChatPromptBar`, `CliSelector`, `CliBubble`, `PromptOverlay`, `ProjectBar`, `GitPanel`, `ConversationHistory`
- **Terminal**: `TerminalOutput`, `TerminalTabStrip`, `AgentTabs`
- **Layout**: `Sidebar`, `AgentStatusCard`, `ProjectSummary`, `RecentActivity`, `QuickActions`

### Backend Modules (`src-tauri/src`)
| Module | Description |
|--------|-------------|
| `automation.rs` | Automation jobs, runs, goals, and cron scheduling |
| `storage.rs` | SQLite-backed persistent storage for sessions and context |
| `acp.rs` | Agent Communication Protocol for inter-agent handoffs |
| `main.rs` | Tauri command handlers and application entry point |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────────────┐ │
│  │  Sidebar    │  │  Terminal   │  │  Settings / Jobs UI   │ │
│  └─────────────┘  └─────────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │ Tauri IPC
┌─────────────────────────────────────────────────────────────┐
│                     Backend (Rust/Tauri)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │  Commands   │  │ Automation │  │  Storage (SQLite)   │   │
│  │  Handlers   │  │   Engine    │  │                     │   │
│  └─────────────┘  └─────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Key Features

1. **Multi-Agent Orchestration**: Seamlessly switch between Codex, Claude, and Gemini agents
2. **Persistent Sessions**: Conversation history and context survive app restarts
3. **Automation Jobs**: Create scheduled jobs with custom goals and parameters
4. **Context Management**: Automatic context compaction for long conversations
5. **CLI Detection**: Automatically detects installed CLI wrappers
6. **Real-time Streaming**: CLI output streamed to frontend via Tauri events
7. **Workspace Management**: Track git status, dirty files, and failing checks

## Commands

```bash
# Install dependencies
npm install

# Frontend development (browser runtime)
npm run dev

# Full Tauri development
npm run tauri:dev

# Production build
npm run build
npm run tauri:build
```

## macOS notes

- `npm run tauri:dev` now uses a cross-platform launcher. On macOS it runs the local Tauri CLI directly instead of the Windows PowerShell wrapper.
- The desktop host uses the native macOS shell path and supports folder selection through `osascript`.
- You still need the normal macOS native prerequisites for Tauri: Xcode Command Line Tools and a recent Rust toolchain.

## Build Requirements

- Rust 1.88+
- Node.js (for frontend build)
- Microsoft C++ Build Tools (for MSVC target on Windows)
- Tauri CLI v2

## Rust toolchain requirement

The current Tauri dependency graph requires a newer Rust toolchain than the one that shipped on this machine. This repo now pins `rust-toolchain.toml` to Rust `1.88.0`.

If your local toolchain is older, run:

```bash
rustup toolchain install 1.88.0
rustup default 1.88.0
```

## Data Storage

Application data is stored in the platform-specific app data directory:
- **Windows**: `%LOCALAPPDATA%\multi-cli-studio`
- **Linux**: `~/.local/share/multi-cli-studio`
- **macOS**: `~/Library/Application Support/multi-cli-studio`

Key storage files:
- `automation-jobs.json` - Job definitions
- `automation-runs.json` - Run history
- `automation-rules.json` - Rule profiles
- `terminal-state.db` - SQLite database for sessions and context

## Validation performed

- `npm install`
- `npm run build`
- browser runtime interaction checks for:
  - writer takeover
  - review requests
  - artifact creation
  - activity updates
