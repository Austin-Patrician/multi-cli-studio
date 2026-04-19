const LEGACY_AGENT_ICON_OPTIONS = [
  "codicon-hubot",
  "codicon-robot",
] as const;

const ROBOT_AGENT_ICON_OPTIONS = [
  "agent-robot-01",
  "agent-robot-02",
  "agent-robot-03",
  "agent-robot-04",
  "agent-robot-05",
  "agent-robot-06",
  "agent-robot-07",
  "agent-robot-08",
  "agent-robot-09",
  "agent-robot-10",
  "agent-robot-11",
  "agent-robot-12",
  "agent-robot-13",
  "agent-robot-14",
  "agent-robot-15",
] as const;

export const AGENT_ICON_OPTIONS = ROBOT_AGENT_ICON_OPTIONS;

export const AGENT_ICON_GROUPS = [
  {
    id: "masculine",
    label: "男性",
    icons: ROBOT_AGENT_ICON_OPTIONS.slice(0, 5),
  },
  {
    id: "feminine",
    label: "女性",
    icons: ROBOT_AGENT_ICON_OPTIONS.slice(5, 10),
  },
  {
    id: "neutral",
    label: "中性",
    icons: ROBOT_AGENT_ICON_OPTIONS.slice(10, 15),
  },
] as const;

export type LegacyAgentIcon = (typeof LEGACY_AGENT_ICON_OPTIONS)[number];
export type RobotAgentIcon = (typeof ROBOT_AGENT_ICON_OPTIONS)[number];
export type AgentIconId = LegacyAgentIcon | RobotAgentIcon;

export const DEFAULT_AGENT_ICON: AgentIconId = AGENT_ICON_OPTIONS[0];

const AGENT_ICON_SET = new Set<string>([
  ...LEGACY_AGENT_ICON_OPTIONS,
  ...ROBOT_AGENT_ICON_OPTIONS,
]);

function normalizeSeed(seed: unknown): string {
  return typeof seed === "string" ? seed.trim() : "";
}

function hashSeedFNV1a(seed: string): number {
  let hash = 0x811c9dc5;
  for (const char of seed) {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint !== "number") continue;
    hash ^= codePoint;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function normalizeAgentIcon(value: unknown): AgentIconId | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (AGENT_ICON_SET.has(trimmed)) {
    return trimmed as AgentIconId;
  }
  const normalizedLegacy = trimmed.startsWith("codicon-") ? trimmed : `codicon-${trimmed}`;
  if (AGENT_ICON_SET.has(normalizedLegacy)) {
    return normalizedLegacy as AgentIconId;
  }
  return null;
}

export function resolveAgentIcon(
  value: unknown,
  fallback: AgentIconId = DEFAULT_AGENT_ICON
): AgentIconId {
  return normalizeAgentIcon(value) ?? fallback;
}

export function deriveAgentIconFromSeed(
  seed: unknown,
  fallback: AgentIconId = DEFAULT_AGENT_ICON
): AgentIconId {
  const normalizedSeed = normalizeSeed(seed);
  if (!normalizedSeed) return fallback;
  const index = hashSeedFNV1a(normalizedSeed) % AGENT_ICON_OPTIONS.length;
  return AGENT_ICON_OPTIONS[index] ?? fallback;
}

export function resolveAgentIconBySeed(
  icon: unknown,
  seed: unknown,
  fallback: AgentIconId = DEFAULT_AGENT_ICON
): AgentIconId {
  return normalizeAgentIcon(icon) ?? deriveAgentIconFromSeed(seed, fallback);
}

export function resolveAgentIconForAgent(
  agent: { id?: unknown; name?: unknown; icon?: unknown } | null | undefined,
  fallback: AgentIconId = DEFAULT_AGENT_ICON
): AgentIconId {
  if (!agent) return fallback;
  const explicit = normalizeAgentIcon(agent.icon);
  if (explicit) return explicit;
  return deriveAgentIconFromSeed(normalizeSeed(agent.id) || normalizeSeed(agent.name), fallback);
}

