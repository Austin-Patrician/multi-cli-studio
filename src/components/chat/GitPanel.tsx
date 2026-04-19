import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheckBig,
  FolderTree,
  LayoutGrid,
  Minus,
  Plus,
  RefreshCw,
  SquarePen,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { bridge } from "../../lib/bridge";
import type { GitFileDiff, GitFileStatus, GitLogResponse, GitOverviewResponse, WorkspaceRef } from "../../lib/models";
import { useStore } from "../../lib/store";
import { FileIcon } from "../FileIcon";
import { GitTooltipButton } from "../GitTooltipButton";
import { GitDiffBlock, type GitDiffStyle } from "../settings/GitDiffBlock";

type ChangeViewMode = "flat" | "tree";
type WorktreeSectionKind = "staged" | "unstaged";
type DiffTreeFolderNode<T extends { path: string }> = {
  key: string;
  name: string;
  folders: Map<string, DiffTreeFolderNode<T>>;
  files: T[];
};
type DiffModalState = {
  file: GitFileStatus;
  diff: GitFileDiff | null;
  loading: boolean;
  error: string | null;
};

const TREE_INDENT_STEP = 10;
const DIFF_STYLE_STORAGE_KEY = "workspace_right_panel_git_diff_style";
const COMMIT_COLLAPSE_STORAGE_KEY = "workspace_right_panel_git_commit_collapsed";
const REMOTE_GIT_CACHE_TTL_MS = 30_000;
const gitLogCacheByWorkspace = new Map<string, GitLogResponse | null>();
const gitRefreshAtByWorkspace = new Map<string, number>();

function splitPath(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

function buildFileKey(path: string, oldPath?: string | null) {
  return `${oldPath ?? ""}::${path}`;
}

function splitNameAndExtension(name: string) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return { base: name, extension: "" };
  }
  return {
    base: name.slice(0, lastDot),
    extension: name.slice(lastDot + 1).toLowerCase(),
  };
}

function normalizeStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "a" || normalized === "added") return "A";
  if (normalized === "d" || normalized === "deleted") return "D";
  if (normalized === "r" || normalized === "renamed") return "R";
  if (normalized === "t" || normalized === "typechange") return "T";
  return "M";
}

function statusToneClass(status: string) {
  switch (normalizeStatus(status)) {
    case "A":
      return "is-add";
    case "D":
      return "is-del";
    case "R":
      return "is-rename";
    case "T":
      return "is-typechange";
    default:
      return "is-mod";
  }
}

function statusSymbol(status: string) {
  switch (normalizeStatus(status)) {
    case "A":
      return "(A)";
    case "D":
      return "(D)";
    case "R":
      return "(R)";
    case "T":
      return "(T)";
    default:
      return "(U)";
  }
}

function statusIconClass(status: string) {
  switch (normalizeStatus(status)) {
    case "A":
      return "diff-icon-added";
    case "D":
      return "diff-icon-deleted";
    case "R":
      return "diff-icon-renamed";
    case "T":
      return "diff-icon-typechange";
    default:
      return "diff-icon-modified";
  }
}

function buildDiffTree<T extends { path: string }>(files: T[], scopeKey: string): DiffTreeFolderNode<T> {
  const root: DiffTreeFolderNode<T> = {
    key: `${scopeKey}:/`,
    name: "",
    folders: new Map(),
    files: [],
  };

  for (const file of files) {
    const parts = file.path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let node = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const segment = parts[index] ?? "";
      const nextKey = `${node.key}${segment}/`;
      let child = node.folders.get(segment);
      if (!child) {
        child = {
          key: nextKey,
          name: segment,
          folders: new Map(),
          files: [],
        };
        node.folders.set(segment, child);
      }
      node = child;
    }
    node.files.push(file);
  }

  return root;
}

function getTreeLineOpacity(depth: number) {
  return depth <= 1 ? "1" : "0.62";
}

function SectionIndicator({ section, count }: { section: WorktreeSectionKind; count: number }) {
  const Icon = section === "staged" ? CircleCheckBig : SquarePen;
  return (
    <span className={`diff-section-indicator is-${section}`}>
      <Icon size={12} aria-hidden />
      <strong>{count}</strong>
    </span>
  );
}

