import { useMemo, useState, type ReactNode } from "react";
import {
  ChatMessage,
  ChatMessageBlock,
  AgentId,
  AssistantApprovalDecision,
  AutoRouteAction,
} from "../../lib/models";
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

function samePath(left: string, right: string) {
  return (
    left.replace(/\//g, "\\").replace(/[\\]+$/, "").toLowerCase() ===
    right.replace(/\//g, "\\").replace(/[\\]+$/, "").toLowerCase()
  );
}

type FilePatchRow =
  | {
      kind: "hunk";
      text: string;
    }
  | {
      kind: "line";
      tone: "context" | "add" | "delete" | "note";
      prefix: string;
      text: string;
    };

function parseFilePatch(diffText: string) {
  let additions = 0;
  let deletions = 0;
  const rows: FilePatchRow[] = [];

  for (const line of diffText.split(/\r?\n/)) {
    if (!line) continue;
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }

    if (line.startsWith("@@")) {
      rows.push({ kind: "hunk", text: line });
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
      rows.push({
        kind: "line",
        tone: "add",
        prefix: "+",
        text: line.slice(1),
      });
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
      rows.push({
        kind: "line",
        tone: "delete",
        prefix: "-",
        text: line.slice(1),
      });
      continue;
    }

    if (line.startsWith(" ")) {
      rows.push({
        kind: "line",
        tone: "context",
        prefix: " ",
        text: line.slice(1),
      });
      continue;
    }

    if (line.startsWith("\\")) {
      rows.push({
        kind: "line",
        tone: "note",
        prefix: "·",
        text: line,
      });
    }
  }

  return {
    additions,
    deletions,
    rows,
    hasRenderablePatch: rows.length > 0,
  };
}

function fileChangeTone(changeType: "add" | "delete" | "update", movePath?: string | null) {
  if (changeType === "add") {
    return {
      label: "Added",
      chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
      icon: "bg-emerald-50 text-emerald-600",
    };
  }
  if (changeType === "delete") {
    return {
      label: "Deleted",
      chip: "border-rose-200 bg-rose-50 text-rose-700",
      icon: "bg-rose-50 text-rose-600",
    };
  }
  if (movePath) {
    return {
      label: "Moved",
      chip: "border-sky-200 bg-sky-50 text-sky-700",
      icon: "bg-sky-50 text-sky-600",
    };
  }
  return {
    label: "Updated",
    chip: "border-amber-200 bg-amber-50 text-amber-700",
    icon: "bg-[#eaf2ff] text-[#2563eb]",
  };
}

function summarizeMultiline(text: string, maxLines = 4, maxChars = 420) {
  const normalized = text.trimEnd();
  const lines = normalized.split("\n");
  const preview = lines.slice(0, maxLines).join("\n");
  if (lines.length <= maxLines && normalized.length <= maxChars) {
    return { preview: normalized, truncated: false };
  }

  const compactPreview =
    preview.length > maxChars ? `${preview.slice(0, maxChars).trimEnd()}...` : preview;
  return { preview: compactPreview, truncated: true };
}

function titleCase(value: string) {
  if (!value) return value;
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

function DirectoryIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 7.5A2.25 2.25 0 016 5.25h4.19a2.25 2.25 0 011.59.659l1.062 1.06a2.25 2.25 0 001.59.66H18A2.25 2.25 0 0120.25 9.9v6.35A2.25 2.25 0 0118 18.5H6A2.25 2.25 0 013.75 16.25V7.5z"
      />
    </svg>
  );
}

function OutputIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 8l-4 4 4 4m6 0h8M13 8h8" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
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
  label,
  onClick,
}: {
  expanded: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 text-slate-400 transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-600 active:scale-95 shadow-sm"
      aria-expanded={expanded}
      title={label}
      aria-label={label}
    >
      <ChevronIcon expanded={expanded} />
    </button>
  );
}

function RefreshIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M15.5 8.2A5.8 5.8 0 105.9 13M15.5 8.2V4.8m0 3.4h-3.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4.5 6h11m-8.5 0V4.8A1.3 1.3 0 018.3 3.5h3.4A1.3 1.3 0 0113 4.8V6m-7.5 0l.6 8.1A1.5 1.5 0 007.6 15.5h4.8a1.5 1.5 0 001.5-1.4L14.5 6m-5.7 2.5v4m2.4-4v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MessageActionButton({
  label,
  icon,
  onClick,
  disabled = false,
  tone = "neutral",
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-200/90 bg-rose-50/90 text-rose-600 hover:border-rose-300 hover:bg-rose-100 hover:text-rose-700"
      : "border-slate-200/90 bg-white/92 text-slate-500 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${toneClass}`}
    >
      {icon}
    </button>
  );
}

function MetaPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-white text-slate-600";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${toneClass}`}
    >
      {children}
    </span>
  );
}

function CommandSurface({
  label,
  icon,
  tone = "light",
  collapsible = false,
  expanded = true,
  onToggle,
  children,
}: {
  label: string;
  icon?: ReactNode;
  tone?: "light" | "dark";
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const toneClass =
    tone === "dark"
      ? "border-[#182132] bg-[#0f1728] text-slate-100"
      : "border-slate-200 bg-white/95 text-slate-800";
  const headerClass =
    tone === "dark"
      ? "border-white/8 bg-white/[0.03] text-slate-300"
      : "border-slate-200/90 bg-slate-50/70 text-slate-500";
  const headerContent = (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">{label}</span>
    </div>
  );

  return (
    <div className={`overflow-hidden rounded-[12px] border ${toneClass}`}>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          className={`flex w-full items-center justify-between border-b px-3.5 py-2.5 text-left transition-colors ${
            tone === "dark"
              ? "hover:bg-white/[0.06] active:bg-white/[0.08]"
              : "hover:bg-slate-100/80 active:bg-slate-100"
          } ${headerClass}`}
          aria-expanded={expanded}
        >
          {headerContent}
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current/15 bg-current/[0.06]">
            <ChevronIcon expanded={expanded} />
          </span>
        </button>
      ) : (
        <div className={`flex items-center gap-2 border-b px-3.5 py-2.5 ${headerClass}`}>
          {headerContent}
        </div>
      )}
      {children}
    </div>
  );
}

function commandTone(status?: string, exitCode?: number): "neutral" | "success" | "warning" | "danger" {
  if (status === "failed" || (exitCode != null && exitCode !== 0)) return "danger";
  if (status === "declined") return "warning";
  if (status === "completed" || status === "success" || status === "ok" || exitCode === 0) {
    return "success";
  }
  return "neutral";
}

