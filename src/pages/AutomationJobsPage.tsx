import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { bridge } from "../lib/bridge";
import type {
  AutomationGoalRuleConfig,
  AutomationJob,
  AutomationRunDetail,
  AutomationRunRecord,
  AutomationValidationResult,
  ChatMessage,
} from "../lib/models";
import refreshIcon from "../media/svg/refresh.svg";
import { cn, executionModeLabel, formatDuration, formatStamp, isActiveRunStatus } from "./automationUi";
import {
  AutomationRunConversationSection,
  AutomationRunSnapshotSection,
  StatusBadge,
} from "./AutomationRunDetailSections";
import { buildAutomationConversationLog } from "./automationLog";

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

const CloseIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M16.5 7.5l-9 9m0-9l9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const DownloadIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M9 7V5.75A1.75 1.75 0 0110.75 4h2.5A1.75 1.75 0 0115 5.75V7m-9 0h12m-1 0l-.62 9.07A2 2 0 0114.38 18H9.62a2 2 0 01-1.99-1.93L7 7m3 3.5v4m4-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PauseIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M9 6.75v10.5M15 6.75v10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const RestartIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M20 11a8 8 0 10-2.34 5.66M20 7v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChevronDownIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const StopIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="7" y="7" width="10" height="10" rx="1.75" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

function summarizeRuns(runs: AutomationRunRecord[]) {
  return {
    total: runs.length,
    running: runs.filter((run) => run.displayStatus === "running" || run.displayStatus === "validating").length,
    attention: runs.filter((run) => run.displayStatus === "blocked" || run.displayStatus === "failed").length,
  };
}

