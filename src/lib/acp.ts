import { AgentId } from "./models";

export type AcpCommandKind =
  | "plan" | "model" | "compact" | "clear" | "rewind"
  | "diff" | "permissions" | "cost" | "help" | "export"
  | "status" | "effort" | "fast" | "context" | "memory" | "recall";

export type CommandExecution = "local" | "flag-inject" | "git-local";

export interface AcpCommandDef {
  kind: AcpCommandKind;
  slash: string;
  label: string;
  description: string;
  argsHint?: string;
  execution: CommandExecution;
  supportedClis: AgentId[];
}

export interface AcpCommand {
  kind: AcpCommandKind;
  args: string[];
  rawInput: string;
}

export type AcpPickerCommandKind = Extract<AcpCommandKind, "model" | "permissions" | "effort">;

export type AcpOptionSource = "runtime" | "fallback" | "manual";

export interface AcpOptionDef {
  value: string;
  label: string;
  description?: string | null;
  source: AcpOptionSource;
}

export interface AcpOptionCatalog {
  supported: boolean;
  options: AcpOptionDef[];
  note?: string | null;
}

export interface AcpCliCapabilities {
  cliId: AgentId;
  model: AcpOptionCatalog;
  permissions: AcpOptionCatalog;
  effort: AcpOptionCatalog;
}

export interface AcpCommandResult {
  success: boolean;
  output: string;
  sideEffects: AcpSideEffect[];
}

export type AcpSideEffect =
  | { type: "modelChanged"; cliId: AgentId; model: string }
  | { type: "permissionChanged"; cliId: AgentId; mode: string }
  | { type: "effortChanged"; level: string }
  | { type: "planModeToggled"; active: boolean }
  | { type: "historyCleared" }
  | { type: "contextCompacted" }
  | { type: "conversationRewound"; removedTurns: number }
  | { type: "uiNotification"; message: string };

export interface AcpSession {
  model: Partial<Record<AgentId, string>>;
  permissionMode: Partial<Record<AgentId, string>>;
  effortLevel: string | null;
  planMode: boolean;
  fastMode: boolean;
}

export function defaultAcpSession(): AcpSession {
  return {
    model: {},
    permissionMode: {},
    effortLevel: null,
    planMode: false,
    fastMode: false,
  };
}

export const ACP_COMMANDS: AcpCommandDef[] = [
  {
    kind: "plan", slash: "/plan", label: "Plan Mode",
    description: "Toggle planning mode \u2014 CLI works in plan-only mode",
    execution: "local", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "model", slash: "/model", label: "Select Model",
    description: "Change the model for the active CLI",
    argsHint: "<model-name>",
    execution: "flag-inject", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "compact", slash: "/compact", label: "Compact Context",
    description: "Trim older conversation turns to free context space",
    execution: "local", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "clear", slash: "/clear", label: "Clear History",
    description: "Clear conversation history for all CLIs",
    execution: "local", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "rewind", slash: "/rewind", label: "Rewind",
    description: "Remove the last conversation turn and its output",
    execution: "local", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "diff", slash: "/diff", label: "Git Diff",
    description: "Show uncommitted changes in the project",
    execution: "git-local", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "permissions", slash: "/permissions", label: "Permissions",
    description: "Change sandbox/permission mode for the active CLI",
    argsHint: "<mode>",
    execution: "flag-inject", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "cost", slash: "/cost", label: "Usage/Cost",
    description: "Show estimated token usage across the conversation",
    execution: "local", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "help", slash: "/help", label: "Help",
    description: "Show available commands for the active CLI",
    execution: "local", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "export", slash: "/export", label: "Export",
    description: "Export conversation history as markdown",
    execution: "local", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "status", slash: "/status", label: "Status",
    description: "Show CLI version, model, and connection info",
    execution: "local", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "effort", slash: "/effort", label: "Effort Level",
    description: "Set reasoning effort for the active CLI",
    argsHint: "[low|medium|high|max]",
    execution: "flag-inject", supportedClis: ["codex", "claude"],
  },
  {
    kind: "fast", slash: "/fast", label: "Fast Mode",
    description: "Toggle fast output mode (Claude only)",
    execution: "flag-inject", supportedClis: ["claude"],
  },
  {
    kind: "context", slash: "/context", label: "Context Usage",
    description: "Show how much context window is used per CLI",
    execution: "local", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "memory", slash: "/memory", label: "Memory",
    description: "View/edit project memory (CLAUDE.md / AGENTS.md)",
    execution: "local", supportedClis: ["codex", "claude", "gemini"],
  },
  {
    kind: "recall", slash: "/recall", label: "Recall",
    description: "Search conversation history across all CLIs in this tab",
    argsHint: "<search-query>",
    execution: "local", supportedClis: ["codex", "claude", "gemini"],
  },
];

export function parseSlashCommand(input: string): AcpCommand | null {
  if (!input.startsWith("/")) return null;
  const parts = input.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase();
  if (!name) return null;
  const def = ACP_COMMANDS.find((c) => c.slash === `/${name}`);
  if (!def) return null;
  return { kind: def.kind, args: parts.slice(1), rawInput: input };
}

export function getCommandsForCli(cliId: AgentId): AcpCommandDef[] {
  return ACP_COMMANDS.filter((c) => c.supportedClis.includes(cliId));
}

export function isPickerCommandKind(kind: AcpCommandKind): kind is AcpPickerCommandKind {
  return kind === "model" || kind === "permissions" || kind === "effort";
}

export function getPickerCatalog(
  capabilities: AcpCliCapabilities | null | undefined,
  kind: AcpPickerCommandKind
): AcpOptionCatalog | null {
  if (!capabilities) return null;
  return capabilities[kind];
}

export function getCommandCategory(kind: AcpCommandKind) {
  switch (kind) {
    case "plan":
    case "model":
    case "permissions":
    case "effort":
    case "fast":
    case "status":
      return "session";
    case "diff":
    case "memory":
      return "workspace";
    default:
      return "history";
  }
}

export function getCommandCategoryLabel(category: ReturnType<typeof getCommandCategory>) {
  switch (category) {
    case "session":
      return "Session Controls";
    case "workspace":
      return "Workspace Tools";
    default:
      return "History & Context";
  }
}

export function filterCommands(filter: string, cliId: AgentId): AcpCommandDef[] {
  const q = filter.toLowerCase().replace(/^\//, "");
  return ACP_COMMANDS.filter((c) => {
    const matchesFilter = !q || c.slash.slice(1).startsWith(q) || c.label.toLowerCase().includes(q);
    return matchesFilter;
  }).map((c) => ({
    ...c,
    _supported: c.supportedClis.includes(cliId),
  })).sort((a, b) => {
    // Supported commands first
    const aSupported = a.supportedClis.includes(cliId) ? 0 : 1;
    const bSupported = b.supportedClis.includes(cliId) ? 0 : 1;
    return aSupported - bSupported;
  });
}
