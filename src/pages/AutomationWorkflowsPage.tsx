import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { bridge } from "../lib/bridge";
import type {
  AutomationWorkflow,
  AutomationWorkflowRun,
  AutomationWorkflowRunDetail,
  AutomationWorkflowNodeRun,
  AutomationRunDetail,
  ChatMessage,
} from "../lib/models";
import { AutomationWorkflowRunCanvas } from "./AutomationWorkflowRunCanvas";
import { StatusBadge } from "./AutomationRunDetailSections";
import { messageText, orderedMessages } from "./automationLog";
import {
  cn,
  executionModeLabel,
  formatDuration,
  formatStamp,
  statusText,
  statusTone,
  workflowContextStrategyLabel,
} from "./automationUi";

const PlusIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const PlayIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M7 6.5c0-.75.82-1.22 1.49-.86l8.18 4.58a.98.98 0 010 1.72l-8.18 4.58c-.67.37-1.49-.1-1.49-.86V6.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const SettingsIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M9 7V5.75A1.75 1.75 0 0110.75 4h2.5A1.75 1.75 0 0115 5.75V7m-9 0h12m-1 0l-.62 9.07A2 2 0 0114.38 18H9.62a2 2 0 01-1.99-1.93L7 7m3 3.5v4m4-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloseIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M16.5 7.5l-9 9m0-9l9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const StopIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="7" y="7" width="10" height="10" rx="1.75" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const SearchIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M21 21l-5.2-5.2m0 0A7.5 7.5 0 105.2 5.2a7.5 7.5 0 0010.6 10.6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChevronLeftIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChevronRightIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LogIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M7 6h10M7 12h10M7 18h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const SharedContextIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M12 7.5c-2.2 0-4 .9-4 2s1.8 2 4 2 4-.9 4-2-1.8-2-4-2z" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 9.5V14c0 1.1 1.8 2 4 2s4-.9 4-2V9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M5 11.5v2.5c0 1.1 1.8 2 4 2M19 11.5v2.5c0 1.1-1.8 2-4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const NodeLogIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="4" y="5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <rect x="14" y="13" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 8h2a2 2 0 012 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const buttonClass =
  "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:opacity-50";

function workflowCardClass(status?: string | null, isSelected = false) {
  const stateTone = (() => {
    switch (status) {
      case "completed":
        return "border-emerald-200 bg-emerald-50 hover:border-emerald-300";
      case "running":
        return "border-sky-200 bg-sky-50 hover:border-sky-300";
      case "validating":
      case "scheduled":
        return "border-indigo-200 bg-indigo-50 hover:border-indigo-300";
      case "paused":
      case "blocked":
        return "border-amber-200 bg-amber-50 hover:border-amber-300";
      case "failed":
      case "cancelled":
        return "border-rose-200 bg-rose-50 hover:border-rose-300";
      default:
        return "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50";
    }
  })();

  if (isSelected) {
    return `${stateTone} border-slate-400 shadow-sm`;
  }
  return stateTone;
}

function workflowSummary(run: AutomationWorkflowRun | null) {
  if (!run) return "还没有运行记录。";
  const completed = run.nodeRuns.filter((node) => node.status === "completed").length;
  const failed = run.nodeRuns.filter((node) => node.status === "failed").length;
  const paused = run.nodeRuns.filter((node) => node.status === "paused").length;
  const parts = [`${completed}/${run.nodeRuns.length} 完成`, `${failed} 失败`];
  if (paused > 0) parts.push(`${paused} 等待人工`);
  return parts.join(" · ");
}

function filterMessagesForNode(messages: ChatMessage[], nodeId: string, automationRunId?: string | null) {
  const filtered = messages.filter(
    (message) =>
      (automationRunId ? message.automationRunId === automationRunId : false) ||
      message.workflowNodeId === nodeId
  );
  return filtered.length > 0 ? filtered : messages;
}

function workflowLogRoleLabel(message: ChatMessage) {
  switch (message.role) {
    case "user":
      return "INPUT";
    case "assistant":
      return message.cliId ? message.cliId.toUpperCase() : "ASSISTANT";
    default:
      return "SYSTEM";
  }
}

