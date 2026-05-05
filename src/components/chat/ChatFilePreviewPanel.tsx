import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import {
  ArrowUpRight,
  Code2,
  Eye,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ChevronLeft,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  CodeIntelLocation,
  ChatFilePreviewMode,
  ChatFilePreviewState,
  WorkspacePreviewFileResult,
  WorkspaceRef,
  WorkspaceTextSearchFileResult,
} from "../../lib/models";
import { bridge } from "../../lib/bridge";
import { useStore } from "../../lib/store";
import { FileIcon } from "../FileIcon";
import { OpenWorkspaceMenu } from "./OpenWorkspaceMenu";

type ChatFilePreviewPanelProps = {
  tabId: string;
  workspace: Pick<WorkspaceRef, "id" | "name" | "rootPath" | "locationKind">;
  previewState: ChatFilePreviewState;
};

type ExternalConflictState = {
  content: string;
  truncated: boolean;
  detectedAt: number;
  updateCount: number;
};

type SymbolLookupKind = "definition" | "references";

type SymbolLookupState = {
  kind: SymbolLookupKind;
  symbol: string;
  loading: boolean;
  error: string | null;
  results: SymbolLookupItem[];
  source: "code-intel" | "search-fallback";
};

type PendingFocusLocation = {
  tabId: string;
  path: string;
  line: number;
  column: number;
};

type SymbolLookupItem = {
  key: string;
  path: string;
  line: number;
  column: number;
  preview: string | null;
};

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);
const EXTERNAL_SYNC_NOTICE_MS = 3_200;
const EXTERNAL_SYNC_POLL_INTERVAL_MS = 2_000;
const IDENTIFIER_CHAR_PATTERN = /[A-Za-z0-9_$]/;

function fileExtension(path: string) {
  const normalized = path.split("/").pop() ?? path;
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === normalized.length - 1) {
    return "";
  }
  return normalized.slice(lastDot + 1).toLowerCase();
}

function fileName(path: string) {
  return path.split("/").pop() || path;
}

function canPreviewAsMarkdown(path: string) {
  return MARKDOWN_EXTENSIONS.has(fileExtension(path));
}

function supportsPreviewMode(path: string, mode: ChatFilePreviewMode) {
  if (mode === "preview") {
    return canPreviewAsMarkdown(path);
  }
  return true;
}

function appendPromptText(currentPrompt: string, nextText: string) {
  const trimmed = nextText.trim();
  if (!trimmed) return currentPrompt;
  const needsSpacer = currentPrompt.length > 0 && !/\s$/.test(currentPrompt);
  return `${currentPrompt}${needsSpacer ? "\n\n" : ""}${trimmed}`;
}

