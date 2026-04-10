import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  useNodesState,
} from "@xyflow/react";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { bridge } from "../lib/bridge";
import type {
  AutomationExecutionMode,
  AutomationPermissionProfile,
  AutomationWorkflowContextStrategy,
  AutomationWorkflowDraft,
  AutomationWorkflowEdgeDraft,
  AutomationWorkflowNodeDraft,
  AutomationWorkflowNodeLayout,
} from "../lib/models";
import { useStore } from "../lib/store";
import {
  applyWorkflowBranchConnection,
  hasWorkflowPath,
  validateWorkflowGraph,
  type WorkflowBranch,
} from "./automationWorkflowGraph";
import {
  cn,
  executionModeLabel,
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
  layout: AutomationWorkflowNodeLayout;
};

type WorkflowCanvasNodeData = {
  index: number;
  label: string;
  goal: string;
  isEntry: boolean;
  executionModeLabel: string;
  permissionLabel: string;
  connectionSummary: string;
};

type WorkflowCanvasNode = Node<WorkflowCanvasNodeData, "workflowNode">;
type WorkflowCanvasEdge = Edge<{ branch: "success" | "fail" }>;

const NODE_WIDTH = 248;
const NODE_HEIGHT = 156;
const NODE_STYLE = { width: NODE_WIDTH, height: NODE_HEIGHT };

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

const CloseIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M16.5 7.5l-9 9m0-9l9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const EntryIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M12 4l2.35 4.76 5.25.77-3.8 3.7.9 5.23L12 16l-4.7 2.46.9-5.23-3.8-3.7 5.25-.77L12 4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const SparkIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15zM6 15l.9 2.1L9 18l-2.1.9L6 21l-.9-2.1L3 18l2.1-.9L6 15z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FlowHintIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M5 12h6m0 0l-3-3m3 3l-3 3M13 6h6M13 18h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const NodeSettingsIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PanelToggleIcon = ({ className, collapsed }: { className?: string; collapsed: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d={collapsed ? "M10 8l3 4-3 4" : "M14 8l-3 4 3 4"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SelectChevronIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" className={className}>
    <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const INPUT_CLASS =
  "w-full rounded-[10px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10";
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[112px] resize-none leading-relaxed`;
const SELECT_CLASS = `${INPUT_CLASS} appearance-none pr-12`;
const GLOBAL_INPUT_CLASS =
  "w-full rounded-[10px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10";
const GLOBAL_TEXTAREA_CLASS = `${GLOBAL_INPUT_CLASS} min-h-[112px] resize-none leading-relaxed`;
const GLOBAL_SELECT_CLASS = `${GLOBAL_INPUT_CLASS} appearance-none pr-12`;
const HEADER_ICON_BUTTON_CLASS =
  "inline-flex h-[44px] w-[44px] items-center justify-center rounded-2xl shadow-sm transition disabled:opacity-50 active:scale-95";
const CANVAS_BUTTON_CLASS =
  "inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50";

const WorkflowCanvasContext = createContext<{
  openNodeDrawer: (nodeId: string) => void;
} | null>(null);

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function defaultNodeLayout(index: number): AutomationWorkflowNodeLayout {
  return {
    x: 120 + (index % 3) * 360,
    y: 120 + Math.floor(index / 3) * 240,
  };
}

function createEmptyNode(index: number): NodeState {
  return {
    id: createId("wf-node"),
    label: `节点 ${index + 1}`,
    goal: "",
    expectedOutcome: "",
    executionMode: "inherit",
    permissionProfile: "inherit",
    reuseSession: true,
    successNodeId: "",
    failNodeId: "",
    layout: defaultNodeLayout(index),
  };
}

function permissionProfileLabel(value: AutomationPermissionProfile | "inherit") {
  switch (value) {
    case "full-access":
      return "full access";
    case "read-only":
      return "read-only";
    case "inherit":
      return "继承工作流";
    default:
      return "standard";
  }
}

function workflowNodeExecutionModeLabel(
  value: AutomationExecutionMode | "inherit",
  inherited: AutomationExecutionMode
) {
  return value === "inherit" ? `继承 · ${executionModeLabel(inherited)}` : executionModeLabel(value);
}

function workflowNodePermissionLabel(
  value: AutomationPermissionProfile | "inherit",
  inherited: AutomationPermissionProfile
) {
  return value === "inherit" ? `继承 · ${permissionProfileLabel(inherited)}` : permissionProfileLabel(value);
}

function removeNodeAndReferences(nodes: NodeState[], removedId: string) {
  return nodes
    .filter((node) => node.id !== removedId)
    .map((node) => ({
      ...node,
      successNodeId: node.successNodeId === removedId ? "" : node.successNodeId,
      failNodeId: node.failNodeId === removedId ? "" : node.failNodeId,
    }));
}

function autoArrangeNodes(nodes: NodeState[], entryNodeId: string | null): NodeState[] {
  if (nodes.length === 0) return nodes;

  const fallbackEntryId = entryNodeId && nodes.some((node) => node.id === entryNodeId)
    ? entryNodeId
    : nodes[0].id;
  const levelMap = new Map<string, number>();
  const rowMap = new Map<string, number>();
  const queue: Array<{ id: string; level: number }> = [{ id: fallbackEntryId, level: 0 }];
  const seen = new Set<string>();
  const levelCounters = new Map<number, number>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    levelMap.set(current.id, current.level);
    const row = levelCounters.get(current.level) ?? 0;
    rowMap.set(current.id, row);
    levelCounters.set(current.level, row + 1);

    const node = nodes.find((item) => item.id === current.id);
    if (!node) continue;
    for (const nextId of [node.successNodeId, node.failNodeId].filter(Boolean)) {
      if (!seen.has(nextId)) {
        queue.push({ id: nextId, level: current.level + 1 });
      }
    }
  }

  let orphanLevel = Math.max(0, ...levelMap.values()) + 1;
  let orphanRow = 0;

  return nodes.map((node) => {
    const level = levelMap.get(node.id);
    const row = rowMap.get(node.id);
    if (level === undefined || row === undefined) {
      const next = {
        ...node,
        layout: {
          x: 120 + orphanLevel * 300,
          y: 120 + orphanRow * 180,
        },
      };
      orphanRow += 1;
      if (orphanRow >= 3) {
        orphanRow = 0;
        orphanLevel += 1;
      }
      return next;
    }
    return {
      ...node,
      layout: {
        x: 120 + level * 300,
        y: 120 + row * 180,
      },
    };
  });
}

const WorkflowCanvasNodeComponent = memo(function WorkflowCanvasNodeComponent({
  id,
  data,
  selected,
}: NodeProps<WorkflowCanvasNode>) {
  const canvasContext = useContext(WorkflowCanvasContext);

  return (
    <div
      style={NODE_STYLE}
      className={cn(
        "relative overflow-hidden rounded-[14px] border bg-white shadow-[0_14px_36px_rgba(15,23,42,0.10)] transition-colors [will-change:transform]",
        selected ? "border-sky-400 ring-4 ring-sky-500/10" : "border-slate-200 hover:border-slate-300"
      )}
    >
      <Handle id="target" type="target" position={Position.Left} className="!h-3.5 !w-3.5 !border-2 !border-white !bg-slate-700" style={{ left: -7, top: "50%" }} />
      <Handle id="success" type="source" position={Position.Right} className="!h-3.5 !w-3.5 !border-2 !border-white !bg-emerald-500" style={{ right: -7, top: "36%" }} />
      <Handle id="fail" type="source" position={Position.Right} className="!h-3.5 !w-3.5 !border-2 !border-white !bg-rose-500" style={{ right: -7, top: "66%" }} />

      <div className="border-b border-slate-100 bg-[linear-gradient(135deg,#f8fbff,white)] px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-950 text-[11px] font-semibold text-white shadow-sm">
              {data.index + 1}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold tracking-tight text-slate-950">{data.label}</div>
              <div className="mt-1 text-[10px] font-medium text-slate-500">
                {data.connectionSummary}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.isEntry ? (
              <div className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                <EntryIcon className="h-3 w-3" />
                Entry
              </div>
            ) : null}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                canvasContext?.openNodeDrawer(id);
              }}
              onMouseDown={(event) => event.stopPropagation()}
              className="nodrag nopan inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-700"
              title="打开节点属性"
              aria-label="打开节点属性"
            >
              <NodeSettingsIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3.5">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">任务目标</div>
          <div className="mt-2 line-clamp-2 text-[13px] leading-6 text-slate-700">
            {data.goal.trim() || "点击右侧属性面板填写这个节点的任务目标。"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-600">{data.executionModeLabel}</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-600">{data.permissionLabel}</span>
        </div>
      </div>
    </div>
  );
});

const nodeTypes = {
  workflowNode: WorkflowCanvasNodeComponent,
};

function SectionCard({
  title,
  subtitle,
  children,
  headerAction,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-[8px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70", className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/60 px-6 py-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {headerAction}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">{children}</div>
    </section>
  );
}

function ToggleField({
  checked,
  label,
  onChange,
  className,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className={cn("group flex cursor-pointer items-center justify-between gap-4 rounded-[10px] border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300 hover:bg-slate-50", className)}>
      <span className="text-sm font-semibold tracking-tight text-slate-700">{label}</span>
      <div className="relative inline-flex h-6 w-11 items-center rounded-full transition" style={{ backgroundColor: checked ? "#0ea5e9" : "#cbd5e1" }}>
        <input type="checkbox" className="sr-only" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow-sm transition", checked ? "translate-x-6" : "translate-x-1")} />
      </div>
    </label>
  );
}

function AutomationWorkflowEditorContent() {
  const navigate = useNavigate();
  const { workflowId } = useParams();
  const workspaces = useStore((state) => state.workspaces);
  const appState = useStore((state) => state.appState);
  const [workspaceId, setWorkspaceId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cronExpression, setCronExpression] = useState("");
  const [contextStrategy, setContextStrategy] = useState<AutomationWorkflowContextStrategy>("resume-per-cli");
  const [defaultExecutionMode, setDefaultExecutionMode] = useState<AutomationExecutionMode>("auto");
  const [defaultPermissionProfile, setDefaultPermissionProfile] = useState<AutomationPermissionProfile>("standard");
  const [emailNotificationEnabled, setEmailNotificationEnabled] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [globalCollapsed, setGlobalCollapsed] = useState(false);
  const [entryNodeId, setEntryNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [drawerNodeId, setDrawerNodeId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<NodeState[]>([createEmptyNode(0)]);
  const [canvasNodes, setCanvasNodes, onCanvasNodesChange] = useNodesState<WorkflowCanvasNode>([]);
  const [busy, setBusy] = useState<"save" | "save-run" | null>(null);
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

  const drawerNode = nodes.find((node) => node.id === drawerNodeId) ?? null;

  const openNodeDrawer = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setDrawerNodeId(nodeId);
  }, []);
  const canvasContextValue = useMemo(() => ({ openNodeDrawer }), [openNodeDrawer]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const workflow = workflowId ? await bridge.getAutomationWorkflow(workflowId) : null;
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
          setEntryNodeId(workflow.entryNodeId);
          const loadedNodes = workflow.nodes.map((node, index) => {
            const successNodeId =
              workflow.edges.find((edge) => edge.fromNodeId === node.id && edge.on === "success")
                ?.toNodeId ?? "";
            const failNodeId =
              workflow.edges.find((edge) => edge.fromNodeId === node.id && edge.on === "fail")
                ?.toNodeId ?? "";
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
              layout: node.layout ?? defaultNodeLayout(index),
            };
          });
          setNodes(loadedNodes.length > 0 ? loadedNodes : [createEmptyNode(0)]);
          setSelectedNodeId(null);
          setDrawerNodeId(null);
        } else {
          setWorkspaceId(workspaceOptions[0]?.id ?? "");
          const initial = createEmptyNode(0);
          setNodes([initial]);
          setEntryNodeId(initial.id);
          setSelectedNodeId(null);
          setDrawerNodeId(null);
        }

        setError(null);
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "加载工作流失败。");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [workflowId, workspaceOptions]);

  useEffect(() => {
    if (nodes.length === 0) {
      const next = createEmptyNode(0);
      setNodes([next]);
      setEntryNodeId(next.id);
      setSelectedNodeId(null);
      setDrawerNodeId(null);
      return;
    }
    if (!entryNodeId || !nodes.some((node) => node.id === entryNodeId)) {
      setEntryNodeId(nodes[0].id);
    }
    if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
    if (drawerNodeId && !nodes.some((node) => node.id === drawerNodeId)) {
      setDrawerNodeId(null);
    }
  }, [nodes, entryNodeId, selectedNodeId, drawerNodeId]);

  useEffect(() => {
    setCanvasNodes(
      nodes.map((node, index) => ({
        id: node.id,
        type: "workflowNode" as const,
        position: node.layout,
        draggable: true,
        selected: node.id === selectedNodeId,
        data: {
          index,
          label: node.label,
          goal: node.goal,
          isEntry: node.id === entryNodeId,
          executionModeLabel: workflowNodeExecutionModeLabel(node.executionMode, defaultExecutionMode),
          permissionLabel: workflowNodePermissionLabel(node.permissionProfile, defaultPermissionProfile),
          connectionSummary: node.successNodeId || node.failNodeId ? "connected" : "unlinked",
        },
        style: NODE_STYLE,
      }))
    );
  }, [
    defaultExecutionMode,
    defaultPermissionProfile,
    entryNodeId,
    nodes,
    selectedNodeId,
    setCanvasNodes,
  ]);

  const flowEdges = useMemo<WorkflowCanvasEdge[]>(() => {
    const edges: WorkflowCanvasEdge[] = [];
    for (const node of nodes) {
      if (node.successNodeId) {
        edges.push({
          id: `${node.id}:success`,
          source: node.id,
          target: node.successNodeId,
          sourceHandle: "success",
          type: "smoothstep",
          data: { branch: "success" },
          style: { stroke: "#10b981", strokeWidth: 2.1 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#10b981" },
        });
      }
      if (node.failNodeId) {
        edges.push({
          id: `${node.id}:fail`,
          source: node.id,
          target: node.failNodeId,
          sourceHandle: "fail",
          type: "smoothstep",
          data: { branch: "fail" },
          style: { stroke: "#f43f5e", strokeWidth: 2.1 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#f43f5e" },
        });
      }
    }
    return edges;
  }, [nodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceId = connection.source;
      const targetId = connection.target;
      const branch =
        connection.sourceHandle === "success" || connection.sourceHandle === "fail"
          ? connection.sourceHandle
          : null;

      if (!sourceId || !targetId || !branch) return;
      if (sourceId === targetId) {
        setError("节点不能连接到自己。");
        return;
      }

      const candidateNodes = applyWorkflowBranchConnection(nodes, sourceId, branch, targetId);
      if (hasWorkflowPath(candidateNodes, targetId, sourceId)) {
        setError("首版工作流不支持环路，请改为无环路由。");
        return;
      }

      setError(null);
      setNodes(candidateNodes);
      setSelectedNodeId(sourceId);
    },
    [nodes]
  );

  function updateNode(nodeId: string, updater: (node: NodeState) => NodeState) {
    setNodes((current) => current.map((node) => (node.id === nodeId ? updater(node) : node)));
  }

  function updateBranchRoute(nodeId: string, branch: WorkflowBranch, targetId: string) {
    const candidateNodes = applyWorkflowBranchConnection(nodes, nodeId, branch, targetId);
    if (!targetId) {
      setError(null);
      setNodes(candidateNodes);
      return;
    }
    if (targetId === nodeId || hasWorkflowPath(candidateNodes, targetId, nodeId)) {
      setError("首版工作流不支持环路，请改为无环路由。");
      return;
    }
    setError(null);
    setNodes(candidateNodes);
  }

  function addNode() {
    const nextNode = createEmptyNode(nodes.length);
    setNodes((current) => [...current, nextNode]);
    setSelectedNodeId(nextNode.id);
    setDrawerNodeId(null);
    if (!entryNodeId) {
      setEntryNodeId(nextNode.id);
    }
  }

  function deleteNode(nodeId: string) {
    if (nodes.length <= 1) return;
    const nextNodes = removeNodeAndReferences(nodes, nodeId);
    setNodes(nextNodes);
    if (entryNodeId === nodeId) {
      setEntryNodeId(nextNodes[0]?.id ?? null);
    }
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(nextNodes[0]?.id ?? null);
    }
    if (drawerNodeId === nodeId) {
      setDrawerNodeId(null);
    }
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
    if (nodes.some((node) => !node.goal.trim())) {
      setError("每个节点都必须填写任务目标。");
      return;
    }
    if (nodes.some((node) => !node.expectedOutcome.trim())) {
      setError("每个节点都必须填写预期交付结果。");
      return;
    }
    if (!entryNodeId || !nodes.some((node) => node.id === entryNodeId)) {
      setError("请设置一个入口节点。");
      return;
    }
    const graphError = validateWorkflowGraph(nodes, entryNodeId);
    if (graphError) {
      setError(graphError);
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
      entryNodeId,
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
        layout: node.layout,
      })),
      edges: nodes.flatMap<AutomationWorkflowEdgeDraft>((node) => {
        const edges: AutomationWorkflowEdgeDraft[] = [];
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
    <div className="h-[calc(100vh-48px)] min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.08),transparent_26%),linear-gradient(180deg,#f8fafc_0%,#f3f6fb_100%)] px-4 py-6 sm:px-6">
      <div className="mx-auto flex h-full max-w-[1680px] flex-col gap-5">
        <header className="flex shrink-0 flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => navigate("/automation/workflows")}
                className={`${HEADER_ICON_BUTTON_CLASS} group h-10 w-10 rounded-xl border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900`}
                title="返回工作流中心"
                aria-label="返回工作流中心"
              >
                <BackIcon className="h-4 w-4 stroke-current stroke-[1.5] transition group-hover:-translate-x-0.5" />
              </button>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                {workflowId ? "编辑工作流画布" : "新建工作流"}
              </h1>
              {workflowId ? (
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500 ring-1 ring-slate-200">
                  {workflowId.slice(0, 8)}
                </span>
              ) : null}
            </div>
            <p className="max-w-[720px] text-sm leading-6 text-slate-500">
              拖拽节点排版，直接连出 success / fail 两条路由。
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void save(false)} disabled={busy !== null} className={`${HEADER_ICON_BUTTON_CLASS} border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50`} title="保存当前工作流配置" aria-label="保存配置">
              <SaveIcon className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => void save(true)} disabled={busy !== null} className={`${HEADER_ICON_BUTTON_CLASS} bg-slate-950 text-white hover:bg-slate-900`} title="保存当前工作流并立即启动一次运行" aria-label="保存并运行">
              <PlayIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        {error ? (
          <div className="flex shrink-0 items-start gap-3 rounded-[22px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-medium text-rose-700 shadow-sm">
            <SparkIcon className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
            <div>{error}</div>
          </div>
        ) : null}

        <div className={cn("grid min-h-0 flex-1 gap-5", globalCollapsed ? "xl:grid-cols-[minmax(0,1fr)]" : "xl:grid-cols-[320px_minmax(0,1fr)]")}>
          {!globalCollapsed ? (
          <SectionCard
            title="全局定义"
            subtitle=""
            headerAction={
              <button
                type="button"
                onClick={() => setGlobalCollapsed(true)}
                className={CANVAS_BUTTON_CLASS}
                title="折叠全局定义"
                aria-label="折叠全局定义"
              >
                <PanelToggleIcon className="h-4 w-4" collapsed={false} />
              </button>
            }
          >
            <div className="grid gap-5">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">工作流名称</label>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：回归修复与交付验收" className={GLOBAL_INPUT_CLASS} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">工作区</label>
                <div className="relative">
                  <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className={GLOBAL_SELECT_CLASS}>
                    {workspaceOptions.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                    <SelectChevronIcon className="h-4 w-4" />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">简短说明</label>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明这个工作流解决什么问题。" className={GLOBAL_TEXTAREA_CLASS} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cron 表达式</label>
                <input value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} className={cn(GLOBAL_INPUT_CLASS, "font-mono")} placeholder="0 0/30 * * * *" />
                <p className="text-[11px] text-slate-500">留空表示仅支持手动触发。</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">任务交接方式</label>
                <div className="relative">
                  <select value={contextStrategy} onChange={(event) => setContextStrategy(event.target.value as AutomationWorkflowContextStrategy)} className={GLOBAL_SELECT_CLASS}>
                    {workflowContextStrategyOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                    <SelectChevronIcon className="h-4 w-4" />
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">{workflowContextStrategyLabel(contextStrategy)}</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">统一执行模式</label>
                <div className="relative">
                  <select value={defaultExecutionMode} onChange={(event) => setDefaultExecutionMode(event.target.value as AutomationExecutionMode)} className={GLOBAL_SELECT_CLASS}>
                    <option value="auto">自动模式</option>
                    <option value="codex">Codex</option>
                    <option value="claude">Claude</option>
                    <option value="gemini">Gemini</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                    <SelectChevronIcon className="h-4 w-4" />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">统一权限策略</label>
                <div className="relative">
                  <select value={defaultPermissionProfile} onChange={(event) => setDefaultPermissionProfile(event.target.value as AutomationPermissionProfile)} className={GLOBAL_SELECT_CLASS}>
                    <option value="standard">standard</option>
                    <option value="full-access">full access</option>
                    <option value="read-only">read-only</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                    <SelectChevronIcon className="h-4 w-4" />
                  </div>
                </div>
              </div>
              <div className="grid gap-3 border-t border-slate-100 pt-5">
                <ToggleField checked={enabled} onChange={setEnabled} label="启用工作流" className="rounded-[10px]" />
                <ToggleField checked={emailNotificationEnabled} onChange={setEmailNotificationEnabled} label="完成后发送邮件通知" className="rounded-[10px]" />
              </div>
            </div>
          </SectionCard>
          ) : null}

          <section className="relative flex min-h-0 flex-col overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/60 px-6 py-5">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-900">Workflow Canvas</h2>
                <p className="mt-1 text-xs text-slate-500">绿色连接 success，红色连接 fail。拖拽节点排版，点击节点后从右侧抽屉编辑属性。</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNodes((current) => autoArrangeNodes(current, entryNodeId))}
                  className={CANVAS_BUTTON_CLASS}
                  title="自动整理布局"
                  aria-label="自动整理布局"
                >
                  <FlowHintIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => selectedNodeId && deleteNode(selectedNodeId)}
                  disabled={!selectedNodeId || nodes.length <= 1}
                  className={CANVAS_BUTTON_CLASS}
                  title="删除当前选中节点"
                  aria-label="删除当前选中节点"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setGlobalCollapsed((current) => !current)}
                  className={CANVAS_BUTTON_CLASS}
                  title={globalCollapsed ? "展开全局定义" : "折叠全局定义"}
                  aria-label={globalCollapsed ? "展开全局定义" : "折叠全局定义"}
                >
                  <PanelToggleIcon className="h-4 w-4" collapsed={globalCollapsed} />
                </button>
                <button type="button" onClick={addNode} className={CANVAS_BUTTON_CLASS} title="添加节点" aria-label="添加节点">
                  <PlusIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.12),transparent_24%),linear-gradient(180deg,#f8fbff_0%,#eef4fb_100%)]">
              <div className="pointer-events-none absolute left-5 top-5 z-20 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-[11px] font-medium text-slate-600 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-slate-800">
                  <FlowHintIcon className="h-4 w-4 text-sky-500" />
                  拖出连接线即可设置路由
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />success</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />fail</span>
                </div>
              </div>

              <WorkflowCanvasContext.Provider value={canvasContextValue}>
                <ReactFlow
                  nodes={canvasNodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  onNodesChange={onCanvasNodesChange}
                  onConnect={onConnect}
                  onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                  onNodeDragStop={(_, node) =>
                    setNodes((current) =>
                      current.map((entry) =>
                        entry.id === node.id
                          ? {
                              ...entry,
                              layout: { x: node.position.x, y: node.position.y },
                            }
                          : entry
                      )
                    )
                  }
                  onPaneClick={() => {
                    setSelectedNodeId(null);
                    setDrawerNodeId(null);
                  }}
                  fitView
                  fitViewOptions={{ padding: 0.18 }}
                  minZoom={0.55}
                  maxZoom={1.35}
                  className="bg-transparent"
                >
                  <Background gap={24} size={1.2} color="#d7e3f1" variant={BackgroundVariant.Dots} />
                  <Controls className="!bottom-5 !left-5 !top-auto !rounded-2xl !border !border-slate-200 !bg-white/90 !shadow-sm" showInteractive={false} />
                </ReactFlow>
              </WorkflowCanvasContext.Provider>

              {drawerNode ? (
                <button
                  type="button"
                  onClick={() => setDrawerNodeId(null)}
                  className="absolute inset-0 z-20 bg-slate-950/8 backdrop-blur-[1.5px] transition"
                  aria-label="关闭节点属性抽屉"
                />
              ) : null}

              <div
                className={cn(
                  "absolute inset-y-5 right-5 z-30 w-[360px] transition-all duration-200 ease-out",
                  drawerNode
                    ? "translate-x-0 opacity-100"
                    : "pointer-events-none translate-x-8 opacity-0"
                )}
              >
                <div className="flex h-full flex-col overflow-hidden rounded-[12px] border border-slate-200 bg-white/96 shadow-[0_30px_90px_rgba(15,23,42,0.18)] backdrop-blur">
                  <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-900">节点属性</h3>
                      {/* <p className="mt-1 text-xs text-slate-500">
                        {drawerNode ? "修改当前节点的目标、交付结果和路由。" : "点击节点后在这里编辑。"}
                      </p> */}
                    </div>
                    <div className="flex items-center gap-2">
                      {drawerNode ? (
                        <>
                          <button type="button" onClick={() => setEntryNodeId(drawerNode.id)} className={CANVAS_BUTTON_CLASS} title="设为入口节点" aria-label="设为入口节点">
                            <EntryIcon className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => deleteNode(drawerNode.id)} disabled={nodes.length <= 1} className={CANVAS_BUTTON_CLASS} title="删除当前节点" aria-label="删除当前节点">
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </>
                      ) : null}
                      <button type="button" onClick={() => setDrawerNodeId(null)} className={CANVAS_BUTTON_CLASS} title="关闭节点抽屉" aria-label="关闭节点抽屉">
                        <CloseIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                    {!drawerNode ? (
                      <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50/50 px-6 text-center text-sm text-slate-500">
                        <SparkIcon className="mb-3 h-6 w-6 text-slate-300" />
                        点击画布里的节点后，这里会显示它的详细配置和当前 success / fail 路由。
                      </div>
                    ) : (
                      <div className="grid gap-5">
                        <div className="flex items-center justify-between rounded-[10px] border border-slate-200 bg-slate-50 px-4 py-3">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">当前节点</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{drawerNode.label}</div>
                          </div>
                          {drawerNode.id === entryNodeId ? <span className="rounded-full bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700">入口节点</span> : null}
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">节点标题</label>
                          <input value={drawerNode.label} onChange={(event) => updateNode(drawerNode.id, (current) => ({ ...current, label: event.target.value }))} className={INPUT_CLASS} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">任务目标</label>
                          <textarea value={drawerNode.goal} onChange={(event) => updateNode(drawerNode.id, (current) => ({ ...current, goal: event.target.value }))} className={TEXTAREA_CLASS} placeholder="描述这个节点需要完成的目标。" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">预期交付结果</label>
                          <textarea value={drawerNode.expectedOutcome} onChange={(event) => updateNode(drawerNode.id, (current) => ({ ...current, expectedOutcome: event.target.value }))} className={TEXTAREA_CLASS} placeholder="明确写出通过验收时应该交付什么结果。" />
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-xs font-bold tracking-tight text-slate-700">执行模式</label>
                            <div className="relative">
                              <select value={drawerNode.executionMode} onChange={(event) => updateNode(drawerNode.id, (current) => ({ ...current, executionMode: event.target.value as AutomationExecutionMode | "inherit" }))} className={cn(INPUT_CLASS, "appearance-none pr-8 text-[13px]")}>
                                <option value="inherit">继承配置</option>
                                <option value="codex">Codex (编写代码)</option>
                                <option value="claude">Claude (分析推理)</option>
                                <option value="gemini">Gemini (视觉相关)</option>
                              </select>
                              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400">
                                <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 stroke-current stroke-[1.5]"><path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold tracking-tight text-slate-700">权限策略</label>
                            <div className="relative">
                              <select value={drawerNode.permissionProfile} onChange={(event) => updateNode(drawerNode.id, (current) => ({ ...current, permissionProfile: event.target.value as AutomationPermissionProfile | "inherit" }))} className={cn(INPUT_CLASS, "appearance-none pr-8 text-[13px]")}>
                                <option value="inherit">继承配置</option>
                                <option value="standard">标准权限 (Standard)</option>
                                <option value="full-access">最高权限 (Full Access)</option>
                                <option value="read-only">仅可读 (Read Only)</option>
                              </select>
                              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400">
                                <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 stroke-current stroke-[1.5]"><path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              </div>
                            </div>
                          </div>
                        </div>

                        <ToggleField checked={drawerNode.reuseSession} onChange={(checked) => updateNode(drawerNode.id, (current) => ({ ...current, reuseSession: checked }))} label="同 CLI 复用原生 Session" />

                        <div className="rounded-[10px] bg-slate-50/80 p-5 ring-1 ring-slate-200/50">
                          <div className="mb-4 flex items-center gap-2">
                            <span className="text-sm font-bold tracking-tight text-slate-900">执行结果路由</span>
                          </div>
                          
                          <div className="grid gap-5 sm:grid-cols-2">
                            <div className="space-y-2">
                              <label className="flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                                <span className="h-2 w-2 rounded-full bg-emerald-500"></span> 成功后去往
                              </label>
                              <div className="relative">
                                <select value={drawerNode.successNodeId} onChange={(event) => updateBranchRoute(drawerNode.id, "success", event.target.value)} className={cn(INPUT_CLASS, "appearance-none pr-8 text-[13px] bg-white")}>
                                  <option value="">结束</option>
                                  {nodes.filter((node) => node.id !== drawerNode.id).map((node) => (
                                    <option key={node.id} value={node.id}>{node.label}</option>
                                  ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400">
                                  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 stroke-current stroke-[1.5]"><path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <label className="flex items-center gap-1.5 text-xs font-bold text-rose-500">
                                <span className="h-2 w-2 rounded-full bg-rose-500"></span> 失败后去往
                              </label>
                              <div className="relative">
                                <select value={drawerNode.failNodeId} onChange={(event) => updateBranchRoute(drawerNode.id, "fail", event.target.value)} className={cn(INPUT_CLASS, "appearance-none pr-8 text-[13px] bg-white")}>
                                  <option value="">结束</option>
                                  {nodes.filter((node) => node.id !== drawerNode.id).map((node) => (
                                    <option key={node.id} value={node.id}>{node.label}</option>
                                  ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400">
                                  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 stroke-current stroke-[1.5]"><path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          <div className="mt-4 grid gap-2 text-[11px] text-slate-500 border-t border-slate-200/60 pt-4">
                            <div>success 当前去往：<span className="ml-1 font-medium text-slate-700">{drawerNode.successNodeId ? nodes.find((node) => node.id === drawerNode.successNodeId)?.label ?? drawerNode.successNodeId : "(结束工作流)"}</span></div>
                            <div>fail 当前去往：<span className="ml-1 font-medium text-slate-700">{drawerNode.failNodeId ? nodes.find((node) => node.id === drawerNode.failNodeId)?.label ?? drawerNode.failNodeId : "(结束工作流)"}</span></div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function AutomationWorkflowEditorPage() {
  return (
    <ReactFlowProvider>
      <AutomationWorkflowEditorContent />
    </ReactFlowProvider>
  );
}