function workflowLogRoleClass(message: ChatMessage) {
  switch (message.role) {
    case "user":
      return "border-sky-400/25 bg-sky-400/10 text-sky-200";
    case "assistant":
      return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
    default:
      return "border-slate-500/25 bg-slate-500/10 text-slate-300";
  }
}

function WorkflowRunLogDrawer({
  title,
  emptyText,
  messages,
  activeLogView,
  onSelectShared,
  onSelectNode,
  onClose,
  onResumePaused,
  selectedNodeRun,
  selectedNodeHasDedicatedLog,
  selectedNodeRunLoading,
  pausedReason,
}: {
  title: string;
  emptyText: string;
  messages: ChatMessage[];
  activeLogView: "shared" | "node";
  onSelectShared: () => void;
  onSelectNode: () => void;
  onClose: () => void;
  onResumePaused?: (() => void) | null;
  selectedNodeRun: AutomationWorkflowNodeRun | null;
  selectedNodeHasDedicatedLog: boolean;
  selectedNodeRunLoading: boolean;
  pausedReason?: string | null;
}) {
  const ordered = orderedMessages(messages).filter((message) => messageText(message));

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[12px] border border-slate-700/70 bg-[linear-gradient(180deg,#0c1622_0%,#111c29_100%)] text-slate-100 shadow-[0_26px_72px_rgba(2,8,23,0.28)] backdrop-blur">
      <div className="border-b border-slate-700/70 bg-[#111b28]/88 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500/90">Execution Log</div>
            <h3 className="mt-1 truncate text-sm font-semibold text-slate-100/95">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-[12px] border border-slate-600/60 bg-slate-950/20 p-1 shadow-sm">
              <button
                type="button"
                onClick={onSelectShared}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-[10px] transition",
                  activeLogView === "shared"
                    ? "bg-slate-100 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:bg-white/8 hover:text-slate-100"
                )}
                title="共享上下文"
                aria-label="共享上下文"
              >
                <SharedContextIcon className="h-4 w-4" />
              </button>
              {selectedNodeRun ? (
                <button
                  type="button"
                onClick={onSelectNode}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-[10px] transition",
                  activeLogView === "node"
                    ? "bg-sky-400 text-slate-950 shadow-sm"
                    : "text-slate-400 hover:bg-white/8 hover:text-slate-100"
                )}
                title={selectedNodeHasDedicatedLog ? "节点执行日志" : "节点上下文片段"}
                aria-label={selectedNodeHasDedicatedLog ? "节点执行日志" : "节点上下文片段"}
                >
                  <NodeLogIcon className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="shrink-0 rounded-full border border-slate-600/60 bg-slate-950/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {ordered.length}
            </div>
            {onResumePaused ? (
              <button
                type="button"
                onClick={onResumePaused}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-emerald-400/25 bg-emerald-400/10 text-emerald-200 shadow-sm transition hover:bg-emerald-400/16 hover:text-emerald-100"
                title="继续执行"
                aria-label="继续执行"
              >
                <PlayIcon className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-slate-600/60 bg-slate-950/20 text-slate-400 shadow-sm transition hover:bg-white/8 hover:text-slate-100"
              title="关闭日志抽屉"
              aria-label="关闭日志抽屉"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {selectedNodeRun && activeLogView === "node" && pausedReason ? (
        <div className="border-b border-slate-700/70 bg-white/[0.03] px-5 py-2.5 text-[11px] text-slate-300/90">
          {pausedReason}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {ordered.length === 0 ? (
          <div className="flex h-full min-h-[220px] items-center justify-center rounded-[24px] border border-dashed border-slate-600/60 bg-white/[0.025] px-6 text-center text-sm text-slate-400">
            {emptyText}
          </div>
        ) : (
          <div className="space-y-2.5">
            {ordered.map((message) => (
              <article
                key={message.id}
                className="rounded-[14px] border border-slate-700/60 bg-white/[0.035] px-3.5 py-3 shadow-[0_8px_22px_rgba(2,8,23,0.12)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]", workflowLogRoleClass(message))}>
                      {workflowLogRoleLabel(message)}
                    </span>
                  </div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500/90">
                    {formatStamp(message.timestamp)}
                  </div>
                </div>
                <div className="mt-2.5 rounded-[12px] bg-black/12 px-3 py-2.5 ring-1 ring-white/5">
                  <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-slate-200">
                    {messageText(message)}
                  </pre>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function AutomationWorkflowsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [workflows, setWorkflows] = useState<AutomationWorkflow[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<AutomationWorkflowRun[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AutomationWorkflowRunDetail | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeRunId, setSelectedNodeRunId] = useState<string | null>(null);
  const [selectedNodeRunDetail, setSelectedNodeRunDetail] = useState<AutomationRunDetail | null>(null);
  const [selectedNodeRunLoading, setSelectedNodeRunLoading] = useState(false);
  const [logDockCollapsed, setLogDockCollapsed] = useState(true);
  const [activeLogView, setActiveLogView] = useState<"shared" | "node">("shared");
  const [workflowListCollapsed, setWorkflowListCollapsed] = useState(false);

  async function refresh() {
    try {
      const [nextWorkflows, nextRuns] = await Promise.all([
        bridge.listAutomationWorkflows(),
        bridge.listAutomationWorkflowRuns(null),
      ]);
      setWorkflows(nextWorkflows);
      setWorkflowRuns(nextRuns);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载工作流失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const state = location.state as
      | { selectedWorkflowId?: string; selectedWorkflowRunId?: string }
      | undefined;
    if (state?.selectedWorkflowId) setSelectedWorkflowId(state.selectedWorkflowId);
    if (state?.selectedWorkflowRunId) setSelectedRunId(state.selectedWorkflowRunId);
  }, [location.state]);

  const filteredWorkflows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return workflows;
    return workflows.filter((workflow) =>
      [workflow.name, workflow.projectName, workflow.description ?? ""]
        .join("\n")
        .toLowerCase()
        .includes(keyword)
    );
  }, [query, workflows]);

  const selectedWorkflow =
    filteredWorkflows.find((workflow) => workflow.id === selectedWorkflowId) ??
    filteredWorkflows[0] ??
    null;

  useEffect(() => {
    if (selectedWorkflow && selectedWorkflow.id !== selectedWorkflowId) {
      setSelectedWorkflowId(selectedWorkflow.id);
    }
  }, [selectedWorkflow, selectedWorkflowId]);

  const runsForSelectedWorkflow = useMemo(
    () =>
      workflowRuns
        .filter((run) => run.workflowId === selectedWorkflow?.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [selectedWorkflow?.id, workflowRuns]
  );
  const latestRun = runsForSelectedWorkflow[0] ?? null;
  const currentRun =
    detail?.run ??
    (selectedRunId
      ? runsForSelectedWorkflow.find((run) => run.id === selectedRunId) ?? null
      : null);
  const workflowForCanvas = detail?.workflow ?? selectedWorkflow;
  const previewRun = useMemo<AutomationWorkflowRun | null>(() => {
    if (!selectedWorkflow) return null;
    const now = new Date().toISOString();
    return {
      id: `preview-${selectedWorkflow.id}`,
      workflowId: selectedWorkflow.id,
      workflowName: selectedWorkflow.name,
      triggerSource: "preview",
      workspaceId: selectedWorkflow.workspaceId,
      projectRoot: selectedWorkflow.projectRoot,
      projectName: selectedWorkflow.projectName,
      status: "queued",
      statusSummary: "当前工作流还没有执行记录，画布展示的是未执行预览状态。",
      scheduledStartAt: null,
      sharedTerminalTabId: "",
      entryNodeId: selectedWorkflow.entryNodeId,
      currentNodeId: null,
      emailNotificationEnabled: selectedWorkflow.emailNotificationEnabled,
      cliSessions: [],
      nodeRuns: [],
      events: [],
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }, [selectedWorkflow]);

  useEffect(() => {
    if (!selectedWorkflow) {
      setSelectedRunId(null);
      setSelectedNodeRunId(null);
      return;
    }
    if (!runsForSelectedWorkflow.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runsForSelectedWorkflow[0]?.id ?? null);
    }
  }, [runsForSelectedWorkflow, selectedRunId, selectedWorkflow]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    bridge
      .getAutomationWorkflowRunDetail(selectedRunId)
      .then((nextDetail) => {
        if (!cancelled) setDetail(nextDetail);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, workflowRuns]);

  useEffect(() => {
    if (!currentRun) {
      setSelectedNodeRunId(null);
      setSelectedNodeRunDetail(null);
      return;
    }
    if (
      selectedNodeRunId &&
      !currentRun.nodeRuns.some((nodeRun) => nodeRun.id === selectedNodeRunId)
    ) {
      setSelectedNodeRunId(null);
      setSelectedNodeRunDetail(null);
    }
  }, [currentRun, selectedNodeRunId]);

  useEffect(() => {
    const targetNodeRun = currentRun?.nodeRuns.find((nodeRun) => nodeRun.id === selectedNodeRunId);
    const automationRunId = targetNodeRun?.automationRunId ?? null;
    if (!automationRunId) {
      setSelectedNodeRunDetail(null);
      setSelectedNodeRunLoading(false);
      return;
    }
    let cancelled = false;
    setSelectedNodeRunLoading(true);
    bridge
      .getAutomationRunDetail(automationRunId)
      .then((nextDetail) => {
        if (!cancelled) {
          setSelectedNodeRunDetail(nextDetail);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedNodeRunDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedNodeRunLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentRun?.updatedAt, currentRun?.id, selectedNodeRunId]);

  useEffect(() => {
    if (selectedNodeRunId) {
      setLogDockCollapsed(false);
      setActiveLogView("node");
    } else {
      setActiveLogView("shared");
    }
  }, [selectedNodeRunId]);

  async function withBusy<T>(key: string, action: () => Promise<T>) {
    setBusyKey(key);
    try {
      return await action();
    } finally {
      setBusyKey(null);
      void refresh();
    }
  }

  async function runWorkflow(workflow: AutomationWorkflow) {
    const run = await bridge.createAutomationWorkflowRun({ workflowId: workflow.id });
    setSelectedWorkflowId(workflow.id);
    setSelectedRunId(run.id);
  }
  const selectedNodeRun =
    currentRun?.nodeRuns.find((nodeRun) => nodeRun.id === selectedNodeRunId) ?? null;
  const childRunsById = useMemo(
    () => new Map((detail?.childRuns ?? []).map((run) => [run.id, run])),
    [detail?.childRuns]
  );
  const currentNodeRun =
    currentRun?.nodeRuns.find((nodeRun) => nodeRun.nodeId === currentRun.currentNodeId) ?? null;
  const selectedChildRun =
    selectedNodeRun?.automationRunId ? childRunsById.get(selectedNodeRun.automationRunId) ?? null : null;
  const currentChildRun =
    currentNodeRun?.automationRunId ? childRunsById.get(currentNodeRun.automationRunId) ?? null : null;
  const selectedNodeHasDedicatedLog = Boolean(selectedNodeRun?.automationRunId);
  const sharedLogMessages = detail?.conversationSession?.messages ?? [];
  const nodeScopedMessages = selectedNodeRun
    ? selectedNodeHasDedicatedLog && selectedNodeRun?.automationRunId
      ? filterMessagesForNode(
          selectedNodeRunDetail?.conversationSession?.messages ?? [],
          selectedNodeRun.nodeId,
          selectedNodeRun.automationRunId
        )
      : filterMessagesForNode(
          sharedLogMessages,
          selectedNodeRun.nodeId,
          selectedNodeRun.automationRunId ?? null
        )
    : [];
  const showingNodeLog = activeLogView === "node" && Boolean(selectedNodeRun);
  const logMessages = showingNodeLog ? nodeScopedMessages : sharedLogMessages;
  const logTitle = showingNodeLog
    ? selectedNodeHasDedicatedLog
      ? `${selectedNodeRun?.label ?? "节点"} 执行日志`
      : `${selectedNodeRun?.label ?? "节点"} 共享上下文`
    : "共享上下文日志";
  const logEmptyText = showingNodeLog
    ? selectedNodeHasDedicatedLog
      ? selectedNodeRunLoading
        ? "正在加载该节点的执行日志..."
        : "该节点暂时没有可展示的独立执行日志。"
      : "该节点当前没有独立执行日志，已回落为共享上下文视角。"
    : detailLoading
      ? "正在加载日志..."
      : "当前没有共享上下文日志输出。";
  const pausedReason =
    selectedChildRun?.requiresAttentionReason ??
    selectedChildRun?.statusSummary ??
    currentChildRun?.requiresAttentionReason ??
    currentChildRun?.statusSummary ??
    currentRun?.statusSummary ??
    null;

  return (
    <div className="h-full min-h-0 overflow-hidden bg-slate-50/50 px-4 pb-3 pt-6 sm:px-6">
      <div
        className={cn(
          "mx-auto grid h-full max-w-[100rem] grid-rows-[minmax(0,1fr)] gap-5 transition-[grid-template-columns] duration-200",
          workflowListCollapsed
            ? "grid-cols-[minmax(0,1fr)]"
            : "grid-cols-[320px_minmax(0,1fr)]"
        )}
      >
        
        {/* Left Sidebar: Workflow List */}
        {!workflowListCollapsed ? (
          <section className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
              <div className="space-y-4 border-b border-slate-100 bg-slate-50/50 px-5 py-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-lg font-bold tracking-tight text-slate-900">工作流</h1>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-500">组合多个任务形成自动化链路</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setWorkflowListCollapsed(true)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50"
                      title="折叠工作流列表"
                      aria-label="折叠工作流列表"
                    >
                      <ChevronLeftIcon className="h-4 w-4" />
                    </button>
                    <button 
                      type="button" 
                      onClick={() => navigate("/automation/workflows/new")} 
                      className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm transition hover:bg-slate-800 active:scale-95 disabled:opacity-50"
                      disabled={busyKey !== null}
                      title="新建工作流"
                      aria-label="新建工作流"
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input 
                    value={query} 
                    onChange={(event) => setQuery(event.target.value)} 
                    placeholder="搜索工作流名称..." 
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20" 
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
                {loading ? (
                  <div className="py-8 text-center text-sm text-slate-400">正在加载...</div>
                ) : filteredWorkflows.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">没有找到匹配的工作流</div>
                ) : (
                  filteredWorkflows.map((workflow) => {
                    const latest = workflowRuns.find((run) => run.workflowId === workflow.id) ?? null;
                    const isSelected = selectedWorkflow?.id === workflow.id;
                    return (
                      <button
                        key={workflow.id}
                        type="button"
                        onClick={() => setSelectedWorkflowId(workflow.id)}
                        className={cn(
                          "w-full rounded-2xl border p-4 text-left transition-all",
                          workflowCardClass(latest?.status, isSelected)
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold tracking-tight text-slate-900">
                              {workflow.name}
                            </div>
                            <div className="mt-1 truncate text-[11px] font-medium text-slate-500">
                              {workflow.projectName}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-medium text-slate-400">
                          <span className="rounded-md bg-white px-1.5 py-0.5 ring-1 ring-slate-200/80 shadow-sm">{workflow.nodes.length} 节点</span>
                          <span className="rounded-md bg-white px-1.5 py-0.5 ring-1 ring-slate-200/80 shadow-sm">{executionModeLabel(workflow.defaultExecutionMode)}</span>
                          {workflow.cronExpression?.trim() && <span className="rounded-md bg-sky-100/50 text-sky-700 px-1.5 py-0.5 ring-1 ring-sky-200/50 shadow-sm">Cron</span>}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
          </section>
        ) : null}

        {/* Right Panel: Details & Logs */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          {!selectedWorkflow ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="rounded-full bg-slate-50 p-4 mb-4 border border-slate-100">
                <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-slate-300">
                  <path d="M8 9h8m-8 4h6m-7 6h10c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2H7c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="text-sm font-bold tracking-tight text-slate-900">未选择工作流</h3>
              <p className="mt-1 text-sm text-slate-500">请从左侧列表中选择一个工作流查看详情和运行记录</p>
            </div>
          ) : (
            <>
              {/* Workflow Header (Collapsible toggle included) */}
              <div className="flex shrink-0 flex-col border-b border-slate-100 bg-slate-50/50 px-6 py-5 shadow-sm z-10">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <h2 className="truncate text-xl font-bold tracking-tight text-slate-900">{selectedWorkflow.name}</h2>
                    <p className="truncate text-sm text-slate-500">{selectedWorkflow.description || "暂无描述"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setWorkflowListCollapsed((current) => !current)}
                      className={buttonClass}
                      title={workflowListCollapsed ? "展开工作流列表" : "折叠工作流列表"}
                      aria-label={workflowListCollapsed ? "展开工作流列表" : "折叠工作流列表"}
                    >
                      {workflowListCollapsed ? (
                        <ChevronRightIcon className="h-4 w-4" />
                      ) : (
                        <ChevronLeftIcon className="h-4 w-4" />
                      )}
                    </button>
                    <button 
                      type="button" 
                      onClick={() => void withBusy(`wf-run-${selectedWorkflow.id}`, () => runWorkflow(selectedWorkflow))} 
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm transition hover:bg-slate-800 active:scale-95 disabled:opacity-50"
                      disabled={busyKey !== null}
                      title="运行工作流"
                      aria-label="运行工作流"
                    >
                      <PlayIcon className="h-3.5 w-3.5" />
                    </button>
                    <button 
                      type="button" 
                      onClick={() => navigate(`/automation/workflows/${selectedWorkflow.id}`)} 
                      className={buttonClass} 
                      title="配置"
                    >
                      <SettingsIcon className="h-4 w-4" />
                    </button>
                    <button 
                      type="button" 
                      onClick={() => { if (window.confirm("确认删除这个工作流吗？")) void withBusy(`wf-delete-${selectedWorkflow.id}`, () => bridge.deleteAutomationWorkflow(selectedWorkflow.id)); }} 
                      className={cn(buttonClass, "hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200")} 
                      title="删除"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>

              </div>

              {/* Expanded Workflow Details */}
              <div className="shrink-0 border-b border-slate-100 bg-slate-50/80 p-5 shadow-inner">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-medium text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">当前状态</span>
                    <div className="pt-0.5"><StatusBadge status={latestRun?.status ?? "unknown"} /></div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">最新执行</span>
                    <span className="text-slate-700">{workflowSummary(latestRun)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">上下文策略</span>
                    <span className="text-slate-700">{workflowContextStrategyLabel(selectedWorkflow.defaultContextStrategy)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">统一执行模式</span>
                    <span className="text-slate-700">{executionModeLabel(selectedWorkflow.defaultExecutionMode)}</span>
                  </div>
                </div>
              </div>

              {/* Active Run Overview & Logs */}
              {!currentRun ? (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/30 px-6 py-3">
                    <div className="min-w-0 flex items-center gap-4">
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status="queued" />
                        <span className="text-xs font-bold text-slate-700">未执行预览</span>
                      </div>
                      <div className="h-3 w-px bg-slate-200 mx-1 shrink-0" />
                      <div className="truncate text-[11px] text-slate-500">
                        当前工作流还没有执行记录，画布展示的是节点未执行状态，方便先检查结构与节点详情。
                      </div>
                    </div>
                  </div>

                  <div className="relative flex min-h-0 flex-1 bg-slate-50/20">
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white px-6 py-5">
                      <div className="mb-4 flex items-center justify-between gap-3 rounded-[18px] border border-slate-200/70 bg-slate-50/80 px-4 py-3 text-[11px] text-slate-600 shadow-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400" />
                          <span className="truncate">当前为未执行预览态，节点会以未执行状态展示。</span>
                        </div>
                      </div>

                      <div className="min-h-0 flex-1">
                        {workflowForCanvas && previewRun ? (
                          <AutomationWorkflowRunCanvas
                            workflow={workflowForCanvas}
                            run={previewRun}
                            selectedNodeRunId={null}
                            onSelectNodeRun={() => {}}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center rounded-[22px] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                            当前工作流缺少定义，无法渲染预览画布。
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Current Run Mini Header */}
                  <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/30 px-6 py-3">
                    <div className="min-w-0 flex items-center gap-4">
                      <div className="flex items-center gap-2 shrink-0">
                        {/* <StatusBadge status={currentRun.status} /> */}
                        <span className="text-xs font-bold text-slate-700">执行追踪</span>
                      </div>
                      <div className="h-3 w-px bg-slate-200 mx-1 shrink-0" />
                      <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500 shrink-0">
                        <span>耗时 <strong className="text-slate-700 font-mono ml-0.5">{formatDuration(currentRun.startedAt, currentRun.completedAt)}</strong></span>
                        <span>会话 <strong className="text-slate-700 font-mono ml-0.5">{currentRun.cliSessions.length}</strong></span>
                      </div>
                      <div className="truncate text-[11px] text-slate-500">
                        {currentRun.statusSummary || "等待执行结果。"}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setLogDockCollapsed((current) => !current)}
                        className={cn(
                          "inline-flex h-7 w-7 items-center justify-center rounded-lg border transition",
                          logDockCollapsed
                            ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        )}
                        title={logDockCollapsed ? "展开日志侧栏" : "收起日志侧栏"}
                        aria-label={logDockCollapsed ? "展开日志侧栏" : "收起日志侧栏"}
                      >
                        <LogIcon className="h-3.5 w-3.5" />
                      </button>
                      {currentRun.status === "paused" ? (
                        <button
                          type="button"
                          onClick={() => void withBusy(`wf-resume-${currentRun.id}`, () => bridge.resumeAutomationWorkflowRun(currentRun.id))}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100 hover:text-emerald-700"
                          title="继续执行"
                          aria-label="继续执行"
                        >
                          <PlayIcon className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      {currentRun.status === "running" || currentRun.status === "scheduled" || currentRun.status === "paused" ? (
                        <button 
                          type="button" 
                          onClick={() => void withBusy(`wf-cancel-${currentRun.id}`, () => bridge.cancelAutomationWorkflowRun(currentRun.id))} 
                          className={cn(buttonClass, "h-7 w-7 rounded-lg hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200")} 
                          title="取消运行"
                        >
                          <StopIcon className="h-3 w-3" />
                        </button>
                      ) : null}
                      <button 
                        type="button" 
                        onClick={() => { if (window.confirm("确认删除这条运行记录吗？")) void withBusy(`wf-run-delete-${currentRun.id}`, () => bridge.deleteAutomationWorkflowRun(currentRun.id)); }} 
                        className={cn(buttonClass, "h-7 w-7 rounded-lg hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200")} 
                        title="删除记录"
                      >
                        <TrashIcon className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  <div className="relative flex min-h-0 flex-1 bg-slate-50/20">
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white px-6 py-5">
                      <div className="min-h-0 flex-1">
                        {workflowForCanvas ? (
                          <AutomationWorkflowRunCanvas
                            workflow={workflowForCanvas}
                            run={currentRun}
                            selectedNodeRunId={selectedNodeRunId}
                            onSelectNodeRun={setSelectedNodeRunId}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center rounded-[22px] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                            当前运行缺少工作流定义，无法渲染执行画布。
                          </div>
                        )}
                      </div>
                    </div>

                    {!logDockCollapsed ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setLogDockCollapsed(true)}
                          className="absolute inset-0 z-20 bg-slate-950/8 backdrop-blur-[1.5px] transition"
                          aria-label="关闭日志抽屉"
                        />
                        <div className="absolute inset-y-5 right-5 z-30 w-[380px] transition-all duration-200 ease-out translate-x-0 opacity-100">
                          <WorkflowRunLogDrawer
                            messages={logMessages}
                            title={logTitle}
                            emptyText={logEmptyText}
                            activeLogView={activeLogView}
                            onSelectShared={() => setActiveLogView("shared")}
                            onSelectNode={() => setActiveLogView("node")}
                            onClose={() => setLogDockCollapsed(true)}
                            onResumePaused={
                              currentRun.status === "paused"
                                ? () => void withBusy(`wf-resume-${currentRun.id}`, () => bridge.resumeAutomationWorkflowRun(currentRun.id))
                                : null
                            }
                            selectedNodeRun={selectedNodeRun}
                            selectedNodeHasDedicatedLog={selectedNodeHasDedicatedLog}
                            selectedNodeRunLoading={selectedNodeRunLoading}
                            pausedReason={activeLogView === "node" && selectedNodeRun?.status === "paused" ? pausedReason : null}
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {error ? (
        <div className="pointer-events-none fixed bottom-6 right-6 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700 shadow-lg">
          <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-5 w-5 shrink-0 text-rose-500">
            <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-5a1.25 1.25 0 100 2.5A1.25 1.25 0 0010 4z" fill="currentColor" />
          </svg>
          <div>{error}</div>
        </div>
      ) : null}
    </div>
  );
}
