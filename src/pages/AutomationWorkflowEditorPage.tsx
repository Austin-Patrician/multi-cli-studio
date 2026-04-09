import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { bridge } from "../lib/bridge";
import type {
  AutomationExecutionMode,
  AutomationPermissionProfile,
  AutomationWorkflowContextStrategy,
  AutomationWorkflowDraft,
  AutomationWorkflowNodeDraft,
} from "../lib/models";
import { useStore } from "../lib/store";
import {
  cn,
  workflowContextStrategyLabel,
  workflowContextStrategyOptions,
} from "./automationUi";

type NodeState = {
  id: string;
  label: string;
  goal: string;
  expectedOutcome: string;
  executionMode: AutomationExecutionMode | "inherit";
  permissionProfile: AutomationPermissionProfile | "inherit";
  reuseSession: boolean;
  successNodeId: string;
  failNodeId: string;
};

const BackIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" className={className}>
    <path d="M12.5 15L7.5 10l5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SaveIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M5 20h14a1 1 0 001-1V8.414a1 1 0 00-.293-.707l-3.414-3.414A1 1 0 0015.586 4H5a1 1 0 00-1 1v14a1 1 0 001 1z" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 20v-5a1 1 0 011-1h6a1 1 0 011 1v5M8 4v5a1 1 0 001 1h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PlayIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M7 6.5c0-.75.82-1.22 1.49-.86l8.18 4.58a.98.98 0 010 1.72l-8.18 4.58c-.67.37-1.49-.1-1.49-.86V6.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const PlusIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M9 7V5.75A1.75 1.75 0 0110.75 4h2.5A1.75 1.75 0 0115 5.75V7m-9 0h12m-1 0l-.62 9.07A2 2 0 0114.38 18H9.62a2 2 0 01-1.99-1.93L7 7m3 3.5v4m4-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" className={className}>
    <path d="M16.7 5.3L8.4 13.6l-5.1-5.1" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CrossIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" className={className}>
    <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ArrowIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M5 12h14m0 0l-5-5m5 5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200/80 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10";
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[100px] resize-none py-3 leading-relaxed`;
const HEADER_ICON_BUTTON_CLASS =
  "inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl shadow-sm transition disabled:opacity-50 active:scale-95";

const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:opacity-50";

function ToggleField({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="group flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50">
      <span className="text-sm font-bold tracking-tight text-slate-700 transition-colors group-hover:text-slate-900">{label}</span>
      <div className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus-within:outline-none focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2" style={{ backgroundColor: checked ? '#0ea5e9' : '#cbd5e1' }}>
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out",
            checked ? "translate-x-6" : "translate-x-1"
          )}
        />
      </div>
    </label>
  );
}

function SectionCard({ title, subtitle, children, headerAction, className }: { title: string; subtitle?: string; children: React.ReactNode; headerAction?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-[24px] bg-white shadow-sm ring-1 ring-slate-200/60", className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 py-5">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {headerAction}
      </div>
      <div className="custom-scrollbar flex-1 overflow-y-auto px-6 py-6">
        {children}
      </div>
    </section>
  );
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function emptyNodeState(): NodeState {
  return {
    id: createId("wf-node"),
    label: "",
    goal: "",
    expectedOutcome: "",
    executionMode: "inherit",
    permissionProfile: "inherit",
    reuseSession: true,
    successNodeId: "",
    failNodeId: "",
  };
}

export function AutomationWorkflowEditorPage() {
  const navigate = useNavigate();
  const { workflowId } = useParams();
  const workspaces = useStore((state) => state.workspaces);
  const appState = useStore((state) => state.appState);
  const [workspaceId, setWorkspaceId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cronExpression, setCronExpression] = useState("");
  const [contextStrategy, setContextStrategy] =
    useState<AutomationWorkflowContextStrategy>("resume-per-cli");
  const [defaultExecutionMode, setDefaultExecutionMode] =
    useState<AutomationExecutionMode>("auto");
  const [defaultPermissionProfile, setDefaultPermissionProfile] =
    useState<AutomationPermissionProfile>("standard");
  const [emailNotificationEnabled, setEmailNotificationEnabled] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [nodes, setNodes] = useState<NodeState[]>([emptyNodeState()]);
  const [busy, setBusy] = useState<"save" | "save-run" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const workspaceOptions = useMemo(() => {
    if (workspaces.length > 0) return workspaces;
    if (!appState) return [];
    return [
      {
        id: appState.workspace.projectRoot,
        name: appState.workspace.projectName,
        rootPath: appState.workspace.projectRoot,
      },
    ];
  }, [appState, workspaces]);

  const selectedWorkspace = useMemo(
    () => workspaceOptions.find((item) => item.id === workspaceId) ?? workspaceOptions[0] ?? null,
    [workspaceId, workspaceOptions]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const workflow = workflowId
          ? await bridge.getAutomationWorkflow(workflowId)
          : null;
        if (cancelled) return;
        if (workflow) {
          setWorkspaceId(workflow.workspaceId);
          setName(workflow.name);
          setDescription(workflow.description ?? "");
          setCronExpression(workflow.cronExpression ?? "");
          setContextStrategy(workflow.defaultContextStrategy);
          setDefaultExecutionMode(workflow.defaultExecutionMode);
          setDefaultPermissionProfile(workflow.defaultPermissionProfile);
          setEmailNotificationEnabled(workflow.emailNotificationEnabled);
          setEnabled(workflow.enabled);
          const nextNodes = workflow.nodes.map((node) => {
            const successNodeId =
              workflow.edges.find(
                (edge) => edge.fromNodeId === node.id && edge.on === "success"
              )?.toNodeId ?? "";
            const failNodeId =
              workflow.edges.find(
                (edge) => edge.fromNodeId === node.id && edge.on === "fail"
              )?.toNodeId ?? "";
            return {
              id: node.id,
              label: node.label,
              goal: node.goal,
              expectedOutcome: node.expectedOutcome,
              executionMode: node.executionMode,
              permissionProfile: node.permissionProfile,
              reuseSession: node.reuseSession,
              successNodeId,
              failNodeId,
            };
          });
          setNodes(nextNodes.length > 0 ? nextNodes : [emptyNodeState()]);
        } else {
          setWorkspaceId(workspaceOptions[0]?.id ?? "");
        }
        setError(null);
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "加载工作流失败。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workflowId, workspaceOptions]);

  function updateNode(nodeId: string, updater: (node: NodeState) => NodeState) {
    setNodes((current) => current.map((node) => (node.id === nodeId ? updater(node) : node)));
  }

  async function save(runAfterSave: boolean) {
    if (!selectedWorkspace) {
      setError("请选择工作区。");
      return;
    }
    if (!name.trim()) {
      setError("请填写工作流名称。");
      return;
    }
    if (nodes.length === 0 || nodes.some((node) => !node.goal.trim())) {
      setError("每个节点都必须填写任务目标。");
      return;
    }
    if (nodes.some((node) => !node.expectedOutcome.trim())) {
      setError("每个节点都必须填写预期交付结果。");
      return;
    }

    const payload: AutomationWorkflowDraft = {
      workspaceId: selectedWorkspace.id,
      projectRoot: selectedWorkspace.rootPath,
      projectName: selectedWorkspace.name,
      name: name.trim(),
      description: description.trim() || null,
      cronExpression: cronExpression.trim() || null,
      emailNotificationEnabled,
      enabled,
      entryNodeId: nodes[0]?.id ?? null,
      defaultContextStrategy: contextStrategy,
      defaultExecutionMode,
      defaultPermissionProfile,
      nodes: nodes.map<AutomationWorkflowNodeDraft>((node) => ({
        id: node.id,
        label: node.label.trim() || null,
        goal: node.goal.trim(),
        expectedOutcome: node.expectedOutcome.trim(),
        executionMode: node.executionMode,
        permissionProfile: node.permissionProfile,
        reuseSession: node.reuseSession,
      })),
      edges: nodes.flatMap((node) => {
        const edges: AutomationWorkflowDraft["edges"] = [];
        if (node.successNodeId) {
          edges.push({ fromNodeId: node.id, on: "success", toNodeId: node.successNodeId });
        }
        if (node.failNodeId) {
          edges.push({ fromNodeId: node.id, on: "fail", toNodeId: node.failNodeId });
        }
        return edges;
      }),
    };

    setBusy(runAfterSave ? "save-run" : "save");
    try {
      const saved = workflowId
        ? await bridge.updateAutomationWorkflow(workflowId, payload)
        : await bridge.createAutomationWorkflow(payload);
      if (runAfterSave) {
        const run = await bridge.createAutomationWorkflowRun({ workflowId: saved.id });
        navigate("/automation/workflows", {
          state: { selectedWorkflowId: saved.id, selectedWorkflowRunId: run.id },
        });
      } else {
        navigate("/automation/workflows", { state: { selectedWorkflowId: saved.id } });
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存工作流失败。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="h-[calc(100vh-48px)] min-h-0 overflow-hidden bg-slate-50/50 px-4 py-6 sm:px-6">
      <div className="mx-auto flex h-full max-w-[90rem] flex-col gap-6">
        
        {/* Header Section */}
        <header className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <button 
              type="button" 
              onClick={() => navigate("/automation/workflows")} 
              className="group inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-900"
            >
              <BackIcon className="h-4 w-4 stroke-current stroke-[1.5] transition-transform group-hover:-translate-x-0.5" />
              返回工作流中心
            </button>
            <div className="flex items-center gap-3 pt-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {workflowId ? "编辑工作流配置" : "新建工作流"}
              </h1>
              {workflowId && <span className="rounded-full bg-slate-200/50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 ring-1 ring-slate-300/50">ID: {workflowId.slice(0, 8)}</span>}
            </div>
            <p className="text-sm text-slate-500">
              为每个节点直接定义任务目标与预期交付结果，并配置 success/fail 路由。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save(false)}
              disabled={busy !== null}
              className={`${HEADER_ICON_BUTTON_CLASS} border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50`}
              title="保存当前工作流配置"
              aria-label="保存配置"
            >
              <SaveIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void save(true)}
              disabled={busy !== null}
              className={`${HEADER_ICON_BUTTON_CLASS} bg-sky-500 text-white hover:bg-sky-600`}
              title="保存当前工作流并立即启动一次运行"
              aria-label="保存并运行"
            >
              <PlayIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        {error ? (
          <div className="flex shrink-0 items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700 shadow-sm">
            <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-5 w-5 shrink-0 text-rose-500">
              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-5a1.25 1.25 0 100 2.5A1.25 1.25 0 0010 4z" fill="currentColor" />
            </svg>
            <div>
              <div className="font-bold">保存失败</div>
              <div className="mt-1 opacity-90">{error}</div>
            </div>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[400px_1fr] xl:grid-cols-[440px_1fr]">
          
          {/* Left Column: Basic Info */}
          <SectionCard title="工作流定义" subtitle="配置基础信息、统一执行策略和任务交接方式">
            <div className="grid gap-6">
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">工作流名称 <span className="text-rose-500">*</span></label>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：夜间自动化构建与部署" className={INPUT_CLASS} />
              </div>
              
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">目标工作区 <span className="text-rose-500">*</span></label>
                <div className="relative">
                  <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className={cn(INPUT_CLASS, "appearance-none pr-10")}>
                    {workspaceOptions.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 stroke-current stroke-[1.5]">
                      <path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">简短说明</label>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="描述这个工作流的主要用途（可选）" className={TEXTAREA_CLASS} />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Cron 表达式</label>
                <input value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} className={cn(INPUT_CLASS, "font-mono")} placeholder="0 0/30 * * * *" />
                <p className="ml-1 mt-1 text-[11px] text-slate-500">留空表示仅支持手动触发</p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">任务交接方式</label>
                <div className="relative">
                  <select value={contextStrategy} onChange={(event) => setContextStrategy(event.target.value as AutomationWorkflowContextStrategy)} className={cn(INPUT_CLASS, "appearance-none pr-10")}>
                    {workflowContextStrategyOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 stroke-current stroke-[1.5]">
                      <path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
                <p className="ml-1 mt-1 text-[11px] font-medium text-slate-500">{workflowContextStrategyLabel(contextStrategy)}</p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">统一执行模式</label>
                <div className="relative">
                  <select value={defaultExecutionMode} onChange={(event) => setDefaultExecutionMode(event.target.value as AutomationExecutionMode)} className={cn(INPUT_CLASS, "appearance-none pr-10")}>
                    <option value="auto">自动模式</option>
                    <option value="codex">Codex</option>
                    <option value="claude">Claude</option>
                    <option value="gemini">Gemini</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 stroke-current stroke-[1.5]">
                      <path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">统一权限策略</label>
                <div className="relative">
                  <select value={defaultPermissionProfile} onChange={(event) => setDefaultPermissionProfile(event.target.value as AutomationPermissionProfile)} className={cn(INPUT_CLASS, "appearance-none pr-10")}>
                    <option value="standard">standard</option>
                    <option value="full-access">full access</option>
                    <option value="read-only">read-only</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 stroke-current stroke-[1.5]">
                      <path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 border-t border-slate-100 pt-6">
                <ToggleField checked={enabled} onChange={setEnabled} label="启用工作流" />
                <ToggleField checked={emailNotificationEnabled} onChange={setEmailNotificationEnabled} label="完成后发送邮件通知" />
              </div>

            </div>
          </SectionCard>

          {/* Right Column: Node Orchestration */}
          <SectionCard 
            title="节点编排图" 
            subtitle="添加任务节点，构建执行顺序与条件分支"
            headerAction={
              <button
                type="button"
                onClick={() => setNodes((current) => [...current, emptyNodeState()])}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm transition hover:bg-slate-800 active:scale-95"
                title="向编排图追加一个新节点"
                aria-label="添加节点"
              >
                <PlusIcon className="h-4 w-4" />
              </button>
            }
          >
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
              </div>
            ) : (
              <div className="space-y-0 px-2 pt-2 pb-8">
                {nodes.map((node, index) => (
                  <div key={node.id} className="group relative flex gap-6 pb-8 last:pb-0">
                    
                    {/* Timeline Line */}
                    {index !== nodes.length - 1 && (
                      <div className="absolute bottom-0 left-[19px] top-10 w-px bg-slate-200" />
                    )}
                    
                    {/* Timeline Step Indicator */}
                    <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[3px] border-white bg-slate-900 text-sm font-bold text-white shadow-sm ring-1 ring-slate-200/60">
                      {index + 1}
                    </div>

                    {/* Node Card */}
                    <div className="flex-1 rounded-[24px] bg-white p-6 shadow-sm ring-1 ring-slate-200/80 transition-all hover:shadow-md hover:ring-slate-300">
                      
                      {/* Node Header */}
                      <div className="mb-6 flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <input 
                            value={node.label} 
                            onChange={(event) => updateNode(node.id, (current) => ({ ...current, label: event.target.value }))} 
                            placeholder="输入节点标题..." 
                            className="block w-full bg-transparent p-0 text-xl font-bold tracking-tight text-slate-900 placeholder:text-slate-300 outline-none focus:ring-0 border-0" 
                          />
                          <div className="mt-1.5 text-xs font-medium text-slate-500">{index === 0 ? "入口节点 (触发时首先执行)" : "后续流转节点"}</div>
                        </div>
                        {nodes.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setNodes((current) => current.filter((item) => item.id !== node.id))}
                            className={cn(
                              iconButtonClass,
                              "h-9 w-9 shrink-0 border-transparent bg-transparent text-slate-400 shadow-none hover:bg-rose-50 hover:text-rose-500"
                            )}
                            title="从当前工作流中移除这个节点"
                            aria-label="删除节点"
                          >
                            <TrashIcon className="h-5 w-5" />
                          </button>
                        )}
                      </div>

                      <div className="grid gap-6 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">任务目标 <span className="text-rose-500">*</span></label>
                          <textarea
                            value={node.goal}
                            onChange={(event) => updateNode(node.id, (current) => ({ ...current, goal: event.target.value }))}
                            className={TEXTAREA_CLASS}
                            placeholder="描述这个节点需要完成的任务目标"
                          />
                        </div>

                        <div className="space-y-2 sm:col-span-2">
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">预期交付结果 <span className="text-rose-500">*</span></label>
                          <textarea
                            value={node.expectedOutcome}
                            onChange={(event) => updateNode(node.id, (current) => ({ ...current, expectedOutcome: event.target.value }))}
                            className={TEXTAREA_CLASS}
                            placeholder="明确描述本节点执行完成后应交付什么结果"
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">执行模式</label>
                          <div className="relative">
                            <select value={node.executionMode} onChange={(event) => updateNode(node.id, (current) => ({ ...current, executionMode: (event.target.value as AutomationExecutionMode | "inherit") ?? "inherit" }))} className={cn(INPUT_CLASS, "appearance-none pr-10")}>
                              <option value="inherit">继承工作流</option>
                              <option value="codex">Codex</option>
                              <option value="claude">Claude</option>
                              <option value="gemini">Gemini</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                              <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 stroke-current stroke-[1.5]"><path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">权限策略</label>
                          <div className="relative">
                            <select value={node.permissionProfile} onChange={(event) => updateNode(node.id, (current) => ({ ...current, permissionProfile: (event.target.value as AutomationPermissionProfile | "inherit") ?? "inherit" }))} className={cn(INPUT_CLASS, "appearance-none pr-10")}>
                              <option value="inherit">继承工作流</option>
                              <option value="standard">standard</option>
                              <option value="full-access">full access</option>
                              <option value="read-only">read-only</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                              <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 stroke-current stroke-[1.5]"><path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </div>
                          </div>
                        </div>

                        <div className="sm:col-span-2 pt-2">
                          <ToggleField checked={node.reuseSession} onChange={(checked) => updateNode(node.id, (current) => ({ ...current, reuseSession: checked }))} label="同 CLI 复用原生 Session" />
                        </div>
                      </div>

                      {/* Routing */}
                      <div className="mt-8 rounded-[20px] bg-slate-50/80 p-5 ring-1 ring-slate-200/50">
                        <div className="mb-5 flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/50 text-slate-500">
                            <ArrowIcon className="h-4 w-4" />
                          </div>
                          <span className="text-sm font-bold tracking-tight text-slate-900">执行结果路由</span>
                        </div>
                        
                        <div className="grid gap-5 sm:grid-cols-2">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                              <CheckIcon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 relative">
                              <select value={node.successNodeId} onChange={(event) => updateNode(node.id, (current) => ({ ...current, successNodeId: event.target.value }))} className={cn(INPUT_CLASS, "appearance-none pr-10 bg-white")}>
                                <option value="">(结束工作流)</option>
                                {nodes.filter((item) => item.id !== node.id).map((item) => (
                                  <option key={item.id} value={item.id}>{item.label || `节点 ${nodes.findIndex((entry) => entry.id === item.id) + 1}`}</option>
                                ))}
                              </select>
                              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                                <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 stroke-current stroke-[1.5]"><path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-500">
                              <CrossIcon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 relative">
                              <select value={node.failNodeId} onChange={(event) => updateNode(node.id, (current) => ({ ...current, failNodeId: event.target.value }))} className={cn(INPUT_CLASS, "appearance-none pr-10 bg-white")}>
                                <option value="">(结束工作流)</option>
                                {nodes.filter((item) => item.id !== node.id).map((item) => (
                                  <option key={item.id} value={item.id}>{item.label || `节点 ${nodes.findIndex((entry) => entry.id === item.id) + 1}`}</option>
                                ))}
                              </select>
                              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                                <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 stroke-current stroke-[1.5]"><path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
