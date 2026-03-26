import { useMemo, useState } from "react";
import { ChatMessage, AgentId } from "../../lib/models";
import {
  AssistantDisplayBlock,
  detectAssistantContentFormat,
  normalizeAssistantContent,
  parseAssistantDisplayBlocks,
} from "../../lib/messageFormatting";
import { AssistantMessageContent } from "./AssistantMessageContent";

const CLI_BADGE: Record<AgentId, { bg: string; text: string; label: string }> = {
  codex: { bg: "bg-blue-500", text: "text-white", label: "Codex" },
  claude: { bg: "bg-amber-500", text: "text-white", label: "Claude" },
  gemini: { bg: "bg-emerald-500", text: "text-white", label: "Gemini" },
};

function basename(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function summarizeInline(text: string, max = 116) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max).trimEnd()}...`;
}

function CommandIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 8l-4 4 4 4m6 0h8M13 8h8" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487a2.1 2.1 0 113 2.97L8.25 19.07 4 20l.93-4.25 11.932-11.263z" />
    </svg>
  );
}

function StatusIcon({ level }: { level: "error" | "warning" }) {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      {level === "warning" ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86l-8 14A2 2 0 004 21h16a2 2 0 001.71-3.14l-8-14a2 2 0 00-3.42 0z" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M10.29 3.86l-8 14A2 2 0 004 21h16a2 2 0 001.71-3.14l-8-14a2 2 0 00-3.42 0z" />
      )}
    </svg>
  );
}

function ToggleButton({
  expanded,
  onClick,
}: {
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-slate-200 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800"
    >
      {expanded ? "Hide" : "Details"}
    </button>
  );
}

function CommandBlock({ block }: { block: Extract<AssistantDisplayBlock, { kind: "command" }> }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-[20px] border border-slate-200 bg-[#f8fafc] px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
          <CommandIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Ran
            </span>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700">
              {block.label}
            </span>
          </div>
          <div className="mt-1 font-mono text-[12px] leading-6 text-slate-700">
            {expanded ? block.command : summarizeInline(block.command)}
          </div>
        </div>
        <ToggleButton expanded={expanded} onClick={() => setExpanded((value) => !value)} />
      </div>
      {expanded && (
        <div className="mt-3 overflow-hidden rounded-[18px] border border-slate-200 bg-white">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-[12px] leading-6 text-slate-800">
            {block.command}
          </pre>
        </div>
      )}
    </div>
  );
}

function EditBlock({ block }: { block: Extract<AssistantDisplayBlock, { kind: "edit" }> }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-[#eaf2ff] text-[#2563eb]">
          <EditIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {block.verb}
            </span>
            {block.additions != null && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                +{block.additions}
              </span>
            )}
            {block.deletions != null && (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                -{block.deletions}
              </span>
            )}
          </div>
          <div className="mt-1 text-[13px] font-semibold text-slate-900">
            {basename(block.path)}
          </div>
          <div className="mt-0.5 break-all text-[12px] text-slate-500">{block.path}</div>
        </div>
      </div>
    </div>
  );
}

function StatusBlock({ block }: { block: Extract<AssistantDisplayBlock, { kind: "status" }> }) {
  const isWarning = block.level === "warning";
  return (
    <div
      className={`rounded-[20px] border px-4 py-3 ${
        isWarning
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-rose-200 bg-rose-50 text-rose-900"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl ${
            isWarning ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
          }`}
        >
          <StatusIcon level={block.level} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.16em]">
            {isWarning ? "Warning" : "Error"}
          </div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-6">
            {block.text}
          </pre>
        </div>
      </div>
    </div>
  );
}

function LogBlock({ block }: { block: Extract<AssistantDisplayBlock, { kind: "log" }> }) {
  const [expanded, setExpanded] = useState(false);
  const lines = block.text.split("\n");
  const preview = lines.slice(0, 4).join("\n");
  const shouldCollapse = lines.length > 4 || block.text.length > 220;

  return (
    <div className="overflow-hidden rounded-[20px] border border-[#172033] bg-[#0f172a]">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Log output
        </div>
        {shouldCollapse && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-300 transition-colors hover:border-white/20 hover:bg-white/6 hover:text-white"
          >
            {expanded ? "Hide" : "Show"}
          </button>
        )}
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all px-4 py-4 font-mono text-[12px] leading-6 text-slate-100">
        {shouldCollapse && !expanded ? preview : block.text}
      </pre>
    </div>
  );
}

function TextBlock({ block }: { block: Extract<AssistantDisplayBlock, { kind: "text" }> }) {
  return (
    <div className="text-[14px] text-slate-800">
      <AssistantMessageContent
        content={block.text}
        rawContent={block.text}
        contentFormat={block.format}
        isStreaming={false}
        renderMode="rich"
      />
    </div>
  );
}

function StructuredAssistantBlocks({
  blocks,
}: {
  blocks: AssistantDisplayBlock[];
}) {
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case "command":
            return <CommandBlock key={key} block={block} />;
          case "edit":
            return <EditBlock key={key} block={block} />;
          case "status":
            return <StatusBlock key={key} block={block} />;
          case "log":
            return <LogBlock key={key} block={block} />;
          case "text":
            return <TextBlock key={key} block={block} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

export function CliBubble({ message }: { message: ChatMessage }) {
  const cli = message.cliId as AgentId;
  const badge = cli ? CLI_BADGE[cli] : null;
  const [renderMode, setRenderMode] = useState<"rich" | "raw">("rich");
  const time = new Date(message.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const rawText = useMemo(
    () => normalizeAssistantContent(message.rawContent ?? message.content),
    [message.content, message.rawContent]
  );
  const contentFormat = message.contentFormat ?? detectAssistantContentFormat(rawText);
  const parsed = useMemo(() => parseAssistantDisplayBlocks(rawText), [rawText]);
  const formatLabel =
    !message.isStreaming && parsed.hasSpecialBlocks ? "structured" : contentFormat;
  const showRawToggle =
    !message.isStreaming &&
    rawText.length > 0 &&
    (parsed.hasSpecialBlocks || contentFormat !== "plain" || rawText.includes("\n"));

  return (
    <div className="flex w-full max-w-[min(90%,960px)] flex-col items-start gap-2">
      <div className="flex w-full items-center gap-2 text-[11px] text-muted">
        {badge && (
          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${badge.bg} ${badge.text}`}>
            {badge.label}
          </span>
        )}
        <span>{time}</span>
        {!message.isStreaming && message.durationMs != null && (
          <span>{(message.durationMs / 1000).toFixed(1)}s</span>
        )}
        {!message.isStreaming && message.exitCode != null && (
          <span
            className={`rounded-full px-2 py-1 text-[10px] font-medium ${
              message.exitCode === 0
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            exit {message.exitCode}
          </span>
        )}
        {message.isStreaming && (
          <span className="rounded-full bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent">
            streaming
          </span>
        )}
        {!message.isStreaming && (
          <span className="rounded-full bg-[#eef2f7] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary">
            {formatLabel}
          </span>
        )}
        {showRawToggle && (
          <div className="ml-auto inline-flex rounded-full border border-border bg-white p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setRenderMode("rich")}
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                renderMode === "rich"
                  ? "bg-[#111827] text-white"
                  : "text-secondary hover:text-text"
              }`}
            >
              Rich
            </button>
            <button
              type="button"
              onClick={() => setRenderMode("raw")}
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                renderMode === "raw"
                  ? "bg-[#111827] text-white"
                  : "text-secondary hover:text-text"
              }`}
            >
              Raw
            </button>
          </div>
        )}
      </div>

      <div className="w-full overflow-hidden rounded-[26px] rounded-bl-lg border border-[#dce4f2] bg-white/96 px-4 py-4 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-sm">
        {renderMode === "raw" ? (
          <AssistantMessageContent
            content={message.content}
            rawContent={message.rawContent}
            contentFormat={contentFormat}
            isStreaming={message.isStreaming}
            renderMode="raw"
          />
        ) : message.isStreaming ? (
          <AssistantMessageContent
            content={message.content}
            rawContent={message.rawContent}
            contentFormat={contentFormat}
            isStreaming={message.isStreaming}
            renderMode="rich"
          />
        ) : (
          <StructuredAssistantBlocks blocks={parsed.blocks} />
        )}
      </div>
    </div>
  );
}
