import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { bridge } from "../lib/bridge";
import type {
  AutomationExecutionMode,
  AutomationGoalRuleConfig,
  AutomationJobDraft,
  AutomationPermissionProfile,
  AutomationRuleProfile,
} from "../lib/models";
import { useStore } from "../lib/store";
import { cn } from "./automationUi";

const EXECUTION_OPTIONS: Array<{ value: AutomationExecutionMode; label: string; detail: string }> = [
  { value: "auto", label: "自动模式", detail: "系统会根据任务内容自动选择更合适的 CLI。" },
  { value: "codex", label: "Codex", detail: "默认由 Codex 直接执行，适合代码实现与修改。" },
  { value: "claude", label: "Claude", detail: "默认由 Claude 执行，适合分析、审阅与推理。" },
  { value: "gemini", label: "Gemini", detail: "默认由 Gemini 执行，适合 UI 和视觉工作。" },
];

const PERMISSION_OPTIONS: Array<{ value: AutomationPermissionProfile; label: string; detail: string }> = [
  { value: "standard", label: "标准权限", detail: "Codex 使用 workspace-write，Claude 使用 acceptEdits，Gemini 使用 auto_edit。" },
  { value: "full-access", label: "Full Access", detail: "尽量放宽沙箱与权限限制，适合定时任务需要更高执行权限的情况。" },
  { value: "read-only", label: "只读权限", detail: "只允许规划和检查，不允许实际修改。" },
];

