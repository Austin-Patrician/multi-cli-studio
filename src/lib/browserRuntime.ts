import {
  AppState,
  AgentId,
  AgentRuntimeResources,
  AgentPromptRequest,
  TerminalEvent,
  TerminalLine,
  ContextStore,
  ConversationTurn,
  AppSettings,
  EnrichedHandoff,
  ChatPromptRequest,
  FileMentionCandidate,
  GitFileDiff,
  StreamEvent,
  GitPanelData,
  GitFileChange,
  WorkspacePickResult,
} from "./models";
import {
  AcpCommand,
  AcpCommandDef,
  AcpCommandResult,
  AcpSession,
  ACP_COMMANDS,
  defaultAcpSession,
} from "./acp";
import { createSeedState } from "./seed";

type StateListener = (state: AppState) => void;
type TerminalListener = (event: TerminalEvent) => void;
type StreamListener = (event: StreamEvent) => void;

const STORAGE_KEY = "multi-cli-studio::state";
const CONTEXT_KEY = "multi-cli-studio::context";
const SETTINGS_KEY = "multi-cli-studio::settings";

let state: AppState = loadStoredState();
let contextStore: ContextStore = loadStoredContext();
let settings: AppSettings = loadStoredSettings();
let acpSession: AcpSession = defaultAcpSession();

const stateListeners = new Set<StateListener>();
const terminalListeners = new Set<TerminalListener>();
const streamListeners = new Set<StreamListener>();

function defaultResourceGroup(supported: boolean) {
  return {
    supported,
    items: [],
    error: null,
  };
}

function fallbackResources(agentId: AgentId): AgentRuntimeResources {
  switch (agentId) {
    case "codex":
      return {
        mcp: defaultResourceGroup(true),
        plugin: defaultResourceGroup(false),
        extension: defaultResourceGroup(false),
        skill: defaultResourceGroup(true),
      };
    case "claude":
      return {
        mcp: defaultResourceGroup(true),
        plugin: defaultResourceGroup(true),
        extension: defaultResourceGroup(false),
        skill: defaultResourceGroup(true),
      };
    default:
      return {
        mcp: defaultResourceGroup(true),
        plugin: defaultResourceGroup(false),
        extension: defaultResourceGroup(true),
        skill: defaultResourceGroup(true),
      };
  }
}

function normalizeResources(
  agentId: AgentId,
  value: Partial<AgentRuntimeResources> | null | undefined,
  seed?: AgentRuntimeResources
) {
  const fallback = seed ?? fallbackResources(agentId);
  return {
    mcp: { ...fallback.mcp, ...value?.mcp, items: value?.mcp?.items ?? fallback.mcp.items },
    plugin: { ...fallback.plugin, ...value?.plugin, items: value?.plugin?.items ?? fallback.plugin.items },
    extension: {
      ...fallback.extension,
      ...value?.extension,
      items: value?.extension?.items ?? fallback.extension.items,
    },
    skill: { ...fallback.skill, ...value?.skill, items: value?.skill?.items ?? fallback.skill.items },
  };
}

function hasDetectedResources(value: AgentRuntimeResources | null | undefined) {
  if (!value) return false;
  return Object.values(value).some((group) => (group.items?.length ?? 0) > 0 || Boolean(group.error));
}

function normalizeAppState(parsed: AppState): AppState {
  const seeded = createSeedState(parsed.workspace?.projectRoot);
  const agents = (parsed.agents ?? seeded.agents).map((agent) => {
    const seededAgent = seeded.agents.find((candidate) => candidate.id === agent.id) ?? seeded.agents[0];
    const shouldUseSeedResources =
      (parsed.environment?.backend ?? "browser") === "browser" &&
      !hasDetectedResources(agent.runtime?.resources) &&
      hasDetectedResources(seededAgent.runtime.resources);
    return {
      ...seededAgent,
      ...agent,
      runtime: {
        ...seededAgent.runtime,
        ...agent.runtime,
        resources: shouldUseSeedResources
          ? seededAgent.runtime.resources
          : normalizeResources(agent.id, agent.runtime?.resources, seededAgent.runtime.resources),
      },
    };
  });

  return {
    ...seeded,
    ...parsed,
    agents,
  };
}

function loadStoredState(): AppState {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return createSeedState();
  try {
    return normalizeAppState(JSON.parse(raw) as AppState);
  } catch {
    return createSeedState();
  }
}