function WorktreeFileRow({
  file,
  section,
  active,
  treeItem = false,
  indentLevel = 0,
  treeDepth = 1,
  parentFolderKey,
  showDirectory = true,
  onOpen,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
}: {
  file: GitFileStatus;
  section: WorktreeSectionKind;
  active: boolean;
  treeItem?: boolean;
  indentLevel?: number;
  treeDepth?: number;
  parentFolderKey?: string;
  showDirectory?: boolean;
  onOpen: () => void;
  onStageFile?: (path: string) => Promise<void> | void;
  onUnstageFile?: (path: string) => Promise<void> | void;
  onDiscardFile?: (path: string) => Promise<void> | void;
}) {
  const segments = splitPath(file.path);
  const name = segments[segments.length - 1] ?? file.path;
  const dir = segments.length > 1 ? segments.slice(0, -1).join("/") : "";
  const { base, extension } = splitNameAndExtension(name);
  const status = normalizeStatus(file.status);
  const iconClass = statusIconClass(file.status);
  const showStage = section === "unstaged" && Boolean(onStageFile);
  const showUnstage = section === "staged" && Boolean(onUnstageFile);
  const showDiscard = section === "unstaged" && Boolean(onDiscardFile);
  const treeIndentPx = indentLevel * TREE_INDENT_STEP;
  const rowStyle = treeItem
    ? ({
        paddingLeft: `${treeIndentPx}px`,
        ["--git-tree-indent-x" as string]: `${Math.max(treeIndentPx - 5, 0)}px`,
        ["--git-tree-line-opacity" as string]: getTreeLineOpacity(indentLevel),
      } as CSSProperties)
    : undefined;

  return (
    <div
      className={`diff-row git-filetree-row${active ? " active" : ""}`}
      data-section={section}
      data-status={status}
      data-path={file.path}
      data-tree-depth={treeItem ? treeDepth : undefined}
      data-parent-folder-key={treeItem ? parentFolderKey : undefined}
      style={rowStyle}
      role={treeItem ? "treeitem" : "button"}
      tabIndex={0}
      aria-label={file.path}
      aria-selected={active}
      aria-level={treeItem ? treeDepth : undefined}
      onClick={onOpen}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span className={`diff-icon ${iconClass}`} aria-hidden>
        {statusSymbol(file.status)}
      </span>
      <span className="diff-file-icon" aria-hidden>
        <FileIcon filePath={file.path} className="h-4 w-4" />
      </span>
      <div className="diff-file">
        <div className="diff-path">
          <span className="diff-name">
            <span className="diff-name-base">{base}</span>
            {extension ? <span className="diff-name-ext">.{extension}</span> : null}
          </span>
        </div>
        {showDirectory && dir ? <div className="diff-dir">{dir}</div> : null}
      </div>
      <div className="diff-row-meta">
        <span className="diff-counts-inline git-filetree-badge" aria-label={`+${file.additions} -${file.deletions}`}>
          <span className="diff-add">+{file.additions}</span>
          <span className="diff-sep">/</span>
          <span className="diff-del">-{file.deletions}</span>
        </span>
        <div className="diff-row-actions" role="group" aria-label="File actions" onClick={(event) => event.stopPropagation()}>
          {showStage ? (
            <GitTooltipButton
              className="diff-row-action diff-row-action--stage"
              onClick={() => void onStageFile?.(file.path)}
              tooltip="Stage file"
            >
              <Plus size={12} aria-hidden />
            </GitTooltipButton>
          ) : null}
          {showUnstage ? (
            <GitTooltipButton
              className="diff-row-action diff-row-action--unstage"
              onClick={() => void onUnstageFile?.(file.path)}
              tooltip="Unstage file"
            >
              <Minus size={12} aria-hidden />
            </GitTooltipButton>
          ) : null}
          {showDiscard ? (
            <GitTooltipButton
              className="diff-row-action diff-row-action--discard"
              onClick={() => void onDiscardFile?.(file.path)}
              tooltip="Discard changes"
            >
              <Undo2 size={12} aria-hidden />
            </GitTooltipButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function WorktreeSection({
  title,
  section,
  files,
  activeFileKey,
  rootFolderName,
  compactHeader = false,
  leadingMeta,
  onOpenFile,
  onStageAll,
  onUnstageAll,
  onDiscardAll,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
}: {
  title: string;
  section: WorktreeSectionKind;
  files: GitFileStatus[];
  activeFileKey: string | null;
  rootFolderName?: string;
  compactHeader?: boolean;
  leadingMeta?: ReactNode;
  onOpenFile: (file: GitFileStatus) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onDiscardAll?: () => void;
  onStageFile?: (path: string) => Promise<void> | void;
  onUnstageFile?: (path: string) => Promise<void> | void;
  onDiscardFile?: (path: string) => Promise<void> | void;
}) {
  const showCompactRoot = compactHeader && Boolean(rootFolderName?.trim());

  return (
    <div className={`diff-section git-history-worktree-section git-filetree-section diff-section--${section}`}>
      <div className={`diff-section-title diff-section-title--row git-history-worktree-section-header${showCompactRoot ? " is-compact" : ""}`}>
        {showCompactRoot ? (
          <span className="diff-tree-summary-root is-static">
            <span className="diff-tree-summary-root-toggle" aria-hidden>
              <span className="diff-tree-folder-spacer" />
            </span>
            <FileIcon filePath={rootFolderName ?? ""} isFolder isOpen={false} className="diff-tree-summary-root-icon" />
            <span className="diff-tree-summary-root-name">{rootFolderName}</span>
          </span>
        ) : null}
        <span className="diff-tree-summary-section-label">
          <SectionIndicator section={section} count={files.length} />
        </span>
        {leadingMeta ? <span className="diff-tree-summary-meta">{leadingMeta}</span> : null}
        <div className="diff-section-actions git-history-worktree-section-actions" role="group" aria-label={`${title} actions`}>
          {section === "unstaged" ? (
            <>
              <GitTooltipButton
                className="diff-row-action diff-row-action--stage"
                onClick={onStageAll}
                tooltip="Stage all"
              >
                <Plus size={12} aria-hidden />
              </GitTooltipButton>
              <GitTooltipButton
                className="diff-row-action diff-row-action--discard"
                onClick={onDiscardAll}
                tooltip="Discard all"
              >
                <Undo2 size={12} aria-hidden />
              </GitTooltipButton>
            </>
          ) : (
            <GitTooltipButton
              className="diff-row-action diff-row-action--unstage"
              onClick={onUnstageAll}
              tooltip="Unstage all"
            >
              <Minus size={12} aria-hidden />
            </GitTooltipButton>
          )}
        </div>
      </div>
      <div className="diff-section-list git-history-worktree-section-list git-filetree-list">
        {files.map((file) => {
          const key = buildFileKey(file.path, file.previousPath);
          return (
            <WorktreeFileRow
              key={`${section}-${key}`}
              file={file}
              section={section}
              active={activeFileKey === key}
              onOpen={() => onOpenFile(file)}
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
              onDiscardFile={onDiscardFile}
            />
          );
        })}
      </div>
    </div>
  );
}

function WorktreeTreeSection({
  title,
  section,
  files,
  activeFileKey,
  rootFolderName,
  compactHeader = false,
  collapsedFolders,
  onToggleFolder,
  leadingMeta,
  onOpenFile,
  onStageAll,
  onUnstageAll,
  onDiscardAll,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
}: {
  title: string;
  section: WorktreeSectionKind;
  files: GitFileStatus[];
  activeFileKey: string | null;
  rootFolderName: string;
  compactHeader?: boolean;
  collapsedFolders: Set<string>;
  onToggleFolder: (folderKey: string) => void;
  leadingMeta?: ReactNode;
  onOpenFile: (file: GitFileStatus) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  onDiscardAll?: () => void;
  onStageFile?: (path: string) => Promise<void> | void;
  onUnstageFile?: (path: string) => Promise<void> | void;
  onDiscardFile?: (path: string) => Promise<void> | void;
}) {
  const tree = useMemo(() => buildDiffTree(files, section), [files, section]);
  const rootFolderKey = `${section}:__repo_root__/`;
  const rootCollapsed = collapsedFolders.has(rootFolderKey);
  const useCompactHeader = compactHeader && rootFolderName.trim().length > 0;

  function renderFolder(folder: DiffTreeFolderNode<GitFileStatus>, depth: number, parentKey?: string): ReactNode {
    const isCollapsed = collapsedFolders.has(folder.key);
    const hasChildren = folder.folders.size > 0 || folder.files.length > 0;
    const treeIndentPx = depth * TREE_INDENT_STEP;
    const folderStyle = {
      paddingLeft: `${treeIndentPx}px`,
      ["--git-tree-indent-x" as string]: `${Math.max(treeIndentPx - 5, 0)}px`,
      ["--git-tree-line-opacity" as string]: getTreeLineOpacity(depth),
    } as CSSProperties;
    const childStyle = {
      ["--git-tree-branch-x" as string]: `${Math.max((depth + 1) * TREE_INDENT_STEP - 5, 0)}px`,
      ["--git-tree-branch-opacity" as string]: getTreeLineOpacity(depth + 1),
    } as CSSProperties;

    return (
      <div key={folder.key} className="diff-tree-folder-group">
        <button
          type="button"
          className="diff-tree-folder-row git-filetree-folder-row"
          style={folderStyle}
          data-folder-key={folder.key}
          data-tree-depth={depth + 1}
          data-collapsed={hasChildren ? String(isCollapsed) : undefined}
          role="treeitem"
          aria-level={depth + 1}
          aria-label={folder.name}
          aria-expanded={hasChildren ? !isCollapsed : undefined}
          onClick={() => {
            if (hasChildren) onToggleFolder(folder.key);
          }}
        >
          <span className="diff-tree-folder-toggle" aria-hidden>
            {hasChildren ? (isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />) : <span className="diff-tree-folder-spacer" />}
          </span>
          <FileIcon filePath={folder.name} isFolder isOpen={!isCollapsed} className="diff-tree-folder-icon" />
          <span className="diff-tree-folder-name">{folder.name}</span>
        </button>
        {!isCollapsed ? (
          <div className="diff-tree-folder-children" style={childStyle}>
            {Array.from(folder.folders.values()).map((child) => renderFolder(child, depth + 1, folder.key))}
            {folder.files.map((file) => {
              const key = buildFileKey(file.path, file.previousPath);
              return (
                <WorktreeFileRow
                  key={`${section}-${key}`}
                  file={file}
                  section={section}
                  active={activeFileKey === key}
                  treeItem
                  indentLevel={depth + 1}
                  treeDepth={depth + 2}
                  parentFolderKey={parentKey ?? folder.key}
                  showDirectory={false}
                  onOpen={() => onOpenFile(file)}
                  onStageFile={onStageFile}
                  onUnstageFile={onUnstageFile}
                  onDiscardFile={onDiscardFile}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`diff-section git-history-worktree-section git-filetree-section diff-section--${section}`}>
      <div className={`diff-section-title diff-section-title--row git-history-worktree-section-header${useCompactHeader ? " is-compact" : ""}`}>
        {useCompactHeader ? (
          <button
            type="button"
            className="diff-tree-summary-root"
            aria-label={rootFolderName}
            aria-expanded={!rootCollapsed}
            onClick={() => onToggleFolder(rootFolderKey)}
          >
            <span className="diff-tree-summary-root-toggle" aria-hidden>
              {rootCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </span>
            <FileIcon filePath={rootFolderName} isFolder isOpen={!rootCollapsed} className="diff-tree-summary-root-icon" />
            <span className="diff-tree-summary-root-name">{rootFolderName}</span>
          </button>
        ) : null}
        <span className="diff-tree-summary-section-label">
          <SectionIndicator section={section} count={files.length} />
        </span>
        {leadingMeta ? <span className="diff-tree-summary-meta">{leadingMeta}</span> : null}
        <div className="diff-section-actions git-history-worktree-section-actions" role="group" aria-label={`${title} actions`}>
          {section === "unstaged" ? (
            <>
              <GitTooltipButton
                className="diff-row-action diff-row-action--stage"
                onClick={onStageAll}
                tooltip="Stage all"
              >
                <Plus size={12} aria-hidden />
              </GitTooltipButton>
              <GitTooltipButton
                className="diff-row-action diff-row-action--discard"
                onClick={onDiscardAll}
                tooltip="Discard all"
              >
                <Undo2 size={12} aria-hidden />
              </GitTooltipButton>
            </>
          ) : (
            <GitTooltipButton
              className="diff-row-action diff-row-action--unstage"
              onClick={onUnstageAll}
              tooltip="Unstage all"
            >
              <Minus size={12} aria-hidden />
            </GitTooltipButton>
          )}
        </div>
      </div>
      <div className={`diff-section-list diff-section-tree-list git-history-worktree-section-list git-filetree-list git-filetree-list--tree${useCompactHeader ? " is-compact-root" : ""}`}>
        {useCompactHeader ? (
          !rootCollapsed ? (
            <>
              {Array.from(tree.folders.values()).map((folder) => renderFolder(folder, 1, rootFolderKey))}
              {tree.files.map((file) => {
                const key = buildFileKey(file.path, file.previousPath);
                return (
                  <WorktreeFileRow
                    key={`${section}-${key}`}
                    file={file}
                    section={section}
                    active={activeFileKey === key}
                    treeItem
                    indentLevel={1}
                    treeDepth={2}
                    parentFolderKey={rootFolderKey}
                    showDirectory={false}
                    onOpen={() => onOpenFile(file)}
                    onStageFile={onStageFile}
                    onUnstageFile={onUnstageFile}
                    onDiscardFile={onDiscardFile}
                  />
                );
              })}
            </>
          ) : null
        ) : (
          <div className="diff-tree-folder-group">
            <button
              type="button"
              className="diff-tree-folder-row git-filetree-folder-row"
              style={{ paddingLeft: "0px" }}
              data-folder-key={rootFolderKey}
              data-tree-depth={1}
              data-collapsed={String(rootCollapsed)}
              role="treeitem"
              aria-level={1}
              aria-label={rootFolderName}
              aria-expanded={!rootCollapsed}
              onClick={() => onToggleFolder(rootFolderKey)}
            >
              <span className="diff-tree-folder-toggle" aria-hidden>
                {rootCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </span>
              <FileIcon filePath={rootFolderName} isFolder isOpen={!rootCollapsed} className="diff-tree-folder-icon" />
              <span className="diff-tree-folder-name">{rootFolderName}</span>
            </button>
            {!rootCollapsed ? (
              <div
                className="diff-tree-folder-children"
                style={
                  {
                    ["--git-tree-branch-x" as string]: `${Math.max(TREE_INDENT_STEP - 5, 0)}px`,
                    ["--git-tree-branch-opacity" as string]: getTreeLineOpacity(1),
                  } as CSSProperties
                }
              >
                {Array.from(tree.folders.values()).map((folder) => renderFolder(folder, 1, rootFolderKey))}
                {tree.files.map((file) => {
                  const key = buildFileKey(file.path, file.previousPath);
                  return (
                    <WorktreeFileRow
                      key={`${section}-${key}`}
                      file={file}
                      section={section}
                      active={activeFileKey === key}
                      treeItem
                      indentLevel={1}
                      treeDepth={2}
                      parentFolderKey={rootFolderKey}
                      showDirectory={false}
                      onOpen={() => onOpenFile(file)}
                      onStageFile={onStageFile}
                      onUnstageFile={onUnstageFile}
                      onDiscardFile={onDiscardFile}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function DiffModal({
  state,
  diffStyle,
  onDiffStyleChange,
  onClose,
}: {
  state: DiffModalState;
  diffStyle: GitDiffStyle;
  onDiffStyleChange: (style: GitDiffStyle) => void;
  onClose: () => void;
}) {
  const file = state.file;
  const diffText = state.diff?.diff ?? "";
  const binary = state.diff?.isBinary ?? false;
  const status = normalizeStatus(file.status);

  return (
    <div className="git-history-diff-modal-overlay" role="presentation" onClick={onClose}>
      <div className="git-history-diff-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="git-history-diff-modal-header">
          <div className="git-history-diff-modal-title">
            <span className={`git-history-file-status ${statusToneClass(file.status)}`}>{status}</span>
            <span className="git-history-tree-icon is-file" aria-hidden>
              <FileIcon filePath={file.path} className="h-4 w-4" />
            </span>
            <span className="git-history-diff-modal-path">{file.path}</span>
            <span className="git-history-diff-modal-stats">
              <span className="is-add">+{file.additions}</span>
              <span className="is-sep">/</span>
              <span className="is-del">-{file.deletions}</span>
            </span>
          </div>
          <div className="git-history-diff-modal-actions">
            {!binary && diffText.trim() ? (
              <div className="diff-viewer-header-controls is-external">
                <div className="diff-viewer-header-mode" role="group" aria-label="Diff style">
                  <button
                    type="button"
                    className={`diff-viewer-header-mode-icon-button ${diffStyle === "split" ? "active" : ""}`}
                    onClick={() => onDiffStyleChange("split")}
                    aria-label="Dual panel diff"
                    title="Dual panel diff"
                  >
                    <span className="diff-viewer-mode-glyph diff-viewer-mode-glyph-split" aria-hidden />
                    <span className="diff-viewer-mode-label">Dual panel</span>
                  </button>
                  <button
                    type="button"
                    className={`diff-viewer-header-mode-icon-button ${diffStyle === "unified" ? "active" : ""}`}
                    onClick={() => onDiffStyleChange("unified")}
                    aria-label="Single column diff"
                    title="Single column diff"
                  >
                    <span className="diff-viewer-mode-glyph diff-viewer-mode-glyph-unified" aria-hidden />
                    <span className="diff-viewer-mode-label">Single column</span>
                  </button>
                </div>
              </div>
            ) : null}
            <button type="button" className="git-history-diff-modal-close" onClick={onClose} aria-label="Close diff" title="Close diff">
              <X size={14} />
            </button>
          </div>
        </div>
        {state.loading ? <div className="git-history-empty">Loading diff...</div> : null}
        {state.error ? <div className="git-history-error">{state.error}</div> : null}
        {!state.loading && !state.error ? (
          binary || !diffText.trim() ? (
            <pre className="git-history-diff-modal-code">{diffText || "No diff available."}</pre>
          ) : (
            <div className="git-history-diff-modal-viewer">
              <GitDiffBlock diff={diffText} style={diffStyle} />
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

export function GitPanel({ workspace }: { workspace: WorkspaceRef | null }) {
  const applyGitPanel = useStore((state) => state.applyGitPanel);
  const refreshGitPanel = useStore((state) => state.refreshGitPanel);
  const setGitCommitMessage = useStore((state) => state.setGitCommitMessage);
  const stageGitFile = useStore((state) => state.stageGitFile);
  const unstageGitFile = useStore((state) => state.unstageGitFile);
  const discardGitFile = useStore((state) => state.discardGitFile);
  const commitGitChanges = useStore((state) => state.commitGitChanges);

  const workspaceId = workspace?.id ?? null;
  const projectRoot = workspace?.rootPath ?? null;
  const repositoryRootName = workspace ? splitPath(workspace.rootPath).at(-1) ?? workspace.name : "";
  const gitPanel = useStore((state) => (workspaceId ? state.gitPanelsByWorkspace[workspaceId] ?? null : null));
  const commitMessage = useStore((state) => (workspaceId ? state.gitCommitMessageByWorkspace[workspaceId] ?? "" : ""));
  const commitLoading = useStore((state) => (workspaceId ? Boolean(state.gitCommitLoadingByWorkspace[workspaceId]) : false));
  const commitError = useStore((state) => (workspaceId ? state.gitCommitErrorByWorkspace[workspaceId] ?? null : null));

  const [changeView, setChangeView] = useState<ChangeViewMode>("flat");
  const [selectedWorktreeFileKey, setSelectedWorktreeFileKey] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [diffModal, setDiffModal] = useState<DiffModalState | null>(null);
  const [diffViewStyle, setDiffViewStyle] = useState<GitDiffStyle>(() => {
    if (typeof window === "undefined") return "split";
    const stored = window.localStorage.getItem(DIFF_STYLE_STORAGE_KEY);
    return stored === "unified" ? "unified" : "split";
  });
  const [commitSectionCollapsed, setCommitSectionCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COMMIT_COLLAPSE_STORAGE_KEY) === "true";
  });
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [gitLog, setGitLog] = useState<GitLogResponse | null>(() => (workspace?.id ? gitLogCacheByWorkspace.get(workspace.id) ?? null : null));

  const stagedFiles = gitPanel?.stagedFiles ?? [];
  const unstagedFiles = gitPanel?.unstagedFiles ?? [];
  const hasAnyChanges = stagedFiles.length > 0 || unstagedFiles.length > 0;
  const hasDualWorktreeSections = stagedFiles.length > 0 && unstagedFiles.length > 0;
  const primarySection = stagedFiles.length > 0 ? "staged" : unstagedFiles.length > 0 ? "unstaged" : null;
  const commitsAhead = gitLog?.ahead ?? 0;
  const canCommit = commitMessage.trim().length > 0 && hasAnyChanges && !commitLoading;

  const applyGitOverview = useCallback((overview: GitOverviewResponse) => {
    if (!workspaceId) return;
    applyGitPanel(workspaceId, overview.panel);
    setGitLog(overview.log);
    gitLogCacheByWorkspace.set(workspaceId, overview.log);
    gitRefreshAtByWorkspace.set(workspaceId, Date.now());
  }, [applyGitPanel, workspaceId]);

  const loadGitLog = useCallback(async () => {
    if (!projectRoot) {
      setGitLog(null);
      return;
    }
    try {
      const response = await bridge.getGitLog(projectRoot, workspaceId);
      setGitLog(response);
      if (workspaceId) {
        gitLogCacheByWorkspace.set(workspaceId, response);
        gitRefreshAtByWorkspace.set(workspaceId, Date.now());
      }
    } catch {
      if (!workspaceId || !gitLogCacheByWorkspace.has(workspaceId)) {
        setGitLog(null);
      }
    }
  }, [projectRoot, workspaceId]);

  const refreshAll = useCallback(async (options?: { silent?: boolean }) => {
    if (!workspaceId) return;
    const silent = Boolean(options?.silent);
    if (!silent) {
      setRefreshLoading(true);
    }
    setPanelError(null);
    try {
      if (!projectRoot) {
        return;
      }
      const overview = await bridge.getGitOverview(projectRoot, workspaceId);
      applyGitOverview(overview);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!silent) {
        setRefreshLoading(false);
      }
    }
  }, [applyGitOverview, projectRoot, workspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DIFF_STYLE_STORAGE_KEY, diffViewStyle);
  }, [diffViewStyle]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COMMIT_COLLAPSE_STORAGE_KEY, String(commitSectionCollapsed));
  }, [commitSectionCollapsed]);

  useEffect(() => {
    if (!workspaceId) return;
    setSelectedWorktreeFileKey(null);
    setCollapsedFolders(new Set());
    setDiffModal(null);
    setPushError(null);
    setPanelError(null);
    const cachedGitLog = gitLogCacheByWorkspace.get(workspaceId) ?? null;
    setGitLog(cachedGitLog);
    const lastRefreshAt = gitRefreshAtByWorkspace.get(workspaceId) ?? 0;
    const hasCachedView = Boolean(gitPanel) || cachedGitLog !== null;
    const cacheFresh =
      workspace?.locationKind === "ssh" &&
      hasCachedView &&
      Date.now() - lastRefreshAt < REMOTE_GIT_CACHE_TTL_MS;
    if (cacheFresh) {
      return;
    }
    void refreshAll({ silent: hasCachedView });
  }, [refreshAll, workspace?.locationKind, workspaceId]);

  const openWorktreeDiff = useCallback(
    async (file: GitFileStatus) => {
      if (!projectRoot) return;
      setSelectedWorktreeFileKey(buildFileKey(file.path, file.previousPath));
      setDiffModal({ file, diff: null, loading: true, error: null });
      try {
        const diff = await bridge.getGitFileDiff(projectRoot, file.path, workspaceId);
        setDiffModal({ file, diff, loading: false, error: null });
      } catch (error) {
        setDiffModal({
          file,
          diff: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [projectRoot]
  );

  function toggleCollapsedFolder(folderKey: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderKey)) next.delete(folderKey);
      else next.add(folderKey);
      return next;
    });
  }

  const handleStageFile = useCallback(async (path: string) => {
    if (!workspaceId) return;
    setPanelError(null);
    setPushError(null);
    await stageGitFile(workspaceId, path);
    gitRefreshAtByWorkspace.set(workspaceId, Date.now());
  }, [stageGitFile, workspaceId]);

  const handleUnstageFile = useCallback(async (path: string) => {
    if (!workspaceId) return;
    setPanelError(null);
    setPushError(null);
    await unstageGitFile(workspaceId, path);
    gitRefreshAtByWorkspace.set(workspaceId, Date.now());
  }, [unstageGitFile, workspaceId]);

  const handleDiscardFile = useCallback(async (path: string) => {
    if (!workspaceId) return;
    setPanelError(null);
    setPushError(null);
    await discardGitFile(workspaceId, path);
    if (selectedWorktreeFileKey?.endsWith(`::${path}`)) {
      setSelectedWorktreeFileKey(null);
    }
    gitRefreshAtByWorkspace.set(workspaceId, Date.now());
  }, [discardGitFile, selectedWorktreeFileKey, workspaceId]);

  const stageAllChanges = useCallback(async () => {
    if (!workspaceId || !projectRoot) return;
    setPanelError(null);
    setPushError(null);
    try {
      for (const file of unstagedFiles) {
        await bridge.stageGitFile(projectRoot, file.path, workspaceId);
      }
      await refreshGitPanel(workspaceId);
      gitRefreshAtByWorkspace.set(workspaceId, Date.now());
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    }
  }, [projectRoot, refreshGitPanel, unstagedFiles, workspaceId]);

  const unstageAllChanges = useCallback(async () => {
    if (!workspaceId || !projectRoot) return;
    setPanelError(null);
    setPushError(null);
    try {
      for (const file of stagedFiles) {
        await bridge.unstageGitFile(projectRoot, file.path, workspaceId);
      }
      await refreshGitPanel(workspaceId);
      gitRefreshAtByWorkspace.set(workspaceId, Date.now());
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    }
  }, [projectRoot, refreshGitPanel, stagedFiles, workspaceId]);

  const discardAllChanges = useCallback(async () => {
    if (!workspaceId || !projectRoot) return;
    setPanelError(null);
    setPushError(null);
    try {
      for (const file of unstagedFiles) {
        await bridge.discardGitFile(projectRoot, file.path, workspaceId);
      }
      setSelectedWorktreeFileKey(null);
      await refreshGitPanel(workspaceId);
      gitRefreshAtByWorkspace.set(workspaceId, Date.now());
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    }
  }, [projectRoot, refreshGitPanel, unstagedFiles, workspaceId]);

  const handleCommit = useCallback(async () => {
    if (!workspaceId) return;
    setPanelError(null);
    setPushError(null);
    await commitGitChanges(workspaceId, { stageAll: stagedFiles.length === 0 && unstagedFiles.length > 0 });
    if (!useStore.getState().gitCommitErrorByWorkspace[workspaceId]) {
      setSelectedWorktreeFileKey(null);
      await loadGitLog();
    }
  }, [commitGitChanges, loadGitLog, stagedFiles.length, unstagedFiles.length, workspaceId]);

  const pushChanges = useCallback(async () => {
    if (!projectRoot) return;
    setPushLoading(true);
    setPushError(null);
    setPanelError(null);
    try {
      await bridge.pushGit(projectRoot, null, null, undefined, workspaceId);
      await refreshAll();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPushError(message);
      setPanelError(message);
    } finally {
      setPushLoading(false);
    }
  }, [projectRoot, refreshAll]);

  if (!workspaceId || !workspace) {
    return (
      <div className="workspace-git-panel-shell">
        <div className="git-history-changes diff-panel workspace-git-panel">
          <div className="git-history-empty">No active workspace.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-git-panel-shell">
      <section className="git-history-changes diff-panel workspace-git-panel">
        <div className="git-panel-header">
          <div className="git-panel-actions" role="group" aria-label="Git change panel">
            <div className="diff-list-view-toggle" role="group" aria-label="List view">
              <button
                type="button"
                className={`diff-list-view-button ${changeView === "flat" ? "active" : ""}`}
                onClick={() => setChangeView("flat")}
                aria-pressed={changeView === "flat"}
              >
                <LayoutGrid size={13} aria-hidden />
                <span>Flat</span>
              </button>
              <button
                type="button"
                className={`diff-list-view-button ${changeView === "tree" ? "active" : ""}`}
                onClick={() => setChangeView("tree")}
                aria-pressed={changeView === "tree"}
              >
                <FolderTree size={13} aria-hidden />
                <span>Tree</span>
              </button>
              {hasAnyChanges ? (
                <button
                  type="button"
                  className={`diff-list-view-collapse-toggle ${!commitSectionCollapsed ? "active" : ""}`}
                  onClick={() => setCommitSectionCollapsed((value) => !value)}
                  aria-expanded={!commitSectionCollapsed}
                  title={commitSectionCollapsed ? "Expand commit section" : "Collapse commit section"}
                >
                  {commitSectionCollapsed ? <ChevronsUpDown size={13} aria-hidden /> : <ChevronsDownUp size={13} aria-hidden />}
                  <span>Commit</span>
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="git-history-mini-chip"
              onClick={() => void refreshAll()}
              title="Refresh Git data"
              aria-label="Refresh Git data"
            >
              <RefreshCw size={12} className={refreshLoading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div className="diff-list">
          {panelError ? <div className="git-history-error">{panelError}</div> : null}
          {!gitPanel ? <div className="git-history-empty">Loading changes...</div> : null}
          {gitPanel && !gitPanel.isGitRepo ? <div className="git-history-empty">This workspace is not a Git repository.</div> : null}

          {gitPanel?.isGitRepo ? (
            <>
              {hasAnyChanges && !commitSectionCollapsed ? (
                <div className="commit-message-section">
                  <div className="commit-message-input-wrapper">
                    <textarea
                      className="commit-message-input"
                      placeholder="Commit message"
                      value={commitMessage}
                      onChange={(event) => {
                        if (workspaceId) {
                          setGitCommitMessage(workspaceId, event.target.value);
                        }
                      }}
                      rows={2}
                      disabled={commitLoading}
                    />
                  </div>
                  {commitError ? <div className="commit-message-error">{commitError}</div> : null}
                  <div className="commit-button-container">
                    <button
                      type="button"
                      className={`commit-button${commitLoading ? " is-loading" : ""}`}
                      onClick={() => void handleCommit()}
                      disabled={!canCommit}
                      aria-busy={commitLoading}
                    >
                      {commitLoading ? <span className="commit-button-spinner" aria-hidden /> : <Check size={14} aria-hidden />}
                      <span>{commitLoading ? "Committing..." : "Commit"}</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {commitsAhead > 0 && stagedFiles.length === 0 ? (
                <div className="push-section">
                  {pushError ? <div className="commit-message-error">{pushError}</div> : null}
                  <button
                    type="button"
                    className={`push-button${pushLoading ? " is-loading" : ""}`}
                    onClick={() => void pushChanges()}
                    disabled={pushLoading}
                    aria-busy={pushLoading}
                  >
                    {pushLoading ? <span className="commit-button-spinner" aria-hidden /> : <Upload size={14} aria-hidden />}
                    <span>Push</span>
                    <span className="push-count">{commitsAhead}</span>
                  </button>
                </div>
              ) : null}

              {!hasAnyChanges && commitsAhead === 0 ? <div className="git-history-empty">No changes detected.</div> : null}

              {hasAnyChanges ? (
                <div
                  className={[
                    "git-history-worktree-sections",
                    hasDualWorktreeSections ? "has-dual-sections" : "",
                    stagedFiles.length === 0 || unstagedFiles.length === 0 ? "is-single" : "",
                    changeView === "flat" ? "is-flat-view" : "is-tree-view",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {stagedFiles.length > 0
                    ? changeView === "tree"
                      ? (
                          <WorktreeTreeSection
                            title="Staged"
                            section="staged"
                            files={stagedFiles}
                            activeFileKey={selectedWorktreeFileKey}
                            rootFolderName={repositoryRootName}
                            compactHeader={false}
                            collapsedFolders={collapsedFolders}
                            onToggleFolder={toggleCollapsedFolder}
                            onOpenFile={openWorktreeDiff}
                            onUnstageAll={() => void unstageAllChanges()}
                            onUnstageFile={(path) => void handleUnstageFile(path)}
                          />
                        )
                      : (
                          <WorktreeSection
                            title="Staged"
                            section="staged"
                            files={stagedFiles}
                            activeFileKey={selectedWorktreeFileKey}
                            rootFolderName={repositoryRootName}
                            compactHeader={false}
                            onOpenFile={openWorktreeDiff}
                            onUnstageAll={() => void unstageAllChanges()}
                            onUnstageFile={(path) => void handleUnstageFile(path)}
                          />
                        )
                    : null}
                  {unstagedFiles.length > 0
                    ? changeView === "tree"
                      ? (
                          <WorktreeTreeSection
                            title="Unstaged"
                            section="unstaged"
                            files={unstagedFiles}
                            activeFileKey={selectedWorktreeFileKey}
                            rootFolderName={repositoryRootName}
                            compactHeader={Boolean(repositoryRootName)}
                            collapsedFolders={collapsedFolders}
                            onToggleFolder={toggleCollapsedFolder}
                            onOpenFile={openWorktreeDiff}
                            onStageAll={() => void stageAllChanges()}
                            onDiscardAll={() => void discardAllChanges()}
                            onStageFile={(path) => void handleStageFile(path)}
                            onDiscardFile={(path) => void handleDiscardFile(path)}
                          />
                        )
                      : (
                          <WorktreeSection
                            title="Unstaged"
                            section="unstaged"
                            files={unstagedFiles}
                            activeFileKey={selectedWorktreeFileKey}
                            rootFolderName={repositoryRootName}
                            compactHeader={primarySection === "unstaged"}
                            onOpenFile={openWorktreeDiff}
                            onStageAll={() => void stageAllChanges()}
                            onDiscardAll={() => void discardAllChanges()}
                            onStageFile={(path) => void handleStageFile(path)}
                            onDiscardFile={(path) => void handleDiscardFile(path)}
                          />
                        )
                    : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>

      {diffModal ? (
        <DiffModal state={diffModal} diffStyle={diffViewStyle} onDiffStyleChange={setDiffViewStyle} onClose={() => setDiffModal(null)} />
      ) : null}
    </div>
  );
}
