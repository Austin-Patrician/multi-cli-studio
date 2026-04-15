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
import { cx } from "../modelProviders/ui";
import { SkillMarkdownPreview } from "./SkillMarkdownPreview";

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

function isSkillMarkdownPath(path: string | null | undefined) {
  return normalizePath(path).endsWith("/skill.md") || pathBaseName(String(path ?? "")).toLowerCase() === "skill.md";
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

  const selectedFileExtension = extName(selectedNodePath ?? "");
  const selectedFileIsMarkdown =
    selectedNodeKind === "file" && MARKDOWN_EXTENSIONS.has(selectedFileExtension);
  const selectedFileIsSkillMarkdown =
    selectedNodeKind === "file" && isSkillMarkdownPath(selectedNodePath);
  const selectedFileHasUnsavedChanges =
    selectedNodeKind === "file" && selectedFileDraftContent !== selectedFileContent;

  return (
    <section className="settings-section dcc-skills-shell">
      <div>
        <div className="settings-section-title">技能</div>
        <div className="settings-section-subtitle">
          浏览不同引擎的全局技能目录，预览 `SKILL.md` 结构化内容，并直接编辑资源文件。
        </div>
      </div>

      <div className="dcc-toolbar-row dcc-toolbar-row-wrap">
        <div className="dcc-segmented">
          {ENGINE_ORDER.map((item) => (
            <button
              key={item}
              type="button"
              className={cx("dcc-segmented-button", engine === item && "is-active")}
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

        <div className="dcc-search-shell">
          <Search className="dcc-search-icon h-4 w-4" />
          <input
            className="dcc-search-input dcc-search-input-with-icon"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索技能名、描述、路径..."
          />
          {query ? (
            <button type="button" className="dcc-search-clear" onClick={() => setQuery("")} aria-label="清空搜索">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="dcc-detail-actions">
          <button type="button" className="dcc-action-button" onClick={() => void refreshSkills()}>
            <RefreshCw size={14} className={skillStatus === "loading" ? "dcc-spin" : ""} />
            刷新
          </button>
        </div>
      </div>

      <div className="dcc-skills-summary-strip">
        <span className="dcc-detail-chip">{ENGINE_LABEL[engine]}</span>
        <span className="dcc-detail-chip">{activeWorkspace?.name ?? "无工作区"}</span>
        <span className="dcc-detail-chip">{filteredSkills.length} 个技能</span>
        <span className="dcc-detail-chip" title={engineRootPath ?? undefined}>
          {engineRootPath || "未发现全局根目录"}
        </span>
        {selectedFileIsSkillMarkdown ? <span className="dcc-detail-chip">结构化 SKILL.md 预览</span> : null}
      </div>

      <div
        ref={browserContainerRef}
        className={cx(
          "dcc-skills-browser",
          isResizingTreePane && "is-resizing",
          treePaneCollapsed && "is-tree-collapsed"
        )}
        style={treePaneCollapsed ? undefined : { gridTemplateColumns: `${treePaneWidth}px 6px minmax(0, 1fr)` }}
      >
        <aside className="dcc-skills-list-pane">
          <div className="dcc-pane-title-row">
            <div>
              <div className="dcc-pane-title">技能树</div>
              <div className="dcc-skill-detail-copy">目录浏览、文件预览与技能入口识别</div>
            </div>
            <button type="button" className="dcc-pane-icon-btn" onClick={toggleTreePane} title="收起技能树">
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>

          <div className="dcc-tree-root">{engineRootPath || "未指定技能目录"}</div>

          <div className="dcc-skills-tree-scroll">
            {!engineRootPath ? (
              <div className="dcc-empty-state">未找到该引擎的全局技能根目录。</div>
            ) : rootEntries.length === 0 && skillStatus !== "loading" ? (
              <div className="dcc-empty-state">当前目录下没有可浏览的技能文件。</div>
            ) : (
              renderDirectory(engineRootPath, 0)
            )}
          </div>
        </aside>

        <button
          type="button"
          className="dcc-skills-splitter"
          onPointerDown={handleTreePaneResizeStart}
          onDoubleClick={toggleTreePane}
          aria-label="调整技能树宽度"
        />

        <section className="dcc-skill-detail-pane">
          <div className="dcc-pane-title-row">
            <div>
              <div className="dcc-pane-title">{selectedNodePath ? pathBaseName(selectedNodePath) : "详细信息"}</div>
              <div className="dcc-skill-detail-copy">
                {selectedNodePath ? normalizePath(selectedNodePath) : "请选择左侧技能目录或文件"}
              </div>
            </div>

            <div className="dcc-detail-actions">
              {treePaneCollapsed ? (
                <button type="button" className="dcc-pane-icon-btn" onClick={toggleTreePane} title="展开技能树">
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : null}

              {selectedNodeKind === "file" ? (
                isEditingSelectedFile ? (
                  <>
                    <button
                      type="button"
                      className="dcc-action-button"
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
                      className="dcc-action-button"
                      onClick={() => void handleSaveFile()}
                      disabled={selectedFileSaveLoading || !selectedFileHasUnsavedChanges}
                    >
                      <Save size={14} />
                      {selectedFileSaveLoading ? "保存中..." : "保存"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="dcc-action-button"
                    onClick={() => setIsEditingSelectedFile(true)}
                  >
                    <PencilLine size={14} />
                    编辑
                  </button>
                )
              ) : null}
            </div>
          </div>

          {selectedSkill ? (
            <div className="dcc-skill-detail-panel">
              <div className="dcc-skill-detail-headline">
                <div className="dcc-skill-detail-name">{selectedSkill.displayName ?? selectedSkill.name}</div>
                <span className="dcc-detail-chip">{selectedNodeKind === "dir" ? "目录" : "文件"}</span>
                {selectedSkill.source ? <span className="dcc-detail-chip">{selectedSkill.source}</span> : null}
                {selectedSkill.scope ? <span className="dcc-detail-chip">{selectedSkill.scope}</span> : null}
              </div>

              <div className="dcc-skill-detail-meta">
                <span className="dcc-detail-chip" title={selectedNodePath ?? undefined}>
                  当前路径: {selectedNodePath ? pathBaseName(selectedNodePath) : "未选择"}
                </span>
                <span className="dcc-detail-chip" title={normalizePath(pathParent(selectedSkill.path)) || undefined}>
                  技能根目录: {normalizePath(pathParent(selectedSkill.path)) || "不可用"}
                </span>
              </div>

              {selectedSkill.description ? (
                <div className="dcc-skill-detail-description">{selectedSkill.description}</div>
              ) : null}
            </div>
          ) : null}

          {selectedNodeKind === "dir" ? (
            <div className="dcc-skill-directory-state">
              <div className="dcc-skill-directory-state-title">目录已选中</div>
              <div className="dcc-skill-directory-state-copy">
                当前目录加载了 {selectedDirectoryChildCount} 个子项目。继续从左侧选择 `SKILL.md`、资源文件或子目录查看详情。
              </div>
            </div>
          ) : null}

          {selectedNodeKind === "file" ? (
            <>
              {selectedFileSaveError ? <div className="dcc-inline-error">{selectedFileSaveError}</div> : null}
              {selectedFileContentError ? <div className="dcc-inline-error">{selectedFileContentError}</div> : null}

              {selectedFileContentLoading ? (
                <div className="dcc-empty-state">正在加载文件内容...</div>
              ) : imagePreviewSrc ? (
                <div className="dcc-skill-image-stage">
                  <img src={imagePreviewSrc} alt="" className="dcc-skill-image-preview" />
                </div>
              ) : isEditingSelectedFile ? (
                <textarea
                  className="dcc-skill-editor"
                  value={selectedFileDraftContent}
                  onChange={(event) => setSelectedFileDraftContent(event.target.value)}
                />
              ) : selectedFileIsSkillMarkdown ? (
                <SkillMarkdownPreview content={selectedFileContent} />
              ) : selectedFileIsMarkdown ? (
                <div className="dcc-markdown-preview dcc-skill-preview-frame">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedFileContent}</ReactMarkdown>
                </div>
              ) : (
                <pre className="dcc-code-preview dcc-skill-code-frame">{selectedFileContent || "空文件。"}</pre>
              )}
            </>
          ) : null}

          {!selectedNodePath ? (
            <div className="dcc-empty-state">请先从左侧技能树选择一个目录或文件。</div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
