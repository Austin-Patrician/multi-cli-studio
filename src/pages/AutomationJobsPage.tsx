import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { bridge } from "../lib/bridge";
import type { AutomationJob, AutomationRunDetail, AutomationRunRecord, ChatMessage } from "../lib/models";
import refreshIcon from "../media/svg/refresh.svg";
import { cn, executionModeLabel, formatDuration, formatStamp, isActiveRunStatus } from "./automationUi";
import {
  AutomationRunConversationSection,
  AutomationRunSnapshotSection,
  StatusBadge,
} from "./AutomationRunDetailSections";

const PlusIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const PlayIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path
      d="M7 6.8c0-.79.86-1.29 1.56-.9l8.1 4.62a1.03 1.03 0 010 1.8l-8.1 4.62c-.7.39-1.56-.11-1.56-.9V6.8z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

const SearchIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SettingsIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function summarizeRuns(runs: AutomationRunRecord[]) {
  return {
    total: runs.length,
    running: runs.filter((run) => run.lifecycleStatus === "running").length,
    attention: runs.filter((run) => run.attentionStatus !== "none" || run.outcomeStatus === "failed").length,
  };
}

function sortRunsNewestFirst(runs: AutomationRunRecord[]) {
  return [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

const JOBS_PAGE_SIZE = 8;

function buttonClass(
  variant: "primary" | "secondary" | "danger" | "warning",
  size: "icon" | "sm" | "md" = "sm"
) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[16px] font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = {
    icon: "h-[46px] w-[46px]",
    sm: "h-9 px-4 text-xs",
    md: "h-[46px] px-5 text-sm",
  };
  const variants = {
    primary: "bg-slate-900 text-white shadow-sm hover:bg-slate-800 active:scale-95",
    secondary:
      "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 active:scale-95",
    danger:
      "border border-rose-200 bg-rose-50 text-rose-700 shadow-sm hover:bg-rose-100 active:scale-95",
    warning:
      "bg-amber-400 text-slate-950 shadow-sm hover:bg-amber-300 active:scale-95",
  };
  return `${base} ${sizes[size]} ${variants[variant]}`;
}

function OverviewCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[16px] border border-slate-200 bg-slate-50 p-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-3 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export function AutomationJobsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [runs, setRuns] = useState<AutomationRunRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AutomationRunDetail | null>(null);
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  async function refresh() {
    try {
      const [nextJobs, nextRuns] = await Promise.all([bridge.listAutomationJobs(), bridge.listAutomationJobRuns(null)]);
      setJobs(nextJobs);
      setRuns(nextRuns);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载自动化任务失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(id);
  }, []);

  const filteredJobs = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return jobs;
    return jobs.filter((job) =>
      [job.name, job.projectName, job.description ?? "", job.goal, job.expectedOutcome]
        .join("\n")
        .toLowerCase()
        .includes(keyword)
    );
  }, [jobs, query]);

  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / JOBS_PAGE_SIZE));
  const pagedJobs = useMemo(() => {
    const start = (currentPage - 1) * JOBS_PAGE_SIZE;
    return filteredJobs.slice(start, start + JOBS_PAGE_SIZE);
  }, [currentPage, filteredJobs]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    const locationJobId = (location.state as { selectedJobId?: string } | null)?.selectedJobId ?? null;
    if (filteredJobs.length === 0) {
      setSelectedJobId(null);
      return;
    }
    if (locationJobId && filteredJobs.some((job) => job.id === locationJobId)) {
      setSelectedJobId(locationJobId);
      return;
    }
    if (!selectedJobId || !filteredJobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(pagedJobs[0]?.id ?? filteredJobs[0].id);
    }
  }, [filteredJobs, location.state, pagedJobs, selectedJobId]);

  useEffect(() => {
    if (!selectedJobId) return;
    const index = filteredJobs.findIndex((job) => job.id === selectedJobId);
    if (index < 0) return;
    const targetPage = Math.floor(index / JOBS_PAGE_SIZE) + 1;
    if (targetPage !== currentPage) {
      setCurrentPage(targetPage);
    }
  }, [currentPage, filteredJobs, selectedJobId]);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId]
  );

  const latestRunForSelectedJob = useMemo(
    () => sortRunsNewestFirst(runs.filter((run) => run.jobId === selectedJobId))[0] ?? null,
    [runs, selectedJobId]
  );

  useEffect(() => {
    if (!latestRunForSelectedJob) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      setLiveMessages([]);
      return;
    }

    const runId = latestRunForSelectedJob.id;
    let cancelled = false;

    async function loadDetail() {
      if (!cancelled) setDetailLoading(true);
      try {
        const nextDetail = await bridge.getAutomationRunDetail(runId);
        if (cancelled) return;
        setDetail(nextDetail);
        setLiveMessages(nextDetail.conversationSession?.messages ?? []);
        setDetailError(null);
      } catch (nextError) {
        if (!cancelled) {
          setDetailError(nextError instanceof Error ? nextError.message : "加载运行详情失败。");
          setDetail(null);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [latestRunForSelectedJob?.id]);

  useEffect(() => {
    const terminalTabId = detail?.run.terminalTabId;
    if (!terminalTabId) return;
    let cancelled = false;
    let unlisten = () => {};

    void bridge.onStream((event) => {
      if (cancelled || event.terminalTabId !== terminalTabId) return;
      setLiveMessages((current) => {
        const next = [...current];
        const index = next.findIndex((message) => message.id === event.messageId);
        if (index === -1) {
          next.push({
            id: event.messageId,
            role: "assistant",
            cliId: null,
            timestamp: new Date().toISOString(),
            content: event.done ? event.finalContent ?? event.chunk : event.chunk,
            rawContent: event.done ? event.finalContent ?? event.chunk : event.chunk,
            contentFormat: event.contentFormat ?? "log",
            transportKind: event.transportKind ?? null,
            blocks: event.blocks ?? null,
            isStreaming: !event.done,
            durationMs: event.durationMs ?? null,
            exitCode: event.exitCode ?? null,
          });
          return next;
        }

        const existing = next[index];
        const accumulated = `${existing.rawContent ?? existing.content ?? ""}${event.done ? "" : event.chunk}`;
        next[index] = {
          ...existing,
          rawContent: event.done
            ? existing.rawContent ?? existing.content ?? accumulated
            : accumulated,
          content: event.done
            ? existing.content || existing.rawContent || accumulated
            : accumulated,
          contentFormat: event.contentFormat ?? existing.contentFormat ?? "log",
          transportKind: event.transportKind ?? existing.transportKind ?? null,
          blocks: event.blocks ?? existing.blocks ?? null,
          isStreaming: !event.done,
          durationMs: event.durationMs ?? existing.durationMs ?? null,
          exitCode: event.exitCode ?? existing.exitCode ?? null,
        };
        return next;
      });
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      cancelled = true;
      unlisten();
    };
  }, [detail?.run.terminalTabId]);

  useEffect(() => {
    if (!latestRunForSelectedJob || !detail || !isActiveRunStatus(detail.run.status)) return;
    const runId = latestRunForSelectedJob.id;
    const id = window.setInterval(() => {
      void bridge
        .getAutomationRunDetail(runId)
        .then((nextDetail) => {
          setDetail(nextDetail);
          setDetailError(null);
        })
        .catch((nextError) => {
          setDetailError(nextError instanceof Error ? nextError.message : "加载运行详情失败。");
        });
    }, 2500);
    return () => window.clearInterval(id);
  }, [detail, latestRunForSelectedJob?.id]);

  const stats = useMemo(() => summarizeRuns(runs), [runs]);

  async function withBusy(key: string, action: () => Promise<void>) {
    setBusyKey(key);
    try {
      await action();
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "操作失败。");
    } finally {
      setBusyKey(null);
    }
  }

  async function runJob(job: AutomationJob) {
    await bridge.createAutomationRunFromJob({ jobId: job.id });
    setSelectedJobId(job.id);
    await refresh();
  }

  async function deleteSelectedJob() {
    if (!selectedJob) return;
    if (!window.confirm(`确认删除任务“${selectedJob.name}”吗？`)) return;
    await bridge.deleteAutomationJob(selectedJob.id);
    setSelectedJobId(null);
    setDetail(null);
    await refresh();
  }

  async function deleteLatestRun() {
    if (!latestRunForSelectedJob) return;
    if (!window.confirm("确认删除这条运行记录吗？")) return;
    await bridge.deleteAutomationRun(latestRunForSelectedJob.id);
    setDetail(null);
    await refresh();
  }

  function runActionGroup() {
    if (!latestRunForSelectedJob) return null;

    const status = latestRunForSelectedJob.status;
    const actions: ReactNode[] = [];

    if (status === "scheduled" || status === "running") {
      actions.push(
        <button
          key="pause"
          type="button"
          onClick={() =>
            void withBusy(`pause-${latestRunForSelectedJob.id}`, async () => {
              await bridge.pauseAutomationRun(latestRunForSelectedJob.id);
            })
          }
          disabled={busyKey === `pause-${latestRunForSelectedJob.id}`}
          className={buttonClass("warning")}
        >
          暂停
        </button>
      );
      actions.push(
        <button
          key="cancel"
          type="button"
          onClick={() =>
            void withBusy(`cancel-${latestRunForSelectedJob.id}`, async () => {
              await bridge.cancelAutomationRun(latestRunForSelectedJob.id);
            })
          }
          disabled={busyKey === `cancel-${latestRunForSelectedJob.id}`}
          className={buttonClass("danger")}
        >
          取消
        </button>
      );
    } else if (status === "paused") {
      actions.push(
        <button
          key="resume"
          type="button"
          onClick={() =>
            void withBusy(`resume-${latestRunForSelectedJob.id}`, async () => {
              await bridge.resumeAutomationRun(latestRunForSelectedJob.id);
            })
          }
          disabled={busyKey === `resume-${latestRunForSelectedJob.id}`}
          className={buttonClass("primary")}
        >
          继续
        </button>
      );
      actions.push(
        <button
          key="cancel"
          type="button"
          onClick={() =>
            void withBusy(`cancel-${latestRunForSelectedJob.id}`, async () => {
              await bridge.cancelAutomationRun(latestRunForSelectedJob.id);
            })
          }
          disabled={busyKey === `cancel-${latestRunForSelectedJob.id}`}
          className={buttonClass("danger")}
        >
          取消
        </button>
      );
    } else {
      actions.push(
        <button
          key="restart"
          type="button"
          onClick={() =>
            void withBusy(`restart-${latestRunForSelectedJob.id}`, async () => {
              await bridge.restartAutomationRun(latestRunForSelectedJob.id);
            })
          }
          disabled={busyKey === `restart-${latestRunForSelectedJob.id}`}
          className={buttonClass("primary")}
        >
          重跑
        </button>
      );
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      actions.push(
        <button
          key="delete-run"
          type="button"
          onClick={() => void withBusy(`delete-run-${latestRunForSelectedJob.id}`, deleteLatestRun)}
          disabled={busyKey === `delete-run-${latestRunForSelectedJob.id}`}
          className={buttonClass("secondary")}
        >
          删除记录
        </button>
      );
    }

    return actions;
  }

  function displayDuration(run: AutomationRunRecord) {
    const end = run.status === "paused" ? run.updatedAt : run.completedAt;
    return formatDuration(run.startedAt, end);
  }

  function goToPage(page: number) {
    const nextPage = Math.min(totalPages, Math.max(1, page));
    setCurrentPage(nextPage);
    const start = (nextPage - 1) * JOBS_PAGE_SIZE;
    const nextJob = filteredJobs[start];
    if (nextJob) {
      setSelectedJobId(nextJob.id);
    }
  }

  return (
    <div className="h-full overflow-hidden bg-slate-50/50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-full max-w-[96rem] min-h-0 flex-col gap-6">
        <section className="flex shrink-0 flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">自动化任务</h1>
              <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sky-700">CLI Automation</span>
            </div>
            <p className="text-sm text-slate-500">左侧选择任务，右侧直接查看最近一次运行的概览与执行日志。</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void refresh()}
              className={cn(buttonClass("secondary", "icon"), "text-slate-600")}
              title="刷新状态"
            >
              <img src={refreshIcon} alt="" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => navigate("/automation/jobs/new")}
              className={buttonClass("primary", "md")}
            >
              <PlusIcon className="h-4 w-4" />
              新建任务
            </button>
          </div>
        </section>

        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}

        <section className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="shrink-0 space-y-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold tracking-tight text-slate-900">任务列表</h2>
                  <div className="flex items-center gap-2 text-[11px] font-semibold">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">任务 {jobs.length}</span>
                    <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-700">运行中 {stats.running}</span>
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">需关注 {stats.attention}</span>
                  </div>
                </div>
                {/* <p className="text-sm text-slate-500">选择任务后，右侧显示它最近一次运行的结果。</p> */}
              </div>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索任务名称、目标..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                />
              </div>
            </div>

            <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
              {loading ? (
                <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">正在加载任务...</div>
              ) : filteredJobs.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">当前没有匹配的自动化任务。</div>
              ) : (
                <div className="space-y-2">
                {pagedJobs.map((job) => {
                  const latestRun = sortRunsNewestFirst(runs.filter((run) => run.jobId === job.id))[0] ?? null;
                  const isSelected = selectedJobId === job.id;
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => setSelectedJobId(job.id)}
                      className={cn(
                        "w-full rounded-[14px] border px-4 py-4 text-left transition",
                        isSelected ? "border-sky-300 bg-sky-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-900" title={job.name}>{job.name}</span>
                            <span className="shrink-0 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600 ring-1 ring-slate-200">
                              {executionModeLabel(job.defaultExecutionMode)}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-xs text-slate-500">{job.projectName}</div>
                        </div>
        {latestRun ? <StatusBadge status={latestRun.displayStatus} /> : <span className="text-[11px] text-slate-400">未运行</span>}
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                        <span>{job.cronExpression?.trim() ? "Cron 定时" : "手动触发"}</span>
                        <span>{latestRun ? formatStamp(latestRun.createdAt) : "-"}</span>
                      </div>
                      <div className="mt-4 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void withBusy(`run-${job.id}`, async () => {
                              await runJob(job);
                            });
                          }}
                          disabled={busyKey === `run-${job.id}`}
                          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[14px] bg-slate-900 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
                        >
                          <PlayIcon className="h-4 w-4" />
                          运行
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/automation/jobs/${job.id}`);
                          }}
                          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                        >
                          <SettingsIcon className="h-3.5 w-3.5 text-slate-400" />
                          配置
                        </button>
                      </div>
                    </button>
                  );
                })}
                </div>
              )}
            </div>

            <div className="mt-4 flex shrink-0 items-center justify-between border-t border-slate-100 pt-4">
              <div className="text-xs text-slate-500">
                第 {currentPage} / {totalPages} 页
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className={buttonClass("secondary")}
                >
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className={buttonClass("secondary")}
                >
                  下一页
                </button>
              </div>
            </div>
          </aside>

          <section className="flex min-h-0 flex-col gap-6">
            {!selectedJob ? (
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-[20px] border border-dashed border-slate-300 bg-white px-6 py-20 text-center text-sm text-slate-500 shadow-sm">
                先从左侧选择一个任务，右侧会显示该任务最近一次运行的执行日志。
              </div>
            ) : !latestRunForSelectedJob ? (
              <div className="flex min-h-0 flex-1 flex-col rounded-[20px] border border-slate-200 bg-white p-8 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{selectedJob.name}</h2>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                        {executionModeLabel(selectedJob.defaultExecutionMode)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-7 text-slate-500">{selectedJob.description || selectedJob.goal}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => navigate(`/automation/jobs/${selectedJob.id}`)}
                      className={buttonClass("secondary")}
                    >
                      编辑任务
                    </button>
                    <button
                      type="button"
                      onClick={() => void withBusy(`delete-job-${selectedJob.id}`, deleteSelectedJob)}
                      disabled={busyKey === `delete-job-${selectedJob.id}`}
                      className={buttonClass("danger")}
                    >
                      删除任务
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void withBusy(`run-${selectedJob.id}`, async () => {
                          await runJob(selectedJob);
                        })
                      }
                      disabled={busyKey === `run-${selectedJob.id}`}
                      className={buttonClass("primary")}
                    >
                      立即运行
                    </button>
                  </div>
                </div>
                <div className="mt-8 rounded-[16px] border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
                  该任务还没有运行记录。点击“立即运行”后，这里会直接显示完整执行日志。
                </div>
              </div>
            ) : (
              <>
                <div className="shrink-0 rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="space-y-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex items-center gap-3">
                        <h2 className="truncate text-xl font-bold tracking-tight text-slate-900">{selectedJob.name}</h2>
                        <StatusBadge status={latestRunForSelectedJob.displayStatus} />
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-medium text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400">工作区</span>
                          <span className="text-slate-700">{selectedJob.projectName}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400">模型</span>
                          <span className="text-slate-700">{executionModeLabel(selectedJob.defaultExecutionMode)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400">触发</span>
                          <span className="text-slate-700">{latestRunForSelectedJob.triggerSource || "manual"} ({selectedJob.cronExpression?.trim() ? "Cron" : "手动"})</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400">耗时</span>
                          <span className="text-slate-700">{displayDuration(latestRunForSelectedJob)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400">开始于</span>
                          <span className="text-slate-700">{formatStamp(latestRunForSelectedJob.startedAt || latestRunForSelectedJob.scheduledStartAt)}</span>
                        </div>
                      </div>

                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void withBusy(`run-${selectedJob.id}`, async () => {
                            await runJob(selectedJob);
                          })
                        }
                        disabled={busyKey === `run-${selectedJob.id}`}
                        className={buttonClass("primary")}
                      >
                        启动新运行
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/automation/jobs/${selectedJob.id}`)}
                        className={buttonClass("secondary")}
                      >
                        配置
                      </button>
                      <div className="h-4 w-px bg-slate-200 mx-1"></div>
                      {runActionGroup()}
                      </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="min-w-0 rounded-[16px] bg-slate-50 p-3">
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">任务目标</div>
                        <div className="line-clamp-2 text-xs leading-relaxed text-slate-700" title={detail?.goal ?? selectedJob.goal}>
                          {detail?.goal ?? selectedJob.goal}
                        </div>
                      </div>
                      <div className="min-w-0 rounded-[16px] bg-slate-50 p-3">
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">期望结果</div>
                        <div className="line-clamp-2 text-xs leading-relaxed text-slate-700" title={detail?.expectedOutcome ?? selectedJob.expectedOutcome}>
                          {detail?.expectedOutcome ?? selectedJob.expectedOutcome}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {detailError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{detailError}</div>
                ) : null}

                {detailLoading || !detail ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center rounded-[28px] border border-slate-200 bg-white p-12 text-center text-sm text-slate-400 shadow-sm">正在加载执行日志...</div>
                ) : (
                  <>
                    <div className="min-h-0 flex-1">
                      <AutomationRunConversationSection messages={liveMessages} title="执行日志" />
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </section>
      </div>
    </div>
  );
}
