import { DiffEditor as MonacoDiffEditor } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { bridge } from "../../lib/bridge";
import type { GitFileChange, GitFileDiff } from "../../lib/models";
import { useStore } from "../../lib/store";

type DiffViewMode = "split" | "unified";

type DiffHunk = {
  originalStart: number;
  originalCount: number;
  modifiedStart: number;
  modifiedCount: number;
};

const MAX_MONACO_CONTENT_CHARS = 300_000;
const MAX_MONACO_DIFF_CHARS = 500_000;

const ArrowUpIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" className={className}>
    <path
      d="M10 15V5m0 0L6.5 8.5M10 5l3.5 3.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ArrowDownIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" className={className}>
    <path
      d="M10 5v10m0 0l3.5-3.5M10 15l-3.5-3.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const OpenFileIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 20 20" fill="none" className={className}>
    <path
      d="M7.5 5.5H5.75A1.75 1.75 0 004 7.25v7A1.75 1.75 0 005.75 16h8.5A1.75 1.75 0 0016 14.25V12.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10 10L16 4M12 4h4v4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

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
      return {
        label: "TSX",
        listTone: "border-sky-200 bg-sky-500/10 text-sky-700",
        overlayTone: "border-sky-300/60 bg-sky-500/15 text-sky-100",
      };
    case "ts":
      return {
        label: "TS",
        listTone: "border-blue-200 bg-blue-500/10 text-blue-700",
        overlayTone: "border-blue-300/60 bg-blue-500/15 text-blue-100",
      };
    case "rs":
      return {
        label: "RS",
        listTone: "border-orange-200 bg-orange-500/10 text-orange-700",
        overlayTone: "border-orange-300/60 bg-orange-500/15 text-orange-100",
      };
    case "json":
      return {
        label: "JSON",
        listTone: "border-amber-200 bg-amber-500/10 text-amber-700",
        overlayTone: "border-amber-300/60 bg-amber-500/15 text-amber-100",
      };
    case "md":
      return {
        label: "MD",
        listTone: "border-violet-200 bg-violet-500/10 text-violet-700",
        overlayTone: "border-violet-300/60 bg-violet-500/15 text-violet-100",
      };
    case "css":
      return {
        label: "CSS",
        listTone: "border-cyan-200 bg-cyan-500/10 text-cyan-700",
        overlayTone: "border-cyan-300/60 bg-cyan-500/15 text-cyan-100",
      };
    case "js":
      return {
        label: "JS",
        listTone: "border-yellow-200 bg-yellow-500/10 text-yellow-700",
        overlayTone: "border-yellow-300/60 bg-yellow-500/15 text-yellow-100",
      };
    default:
      return {
        label: extension ? extension.slice(0, 4).toUpperCase() : "FILE",
        listTone: "border-slate-200 bg-slate-200 text-slate-700",
        overlayTone: "border-slate-500/40 bg-slate-500/10 text-slate-200",
      };
  }
}

function statusToken(status: string) {
  switch (status) {
    case "added":
      return {
        label: "Added",
        short: "A",
        chip: "bg-emerald-500/12 text-emerald-300 ring-1 ring-emerald-400/20",
        dot: "bg-emerald-400",
      };
    case "deleted":
      return {
        label: "Deleted",
        short: "D",
        chip: "bg-rose-500/12 text-rose-300 ring-1 ring-rose-400/20",
        dot: "bg-rose-400",
      };
    case "renamed":
      return {
        label: "Renamed",
        short: "R",
        chip: "bg-sky-500/12 text-sky-300 ring-1 ring-sky-400/20",
        dot: "bg-sky-400",
      };
    default:
      return {
        label: "Modified",
        short: "M",
        chip: "bg-amber-500/12 text-amber-300 ring-1 ring-amber-400/20",
        dot: "bg-amber-400",
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

function metadataSummaryLines(diffText: string) {
  return diffText.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("diff --git")) return false;
    if (trimmed.startsWith("index ")) return false;
    if (trimmed.startsWith("--- ")) return false;
    if (trimmed.startsWith("+++ ")) return false;
    if (trimmed.startsWith("@@")) return false;
    return true;
  });
}

function canRenderMonacoDiff(diff: GitFileDiff | null) {
  return (
    !!diff &&
    !diff.isBinary &&
    typeof diff.originalContent === "string" &&
    typeof diff.modifiedContent === "string"
  );
}

