# Multi CLI Studio

[简体中文](./README.zh-CN.md)

Multi CLI Studio is a Tauri desktop workspace for people who do not want to be locked into a single AI coding CLI or a single model vendor.

Instead of forcing one tool to do everything, it gives you one local desktop surface for:

- `Codex`, `Claude`, and `Gemini` CLI workflows
- provider-based model chat for `OpenAI-compatible`, `Claude`, and `Gemini`
- local automation jobs and workflows
- shared local state across terminal, chat, and automation

## Why This Exists

Most AI coding tools assume one model, one CLI, one workflow.

That is not how real work behaves:

- one CLI may be better at edits, another at planning, another at UI or long-context work
- comparing outputs across agents is often safer than trusting a single tool path
- context gets fragmented when terminal, chat, and automation live in different apps
- local project state matters, but most tools do not coordinate around it

Multi CLI Studio is built around a different assumption:

**cross-CLI orchestration is the product, not an add-on**

## Core Value

- Keep project context in one place while switching between different AI execution styles
- Use CLI-native agent workflows and provider-based chat side by side
- Turn repeated tasks into local automation instead of re-prompting from scratch
- Keep runtime state local with desktop-native storage and tooling

## Platform Support

- Windows desktop: primary packaged target with release workflow for installer output
- macOS desktop: supported through the Tauri desktop stack and local build flow

## Screenshots

### Dashboard

<img src="./docs/screenshots/index.png" alt="Dashboard" width="100%" />

### Terminal Workspace

<img src="./docs/screenshots/terminal.png" alt="Terminal Workspace" width="100%" />

### Model Chat

<img src="./docs/screenshots/chat.png" alt="Model Chat" width="100%" />

### Model Providers

<img src="./docs/screenshots/provider.png" alt="Model Providers" width="100%" />

### Automation Jobs

<img src="./docs/screenshots/automationJob_Index.png" alt="Automation Jobs" width="100%" />

### Automation Workflows

<img src="./docs/screenshots/automation_workflow.png" alt="Automation Workflows" width="100%" />

### Settings

<img src="./docs/screenshots/settings.png" alt="Settings" width="100%" />

## Current Capabilities

### Terminal and CLI Workspace

- unified desktop surface for `Codex`, `Claude`, and `Gemini`
- persistent sessions and chat-like execution history
- streaming output rendered directly into the UI
- slash commands for model, permissions, effort, plan mode, context, and session controls
- integrated git side panel to keep working-tree changes visible during execution

### Model Chat and Provider Layer

- provider-backed chat for `OpenAI-compatible`, `Claude`, and `Gemini`
- per-turn model switching inside the same conversation thread
- local provider management with editable API key, base URL, enable state, and model catalog
- useful for side-by-side comparison, quick iteration, and non-CLI model usage

### Automation and Workflow Layer

- automation jobs with execution summaries, state, and logs
- workflow editor and workflow run canvas for multi-step flows
- repeatable local orchestration for AI-assisted tasks

### Local Runtime and Persistence

- local-first storage with SQLite and JSON
- Tauri 2 desktop runtime with Rust backend and React frontend
- CLI and local resource detection in Settings
- release workflow and version sync tooling already wired into the repo

## Main Pages

### Dashboard

- workspace snapshot with project root, dirty files, checks, events, and traffic

### Terminal

- primary multi-CLI execution page
- combines conversation history, prompt bar, streaming output, slash commands, and git changes

### Model Chat

- dedicated provider-based conversation page
- keeps one thread while letting users switch model/provider selection turn by turn

### Model Providers

- manage OpenAI-compatible, Claude, and Gemini providers
- edit base URL, API key, enabled state, and refresh model lists

### Automation

- jobs, workflow lists, workflow editor, run details, and execution logs

### Settings

- inspect installed CLIs, local runtime resources, and environment-related state

## Tech Stack

### Frontend

- React 19
- TypeScript
- Vite 7
- React Router DOM 7
- Zustand
- Tailwind CSS 4
- Monaco Editor
- ECharts
- react-markdown + remark-gfm