const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-500/10";
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[140px] resize-none py-3 leading-relaxed`;

type WorkspaceOption = { id: string; name: string; rootPath: string };

function defaultRuleConfig(defaults?: AutomationRuleProfile | null): AutomationGoalRuleConfig {
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

function buildEmptyDraft(defaults?: AutomationRuleProfile | null, workspace?: WorkspaceOption | null): AutomationJobDraft {
  return {
    workspaceId: workspace?.id ?? "",
    projectRoot: workspace?.rootPath ?? "",
    projectName: workspace?.name ?? "",
    name: "",
    description: "",
    goal: "",
    expectedOutcome: "",
    defaultExecutionMode: "auto",
    permissionProfile: "standard",
    ruleConfig: defaultRuleConfig(defaults),
    parameterDefinitions: [],
    defaultParameterValues: {},
    cronExpression: "",
    enabled: true,
  };
}

function toIsoOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? "0"),
    0
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function SectionCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-5 sm:px-8">
        <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{hint}</p>
      </div>
      <div className="p-6 sm:p-8">{children}</div>
    </section>
  );
}

function ChoiceCard({
  active,
  title,
  detail,
  onClick,
}: {
  active: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all duration-200",
        active 
          ? "border-sky-500 bg-sky-50/50 shadow-sm ring-1 ring-sky-500/20" 
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
      )}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <span className={cn("text-sm font-bold tracking-tight transition-colors", active ? "text-sky-900" : "text-slate-700 group-hover:text-slate-900")}>
          {title}
        </span>
        <div className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors", 
          active ? "border-sky-500 bg-sky-500" : "border-slate-300 bg-slate-50 group-hover:border-slate-400"
        )}>
          {active && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
        </div>
      </div>
      <span className={cn("text-xs leading-relaxed transition-colors", active ? "text-sky-700/80" : "text-slate-500")}>
        {detail}
      </span>
    </button>
  );
}

function ToggleField({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="group flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 transition-all hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm">
      <div className="flex-1">
        <div className="text-sm font-bold tracking-tight text-slate-700 group-hover:text-slate-900 transition-colors">{label}</div>
        <div className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</div>
      </div>
      <div className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus-within:outline-none focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2" style={{ backgroundColor: checked ? '#0ea5e9' : '#cbd5e1' }}>
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out",
            checked ? "translate-x-6" : "translate-x-1"
          )}
        />
      </div>
    </label>
  );
}

function RuleMetricField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="text-sm font-bold tracking-tight text-slate-700">{label}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{hint}</p>
        </div>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value) || min)}
          className="w-20 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-center text-sm font-semibold text-slate-900 outline-none transition hover:border-slate-300 focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-500/20"
        />
      </div>
    </div>
  );
}

export function AutomationJobEditorPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const workspaces = useStore((state) => state.workspaces);
  const appState = useStore((state) => state.appState);

  const workspaceOptions = useMemo<WorkspaceOption[]>(() => {
    if (workspaces.length > 0) return workspaces;
    if (!appState) return [];
    return [{ id: appState.workspace.projectRoot, name: appState.workspace.projectName, rootPath: appState.workspace.projectRoot }];
  }, [appState, workspaces]);

  const [draft, setDraft] = useState<AutomationJobDraft>(buildEmptyDraft());
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launchScheduledAt, setLaunchScheduledAt] = useState("");

  useEffect(() => {
    if (!draft.workspaceId && workspaceOptions[0]) {
      setDraft((current) => ({
        ...current,
        workspaceId: workspaceOptions[0].id,
        projectRoot: workspaceOptions[0].rootPath,
        projectName: workspaceOptions[0].name,
      }));
    }
  }, [draft.workspaceId, workspaceOptions]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const profile = await bridge.getAutomationRuleProfile();
        if (cancelled) return;

        if (!jobId) {
          setDraft((current) => ({
            ...buildEmptyDraft(profile, workspaceOptions[0] ?? null),
            ...current,
            ruleConfig: current.ruleConfig.maxRoundsPerGoal ? current.ruleConfig : defaultRuleConfig(profile),
          }));
          setLoading(false);
          return;
        }

        const job = await bridge.getAutomationJob(jobId);
        if (cancelled) return;
        setDraft({
          workspaceId: job.workspaceId,
          projectRoot: job.projectRoot,
          projectName: job.projectName,
          name: job.name,
          description: job.description ?? "",
          goal: job.goal,
          expectedOutcome: job.expectedOutcome,
          defaultExecutionMode: job.defaultExecutionMode,
          permissionProfile: job.permissionProfile,
          ruleConfig: job.ruleConfig,
          parameterDefinitions: [],
          defaultParameterValues: {},
          cronExpression: job.cronExpression ?? "",
          enabled: job.enabled,
        });
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "加载任务失败。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [jobId, workspaceOptions]);

  async function withBusy(key: string, action: () => Promise<void>) {
    setBusyKey(key);
    try {
      await action();
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "操作失败。");
    } finally {
      setBusyKey(null);
    }
  }

  function updateWorkspace(workspaceId: string) {
    const workspace = workspaceOptions.find((item) => item.id === workspaceId);
    setDraft((current) => ({
      ...current,
      workspaceId,
      projectRoot: workspace?.rootPath ?? current.projectRoot,
      projectName: workspace?.name ?? current.projectName,
    }));
  }

  function buildPayload(): AutomationJobDraft {
    return {
      ...draft,
      name: draft.name.trim(),
      description: draft.description?.trim() ?? "",
      goal: draft.goal.trim(),
      expectedOutcome: draft.expectedOutcome.trim(),
      parameterDefinitions: [],
      defaultParameterValues: {},
      cronExpression: draft.cronExpression?.trim() ?? "",
    };
  }

  async function ensureSavedJob(): Promise<string> {
    const payload = buildPayload();
    if (!payload.workspaceId || !payload.goal || !payload.expectedOutcome) {
      throw new Error("请先填写工作区、任务目标和期望结果。");
    }

    if (jobId) {
      const updated = await bridge.updateAutomationJob(jobId, payload);
      setDraft((current) => ({ ...current, cronExpression: updated.cronExpression ?? "" }));
      return updated.id;
    }

    const created = await bridge.createAutomationJob(payload);
    navigate(`/automation/jobs/${created.id}`, { replace: true });
    return created.id;
  }

  async function handleSave() {
    const savedJobId = await ensureSavedJob();
    if (!jobId) {
      navigate(`/automation/jobs/${savedJobId}`, { replace: true });
    }
  }

  async function handleSaveAndRun() {
    const scheduledStartAt = toIsoOrNull(launchScheduledAt);
    if (launchScheduledAt.trim() && !scheduledStartAt) {
      throw new Error("单次延时启动时间格式无效，请重新选择。");
    }
    if (scheduledStartAt && Date.parse(scheduledStartAt) <= Date.now() + 1000) {
      throw new Error("单次延时启动必须设置为未来时间。");
    }
    const savedJobId = await ensureSavedJob();
    await bridge.createAutomationRunFromJob({
      jobId: savedJobId,
      scheduledStartAt,
      executionMode: null,
    });
    navigate("/automation", { state: { selectedJobId: savedJobId } });
  }

  async function handleDelete() {
    if (!jobId) return;
    if (!window.confirm("确认删除这个 CLI 自动化任务吗？")) return;
    await bridge.deleteAutomationJob(jobId);
    navigate("/automation");
  }

  const cronEnabled = Boolean(draft.cronExpression?.trim());

  return (
    <div className="min-h-full bg-slate-50/50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[54rem] space-y-8">
        
        {/* Header Section */}
        <section className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <button 
              type="button" 
              onClick={() => navigate("/automation")} 
              className="group inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-900"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 stroke-current stroke-[1.5] transition-transform group-hover:-translate-x-0.5">
                <path d="M12.5 15L7.5 10l5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              返回任务中心
            </button>
            <div className="flex items-center gap-3 pt-2">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {jobId ? "编辑任务配置" : "新建自动化任务"}
              </h1>
              {jobId && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">ID: {jobId.slice(0, 8)}</span>}
            </div>
            <p className="text-sm text-slate-500">
              定义任务的目标、执行模式、工作区范围和触发时机。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/automation")}
              className="inline-flex h-[42px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95"
            >
              取消
            </button>
            {jobId ? (
              <button
                type="button"
                onClick={() => void withBusy("delete", handleDelete)}
                disabled={busyKey === "delete"}
                className="inline-flex h-[42px] items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:opacity-50 active:scale-95"
              >
                删除
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void withBusy("save", handleSave)}
              disabled={busyKey === "save"}
              className="inline-flex h-[42px] items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50 active:scale-95"
            >
              保存配置
            </button>
            <button
              type="button"
              onClick={() => void withBusy("save-run", handleSaveAndRun)}
              disabled={busyKey === "save-run"}
              className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-sky-600 disabled:opacity-50 active:scale-95"
            >
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path d="M6.5 5.5l8 4.5-8 4.5v-9z" fill="currentColor" />
              </svg>
              保存并运行
            </button>
          </div>
        </section>

        {error ? (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700 shadow-sm">
            <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 h-5 w-5 shrink-0 text-rose-500">
              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-5a1.25 1.25 0 100 2.5A1.25 1.25 0 0010 4z" fill="currentColor" />
            </svg>
            <div>
              <div className="font-bold">操作失败</div>
              <div className="mt-1 opacity-90">{error}</div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-slate-200 bg-white py-20 shadow-sm">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-sky-500" />
            <p className="mt-4 text-sm font-medium text-slate-500">正在加载任务配置...</p>
          </div>
        ) : (
          <div className="space-y-8">
            <SectionCard title="基础信息" hint="设定任务的标识、工作范围以及最终要达成的目标。">
              <div className="grid gap-6">
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-bold tracking-tight text-slate-700">任务名称 <span className="text-rose-500">*</span></label>
                    <input 
                      value={draft.name} 
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} 
                      placeholder="例如：自动修复构建错误" 
                      className={INPUT_CLASS} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold tracking-tight text-slate-700">目标工作区 <span className="text-rose-500">*</span></label>
                    <div className="relative">
                      <select 
                        value={draft.workspaceId} 
                        onChange={(event) => updateWorkspace(event.target.value)} 
                        className={cn(INPUT_CLASS, "appearance-none pr-10")}
                      >
                        {workspaceOptions.map((workspace) => (
                          <option key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400">
                        <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 stroke-current stroke-[1.5]">
                          <path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-bold tracking-tight text-slate-700">简短说明</label>
                  <input
                    value={draft.description ?? ""}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="一句话描述这个任务的主要用途（可选）"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="grid gap-6 pt-2 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-bold tracking-tight text-slate-700">任务目标设定 <span className="text-rose-500">*</span></label>
                    <p className="mb-2 text-xs text-slate-500">详细描述 Agent 需要执行的具体动作和范围。</p>
                    <textarea
                      value={draft.goal}
                      onChange={(event) => setDraft((current) => ({ ...current, goal: event.target.value }))}
                      placeholder="例如：检查 src/components 目录下的所有文件，修复所有 ESLint 和 TypeScript 类型错误..."
                      className={TEXTAREA_CLASS}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold tracking-tight text-slate-700">预期交付结果 <span className="text-rose-500">*</span></label>
                    <p className="mb-2 text-xs text-slate-500">描述任务被认为“完成”时，系统应该处于什么状态。</p>
                    <textarea
                      value={draft.expectedOutcome}
                      onChange={(event) => setDraft((current) => ({ ...current, expectedOutcome: event.target.value }))}
                      placeholder="例如：1. 运行 npm run lint 无报错。 2. 所有修改均符合项目代码规范..."
                      className={TEXTAREA_CLASS}
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="执行模式与权限" hint="选择该任务最适合的 Agent 模型以及沙箱权限级别。">
              <div className="grid gap-8">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold tracking-tight text-slate-900">推荐模型 (Execution Mode)</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {EXECUTION_OPTIONS.map((option) => (
                      <ChoiceCard
                        key={option.value}
                        active={draft.defaultExecutionMode === option.value}
                        title={option.label}
                        detail={option.detail}
                        onClick={() => setDraft((current) => ({ ...current, defaultExecutionMode: option.value }))}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold tracking-tight text-slate-900">权限配置 (Permission Profile)</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">Security</span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {PERMISSION_OPTIONS.map((option) => (
                      <ChoiceCard
                        key={option.value}
                        active={draft.permissionProfile === option.value}
                        title={option.label}
                        detail={option.detail}
                        onClick={() => setDraft((current) => ({ ...current, permissionProfile: option.value }))}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="安全与策略边界" hint="配置 Agent 在无人值守模式下的行为限制和防御机制。">
              <div className="grid gap-8">
                <div className="space-y-4">
                  <h3 className="text-sm font-bold tracking-tight text-slate-900">行为限制控制开关</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {([
                      ["allowAutoSelectStrategy", "允许自动选择策略", "遇到多种可选方案时，允许系统自动选择其一继续执行，而不是暂停询问。"],
                      ["allowSafeWorkspaceEdits", "允许自动修改文件", "授权 CLI 直接在当前工作区内对文件进行修改、保存或删除。"],
                      ["allowSafeChecks", "允许执行安全校验", "授权系统自动运行测试、构建、Lint 等预设的校验命令。"],
                      ["pauseOnCredentials", "敏感信息保护", "当检测到需要输入密码、Token 或进行系统认证时，强制暂停运行。"],
                      ["pauseOnExternalInstalls", "外部依赖安装拦截", "当检测到试图通过包管理器安装新依赖或软件时，强制暂停运行。"],
                      ["pauseOnDestructiveCommands", "危险指令拦截", "当检测到 rm -rf、系统级修改等潜在破坏性指令时，强制暂停运行。"],
                      ["pauseOnGitPush", "Git 推送拦截", "当检测到即将向远程仓库执行 git push 操作时，强制暂停运行。"],
                    ] as Array<[keyof AutomationGoalRuleConfig, string, string]>).map(([key, label, hint]) => (
                      <ToggleField
                        key={key}
                        label={label}
                        hint={hint}
                        checked={draft.ruleConfig[key] as boolean}
                        onChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            ruleConfig: {
                              ...current.ruleConfig,
                              [key]: checked,
                            },
                          }))
                        }
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-4 border-t border-slate-100 pt-4">
                  <h3 className="text-sm font-bold tracking-tight text-slate-900">资源阈值控制</h3>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <RuleMetricField
                      label="最大执行轮次"
                      hint="单次任务最多允许 Agent 交互的轮数"
                      value={draft.ruleConfig.maxRoundsPerGoal}
                      min={1}
                      max={15}
                      onChange={(next) => setDraft((current) => ({ ...current, ruleConfig: { ...current.ruleConfig, maxRoundsPerGoal: next } }))}
                    />
                    <RuleMetricField
                      label="最大连续失败数"
                      hint="达到此失败次数后强制终止任务"
                      value={draft.ruleConfig.maxConsecutiveFailures}
                      min={1}
                      max={5}
                      onChange={(next) => setDraft((current) => ({ ...current, ruleConfig: { ...current.ruleConfig, maxConsecutiveFailures: next } }))}
                    />
                    <RuleMetricField
                      label="容忍无进展轮次"
                      hint="连续多轮无进展则提前终止"
                      value={draft.ruleConfig.maxNoProgressRounds}
                      min={0}
                      max={5}
                      onChange={(next) => setDraft((current) => ({ ...current, ruleConfig: { ...current.ruleConfig, maxNoProgressRounds: next } }))}
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

              <SectionCard title="调度与触发" hint="配置任务是手动执行，还是按照指定的时间表自动运行。">
                <div className="space-y-6">
                  <ToggleField
                    label="启用 Cron 定时调度"
                    hint="开启后，系统将按照设定的 Cron 表达式周期性自动创建并运行任务。"
                  checked={cronEnabled}
                  onChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      cronExpression: checked ? current.cronExpression || "0 9 * * 1-5" : "",
                    }))
                  }
                />
                
                {cronEnabled ? (
                  <div className="grid gap-6 duration-300 animate-in fade-in slide-in-from-top-2 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-bold tracking-tight text-slate-700">Cron 表达式</label>
                      <input
                        value={draft.cronExpression ?? ""}
                        onChange={(event) => setDraft((current) => ({ ...current, cronExpression: event.target.value }))}
                        placeholder="例如：0 9 * * 1-5"
                        className={cn(INPUT_CLASS, "font-mono")}
                      />
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 text-sm font-bold tracking-tight text-slate-700">常用表达式参考</div>
                      <ul className="space-y-1.5 font-mono text-xs text-slate-600">
                        <li className="flex items-center gap-2"><span className="w-24 text-sky-600">0 9 * * 1-5</span> 工作日 09:00</li>
                        <li className="flex items-center gap-2"><span className="w-24 text-sky-600">30 2 * * *</span> 每天 02:30</li>
                        <li className="flex items-center gap-2"><span className="w-24 text-sky-600">0 */4 * * *</span> 每 4 小时</li>
                        <li className="flex items-center gap-2"><span className="w-24 text-sky-600">0 0 * * 0</span> 每周日午夜</li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-6 text-center text-sm text-slate-500">
                    当前设置为<span className="mx-1 font-semibold text-slate-700">纯手动模式</span>。该任务只会在你点击"运行"时启动，不会自动调度。
                  </div>
                )}

                <div className="border-t border-slate-100 pt-6">
                  <div className="max-w-md space-y-2">
                    <label className="text-sm font-bold tracking-tight text-slate-700">单次延时启动（可选）</label>
                    <p className="mb-2 text-xs text-slate-500">指定一个未来时间。当你点击"保存并运行"时，这次运行会在那个时间点才开始执行。</p>
                    <input 
                      type="datetime-local" 
                      value={launchScheduledAt} 
                      onChange={(event) => setLaunchScheduledAt(event.target.value)} 
                      className={INPUT_CLASS} 
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

          </div>
        )}
      </div>
    </div>
  );
}
