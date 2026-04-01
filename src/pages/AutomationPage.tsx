import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { bridge } from "../lib/bridge";
import type { AutomationEvent, AutomationGoal, AutomationGoalRuleConfig, AutomationRun } from "../lib/models";

const TITLE_FONT = {
  fontFamily: '"Noto Serif SC", "Songti SC", "STSong", serif',
} as const;

const UI_FONT = {
  fontFamily: '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
} as const;

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
    case "draft":
      return "草稿";
    case "scheduled":
      return "待开始";
    case "running":
      return "执行中";
    case "completed":
      return "已完成";
    case "paused":
      return "已暂停";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "success":
      return "成功";
    case "warning":
      return "提醒";
    case "error":
      return "异常";
    default:
      return "信息";
  }
}

function statusClass(status: string) {
  switch (status) {
    case "completed":
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "scheduled":
    case "running":
    case "info":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "paused":
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failed":
    case "cancelled":
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function summarizeRuleConfig(config: AutomationGoalRuleConfig) {
  return [
    config.allowAutoSelectStrategy ? "自动选方案" : "遇分支停下",
    config.allowSafeWorkspaceEdits ? "允许改文件" : "只读",
    config.allowSafeChecks ? "允许校验" : "禁用校验",
    `最多 ${config.maxRoundsPerGoal} 轮`,
  ];
}

function filterRuns(runs: AutomationRun[], filter: "all" | "scheduled" | "running" | "attention", query: string) {
  const q = query.trim().toLowerCase();
  return runs.filter((run) => {
    const matchesFilter =
      filter === "all"
        ? true
        : filter === "attention"
          ? run.status === "paused" || run.status === "failed"
          : run.status === filter;
    const matchesQuery =
      !q ||
      run.projectName.toLowerCase().includes(q) ||
      run.summary?.toLowerCase().includes(q) === true ||
      run.goals.some((goal) => goal.title.toLowerCase().includes(q) || goal.goal.toLowerCase().includes(q));
    return matchesFilter && matchesQuery;
  });
}

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
    <div className="grid gap-3 border-t border-gray-100 bg-gray-50/40 px-4 py-4 md:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {toggles.map(([key, label]) => (
          <label key={String(key)} className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
            <span>{label}</span>
            <input
              type="checkbox"
              checked={Boolean(value[key])}
              onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
              className="h-4 w-4 accent-gray-900"
            />
          </label>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-1">
        <input
          type="number"
          min={1}
          max={8}
          value={value.maxRoundsPerGoal}
          onChange={(event) => onChange({ ...value, maxRoundsPerGoal: Number.parseInt(event.target.value, 10) || 1 })}
          className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
        />
        <input
          type="number"
          min={1}
          max={5}
          value={value.maxConsecutiveFailures}
          onChange={(event) => onChange({ ...value, maxConsecutiveFailures: Number.parseInt(event.target.value, 10) || 1 })}
          className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
        />
        <input
          type="number"
          min={0}
          max={5}
          value={value.maxNoProgressRounds}
          onChange={(event) => onChange({ ...value, maxNoProgressRounds: Math.max(0, Number.parseInt(event.target.value, 10) || 0) })}
          className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}

function EventList({ events }: { events: AutomationEvent[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="text-xs uppercase tracking-[0.18em] text-gray-400">事件流</div>
        <div className="mt-1 text-base font-semibold text-gray-900">最近事件</div>
      </div>
      <div className="max-h-[520px] divide-y divide-gray-100 overflow-y-auto">
        {events.length ? (
          events.map((event) => (
            <div key={event.id} className="px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-gray-900">{event.title}</div>
                <span className={cn("inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]", statusClass(event.level))}>
                  {statusText(event.level)}
                </span>
              </div>
              <div className="mt-2 text-sm leading-6 text-gray-500">{event.detail}</div>
              <div className="mt-2 text-xs text-gray-400">{formatStamp(event.createdAt)}</div>
            </div>
          ))
        ) : (
          <div className="px-5 py-8 text-sm text-gray-400">当前没有可展示的事件记录。</div>
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

  async function withBusy(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
      await refreshPage();
      setError(null);
    } catch {
      setError("当前操作没有成功完成。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-full bg-[#fcfcfc] px-6 py-8 text-gray-800">
      <div className="mx-auto max-w-7xl space-y-6" style={UI_FONT}>
        <section className="border-b border-gray-100 pb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-gray-400">自动化</div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900" style={TITLE_FONT}>自动化批次</h1>
              <p className="mt-2 text-sm text-gray-500">查看批次、目标进度与目标级规则，事件流集中放在目标列表下方。</p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索项目、摘要或目标..."
                className="w-72 rounded-md border border-gray-200 bg-white px-4 py-2 outline-none focus:border-gray-300"
              />
              <button onClick={() => void refreshPage()} className="rounded-md border border-gray-200 px-4 py-2 hover:bg-gray-50">刷新</button>
              <button onClick={() => navigate("/automation/new")} className="rounded-md bg-gray-900 px-4 py-2 text-white hover:bg-gray-800">新建批次</button>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          {[
            ["待开始", runs.filter((run) => run.status === "scheduled").length, "已排队等待触发"],
            ["执行中", runs.filter((run) => run.status === "running").length, "正在后台推进"],
            ["已完成", runs.filter((run) => run.status === "completed").length, "结果已沉淀归档"],
            ["需处理", runs.filter((run) => run.status === "paused" || run.status === "failed").length, "暂停或失败的批次"],
          ].map(([label, value, helper]) => (
            <div key={String(label)} className="rounded-lg border border-gray-200 bg-white px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-gray-400">{label}</div>
              <div className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">{value}</div>
              <div className="mt-1 text-sm text-gray-500">{helper}</div>
            </div>
          ))}
        </section>

        {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <section className="flex items-center gap-6 border-b border-gray-100 pb-3 text-sm">
          <button onClick={() => setFilter("all")} className={cn("pb-3 -mb-[14px]", filter === "all" ? "border-b-2 border-gray-900 font-medium text-gray-900" : "text-gray-500 hover:text-gray-800")}>全部 ({runs.length})</button>
          <button onClick={() => setFilter("running")} className={cn("pb-3 -mb-[14px]", filter === "running" ? "border-b-2 border-gray-900 font-medium text-gray-900" : "text-gray-500 hover:text-gray-800")}>执行中 ({runs.filter((run) => run.status === "running").length})</button>
          <button onClick={() => setFilter("scheduled")} className={cn("pb-3 -mb-[14px]", filter === "scheduled" ? "border-b-2 border-gray-900 font-medium text-gray-900" : "text-gray-500 hover:text-gray-800")}>待开始 ({runs.filter((run) => run.status === "scheduled").length})</button>
          <button onClick={() => setFilter("attention")} className={cn("pb-3 -mb-[14px]", filter === "attention" ? "border-b-2 border-gray-900 font-medium text-gray-900" : "text-red-500 hover:text-red-600")}>异常 / 暂停 ({runs.filter((run) => run.status === "paused" || run.status === "failed").length})</button>
        </section>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="grid grid-cols-12 gap-4 border-b border-gray-100 bg-gray-50/50 px-5 py-3 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
            <div className="col-span-1">状态</div>
            <div className="col-span-2">批次</div>
            <div className="col-span-2">项目</div>
            <div className="col-span-1">目标数</div>
            <div className="col-span-2">计划开始</div>
            <div className="col-span-3">执行摘要</div>
            <div className="col-span-1 text-right">操作</div>
          </div>
          <div className="divide-y divide-gray-100">
            {loading ? (
              <div className="px-5 py-8 text-sm text-gray-400">正在加载批次...</div>
            ) : filteredRuns.length === 0 ? (
              <div className="px-5 py-8 text-sm text-gray-400">没有匹配的自动化批次。</div>
            ) : (
              filteredRuns.map((run) => (
                <button key={run.id} onClick={() => setSelectedRunId(run.id)} className={cn("grid w-full grid-cols-12 gap-4 px-5 py-4 text-left transition hover:bg-gray-50/80", selectedRunId === run.id && "bg-gray-50")}>
                  <div className="col-span-1"><span className={cn("inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]", statusClass(run.status))}>{statusText(run.status)}</span></div>
                  <div className="col-span-2 text-sm font-medium text-gray-900">{run.id.slice(0, 12)}</div>
                  <div className="col-span-2 text-sm text-gray-700">{run.projectName}</div>
                  <div className="col-span-1 text-sm text-gray-600">{run.goals.length}</div>
                  <div className="col-span-2 text-sm text-gray-500">{formatStamp(run.scheduledStartAt ?? run.createdAt)}</div>
                  <div className="col-span-3 text-sm text-gray-500">{run.summary ?? "等待执行摘要..."}</div>
                  <div className="col-span-1 flex justify-end">
                    {run.status === "draft" ? (
                      <button onClick={(event) => { event.stopPropagation(); void withBusy(`start-${run.id}`, async () => { const updated = await bridge.startAutomationRun(run.id); setSelectedRunId(updated.id); }); }} className="text-xs text-gray-600 hover:text-gray-900">开始</button>
                    ) : !["completed", "cancelled"].includes(run.status) ? (
                      <button onClick={(event) => { event.stopPropagation(); void withBusy(`cancel-${run.id}`, async () => { const updated = await bridge.cancelAutomationRun(run.id); setSelectedRunId(updated.id); }); }} className="text-xs text-gray-600 hover:text-red-600">取消</button>
                    ) : <span className="text-xs text-gray-300">-</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {selectedRun ? (
          <div className="space-y-6">
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="flex items-end justify-between gap-4 border-b border-gray-100 px-5 py-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-gray-400">当前批次</div>
                  <div className="mt-1 text-xl font-semibold text-gray-900" style={TITLE_FONT}>{selectedRun.projectName}</div>
                  <div className="mt-2 text-sm text-gray-500">{selectedRun.summary ?? "该批次正在等待更多进展后生成摘要。"}</div>
                </div>
                <span className={cn("inline-flex rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]", statusClass(selectedRun.status))}>{statusText(selectedRun.status)}</span>
              </div>
              <div className="grid grid-cols-12 gap-4 border-b border-gray-100 bg-gray-50/50 px-5 py-3 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
                <div className="col-span-1">状态</div>
                <div className="col-span-2">目标</div>
                <div className="col-span-3">期望结果</div>
                <div className="col-span-2">最新进展</div>
                <div className="col-span-2">目标规则</div>
                <div className="col-span-1">轮次</div>
                <div className="col-span-1 text-right">操作</div>
              </div>
              <div className="divide-y divide-gray-100">
                {selectedRun.goals.slice().sort((a, b) => a.position - b.position).map((goal: AutomationGoal) => (
                  <div key={goal.id}>
                    <div className="grid grid-cols-12 gap-4 px-5 py-4 hover:bg-gray-50/80">
                      <div className="col-span-1"><span className={cn("inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]", statusClass(goal.status))}>{statusText(goal.status)}</span></div>
                      <div className="col-span-2">
                        <div className="text-sm font-medium text-gray-900">{goal.title}</div>
                        <div className="mt-1 text-xs text-gray-400">{goal.lastOwnerCli ?? "未分配"}</div>
                      </div>
                      <div className="col-span-3 text-sm leading-6 text-gray-600">{goal.expectedOutcome}</div>
                      <div className="col-span-2 text-sm leading-6 text-gray-600">{goal.latestProgressSummary ?? goal.resultSummary ?? "暂无进展摘要"}</div>
                      <div className="col-span-2 flex flex-wrap gap-2">
                        {summarizeRuleConfig(editedGoalRules[goal.id] ?? goal.ruleConfig).slice(0, 3).map((item) => (
                          <span key={`${goal.id}-${item}`} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-600">{item}</span>
                        ))}
                      </div>
                      <div className="col-span-1 text-sm text-gray-600">{goal.roundCount}</div>
                      <div className="col-span-1 flex justify-end gap-3 text-xs">
                        <button onClick={() => setExpandedGoalId((current) => current === goal.id ? null : goal.id)} className="text-gray-600 hover:text-gray-900">规则</button>
                        {goal.status === "paused" ? (
                          <button onClick={() => void withBusy(`resume-${goal.id}`, async () => { const updated = await bridge.resumeAutomationGoal(goal.id); setSelectedRunId(updated.id); })} className="text-gray-600 hover:text-gray-900">继续</button>
                        ) : goal.status === "queued" ? (
                          <button onClick={() => void withBusy(`pause-${goal.id}`, async () => { const updated = await bridge.pauseAutomationGoal(goal.id); setSelectedRunId(updated.id); })} className="text-gray-600 hover:text-gray-900">暂停</button>
                        ) : null}
                      </div>
                      {goal.requiresAttentionReason ? <div className="col-span-12 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">{goal.requiresAttentionReason}</div> : null}
                    </div>
                    {expandedGoalId === goal.id ? (
                      <div>
                        <GoalRuleEditor value={editedGoalRules[goal.id] ?? goal.ruleConfig} onChange={(next) => setEditedGoalRules((current) => ({ ...current, [goal.id]: next }))} />
                        <div className="flex justify-end border-t border-gray-100 px-4 py-3">
                          <button onClick={() => void withBusy(`save-goal-rule-${goal.id}`, async () => { const updated = await bridge.updateAutomationGoalRuleConfig(goal.id, editedGoalRules[goal.id] ?? goal.ruleConfig); setSelectedRunId(updated.id); })} className="rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white hover:bg-gray-800">
                            保存目标规则
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
