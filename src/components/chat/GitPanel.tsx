import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { bridge } from "../../lib/bridge";
import type { GitFileChange, GitFileDiff } from "../../lib/models";
import { useStore } from "../../lib/store";

type DiffCellTone = "context" | "add" | "delete" | "empty";
type DiffViewMode = "split" | "unified";
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

type UnifiedDiffRowType = "hunk" | "code" | "note";

interface UnifiedDiffRow {
  id: string;
  type: UnifiedDiffRowType;
  header?: string;
  note?: string;
  lineNumber: number | null;
  sign: " " | "+" | "-";
  content: string;
  tone: Exclude<DiffCellTone, "empty">;
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

function splitCellClasses(tone: DiffCellTone, side: SplitDiffSide) {
  switch (tone) {
    case "add":
      return "bg-[#e6ffec] text-slate-900";
    case "delete":
      return "bg-[#fff0f0] text-slate-900";
    case "empty":
      return side === "left" ? "bg-[#f7f7f7] text-transparent" : "bg-[#fbfbfb] text-transparent";
    default:
      return side === "left" ? "bg-[#fafafa] text-slate-700" : "bg-white text-slate-700";
  }
}

function splitNumberClasses(tone: DiffCellTone, side: SplitDiffSide) {
  const base = side === "left" ? "border-r border-slate-200/90" : "border-l border-slate-200/90";
  switch (tone) {
    case "add":
      return `bg-[#cdf0d8] text-emerald-700 ${base}`.trim();
    case "delete":
      return `bg-[#ffd9d9] text-rose-700 ${base}`.trim();
    case "empty":
      return `${side === "left" ? "bg-[#f2f2f2]" : "bg-[#f8f8f8]"} text-transparent ${base}`.trim();
    default:
      return `${side === "left" ? "bg-[#f3f3f3]" : "bg-[#f8f8f8]"} text-slate-400 ${base}`.trim();
  }
}

function renderLineNumber(value: number | null) {
  return value == null ? "" : String(value);
}

function unifiedLineClasses(tone: Exclude<DiffCellTone, "empty">) {
  switch (tone) {
    case "add":
      return {
        row: "bg-[#e6ffec]",
        gutter: "bg-[#cdf0d8] text-emerald-700 border-r border-slate-200/90",
        sign: "text-emerald-700",
      };
    case "delete":
      return {
        row: "bg-[#fff0f0]",
        gutter: "bg-[#ffd9d9] text-rose-700 border-r border-slate-200/90",
        sign: "text-rose-700",
      };
    default:
      return {
        row: "bg-white",
        gutter: "bg-[#f3f3f3] text-slate-400 border-r border-slate-200/90",
        sign: "text-slate-300",
      };
  }
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

function buildUnifiedRows(parsed: ParsedSplitDiff): UnifiedDiffRow[] {
  const rows: UnifiedDiffRow[] = [];

  for (const row of parsed.rows) {
    if (row.type === "hunk") {
      rows.push({
        id: row.id,
        type: "hunk",
        header: row.header,
        lineNumber: null,
        sign: " ",
        content: "",
        tone: "context",
      });
      continue;
    }

    if (row.type === "note") {
      rows.push({
        id: row.id,
        type: "note",
        note: row.note,
        lineNumber: null,
        sign: " ",
        content: "",
        tone: "context",
      });
      continue;
    }

    const leftTone = row.left.tone;
    const rightTone = row.right.tone;

    if (leftTone === "context" && rightTone === "context") {
      rows.push({
        id: `${row.id}-context`,
        type: "code",
        lineNumber: row.right.lineNumber ?? row.left.lineNumber,
        sign: " ",
        content: row.right.content || row.left.content,
        tone: "context",
      });
      continue;
    }

    if (leftTone === "delete") {
      rows.push({
        id: `${row.id}-delete`,
        type: "code",
        lineNumber: row.left.lineNumber,
        sign: "-",
        content: row.left.content,
        tone: "delete",
      });
    }

    if (rightTone === "add") {
      rows.push({
        id: `${row.id}-add`,
        type: "code",
        lineNumber: row.right.lineNumber,
        sign: "+",
        content: row.right.content,
        tone: "add",
      });
    }
  }

  return rows;
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
    <div className="px-5 py-8">
      <div className="overflow-hidden rounded-[10px] border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-[#f3f3f3] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          {title}
        </div>
        <div className="px-5 py-10 text-sm leading-6 text-slate-600">{description}</div>
        {lines.length > 0 && (
          <div className="border-t border-slate-200 bg-[#fafafa] px-4 py-4">
            <div className="space-y-1.5">
              {lines.map((line, index) => (
                <div
                  key={`${index}-${line}`}
                  className="font-mono text-[11px] leading-5 text-slate-500"
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
      <div className="overflow-hidden rounded-[10px] border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <div className="min-w-[980px] bg-white">
            <div className="sticky top-0 z-10 grid grid-cols-[52px_minmax(0,1fr)_2px_52px_minmax(0,1fr)] border-b border-slate-200 bg-[#f3f3f3] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              <div className="border-r border-slate-200 px-2 py-2 text-right">Line</div>
              <div className="border-r border-slate-200 px-3 py-2 text-slate-500">Original</div>
              <div className="bg-slate-300" />
              <div className="border-r border-slate-200 px-2 py-2 text-right">Line</div>
              <div className="px-3 py-2 text-slate-500">Modified</div>
            </div>

            {parsed.rows.map((row) => {
              if (row.type === "hunk") {
                return (
                  <div
                    key={row.id}
                    className="border-b border-slate-200 bg-[#f0f0f0] px-3 py-1.5 font-mono text-[10.5px] font-medium text-slate-600"
                  >
                    {row.header}
                  </div>
                );
              }

              if (row.type === "note") {
                return (
                  <div
                    key={row.id}
                    className="border-b border-slate-100 bg-[#fafafa] px-3 py-1.5 font-mono text-[10.5px] text-slate-500"
                  >
                    {row.note}
                  </div>
                );
              }

              return (
                <div
                  key={row.id}
                  className="group grid grid-cols-[52px_minmax(0,1fr)_2px_52px_minmax(0,1fr)] border-b border-slate-100 transition-colors last:border-b-0 hover:bg-slate-50/35"
                >
                  <div
                    className={`px-2 py-0.5 text-right font-mono text-[10px] leading-5 ${splitNumberClasses(
                      row.left.tone,
                      "left"
                    )}`}
                  >
                    {renderLineNumber(row.left.lineNumber)}
                  </div>
                  <div
                    className={`border-r border-slate-200 px-3 py-0.5 font-mono text-[11px] leading-5 ${splitCellClasses(
                      row.left.tone,
                      "left"
                    )}`}
                  >
                    <div className="whitespace-pre">{row.left.content || " "}</div>
                  </div>
                  <div className="bg-slate-300/95" />
                  <div
                    className={`px-2 py-0.5 text-right font-mono text-[10px] leading-5 ${splitNumberClasses(
                      row.right.tone,
                      "right"
                    )}`}
                  >
                    {renderLineNumber(row.right.lineNumber)}
                  </div>
                  <div
                    className={`px-3 py-0.5 font-mono text-[11px] leading-5 ${splitCellClasses(
                      row.right.tone,
                      "right"
                    )}`}
                  >
                    <div className="whitespace-pre">{row.right.content || " "}</div>
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

function UnifiedDiffView({ parsed }: { parsed: ParsedSplitDiff }) {
  const metadataLines = metadataSummaryLines(parsed.headerLines);
  const rows = useMemo(() => buildUnifiedRows(parsed), [parsed]);

  if (parsed.isBinary) {
    return (
      <DiffStateNotice
        title="Binary change"
        description="This file changed, but Git returned a binary diff, so there is no textual comparison to render."
        lines={metadataLines}
      />
    );
  }

  if (rows.filter((row) => row.type === "code").length === 0) {
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
      <div className="overflow-hidden rounded-[10px] border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <div className="min-w-[760px] bg-white">
            <div className="sticky top-0 z-10 grid grid-cols-[52px_18px_minmax(0,1fr)] border-b border-slate-200 bg-[#f3f3f3] text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              <div className="border-r border-slate-200 px-2 py-2 text-right">Line</div>
              <div className="border-r border-slate-200 px-1 py-2 text-center"> </div>
              <div className="px-3 py-2 text-slate-500">Diff</div>
            </div>

            {rows.map((row) => {
              if (row.type === "hunk") {
                return (
                  <div
                    key={row.id}
                    className="border-b border-slate-200 bg-[#f0f0f0] px-3 py-1.5 font-mono text-[10.5px] font-medium text-slate-600"
                  >
                    {row.header}
                  </div>
                );
              }

              if (row.type === "note") {
                return (
                  <div
                    key={row.id}
                    className="border-b border-slate-100 bg-[#fafafa] px-3 py-1.5 font-mono text-[10.5px] text-slate-500"
                  >
                    {row.note}
                  </div>
                );
              }

              const tone = unifiedLineClasses(row.tone);
              return (
                <div
                  key={row.id}
                  className={`grid grid-cols-[52px_18px_minmax(0,1fr)] border-b border-slate-100 last:border-b-0 ${tone.row}`}
                >
                  <div className={`px-2 py-0.5 text-right font-mono text-[10px] leading-5 ${tone.gutter}`}>
                    {renderLineNumber(row.lineNumber)}
                  </div>
                  <div className={`border-r border-slate-200 px-1 py-0.5 text-center font-mono text-[11px] leading-5 ${tone.sign}`}>
                    {row.sign}
                  </div>
                  <div className="px-3 py-0.5 font-mono text-[11px] leading-5 text-slate-800">
                    <div className="whitespace-pre">{row.content || " "}</div>
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

function DiffModeToggle({
  mode,
  onChange,
}: {
  mode: DiffViewMode;
  onChange: (mode: DiffViewMode) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-full border border-slate-200 bg-[#f8fafc] p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
      {(["split", "unified"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-all ${
            mode === option
              ? "bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
              : "text-slate-500 hover:text-slate-900"
          }`}
        >
          {option === "split" ? "Split" : "Unified"}
        </button>
      ))}
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
  const [viewMode, setViewMode] = useState<DiffViewMode>("split");

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
  const parsedDiff = useMemo(
    () => parseSplitDiff(diff?.diff ?? ""),
    [diff?.diff]
  );

  useEffect(() => {
    setViewMode("split");
  }, [titlePath]);

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
      <div className="absolute inset-x-4 inset-y-4 mx-auto flex max-w-[1320px] flex-col overflow-hidden rounded-[14px] border border-slate-300 bg-[#f3f3f3] shadow-[0_28px_100px_rgba(15,23,42,0.22)]">
        <div className="border-b border-slate-200 bg-[#f3f3f3] px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-slate-900">
                {basename(titlePath)}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-500">{titlePath}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                {status.label}
                {additions > 0 && <span className="font-medium text-emerald-700">+{additions}</span>}
                {deletions > 0 && <span className="font-medium text-rose-700">-{deletions}</span>}
                {diff?.previousPath ? ` · from ${diff.previousPath}` : ""}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <DiffModeToggle mode={viewMode} onChange={setViewMode} />
              <button
                type="button"
                onClick={() => void handleOpenFile()}
                disabled={isOpeningFile || !titlePath}
                className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3.5 py-2 text-[11px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isOpeningFile ? "Opening..." : "Open file"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close diff"
              >
                x
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-white">
          {loading ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="text-sm text-slate-500">Loading diff...</div>
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="max-w-md rounded-[10px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
                {error}
              </div>
            </div>
          ) : diff ? (
            viewMode === "split" ? (
              <SplitDiffView parsed={parsedDiff} />
            ) : (
              <UnifiedDiffView parsed={parsedDiff} />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function GitPanel() {
  const workspaceState = useStore(
    useShallow((state) => {
      const tab = state.terminalTabs.find((item) => item.id === state.activeTerminalTabId);
      const workspace = state.workspaces.find((item) => item.id === tab?.workspaceId);
      return {
        workspaceId: workspace?.id ?? null,
        workspaceName: workspace?.name ?? null,
        workspaceRootPath: workspace?.rootPath ?? null,
        gitPanel: workspace ? state.gitPanelsByWorkspace[workspace.id] ?? null : null,
      };
    })
  );

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<GitFileDiff | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const workspace = useMemo(
    () =>
      workspaceState.workspaceId &&
      workspaceState.workspaceName &&
      workspaceState.workspaceRootPath
        ? {
            id: workspaceState.workspaceId,
            name: workspaceState.workspaceName,
            rootPath: workspaceState.workspaceRootPath,
          }
        : null,
    [
      workspaceState.workspaceId,
      workspaceState.workspaceName,
      workspaceState.workspaceRootPath,
    ]
  );
  const gitPanel = workspaceState.gitPanel;

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
  }, [workspace?.rootPath, gitPanel, selectedPath, changesVersion]);

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
