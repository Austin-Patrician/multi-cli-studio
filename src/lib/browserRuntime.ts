import {
  AppState,
  AgentId,
  AutomationJob,
  AutomationJobDraft,
  AutomationGoal,
  AutomationGoalDraft,
  AutomationGoalRuleConfig,
  AutomationGoalStatus,
  AutomationParameterDefinition,
  AutomationPermissionProfile,
  AutomationParameterValue,
  AutomationRunDetail,
  AutomationRunRecord,
  AutomationRuleProfile,
  AutomationRun,
  AutomationRunStatus,
  AgentTransportKind,
  AgentTransportSession,
  AgentRuntimeResources,
  AgentPromptRequest,
  AssistantApprovalDecision,
  AutoOrchestrationRequest,
  ChatMessageBlocksUpdateRequest,
  ChatMessageDeleteRequest,
  ChatMessageFinalizeRequest,
  ChatMessageBlock,
  ChatMessagesAppendRequest,
  ChatMessageStreamUpdateRequest,
  CliHandoffRequest,
  CliSkillItem,
  TerminalEvent,
  TerminalLine,
  ContextStore,
  ConversationTurn,
  CreateAutomationRunFromJobRequest,
  CreateAutomationRunRequest,
  AppSettings,
  EnrichedHandoff,
  ChatPromptRequest,
  FileMentionCandidate,
  GitFileDiff,
  StreamEvent,
  GitPanelData,
  GitFileChange,
  PersistedTerminalState,
  WorkspacePickResult,
} from "./models";
import {
  AcpCliCapabilities,
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
const TERMINAL_STATE_KEY = "multi-cli-studio::terminal-state";
const AUTOMATION_JOBS_KEY = "multi-cli-studio::automation-jobs";
const AUTOMATION_RUNS_KEY = "multi-cli-studio::automation-runs";
const AUTOMATION_RULE_KEY = "multi-cli-studio::automation-rule";

let state: AppState = loadStoredState();
let contextStore: ContextStore = loadStoredContext();
let settings: AppSettings = loadStoredSettings();
let acpSession: AcpSession = defaultAcpSession();
let automationJobs: AutomationJob[] = loadStoredAutomationJobs();
let automationRuns: AutomationRun[] = loadStoredAutomationRuns();
let automationRuleProfile: AutomationRuleProfile = loadStoredAutomationRuleProfile();

automationRuns
  .filter((run) => run.status === "scheduled")
  .forEach((run) => {
    if (typeof window !== "undefined") {
      window.setTimeout(() => scheduleBrowserAutomationRun(run.id), 0);
    }
  });

const stateListeners = new Set<StateListener>();
const terminalListeners = new Set<TerminalListener>();
const streamListeners = new Set<StreamListener>();

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
  return {
    cliPaths: { codex: "auto", claude: "auto", gemini: "auto" },
    projectRoot: state?.workspace?.projectRoot ?? "C:\\Users\\admin\\source\\repos\\multi-cli-studio",
    maxTurnsPerAgent: 50,
    maxOutputCharsPerTurn: 100000,
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
  };
}

