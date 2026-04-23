const LEGACY_AGENT_ICON_OPTIONS = ["codicon-hubot", "codicon-robot"] as const;

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

const AVATAR_AGENT_ICON_OPTIONS = [
  "avatar-scout-01",
  "avatar-builder-02",
  "avatar-analyst-03",
  "avatar-pilot-04",
  "avatar-orbit-05",
  "avatar-ranger-06",
  "avatar-zenith-07",
  "avatar-signal-08",
  "avatar-comet-09",
  "avatar-ember-10",
  "avatar-grove-11",
  "avatar-lumen-12",
] as const;

export const AGENT_ICON_OPTIONS = AVATAR_AGENT_ICON_OPTIONS;

export type LegacyAgentIcon = (typeof LEGACY_AGENT_ICON_OPTIONS)[number];
export type RobotAgentIcon = (typeof ROBOT_AGENT_ICON_OPTIONS)[number];
export type AvatarAgentIcon = (typeof AVATAR_AGENT_ICON_OPTIONS)[number];
export type AgentIconId = LegacyAgentIcon | RobotAgentIcon | AvatarAgentIcon;

export type AgentIconChoice = {
  id: AvatarAgentIcon;
  label: string;
  description: string;
};

type AvatarIconDefinition = {
  label: string;
  description: string;
  bgStart: string;
  bgEnd: string;
  glow: string;
  skin: string;
  hair: string;
  jacket: string;
  accent: string;
  brow: string;
  accessory: "spark" | "visor" | "headset" | "crown" | "leaf" | "halo";
};

const AVATAR_ICON_LIBRARY: Record<AvatarAgentIcon, AvatarIconDefinition> = {
  "avatar-scout-01": {
    label: "潮汐侦察员",
    description: "青绿脉冲，轻快灵动。",
    bgStart: "#083344",
    bgEnd: "#14b8a6",
    glow: "#5eead4",
    skin: "#f4c7a1",
    hair: "#062b33",
    jacket: "#0f766e",
    accent: "#facc15",
    brow: "#d97706",
    accessory: "spark",
  },
  "avatar-builder-02": {
    label: "琥珀工匠",
    description: "暖金层次，偏执行型。",
    bgStart: "#4c1d06",
    bgEnd: "#f59e0b",
    glow: "#fdba74",
    skin: "#f7d4b4",
    hair: "#5b3716",
    jacket: "#9a3412",
    accent: "#fde68a",
    brow: "#ea580c",
    accessory: "visor",
  },
  "avatar-analyst-03": {
    label: "深海分析师",
    description: "冷蓝渐层，理性干净。",
    bgStart: "#172554",
    bgEnd: "#2563eb",
    glow: "#93c5fd",
    skin: "#ebc8a9",
    hair: "#0f172a",
    jacket: "#1d4ed8",
    accent: "#bfdbfe",
    brow: "#2563eb",
    accessory: "halo",
  },
  "avatar-pilot-04": {
    label: "霓虹领航员",
    description: "洋红与蓝绿，速度感更强。",
    bgStart: "#581c87",
    bgEnd: "#ec4899",
    glow: "#f5d0fe",
    skin: "#f3c9a8",
    hair: "#3b0764",
    jacket: "#be185d",
    accent: "#67e8f9",
    brow: "#db2777",
    accessory: "headset",
  },
  "avatar-orbit-05": {
    label: "轨道协调员",
    description: "蓝紫冷光，结构清晰。",
    bgStart: "#312e81",
    bgEnd: "#6366f1",
    glow: "#c4b5fd",
    skin: "#f1c5a0",
    hair: "#1e1b4b",
    jacket: "#4338ca",
    accent: "#e0e7ff",
    brow: "#6366f1",
    accessory: "halo",
  },
  "avatar-ranger-06": {
    label: "风暴游侠",
    description: "墨绿冷灰，偏探索气质。",
    bgStart: "#052e2b",
    bgEnd: "#0f766e",
    glow: "#99f6e4",
    skin: "#e8bc96",
    hair: "#022c22",
    jacket: "#115e59",
    accent: "#ccfbf1",
    brow: "#0d9488",
    accessory: "leaf",
  },
  "avatar-zenith-07": {
    label: "顶点策展人",
    description: "樱粉与石墨，偏审美导向。",
    bgStart: "#4a044e",
    bgEnd: "#f472b6",
    glow: "#fbcfe8",
    skin: "#f6cfb2",
    hair: "#3f0d2f",
    jacket: "#9d174d",
    accent: "#fdf2f8",
    brow: "#ec4899",
    accessory: "crown",
  },
  "avatar-signal-08": {
    label: "信号调度官",
    description: "湖蓝明亮，界面感很强。",
    bgStart: "#0f172a",
    bgEnd: "#06b6d4",
    glow: "#67e8f9",
    skin: "#efc7a6",
    hair: "#082f49",
    jacket: "#0e7490",
    accent: "#ecfeff",
    brow: "#0891b2",
    accessory: "visor",
  },
  "avatar-comet-09": {
    label: "彗星快反者",
    description: "深空紫和亮橙，对比明显。",
    bgStart: "#1f1147",
    bgEnd: "#8b5cf6",
    glow: "#ddd6fe",
    skin: "#f2caa7",
    hair: "#1e1b4b",
    jacket: "#6d28d9",
    accent: "#fb923c",
    brow: "#7c3aed",
    accessory: "spark",
  },
  "avatar-ember-10": {
    label: "余烬策士",
    description: "砖红与金黄，情绪更饱满。",
    bgStart: "#431407",
    bgEnd: "#ef4444",
    glow: "#fdba74",
    skin: "#f0c29b",
    hair: "#3f1d12",
    jacket: "#b91c1c",
    accent: "#fde047",
    brow: "#dc2626",
    accessory: "crown",
  },
  "avatar-grove-11": {
    label: "林地顾问",
    description: "松绿渐变，柔和稳定。",
    bgStart: "#14532d",
    bgEnd: "#22c55e",
    glow: "#bbf7d0",
    skin: "#eec49d",
    hair: "#16351f",
    jacket: "#15803d",
    accent: "#fef08a",
    brow: "#16a34a",
    accessory: "leaf",
  },
  "avatar-lumen-12": {
    label: "流明主持人",
    description: "奶白与电蓝，偏未来感。",
    bgStart: "#1e293b",
    bgEnd: "#38bdf8",
    glow: "#bae6fd",
    skin: "#f6cfaf",
    hair: "#0f172a",
    jacket: "#0284c7",
    accent: "#f8fafc",
    brow: "#38bdf8",
    accessory: "headset",
  },
};