function CommandCard({
  label,
  command,
  cwd,
  workspaceRoot,
  status,
  exitCode,
  output,
}: {
  label: string;
  command: string;
  cwd?: string | null;
  workspaceRoot?: string | null;
  status?: string | null;
  exitCode?: number | null;
  output?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusTone = commandTone(status ?? undefined, exitCode ?? undefined);
  const outputPreview = output ? summarizeMultiline(output, 4, 360) : null;
  const hasOutput = Boolean(output?.trim());
  const canToggleOutput = Boolean(outputPreview?.truncated);
  const showCwd = Boolean(
    cwd?.trim() && (!workspaceRoot?.trim() || !samePath(cwd.trim(), workspaceRoot.trim()))
  );

  return (
    <div className="rounded-[12px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.98)_100%)] px-4 py-4 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[16px] border border-slate-200 bg-white text-slate-700 shadow-[0_10px_18px_rgba(15,23,42,0.06)]">
          <CommandIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Command
            </span>
            <MetaPill>{label}</MetaPill>
            {status && <MetaPill tone={statusTone}>{titleCase(status)}</MetaPill>}
            {exitCode != null && <MetaPill tone={statusTone}>exit {exitCode}</MetaPill>}
          </div>
          {showCwd && cwd && (
            <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white/85 px-3 py-1.5 text-[11px] text-slate-500">
              <DirectoryIcon />
              <span className="truncate">{cwd}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        <CommandSurface label="Shell Command">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all px-3.5 py-3 font-mono text-[12.5px] leading-6 text-slate-800">
            {command}
          </pre>
        </CommandSurface>

        {hasOutput && (
          <CommandSurface
            label="Output"
            icon={<OutputIcon />}
            tone="dark"
            collapsible={canToggleOutput}
            expanded={expanded}
            onToggle={canToggleOutput ? () => setExpanded((value) => !value) : undefined}
          >
            <pre className="overflow-x-auto whitespace-pre-wrap break-all px-3.5 py-3 font-mono text-[12px] leading-6 text-slate-100">
              {expanded || !outputPreview?.truncated ? output : outputPreview?.preview}
            </pre>
          </CommandSurface>
        )}
      </div>
    </div>
  );
}

function CommandBlock({
  block,
  workspaceRoot,
}: {
  block: Extract<AssistantDisplayBlock, { kind: "command" }>;
  workspaceRoot?: string | null;
}) {
  return <CommandCard label={block.label} command={block.command} workspaceRoot={workspaceRoot} />;
}

function EditBlock({ block }: { block: Extract<AssistantDisplayBlock, { kind: "edit" }> }) {
  return (
    <div className="rounded-[12px] border border-slate-200 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
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
      className={`rounded-[12px] border px-4 py-3 ${
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
    <div className="overflow-hidden rounded-[12px] border border-[#172033] bg-[#0f172a]">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Log output
        </div>
        {shouldCollapse && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-white/10 text-slate-400 transition-all hover:border-white/30 hover:bg-white/10 hover:text-white active:scale-95"
            aria-label={expanded ? "Hide logs" : "Show logs"}
          >
            <ChevronIcon expanded={expanded} />
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

function RuntimeTextBlock({
  block,
}: {
  block: Extract<ChatMessageBlock, { kind: "text" }>;
}) {
  return (
    <AssistantMessageContent
      content={block.text}
      rawContent={block.text}
      contentFormat={block.format}
      isStreaming={false}
      renderMode="rich"
    />
  );
}

function RuntimeStreamingMarker({
  blocks,
}: {
  blocks: ChatMessageBlock[];
}) {
  const lastBlock = blocks[blocks.length - 1];
  let label = "Responding";

  if (lastBlock) {
    switch (lastBlock.kind) {
      case "command":
      case "tool":
      case "approvalRequest":
        label = "Running tools";
        break;
      case "fileChange":
        label = "Updating files";
        break;
      case "reasoning":
      case "plan":
      case "orchestrationPlan":
      case "orchestrationStep":
      case "autoRoute":
        label = "Planning";
        break;
      case "status":
        label = "Responding";
        break;
      case "text":
        label = "Responding";
        break;
      default:
        label = "Responding";
    }
  }

  return (
    <div className="rounded-[12px] border border-dashed border-slate-200 bg-slate-50/70 px-3 py-2.5 text-[12px] font-medium text-slate-500">
      {label}...
      <span className="ml-1 inline-block h-3.5 w-1.5 rounded-full bg-accent align-[-2px] animate-pulse" />
    </div>
  );
}

function RuntimeReasoningBlock({
  block,
}: {
  block: Extract<ChatMessageBlock, { kind: "reasoning" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = useMemo(() => summarizeMultiline(block.text, 2, 220), [block.text]);
  const showToggle = preview.truncated;

  return (
    <div className="rounded-[12px] border border-violet-200 bg-violet-50/80 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">
          Reasoning Summary
        </div>
        {showToggle && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-violet-200/60 text-violet-500 transition-all hover:border-violet-300 hover:bg-white active:scale-95 shadow-sm"
            aria-label={expanded ? "Hide reasoning" : "Show reasoning"}
          >
            <ChevronIcon expanded={expanded} />
          </button>
        )}
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[12px] leading-6 text-violet-950">
        {showToggle && !expanded ? preview.preview : block.text}
      </pre>
    </div>
  );
}

function RuntimeCommandBlock({
  block,
  workspaceRoot,
}: {
  block: Extract<ChatMessageBlock, { kind: "command" }>;
  workspaceRoot?: string | null;
}) {
  return (
    <CommandCard
      label={block.label}
      command={block.command}
      cwd={block.cwd}
      workspaceRoot={workspaceRoot}
      status={block.status}
      exitCode={block.exitCode}
      output={block.output}
    />
  );
}

function RuntimeFileChangeBlock({
  block,
}: {
  block: Extract<ChatMessageBlock, { kind: "fileChange" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const changeTone = fileChangeTone(block.changeType, block.movePath);
  const patch = useMemo(() => parseFilePatch(block.diff), [block.diff]);
  const hasCounts = patch.additions > 0 || patch.deletions > 0;

  return (
    <div className="rounded-[12px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.98)_100%)] px-4 py-3.5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl ${changeTone.icon}`}
        >
          <EditIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${changeTone.chip}`}
            >
              {changeTone.label}
            </span>
            {block.status && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700">
                {block.status}
              </span>
            )}
            {hasCounts && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-mono text-[11px]">
                <span className="text-emerald-700">+{patch.additions}</span>
                <span className="text-slate-300">,</span>
                <span className="text-rose-700">-{patch.deletions}</span>
              </span>
            )}
          </div>
          <div className="mt-1.5 text-[13.5px] font-semibold text-slate-900">
            {basename(block.path)}
          </div>
          <div className="mt-0.5 break-all text-[12px] text-slate-500">{block.path}</div>
          {block.movePath && (
            <div className="mt-1 break-all text-[12px] text-slate-500">
              moved from {block.movePath}
            </div>
          )}
        </div>
        <ToggleButton
          expanded={expanded}
          label=""
          onClick={() => setExpanded((value) => !value)}
        />
      </div>
      {expanded && (
        <div className="mt-3 overflow-hidden rounded-[12px] border border-slate-200 bg-white">
          {patch.hasRenderablePatch ? (
            <div className="max-h-[320px] overflow-y-auto px-2 py-2">
              {patch.rows.map((row, index) => {
                if (row.kind === "hunk") {
                  return (
                    <div
                      key={`${row.kind}-${index}`}
                      className="mx-1 my-1 rounded-xl bg-slate-100 px-3 py-1.5 font-mono text-[10.5px] text-slate-500"
                    >
                      {row.text}
                    </div>
                  );
                }

                const toneClass =
                  row.tone === "add"
                    ? "bg-emerald-50/90 text-emerald-950"
                    : row.tone === "delete"
                      ? "bg-rose-50/90 text-rose-950"
                      : row.tone === "note"
                        ? "bg-slate-100 text-slate-500"
                        : "text-slate-600";
                const prefixClass =
                  row.tone === "add"
                    ? "text-emerald-600"
                    : row.tone === "delete"
                      ? "text-rose-600"
                      : row.tone === "note"
                        ? "text-slate-400"
                        : "text-slate-300";

                return (
                  <div
                    key={`${row.kind}-${index}`}
                    className={`grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2 rounded-xl px-3 py-1.5 font-mono text-[12px] leading-6 ${toneClass}`}
                  >
                    <span className={`select-none font-semibold ${prefixClass}`}>{row.prefix}</span>
                    <span className="whitespace-pre-wrap break-all">{row.text || " "}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-[12px] leading-6 text-slate-700">
              {block.diff}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function RuntimeToolBlock({
  block,
}: {
  block: Extract<ChatMessageBlock, { kind: "tool" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const combinedText = [block.source, block.summary].filter(Boolean).join("\n\n");
  const preview = useMemo(() => summarizeMultiline(combinedText, 2, 260), [combinedText]);
  const showToggle = preview.truncated;

  return (
    <div className="rounded-[12px] border border-[#dbe4ef] bg-[#f8fbff] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Tool
            </span>
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700">
              {block.tool}
            </span>
            {block.status && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                {block.status}
              </span>
            )}
          </div>
          {combinedText && (
            <div className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-6 text-slate-600">
              {showToggle && !expanded ? preview.preview : combinedText}
            </div>
          )}
        </div>
        {showToggle && (
          <ToggleButton
            expanded={expanded}
            label=""
            onClick={() => setExpanded((value) => !value)}
          />
        )}
      </div>
    </div>
  );
}

function ApprovalActionButton({
  label,
  onClick,
  disabled = false,
  tone = "neutral",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {label}
    </button>
  );
}

function RuntimeApprovalRequestBlock({
  block,
  onDecision,
}: {
  block: Extract<ChatMessageBlock, { kind: "approvalRequest" }>;
  onDecision?: ((requestId: string, decision: AssistantApprovalDecision) => void) | null;
}) {
  const pending = !block.state || block.state === "pending";
  const statusLabel =
    block.state === "approvedAlways"
      ? block.provider === "codex"
        ? "Approved for session"
        : "Always allowed"
      : block.state === "approved"
        ? "Approved"
        : block.state === "denied"
          ? "Denied"
          : "Awaiting approval";

  return (
    <div className="rounded-[12px] border border-amber-200 bg-amber-50/80 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">
          Tool approval
        </span>
        <MetaPill tone={pending ? "warning" : block.state === "denied" ? "danger" : "success"}>
          {statusLabel}
        </MetaPill>
      </div>

      <div className="mt-2 text-[13px] font-semibold text-amber-950">
        {block.title ?? block.toolName}
      </div>

      {block.summary && (
        <div className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-6 text-amber-900">
          {block.summary}
        </div>
      )}

      {block.description && (
        <div className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-6 text-amber-800/90">
          {block.description}
        </div>
      )}

      {pending && onDecision && (
        <div className="mt-4 flex flex-wrap gap-2">
          <ApprovalActionButton
            label="Yes"
            onClick={() => onDecision(block.requestId, "allowOnce")}
          />
          <ApprovalActionButton
            label={block.persistentLabel ?? "Yes, don't ask again"}
            onClick={() => onDecision(block.requestId, "allowAlways")}
          />
          <ApprovalActionButton
            label="No"
            tone="danger"
            onClick={() => onDecision(block.requestId, "deny")}
          />
        </div>
      )}
    </div>
  );
}

function RuntimePlanBlock({
  block,
}: {
  block: Extract<ChatMessageBlock, { kind: "plan" }>;
}) {
  return (
    <div className="rounded-[12px] border border-sky-200 bg-sky-50/70 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
        Plan
      </div>
      <div className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-7 text-sky-950">
        {block.text}
      </div>
    </div>
  );
}

function orchestrationStatusTone(status?: string | null) {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "running":
    case "synthesizing":
      return "warning";
    default:
      return "neutral";
  }
}

function orchestrationOwnerLabel(owner: AgentId) {
  return owner === "claude" ? "Claude" : owner === "gemini" ? "Gemini" : "Codex";
}

function RuntimeOrchestrationPlanBlock({
  block,
}: {
  block: Extract<ChatMessageBlock, { kind: "orchestrationPlan" }>;
}) {
  return (
    <div className="rounded-[12px] border border-slate-200 bg-slate-50/85 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          Orchestration
        </span>
        <MetaPill tone={orchestrationStatusTone(block.status)}>
          {block.status ?? "planning"}
        </MetaPill>
      </div>
      <div className="mt-2 text-[13px] font-semibold text-slate-950">{block.title}</div>
      <div className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-6 text-slate-700">
        {block.goal}
      </div>
      {block.summary && (
        <div className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-6 text-slate-600">
          {block.summary}
        </div>
      )}
    </div>
  );
}

function RuntimeOrchestrationStepBlock({
  block,
}: {
  block: Extract<ChatMessageBlock, { kind: "orchestrationStep" }>;
}) {
  return (
    <div className="rounded-[12px] border border-[#dbe4ef] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {orchestrationOwnerLabel(block.owner)}
        </span>
        <MetaPill tone={orchestrationStatusTone(block.status)}>
          {block.status ?? "planned"}
        </MetaPill>
      </div>
      <div className="mt-2 text-[13px] font-semibold text-slate-950">{block.title}</div>
      {block.summary && (
        <div className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-6 text-slate-700">
          {block.summary}
        </div>
      )}
      {block.result && (
        <div className="mt-2 whitespace-pre-wrap break-words rounded-[12px] bg-slate-50 px-3 py-2 text-[12px] leading-6 text-slate-600">
          {block.result}
        </div>
      )}
    </div>
  );
}

function RuntimeAutoRouteBlock({
  block,
  onAction,
}: {
  block: Extract<ChatMessageBlock, { kind: "autoRoute" }>;
  onAction?: ((action: AutoRouteAction) => void) | null;
}) {
  const pending = !block.state || block.state === "pending";
  const statusLabel =
    block.state === "accepted"
      ? "Queued"
      : block.state === "switched"
        ? "Switched"
        : block.state === "cancelled"
          ? "Cancelled"
          : "Pending";

  return (
    <div className="rounded-[12px] border border-sky-200 bg-sky-50/70 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
          Auto routing
        </span>
        <MetaPill tone={pending ? "warning" : "success"}>{statusLabel}</MetaPill>
      </div>
      <div className="mt-2 text-[13px] font-semibold text-sky-950">
        {block.title}
      </div>
      <div className="mt-1 text-[12px] leading-6 text-sky-900">{block.reason}</div>
      {block.modeHint && (
        <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-sky-700/80">
          {block.modeHint}
        </div>
      )}
      {pending && onAction && (
        <div className="mt-4 flex flex-wrap gap-2">
          <ApprovalActionButton label="Run now" onClick={() => onAction("run")} />
          <ApprovalActionButton label="Switch CLI" onClick={() => onAction("switch")} />
          <ApprovalActionButton label="Cancel" tone="danger" onClick={() => onAction("cancel")} />
        </div>
      )}
    </div>
  );
}

function RuntimeStatusBlock({
  block,
}: {
  block: Extract<ChatMessageBlock, { kind: "status" }>;
}) {
  const tone =
    block.level === "error"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : block.level === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-slate-200 bg-slate-50 text-slate-900";

  return (
    <div className={`rounded-[12px] border px-4 py-3 ${tone}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.16em]">
        {block.level}
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[12px] leading-6">
        {block.text}
      </pre>
    </div>
  );
}

function StructuredAssistantBlocks({
  blocks,
  workspaceRoot,
}: {
  blocks: AssistantDisplayBlock[];
  workspaceRoot?: string | null;
}) {
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case "command":
            return <CommandBlock key={key} block={block} workspaceRoot={workspaceRoot} />;
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

function RuntimeStructuredBlocks({
  blocks,
  isStreaming = false,
  workspaceRoot,
  onApprovalDecision,
  onAutoRouteAction,
}: {
  blocks: ChatMessageBlock[];
  isStreaming?: boolean;
  workspaceRoot?: string | null;
  onApprovalDecision?: ((requestId: string, decision: AssistantApprovalDecision) => void) | null;
  onAutoRouteAction?: ((action: AutoRouteAction) => void) | null;
}) {
  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case "text":
            return <RuntimeTextBlock key={key} block={block} />;
          case "reasoning":
            return <RuntimeReasoningBlock key={key} block={block} />;
          case "command":
            return <RuntimeCommandBlock key={key} block={block} workspaceRoot={workspaceRoot} />;
          case "fileChange":
            return <RuntimeFileChangeBlock key={key} block={block} />;
          case "tool":
            return <RuntimeToolBlock key={key} block={block} />;
          case "approvalRequest":
            return (
              <RuntimeApprovalRequestBlock
                key={key}
                block={block}
                onDecision={onApprovalDecision}
              />
            );
          case "orchestrationPlan":
            return <RuntimeOrchestrationPlanBlock key={key} block={block} />;
          case "orchestrationStep":
            return <RuntimeOrchestrationStepBlock key={key} block={block} />;
          case "autoRoute":
            return (
              <RuntimeAutoRouteBlock
                key={key}
                block={block}
                onAction={onAutoRouteAction}
              />
            );
          case "plan":
            return <RuntimePlanBlock key={key} block={block} />;
          case "status":
            return <RuntimeStatusBlock key={key} block={block} />;
          default:
            return null;
        }
      })}
      {isStreaming && <RuntimeStreamingMarker blocks={blocks} />}
    </div>
  );
}

