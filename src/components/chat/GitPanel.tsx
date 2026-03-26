import { useEffect, useMemo, useState } from "react";
import { bridge } from "../../lib/bridge";
import type { GitFileChange, GitFileDiff } from "../../lib/models";
import { useStore } from "../../lib/store";

type DiffCellTone = "context" | "add" | "delete" | "empty";
type SplitDiffRowType = "hunk" | "code" | "note";
type SplitDiffSide = "left" | "right";

interface SplitDiffCell {
  lineNumber: number | null;
  content: string;
  tone: DiffCellTone;
}

interface SplitDiffRow {
  id: string;
  type: SplitDiffRowType;
  header?: string;
  note?: string;
  left: SplitDiffCell;
  right: SplitDiffCell;
}

interface ParsedSplitDiff {
  rows: SplitDiffRow[];
  headerLines: string[];
  isBinary: boolean;
  isMetadataOnly: boolean;
}

function samePath(left: string, right: string) {
  return left.replace(/\//g, "\\").toLowerCase() === right.replace(/\//g, "\\").toLowerCase();
}

function basename(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function dirname(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function extensionOf(path: string) {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function fileTypeToken(path: string) {
  const extension = extensionOf(path);
  switch (extension) {
    case "tsx":
      return { label: "TSX", tone: "bg-sky-500/10 text-sky-700 border-sky-200" };
    case "ts":
      return { label: "TS", tone: "bg-blue-500/10 text-blue-700 border-blue-200" };
    case "rs":
      return { label: "RS", tone: "bg-orange-500/10 text-orange-700 border-orange-200" };
    case "json":
      return { label: "JSON", tone: "bg-amber-500/10 text-amber-700 border-amber-200" };
    case "md":
      return { label: "MD", tone: "bg-violet-500/10 text-violet-700 border-violet-200" };
    case "css":
      return { label: "CSS", tone: "bg-cyan-500/10 text-cyan-700 border-cyan-200" };
    case "js":
      return { label: "JS", tone: "bg-yellow-500/10 text-yellow-700 border-yellow-200" };
    default:
      return {
        label: extension ? extension.slice(0, 4).toUpperCase() : "FILE",
        tone: "bg-slate-200 text-slate-700 border-slate-200",
      };
  }
}

function statusToken(status: string) {
  switch (status) {
    case "added":
      return {
        label: "Added",
        short: "A",
        chip: "bg-emerald-500/10 text-emerald-700",
        dot: "bg-emerald-500",
      };
    case "deleted":
      return {
        label: "Deleted",
        short: "D",
        chip: "bg-rose-500/10 text-rose-700",
        dot: "bg-rose-500",
      };
    case "renamed":
      return {
        label: "Renamed",
        short: "R",
        chip: "bg-sky-500/10 text-sky-700",
        dot: "bg-sky-500",
      };
    default:
      return {
        label: "Modified",
        short: "M",
        chip: "bg-amber-500/10 text-amber-700",
        dot: "bg-amber-500",
      };
  }
}

function summarizeDiff(diffText: string) {
  let additions = 0;
  let deletions = 0;

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }

  return { additions, deletions };
}

function createDiffCell(
  tone: DiffCellTone,
  content = "",
  lineNumber: number | null = null
): SplitDiffCell {
  return { tone, content, lineNumber };
}

function parseHunkHeader(line: string) {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match) return null;
  return {
    oldLine: Number(match[1]),
    newLine: Number(match[2]),
  };
}

function parseSplitDiff(diffText: string): ParsedSplitDiff {
  const lines = diffText.split(/\r?\n/);
  const headerLines: string[] = [];
  const rows: SplitDiffRow[] = [];

  if (lines.some((line) => line.startsWith("Binary files "))) {
    return {
      rows: [],
      headerLines: lines,
      isBinary: true,
      isMetadataOnly: false,
    };
  }

  let index = 0;
  while (index < lines.length && !lines[index].startsWith("@@")) {
    headerLines.push(lines[index]);
    index += 1;
  }

  if (index >= lines.length) {
    return {
      rows: [],
      headerLines,
      isBinary: false,
      isMetadataOnly: true,
    };
  }

  let rowIndex = 0;
  while (index < lines.length) {
    const current = lines[index];
    if (!current.startsWith("@@")) {
      index += 1;
      continue;
    }

    const hunk = parseHunkHeader(current);
    let oldLine = hunk?.oldLine ?? 0;
    let newLine = hunk?.newLine ?? 0;

    rows.push({
      id: `hunk-${rowIndex}`,
      type: "hunk",
      header: current,
      left: createDiffCell("context"),
      right: createDiffCell("context"),
    });
    rowIndex += 1;
    index += 1;

    while (index < lines.length && !lines[index].startsWith("@@")) {
      const line = lines[index];

      if (line.startsWith(" ")) {
        const content = line.slice(1);
        rows.push({
          id: `row-${rowIndex}`,
          type: "code",
          left: createDiffCell("context", content, oldLine),
          right: createDiffCell("context", content, newLine),
        });
        oldLine += 1;
        newLine += 1;
        rowIndex += 1;
        index += 1;
        continue;
      }

      if (line.startsWith("-") || line.startsWith("+")) {
        const deleted: string[] = [];
        const added: string[] = [];

        while (index < lines.length && !lines[index].startsWith("@@")) {
          const candidate = lines[index];
          if (candidate.startsWith("-") && !candidate.startsWith("---")) {
            deleted.push(candidate.slice(1));
            index += 1;
            continue;
          }
          if (candidate.startsWith("+") && !candidate.startsWith("+++")) {
            added.push(candidate.slice(1));
            index += 1;
            continue;
          }
          break;
        }

        const pairCount = Math.max(deleted.length, added.length);
        for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
          const leftContent = deleted[pairIndex] ?? "";
          const rightContent = added[pairIndex] ?? "";
          const hasLeft = pairIndex < deleted.length;
          const hasRight = pairIndex < added.length;

          rows.push({
            id: `row-${rowIndex}`,
            type: "code",
            left: hasLeft
              ? createDiffCell("delete", leftContent, oldLine)
              : createDiffCell("empty"),
            right: hasRight
              ? createDiffCell("add", rightContent, newLine)
              : createDiffCell("empty"),
          });

          if (hasLeft) oldLine += 1;
          if (hasRight) newLine += 1;
          rowIndex += 1;
        }

        continue;
      }

      if (line.startsWith("\\")) {
        rows.push({
          id: `row-${rowIndex}`,
          type: "note",
          note: line,
          left: createDiffCell("context"),
          right: createDiffCell("context"),
        });
        rowIndex += 1;
        index += 1;
        continue;
      }

      rows.push({
        id: `row-${rowIndex}`,
        type: "note",
        note: line,
        left: createDiffCell("context"),
        right: createDiffCell("context"),
      });
      rowIndex += 1;
      index += 1;
    }
  }

  return {
    rows,
    headerLines,
    isBinary: false,
    isMetadataOnly: rows.filter((row) => row.type === "code").length === 0,
  };
}

function splitCellClasses(tone: DiffCellTone, side: SplitDiffSide, active: boolean) {
  const activeState = active
    ? side === "left"
      ? "shadow-[inset_0_0_0_1px_rgba(59,130,246,0.24)]"
      : "shadow-[inset_0_0_0_1px_rgba(59,130,246,0.3)]"
    : "";

  switch (tone) {
    case "add":
      return `bg-emerald-50/95 text-slate-900 ${activeState}`.trim();
    case "delete":
      return `bg-rose-50/95 text-slate-900 ${activeState}`.trim();
    case "empty":
      return `${side === "left" ? "bg-[#f5f7fa]" : "bg-slate-50/80"} text-transparent ${activeState}`.trim();
    default:
      return `${side === "left" ? "bg-[#fafbfd]" : "bg-white"} text-slate-700 ${activeState}`.trim();
  }
}

function splitNumberClasses(tone: DiffCellTone, side: SplitDiffSide, active: boolean) {
  const base = side === "left" ? "border-r border-slate-200/80" : "border-l border-slate-200/60";
  const activeState = active ? "text-sky-700" : "";

  switch (tone) {
    case "add":
      return `bg-emerald-100/80 text-emerald-700 ${base} ${activeState}`.trim();
    case "delete":
      return `bg-rose-100/80 text-rose-700 ${base} ${activeState}`.trim();
    case "empty":
      return `${side === "left" ? "bg-[#eef2f6]" : "bg-slate-100/80"} text-transparent ${base}`.trim();
    default:
      return `${side === "left" ? "bg-[#f1f5f9]" : "bg-slate-50"} text-slate-400 ${base} ${activeState}`.trim();
  }
}

function renderLineNumber(value: number | null) {
  return value == null ? "" : String(value);
}

function metadataSummaryLines(headerLines: string[]) {
  return headerLines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("diff --git")) return false;
    if (trimmed.startsWith("index ")) return false;
    if (trimmed.startsWith("--- ")) return false;
    if (trimmed.startsWith("+++ ")) return false;
    return true;
  });
}

