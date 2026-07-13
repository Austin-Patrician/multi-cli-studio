import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  LoaderCircle as SpinnerIcon,
  RefreshCw as RefreshIcon,
  Search as SearchIcon,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  Plus,
  X,
  XCircle,
} from "lucide-react";
import type {
  AgentId,
  ChatMessage,
  ChatMessageBlock,
  ConversationSession,
  FileMentionCandidate,
  GitFileDiff,
  GitFileChange,
  GitFileStatus,
  TerminalTab,
  TabSubagentState,
  WorkspaceRef,
  WorkspaceTextSearchFileResult,
  WorkspaceTextSearchResponse,
  WorkspaceTreeEntry,
} from "../../lib/models";
import { bridge } from "../../lib/bridge";
import { compactPathForDisplay } from "../../lib/pathDisplay";
import { useStore } from "../../lib/store";
import { GitDiffBlock, type GitDiffStyle } from "../settings/GitDiffBlock";
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

type ConversationFileChangeEntry = GitFileStatus & {
  diff: string;
  lastTimestamp: number;
};

type ConversationFileDiffModalState = {
  file: ConversationFileChangeEntry;
  diff: GitFileDiff | null;
  loading: boolean;
  error: string | null;
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
const STATUS_RAIL_DIFF_STYLE_STORAGE_KEY = "workspace_status_rail_file_change_diff_style";
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

function splitNameAndExtension(name: string) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return { base: name, extension: "" };
  }
  return {
    base: name.slice(0, lastDot),
    extension: name.slice(lastDot + 1).toLowerCase(),
  };
}

function normalizeGitLikeStatus(status: GitFileChange["status"]) {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default:
      return "M";
  }
}

function gitLikeStatusToneClass(status: GitFileChange["status"]) {
  switch (status) {
    case "added":
      return "is-add";
    case "deleted":
      return "is-del";
    case "renamed":
      return "is-rename";
    default:
      return "is-mod";
  }
}

function gitLikeStatusSymbol(status: GitFileChange["status"]) {
  switch (status) {
    case "added":
      return "(A)";
    case "deleted":
      return "(D)";
    case "renamed":
      return "(R)";
    default:
      return "(U)";
  }
}

