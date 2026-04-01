import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { bridge } from "../lib/bridge";
import type { AutomationGoalDraft, AutomationGoalRuleConfig, AutomationRuleProfile, CreateAutomationRunRequest } from "../lib/models";
import { useStore } from "../lib/store";

const TITLE_FONT = {
  fontFamily: '"Noto Serif SC", "Songti SC", "STSong", serif',
} as const;

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
  return { title: "", goal: "", expectedOutcome: "", ruleConfig: emptyRuleConfig(defaults) };
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
    `最多 ${config.maxRoundsPerGoal} 轮`,
  ];
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
    <div className="grid gap-3 border-t border-gray-100 px-4 py-4 md:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {toggles.map(([key, label]) => (
          <label key={String(key)} className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <span>{label}</span>
            <input type="checkbox" checked={Boolean(value[key])} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} className="h-4 w-4 accent-gray-900" />
          </label>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-1">
        <input type="number" min={1} max={8} value={value.maxRoundsPerGoal} onChange={(event) => onChange({ ...value, maxRoundsPerGoal: Number.parseInt(event.target.value, 10) || 1 })} className="rounded-md border border-gray-200 px-3 py-2 text-sm" />
        <input type="number" min={1} max={5} value={value.maxConsecutiveFailures} onChange={(event) => onChange({ ...value, maxConsecutiveFailures: Number.parseInt(event.target.value, 10) || 1 })} className="rounded-md border border-gray-200 px-3 py-2 text-sm" />
        <input type="number" min={0} max={5} value={value.maxNoProgressRounds} onChange={(event) => onChange({ ...value, maxNoProgressRounds: Math.max(0, Number.parseInt(event.target.value, 10) || 0) })} className="rounded-md border border-gray-200 px-3 py-2 text-sm" />
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

  return (
    <div className="min-h-full bg-[#fcfcfc] px-6 py-8 text-gray-800">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="border-b border-gray-100 pb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-gray-400">自动化</div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900" style={TITLE_FONT}>新建批次</h1>
              <p className="mt-2 text-sm text-gray-500">在独立页面配置工作区、开始时间、目标与目标级规则。</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => navigate("/automation")} className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">返回列表</button>
              <button onClick={() => void handleCreateRun(false)} disabled={busy === "create-run"} className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">保存草稿</button>
              <button onClick={() => void handleCreateRun(true)} disabled={busy === "create-run"} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50">立即开始</button>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="grid grid-cols-12 gap-4 border-b border-gray-100 bg-gray-50/60 px-5 py-3 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
            <div className="col-span-2">目标标题</div>
            <div className="col-span-4">目标说明</div>
            <div className="col-span-3">期望结果</div>
            <div className="col-span-2">目标规则</div>
            <div className="col-span-1 text-right">操作</div>
          </div>
          <div className="divide-y divide-gray-100">
            {goalDrafts.map((goal, index) => (
              <div key={`draft-${index}`}>
                <div className="grid grid-cols-12 gap-4 px-5 py-4">
                  <div className="col-span-12 md:col-span-2">
                    <input value={goal.title ?? ""} onChange={(event) => setGoalDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} placeholder="可选标题" className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                  <div className="col-span-12 md:col-span-4">
                    <textarea value={goal.goal} onChange={(event) => setGoalDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, goal: event.target.value } : item))} placeholder="描述这个自动化目标" rows={3} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                  <div className="col-span-12 md:col-span-3">
                    <textarea value={goal.expectedOutcome} onChange={(event) => setGoalDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, expectedOutcome: event.target.value } : item))} placeholder="描述完成标准" rows={3} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm" />
                  </div>
                  <div className="col-span-12 md:col-span-2">
                    <div className="flex flex-wrap gap-2">
                      {summarizeRuleConfig(goal.ruleConfig ?? emptyRuleConfig(defaultRuleProfile)).map((item) => <span key={`${index}-${item}`} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-600">{item}</span>)}
                    </div>
                    <button onClick={() => setExpandedGoalIndex((current) => current === index ? null : index)} className="mt-3 text-xs font-medium text-gray-600 hover:text-gray-900">
                      {expandedGoalIndex === index ? "收起规则" : "展开规则"}
                    </button>
                  </div>
                  <div className="col-span-12 md:col-span-1 flex justify-end">
                    {goalDrafts.length > 1 ? <button onClick={() => setGoalDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="text-sm text-gray-400 hover:text-red-600">删除</button> : null}
                  </div>
                </div>
                {expandedGoalIndex === index ? (
                  <GoalRuleEditor value={goal.ruleConfig ?? emptyRuleConfig(defaultRuleProfile)} onChange={(next) => setGoalDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ruleConfig: next } : item))} />
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/50 px-5 py-4">
            <div className="flex items-center gap-3">
              <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="rounded-md border border-gray-200 px-3 py-2 text-sm">
                {workspaceOptions.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
              </select>
              <input type="datetime-local" value={scheduledLocal} onChange={(event) => setScheduledLocal(event.target.value)} className="rounded-md border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <button onClick={() => setGoalDrafts((current) => [...current, emptyGoalDraft(defaultRuleProfile)])} className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">新增目标</button>
          </div>
        </section>
      </div>
    </div>
  );
}