function sortRunsNewestFirst(runs: AutomationRunRecord[]) {
  return [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function validationDecisionLabel(decision?: AutomationValidationResult["decision"]) {
  switch (decision) {
    case "pass":
      return "通过";
    case "blocked":
      return "阻塞";
    case "fail_with_feedback":
      return "未通过";
    default:
      return "待确认";
  }
}

function cleanValidationText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanValidationList(values?: string[] | null) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
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

function headerIconButtonClass(variant: "primary" | "secondary" | "danger" | "warning") {
  return cn(buttonClass(variant, "icon"), "h-10 w-10 rounded-[14px]");
}

function jobCardClass(status?: string | null, isSelected = false) {
  const stateTone = (() => {
    switch (status) {
      case "completed":
        return "border-emerald-200 bg-emerald-50 hover:border-emerald-300";
      case "running":
        return "border-sky-200 bg-sky-50 hover:border-sky-300";
      case "validating":
        return "border-indigo-200 bg-indigo-50 hover:border-indigo-300";
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

function OverviewCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-4">
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
  const [jobPendingDelete, setJobPendingDelete] = useState<AutomationJob | null>(null);
  const [runPendingDelete, setRunPendingDelete] = useState<AutomationRunRecord | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [validationExpanded, setValidationExpanded] = useState(false);

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

  useEffect(() => {
    if (!actionNotice) return;
    const id = window.setTimeout(() => setActionNotice(null), 3500);
    return () => window.clearTimeout(id);
  }, [actionNotice]);

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
  const detailMatchesLatestRun = detail?.run.id === latestRunForSelectedJob?.id;
  const activeRuleConfig: AutomationGoalRuleConfig | null = detailMatchesLatestRun
    ? detail?.ruleConfig ?? selectedJob?.ruleConfig ?? null
    : selectedJob?.ruleConfig ?? null;
  const activeValidation: AutomationValidationResult | null = detailMatchesLatestRun
    ? detail?.run.validationResult ?? latestRunForSelectedJob?.validationResult ?? null
    : latestRunForSelectedJob?.validationResult ?? null;
  const validationReason = cleanValidationText(activeValidation?.reason);
  const validationFeedback = cleanValidationText(activeValidation?.feedback);
  const validationEvidence = cleanValidationText(activeValidation?.evidenceSummary);
  const validationMissingChecks = cleanValidationList(activeValidation?.missingChecks);
  const validationVerificationSteps = cleanValidationList(activeValidation?.verificationSteps);
  const validationSummaryText = validationReason ?? validationFeedback ?? "暂无验收说明。";

  useEffect(() => {
    if (!latestRunForSelectedJob) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      setLiveMessages([]);
      setValidationExpanded(false);
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

  useEffect(() => {
    setValidationExpanded(false);
  }, [latestRunForSelectedJob?.id]);

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
    setActionNotice(null);
    await bridge.createAutomationRunFromJob({ jobId: job.id });
    setSelectedJobId(job.id);
    await refresh();
  }

  async function deleteJob(job: AutomationJob) {
    setActionNotice(null);
    await bridge.deleteAutomationJob(job.id);
    if (selectedJobId === job.id) {
      setSelectedJobId(null);
      setDetail(null);
    }
    setJobPendingDelete(null);
    await refresh();
  }

  async function deleteLatestRun(run: AutomationRunRecord) {
    setActionNotice(null);
    await bridge.deleteAutomationRun(run.id);
    setDetail(null);
    setRunPendingDelete(null);
    await refresh();
  }

  async function downloadLatestRunLog() {
    if (!latestRunForSelectedJob) return;
    const logText = buildAutomationConversationLog(liveMessages);
    const safeName = (selectedJob?.name ?? latestRunForSelectedJob.jobName ?? "automation-run")
      .replace(/[<>:\"/\\|?*\u0000-\u001F]/g, "-")
      .trim();
    const fileName = `${safeName || "automation-run"}-${latestRunForSelectedJob.id}.log.txt`;
    const savedTo = await bridge.saveTextToDownloads(fileName, logText || "当前没有可导出的执行日志。");
    setActionNotice(savedTo.startsWith("browser-download:") ? `日志已开始下载：${fileName}` : `日志已保存到：${savedTo}`);
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
          className={headerIconButtonClass("warning")}
          title="暂停"
          aria-label="暂停"
        >
          <PauseIcon className="h-4 w-4" />
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
          className={headerIconButtonClass("danger")}
          title="取消"
          aria-label="取消"
        >
          <StopIcon className="h-4 w-4" />
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
          className={headerIconButtonClass("primary")}
          title="继续"
          aria-label="继续"
        >
          <PlayIcon className="h-4 w-4" />
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
          className={headerIconButtonClass("danger")}
          title="取消"
          aria-label="取消"
        >
          <StopIcon className="h-4 w-4" />
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
          className={headerIconButtonClass("primary")}
          title="重跑"
          aria-label="重跑"
        >
          <RestartIcon className="h-4 w-4" />
        </button>
      );
    }

    return actions;
  }

  function displayDuration(run: AutomationRunRecord) {
    const end = run.status === "paused" || run.displayStatus === "blocked" ? run.updatedAt : run.completedAt;
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
              {/* <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sky-700">CLI Automation</span> */}
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
              className={headerIconButtonClass("primary")}
              title="新建任务"
              aria-label="新建任务"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
        </section>

        {error ? <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div> : null}
        {actionNotice ? <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{actionNotice}</div> : null}

        <section className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col rounded-[10px] border border-slate-200 bg-white p-5 shadow-sm">
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
                <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">正在加载任务...</div>
              ) : filteredJobs.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">当前没有匹配的自动化任务。</div>
              ) : (
                <div className="space-y-2">
                {pagedJobs.map((job) => {
                  const latestRun = sortRunsNewestFirst(runs.filter((run) => run.jobId === job.id))[0] ?? null;
                  const isSelected = selectedJobId === job.id;
                  return (
                    <div
                      key={job.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedJobId(job.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedJobId(job.id);
                        }
                      }}
                      className={cn(
                        "relative w-full rounded-[10px] border px-4 py-4 text-left transition",
                        jobCardClass(latestRun?.displayStatus, isSelected)
                      )}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setJobPendingDelete(job);
                        }}
                        className="absolute right-2.5 top-2.5 inline-flex h-5 w-5 items-center justify-center text-slate-300 transition hover:text-rose-600"
                        title={`删除任务 ${job.name}`}
                        aria-label={`删除任务 ${job.name}`}
                      >
                        <CloseIcon className="h-3.5 w-3.5" />
                      </button>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 pr-5">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-slate-900" title={job.name}>{job.name}</span>
                            <span className="shrink-0 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600 ring-1 ring-slate-200">
                              {executionModeLabel(job.defaultExecutionMode)}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-xs text-slate-500">{job.projectName}</div>
                        </div>
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
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] bg-slate-900 text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
                          title={`运行任务 ${job.name}`}
                          aria-label={`运行任务 ${job.name}`}
                        >
                          <PlayIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/automation/jobs/${job.id}`);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
                          title={`配置任务 ${job.name}`}
                          aria-label={`配置任务 ${job.name}`}
                        >
                          <SettingsIcon className="h-3.5 w-3.5 text-slate-400" />
                        </button>
                      </div>
                    </div>
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
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-[10px] border border-dashed border-slate-300 bg-white px-6 py-20 text-center text-sm text-slate-500 shadow-sm">
                先从左侧选择一个任务，右侧会显示该任务最近一次运行的执行日志。
              </div>
            ) : !latestRunForSelectedJob ? (
              <div className="flex min-h-0 flex-1 flex-col rounded-[10px] border border-slate-200 bg-white p-8 shadow-sm">
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/automation/jobs/${selectedJob.id}`)}
                      className={headerIconButtonClass("secondary")}
                      title="编辑任务"
                      aria-label="编辑任务"
                    >
                      <SettingsIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setJobPendingDelete(selectedJob)}
                      disabled={busyKey === `delete-job-${selectedJob.id}`}
                      className={headerIconButtonClass("danger")}
                      title="删除任务"
                      aria-label="删除任务"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void withBusy(`run-${selectedJob.id}`, async () => {
                          await runJob(selectedJob);
                        })
                      }
                      disabled={busyKey === `run-${selectedJob.id}`}
                      className={headerIconButtonClass("primary")}
                      title="立即运行"
                      aria-label="立即运行"
                    >
                      <PlayIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-8 rounded-[10px] border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
                  该任务还没有运行记录。点击右上角运行按钮后，这里会直接显示完整执行日志。
                </div>
              </div>
            ) : (
              <>
                <div className="shrink-0 rounded-[10px] border border-slate-200 bg-white p-5 shadow-sm">
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
                        {activeRuleConfig ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400">轮次上限</span>
                            <span className="text-slate-700">
                              {activeRuleConfig.maxRoundsPerGoal}
                            </span>
                          </div>
                        ) : null}
                        {activeRuleConfig ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400">连续失败上限</span>
                            <span className="text-slate-700">{activeRuleConfig.maxConsecutiveFailures}</span>
                          </div>
                        ) : null}
                        {activeValidation?.decision ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400">最近验收</span>
                            <span className="text-slate-700">{validationDecisionLabel(activeValidation.decision)}</span>
                          </div>
                        ) : null}
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
                        className={headerIconButtonClass("primary")}
                        title="启动新运行"
                        aria-label="启动新运行"
                      >
                        <PlayIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/automation/jobs/${selectedJob.id}`)}
                        className={headerIconButtonClass("secondary")}
                        title="配置"
                        aria-label="配置"
                      >
                        <SettingsIcon className="h-4 w-4" />
                      </button>
                      <div className="h-4 w-px bg-slate-200 mx-1"></div>
                      {runActionGroup()}
                      </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="min-w-0 rounded-[10px] bg-slate-50 p-3">
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">任务目标</div>
                        <div className="line-clamp-2 text-xs leading-relaxed text-slate-700" title={detail?.goal ?? selectedJob.goal}>
                          {detail?.goal ?? selectedJob.goal}
                        </div>
                      </div>
                      <div className="min-w-0 rounded-[10px] bg-slate-50 p-3">
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">期望结果</div>
                        <div className="line-clamp-2 text-xs leading-relaxed text-slate-700" title={detail?.expectedOutcome ?? selectedJob.expectedOutcome}>
                          {detail?.expectedOutcome ?? selectedJob.expectedOutcome}
                        </div>
                      </div>
                    </div>

                    {validationReason
                    || validationMissingChecks.length > 0
                    || validationVerificationSteps.length > 0
                    || validationFeedback
                    || validationEvidence ? (
                      <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">最近验收</div>
                            <div className="text-xs leading-relaxed text-slate-700">{validationSummaryText}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setValidationExpanded((current) => !current)}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50"
                            title={validationExpanded ? "收起最近验收" : "展开最近验收"}
                            aria-label={validationExpanded ? "收起最近验收" : "展开最近验收"}
                          >
                            <ChevronDownIcon className={cn("h-3.5 w-3.5 transition-transform", validationExpanded && "rotate-180")} />
                          </button>
                        </div>
                        {!validationExpanded ? (
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">
                              结论：{validationDecisionLabel(activeValidation?.decision)}
                            </span>
                            <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">
                              未满足项：{validationMissingChecks.length}
                            </span>
                            <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">
                              建议步骤：{validationVerificationSteps.length}
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="mt-3 grid gap-3 lg:grid-cols-3">
                              <div className="rounded-[10px] bg-white/80 p-3">
                                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">结论</div>
                                <div className="text-xs leading-relaxed text-slate-700">{validationSummaryText}</div>
                              </div>
                              <div className="rounded-[10px] bg-white/80 p-3">
                                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">未满足项</div>
                                {validationMissingChecks.length > 0 ? (
                                  <ul className="space-y-1 text-xs leading-relaxed text-slate-700">
                                    {validationMissingChecks.map((item) => (
                                      <li key={item} className="flex gap-1.5">
                                        <span className="text-slate-400">-</span>
                                        <span>{item}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <div className="text-xs text-slate-500">当前没有记录到明确缺口。</div>
                                )}
                              </div>
                              <div className="rounded-[10px] bg-white/80 p-3">
                                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">下一轮建议</div>
                                {validationVerificationSteps.length > 0 ? (
                                  <ul className="space-y-1 text-xs leading-relaxed text-slate-700">
                                    {validationVerificationSteps.map((item) => (
                                      <li key={item} className="flex gap-1.5">
                                        <span className="text-slate-400">-</span>
                                        <span>{item}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <div className="text-xs text-slate-500">{validationFeedback ?? "当前没有额外建议。"}</div>
                                )}
                              </div>
                            </div>
                            {validationEvidence ? (
                              <div className="mt-3 rounded-[10px] bg-white/80 p-3 text-xs leading-relaxed text-slate-600">
                                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">判定依据</div>
                                {validationEvidence}
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>

                {detailError ? (
                  <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{detailError}</div>
                ) : null}

                {detailLoading || !detail ? (
                  <div className="flex min-h-0 flex-1 items-center justify-center rounded-[10px] border border-slate-200 bg-white p-12 text-center text-sm text-slate-400 shadow-sm">正在加载执行日志...</div>
                ) : (
                  <>
                    <div className="min-h-0 flex-1">
                      <AutomationRunConversationSection
                        messages={liveMessages}
                        title="执行日志"
                        actions={
                          <>
                            <button
                              type="button"
                              onClick={() => void downloadLatestRunLog()}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-slate-700 bg-transparent text-slate-300 transition hover:border-slate-500 hover:bg-slate-900 hover:text-white"
                              title="下载完整日志"
                              aria-label="下载完整日志"
                            >
                              <DownloadIcon className="h-3.5 w-3.5" />
                            </button>
                            {(latestRunForSelectedJob.status === "completed"
                              || latestRunForSelectedJob.status === "failed"
                              || latestRunForSelectedJob.status === "cancelled") ? (
                              <button
                                type="button"
                                onClick={() => setRunPendingDelete(latestRunForSelectedJob)}
                                disabled={busyKey === `delete-run-${latestRunForSelectedJob.id}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-rose-900/80 bg-rose-950/30 text-rose-200 transition hover:border-rose-700 hover:bg-rose-950/50 disabled:opacity-50"
                                title="删除记录"
                                aria-label="删除记录"
                              >
                                <TrashIcon className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </>
                        }
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </section>
      </div>

      {jobPendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[10px] border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold tracking-tight text-slate-900">删除任务</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  确认删除任务“{jobPendingDelete.name}”吗？这会移除该任务及其相关运行记录，且无法恢复。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setJobPendingDelete(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
                aria-label="关闭删除确认"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setJobPendingDelete(null)}
                className={buttonClass("secondary")}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() =>
                  void withBusy(`delete-job-${jobPendingDelete.id}`, async () => {
                    await deleteJob(jobPendingDelete);
                  })
                }
                disabled={busyKey === `delete-job-${jobPendingDelete.id}`}
                className={buttonClass("danger")}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {runPendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[10px] border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold tracking-tight text-slate-900">删除运行记录</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  确认删除这条运行记录吗？这会移除当前任务最近一次运行的日志与结果，且无法恢复。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRunPendingDelete(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
                aria-label="关闭删除运行记录确认"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 rounded-[10px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <div className="font-medium text-slate-900">{runPendingDelete.jobName}</div>
              <div className="mt-1">运行时间：{formatStamp(runPendingDelete.startedAt || runPendingDelete.createdAt)}</div>
              <div className="mt-1">当前状态：{runPendingDelete.displayStatus}</div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setRunPendingDelete(null)}
                className={buttonClass("secondary")}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() =>
                  void withBusy(`delete-run-${runPendingDelete.id}`, async () => {
                    await deleteLatestRun(runPendingDelete);
                  })
                }
                disabled={busyKey === `delete-run-${runPendingDelete.id}`}
                className={buttonClass("danger")}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
