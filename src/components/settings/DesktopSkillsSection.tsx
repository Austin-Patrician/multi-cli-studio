import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import { bridge } from "../../lib/bridge";
import { useStore } from "../../lib/store";
import type { AgentId, CliSkillItem, ExternalDirectoryEntry, WorkspaceRef } from "../../lib/models";

type TreeNodeKind = "dir" | "file" | null;
type GlobalEngine = "claude" | "codex" | "gemini";

const ENGINE_ORDER: GlobalEngine[] = ["claude", "codex", "gemini"];
const ENGINE_LABEL: Record<GlobalEngine, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};
const ENGINE_PATH_MARKERS: Record<GlobalEngine, string[]> = {
  claude: ["/.claude/skills"],
  codex: ["/.codex/skills"],
  gemini: ["/.gemini/skills"],
};
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "ico"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);
const TREE_MIN_WIDTH = 240;
const TREE_DEFAULT_WIDTH = 340;
const TREE_MAX_WIDTH = 560;
const TREE_COLLAPSE_THRESHOLD = 120;

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePath(path: unknown) {
  return String(path ?? "").trim().replace(/\\/g, "/");
}

function pathParent(path: string) {
  const normalized = normalizePath(path).replace(/\/+$/, "");
  if (!normalized) return "";
  const index = normalized.lastIndexOf("/");
  if (index < 0) return "";
  if (index === 0) return "/";
  return normalized.slice(0, index);
}

function pathBaseName(path: string) {
  const normalized = normalizePath(path).replace(/\/+$/, "");
  if (!normalized) return "";
  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? normalized;
}

