import type {
  AutomationExecutionMode,
  AutomationParameterValue,
  AutomationRunStatus,
  AutomationWorkflowContextStrategy,
} from "../lib/models";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function formatStamp(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDuration(start?: string | null, end?: string | null) {
  if (!start) return "-";
  const startMs = Date.parse(start);
  const endMs = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return "-";
  const totalSeconds = Math.round((endMs - startMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function statusText(status: AutomationRunStatus | string) {
  switch (status) {
    case "queued":
      return "未执行";
    case "draft":
      return "草稿";
    case "scheduled":
      return "待执行";
    case "running":
      return "运行中";
    case "validating":
      return "验收中";
    case "paused":
      return "已暂停";
    case "blocked":
      return "已阻塞";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "success":
      return "成功";
    case "partial":
      return "部分完成";
    case "waiting_human":
      return "等待人工处理";
    case "blocked_by_policy":
      return "策略拦截";
    case "blocked_by_environment":
      return "环境阻塞";
    case "unknown":
      return "待确认";
    default:
      return status;
  }
}

export function statusTone(status: AutomationRunStatus | string) {
  switch (status) {
    case "queued":
      return "bg-slate-100 text-slate-600 ring-slate-500/10";
    case "completed":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "running":
      return "bg-sky-50 text-sky-700 ring-sky-600/20";
    case "validating":
      return "bg-indigo-50 text-indigo-700 ring-indigo-600/20";
    case "scheduled":
      return "bg-indigo-50 text-indigo-700 ring-indigo-600/20";
    case "paused":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    case "blocked":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    case "failed":
    case "cancelled":
      return "bg-rose-50 text-rose-700 ring-rose-600/20";
    case "success":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "partial":
      return "bg-cyan-50 text-cyan-700 ring-cyan-600/20";
    case "waiting_human":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    case "blocked_by_policy":
      return "bg-orange-50 text-orange-700 ring-orange-600/20";
    case "blocked_by_environment":
      return "bg-violet-50 text-violet-700 ring-violet-600/20";
    case "unknown":
      return "bg-slate-100 text-slate-600 ring-slate-500/10";
    default:
      return "bg-slate-100 text-slate-600 ring-slate-500/10";
  }
}

export function executionModeLabel(value?: AutomationExecutionMode | string | null) {
  switch (value) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "gemini":
      return "Gemini";
    default:
      return "自动模式";
  }
}

export const workflowContextStrategyOptions: Array<{
  value: AutomationWorkflowContextStrategy;
  label: string;
}> = [
  { value: "resume-per-cli", label: "按执行方延续进度" },
  { value: "kernel-only", label: "仅交接任务要点" },
  { value: "session-pool", label: "全流程共享完整背景" },
];

export function workflowContextStrategyLabel(
  value?: AutomationWorkflowContextStrategy | string | null
) {
  return (
    workflowContextStrategyOptions.find((option) => option.value === value)?.label ??
    value ??
    "未设置"
  );
}

export function parameterValueText(value: AutomationParameterValue | undefined) {
  if (value === null || value === undefined || value === "") return "未设置";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function isActiveRunStatus(status: AutomationRunStatus | string) {
  return status === "running" || status === "validating" || status === "scheduled" || status === "paused";
}
