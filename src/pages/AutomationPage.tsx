import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { bridge } from "../lib/bridge";
import type { AutomationEvent, AutomationGoal, AutomationGoalRuleConfig, AutomationRun } from "../lib/models";

// --- Icons ---
const PlayIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
  </svg>
);

const PauseIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" />
  </svg>
);

const XMarkIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673A2.25 2.25 0 0115.916 21H8.084a2.25 2.25 0 01-2.244-1.327L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0A48.11 48.11 0 017.5 5.394m7.5 0V4.5c0-1.125-.91-2.034-2.034-2.034h-1.932C9.91 2.466 9 3.375 9 4.5v.894m6 0A48.667 48.667 0 009 5.394" />
  </svg>
);

const RefreshIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

const PlusIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const SearchIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
);

const ClockIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const AlertIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const CogIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 1115 0 7.5 7.5 0 01-15 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 0v3.75m0-3.75h3.75m-3.75 0H8.25" />
  </svg>
);

const TerminalIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const ListIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25" />
  </svg>
);

// --- Utilities ---
function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatStamp(value?: string | null) {
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

function statusText(status: string) {
  switch (status) {
    case "draft": return "草稿";
    case "scheduled": return "待开始";
    case "running": return "执行中";
    case "completed": return "已完成";
    case "paused": return "已暂停";
    case "failed": return "失败";
    case "cancelled": return "已取消";
    case "success": return "成功";
    case "warning": return "提醒";
    case "error": return "异常";
    default: return "信息";
  }
}

function statusColor(status: string) {
  switch (status) {
    case "completed":
    case "success": return "emerald";
    case "scheduled":
    case "running":
    case "info": return "indigo";
    case "paused":
    case "warning": return "amber";
    case "failed":
    case "cancelled":
    case "error": return "rose";
    default: return "slate";
  }
}

function StatusBadge({ status, small = false }: { status: string; small?: boolean }) {
  const color = statusColor(status);
  const colorClasses: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
    amber: "bg-amber-50 text-amber-700 ring-amber-600/20",
    rose: "bg-rose-50 text-rose-700 ring-rose-600/20",
    slate: "bg-slate-50 text-slate-600 ring-slate-500/10",
  };

  return (
    <span className={cn(
      "inline-flex items-center rounded-full font-semibold ring-1 ring-inset",
      small ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
      colorClasses[color]
    )}>
      {statusText(status)}
    </span>
  );
}

function summarizeRuleConfig(config: AutomationGoalRuleConfig) {
  return [
    config.allowAutoSelectStrategy ? "自动选方案" : "遇分支停下",
    config.allowSafeWorkspaceEdits ? "允许改文件" : "只读",
    config.allowSafeChecks ? "允许校验" : "禁用校验",
    `最多 ${config.maxRoundsPerGoal} 轮`,
  ];
}

