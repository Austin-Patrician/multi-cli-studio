import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { bridge } from "../lib/bridge";
import type { AutomationGoalDraft, AutomationGoalRuleConfig, AutomationRuleProfile, CreateAutomationRunRequest } from "../lib/models";
import { useStore } from "../lib/store";

// --- Icons ---
const ArrowLeftIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
);

const PlusIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

const CogIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 1115 0 7.5 7.5 0 01-15 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 0v3.75m0-3.75h3.75m-3.75 0H8.25" />
  </svg>
);

const FolderIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
);

const ClockIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const RocketIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.841m1.861-4.413a10.12 10.12 0 00-3.446 3.446m4.033-3.59a10.047 10.047 0 012.705 2.705" />
  </svg>
);

// --- Utilities ---
function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function emptyRuleConfig(defaults?: AutomationRuleProfile | null): AutomationGoalRuleConfig {
  return {
    allowAutoSelectStrategy: defaults?.allowAutoSelectStrategy ?? true,
    allowSafeWorkspaceEdits: defaults?.allowSafeWorkspaceEdits ?? true,
    allowSafeChecks: defaults?.allowSafeChecks ?? true,
    pauseOnCredentials: defaults?.pauseOnCredentials ?? true,
    pauseOnExternalInstalls: defaults?.pauseOnExternalInstalls ?? true,
    pauseOnDestructiveCommands: defaults?.pauseOnDestructiveCommands ?? true,
    pauseOnGitPush: defaults?.pauseOnGitPush ?? true,
    maxRoundsPerGoal: defaults?.maxRoundsPerGoal ?? 3,
    maxConsecutiveFailures: defaults?.maxConsecutiveFailures ?? 2,
    maxNoProgressRounds: defaults?.maxNoProgressRounds ?? 1,
  };
}

function emptyGoalDraft(defaults?: AutomationRuleProfile | null): AutomationGoalDraft {
  return { title: "", goal: "", expectedOutcome: "", executionMode: "auto", ruleConfig: emptyRuleConfig(defaults) };
}

function toIsoOrNull(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function summarizeRuleConfig(config: AutomationGoalRuleConfig) {
  return [
    config.allowAutoSelectStrategy ? "自动选方案" : "遇分支停下",
    config.allowSafeWorkspaceEdits ? "允许改文件" : "只读",
    config.allowSafeChecks ? "允许校验" : "禁用校验",
    `${config.maxRoundsPerGoal} 轮上限`,
  ];
}

const EXECUTION_OPTIONS = [
  { value: "auto", label: "自动模式" },
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
  { value: "gemini", label: "Gemini" },
] as const;

function executionModeLabel(value?: string | null) {
  return EXECUTION_OPTIONS.find((option) => option.value === value)?.label ?? "自动模式";
}

// --- Components ---

function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <label className="block text-[13px] font-bold text-slate-700 uppercase tracking-widest mb-2">
      {children}
      {required && <span className="text-rose-500 ml-1">*</span>}
    </label>
  );
}