function isMetadataOnlyDiff(diff: GitFileDiff | null) {
  if (!diff || diff.isBinary) return false;
  return !/^@@/m.test(diff.diff);
}

function monacoDiffTooLarge(diff: GitFileDiff | null) {
  if (!diff) return false;
  const originalLength = typeof diff.originalContent === "string" ? diff.originalContent.length : 0;
  const modifiedLength = typeof diff.modifiedContent === "string" ? diff.modifiedContent.length : 0;
  return (
    originalLength > MAX_MONACO_CONTENT_CHARS ||
    modifiedLength > MAX_MONACO_CONTENT_CHARS ||
    diff.diff.length > MAX_MONACO_DIFF_CHARS
  );
}

function parseDiffHunks(diffText: string) {
  const hunks: DiffHunk[] = [];
  const pattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  for (const match of diffText.matchAll(pattern)) {
    hunks.push({
      originalStart: Number(match[1] ?? "1"),
      originalCount: Number(match[2] ?? "1"),
      modifiedStart: Number(match[3] ?? "1"),
      modifiedCount: Number(match[4] ?? "1"),
    });
  }
  return hunks;
}

function DiffModeToggle({
  mode,
  onChange,
}: {
  mode: DiffViewMode;
  onChange: (mode: DiffViewMode) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 p-1">
      {(["split", "unified"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
            mode === option
              ? "bg-white text-slate-950 shadow-sm"
              : "text-slate-300 hover:text-white"
          }`}
        >
          {option === "split" ? "Side by side" : "Inline"}
        </button>
      ))}
    </div>
  );
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
    <div className="flex h-full items-center justify-center px-8 py-10">
      <div className="w-full max-w-2xl rounded-[16px] border border-white/10 bg-[#111827] p-6 text-slate-200 shadow-[0_24px_80px_rgba(15,23,42,0.45)]">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{title}</div>
        <div className="mt-4 text-sm leading-7 text-slate-300">{description}</div>
        {lines.length > 0 ? (
          <div className="mt-5 rounded-[12px] border border-white/10 bg-black/20 p-4 font-mono text-[12px] leading-6 text-slate-400">
            {lines.map((line, index) => (
              <div key={`${index}-${line}`}>{line}</div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MonacoDiffView({
  diff,
  mode,
  activeHunk,
  onReadyChange,
}: {
  diff: GitFileDiff;
  mode: DiffViewMode;
  activeHunk: DiffHunk | null;
  onReadyChange?: (ready: boolean) => void;
}) {
  const editorRef = useRef<any>(null);

  useEffect(() => {
    onReadyChange?.(false);
    return () => onReadyChange?.(false);
  }, [diff.path, onReadyChange]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const rafId = window.requestAnimationFrame(() => {
      editor.layout?.();
    });
    const timeoutId = window.setTimeout(() => {
      editor.layout?.();
    }, 120);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [diff.path, mode]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeHunk) return;
    const originalEditor = editor.getOriginalEditor?.();
    const modifiedEditor = editor.getModifiedEditor?.();
    if (activeHunk.originalCount > 0 && originalEditor) {
      originalEditor.revealLineInCenter(activeHunk.originalStart);
      originalEditor.setPosition?.({ lineNumber: activeHunk.originalStart, column: 1 });
    }
    if (activeHunk.modifiedCount > 0 && modifiedEditor) {
      modifiedEditor.revealLineInCenter(activeHunk.modifiedStart);
      modifiedEditor.setPosition?.({ lineNumber: activeHunk.modifiedStart, column: 1 });
    }
  }, [activeHunk]);

  return (
    <div className="h-full min-h-0 bg-[#1e1e1e]">
      <MonacoDiffEditor
        onMount={(editor) => {
          editorRef.current = editor;
          window.requestAnimationFrame(() => {
            editor.layout?.();
          });
          onReadyChange?.(true);
        }}
        original={diff.originalContent ?? ""}
        modified={diff.modifiedContent ?? ""}
        language={diff.language ?? "plaintext"}
        theme="vs-dark"
        height="100%"
        loading={<div className="flex h-full items-center justify-center text-sm text-slate-400">Loading Monaco diff…</div>}
        options={{
          readOnly: true,
          originalEditable: false,
          renderSideBySide: mode === "split",
          minimap: { enabled: false },
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          wordWrap: "off",
          automaticLayout: true,
          renderOverviewRuler: false,
          glyphMargin: false,
          folding: false,
          matchBrackets: "never",
          fixedOverflowWidgets: true,
          diffWordWrap: "off",
          ignoreTrimWhitespace: false,
          codeLens: false,
          renderValidationDecorations: "off",
          occurrencesHighlight: "off",
          selectionHighlight: false,
        }}
      />
    </div>
  );
}

function DiffOverlay({
  workspaceRoot,
  change,
  diff,
  loading,
  error,
  hasPreviousFile,
  hasNextFile,
  onPreviousFile,
  onNextFile,
  initialHunkTarget,
  onClose,
}: {
  workspaceRoot: string;
  change: GitFileChange | null;
  diff: GitFileDiff | null;
  loading: boolean;
  error: string | null;
  hasPreviousFile: boolean;
  hasNextFile: boolean;
  onPreviousFile: () => void;
  onNextFile: () => void;
  initialHunkTarget?: "first" | "last" | null;
  onClose: () => void;
}) {
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const [viewMode, setViewMode] = useState<DiffViewMode>("split");
  const [activeHunkIndex, setActiveHunkIndex] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "[") handlePrevious();
      if (event.key === "]") handleNext();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    setViewMode("split");
  }, [diff?.path]);

  const diffHunks = useMemo(() => parseDiffHunks(diff?.diff ?? ""), [diff?.diff]);
  const activeHunk =
    diffHunks.length > 0 && activeHunkIndex >= 0 && activeHunkIndex < diffHunks.length
      ? diffHunks[activeHunkIndex]
      : null;

  useEffect(() => {
    if (diffHunks.length === 0) {
      setActiveHunkIndex(0);
      return;
    }
    setActiveHunkIndex(initialHunkTarget === "last" ? diffHunks.length - 1 : 0);
  }, [diff?.path, diffHunks.length, initialHunkTarget]);

  const titlePath = diff?.path ?? change?.path ?? "";
  const fileType = fileTypeToken(titlePath);
  const status = statusToken(diff?.status ?? change?.status ?? "modified");
  const { additions, deletions } = useMemo(() => summarizeDiff(diff?.diff ?? ""), [diff?.diff]);
  const metadataLines = useMemo(() => metadataSummaryLines(diff?.diff ?? ""), [diff?.diff]);
  const renderMonaco = canRenderMonacoDiff(diff);
  const metadataOnly = isMetadataOnlyDiff(diff);
  const monacoTooLarge = monacoDiffTooLarge(diff);
  const canPrevious = diffHunks.length > 0 ? activeHunkIndex > 0 || hasPreviousFile : hasPreviousFile;
  const canNext = diffHunks.length > 0 ? activeHunkIndex < diffHunks.length - 1 || hasNextFile : hasNextFile;

  function handlePrevious() {
    if (diffHunks.length > 0 && activeHunkIndex > 0) {
      setActiveHunkIndex((current) => current - 1);
      return;
    }
    if (hasPreviousFile) onPreviousFile();
  }

  function handleNext() {
    if (diffHunks.length > 0 && activeHunkIndex < diffHunks.length - 1) {
      setActiveHunkIndex((current) => current + 1);
      return;
    }
    if (hasNextFile) onNextFile();
  }

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
      className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-[3px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-x-4 inset-y-4 mx-auto flex max-w-[1480px] flex-col overflow-hidden rounded-[20px] border border-white/10 bg-[#0f172a] shadow-[0_40px_120px_rgba(2,6,23,0.65)]">
        <div className="border-b border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.9))] px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${fileType.overlayTone}`}>
                  {fileType.label}
                </span>
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${status.chip}`}>
                  {status.label}
                </span>
              </div>
              <div className="mt-3 truncate text-[15px] font-semibold text-white">{basename(titlePath)}</div>
              <div className="mt-1 truncate font-mono text-[11px] text-slate-400">{titlePath}</div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                {additions > 0 ? <span className="font-semibold text-emerald-300">+{additions}</span> : null}
                {deletions > 0 ? <span className="font-semibold text-rose-300">-{deletions}</span> : null}
                {diff?.previousPath ? <span>from {diff.previousPath}</span> : null}
                {diff?.language ? <span>language: {diff.language}</span> : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <DiffModeToggle mode={viewMode} onChange={setViewMode} />
              <button
                type="button"
                onClick={handlePrevious}
                disabled={!canPrevious}
                title="Previous change"
                aria-label="Previous change"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUpIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={!canNext}
                title="Next change"
                aria-label="Next change"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowDownIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void handleOpenFile()}
                disabled={isOpeningFile || !titlePath}
                title={isOpeningFile ? "Opening file..." : "Open file"}
                aria-label={isOpeningFile ? "Opening file" : "Open file"}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <OpenFileIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
                aria-label="Close diff"
              >
                x
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 bg-[#111827]">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading diff...</div>
          ) : error ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="max-w-md rounded-[14px] border border-rose-400/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
                {error}
              </div>
            </div>
          ) : diff?.isBinary ? (
            <DiffStateNotice
              title="Binary change"
              description="Git reported this file as binary, so Monaco cannot render a text comparison for it."
              lines={metadataLines}
            />
          ) : metadataOnly ? (
            <DiffStateNotice
              title="Metadata-only change"
              description="This change only carries file-level metadata, such as rename or mode updates. There are no textual hunks to compare."
              lines={metadataLines}
            />
          ) : monacoTooLarge ? (
            <DiffStateNotice
              title="Large change"
              description="This diff is too large for Monaco DiffEditor in the desktop shell. Open the file directly or narrow the change before previewing it here."
              lines={[
                `Diff length: ${diff?.diff.length ?? 0} chars`,
                `Original length: ${diff?.originalContent?.length ?? 0} chars`,
                `Modified length: ${diff?.modifiedContent?.length ?? 0} chars`,
              ]}
            />
          ) : diff && renderMonaco ? (
            <MonacoDiffView
              diff={diff}
              mode={viewMode}
              activeHunk={activeHunk}
              onReadyChange={() => {}}
            />
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
  const [diffCacheByPath, setDiffCacheByPath] = useState<Record<string, GitFileDiff>>({});
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [pendingHunkTarget, setPendingHunkTarget] = useState<"first" | "last" | null>(null);

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
    setDiffCacheByPath({});
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
    const cached = diffCacheByPath[currentChange.path];
    if (cached) {
      setSelectedDiff(cached);
      setDiffError(null);
      setIsLoadingDiff(false);
      return;
    }
    setIsLoadingDiff(true);
    setDiffError(null);

    bridge
      .getGitFileDiff(workspace.rootPath, currentChange.path)
      .then((result) => {
        if (cancelled) return;
        setSelectedDiff(result);
        setDiffCacheByPath((current) => ({ ...current, [currentChange.path]: result }));
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
  }, [diffCacheByPath, workspace?.rootPath, gitPanel, selectedPath, changesVersion]);

  if (!workspace) return null;

  const recentChanges = gitPanel?.recentChanges ?? [];
  const changeCount = recentChanges.length;
  const selectedIndex = selectedPath
    ? recentChanges.findIndex((change) => samePath(change.path, selectedPath))
    : -1;
  const hasPrevious = selectedIndex > 0;
  const hasNext = selectedIndex >= 0 && selectedIndex < recentChanges.length - 1;

  function selectRelativeChange(direction: -1 | 1) {
    if (selectedIndex < 0) return;
    const nextChange = recentChanges[selectedIndex + direction];
    if (!nextChange) return;
    setPendingHunkTarget(direction < 0 ? "last" : "first");
    setSelectedPath(nextChange.path);
  }

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
                      onClick={() => {
                        setPendingHunkTarget(null);
                        setSelectedPath(change.path);
                      }}
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
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${
                              fileType.listTone
                            }`}
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
                        {change.previousPath ? (
                          <div className="mt-1 truncate text-[11px] text-slate-400">
                            from {change.previousPath}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </aside>

      {selectedPath ? (
        <DiffOverlay
          workspaceRoot={workspace.rootPath}
          change={selectedChange}
          diff={selectedDiff}
          loading={isLoadingDiff}
          error={diffError}
          hasPreviousFile={hasPrevious}
          hasNextFile={hasNext}
          onPreviousFile={() => selectRelativeChange(-1)}
          onNextFile={() => selectRelativeChange(1)}
          initialHunkTarget={pendingHunkTarget}
          onClose={() => {
            setSelectedPath(null);
            setSelectedDiff(null);
            setDiffError(null);
            setIsLoadingDiff(false);
            setPendingHunkTarget(null);
          }}
        />
      ) : null}
    </>
  );
}