function extName(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function matchesEngine(skill: CliSkillItem, engine: GlobalEngine) {
  const normalized = normalizePath(skill.path);
  return ENGINE_PATH_MARKERS[engine].some((marker) => normalized.includes(marker));
}

function extractEngineRoot(path: string, engine: GlobalEngine) {
  const normalized = normalizePath(path);
  const lowered = normalized.toLowerCase();
  for (const marker of ENGINE_PATH_MARKERS[engine]) {
    const index = lowered.lastIndexOf(marker.toLowerCase());
    if (index >= 0) {
      return normalized.slice(0, index + marker.length);
    }
  }
  return null;
}

function sortEntries(entries: ExternalDirectoryEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "dir" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

export function DesktopSkillsSection({
  activeWorkspace,
}: {
  activeWorkspace: WorkspaceRef | null;
}) {
  const loadCliSkills = useStore((state) => state.loadCliSkills);
  const cliSkillsByContext = useStore((state) => state.cliSkillsByContext);
  const cliSkillStatusByContext = useStore((state) => state.cliSkillStatusByContext);

  const [engine, setEngine] = useState<GlobalEngine>("claude");
  const [query, setQuery] = useState("");
  const [selectedNodePath, setSelectedNodePath] = useState<string | null>(null);
  const [selectedNodeKind, setSelectedNodeKind] = useState<TreeNodeKind>(null);
  const [expandedDirectoryKeys, setExpandedDirectoryKeys] = useState<Set<string>>(new Set());
  const [directoryEntries, setDirectoryEntries] = useState<Record<string, ExternalDirectoryEntry[]>>({});
  const [directoryErrors, setDirectoryErrors] = useState<Record<string, string>>({});
  const [loadingDirectoryKeys, setLoadingDirectoryKeys] = useState<Set<string>>(new Set());
  const [selectedFileContent, setSelectedFileContent] = useState("");
  const [selectedFileContentError, setSelectedFileContentError] = useState<string | null>(null);
  const [selectedFileContentLoading, setSelectedFileContentLoading] = useState(false);
  const [isEditingSelectedFile, setIsEditingSelectedFile] = useState(false);
  const [selectedFileDraftContent, setSelectedFileDraftContent] = useState("");
  const [selectedFileSaveLoading, setSelectedFileSaveLoading] = useState(false);
  const [selectedFileSaveError, setSelectedFileSaveError] = useState<string | null>(null);
  const [imagePreviewSrc, setImagePreviewSrc] = useState<string | null>(null);
  const [treePaneWidth, setTreePaneWidth] = useState(TREE_DEFAULT_WIDTH);
  const [isResizingTreePane, setIsResizingTreePane] = useState(false);
  const browserContainerRef = useRef<HTMLDivElement | null>(null);
  const treeResizeCleanupRef = useRef<(() => void) | null>(null);

  const cacheKey = activeWorkspace ? `${engine}:${activeWorkspace.id}` : null;
  const skills = cacheKey ? cliSkillsByContext[cacheKey] ?? [] : [];
  const skillStatus = cacheKey ? cliSkillStatusByContext[cacheKey] ?? "idle" : "idle";

  useEffect(() => {
    if (!activeWorkspace) return;
    void loadCliSkills(engine as AgentId, activeWorkspace.id);
  }, [activeWorkspace, engine, loadCliSkills]);

  const engineSkills = useMemo(() => skills.filter((skill) => matchesEngine(skill, engine)), [engine, skills]);
  const filteredSkills = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return engineSkills;
    return engineSkills.filter((skill) =>
      `${skill.name} ${skill.displayName ?? ""} ${skill.description ?? ""} ${skill.path}`.toLowerCase().includes(normalizedQuery)
    );
  }, [engineSkills, query]);

  const engineRootPath = useMemo(() => {
    for (const skill of filteredSkills.length > 0 ? filteredSkills : engineSkills) {
      const root = extractEngineRoot(skill.path, engine);
      if (root) return root;
    }
    return null;
  }, [engine, engineSkills, filteredSkills]);

  const skillRootMap = useMemo(() => {
    const map = new Map<string, CliSkillItem>();
    for (const skill of engineSkills) {
      const rootPath = pathParent(skill.path);
      if (rootPath) {
        map.set(normalizePath(rootPath), skill);
      }
    }
    return map;
  }, [engineSkills]);

  const loadDirectoryEntries = useCallback(async (directoryPath: string) => {
    const normalized = normalizePath(directoryPath);
    setLoadingDirectoryKeys((current) => new Set(current).add(normalized));
    try {
      const entries = await bridge.listExternalAbsoluteDirectoryChildren(directoryPath);
      setDirectoryEntries((current) => ({ ...current, [normalized]: sortEntries(entries) }));
      setDirectoryErrors((current) => {
        const next = { ...current };
        delete next[normalized];
        return next;
      });
    } catch (error) {
      setDirectoryErrors((current) => ({
        ...current,
        [normalized]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setLoadingDirectoryKeys((current) => {
        const next = new Set(current);
        next.delete(normalized);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (engineRootPath && !directoryEntries[normalizePath(engineRootPath)]) {
      void loadDirectoryEntries(engineRootPath);
      setExpandedDirectoryKeys(new Set([normalizePath(engineRootPath)]));
    }
  }, [directoryEntries, engineRootPath, loadDirectoryEntries]);

  const loadFileContent = useCallback(async (path: string) => {
    setSelectedFileContentLoading(true);
    setSelectedFileContentError(null);
    setImagePreviewSrc(null);
    try {
      if (IMAGE_EXTENSIONS.has(extName(path))) {
        setImagePreviewSrc(await convertFileSrc(path));
        setSelectedFileContent("");
        setSelectedFileDraftContent("");
      } else {
        const file = await bridge.readExternalAbsoluteFile(path);
        setSelectedFileContent(file.content);
        setSelectedFileDraftContent(file.content);
      }
    } catch (error) {
      setSelectedFileContentError(error instanceof Error ? error.message : String(error));
    } finally {
      setSelectedFileContentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedNodeKind === "file" && selectedNodePath) {
      void loadFileContent(selectedNodePath);
    } else {
      setSelectedFileContent("");
      setSelectedFileDraftContent("");
      setSelectedFileContentError(null);
      setImagePreviewSrc(null);
    }
  }, [loadFileContent, selectedNodeKind, selectedNodePath]);

  const toggleDirectory = useCallback(
    (path: string) => {
      const normalized = normalizePath(path);
      setExpandedDirectoryKeys((current) => {
        const next = new Set(current);
        if (next.has(normalized)) {
          next.delete(normalized);
        } else {
          next.add(normalized);
          if (!directoryEntries[normalized]) {
            void loadDirectoryEntries(path);
          }
        }
        return next;
      });
    },
    [directoryEntries, loadDirectoryEntries]
  );

  const rootEntries = engineRootPath ? directoryEntries[normalizePath(engineRootPath)] ?? [] : [];

  function renderDirectory(path: string, depth: number): ReactNode[] {
    const normalized = normalizePath(path);
    const entries = directoryEntries[normalized] ?? [];
    return entries.flatMap((entry) => {
      const entryPath = normalizePath(entry.path);
      const isDir = entry.kind === "dir";
      const isExpanded = expandedDirectoryKeys.has(entryPath);
      const isSelected = selectedNodePath === entryPath;
      const skillRoot = skillRootMap.get(entryPath);
      const icon = isDir ? (
        isExpanded ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />
      ) : IMAGE_EXTENSIONS.has(extName(entry.name)) ? (
        <ImageIcon className="h-4 w-4" />
      ) : MARKDOWN_EXTENSIONS.has(extName(entry.name)) ? (
        <FileText className="h-4 w-4" />
      ) : (
        <FileCode2 className="h-4 w-4" />
      );

      return [
        <div key={entryPath}>
          <button
            type="button"
            className={`dcc-skill-tree-node ${isSelected ? "is-active" : ""}`}
            style={{ paddingLeft: `${12 + depth * 18}px` }}
            onClick={() => {
              setSelectedNodePath(entryPath);
              setSelectedNodeKind(isDir ? "dir" : "file");
              if (isDir) toggleDirectory(entryPath);
            }}
          >
            <span className="dcc-skill-tree-chevron">
              {isDir ? (isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
            </span>
            <span className="dcc-skill-tree-icon">{icon}</span>
            <span className="dcc-skill-tree-label">{entry.name}</span>
            {skillRoot ? <span className="dcc-badge">组件</span> : null}
          </button>
          {isDir && isExpanded ? (
            loadingDirectoryKeys.has(entryPath) && !directoryEntries[entryPath] ? (
              <div className="dcc-skill-tree-state" style={{ paddingLeft: `${32 + depth * 18}px` }}>加载中...</div>
            ) : directoryErrors[entryPath] ? (
              <div className="dcc-skill-tree-state dcc-inline-error" style={{ paddingLeft: `${32 + depth * 18}px` }}>
                {directoryErrors[entryPath]}
              </div>
            ) : (
              renderDirectory(entryPath, depth + 1)
            )
          ) : null}
        </div>,
      ];
    });
  }

  async function refreshSkills() {
    if (!activeWorkspace) return;
    await loadCliSkills(engine as AgentId, activeWorkspace.id, true);
    if (engineRootPath) {
      await loadDirectoryEntries(engineRootPath);
    }
  }

  async function handleSaveFile() {
    if (!selectedNodePath || selectedNodeKind !== "file") return;
    setSelectedFileSaveLoading(true);
    setSelectedFileSaveError(null);
    try {
      await bridge.writeExternalAbsoluteFile(selectedNodePath, selectedFileDraftContent);
      setSelectedFileContent(selectedFileDraftContent);
      setIsEditingSelectedFile(false);
    } catch (error) {
      setSelectedFileSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSelectedFileSaveLoading(false);
    }
  }

  const selectedSkill = selectedNodePath
    ? skillRootMap.get(
        selectedNodeKind === "dir" ? normalizePath(selectedNodePath) : normalizePath(pathParent(selectedNodePath))
      ) ?? null
    : null;

  const selectedDirectoryChildCount =
    selectedNodeKind === "dir" && selectedNodePath
      ? directoryEntries[normalizePath(selectedNodePath)]?.length ?? 0
      : 0;
  const treePaneCollapsed = treePaneWidth === 0;

  const cleanupTreeResizeTracking = useCallback(() => {
    treeResizeCleanupRef.current?.();
    treeResizeCleanupRef.current = null;
  }, []);

  useEffect(
    () => () => {
      cleanupTreeResizeTracking();
    },
    [cleanupTreeResizeTracking]
  );

  const handleTreePaneResizeStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }
      cleanupTreeResizeTracking();
      event.preventDefault();
      const containerWidth = browserContainerRef.current?.getBoundingClientRect().width ?? 0;
      const maxWidth = Math.min(TREE_MAX_WIDTH, Math.max(0, Math.floor(containerWidth - 360)));
      const startX = event.clientX;
      const startWidth = treePaneWidth;
      setIsResizingTreePane(true);

      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        let nextWidth = startWidth + (moveEvent.clientX - startX);
        nextWidth = Math.max(0, Math.min(nextWidth, maxWidth));
        if (nextWidth < TREE_COLLAPSE_THRESHOLD) {
          nextWidth = 0;
        } else if (nextWidth < TREE_MIN_WIDTH) {
          nextWidth = TREE_MIN_WIDTH;
        }
        setTreePaneWidth(nextWidth);
      };

      let completed = false;
      const finishResize = () => {
        if (completed) {
          return;
        }
        completed = true;
        setIsResizingTreePane(false);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finishResize);
        window.removeEventListener("pointercancel", finishResize);
        window.removeEventListener("blur", finishResize);
        treeResizeCleanupRef.current = null;
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", finishResize);
      window.addEventListener("pointercancel", finishResize);
      window.addEventListener("blur", finishResize);
      treeResizeCleanupRef.current = finishResize;
    },
    [cleanupTreeResizeTracking, treePaneWidth]
  );

  const toggleTreePane = useCallback(() => {
    setTreePaneWidth((current) => (current === 0 ? TREE_DEFAULT_WIDTH : 0));
  }, []);

  return (
    <section className="settings-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
      <style>{`
        .refined-skills-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
          height: 100%;
          color: #333;
        }
        .refined-header {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .refined-title {
          font-size: 1.125rem;
          font-weight: 600;
          color: #1a1a1a;
          letter-spacing: -0.01em;
        }
        .refined-subtitle {
          font-size: 0.8125rem;
          color: #666;
        }
        .refined-toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
        }
        .refined-browser {
          display: grid;
          flex: 1;
          min-height: 400px;
          border: 1px solid #e5e5e5;
          border-radius: 10px;
          background: #ffffff;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        }
        .refined-pane-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: #fafafa;
          border-bottom: 1px solid #e5e5e5;
          font-size: 0.8125rem;
          font-weight: 500;
          color: #444;
        }
        .refined-skill-node {
          padding: 6px 8px;
          margin: 2px 8px;
          border-radius: 6px;
          font-size: 0.8125rem;
          color: #333;
          transition: background 0.15s;
        }
        .refined-skill-node:hover {
          background: #f4f4f5;
        }
        .refined-skill-node.is-active {
          background: #eff6ff;
          color: #1d4ed8;
          font-weight: 500;
        }
        .refined-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          background: #f4f4f5;
          border: 1px solid #e5e5e5;
          border-radius: 6px;
          font-size: 0.75rem;
          color: #555;
          white-space: nowrap;
        }
        .refined-button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: #ffffff;
          border: 1px solid #e5e5e5;
          border-radius: 6px;
          font-size: 0.8125rem;
          color: #333;
          cursor: pointer;
          transition: all 0.15s;
        }
        .refined-button:hover {
          background: #f9f9f9;
          border-color: #d4d4d8;
        }
        .refined-button.primary {
          background: #18181b;
          color: #ffffff;
          border-color: #18181b;
        }
        .refined-button.primary:hover {
          background: #27272a;
        }
        .refined-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .refined-search {
          display: flex;
          align-items: center;
          background: #ffffff;
          border: 1px solid #e5e5e5;
          border-radius: 6px;
          padding: 0 8px;
          height: 32px;
          min-width: 200px;
        }
        .refined-search input {
          border: none;
          outline: none;
          background: transparent;
          font-size: 0.8125rem;
          padding: 0 8px;
          width: 100%;
          color: #333;
        }
        .refined-search input::placeholder {
          color: #999;
        }
        .refined-segmented {
          display: flex;
          background: #f4f4f5;
          padding: 2px;
          border-radius: 8px;
          border: 1px solid #e5e5e5;
        }
        .refined-segmented button {
          padding: 4px 12px;
          border-radius: 6px;
          font-size: 0.8125rem;
          color: #555;
          border: none;
          background: transparent;
          cursor: pointer;
          transition: all 0.15s;
        }
        .refined-segmented button.is-active {
          background: #ffffff;
          color: #18181b;
          font-weight: 500;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .refined-splitter {
          width: 1px;
          background: #e5e5e5;
          cursor: col-resize;
          position: relative;
        }
        .refined-splitter::after {
          content: '';
          position: absolute;
          top: 0; left: -3px; right: -3px; bottom: 0;
          z-index: 10;
        }
        .refined-splitter:hover {
          background: #d4d4d8;
        }
        .refined-content-area {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          overflow: auto;
        }
        .refined-code-block {
          background: #f4f4f5;
          border: 1px solid #e5e5e5;
          border-radius: 8px;
          padding: 16px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.8125rem;
          overflow: auto;
          flex: 1;
        }
        .refined-textarea {
          width: 100%;
          flex: 1;
          min-height: 200px;
          padding: 16px;
          border: 1px solid #e5e5e5;
          border-radius: 8px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.8125rem;
          resize: none;
          outline: none;
        }
        .refined-textarea:focus {
          border-color: #a1a1aa;
        }
        .refined-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #999;
          font-size: 0.875rem;
        }
        .refined-detail-header {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-bottom: 16px;
          border-bottom: 1px solid #f0f0f0;
        }
        .refined-detail-title {
          font-size: 1.125rem;
          font-weight: 600;
          color: #18181b;
        }
        .refined-detail-meta {
          font-size: 0.75rem;
          color: #71717a;
        }
        .refined-detail-desc {
          background: #fafafa;
          border: 1px solid #f0f0f0;
          padding: 12px;
          border-radius: 8px;
          font-size: 0.8125rem;
          color: #555;
        }
      `}</style>

      <div className="refined-skills-container">
        <div className="refined-header">
          <div className="refined-title">技能管理</div>
          <div className="refined-subtitle">
            管理您的各类 Agent 技能，支持多引擎切换、树状导航、Markdown 预览及文件编辑。
          </div>
        </div>

        <div className="refined-toolbar">
          <div className="refined-segmented">
            {ENGINE_ORDER.map((item) => (
              <button
                key={item}
                type="button"
                className={engine === item ? "is-active" : ""}
                onClick={() => {
                  setEngine(item);
                  setSelectedNodePath(null);
                  setSelectedNodeKind(null);
                }}
              >
                {ENGINE_LABEL[item]}
              </button>
            ))}
          </div>

          <div className="refined-search">
            <Search className="h-4 w-4" style={{ color: '#999' }} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索技能..."
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: '#999' }}>
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <button type="button" className="refined-button" onClick={() => void refreshSkills()}>
            <RefreshCw size={14} className={skillStatus === "loading" ? "dcc-spin" : ""} />
            刷新
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <span className="refined-badge">{ENGINE_LABEL[engine]}</span>
          <span className="refined-badge">{activeWorkspace?.name ?? "无工作区"}</span>
          <span className="refined-badge">{filteredSkills.length} 个技能</span>
          <span className="refined-badge">{engineRootPath || "无全局根目录"}</span>
        </div>

        <div
          ref={browserContainerRef}
          className="refined-browser"
          style={{ gridTemplateColumns: treePaneCollapsed ? '0 1px 1fr' : `${treePaneWidth}px 1px 1fr` }}
        >
          <aside style={{ display: treePaneCollapsed ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="refined-pane-header">
              <span>技能树</span>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#666' }} onClick={toggleTreePane} title="收起树">
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
            <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: '#888', borderBottom: '1px solid #f4f4f5', background: '#fafafa' }}>
              {engineRootPath || "未指定目录"}
            </div>
            <div style={{ overflow: 'auto', flex: 1, padding: '8px 0' }}>
              {!engineRootPath ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '0.8125rem' }}>未找到该引擎的全局技能根目录。</div>
              ) : rootEntries.length === 0 && skillStatus !== "loading" ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '0.8125rem' }}>未找到技能。</div>
              ) : (
                renderDirectory(engineRootPath, 0)
              )}
            </div>
          </aside>

          <button
            type="button"
            className="refined-splitter"
            onPointerDown={handleTreePaneResizeStart}
            onDoubleClick={toggleTreePane}
            aria-label="调整技能树宽度"
            style={{ border: 'none', padding: 0 }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, background: '#ffffff' }}>
            <div className="refined-pane-header">
              <span>{selectedNodePath ? pathBaseName(selectedNodePath) : "详细信息"}</span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {treePaneCollapsed ? (
                  <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#666' }} onClick={toggleTreePane} title="展开树">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                ) : null}
                {selectedNodeKind === "file" ? (
                  isEditingSelectedFile ? (
                    <>
                      <button
                        type="button"
                        className="refined-button"
                        onClick={() => {
                          setIsEditingSelectedFile(false);
                          setSelectedFileDraftContent(selectedFileContent);
                          setSelectedFileSaveError(null);
                        }}
                        disabled={selectedFileSaveLoading}
                      >
                        <X size={14} />
                        取消
                      </button>
                      <button
                        type="button"
                        className="refined-button primary"
                        onClick={() => void handleSaveFile()}
                        disabled={selectedFileSaveLoading}
                      >
                        <Save size={14} />
                        {selectedFileSaveLoading ? "保存中..." : "保存"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="refined-button"
                      onClick={() => setIsEditingSelectedFile(true)}
                    >
                      <PencilLine size={14} />
                      编辑
                    </button>
                  )
                ) : null}
              </div>
            </div>

            <div className="refined-content-area">
              {selectedSkill ? (
                <div className="refined-detail-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="refined-detail-title">{selectedSkill.displayName ?? selectedSkill.name}</span>
                    <span className="refined-badge">{selectedNodeKind === "dir" ? "目录" : "文件"}</span>
                    {selectedSkill.source ? <span className="refined-badge">{selectedSkill.source}</span> : null}
                    {selectedSkill.scope ? <span className="refined-badge">{selectedSkill.scope}</span> : null}
                  </div>
                  <div className="refined-detail-meta">{selectedNodePath}</div>
                  <div className="refined-detail-meta">
                    技能根目录: {normalizePath(pathParent(selectedSkill.path)) || "不可用"}
                  </div>
                  {selectedSkill.description ? (
                    <div className="refined-detail-desc">{selectedSkill.description}</div>
                  ) : null}
                </div>
              ) : null}

              {selectedNodeKind === "dir" ? (
                <div className="refined-empty">已选择目录。当前加载了 {selectedDirectoryChildCount} 个子项目。</div>
              ) : null}

              {selectedNodeKind === "file" ? (
                <>
                  {selectedFileSaveError ? <div style={{ color: '#ef4444', fontSize: '0.8125rem' }}>{selectedFileSaveError}</div> : null}
                  {selectedFileContentError ? <div style={{ color: '#ef4444', fontSize: '0.8125rem' }}>{selectedFileContentError}</div> : null}

                  {selectedFileContentLoading ? (
                    <div className="refined-empty">正在加载文件内容...</div>
                  ) : imagePreviewSrc ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '20px', background: '#f9f9f9', borderRadius: '8px' }}>
                      <img src={imagePreviewSrc} alt="" style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain' }} />
                    </div>
                  ) : isEditingSelectedFile ? (
                    <textarea
                      className="refined-textarea"
                      value={selectedFileDraftContent}
                      onChange={(event) => setSelectedFileDraftContent(event.target.value)}
                    />
                  ) : MARKDOWN_EXTENSIONS.has(extName(selectedNodePath ?? "")) ? (
                    <div className="dcc-markdown-preview" style={{ padding: '0 8px' }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedFileContent}</ReactMarkdown>
                    </div>
                  ) : (
                    <pre className="refined-code-block dcc-code-preview">{selectedFileContent || "空文件。"}</pre>
                  )}
                </>
              ) : null}

              {!selectedNodePath ? <div className="refined-empty">请在左侧选择一个技能文件夹或文件。</div> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