const INPUT_CLASS = "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all";
const TEXTAREA_CLASS = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all resize-none leading-relaxed";

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
    <div className="grid gap-6 bg-slate-50/50 px-6 py-6 border-t border-slate-100">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {toggles.map(([key, label]) => (
          <label key={String(key)} className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-medium text-slate-700 shadow-sm transition-all hover:border-indigo-200 hover:ring-1 hover:ring-indigo-100 cursor-pointer">
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
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 ml-1">最大执行轮次</span>
          <input 
            type="number" 
            min={1} 
            max={8} 
            value={value.maxRoundsPerGoal} 
            onChange={(event) => onChange({ ...value, maxRoundsPerGoal: Number.parseInt(event.target.value, 10) || 1 })} 
            className={INPUT_CLASS} 
          />
        </div>
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 ml-1">最大失败阈值</span>
          <input 
            type="number" 
            min={1} 
            max={5} 
            value={value.maxConsecutiveFailures} 
            onChange={(event) => onChange({ ...value, maxConsecutiveFailures: Number.parseInt(event.target.value, 10) || 1 })} 
            className={INPUT_CLASS} 
          />
        </div>
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 ml-1">无进展容忍轮数</span>
          <input 
            type="number" 
            min={0} 
            max={5} 
            value={value.maxNoProgressRounds} 
            onChange={(event) => onChange({ ...value, maxNoProgressRounds: Math.max(0, Number.parseInt(event.target.value, 10) || 0) })} 
            className={INPUT_CLASS} 
          />
        </div>
      </div>
    </div>
  );
}

export function AutomationComposerPage() {
  const navigate = useNavigate();
  const workspaces = useStore((state) => state.workspaces);
  const appState = useStore((state) => state.appState);
  const [workspaceId, setWorkspaceId] = useState("");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [goalDrafts, setGoalDrafts] = useState<AutomationGoalDraft[]>([emptyGoalDraft()]);
  const [expandedGoalIndex, setExpandedGoalIndex] = useState<number | null>(0);
  const [defaultRuleProfile, setDefaultRuleProfile] = useState<AutomationRuleProfile | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const workspaceOptions = useMemo(() => {
    if (workspaces.length > 0) return workspaces;
    if (!appState) return [];
    return [{ id: appState.workspace.projectRoot, name: appState.workspace.projectName, rootPath: appState.workspace.projectRoot }];
  }, [appState, workspaces]);

  useEffect(() => {
    if (!workspaceId && workspaceOptions[0]) setWorkspaceId(workspaceOptions[0].id);
  }, [workspaceId, workspaceOptions]);

  useEffect(() => {
    bridge.getAutomationRuleProfile().then((profile) => {
      setDefaultRuleProfile(profile);
      setGoalDrafts((current) => current.map((goal) => ({ ...goal, ruleConfig: goal.ruleConfig ?? emptyRuleConfig(profile) })));
    }).catch(() => {
      // ignore
    });
  }, []);

  async function handleCreateRun(startImmediately: boolean) {
    const workspace = workspaceOptions.find((item) => item.id === workspaceId);
    const goals = goalDrafts
      .map((goal) => ({
        ...goal,
        title: goal.title?.trim() ?? "",
        goal: goal.goal.trim(),
        expectedOutcome: goal.expectedOutcome.trim(),
        executionMode: goal.executionMode ?? "auto",
        ruleConfig: goal.ruleConfig ?? emptyRuleConfig(defaultRuleProfile),
      }))
      .filter((goal) => goal.goal && goal.expectedOutcome);

    if (!workspace || goals.length === 0) {
      setError("请选择工作区，并至少填写一个目标与期望结果。");
      return;
    }

    setBusy("create-run");
    try {
      const request: CreateAutomationRunRequest = {
        workspaceId: workspace.id,
        projectRoot: workspace.rootPath,
        projectName: workspace.name,
        scheduledStartAt: startImmediately ? new Date().toISOString() : toIsoOrNull(scheduledLocal),
        ruleProfileId: defaultRuleProfile?.id ?? "safe-autonomy-v1",
        goals,
      };
      const created = await bridge.createAutomationRun(request);
      navigate("/automation", { state: { selectedRunId: created.id } });
    } catch {
      setError("新建批次失败，请检查目标内容。");
    } finally {
      setBusy(null);
    }
  }

  function stageStyle(delay: number): CSSProperties {
    return {
      opacity: mounted ? 1 : 0,
      transform: mounted ? "none" : "translateY(12px)",
      transition: `opacity 400ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms, transform 400ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
    };
  }

  return (
    <div className="min-h-full bg-[#f8fafc] px-6 py-10 sm:px-8 lg:px-12 text-slate-800 relative overflow-x-hidden">
      {/* Soft background ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1200px] h-[600px] bg-[radial-gradient(ellipse_at_top,rgba(79,70,229,0.06),transparent_70%)] pointer-events-none" />

      <div className="relative mx-auto max-w-5xl space-y-8">
        <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between" style={stageStyle(0)}>
          <div>
            <button 
              onClick={() => navigate("/automation")} 
              className="group inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-indigo-600 transition-colors mb-4"
            >
              <ArrowLeftIcon className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
              返回自动化批次
            </button>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 drop-shadow-sm">新建批次</h1>
            <p className="mt-2 text-[15px] text-slate-500">配置工作区、执行时间，并定义需要顺序执行的自动化目标。</p>
          </div>
          <div className="flex items-center gap-3 bg-white/50 p-1.5 rounded-2xl ring-1 ring-slate-200/50 backdrop-blur-md shadow-sm">
            <button 
              onClick={() => void handleCreateRun(false)} 
              disabled={busy === "create-run"}
              className="rounded-xl px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-50"
            >
              保存草稿
            </button>
            <button 
              onClick={() => void handleCreateRun(true)} 
              disabled={busy === "create-run"}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white hover:bg-slate-800 shadow-lg shadow-slate-900/10 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              <RocketIcon className="w-4 h-4" />
              立即开始执行
            </button>
          </div>
        </header>

        {error ? (
          <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-medium text-rose-700 shadow-sm animate-in fade-in slide-in-from-top-4" style={stageStyle(50)}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            {error}
          </div>
        ) : null}

        {/* Global Batch Settings */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100" style={stageStyle(100)}>
          <div className="grid gap-6 p-6 sm:grid-cols-2">
            <div>
              <FieldLabel required>执行工作区</FieldLabel>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <FolderIcon className="h-4 w-4 text-slate-400" />
                </div>
                <select 
                  value={workspaceId} 
                  onChange={(event) => setWorkspaceId(event.target.value)} 
                  className={cn(INPUT_CLASS, "pl-10 appearance-none")}
                >
                  {workspaceOptions.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                </select>
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-slate-400">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </div>
              </div>
            </div>
            <div>
              <FieldLabel>计划开始时间 (可选)</FieldLabel>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <ClockIcon className="h-4 w-4" />
                </div>
                <input 
                  type="datetime-local" 
                  value={scheduledLocal} 
                  onChange={(event) => setScheduledLocal(event.target.value)} 
                  className={cn(INPUT_CLASS, "pl-10")} 
                />
              </div>
            </div>
          </div>
        </section>

        {/* Goals Configuration */}
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2" style={stageStyle(150)}>
            <h2 className="text-xl font-bold text-slate-900">执行目标</h2>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{goalDrafts.length} 个目标已添加</span>
          </div>

          <div className="space-y-6">
            {goalDrafts.map((goal, index) => (
              <section 
                key={`draft-${index}`} 
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100 transition-all hover:shadow-md"
                style={stageStyle(200 + index * 50)}
              >
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold text-indigo-600 ring-1 ring-slate-200 shadow-sm">
                      {index + 1}
                    </div>
                    <span className="text-sm font-bold text-slate-700">配置目标 {index + 1}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {goalDrafts.length > 1 && (
                      <button 
                        onClick={() => setGoalDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))} 
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-all"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  <div className="grid gap-6 md:grid-cols-[240px_1fr]">
                    <div className="space-y-4">
                      <div>
                        <FieldLabel>目标标题</FieldLabel>
                        <input 
                          value={goal.title ?? ""} 
                          onChange={(event) => setGoalDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} 
                          placeholder="例如：重构 API 模块" 
                          className={INPUT_CLASS} 
                        />
                      </div>
                      <div>
                        <FieldLabel>执行模式</FieldLabel>
                        <select
                          value={goal.executionMode ?? "auto"}
                          onChange={(event) =>
                            setGoalDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      executionMode: event.target.value as typeof EXECUTION_OPTIONS[number]["value"],
                                    }
                                  : item
                              )
                            )
                          }
                          className={INPUT_CLASS}
                        >
                          {EXECUTION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="pt-2">
                        <FieldLabel>目标级规则</FieldLabel>
                        <div className="flex flex-wrap gap-2 mb-3">
                          <span className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600 ring-1 ring-indigo-100 whitespace-nowrap">
                            {executionModeLabel(goal.executionMode)}
                          </span>
                          {summarizeRuleConfig(goal.ruleConfig ?? emptyRuleConfig(defaultRuleProfile)).map((item) => (
                            <span key={`${index}-${item}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-white whitespace-nowrap">
                              {item}
                            </span>
                          ))}
                        </div>
                        <button 
                          onClick={() => setExpandedGoalIndex((current) => current === index ? null : index)} 
                          className={cn(
                            "flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ring-1 ring-inset",
                            expandedGoalIndex === index ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                          )}
                        >
                          <CogIcon className="w-4 h-4" />
                          {expandedGoalIndex === index ? "隐藏规则配置" : "配置目标规则"}
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-6 sm:grid-cols-2">
                      <div className="flex flex-col">
                        <FieldLabel required>目标详细描述</FieldLabel>
                        <textarea 
                          value={goal.goal} 
                          onChange={(event) => setGoalDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, goal: event.target.value } : item))} 
                          placeholder="描述这个自动化目标需要完成的具体任务..." 
                          className={cn(TEXTAREA_CLASS, "flex-1 min-h-[140px]")} 
                        />
                      </div>
                      <div className="flex flex-col">
                        <FieldLabel required>期望结果产出</FieldLabel>
                        <textarea 
                          value={goal.expectedOutcome} 
                          onChange={(event) => setGoalDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, expectedOutcome: event.target.value } : item))} 
                          placeholder="描述完成该目标后的预期状态或交付物..." 
                          className={cn(TEXTAREA_CLASS, "flex-1 min-h-[140px]")} 
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {expandedGoalIndex === index && (
                  <div className="animate-in slide-in-from-top-4 duration-300">
                    <GoalRuleEditor 
                      value={goal.ruleConfig ?? emptyRuleConfig(defaultRuleProfile)} 
                      onChange={(next) => setGoalDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ruleConfig: next } : item))} 
                    />
                  </div>
                )}
              </section>
            ))}
          </div>

          <button 
            onClick={() => setGoalDrafts((current) => [...current, emptyGoalDraft(defaultRuleProfile)])} 
            className="group flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 p-8 text-sm font-bold text-slate-500 transition-all hover:border-indigo-300 hover:bg-indigo-50/30 hover:text-indigo-600"
            style={stageStyle(300)}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 group-hover:bg-indigo-100 transition-colors">
              <PlusIcon className="w-5 h-5" />
            </div>
            添加下一个执行目标
          </button>
        </div>
      </div>
    </div>
  );
}
