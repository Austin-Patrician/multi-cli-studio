import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  Activity as ActivityIcon,
  Bot,
  Braces,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock3 as ClockIcon,
  FilePlus2,
  FileCode2,
  FileSearch as FileLookupIcon,
  FolderPlus,
  FolderTree as FilesPanelIcon,
  GitBranch as GitIcon,
  LayoutList as RadarIcon,
  Network as WorkflowIcon,
  LoaderCircle as SpinnerIcon,
  RefreshCw as RefreshIcon,
  Search as SearchIcon,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  XCircle,
} from "lucide-react";
import type {
  AgentId,
  ChatMessage,
  ChatMessageBlock,
  ConversationSession,
  FileMentionCandidate,
  GitFileChange,
  TerminalTab,
  TabSubagentState,
  WorkspaceRef,
  WorkspaceTextSearchFileResult,
  WorkspaceTextSearchResponse,
  StudioWorkflowArtifact,
  StudioWorkflowManifestEntry,
  StudioWorkflowMemoryCandidate,
  StudioWorkflowState,
  StudioWorkflowTimelineEvent,
  WorkspaceTreeEntry,
} from "../../lib/models";
import { bridge } from "../../lib/bridge";
import { useStore } from "../../lib/store";
import {
  isWorkspaceFileIndexFresh,
  loadWorkspaceFileIndex,
  peekWorkspaceFileIndex,
} from "../../lib/workspaceFileIndex";
import { FileIcon } from "../FileIcon";
import { GitPanel } from "./GitPanel";
import { type WorkspacePanelMode } from "./workspacePanelModes";
type WorkspaceCreateDialogKind = "file" | "folder";

type SessionSummary = {
  tabId: string;
  title: string;
  cliId: AgentId;
  updatedAt: number;
  preview: string;
  isRunning: boolean;
  changedFiles: string[];
  messageCount: number;
};

type TaskNode = {
  id: string;
  detail: string;
  timestamp: string;
  isLatest: boolean;
};

type ActivityEntry = {
  id: string;
  messageId: string;
  messageRole: ChatMessage["role"];
  timestamp: number;
  tabId: string;
  cliId: AgentId;
  kind: "command" | "fileChange" | "tool" | "subagent" | "status" | "approval" | "task" | "reasoning" | "routing" | "message";
  label: string;
  detail: string;
  filePath?: string | null;
};

const EMPTY_TREE: WorkspaceTreeEntry[] = [];
const EMPTY_CHAT_SESSIONS: Record<string, ConversationSession> = {};
const EMPTY_GIT_CHANGES: GitFileChange[] = [];
const EMPTY_SUBAGENTS: TabSubagentState[] = [];
const REMOTE_FILE_TREE_CACHE_TTL_MS = 30_000;
const workspaceTreeUiStateByWorkspace = new Map<
  string,
  {
    expandedDirectories: Record<string, boolean>;
  }