const AGENT_ICON_SVG_BY_ID: Record<AgentIconId, string> = {
  "codicon-hubot":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v2.2"/><rect x="5" y="6.3" width="14" height="9.5" rx="3.2"/><circle cx="9.4" cy="10.2" r=".72" fill="currentColor"/><circle cx="14.6" cy="10.2" r=".72" fill="currentColor"/><path d="M9.5 13.1c.7.6 1.6.9 2.5.9s1.8-.3 2.5-.9"/><path d="M5 10H3.8v2"/><path d="M19 10h1.2v2"/><path d="M10.1 15.8v2.8"/><path d="M13.9 15.8v2.8"/></svg>',
  "codicon-robot":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2v1.8"/><rect x="5.6" y="6.1" width="12.8" height="9.8" rx="3"/><rect x="8.8" y="9.6" width="6.4" height="1.8" rx=".9"/><path d="M9.6 13.3h4.8"/><path d="M5.6 10H4.4v2"/><path d="M18.4 10h1.2v2"/><path d="M10.2 15.9v2.7"/><path d="M13.8 15.9v2.7"/></svg>',
  "agent-robot-01":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2v2"/><rect x="5" y="6" width="14" height="9.8" rx="3.2"/><circle cx="9.5" cy="10.1" r=".72" fill="currentColor"/><circle cx="14.5" cy="10.1" r=".72" fill="currentColor"/><path d="M9.4 13c.8.6 1.7.9 2.6.9s1.8-.3 2.6-.9"/><path d="M5 9.8H3.8v2.1"/><path d="M19 9.8h1.2v2.1"/><path d="M10 15.8v2.9"/><path d="M14 15.8v2.9"/></svg>',
  "agent-robot-02":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2v1.8"/><rect x="5.8" y="6.1" width="12.4" height="9.8" rx="4.9"/><circle cx="9.7" cy="10.3" r=".65" fill="currentColor"/><circle cx="14.3" cy="10.3" r=".65" fill="currentColor"/><path d="M10 13.2h4"/><path d="M5.8 10H4.5v2"/><path d="M18.2 10h1.3v2"/><path d="M10.2 15.9v2.6"/><path d="M13.8 15.9v2.6"/></svg>',
  "agent-robot-03":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="m8.1 6.9 1.1-1.6"/><path d="m15.9 6.9-1.1-1.6"/><rect x="5.2" y="6.9" width="13.6" height="9.8" rx="3.1"/><rect x="8.4" y="9.7" width="7.2" height="1.9" rx=".95"/><path d="M9.5 13.6h5"/><path d="M5.2 10H4v2.1"/><path d="M18.8 10H20v2.1"/><path d="M9.9 16.7v2.7"/><path d="M14.1 16.7v2.7"/></svg>',
  "agent-robot-04":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.1v1.8"/><rect x="5.1" y="6.1" width="13.8" height="9.9" rx="3"/><circle cx="12" cy="10.1" r="1.3"/><path d="M9.5 13h5"/><path d="M5.1 9.9H4v2.1"/><path d="M18.9 9.9H20v2.1"/><path d="M10 16v2.8"/><path d="M14 16v2.8"/></svg>',
  "agent-robot-05":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.3v1.7"/><path d="M9 5h6"/><rect x="6" y="6.8" width="12" height="9.3" rx="2.7"/><circle cx="10.1" cy="10.2" r=".62" fill="currentColor"/><circle cx="13.9" cy="10.2" r=".62" fill="currentColor"/><path d="M10.1 12.8h3.8"/><path d="M6 10H4.7v2"/><path d="M18 10h1.3v2"/><path d="M10.2 16.1v2.8"/><path d="M13.8 16.1v2.8"/></svg>',
  "agent-robot-06":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2v1.8"/><rect x="5.4" y="6.1" width="13.2" height="9.7" rx="4.8"/><circle cx="9.5" cy="10" r=".58" fill="currentColor"/><circle cx="14.5" cy="10" r=".58" fill="currentColor"/><path d="M9.4 12.4h5.2"/><path d="M9.3 14.2c.8.6 1.7.9 2.7.9s1.9-.3 2.7-.9"/><path d="M5.4 9.8H4.2v2"/><path d="M18.6 9.8h1.2v2"/><path d="M10 15.8v2.8"/><path d="M14 15.8v2.8"/></svg>',
  "agent-robot-07":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="m8.5 6.2 1-1.6"/><path d="m15.5 6.2-1-1.6"/><rect x="5.6" y="6.2" width="12.8" height="9.9" rx="3"/><rect x="8.7" y="9.5" width="1.8" height="1.8" rx=".45"/><rect x="13.5" y="9.5" width="1.8" height="1.8" rx=".45"/><path d="M9.6 13.3h4.8"/><path d="M5.6 10H4.4v2"/><path d="M18.4 10h1.2v2"/><path d="M10.1 16.1v2.8"/><path d="M13.9 16.1v2.8"/></svg>',
  "agent-robot-08":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.1v1.8"/><rect x="5.5" y="6" width="13" height="9.8" rx="3.1"/><circle cx="9.7" cy="8.9" r=".56" fill="currentColor"/><circle cx="14.3" cy="8.9" r=".56" fill="currentColor"/><path d="M9.2 10.9h5.6"/><path d="M10 13h4"/><path d="M5.5 9.8H4.3v2"/><path d="M18.5 9.8h1.2v2"/><path d="M10.2 15.8v2.9"/><path d="M13.8 15.8v2.9"/></svg>',
  "agent-robot-09":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="8.1" y="3.8" width="7.8" height="4.9" rx="2"/><circle cx="10.8" cy="6.2" r=".5" fill="currentColor"/><circle cx="13.2" cy="6.2" r=".5" fill="currentColor"/><path d="M10.7 7.7h2.6"/><rect x="8.8" y="9.8" width="6.4" height="5.2" rx="2.1"/><path d="M8.8 11.2 6.4 12.8"/><path d="M15.2 11.2 17.6 12.8"/><path d="M10.2 15v4.4"/><path d="M13.8 15v4.4"/><path d="M9.4 19.4h1.6"/><path d="M13 19.4h1.6"/></svg>',
  "agent-robot-10":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="7.8" y="3.7" width="8.4" height="5.1" rx="2.3"/><path d="M12 2.6v1.1"/><circle cx="10.7" cy="6.1" r=".5" fill="currentColor"/><circle cx="13.3" cy="6.1" r=".5" fill="currentColor"/><path d="M10.7 7.6h2.6"/><rect x="8.6" y="9.7" width="6.8" height="5.4" rx="2.4"/><path d="M8.6 11.4H6.1"/><path d="M15.4 11.4h2.5"/><path d="M10.3 15.1 9.4 19"/><path d="M13.7 15.1 14.6 19"/><path d="M8.9 19h1.4"/><path d="M13.7 19h1.4"/></svg>',
  "agent-robot-11":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3.6" width="8" height="5" rx="1.9"/><path d="M9.4 6.1h1"/><path d="M13.6 6.1h1"/><path d="M10.7 7.5h2.6"/><path d="M8.6 10.1h6.8"/><path d="M12 10.1v5.2"/><path d="M8.6 11.2 6 13.2"/><path d="M15.4 11.2 18 13.2"/><path d="M10.2 15.3v4.2"/><path d="M13.8 15.3v4.2"/><path d="M9.2 19.5h1.7"/><path d="M13.1 19.5h1.7"/></svg>',
  "agent-robot-12":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="7.6" y="3.8" width="8.8" height="4.8" rx="2.4"/><circle cx="10.8" cy="6.1" r=".52" fill="currentColor"/><circle cx="13.2" cy="6.1" r=".52" fill="currentColor"/><rect x="8.4" y="9.6" width="7.2" height="5.6" rx="2.8"/><path d="M8.4 11.7h-2.1"/><path d="M15.6 11.7h2.1"/><path d="M10.2 15.2 9.8 19.3"/><path d="M13.8 15.2 14.2 19.3"/><path d="M9.2 19.3h1.2"/><path d="M13.6 19.3h1.2"/></svg>',
  "agent-robot-13":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.28" stroke-linecap="round" stroke-linejoin="round"><rect x="8.2" y="3.7" width="7.6" height="5.1" rx="2"/><path d="M9.1 5.8h1.2"/><path d="M13.7 5.8h1.2"/><path d="M10.8 7.6h2.4"/><rect x="8.9" y="9.9" width="6.2" height="4.8" rx="2"/><path d="M8.9 11.5 6.7 13.8"/><path d="M15.1 11.5 17.3 13.8"/><path d="M10.4 14.7v4.6"/><path d="M13.6 14.7v4.6"/><path d="M9.6 19.3h1.4"/><path d="M13 19.3h1.4"/></svg>',
  "agent-robot-14":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="7.9" y="3.6" width="8.2" height="5" rx="2.2"/><circle cx="10.7" cy="6" r=".5" fill="currentColor"/><circle cx="13.3" cy="6" r=".5" fill="currentColor"/><path d="M10.7 7.5h2.6"/><path d="M8.2 10.1h7.6"/><path d="M12 10.1v5.2"/><path d="M8.2 11.4h-2.4"/><path d="M15.8 11.4h2.4"/><path d="M10.3 15.3 9.2 19.2"/><path d="M13.7 15.3 14.8 19.2"/><path d="M8.7 19.2h1.4"/><path d="M13.9 19.2h1.4"/></svg>',
  "agent-robot-15":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3.7" width="8" height="5" rx="2"/><path d="M12 2.6v1.1"/><circle cx="10.8" cy="6" r=".48" fill="currentColor"/><circle cx="13.2" cy="6" r=".48" fill="currentColor"/><path d="M10.7 7.6h2.6"/><rect x="8.7" y="9.7" width="6.6" height="5.5" rx="2.2"/><path d="M8.7 11.4 6.2 12.4"/><path d="M15.3 11.4 17.8 12.4"/><path d="M10.3 15.2v4.1"/><path d="M13.7 15.2v4.1"/><path d="M9.5 19.3h1.5"/><path d="M13 19.3h1.5"/></svg>',
};

function ensureScalableSvgMarkup(svgMarkup: string): string {
  if (!svgMarkup.includes("<svg")) return svgMarkup;
  if (svgMarkup.includes('width="100%"') && svgMarkup.includes('height="100%"')) {
    return svgMarkup;
  }
  return svgMarkup.replace("<svg ", '<svg width="100%" height="100%" ');
}

export function getAgentIconSvgMarkup(icon: unknown): string | null {
  const normalized = normalizeAgentIcon(icon);
  if (!normalized) return null;
  const svgMarkup = AGENT_ICON_SVG_BY_ID[normalized] ?? null;
  return svgMarkup ? ensureScalableSvgMarkup(svgMarkup) : null;
}

