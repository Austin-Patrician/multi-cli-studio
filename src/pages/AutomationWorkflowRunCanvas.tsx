import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  useNodesState,
} from "@xyflow/react";
import { memo, useEffect, useMemo } from "react";
import type {
  AutomationWorkflow,
  AutomationWorkflowBranchResult,
  AutomationWorkflowNodeRun,
  AutomationWorkflowRun,
} from "../lib/models";
import { cn, executionModeLabel, statusText, statusTone } from "./automationUi";

type WorkflowRunCanvasNodeData = {
  label: string;
  goal: string;
  isEntry: boolean;
  executionModeLabel: string;
  permissionLabel: string;
  status: string;
  statusLabel: string;
  statusSummary: string;
  isCurrent: boolean;
  isSelected: boolean;
  currentHint: string | null;
  onSelect: () => void;
};

type WorkflowRunCanvasNode = Node<WorkflowRunCanvasNodeData, "workflowRunNode">;
type WorkflowRunCanvasEdge = Edge<{ branch: AutomationWorkflowBranchResult; active: boolean }>;

const NODE_WIDTH = 220;
const NODE_HEIGHT = 150;

function defaultNodeLayout(index: number) {
  return {
    x: 120 + (index % 3) * 340,
    y: 120 + Math.floor(index / 3) * 240,
  };
}

function permissionLabel(value: string) {
  switch (value) {
    case "full-access":
      return "full access";
    case "read-only":
      return "read-only";
    default:
      return "standard";
  }
}

function nodeShellClass(status: string, isCurrent: boolean, isSelected: boolean) {
  const tone = (() => {
    switch (status) {
      case "completed":
        return "border-emerald-200 bg-emerald-50/70";
      case "running":
        return "border-sky-300 bg-sky-50/85";
      case "paused":
      case "blocked":
        return "border-amber-300 bg-amber-50/80";
      case "failed":
      case "cancelled":
        return "border-rose-300 bg-rose-50/80";
      default:
        return "border-slate-200 bg-white/95";
    }
  })();

  return cn(
    "relative overflow-hidden rounded-[18px] border shadow-[0_14px_36px_rgba(15,23,42,0.11)] transition-all duration-200",
    tone,
    isCurrent && "border-sky-400 ring-3 ring-sky-500/20 shadow-[0_0_0_1px_rgba(56,189,248,0.24),0_20px_44px_rgba(14,165,233,0.18)] -translate-y-0.5",
    isSelected && "border-slate-900 ring-3 ring-slate-900/10"
  );
}

const WorkflowRunNodeCard = memo(function WorkflowRunNodeCard({
  data,
}: NodeProps<WorkflowRunCanvasNode>) {
  const badgeTone = statusTone(data.status);

  return (
    <button
      type="button"
      onClick={data.onSelect}
      className={cn(nodeShellClass(data.status, data.isCurrent, data.isSelected), "h-full w-full text-left")}
    >
      <Handle
        id="target"
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        id="source"
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!h-2 !w-2 !border-0 !bg-transparent !opacity-0"
      />
      {data.isCurrent ? (
        <>
          <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#38bdf8,#0ea5e9,#38bdf8)]" />
          <div className="absolute right-3 top-3 flex h-3 w-3 items-center justify-center rounded-full bg-sky-500/15 ring-1 ring-sky-400/35">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
          </div>
        </>
      ) : null}
      <div className="border-b border-white/80 bg-[linear-gradient(135deg,rgba(248,250,252,0.95),rgba(255,255,255,0.98))] px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <div className="rounded-full bg-slate-950 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-white">
                {data.isEntry ? "Entry" : "Node"}
              </div>
              {data.isCurrent ? (
                <div className="rounded-full bg-sky-500 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm shadow-sky-500/30">
                  当前
                </div>
              ) : null}
            </div>
            <div className="mt-2 truncate text-[13px] font-semibold tracking-tight text-slate-950">
              {data.label}
            </div>
          </div>
          <div className={cn("rounded-full px-2 py-0.5 text-[9px] font-semibold ring-1", badgeTone)}>
            {data.statusLabel}
          </div>
        </div>
      </div>

      <div className="space-y-2.5 px-3 py-3">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            任务目标
          </div>
          <div className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-slate-700">
            {data.goal.trim() || "未填写任务目标。"}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[9px] font-medium text-slate-600 ring-1 ring-slate-200">
            {data.executionModeLabel}
          </span>
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[9px] font-medium text-slate-600 ring-1 ring-slate-200">
            {data.permissionLabel}
          </span>
        </div>
        <div className="rounded-[12px] bg-white/75 px-2.5 py-2 ring-1 ring-slate-200/80">
          <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            运行摘要
          </div>
          <div className="mt-1 line-clamp-2 text-[10px] leading-4.5 text-slate-600">
            {data.statusSummary}
          </div>
        </div>
        {data.currentHint ? (
          <div className="rounded-[12px] border border-sky-200 bg-sky-50/90 px-2.5 py-2 text-[10px] font-medium leading-4.5 text-sky-700">
            {data.currentHint}
          </div>
        ) : null}
      </div>
    </button>
  );
});