function loadStoredContext(): ContextStore {
  const raw = window.localStorage.getItem(CONTEXT_KEY);
  if (!raw) return createSeedContext();
  try {
    const parsed = JSON.parse(raw);
    // Migration: add conversationHistory if missing
    if (!parsed.conversationHistory) {
      parsed.conversationHistory = [];
      // Merge from per-agent if present
      if (parsed.agents) {
        const allTurns: ConversationTurn[] = [];
        for (const agent of Object.values(parsed.agents) as any[]) {
          if (agent.conversationHistory) {
            allTurns.push(...agent.conversationHistory);
          }
        }
        allTurns.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        parsed.conversationHistory = allTurns;
      }
    }
    return parsed as ContextStore;
  } catch {
    return createSeedContext();
  }
}

function loadStoredSettings(): AppSettings {
  const raw = window.localStorage.getItem(SETTINGS_KEY);
  if (!raw) return defaultSettings();
  try {
    return JSON.parse(raw) as AppSettings;
  } catch {
    return defaultSettings();
  }
}

function createSeedContext(): ContextStore {
  return {
    agents: {
      codex: { agentId: "codex", conversationHistory: [], totalTokenEstimate: 0 },
      claude: { agentId: "claude", conversationHistory: [], totalTokenEstimate: 0 },
      gemini: { agentId: "gemini", conversationHistory: [], totalTokenEstimate: 0 },
    },
    conversationHistory: [],
    handoffs: [],
    maxTurnsPerAgent: 50,
    maxOutputCharsPerTurn: 100000,
  };
}

function defaultSettings(): AppSettings {
  return {
    cliPaths: { codex: "auto", claude: "auto", gemini: "auto" },
    projectRoot: state?.workspace?.projectRoot ?? "C:\\Users\\admin\\source\\repos\\multi-cli-studio",
    maxTurnsPerAgent: 50,
    maxOutputCharsPerTurn: 100000,
    processTimeoutMs: 300000,
  };
}

function persist() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function persistContext() {
  window.localStorage.setItem(CONTEXT_KEY, JSON.stringify(contextStore));
}