export const AGENT_ICON_CHOICES: AgentIconChoice[] = AGENT_ICON_OPTIONS.map((id) => ({
  id,
  label: AVATAR_ICON_LIBRARY[id].label,
  description: AVATAR_ICON_LIBRARY[id].description,
}));

export const DEFAULT_AGENT_ICON: AgentIconId = AGENT_ICON_OPTIONS[0];

const AGENT_ICON_SET = new Set<string>([
  ...LEGACY_AGENT_ICON_OPTIONS,
  ...ROBOT_AGENT_ICON_OPTIONS,
  ...AVATAR_AGENT_ICON_OPTIONS,
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

function createAccessoryMarkup(
  accessory: AvatarIconDefinition["accessory"],
  accent: string,
  iconId: string
) {
  switch (accessory) {
    case "spark":
      return `
        <path d="M17.3 5.4 18 7.2l1.9.6-1.9.6-.7 1.8-.7-1.8-1.8-.6 1.8-.6Z" fill="${accent}" opacity="0.96">
          <animateTransform attributeName="transform" type="scale" values="1;1.12;1" dur="3.4s" repeatCount="indefinite" />
        </path>
      `;
    case "visor":
      return `
        <rect x="8.2" y="8.8" width="7.6" height="1.9" rx="0.95" fill="${accent}" opacity="0.92" />
      `;
    case "headset":
      return `
        <path d="M7.6 11.2a4.4 4.4 0 0 1 8.8 0" stroke="${accent}" stroke-width="1.2" stroke-linecap="round" fill="none" opacity="0.9" />
        <rect x="7.1" y="11.2" width="1.1" height="2.2" rx="0.55" fill="${accent}" />
        <rect x="15.8" y="11.2" width="1.1" height="2.2" rx="0.55" fill="${accent}" />
      `;
    case "crown":
      return `
        <path d="M8.6 6.2 10 4.8l2 1.5 2-1.5 1.4 1.4-.5 1.4H9.1Z" fill="${accent}" />
      `;
    case "leaf":
      return `
        <path d="M17.7 5.6c-1.9.1-3 1.2-3.3 3 .9.2 1.8 0 2.5-.5.7-.6 1-1.4.8-2.5Z" fill="${accent}" opacity="0.96">
          <animateTransform attributeName="transform" type="rotate" values="0 16 7;6 16 7;0 16 7" dur="4.2s" repeatCount="indefinite" />
        </path>
      `;
    case "halo":
      return `
        <ellipse cx="12" cy="5.8" rx="3.2" ry="1.15" fill="none" stroke="${accent}" stroke-width="1.1" opacity="0.9">
          <animate attributeName="opacity" values="0.7;1;0.7" dur="3.2s" repeatCount="indefinite" />
        </ellipse>
      `;
    default:
      return "";
  }
}

function createAvatarSvg(iconId: AvatarAgentIcon, definition: AvatarIconDefinition) {
  return `
    <svg width="100%" height="100%" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
      <defs>
        <linearGradient id="${iconId}-bg" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop stop-color="${definition.bgStart}" />
          <stop offset="1" stop-color="${definition.bgEnd}" />
        </linearGradient>
        <radialGradient id="${iconId}-glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(18 6) rotate(137.2) scale(10.2)">
          <stop stop-color="${definition.glow}" stop-opacity="0.85" />
          <stop offset="1" stop-color="${definition.glow}" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#${iconId}-bg)" />
      <circle cx="18" cy="6" r="5.2" fill="url(#${iconId}-glow)">
        <animate attributeName="opacity" values="0.55;0.9;0.55" dur="4.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="6" cy="18" r="4.4" fill="${definition.accent}" opacity="0.11">
        <animate attributeName="r" values="4.1;4.8;4.1" dur="4.8s" repeatCount="indefinite" />
      </circle>
      ${createAccessoryMarkup(definition.accessory, definition.accent, iconId)}
      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 -0.65;0 0" dur="4.8s" repeatCount="indefinite" />
        <path d="M7.1 19.2c.8-3.15 2.45-4.75 4.95-4.75s4.15 1.6 4.95 4.75H7.1Z" fill="${definition.jacket}" />
        <path d="M9.05 14.9c.95.6 1.92.9 2.95.9 1.03 0 2-.3 2.95-.9l.8 4.3H8.25l.8-4.3Z" fill="${definition.accent}" opacity="0.34" />
        <circle cx="12" cy="10.4" r="3.55" fill="${definition.skin}" />
        <path d="M8.55 10.2c.16-2.56 1.45-4 3.45-4 2.58 0 3.9 1.94 3.9 4.25-.7-1.02-1.75-1.65-3.1-1.65-1.52 0-2.78.52-4.25 1.4Z" fill="${definition.hair}" />
        <path d="M8.95 10.05c.25-.98.78-1.78 1.58-2.38" stroke="${definition.hair}" stroke-width="1.1" stroke-linecap="round" opacity="0.72" />
        <circle cx="10.65" cy="10.72" r="0.36" fill="#1f2937" />
        <circle cx="13.35" cy="10.72" r="0.36" fill="#1f2937" />
        <path d="M10.45 12.55c.42.4.95.6 1.55.6s1.13-.2 1.55-.6" stroke="${definition.brow}" stroke-width="0.9" stroke-linecap="round" />
      </g>
    </svg>
  `.trim();
}

function createRobotSvg(iconId: LegacyAgentIcon | RobotAgentIcon) {
  const numericSuffix = Number.parseInt(iconId.slice(-2), 10);
  const seed = Number.isFinite(numericSuffix) ? numericSuffix : iconId === "codicon-hubot" ? 2 : 1;
  const palette = [
    ["#dbeafe", "#60a5fa", "#0f172a"],
    ["#ede9fe", "#8b5cf6", "#1e1b4b"],
    ["#ccfbf1", "#14b8a6", "#042f2e"],
    ["#fce7f3", "#f472b6", "#4a044e"],
    ["#fef3c7", "#f59e0b", "#451a03"],
  ][seed % 5];
  const [bg, accent, stroke] = palette;
  const antennaHeight = 3 + (seed % 3) * 0.35;
  const eyeWidth = seed % 2 === 0 ? 1.5 : 1.1;
  const mouthY = 13.2 + (seed % 2) * 0.2;

  return `
    <svg width="100%" height="100%" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="${bg}" />
      <path d="M12 4.1v${antennaHeight}" stroke="${stroke}" stroke-width="1.2" stroke-linecap="round" />
      <circle cx="12" cy="3.5" r="1" fill="${accent}">
        <animate attributeName="r" values="0.92;1.16;0.92" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <rect x="5.1" y="7.2" width="13.8" height="8.8" rx="3.2" fill="white" stroke="${stroke}" stroke-width="1.15" />
      <rect x="8.1" y="10" width="${eyeWidth}" height="1.65" rx="0.52" fill="${accent}" />
      <rect x="${14.8 - eyeWidth}" y="10" width="${eyeWidth}" height="1.65" rx="0.52" fill="${accent}" />
      <path d="M9.4 ${mouthY}h5.2" stroke="${stroke}" stroke-width="1.1" stroke-linecap="round" />
      <path d="M5.1 10.8H3.9v1.5" stroke="${stroke}" stroke-width="1.1" stroke-linecap="round" />
      <path d="M18.9 10.8h1.2v1.5" stroke="${stroke}" stroke-width="1.1" stroke-linecap="round" />
      <path d="M10.1 16v2.55" stroke="${stroke}" stroke-width="1.1" stroke-linecap="round" />
      <path d="M13.9 16v2.55" stroke="${stroke}" stroke-width="1.1" stroke-linecap="round" />
    </svg>
  `.trim();
}

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

  const svgMarkup = normalized in AVATAR_ICON_LIBRARY
    ? createAvatarSvg(normalized as AvatarAgentIcon, AVATAR_ICON_LIBRARY[normalized as AvatarAgentIcon])
    : createRobotSvg(normalized as LegacyAgentIcon | RobotAgentIcon);

  return ensureScalableSvgMarkup(svgMarkup);
}
