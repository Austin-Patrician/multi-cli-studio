import { useEffect, useMemo, useState } from "react";
import { useStore } from "../lib/store";
import type {
  AgentCard,
  AgentId,
  AgentResourceGroup,
  AgentResourceItem,
  AgentResourceKind,
  AgentRuntimeResources,
} from "../lib/models";

const CLI_THEME: Record<
  AgentId,
  {
    accent: string;
    soft: string;
    wash: string;
    text: string;
    line: string;
    glow: string;
  }
> = {
  codex: {
    accent: "bg-slate-900",
    soft: "bg-slate-100",
    wash: "bg-slate-50",
    text: "text-slate-900",
    line: "bg-slate-700",
    glow: "shadow-[0_18px_60px_rgba(15,23,42,0.10)]",
  },
  claude: {
    accent: "bg-amber-500",
    soft: "bg-amber-50",
    wash: "bg-amber-50",
    text: "text-amber-800",
    line: "bg-amber-400",
    glow: "shadow-[0_18px_60px_rgba(245,158,11,0.14)]",
  },
  gemini: {
    accent: "bg-emerald-500",
    soft: "bg-emerald-50",
    wash: "bg-emerald-50",
    text: "text-emerald-800",
    line: "bg-emerald-400",
    glow: "shadow-[0_18px_60px_rgba(16,185,129,0.14)]",
  },
};

const RESOURCE_ORDER: AgentResourceKind[] = ["mcp", "skill", "plugin", "extension"];

const RESOURCE_LABEL: Record<AgentResourceKind, string> = {
  mcp: "MCP",
  skill: "Skills",
  plugin: "Plugins",
  extension: "Extensions",
};

const RESOURCE_PREVIEW_COUNT = 2;

const RESOURCE_STYLE: Record<
  AgentResourceKind,
  {
    token: string;
    tint: string;
    text: string;
    border: string;
    glow: string;
  }
> = {
  mcp: {
    token: "MCP",
    tint: "bg-sky-500/10",
    text: "text-sky-700",
    border: "border-sky-200",
    glow: "bg-sky-50/80",
  },
  skill: {
    token: "SK",
    tint: "bg-violet-500/10",
    text: "text-violet-700",
    border: "border-violet-200",
    glow: "bg-violet-50/80",
  },
  plugin: {
    token: "PL",
    tint: "bg-amber-500/10",
    text: "text-amber-700",
    border: "border-amber-200",
    glow: "bg-amber-50/80",
  },
  extension: {
    token: "EX",
    tint: "bg-emerald-500/10",
    text: "text-emerald-700",
    border: "border-emerald-200",
    glow: "bg-emerald-50/80",
  },
};

interface ResourceOverlayState {
  agentId: AgentId;
  kind: AgentResourceKind;
}