export function CliBubble({
  message,
  workspaceRoot,
  onRegenerate,
  onDelete,
  onApprovalDecision,
  onAutoRouteAction,
  actionsDisabled = false,
}: {
  message: ChatMessage;
  workspaceRoot?: string | null;
  onRegenerate?: (() => void) | null;
  onDelete?: ((messageId: string) => void) | null;
  onApprovalDecision?: ((requestId: string, decision: AssistantApprovalDecision) => void) | null;
  onAutoRouteAction?: ((action: AutoRouteAction) => void) | null;
  actionsDisabled?: boolean;
}) {
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
  const runtimeBlocks = message.blocks ?? null;
  const hasTextRuntimeBlocks =
    runtimeBlocks?.some((block) => block.kind === "text") ?? false;
  const shouldRenderRuntimeFallbackText =
    !hasTextRuntimeBlocks && message.content.trim().length > 0;
  const formatLabel =
    runtimeBlocks?.length
      ? "structured"
      : !message.isStreaming && parsed.hasSpecialBlocks
        ? "structured"
        : contentFormat;
  const showRawToggle =
    !message.isStreaming &&
    rawText.length > 0 &&
    ((runtimeBlocks?.length ?? 0) > 0 ||
      parsed.hasSpecialBlocks ||
      contentFormat !== "plain" ||
      rawText.includes("\n"));
  const showDurationFooter = !message.isStreaming && message.durationMs != null;
  const showBottomActions = Boolean(onRegenerate || onDelete);
  const showBottomFooter = showDurationFooter || showBottomActions;

  return (
    <div className="flex w-full max-w-[min(90%,960px)] flex-col items-start gap-2">
      <div className="flex w-full items-center gap-2 text-[11px] text-muted">
        {badge && (
          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${badge.bg} ${badge.text}`}>
            {badge.label}
          </span>
        )}
        <span>{time}</span>
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

      <div className="w-full">
        <div
          data-chat-searchable-content="true"
          data-chat-search-message-id={message.id}
          className="overflow-hidden rounded-[12px] border border-[#dce4f2] bg-white/96 px-4 py-4 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-sm"
        >
          {renderMode === "raw" ? (
            <AssistantMessageContent
              content={message.content}
              rawContent={message.rawContent}
              contentFormat={contentFormat}
              isStreaming={message.isStreaming}
              renderMode="raw"
            />
          ) : runtimeBlocks?.length ? (
            <div className="space-y-3">
              <RuntimeStructuredBlocks
                blocks={runtimeBlocks}
                isStreaming={message.isStreaming}
                workspaceRoot={workspaceRoot}
                onApprovalDecision={onApprovalDecision}
                onAutoRouteAction={onAutoRouteAction}
              />
              {shouldRenderRuntimeFallbackText && (
                <AssistantMessageContent
                  content={message.content}
                  rawContent={message.rawContent}
                  contentFormat={contentFormat}
                  isStreaming={message.isStreaming}
                  renderMode="rich"
                />
              )}
            </div>
          ) : message.isStreaming ? (
            <AssistantMessageContent
              content={message.content}
              rawContent={message.rawContent}
              contentFormat={contentFormat}
              isStreaming={message.isStreaming}
              renderMode="rich"
            />
          ) : (
            <StructuredAssistantBlocks blocks={parsed.blocks} workspaceRoot={workspaceRoot} />
          )}
        </div>

        {showBottomFooter && (
          <div className="mt-1.5 flex min-h-7 items-center gap-3 pl-1">
            {showDurationFooter && (
              <span className="text-[11px] font-medium text-muted">
                {(message.durationMs! / 1000).toFixed(1)}s
              </span>
            )}
            {showBottomActions && (
              <div className="flex items-center gap-1">
                {onRegenerate && (
                  <MessageActionButton
                    label="Regenerate"
                    icon={<RefreshIcon />}
                    onClick={onRegenerate}
                    disabled={actionsDisabled}
                  />
                )}
                {onDelete && (
                  <MessageActionButton
                    label="Delete"
                    icon={<DeleteIcon />}
                    onClick={() => onDelete(message.id)}
                    disabled={actionsDisabled}
                    tone="danger"
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
