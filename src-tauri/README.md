# Multi CLI Studio - Tauri Backend

Native desktop host for Multi CLI Studio - a desktop orchestration shell for managing multiple AI CLI agents (Codex, Claude, Gemini) in a unified interface.

## Project Overview

**Multi CLI Studio** is a desktop application that provides a unified terminal interface for orchestrating multiple AI CLI agents. It enables users to:

- Manage multiple workspaces with concurrent AI agent sessions
- Orchestrate Codex, Claude, and Gemini CLI agents
- Stream CLI output in real-time through Tauri events
- Schedule and run automation jobs with cron-based triggers
- Persist conversation sessions and context across restarts

## Tech Stack

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

### Frontend (src)
- **Framework**: React 19
- **Build Tool**: Vite 7
- **Routing**: React Router DOM 7
- **State Management**: Zustand 5
- **Styling**: Tailwind CSS 4
- **Charts**: ECharts
- **Markdown**: react-markdown with GFM support

## Core Modules

### 1. Automation (`src/automation.rs`)
Manages automation jobs and runs:
- `AutomationJob` / `AutomationJobDraft` - Job definitions with goals, parameters, and schedules
- `AutomationRun` - Execution instances of automation jobs
- `AutomationGoal` - Individual goals within a run
- `AutomationRuleProfile` / `AutomationGoalRuleConfig` - Safety and permission rules
- Cron-based scheduling support

### 2. Storage (`src/storage.rs`)
Handles persistent state management:
- `TerminalStorage` - SQLite-backed storage engine
- Workspace persistence (`PersistedWorkspaceRef`)
- Terminal tab state (`PersistedTerminalTab`)
- Chat session history (`PersistedConversationSession`)
- Task packets and context snapshots for agent handoffs
- Context compaction for long-running conversations

### 3. ACP (`src/acp.rs`)
Agent Communication Protocol - handles inter-agent communication and handoffs

### 4. Main Application (`src/main.rs`)
Tauri command handlers and application entry point

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

## Build Requirements

- Rust 1.88+
- Node.js (for frontend build)
- Microsoft C++ Build Tools (for MSVC target on Windows)
- Tauri CLI v2

## Development

```bash
# Frontend only
npm run dev

# Full Tauri development
npm run tauri:dev

# Production build
npm run tauri:build
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