function fallbackGroup(supported: boolean): AgentResourceGroup {
  return {
    supported,
    items: [],
    error: null,
  };
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

function enabledResourceCount(group: AgentResourceGroup) {
  return group.items.filter((item) => item.enabled).length;
}

function previewResourceItems(group: AgentResourceGroup) {
  return group.items.slice(0, RESOURCE_PREVIEW_COUNT);
}

function resourceOverlayEnabled(group: AgentResourceGroup) {
  return group.supported && (group.items.length > 0 || Boolean(group.error));
}

function terminalVolume(lines: { content: string }[] | undefined) {
  return lines?.length ?? 0;
}

function runtimeLabel(agent: AgentCard) {
  if (!agent.runtime.installed) return "Missing";
  return agent.runtime.version?.trim() || "Installed";
}

function artifactChartColor(kind: string) {
  switch (kind) {
    case "plan":
      return "bg-amber-400";
    case "review":
      return "bg-sky-400";
    case "ui-note":
      return "bg-emerald-400";
    default:
      return "bg-slate-500";
  }
}

function toneClasses(tone: string) {
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

function SectionHeading({
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
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
          {eyebrow}
        </div>
        <div className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-slate-950">
          {title}
        </div>
      </div>
      {detail ? <div className="text-sm text-slate-500">{detail}</div> : null}
    </div>
  );
}

function MetricStrip({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white/88 px-4 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-slate-950">
        {value}
      </div>
      {helper ? <div className="mt-1 text-sm text-slate-500">{helper}</div> : null}
    </div>
  );
}

function SessionVolumeChart({
  agents,
  terminalByAgent,
}: {
  agents: AgentCard[];
  terminalByAgent: Record<AgentId, { content: string }[]>;
}) {
  const chartRows = agents.map((agent) => ({
    agent,
    value: terminalVolume(terminalByAgent[agent.id]),
  }));
  const max = Math.max(1, ...chartRows.map((row) => row.value));

  return (
    <div className="rounded-[26px] border border-slate-200 bg-white px-6 py-6">
      <SectionHeading eyebrow="Session Volume" title="CLI message traffic" detail="Recent terminal output by lane" />
      <div className="mt-8 space-y-5">
        {chartRows.map(({ agent, value }) => {
          const theme = CLI_THEME[agent.id];
          const width = `${Math.max(10, (value / max) * 100)}%`;
          return (
            <div key={agent.id}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${theme.line}`} />
                  <span className="text-sm font-medium text-slate-900">{agent.label}</span>
                </div>
                <div className="text-sm font-medium text-slate-500">{value} lines</div>
              </div>
              <div className="h-3 rounded-full bg-slate-100">
                <div
                  className={`h-3 rounded-full transition-[width] duration-300 ${theme.line}`}
                  style={{ width }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResourcePreviewToken({
  item,
}: {
  item: AgentResourceItem;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
        item.enabled
          ? "border-slate-200 bg-white text-slate-600"
          : "border-slate-200 bg-slate-100 text-slate-500"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${item.enabled ? "bg-emerald-500" : "bg-slate-400"}`} />
      <span className="truncate">{item.name}</span>
    </span>
  );
}

function ResourceLane({
  kind,
  group,
  onOpen,
}: {
  kind: AgentResourceKind;
  group: AgentResourceGroup;
  onOpen: (kind: AgentResourceKind) => void;
}) {
  const previewItems = previewResourceItems(group);
  const hiddenCount = Math.max(0, group.items.length - previewItems.length);
  const enabledCount = enabledResourceCount(group);
  const interactive = resourceOverlayEnabled(group);
  const style = RESOURCE_STYLE[kind];

  const body = (
    <>
      <div className="flex items-start gap-3">
        <div
          className={`inline-flex h-10 min-w-10 items-center justify-center rounded-2xl border text-[10px] font-semibold uppercase tracking-[0.16em] ${style.tint} ${style.text} ${style.border}`}
        >
          {style.token}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-950">{RESOURCE_LABEL[kind]}</span>
            {!group.supported ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Unavailable
              </span>
            ) : (
              <>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                  {group.items.length} item{group.items.length === 1 ? "" : "s"}
                </span>
                {group.error ? (
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-700">
                    Read error
                  </span>
                ) : group.items.length > 0 ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                    {enabledCount}/{group.items.length} enabled
                  </span>
                ) : null}
              </>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!group.supported ? (
              <span className="text-xs text-slate-400">Not exposed by this CLI.</span>
            ) : group.error ? (
              <span className="text-xs leading-5 text-rose-600">{group.error}</span>
            ) : group.items.length === 0 ? (
              <span className="text-xs text-slate-400">No items detected.</span>
            ) : (
              <>
                {previewItems.map((item) => (
                  <ResourcePreviewToken key={`${kind}-${item.name}-${item.source ?? ""}`} item={item} />
                ))}
                {hiddenCount > 0 ? (
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${style.tint} ${style.text} ${style.border}`}
                  >
                    +{hiddenCount} more
                  </span>
                ) : (
                  <span className="text-[11px] font-medium text-slate-400">View details</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {interactive ? (
        <div className="flex items-center gap-2 pl-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Open</span>
          <span className="text-lg leading-none text-slate-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-slate-500">
            &gt;
          </span>
        </div>
      ) : null}
    </>
  );

  if (!group.supported) {
    return (
      <div className="border-t border-slate-200/80 first:border-t-0">
        <div className="flex items-start justify-between gap-4 py-4">{body}</div>
      </div>
    );
  }

  return (
    <div className="border-t border-slate-200/80 first:border-t-0">
      <button
        type="button"
        onClick={() => interactive && onOpen(kind)}
        disabled={!interactive}
        className={`group flex w-full items-start justify-between gap-4 py-4 text-left transition-colors ${
          interactive ? "hover:bg-slate-50/80" : "cursor-default"
        }`}
      >
        {body}
      </button>
    </div>
  );
}

function ResourceOverlay({
  agent,
  kind,
  group,
  onClose,
}: {
  agent: AgentCard;
  kind: AgentResourceKind;
  group: AgentResourceGroup;
  onClose: () => void;
}) {
  const theme = CLI_THEME[agent.id];
  const style = RESOURCE_STYLE[kind];
  const enabledCount = useMemo(() => enabledResourceCount(group), [group]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 bg-[#0f172a]/24 backdrop-blur-[3px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${agent.label} ${RESOURCE_LABEL[kind]} inventory`}
    >
      <div className="absolute inset-x-4 bottom-4 top-4 mx-auto max-w-[980px] overflow-hidden rounded-[30px] border border-slate-200 bg-[#f8fafc] shadow-[0_40px_140px_rgba(15,23,42,0.24)]">
        <div className="border-b border-slate-200 bg-white/94 px-6 py-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-2xl ${theme.soft} ${theme.text} text-sm font-semibold uppercase`}
                >
                  {agent.label.slice(0, 2)}
                </div>
                <div
                  className={`inline-flex h-10 min-w-10 items-center justify-center rounded-2xl border px-3 text-[10px] font-semibold uppercase tracking-[0.16em] ${style.tint} ${style.text} ${style.border}`}
                >
                  {style.token}
                </div>
                <div className="min-w-0">
                  <div className="text-[19px] font-semibold tracking-[-0.03em] text-slate-950">
                    {agent.label} {RESOURCE_LABEL[kind]}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    Full inventory for this CLI surface.
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
                  Runtime {runtimeLabel(agent)}
                </span>
                <span className={`rounded-full px-2.5 py-1 font-medium ${style.glow} ${style.text}`}>
                  {group.items.length} item{group.items.length === 1 ? "" : "s"}
                </span>
                {group.supported ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
                    {enabledCount}/{group.items.length} enabled
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                    Unavailable
                  </span>
                )}
                {group.error ? (
                  <span className="rounded-full bg-rose-50 px-2.5 py-1 font-medium text-rose-700">
                    Read error
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
              aria-label="Close resource inventory"
            >
              x
            </button>
          </div>
        </div>

        <div className="h-[calc(100%-117px)] overflow-y-auto">
          {!group.supported ? (
            <div className="px-6 py-6">
              <div className="rounded-[22px] border border-slate-200 bg-white px-5 py-5 text-sm text-slate-600">
                This resource surface is not available for {agent.label}.
              </div>
            </div>
          ) : (
            <div className="px-6 py-6">
              {group.error ? (
                <div className="mb-4 rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm leading-6 text-rose-700">
                  {group.error}
                </div>
              ) : null}

              {group.items.length === 0 ? (
                <div className="rounded-[22px] border border-slate-200 bg-white px-5 py-5 text-sm text-slate-500">
                  No items detected for this surface.
                </div>
              ) : (
                <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-slate-200 bg-slate-50/90 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    <div>Resource</div>
                    <div>Metadata</div>
                  </div>

                  {group.items.map((item, index) => (
                    <div
                      key={`${kind}-${item.name}-${item.source ?? ""}-${index}`}
                      className="grid gap-4 border-b border-slate-200/80 px-5 py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-semibold text-slate-950">{item.name}</div>
                          {!item.enabled ? (
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                              Off
                            </span>
                          ) : null}
                        </div>
                        {item.detail ? (
                          <div className="mt-2 text-sm leading-6 text-slate-500">{item.detail}</div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center justify-start gap-2 md:max-w-[320px] md:justify-end">
                        {item.source ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                            {item.source}
                          </span>
                        ) : null}
                        {item.version ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                            v{item.version}
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                            item.enabled
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {item.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CliInventoryPanel({
  agent,
  onOpenResource,
}: {
  agent: AgentCard;
  onOpenResource: (agentId: AgentId, kind: AgentResourceKind) => void;
}) {
  const theme = CLI_THEME[agent.id];
  const resources = runtimeResources(agent);
  const total = totalResources(agent);

  return (
    <section className={`overflow-hidden rounded-[30px] border border-slate-200 bg-white px-6 py-6 ${theme.glow}`}>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-2xl ${theme.soft} ${theme.text} text-sm font-semibold uppercase`}
            >
              {agent.label.slice(0, 2)}
            </div>
            <div className="min-w-0">
              <div className="text-[18px] font-semibold tracking-[-0.03em] text-slate-950">
                {agent.label}
              </div>
              <div className="mt-1 truncate text-sm text-slate-500">{agent.specialty}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
              Runtime {runtimeLabel(agent)}
            </span>
            <span className={`rounded-full px-2.5 py-1 font-medium ${theme.soft} ${theme.text}`}>
              {RESOURCE_ORDER.filter((kind) => resources[kind].supported).length} surfaces
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
              Tap a lane to inspect
            </span>
          </div>
        </div>

        <div className={`shrink-0 rounded-[24px] border border-slate-200 px-4 py-3 text-right ${theme.wash}`}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Inventory
          </div>
          <div className="mt-2 text-[30px] font-semibold tracking-[-0.05em] text-slate-950">{total}</div>
          <div className="text-xs text-slate-500">Detected items</div>
        </div>
      </div>

      <div className="mt-6 rounded-[28px] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,0.96))] px-5 py-2">
        {RESOURCE_ORDER.map((kind) => (
          <ResourceLane
            key={`${agent.id}-${kind}`}
            kind={kind}
            group={resources[kind]}
            onOpen={(resourceKind) => onOpenResource(agent.id, resourceKind)}
          />
        ))}
      </div>
    </section>
  );
}

export function DashboardPage() {
  const appState = useStore((s) => s.appState);
  const [resourceOverlay, setResourceOverlay] = useState<ResourceOverlayState | null>(null);

  const artifactCounts = useMemo(() => {
    if (!appState) return [];
    const counts = new Map<string, number>();
    for (const artifact of appState.artifacts) {
      counts.set(artifact.kind, (counts.get(artifact.kind) ?? 0) + 1);
    }
    return Array.from(counts.entries());
  }, [appState]);

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

  const { workspace, activity, handoffs, artifacts, agents, terminalByAgent } = appState;
  const labelFor = (id: string) => agents.find((agent) => agent.id === id)?.label ?? id;
  const overlayAgent = resourceOverlay
    ? agents.find((agent) => agent.id === resourceOverlay.agentId) ?? null
    : null;
  const overlayGroup =
    overlayAgent && resourceOverlay
      ? runtimeResources(overlayAgent)[resourceOverlay.kind]
      : null;

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.08),_transparent_28%),linear-gradient(180deg,#f8fafc_0%,#ffffff_52%,#f8fafc_100%)]">
      <div className="mx-auto max-w-[1480px] px-6 py-8 lg:px-8">
        <section className="rounded-[34px] border border-slate-200 bg-white/90 px-6 py-6 shadow-[0_28px_80px_rgba(15,23,42,0.08)] backdrop-blur lg:px-8">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.3fr)_420px]">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Workspace Overview
              </div>
              <div className="mt-3 text-[38px] font-semibold tracking-[-0.05em] text-slate-950">
                {workspace.projectName}
              </div>
              <div className="mt-3 max-w-3xl text-sm leading-7 text-slate-500">
                The dashboard focuses on resource inventory, traffic, and cross-CLI coordination for the current project.
              </div>
              <div className="mt-5 rounded-[24px] bg-slate-950 px-4 py-4 font-mono text-[12px] leading-6 text-slate-100">
                {workspace.projectRoot}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              <MetricStrip
                label="Installed CLIs"
                value={String(installedCliCount)}
                helper="Runtimes detected on this machine"
              />
              <MetricStrip
                label="Resource Items"
                value={String(inventoryCount)}
                helper="Total MCP, skills, plugins, and extensions"
              />
              <MetricStrip
                label="Artifacts"
                value={String(artifacts.length)}
                helper="Saved plans, reviews, and UI notes"
              />
              <MetricStrip
                label="Handoffs"
                value={String(handoffs.length)}
                helper="Cross-CLI transfer records"
              />
            </div>
          </div>

          <div className="mt-8">
            <SessionVolumeChart agents={agents} terminalByAgent={terminalByAgent} />
          </div>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-3">
          {agents.map((agent) => (
            <CliInventoryPanel
              key={agent.id}
              agent={agent}
              onOpenResource={(agentId, kind) => setResourceOverlay({ agentId, kind })}
            />
          ))}
        </section>

        <section className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_420px]">
          <div className="rounded-[30px] border border-slate-200 bg-white px-6 py-6">
            <SectionHeading
              eyebrow="Recent Activity"
              title="Latest orchestration timeline"
              detail={`${activity.length} events in memory`}
            />
            <div className="mt-8 space-y-3">
              {activity.length === 0 ? (
                <div className="rounded-[18px] bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  No activity recorded yet.
                </div>
              ) : (
                activity.slice(0, 8).map((item) => (
                  <div
                    key={item.id}
                    className="grid gap-3 rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-4 sm:grid-cols-[92px_minmax(0,1fr)]"
                  >
                    <div className="text-sm font-medium text-slate-500">{item.time}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClasses(item.tone)}`}
                        >
                          {item.tone}
                        </span>
                        <span className="text-sm font-semibold text-slate-950">{item.title}</span>
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[30px] border border-slate-200 bg-white px-6 py-6">
              <SectionHeading
                eyebrow="Artifacts"
                title="Output distribution"
                detail={`${artifacts.length} stored artifacts`}
              />
              <div className="mt-8 space-y-4">
                {artifactCounts.length === 0 ? (
                  <div className="rounded-[18px] bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    No artifacts captured yet.
                  </div>
                ) : (
                  artifactCounts.map(([kind, count]) => {
                    const max = Math.max(1, ...artifactCounts.map(([, value]) => value));
                    return (
                      <div key={kind}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="text-sm font-medium capitalize text-slate-900">{kind}</div>
                          <div className="text-sm text-slate-500">{count}</div>
                        </div>
                        <div className="h-3 rounded-full bg-slate-100">
                          <div
                            className={`h-3 rounded-full ${artifactChartColor(kind)}`}
                            style={{ width: `${Math.max(10, (count / max) * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-[30px] border border-slate-200 bg-white px-6 py-6">
              <SectionHeading eyebrow="Handoffs" title="Cross-CLI readiness" detail={`${handoffs.length} tracked handoffs`} />
              <div className="mt-6 space-y-3">
                {handoffs.length === 0 ? (
                  <div className="rounded-[18px] bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    No handoffs available.
                  </div>
                ) : (
                  handoffs.slice(0, 4).map((handoff) => (
                    <div key={handoff.id} className="rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-950">
                          {labelFor(handoff.from)} → {labelFor(handoff.to)}
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClasses(handoff.status === "blocked" ? "danger" : handoff.status === "draft" ? "warning" : "success")}`}>
                          {handoff.status}
                        </span>
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-600">{handoff.goal}</div>
                      <div className="mt-3 text-xs text-slate-500">
                        {handoff.files.length} files • updated {handoff.updatedAt}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        {overlayAgent && resourceOverlay && overlayGroup ? (
          <ResourceOverlay
            agent={overlayAgent}
            kind={resourceOverlay.kind}
            group={overlayGroup}
            onClose={() => setResourceOverlay(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