>();
function basename(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function dirname(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function formatTimeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  const diffMs = Date.now() - parsed;
  if (diffMs < 60_000) return "just now";
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatDateKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveEffectiveCli(tab: TerminalTab, workspace: WorkspaceRef, session: ConversationSession): AgentId {
  const selectedCli = tab.selectedCli === "auto" || !tab.selectedCli ? workspace.activeAgent : tab.selectedCli;
  const recentCli =
    [...session.messages]
      .reverse()
      .find((message) => message.cliId && message.role !== "system")
      ?.cliId ?? null;
  return (recentCli ?? selectedCli) as AgentId;
}

function extractMessagePreview(session: ConversationSession) {
  const candidate =
    [...session.messages]
      .reverse()
      .find((message) => message.role !== "system" && (message.rawContent ?? message.content).trim()) ?? null;
  if (!candidate) return "No activity yet";
  const content = (candidate.rawContent ?? candidate.content).replace(/\s+/g, " ").trim();
  return content.length > 120 ? `${content.slice(0, 117)}...` : content;
}

function collectChangedFiles(session: ConversationSession) {
  const files = new Set<string>();
  for (const message of session.messages) {
    for (const block of message.blocks ?? []) {
      if (block.kind === "fileChange") {
        files.add(block.path);
      }
    }
  }
  return Array.from(files).slice(-6);
}

function buildSessionSummary(tab: TerminalTab, workspace: WorkspaceRef, session: ConversationSession): SessionSummary {
  const updatedAt = Date.parse(session.updatedAt);
  const messageCount = session.messages.filter((message) => message.role !== "system").length;
  const isRunning = tab.status === "streaming" || session.messages.some((message) => message.isStreaming);
  return {
    tabId: tab.id,
    title: tab.title || workspace.name,
    cliId: resolveEffectiveCli(tab, workspace, session),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    preview: extractMessagePreview(session),
    isRunning,
    changedFiles: collectChangedFiles(session),
    messageCount,
  };
}

function buildTaskNodes(session: ConversationSession | null): TaskNode[] {
  if (!session) return [];

  const prompts = session.messages
    .filter((message) => message.role === "user")
    .map((message) => {
      const detail = (message.rawContent ?? message.content).replace(/\s+/g, " ").trim();
      return {
        id: message.id,
        detail: detail.length > 160 ? `${detail.slice(0, 157)}...` : detail,
        timestamp: formatTimeAgo(message.timestamp),
      };
    })
    .filter((message) => message.detail.length > 0)
    .slice(-40);

  return prompts
    .reverse()
    .map((prompt, index) => ({
      ...prompt,
      isLatest: index === 0,
    }));
}

function formatActivityDetail(message: ChatMessage, block: ChatMessageBlock | null) {
  if (!block) {
    const content = (message.rawContent ?? message.content).replace(/\s+/g, " ").trim();
    return content.length > 160 ? `${content.slice(0, 157)}...` : content || "No details";
  }

  switch (block.kind) {
    case "command":
      return block.command;
    case "fileChange":
      return block.path;
    case "tool":
      return block.summary?.trim() || block.tool;
    case "subagent":
      return block.description;
    case "status":
      return block.text;
    case "approvalRequest":
      return block.summary?.trim() || block.description?.trim() || block.toolName;
    case "orchestrationPlan":
      return block.goal;
    case "orchestrationStep":
      return block.result?.trim() || block.summary?.trim() || block.title;
    case "reasoning":
      return block.text;
    case "text":
    case "plan":
      return block.text;
    case "autoRoute":
      return `${block.targetCli} · ${block.reason}`;
    default:
      return (message.rawContent ?? message.content).trim();
  }
}

function formatActivityLabel(message: ChatMessage, block: ChatMessageBlock | null) {
  if (!block) {
    if (message.role === "user") return "Prompt";
    if (message.role === "assistant") return "Response";
    return "System";
  }

  switch (block.kind) {
    case "command":
      return "Command";
    case "fileChange":
      return "File change";
    case "tool":
      return "Tool";
    case "subagent":
      return "Subagent";
    case "status":
      return block.level === "error" ? "Error" : block.level === "warning" ? "Warning" : "Status";
    case "approvalRequest":
      return "Approval";
    case "orchestrationPlan":
      return "Plan";
    case "orchestrationStep":
      return "Execution";
    case "reasoning":
      return "Reasoning";
    case "autoRoute":
      return "Routing";
    case "text":
      return "Output";
    case "plan":
      return "Plan";
    default:
      return "Activity";
  }
}

function formatActivityKind(message: ChatMessage, block: ChatMessageBlock | null): ActivityEntry["kind"] {
  if (!block) {
    return "message";
  }

  switch (block.kind) {
    case "command":
      return "command";
    case "fileChange":
      return "fileChange";
    case "tool":
      return "tool";
    case "subagent":
      return "subagent";
    case "status":
      return "status";
    case "approvalRequest":
      return "approval";
    case "orchestrationPlan":
    case "orchestrationStep":
    case "plan":
      return "task";
    case "reasoning":
      return "reasoning";
    case "autoRoute":
      return "routing";
    default:
      return "message";
  }
}

function buildActivityEntries(
  workspace: WorkspaceRef,
  tabs: TerminalTab[],
  sessionsByTabId: Record<string, ConversationSession>
) {
  const entries: ActivityEntry[] = [];

  for (const tab of tabs) {
    const session = sessionsByTabId[tab.id];
    if (!session) continue;
    const cliId = resolveEffectiveCli(tab, workspace, session);

    for (const message of session.messages) {
      const timestamp = Date.parse(message.timestamp);
      const fallbackTimestamp = Date.parse(session.updatedAt);
      const resolvedTimestamp = Number.isFinite(timestamp)
        ? timestamp
        : Number.isFinite(fallbackTimestamp)
          ? fallbackTimestamp
          : 0;

      const blocks = message.blocks ?? [];
      if (blocks.length === 0) {
        if (message.role === "system" && !(message.content || "").trim()) {
          continue;
        }
        entries.push({
          id: `${tab.id}:${message.id}:message`,
          messageId: message.id,
          messageRole: message.role,
          timestamp: resolvedTimestamp,
          tabId: tab.id,
          cliId: message.cliId ?? cliId,
          kind: formatActivityKind(message, null),
          label: formatActivityLabel(message, null),
          detail: formatActivityDetail(message, null),
          filePath: null,
        });
        continue;
      }

      blocks.forEach((block, index) => {
        entries.push({
          id: `${tab.id}:${message.id}:${block.kind}:${index}`,
          messageId: message.id,
          messageRole: message.role,
          timestamp: resolvedTimestamp,
          tabId: tab.id,
          cliId: message.cliId ?? cliId,
          kind: formatActivityKind(message, block),
          label: formatActivityLabel(message, block),
          detail: formatActivityDetail(message, block),
          filePath: block.kind === "fileChange" ? block.path : null,
        });
      });
    }
  }

  return entries
    .filter((entry) => entry.detail.trim().length > 0)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 40);
}

function gitStatusClass(status: GitFileChange["status"] | undefined) {
  switch (status) {
    case "added":
      return " git-a";
    case "modified":
      return " git-m";
    case "deleted":
      return " git-d";
    case "renamed":
      return " git-r";
    default:
      return "";
  }
}

function changeStatusMap(changes: GitFileChange[]) {
  const map = new Map<string, GitFileChange["status"]>();
  changes.forEach((change) => {
    map.set(change.path.replace(/\\/g, "/"), change.status);
  });
  return map;
}

const WORKFLOW_PHASES = [
  { id: "planning", label: "Plan" },
  { id: "context_curated", label: "Context" },
  { id: "implementing", label: "Build" },
  { id: "checking", label: "Check" },
  { id: "memory_distilled", label: "Memory" },
  { id: "completed", label: "Done" },
] as const;

type WorkflowGateTone = "pass" | "warn" | "fail" | "idle";
type WorkflowPhaseTone = "done" | "active" | "pending";
type WorkflowDetailView = "events" | "manifest" | "reports" | "memory" | "resources";

function normalizeWorkflowLabel(value: string | null | undefined, fallback = "pending") {
  const normalized = value?.trim();
  return normalized ? normalized.replace(/_/g, " ") : fallback;
}

function workflowPhaseIndex(phase: string | null | undefined) {
  const normalized = phase ?? "";
  if (normalized === "memory_distilled") return 4;
  if (normalized === "completed" || normalized === "browser_runtime") return 5;
  return WORKFLOW_PHASES.findIndex((item) => item.id === normalized);
}

function workflowPhaseTone(currentPhase: string, phaseId: (typeof WORKFLOW_PHASES)[number]["id"]): WorkflowPhaseTone {
  const currentIndex = workflowPhaseIndex(currentPhase);
  const phaseIndex = workflowPhaseIndex(phaseId);
  if (currentIndex < 0 || phaseIndex < 0) return "pending";
  if (phaseIndex < currentIndex) return "done";
  if (phaseIndex === currentIndex) return "active";
  return "pending";
}

function workflowPhaseClass(tone: WorkflowPhaseTone) {
  switch (tone) {
    case "done":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "active":
      return "border-blue-200 bg-blue-50 text-blue-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-500";
  }
}

function workflowGateClass(tone: WorkflowGateTone) {
  switch (tone) {
    case "pass":
      return "border-emerald-200 bg-emerald-50/70";
    case "warn":
      return "border-amber-200 bg-amber-50/80";
    case "fail":
      return "border-red-200 bg-red-50/80";
    default:
      return "border-border bg-white";
  }
}

function workflowStatusClass(tone: WorkflowGateTone) {
  switch (tone) {
    case "pass":
      return "border-emerald-200 bg-white text-emerald-700";
    case "warn":
      return "border-amber-200 bg-white text-amber-700";
    case "fail":
      return "border-red-200 bg-white text-red-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function artifactStatusClass(status: string) {
  return status === "ready"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-50 text-slate-500";
}

function workflowSmallStatusClass(status: string | null | undefined) {
  const normalized = (status ?? "").toLowerCase();
  if (["ready", "pass", "promotable", "promoted", "curated", "completed"].includes(normalized)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (["fail", "failed", "rejected", "missing"].includes(normalized)) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (["held", "hold", "pending_checker", "skipped", "warn", "fallback", "curated_with_fallback"].includes(normalized)) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function formatManifestScore(entry: StudioWorkflowManifestEntry) {
  if (typeof entry.confidence === "number") return `${Math.round(entry.confidence * 100)}%`;
  if (typeof entry.score === "number") return `score ${entry.score}`;
  return "scored";
}

function timelineTone(status: string): WorkflowGateTone {
  const normalized = status.toLowerCase();
  if (["pass", "ready", "promoted", "completed", "curated"].includes(normalized)) return "pass";
  if (["fail", "failed", "missing", "rejected"].includes(normalized)) return "fail";
  if (["held", "hold", "pending_checker", "skipped", "checking", "fallback", "curated_with_fallback"].includes(normalized)) return "warn";
  return "idle";
}

function candidateStatusClass(candidate: StudioWorkflowMemoryCandidate) {
  return workflowSmallStatusClass(candidate.status);
}

function formatArtifactSize(sizeBytes: number | null | undefined) {
  if (!sizeBytes) return null;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 102.4) / 10} KB`;
  return `${Math.round(sizeBytes / 1024 / 102.4) / 10} MB`;
}

function formatWorkflowTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  return timestamp.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatArtifactMeta(artifact: StudioWorkflowArtifact) {
  return [formatArtifactSize(artifact.sizeBytes), formatWorkflowTimestamp(artifact.updatedAt)].filter(Boolean).join(" · ");
}

function WorkflowGateTile({
  icon: Icon,
  title,
  status,
  tone,
  metric,
  detail,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  status: string;
  tone: WorkflowGateTone;
  metric: string;
  detail: string;
}) {
  return (
    <div className={`min-w-0 rounded-[16px] border px-3 py-3 ${workflowGateClass(tone)}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-secondary" />
          <div className="min-w-0">
            <div className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary">{title}</div>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${workflowStatusClass(
            tone,
          )}`}
        >
          {status}
        </span>
      </div>
      <div className="mt-2 truncate text-sm font-semibold text-primary">{metric}</div>
      <div className="mt-0.5 truncate text-[11px] text-secondary">{detail}</div>
    </div>
  );
}

function WorkflowEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[14px] border border-dashed border-border bg-slate-50 px-3 py-4 text-center text-xs text-secondary">
      {children}
    </div>
  );
}

function WorkflowManifestRow({
  entry,
  workspace,
}: {
  entry: StudioWorkflowManifestEntry;
  workspace: WorkspaceRef;
}) {
  const ready = entry.status === "ready";
  return (
    <button
      type="button"
      className="w-full rounded-[14px] border border-border bg-slate-50 px-3 py-2 text-left text-xs hover:bg-slate-100 disabled:cursor-default disabled:opacity-60"
      disabled={!ready}
      onClick={() => {
        if (ready) void bridge.openWorkspaceFile(workspace.rootPath, entry.file, workspace.id);
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-secondary">
              {entry.manifest}
            </span>
            <span className="truncate font-semibold text-primary">{entry.file}</span>
          </div>
          <div className="mt-1 line-clamp-2 break-words text-secondary">{entry.reason}</div>
        </div>
        <div className="shrink-0 text-right">
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${workflowSmallStatusClass(entry.status)}`}>
            {entry.fallback ? "fallback" : entry.status}
          </span>
          <div className="mt-1 text-[10px] text-secondary">{formatManifestScore(entry)}</div>
        </div>
      </div>
    </button>
  );
}

function WorkflowTimelineRow({
  event,
  workspace,
}: {
  event: StudioWorkflowTimelineEvent;
  workspace: WorkspaceRef;
}) {
  const tone = timelineTone(event.status);
  const timestamp = formatWorkflowTimestamp(event.timestamp);
  return (
    <button
      type="button"
      className="grid w-full grid-cols-[16px_1fr] gap-3 rounded-[14px] px-2 py-2 text-left text-xs hover:bg-slate-50 disabled:cursor-default"
      disabled={!event.path}
      onClick={() => {
        if (event.path) void bridge.openWorkspaceFile(workspace.rootPath, event.path, workspace.id);
      }}
    >
      <span className={`mt-1 h-3 w-3 rounded-full border ${workflowStatusClass(tone)}`} />
      <span className="min-w-0">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate font-semibold text-primary">{event.title}</span>
            <span className="mt-0.5 block line-clamp-2 break-words text-secondary">{event.summary}</span>
          </span>
          <span className="shrink-0 text-right">
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${workflowSmallStatusClass(event.status)}`}>
              {normalizeWorkflowLabel(event.status)}
            </span>
            <span className="mt-1 block max-w-[88px] truncate text-[10px] text-secondary">{timestamp ?? "no time"}</span>
          </span>
        </span>
      </span>
    </button>
  );
}

function WorkflowMemoryCandidateRow({ candidate }: { candidate: StudioWorkflowMemoryCandidate }) {
  return (
    <div className="rounded-[14px] border border-border bg-slate-50 px-3 py-2 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-secondary">
              {candidate.kind}
            </span>
            <span className="truncate text-secondary">{candidate.candidateType}</span>
          </div>
          <div className="mt-1 line-clamp-3 break-words font-medium text-primary">{candidate.content}</div>
        </div>
        <div className="shrink-0 text-right">
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${candidateStatusClass(candidate)}`}>
            {candidate.status}
          </span>
          <div className="mt-1 text-[10px] text-secondary">{candidate.target}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-secondary">
        <span>confidence {candidate.confidence}</span>
        <span>evidence {candidate.evidenceCount}</span>
        {candidate.updatedAt ? <span>{formatWorkflowTimestamp(candidate.updatedAt)}</span> : null}
      </div>
    </div>
  );
}

