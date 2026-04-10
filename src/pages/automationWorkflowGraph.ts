export type WorkflowBranch = "success" | "fail";

export type WorkflowGraphNode = {
  id: string;
  label: string;
  successNodeId: string;
  failNodeId: string;
};

function branchTargets(node: WorkflowGraphNode) {
  return [
    { branch: "success" as const, targetId: node.successNodeId },
    { branch: "fail" as const, targetId: node.failNodeId },
  ].filter((entry) => entry.targetId);
}

function branchLabel(branch: WorkflowBranch) {
  return branch === "success" ? "success" : "fail";
}

export function hasWorkflowPath<T extends WorkflowGraphNode>(
  nodes: T[],
  startId: string,
  targetId: string,
  visited = new Set<string>()
): boolean {
  if (startId === targetId) return true;
  if (visited.has(startId)) return false;
  visited.add(startId);
  const node = nodes.find((item) => item.id === startId);
  if (!node) return false;
  return branchTargets(node).some((entry) =>
    hasWorkflowPath(nodes, entry.targetId, targetId, visited)
  );
}

export function applyWorkflowBranchConnection<T extends WorkflowGraphNode>(
  nodes: T[],
  sourceId: string,
  branch: WorkflowBranch,
  targetId: string
) {
  return nodes.map((node) =>
    node.id === sourceId
      ? {
          ...node,
          successNodeId: branch === "success" ? targetId : node.successNodeId,
          failNodeId: branch === "fail" ? targetId : node.failNodeId,
        }
      : node
  );
}

export function collectReachableWorkflowNodeIds<T extends WorkflowGraphNode>(
  nodes: T[],
  entryNodeId: string
) {
  const reachable = new Set<string>();
  const stack = [entryNodeId];

  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!nodeId || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) continue;
    branchTargets(node).forEach((entry) => {
      if (!reachable.has(entry.targetId)) {
        stack.push(entry.targetId);
      }
    });
  }

  return reachable;
}

function cyclePath<T extends WorkflowGraphNode>(
  nodes: T[],
  nodeId: string,
  visiting: string[],
  visited: Set<string>,
  active = new Set<string>()
): string[] | null {
  if (visiting.includes(nodeId)) {
    return [...visiting.slice(visiting.indexOf(nodeId)), nodeId];
  }
  if (visited.has(nodeId)) return null;
  active.add(nodeId);

  const node = nodes.find((item) => item.id === nodeId);
  if (!node) {
    active.delete(nodeId);
    visited.add(nodeId);
    return null;
  }

  for (const entry of branchTargets(node)) {
    if (active.has(entry.targetId)) {
      return [...visiting, nodeId, entry.targetId];
    }
    const detected = cyclePath(nodes, entry.targetId, [...visiting, nodeId], visited, active);
    if (detected) return detected;
  }

  active.delete(nodeId);
  visited.add(nodeId);
  return null;
}

export function validateWorkflowGraph<T extends WorkflowGraphNode>(
  nodes: T[],
  entryNodeId: string | null
) {
  if (nodes.length === 0) {
    return "工作流至少需要一个节点。";
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const labelById = new Map(nodes.map((node) => [node.id, node.label.trim() || node.id]));

  if (!entryNodeId || !nodeIds.has(entryNodeId)) {
    return "请设置一个有效的入口节点。";
  }

  for (const node of nodes) {
    for (const entry of branchTargets(node)) {
      if (entry.targetId === node.id) {
        return `节点“${labelById.get(node.id)}”的 ${branchLabel(entry.branch)} 路由不能指向自己。`;
      }
      if (!nodeIds.has(entry.targetId)) {
        return `节点“${labelById.get(node.id)}”的 ${branchLabel(entry.branch)} 路由指向了不存在的节点。`;
      }
    }
  }

  const cycle = cyclePath(nodes, entryNodeId, [], new Set<string>());
  if (cycle && cycle.length > 1) {
    const labels = cycle.map((nodeId) => labelById.get(nodeId) ?? nodeId);
    return `当前工作流存在环路：${labels.join(" -> ")}。请改为无环路由。`;
  }

  const reachable = collectReachableWorkflowNodeIds(nodes, entryNodeId);
  const unreachableLabels = nodes
    .filter((node) => !reachable.has(node.id))
    .map((node) => labelById.get(node.id) ?? node.id);

  if (unreachableLabels.length > 0) {
    return `存在从入口不可达的节点：${unreachableLabels.join("、")}。`;
  }

  return null;
}
