import type { CustomPromptTemplate } from "./models";

const PROMPTS_CMD_PREFIX = "prompts";
const PROMPTS_CMD = `${PROMPTS_CMD_PREFIX}:`;
const PROMPT_ARG_REGEX = /\$[A-Z][A-Z0-9_]*/g;

type PromptLike = {
  name: string;
  content: string;
  argumentHint?: string | null;
};

function normalizeQuotes(input: string) {
  return input.replace(/[\u201C\u201D]/g, "\"").replace(/[\u2018\u2019]/g, "'");
}

export function filterCustomPromptsForWorkspace(
  prompts: CustomPromptTemplate[] | null | undefined,
  workspaceId: string | null | undefined,
) {
  return (prompts ?? []).filter((prompt) => {
    if (prompt.scope === "global") return true;
    return Boolean(workspaceId) && prompt.workspaceId === workspaceId;
  });
}

export function promptArgumentNames(content: string) {
  const names: string[] = [];
  const seen = new Set<string>();
  const matches = content.matchAll(PROMPT_ARG_REGEX);
  for (const match of matches) {
    const index = match.index ?? 0;
    if (index > 0 && content[index - 1] === "$") continue;
    const name = match[0].slice(1);
    if (name === "ARGUMENTS") continue;
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

export function promptHasNumericPlaceholders(content: string) {
  if (content.includes("$ARGUMENTS")) return true;
  for (let index = 0; index + 1 < content.length; index += 1) {
    if (content[index] === "$" && /[1-9]/.test(content[index + 1] ?? "")) {
      return true;
    }
  }
  return false;
}

export function getPromptArgumentHint(prompt: PromptLike) {
  const hint = prompt.argumentHint?.trim();
  if (hint) return hint;
  const names = promptArgumentNames(prompt.content);
  if (names.length > 0) {
    return names.map((name) => `${name}=""`).join(" ");
  }
  if (promptHasNumericPlaceholders(prompt.content)) {
    return "[args]";
  }
  return undefined;
}

export function buildPromptCommandName(promptName: string) {
  return `${PROMPTS_CMD}${promptName}`;
}

export function buildPromptCommand(promptName: string, args = "") {
  const suffix = args.trim();
  return `/${buildPromptCommandName(promptName)}${suffix ? ` ${suffix}` : ""}`;
}

export function buildPromptInsertText(prompt: CustomPromptTemplate) {
  const names = promptArgumentNames(prompt.content);
  let text = buildPromptCommand(prompt.name);
  let cursorOffset: number | undefined;
  names.forEach((name) => {
    if (cursorOffset === undefined) {
      cursorOffset = text.length + 1 + name.length + 2;
    }
    text += ` ${name}=""`;
  });
  return { text, cursorOffset };
}

export function parseSlashName(line: string) {
  if (!line.startsWith("/")) return null;
  const stripped = line.slice(1);
  let nameEnd = stripped.length;
  for (let index = 0; index < stripped.length; index += 1) {
    if (/\s/.test(stripped[index] ?? "")) {
      nameEnd = index;
      break;
    }
  }
  const name = stripped.slice(0, nameEnd);
  if (!name) return null;
  return {
    name,
    rest: stripped.slice(nameEnd).trimStart(),
  };
}

function splitShlex(input: string) {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (!inSingle && char === "\\") {
      escaped = true;
      continue;
    }
    if (!inDouble && char === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && char === "\"") {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}

type PromptArgsError =
  | { kind: "MissingAssignment"; token: string }
  | { kind: "MissingKey"; token: string };

type PromptInputsResult = { values: Record<string, string> } | { error: PromptArgsError };

function parsePromptInputs(rest: string): PromptInputsResult {
  const values: Record<string, string> = {};
  if (!rest.trim()) return { values };
  const tokens = splitShlex(normalizeQuotes(rest));
  for (const token of tokens) {
    const eqIndex = token.indexOf("=");
    if (eqIndex <= 0) {
      if (eqIndex === 0) return { error: { kind: "MissingKey", token } };
      return { error: { kind: "MissingAssignment", token } };
    }
    values[token.slice(0, eqIndex)] = token.slice(eqIndex + 1);
  }
  return { values };
}

function formatPromptArgsError(command: string, error: PromptArgsError) {
  if (error.kind === "MissingAssignment") {
    return `Could not parse ${command}: expected key=value but found '${error.token}'.`;
  }
  return `Could not parse ${command}: expected a name before '=' in '${error.token}'.`;
}

function expandNamedPlaceholders(content: string, inputs: Record<string, string>) {
  return content.replace(PROMPT_ARG_REGEX, (match, offset) => {
    if (offset > 0 && content[offset - 1] === "$") return match;
    return inputs[match.slice(1)] ?? match;
  });
}

function expandNumericPlaceholders(content: string, args: string[]) {
  let output = "";
  let index = 0;
  let cachedJoined: string | null = null;
  while (index < content.length) {
    const next = content.indexOf("$", index);
    if (next === -1) {
      output += content.slice(index);
      break;
    }
    output += content.slice(index, next);
    const rest = content.slice(next);
    const nextChar = rest[1];
    if (nextChar === "$" && rest.length >= 2) {
      output += "$$";
      index = next + 2;
      continue;
    }
    if (nextChar && /[1-9]/.test(nextChar)) {
      const argIndex = Number(nextChar) - 1;
      if (Number.isFinite(argIndex) && args[argIndex]) {
        output += args[argIndex];
      }
      index = next + 2;
      continue;
    }
    if (rest.length > 1 && rest.slice(1).startsWith("ARGUMENTS")) {
      if (args.length > 0) {
        cachedJoined ??= args.join(" ");
        output += cachedJoined;
      }
      index = next + 1 + "ARGUMENTS".length;
      continue;
    }
    output += "$";
    index = next + 1;
  }
  return output;
}

function expandPromptEntry(prompt: PromptLike, rest: string, commandLabel: string) {
  const required = promptArgumentNames(prompt.content);
  if (required.length > 0) {
    const parsedInputs = parsePromptInputs(rest);
    if ("error" in parsedInputs) {
      return { error: formatPromptArgsError(commandLabel, parsedInputs.error) } as const;
    }
    const missing = required.filter((name) => !(name in parsedInputs.values));
    if (missing.length > 0) {
      return {
        error: `Missing required args for ${commandLabel}: ${missing.join(", ")}.`,
      } as const;
    }
    return {
      expanded: expandNamedPlaceholders(prompt.content, parsedInputs.values),
    } as const;
  }
  return {
    expanded: expandNumericPlaceholders(normalizeQuotes(prompt.content), splitShlex(normalizeQuotes(rest))),
  } as const;
}

export function expandCustomPromptText(
  text: string,
  prompts: CustomPromptTemplate[],
): { expanded: string } | { error: string } | null {
  const parsed = parseSlashName(text);
  if (!parsed) return null;
  if (!parsed.name.startsWith(PROMPTS_CMD)) return null;
  const promptName = parsed.name.slice(PROMPTS_CMD.length);
  if (!promptName) return null;
  const prompt = prompts.find((entry) => entry.name === promptName);
  if (!prompt) return null;
  return expandPromptEntry(prompt, parsed.rest, `/${parsed.name}`);
}