function snippetFenceLanguage(path: string) {
  const extension = fileExtension(path);
  if (!extension) return "";
  if (extension === "md") return "markdown";
  return extension;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinLocalWorkspacePath(rootPath: string, relativePath: string) {
  const base = rootPath.replace(/[\\/]+$/, "");
  const relative = relativePath.replace(/^\/+/, "");
  if (!base) {
    return relative;
  }
  if (!relative) {
    return base;
  }
  return `${base}/${relative}`;
}

function buildPreviewAssetCandidates(path: string) {
  const candidates: string[] = [];
  try {
    candidates.push(convertFileSrc(path));
  } catch {
    // Fall through to raw path candidates.
  }
  candidates.push(path);
  if (path.startsWith("/")) {
    candidates.push(`file://${encodeURI(path)}`);
  }
  return Array.from(new Set(candidates.filter((value) => value.trim().length > 0)));
}

function resolveSymbolQuery(view: EditorView | null, fallbackText: string) {
  const selection = view?.state.selection.main ?? null;
  if (view && selection && !selection.empty) {
    const selected = view.state.sliceDoc(selection.from, selection.to).trim();
    if (selected) {
      return selected;
    }
  }

  const text = view?.state.doc.toString() ?? fallbackText;
  const offset = selection?.head ?? 0;
  if (!text) {
    return "";
  }
  let start = Math.max(0, Math.min(offset, text.length));
  let end = start;

  while (start > 0 && IDENTIFIER_CHAR_PATTERN.test(text[start - 1] ?? "")) {
    start -= 1;
  }
  while (end < text.length && IDENTIFIER_CHAR_PATTERN.test(text[end] ?? "")) {
    end += 1;
  }

  return text.slice(start, end).trim();
}

function resolveEditorCursorLocation(view: EditorView | null) {
  if (!view) {
    return null;
  }
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return {
    line: line.number - 1,
    character: head - line.from,
  };
}

function flattenTextSearchResults(results: WorkspaceTextSearchFileResult[]): SymbolLookupItem[] {
  return results.flatMap((fileResult) =>
    fileResult.matches.map((match) => ({
      key: `${fileResult.path}:${match.line}:${match.column}`,
      path: fileResult.path,
      line: match.line,
      column: match.column,
      preview: match.preview,
    }))
  );
}

function flattenCodeIntelResults(results: CodeIntelLocation[]): SymbolLookupItem[] {
  return results.map((location, index) => ({
    key: `${location.path}:${location.range.start.line}:${location.range.start.character}:${index}`,
    path: location.path,
    line: location.range.start.line + 1,
    column: location.range.start.character + 1,
    preview: null,
  }));
}

function errorMessageFromUnknown(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return fallback;
}

function ActionLabel({
  icon,
  label,
  active = false,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-semibold ${
        disabled
          ? "opacity-55"
          : active
            ? "text-slate-900"
            : "text-slate-500 group-hover:text-slate-900"
      }`}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

export function ChatFilePreviewPanel({
  tabId,
  workspace,
  previewState,
}: ChatFilePreviewPanelProps) {
  const closeChatFilePreviewTab = useStore((state) => state.closeChatFilePreviewTab);
  const openChatFilePreview = useStore((state) => state.openChatFilePreview);
  const setActiveChatFilePreviewTab = useStore((state) => state.setActiveChatFilePreviewTab);
  const setChatFilePreviewMode = useStore((state) => state.setChatFilePreviewMode);
  const clearChatFilePreview = useStore((state) => state.clearChatFilePreview);
  const setTabDraftPrompt = useStore((state) => state.setTabDraftPrompt);
  const currentDraftPrompt = useStore(
    (state) => state.terminalTabs.find((tab) => tab.id === tabId)?.draftPrompt ?? ""
  );
  const activePath = previewState.activePath;
  const [fileState, setFileState] = useState<WorkspacePreviewFileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [assetSrc, setAssetSrc] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [externalConflict, setExternalConflict] = useState<ExternalConflictState | null>(null);
  const [externalNotice, setExternalNotice] = useState<string | null>(null);
  const [lookupState, setLookupState] = useState<SymbolLookupState | null>(null);
  const [editorReadyTick, setEditorReadyTick] = useState(0);
  const requestKeyRef = useRef(0);
  const editorViewRef = useRef<EditorView | null>(null);
  const externalSnapshotRef = useRef<{ content: string; truncated: boolean } | null>(null);
  const assetCandidatesRef = useRef<string[]>([]);
  const dirtyRef = useRef(false);
  const lookupRequestIdRef = useRef(0);
  const pendingFocusRef = useRef<PendingFocusLocation | null>(null);

  const activeMode = useMemo(() => {
    if (!activePath) return "code" as ChatFilePreviewMode;
    const candidate =
      previewState.modeByPath[activePath] ?? (canPreviewAsMarkdown(activePath) ? "preview" : "code");
    return supportsPreviewMode(activePath, candidate) ? candidate : "code";
  }, [activePath, previewState.modeByPath]);

  const hydratePreviewState = useCallback((result: WorkspacePreviewFileResult) => {
    setFileState(result);
    setSaveError(null);
    setExternalConflict(null);
    if (result.exists && result.kind === "text") {
      setEditorContent(result.content);
      setSavedContent(result.content);
      externalSnapshotRef.current = {
        content: result.content,
        truncated: Boolean(result.truncated),
      };
    } else {
      setEditorContent("");
      setSavedContent("");
      externalSnapshotRef.current = null;
    }
    setIsEditing(false);
  }, []);

  const loadFile = useCallback(async () => {
    if (!activePath) return;
    const requestKey = ++requestKeyRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await bridge.readWorkspacePreviewFile(
        workspace.rootPath,
        activePath,
        workspace.id
      );
      if (requestKey !== requestKeyRef.current) return;
      hydratePreviewState(result);
      if (!result.exists) {
        setError("File no longer exists.");
      }
    } catch (loadError) {
      if (requestKey !== requestKeyRef.current) return;
      setFileState(null);
      setEditorContent("");
      setSavedContent("");
      setExternalConflict(null);
      setError(errorMessageFromUnknown(loadError, "Unable to load file preview."));
    } finally {
      if (requestKey === requestKeyRef.current) {
        setLoading(false);
      }
    }
  }, [activePath, hydratePreviewState, workspace.id, workspace.rootPath]);

  useEffect(() => {
    setFileState(null);
    setError(null);
    setSaveError(null);
    setAssetSrc(null);
    setEditorContent("");
    setSavedContent("");
    setIsEditing(false);
    setExternalConflict(null);
    setExternalNotice(null);
    setLookupState(null);
    editorViewRef.current = null;
    if (!activePath) return;
    void loadFile();
  }, [activePath, loadFile]);

  useEffect(() => {
    dirtyRef.current = editorContent !== savedContent;
  }, [editorContent, savedContent]);

  useEffect(() => {
    let cancelled = false;
    if (!fileState?.exists) {
      assetCandidatesRef.current = [];
      setAssetSrc(null);
      return;
    }
    if ((fileState.kind === "image" || fileState.kind === "pdf") && fileState.assetPath) {
      const candidates = buildPreviewAssetCandidates(fileState.assetPath);
      assetCandidatesRef.current = candidates;
      if (!cancelled) {
        setAssetSrc(candidates[0] ?? null);
      }
      return () => {
        cancelled = true;
      };
    }
    if ((fileState.kind === "image" || fileState.kind === "pdf") && fileState.base64Data && fileState.mediaType) {
      assetCandidatesRef.current = [];
      setAssetSrc(`data:${fileState.mediaType};base64,${fileState.base64Data}`);
      return;
    }
    assetCandidatesRef.current = [];
    setAssetSrc(null);
    return () => {
      cancelled = true;
    };
  }, [fileState]);

  const handleImageLoadError = useCallback(() => {
    if (!assetSrc) {
      return;
    }
    const candidates = assetCandidatesRef.current;
    const currentIndex = candidates.indexOf(assetSrc);
    if (currentIndex >= 0 && currentIndex + 1 < candidates.length) {
      setAssetSrc(candidates[currentIndex + 1]);
      return;
    }
    setAssetSrc(null);
  }, [assetSrc]);

  useEffect(() => {
    if (!externalNotice) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setExternalNotice(null);
    }, EXTERNAL_SYNC_NOTICE_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [externalNotice]);

  const focusEditorAtLocation = useCallback((line: number, column: number) => {
    const view = editorViewRef.current;
    if (!view) {
      return false;
    }
    if (line < 1 || line > view.state.doc.lines) {
      return false;
    }
    const lineInfo = view.state.doc.line(line);
    const safeColumn = Math.max(1, Math.min(column, lineInfo.length + 1));
    const anchor = lineInfo.from + safeColumn - 1;
    view.dispatch({
      selection: { anchor },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  }, []);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (
      !pending ||
      !activePath ||
      pending.tabId !== tabId ||
      pending.path !== activePath ||
      fileState?.kind !== "text" ||
      !fileState.exists
    ) {
      return;
    }
    if (activeMode !== "code") {
      setChatFilePreviewMode(tabId, activePath, "code");
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      if (focusEditorAtLocation(pending.line, pending.column)) {
        pendingFocusRef.current = null;
      }
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeMode, activePath, editorReadyTick, fileState, focusEditorAtLocation, setChatFilePreviewMode, tabId]);

  useEffect(() => {
    if (!activePath || fileState?.kind !== "text" || !fileState.exists || loading) {
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const pollExternalChanges = async () => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      try {
        const result = await bridge.readWorkspacePreviewFile(
          workspace.rootPath,
          activePath,
          workspace.id
        );
        if (cancelled || !result.exists || result.kind !== "text") {
          return;
        }
        const nextSnapshot = {
          content: result.content,
          truncated: Boolean(result.truncated),
        };
        const previousSnapshot = externalSnapshotRef.current;
        if (
          previousSnapshot &&
          previousSnapshot.content === nextSnapshot.content &&
          previousSnapshot.truncated === nextSnapshot.truncated
        ) {
          return;
        }

        if (dirtyRef.current) {
          setExternalConflict((current) => {
            if (
              current &&
              current.content === nextSnapshot.content &&
              current.truncated === nextSnapshot.truncated
            ) {
              return current;
            }
            return {
              content: nextSnapshot.content,
              truncated: nextSnapshot.truncated,
              detectedAt: Date.now(),
              updateCount: Math.min(99, (current?.updateCount ?? 0) + 1),
            };
          });
          return;
        }

        externalSnapshotRef.current = nextSnapshot;
        setFileState(result);
        setEditorContent(result.content);
        setSavedContent(result.content);
        setIsEditing(false);
        setExternalConflict(null);
        setExternalNotice("File updated from disk.");
      } catch {
        // Ignore transient polling failures in the preview pane.
      } finally {
        inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void pollExternalChanges();
    }, EXTERNAL_SYNC_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activePath, fileState, loading, tabId, workspace.id, workspace.rootPath]);

  const handleSave = useCallback(async () => {
    if (!activePath || !fileState?.exists || fileState.kind !== "text" || saving) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await bridge.writeWorkspacePreviewFile(
        workspace.rootPath,
        activePath,
        editorContent,
        workspace.id
      );
      setSavedContent(editorContent);
      setFileState((current) =>
        current && current.exists && current.kind === "text"
          ? {
              ...current,
              content: editorContent,
              truncated: false,
            }
          : current
      );
      externalSnapshotRef.current = {
        content: editorContent,
        truncated: false,
      };
      setIsEditing(false);
      setExternalConflict(null);
      setExternalNotice("Saved.");
    } catch (saveErrorValue) {
      setSaveError(errorMessageFromUnknown(saveErrorValue, "Unable to save file."));
    } finally {
      setSaving(false);
    }
  }, [activePath, editorContent, fileState, saving, workspace.id, workspace.rootPath]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [handleSave, isEditing]);

  const resolvedPath = activePath ?? "";
  const showPreviewToggle = activePath ? canPreviewAsMarkdown(activePath) : false;
  const truncated = Boolean(fileState?.truncated);
  const isTextFile = fileState?.exists && fileState.kind === "text";
  const currentTextContent = isTextFile ? editorContent : fileState?.content ?? "";
  const canAddToChat = isTextFile && currentTextContent.trim().length > 0;
  const canEditText = isTextFile && !truncated;
  const isDirty = canEditText && editorContent !== savedContent;
  const canSymbolLookup = isTextFile && currentTextContent.trim().length > 0;
  const localFilePath =
    workspace.locationKind === "local" && activePath
      ? joinLocalWorkspacePath(workspace.rootPath, activePath)
      : null;

  const handleAddToChat = () => {
    if (!canAddToChat || !activePath) return;
    const language = snippetFenceLanguage(activePath);
    const fence = language ? `\`\`\`${language}` : "```";
    const body = `${activePath}\n${fence}\n${currentTextContent}${truncated ? "\n\n[truncated preview]" : ""}\n\`\`\``;
    setTabDraftPrompt(tabId, appendPromptText(currentDraftPrompt, body));
    window.dispatchEvent(new Event("terminal-queue-edit-focus"));
  };

  const handleDiscardChanges = () => {
    if (externalConflict) {
      setEditorContent(externalConflict.content);
      setSavedContent(externalConflict.content);
      setFileState((current) =>
        current && current.exists && current.kind === "text"
          ? {
              ...current,
              content: externalConflict.content,
              truncated: externalConflict.truncated,
            }
          : current
      );
      externalSnapshotRef.current = {
        content: externalConflict.content,
        truncated: externalConflict.truncated,
      };
      setExternalConflict(null);
      setExternalNotice("Reloaded newer disk version.");
    } else {
      setEditorContent(savedContent);
    }
    setIsEditing(false);
    setSaveError(null);
  };

  const runSymbolLookup = useCallback(
    async (kind: SymbolLookupKind) => {
      if (!activePath || !canSymbolLookup) {
        return;
      }
      const symbol = resolveSymbolQuery(editorViewRef.current, currentTextContent);
      if (!symbol) {
        setLookupState({
          kind,
          symbol: "",
          loading: false,
          error: "Place the cursor on a symbol or select one first.",
          results: [],
          source: "search-fallback",
        });
        return;
      }

      const requestId = lookupRequestIdRef.current + 1;
      lookupRequestIdRef.current = requestId;
      setLookupState({
        kind,
        symbol,
        loading: true,
        error: null,
        results: [],
        source: "code-intel",
      });

      try {
        let results: SymbolLookupItem[] = [];
        let source: "code-intel" | "search-fallback" = "search-fallback";
        let fallbackError: string | null = null;
        const cursorLocation = resolveEditorCursorLocation(editorViewRef.current);

        if (cursorLocation && workspace.locationKind === "local") {
          try {
            const response =
              kind === "definition"
                ? await bridge.getCodeIntelDefinition(workspace.id, {
                    filePath: activePath,
                    line: cursorLocation.line,
                    character: cursorLocation.character,
                  })
                : await bridge.getCodeIntelReferences(workspace.id, {
                    filePath: activePath,
                    line: cursorLocation.line,
                    character: cursorLocation.character,
                    includeDeclaration: false,
                  });
            results = flattenCodeIntelResults(response.result);
            if (results.length > 0) {
              source = "code-intel";
            }
          } catch (nativeLookupError) {
            fallbackError = errorMessageFromUnknown(
              nativeLookupError,
              "Native code intelligence is unavailable for this symbol."
            );
          }
        }

        if (results.length === 0) {
          if (kind === "references") {
            const response = await bridge.searchWorkspaceText(
              workspace.rootPath,
              {
                query: symbol,
                caseSensitive: true,
                wholeWord: true,
                isRegex: false,
              },
              workspace.id
            );
            results = flattenTextSearchResults(response.files);
          } else {
            const escaped = escapeRegex(symbol);
            const definitionPatterns = [
              `\\b(?:function|class|interface|type|enum|const|let|var|fn|struct|trait|impl)\\s+${escaped}\\b`,
              `\\b${escaped}\\s*[:=]`,
              `\\b${escaped}\\s*\\(`,
            ];

            for (const pattern of definitionPatterns) {
              const response = await bridge.searchWorkspaceText(
                workspace.rootPath,
                {
                  query: pattern,
                  caseSensitive: true,
                  wholeWord: false,
                  isRegex: true,
                },
                workspace.id
              );
              if (response.matchCount > 0) {
                results = flattenTextSearchResults(response.files);
                break;
              }
            }

            if (results.length === 0) {
              const fallback = await bridge.searchWorkspaceText(
                workspace.rootPath,
                {
                  query: symbol,
                  caseSensitive: true,
                  wholeWord: true,
                  isRegex: false,
                },
                workspace.id
              );
              results = flattenTextSearchResults(fallback.files);
            }
          }
        }

        if (requestId !== lookupRequestIdRef.current) {
          return;
        }

        setLookupState({
          kind,
          symbol,
          loading: false,
          error:
            results.length === 0
              ? fallbackError ??
                (kind === "definition"
                  ? "No definition candidates found."
                  : "No references found.")
              : null,
          results,
          source,
        });
      } catch (lookupError) {
        if (requestId !== lookupRequestIdRef.current) {
          return;
        }
        setLookupState({
          kind,
          symbol,
          loading: false,
          error: errorMessageFromUnknown(lookupError, "Unable to search the workspace."),
          results: [],
          source: "search-fallback",
        });
      }
    },
    [activePath, canSymbolLookup, currentTextContent, workspace.id, workspace.locationKind, workspace.rootPath]
  );

  const handleJumpToLookupResult = useCallback(
    (path: string, line: number, column: number) => {
      pendingFocusRef.current = {
        tabId,
        path,
        line,
        column,
      };
      if (path === activePath) {
        if (activeMode !== "code") {
          setChatFilePreviewMode(tabId, path, "code");
          return;
        }
        focusEditorAtLocation(line, column);
        pendingFocusRef.current = null;
        return;
      }
      openChatFilePreview(tabId, path);
    },
    [activeMode, activePath, focusEditorAtLocation, openChatFilePreview, setChatFilePreviewMode, tabId]
  );

  const renderLookupPanel = () => {
    if (!lookupState) {
      return null;
    }
    const title = lookupState.kind === "definition" ? "Definition candidates" : "Reference results";
    return (
      <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-[#f5f7fa] px-3 py-2">
        <div className="overflow-hidden rounded-lg border border-slate-200/80 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold text-slate-800">
                {title}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                <span className="truncate">{lookupState.symbol || "No symbol selected"}</span>
                {lookupState.source === "search-fallback" ? (
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500">
                    Fallback search
                  </span>
                ) : (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    Code intel
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
              onClick={() => setLookupState(null)}
              aria-label="Close search results"
              title="Close search results"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {lookupState.loading ? (
            <div className="px-3 py-3 text-sm text-slate-500">
              <div className="flex items-center gap-2">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Searching workspace...
              </div>
            </div>
          ) : lookupState.error ? (
            <div className="px-3 py-3 text-sm text-amber-800">
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                {lookupState.error}
              </div>
            </div>
          ) : (
            <div className="max-h-[240px] overflow-auto bg-white">
              <div className="divide-y divide-slate-200/70">
                {lookupState.results.slice(0, 40).map((result) => (
                  <button
                    key={result.key}
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-[11px] transition hover:bg-slate-50"
                    onClick={() => handleJumpToLookupResult(result.path, result.line, result.column)}
                  >
                    <FileIcon filePath={result.path} className="h-3.5 w-3.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <span className="truncate font-mono text-[11px] text-slate-800">{result.path}</span>
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">
                          L{result.line}:C{result.column}
                        </span>
                      </div>
                      {result.preview ? (
                        <div className="mt-0.5 truncate text-[10px] text-slate-500">
                          {result.preview}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderBody = () => {
    if (loading) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          Loading file preview...
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
          {error}
        </div>
      );
    }
    if (!fileState?.exists) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
          File not found.
        </div>
      );
    }
    if (fileState.kind === "image") {
      if (!assetSrc) {
        return (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
            {truncated ? "Remote image is too large to preview inline." : "Image preview is unavailable."}
          </div>
        );
      }
      return (
        <div className="flex h-full items-center justify-center overflow-auto bg-[linear-gradient(45deg,#eef2f7_25%,transparent_25%),linear-gradient(-45deg,#eef2f7_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eef2f7_75%),linear-gradient(-45deg,transparent_75%,#eef2f7_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0] p-6">
          <img
            src={assetSrc}
            alt={resolvedPath}
            className="max-h-full max-w-full object-contain shadow-sm"
            onError={handleImageLoadError}
          />
        </div>
      );
    }
    if (fileState.kind === "pdf") {
      if (!assetSrc) {
        return (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
            {truncated ? "Remote PDF is too large to preview inline." : "PDF preview is unavailable."}
          </div>
        );
      }
      return (
        <object data={assetSrc} type="application/pdf" className="h-full w-full bg-white">
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
            PDF preview is unavailable in this runtime.
          </div>
        </object>
      );
    }
    if (fileState.kind === "binary-unsupported") {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
          This file type is not previewable in chat yet.
        </div>
      );
    }
    if (!isEditing && activeMode === "preview" && canPreviewAsMarkdown(resolvedPath)) {
      return (
        <div className="h-full overflow-auto bg-[#fbfcfe] px-6 py-5">
          <div className="dcc-markdown-preview dcc-markdown-preview-plain mt-0 max-w-none text-[13px] leading-7 text-slate-800">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentTextContent}</ReactMarkdown>
          </div>
        </div>
      );
    }
    return (
      <div className="h-full overflow-hidden bg-[#fbfcfe]">
        <CodeMirror
          value={currentTextContent}
          height="100%"
          className="h-full text-[12px] [&_.cm-editor]:h-full [&_.cm-editor]:bg-transparent [&_.cm-gutters]:min-h-full [&_.cm-gutters]:border-r [&_.cm-gutters]:border-slate-200 [&_.cm-gutters]:bg-[#f8fafc] [&_.cm-lineNumbers]:text-slate-400 [&_.cm-scroller]:overflow-auto"
          editable={isEditing}
          readOnly={!isEditing}
          onChange={(value) => {
            setEditorContent(value);
          }}
          onCreateEditor={(view) => {
            editorViewRef.current = view;
            setEditorReadyTick((current) => current + 1);
          }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            highlightSelectionMatches: false,
          }}
          theme="light"
        />
      </div>
    );
  };

  const renderTopbarActions = () => (
    <div className="flex items-center gap-3">
      {canAddToChat ? (
        <button
          type="button"
          className="group inline-flex items-center"
          onClick={handleAddToChat}
          title="Add to chat"
          aria-label="Add to chat"
        >
          <ActionLabel icon={<Plus className="h-3 w-3" />} label="Add to chat" />
        </button>
      ) : null}
      {showPreviewToggle ? (
        <>
          <button
            type="button"
            className="group inline-flex items-center"
            onClick={() => {
              setIsEditing(false);
              setChatFilePreviewMode(tabId, resolvedPath, "preview");
            }}
            title="Preview"
            aria-label="Preview"
          >
            <ActionLabel
              icon={<Eye className="h-3 w-3" />}
              label="Preview"
              active={activeMode === "preview" && !isEditing}
            />
          </button>
          <button
            type="button"
            className="group inline-flex items-center"
            onClick={() => setChatFilePreviewMode(tabId, resolvedPath, "code")}
            title="Code"
            aria-label="Code"
          >
            <ActionLabel
              icon={<Code2 className="h-3 w-3" />}
              label="Code"
              active={activeMode === "code" || isEditing}
            />
          </button>
        </>
      ) : null}
      {canSymbolLookup ? (
        <>
          <button
            type="button"
            className="group inline-flex items-center"
            onClick={() => void runSymbolLookup("definition")}
            title="Find definition candidates"
            aria-label="Find definition candidates"
          >
            <ActionLabel
              icon={
                lookupState?.loading && lookupState.kind === "definition" ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                ) : (
                  <ArrowUpRight className="h-3 w-3" />
                )
              }
              label="Definition"
            />
          </button>
          <button
            type="button"
            className="group inline-flex items-center"
            onClick={() => void runSymbolLookup("references")}
            title="Find workspace references"
            aria-label="Find workspace references"
          >
            <ActionLabel
              icon={
                lookupState?.loading && lookupState.kind === "references" ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                ) : (
                  <Search className="h-3 w-3" />
                )
              }
              label="References"
            />
          </button>
        </>
      ) : null}
      {canEditText ? (
        isEditing || isDirty ? (
          <>
            <button
              type="button"
              className="group inline-flex items-center disabled:cursor-not-allowed"
              onClick={() => void handleSave()}
              disabled={!isDirty || saving}
              title="Save"
              aria-label="Save"
            >
              <ActionLabel
                icon={
                  saving ? (
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )
                }
                label="Save"
                active
                disabled={!isDirty || saving}
              />
            </button>
            <button
              type="button"
              className="group inline-flex items-center"
              onClick={handleDiscardChanges}
              title={externalConflict ? "Reload from disk" : "Discard changes"}
              aria-label={externalConflict ? "Reload from disk" : "Discard changes"}
            >
              <ActionLabel icon={<RotateCcw className="h-3 w-3" />} label="Discard" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="group inline-flex items-center"
            onClick={() => {
              setIsEditing(true);
              setChatFilePreviewMode(tabId, resolvedPath, "code");
            }}
            title="Edit"
            aria-label="Edit"
          >
            <ActionLabel icon={<Pencil className="h-3 w-3" />} label="Edit" />
          </button>
        )
      ) : null}
      <button
        type="button"
        className="group inline-flex items-center"
        onClick={() => void loadFile()}
        title="Refresh file preview"
        aria-label="Refresh file preview"
      >
        <ActionLabel
          icon={<RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />}
          label="Refresh"
        />
      </button>
    </div>
  );

  if (!activePath) {
    return null;
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-[#fafbfd] px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            onClick={() => clearChatFilePreview(tabId)}
            title="Back to chat"
            aria-label="Back to chat"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="truncate font-mono text-[12px] font-semibold text-slate-800" title={resolvedPath}>
            {resolvedPath}
          </span>
          {isDirty ? <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-sky-500" /> : null}
          {truncated ? (
            <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-slate-400">Truncated</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-4">{renderTopbarActions()}</div>
      </div>

      <div className="border-b border-border bg-[#fafbfd] px-2 py-1">
        <div className="flex items-center gap-0.5 overflow-x-auto">
          {previewState.openTabs.map((path) => {
            const isActive = path === activePath;
            const tabLabel = fileName(path);
            return (
              <div
                key={path}
                className={`group inline-flex max-w-[220px] items-center text-[10px] transition ${
                  isActive
                    ? "bg-white text-slate-900"
                    : "bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <button
                  type="button"
                  className="inline-flex min-w-0 items-center gap-1.5 px-2 py-1.5"
                  onClick={() => setActiveChatFilePreviewTab(tabId, path)}
                  title={path}
                >
                  <FileIcon filePath={path} className="h-3 w-3 shrink-0 opacity-90" />
                  <span className="truncate">{tabLabel}</span>
                </button>
                <button
                  type="button"
                  className="mr-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
                  onClick={() => closeChatFilePreviewTab(tabId, path)}
                  aria-label={`Close ${tabLabel}`}
                  title={`Close ${tabLabel}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {externalConflict ? (
        <div className="border-b border-amber-200/70 bg-[#fff8eb] px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-amber-900">File changed on disk</div>
              <div className="mt-0.5 text-[11px] text-amber-800">
                A newer version was detected while you had unsaved edits.
                {externalConflict.updateCount > 1 ? ` (${externalConflict.updateCount} updates)` : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-900 transition hover:bg-amber-100"
                onClick={handleDiscardChanges}
              >
                Reload from disk
              </button>
              <button
                type="button"
                className="inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-medium text-amber-900 transition hover:bg-amber-100"
                onClick={() => setExternalConflict(null)}
              >
                Keep mine
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {externalNotice ? (
        <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-[12px] font-medium text-sky-700">
          {externalNotice}
        </div>
      ) : null}

      {saveError ? (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-[12px] font-medium text-rose-700">
          {saveError}
        </div>
      ) : null}

      {renderLookupPanel()}

      <div className="min-h-0 flex-1 overflow-hidden">{renderBody()}</div>

      <div className="flex min-h-[24px] items-center justify-between gap-2 border-t border-border bg-[#fafbfd] px-3 py-1 text-[10px] text-slate-400">
        <div className="flex min-w-0 items-center gap-2">
          {canEditText && isDirty ? (
            <span className="inline-flex items-center gap-2 text-slate-600">
              <span className="inline-flex h-2 w-2 rounded-full bg-sky-500" />
              Unsaved changes
              <span className="rounded border border-slate-200 bg-slate-50 px-1 py-0 font-mono text-[9px] text-slate-400">
                Cmd/Ctrl+S
              </span>
            </span>
          ) : canEditText ? (
            <span className="text-slate-500">Saved</span>
          ) : truncated ? (
            <span>Read-only truncated preview</span>
          ) : (
            <span>Read-only preview</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {localFilePath ? <OpenWorkspaceMenu path={localFilePath} subjectLabel="文件" /> : null}
        </div>
      </div>
    </section>
  );
}