### Backend

- Rust 1.88
- Tauri 2
- rusqlite
- serde / serde_json
- chrono / uuid
- reqwest
- lettre
- cron

## Project Structure

```text
multi-cli-studio/
├─ src/
│  ├─ components/
│  │  ├─ chat/
│  │  └─ modelProviders/
│  ├─ layouts/
│  ├─ lib/
│  └─ pages/
│     ├─ DashboardPage.tsx
│     ├─ TerminalPage.tsx
│     ├─ ModelChatPage.tsx
│     ├─ ModelProvidersPage.tsx
│     ├─ ModelProviderEditorPage.tsx
│     ├─ AutomationJobsPage.tsx
│     ├─ AutomationWorkflowsPage.tsx
│     ├─ AutomationWorkflowEditorPage.tsx
│     ├─ AutomationJobEditorPage.tsx
│     └─ SettingsPage.tsx
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs
│  │  ├─ automation.rs
│  │  ├─ storage.rs
│  │  └─ acp.rs
│  ├─ tauri.conf.json
│  └─ Cargo.toml
├─ docs/
│  └─ screenshots/
├─ scripts/
│  ├─ run-tauri.mjs
│  └─ sync-version.mjs
├─ .github/
│  └─ workflows/
│     └─ release-desktop.yml
├─ README.md
├─ README.zh-CN.md
└─ package.json
```

## Getting Started

### Prerequisites

- Node.js 20+
- Rust 1.88+
- Tauri CLI 2
- Windows: MSVC build tools
- macOS: Xcode Command Line Tools

### Install

```bash
npm install
```

### Run Frontend Only

```bash
npm run dev
```

### Run Desktop App

```bash
npm run tauri:dev
```

### Build

```bash
npm run build
npm run tauri:build
```

## Scripts

- `npm run dev`: start Vite dev server
- `npm run build`: type-check and build frontend
- `npm run preview`: preview the built frontend
- `npm run tauri:dev`: run the Tauri desktop app in development
- `npm run tauri:build`: build desktop bundles
- `npm run tauri:android`: run Android flow through the wrapper script
- `npm run version:sync -- <version>`: sync `package.json`, `Cargo.toml`, and `tauri.conf.json`
- `npm run version:check -- <version>`: verify version metadata alignment

## Provider Notes

### Gemini Base URL

Recommended:

```text
https://generativelanguage.googleapis.com
```

Also valid:

```text
https://generativelanguage.googleapis.com/v1beta
```

Do not put `models/...:streamGenerateContent` or `?key=...` into the base URL field.

## Data Storage

Application data is stored in local app-data directories:

- Windows: `%LOCALAPPDATA%\multi-cli-studio`
- Linux: `~/.local/share/multi-cli-studio`
- macOS: `~/Library/Application Support/multi-cli-studio`

Common files:

- `terminal-state.db`
- `session.json`
- `automation-jobs.json`
- `automation-runs.json`
- `automation-rules.json`

## Release

The repo already includes a desktop release workflow:

- `.github/workflows/release-desktop.yml`

It synchronizes version metadata, builds the Tauri desktop bundle, and uploads the macOS DMGs, Windows installer, and `latest.json` update feed to GitHub Releases.

The current distribution flow is intentionally low-cost:

- It does not rely on Apple Developer ID or notarization.
- macOS builds use ad-hoc signing, so first launch may require manually allowing the app in `Privacy & Security`.
- In-app updates still require a real Tauri updater keypair: put the public key in `src-tauri/tauri.conf.json` and configure the private key in GitHub Actions secrets.

Full setup and release steps:

- [docs/desktop-release.md](./docs/desktop-release.md)

## License

MIT. See [LICENSE](./LICENSE).

---

Finally，Thanks to everyone on LinuxDo for their support! Welcome to join https://linux.do/ for all kinds of technical exchanges, cutting-edge AI information, and AI experience sharing, all on Linuxdo!
