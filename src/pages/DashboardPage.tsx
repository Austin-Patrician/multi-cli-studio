import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useStore } from "../lib/store";
import type { ActivityItem, AgentCard, AgentId } from "../lib/models";

const DISPLAY_FONT = {
  fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
} as const;

const DATA_FONT = {
  fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
} as const;

const CLI_THEME: Record<
  AgentId,
  {
    chip: string;
    text: string;
    color: string;
    muted: string;
  }
> = {
  codex: {
    chip: "bg-slate-200 text-slate-800",
    text: "text-slate-700",
    color: "#64748b",
    muted: "#cbd5e1",
  },
  claude: {
    chip: "bg-amber-100 text-amber-800",
    text: "text-amber-800",
    color: "#b45309",
    muted: "#fcd34d",
  },
  gemini: {
    chip: "bg-emerald-100 text-emerald-800",
    text: "text-emerald-800",
    color: "#0f766e",
    muted: "#a7f3d0",
  },
};

function terminalVolume(lines: { content: string }[] | undefined) {
  return lines?.length ?? 0;
}

function totalTrafficLines(agents: AgentCard[], terminalByAgent: Record<AgentId, { content: string }[]>) {
  return agents.reduce((sum, agent) => sum + terminalVolume(terminalByAgent[agent.id]), 0);
}

function activityToneBreakdown(activity: ActivityItem[]) {
  const counts = { info: 0, success: 0, warning: 0, danger: 0 };
  for (const item of activity) counts[item.tone] += 1;
  return counts;
}

function shortPath(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 4) return path;
  return ["...", ...parts.slice(-4)].join("\\");
}

function PanelHeader({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{eyebrow}</div>
        <div className="mt-2 text-[28px] tracking-[-0.04em] text-slate-950 sm:text-[30px]" style={DISPLAY_FONT}>
          {title}
        </div>
      </div>
      {detail ? <div className="max-w-[240px] text-right text-sm leading-6 text-slate-500">{detail}</div> : null}
    </div>
  );
}

function MetricCell({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-3 text-[30px] font-semibold tracking-[-0.05em] text-slate-950">{value}</div>
      <div className="mt-1 text-sm leading-6 text-slate-500">{helper}</div>
    </div>
  );
}

function TrafficChartPanel({
  agents,
  terminalByAgent,
}: {
  agents: AgentCard[];
  terminalByAgent: Record<AgentId, { content: string }[]>;
}) {
  const rows = agents.map((agent) => ({
    agent,
    value: terminalVolume(terminalByAgent[agent.id]),
  }));

  const option = useMemo<EChartsOption>(
    () => ({
      animationDuration: 500,
      grid: { left: 12, right: 18, top: 16, bottom: 12, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "value",
        axisLabel: { color: "#94a3b8" },
        splitLine: { lineStyle: { color: "#e2e8f0" } },
      },
      yAxis: {
        type: "category",
        data: rows.map((row) => row.agent.label),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: "#334155", fontWeight: 600 },
      },
      series: [
        {
          type: "bar",
          barWidth: 18,
          showBackground: true,
          backgroundStyle: { color: "#f1f5f9", borderRadius: 10 },
          data: rows.map((row) => ({
            value: row.value,
            itemStyle: {
              color: CLI_THEME[row.agent.id].color,
              borderRadius: 10,
            },
          })),
        },
      ],
    }),
    [rows]
  );

  return (
    <section className="rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_20px_60px_rgba(15,23,42,0.05)]">
      <PanelHeader eyebrow="Usage" title="CLI traffic" detail="Terminal output volume by lane." />
      <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50/60 p-3">
        <ReactECharts option={option} style={{ height: 280, width: "100%" }} opts={{ renderer: "svg" }} />
      </div>
    </section>
  );
}

