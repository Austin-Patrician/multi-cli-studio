import {
  AppState,
  AgentId,
  AutomationJob,
  AutomationJobDraft,
  AutomationGoal,
  AutomationGoalDraft,
  AutomationGoalRuleConfig,
  AutomationGoalStatus,
  AutomationExecutionMode,
  AutomationParameterDefinition,
  AutomationPermissionProfile,
  AutomationParameterValue,
  AutomationWorkflow,
  AutomationWorkflowContextStrategy,
  AutomationWorkflowDraft,
  AutomationWorkflowNode,
  AutomationWorkflowNodeDraft,
  AutomationWorkflowNodeRun,
  AutomationWorkflowRun,
  AutomationWorkflowRunDetail,
  AutomationRunDetail,
  AutomationRunRecord,
  AutomationRuleProfile,
  AutomationRun,
  AutomationRunStatus,
  ApiChatRequest,
  ApiChatResponse,
  ApiChatStreamEvent,
  AgentTransportKind,
  AgentTransportSession,
  AgentRuntimeResources,
  AgentPromptRequest,
  AssistantApprovalDecision,
  AutoOrchestrationRequest,
  ChatInterruptResult,
  ChatMessageBlocksUpdateRequest,
  ChatMessageDeleteRequest,
  ChatMessageFinalizeRequest,
  ChatMessageBlock,
  ChatMessagesAppendRequest,
  ChatMessageStreamUpdateRequest,
  CliHandoffRequest,
  CliSkillItem,
  ExternalDirectoryEntry,
  ExternalTextFile,
  GlobalMcpServerEntry,
  TerminalEvent,
  TerminalLine,
  ContextStore,
  ConversationTurn,
  CreateAutomationRunFromJobRequest,
  CreateAutomationRunRequest,
  CreateAutomationWorkflowRunRequest,
  AppSettings,
  NotificationConfig,
  EnrichedHandoff,
  ChatPromptRequest,
  FileMentionCandidate,
  PickedChatAttachment,
  LocalUsageStatistics,
  WorkspaceTextSearchResponse,
  GitFileDiff,
  GitBranchListResponse,
  GitCommitDetails,
  GitHistoryCommit,
  GitHistoryResponse,
  GitPushPreviewResponse,
  GitHubIssue,
  GitHubIssuesResponse,
  GitHubPullRequest,
  GitHubPullRequestsResponse,
  GitLogEntry,
  GitLogResponse,
  GitOverviewResponse,
  GitFileStatus,
  StreamEvent,
  GitPanelData,
  GitFileChange,
  ModelProviderConfig,
  ModelProviderServiceType,
  PersistedTerminalState,
  SemanticMemoryChunk,
  CodexRuntimeReloadResult,
  SettingsEngineStatus,
  SshConnectionTestResult,
  WorkspaceFileIndexResponse,
  WorkspacePickResult,
  WorkspaceTreeEntry,
} from "./models";
import { parseApiAssistantContent } from "./apiChatFormatting";
import {
  AcpCliCapabilities,
  AcpCommand,
  AcpCommandDef,
  AcpCommandResult,
  AcpSession,
  ACP_COMMANDS,
  defaultAcpSession,
} from "./acp";
import {
  defaultModelsForServiceType,
  normalizeProviderSettings,
} from "./modelProviders";
import { createSeedState } from "./seed";

type StateListener = (state: AppState) => void;
type TerminalListener = (event: TerminalEvent) => void;
type StreamListener = (event: StreamEvent) => void;
type ApiChatStreamListener = (event: ApiChatStreamEvent) => void;

const STORAGE_KEY = "multi-cli-studio::state";
const CONTEXT_KEY = "multi-cli-studio::context";
const SETTINGS_KEY = "multi-cli-studio::settings";
const TERMINAL_STATE_KEY = "multi-cli-studio::terminal-state";
const AUTOMATION_JOBS_KEY = "multi-cli-studio::automation-jobs";
const AUTOMATION_RUNS_KEY = "multi-cli-studio::automation-runs";
const AUTOMATION_WORKFLOWS_KEY = "multi-cli-studio::automation-workflows";
const AUTOMATION_WORKFLOW_RUNS_KEY = "multi-cli-studio::automation-workflow-runs";
const AUTOMATION_RULE_KEY = "multi-cli-studio::automation-rule";

let state: AppState = loadStoredState();
let contextStore: ContextStore = loadStoredContext();
let settings: AppSettings = loadStoredSettings();
let acpSession: AcpSession = defaultAcpSession();
let automationJobs: AutomationJob[] = loadStoredAutomationJobs();
let automationRuns: AutomationRun[] = loadStoredAutomationRuns();
let automationWorkflows: AutomationWorkflow[] = loadStoredAutomationWorkflows();
let automationWorkflowRuns: AutomationWorkflowRun[] = loadStoredAutomationWorkflowRuns();
let automationRuleProfile: AutomationRuleProfile = loadStoredAutomationRuleProfile();

automationRuns
  .filter((run) => run.status === "scheduled")
  .forEach((run) => {
    if (typeof window !== "undefined") {
      window.setTimeout(() => scheduleBrowserAutomationRun(run.id), 0);
    }
  });

automationWorkflowRuns
  .filter((run) => run.status === "scheduled")
  .forEach((run) => {
    if (typeof window !== "undefined") {
      window.setTimeout(() => scheduleBrowserWorkflowRun(run.id), 0);
    }
  });

const stateListeners = new Set<StateListener>();
const terminalListeners = new Set<TerminalListener>();
const streamListeners = new Set<StreamListener>();
const apiChatStreamListeners = new Set<ApiChatStreamListener>();

function defaultTransportKind(agentId: AgentId): AgentTransportKind {
  switch (agentId) {
    case "codex":
      return "codex-app-server";
    case "claude":
      return "claude-cli";
    case "gemini":
      return "gemini-acp";
    default:
      return "browser-fallback";
  }
}

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

function fallbackCliSkills(cliId: AgentId): CliSkillItem[] {
  const itemsByCli: Record<AgentId, CliSkillItem[]> = {
    codex: [
      {
        name: "frontend-design",
        displayName: "frontend-design",
        description: "Polished frontend interface design workflow.",
        path: "~/.codex/skills/frontend-design",
        scope: "user",
        source: "browser-fallback",
      },
      {
        name: "frontend-skill",
        displayName: "frontend-skill",
        description: "Minimal, structured UI composition workflow.",
        path: "~/.codex/skills/frontend-skill",
        scope: "user",
        source: "browser-fallback",
      },
    ],
    claude: [
      {
        name: "frontend-design",
        displayName: "frontend-design",
        description: "Polished frontend interface design workflow.",
        path: "~/.claude/skills/frontend-design",
        scope: "user",
        source: "browser-fallback",
      },
    ],
    gemini: [],
  };

  return itemsByCli[cliId];
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
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

function loadStoredTerminalState(): PersistedTerminalState | null {
  const raw = window.localStorage.getItem(TERMINAL_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedTerminalState;
  } catch {
    return null;
  }
}

function parsePositiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
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
  return normalizeProviderSettings({
    cliPaths: { codex: "auto", claude: "auto", gemini: "auto" },
    sshConnections: [],
    customAgents: [],
    projectRoot: state?.workspace?.projectRoot ?? "C:\\Users\\admin\\source\\repos\\multi-cli-studio",
    maxTurnsPerAgent: 50,
    maxOutputCharsPerTurn: 100000,
    modelChatContextTurnLimit: 4,
    processTimeoutMs: 300000,
    notifyOnTerminalCompletion: false,
    notificationConfig: {
      notifyOnCompletion: false,
      webhookUrl: "",
      webhookEnabled: false,
      smtpEnabled: false,
      smtpHost: "",
      smtpPort: 587,
      smtpUsername: "",
      smtpPassword: "",
      smtpFrom: "",
      emailRecipients: [],
    },
    updateConfig: {
      autoCheckForUpdates: true,
      notifyOnUpdateAvailable: false,
    },
    openaiCompatibleProviders: [],
    claudeProviders: [],
    geminiProviders: [],
  });
}

function normalizeNotificationConfig(value: unknown, fallback = defaultSettings().notificationConfig) {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<AppSettings["notificationConfig"]>;
  const smtpPort =
    typeof raw.smtpPort === "number" && Number.isFinite(raw.smtpPort) && raw.smtpPort > 0
      ? Math.round(raw.smtpPort)
      : fallback.smtpPort;
  const emailRecipients = Array.isArray(raw.emailRecipients)
    ? raw.emailRecipients
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : fallback.emailRecipients;
  return {
    notifyOnCompletion: raw.notifyOnCompletion === true,
    webhookUrl: typeof raw.webhookUrl === "string" ? raw.webhookUrl : fallback.webhookUrl,
    webhookEnabled: raw.webhookEnabled === true,
    smtpEnabled: raw.smtpEnabled === true,
    smtpHost: typeof raw.smtpHost === "string" ? raw.smtpHost : fallback.smtpHost,
    smtpPort,
    smtpUsername: typeof raw.smtpUsername === "string" ? raw.smtpUsername : fallback.smtpUsername,
    smtpPassword: typeof raw.smtpPassword === "string" ? raw.smtpPassword : fallback.smtpPassword,
    smtpFrom: typeof raw.smtpFrom === "string" ? raw.smtpFrom : fallback.smtpFrom,
    emailRecipients,
  };
}

function normalizeUpdateConfig(value: unknown, fallback = defaultSettings().updateConfig) {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<AppSettings["updateConfig"]>;
  return {
    autoCheckForUpdates:
      typeof raw.autoCheckForUpdates === "boolean"
        ? raw.autoCheckForUpdates
        : fallback.autoCheckForUpdates,
    notifyOnUpdateAvailable:
      typeof raw.notifyOnUpdateAvailable === "boolean"
        ? raw.notifyOnUpdateAvailable
        : fallback.notifyOnUpdateAvailable,
  };
}

