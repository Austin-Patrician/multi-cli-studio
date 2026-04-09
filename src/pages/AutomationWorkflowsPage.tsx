import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { bridge } from "../lib/bridge";
import type {
  AutomationWorkflow,
  AutomationWorkflowRun,
  AutomationWorkflowRunDetail,
  AutomationRunDetail,
  ChatMessage,
} from "../lib/models";
import { AutomationRunConversationSection, StatusBadge } from "./AutomationRunDetailSections";
import {
  cn,
  executionModeLabel,
  formatDuration,
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

const ChevronDownIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LogIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M7 6h10M7 12h10M7 18h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
  return `${completed}/${run.nodeRuns.length} 完成 · ${failed} 失败`;
}

function filterMessagesForNode(messages: ChatMessage[], nodeId: string, automationRunId: string) {
  const filtered = messages.filter(
    (message) =>
      message.automationRunId === automationRunId ||
      message.workflowNodeId === nodeId
  );
  return filtered.length > 0 ? filtered : messages;
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
  const [showWorkflowDetails, setShowWorkflowDetails] = useState(false);
  const [selectedNodeRunId, setSelectedNodeRunId] = useState<string | null>(null);
  const [selectedNodeRunDetail, setSelectedNodeRunDetail] = useState<AutomationRunDetail | null>(null);
  const [selectedNodeRunLoading, setSelectedNodeRunLoading] = useState(false);

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
  const showingNodeLog =
    Boolean(selectedNodeRun?.automationRunId) && Boolean(selectedNodeRunDetail);
  const nodeLogMessages =
    showingNodeLog && selectedNodeRun?.automationRunId
      ? filterMessagesForNode(
          selectedNodeRunDetail?.conversationSession?.messages ?? [],
          selectedNodeRun.nodeId,
          selectedNodeRun.automationRunId
        )
      : [];
  const logMessages = showingNodeLog
    ? nodeLogMessages
    : detail?.conversationSession?.messages ?? [];
  const logTitle = showingNodeLog
    ? `${selectedNodeRun?.label ?? "节点"} 执行日志`
    : "共享上下文日志";
  const logEmptyText = selectedNodeRunId
    ? selectedNodeRunLoading
      ? "正在加载该节点的执行日志..."
      : "该节点暂时没有可展示的独立执行日志。"
    : detailLoading
      ? "正在加载日志..."
      : "当前没有共享上下文日志输出。";

  return (
    <div className="h-[calc(100vh-48px)] min-h-0 bg-slate-50/50 px-4 py-6 sm:px-6">
      <div className="mx-auto grid h-full max-w-[100rem] grid-cols-[320px_minmax(0,1fr)] gap-5">
        
        {/* Left Sidebar: Workflow List */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="space-y-4 border-b border-slate-100 bg-slate-50/50 px-5 py-5">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold tracking-tight text-slate-900">工作流</h1>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500">组合多个任务形成自动化链路</p>
              </div>
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

                <button 
                  type="button"
                  onClick={() => setShowWorkflowDetails(!showWorkflowDetails)}
                  className="mt-4 flex items-center gap-1.5 self-start text-xs font-bold text-sky-600 transition hover:text-sky-700"
                >
                  <ChevronDownIcon className={cn("h-4 w-4 transition-transform", showWorkflowDetails ? "rotate-180" : "")} />
                  {showWorkflowDetails ? "收起工作流配置" : "展开工作流配置"}
                </button>
              </div>

              {/* Expanded Workflow Details */}
              {showWorkflowDetails && (
                <div className="shrink-0 border-b border-slate-100 bg-slate-50/80 p-5 shadow-inner max-h-[300px] overflow-y-auto custom-scrollbar">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-medium text-slate-500 mb-5">
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

                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">节点流转预览</h3>
                  <div className="flex flex-col gap-1.5">
                    {selectedWorkflow.nodes.map((node, index) => {
                      const successEdge = selectedWorkflow.edges.find((edge) => edge.fromNodeId === node.id && edge.on === "success");
                      const failEdge = selectedWorkflow.edges.find((edge) => edge.fromNodeId === node.id && edge.on === "fail");
                      return (
                        <div key={node.id} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200/60 bg-white px-3 py-2 shadow-sm">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[9px] font-bold text-slate-600">
                              {index + 1}
                            </div>
                            <div className="flex items-center gap-2 truncate">
                              <span className="text-xs font-bold text-slate-700">{node.label}</span>
                              <span className="text-[9px] text-slate-400 border-l border-slate-200 pl-2">
                                {node.executionMode === "inherit" ? "继承模式" : executionModeLabel(node.executionMode)}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 text-[9px] font-medium shrink-0 bg-slate-50/50 px-2 py-1 rounded-md border border-slate-100">
                            <div className="flex items-center gap-1 text-emerald-600">
                              <span className="opacity-70">成功 ➔</span>
                              <span className="truncate max-w-[80px]">{successEdge ? selectedWorkflow.nodes.find((item) => item.id === successEdge.toNodeId)?.label ?? successEdge.toNodeId : "结束"}</span>
                            </div>
                            <div className="w-px h-3 bg-slate-200" />
                            <div className="flex items-center gap-1 text-rose-500">
                              <span className="opacity-70">失败 ➔</span>
                              <span className="truncate max-w-[80px]">{failEdge ? selectedWorkflow.nodes.find((item) => item.id === failEdge.toNodeId)?.label ?? failEdge.toNodeId : "结束"}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Active Run Overview & Logs */}
              {!currentRun ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/30">
                  <div className="rounded-full bg-white p-3 mb-3 shadow-sm border border-slate-100">
                    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-slate-300">
                      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="text-xs text-slate-500">还没有运行记录，点击右上角“运行”开始。</p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Current Run Mini Header */}
                  <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/30 px-6 py-2.5">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={currentRun.status} />
                        <span className="text-xs font-bold text-slate-700">执行追踪</span>
                      </div>
                      <div className="h-3 w-px bg-slate-200 mx-1" />
                      <div className="flex items-center gap-3 text-[11px] font-medium text-slate-500">
                        <span>耗时 <strong className="text-slate-700 font-mono ml-0.5">{formatDuration(currentRun.startedAt, currentRun.completedAt)}</strong></span>
                        <span>会话 <strong className="text-slate-700 font-mono ml-0.5">{currentRun.cliSessions.length}</strong></span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {currentRun.status === "running" || currentRun.status === "scheduled" ? (
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
                  
                  {/* Node Executions Row */}
                  <div className="border-b border-slate-100 bg-white px-6 py-2.5 shrink-0">
                    <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                      {currentRun.nodeRuns.map((nodeRun) => (
                        <button
                          key={nodeRun.id}
                          type="button"
                          onClick={() =>
                            nodeRun.automationRunId
                              ? setSelectedNodeRunId((current) =>
                                  current === nodeRun.id ? null : nodeRun.id
                                )
                              : undefined
                          }
                          disabled={!nodeRun.automationRunId}
                          className={cn(
                            "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 shrink-0 shadow-sm transition",
                            selectedNodeRunId === nodeRun.id
                              ? "border-sky-300 bg-sky-50 ring-1 ring-sky-500/10"
                              : "border-slate-200/60 bg-slate-50 hover:border-slate-300 hover:bg-white",
                            !nodeRun.automationRunId && "cursor-default opacity-60 hover:border-slate-200/60 hover:bg-slate-50"
                          )}
                          title={
                            nodeRun.automationRunId
                              ? "点击查看该节点的独立执行日志"
                              : "该节点还没有独立执行日志"
                          }
                          aria-label={
                            nodeRun.automationRunId
                              ? `查看节点 ${nodeRun.label} 的执行日志`
                              : `节点 ${nodeRun.label} 暂无独立执行日志`
                          }
                        >
                          <div className={cn("h-2 w-2 shrink-0 rounded-full", statusTone(nodeRun.status).split(' ')[0].replace('text-', 'bg-').replace('ring-', 'bg-'))} />
                          <div className="flex flex-col items-start text-left">
                            <span className="text-[10px] font-bold text-slate-700 max-w-[100px] truncate leading-tight">{nodeRun.label}</span>
                            <span className="text-[9px] text-slate-400 truncate max-w-[100px] leading-tight">{nodeRun.statusSummary || "等待执行"}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 relative">
                    <AutomationRunConversationSection
                      messages={logMessages}
                      title={logTitle}
                      emptyText={logEmptyText}
                      actions={
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedNodeRunId(null)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition",
                              !selectedNodeRunId
                                ? "border-slate-700 bg-slate-800 text-white"
                                : "border-slate-700/20 bg-slate-900/10 text-slate-200 hover:bg-slate-900/20"
                            )}
                            title="查看整个工作流的共享上下文日志"
                          >
                            <LogIcon className="h-3.5 w-3.5" />
                            共享日志
                          </button>
                          {selectedNodeRun ? (
                            <div className="rounded-lg border border-slate-700/20 bg-slate-900/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200">
                              节点：{selectedNodeRun.label}
                            </div>
                          ) : null}
                        </div>
                      }
                    />
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