function gitLikeStatusIconClass(status: GitFileChange["status"]) {
  switch (status) {
    case "added":
      return "diff-icon-added";
    case "deleted":
      return "diff-icon-deleted";
    case "renamed":
      return "diff-icon-renamed";
    default:
      return "diff-icon-modified";
  }
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

function parseConversationFilePatch(diffText: string) {
  let additions = 0;
  let deletions = 0;

  for (const line of diffText.split(/\r?\n/)) {
    if (!line) continue;
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function mergeConversationDiff(current: string, next: string) {
  const normalizedCurrent = current.trim();
  const normalizedNext = next.trim();
  if (!normalizedCurrent) return normalizedNext;
  if (!normalizedNext) return normalizedCurrent;
  if (normalizedCurrent === normalizedNext) return normalizedCurrent;
  return `${normalizedCurrent}\n\n${normalizedNext}`;
}

function mapConversationFileChangeStatus(
  block: Extract<ChatMessageBlock, { kind: "fileChange" }>
): GitFileChange["status"] {
  if (block.movePath?.trim()) return "renamed";
  if (block.changeType === "add") return "added";
  if (block.changeType === "delete") return "deleted";
  return "modified";
}

function buildConversationFileChanges(session: ConversationSession | null): ConversationFileChangeEntry[] {
  if (!session) return [];

  const latestUserIndex = [...session.messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find((entry) => entry.message.role === "user")?.index ?? -1;
  const turnMessages = latestUserIndex >= 0 ? session.messages.slice(latestUserIndex + 1) : session.messages;
  const changes = new Map<string, ConversationFileChangeEntry>();

  turnMessages.forEach((message) => {
    const timestamp = Date.parse(message.timestamp);
    const lastTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
    for (const block of message.blocks ?? []) {
      if (block.kind !== "fileChange") continue;
      const key = `${block.movePath ?? ""}::${block.path}`;
      const patch = parseConversationFilePatch(block.diff);
      const status = mapConversationFileChangeStatus(block);
      const existing = changes.get(key);
      if (existing) {
        existing.additions += patch.additions;
        existing.deletions += patch.deletions;
        existing.diff = mergeConversationDiff(existing.diff, block.diff);
        existing.status = status;
        existing.previousPath = block.movePath ?? existing.previousPath ?? null;
        existing.lastTimestamp = Math.max(existing.lastTimestamp, lastTimestamp);
      } else {
        changes.set(key, {
          path: block.path,
          status,
          previousPath: block.movePath ?? null,
          additions: patch.additions,
          deletions: patch.deletions,
          diff: block.diff,
          lastTimestamp,
        });
      }
    }
  });

  return Array.from(changes.values()).sort((left, right) => right.lastTimestamp - left.lastTimestamp);
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
    case "codexGoal":
      return block.objective?.trim() || block.message?.trim() || block.status;
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
    case "codexGoal":
      return "Goal";
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
    case "codexGoal":
      return "task";
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

function buildWorkspaceMentionText(relativePath: string, isDirectory: boolean) {
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalizedPath) return "";
  const mentionPath = isDirectory ? `${normalizedPath}/` : normalizedPath;
  return `@${mentionPath}`;
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
  fileChanges,
  workspace,
  terminalTabId,
  onOpenTask,
}: {
  tasks: TaskNode[];
  subagents: TabSubagentState[];
  fileChanges: ConversationFileChangeEntry[];
  workspace: WorkspaceRef | null;
  terminalTabId: string | null;
  onOpenTask: (terminalTabId: string, messageId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"tasks" | "changes" | "subagents">(() =>
    tasks.length > 0 ? "tasks" : fileChanges.length > 0 ? "changes" : "subagents"
  );
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);
  const [diffModal, setDiffModal] = useState<ConversationFileDiffModalState | null>(null);
  const [diffViewStyle, setDiffViewStyle] = useState<GitDiffStyle>(() => {
    if (typeof window === "undefined") return "split";
    const stored = window.localStorage.getItem(STATUS_RAIL_DIFF_STYLE_STORAGE_KEY);
    return stored === "unified" ? "unified" : "split";
  });
  const hasMoreTasks = tasks.length > 10;
  const hasMoreChanges = fileChanges.length > 10;
  const visibleTasks = expanded ? tasks : tasks.slice(0, 10);
  const visibleChanges = expanded ? fileChanges : fileChanges.slice(0, 10);
  const visibleSubagents = subagents.slice(0, expanded ? subagents.length : 10);

  useEffect(() => {
    if (activeTab === "tasks" && tasks.length === 0) {
      if (fileChanges.length > 0) {
        setActiveTab("changes");
        return;
      }
      if (subagents.length > 0) {
        setActiveTab("subagents");
        return;
      }
    }
    if (activeTab === "changes" && fileChanges.length === 0) {
      if (tasks.length > 0) {
        setActiveTab("tasks");
        return;
      }
      if (subagents.length > 0) {
        setActiveTab("subagents");
        return;
      }
    }
    if (activeTab === "subagents" && subagents.length === 0) {
      if (tasks.length > 0) {
        setActiveTab("tasks");
        return;
      }
      if (fileChanges.length > 0) {
        setActiveTab("changes");
      }
    }
  }, [activeTab, fileChanges.length, subagents.length, tasks.length]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STATUS_RAIL_DIFF_STYLE_STORAGE_KEY, diffViewStyle);
  }, [diffViewStyle]);

  useEffect(() => {
    setExpanded(false);
    setSelectedFileKey(null);
    setDiffModal(null);
  }, [terminalTabId]);

  const openConversationDiff = useCallback(
    async (file: ConversationFileChangeEntry) => {
      setSelectedFileKey(`${file.previousPath ?? ""}::${file.path}`);
      setDiffModal({ file, diff: null, loading: true, error: null });

      const fallbackDiff: GitFileDiff = {
        path: file.path,
        status: file.status,
        previousPath: file.previousPath ?? null,
        diff: file.diff,
        isBinary: false,
      };

      if (!workspace?.rootPath) {
        setDiffModal({ file, diff: fallbackDiff, loading: false, error: null });
        return;
      }

      try {
        const liveDiff = await bridge.getGitFileDiff(workspace.rootPath, file.path, workspace.id);
        const resolvedDiff = liveDiff?.diff?.trim() ? liveDiff : fallbackDiff;
        setDiffModal({ file, diff: resolvedDiff, loading: false, error: null });
      } catch (error) {
        setDiffModal({
          file,
          diff: fallbackDiff.diff.trim() ? fallbackDiff : null,
          loading: false,
          error: fallbackDiff.diff.trim()
            ? null
            : error instanceof Error
              ? error.message
              : String(error),
        });
      }
    },
    [workspace]
  );

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
            onClick={() => setActiveTab("changes")}
            className={`workspace-task-pill${activeTab === "changes" ? " is-active" : ""}`}
          >
            <span className="workspace-task-pill-label">File Change</span>
            <span className="workspace-task-pill-value">{fileChanges.length}</span>
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
                    <button
                      type="button"
                      className={`workspace-task-node${task.isLatest ? " is-latest" : ""}`}
                      title="双击跳转到这条消息"
                      onDoubleClick={() => {
                        if (!terminalTabId) return;
                        onOpenTask(terminalTabId, task.id);
                      }}
                    >
                      <div className="workspace-task-node-marker" aria-hidden>
                        <div className="workspace-task-node-dot" />
                      </div>
                      <div className="workspace-task-node-main">
                        <div className="workspace-task-node-detail">{task.detail}</div>
                        <div className="workspace-task-node-time">{task.timestamp || "just now"}</div>
                      </div>
                    </button>
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
      ) : activeTab === "changes" ? (
        fileChanges.length === 0 ? (
          <div className="workspace-task-rail-empty">
            当前轮对话还没有产生文件改动。
          </div>
        ) : (
          <div className="git-history-changes diff-panel workspace-status-filechange-panel">
            <div className="diff-list">
              <div className="git-history-worktree-sections is-single is-flat-view">
                <div className="git-history-worktree-section diff-section diff-section--unstaged">
                  <div className="git-history-worktree-section-list diff-section-list">
                    {visibleChanges.map((file, index) => {
                      const fileKey = `${file.previousPath ?? ""}::${file.path}`;
                      const segments = file.path.replace(/\\/g, "/").split("/").filter(Boolean);
                      const name = segments[segments.length - 1] ?? file.path;
                      const dir = segments.length > 1 ? segments.slice(0, -1).join("/") : "";
                      const { base, extension } = splitNameAndExtension(name);
                      const isLastVisibleFile = index === visibleChanges.length - 1;
                      return (
                        <Fragment key={fileKey}>
                          <div
                            className={`diff-row git-filetree-row${selectedFileKey === fileKey ? " active" : ""}`}
                            data-status={normalizeGitLikeStatus(file.status)}
                            data-path={file.path}
                            role="button"
                            tabIndex={0}
                            aria-label={file.path}
                            onClick={() => void openConversationDiff(file)}
                            onDoubleClick={() => void openConversationDiff(file)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                void openConversationDiff(file);
                              }
                            }}
                          >
                            <span className={`diff-icon ${gitLikeStatusIconClass(file.status)}`} aria-hidden>
                              {gitLikeStatusSymbol(file.status)}
                            </span>
                            <span className="diff-file-icon" aria-hidden>
                              <FileIcon filePath={file.path} className="h-4 w-4" />
                            </span>
                            <div className="diff-file">
                              <div className="diff-path">
                                <span className="diff-name">
                                  <span className="diff-name-base">{base}</span>
                                  {extension ? <span className="diff-name-ext">.{extension}</span> : null}
                                </span>
                              </div>
                              {dir ? <div className="diff-dir">{dir}</div> : null}
                            </div>
                            <div className="diff-row-meta">
                              <span className="diff-counts-inline git-filetree-badge" aria-label={`+${file.additions} -${file.deletions}`}>
                                <span className="diff-add">+{file.additions}</span>
                                <span className="diff-sep">/</span>
                                <span className="diff-del">-{file.deletions}</span>
                              </span>
                            </div>
                          </div>
                          {!expanded && hasMoreChanges && isLastVisibleFile ? (
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
                </div>
              </div>
            </div>
          </div>
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
      {diffModal ? (
        <div className="git-history-diff-modal-overlay" role="presentation" onClick={() => setDiffModal(null)}>
          <div
            className="git-history-diff-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="git-history-diff-modal-header">
              <div className="git-history-diff-modal-title">
                <span className={`git-history-file-status ${gitLikeStatusToneClass(diffModal.file.status)}`}>
                  {normalizeGitLikeStatus(diffModal.file.status)}
                </span>
                <span className="git-history-tree-icon is-file" aria-hidden>
                  <FileIcon filePath={diffModal.file.path} className="h-4 w-4" />
                </span>
                <span className="git-history-diff-modal-path" title={diffModal.file.path}>
                  {compactPathForDisplay(diffModal.file.path)}
                </span>
                <span className="git-history-diff-modal-stats">
                  <span className="is-add">+{diffModal.file.additions}</span>
                  <span className="is-sep">/</span>
                  <span className="is-del">-{diffModal.file.deletions}</span>
                </span>
              </div>
              <div className="git-history-diff-modal-actions">
                {!diffModal.loading && !diffModal.error && diffModal.diff?.diff.trim() ? (
                  <div className="diff-viewer-header-controls is-external">
                    <div className="diff-viewer-header-mode" role="group" aria-label="Diff style">
                      <button
                        type="button"
                        className={`diff-viewer-header-mode-icon-button ${diffViewStyle === "split" ? "active" : ""}`}
                        onClick={() => setDiffViewStyle("split")}
                        aria-label="Dual panel diff"
                        title="Dual panel diff"
                      >
                        <span className="diff-viewer-mode-glyph diff-viewer-mode-glyph-split" aria-hidden />
                        <span className="diff-viewer-mode-label">Dual panel</span>
                      </button>
                      <button
                        type="button"
                        className={`diff-viewer-header-mode-icon-button ${diffViewStyle === "unified" ? "active" : ""}`}
                        onClick={() => setDiffViewStyle("unified")}
                        aria-label="Single column diff"
                        title="Single column diff"
                      >
                        <span className="diff-viewer-mode-glyph diff-viewer-mode-glyph-unified" aria-hidden />
                        <span className="diff-viewer-mode-label">Single column</span>
                      </button>
                    </div>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="git-history-diff-modal-close"
                  onClick={() => setDiffModal(null)}
                  aria-label="Close diff"
                  title="Close diff"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            {diffModal.loading ? <div className="git-history-empty">Loading diff...</div> : null}
            {diffModal.error ? <div className="git-history-error">{diffModal.error}</div> : null}
            {!diffModal.loading && !diffModal.error ? (
              diffModal.diff?.isBinary || !diffModal.diff?.diff.trim() ? (
                <pre className="git-history-diff-modal-code">
                  {diffModal.diff?.diff || "No diff available."}
                </pre>
              ) : (
                <div className="git-history-diff-modal-viewer">
                  <GitDiffBlock diff={diffModal.diff.diff} style={diffViewStyle} />
                </div>
              )
            ) : null}
          </div>
        </div>
      ) : null}
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
  const activeTabId = useStore((state) => state.activeTerminalTabId);
  const terminalTabs = useStore((state) => state.terminalTabs);
  const openChatFilePreview = useStore((state) => state.openChatFilePreview);
  const [entriesByParent, setEntriesByParent] = useState<Record<string, WorkspaceTreeEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({ "": true });
  const [loadingDirectories, setLoadingDirectories] = useState<Record<string, boolean>>({});
  const [treeLoading, setTreeLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<WorkspaceTreeEntry["kind"] | null>(null);
  const [createDialogKind, setCreateDialogKind] = useState<WorkspaceCreateDialogKind | null>(null);
  const [createName, setCreateName] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const gitStatusByPath = useMemo(() => changeStatusMap(changes), [changes]);
  const targetTabId = useMemo(
    () =>
      activeTabId && terminalTabs.some((tab) => tab.id === activeTabId && tab.workspaceId === workspace.id)
        ? activeTabId
        : terminalTabs.find((tab) => tab.workspaceId === workspace.id)?.id ?? null,
    [activeTabId, terminalTabs, workspace.id]
  );

  const loadDirectoryEntries = useCallback(
    async (path: string, options?: { silent?: boolean }) => {
      const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      const silent = Boolean(options?.silent);
      if (normalizedPath === "") {
        setTreeLoading(true);
      } else if (!silent) {
        setLoadingDirectories((current) => ({ ...current, [normalizedPath]: true }));
      }
      setErrorMessage(null);
      try {
        const entries = await bridge.listWorkspaceEntries(
          workspace.rootPath,
          normalizedPath || undefined,
          workspace.id
        );
        setEntriesByParent((current) => ({
          ...current,
          [normalizedPath]: entries,
        }));
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unable to load workspace files.";
        setErrorMessage(detail);
      } finally {
        if (normalizedPath === "") {
          setTreeLoading(false);
        } else if (!silent) {
          setLoadingDirectories((current) => {
            const next = { ...current };
            delete next[normalizedPath];
            return next;
          });
        }
      }
    },
    [workspace.id, workspace.rootPath]
  );

  useEffect(() => {
    const rootExpanded = workspaceTreeUiStateByWorkspace.get(workspace.id)?.expandedDirectories?.[""] ?? true;
    setEntriesByParent({});
    setExpandedDirectories({ "": rootExpanded });
    setLoadingDirectories({});
    setErrorMessage(null);
    setSelectedPath(null);
    setSelectedKind(null);
    setCreateDialogKind(null);
    setCreateName("");
    setDeleteDialogOpen(false);
    void loadDirectoryEntries("");
  }, [loadDirectoryEntries, workspace.id]);

  useEffect(() => {
    workspaceTreeUiStateByWorkspace.set(workspace.id, {
      expandedDirectories,
    });
  }, [expandedDirectories, workspace.id]);

  const toggleDirectory = useCallback(
    (path: string) => {
      const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      setExpandedDirectories((current) => {
        const isExpanded = Boolean(current[normalizedPath]);
        return { ...current, [normalizedPath]: !isExpanded };
      });
      if (!Object.prototype.hasOwnProperty.call(entriesByParent, normalizedPath)) {
        void loadDirectoryEntries(normalizedPath);
      }
    },
    [entriesByParent, loadDirectoryEntries]
  );

  const addPathMentionToPrompt = useCallback(
    (path: string, kind: WorkspaceTreeEntry["kind"]) => {
      if (!targetTabId) return;
      const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (!normalizedPath) return;
      const text = buildWorkspaceMentionText(normalizedPath, kind === "directory");
      if (!text) return;
      window.dispatchEvent(
        new CustomEvent("terminal-chat-insert-prompt-text", {
          detail: {
            tabId: targetTabId,
            text,
          },
        })
      );
    },
    [targetTabId]
  );

  const renderDirectory = useCallback(
    (parentPath: string, depth: number) => {
      const entries = entriesByParent[parentPath] ?? EMPTY_TREE;
      return entries.flatMap((entry) => {
        const normalizedPath = entry.path.replace(/\\/g, "/");
        const isDirectory = entry.kind === "directory";
        const isExpanded = Boolean(expandedDirectories[normalizedPath]);
        const hasLoadedChildren = Object.prototype.hasOwnProperty.call(entriesByParent, normalizedPath);
        const isLoadingChildren = Boolean(loadingDirectories[normalizedPath]);
        const gitStatus = gitStatusByPath.get(normalizedPath);
        const children = isDirectory && isExpanded && hasLoadedChildren ? renderDirectory(normalizedPath, depth + 1) : [];

        return [
          <div key={normalizedPath} className="file-tree-row-wrap">
            <div className="file-tree-row-shell">
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
                  if (!targetTabId) {
                    return;
                  }
                  openChatFilePreview(targetTabId, normalizedPath);
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
              {targetTabId ? (
                <button
                  type="button"
                  className="file-tree-inline-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    addPathMentionToPrompt(normalizedPath, entry.kind);
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                  title={isDirectory ? "添加 @ 文件夹到聊天输入框" : "添加 @ 文件到聊天输入框"}
                  aria-label={isDirectory ? `Mention folder ${entry.name}` : `Mention file ${entry.name}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            {isDirectory && isExpanded ? (
              hasLoadedChildren ? (
                children
              ) : (
                <div className="file-tree-empty py-1 text-left" style={{ paddingLeft: `${34 + (depth + 1) * 16}px` }}>
                  {isLoadingChildren ? "Loading..." : "No files loaded."}
                </div>
              )
            ) : null}
          </div>,
        ];
      });
    },
    [addPathMentionToPrompt, entriesByParent, expandedDirectories, gitStatusByPath, loadingDirectories, openChatFilePreview, selectedPath, targetTabId, toggleDirectory]
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
    const loadedPaths = Object.keys(entriesByParent);
    if (loadedPaths.length === 0) {
      await loadDirectoryEntries("");
      return;
    }
    await Promise.all(loadedPaths.map((path) => loadDirectoryEntries(path, { silent: path !== "" })));
  }, [entriesByParent, loadDirectoryEntries]);

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
      await loadDirectoryEntries(selectedParentFolder);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [closeCreateDialog, createDialogKind, createName, loadDirectoryEntries, resolveCreateTargetPath, selectedParentFolder, workspace.id, workspace.rootPath]);

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
      const deletedPath = selectedPath;
      const parentFolder =
        selectedKind === "directory"
          ? selectedPath.lastIndexOf("/") >= 0
            ? selectedPath.slice(0, selectedPath.lastIndexOf("/"))
            : ""
          : selectedParentFolder;
      setSelectedPath(null);
      setSelectedKind(null);
      setDeleteDialogOpen(false);
      setEntriesByParent((current) => {
        const next = { ...current };
        for (const key of Object.keys(next)) {
          if (key === deletedPath || key.startsWith(`${deletedPath}/`)) {
            delete next[key];
          }
        }
        return next;
      });
      await loadDirectoryEntries(parentFolder || "");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [loadDirectoryEntries, selectedKind, selectedParentFolder, selectedPath, workspace.id, workspace.rootPath]);

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
  const conversationFileChanges = useMemo(
    () => buildConversationFileChanges(activeSession),
    [activeSession]
  );
  const tabSubagentsByTab = useStore((state) => state.tabSubagentsByTab);
  const activeSubagents = useMemo(
    () => (activeTabId ? tabSubagentsByTab[activeTabId] ?? EMPTY_SUBAGENTS : EMPTY_SUBAGENTS),
    [activeTabId, tabSubagentsByTab]
  );

  const handleOpenTaskMessage = useCallback((terminalTabId: string, messageId: string) => {
    window.dispatchEvent(
      new CustomEvent("terminal-chat-scroll-message", {
        detail: {
          tabId: terminalTabId,
          messageId,
        },
      })
    );
  }, []);

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
            ) : mode === "files" ? (
              <WorkspaceFilesPanel workspace={workspace} changes={fileModeChanges} />
            ) : mode === "search" ? (
              <WorkspaceSearchPanel workspace={workspace} />
            ) : (
              <GitPanel workspace={workspace} />
            )}
          </div>

          {!statusPanelCollapsed ? (
            <WorkspaceStatusRail
              tasks={taskNodes}
              subagents={activeSubagents}
              fileChanges={conversationFileChanges}
              workspace={workspace}
              terminalTabId={activeTabId}
              onOpenTask={handleOpenTaskMessage}
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
}
