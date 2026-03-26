import {
  AppState,
  AgentCard,
  AgentId,
  AgentResourceGroup,
  AgentRuntimeResources,
} from "./models";

const nowTime = () =>
  new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

function resourceGroup(
  supported: boolean,
  items: AgentResourceGroup["items"] = [],
  error: string | null = null
): AgentResourceGroup {
  return {
    supported,
    items,
    error,
  };
}

function createSeedResources(id: AgentId): AgentRuntimeResources {
  switch (id) {
    case "codex":
      return {
        mcp: resourceGroup(true, [
          { name: "chrome-devtools", enabled: true, source: "config.toml" },
          { name: "pencil", enabled: true, source: "config.toml" },
        ]),
        plugin: resourceGroup(false),
        extension: resourceGroup(false),
        skill: resourceGroup(true, [
          { name: "frontend-design", enabled: true, source: "user" },
          { name: "frontend-skill", enabled: true, source: "user" },
          { name: "openai-docs", enabled: true, source: "built-in" },
          { name: "skill-creator", enabled: true, source: "built-in" },
        ]),
      };
    case "claude":
      return {
        mcp: resourceGroup(true, [
          { name: "chrome-devtools", enabled: true, source: "global" },
          { name: "pencil", enabled: true, source: "global" },
        ]),
        plugin: resourceGroup(true, [
          { name: "context7", enabled: true, version: "205b6e0b3036", source: "claude-plugins-official" },
          { name: "frontend-design", enabled: true, version: "205b6e0b3036", source: "claude-plugins-official" },
          { name: "rust-analyzer-lsp", enabled: true, version: "1.0.0", source: "claude-plugins-official" },
        ]),
        extension: resourceGroup(false),
        skill: resourceGroup(true, [
          { name: "find-skills", enabled: true, source: "user" },
          { name: "frontend-design", enabled: true, source: "user" },
          { name: "playwright-cli", enabled: true, source: "user" },
          { name: "skill-creator", enabled: true, source: "user" },
        ]),
      };
    default:
      return {
        mcp: resourceGroup(true, [
          { name: "pencil", enabled: true, source: "settings.json" },
        ]),
        plugin: resourceGroup(false),
        extension: resourceGroup(true, [
          { name: "context7", enabled: true, version: "1.0.0", source: "github-release" },
        ]),
        skill: resourceGroup(true, []),
      };
  }
}

function baseAgent(
  id: AgentId,
  label: string,
  mode: AgentCard["mode"],
  status: AgentCard["status"],
  specialty: string,
  summary: string,
  pendingAction: string,
  sessionRef: string
): AgentCard {
  return {
    id,
    label,
    mode,
    status,
    specialty,
    summary,
    pendingAction,
    sessionRef,
    lastSync: "just now",
    runtime: {
      installed: true,
      version: "local",
      commandPath: `${id}.ps1`,
      resources: createSeedResources(id),
    }
  };
}

export function createSeedState(projectRoot = "C:\\Users\\admin\\source\\repos\\multi-cli-studio"): AppState {
  return {
    workspace: {
      projectName: "multi-cli-studio",
      projectRoot,
      branch: "main",
      currentWriter: "codex",
      activeAgent: "codex",
      dirtyFiles: 3,
      failingChecks: 1,
      handoffReady: true
    },
    agents: [
      baseAgent(
        "codex",
        "Codex",
        "writer",
        "active",
        "Bug isolation, patch drafting, repo-grounded fixes",
        "Primary execution lane with direct writer ownership.",
        "Ready to accept execution prompts.",
        "codex:last"
      ),
      baseAgent(
        "claude",
        "Claude",
        "architect",
        "ready",
        "System boundaries, review, refactor guidance",
        "Architecture lane prepared for review and takeover.",
        "Waiting for an architecture prompt or review request.",
        "claude:latest"
      ),
      baseAgent(
        "gemini",
        "Gemini",
        "ui-designer",
        "ready",
        "Workbench quality, hierarchy, interface polish",
        "Interface lane prepared for design critique and visual refinement.",
        "Waiting for a UI-focused prompt or review request.",
        "gemini:latest"
      )
    ],
    handoffs: [
      {
        id: createId("handoff"),
        from: "codex",
        to: "claude",
        status: "ready",
        goal: "Review the orchestrator boundary before deeper CLI execution flows land.",
        files: ["src/App.tsx", "src/lib/bridge.ts", "src-tauri/src/main.rs"],
        risks: [
          "Frontend and backend state models must stay aligned.",
          "Writer lock ownership should remain explicit."
        ],
        nextStep: "Validate the shared session model and the bridge contracts.",
        updatedAt: "just now"
      }
    ],
    artifacts: [
      {
        id: createId("artifact"),
        source: "codex",
        title: "Desktop host ready",
        kind: "plan",
        summary:
          "The Tauri host owns persistence, runtime detection, and background job orchestration.",
        confidence: "high",
        createdAt: "just now"
      }
    ],
    activity: [
      {
        id: createId("activity"),
        time: nowTime(),
        tone: "success",
        title: "Workspace attached",
        detail: "The app session loaded and bound itself to the current project root."
      }
    ],
    terminalByAgent: {
      codex: [
        {
          id: createId("line"),
          speaker: "system",
          content: "writer lock acquired for the primary workspace",
          time: nowTime()
        },
        {
          id: createId("line"),
          speaker: "codex",
          content: "Environment checked. The shell is ready for real CLI jobs.",
          time: nowTime()
        }
      ],
      claude: [
        {
          id: createId("line"),
          speaker: "claude",
          content: "Architecture lane is standing by for review or takeover.",
          time: nowTime()
        }
      ],
      gemini: [
        {
          id: createId("line"),
          speaker: "gemini",
          content: "Interface lane is standing by for UI critique and visual refinement.",
          time: nowTime()
        }
      ]
    },
    environment: {
      backend: "browser",
      tauriReady: false,
      rustAvailable: false,
      notes: ["Browser fallback is active. Tauri commands are simulated."]
    }
  };
}