const nodeTypes = {
  workflowRunNode: WorkflowRunNodeCard,
};

function activeEdgeIds(run: AutomationWorkflowRun) {
  const ids = new Set<string>();
  run.nodeRuns.forEach((nodeRun) => {
    if (nodeRun.branchResult) {
      ids.add(`${nodeRun.nodeId}:${nodeRun.branchResult}`);
    }
  });
  return ids;
}

function nodeRunByNodeId(run: AutomationWorkflowRun) {
  return new Map(run.nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]));
}

function currentHint(status: string, isCurrent: boolean) {
  if (!isCurrent) return null;
  switch (status) {
    case "running":
      return "该节点正在执行，画布会在下一次轮询时刷新路径状态。";
    case "paused":
    case "blocked":
      return "该节点暂停在这里，等待人工确认或外部条件恢复。";
    case "completed":
      return "该节点刚完成，下一条命中的分支会在画布中高亮。";
    default:
      return "当前焦点停留在这个节点。";
  }
}

function selectNodeRunId(
  nodeRun: AutomationWorkflowNodeRun | undefined,
  selectedNodeRunId: string | null | undefined
) {
  if (!nodeRun) return null;
  return selectedNodeRunId === nodeRun.id ? null : nodeRun.id;
}

export function AutomationWorkflowRunCanvas({
  workflow,
  run,
  selectedNodeRunId,
  onSelectNodeRun,
}: {
  workflow: AutomationWorkflow;
  run: AutomationWorkflowRun;
  selectedNodeRunId: string | null;
  onSelectNodeRun: (nodeRunId: string | null) => void;
}) {
  const [canvasNodes, setCanvasNodes, onCanvasNodesChange] = useNodesState<WorkflowRunCanvasNode>([]);

  const nodeRunsByNodeId = useMemo(() => nodeRunByNodeId(run), [run]);
  const traversedEdgeIds = useMemo(() => activeEdgeIds(run), [run]);

  const nodeDefinitions = useMemo<WorkflowRunCanvasNode[]>(
    () =>
      workflow.nodes.map((node, index) => {
        const nodeRun = nodeRunsByNodeId.get(node.id);
        const status = nodeRun?.status ?? (run.currentNodeId === node.id ? "running" : "queued");
        const statusSummary =
          nodeRun?.statusSummary ??
          (run.currentNodeId === node.id ? "当前节点正在执行。" : "等待执行。");
        return {
          id: node.id,
          type: "workflowRunNode",
          position: node.layout ?? defaultNodeLayout(index),
          draggable: true,
          selectable: false,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: {
            label: node.label,
            goal: node.goal,
            isEntry: workflow.entryNodeId === node.id,
            executionModeLabel:
              node.executionMode === "inherit"
                ? `继承 · ${executionModeLabel(workflow.defaultExecutionMode)}`
                : executionModeLabel(node.executionMode),
            permissionLabel:
              node.permissionProfile === "inherit"
                ? `继承 · ${permissionLabel(workflow.defaultPermissionProfile)}`
                : permissionLabel(node.permissionProfile),
            status,
            statusLabel: statusText(status),
            statusSummary,
            isCurrent: run.currentNodeId === node.id,
            isSelected: nodeRun?.id === selectedNodeRunId,
            currentHint: currentHint(status, run.currentNodeId === node.id),
            onSelect: () => onSelectNodeRun(selectNodeRunId(nodeRun, selectedNodeRunId)),
          },
          style: { width: NODE_WIDTH, height: NODE_HEIGHT },
        };
      }),
    [nodeRunsByNodeId, onSelectNodeRun, run.currentNodeId, selectedNodeRunId, workflow]
  );

  useEffect(() => {
    setCanvasNodes((current) => {
      const currentPositions = new Map(current.map((node) => [node.id, node.position]));
      return nodeDefinitions.map((node) => ({
        ...node,
        position: currentPositions.get(node.id) ?? node.position,
      }));
    });
  }, [nodeDefinitions, setCanvasNodes]);

  const edges = useMemo<WorkflowRunCanvasEdge[]>(
    () =>
      workflow.edges.map((edge) => {
        const active = traversedEdgeIds.has(`${edge.fromNodeId}:${edge.on}`);
        const touchesCurrentNode =
          run.currentNodeId != null &&
          (edge.fromNodeId === run.currentNodeId || edge.toNodeId === run.currentNodeId);
        const color = edge.on === "success" ? "#10b981" : "#f43f5e";
        const stroke = active ? color : touchesCurrentNode ? "#0ea5e9" : "#94a3b8";
        return {
          id: `${edge.fromNodeId}:${edge.on}`,
          source: edge.fromNodeId,
          target: edge.toNodeId,
          type: "default",
          animated: (active || touchesCurrentNode) && run.status === "running",
          data: { branch: edge.on, active },
          style: {
            stroke,
            strokeWidth: active ? 4 : touchesCurrentNode ? 3 : 2.4,
            opacity: active ? 1 : touchesCurrentNode ? 0.92 : 0.55,
            strokeDasharray: active ? undefined : touchesCurrentNode ? "10 6" : "6 8",
            filter: active ? `drop-shadow(0 0 8px ${color}55)` : touchesCurrentNode ? "drop-shadow(0 0 8px rgba(14,165,233,0.28))" : undefined,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: stroke,
            width: active ? 22 : touchesCurrentNode ? 19 : 16,
            height: active ? 22 : touchesCurrentNode ? 19 : 16,
          },
        };
      }),
    [run.currentNodeId, run.status, traversedEdgeIds, workflow.edges]
  );

  return (
    <div className="relative h-full min-h-[340px] overflow-hidden rounded-[22px] border border-slate-200 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.14),transparent_24%),linear-gradient(180deg,#f8fbff_0%,#eef4fb_100%)]">
      <div className="pointer-events-none absolute left-5 top-5 z-10 max-w-[420px] rounded-2xl border border-white/70 bg-white/90 px-4 py-3 text-[11px] font-medium text-slate-600 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            已走 success
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
            已走 fail
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
            当前相关路径
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
            未走路径
          </span>
        </div>
      </div>

      <ReactFlow
        nodes={canvasNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.45}
        maxZoom={1.3}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onSelectNodeRun(selectNodeRunId(nodeRunsByNodeId.get(node.id), selectedNodeRunId))}
        onNodesChange={onCanvasNodesChange}
        onPaneClick={() => onSelectNodeRun(null)}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        className="bg-transparent"
      >
        <Background gap={24} size={1.2} color="#d7e3f1" variant={BackgroundVariant.Dots} />
        <Controls
          className="!bottom-5 !left-5 !top-auto !rounded-2xl !border !border-slate-200 !bg-white/90 !shadow-sm"
          showInteractive={false}
        />
      </ReactFlow>
    </div>
  );
}