function DiffStateNotice({
  title,
  description,
  lines = [],
}: {
  title: string;
  description: string;
  lines?: string[];
}) {
  return (
    <div className="px-4 py-4">
      <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-50/90 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {title}
        </div>
        <div className="px-5 py-5 text-sm leading-6 text-slate-600">{description}</div>
        {lines.length > 0 && (
          <div className="border-t border-slate-200 bg-[#f8fafc] px-4 py-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Change details
            </div>
            <div className="space-y-2">
              {lines.map((line, index) => (
                <div
                  key={`${index}-${line}`}
                  className="rounded-[12px] border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] leading-5 text-slate-600"
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SplitDiffView({ parsed }: { parsed: ParsedSplitDiff }) {
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const metadataLines = metadataSummaryLines(parsed.headerLines);

  if (parsed.isBinary) {
    return (
      <DiffStateNotice
        title="Binary change"
        description="This file changed, but Git returned a binary diff, so there is no side-by-side text comparison to render."
        lines={metadataLines}
      />
    );
  }

  if (parsed.rows.length === 0 || parsed.isMetadataOnly) {
    return (
      <DiffStateNotice
        title="No textual hunks"
        description="This change does not contain editable text hunks, so the diff viewer only shows the file-level change details."
        lines={metadataLines}
      />
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.06)]">
        <div className="overflow-x-auto">
          <div className="min-w-[1040px] bg-[linear-gradient(to_right,#f8fafc_0%,#f8fafc_49.7%,#e2e8f0_49.7%,#e2e8f0_50.3%,#ffffff_50.3%,#ffffff_100%)]">
            <div className="sticky top-0 z-10 grid grid-cols-[72px,minmax(0,1fr),72px,minmax(0,1fr)] border-b border-slate-200 bg-white/90 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 backdrop-blur">
              <div className="border-r border-slate-200/80 bg-[#eef2f6] px-3 py-3 text-right">Line</div>
              <div className="border-r border-slate-200 px-4 py-3 text-slate-500">Original</div>
              <div className="border-l border-r border-slate-200/60 bg-slate-50 px-3 py-3 text-right">Line</div>
              <div className="px-4 py-3 text-slate-500">Modified</div>
            </div>

            {parsed.rows.map((row) => {
              if (row.type === "hunk") {
                return (
                  <div
                    key={row.id}
                    className="border-b border-slate-200 bg-amber-50/70 px-4 py-2.5 font-mono text-[11px] font-medium text-amber-900"
                  >
                    {row.header}
                  </div>
                );
              }

              if (row.type === "note") {
                return (
                  <div
                    key={row.id}
                    className="border-b border-slate-100 bg-slate-50 px-4 py-2 font-mono text-[11px] text-slate-500"
                  >
                    {row.note}
                  </div>
                );
              }

              const isActive = activeRowId === row.id;

              return (
                <div
                  key={row.id}
                  onClick={() => setActiveRowId((current) => (current === row.id ? null : row.id))}
                  className={`group grid cursor-pointer grid-cols-[72px,minmax(0,1fr),72px,minmax(0,1fr)] border-b border-slate-100 transition-colors last:border-b-0 ${
                    isActive ? "bg-sky-50/25" : "hover:bg-slate-50/50"
                  }`}
                >
                  <div
                    className={`px-3 py-1.5 text-right font-mono text-[11px] leading-6 ${splitNumberClasses(
                      row.left.tone,
                      "left",
                      isActive
                    )}`}
                  >
                    {renderLineNumber(row.left.lineNumber)}
                  </div>
                  <div
                    className={`border-r border-slate-200 px-4 py-1.5 font-mono text-[12px] leading-6 ${splitCellClasses(
                      row.left.tone,
                      "left",
                      isActive
                    )}`}
                  >
                    <div className="whitespace-pre-wrap break-all">{row.left.content || " "}</div>
                  </div>
                  <div
                    className={`px-3 py-1.5 text-right font-mono text-[11px] leading-6 ${splitNumberClasses(
                      row.right.tone,
                      "right",
                      isActive
                    )}`}
                  >
                    {renderLineNumber(row.right.lineNumber)}
                  </div>
                  <div
                    className={`px-4 py-1.5 font-mono text-[12px] leading-6 ${splitCellClasses(
                      row.right.tone,
                      "right",
                      isActive
                    )}`}
                  >
                    <div className="whitespace-pre-wrap break-all">{row.right.content || " "}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffOverlay({
  workspaceRoot,
  change,
  diff,
  loading,
  error,
  onClose,
}: {
  workspaceRoot: string;
  change: GitFileChange | null;
  diff: GitFileDiff | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [isOpeningFile, setIsOpeningFile] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const titlePath = diff?.path ?? change?.path ?? "";
  const fileType = fileTypeToken(titlePath);
  const status = statusToken(diff?.status ?? change?.status ?? "modified");
  const { additions, deletions } = useMemo(
    () => summarizeDiff(diff?.diff ?? ""),
    [diff?.diff]
  );
  const parsedSplitDiff = useMemo(
    () => parseSplitDiff(diff?.diff ?? ""),
    [diff?.diff]
  );

  async function handleOpenFile() {
    if (!titlePath || isOpeningFile) return;
    setIsOpeningFile(true);
    try {
      await bridge.openWorkspaceFile(workspaceRoot, titlePath);
    } finally {
      setIsOpeningFile(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-[#0f172a]/22 backdrop-blur-[2px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-x-4 inset-y-4 mx-auto max-w-[1320px] overflow-hidden rounded-[26px] border border-slate-200 bg-[#f3f6fa] shadow-[0_36px_120px_rgba(15,23,42,0.24)]">
        <div className="border-b border-slate-200 bg-white/94 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-[11px] font-semibold ${status.chip}`}
                >
                  {status.short}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${fileType.tone}`}
                >
                  {fileType.label}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[16px] font-semibold text-slate-950">
                    {basename(titlePath)}
                  </div>
                  <div className="truncate text-xs text-slate-500">{titlePath}</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
                  {status.label}
                </span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
                  +{additions}
                </span>
                <span className="rounded-full bg-rose-50 px-2.5 py-1 font-medium text-rose-700">
                  -{deletions}
                </span>
                {diff?.previousPath && (
                  <span className="truncate rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                    from {diff.previousPath}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleOpenFile()}
                disabled={isOpeningFile || !titlePath}
                className="rounded-full border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isOpeningFile ? "Opening..." : "Open file"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close diff"
              >
                x
              </button>
            </div>
          </div>
        </div>

        <div className="h-[calc(100%-109px)] overflow-y-auto bg-[#f3f6fa]">
          {loading ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="text-sm text-slate-500">Loading diff...</div>
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="max-w-md rounded-[22px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
                {error}
              </div>
            </div>
          ) : diff ? (
            <SplitDiffView parsed={parsedSplitDiff} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function GitPanel() {
  const terminalTabs = useStore((s) => s.terminalTabs);
  const workspaces = useStore((s) => s.workspaces);
  const activeTerminalTabId = useStore((s) => s.activeTerminalTabId);
  const gitPanelsByWorkspace = useStore((s) => s.gitPanelsByWorkspace);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<GitFileDiff | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const activeTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;
  const workspace = workspaces.find((item) => item.id === activeTab?.workspaceId) ?? null;
  const gitPanel = workspace ? gitPanelsByWorkspace[workspace.id] : null;

  const selectedChange =
    selectedPath && gitPanel
      ? gitPanel.recentChanges.find((change) => samePath(change.path, selectedPath)) ?? null
      : null;

  const changesVersion = useMemo(() => {
    if (!gitPanel) return "";
    return gitPanel.recentChanges
      .map((change) => `${change.status}:${change.previousPath ?? ""}:${change.path}`)
      .join("|");
  }, [gitPanel]);

  useEffect(() => {
    setSelectedPath(null);
    setSelectedDiff(null);
    setDiffError(null);
    setIsLoadingDiff(false);
  }, [workspace?.id]);

  useEffect(() => {
    if (!workspace || !gitPanel || !selectedPath) return;

    const currentChange = gitPanel.recentChanges.find((change) => samePath(change.path, selectedPath));
    if (!currentChange) {
      setSelectedPath(null);
      setSelectedDiff(null);
      setDiffError(null);
      setIsLoadingDiff(false);
      return;
    }

    let cancelled = false;
    setIsLoadingDiff(true);
    setDiffError(null);

    bridge
      .getGitFileDiff(workspace.rootPath, currentChange.path)
      .then((result) => {
        if (cancelled) return;
        setSelectedDiff(result);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Unable to load diff.";
        setDiffError(message);
        setSelectedDiff(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDiff(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspace, gitPanel, selectedPath, changesVersion]);

  if (!workspace) return null;

  const recentChanges = gitPanel?.recentChanges ?? [];
  const changeCount = recentChanges.length;

  return (
    <>
      <aside className="w-[320px] border-l border-border bg-[#fcfcfd]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-border px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
              Changes
            </div>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div className="text-sm font-semibold text-text">
                {gitPanel?.isGitRepo ? "Working tree" : "Git unavailable"}
              </div>
              <div className="text-xs text-secondary">
                {gitPanel?.isGitRepo ? `${changeCount} file${changeCount === 1 ? "" : "s"}` : "No repository"}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!gitPanel ? (
              <div className="px-5 py-6 text-sm text-secondary">Loading changes...</div>
            ) : !gitPanel.isGitRepo ? (
              <div className="px-5 py-6 text-sm leading-6 text-secondary">
                The current workspace is not a Git repository, so there is no working tree diff to inspect.
              </div>
            ) : recentChanges.length === 0 ? (
              <div className="px-5 py-6 text-sm leading-6 text-secondary">
                No uncommitted changes in this workspace. New edits will appear here automatically.
              </div>
            ) : (
              <div className="px-3 py-3">
                {recentChanges.map((change) => {
                  const status = statusToken(change.status);
                  const fileType = fileTypeToken(change.path);
                  const isSelected = selectedPath ? samePath(change.path, selectedPath) : false;

                  return (
                    <button
                      key={`${change.previousPath ?? ""}:${change.path}:${change.status}`}
                      type="button"
                      onClick={() => setSelectedPath(change.path)}
                      className={`mb-1.5 flex w-full items-start gap-3 rounded-[20px] px-3 py-3 text-left transition-all ${
                        isSelected
                          ? "bg-[#edf4ff] shadow-[inset_0_0_0_1px_rgba(59,130,246,0.12)]"
                          : "hover:bg-[#f4f7fb]"
                      }`}
                    >
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${status.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${fileType.tone}`}
                          >
                            {fileType.label}
                          </span>
                          <span className="truncate text-[13px] font-semibold text-slate-900">
                            {basename(change.path)}
                          </span>
                          <span
                            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${status.chip}`}
                          >
                            {status.short}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-[11px] text-slate-500">
                          {dirname(change.path) || "."}
                        </div>
                        {change.previousPath && (
                          <div className="mt-1 truncate text-[11px] text-slate-400">
                            from {change.previousPath}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </aside>

      {selectedPath && (
        <DiffOverlay
          workspaceRoot={workspace.rootPath}
          change={selectedChange}
          diff={selectedDiff}
          loading={isLoadingDiff}
          error={diffError}
          onClose={() => {
            setSelectedPath(null);
            setSelectedDiff(null);
            setDiffError(null);
            setIsLoadingDiff(false);
          }}
        />
      )}
    </>
  );
}