function normalizeSshConnections(
  value: unknown,
  fallback = defaultSettings().sshConnections
): AppSettings["sshConnections"] {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Partial<AppSettings["sshConnections"][number]>;
      const id = typeof raw.id === "string" ? raw.id.trim() : "";
      const host = typeof raw.host === "string" ? raw.host.trim() : "";
      const username = typeof raw.username === "string" ? raw.username.trim() : "";
      if (!id || !host || !username) return null;
      const port =
        typeof raw.port === "number" && Number.isFinite(raw.port) && raw.port > 0
          ? Math.round(raw.port)
          : 22;
      const labels = Array.isArray(raw.labels)
        ? raw.labels
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : [];
      return {
        id,
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : host,
        host,
        port,
        username,
        authMode:
          raw.authMode === "identityFile" ? "identityFile" : raw.authMode === "password" ? "password" : "agent",
        identityFile: typeof raw.identityFile === "string" ? raw.identityFile : "",
        password: typeof raw.password === "string" ? raw.password : "",
        proxyJump: typeof raw.proxyJump === "string" ? raw.proxyJump : "",
        remoteShell: typeof raw.remoteShell === "string" && raw.remoteShell.trim()
          ? raw.remoteShell.trim()
          : "bash",
        labels,
        createdAt: typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt : nowISO(),
        updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt.trim() ? raw.updatedAt : nowISO(),
        lastValidatedAt:
          typeof raw.lastValidatedAt === "string" && raw.lastValidatedAt.trim()
            ? raw.lastValidatedAt
            : null,
        detectedCliPaths: {
          codex:
            typeof raw.detectedCliPaths?.codex === "string" && raw.detectedCliPaths.codex.trim()
              ? raw.detectedCliPaths.codex.trim()
              : null,
          claude:
            typeof raw.detectedCliPaths?.claude === "string" && raw.detectedCliPaths.claude.trim()
              ? raw.detectedCliPaths.claude.trim()
              : null,
          gemini:
            typeof raw.detectedCliPaths?.gemini === "string" && raw.detectedCliPaths.gemini.trim()
              ? raw.detectedCliPaths.gemini.trim()
              : null,
        },
      } satisfies AppSettings["sshConnections"][number];
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function normalizeSettings(value: unknown): AppSettings {
  const defaults = defaultSettings();
  if (!value || typeof value !== "object") return defaults;

  const raw = value as Partial<AppSettings> & {
    cliPaths?: Partial<AppSettings["cliPaths"]>;
  };

  return normalizeProviderSettings({
    cliPaths: {
      ...defaults.cliPaths,
      ...(raw.cliPaths ?? {}),
    },
    sshConnections: normalizeSshConnections(raw.sshConnections, defaults.sshConnections),
    customAgents: Array.isArray(raw.customAgents)
      ? raw.customAgents
          .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const item = entry as AppSettings["customAgents"][number];
            const id = typeof item.id === "string" ? item.id.trim() : "";
            const name = typeof item.name === "string" ? item.name.trim() : "";
            if (!id || !name) return null;
            return {
              id,
              name,
              prompt: typeof item.prompt === "string" && item.prompt.trim() ? item.prompt : null,
              icon: typeof item.icon === "string" && item.icon.trim() ? item.icon : null,
              createdAt:
                typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
                  ? item.createdAt
                  : null,
            } satisfies AppSettings["customAgents"][number];
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : defaults.customAgents,
    projectRoot:
      typeof raw.projectRoot === "string" && raw.projectRoot.trim()
        ? raw.projectRoot
        : defaults.projectRoot,
    maxTurnsPerAgent: parsePositiveNumber(raw.maxTurnsPerAgent, defaults.maxTurnsPerAgent),
    maxOutputCharsPerTurn: parsePositiveNumber(raw.maxOutputCharsPerTurn, defaults.maxOutputCharsPerTurn),
    modelChatContextTurnLimit: parsePositiveNumber(
      raw.modelChatContextTurnLimit,
      defaults.modelChatContextTurnLimit
    ),
    processTimeoutMs: parsePositiveNumber(raw.processTimeoutMs, defaults.processTimeoutMs),
    notifyOnTerminalCompletion: raw.notifyOnTerminalCompletion === true,
    notificationConfig: normalizeNotificationConfig(raw.notificationConfig, defaults.notificationConfig),
    updateConfig: normalizeUpdateConfig(raw.updateConfig, defaults.updateConfig),
    openaiCompatibleProviders: raw.openaiCompatibleProviders ?? defaults.openaiCompatibleProviders,
    claudeProviders: raw.claudeProviders ?? defaults.claudeProviders,
    geminiProviders: raw.geminiProviders ?? defaults.geminiProviders,
  });
}

function loadStoredAutomationRuns(): AutomationRun[] {
  const raw = window.localStorage.getItem(AUTOMATION_RUNS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<AutomationRun>[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((run) => ({
      id: run.id ?? createId("auto-run"),
      jobId: run.jobId ?? null,
      jobName: run.jobName ?? null,
      triggerSource: run.triggerSource ?? null,
      runNumber: run.runNumber ?? null,
      permissionProfile: normalizeAutomationPermissionProfile(run.permissionProfile),
      parameterValues: normalizeAutomationParameterValues(run.parameterValues),
      workspaceId: run.workspaceId ?? "",
      projectRoot: run.projectRoot ?? "",
      projectName: run.projectName ?? "workspace",
      ruleProfileId: run.ruleProfileId ?? "safe-autonomy-v1",
      lifecycleStatus: run.lifecycleStatus ?? "queued",
      outcomeStatus: run.outcomeStatus ?? "unknown",
      attentionStatus: run.attentionStatus ?? "none",
      resolutionCode: run.resolutionCode ?? "not_evaluated",
      statusSummary: run.statusSummary ?? null,
      objectiveSignals: run.objectiveSignals ?? {
        exitCode: null,
        checksPassed: false,
        checksFailed: false,
        artifactsProduced: false,
        filesChanged: 0,
        policyBlocks: [],
      },
      judgeAssessment: run.judgeAssessment ?? {
        madeProgress: false,
        expectedOutcomeMet: false,
        suggestedDecision: null,
        reason: null,
      },
      validationResult: run.validationResult ?? {
        decision: null,
        reason: null,
        feedback: null,
        evidenceSummary: null,
        missingChecks: [],
        verificationSteps: [],
        madeProgress: false,
        expectedOutcomeMet: false,
      },
      status: (run.status as AutomationRunStatus | undefined) ?? "draft",
      scheduledStartAt: run.scheduledStartAt ?? null,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      summary: run.summary ?? null,
      createdAt: run.createdAt ?? nowISO(),
      updatedAt: run.updatedAt ?? nowISO(),
      goals: (run.goals ?? []).map((goal, index) => ({
        id: goal.id ?? createId("auto-goal"),
        runId: goal.runId ?? run.id ?? createId("auto-run"),
        title: goal.title ?? "Untitled goal",
        goal: goal.goal ?? "",
        expectedOutcome: goal.expectedOutcome ?? "",
        executionMode: goal.executionMode ?? "auto",
        lifecycleStatus: goal.lifecycleStatus ?? "queued",
        outcomeStatus: goal.outcomeStatus ?? "unknown",
        attentionStatus: goal.attentionStatus ?? "none",
        resolutionCode: goal.resolutionCode ?? "not_evaluated",
        statusSummary: goal.statusSummary ?? null,
        objectiveSignals: goal.objectiveSignals ?? {
          exitCode: null,
          checksPassed: false,
          checksFailed: false,
          artifactsProduced: false,
          filesChanged: 0,
          policyBlocks: [],
        },
        judgeAssessment: goal.judgeAssessment ?? {
          madeProgress: false,
          expectedOutcomeMet: false,
          suggestedDecision: null,
          reason: null,
        },
        validationResult: goal.validationResult ?? {
          decision: null,
          reason: null,
          feedback: null,
          evidenceSummary: null,
          missingChecks: [],
          verificationSteps: [],
          madeProgress: false,
          expectedOutcomeMet: false,
        },
        status: (goal.status as AutomationGoalStatus | undefined) ?? "queued",
        position: goal.position ?? index,
        roundCount: goal.roundCount ?? 0,
        consecutiveFailureCount: goal.consecutiveFailureCount ?? 0,
        noProgressRounds: goal.noProgressRounds ?? 0,
        ruleConfig: normalizeAutomationGoalRuleConfig(goal.ruleConfig ?? defaultAutomationRuleProfile()),
        lastOwnerCli: goal.lastOwnerCli ?? null,
        resultSummary: goal.resultSummary ?? null,
        latestProgressSummary: goal.latestProgressSummary ?? null,
        nextInstruction: goal.nextInstruction ?? null,
        requiresAttentionReason: goal.requiresAttentionReason ?? null,
        relevantFiles: goal.relevantFiles ?? [],
        syntheticTerminalTabId: goal.syntheticTerminalTabId ?? createId("auto-tab"),
        lastExitCode: goal.lastExitCode ?? null,
        startedAt: goal.startedAt ?? null,
        completedAt: goal.completedAt ?? null,
        updatedAt: goal.updatedAt ?? nowISO(),
      })),
      events: run.events ?? [],
    }));
  } catch {
    return [];
  }
}

function normalizeAutomationParameterDefinitions(
  values: AutomationParameterDefinition[] | undefined | null
): AutomationParameterDefinition[] {
  if (!values) return [];
  return values.map((item, index) => ({
    id: item.id ?? createId(`auto-param-${index}`),
    key: item.key?.trim() || `param-${index + 1}`,
    label: item.label?.trim() || item.key?.trim() || `参数 ${index + 1}`,
    kind: item.kind === "boolean" || item.kind === "enum" ? item.kind : "string",
    description: item.description ?? null,
    required: item.required === true,
    options: item.kind === "enum" ? item.options ?? [] : [],
    defaultValue: item.defaultValue ?? null,
  }));
}

function normalizeAutomationParameterValues(
  values: Record<string, AutomationParameterValue> | undefined | null
): Record<string, AutomationParameterValue> {
  if (!values) return {};
  const normalizedEntries = Object.entries(values)
    .map(([key, value]) => [key.trim(), value ?? null] as const)
    .filter(([key]) => key.length > 0);
  return Object.fromEntries(normalizedEntries);
}

function loadStoredAutomationJobs(): AutomationJob[] {
  const raw = window.localStorage.getItem(AUTOMATION_JOBS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<AutomationJob>[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((job, index) => ({
      id: job.id ?? createId("auto-job"),
      workspaceId: job.workspaceId ?? "",
      projectRoot: job.projectRoot ?? "",
      projectName: job.projectName ?? "workspace",
      name: job.name?.trim() || `CLI 任务 ${index + 1}`,
      description: job.description ?? null,
      goal: job.goal ?? "",
      expectedOutcome: job.expectedOutcome ?? "",
      defaultExecutionMode: job.defaultExecutionMode ?? "auto",
      permissionProfile: normalizeAutomationPermissionProfile(job.permissionProfile),
      ruleConfig: normalizeAutomationGoalRuleConfig(job.ruleConfig ?? defaultAutomationRuleProfile()),
      parameterDefinitions: normalizeAutomationParameterDefinitions(job.parameterDefinitions),
      defaultParameterValues: normalizeAutomationParameterValues(job.defaultParameterValues),
      cronExpression: job.cronExpression ?? null,
      emailNotificationEnabled: job.emailNotificationEnabled === true,
      lastTriggeredAt: job.lastTriggeredAt ?? null,
      enabled: job.enabled !== false,
      createdAt: job.createdAt ?? nowISO(),
      updatedAt: job.updatedAt ?? nowISO(),
    }));
  } catch {
    return [];
  }
}

function defaultAutomationWorkflowContextStrategy(): AutomationWorkflowContextStrategy {
  return "resume-per-cli";
}

function normalizeAutomationWorkflowContextStrategy(
  value?: string | null
): AutomationWorkflowContextStrategy {
  return value === "kernel-only" || value === "session-pool" ? value : "resume-per-cli";
}

function normalizeWorkflowNodeExecutionMode(
  value: unknown
): AutomationExecutionMode | "inherit" {
  return value === "codex" || value === "claude" || value === "gemini" ? value : "inherit";
}

function normalizeWorkflowNodePermissionProfile(
  value: unknown
): AutomationPermissionProfile | "inherit" {
  return value === "standard" || value === "full-access" || value === "read-only"
    ? value
    : "inherit";
}

function defaultWorkflowNodeLayout(index: number) {
  return {
    x: 160 + (index % 3) * 320,
    y: 140 + Math.floor(index / 3) * 220,
  };
}

function normalizeAutomationWorkflowNode(
  node: Partial<AutomationWorkflowNodeDraft>,
  index: number
): AutomationWorkflowNode {
  const legacyJob =
    typeof (node as { jobId?: string | null }).jobId === "string"
      ? automationJobs.find((item) => item.id === (node as { jobId?: string | null }).jobId)
      : null;
  const goal = node.goal?.trim() || legacyJob?.goal || "";
  const expectedOutcome =
    node.expectedOutcome?.trim() || legacyJob?.expectedOutcome || "";
  const label =
    node.label?.trim() ||
    legacyJob?.name ||
    (goal ? deriveAutomationGoalTitle(goal) : `节点 ${index + 1}`);

  return {
    id: node.id?.trim() || createId("wf-node"),
    label,
    goal,
    expectedOutcome,
    executionMode: normalizeWorkflowNodeExecutionMode(
      node.executionMode ?? (node as { executionModeOverride?: unknown }).executionModeOverride
    ),
    permissionProfile: normalizeWorkflowNodePermissionProfile(
      node.permissionProfile ??
        (node as { permissionProfileOverride?: unknown }).permissionProfileOverride
    ),
    reuseSession: node.reuseSession !== false,
    layout:
      node.layout &&
      Number.isFinite(node.layout.x) &&
      Number.isFinite(node.layout.y)
        ? { x: node.layout.x, y: node.layout.y }
        : defaultWorkflowNodeLayout(index),
  };
}

function normalizeAutomationWorkflowEdge(
  edge: Partial<AutomationWorkflowDraft["edges"][number]>
) {
  return {
    fromNodeId: edge.fromNodeId?.trim() || "",
    on: edge.on === "success" ? "success" : "fail",
    toNodeId: edge.toNodeId?.trim() || "",
  } as const;
}

function loadStoredAutomationWorkflows(): AutomationWorkflow[] {
  const raw = window.localStorage.getItem(AUTOMATION_WORKFLOWS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<AutomationWorkflow>[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((workflow, index) => {
      const nodes = (workflow.nodes ?? []).map((node, nodeIndex) =>
        normalizeAutomationWorkflowNode(node, nodeIndex)
      );
      const entryNodeId =
        workflow.entryNodeId?.trim() || nodes[0]?.id || createId(`wf-entry-${index}`);
      return {
        id: workflow.id ?? createId("wf"),
        workspaceId: workflow.workspaceId ?? "",
        projectRoot: workflow.projectRoot ?? "",
        projectName: workflow.projectName ?? "workspace",
        name: workflow.name?.trim() || `工作流 ${index + 1}`,
        description: workflow.description ?? null,
        cronExpression: workflow.cronExpression ?? null,
        emailNotificationEnabled: workflow.emailNotificationEnabled === true,
        enabled: workflow.enabled !== false,
        entryNodeId,
        defaultContextStrategy: normalizeAutomationWorkflowContextStrategy(
          workflow.defaultContextStrategy
        ),
        defaultExecutionMode:
          workflow.defaultExecutionMode === "codex" ||
          workflow.defaultExecutionMode === "claude" ||
          workflow.defaultExecutionMode === "gemini"
            ? workflow.defaultExecutionMode
            : "auto",
        defaultPermissionProfile: normalizeAutomationPermissionProfile(
          workflow.defaultPermissionProfile
        ),
        nodes,
        edges: (workflow.edges ?? []).map((edge) => normalizeAutomationWorkflowEdge(edge)),
        lastTriggeredAt: workflow.lastTriggeredAt ?? null,
        createdAt: workflow.createdAt ?? nowISO(),
        updatedAt: workflow.updatedAt ?? nowISO(),
      };
    });
  } catch {
    return [];
  }
}

function loadStoredAutomationWorkflowRuns(): AutomationWorkflowRun[] {
  const raw = window.localStorage.getItem(AUTOMATION_WORKFLOW_RUNS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<AutomationWorkflowRun>[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((run) => ({
      id: run.id ?? createId("wf-run"),
      workflowId: run.workflowId ?? "",
      workflowName: run.workflowName ?? "工作流",
      triggerSource: run.triggerSource ?? "manual",
      workspaceId: run.workspaceId ?? "",
      projectRoot: run.projectRoot ?? "",
      projectName: run.projectName ?? "workspace",
      status: run.status ?? "scheduled",
      statusSummary: run.statusSummary ?? null,
      scheduledStartAt: run.scheduledStartAt ?? null,
      sharedTerminalTabId: run.sharedTerminalTabId ?? createId("wf-tab"),
      entryNodeId: run.entryNodeId ?? "",
      currentNodeId: run.currentNodeId ?? null,
      emailNotificationEnabled: run.emailNotificationEnabled === true,
      cliSessions: run.cliSessions ?? [],
      nodeRuns: (run.nodeRuns ?? []).map((nodeRun, index) => ({
        id: nodeRun.id ?? createId("wf-node-run"),
        workflowRunId: nodeRun.workflowRunId ?? run.id ?? createId("wf-run"),
        nodeId: nodeRun.nodeId ?? "",
        label: nodeRun.label ?? `节点 ${index + 1}`,
        goal: nodeRun.goal ?? "",
        automationRunId: nodeRun.automationRunId ?? null,
        status: nodeRun.status ?? "queued",
        branchResult: nodeRun.branchResult ?? null,
        usedCli: nodeRun.usedCli ?? null,
        transportSession: nodeRun.transportSession ?? null,
        statusSummary: nodeRun.statusSummary ?? null,
        startedAt: nodeRun.startedAt ?? null,
        completedAt: nodeRun.completedAt ?? null,
        updatedAt: nodeRun.updatedAt ?? nowISO(),
      })),
      events: run.events ?? [],
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      createdAt: run.createdAt ?? nowISO(),
      updatedAt: run.updatedAt ?? nowISO(),
    }));
  } catch {
    return [];
  }
}

function defaultAutomationRuleProfile(): AutomationRuleProfile {
  return {
    id: "safe-autonomy-v1",
    label: "Safe Autonomy",
    allowAutoSelectStrategy: true,
    allowSafeWorkspaceEdits: true,
    allowSafeChecks: true,
    pauseOnCredentials: true,
    pauseOnExternalInstalls: true,
    pauseOnDestructiveCommands: true,
    pauseOnGitPush: true,
    maxRoundsPerGoal: 3,
    maxConsecutiveFailures: 2,
    maxNoProgressRounds: 1,
  };
}

function normalizeAutomationPermissionProfile(value?: string | null): AutomationPermissionProfile {
  return value === "full-access" || value === "read-only" ? value : "standard";
}

function normalizeAutomationRuleProfile(profile: AutomationRuleProfile): AutomationRuleProfile {
  const defaults = defaultAutomationRuleProfile();
  return {
    ...defaults,
    ...profile,
    id: profile.id?.trim() ? profile.id : defaults.id,
    label: profile.label?.trim() ? profile.label : defaults.label,
    maxRoundsPerGoal: Math.min(8, Math.max(1, Number(profile.maxRoundsPerGoal) || defaults.maxRoundsPerGoal)),
    maxConsecutiveFailures: Math.min(
      5,
      Math.max(1, Number(profile.maxConsecutiveFailures) || defaults.maxConsecutiveFailures)
    ),
    maxNoProgressRounds: Math.min(5, Math.max(0, Number(profile.maxNoProgressRounds) || defaults.maxNoProgressRounds)),
  };
}

function loadStoredAutomationRuleProfile(): AutomationRuleProfile {
  const raw = window.localStorage.getItem(AUTOMATION_RULE_KEY);
  if (!raw) return defaultAutomationRuleProfile();
  try {
    return normalizeAutomationRuleProfile(JSON.parse(raw) as AutomationRuleProfile);
  } catch {
    return defaultAutomationRuleProfile();
  }
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

function persistTerminalState(state: PersistedTerminalState) {
  window.localStorage.setItem(TERMINAL_STATE_KEY, JSON.stringify(state));
}

function persistAutomationJobs() {
  window.localStorage.setItem(AUTOMATION_JOBS_KEY, JSON.stringify(automationJobs));
}

function persistAutomationRuns() {
  window.localStorage.setItem(AUTOMATION_RUNS_KEY, JSON.stringify(automationRuns));
}

function persistAutomationWorkflows() {
  window.localStorage.setItem(AUTOMATION_WORKFLOWS_KEY, JSON.stringify(automationWorkflows));
}

function persistAutomationWorkflowRuns() {
  window.localStorage.setItem(
    AUTOMATION_WORKFLOW_RUNS_KEY,
    JSON.stringify(automationWorkflowRuns)
  );
}

function persistAutomationRuleProfile() {
  window.localStorage.setItem(AUTOMATION_RULE_KEY, JSON.stringify(automationRuleProfile));
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

function providerSettingsKey(serviceType: ModelProviderServiceType) {
  switch (serviceType) {
    case "openaiCompatible":
      return "openaiCompatibleProviders" as const;
    case "claude":
      return "claudeProviders" as const;
    case "gemini":
      return "geminiProviders" as const;
    default:
      return "openaiCompatibleProviders" as const;
  }
}

function getProvidersForServiceType(
  currentSettings: AppSettings,
  serviceType: ModelProviderServiceType
) {
  return currentSettings[providerSettingsKey(serviceType)];
}

function setProvidersForServiceType(
  currentSettings: AppSettings,
  serviceType: ModelProviderServiceType,
  providers: ModelProviderConfig[]
): AppSettings {
  return normalizeProviderSettings({
    ...currentSettings,
    [providerSettingsKey(serviceType)]: providers,
  });
}

function defaultBrowserModels(serviceType: ModelProviderServiceType) {
  return defaultModelsForServiceType(serviceType);
}

function getProviderById(
  currentSettings: AppSettings,
  serviceType: ModelProviderServiceType,
  providerId: string
) {
  return getProvidersForServiceType(currentSettings, serviceType).find(
    (provider) => provider.id === providerId
  );
}

function basename(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function pickBrowserChatAttachments(): Promise<PickedChatAttachment[]> {
  if (typeof document === "undefined") {
    return [];
  }

  return new Promise<PickedChatAttachment[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.position = "fixed";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);
    let settled = false;

    const cleanup = () => {
      input.value = "";
      input.remove();
    };

    const settle = (value: PickedChatAttachment[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        void Promise.all(
          files.map(async (file) => {
            const mediaType = file.type || null;
            if (mediaType?.startsWith("image/")) {
              return {
                fileName: file.name,
                mediaType,
                source: await readFileAsDataUrl(file),
              } satisfies PickedChatAttachment;
            }
            return {
              fileName: file.name,
                mediaType,
                source: file.name,
              } satisfies PickedChatAttachment;
          })
        )
          .then((items) => settle(items))
          .catch(() => settle([]));
      },
      { once: true }
    );

    window.addEventListener(
      "focus",
      () => {
        window.setTimeout(() => {
          if (settled) return;
          settle([]);
        }, 0);
      },
      { once: true }
    );

    input.click();
  });
}

function pushAutomationEvent(
  run: AutomationRun,
  level: "info" | "success" | "warning" | "error",
  title: string,
  detail: string,
  goalId?: string | null
) {
  run.events.unshift({
    id: createId("auto-event"),
    runId: run.id,
    goalId: goalId ?? null,
    level,
    title,
    detail,
    createdAt: nowISO(),
  });
  run.events = run.events.slice(0, 200);
}

function pushWorkflowEvent(
  run: AutomationWorkflowRun,
  level: "info" | "success" | "warning" | "error",
  title: string,
  detail: string,
  nodeId?: string | null
) {
  run.events.unshift({
    id: createId("wf-event"),
    runId: run.id,
    goalId: nodeId ?? null,
    level,
    title,
    detail,
    createdAt: nowISO(),
  });
  run.events = run.events.slice(0, 200);
}

function deriveAutomationGoalTitle(raw: string) {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return "Untitled goal";
  return compact.length <= 64 ? compact : `${compact.slice(0, 63).trimEnd()}…`;
}

function createAutomationGoal(runId: string, draft: AutomationGoalDraft, position: number): AutomationGoal {
  return {
    id: createId("auto-goal"),
    runId,
    title: draft.title?.trim() || deriveAutomationGoalTitle(draft.goal),
    goal: draft.goal,
    expectedOutcome: draft.expectedOutcome,
    executionMode: draft.executionMode ?? "auto",
    lifecycleStatus: "queued",
    outcomeStatus: "unknown",
    attentionStatus: "none",
    resolutionCode: "queued",
    statusSummary: "Waiting to start.",
    objectiveSignals: { exitCode: null, checksPassed: false, checksFailed: false, artifactsProduced: false, filesChanged: 0, policyBlocks: [] },
    judgeAssessment: { madeProgress: false, expectedOutcomeMet: false, suggestedDecision: null, reason: null },
    validationResult: {
      decision: null,
      reason: null,
      feedback: null,
      evidenceSummary: null,
      missingChecks: [],
      verificationSteps: [],
      madeProgress: false,
      expectedOutcomeMet: false,
    },
    status: "queued",
    position,
    roundCount: 0,
    consecutiveFailureCount: 0,
    noProgressRounds: 0,
    ruleConfig: normalizeAutomationGoalRuleConfig(draft.ruleConfig ?? defaultAutomationRuleProfile()),
    lastOwnerCli: null,
    resultSummary: null,
    latestProgressSummary: null,
    nextInstruction: null,
    requiresAttentionReason: null,
    relevantFiles: [],
    syntheticTerminalTabId: createId("auto-tab"),
    lastExitCode: null,
    startedAt: null,
    completedAt: null,
    updatedAt: nowISO(),
  };
}

function normalizeAutomationGoalRuleConfig(config: AutomationGoalRuleConfig): AutomationGoalRuleConfig {
  const defaults = defaultAutomationRuleProfile();
  return {
    allowAutoSelectStrategy: config.allowAutoSelectStrategy ?? defaults.allowAutoSelectStrategy,
    allowSafeWorkspaceEdits: config.allowSafeWorkspaceEdits ?? defaults.allowSafeWorkspaceEdits,
    allowSafeChecks: config.allowSafeChecks ?? defaults.allowSafeChecks,
    pauseOnCredentials: config.pauseOnCredentials ?? defaults.pauseOnCredentials,
    pauseOnExternalInstalls: config.pauseOnExternalInstalls ?? defaults.pauseOnExternalInstalls,
    pauseOnDestructiveCommands: config.pauseOnDestructiveCommands ?? defaults.pauseOnDestructiveCommands,
    pauseOnGitPush: config.pauseOnGitPush ?? defaults.pauseOnGitPush,
    maxRoundsPerGoal: Math.min(8, Math.max(1, Number(config.maxRoundsPerGoal) || defaults.maxRoundsPerGoal)),
    maxConsecutiveFailures: Math.min(5, Math.max(1, Number(config.maxConsecutiveFailures) || defaults.maxConsecutiveFailures)),
    maxNoProgressRounds: Math.min(5, Math.max(0, Number(config.maxNoProgressRounds) || defaults.maxNoProgressRounds)),
  };
}

function summarizeBrowserRun(run: AutomationRun) {
  const completed = run.goals.filter((goal) => goal.status === "completed").length;
  const failed = run.goals.filter((goal) => goal.status === "failed").length;
  const blocked = run.goals.filter((goal) => goal.status === "paused").length;
  return `${completed}/${run.goals.length} completed • ${failed} failed • ${blocked} blocked`;
}

function inferBrowserGoalStatus(goal: AutomationGoal): AutomationGoalStatus {
  const text = `${goal.goal}\n${goal.expectedOutcome}`.toLowerCase();
  if (/approval|confirm|credential|login|manual/.test(text)) return "paused";
  if (/fail|broken|error/.test(text)) return "failed";
  return "completed";
}

function getPrimaryGoal(run: AutomationRun): AutomationGoal | null {
  return [...run.goals].sort((left, right) => left.position - right.position)[0] ?? null;
}

function toAutomationRunRecord(run: AutomationRun): AutomationRunRecord {
  const goal = getPrimaryGoal(run);
  const displayStatus =
    run.lifecycleStatus === "validating"
      ? "validating"
      : run.attentionStatus && run.attentionStatus !== "none"
        ? "blocked"
        : run.lifecycleStatus === "queued"
          ? "scheduled"
          : run.lifecycleStatus === "finished" && run.outcomeStatus === "success"
            ? "completed"
            : run.lifecycleStatus === "finished" && run.outcomeStatus === "failed"
              ? "failed"
              : run.lifecycleStatus === "stopped" && run.attentionStatus === "none"
                ? "cancelled"
                : run.lifecycleStatus === "running"
                  ? "running"
                  : "unknown";
  return {
    id: run.id,
    jobId: run.jobId ?? null,
    jobName: run.jobName ?? goal?.title ?? run.projectName,
    projectName: run.projectName,
    projectRoot: run.projectRoot,
    workspaceId: run.workspaceId,
    executionMode: goal?.executionMode ?? "auto",
    permissionProfile: normalizeAutomationPermissionProfile(run.permissionProfile),
    triggerSource: run.triggerSource ?? "manual",
    runNumber: run.runNumber ?? null,
    status: run.status,
    displayStatus,
    lifecycleStatus: run.lifecycleStatus ?? "queued",
    outcomeStatus: run.outcomeStatus ?? "unknown",
    attentionStatus: run.attentionStatus ?? "none",
    resolutionCode: run.resolutionCode ?? "not_evaluated",
    statusSummary: run.statusSummary ?? null,
    summary: run.summary ?? null,
    requiresAttentionReason: goal?.requiresAttentionReason ?? null,
    objectiveSignals: run.objectiveSignals ?? {
      exitCode: null,
      checksPassed: false,
      checksFailed: false,
      artifactsProduced: false,
      filesChanged: 0,
      policyBlocks: [],
    },
    judgeAssessment: run.judgeAssessment ?? {
      madeProgress: false,
      expectedOutcomeMet: false,
      suggestedDecision: null,
      reason: null,
    },
    validationResult: run.validationResult ?? {
      decision: null,
      reason: null,
      feedback: null,
      evidenceSummary: null,
      missingChecks: [],
      verificationSteps: [],
      madeProgress: false,
      expectedOutcomeMet: false,
    },
    relevantFiles: goal?.relevantFiles ?? [],
    lastExitCode: goal?.lastExitCode ?? null,
    terminalTabId: goal?.syntheticTerminalTabId ?? null,
    parameterValues: normalizeAutomationParameterValues(run.parameterValues),
    scheduledStartAt: run.scheduledStartAt ?? null,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function toAutomationRunDetail(run: AutomationRun): AutomationRunDetail {
  const goal = getPrimaryGoal(run);
  const runRecord = toAutomationRunRecord(run);
  const job = run.jobId ? automationJobs.find((item) => item.id === run.jobId) ?? null : null;
  const messageContent = [
    runRecord.summary ? `Summary: ${runRecord.summary}` : null,
    runRecord.validationResult?.reason ? `Validation: ${runRecord.validationResult.reason}` : null,
    runRecord.validationResult?.feedback ? `Feedback: ${runRecord.validationResult.feedback}` : null,
    goal?.requiresAttentionReason ? `Attention: ${goal.requiresAttentionReason}` : null,
  ].filter(Boolean).join("\n");

  return {
    run: runRecord,
    job,
    ruleConfig: goal?.ruleConfig ?? defaultAutomationRuleProfile(),
    goal: goal?.goal ?? "",
    expectedOutcome: goal?.expectedOutcome ?? "",
    events: structuredClone(run.events),
    conversationSession: goal
      ? {
          id: `session-${goal.syntheticTerminalTabId}`,
          terminalTabId: goal.syntheticTerminalTabId,
          workspaceId: run.workspaceId,
          projectRoot: run.projectRoot,
          projectName: run.projectName,
          messages: [
            {
              id: createId("msg"),
              role: "assistant",
              cliId: goal.lastOwnerCli ?? "codex",
              timestamp: run.updatedAt,
              content: messageContent || "Browser fallback did not capture detailed logs for this run.",
              rawContent: null,
              contentFormat: "plain",
              transportKind: "browser-fallback",
              blocks: null,
              isStreaming: false,
              durationMs: null,
              exitCode: goal.lastExitCode ?? null,
            },
          ],
          compactedSummaries: [],
          lastCompactedAt: null,
          estimatedTokens: 0,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        }
      : null,
    taskContext: null,
  };
}

function toAutomationWorkflowRunDetail(
  run: AutomationWorkflowRun
): AutomationWorkflowRunDetail {
  return {
    run: structuredClone(run),
    workflow:
      structuredClone(
        automationWorkflows.find((item) => item.id === run.workflowId) ?? null
      ) ?? null,
    childRuns: automationRuns
      .filter((item) => item.workflowRunId === run.id)
      .map((item) => toAutomationRunRecord(item))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    conversationSession: null,
    taskContext: null,
  };
}

function scheduleBrowserAutomationRun(runId: string) {
  const run = automationRuns.find((item) => item.id === runId);
  if (!run || run.status !== "scheduled") return;

  const scheduledMs = run.scheduledStartAt ? Date.parse(run.scheduledStartAt) : Date.now();
  const waitMs = Number.isFinite(scheduledMs) ? Math.max(0, scheduledMs - Date.now()) : 0;

  window.setTimeout(() => {
    const target = automationRuns.find((item) => item.id === runId);
    if (!target || target.status !== "scheduled") return;
    target.status = "running";
    target.startedAt = target.startedAt ?? nowISO();
    target.updatedAt = nowISO();
    pushAutomationEvent(target, "info", "Run started", "Browser fallback started the automation run.");
    persistAutomationRuns();

    let offset = 400;
    target.goals
      .filter((goal) => goal.status === "queued")
      .sort((left, right) => left.position - right.position)
      .forEach((goal) => {
        window.setTimeout(() => {
          const liveRun = automationRuns.find((item) => item.id === runId);
          const liveGoal = liveRun?.goals.find((item) => item.id === goal.id);
          if (!liveRun || !liveGoal || liveRun.status === "cancelled") return;

          const nextStatus = inferBrowserGoalStatus(liveGoal);
          liveGoal.status = nextStatus;
          liveGoal.roundCount = Math.min(automationRuleProfile.maxRoundsPerGoal, liveGoal.roundCount + 1);
          liveGoal.lastOwnerCli = /ui|design|css|frontend/i.test(liveGoal.goal) ? "gemini" : "codex";
          liveGoal.resultSummary =
            nextStatus === "completed"
              ? "Browser fallback marked this goal as completed."
              : nextStatus === "paused"
                ? "Browser fallback paused this goal for manual attention."
                : "Browser fallback marked this goal as failed.";
          liveGoal.latestProgressSummary = liveGoal.resultSummary;
          liveGoal.nextInstruction = nextStatus === "completed" ? null : "Review this goal in the desktop runtime.";
          liveGoal.requiresAttentionReason =
            nextStatus === "paused" ? "Needs human review in browser fallback mode." : null;
          liveGoal.lastExitCode = nextStatus === "completed" ? 0 : 1;
          liveGoal.startedAt = liveGoal.startedAt ?? nowISO();
          liveGoal.completedAt = nowISO();
          liveGoal.updatedAt = nowISO();
          pushAutomationEvent(
            liveRun,
            nextStatus === "completed" ? "success" : nextStatus === "paused" ? "warning" : "error",
            nextStatus === "completed" ? "Goal completed" : nextStatus === "paused" ? "Goal paused" : "Goal failed",
            liveGoal.resultSummary,
            liveGoal.id
          );

          const remainingQueued = liveRun.goals.some((item) => item.status === "queued");
          if (!remainingQueued) {
            liveRun.status = liveRun.goals.some((item) => item.status === "paused")
              ? "paused"
              : liveRun.goals.some((item) => item.status === "failed")
                ? "failed"
                : "completed";
            liveRun.completedAt = nowISO();
            liveRun.summary = summarizeBrowserRun(liveRun);
            pushAutomationEvent(
              liveRun,
              liveRun.status === "completed" ? "success" : "warning",
              liveRun.status === "completed" ? "Run completed" : "Run finished",
              liveRun.summary
            );
          }

          persistAutomationRuns();
        }, offset);
        offset += 600;
      });
  }, waitMs);
}

function workflowNodeById(
  workflow: AutomationWorkflow,
  nodeId: string
): AutomationWorkflowNode | null {
  return workflow.nodes.find((node) => node.id === nodeId) ?? null;
}

function workflowNextNodeId(
  workflow: AutomationWorkflow,
  nodeId: string,
  branchResult: "success" | "fail"
) {
  return (
    workflow.edges.find(
      (edge) => edge.fromNodeId === nodeId && edge.on === branchResult
    )?.toNodeId ?? null
  );
}

function workflowNodeTerminalStatus(
  node: AutomationWorkflowNode,
  status: AutomationRunStatus
) {
  switch (status) {
    case "paused":
      return `Workflow paused after \`${node.label}\` requested manual attention.`;
    case "failed":
      return `Workflow stopped after \`${node.label}\` failed.`;
    default:
      return "Workflow completed successfully.";
  }
}

function workflowNodeEffectiveExecutionMode(
  workflow: AutomationWorkflow,
  node: AutomationWorkflowNode
) {
  return (node.executionMode === "inherit"
    ? workflow.defaultExecutionMode
    : node.executionMode) as "auto" | AgentId;
}

function workflowNodeEffectivePermissionProfile(
  workflow: AutomationWorkflow,
  node: AutomationWorkflowNode
) {
  return node.permissionProfile === "inherit"
    ? workflow.defaultPermissionProfile
    : node.permissionProfile;
}

function createBrowserWorkflowChildRun(
  workflowRun: AutomationWorkflowRun,
  workflow: AutomationWorkflow,
  node: AutomationWorkflowNode
) {
  const runId = createId("auto-run");
  const executionMode = workflowNodeEffectiveExecutionMode(workflow, node);
  const goal = createAutomationGoal(
    runId,
    {
      title: node.label,
      goal: node.goal,
      expectedOutcome: node.expectedOutcome,
      executionMode,
      ruleConfig: defaultAutomationRuleProfile(),
    },
    0
  );
  goal.syntheticTerminalTabId = workflowRun.sharedTerminalTabId;
  const inferred = inferBrowserGoalStatus(goal);
  const finalStatus =
    inferred === "completed" ? "completed" : inferred === "paused" ? "paused" : "failed";
  goal.status = inferred;
  goal.lifecycleStatus = inferred === "paused" ? "stopped" : "finished";
  goal.outcomeStatus =
    inferred === "completed" ? "success" : inferred === "paused" ? "partial" : "failed";
  goal.attentionStatus = inferred === "paused" ? "waiting_human" : "none";
  goal.resolutionCode =
    inferred === "completed"
      ? "objective_checks_passed"
      : inferred === "paused"
        ? "waiting_human"
        : "objective_checks_failed";
  goal.statusSummary =
    inferred === "completed"
      ? "Browser fallback marked this workflow node as completed."
      : inferred === "paused"
        ? "Browser fallback marked this workflow node as needing manual attention."
        : "Browser fallback marked this workflow node as failed.";
  goal.roundCount = 1;
  goal.lastOwnerCli = executionMode === "auto" ? "codex" : executionMode;
  goal.resultSummary = goal.statusSummary;
  goal.latestProgressSummary = goal.statusSummary;
  goal.nextInstruction = inferred === "completed" ? null : "Review this workflow node in the desktop runtime.";
  goal.requiresAttentionReason =
    inferred === "paused" ? "Needs human review in browser fallback mode." : null;
  goal.lastExitCode = inferred === "completed" ? 0 : 1;
  goal.startedAt = nowISO();
  goal.completedAt = nowISO();
  goal.updatedAt = nowISO();

  const run: AutomationRun = {
    id: runId,
    jobId: null,
    jobName: node.label,
    triggerSource: "workflow",
    runNumber: null,
    workflowRunId: workflowRun.id,
    workflowNodeId: node.id,
    permissionProfile: workflowNodeEffectivePermissionProfile(workflow, node),
    parameterValues: {},
    workspaceId: workflow.workspaceId,
    projectRoot: workflow.projectRoot,
    projectName: workflow.projectName,
    ruleProfileId: "safe-autonomy-v1",
    lifecycleStatus: inferred === "paused" ? "stopped" : "finished",
    outcomeStatus: inferred === "completed" ? "success" : inferred === "paused" ? "partial" : "failed",
    attentionStatus: inferred === "paused" ? "waiting_human" : "none",
    resolutionCode:
      inferred === "completed"
        ? "objective_checks_passed"
        : inferred === "paused"
          ? "waiting_human"
          : "objective_checks_failed",
    statusSummary: goal.statusSummary,
    objectiveSignals: {
      exitCode: goal.lastExitCode,
      checksPassed: inferred === "completed",
      checksFailed: inferred === "failed",
      artifactsProduced: false,
      filesChanged: 0,
      policyBlocks: inferred === "paused" ? ["waiting_human"] : [],
    },
    judgeAssessment: {
      madeProgress: inferred === "completed" || inferred === "paused",
      expectedOutcomeMet: inferred === "completed",
      suggestedDecision:
        inferred === "completed" ? "pass" : inferred === "paused" ? "blocked" : "fail_with_feedback",
      reason: goal.statusSummary,
    },
    validationResult: {
      decision:
        inferred === "completed" ? "pass" : inferred === "paused" ? "blocked" : "fail_with_feedback",
      reason: goal.statusSummary,
      feedback: inferred === "completed" ? null : "Review this node in the desktop runtime.",
      evidenceSummary: goal.statusSummary,
      missingChecks: inferred === "completed" ? [] : [node.expectedOutcome],
      verificationSteps:
        inferred === "completed" ? [] : ["Open the desktop runtime to continue this workflow node."],
      madeProgress: inferred === "completed" || inferred === "paused",
      expectedOutcomeMet: inferred === "completed",
    },
    status: finalStatus,
    scheduledStartAt: workflowRun.scheduledStartAt ?? nowISO(),
    startedAt: goal.startedAt,
    completedAt: goal.completedAt,
    summary: goal.statusSummary,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    goals: [goal],
    events: [],
  };

  pushAutomationEvent(
    run,
    inferred === "completed" ? "success" : "warning",
    inferred === "completed"
      ? "Workflow node completed"
      : inferred === "paused"
        ? "Workflow node paused"
        : "Workflow node failed",
    goal.statusSummary ?? "Workflow node finished."
  );

  automationRuns = [run, ...automationRuns];
  persistAutomationRuns();
  return run;
}

function scheduleBrowserWorkflowRun(runId: string) {
  const run = automationWorkflowRuns.find((item) => item.id === runId);
  if (!run || run.status !== "scheduled") return;

  const scheduledMs = run.scheduledStartAt ? Date.parse(run.scheduledStartAt) : Date.now();
  const waitMs = Number.isFinite(scheduledMs) ? Math.max(0, scheduledMs - Date.now()) : 0;

  window.setTimeout(() => {
    const liveRun = automationWorkflowRuns.find((item) => item.id === runId);
    if (!liveRun || liveRun.status !== "scheduled") return;
    const workflow = automationWorkflows.find((item) => item.id === liveRun.workflowId);
    if (!workflow) {
      liveRun.status = "failed";
      liveRun.statusSummary = "Workflow definition no longer exists.";
      liveRun.completedAt = nowISO();
      liveRun.updatedAt = nowISO();
      pushWorkflowEvent(liveRun, "error", "Workflow failed", liveRun.statusSummary);
      persistAutomationWorkflowRuns();
      return;
    }

    liveRun.status = "running";
    liveRun.startedAt = liveRun.startedAt ?? nowISO();
    liveRun.updatedAt = nowISO();
    pushWorkflowEvent(liveRun, "info", "Workflow started", "Browser fallback started the workflow run.");
    persistAutomationWorkflowRuns();

    const runNext = (nodeId: string | null) => {
      const currentRun = automationWorkflowRuns.find((item) => item.id === runId);
      const currentWorkflow = automationWorkflows.find((item) => item.id === liveRun.workflowId);
      if (!currentRun || !currentWorkflow) return;
      if (currentRun.status === "cancelled") return;
      if (!nodeId) {
        currentRun.status = "completed";
        currentRun.currentNodeId = null;
        currentRun.completedAt = nowISO();
        currentRun.updatedAt = nowISO();
        currentRun.statusSummary = "Workflow completed successfully.";
        pushWorkflowEvent(currentRun, "success", "Workflow completed", currentRun.statusSummary);
        persistAutomationWorkflowRuns();
        return;
      }

      const node = workflowNodeById(currentWorkflow, nodeId);
      if (!node) {
        currentRun.status = "failed";
        currentRun.currentNodeId = null;
        currentRun.completedAt = nowISO();
        currentRun.updatedAt = nowISO();
        currentRun.statusSummary = "The next workflow node definition is missing.";
        pushWorkflowEvent(currentRun, "error", "Workflow failed", currentRun.statusSummary);
        persistAutomationWorkflowRuns();
        return;
      }
      const nodeRun = currentRun.nodeRuns.find((item) => item.nodeId === node.id);
      if (!nodeRun) {
        currentRun.status = "failed";
        currentRun.currentNodeId = null;
        currentRun.completedAt = nowISO();
        currentRun.updatedAt = nowISO();
        currentRun.statusSummary = "The selected workflow node could not be resolved.";
        pushWorkflowEvent(currentRun, "error", "Workflow failed", currentRun.statusSummary, node.id);
        persistAutomationWorkflowRuns();
        return;
      }

      currentRun.currentNodeId = node.id;
      currentRun.status = "running";
      currentRun.statusSummary = `Running workflow node \`${node.label}\`.`;
      currentRun.updatedAt = nowISO();
      nodeRun.status = "running";
      nodeRun.statusSummary = "Executing linked automation job.";
      nodeRun.startedAt = nodeRun.startedAt ?? nowISO();
      nodeRun.updatedAt = nowISO();
      pushWorkflowEvent(currentRun, "info", "Workflow node started", `Running node \`${node.label}\`.`, node.id);
      persistAutomationWorkflowRuns();

      window.setTimeout(() => {
        const childRun = createBrowserWorkflowChildRun(currentRun, currentWorkflow, node);
        const childGoal = childRun.goals[0];
        const branchResult = childRun.status === "completed" ? "success" : childRun.status === "failed" ? "fail" : null;
        nodeRun.automationRunId = childRun.id;
        nodeRun.status = childRun.status;
        nodeRun.branchResult = branchResult;
        nodeRun.usedCli = childGoal.lastOwnerCli;
        nodeRun.statusSummary = childRun.statusSummary ?? childRun.summary ?? null;
        nodeRun.completedAt = nowISO();
        nodeRun.updatedAt = nowISO();
        if (childGoal.lastOwnerCli) {
          currentRun.cliSessions = [
            ...currentRun.cliSessions.filter((entry) => entry.cliId !== childGoal.lastOwnerCli),
            {
              cliId: childGoal.lastOwnerCli,
              kind: "browser-fallback",
              threadId: `${currentRun.id}:${childGoal.lastOwnerCli}`,
              turnId: childRun.id,
              model: null,
              permissionMode: null,
              lastSyncAt: nowISO(),
            },
          ];
        }

        if (childRun.status === "paused") {
          currentRun.currentNodeId = node.id;
          currentRun.status = "paused";
          currentRun.updatedAt = nowISO();
          currentRun.statusSummary = `Node \`${node.label}\` needs manual attention before the workflow can continue.`;
          pushWorkflowEvent(
            currentRun,
            "warning",
            "Workflow paused",
            currentRun.statusSummary,
            node.id
          );
          persistAutomationWorkflowRuns();
          return;
        }

        if (!branchResult) {
          currentRun.currentNodeId = null;
          currentRun.status = "failed";
          currentRun.completedAt = nowISO();
          currentRun.updatedAt = nowISO();
          currentRun.statusSummary = `Workflow stopped after \`${node.label}\` returned an unsupported status.`;
          pushWorkflowEvent(currentRun, "error", "Workflow failed", currentRun.statusSummary, node.id);
          persistAutomationWorkflowRuns();
          return;
        }

        const nextNodeId = workflowNextNodeId(currentWorkflow, node.id, branchResult);
        if (nextNodeId) {
          currentRun.currentNodeId = nextNodeId;
          currentRun.status = "running";
          currentRun.updatedAt = nowISO();
          currentRun.statusSummary =
            branchResult === "success"
              ? `Node \`${node.label}\` completed. Continuing to the next node.`
              : `Node \`${node.label}\` failed. Routing to the fail branch.`;
          pushWorkflowEvent(
            currentRun,
            branchResult === "success" ? "success" : "warning",
            branchResult === "success" ? "Workflow node completed" : "Workflow node failed",
            currentRun.statusSummary,
            node.id
          );
          persistAutomationWorkflowRuns();
          runNext(nextNodeId);
          return;
        }

        const terminalStatus: AutomationRunStatus =
          branchResult === "success" ? "completed" : "failed";
        currentRun.currentNodeId = null;
        currentRun.status = terminalStatus;
        currentRun.completedAt = nowISO();
        currentRun.updatedAt = nowISO();
        currentRun.statusSummary = workflowNodeTerminalStatus(node, terminalStatus);
        pushWorkflowEvent(
          currentRun,
          branchResult === "success" ? "success" : "error",
          branchResult === "success" ? "Workflow completed" : "Workflow failed",
          currentRun.statusSummary,
          node.id
        );
        persistAutomationWorkflowRuns();
      }, 550);
    };

    runNext(liveRun.currentNodeId ?? liveRun.entryNodeId);
  }, waitMs);
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

function emitApiChatStream(event: ApiChatStreamEvent) {
  apiChatStreamListeners.forEach((listener) => listener(event));
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
  async loadAppState(projectRoot?: string, _refreshRuntime?: boolean) {
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

  async onApiChatStream(listener: ApiChatStreamListener) {
    apiChatStreamListeners.add(listener);
    return () => {
      apiChatStreamListeners.delete(listener);
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
    settings = normalizeSettings(newSettings);
    contextStore.maxTurnsPerAgent = settings.maxTurnsPerAgent;
    contextStore.maxOutputCharsPerTurn = settings.maxOutputCharsPerTurn;
    persistSettings();
    persistContext();
    return structuredClone(settings);
  },

  async refreshProviderModels(serviceType: ModelProviderServiceType, providerId: string) {
    const provider = getProviderById(settings, serviceType, providerId);
    if (!provider) {
      throw new Error("Provider not found.");
    }

    const refreshedProvider: ModelProviderConfig = {
      ...provider,
      models: provider.models.length > 0 ? provider.models : defaultBrowserModels(serviceType),
      updatedAt: nowISO(),
      lastRefreshedAt: nowISO(),
    };

    settings = setProvidersForServiceType(
      settings,
      serviceType,
      getProvidersForServiceType(settings, serviceType).map((item) =>
        item.id === providerId ? refreshedProvider : item
      )
    );
    persistSettings();
    return structuredClone(refreshedProvider);
  },

  async sendApiChatMessage(request: ApiChatRequest) {
    const provider = getProviderById(
      settings,
      request.selection.serviceType,
      request.selection.providerId
    );
    if (!provider) {
      throw new Error("Enabled provider not found.");
    }
    const startedAt = Date.now();

    const prompt =
      [...request.messages]
        .reverse()
        .find((message) => message.role === "user")
        ?.content.trim() ?? "";

    const rawContent = [
      `<think>The user asked for a browser fallback response for ${request.selection.serviceType}.`,
      `This environment simulates provider output and streams it locally.</think>`,
      "",
      `# Browser fallback`,
      "",
      `Provider: **${provider.name}**`,
      `Model: \`${request.selection.modelId}\``,
      "",
      prompt ? `Latest prompt: ${prompt}` : "Latest prompt: (empty)",
    ].join("\n");
    const parsed = parseApiAssistantContent(rawContent);

    const messageId = createId("api-msg");

    if (request.streamId) {
      const chunks = rawContent.match(/.{1,42}(\s+|$)|.+$/g) ?? [rawContent];
      let streamedRaw = "";
      for (const chunk of chunks) {
        streamedRaw += chunk;
        const snapshot = parseApiAssistantContent(streamedRaw);
        emitApiChatStream({
          streamId: request.streamId,
          messageId,
          chunk,
          done: false,
          rawContent: snapshot.rawContent,
          content: snapshot.content,
          contentFormat: snapshot.contentFormat,
          blocks: snapshot.blocks,
        });
        await new Promise((resolve) => window.setTimeout(resolve, 35));
      }
      emitApiChatStream({
        streamId: request.streamId,
        messageId,
        chunk: "",
        done: true,
        rawContent: parsed.rawContent,
        content: parsed.content,
        contentFormat: parsed.contentFormat,
        blocks: parsed.blocks,
        durationMs: Date.now() - startedAt,
        promptTokens: Math.max(
          1,
          Math.round(request.messages.reduce((sum, message) => sum + message.content.length, 0) / 4)
        ),
        completionTokens: Math.max(1, Math.round(parsed.rawContent.length / 4)),
        totalTokens:
          Math.max(
            1,
            Math.round(request.messages.reduce((sum, message) => sum + message.content.length, 0) / 4)
          ) + Math.max(1, Math.round(parsed.rawContent.length / 4)),
      });
    }

    const durationMs = Date.now() - startedAt;
    const promptTokens = Math.max(1, Math.round(request.messages.reduce((sum, message) => sum + message.content.length, 0) / 4));
    const completionTokens = Math.max(1, Math.round(parsed.rawContent.length / 4));
    const totalTokens = promptTokens + completionTokens;

    const response: ApiChatResponse = {
      selection: request.selection,
      message: {
        id: messageId,
        role: "assistant",
        timestamp: nowISO(),
        content: parsed.content,
        generationMeta: {
          ...request.selection,
          providerName: provider.name,
          modelLabel:
            provider.models.find((model) => model.id === request.selection.modelId)?.label ??
            provider.models.find((model) => model.id === request.selection.modelId)?.name ??
            request.selection.modelId,
          requestedAt: new Date(startedAt).toISOString(),
          completedAt: nowISO(),
        },
        rawContent: parsed.rawContent,
        contentFormat: parsed.contentFormat,
        blocks: parsed.blocks,
        durationMs,
        promptTokens,
        completionTokens,
        totalTokens,
      },
    };

    return structuredClone(response);
  },

  async sendTestEmailNotification(config: NotificationConfig) {
    const normalized = normalizeNotificationConfig(config);
    if (!normalized.smtpEnabled) {
      throw new Error("SMTP is disabled.");
    }
    if (!normalized.smtpHost.trim()) {
      throw new Error("SMTP host is required.");
    }
    if (!normalized.smtpUsername.trim()) {
      throw new Error("SMTP username is required.");
    }
    if (!normalized.smtpPassword.trim()) {
      throw new Error("SMTP password is required.");
    }
    if (!normalized.smtpFrom.trim()) {
      throw new Error("Sender email is required.");
    }
    if (normalized.emailRecipients.length === 0) {
      throw new Error("At least one recipient is required.");
    }
    return `Browser fallback simulated a test email to ${normalized.emailRecipients.join(", ")}.`;
  },

  async loadTerminalState() {
    return structuredClone(loadStoredTerminalState());
  },

  async loadTerminalSession(terminalTabId: string) {
    const state = loadStoredTerminalState();
    return structuredClone(state?.chatSessions?.[terminalTabId] ?? null);
  },

  async saveTerminalState(nextState: PersistedTerminalState) {
    persistTerminalState(nextState);
  },
  async switchCliForTask(_request: CliHandoffRequest) {
    return;
  },
  async appendChatMessages(_request: ChatMessagesAppendRequest) {
    return;
  },
  async updateChatMessageStream(_request: ChatMessageStreamUpdateRequest) {
    return;
  },
  async finalizeChatMessage(_request: ChatMessageFinalizeRequest) {
    return;
  },
  async deleteChatMessage(_request: ChatMessageDeleteRequest) {
    return;
  },
  async deleteChatSessionByTab(_terminalTabId: string) {
    return;
  },
  async updateChatMessageBlocks(_request: ChatMessageBlocksUpdateRequest) {
    return;
  },
  async listAutomationJobs() {
    return structuredClone(automationJobs);
  },
  async getAutomationJob(jobId: string) {
    const job = automationJobs.find((item) => item.id === jobId);
    if (!job) throw new Error("Automation job not found.");
    return structuredClone(job);
  },
  async createAutomationJob(job: AutomationJobDraft) {
    const created: AutomationJob = {
      ...job,
      id: createId("auto-job"),
      name: job.name.trim() || `CLI 任务 ${automationJobs.length + 1}`,
      description: job.description?.trim() || null,
      defaultExecutionMode: job.defaultExecutionMode ?? "auto",
      permissionProfile: normalizeAutomationPermissionProfile(job.permissionProfile),
      ruleConfig: normalizeAutomationGoalRuleConfig(job.ruleConfig),
      parameterDefinitions: normalizeAutomationParameterDefinitions(job.parameterDefinitions),
      defaultParameterValues: normalizeAutomationParameterValues(job.defaultParameterValues),
      cronExpression: job.cronExpression?.trim() || null,
      emailNotificationEnabled: job.emailNotificationEnabled === true,
      lastTriggeredAt: null,
      enabled: job.enabled !== false,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    automationJobs = [created, ...automationJobs];
    persistAutomationJobs();
    return structuredClone(created);
  },
  async updateAutomationJob(jobId: string, job: AutomationJobDraft) {
    const index = automationJobs.findIndex((item) => item.id === jobId);
    if (index < 0) throw new Error("Automation job not found.");
    const updated: AutomationJob = {
      ...automationJobs[index],
      ...job,
      name: job.name.trim() || automationJobs[index].name,
      description: job.description?.trim() || null,
      defaultExecutionMode: job.defaultExecutionMode ?? "auto",
      permissionProfile: normalizeAutomationPermissionProfile(job.permissionProfile),
      ruleConfig: normalizeAutomationGoalRuleConfig(job.ruleConfig),
      parameterDefinitions: normalizeAutomationParameterDefinitions(job.parameterDefinitions),
      defaultParameterValues: normalizeAutomationParameterValues(job.defaultParameterValues),
      cronExpression: job.cronExpression?.trim() || null,
      emailNotificationEnabled: job.emailNotificationEnabled === true,
      enabled: job.enabled !== false,
      updatedAt: nowISO(),
    };
    automationJobs[index] = updated;
    persistAutomationJobs();
    return structuredClone(updated);
  },
  async deleteAutomationJob(jobId: string) {
    automationJobs = automationJobs.filter((item) => item.id !== jobId);
    persistAutomationJobs();
  },
  async listAutomationWorkflows() {
    return structuredClone(automationWorkflows);
  },
  async getAutomationWorkflow(workflowId: string) {
    const workflow = automationWorkflows.find((item) => item.id === workflowId);
    if (!workflow) throw new Error("Automation workflow not found.");
    return structuredClone(workflow);
  },
  async createAutomationWorkflow(workflow: AutomationWorkflowDraft) {
    const nodes = workflow.nodes.map((node, index) =>
      normalizeAutomationWorkflowNode(node, index)
    );
    if (nodes.length === 0) {
      throw new Error("At least one workflow node is required.");
    }
    const created: AutomationWorkflow = {
      ...workflow,
      id: createId("wf"),
      name: workflow.name.trim() || `工作流 ${automationWorkflows.length + 1}`,
      description: workflow.description?.trim() || null,
      cronExpression: workflow.cronExpression?.trim() || null,
      emailNotificationEnabled: workflow.emailNotificationEnabled === true,
      enabled: workflow.enabled !== false,
      entryNodeId: workflow.entryNodeId?.trim() || nodes[0].id,
      defaultContextStrategy: normalizeAutomationWorkflowContextStrategy(
        workflow.defaultContextStrategy
      ),
      defaultExecutionMode:
        workflow.defaultExecutionMode === "codex" ||
        workflow.defaultExecutionMode === "claude" ||
        workflow.defaultExecutionMode === "gemini"
          ? workflow.defaultExecutionMode
          : "auto",
      defaultPermissionProfile: normalizeAutomationPermissionProfile(
        workflow.defaultPermissionProfile
      ),
      nodes,
      edges: workflow.edges.map((edge) => normalizeAutomationWorkflowEdge(edge)),
      lastTriggeredAt: null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    automationWorkflows = [created, ...automationWorkflows];
    persistAutomationWorkflows();
    return structuredClone(created);
  },
  async updateAutomationWorkflow(workflowId: string, workflow: AutomationWorkflowDraft) {
    const index = automationWorkflows.findIndex((item) => item.id === workflowId);
    if (index < 0) throw new Error("Automation workflow not found.");
    const nodes = workflow.nodes.map((node, nodeIndex) =>
      normalizeAutomationWorkflowNode(node, nodeIndex)
    );
    if (nodes.length === 0) {
      throw new Error("At least one workflow node is required.");
    }
    const updated: AutomationWorkflow = {
      ...automationWorkflows[index],
      ...workflow,
      name: workflow.name.trim() || automationWorkflows[index].name,
      description: workflow.description?.trim() || null,
      cronExpression: workflow.cronExpression?.trim() || null,
      emailNotificationEnabled: workflow.emailNotificationEnabled === true,
      enabled: workflow.enabled !== false,
      entryNodeId: workflow.entryNodeId?.trim() || nodes[0].id,
      defaultContextStrategy: normalizeAutomationWorkflowContextStrategy(
        workflow.defaultContextStrategy
      ),
      defaultExecutionMode:
        workflow.defaultExecutionMode === "codex" ||
        workflow.defaultExecutionMode === "claude" ||
        workflow.defaultExecutionMode === "gemini"
          ? workflow.defaultExecutionMode
          : "auto",
      defaultPermissionProfile: normalizeAutomationPermissionProfile(
        workflow.defaultPermissionProfile
      ),
      nodes,
      edges: workflow.edges.map((edge) => normalizeAutomationWorkflowEdge(edge)),
      updatedAt: nowISO(),
    };
    automationWorkflows[index] = updated;
    persistAutomationWorkflows();
    return structuredClone(updated);
  },
  async deleteAutomationWorkflow(workflowId: string) {
    if (
      automationWorkflowRuns.some(
        (run) =>
          run.workflowId === workflowId &&
          (run.status === "scheduled" || run.status === "running")
      )
    ) {
      throw new Error("This workflow has active runs and cannot be deleted yet.");
    }
    automationWorkflows = automationWorkflows.filter((item) => item.id !== workflowId);
    persistAutomationWorkflows();
  },
  async listAutomationJobRuns(jobId?: string | null) {
    return structuredClone(
      automationRuns
        .filter((run) => (jobId ? run.jobId === jobId : true))
        .map((run) => toAutomationRunRecord(run))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    );
  },
  async getAutomationRunDetail(runId: string) {
    const run = automationRuns.find((item) => item.id === runId);
    if (!run) throw new Error("Automation run not found.");
    return structuredClone(toAutomationRunDetail(run));
  },
  async getAutomationRuleProfile() {
    return structuredClone(automationRuleProfile);
  },
  async updateAutomationRuleProfile(profile: AutomationRuleProfile) {
    automationRuleProfile = normalizeAutomationRuleProfile(profile);
    persistAutomationRuleProfile();
    return structuredClone(automationRuleProfile);
  },
  async updateAutomationGoalRuleConfig(goalId: string, ruleConfig: AutomationGoalRuleConfig) {
    const run = automationRuns.find((item) => item.goals.some((goal) => goal.id === goalId));
    const goal = run?.goals.find((item) => item.id === goalId);
    if (!run || !goal) throw new Error("Automation goal not found.");
    goal.ruleConfig = normalizeAutomationGoalRuleConfig(ruleConfig);
    goal.updatedAt = nowISO();
    pushAutomationEvent(run, "info", "目标规则已更新", "该目标的自动化规则已更新。", goalId);
    persistAutomationRuns();
    return structuredClone(run);
  },
  async listAutomationRuns() {
    return structuredClone(automationRuns);
  },
  async listAutomationWorkflowRuns(workflowId?: string | null) {
    return structuredClone(
      automationWorkflowRuns
        .filter((run) => (workflowId ? run.workflowId === workflowId : true))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    );
  },
  async getAutomationWorkflowRunDetail(workflowRunId: string) {
    const run = automationWorkflowRuns.find((item) => item.id === workflowRunId);
    if (!run) throw new Error("Workflow run not found.");
    return structuredClone(toAutomationWorkflowRunDetail(run));
  },
  async createAutomationRun(request: CreateAutomationRunRequest) {
    const runId = createId("auto-run");
    const status: AutomationRunStatus = request.scheduledStartAt ? "scheduled" : "draft";
    const run: AutomationRun = {
      id: runId,
      permissionProfile: "standard",
      workspaceId: request.workspaceId,
      projectRoot: request.projectRoot,
      projectName: request.projectName,
      ruleProfileId: request.ruleProfileId ?? "safe-autonomy-v1",
      lifecycleStatus: status === "scheduled" ? "queued" : "stopped",
      outcomeStatus: "unknown",
      attentionStatus: "none",
      resolutionCode: status === "scheduled" ? "scheduled" : "draft",
      statusSummary: status === "scheduled" ? "Scheduled and waiting to start." : "Saved as draft.",
      objectiveSignals: { exitCode: null, checksPassed: false, checksFailed: false, artifactsProduced: false, filesChanged: 0, policyBlocks: [] },
      judgeAssessment: { madeProgress: false, expectedOutcomeMet: false, suggestedDecision: null, reason: null },
      validationResult: {
        decision: null,
        reason: null,
        feedback: null,
        evidenceSummary: null,
        missingChecks: [],
        verificationSteps: [],
        madeProgress: false,
        expectedOutcomeMet: false,
      },
      status,
      scheduledStartAt: request.scheduledStartAt ?? null,
      startedAt: null,
      completedAt: null,
      summary: null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      goals: request.goals.map((goal, index) => createAutomationGoal(runId, goal, index)),
      events: [],
    };
    pushAutomationEvent(
      run,
      "info",
      "Run created",
      status === "scheduled"
        ? "Browser fallback queued the run for its scheduled start."
        : "Browser fallback saved the run as a draft."
    );
    automationRuns = [run, ...automationRuns];
    persistAutomationRuns();
    if (status === "scheduled") {
      scheduleBrowserAutomationRun(run.id);
    }
    return structuredClone(run);
  },
  async createAutomationRunFromJob(request: CreateAutomationRunFromJobRequest) {
    const job = automationJobs.find((item) => item.id === request.jobId);
    if (!job) throw new Error("Automation job not found.");
    if (request.scheduledStartAt) {
      const scheduledMs = Date.parse(request.scheduledStartAt);
      if (!Number.isFinite(scheduledMs)) {
        throw new Error("Scheduled start time is invalid.");
      }
      if (scheduledMs <= Date.now() + 1000) {
        throw new Error("Scheduled start time must be in the future.");
      }
    }
    const runId = createId("auto-run");
    const nextRunNumber =
      automationRuns
        .filter((item) => item.jobId === job.id)
        .reduce((max, item) => Math.max(max, item.runNumber ?? 0), 0) + 1;
    const run: AutomationRun = {
      id: runId,
      jobId: job.id,
      jobName: job.name,
      triggerSource: request.scheduledStartAt ? "schedule" : "manual",
      runNumber: nextRunNumber,
      permissionProfile: normalizeAutomationPermissionProfile(job.permissionProfile),
      parameterValues: {
        ...normalizeAutomationParameterValues(job.defaultParameterValues),
        ...normalizeAutomationParameterValues(request.parameterValues ?? {}),
      },
      workspaceId: job.workspaceId,
      projectRoot: job.projectRoot,
      projectName: job.projectName,
      ruleProfileId: "safe-autonomy-v1",
      lifecycleStatus: "queued",
      outcomeStatus: "unknown",
      attentionStatus: "none",
      resolutionCode: request.scheduledStartAt ? "scheduled" : "queued",
      statusSummary: request.scheduledStartAt ? "Scheduled and waiting to start." : "Queued to start immediately.",
      objectiveSignals: { exitCode: null, checksPassed: false, checksFailed: false, artifactsProduced: false, filesChanged: 0, policyBlocks: [] },
      judgeAssessment: { madeProgress: false, expectedOutcomeMet: false, suggestedDecision: null, reason: null },
      validationResult: {
        decision: null,
        reason: null,
        feedback: null,
        evidenceSummary: null,
        missingChecks: [],
        verificationSteps: [],
        madeProgress: false,
        expectedOutcomeMet: false,
      },
      status: "scheduled",
      scheduledStartAt: request.scheduledStartAt ?? nowISO(),
      startedAt: null,
      completedAt: null,
      summary: null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      goals: [
        {
          ...createAutomationGoal(runId, {
            title: job.name,
            goal: job.goal,
            expectedOutcome: job.expectedOutcome,
            executionMode: request.executionMode ?? job.defaultExecutionMode,
            ruleConfig: job.ruleConfig,
          }, 0),
          title: job.name,
        },
      ],
      events: [],
    };
    pushAutomationEvent(
      run,
      "info",
      "Run created",
      request.scheduledStartAt
        ? "Browser fallback queued the CLI run for a scheduled start."
        : "Browser fallback queued the CLI run to start immediately."
    );
    automationRuns = [run, ...automationRuns];
    persistAutomationRuns();
    scheduleBrowserAutomationRun(run.id);
    return structuredClone(toAutomationRunRecord(run));
  },
  async createAutomationWorkflowRun(request: CreateAutomationWorkflowRunRequest) {
    const workflow = automationWorkflows.find((item) => item.id === request.workflowId);
    if (!workflow) throw new Error("Automation workflow not found.");
    if (workflow.nodes.length === 0) {
      throw new Error("The workflow does not contain any nodes.");
    }
    const run: AutomationWorkflowRun = {
      id: createId("wf-run"),
      workflowId: workflow.id,
      workflowName: workflow.name,
      triggerSource: request.scheduledStartAt ? "schedule" : "manual",
      workspaceId: workflow.workspaceId,
      projectRoot: workflow.projectRoot,
      projectName: workflow.projectName,
      status: "scheduled",
      statusSummary: request.scheduledStartAt
        ? "Scheduled and waiting to start."
        : "Queued to start immediately.",
      scheduledStartAt: request.scheduledStartAt ?? nowISO(),
      sharedTerminalTabId: createId("wf-tab"),
      entryNodeId: workflow.entryNodeId,
      currentNodeId: workflow.entryNodeId,
      emailNotificationEnabled: workflow.emailNotificationEnabled === true,
      cliSessions: [],
      nodeRuns: workflow.nodes.map((node) => ({
        id: createId("wf-node-run"),
        workflowRunId: "",
        nodeId: node.id,
        label: node.label,
        goal: node.goal,
        automationRunId: null,
        status: "queued",
        branchResult: null,
        usedCli: null,
        transportSession: null,
        statusSummary:
          node.id === workflow.entryNodeId
            ? "Ready to run as the entry node."
            : "Waiting for dependency resolution.",
        startedAt: null,
        completedAt: null,
        updatedAt: nowISO(),
      })),
      events: [],
      startedAt: null,
      completedAt: null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    run.nodeRuns = run.nodeRuns.map((nodeRun) => ({
      ...nodeRun,
      workflowRunId: run.id,
    }));
    pushWorkflowEvent(
      run,
      "info",
      "Workflow run created",
      request.scheduledStartAt
        ? "Browser fallback queued the workflow for a scheduled start."
        : "Browser fallback queued the workflow to start immediately."
    );
    automationWorkflowRuns = [run, ...automationWorkflowRuns];
    persistAutomationWorkflowRuns();
    scheduleBrowserWorkflowRun(run.id);
    return structuredClone(run);
  },
  async startAutomationRun(runId: string) {
    const run = automationRuns.find((item) => item.id === runId);
    if (!run) throw new Error("Automation run not found.");
    run.status = "scheduled";
    run.scheduledStartAt = nowISO();
    run.updatedAt = nowISO();
    pushAutomationEvent(run, "info", "Run scheduled", "Browser fallback queued the run to start immediately.");
    persistAutomationRuns();
    scheduleBrowserAutomationRun(runId);
    return structuredClone(run);
  },
  async pauseAutomationRun(runId: string) {
    const run = automationRuns.find((item) => item.id === runId);
    if (!run) throw new Error("Automation run not found.");
    run.status = "paused";
    run.updatedAt = nowISO();
    pushAutomationEvent(run, "warning", "批次已暂停", "浏览器预览已暂停该批次。");
    persistAutomationRuns();
    return structuredClone(run);
  },
  async resumeAutomationRun(runId: string) {
    const run = automationRuns.find((item) => item.id === runId);
    if (!run) throw new Error("Automation run not found.");
    run.status = "scheduled";
    run.scheduledStartAt = nowISO();
    run.updatedAt = nowISO();
    run.goals = run.goals.map((goal) =>
      goal.status === "paused"
        ? { ...goal, status: "queued", requiresAttentionReason: null, updatedAt: nowISO() }
        : goal
    );
    pushAutomationEvent(run, "info", "批次继续执行", "浏览器预览已恢复该批次。");
    persistAutomationRuns();
    scheduleBrowserAutomationRun(run.id);
    return structuredClone(run);
  },
  async resumeAutomationWorkflowRun(workflowRunId: string) {
    const run = automationWorkflowRuns.find((item) => item.id === workflowRunId);
    if (!run) throw new Error("Workflow run not found.");
    if (run.status !== "paused") {
      throw new Error("Only paused workflow runs can be resumed.");
    }
    const now = nowISO();
    run.status = "scheduled";
    run.statusSummary = "Re-queued after pause.";
    run.scheduledStartAt = now;
    run.completedAt = null;
    run.updatedAt = now;
    const currentNodeId = run.currentNodeId ?? run.entryNodeId;
    const currentNodeRun = run.nodeRuns.find((item) => item.nodeId === currentNodeId);
    if (currentNodeRun && currentNodeRun.status === "paused") {
      currentNodeRun.status = "queued";
      currentNodeRun.branchResult = null;
      currentNodeRun.statusSummary = "Re-queued after pause.";
      currentNodeRun.automationRunId = null;
      currentNodeRun.transportSession = null;
      currentNodeRun.usedCli = null;
      currentNodeRun.completedAt = null;
      currentNodeRun.updatedAt = now;
    }
    pushWorkflowEvent(run, "info", "Workflow resumed", "Browser fallback re-queued the paused workflow.");
    persistAutomationWorkflowRuns();
    scheduleBrowserWorkflowRun(run.id);
    return structuredClone(run);
  },
  async restartAutomationRun(runId: string) {
    const run = automationRuns.find((item) => item.id === runId);
    if (!run) throw new Error("Automation run not found.");
    run.status = "scheduled";
    run.lifecycleStatus = "queued";
    run.outcomeStatus = "unknown";
    run.attentionStatus = "none";
    run.resolutionCode = "scheduled";
    run.statusSummary = "Reset and queued again.";
    run.scheduledStartAt = nowISO();
    run.startedAt = null;
    run.completedAt = null;
    run.summary = null;
    run.updatedAt = nowISO();
    run.goals = run.goals.map((goal) => ({
      ...goal,
      lifecycleStatus: "queued",
      outcomeStatus: "unknown",
      attentionStatus: "none",
      resolutionCode: "scheduled",
      statusSummary: "Reset and queued again.",
      status: "queued",
      roundCount: 0,
      consecutiveFailureCount: 0,
      noProgressRounds: 0,
      lastOwnerCli: null,
      resultSummary: null,
      latestProgressSummary: null,
      nextInstruction: null,
      requiresAttentionReason: null,
      relevantFiles: [],
      syntheticTerminalTabId: createId("auto-tab"),
      lastExitCode: null,
      startedAt: null,
      completedAt: null,
      updatedAt: nowISO(),
    }));
    pushAutomationEvent(run, "info", "批次重新运行", "浏览器预览已将批次重置并重新排队。");
    persistAutomationRuns();
    scheduleBrowserAutomationRun(run.id);
    return structuredClone(run);
  },
  async pauseAutomationGoal(goalId: string) {
    const run = automationRuns.find((item) => item.goals.some((goal) => goal.id === goalId));
    const goal = run?.goals.find((item) => item.id === goalId);
    if (!run || !goal) throw new Error("Automation goal not found.");
    goal.status = "paused";
    goal.requiresAttentionReason = "Paused manually.";
    goal.updatedAt = nowISO();
    run.status = "paused";
    run.updatedAt = nowISO();
    pushAutomationEvent(run, "warning", "Goal paused", "Browser fallback paused the selected goal.", goalId);
    persistAutomationRuns();
    return structuredClone(run);
  },
  async resumeAutomationGoal(goalId: string) {
    const run = automationRuns.find((item) => item.goals.some((goal) => goal.id === goalId));
    const goal = run?.goals.find((item) => item.id === goalId);
    if (!run || !goal) throw new Error("Automation goal not found.");
    goal.status = "queued";
    goal.requiresAttentionReason = null;
    goal.updatedAt = nowISO();
    run.status = "scheduled";
    run.scheduledStartAt = nowISO();
    run.updatedAt = nowISO();
    pushAutomationEvent(run, "info", "Goal resumed", "Browser fallback re-queued the paused goal.", goalId);
    persistAutomationRuns();
    scheduleBrowserAutomationRun(run.id);
    return structuredClone(run);
  },
  async cancelAutomationRun(runId: string) {
    const run = automationRuns.find((item) => item.id === runId);
    if (!run) throw new Error("Automation run not found.");
    run.status = "cancelled";
    run.completedAt = nowISO();
    run.updatedAt = nowISO();
    run.goals = run.goals.map((goal) =>
      goal.status === "completed" || goal.status === "failed"
        ? goal
        : { ...goal, status: "cancelled", updatedAt: nowISO(), completedAt: nowISO() }
    );
    pushAutomationEvent(run, "warning", "Run cancelled", "Browser fallback cancelled the automation run.");
    persistAutomationRuns();
    return structuredClone(run);
  },
  async deleteAutomationRun(runId: string) {
    const run = automationRuns.find((item) => item.id === runId);
    if (!run) throw new Error("Automation run not found.");
    if (run.status === "running") {
      throw new Error("Running automation runs must be paused or cancelled before deletion.");
    }
    automationRuns = automationRuns.filter((item) => item.id !== runId);
    persistAutomationRuns();
  },
  async cancelAutomationWorkflowRun(workflowRunId: string) {
    const run = automationWorkflowRuns.find((item) => item.id === workflowRunId);
    if (!run) throw new Error("Workflow run not found.");
    run.status = "cancelled";
    run.statusSummary = "Cancelled manually.";
    run.completedAt = nowISO();
    run.updatedAt = nowISO();
    pushWorkflowEvent(run, "warning", "Workflow cancelled", run.statusSummary);
    persistAutomationWorkflowRuns();
    return structuredClone(run);
  },
  async deleteAutomationWorkflowRun(workflowRunId: string) {
    const run = automationWorkflowRuns.find((item) => item.id === workflowRunId);
    if (!run) throw new Error("Workflow run not found.");
    if (run.status === "running") {
      throw new Error("Running workflow runs must be cancelled before deletion.");
    }
    const childRunIds = new Set(
      run.nodeRuns.map((entry) => entry.automationRunId).filter(Boolean)
    );
    automationRuns = automationRuns.filter((item) => !childRunIds.has(item.id));
    automationWorkflowRuns = automationWorkflowRuns.filter((item) => item.id !== workflowRunId);
    persistAutomationRuns();
    persistAutomationWorkflowRuns();
  },
  async saveTextToDownloads(fileName: string, content: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    return `browser-download:${fileName}`;
  },

  async sendChatMessage(request: ChatPromptRequest) {
    const { cliId, prompt, terminalTabId } = request;
    const messageId = createId("msg");
    const startTime = Date.now();
    const transportSession: AgentTransportSession = {
      cliId,
      kind: "browser-fallback",
      threadId: request.transportSession?.threadId ?? null,
      turnId: createId("turn"),
      model: request.modelOverride ?? null,
      permissionMode: request.permissionOverride ?? null,
      lastSyncAt: nowISO(),
    };

    pushActivity("info", `${cliId} queued`, "Prompt dispatched to the selected CLI.");
    emitState();

    // Simulate streaming: emit chunks over time
    const output = fakeOutputFor(cliId, prompt);
    const blocks: ChatMessageBlock[] = [
      {
        kind: "text",
        text: output,
        format: "markdown",
      },
    ];
    const words = output.split(" ");
    let emitted = 0;

    const interval = setInterval(() => {
      const chunkSize = Math.min(3, words.length - emitted);
      if (chunkSize <= 0) {
        clearInterval(interval);
        const durationMs = Date.now() - startTime;
        emitStream({
          terminalTabId,
          messageId,
          chunk: "",
          done: true,
          exitCode: 0,
          durationMs,
          finalContent: output,
          contentFormat: "markdown",
          transportKind: defaultTransportKind(cliId),
          transportSession,
          blocks,
        });
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
  async interruptChatTurn(_terminalTabId: string, _messageId: string): Promise<ChatInterruptResult> {
    return {
      status: "notRunning",
      accepted: false,
      pending: false,
      message: "Interrupt is only available in the desktop runtime.",
    };
  },
  async runAutoOrchestration(request: AutoOrchestrationRequest) {
    const messageId = createId("msg");
    const startTime = Date.now();
    const planBlocks: ChatMessageBlock[] = [
      {
        kind: "orchestrationPlan",
        title: "Auto orchestration by Claude",
        goal: request.prompt,
        summary: "Browser fallback simulated an orchestration run.",
        status: "running",
      },
      {
        kind: "orchestrationStep",
        stepId: "step-1",
        owner: /ui|design|layout|css|frontend/i.test(request.prompt) ? "gemini" : "codex",
        title: "Simulated worker execution",
        summary: "This is a browser fallback preview of the orchestration UI.",
        result: "No real CLI execution happened in browser mode.",
        status: "completed",
      },
    ];
    const finalOutput =
      "Auto mode is only fully available in the Tauri runtime. This browser fallback simulates the orchestration trace.";

    window.setTimeout(() => {
      emitStream({
        terminalTabId: request.terminalTabId,
        messageId,
        chunk: "",
        done: true,
        exitCode: 0,
        durationMs: Date.now() - startTime,
        finalContent: finalOutput,
        contentFormat: "markdown",
        transportKind: "browser-fallback",
        transportSession: null,
        blocks: [
          {
            kind: "orchestrationPlan",
            title: "Auto orchestration by Claude",
            goal: request.prompt,
            summary: "Browser fallback completed the simulated run.",
            status: "completed",
          },
          ...planBlocks.slice(1),
        ],
      });
    }, 400);

    return messageId;
  },
  async respondAssistantApproval(_requestId: string, _decision: AssistantApprovalDecision) {
    return false;
  },

  async pickWorkspaceFolder(): Promise<WorkspacePickResult | null> {
    const rootPath = window.prompt("Enter a workspace folder path");
    if (!rootPath || !rootPath.trim()) return null;
    return {
      name: basename(rootPath.trim()),
      rootPath: rootPath.trim(),
    };
  },

  async pickChatAttachments(): Promise<PickedChatAttachment[]> {
    return pickBrowserChatAttachments();
  },

  async searchWorkspaceFiles(
    _projectRoot: string,
    query: string,
    _workspaceId?: string | null
  ): Promise<FileMentionCandidate[]> {
    const lower = query.toLowerCase();
    return MOCK_WORKSPACE_FILE_PATHS
      .filter((path) => path.toLowerCase().includes(lower))
      .slice(0, 20)
      .map((relativePath) => ({
        id: relativePath,
        name: basename(relativePath),
        relativePath,
        absolutePath: null,
      }));
  },

  async searchWorkspaceText(
    _projectRoot: string,
    options: {
      query: string;
      caseSensitive: boolean;
      wholeWord: boolean;
      isRegex: boolean;
      includePattern?: string | null;
      excludePattern?: string | null;
    },
    _workspaceId?: string | null
  ): Promise<WorkspaceTextSearchResponse> {
    const trimmed = options.query.trim();
    if (!trimmed) {
      return { files: [], fileCount: 0, matchCount: 0, limitHit: false };
    }
    const filtered = MOCK_WORKSPACE_FILE_PATHS.filter((path) => {
      const include = options.includePattern?.trim();
      const exclude = options.excludePattern?.trim();
      if (include && !path.includes(include.replaceAll("*", ""))) return false;
      if (exclude && path.includes(exclude.replaceAll("*", ""))) return false;
      return true;
    }).slice(0, 12);

    const files = filtered
      .map((path) => {
        const haystack = options.caseSensitive ? path : path.toLowerCase();
        const needle = options.caseSensitive ? trimmed : trimmed.toLowerCase();
        if (!haystack.includes(needle)) return null;
        return {
          path,
          matchCount: 1,
          matches: [
            {
              line: 1,
              column: 1,
              endColumn: Math.max(2, trimmed.length + 1),
              preview: `Mock match in ${path}`,
            },
          ],
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    return {
      files,
      fileCount: files.length,
      matchCount: files.length,
      limitHit: false,
    };
  },

  async createWorkspaceFile(
    _projectRoot: string,
    _relativePath: string,
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },

  async createWorkspaceDirectory(
    _projectRoot: string,
    _relativePath: string,
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },

  async trashWorkspaceItem(
    _projectRoot: string,
    _relativePath: string,
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },

  async listWorkspaceEntries(
    _projectRoot: string,
    relativePath?: string | null,
    _workspaceId?: string | null
  ): Promise<WorkspaceTreeEntry[]> {
    return listMockWorkspaceEntries(relativePath);
  },

  async getWorkspaceFileIndex(
    _projectRoot: string,
    _workspaceId?: string | null
  ): Promise<WorkspaceFileIndexResponse> {
    return buildMockWorkspaceFileIndex();
  },

  async getCliSkills(cliId: AgentId, _projectRoot: string, _workspaceId?: string | null): Promise<CliSkillItem[]> {
    return structuredClone(fallbackCliSkills(cliId));
  },

  async detectEngines(): Promise<SettingsEngineStatus[]> {
    return [
      { engineType: "claude", installed: true, version: "browser-fallback", binPath: null, error: null },
      { engineType: "codex", installed: true, version: "browser-fallback", binPath: null, error: null },
      { engineType: "gemini", installed: true, version: "browser-fallback", binPath: null, error: null },
    ];
  },

  async testSshConnection(): Promise<SshConnectionTestResult> {
    return {
      reachable: false,
      authOk: false,
      pythonOk: false,
      shell: null,
      platform: null,
      detectedCliPaths: {
        codex: null,
        claude: null,
        gemini: null,
      },
      errors: ["SSH 连接测试仅在桌面端运行时可用。"],
    };
  },

  async getClaudeSettingsPath(): Promise<string | null> {
    return null;
  },

  async getCodexConfigPath(): Promise<string | null> {
    return null;
  },

  async reloadCodexRuntimeConfig(): Promise<CodexRuntimeReloadResult> {
    return {
      status: "applied",
      stage: "browser-fallback",
      restartedSessions: 0,
      message: "浏览器回退环境不需要重新加载 Codex 运行时。",
    };
  },

  async listGlobalMcpServers(): Promise<GlobalMcpServerEntry[]> {
    return [];
  },

  async listCodexMcpRuntimeServers(): Promise<unknown> {
    return { data: [] };
  },

  async listExternalAbsoluteDirectoryChildren(_directoryPath: string): Promise<ExternalDirectoryEntry[]> {
    return [];
  },

  async readExternalAbsoluteFile(_path: string): Promise<ExternalTextFile> {
    return { exists: false, content: "", truncated: false };
  },

  async writeExternalAbsoluteFile(_path: string, _content: string): Promise<void> {
    throw new Error("External file editing is not available in browser runtime.");
  },
  async localUsageStatistics(input: {
    scope: "current" | "all";
    provider?: string | null;
    dateRange: "7d" | "30d" | "all";
    workspacePath?: string | null;
  }): Promise<LocalUsageStatistics> {
    return {
      projectPath: input.workspacePath ?? (input.scope === "all" ? "all" : "current"),
      projectName: input.scope === "all" ? "全部项目" : "当前项目",
      totalSessions: 0,
      totalUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
      },
      estimatedCost: 0,
      sessions: [],
      dailyUsage: [],
      weeklyComparison: {
        currentWeek: { sessions: 0, cost: 0, tokens: 0 },
        lastWeek: { sessions: 0, cost: 0, tokens: 0 },
        trends: { sessions: 0, cost: 0, tokens: 0 },
      },
      byModel: [],
      totalEngineUsageCount: 0,
      engineUsage: [],
      aiCodeModifiedLines: 0,
      dailyCodeChanges: [],
      lastUpdated: Date.now(),
    };
  },
  async ensurePtySession(): Promise<void> {
    return;
  },
  async writePtyInput(): Promise<void> {
    return;
  },
  async resizePtySession(): Promise<void> {
    return;
  },
  async closePtySession(): Promise<void> {
    return;
  },
  async onPtyOutput(): Promise<() => void> {
    return () => {};
  },
  async runtimeLogDetectProfiles(): Promise<Array<{ id: string; defaultCommand: string; detectedStack: string }>> {
    return [];
  },
  async runtimeLogStart(): Promise<never> {
    throw new Error("运行控制台仅在桌面端运行时可用。");
  },
  async runtimeLogStop(): Promise<never> {
    throw new Error("运行控制台仅在桌面端运行时可用。");
  },
  async runtimeLogGetSession(): Promise<null> {
    return null;
  },
  async runtimeLogMarkExit(): Promise<never> {
    throw new Error("运行控制台仅在桌面端运行时可用。");
  },
  async onRuntimeLogOutput(): Promise<() => void> {
    return () => {};
  },
  async onRuntimeLogStatus(): Promise<() => void> {
    return () => {};
  },
  async onRuntimeLogExited(): Promise<() => void> {
    return () => {};
  },

  async getGitPanel(_projectRoot: string, _workspaceId?: string | null): Promise<GitPanelData> {
    const stagedFiles: GitFileStatus[] = [
      { path: "src/components/chat/WorkspaceRightPanel.tsx", status: "modified", additions: 18, deletions: 6 },
    ];
    const unstagedFiles: GitFileStatus[] = [
      { path: "src/pages/TerminalPage.tsx", status: "modified", additions: 4, deletions: 2 },
      { path: "src/components/chat/ChatConversation.tsx", status: "added", additions: 8, deletions: 0 },
      { path: "src/lib/store.ts", status: "modified", additions: 3, deletions: 1 },
      {
        path: "src/components/chat/GitPanel.tsx",
        status: "renamed",
        previousPath: "src/components/GitPanel.tsx",
        additions: 0,
        deletions: 0,
      },
    ];
    const fakeChanges: GitFileChange[] = [...stagedFiles, ...unstagedFiles].map(
      ({ additions: _additions, deletions: _deletions, ...change }) => change
    );
    const totalFiles = stagedFiles.length + unstagedFiles.length;
    return {
      isGitRepo: true,
      branch: state.workspace.branch || "main",
      fileStatus: totalFiles === 0 ? "No changes" : `${totalFiles} file${totalFiles === 1 ? "" : "s"} changed`,
      stagedFiles,
      unstagedFiles,
      recentChanges: fakeChanges,
    };
  },
  async getGitOverview(projectRoot: string, workspaceId?: string | null): Promise<GitOverviewResponse> {
    const [panel, log] = await Promise.all([
      browserRuntime.getGitPanel(projectRoot, workspaceId),
      browserRuntime.getGitLog(projectRoot, workspaceId),
    ]);
    return { panel, log };
  },
  async getGitCommitHistory(
    _projectRoot: string,
    options?: {
      branch?: string | null;
      query?: string | null;
      offset?: number;
      limit?: number;
      snapshotId?: string | null;
    },
    _workspaceId?: string | null
  ): Promise<GitHistoryResponse> {
    const query = (options?.query ?? "").toLowerCase();
    const all = [
      {
        sha: "a".repeat(40),
        shortSha: "aaaaaaa",
        summary: "Refine workspace right panel layout",
        message: "Refine workspace right panel layout\n\nAdjust spacing and metadata chips.",
        author: "Codex",
        authorEmail: "codex@example.com",
        timestamp: Date.now() - 1000 * 60 * 30,
        parents: ["0".repeat(40)],
        refs: ["HEAD", "main"],
      },
      {
        sha: "b".repeat(40),
        shortSha: "bbbbbbb",
        summary: "Add settings desktop shell",
        message: "Add settings desktop shell\n\nIntroduce dedicated settings layout.",
        author: "Codex",
        authorEmail: "codex@example.com",
        timestamp: Date.now() - 1000 * 60 * 90,
        parents: ["a".repeat(40)],
        refs: [],
      },
    ].filter((entry) =>
      !query ||
      `${entry.sha} ${entry.shortSha} ${entry.summary} ${entry.author} ${entry.refs.join(" ")}`.toLowerCase().includes(query)
    );
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 100;
    const commits = all.slice(offset, offset + limit);
    return {
      snapshotId: "browser-fallback",
      total: all.length,
      offset,
      limit,
      hasMore: offset + commits.length < all.length,
      commits,
    };
  },
  async getGitPushPreview(
    _projectRoot: string,
    options: {
      remote: string;
      branch: string;
      limit?: number;
    },
    _workspaceId?: string | null
  ): Promise<GitPushPreviewResponse> {
    const allCommits: GitHistoryCommit[] = [
      {
        sha: "9f8e7d6c5b4a3210fedcba987654321001234567",
        shortSha: "9f8e7d6",
        summary: "Refine desktop settings shell spacing",
        message: "Refine desktop settings shell spacing\n\nTighten the top gutter in the desktop settings workspace.",
        author: "Codex",
        authorEmail: "codex@example.com",
        timestamp: Math.floor((Date.now() - 1000 * 60 * 20) / 1000),
        parents: ["8e7d6c5b4a3210fedcba98765432100123456789a"],
        refs: [],
      },
      {
        sha: "8e7d6c5b4a3210fedcba98765432100123456789a",
        shortSha: "8e7d6c5",
        summary: "Match provider settings menu with desktop-cc-gui",
        message: "Match provider settings menu with desktop-cc-gui",
        author: "Codex",
        authorEmail: "codex@example.com",
        timestamp: Math.floor((Date.now() - 1000 * 60 * 55) / 1000),
        parents: ["7d6c5b4a3210fedcba98765432100123456789ab"],
        refs: [],
      },
      {
        sha: "7d6c5b4a3210fedcba98765432100123456789ab",
        shortSha: "7d6c5b4",
        summary: "Move model management into desktop settings shell",
        message: "Move model management into desktop settings shell",
        author: "Codex",
        authorEmail: "codex@example.com",
        timestamp: Math.floor((Date.now() - 1000 * 60 * 110) / 1000),
        parents: [],
        refs: [],
      },
    ];
    const targetRemote = options.remote.trim() || "origin";
    const targetBranch = options.branch.trim() || "main";
    const maxItems = Math.max(1, Math.min(options.limit ?? 120, allCommits.length));
    return {
      sourceBranch: "feature/git-panel",
      targetRemote,
      targetBranch,
      targetRef: `refs/remotes/${targetRemote}/${targetBranch}`,
      targetFound: targetBranch !== "new-branch",
      hasMore: allCommits.length > maxItems,
      commits: allCommits.slice(0, maxItems),
    };
  },
  async getGitCommitDetails(
    _projectRoot: string,
    commitHash: string,
    _maxDiffLines?: number,
    _workspaceId?: string | null
  ): Promise<GitCommitDetails> {
    return {
      sha: commitHash,
      summary: "Refine workspace right panel layout",
      message: "Refine workspace right panel layout\n\nAdjust spacing and metadata chips.",
      author: "Codex",
      authorEmail: "codex@example.com",
      committer: "Codex",
      committerEmail: "codex@example.com",
      authorTime: Math.floor((Date.now() - 1000 * 60 * 30) / 1000),
      commitTime: Math.floor((Date.now() - 1000 * 60 * 30) / 1000),
      parents: ["0".repeat(40)],
      totalAdditions: 22,
      totalDeletions: 6,
      files: [
        {
          path: "src/components/chat/WorkspaceRightPanel.tsx",
          status: "M",
          additions: 18,
          deletions: 6,
          isBinary: false,
          isImage: false,
          diff: "@@ -1,3 +1,5 @@\n-import old\n+import new\n+const next = true",
          lineCount: 3,
          truncated: false,
        },
        {
          path: "src/styles/workspace-right-panel.css",
          status: "A",
          additions: 4,
          deletions: 0,
          isBinary: false,
          isImage: false,
          diff: "@@ -0,0 +1,4 @@\n+.workspace {}\n+.panel {}",
          lineCount: 2,
          truncated: false,
        },
      ],
    };
  },
  async listGitBranches(_projectRoot: string, _workspaceId?: string | null): Promise<GitBranchListResponse> {
    return {
      currentBranch: "main",
      localBranches: [
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
          upstream: "origin/main",
          lastCommit: Date.now() - 1000 * 60 * 30,
          headSha: "a".repeat(40),
          ahead: 1,
          behind: 0,
        },
        {
          name: "feature/settings-git",
          isCurrent: false,
          isRemote: false,
          upstream: null,
          lastCommit: Date.now() - 1000 * 60 * 120,
          headSha: "b".repeat(40),
          ahead: 0,
          behind: 0,
        },
      ],
      remoteBranches: [
        {
          name: "origin/main",
          isCurrent: false,
          isRemote: true,
          remote: "origin",
          upstream: null,
          lastCommit: Date.now() - 1000 * 60 * 60,
          headSha: "c".repeat(40),
          ahead: 0,
          behind: 0,
        },
      ],
    };
  },
  async checkoutGitBranch(_projectRoot?: string, _name?: string, _workspaceId?: string | null): Promise<void> {
    return;
  },
  async createGitBranch(
    _projectRoot?: string,
    _name?: string,
    _sourceRef?: string | null,
    _checkoutAfterCreate?: boolean,
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },
  async renameGitBranch(
    _projectRoot?: string,
    _oldName?: string,
    _newName?: string,
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },
  async deleteGitBranch(
    _projectRoot?: string,
    _name?: string,
    _force?: boolean,
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },
  async mergeGitBranch(
    _projectRoot?: string,
    _sourceBranch?: string,
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },
  async fetchGit(
    _projectRoot: string,
    _remote?: string | null,
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },
  async pullGit(
    _projectRoot: string,
    _remote?: string | null,
    _targetBranch?: string | null,
    _pullOption?: string | null,
    _workspaceId?: string | null,
  ): Promise<void> {
    return;
  },
  async syncGit(
    _projectRoot: string,
    _remote?: string | null,
    _targetBranch?: string | null,
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },

  async getGitFileDiff(
    _projectRoot: string,
    path: string,
    _workspaceId?: string | null
  ): Promise<GitFileDiff> {
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
        originalContent: `export function TerminalPage() {
  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 flex flex-col min-w-0">
        <ChatConversation />
        <ChatPromptBar />
      </div>
    </div>
  );
}`,
        modifiedContent: `export function TerminalPage() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex-1 flex flex-col min-w-0">
        <ChatConversation />
        <ChatPromptBar />
      </div>
    </div>
  );
}`,
        language: "typescript",
        isBinary: false,
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
        originalContent: "",
        modifiedContent: `import { useStore } from "../../lib/store";

export function ChatConversation() {
  return <div className="flex-1">Conversation</div>;
}`,
        language: "typescript",
        isBinary: false,
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
        originalContent: `loadGitPanel: async (workspaceId, projectRoot) => {
  try {
    const gitPanel = await bridge.getGitPanel(projectRoot);
    set((state) => {`,
        modifiedContent: `loadGitPanel: async (workspaceId, projectRoot) => {
  try {
    const gitPanel = await bridge.getGitPanel(projectRoot);
    // keep the workspace inspector in sync after each streamed response
    // without requiring manual refresh
    set((state) => {`,
        language: "typescript",
        isBinary: false,
      },
      "src/components/chat/GitPanel.tsx": {
        path: "src/components/chat/GitPanel.tsx",
        previousPath: "src/components/GitPanel.tsx",
        status: "renamed",
        diff: `diff --git a/src/components/GitPanel.tsx b/src/components/chat/GitPanel.tsx
similarity index 86%
rename from src/components/GitPanel.tsx
rename to src/components/chat/GitPanel.tsx`,
        originalContent: `export function GitPanel() {
  return <div>Old panel</div>;
}`,
        modifiedContent: `export function GitPanel() {
  return <div>New panel</div>;
}`,
        language: "typescript",
        isBinary: false,
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
        originalContent: "previous content\n",
        modifiedContent: "updated content\n",
        language: path.endsWith(".rs")
          ? "rust"
          : path.endsWith(".json")
            ? "json"
            : path.endsWith(".md")
              ? "markdown"
              : path.endsWith(".css")
                ? "css"
                : path.endsWith(".js")
                  ? "javascript"
                  : path.endsWith(".ts") || path.endsWith(".tsx")
                    ? "typescript"
                    : "plaintext",
        isBinary: false,
      }
    );
  },

  async getGitLog(_projectRoot: string, _workspaceId?: string | null): Promise<GitLogResponse> {
    const entries: GitLogEntry[] = [
      {
        sha: "a1b2c3d4",
        summary: "Refine workspace right panel styles",
        author: "Codex",
        timestamp: Date.now() - 1000 * 60 * 45,
      },
      {
        sha: "b2c3d4e5",
        summary: "Add staged and unstaged Git sections",
        author: "Codex",
        timestamp: Date.now() - 1000 * 60 * 120,
      },
    ];
    return {
      total: entries.length,
      entries,
      ahead: 2,
      behind: 0,
      aheadEntries: entries,
      behindEntries: [],
      upstream: "origin/main",
    };
  },

  async pushGit(
    _projectRoot: string,
    _remote?: string | null,
    _targetBranch?: string | null,
    _options?: {
      pushTags?: boolean;
      noVerify?: boolean;
      forceWithLease?: boolean;
      pushToGerrit?: boolean;
      topic?: string | null;
      reviewers?: string | null;
      cc?: string | null;
    },
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },

  async getGitHubIssues(_projectRoot: string, _workspaceId?: string | null): Promise<GitHubIssuesResponse> {
    const issues: GitHubIssue[] = [
      {
        number: 12,
        title: "Unify Git panel with desktop layout",
        url: "https://github.com/example/repo/issues/12",
        updatedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
      },
    ];
    return { total: issues.length, issues };
  },

  async getGitHubPullRequests(_projectRoot: string, _workspaceId?: string | null): Promise<GitHubPullRequestsResponse> {
    const pullRequests: GitHubPullRequest[] = [
      {
        number: 34,
        title: "Improve workspace right panel parity",
        url: "https://github.com/example/repo/pull/34",
        updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
        body: "Align Git panel interactions with desktop-cc-gui.",
        headRefName: "feature/git-panel",
        baseRefName: "main",
        isDraft: false,
        author: { login: "codex" },
      },
    ];
    return { total: pullRequests.length, pullRequests };
  },

  async stageGitFile(
    _projectRoot: string,
    _path: string,
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },

  async unstageGitFile(
    _projectRoot: string,
    _path: string,
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },

  async discardGitFile(
    _projectRoot: string,
    _path: string,
    _workspaceId?: string | null
  ): Promise<void> {
    return;
  },

  async commitGitChanges(
    _projectRoot: string,
    _message: string,
    _options?: { stageAll?: boolean },
    _workspaceId?: string | null
  ): Promise<{ commitSha: string | null }> {
    return { commitSha: "browser-fallback-commit" };
  },

  async openWorkspaceIn(
    path: string,
    _options?: {
      appName?: string | null;
      command?: string | null;
      args?: string[];
    }
  ): Promise<void> {
    window.alert(`Open workspace is only available in the desktop runtime.\n\n${path}`);
  },

  async openWorkspaceFile(
    _projectRoot: string,
    path: string,
    _workspaceId?: string | null
  ): Promise<boolean> {
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

  async getAcpCapabilities(cliId: AgentId): Promise<AcpCliCapabilities> {
    const fallbackModels = {
      codex: [
        { value: "default", label: "Default", description: "Use the CLI default model", source: "fallback" as const },
        { value: "gpt-5.3-codex", label: "gpt-5.3-codex", description: "Codex-tuned GPT-5.3 model", source: "fallback" as const },
        { value: "gpt-5.4", label: "gpt-5.4", description: "Latest general-purpose GPT-5.4 model", source: "fallback" as const },
        { value: "gpt-5.2-codex", label: "gpt-5.2-codex", description: "Codex-tuned GPT-5.2 model", source: "fallback" as const },
        { value: "gpt-5.2", label: "gpt-5.2", description: "General-purpose GPT-5.2 model", source: "fallback" as const },
      ],
      claude: [
        { value: "default", label: "Default", description: "Use the CLI default model", source: "fallback" as const },
        { value: "sonnet", label: "sonnet", description: "Claude Sonnet alias", source: "fallback" as const },
        { value: "opus", label: "opus", description: "Claude Opus alias", source: "fallback" as const },
      ],
      gemini: [
        { value: "default", label: "Default", description: "Use the CLI default model", source: "fallback" as const },
        { value: "gemini-3.1-pro-preview", label: "gemini-3.1-pro-preview", description: "Preview Gemini 3.1 Pro model", source: "fallback" as const },
        { value: "gemini-3-flash-preview", label: "gemini-3-flash-preview", description: "Preview Gemini 3 Flash model", source: "fallback" as const },
        { value: "gemini-2.5-pro", label: "gemini-2.5-pro", description: "High-capability Gemini 2.5 Pro model", source: "fallback" as const },
        { value: "gemini-2.5-flash", label: "gemini-2.5-flash", description: "Fast Gemini 2.5 Flash model", source: "fallback" as const },
        { value: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite", description: "Lightweight Gemini 2.5 Flash Lite model", source: "fallback" as const },
      ],
    } satisfies Record<AgentId, AcpCliCapabilities["model"]["options"]>;

    const permissionOptions = {
      codex: [
        { value: "read-only", label: "read-only", description: "Read-only shell sandbox", source: "runtime" as const },
        { value: "workspace-write", label: "workspace-write", description: "Allow edits inside the workspace", source: "runtime" as const },
        { value: "danger-full-access", label: "danger-full-access", description: "Disable sandbox restrictions", source: "runtime" as const },
      ],
      claude: [
        { value: "acceptEdits", label: "acceptEdits", description: "Auto-approve edit actions", source: "runtime" as const },
        { value: "bypassPermissions", label: "bypassPermissions", description: "Bypass permission checks", source: "runtime" as const },
        { value: "default", label: "default", description: "Use Claude default permission mode", source: "runtime" as const },
        { value: "dontAsk", label: "dontAsk", description: "Do not ask before actions", source: "runtime" as const },
        { value: "plan", label: "plan", description: "Read-only planning mode", source: "runtime" as const },
        { value: "auto", label: "auto", description: "Automatic permission behavior", source: "runtime" as const },
      ],
      gemini: [
        { value: "default", label: "default", description: "Prompt for approval when needed", source: "runtime" as const },
        { value: "auto_edit", label: "auto_edit", description: "Auto-approve edit tools", source: "runtime" as const },
        { value: "yolo", label: "yolo", description: "Auto-approve all tools", source: "runtime" as const },
        { value: "plan", label: "plan", description: "Read-only plan mode", source: "runtime" as const },
      ],
    } satisfies Record<AgentId, AcpCliCapabilities["permissions"]["options"]>;

    return {
      cliId,
      model: {
        supported: true,
        options: fallbackModels[cliId],
        note: "Browser fallback cannot interrogate the installed CLI, so model presets are curated.",
      },
      permissions: {
        supported: true,
        options: permissionOptions[cliId],
        note:
          cliId === "codex"
            ? "Codex permission selection maps to exec sandbox modes in the desktop runtime."
            : null,
      },
      effort: {
        supported: cliId === "claude",
        options:
          cliId === "claude"
            ? [
                { value: "low", label: "low", description: "Lower reasoning effort", source: "runtime" as const },
                { value: "medium", label: "medium", description: "Balanced reasoning effort", source: "runtime" as const },
                { value: "high", label: "high", description: "High reasoning effort", source: "runtime" as const },
                { value: "max", label: "max", description: "Maximum reasoning effort", source: "runtime" as const },
              ]
            : [],
        note: cliId === "claude" ? null : "Reasoning effort is only exposed by Claude CLI.",
      },
    };
  },

  async semanticRecall(): Promise<SemanticMemoryChunk[]> {
    return [];
  },
};
const MOCK_WORKSPACE_FILE_PATHS = [
  "src/pages/TerminalPage.tsx",
  "src/components/chat/ChatPromptBar.tsx",
  "src/components/chat/ChatConversation.tsx",
  "src/components/chat/GitPanel.tsx",
  "src/lib/store.ts",
  "src/lib/bridge.ts",
  "src-tauri/src/main.rs",
];

function normalizeMockWorkspaceRelativePath(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function listMockWorkspaceEntries(relativePath?: string | null): WorkspaceTreeEntry[] {
  const normalizedParent = normalizeMockWorkspaceRelativePath(relativePath);
  const childrenByPath = new Map<string, WorkspaceTreeEntry>();

  for (const filePath of MOCK_WORKSPACE_FILE_PATHS) {
    const normalizedPath = normalizeMockWorkspaceRelativePath(filePath);
    if (!normalizedPath) continue;
    const segments = normalizedPath.split("/");
    const parentSegments = normalizedParent ? normalizedParent.split("/") : [];
    if (segments.length <= parentSegments.length) continue;
    if (parentSegments.some((segment, index) => segments[index] !== segment)) continue;

    const nextSegment = segments[parentSegments.length];
    if (!nextSegment) continue;
    const childSegments = [...parentSegments, nextSegment];
    const childPath = childSegments.join("/");
    const isDirectory = segments.length > childSegments.length;

    if (!childrenByPath.has(childPath)) {
      childrenByPath.set(childPath, {
        name: nextSegment,
        path: childPath,
        kind: isDirectory ? "directory" : "file",
        hasChildren: isDirectory,
      });
      continue;
    }

    if (isDirectory) {
      childrenByPath.set(childPath, {
        name: nextSegment,
        path: childPath,
        kind: "directory",
        hasChildren: true,
      });
    }
  }

  return Array.from(childrenByPath.values()).sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
  });
}

function buildMockWorkspaceFileIndex(): WorkspaceFileIndexResponse {
  const entriesByParent: Record<string, WorkspaceTreeEntry[]> = { "": listMockWorkspaceEntries("") };
  for (const filePath of MOCK_WORKSPACE_FILE_PATHS) {
    const normalizedPath = normalizeMockWorkspaceRelativePath(filePath);
    if (!normalizedPath) continue;
    const segments = normalizedPath.split("/");
    let parentPath = "";
    for (let index = 0; index < segments.length - 1; index += 1) {
      const nextParent = segments.slice(0, index + 1).join("/");
      if (!(parentPath in entriesByParent)) {
        entriesByParent[parentPath] = listMockWorkspaceEntries(parentPath);
      }
      if (!(nextParent in entriesByParent)) {
        entriesByParent[nextParent] = listMockWorkspaceEntries(nextParent);
      }
      parentPath = nextParent;
    }
  }
  return {
    entriesByParent,
    files: MOCK_WORKSPACE_FILE_PATHS.map((relativePath) => ({
      id: relativePath,
      name: basename(relativePath),
      relativePath,
      absolutePath: null,
    })),
  };
}