function persistSettings() {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function nowTime() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function nowISO() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function basename(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function emitState() {
  persist();
  stateListeners.forEach((listener) => listener(structuredClone(state)));
}

function emitTerminal(agentId: AgentId, line: TerminalLine) {
  terminalListeners.forEach((listener) => listener({ agentId, line }));
}

function emitStream(event: StreamEvent) {
  streamListeners.forEach((listener) => listener(event));
}

function pushLine(agentId: AgentId, speaker: TerminalLine["speaker"], content: string) {
  const line: TerminalLine = {
    id: createId("line"),
    speaker,
    content,
    time: nowTime(),
  };
  state.terminalByAgent[agentId] = [
    ...(state.terminalByAgent[agentId] ?? []),
    line,
  ].slice(-200);
  emitTerminal(agentId, line);
}

function pushActivity(
  tone: AppState["activity"][number]["tone"],
  title: string,
  detail: string
) {
  state.activity = [
    {
      id: createId("activity"),
      time: nowTime(),
      tone,
      title,
      detail,
    },
    ...state.activity,
  ].slice(0, 12);
}

function updateAgentModes(writer: AgentId, active: AgentId) {
  state.agents = state.agents.map((agent) => ({
    ...agent,
    mode:
      agent.id === writer
        ? "writer"
        : agent.id === "claude"
          ? "architect"
          : agent.id === "gemini"
            ? "ui-designer"
            : "standby",
    status: agent.id === active ? "active" : "ready",
    lastSync: "just now",
  }));
}

function fakeOutputFor(agentId: AgentId, prompt: string) {
  if (agentId === "claude") {
    return `## Architecture review\n\nThe session boundary is sound. Keep app-session ownership in the desktop host and avoid duplicating authority in the UI layer.\n\n### Next move\n\n1. Keep chat context scoped to the active terminal tab.\n2. Render AI replies as markdown-first content.\n3. Preserve a raw-output view for diagnostics.\n\n> Prompt summary: ${prompt}`;
  }
  if (agentId === "gemini") {
    return `## UI direction\n\nReduce ornamental chrome, keep the terminal dominant, and make the inspector feel like a precise instrument column instead of a stack of cards.\n\n\`\`\`text\nPrompt summary: ${prompt}\n\`\`\``;
  }
  return `## Execution summary\n\nThe primary workflow completed successfully.\n\n### Command\n\n\`\`\`powershell\ncodex exec \"${prompt}\"\n\`\`\`\n\n### Result\n\n- Context stayed inside the active terminal tab\n- Streaming output was captured\n- The UI can now render the reply as structured content`;
}

function captureArtifact(
  agentId: AgentId,
  title: string,
  summary: string,
  kind: AppState["artifacts"][number]["kind"]
) {
  state.artifacts = [
    {
      id: createId("artifact"),
      source: agentId,
      title,
      kind,
      summary,
      confidence: (agentId === "gemini" ? "medium" : "high") as "high" | "medium" | "low",
      createdAt: "just now",
    },
    ...state.artifacts,
  ].slice(0, 10);
}

function addConversationTurn(
  agentId: AgentId,
  userPrompt: string,
  composedPrompt: string,
  rawOutput: string,
  writeMode: boolean,
  exitCode: number | null,
  durationMs: number
) {
  const turn: ConversationTurn = {
    id: createId("turn"),
    agentId,
    timestamp: nowISO(),
    userPrompt,
    composedPrompt,
    rawOutput,
    outputSummary: rawOutput.length > 500 ? rawOutput.slice(0, 500) + "..." : rawOutput,
    durationMs,
    exitCode,
    writeMode,
  };
  // Per-agent history (backward compat)
  const agentCtx = contextStore.agents[agentId];
  agentCtx.conversationHistory = [
    ...agentCtx.conversationHistory,
    turn,
  ].slice(-contextStore.maxTurnsPerAgent);
  agentCtx.totalTokenEstimate += Math.ceil(rawOutput.length / 4);
  // Unified history
  contextStore.conversationHistory = [
    ...contextStore.conversationHistory,
    turn,
  ].slice(-contextStore.maxTurnsPerAgent);
  persistContext();
  return turn;
}

export const browserRuntime = {
  async loadAppState(projectRoot?: string) {
    if (projectRoot && projectRoot !== state.workspace.projectRoot) {
      state = createSeedState(projectRoot);
      state.environment.notes = ["Browser fallback is active. Tauri commands are simulated."];
      persist();
    }
    emitState();
    return structuredClone(state);
  },

  async switchActiveAgent(agentId: AgentId) {
    state.workspace.activeAgent = agentId;
    updateAgentModes(state.workspace.currentWriter, agentId);
    pushActivity("info", `${agentId} attached`, `${agentId} is now attached to the primary workspace surface.`);
    pushLine(agentId, "system", "primary terminal attached");
    emitState();
    return structuredClone(state);
  },

  async takeOverWriter(agentId: AgentId) {
    const previousWriter = state.workspace.currentWriter;
    state.workspace.currentWriter = agentId;
    state.workspace.activeAgent = agentId;
    state.workspace.handoffReady = true;
    updateAgentModes(agentId, agentId);
    pushLine(previousWriter, "system", `writer lock released to ${agentId}`);
    pushLine(agentId, "system", `writer lock acquired from ${previousWriter}`);

    const previousTurns = contextStore.agents[previousWriter]?.conversationHistory?.slice(-5) ?? [];
    const enrichedHandoff: EnrichedHandoff = {
      id: createId("handoff"),
      from: previousWriter,
      to: agentId,
      timestamp: nowISO(),
      gitDiff: " src/App.tsx | 12 ++--\n src/lib/bridge.ts | 4 +-\n 2 files changed, 10 insertions(+), 6 deletions(-)",
      changedFiles: ["src/App.tsx", "src/lib/bridge.ts", "src-tauri/src/main.rs"],
      previousTurns,
      userGoal: `Resume implementation after ${previousWriter} staged the current app session.`,
      status: "ready",
    };
    contextStore.handoffs = [enrichedHandoff, ...contextStore.handoffs].slice(0, 20);
    persistContext();

    state.handoffs = [
      {
        id: enrichedHandoff.id,
        from: previousWriter,
        to: agentId,
        status: "ready" as const,
        goal: enrichedHandoff.userGoal,
        files: enrichedHandoff.changedFiles,
        risks: [
          "Preserve single-writer control",
          "Keep frontend and backend state shapes aligned",
        ],
        nextStep: `Continue the active task as ${agentId} without dropping the current project context.`,
        updatedAt: "just now",
      },
      ...state.handoffs,
    ].slice(0, 8);

    pushActivity("success", `${agentId} took over`, `Writer ownership moved from ${previousWriter} to ${agentId}.`);
    emitState();
    return structuredClone(state);
  },

  async snapshotWorkspace() {
    state.workspace.handoffReady = true;
    pushLine(state.workspace.activeAgent, "system", "workspace snapshot captured and attached to the app session");
    pushActivity("success", "Workspace snapshot stored", "The current project state is ready for handoff or review.");
    emitState();
    return structuredClone(state);
  },

  async runChecks(_projectRoot?: string, _cliId?: AgentId, _terminalTabId?: string) {
    const active = state.workspace.currentWriter;
    pushLine(active, "system", "running workspace checks...");
    pushActivity("info", "Checks started", "Executing the default validation command for the current project.");
    emitState();
    window.setTimeout(() => {
      state.workspace.failingChecks = 0;
      pushLine(active, active, "Validation finished successfully in browser fallback mode.");
      pushActivity("success", "Checks completed", "Validation command finished successfully.");
      captureArtifact(active, "Validation result", "Validation finished successfully in browser fallback mode.", "diff");
      emitState();
    }, 900);
    return createId("checks");
  },

  async submitPrompt(request: AgentPromptRequest) {
    const { agentId, prompt } = request;
    const writeMode = agentId === state.workspace.currentWriter;
    pushLine(agentId, "user", prompt);
    pushActivity("info", `${agentId} queued`, "Prompt dispatched to the selected CLI.");
    emitState();
    const startTime = Date.now();
    window.setTimeout(() => {
      const output = fakeOutputFor(agentId, prompt);
      pushLine(agentId, agentId, output);
      captureArtifact(agentId, `${agentId} output`, output, "diff");
      pushActivity("success", `${agentId} finished`, "The job output was captured and added to the project record.");
      addConversationTurn(agentId, prompt, prompt, output, writeMode, 0, Date.now() - startTime);
      emitState();
    }, 1200);
    return createId("job");
  },

  async requestReview(agentId: AgentId) {
    pushActivity("info", `${agentId} queued`, "Review request dispatched to the selected CLI.");
    emitState();
    const startTime = Date.now();
    window.setTimeout(() => {
      const prompt = "Review the active workspace and identify the next best move.";
      const output = fakeOutputFor(agentId, prompt);
      pushLine(agentId, agentId, output);
      captureArtifact(
        agentId,
        `${state.agents.find((agent) => agent.id === agentId)?.label ?? agentId} review`,
        output,
        agentId === "claude" ? "plan" : agentId === "gemini" ? "ui-note" : "review"
      );
      pushActivity("success", `${agentId} finished`, "The review output was captured and added to the project record.");
      addConversationTurn(agentId, prompt, prompt, output, false, 0, Date.now() - startTime);
      emitState();
    }, 1200);
    return createId("job");
  },

  async onState(listener: StateListener) {
    stateListeners.add(listener);
    return () => {
      stateListeners.delete(listener);
    };
  },

  async onTerminal(listener: TerminalListener) {
    terminalListeners.add(listener);
    return () => {
      terminalListeners.delete(listener);
    };
  },

  async onStream(listener: StreamListener) {
    streamListeners.add(listener);
    return () => {
      streamListeners.delete(listener);
    };
  },

  async getContextStore() {
    return structuredClone(contextStore);
  },

  async getConversationHistory(agentId: AgentId) {
    return structuredClone(contextStore.agents[agentId]?.conversationHistory ?? []);
  },

  async getSettings() {
    return structuredClone(settings);
  },

  async updateSettings(newSettings: AppSettings) {
    settings = { ...newSettings };
    contextStore.maxTurnsPerAgent = settings.maxTurnsPerAgent;
    contextStore.maxOutputCharsPerTurn = settings.maxOutputCharsPerTurn;
    persistSettings();
    persistContext();
    return structuredClone(settings);
  },

  async sendChatMessage(request: ChatPromptRequest) {
    const { cliId, prompt, terminalTabId } = request;
    const messageId = createId("msg");
    const startTime = Date.now();

    pushActivity("info", `${cliId} queued`, "Prompt dispatched to the selected CLI.");
    emitState();

    // Simulate streaming: emit chunks over time
    const output = fakeOutputFor(cliId, prompt);
    const words = output.split(" ");
    let emitted = 0;

    const interval = setInterval(() => {
      const chunkSize = Math.min(3, words.length - emitted);
      if (chunkSize <= 0) {
        clearInterval(interval);
        const durationMs = Date.now() - startTime;
        emitStream({ terminalTabId, messageId, chunk: "", done: true, exitCode: 0, durationMs });
        addConversationTurn(cliId, prompt, prompt, output, true, 0, durationMs);
        pushActivity("success", `${cliId} finished`, "The job output was captured and added to the project record.");
        emitState();
        return;
      }
      const chunk = words.slice(emitted, emitted + chunkSize).join(" ") + " ";
      emitted += chunkSize;
      emitStream({ terminalTabId, messageId, chunk, done: false });
    }, 100);

    return messageId;
  },

  async pickWorkspaceFolder(): Promise<WorkspacePickResult | null> {
    const rootPath = window.prompt("Enter a workspace folder path");
    if (!rootPath || !rootPath.trim()) return null;
    return {
      name: basename(rootPath.trim()),
      rootPath: rootPath.trim(),
    };
  },

  async searchWorkspaceFiles(_projectRoot: string, query: string): Promise<FileMentionCandidate[]> {
    const candidates = [
      "src/pages/TerminalPage.tsx",
      "src/components/chat/ChatPromptBar.tsx",
      "src/components/chat/ChatConversation.tsx",
      "src/components/chat/GitPanel.tsx",
      "src/lib/store.ts",
      "src/lib/bridge.ts",
      "src-tauri/src/main.rs",
    ];
    const lower = query.toLowerCase();
    return candidates
      .filter((path) => path.toLowerCase().includes(lower))
      .slice(0, 20)
      .map((relativePath) => ({
        id: relativePath,
        name: basename(relativePath),
        relativePath,
        absolutePath: null,
      }));
  },

  async getGitPanel(_projectRoot: string): Promise<GitPanelData> {
    const fakeChanges: GitFileChange[] = [
      { path: "src/pages/TerminalPage.tsx", status: "modified" },
      { path: "src/components/chat/ChatConversation.tsx", status: "added" },
      { path: "src/lib/store.ts", status: "modified" },
      { path: "src/components/chat/GitPanel.tsx", status: "renamed", previousPath: "src/components/GitPanel.tsx" },
    ];
    return {
      isGitRepo: true,
      branch: state.workspace.branch || "main",
      recentChanges: fakeChanges,
    };
  },

  async getGitFileDiff(_projectRoot: string, path: string): Promise<GitFileDiff> {
    const diffByPath: Record<string, GitFileDiff> = {
      "src/pages/TerminalPage.tsx": {
        path: "src/pages/TerminalPage.tsx",
        status: "modified",
        diff: `diff --git a/src/pages/TerminalPage.tsx b/src/pages/TerminalPage.tsx
index 531f4a0..62cb617 100644
--- a/src/pages/TerminalPage.tsx
+++ b/src/pages/TerminalPage.tsx
@@ -8,7 +8,7 @@ export function TerminalPage() {
   return (
-    <div className="flex-1 flex min-h-0">
+    <div className="flex min-h-0 flex-1">
       <div className="flex-1 flex flex-col min-w-0">
         <ChatConversation />
         <ChatPromptBar />`,
      },
      "src/components/chat/ChatConversation.tsx": {
        path: "src/components/chat/ChatConversation.tsx",
        status: "added",
        diff: `diff --git a/src/components/chat/ChatConversation.tsx b/src/components/chat/ChatConversation.tsx
new file mode 100644
--- /dev/null
+++ b/src/components/chat/ChatConversation.tsx
@@ -0,0 +1,8 @@
+import { useStore } from "../../lib/store";
+
+export function ChatConversation() {
+  return <div className="flex-1">Conversation</div>;
+}`,
      },
      "src/lib/store.ts": {
        path: "src/lib/store.ts",
        status: "modified",
        diff: `diff --git a/src/lib/store.ts b/src/lib/store.ts
index bce9811..14f1e8c 100644
--- a/src/lib/store.ts
+++ b/src/lib/store.ts
@@ -950,6 +950,8 @@ export const useStore = create<StoreState>((set, get) => ({
   loadGitPanel: async (workspaceId, projectRoot) => {
     try {
       const gitPanel = await bridge.getGitPanel(projectRoot);
+      // keep the workspace inspector in sync after each streamed response
+      // without requiring manual refresh
       set((state) => {`,
      },
      "src/components/chat/GitPanel.tsx": {
        path: "src/components/chat/GitPanel.tsx",
        previousPath: "src/components/GitPanel.tsx",
        status: "renamed",
        diff: `diff --git a/src/components/GitPanel.tsx b/src/components/chat/GitPanel.tsx
similarity index 86%
rename from src/components/GitPanel.tsx
rename to src/components/chat/GitPanel.tsx`,
      },
    };

    return (
      diffByPath[path] ?? {
        path,
        status: "modified",
        diff: `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-previous content
+updated content`,
      }
    );
  },

  async openWorkspaceFile(_projectRoot: string, path: string): Promise<boolean> {
    window.alert(`Open file is only available in the desktop runtime.\n\n${path}`);
    return false;
  },

  async executeAcpCommand(command: AcpCommand, cliId: AgentId): Promise<AcpCommandResult> {
    const kind = command.kind;

    // Check support
    const def = ACP_COMMANDS.find((c) => c.kind === kind);
    if (def && !def.supportedClis.includes(cliId)) {
      return {
        success: false,
        output: `The /${kind} command is not available for ${cliId} CLI`,
        sideEffects: [],
      };
    }

    switch (kind) {
      case "model": {
        const model = command.args[0] || "";
        if (!model) {
          const current = acpSession.model[cliId] || "default";
          return { success: true, output: `Current model for ${cliId}: ${current}`, sideEffects: [] };
        }
        acpSession.model[cliId] = model;
        return {
          success: true,
          output: `Model for ${cliId} set to: ${model}`,
          sideEffects: [{ type: "modelChanged", cliId, model }],
        };
      }
      case "permissions": {
        const mode = command.args[0] || "";
        if (!mode) {
          const defaults: Record<AgentId, string> = { codex: "workspace-write", claude: "acceptEdits", gemini: "auto_edit" };
          const current = acpSession.permissionMode[cliId] || defaults[cliId];
          return { success: true, output: `Current permission mode for ${cliId}: ${current}`, sideEffects: [] };
        }
        acpSession.permissionMode[cliId] = mode;
        return {
          success: true,
          output: `Permission mode for ${cliId} set to: ${mode}`,
          sideEffects: [{ type: "permissionChanged", cliId, mode }],
        };
      }
      case "effort": {
        const level = command.args[0] || "";
        if (!level) {
          return { success: true, output: `Current effort level: ${acpSession.effortLevel || "default"}`, sideEffects: [] };
        }
        if (!["low", "medium", "high", "max"].includes(level)) {
          return { success: false, output: `Invalid effort level '${level}'. Valid: low, medium, high, max`, sideEffects: [] };
        }
        acpSession.effortLevel = level;
        return { success: true, output: `Effort level set to: ${level}`, sideEffects: [{ type: "effortChanged", level }] };
      }
      case "fast": {
        acpSession.fastMode = !acpSession.fastMode;
        return {
          success: true,
          output: `Fast mode: ${acpSession.fastMode ? "ON" : "OFF"}`,
          sideEffects: [{ type: "uiNotification", message: `Fast mode ${acpSession.fastMode ? "enabled" : "disabled"}` }],
        };
      }
      case "plan": {
        acpSession.planMode = !acpSession.planMode;
        return {
          success: true,
          output: `Plan mode: ${acpSession.planMode ? "ON" : "OFF"}`,
          sideEffects: [{ type: "planModeToggled", active: acpSession.planMode }],
        };
      }
      case "clear": {
        contextStore.conversationHistory = [];
        for (const agentCtx of Object.values(contextStore.agents)) {
          agentCtx.conversationHistory = [];
          agentCtx.totalTokenEstimate = 0;
        }
        persistContext();
        return { success: true, output: "Conversation history cleared for all CLIs.", sideEffects: [{ type: "historyCleared" }] };
      }
      case "compact": {
        const half = Math.floor(contextStore.maxTurnsPerAgent / 2);
        if (contextStore.conversationHistory.length > half) {
          contextStore.conversationHistory = contextStore.conversationHistory.slice(-half);
        }
        for (const agentCtx of Object.values(contextStore.agents)) {
          if (agentCtx.conversationHistory.length > half) {
            agentCtx.conversationHistory = agentCtx.conversationHistory.slice(-half);
          }
        }
        persistContext();
        return { success: true, output: `Context compacted. Kept last ${half} turns.`, sideEffects: [{ type: "contextCompacted" }] };
      }
      case "rewind": {
        if (contextStore.conversationHistory.length === 0) {
          return { success: false, output: "No conversation turns to rewind.", sideEffects: [] };
        }
        const removed = contextStore.conversationHistory.pop()!;
        const agentCtx = contextStore.agents[removed.agentId as AgentId];
        if (agentCtx) {
          agentCtx.conversationHistory = agentCtx.conversationHistory.filter((t) => t.id !== removed.id);
        }
        persistContext();
        return { success: true, output: "Last conversation turn removed.", sideEffects: [{ type: "conversationRewound", removedTurns: 1 }] };
      }
      case "cost": {
        const lines = ["Token usage estimates:"];
        for (const [agentId, agentCtx] of Object.entries(contextStore.agents)) {
          lines.push(`  ${agentId}: ~${agentCtx.totalTokenEstimate} tokens (${agentCtx.conversationHistory.length} turns)`);
        }
        const total = Object.values(contextStore.agents).reduce((s, a) => s + a.totalTokenEstimate, 0);
        lines.push(`  Total: ~${total} tokens`);
        return { success: true, output: lines.join("\n"), sideEffects: [] };
      }
      case "diff": {
        return {
          success: true,
          output: " src/App.tsx         | 12 ++--\n src/lib/bridge.ts   | 4 +-\n src/lib/store.ts    | 8 ++++\n 3 files changed, 16 insertions(+), 8 deletions(-)",
          sideEffects: [],
        };
      }
      case "status": {
        const agent = state.agents.find((a) => a.id === cliId);
        const version = agent?.runtime?.version || "unknown";
        const installed = agent?.runtime?.installed ? "yes" : "no";
        const model = acpSession.model[cliId] || "default";
        const perm = acpSession.permissionMode[cliId] || "default";
        const output = `CLI: ${cliId}\nInstalled: ${installed}\nVersion: ${version}\nModel: ${model}\nPermission mode: ${perm}\nPlan mode: ${acpSession.planMode ? "ON" : "OFF"}\nFast mode: ${acpSession.fastMode ? "ON" : "OFF"}\nEffort: ${acpSession.effortLevel || "default"}`;
        return { success: true, output, sideEffects: [] };
      }
      case "help": {
        const lines = ["Available commands:"];
        for (const cmd of ACP_COMMANDS) {
          const supported = cmd.supportedClis.includes(cliId) ? "" : " (not available)";
          lines.push(`  ${cmd.slash} ${cmd.argsHint || ""} - ${cmd.description}${supported}`);
        }
        return { success: true, output: lines.join("\n"), sideEffects: [] };
      }
      case "export": {
        const md = ["# Conversation Export", ""];
        for (const turn of contextStore.conversationHistory) {
          md.push(`## [${turn.agentId}] ${turn.timestamp} - ${turn.userPrompt}`, "", turn.rawOutput, "", "---", "");
        }
        const output = md.join("\n");
        return { success: true, output: output.length > 5000 ? output.slice(0, 5000) + `\n\n... (${output.length} total characters)` : output, sideEffects: [] };
      }
      case "context": {
        const lines = ["Context usage per CLI:"];
        for (const [agentId, agentCtx] of Object.entries(contextStore.agents)) {
          const chars = agentCtx.conversationHistory.reduce((s, t) => s + t.rawOutput.length + t.userPrompt.length, 0);
          lines.push(`  ${agentId}: ${agentCtx.conversationHistory.length} turns, ~${chars} chars`);
        }
        return { success: true, output: lines.join("\n"), sideEffects: [] };
      }
      case "memory": {
        return { success: true, output: "Memory files are managed at the project root.\nCLAUDE.md: (browser mode - file access unavailable)\nAGENTS.md: (browser mode - file access unavailable)", sideEffects: [] };
      }
      default:
        return { success: false, output: `Unknown command: /${kind}`, sideEffects: [] };
    }
  },

  async getAcpCommands(cliId: AgentId): Promise<AcpCommandDef[]> {
    return ACP_COMMANDS.filter((c) => c.supportedClis.includes(cliId));
  },

  async getAcpSession(): Promise<AcpSession> {
    return structuredClone(acpSession);
  },
};
