import type { CustomAgentConfig, SelectedCustomAgent } from "./models";

export const AGENT_PROMPT_HEADER = "## Agent Role and Instructions";
export const AGENT_PROMPT_NAME_PREFIX = "Agent Name:";
export const AGENT_PROMPT_ICON_PREFIX = "Agent Icon:";

const AGENT_PROMPT_NAME_PREFIX_REGEX = /^Agent Name:\s*\S+/i;
const AGENT_PROMPT_ICON_PREFIX_REGEX = /^Agent Icon:\s*\S+/i;

export function normalizeSelectedCustomAgent(
  value: SelectedCustomAgent | CustomAgentConfig | null | undefined
): SelectedCustomAgent | null {
  if (!value) return null;
  const id = value.id?.trim();
  const name = value.name?.trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    prompt: value.prompt?.trim() ? value.prompt.trim() : null,
    icon: value.icon?.trim() ? value.icon.trim() : null,
  };
}

export function resolveSelectedCustomAgent(
  candidate: SelectedCustomAgent | null | undefined,
  catalog: CustomAgentConfig[] | null | undefined
): SelectedCustomAgent | null {
  const normalized = normalizeSelectedCustomAgent(candidate);
  if (!normalized) return null;
  const latest = catalog?.find((item) => item.id === normalized.id) ?? null;
  return normalizeSelectedCustomAgent(latest ?? normalized);
}

export function injectSelectedAgentPrompt(
  prompt: string,
  selectedAgent: SelectedCustomAgent | null | undefined
) {
  const normalizedPrompt = prompt.trim();
  const normalizedAgent = normalizeSelectedCustomAgent(selectedAgent);
  if (!normalizedAgent) return normalizedPrompt;
  const sections: string[] = [`${AGENT_PROMPT_NAME_PREFIX} ${normalizedAgent.name}`];
  if (normalizedAgent.icon) {
    sections.push(`${AGENT_PROMPT_ICON_PREFIX} ${normalizedAgent.icon}`);
  }
  if (normalizedAgent.prompt?.trim()) {
    sections.push(normalizedAgent.prompt.trim());
  }
  const agentBlock = sections.join("\n\n").trim();
  if (!agentBlock) return normalizedPrompt;
  if (normalizedPrompt.includes(AGENT_PROMPT_HEADER)) {
    return normalizedPrompt;
  }
  return [normalizedPrompt, AGENT_PROMPT_HEADER, agentBlock].filter(Boolean).join("\n\n");
}

export function stripInjectedSelectedAgentPromptBlock(text: string) {
  const headerIndex = text.lastIndexOf(AGENT_PROMPT_HEADER);
  if (headerIndex < 0) return text;
  const prefix = text.slice(0, headerIndex);
  const suffix = text.slice(headerIndex + AGENT_PROMPT_HEADER.length).replace(/^\s+/, "");
  if (!suffix) return text;
  const looksInjectedAgentBlock =
    AGENT_PROMPT_NAME_PREFIX_REGEX.test(suffix) ||
    AGENT_PROMPT_ICON_PREFIX_REGEX.test(suffix);
  if (!looksInjectedAgentBlock) return text;
  return prefix.replace(/\s+$/, "");
}

