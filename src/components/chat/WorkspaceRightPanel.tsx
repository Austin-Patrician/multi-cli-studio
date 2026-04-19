import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
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
  LoaderCircle as SpinnerIcon,
  RefreshCw as RefreshIcon,
  Search as SearchIcon,
  ShieldCheck,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import type {
  AgentId,
  ChatMessage,
  ChatMessageBlock,
  ConversationSession,
  FileMentionCandidate,
  GitFileChange,
  TerminalTab,
  WorkspaceRef,
  WorkspaceTextSearchFileResult,
  WorkspaceTextSearchResponse,
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

type WorkspacePanelMode = "activity" | "radar" | "git" | "files" | "search";
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
  kind: "command" | "fileChange" | "tool" | "status" | "approval" | "task" | "reasoning" | "routing" | "message";
  label: string;
  detail: string;
  filePath?: string | null;
};

const PANEL_STORAGE_KEY = "multi-cli-studio::workspace-right-panel-mode";
const EMPTY_TREE: WorkspaceTreeEntry[] = [];
const EMPTY_CHAT_SESSIONS: Record<string, ConversationSession> = {};
const EMPTY_GIT_CHANGES: GitFileChange[] = [];
const REMOTE_FILE_TREE_CACHE_TTL_MS = 30_000;
const workspaceTreeUiStateByWorkspace = new Map<
  string,
  {
    expandedDirectories: Record<string, boolean>;
  }
>();
const PANEL_MODES: Array<{
  id: WorkspacePanelMode;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "activity", label: "Activity", icon: ActivityIcon },
  { id: "radar", label: "Radar", icon: RadarIcon },
  { id: "git", label: "Git", icon: GitIcon },
  { id: "files", label: "Files", icon: FilesPanelIcon },
  { id: "search", label: "Search", icon: SearchIcon },
];

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
    .slice(-10);

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

function WorkspaceTaskRail({
  tabTitle,
  tasks,
}: {
  tabTitle: string;
  tasks: TaskNode[];
}) {
  const latestTask = tasks[0] ?? null;

  return (
    <section className="workspace-task-rail">
      <div className="workspace-task-rail-header">
        <div className="workspace-task-rail-pills">
          <div className="workspace-task-pill is-primary">
            <span className="workspace-task-pill-label">任务</span>
            <span className="workspace-task-pill-value">{tasks.length}</span>
          </div>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="workspace-task-rail-empty">
          当前会话里的用户消息会在这里形成任务节点。
        </div>
      ) : (
        <div className="workspace-task-rail-list">
          {tasks.map((task) => (
            <div key={task.id} className={`workspace-task-node${task.isLatest ? " is-latest" : ""}`}>
              <div className="workspace-task-node-marker" aria-hidden>
                <div className="workspace-task-node-dot" />
              </div>
              <div className="workspace-task-node-main">
                <div className="workspace-task-node-detail">{task.detail}</div>
                <div className="workspace-task-node-time">{task.timestamp || "just now"}</div>
              </div>
            </div>
          ))}
        </div>
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
          <div>{renderDirectory("", 0)}</div>
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
}: {
  statusPanelCollapsed?: boolean;
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
  const [mode, setMode] = useState<WorkspacePanelMode>(() => {
    if (typeof window === "undefined") return "git";
    const stored = window.localStorage.getItem(PANEL_STORAGE_KEY);
    return PANEL_MODES.some((item) => item.id === stored) ? (stored as WorkspacePanelMode) : "git";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PANEL_STORAGE_KEY, mode);
  }, [mode]);

  const sessionsByTabId = useStore((state) => (mode === "activity" || mode === "radar" ? state.chatSessions : EMPTY_CHAT_SESSIONS));
  const fileModeChanges = useStore((state) =>
    mode === "files" && workspace ? state.gitPanelsByWorkspace[workspace.id]?.recentChanges ?? EMPTY_GIT_CHANGES : EMPTY_GIT_CHANGES
  );
  const activeSession = useMemo(
    () => (activeTabId ? chatSessions[activeTabId] ?? null : null),
    [activeTabId, chatSessions]
  );
  const taskNodes = useMemo(() => buildTaskNodes(activeSession), [activeSession]);

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
      <aside className="workspace-right-panel-shell w-[380px] min-w-[340px] border-l border-border bg-[#fcfcfd]">
        <div className="workspace-right-panel-empty">
          Attach a workspace to inspect project files and Git state.
        </div>
      </aside>
    );
  }

  return (
    <aside className="workspace-right-panel-shell w-[380px] min-w-[340px] border-l border-border bg-[#fcfcfd]">
      <div className="workspace-right-panel">
        <div className="workspace-right-panel-top file-tree-top-zone">
          <div className="workspace-right-panel-toolbar file-tree-tool-row">
            <div className="file-tree-tabs-wrap">
              <div className="panel-tabs">
                {PANEL_MODES.map((item) => {
                  const Icon = item.icon;
                  const isActive = mode === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMode(item.id)}
                      className={`panel-tab${isActive ? " is-active" : ""}`}
                      title={item.label}
                      aria-label={item.label}
                    >
                      <span className="panel-tab-icon" aria-hidden>
                        <Icon className="h-4 w-4" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            {mode === "files" && (
              <button
                type="button"
                onClick={() => void refreshGitPanel(workspace.id)}
                className="ghost icon-button file-tree-root-action"
                title="Refresh workspace state"
                aria-label="Refresh workspace state"
              >
                <RefreshIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          {/* <div className="workspace-right-panel-summary">
            <div className="min-w-0">
              <div className="workspace-right-panel-kicker">Workspace</div>
              <div className="workspace-right-panel-title">{workspace.name}</div>
              <div className="workspace-right-panel-path">{workspace.rootPath}</div>
            </div>
          </div> */}
          {/* <div className="workspace-right-panel-meta">
            <span className="workspace-right-panel-chip">
              {workspace.branch}
            </span>
            <span className="workspace-right-panel-chip workspace-right-panel-chip-muted">
              {workspaceTabs.length} tab{workspaceTabs.length === 1 ? "" : "s"}
            </span>
            {activeTabId ? (
              <span className="workspace-right-panel-chip workspace-right-panel-chip-accent">
                Active tab
              </span>
            ) : null}
          </div> */}
        </div>

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
            <WorkspaceTaskRail
              tabTitle={activeTab?.title || workspace.name}
              tasks={taskNodes}
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
}