function executionModeLabel(value?: string | null) {
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

function filterRuns(runs: AutomationRun[], filter: "all" | "scheduled" | "running" | "attention", query: string) {
  const q = query.trim().toLowerCase();
  return runs.filter((run) => {
    const matchesFilter =
      filter === "all"
        ? true
        : filter === "attention"
          ? run.status === "paused" || run.status === "failed" || run.status === "cancelled"
          : run.status === filter;
    const matchesQuery =
      !q ||
      run.projectName.toLowerCase().includes(q) ||
      run.summary?.toLowerCase().includes(q) === true ||
      run.goals.some((goal) => goal.title.toLowerCase().includes(q) || goal.goal.toLowerCase().includes(q));
    return matchesFilter && matchesQuery;
  });
}

function canDeleteRun(run: AutomationRun) {
  return run.status !== "running";
}

function getRunOutcomeCounts(run: AutomationRun) {
  const total = run.goals.length;
  const completed = run.goals.filter((goal) => goal.status === "completed").length;
  const failed = run.goals.filter((goal) => goal.status === "failed").length;
  const paused = run.goals.filter((goal) => goal.status === "paused").length;
  return { total, completed, failed, paused };
}

function getProgressText(goal: AutomationGoal) {
  return (goal.latestProgressSummary ?? goal.resultSummary ?? "").trim();
}

function shouldShowProgressToggle(text: string) {
  return text.length > 110 || text.includes("\n");
}

function SummaryStack({
  run,
  align = "start",
  dense = false,
}: {
  run: AutomationRun;
  align?: "start" | "end";
  dense?: boolean;
}) {
  const counts = getRunOutcomeCounts(run);
  const items: Array<{
    key: string;
    label: string;
    value: string;
    tone: string;
    icon: ReactNode;
  }> = [
    {
      key: "completed",
      label: "已完成",
      value: `${counts.completed}/${counts.total || 0}`,
      tone: "text-emerald-600 bg-emerald-50 ring-emerald-500/15",
      icon: <CheckIcon className={dense ? "h-3.5 w-3.5" : "h-4 w-4"} />,
    },
    {
      key: "failed",
      label: "失败",
      value: `${counts.failed}`,
      tone: "text-rose-600 bg-rose-50 ring-rose-500/15",
      icon: <XMarkIcon className={dense ? "h-3.5 w-3.5" : "h-4 w-4"} />,
    },
    {
      key: "paused",
      label: "已暂停",
      value: `${counts.paused}`,
      tone: "text-amber-600 bg-amber-50 ring-amber-500/15",
      icon: <PauseIcon className={dense ? "h-3.5 w-3.5" : "h-4 w-4"} />,
    },
  ];

  return (
    <div className={cn("flex flex-col gap-1.5", align === "end" && "items-end")}>
      {items.map((item) => (
        <div
          key={item.key}
          title={`${item.label}: ${item.value}`}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-2.5 py-1 font-semibold ring-1 ring-inset",
            dense ? "min-w-[72px] text-[11px]" : "min-w-[84px] text-xs",
            item.tone
          )}
        >
          <span className="flex items-center justify-center">{item.icon}</span>
          <span className="font-mono tabular-nums">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function runActionButtons(
  run: AutomationRun,
  onStart: () => void,
  onPause: () => void,
  onResume: () => void,
  onRestart: () => void,
  onCancel: () => void
) {
  if (run.status === "draft" || run.status === "scheduled") {
    return (
      <button onClick={onStart} className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors shadow-sm ring-1 ring-emerald-500/20">
        <PlayIcon className="w-4 h-4" />
      </button>
    );
  }

  if (run.status === "running") {
    return (
      <div className="flex items-center gap-2">
        <button onClick={onPause} className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors shadow-sm ring-1 ring-amber-500/20">
          <PauseIcon className="w-4 h-4" />
        </button>
        <button onClick={onCancel} className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors shadow-sm ring-1 ring-rose-500/20">
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (run.status === "paused") {
    return (
      <div className="flex items-center gap-2">
        <button onClick={onResume} className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors shadow-sm ring-1 ring-emerald-500/20">
          <PlayIcon className="w-4 h-4" />
        </button>
        <button onClick={onRestart} className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors shadow-sm ring-1 ring-indigo-500/20">
          <RefreshIcon className="w-4 h-4" />
        </button>
        <button onClick={onCancel} className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors shadow-sm ring-1 ring-rose-500/20">
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (run.status === "failed" || run.status === "cancelled") {
    return (
      <button onClick={onRestart} className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors shadow-sm ring-1 ring-indigo-500/20">
        <RefreshIcon className="w-4 h-4" />
      </button>
    );
  }

  return <span className="text-xs text-slate-300">—</span>;
}

// --- Components ---

function GoalRuleEditor({
  value,
  onChange,
}: {
  value: AutomationGoalRuleConfig;
  onChange: (next: AutomationGoalRuleConfig) => void;
}) {
  const toggles: Array<[keyof AutomationGoalRuleConfig, string]> = [
    ["allowAutoSelectStrategy", "自动选方案"],
    ["allowSafeWorkspaceEdits", "允许改文件"],
    ["allowSafeChecks", "允许校验"],
    ["pauseOnCredentials", "凭据暂停"],
    ["pauseOnExternalInstalls", "安装暂停"],
    ["pauseOnDestructiveCommands", "破坏暂停"],
    ["pauseOnGitPush", "推送暂停"],
  ];

  return (
    <div className="grid gap-4 bg-slate-50/50 px-6 py-6 md:grid-cols-[1fr_300px] border-t border-slate-100">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {toggles.map(([key, label]) => (
          <label key={String(key)} className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-medium text-slate-700 shadow-sm transition-all hover:border-indigo-200 hover:ring-1 hover:ring-indigo-100">
            <span>{label}</span>
            <input
              type="checkbox"
              checked={Boolean(value[key])}
              onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-1">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 ml-1">最大轮次</span>
          <input
            type="number"
            min={1}
            max={8}
            value={value.maxRoundsPerGoal}
            onChange={(event) => onChange({ ...value, maxRoundsPerGoal: Number.parseInt(event.target.value, 10) || 1 })}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 ml-1">最大失败数</span>
          <input
            type="number"
            min={1}
            max={5}
            value={value.maxConsecutiveFailures}
            onChange={(event) => onChange({ ...value, maxConsecutiveFailures: Number.parseInt(event.target.value, 10) || 1 })}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 ml-1">无进展轮次</span>
          <input
            type="number"
            min={0}
            max={5}
            value={value.maxNoProgressRounds}
            onChange={(event) => onChange({ ...value, maxNoProgressRounds: Math.max(0, Number.parseInt(event.target.value, 10) || 0) })}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
          />
        </div>
      </div>
    </div>
  );
}

function EventList({ events }: { events: AutomationEvent[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/50 px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/50 text-indigo-500">
          <ListIcon className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900">事件流</h2>
          <p className="text-sm text-slate-500">当前批次的执行记录</p>
        </div>
      </div>
      <div className="max-h-[600px] divide-y divide-slate-100 overflow-y-auto">
        {events.length ? (
          events.map((event) => (
            <div key={event.id} className="group relative flex gap-4 px-6 py-5 hover:bg-slate-50/50 transition-colors">
              <div className="flex shrink-0 flex-col items-center">
                <div className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full ring-2 ring-white shadow-sm",
                  event.level === "error" ? "bg-rose-100 text-rose-600" : 
                  event.level === "warning" ? "bg-amber-100 text-amber-600" :
                  "bg-indigo-100 text-indigo-600"
                )}>
                  {event.level === "error" ? <AlertIcon className="w-4 h-4" /> : 
                   event.level === "success" ? <CheckIcon className="w-4 h-4" /> :
                   <ClockIcon className="w-4 h-4" />}
                </div>
                <div className="mt-2 w-[1px] flex-1 bg-slate-100" />
              </div>
              <div className="flex-1 pb-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[15px] font-semibold text-slate-900">{event.title}</div>
                  <div className="text-[12px] font-medium text-slate-400 font-mono">{formatStamp(event.createdAt)}</div>
                </div>
                <div className="mt-1.5 text-sm leading-relaxed text-slate-600">{event.detail}</div>
                <div className="mt-3 flex items-center gap-2">
                   <StatusBadge status={event.level} small />
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <ListIcon className="w-12 h-12 mb-3 opacity-20" />
            <div className="text-sm font-medium">当前没有事件记录</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function AutomationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "scheduled" | "running" | "attention">("all");
  const [query, setQuery] = useState("");
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  const [expandedProgressGoalIds, setExpandedProgressGoalIds] = useState<Record<string, boolean>>({});
  const [editedGoalRules, setEditedGoalRules] = useState<Record<string, AutomationGoalRuleConfig>>({});

  async function refreshPage() {
    try {
      const nextRuns = await bridge.listAutomationRuns();
      const stateRunId = (location.state as { selectedRunId?: string } | null)?.selectedRunId ?? null;
      setRuns(nextRuns);
      setSelectedRunId((current) => {
        if (stateRunId && nextRuns.some((run) => run.id === stateRunId)) return stateRunId;
        if (current && nextRuns.some((run) => run.id === current)) return current;
        return nextRuns[0]?.id ?? null;
      });
      setError(null);
    } catch {
      setError("加载自动化批次失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshPage();
    const id = window.setInterval(() => void refreshPage(), 5000);
    return () => window.clearInterval(id);
  }, [location.state]);

  const filteredRuns = useMemo(() => filterRuns(runs, filter, query), [runs, filter, query]);
  const selectedRun = useMemo(
    () => filteredRuns.find((run) => run.id === selectedRunId) ?? runs.find((run) => run.id === selectedRunId) ?? null,
    [filteredRuns, runs, selectedRunId]
  );

  useEffect(() => {
    if (!selectedRun) return;
    setEditedGoalRules(
      Object.fromEntries(selectedRun.goals.map((goal) => [goal.id, goal.ruleConfig]))
    );
  }, [selectedRun?.id]);

  useEffect(() => {
    setExpandedProgressGoalIds({});
  }, [selectedRun?.id]);

  async function withBusy(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
      await refreshPage();
      setError(null);
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "当前操作没有成功完成。";
      setError(detail);
    } finally {
      setBusy(null);
    }
  }

  function confirmDeleteRun(run: AutomationRun) {
    return window.confirm(
      `确认删除批次“${run.projectName}”吗？\n\n这会移除该批次及其自动化聊天记录，且无法恢复。`
    );
  }

  return (
    <div className="min-h-full bg-[#f8fafc] px-6 py-10 sm:px-8 lg:px-12 text-slate-800 relative overflow-x-hidden">
      {/* Soft background ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1200px] h-[600px] bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.08),transparent_70%)] pointer-events-none" />

      <div className="relative mx-auto max-w-7xl space-y-10">
        <header className="flex flex-col gap-4">
          {/* <div className="inline-flex w-fit items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-600 ring-1 ring-indigo-500/20 shadow-sm">
             <TerminalIcon className="w-3.5 h-3.5" />
             Automation System
          </div> */}
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 drop-shadow-sm">自动化批次</h1>
          <p className="text-[15px] text-slate-500 leading-relaxed max-w-2xl">
            监控多级任务的执行进度与规则配置。通过事件流实时追踪每个目标的决策逻辑与执行结果。
          </p>
        </header>

        {/* Stats Grid */}
        <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["待开始", runs.filter((run) => run.status === "scheduled").length, "indigo", <ClockIcon className="w-6 h-6" />],
            ["执行中", runs.filter((run) => run.status === "running").length, "emerald", <PlayIcon className="w-6 h-6" />],
            ["已完成", runs.filter((run) => run.status === "completed").length, "slate", <CheckIcon className="w-6 h-6" />],
            ["需处理", runs.filter((run) => run.status === "paused" || run.status === "failed" || run.status === "cancelled").length, "rose", <AlertIcon className="w-6 h-6" />],
          ].map(([label, value, color, icon]) => (
            <div key={String(label)} className="group relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60 transition-all hover:shadow-md hover:ring-indigo-200/50">
              <div className={cn(
                "absolute top-0 right-0 -mr-4 -mt-4 h-24 w-24 rounded-full opacity-10 transition-transform group-hover:scale-110",
                color === "indigo" ? "bg-indigo-500" : color === "emerald" ? "bg-emerald-500" : color === "rose" ? "bg-rose-500" : "bg-slate-500"
              )} />
              <div className="flex items-center gap-4">
                 <div className={cn(
                   "flex h-12 w-12 items-center justify-center rounded-xl shadow-sm ring-1 ring-inset",
                   color === "indigo" ? "bg-indigo-50 text-indigo-600 ring-indigo-500/20" : 
                   color === "emerald" ? "bg-emerald-50 text-emerald-600 ring-emerald-500/20" : 
                   color === "rose" ? "bg-rose-50 text-rose-600 ring-rose-500/20" : 
                   "bg-slate-50 text-slate-600 ring-slate-500/20"
                 )}>
                   {icon}
                 </div>
                 <div>
                    <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
                    <div className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{value}</div>
                 </div>
              </div>
            </div>
          ))}
        </section>

        {error ? (
          <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-medium text-rose-700 shadow-sm animate-in fade-in slide-in-from-top-4">
            <AlertIcon className="w-5 h-5 shrink-0" />
            {error}
          </div>
        ) : null}

        {/* Runs List Table & Controls */}
        <section className="space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-8 border-b border-slate-200 px-2 text-[14px] font-semibold overflow-x-auto pb-0.5">
              <button onClick={() => setFilter("all")} className={cn("pb-4 relative whitespace-nowrap transition-colors", filter === "all" ? "text-indigo-600" : "text-slate-400 hover:text-slate-600")}>
                全部
                {filter === "all" && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-indigo-500 rounded-t-full" />}
                <span className="ml-2 text-[11px] font-bold opacity-60">({runs.length})</span>
              </button>
              <button onClick={() => setFilter("running")} className={cn("pb-4 relative whitespace-nowrap transition-colors", filter === "running" ? "text-indigo-600" : "text-slate-400 hover:text-slate-600")}>
                执行中
                {filter === "running" && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-indigo-500 rounded-t-full" />}
                <span className="ml-2 text-[11px] font-bold opacity-60">({runs.filter((run) => run.status === "running").length})</span>
              </button>
              <button onClick={() => setFilter("scheduled")} className={cn("pb-4 relative whitespace-nowrap transition-colors", filter === "scheduled" ? "text-indigo-600" : "text-slate-400 hover:text-slate-600")}>
                待开始
                {filter === "scheduled" && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-indigo-500 rounded-t-full" />}
                <span className="ml-2 text-[11px] font-bold opacity-60">({runs.filter((run) => run.status === "scheduled").length})</span>
              </button>
              <button onClick={() => setFilter("attention")} className={cn("pb-4 relative whitespace-nowrap transition-colors", filter === "attention" ? "text-rose-600" : "text-slate-400 hover:text-rose-500")}>
                异常 / 暂停
                {filter === "attention" && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-rose-500 rounded-t-full" />}
                <span className="ml-2 text-[11px] font-bold opacity-60">({runs.filter((run) => run.status === "paused" || run.status === "failed" || run.status === "cancelled").length})</span>
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
               <div className="relative group w-full sm:w-64 xl:w-80">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <SearchIcon className="h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                  </div>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索项目、目标..."
                    className="w-full rounded-xl border border-slate-200 bg-white/70 backdrop-blur-sm pl-10 pr-4 py-2.5 text-sm shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  />
               </div>
               <div className="flex items-center gap-2 bg-white/50 p-1 rounded-2xl ring-1 ring-slate-200/50 backdrop-blur-md shadow-sm">
                  <button 
                    onClick={() => void refreshPage()} 
                    className="flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <RefreshIcon className={cn("w-4 h-4", loading && "animate-spin")} />
                    刷新
                  </button>
                  <button 
                    onClick={() => navigate("/automation/new")} 
                    className="flex items-center gap-2 whitespace-nowrap rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 shadow-md shadow-slate-900/10 transition-all active:scale-[0.98]"
                  >
                    <PlusIcon className="w-4 h-4" />
                    新建批次
                  </button>
               </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100">
            <div className="grid grid-cols-12 gap-4 border-b border-slate-100 bg-slate-50/50 px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              <div className="col-span-1">状态</div>
              <div className="col-span-2">批次 ID</div>
              <div className="col-span-2">项目</div>
              <div className="col-span-1">目标</div>
              <div className="col-span-2">计划时间</div>
              <div className="col-span-3">执行摘要</div>
              <div className="col-span-1 text-right">操作</div>
            </div>
            <div className="divide-y divide-slate-100">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-slate-400 animate-pulse text-sm font-medium">正在同步云端批次数据...</div>
              ) : filteredRuns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                   <div className="mb-2 text-sm font-medium">没有找到符合条件的自动化批次</div>
                   <button onClick={() => {setFilter("all"); setQuery("");}} className="text-xs text-indigo-600 hover:underline">重置所有过滤</button>
                </div>
              ) : (
                filteredRuns.map((run) => (
                  <div 
                    key={run.id} 
                    onClick={() => setSelectedRunId(run.id)} 
                    className={cn(
                      "grid w-full grid-cols-12 gap-4 px-6 py-5 text-left transition-all hover:bg-slate-50 cursor-pointer group", 
                      selectedRunId === run.id && "bg-indigo-50/40 ring-1 ring-inset ring-indigo-500/10"
                    )}
                  >
                    <div className="col-span-1 flex items-center"><StatusBadge status={run.status} small /></div>
                    <div className="col-span-2 flex items-center text-sm font-mono text-slate-500 group-hover:text-indigo-600 transition-colors">
                      {run.id.slice(0, 12)}
                    </div>
                    <div className="col-span-2 flex items-center text-[15px] font-semibold text-slate-900">{run.projectName}</div>
                    <div className="col-span-1 flex items-center">
                       <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-[13px] font-bold text-slate-600 ring-1 ring-slate-200/50">
                         {run.goals.length}
                       </span>
                    </div>
                    <div className="col-span-2 flex items-center text-sm text-slate-500">{formatStamp(run.scheduledStartAt ?? run.createdAt)}</div>
                    <div className="col-span-3 flex items-center pr-4">
                      <SummaryStack run={run} dense />
                    </div>
                    <div className="col-span-1 flex items-center justify-end">
                      {(run.status === "draft" || run.status === "scheduled") && (
                        <div className="flex items-center gap-2">
                          <button onClick={(event) => { event.stopPropagation(); void withBusy(`start-${run.id}`, async () => { const updated = await bridge.startAutomationRun(run.id); setSelectedRunId(updated.id); }); }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors shadow-sm ring-1 ring-emerald-500/20"><PlayIcon className="w-4 h-4" /></button>
                          <button onClick={(event) => { event.stopPropagation(); if (!confirmDeleteRun(run)) return; void withBusy(`delete-${run.id}`, async () => { await bridge.deleteAutomationRun(run.id); }); }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors shadow-sm ring-1 ring-slate-300/70"><TrashIcon className="w-4 h-4" /></button>
                        </div>
                      )}
                      {run.status === "running" && (
                        <div className="flex items-center gap-2">
                          <button onClick={(event) => { event.stopPropagation(); void withBusy(`pause-run-${run.id}`, async () => { const updated = await bridge.pauseAutomationRun(run.id); setSelectedRunId(updated.id); }); }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors shadow-sm ring-1 ring-amber-500/20"><PauseIcon className="w-4 h-4" /></button>
                          <button onClick={(event) => { event.stopPropagation(); void withBusy(`cancel-${run.id}`, async () => { const updated = await bridge.cancelAutomationRun(run.id); setSelectedRunId(updated.id); }); }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors shadow-sm ring-1 ring-rose-500/20"><XMarkIcon className="w-4 h-4" /></button>
                          <button disabled title="运行中的批次请先暂停或取消" className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-lg bg-slate-50 text-slate-300 shadow-sm ring-1 ring-slate-200"><TrashIcon className="w-4 h-4" /></button>
                        </div>
                      )}
                      {run.status === "paused" && (
                        <div className="flex items-center gap-2">
                          <button onClick={(event) => { event.stopPropagation(); void withBusy(`resume-run-${run.id}`, async () => { const updated = await bridge.resumeAutomationRun(run.id); setSelectedRunId(updated.id); }); }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors shadow-sm ring-1 ring-emerald-500/20"><PlayIcon className="w-4 h-4" /></button>
                          <button onClick={(event) => { event.stopPropagation(); void withBusy(`restart-run-${run.id}`, async () => { const updated = await bridge.restartAutomationRun(run.id); setSelectedRunId(updated.id); }); }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors shadow-sm ring-1 ring-indigo-500/20"><RefreshIcon className="w-4 h-4" /></button>
                          <button onClick={(event) => { event.stopPropagation(); void withBusy(`cancel-${run.id}`, async () => { const updated = await bridge.cancelAutomationRun(run.id); setSelectedRunId(updated.id); }); }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors shadow-sm ring-1 ring-rose-500/20"><XMarkIcon className="w-4 h-4" /></button>
                          <button onClick={(event) => { event.stopPropagation(); if (!confirmDeleteRun(run)) return; void withBusy(`delete-${run.id}`, async () => { await bridge.deleteAutomationRun(run.id); }); }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors shadow-sm ring-1 ring-slate-300/70"><TrashIcon className="w-4 h-4" /></button>
                        </div>
                      )}
                      {(run.status === "failed" || run.status === "cancelled") && (
                        <div className="flex items-center gap-2">
                          <button onClick={(event) => { event.stopPropagation(); void withBusy(`restart-run-${run.id}`, async () => { const updated = await bridge.restartAutomationRun(run.id); setSelectedRunId(updated.id); }); }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors shadow-sm ring-1 ring-indigo-500/20"><RefreshIcon className="w-4 h-4" /></button>
                          <button onClick={(event) => { event.stopPropagation(); if (!confirmDeleteRun(run)) return; void withBusy(`delete-${run.id}`, async () => { await bridge.deleteAutomationRun(run.id); }); }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors shadow-sm ring-1 ring-slate-300/70"><TrashIcon className="w-4 h-4" /></button>
                        </div>
                      )}
                      {run.status === "completed" && (
                        <button onClick={(event) => { event.stopPropagation(); if (!confirmDeleteRun(run)) return; void withBusy(`delete-${run.id}`, async () => { await bridge.deleteAutomationRun(run.id); }); }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors shadow-sm ring-1 ring-slate-300/70"><TrashIcon className="w-4 h-4" /></button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Details View */}
        {selectedRun ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-500">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-indigo-500/5">
              <div className="flex flex-col gap-6 bg-slate-50/50 px-8 py-6 border-b border-slate-100 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow-lg shadow-indigo-200">
                    <TerminalIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{selectedRun.projectName}</h2>
                      <StatusBadge status={selectedRun.status} />
                    </div>
                    <p className="mt-1.5 text-[14px] text-slate-500">
                      {selectedRun.goals.length} 个目标 · 最近更新 {formatStamp(selectedRun.updatedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-start gap-4">
                   <div className="flex flex-col items-end">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">批次进度</span>
                      <div className="mt-1 flex items-center gap-3">
                         <div className="h-2 w-32 rounded-full bg-slate-200">
                            <div 
                              className="h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)] transition-all duration-1000" 
                              style={{ width: `${(selectedRun.goals.filter((g) => g.status === 'completed').length / selectedRun.goals.length) * 100}%` }}
                            />
                         </div>
                         <span className="text-sm font-bold text-slate-700">{Math.round((selectedRun.goals.filter((g) => g.status === 'completed').length / selectedRun.goals.length) * 100)}%</span>
                      </div>
                   </div>
                </div>
              </div>
              
              <div className="grid grid-cols-12 gap-4 border-b border-slate-100 bg-white px-8 py-4 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                <div className="col-span-1">状态</div>
                <div className="col-span-2">目标名称</div>
                <div className="col-span-3">预期产出</div>
                <div className="col-span-2">最新进展</div>
                <div className="col-span-2">执行规则</div>
                <div className="col-span-1 text-center">轮次</div>
                <div className="col-span-1 text-right">配置</div>
              </div>

              <div className="divide-y divide-slate-100">
                {selectedRun.goals.slice().sort((a, b) => a.position - b.position).map((goal: AutomationGoal) => (
                  <div key={goal.id} className="group/row">
                    <div className="grid grid-cols-12 gap-4 px-8 py-6 transition-all hover:bg-slate-50/80">
                      <div className="col-span-1 flex items-start pt-1"><StatusBadge status={goal.status} small /></div>
                      <div className="col-span-2">
                        <div className="text-[15px] font-bold text-slate-900 group-hover/row:text-indigo-600 transition-colors">{goal.title}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <span className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600 ring-1 ring-indigo-100">
                            {executionModeLabel(goal.executionMode)}
                          </span>
                        </div>
                      </div>
                      <div className="col-span-3 pr-4">
                        <p className="text-[14px] leading-relaxed text-slate-600 line-clamp-3">{goal.expectedOutcome}</p>
                      </div>
                      <div className="col-span-2 pr-4">
                        {(() => {
                          const progressText = getProgressText(goal);
                          const isExpanded = expandedProgressGoalIds[goal.id] === true;
                          const canExpand = shouldShowProgressToggle(progressText);

                          return (
                            <div className="rounded-xl border border-slate-200/60 bg-white p-3 text-[13px] leading-relaxed text-slate-500 shadow-sm ring-1 ring-slate-50 transition-all group-hover/row:shadow-md group-hover/row:ring-indigo-100">
                              {progressText ? (
                                <>
                                  <div className={cn("whitespace-pre-wrap break-words", !isExpanded && "line-clamp-2")}>
                                    {progressText}
                                  </div>
                                  {canExpand ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedProgressGoalIds((current) => ({
                                          ...current,
                                          [goal.id]: !isExpanded,
                                        }))
                                      }
                                      className="mt-2 text-[11px] font-semibold text-indigo-600 transition-colors hover:text-indigo-700"
                                    >
                                      {isExpanded ? "收起" : "展开全文"}
                                    </button>
                                  ) : null}
                                </>
                              ) : (
                                <span className="italic opacity-60">暂无进展记录...</span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="col-span-2 flex flex-wrap gap-2 content-start">
                        {summarizeRuleConfig(editedGoalRules[goal.id] ?? goal.ruleConfig).slice(0, 3).map((item) => (
                          <span key={`${goal.id}-${item}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-white">
                            {item}
                          </span>
                        ))}
                      </div>
                      <div className="col-span-1 flex items-start justify-center pt-1 font-mono font-bold text-slate-700">{goal.roundCount}</div>
                      <div className="col-span-1 flex flex-col items-end gap-2 pt-1">
                        <button 
                          onClick={() => setExpandedGoalId((current) => current === goal.id ? null : goal.id)} 
                          className={cn(
                            "flex h-8 w-8 items-center justify-center rounded-xl ring-1 ring-inset transition-all",
                            expandedGoalId === goal.id ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"
                          )}
                        >
                          <CogIcon className="w-4 h-4" />
                        </button>
                        {goal.status === "paused" ? (
                          <button onClick={() => void withBusy(`resume-${goal.id}`, async () => { const updated = await bridge.resumeAutomationGoal(goal.id); setSelectedRunId(updated.id); })} className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-500/20 hover:bg-emerald-100"><PlayIcon className="w-4 h-4" /></button>
                        ) : goal.status === "queued" ? (
                          <button onClick={() => void withBusy(`pause-${goal.id}`, async () => { const updated = await bridge.pauseAutomationGoal(goal.id); setSelectedRunId(updated.id); })} className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-500/20 hover:bg-amber-100"><PauseIcon className="w-4 h-4" /></button>
                        ) : null}
                      </div>
                      {goal.requiresAttentionReason ? (
                        <div className="col-span-12 mt-4 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-[14px] font-medium text-rose-800 animate-pulse">
                          <AlertIcon className="w-5 h-5 shrink-0" />
                          {goal.requiresAttentionReason}
                        </div>
                      ) : null}
                    </div>
                    {expandedGoalId === goal.id ? (
                      <div className="animate-in slide-in-from-top-4 duration-300">
                        <GoalRuleEditor value={editedGoalRules[goal.id] ?? goal.ruleConfig} onChange={(next) => setEditedGoalRules((current) => ({ ...current, [goal.id]: next }))} />
                        <div className="flex justify-end bg-slate-50/50 px-8 py-4 border-t border-slate-100">
                          <button 
                            onClick={() => void withBusy(`save-goal-rule-${goal.id}`, async () => { const updated = await bridge.updateAutomationGoalRuleConfig(goal.id, editedGoalRules[goal.id] ?? goal.ruleConfig); setSelectedRunId(updated.id); })} 
                            className="rounded-xl bg-indigo-600 px-6 py-2 text-[13px] font-bold text-white shadow-lg shadow-indigo-200 transition-all hover:bg-indigo-700 active:scale-[0.98]"
                          >
                            保存目标级规则
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <EventList events={selectedRun.events} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