function StudioWorkflowPanel({ workspace, terminalTabId }: { workspace: WorkspaceRef; terminalTabId: string | null }) {
  const [workflowState, setWorkflowState] = useState<StudioWorkflowState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [detailView, setDetailView] = useState<WorkflowDetailView>("events");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const state = await bridge.getStudioWorkflowState(workspace.rootPath, terminalTabId);
      setWorkflowState(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [terminalTabId, workspace.rootPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runPromotion = useCallback(async () => {
    if (!workflowState?.taskId) return;
    setPromoting(true);
    setError(null);
    try {
      await bridge.runStudioPolicyPromotion(workspace.rootPath, workflowState.taskId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPromoting(false);
    }
  }, [refresh, workflowState?.taskId, workspace.rootPath]);

  const fallbackArtifacts: StudioWorkflowArtifact[] = workflowState
    ? [
        ["PRD", workflowState.prdPath],
        ["Context Report", workflowState.contextReportPath],
        ["Implement Manifest", workflowState.implementManifestPath],
        ["Check Manifest", workflowState.checkManifestPath],
        ["Checker Report", workflowState.checkerReportPath],
        ["Checker Retry", workflowState.checkerRetryReportPath],
        ["Policy Check", workflowState.policyCheckPath],
        ["Promotion Report", workflowState.promotionReportPath],
      ]
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([label, path]) => ({ label, path, status: "ready", updatedAt: null, sizeBytes: null }))
    : [];
  const artifactRows = workflowState?.artifacts?.length ? workflowState.artifacts : fallbackArtifacts;
  const checkerStatus = workflowState?.checkerStatus ?? null;
  const checkerTone: WorkflowGateTone =
    checkerStatus === "pass" ? "pass" : checkerStatus === "fail" ? "fail" : workflowState?.checkerNeedsRetry ? "warn" : "idle";
  const checkerStatusLabel = normalizeWorkflowLabel(checkerStatus);
  const contextCuratorStatus = workflowState?.contextCuratorStatus ?? null;
  const contextCuratorMode = workflowState?.contextCuratorMode ?? null;
  const contextTone: WorkflowGateTone =
    workflowState?.contextCuratorError
      ? "fail"
      : workflowState?.contextCuratorFallback || contextCuratorStatus === "fallback" || contextCuratorStatus === "curated_with_fallback"
        ? "warn"
        : workflowState?.contextReportPath && (workflowState.implementEntries > 0 || workflowState.checkEntries > 0)
          ? "pass"
          : "warn";
  const memoryTone: WorkflowGateTone = workflowState?.allowAutoPromote
    ? "pass"
    : workflowState?.memoryPromotableEntries
      ? "warn"
      : workflowState?.memoryCandidateEntries
        ? "idle"
        : "idle";
  const promotionTone: WorkflowGateTone = workflowState?.promotionPromoted
    ? "pass"
    : workflowState?.promotionSkipped || workflowState?.promotionDecision
      ? "warn"
      : "idle";
  const contextStatus = normalizeWorkflowLabel(
    contextCuratorStatus,
    contextTone === "pass" ? "curated" : workflowState?.contextCuratorFallback ? "fallback" : "pending",
  );
  const memoryStatus = workflowState?.allowAutoPromote
    ? "ready"
    : workflowState?.memoryPromotableEntries
      ? "held"
      : workflowState?.memoryCandidateEntries
        ? "candidate"
        : "pending";
  const promotionStatus = normalizeWorkflowLabel(workflowState?.promotionDecision, "pending");
  const manifestRows = workflowState?.manifestEntries ?? [];
  const timelineRows = workflowState?.timeline ?? [];
  const checkerPreviews = workflowState
    ? [
        { label: "Checker Report", path: workflowState.checkerReportPath, content: workflowState.checkerReportPreview },
        { label: "Checker Retry", path: workflowState.checkerRetryReportPath, content: workflowState.checkerRetryReportPreview },
      ].filter((entry): entry is { label: string; path: string | null; content: string } => Boolean(entry.content))
    : [];
  const memoryCandidates = workflowState?.memoryCandidates ?? [];
  const gateSummaries = workflowState
    ? [
        {
          key: "context",
          icon: FileLookupIcon,
          title: "Context",
          status: contextStatus,
          tone: contextTone,
          metric: `${workflowState.implementEntries}/${workflowState.checkEntries}`,
          detail: contextCuratorMode
            ? normalizeWorkflowLabel(contextCuratorMode)
            : `${workflowState.researchArtifacts.length} research`,
          summary:
            workflowState.contextCuratorError ??
            workflowState.contextCuratorReason ??
            "Context projection and manifests are ready for the active task.",
        },
        {
          key: "checker",
          icon: ShieldCheck,
          title: "Checker",
          status: checkerStatusLabel,
          tone: checkerTone,
          metric: `${workflowState.checkerIssues.length} issues`,
          detail: workflowState.checkerRetryPerformed ? workflowState.checkerRetryStatus ?? "retry done" : "retry not run",
          summary: workflowState.checkerSummary ?? "Checker has not produced a summary yet.",
        },
        {
          key: "memory",
          icon: Braces,
          title: "Memory",
          status: memoryStatus,
          tone: memoryTone,
          metric: `${workflowState.memoryPromotableEntries} promotable`,
          detail: `${workflowState.memoryRejectedEntries} rejected`,
          summary: workflowState.memoryPolicyReason ?? `Policy is ${workflowState.policyDecision ?? "pending"}.`,
        },
        {
          key: "promotion",
          icon: CheckCircle2,
          title: "Promotion",
          status: promotionStatus,
          tone: promotionTone,
          metric: `${workflowState.promotionPromoted} promoted`,
          detail: `${workflowState.promotionSkipped} skipped`,
          summary: workflowState.allowAutoPromote
            ? "Promotion is allowed by policy."
            : "Promotion waits for policy, checker, or candidate gates.",
        },
      ]
    : [];
  const activeGate =
    gateSummaries.find((gate) => gate.tone === "fail") ??
    gateSummaries.find((gate) => gate.tone === "warn") ??
    gateSummaries.find((gate) => gate.tone === "idle") ??
    gateSummaries[gateSummaries.length - 1] ??
    null;
  const ActiveGateIcon = activeGate?.icon ?? WorkflowIcon;
  const detailTabs: Array<{ id: WorkflowDetailView; label: string; count: number; icon: ComponentType<{ className?: string }> }> = [
    { id: "events", label: "Events", count: timelineRows.length, icon: ClockIcon },
    { id: "manifest", label: "Manifest", count: manifestRows.length, icon: FileCode2 },
    { id: "reports", label: "Reports", count: checkerPreviews.length, icon: FileLookupIcon },
    { id: "memory", label: "Memory", count: memoryCandidates.length, icon: Braces },
    { id: "resources", label: "Resources", count: artifactRows.length + (workflowState?.researchArtifacts.length ?? 0), icon: FilesPanelIcon },
  ];

  return (
    <section className="session-activity-panel">
      <div className="session-activity-header">
        <div className="session-activity-title-group">
          <div className="session-activity-title-row flex items-center gap-2">
            <WorkflowIcon className="h-4 w-4" />
            Studio Workflow
          </div>
          <div className="text-xs text-secondary">Automatic context, research, checking, and memory promotion.</div>
        </div>
        <button type="button" className="workspace-file-action" onClick={() => void refresh()} disabled={loading}>
          {loading ? <SpinnerIcon className="h-3.5 w-3.5 animate-spin" /> : <RefreshIcon className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>
      <div className="workspace-panel-scroll space-y-3">
        {error ? <div className="rounded-[16px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
        {!workflowState ? (
          <div className="rounded-[18px] border border-dashed border-border bg-white px-4 py-4 text-sm text-secondary">
            {loading ? "Loading Studio workflow state..." : "No Studio workflow state loaded yet."}
          </div>
        ) : (
          <>
            <div className={`rounded-[20px] border p-4 shadow-sm ${activeGate ? workflowGateClass(activeGate.tone) : "border-border bg-white"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-secondary">Current Gate</div>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <ActiveGateIcon className="h-4 w-4 shrink-0 text-secondary" />
                    <div className="truncate text-sm font-semibold text-primary">{activeGate?.title ?? "Workflow"}</div>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                    activeGate ? workflowStatusClass(activeGate.tone) : "border-blue-200 bg-blue-50 text-blue-700"
                  }`}
                >
                  {activeGate?.status ?? normalizeWorkflowLabel(workflowState.phase)}
                </span>
              </div>
              <div className="mt-3 break-words text-sm font-semibold leading-5 text-primary">
                {activeGate?.summary ?? "No workflow state is available yet."}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-[12px] bg-white/70 px-3 py-2">
                  <div className="text-secondary">Task</div>
                  <div className="truncate font-semibold text-primary">{workflowState.taskId ?? "No active task"}</div>
                </div>
                <div className="rounded-[12px] bg-white/70 px-3 py-2">
                  <div className="text-secondary">Updated</div>
                  <div className="truncate font-semibold text-primary">{formatWorkflowTimestamp(workflowState.lastUpdated) ?? "pending"}</div>
                </div>
              </div>
            </div>

            <div className="rounded-[20px] border border-border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-secondary">Phase Rail</div>
                  <div className="mt-1 text-sm font-semibold text-primary">{normalizeWorkflowLabel(workflowState.phase)}</div>
                </div>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-[12px] border border-border bg-white px-3 py-2 text-xs font-semibold text-primary hover:bg-slate-50 disabled:opacity-60"
                  disabled={!workflowState.taskId || promoting}
                  onClick={() => void runPromotion()}
                >
                  {promoting ? <SpinnerIcon className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  Promote
                </button>
              </div>
              <div className="relative mt-4 px-1">
                <div className="absolute left-5 right-5 top-[7px] h-px bg-slate-200" />
                <div className="relative grid grid-cols-6 gap-1">
                  {WORKFLOW_PHASES.map((phase) => {
                    const tone = workflowPhaseTone(workflowState.phase, phase.id);
                    return (
                      <div key={phase.id} className="min-w-0 text-center">
                        <div className={`mx-auto h-3.5 w-3.5 rounded-full ${workflowPhaseClass(tone)}`} />
                        <div
                          className={`mt-2 truncate text-[9px] font-semibold uppercase tracking-[0.08em] ${
                            tone === "active" ? "text-blue-700" : tone === "done" ? "text-emerald-700" : "text-secondary"
                          }`}
                        >
                          {phase.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-[12px] bg-slate-50 px-3 py-2">
                  <div className="text-secondary">Implement</div>
                  <div className="font-semibold text-primary">{workflowState.implementEntries} entries</div>
                </div>
                <div className="rounded-[12px] bg-slate-50 px-3 py-2">
                  <div className="text-secondary">Check</div>
                  <div className="font-semibold text-primary">{workflowState.checkEntries} entries</div>
                </div>
                <div className="rounded-[12px] bg-slate-50 px-3 py-2">
                  <div className="text-secondary">Memory</div>
                  <div className="font-semibold text-primary">{workflowState.memoryCandidateEntries} candidates</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {gateSummaries.map((gate) => (
                <WorkflowGateTile
                  key={gate.key}
                  icon={gate.icon}
                  title={gate.title}
                  status={gate.status}
                  tone={gate.tone}
                  metric={gate.metric}
                  detail={gate.detail}
                />
              ))}
            </div>

            <div className="rounded-[20px] border border-border bg-white p-3 shadow-sm">
              <div className="flex gap-1 overflow-x-auto rounded-[14px] border border-border bg-slate-50 p-1">
                {detailTabs.map((tab) => {
                  const TabIcon = tab.icon;
                  const active = detailView === tab.id;
                  return (
                    <button
                      type="button"
                      key={tab.id}
                      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                        active ? "bg-white text-primary shadow-sm" : "text-secondary hover:bg-white/70 hover:text-primary"
                      }`}
                      onClick={() => setDetailView(tab.id)}
                    >
                      <TabIcon className="h-3.5 w-3.5" />
                      {tab.label}
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-secondary">{tab.count}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3">
                {detailView === "events" ? (
                  timelineRows.length ? (
                    <div className="space-y-1">
                      {timelineRows.map((event) => (
                        <WorkflowTimelineRow key={`${event.kind}-${event.timestamp ?? event.title}`} event={event} workspace={workspace} />
                      ))}
                    </div>
                  ) : (
                    <WorkflowEmptyState>No workflow events recorded yet.</WorkflowEmptyState>
                  )
                ) : null}

                {detailView === "manifest" ? (
                  manifestRows.length ? (
                    <div className="space-y-2">
                      {workflowState.contextCuratorFallback || workflowState.contextCuratorError ? (
                        <div className="rounded-[14px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          <div className="font-semibold">Context-curator fallback is active.</div>
                          <div className="mt-1 break-words">
                            {workflowState.contextCuratorError ??
                              workflowState.contextCuratorReason ??
                              "The current manifests are explicit heuristic fallback projections."}
                          </div>
                        </div>
                      ) : null}
                      {manifestRows.slice(0, 8).map((entry) => (
                        <WorkflowManifestRow key={`${entry.manifest}-${entry.file}-${entry.reason}`} entry={entry} workspace={workspace} />
                      ))}
                    </div>
                  ) : (
                    <WorkflowEmptyState>No manifest entries are available.</WorkflowEmptyState>
                  )
                ) : null}

                {detailView === "reports" ? (
                  checkerPreviews.length ? (
                    <div className="space-y-3">
                      {checkerPreviews.map((report) => (
                        <div key={report.label} className="rounded-[14px] border border-border bg-slate-50 p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="truncate text-xs font-semibold text-primary">{report.label}</div>
                            {report.path ? (
                              <button
                                type="button"
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-white px-2 py-1 text-[10px] font-semibold text-primary hover:bg-slate-100"
                                onClick={() => void bridge.openWorkspaceFile(workspace.rootPath, report.path!, workspace.id)}
                              >
                                <FileLookupIcon className="h-3 w-3" />
                                Open
                              </button>
                            ) : null}
                          </div>
                          <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-white px-3 py-2 text-[11px] leading-5 text-slate-700">
                            {report.content}
                          </pre>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <WorkflowEmptyState>No checker reports are available.</WorkflowEmptyState>
                  )
                ) : null}

                {detailView === "memory" ? (
                  memoryCandidates.length ? (
                    <div className="space-y-2">
                      {memoryCandidates.map((candidate, index) => (
                        <WorkflowMemoryCandidateRow key={candidate.id ?? `${candidate.kind}-${index}`} candidate={candidate} />
                      ))}
                    </div>
                  ) : (
                    <WorkflowEmptyState>No memory candidates are available.</WorkflowEmptyState>
                  )
                ) : null}

                {detailView === "resources" ? (
                  artifactRows.length || workflowState.researchArtifacts.length ? (
                    <div className="space-y-3">
                      {artifactRows.length ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="font-semibold uppercase tracking-[0.14em] text-secondary">Artifacts</div>
                            <div className="text-[11px] text-secondary">{artifactRows.filter((artifact) => artifact.status === "ready").length} ready</div>
                          </div>
                          {artifactRows.map((artifact) => {
                            const ready = artifact.status === "ready";
                            return (
                              <button
                                type="button"
                                key={`${artifact.label}-${artifact.path}`}
                                className="flex w-full items-center justify-between gap-3 rounded-[14px] border border-border bg-slate-50 px-3 py-2 text-left text-xs hover:bg-slate-100 disabled:cursor-default disabled:opacity-60"
                                disabled={!ready}
                                onClick={() => {
                                  if (ready) void bridge.openWorkspaceFile(workspace.rootPath, artifact.path, workspace.id);
                                }}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-primary">{artifact.label}</span>
                                  <span className="block truncate text-secondary">{artifact.path}</span>
                                </span>
                                <span className="shrink-0 text-right">
                                  <span
                                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${artifactStatusClass(
                                      artifact.status,
                                    )}`}
                                  >
                                    {artifact.status}
                                  </span>
                                  <span className="mt-1 block max-w-[96px] truncate text-[10px] text-secondary">{formatArtifactMeta(artifact)}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {workflowState.researchArtifacts.length ? (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-secondary">Research</div>
                          {workflowState.researchArtifacts.map((path) => (
                            <button
                              type="button"
                              key={path}
                              className="block w-full truncate rounded-[14px] border border-border bg-slate-50 px-3 py-2 text-left text-xs text-primary hover:bg-slate-100"
                              onClick={() => void bridge.openWorkspaceFile(workspace.rootPath, path, workspace.id)}
                            >
                              {path}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <WorkflowEmptyState>No workflow resources are available.</WorkflowEmptyState>
                  )
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function WorkspaceSessionRadarPanel({
  sessions,
  workspace,
  onSelectTab,
}: {
  sessions: SessionSummary[];
  workspace: WorkspaceRef;
  onSelectTab: (tabId: string) => void;
}) {
  const runningSessions = sessions.filter((session) => session.isRunning);
  const recentCompleted = sessions.filter((session) => !session.isRunning).slice(0, 8);
  const [previewExpandedById, setPreviewExpandedById] = useState<Record<string, boolean>>({});
  const [collapsedDateGroups, setCollapsedDateGroups] = useState<Record<string, boolean>>({});
  const headerSummary = useMemo(
    () => [`运行中 ${runningSessions.length}`, `最近 ${recentCompleted.length}`].join(" · "),
    [recentCompleted.length, runningSessions.length]
  );

  const recentGroups = useMemo(() => {
    const groups = new Map<string, SessionSummary[]>();
    for (const session of recentCompleted) {
      const key = formatDateKey(session.updatedAt);
      const existing = groups.get(key);
      if (existing) existing.push(session);
      else groups.set(key, [session]);
    }
    return Array.from(groups.entries()).sort((left, right) => right[0].localeCompare(left[0]));
  }, [recentCompleted]);

  const togglePreviewAndSelect = (session: SessionSummary) => {
    setPreviewExpandedById((current) => ({
      ...current,
      [session.tabId]: !current[session.tabId],
    }));
    onSelectTab(session.tabId);
  };

  return (
    <div className="workspace-radar-panel session-activity-panel">
      <div className="session-activity-header">
        <div className="session-activity-title-group">
          <div className="session-activity-heading-row">
            <div className="session-activity-title-row">
              <span>Workspace sessions</span>
            </div>
          </div>
        </div>
        <div className="session-activity-summary">{headerSummary}</div>
      </div>
      <div className="session-activity-radar">
        <section className="session-activity-radar-section">
          <header className="session-activity-radar-section-header">
            <span>{`运行中（${runningSessions.length}）`}</span>
          </header>
          {runningSessions.length === 0 ? (
            <div className="session-activity-radar-empty">
              当前没有正在运行的会话。
            </div>
          ) : (
            <div className="session-activity-radar-list">
              {runningSessions.map((session) => (
                <button
                  key={session.tabId}
                  type="button"
                  onClick={() => togglePreviewAndSelect(session)}
                  className={`session-activity-radar-row is-running${previewExpandedById[session.tabId] ? " is-preview-expanded" : ""}`}
                  aria-expanded={previewExpandedById[session.tabId] ? true : false}
                >
                  <span className="session-activity-radar-row-main">
                    <span className="session-activity-radar-row-meta-line">
                      <span className="session-activity-radar-engine-icon is-running">
                        <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                      </span>
                      <span className="session-activity-radar-workspace">{workspace.name}</span>
                      <span>{session.cliId}</span>
                      <span>{session.messageCount} messages</span>
                      {session.changedFiles.length > 0 ? <span>{session.changedFiles.length} files</span> : null}
                    </span>
                    <span className="session-activity-radar-row-preview">
                      {session.preview}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="session-activity-radar-section">
          <header className="session-activity-radar-section-header">
            <span>{`最近完成（${recentCompleted.length}）`}</span>
          </header>
          {recentCompleted.length === 0 ? (
            <div className="session-activity-radar-empty">
              最近结束的会话会显示在这里。
            </div>
          ) : (
            <div className="session-activity-radar-list">
              {recentGroups.map(([dateKey, group]) => {
                const isCollapsed = collapsedDateGroups[dateKey] ?? true;
                return (
                  <div key={dateKey} className="session-activity-radar-date-group">
                    <div className="session-activity-radar-date-group-header">
                      <button
                        type="button"
                        className="session-activity-radar-date-toggle"
                        onClick={() =>
                          setCollapsedDateGroups((current) => ({
                            ...current,
                            [dateKey]: !isCollapsed,
                          }))
                        }
                      >
                        <span className="session-activity-radar-date-toggle-left">
                          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          <span>{dateKey}</span>
                        </span>
                        <span className="session-activity-radar-date-toggle-count">{group.length}</span>
                      </button>
                    </div>
                    {!isCollapsed ? (
                      <div className="session-activity-radar-date-group-list">
                        {group.map((session) => (
                          <div key={session.tabId} className="session-activity-radar-row-shell">
                            <button
                              type="button"
                              onClick={() => togglePreviewAndSelect(session)}
                              className={`session-activity-radar-row${previewExpandedById[session.tabId] ? " is-preview-expanded" : ""}`}
                              aria-expanded={previewExpandedById[session.tabId] ? true : false}
                            >
                              <span className="session-activity-radar-row-main">
                                <span className="session-activity-radar-row-meta-line">
                                  <span className="session-activity-radar-engine-icon">
                                    <ClockIcon className="h-3.5 w-3.5" />
                                  </span>
                                  <span className="session-activity-radar-workspace">{workspace.name}</span>
                                  <span>{session.cliId}</span>
                                  <span>{session.updatedAt > 0 ? formatTimeAgo(new Date(session.updatedAt).toISOString()) : "Unknown time"}</span>
                                  <span>{session.messageCount} messages</span>
                                </span>
                                <span className="session-activity-radar-row-preview">
                                  {session.preview}
                                </span>
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function WorkspaceStatusRail({
  tasks,
  subagents,
}: {
  tasks: TaskNode[];
  subagents: TabSubagentState[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"tasks" | "subagents">(() =>
    tasks.length > 0 ? "tasks" : "subagents"
  );
  const hasMoreTasks = tasks.length > 10;
  const visibleTasks = expanded ? tasks : tasks.slice(0, 10);
  const visibleSubagents = subagents.slice(0, expanded ? subagents.length : 10);

  useEffect(() => {
    if (activeTab === "tasks" && tasks.length === 0 && subagents.length > 0) {
      setActiveTab("subagents");
      return;
    }
    if (activeTab === "subagents" && subagents.length === 0 && tasks.length > 0) {
      setActiveTab("tasks");
    }
  }, [activeTab, subagents.length, tasks.length]);

  return (
    <section className="workspace-task-rail">
      <div className="workspace-task-rail-header">
        <div className="workspace-task-rail-pills">
          <button
            type="button"
            onClick={() => setActiveTab("tasks")}
            className={`workspace-task-pill is-primary${activeTab === "tasks" ? " is-active" : ""}`}
          >
            <span className="workspace-task-pill-label">任务</span>
            <span className="workspace-task-pill-value">{tasks.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("subagents")}
            className={`workspace-task-pill${activeTab === "subagents" ? " is-active" : ""}`}
          >
            <span className="workspace-task-pill-label">子代理</span>
            <span className="workspace-task-pill-value">{subagents.length}</span>
          </button>
        </div>
      </div>

      {activeTab === "tasks" ? (
        tasks.length === 0 ? (
          <div className="workspace-task-rail-empty">
            当前会话里的用户消息会在这里形成任务节点。
          </div>
        ) : (
          <>
            <div className="workspace-task-rail-list">
              {visibleTasks.map((task, index) => {
                const isLastVisibleTask = index === visibleTasks.length - 1;
                return (
                  <Fragment key={task.id}>
                    <div className={`workspace-task-node${task.isLatest ? " is-latest" : ""}`}>
                      <div className="workspace-task-node-marker" aria-hidden>
                        <div className="workspace-task-node-dot" />
                      </div>
                      <div className="workspace-task-node-main">
                        <div className="workspace-task-node-detail">{task.detail}</div>
                        <div className="workspace-task-node-time">{task.timestamp || "just now"}</div>
                      </div>
                    </div>
                    {!expanded && hasMoreTasks && isLastVisibleTask ? (
                      <button
                        type="button"
                        className="workspace-task-rail-more"
                        onClick={() => {
                          setExpanded(true);
                        }}
                      >
                        Load More
                      </button>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
          </>
        )
      ) : subagents.length === 0 ? (
        <div className="workspace-task-rail-empty">
          当前还没有识别到子代理执行记录。
        </div>
      ) : (
        <>
          <div className="workspace-task-rail-list">
            {visibleSubagents.map((subagent, index) => {
              const isLastVisibleSubagent = index === visibleSubagents.length - 1;
              const StatusIcon =
                subagent.status === "completed"
                  ? CheckCircle2
                  : subagent.status === "error"
                    ? XCircle
                    : SpinnerIcon;
              return (
                <Fragment key={subagent.id}>
                  <div className="workspace-task-node">
                    <div className="workspace-task-node-marker" aria-hidden>
                      <div
                        className={`workspace-task-node-dot${
                          subagent.status === "completed"
                            ? " bg-emerald-500"
                            : subagent.status === "error"
                              ? " bg-rose-500"
                              : " bg-sky-500"
                        }`}
                      />
                    </div>
                    <div className="workspace-task-node-main min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusIcon
                          className={`h-3.5 w-3.5 shrink-0 ${
                            subagent.status === "running" ? "animate-spin text-sky-500" : ""
                          } ${
                            subagent.status === "completed"
                              ? "text-emerald-500"
                              : subagent.status === "error"
                                ? "text-rose-500"
                                : ""
                          }`}
                        />
                        <div className="workspace-task-node-detail">{subagent.label}</div>
                      </div>
                      <div className="mt-1 text-[12px] leading-5 text-secondary break-words">
                        {subagent.description}
                      </div>
                      <div className="workspace-task-node-time">
                        {subagent.status} · {subagent.cliId}
                      </div>
                    </div>
                  </div>
                  {!expanded && subagents.length > 10 && isLastVisibleSubagent ? (
                    <button
                      type="button"
                      className="workspace-task-rail-more"
                      onClick={() => {
                        setExpanded(true);
                      }}
                    >
                      Load More
                    </button>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function WorkspaceSessionActivityPanel({
  activities,
  workspace,
  onSelectTab,
  tabTitlesById,
}: {
  activities: ActivityEntry[];
  workspace: WorkspaceRef;
  onSelectTab: (tabId: string) => void;
  tabTitlesById: Record<string, string>;
}) {
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, true>>({});
  const [expandedConversationIds, setExpandedConversationIds] = useState<Record<string, true>>({});

  const handleOpenFile = useCallback(
    async (path: string) => {
      if (!path || openingPath === path || workspace.locationKind === "ssh") return;
      setOpeningPath(path);
      try {
        await bridge.openWorkspaceFile(workspace.rootPath, path, workspace.id);
      } finally {
        setOpeningPath((current) => (current === path ? null : current));
      }
    },
    [openingPath, workspace.id, workspace.locationKind, workspace.rootPath]
  );

  const groupedActivities = useMemo(() => {
    const groups = new Map<
      string,
      {
        tabId: string;
        title: string;
        cliId: AgentId;
        latestTimestamp: number;
        items: ActivityEntry[];
      }
    >();

    for (const entry of activities) {
      const existing = groups.get(entry.tabId);
      if (existing) {
        existing.items.push(entry);
        if (entry.timestamp > existing.latestTimestamp) {
          existing.latestTimestamp = entry.timestamp;
        }
        continue;
      }
      groups.set(entry.tabId, {
        tabId: entry.tabId,
        title: tabTitlesById[entry.tabId] ?? "Untitled session",
        cliId: entry.cliId,
        latestTimestamp: entry.timestamp,
        items: [entry],
      });
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        items: group.items.slice().sort((left, right) => right.timestamp - left.timestamp),
      }))
      .sort((left, right) => right.latestTimestamp - left.latestTimestamp);
  }, [activities, tabTitlesById]);

  useEffect(() => {
    if (!groupedActivities.length) {
      setExpandedGroupIds({});
      return;
    }
    setExpandedGroupIds((current) => {
      const next: Record<string, true> = {};
      const latestGroupId = groupedActivities[0]?.tabId ?? null;
      if (latestGroupId) {
        next[latestGroupId] = true;
      }
      for (const key of Object.keys(current)) {
        if (groupedActivities.some((group) => group.tabId === key)) {
          next[key] = true;
        }
      }
      return next;
    });
  }, [groupedActivities]);

  const toggleGroup = useCallback((tabId: string) => {
    setExpandedGroupIds((current) => {
      const next = { ...current };
      if (next[tabId]) delete next[tabId];
      else next[tabId] = true;
      return next;
    });
  }, []);

  const toggleConversation = useCallback((conversationId: string) => {
    setExpandedConversationIds((current) => {
      const next = { ...current };
      if (next[conversationId]) delete next[conversationId];
      else next[conversationId] = true;
      return next;
    });
  }, []);

  const activityIconByKind: Record<ActivityEntry["kind"], ReactNode> = {
    command: <TerminalSquare className="h-3.5 w-3.5" />,
    fileChange: <FileCode2 className="h-3.5 w-3.5" />,
    tool: <Braces className="h-3.5 w-3.5" />,
    subagent: <Bot className="h-3.5 w-3.5" />,
    status: <CheckCircle2 className="h-3.5 w-3.5" />,
    approval: <ShieldCheck className="h-3.5 w-3.5" />,
    task: <RadarIcon className="h-3.5 w-3.5" />,
    reasoning: <Bot className="h-3.5 w-3.5" />,
    routing: <GitIcon className="h-3.5 w-3.5" />,
    message: <ActivityIcon className="h-3.5 w-3.5" />,
  };

  function getConversationTitle(role: ChatMessage["role"]) {
    switch (role) {
      case "user":
        return "User Turn";
      case "assistant":
        return "Assistant Turn";
      case "system":
        return "System Turn";
      default:
        return "Conversation";
    }
  }

  return (
    <div className="session-activity-panel">
      <div className="session-activity-header">
        <div className="session-activity-title-group">
          <div className="session-activity-title-row">Workspace Activity</div>
        </div>
      </div>
      <div className="workspace-panel-scroll">
        {activities.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-border bg-white px-4 py-4 text-sm text-secondary">
            Commands, file changes, and responses from this workspace will appear here.
          </div>
        ) : (
          <div className="workspace-activity-timeline">
            {groupedActivities.map((group) => {
              const expanded = Boolean(expandedGroupIds[group.tabId]);
              return (
                <section key={group.tabId} className={`workspace-activity-group${expanded ? " is-expanded" : ""}`}>
                  <button
                    type="button"
                    className="workspace-activity-group-header"
                    onClick={() => toggleGroup(group.tabId)}
                  >
                    <span className="workspace-activity-group-toggle" aria-hidden>
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                    <span className="workspace-activity-group-main">
                      <span className="workspace-activity-group-title">{group.title}</span>
                      <span className="workspace-activity-group-meta">
                        <span className="workspace-activity-group-pill">{group.cliId}</span>
                        <span>{group.items.length} events</span>
                        <span>{group.latestTimestamp > 0 ? formatTimeAgo(new Date(group.latestTimestamp).toISOString()) : ""}</span>
                      </span>
                    </span>
                  </button>
                  {expanded ? (
                    <div className="workspace-activity-group-body">
                      {Array.from(
                        group.items.reduce(
                          (map, entry) => {
                            const existing = map.get(entry.messageId);
                            if (existing) {
                              existing.items.push(entry);
                              if (entry.timestamp > existing.timestamp) {
                                existing.timestamp = entry.timestamp;
                              }
                            } else {
                              map.set(entry.messageId, {
                                id: entry.messageId,
                                role: entry.messageRole,
                                timestamp: entry.timestamp,
                                items: [entry],
                              });
                            }
                            return map;
                          },
                          new Map<
                            string,
                            { id: string; role: ChatMessage["role"]; timestamp: number; items: ActivityEntry[] }
                          >()
                        ).values()
                      )
                        .sort((left, right) => right.timestamp - left.timestamp)
                        .map((conversation) => {
                        const conversationExpanded = Boolean(expandedConversationIds[conversation.id]);
                        const previewEntry = conversation.items[0] ?? null;
                        return (
                          <div key={conversation.id} className={`workspace-activity-event${conversationExpanded ? " is-expanded" : ""}`}>
                            <button
                              type="button"
                              className="workspace-activity-event-row"
                              onClick={() => toggleConversation(conversation.id)}
                            >
                              <span className={`workspace-activity-event-icon kind-${previewEntry?.kind ?? "message"}`} aria-hidden>
                                {activityIconByKind[previewEntry?.kind ?? "message"]}
                              </span>
                              <span className="workspace-activity-event-main">
                                <span className="workspace-activity-event-title">
                                  {getConversationTitle(conversation.role)}
                                </span>
                                <span className="workspace-activity-event-preview">
                                  {previewEntry?.detail ?? ""}
                                </span>
                              </span>
                              <span className="workspace-activity-event-side">
                                <span className="workspace-activity-event-time">
                                  {conversation.timestamp > 0 ? formatTimeAgo(new Date(conversation.timestamp).toISOString()) : ""}
                                </span>
                                <span className="workspace-activity-event-chevron" aria-hidden>
                                  {conversationExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </span>
                              </span>
                            </button>
                            {conversationExpanded ? (
                              <div className="workspace-activity-event-detail">
                                <button
                                  type="button"
                                  onClick={() => onSelectTab(group.tabId)}
                                  className="workspace-activity-event-thread"
                                >
                                  {group.title}
                                </button>
                                <div className="workspace-activity-event-structured">
                                  {conversation.items.map((entry) => (
                                    <div key={entry.id} className="workspace-activity-structured-item">
                                      <div className="workspace-activity-structured-head">
                                        <span className={`workspace-activity-structured-icon kind-${entry.kind}`} aria-hidden>
                                          {activityIconByKind[entry.kind]}
                                        </span>
                                        <span className="workspace-activity-structured-label">{entry.label}</span>
                                      </div>
                                      <div className="workspace-activity-event-text">{entry.detail}</div>
                                      {entry.filePath ? (
                                        <button
                                          type="button"
                                          onClick={() => void handleOpenFile(entry.filePath!)}
                                          className="workspace-activity-event-file"
                                        >
                                          <FileLookupIcon className={`h-3.5 w-3.5 ${openingPath === entry.filePath ? "animate-pulse" : ""}`} />
                                          {basename(entry.filePath)}
                                        </button>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceSearchPanel({ workspace }: { workspace: WorkspaceRef }) {
  const [query, setQuery] = useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchDetailsVisible, setSearchDetailsVisible] = useState(false);
  const [includePattern, setIncludePattern] = useState("");
  const [excludePattern, setExcludePattern] = useState("");
  const [searchResults, setSearchResults] = useState<WorkspaceTextSearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim();
  const isSearchMode = normalizedQuery.length > 0;

  useEffect(() => {
    setQuery("");
    setSearchCaseSensitive(false);
    setSearchWholeWord(false);
    setSearchRegex(false);
    setSearchDetailsVisible(false);
    setIncludePattern("");
    setExcludePattern("");
    setSearchResults(null);
    setSearchLoading(false);
    setSearchError(null);
    setExpandedFiles(new Set());
  }, [workspace.id]);

  useEffect(() => {
    if (!isSearchMode) {
      setSearchResults(null);
      setSearchLoading(false);
      setSearchError(null);
      setExpandedFiles(new Set());
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    void bridge
      .searchWorkspaceText(workspace.rootPath, {
        query: normalizedQuery,
        caseSensitive: searchCaseSensitive,
        wholeWord: searchWholeWord,
        isRegex: searchRegex,
        includePattern: includePattern.trim() || null,
        excludePattern: excludePattern.trim() || null,
      }, workspace.id)
      .then((response) => {
        if (cancelled) return;
        setSearchResults(response);
        setExpandedFiles(new Set(response.files.map((entry) => entry.path)));
      })
      .catch((error) => {
        if (cancelled) return;
        setSearchResults(null);
        setSearchError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setSearchLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    excludePattern,
    includePattern,
    isSearchMode,
    normalizedQuery,
    searchCaseSensitive,
    searchRegex,
    searchWholeWord,
    workspace.rootPath,
  ]);

  const summaryText = useMemo(() => {
    if (!isSearchMode) {
      return "输入内容后开始搜索";
    }
    if (searchLoading) {
      return "正在搜索...";
    }
    if (searchError) {
      return searchError;
    }
    if (!searchResults) {
      return "输入内容后开始搜索";
    }
    return `${searchResults.fileCount} 个文件，${searchResults.matchCount} 处匹配`;
  }, [isSearchMode, searchError, searchLoading, searchResults]);

  const toggleExpanded = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const renderResult = useCallback(
    (result: WorkspaceTextSearchFileResult) => {
      const isExpanded = expandedFiles.has(result.path);
      return (
        <div key={result.path} className="workspace-search-result-group">
          <button
            type="button"
            className="workspace-search-result-file"
            onClick={() => toggleExpanded(result.path)}
          >
            <span className={`file-tree-chevron${isExpanded ? " is-open" : ""}`}>›</span>
            <span className="workspace-search-result-path">{result.path}</span>
            <span className="workspace-search-result-count">{result.matchCount}</span>
          </button>
          {isExpanded ? (
            <div className="workspace-search-result-matches">
              {result.matches.map((match, index) => (
                <button
                  key={`${result.path}-${match.line}-${match.column}-${index}`}
                  type="button"
                  className="workspace-search-result-match"
                  onClick={() => {
                    if (workspace.locationKind === "ssh") return;
                    void bridge.openWorkspaceFile(workspace.rootPath, result.path, workspace.id);
                  }}
                  title={`${result.path}:${match.line}:${match.column}`}
                  disabled={workspace.locationKind === "ssh"}
                >
                  <span className="workspace-search-result-location">
                    {match.line}:{match.column}
                  </span>
                  <span className="workspace-search-result-preview">{match.preview}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      );
    },
    [expandedFiles, toggleExpanded, workspace.rootPath]
  );

  return (
    <section className="diff-panel workspace-search-panel">
      <div className="workspace-search-body">
        <div className="workspace-search-bar">
          <SearchIcon className="workspace-search-icon" aria-hidden />
          <input
            className="workspace-search-input"
            type="search"
            placeholder="搜索工作区"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索工作区"
          />
          <button
            type="button"
            className={`ghost workspace-search-option${searchCaseSensitive ? " is-active" : ""}`}
            onClick={() => setSearchCaseSensitive((prev) => !prev)}
            aria-label="区分大小写"
            title="区分大小写"
          >
            Aa
          </button>
          <button
            type="button"
            className={`ghost workspace-search-option${searchWholeWord ? " is-active" : ""}`}
            onClick={() => setSearchWholeWord((prev) => !prev)}
            aria-label="全词匹配"
            title="全词匹配"
          >
            ab
          </button>
          <button
            type="button"
            className={`ghost workspace-search-option${searchRegex ? " is-active" : ""}`}
            onClick={() => setSearchRegex((prev) => !prev)}
            aria-label="正则表达式"
            title="正则表达式"
          >
            .*
          </button>
          <button
            type="button"
            className={`ghost workspace-search-option${searchDetailsVisible ? " is-active" : ""}`}
            onClick={() => setSearchDetailsVisible((prev) => !prev)}
            aria-label="更多搜索选项"
            title="更多搜索选项"
          >
            …
          </button>
        </div>

        {(searchDetailsVisible || isSearchMode) ? (
          <div className="workspace-search-details">
            <input
              className="workspace-search-details-input"
              type="text"
              placeholder="包含模式，例如 src/**/*.ts"
              value={includePattern}
              onChange={(event) => setIncludePattern(event.target.value)}
              aria-label="包含模式"
            />
            <input
              className="workspace-search-details-input"
              type="text"
              placeholder="排除模式，例如 dist/**"
              value={excludePattern}
              onChange={(event) => setExcludePattern(event.target.value)}
              aria-label="排除模式"
            />
          </div>
        ) : null}

        <div className="workspace-search-summary">{summaryText}</div>
        {searchResults?.limitHit ? (
          <div className="workspace-search-limit">结果达到上限，已截断显示。</div>
        ) : null}

        <div className="workspace-search-results">
          {!isSearchMode ? null : searchLoading || searchError ? null : !searchResults || searchResults.files.length === 0 ? (
            <div className="workspace-search-empty">没有找到匹配内容。</div>
          ) : (
            searchResults.files.map((result) => renderResult(result))
          )}
        </div>
      </div>
    </section>
  );
}

function WorkspaceFilesPanel({
  workspace,
  changes,
}: {
  workspace: WorkspaceRef;
  changes: GitFileChange[];
}) {
  const [entriesByParent, setEntriesByParent] = useState<Record<string, WorkspaceTreeEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({ "": true });
  const [treeLoading, setTreeLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<WorkspaceTreeEntry["kind"] | null>(null);
  const [createDialogKind, setCreateDialogKind] = useState<WorkspaceCreateDialogKind | null>(null);
  const [createName, setCreateName] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const gitStatusByPath = useMemo(() => changeStatusMap(changes), [changes]);

  const syncFileTree = useCallback(
    async (options?: { force?: boolean; silent?: boolean }) => {
      const force = Boolean(options?.force);
      const silent = Boolean(options?.silent);
      if (!silent) {
        setTreeLoading(true);
      }
      setErrorMessage(null);
      try {
        const index = await loadWorkspaceFileIndex({
          workspaceId: workspace.id,
          projectRoot: workspace.rootPath,
          force,
          maxAgeMs:
            workspace.locationKind === "ssh" ? REMOTE_FILE_TREE_CACHE_TTL_MS : Number.POSITIVE_INFINITY,
        });
        setEntriesByParent(index.entriesByParent);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unable to load workspace files.";
        setErrorMessage(detail);
      } finally {
        if (!silent) {
          setTreeLoading(false);
        }
      }
    },
    [workspace.id, workspace.locationKind, workspace.rootPath]
  );

  useEffect(() => {
    const cachedUiState = workspaceTreeUiStateByWorkspace.get(workspace.id);
    const cachedIndex = peekWorkspaceFileIndex(workspace.id);
    setEntriesByParent(cachedIndex?.entriesByParent ?? {});
    setExpandedDirectories(cachedUiState?.expandedDirectories ?? { "": true });
    setErrorMessage(null);
    setSelectedPath(null);
    setSelectedKind(null);
    setCreateDialogKind(null);
    setCreateName("");
    setDeleteDialogOpen(false);
    const hasCachedRoot = Boolean(
      cachedIndex && Object.prototype.hasOwnProperty.call(cachedIndex.entriesByParent, "")
    );
    const cacheFresh =
      workspace.locationKind !== "ssh" ||
      isWorkspaceFileIndexFresh(workspace.id, REMOTE_FILE_TREE_CACHE_TTL_MS);
    if (!hasCachedRoot) {
      void syncFileTree();
      return;
    }
    if (!cacheFresh) {
      void syncFileTree({ force: true, silent: true });
    }
  }, [syncFileTree, workspace.id, workspace.locationKind]);

  useEffect(() => {
    workspaceTreeUiStateByWorkspace.set(workspace.id, {
      expandedDirectories,
    });
  }, [expandedDirectories, workspace.id]);

  const toggleDirectory = useCallback(
    (path: string) => {
      setExpandedDirectories((current) => {
        const isExpanded = Boolean(current[path]);
        return { ...current, [path]: !isExpanded };
      });
    },
    []
  );

  const renderDirectory = useCallback(
    (parentPath: string, depth: number) => {
      const entries = entriesByParent[parentPath] ?? EMPTY_TREE;
      return entries.flatMap((entry) => {
        const normalizedPath = entry.path.replace(/\\/g, "/");
        const isDirectory = entry.kind === "directory";
        const isExpanded = Boolean(expandedDirectories[normalizedPath]);
        const gitStatus = gitStatusByPath.get(normalizedPath);
        const children = isDirectory && isExpanded ? renderDirectory(normalizedPath, depth + 1) : [];

        return [
          <div key={normalizedPath} className="file-tree-row-wrap">
            <button
              type="button"
              onClick={() => {
                setSelectedPath(normalizedPath);
                setSelectedKind(entry.kind);
              }}
              onDoubleClick={() => {
                if (isDirectory) {
                  toggleDirectory(normalizedPath);
                  return;
                }
                if (workspace.locationKind === "ssh") {
                  return;
                }
                void bridge.openWorkspaceFile(workspace.rootPath, normalizedPath, workspace.id);
              }}
              className={`file-tree-row ${isDirectory ? "is-folder" : "is-file"}${selectedPath === normalizedPath ? " is-selected" : ""}`}
              style={{ paddingLeft: `${12 + depth * 16}px` }}
            >
              <span className={`file-tree-chevron${isExpanded ? " is-open" : ""}`} aria-hidden>
                {isDirectory ? <ChevronRight className="h-3.5 w-3.5" /> : null}
              </span>
              {!isDirectory ? <span className="file-tree-spacer" aria-hidden /> : null}
              <span className="file-tree-icon" aria-hidden>
                <FileIcon
                  filePath={entry.path}
                  isFolder={isDirectory}
                  isOpen={isExpanded}
                  className="h-3.5 w-3.5"
                />
              </span>
              <span className={`file-tree-name${gitStatusClass(gitStatus)}`}>
                {entry.name}
              </span>
            </button>
            {isDirectory && isExpanded ? children : null}
          </div>,
        ];
      });
    },
    [entriesByParent, expandedDirectories, gitStatusByPath, selectedPath, toggleDirectory, workspace.id, workspace.locationKind, workspace.rootPath]
  );

  const selectedParentFolder = useMemo(() => {
    if (!selectedPath) return "";
    if (selectedKind === "directory") return selectedPath;
    const lastSlash = selectedPath.lastIndexOf("/");
    return lastSlash >= 0 ? selectedPath.slice(0, lastSlash) : "";
  }, [selectedKind, selectedPath]);

  const rootExpanded = Boolean(expandedDirectories[""]);
  const rootDisplayName = basename(workspace.rootPath) || workspace.name;
  const selectedDisplayName = selectedPath ? basename(selectedPath) : basename(workspace.rootPath);
  const selectedParentDisplay = selectedParentFolder || workspace.rootPath;

  const refreshFileTree = useCallback(async () => {
    await syncFileTree({ force: true });
  }, [syncFileTree]);

  const resolveCreateTargetPath = useCallback(
    (draft: string | null) => {
      const name = draft?.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") ?? "";
      if (!name) return "";
      return selectedParentFolder ? `${selectedParentFolder}/${name}` : name;
    },
    [selectedParentFolder]
  );

  const openCreateDialog = useCallback((kind: WorkspaceCreateDialogKind) => {
    setCreateDialogKind(kind);
    setCreateName("");
  }, []);

  const closeCreateDialog = useCallback(() => {
    setCreateDialogKind(null);
    setCreateName("");
  }, []);

  const confirmCreateDialog = useCallback(async () => {
    if (!createDialogKind) return;
    const nextPath = resolveCreateTargetPath(createName);
    if (!nextPath) return;
    try {
      if (createDialogKind === "file") {
        await bridge.createWorkspaceFile(workspace.rootPath, nextPath, workspace.id);
      } else {
        await bridge.createWorkspaceDirectory(workspace.rootPath, nextPath, workspace.id);
      }
      closeCreateDialog();
      await refreshFileTree();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [closeCreateDialog, createDialogKind, createName, refreshFileTree, resolveCreateTargetPath, workspace.rootPath]);

  const openDeleteDialog = useCallback(() => {
    if (!selectedPath || !selectedKind) return;
    setDeleteDialogOpen(true);
  }, [selectedKind, selectedPath]);

  const closeDeleteDialog = useCallback(() => {
    setDeleteDialogOpen(false);
  }, []);

  const confirmDeleteDialog = useCallback(async () => {
    if (!selectedPath || !selectedKind) return;
    try {
      await bridge.trashWorkspaceItem(workspace.rootPath, selectedPath, workspace.id);
      setSelectedPath(null);
      setSelectedKind(null);
      setDeleteDialogOpen(false);
      await refreshFileTree();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [refreshFileTree, selectedKind, selectedPath, workspace.rootPath]);

  return (
    <div className="file-tree-panel">
      <div className="file-tree-list">
        <div className="file-tree-root-row-wrap">
          <button
            type="button"
            className={`file-tree-row file-tree-row-root is-folder${rootExpanded ? " is-root-open" : ""}${selectedPath === "" ? " is-selected" : ""}`}
            onClick={() => {
              setSelectedPath("");
              setSelectedKind("directory");
            }}
            onDoubleClick={() =>
              setExpandedDirectories((current) => ({
                ...current,
                "": !Boolean(current[""]),
              }))
            }
          >
            <span className={`file-tree-chevron${rootExpanded ? " is-open" : ""}`} aria-hidden>
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
            <span className="file-tree-icon" aria-hidden>
              <FileIcon filePath={workspace.rootPath} isFolder isOpen={rootExpanded} className="h-3.5 w-3.5" />
            </span>
            <span className="file-tree-root-label" title={workspace.rootPath}>
              {rootDisplayName}
            </span>
            <span className="file-tree-root-actions" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="ghost icon-button file-tree-root-action"
                onClick={() => openCreateDialog("file")}
                title="新建文件"
                aria-label="新建文件"
              >
                <FilePlus2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="ghost icon-button file-tree-root-action"
                onClick={() => openCreateDialog("folder")}
                title="新建文件夹"
                aria-label="新建文件夹"
              >
                <FolderPlus className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="ghost icon-button file-tree-root-action"
                onClick={() => void refreshFileTree()}
                title="刷新文件列表"
                aria-label="刷新文件列表"
              >
                <RefreshIcon className={`h-4 w-4 ${treeLoading ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                className="ghost icon-button file-tree-root-action file-tree-root-action-danger"
                onClick={() => openDeleteDialog()}
                title="移到废纸篓"
                aria-label="移到废纸篓"
                disabled={!selectedPath}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </span>
          </button>
        </div>
        {errorMessage ? (
          <div className="file-tree-empty">
            {errorMessage}
          </div>
        ) : treeLoading && (entriesByParent[""] ?? EMPTY_TREE).length === 0 ? (
          <div className="file-tree-empty">
            Loading workspace files...
          </div>
        ) : (entriesByParent[""] ?? EMPTY_TREE).length === 0 ? (
          <div className="file-tree-empty">
            No files found for this workspace.
          </div>
        ) : rootExpanded ? (
          <div className="file-tree-branch-list">{renderDirectory("", 0)}</div>
        ) : null}
      </div>

      {createDialogKind ? (
        <div className="workspace-file-dialog-backdrop" onMouseDown={closeCreateDialog}>
          <div className="workspace-file-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="workspace-file-dialog-title">
              {createDialogKind === "file" ? "新建文件" : "新建文件夹"}
            </div>
            <div className="workspace-file-dialog-subtitle">
              创建位置：{selectedParentDisplay}
            </div>
            <input
              autoFocus
              className="workspace-file-dialog-input"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder={createDialogKind === "file" ? "输入文件名" : "输入文件夹名"}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void confirmCreateDialog();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeCreateDialog();
                }
              }}
            />
            <div className="workspace-file-dialog-actions">
              <button type="button" className="workspace-file-dialog-button secondary" onClick={closeCreateDialog}>
                取消
              </button>
              <button
                type="button"
                className="workspace-file-dialog-button"
                onClick={() => void confirmCreateDialog()}
                disabled={!createName.trim()}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteDialogOpen ? (
        <div className="workspace-file-dialog-backdrop" onMouseDown={closeDeleteDialog}>
          <div className="workspace-file-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="workspace-file-dialog-title">移到废纸篓</div>
            <div className="workspace-file-dialog-subtitle">
              {selectedKind === "directory"
                ? `确认将文件夹“${selectedDisplayName}”及其内容移到废纸篓吗？`
                : `确认将文件“${selectedDisplayName}”移到废纸篓吗？`}
            </div>
            <div className="workspace-file-dialog-actions">
              <button type="button" className="workspace-file-dialog-button secondary" onClick={closeDeleteDialog}>
                取消
              </button>
              <button type="button" className="workspace-file-dialog-button danger" onClick={() => void confirmDeleteDialog()}>
                移到废纸篓
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceRightPanel({
  statusPanelCollapsed = false,
  mode,
}: {
  statusPanelCollapsed?: boolean;
  mode: WorkspacePanelMode;
}) {
  const activeTabId = useStore((state) => state.activeTerminalTabId);
  const terminalTabs = useStore((state) => state.terminalTabs);
  const workspaces = useStore((state) => state.workspaces);
  const chatSessions = useStore((state) => state.chatSessions);
  const setActiveTerminalTab = useStore((state) => state.setActiveTerminalTab);
  const refreshGitPanel = useStore((state) => state.refreshGitPanel);

  const activeTab = useMemo(
    () => terminalTabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, terminalTabs]
  );
  const workspace = useMemo(
    () => workspaces.find((item) => item.id === activeTab?.workspaceId) ?? null,
    [activeTab?.workspaceId, workspaces]
  );
  const workspaceTabs = useMemo(
    () => (workspace ? terminalTabs.filter((tab) => tab.workspaceId === workspace.id) : []),
    [terminalTabs, workspace]
  );
  const workspaceTabTitlesById = useMemo(
    () =>
      Object.fromEntries(
        workspaceTabs.map((tab) => [tab.id, tab.title || workspace?.name || "Untitled session"])
      ),
    [workspace?.name, workspaceTabs]
  );
  const sessionsByTabId = useStore((state) => (mode === "activity" || mode === "radar" ? state.chatSessions : EMPTY_CHAT_SESSIONS));
  const fileModeChanges = useStore((state) =>
    mode === "files" && workspace ? state.gitPanelsByWorkspace[workspace.id]?.recentChanges ?? EMPTY_GIT_CHANGES : EMPTY_GIT_CHANGES
  );
  const activeSession = useMemo(
    () => (activeTabId ? chatSessions[activeTabId] ?? null : null),
    [activeTabId, chatSessions]
  );
  const taskNodes = useMemo(() => buildTaskNodes(activeSession), [activeSession]);
  const tabSubagentsByTab = useStore((state) => state.tabSubagentsByTab);
  const activeSubagents = useMemo(
    () => (activeTabId ? tabSubagentsByTab[activeTabId] ?? EMPTY_SUBAGENTS : EMPTY_SUBAGENTS),
    [activeTabId, tabSubagentsByTab]
  );

  const sessionSummaries = useMemo(() => {
    if (!workspace || mode !== "radar") return [];
    return workspaceTabs
      .map((tab) => {
        const session = sessionsByTabId[tab.id];
        if (!session) return null;
        return buildSessionSummary(tab, workspace, session);
      })
      .filter((entry): entry is SessionSummary => Boolean(entry))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [mode, sessionsByTabId, workspace, workspaceTabs]);

  const activityEntries = useMemo(() => {
    if (!workspace || mode !== "activity") return [];
    return buildActivityEntries(workspace, workspaceTabs, sessionsByTabId);
  }, [mode, sessionsByTabId, workspace, workspaceTabs]);

  if (!workspace) {
    return (
      <aside className="workspace-right-panel-shell w-[380px] min-w-[340px] bg-[#fcfcfd]">
        <div className="workspace-right-panel-empty">
          Attach a workspace to inspect project files and Git state.
        </div>
      </aside>
    );
  }

  return (
    <aside className="workspace-right-panel-shell w-[380px] min-w-[340px] bg-[#fcfcfd]">
      <div className="workspace-right-panel">
        <div className="workspace-right-panel-body">
          <div className="workspace-right-panel-main">
            {mode === "activity" ? (
              <WorkspaceSessionActivityPanel
                activities={activityEntries}
                workspace={workspace}
                onSelectTab={setActiveTerminalTab}
                tabTitlesById={workspaceTabTitlesById}
              />
            ) : mode === "radar" ? (
              <WorkspaceSessionRadarPanel
                sessions={sessionSummaries}
                workspace={workspace}
                onSelectTab={setActiveTerminalTab}
              />
            ) : mode === "workflow" ? (
              <StudioWorkflowPanel workspace={workspace} terminalTabId={activeTabId} />
            ) : mode === "files" ? (
              <WorkspaceFilesPanel workspace={workspace} changes={fileModeChanges} />
            ) : mode === "search" ? (
              <WorkspaceSearchPanel workspace={workspace} />
            ) : (
              <GitPanel workspace={workspace} />
            )}
          </div>

          {!statusPanelCollapsed ? (
            <WorkspaceStatusRail tasks={taskNodes} subagents={activeSubagents} />
          ) : null}
        </div>
      </div>
    </aside>
  );
}