function SignalMixPanel({ activity }: { activity: ActivityItem[] }) {
  const tones = activityToneBreakdown(activity);
  const hasSignals = Object.values(tones).some((value) => value > 0);
  const toneRows = [
    {
      label: "Info",
      value: tones.info,
      helper: "Neutral system notes and context changes",
      dotClass: "bg-slate-400",
    },
    {
      label: "Success",
      value: tones.success,
      helper: "Completed actions and healthy workflow signals",
      dotClass: "bg-emerald-500",
    },
    {
      label: "Warning",
      value: tones.warning,
      helper: "Paused flows, retries, or operator attention needed",
      dotClass: "bg-amber-500",
    },
    {
      label: "Danger",
      value: tones.danger,
      helper: "Errors and broken execution paths",
      dotClass: "bg-rose-500",
    },
  ] as const;

  const option = useMemo<EChartsOption>(
    () => ({
      animationDuration: 500,
      tooltip: { trigger: "item" },
      series: [
        {
          type: "pie",
          radius: ["58%", "78%"],
          center: ["50%", "50%"],
          label: { show: false },
          labelLine: { show: false },
          padAngle: 3,
          emphasis: { scale: false },
          data: hasSignals
            ? [
                { name: "Info", value: tones.info, itemStyle: { color: "#94a3b8" } },
                { name: "Success", value: tones.success, itemStyle: { color: "#10b981" } },
                { name: "Warning", value: tones.warning, itemStyle: { color: "#d97706" } },
                { name: "Danger", value: tones.danger, itemStyle: { color: "#e11d48" } },
              ]
            : [{ name: "No data", value: 1, itemStyle: { color: "#e2e8f0" } }],
        },
      ],
    }),
    [hasSignals, tones]
  );

  return (
    <section className="rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_20px_60px_rgba(15,23,42,0.05)]">
      <PanelHeader eyebrow="Signals" title="Activity mix" detail="Recent activity tone distribution without verbose event details." />
      <div className="mt-6 grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)] xl:items-center">
        <div className="relative rounded-[24px] border border-slate-200 bg-slate-50/60 p-3">
          <ReactECharts option={option} style={{ height: 280, width: "100%" }} opts={{ renderer: "svg" }} />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Events</div>
            <div className="mt-2 text-[34px] font-semibold tracking-[-0.05em] text-slate-950">{activity.length}</div>
          </div>
        </div>

        <div className="grid gap-3">
          {activity.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-400">
              No activity recorded yet.
            </div>
          ) : (
            toneRows.map((tone) => (
              <div key={tone.label} className="rounded-[22px] border border-slate-200 bg-slate-50/50 px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${tone.dotClass}`} />
                      <div className="text-sm font-semibold text-slate-950">{tone.label}</div>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">{tone.helper}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[28px] font-semibold tracking-[-0.05em] text-slate-950">{tone.value}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">events</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

export function DashboardPage() {
  const appState = useStore((s) => s.appState);

  if (!appState) {
    return <div className="flex h-full items-center justify-center text-muted">Loading...</div>;
  }

  const { workspace, activity, agents, terminalByAgent } = appState;
  const totalTraffic = totalTrafficLines(agents, terminalByAgent);

  return (
    <div className="min-h-full bg-[linear-gradient(180deg,#fbfcfe_0%,#ffffff_52%,#f8fafc_100%)]">
      <div className="mx-auto max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-[32px] border border-slate-200 bg-white px-6 py-6 shadow-[0_24px_64px_rgba(15,23,42,0.05)] lg:px-8">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,0.88fr)] xl:items-end">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-400">Workspace</div>
              <div className="mt-3 max-w-4xl text-[42px] leading-[1.02] tracking-[-0.055em] text-slate-950 sm:text-[50px]" style={DISPLAY_FONT}>
                {workspace.projectName}
              </div>
              <div className="mt-4 max-w-3xl text-[15px] leading-7 text-slate-500">
                A quieter dashboard focused on workspace health, signal quality, and live terminal movement.
              </div>
              <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-950 px-4 py-4 text-slate-100">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Project Root</div>
                <div className="mt-3 text-sm leading-7 text-slate-100" style={DATA_FONT}>{shortPath(workspace.projectRoot)}</div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCell label="Dirty Files" value={String(workspace.dirtyFiles)} helper="Tracked workspace changes waiting for review" />
              <MetricCell label="Checks" value={String(workspace.failingChecks)} helper="Failing workspace validations or repo checks" />
              <MetricCell label="Events" value={String(activity.length)} helper="Recent timeline signals in memory" />
              <MetricCell label="Traffic" value={String(totalTraffic)} helper="Terminal output lines across all lanes" />
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <TrafficChartPanel agents={agents} terminalByAgent={terminalByAgent} />
          <SignalMixPanel activity={activity} />
        </section>
      </div>
    </div>
  );
}
