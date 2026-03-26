import { AssistantContentFormat } from "./models";

const ANSI_ESCAPE_PATTERN =
  /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const MARKDOWN_PATTERN =
  /(^|\n)(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|```|\|.+\|)/m;

const LOG_LINE_PATTERN =
  /^\s*(\$|>|PS\s+[A-Z]:\\|[A-Z]:\\[^>]*>|error:|warning:|usage:|for more information, try|diff --git|@@|---\s|\+\+\+\s|caused by:|thread '|stack trace:|at\s.+:\d+|[├└│])/i;

const TOOL_COMMAND_PATTERN = /^Ran\s+(.+)$/;
const TOOL_EDIT_PATTERN =
  /^(Edited|Created|Deleted|Moved|Renamed|Read|Viewed)\s+(.+?)(?:\s+\(\+(\d+)\s+-(\d+)\))?$/i;
const STATUS_LINE_PATTERN =
  /^(error:|warning:|usage:|for more information, try|tip:|caused by:|thread '|stack trace:)/i;
const CONTINUATION_PATTERN = /^\s*[│├└].*/;

export type AssistantDisplayBlock =
  | {
      kind: "text";
      text: string;
      format: AssistantContentFormat;
    }
  | {
      kind: "command";
      label: string;
      command: string;
      raw: string;
    }
  | {
      kind: "edit";
      verb: string;
      path: string;
      additions: number | null;
      deletions: number | null;
      raw: string;
    }
  | {
      kind: "status";
      level: "error" | "warning";
      text: string;
    }
  | {
      kind: "log";
      text: string;
    };

export interface AssistantDisplayParseResult {
  blocks: AssistantDisplayBlock[];
  hasSpecialBlocks: boolean;
}

export function normalizeAssistantContent(raw: string) {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\u0000/g, "")
    .trimEnd();
}

export function summarizeForContext(raw: string, maxChars = 420) {
  const compact = normalizeAssistantContent(raw).replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars).trimEnd()}...`;
}

export function detectAssistantContentFormat(raw: string): AssistantContentFormat {
  const normalized = normalizeAssistantContent(raw).trim();
  if (!normalized) return "plain";

  if (MARKDOWN_PATTERN.test(normalized)) {
    return "markdown";
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return "plain";

  const logishLines = lines.filter((line) => LOG_LINE_PATTERN.test(line)).length;
  const denseLines = lines.filter(
    (line) => line.length > 88 || /\s{2,}\S/.test(line)
  ).length;

  if (
    lines.length >= 5 &&
    (logishLines / lines.length >= 0.28 || denseLines / lines.length >= 0.55)
  ) {
    return "log";
  }

  return "plain";
}

function isToolCommandStart(line: string) {
  return TOOL_COMMAND_PATTERN.test(line);
}

function isToolEditStart(line: string) {
  return TOOL_EDIT_PATTERN.test(line);
}

function isStatusStart(line: string) {
  return STATUS_LINE_PATTERN.test(line);
}

function isSpecialStart(line: string) {
  return isToolCommandStart(line) || isToolEditStart(line) || isStatusStart(line);
}

function normalizeContinuationLine(line: string) {
  return line.replace(/^\s*[│├└]\s?/, "").trimEnd();
}

function joinWrappedCommandLines(lines: string[]) {
  return lines.reduce((acc, line, index) => {
    const chunk =
      index === 0
        ? line.replace(/^Ran\s+/, "").trimEnd()
        : normalizeContinuationLine(line).trim();

    if (!acc) return chunk;
    if (/[\\/'":([{]$/.test(acc)) return `${acc}${chunk}`;
    return `${acc} ${chunk}`;
  }, "");
}

function buildTextOrLogBlock(text: string): AssistantDisplayBlock | null {
  const normalized = normalizeAssistantContent(text).trim();
  if (!normalized) return null;

  const format = detectAssistantContentFormat(normalized);
  if (format === "log") {
    return {
      kind: "log",
      text: normalized,
    };
  }

  return {
    kind: "text",
    text: normalized,
    format,
  };
}

export function parseAssistantDisplayBlocks(raw: string): AssistantDisplayParseResult {
  const normalized = normalizeAssistantContent(raw);
  const lines = normalized.split("\n");
  const blocks: AssistantDisplayBlock[] = [];
  let paragraphLines: string[] = [];
  let hasSpecialBlocks = false;

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    const block = buildTextOrLogBlock(paragraphLines.join("\n"));
    if (block) blocks.push(block);
    paragraphLines = [];
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (isToolCommandStart(line)) {
      flushParagraph();

      const commandLines = [line];
      while (index + 1 < lines.length && CONTINUATION_PATTERN.test(lines[index + 1])) {
        commandLines.push(lines[index + 1]);
        index += 1;
      }

      const command = joinWrappedCommandLines(commandLines);
      const label = command.split(/\s+/)[0] || "command";
      blocks.push({
        kind: "command",
        label,
        command,
        raw: commandLines.join("\n"),
      });
      hasSpecialBlocks = true;
      continue;
    }

    const editMatch = line.match(TOOL_EDIT_PATTERN);
    if (editMatch) {
      flushParagraph();
      blocks.push({
        kind: "edit",
        verb: editMatch[1],
        path: editMatch[2],
        additions: editMatch[3] ? Number(editMatch[3]) : null,
        deletions: editMatch[4] ? Number(editMatch[4]) : null,
        raw: line,
      });
      hasSpecialBlocks = true;
      continue;
    }

    if (isStatusStart(line)) {
      flushParagraph();

      const statusLines = [line];
      let level: "error" | "warning" = /^warning:/i.test(line) ? "warning" : "error";
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        const nextTrimmed = next.trim();
        if (!nextTrimmed) break;
        if (isToolCommandStart(next) || isToolEditStart(next)) break;
        if (
          isStatusStart(next) ||
          CONTINUATION_PATTERN.test(next) ||
          /^\s{2,}\S/.test(next) ||
          /^tip:/i.test(next) ||
          /^Usage:/i.test(next) ||
          /^For more information, try/i.test(next)
        ) {
          if (/^warning:/i.test(next)) level = "warning";
          statusLines.push(next);
          index += 1;
          continue;
        }
        break;
      }

      blocks.push({
        kind: "status",
        level,
        text: statusLines.join("\n"),
      });
      hasSpecialBlocks = true;
      continue;
    }

    if (CONTINUATION_PATTERN.test(line) && blocks.at(-1)?.kind === "log") {
      const last = blocks[blocks.length - 1];
      if (last.kind === "log") {
        last.text = `${last.text}\n${line}`;
      }
      continue;
    }

    if (
      LOG_LINE_PATTERN.test(line) &&
      !isSpecialStart(line) &&
      !MARKDOWN_PATTERN.test(line)
    ) {
      flushParagraph();

      const logLines = [line];
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (!next.trim()) break;
        if (isSpecialStart(next)) break;
        if (LOG_LINE_PATTERN.test(next) || CONTINUATION_PATTERN.test(next)) {
          logLines.push(next);
          index += 1;
          continue;
        }
        break;
      }

      blocks.push({
        kind: "log",
        text: logLines.join("\n"),
      });
      hasSpecialBlocks = true;
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();

  if (blocks.length === 0 && normalized.trim()) {
    const fallback = buildTextOrLogBlock(normalized);
    if (fallback) blocks.push(fallback);
  }

  return {
    blocks,
    hasSpecialBlocks,
  };
}
