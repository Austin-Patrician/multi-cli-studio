import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useStore } from "../lib/store";
import type {
  ActivityItem,
  AgentCard,
  AgentId,
  AgentResourceGroup,
  AgentResourceKind,
  AgentRuntimeResources,
} from "../lib/models";

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

const RESOURCE_ORDER: AgentResourceKind[] = ["mcp", "skill", "plugin", "extension"];

const RESOURCE_LABEL: Record<AgentResourceKind, string> = {
  mcp: "MCP",
  skill: "Skills",
  plugin: "Plugins",
  extension: "Extensions",
};

function fallbackGroup(supported: boolean): AgentResourceGroup {
  return { supported, items: [], error: null };
}

function fallbackResources(agentId: AgentId): AgentRuntimeResources {
  switch (agentId) {
    case "codex":
      return {
        mcp: fallbackGroup(true),
        skill: fallbackGroup(true),
        plugin: fallbackGroup(false),
        extension: fallbackGroup(false),
      };
    case "claude":
      return {
        mcp: fallbackGroup(true),
        skill: fallbackGroup(true),
        plugin: fallbackGroup(true),
        extension: fallbackGroup(false),
      };
    default:
      return {
        mcp: fallbackGroup(true),
        skill: fallbackGroup(true),
        plugin: fallbackGroup(false),
        extension: fallbackGroup(true),
      };
  }
}

function runtimeResources(agent: AgentCard): AgentRuntimeResources {
  const fallback = fallbackResources(agent.id);
  const current = agent.runtime.resources;
  return {
    mcp: current?.mcp ?? fallback.mcp,
    skill: current?.skill ?? fallback.skill,
    plugin: current?.plugin ?? fallback.plugin,
    extension: current?.extension ?? fallback.extension,
  };
}

function totalResources(agent: AgentCard) {
  const resources = runtimeResources(agent);
  return RESOURCE_ORDER.reduce((sum, kind) => {
    const group = resources[kind];
    return sum + (group.supported ? group.items.length : 0);
  }, 0);
}

function supportedSurfaceCount(agent: AgentCard) {
  const resources = runtimeResources(agent);
  return RESOURCE_ORDER.filter((kind) => resources[kind].supported).length;
}

function terminalVolume(lines: { content: string }[] | undefined) {
  return lines?.length ?? 0;
}

function totalTrafficLines(agents: AgentCard[], terminalByAgent: Record<AgentId, { content: string }[]>) {
  return agents.reduce((sum, agent) => sum + terminalVolume(terminalByAgent[agent.id]), 0);
}

function runtimeLabel(agent: AgentCard) {
  if (!agent.runtime.installed) return "Missing";
  return agent.runtime.version?.trim() || "Installed";
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

function resourceNames(group: AgentResourceGroup) {
  if (!group.supported) return "Unavailable";
  if (group.error) return group.error;
  if (group.items.length === 0) return "None";
  return group.items.map((item) => (item.enabled ? item.name : `${item.name} (off)`)).join(" • ");
}

function toneChipClass(tone: ActivityItem["tone"]) {
  switch (tone) {
    case "success":
      return "bg-emerald-50 text-emerald-700";
    case "warning":
      return "bg-amber-50 text-amber-700";
    case "danger":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
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
  const latest = activity.slice(0, 4);
  const hasSignals = Object.values(tones).some((value) => value > 0);

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
      <PanelHeader eyebrow="Signals" title="Activity mix" detail="Recent activity tones and latest operational events." />
      <div className="mt-6 grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)] xl:items-center">
        <div className="relative rounded-[24px] border border-slate-200 bg-slate-50/60 p-3">
          <ReactECharts option={option} style={{ height: 280, width: "100%" }} opts={{ renderer: "svg" }} />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Events</div>
            <div className="mt-2 text-[34px] font-semibold tracking-[-0.05em] text-slate-950">{activity.length}</div>
          </div>
        </div>

        <div className="grid gap-3">
          {latest.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-400">
              No activity recorded yet.
            </div>
          ) : (
            latest.map((item) => (
              <div key={item.id} className="rounded-[22px] border border-slate-200 bg-slate-50/50 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-950">{item.title}</div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${toneChipClass(item.tone)}`}>
                    {item.tone}
                  </span>
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</div>
                <div className="mt-3 text-[11px] uppercase tracking-[0.18em] text-slate-400">{item.time}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function CliInventoryPanel({ agent }: { agent: AgentCard }) {
  const resources = runtimeResources(agent);
  const theme = CLI_THEME[agent.id];

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold uppercase ${theme.chip}`}>
              {agent.label.slice(0, 2)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[18px] font-semibold tracking-[-0.03em] text-slate-950">{agent.label}</div>
              <div className="truncate text-sm text-slate-500">{agent.specialty}</div>
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-[26px] font-semibold tracking-[-0.05em] text-slate-950">{totalResources(agent)}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">{supportedSurfaceCount(agent)} surfaces</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">Runtime {runtimeLabel(agent)}</span>
        <span className={`rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium ${theme.text}`}>Local inventory</span>
      </div>

      <div className="mt-5 space-y-4">
        {RESOURCE_ORDER.map((kind) => (
          <div key={`${agent.id}-${kind}`} className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-400">{RESOURCE_LABEL[kind]}</div>
              <div className="text-[11px] text-slate-400">
                {resources[kind].supported ? resources[kind].items.length : "N/A"}
              </div>
            </div>
            <div className="mt-2 text-sm leading-7 text-slate-600">{resourceNames(resources[kind])}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DashboardPage() {
  const appState = useStore((s) => s.appState);

  const installedCliCount = useMemo(
    () => appState?.agents.filter((agent) => agent.runtime.installed).length ?? 0,
    [appState]
  );

  const inventoryCount = useMemo(
    () => appState?.agents.reduce((sum, agent) => sum + totalResources(agent), 0) ?? 0,
    [appState]
  );

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
                A quieter dashboard focused on runtime usage, signal quality, and CLI inventory clarity.
              </div>
              <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-950 px-4 py-4 text-slate-100">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Project Root</div>
                <div className="mt-3 text-sm leading-7 text-slate-100" style={DATA_FONT}>{shortPath(workspace.projectRoot)}</div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCell label="Installed" value={String(installedCliCount)} helper="CLI runtimes detected on this machine" />
              <MetricCell label="Inventory" value={String(inventoryCount)} helper="MCP, skills, plugins, and extensions" />
              <MetricCell label="Events" value={String(activity.length)} helper="Recent timeline signals in memory" />
              <MetricCell label="Traffic" value={String(totalTraffic)} helper="Terminal output lines across all lanes" />
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <TrafficChartPanel agents={agents} terminalByAgent={terminalByAgent} />
          <SignalMixPanel activity={activity} />
        </section>

        <section className="mt-6 grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
          {agents.map((agent) => (
            <CliInventoryPanel key={agent.id} agent={agent} />
          ))}
        </section>
      </div>
    </div>
  );
}