function normalizeSettings(value: unknown): AppSettings {
  const defaults = defaultSettings();
  if (!value || typeof value !== "object") return defaults;

  const raw = value as Partial<AppSettings> & {
    cliPaths?: Partial<AppSettings["cliPaths"]>;
  };

  return {
    cliPaths: {
      ...defaults.cliPaths,
      ...(raw.cliPaths ?? {}),
    },
    projectRoot:
      typeof raw.projectRoot === "string" && raw.projectRoot.trim()
        ? raw.projectRoot
        : defaults.projectRoot,
    maxTurnsPerAgent: parsePositiveNumber(raw.maxTurnsPerAgent, defaults.maxTurnsPerAgent),
    maxOutputCharsPerTurn: parsePositiveNumber(raw.maxOutputCharsPerTurn, defaults.maxOutputCharsPerTurn),
    processTimeoutMs: parsePositiveNumber(raw.processTimeoutMs, defaults.processTimeoutMs),
    notifyOnTerminalCompletion: raw.notifyOnTerminalCompletion === true,
    notificationConfig: raw.notificationConfig ?? defaults.notificationConfig,
  };
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
      lastTriggeredAt: job.lastTriggeredAt ?? null,
      enabled: job.enabled !== false,
      createdAt: job.createdAt ?? nowISO(),
      updatedAt: job.updatedAt ?? nowISO(),
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

function basename(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
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
  const paused = run.goals.filter((goal) => goal.status === "paused").length;
  return `${completed}/${run.goals.length} completed • ${failed} failed • ${paused} paused`;
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
    displayStatus:
      run.attentionStatus === "waiting_human"
        ? "waiting_human"
        : run.attentionStatus === "blocked_by_policy"
          ? "blocked_by_policy"
          : run.attentionStatus === "blocked_by_environment"
            ? "blocked_by_environment"
            : run.outcomeStatus === "success"
              ? "success"
              : run.outcomeStatus === "failed"
                ? "failed"
                : run.outcomeStatus === "partial"
                  ? "partial"
                  : run.lifecycleStatus ?? "unknown",
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
    goal?.latestProgressSummary ? `Progress: ${goal.latestProgressSummary}` : null,
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
    settings = normalizeSettings(newSettings);
    contextStore.maxTurnsPerAgent = settings.maxTurnsPerAgent;
    contextStore.maxOutputCharsPerTurn = settings.maxOutputCharsPerTurn;
    persistSettings();
    persistContext();
    return structuredClone(settings);
  },

  async loadTerminalState() {
    return structuredClone(loadStoredTerminalState());
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
  async restartAutomationRun(runId: string) {
    const run = automationRuns.find((item) => item.id === runId);
    if (!run) throw new Error("Automation run not found.");
    run.status = "scheduled";
    run.scheduledStartAt = nowISO();
    run.startedAt = null;
    run.completedAt = null;
    run.summary = null;
    run.updatedAt = nowISO();
    run.goals = run.goals.map((goal) => ({
      ...goal,
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

  async getCliSkills(cliId: AgentId, _projectRoot: string): Promise<CliSkillItem[]> {
    return structuredClone(fallbackCliSkills(cliId));
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

  async getAcpCapabilities(cliId: AgentId): Promise<AcpCliCapabilities> {
    const fallbackModels = {
      codex: [
        { value: "default", label: "Default", description: "Use the CLI default model", source: "fallback" as const },
        { value: "gpt-5", label: "gpt-5", description: "General-purpose flagship", source: "fallback" as const },
        { value: "gpt-5-codex", label: "gpt-5-codex", description: "Code-focused GPT-5 profile", source: "fallback" as const },
        { value: "gpt-5-mini", label: "gpt-5-mini", description: "Lighter GPT-5 variant", source: "fallback" as const },
        { value: "o3", label: "o3", description: "Reasoning-focused model alias", source: "fallback" as const },
        { value: "oss", label: "oss", description: "Use local open-source provider mode", source: "fallback" as const },
      ],
      claude: [
        { value: "default", label: "Default", description: "Use the CLI default model", source: "fallback" as const },
        { value: "sonnet", label: "sonnet", description: "Claude Sonnet alias", source: "fallback" as const },
        { value: "opus", label: "opus", description: "Claude Opus alias", source: "fallback" as const },
      ],
      gemini: [
        { value: "default", label: "Default", description: "Use the CLI default model", source: "fallback" as const },
        { value: "gemini-3-flash-preview", label: "gemini-3-flash-preview", description: "Preview of the next-generation flash model", source: "fallback" as const },
        { value: "gemini-2.5-pro", label: "gemini-2.5-pro", description: "High-capability Gemini preset", source: "fallback" as const },
        { value: "gemini-2.5-flash", label: "gemini-2.5-flash", description: "Fast Gemini preset", source: "fallback" as const },
        { value: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite", description: "Lightweight fast Gemini preset", source: "fallback" as const },
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
};
