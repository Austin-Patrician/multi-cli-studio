import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  Cloud,
  Download,
  Folder,
  FolderOpen,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  HardDrive,
  LayoutGrid,
  Minus,
  SquarePen,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Trash2,
  Undo2,
  Upload,
  X,
  Pencil,
} from "lucide-react";
import { bridge } from "../../lib/bridge";
import { FileIcon } from "../FileIcon";
import { GitDiffBlock, type GitDiffStyle } from "./GitDiffBlock";
import type {
  GitBranchListItem,
  GitBranchListResponse,
  GitCommitDetails,
  GitCommitFileChange,
  GitFileDiff,
  GitFileStatus,
  GitHistoryResponse,
  GitPanelData,
  WorkspaceRef,
} from "../../lib/models";

type ChangeViewMode = "flat" | "tree";
type WorktreeSectionKind = "staged" | "unstaged";
type DiffFileLike = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

type DiffTreeFolderNode<T extends { path: string }> = {
  key: string;
  name: string;
  folders: Map<string, DiffTreeFolderNode<T>>;
  files: T[];
};

type BranchTreeNode = {
  key: string;
  label: string;
  children: BranchTreeNode[];
  branches: GitBranchListItem[];
};

type BranchTreeBuilderNode = {
  key: string;
  label: string;
  children: Map<string, BranchTreeBuilderNode>;
  branches: GitBranchListItem[];
};

type DiffModalState =
  | {
      source: "worktree";
      file: GitFileStatus;
      diff: GitFileDiff | null;
      loading: boolean;
      error: string | null;
    }
  | {
      source: "commit";
      file: GitCommitFileChange;
      diff: GitCommitFileChange;
      loading: false;
      error: null;
    };

type GitToolbarDialogKind = "pull" | "push" | "sync" | "fetch";
type GitToolbarConfirmFact = {
  label: string;
  value: string;
};
type RemoteBranchRef = {
  remote: string | null;
  branch: string | null;
};

const GIT_OVERVIEW_MIN_WIDTH = 170;
const GIT_BRANCHES_MIN_WIDTH = 220;
const GIT_COMMITS_MIN_WIDTH = 260;
const GIT_DETAILS_MIN_WIDTH = 260;
const GIT_COLUMN_MIN_WIDTHS = [GIT_OVERVIEW_MIN_WIDTH, GIT_BRANCHES_MIN_WIDTH, GIT_COMMITS_MIN_WIDTH] as const;
const GIT_RESIZER_TOTAL_WIDTH = 24;
const TREE_INDENT_STEP = 10;

function getDefaultColumnWidths(containerWidth: number) {
  const safeWidth = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 1600;
  const minimumColumnsWidth =
    GIT_OVERVIEW_MIN_WIDTH + GIT_BRANCHES_MIN_WIDTH + GIT_COMMITS_MIN_WIDTH + GIT_DETAILS_MIN_WIDTH;
  const availableColumnsWidth = Math.max(minimumColumnsWidth, safeWidth - GIT_RESIZER_TOTAL_WIDTH);

  let overviewWidth = Math.round((availableColumnsWidth * 3) / 10);
  let branchesWidth = Math.round((availableColumnsWidth * 2) / 10);
  let commitsWidth = Math.round((availableColumnsWidth * 3) / 10);
  let detailsWidth = availableColumnsWidth - overviewWidth - branchesWidth - commitsWidth;

  const minWidths = [...GIT_COLUMN_MIN_WIDTHS];
  const minimums = [...GIT_COLUMN_MIN_WIDTHS, GIT_DETAILS_MIN_WIDTH];
  const columns = [overviewWidth, branchesWidth, commitsWidth, detailsWidth];

  let deficit = 0;
  for (let index = 0; index < columns.length; index += 1) {
    if (columns[index] < minimums[index]) {
      deficit += minimums[index] - columns[index];
      columns[index] = minimums[index];
    }
  }

  if (deficit > 0) {
    const shrinkOrder = [2, 0, 1, 3];
    for (const index of shrinkOrder) {
      if (deficit <= 0) break;
      const minimum = minimums[index];
      const room = columns[index] - minimum;
      if (room <= 0) continue;
      const reduction = Math.min(room, deficit);
      columns[index] -= reduction;
      deficit -= reduction;
    }
  }

  return columns.slice(0, 3).map((value, index) => Math.max(minWidths[index], Math.round(value)));
}

function fitColumnWidthsToAvailable(widths: number[], availableWidth: number) {
  const targetColumnsWidth = Math.max(0, Math.floor(availableWidth - GIT_RESIZER_TOTAL_WIDTH - GIT_DETAILS_MIN_WIDTH));
  const minWidths = [...GIT_COLUMN_MIN_WIDTHS];
  const minTotal = minWidths.reduce((sum, value) => sum + value, 0);

  if (targetColumnsWidth <= minTotal) {
    return minWidths;
  }

  const clamped = widths.map((value, index) => Math.max(GIT_COLUMN_MIN_WIDTHS[index], Math.round(value)));
  const currentTotal = clamped.reduce((sum, value) => sum + value, 0);

  if (currentTotal <= targetColumnsWidth) {
    return clamped;
  }

  const next = [...clamped];
  let remainingReduction = currentTotal - targetColumnsWidth;

  while (remainingReduction > 0.5) {
    const shrinkable = next
      .map((value, index) => ({ index, room: value - GIT_COLUMN_MIN_WIDTHS[index] }))
      .filter((entry) => entry.room > 0);

    if (!shrinkable.length) {
      break;
    }

    const totalRoom = shrinkable.reduce((sum, entry) => sum + entry.room, 0);
    let reducedThisPass = 0;

    for (const entry of shrinkable) {
      const share = (remainingReduction * entry.room) / totalRoom;
      const reduction = Math.min(entry.room, share);
      next[entry.index] -= reduction;
      reducedThisPass += reduction;
    }

    if (reducedThisPass < 0.5) {
      break;
    }

    remainingReduction -= reducedThisPass;
  }

  const rounded = next.map((value, index) => Math.max(GIT_COLUMN_MIN_WIDTHS[index], Math.round(value)));
  let roundingDelta = targetColumnsWidth - rounded.reduce((sum, value) => sum + value, 0);

  if (roundingDelta > 0) {
    for (let index = rounded.length - 1; index >= 0 && roundingDelta > 0; index -= 1) {
      rounded[index] += 1;
      roundingDelta -= 1;
      if (index === 0 && roundingDelta > 0) {
        index = rounded.length;
      }
    }
  } else if (roundingDelta < 0) {
    let remaining = Math.abs(roundingDelta);
    while (remaining > 0) {
      let changed = false;
      for (let index = rounded.length - 1; index >= 0 && remaining > 0; index -= 1) {
        if (rounded[index] > GIT_COLUMN_MIN_WIDTHS[index]) {
          rounded[index] -= 1;
          remaining -= 1;
          changed = true;
        }
      }
      if (!changed) {
        break;
      }
    }
  }

  return rounded;
}

function summarizeWorktreeFiles(stagedFiles: GitFileStatus[], unstagedFiles: GitFileStatus[]) {
  const merged = new Map<string, { additions: number; deletions: number }>();
  for (const file of [...stagedFiles, ...unstagedFiles]) {
    const key = buildFileKey(file.path, file.previousPath);
    const current = merged.get(key) ?? { additions: 0, deletions: 0 };
    current.additions += file.additions;
    current.deletions += file.deletions;
    merged.set(key, current);
  }

  let additions = 0;
  let deletions = 0;
  for (const entry of merged.values()) {
    additions += entry.additions;
    deletions += entry.deletions;
  }

  return {
    changedFiles: merged.size,
    additions,
    deletions,
  };
}

function parseRemoteBranchRef(value?: string | null): RemoteBranchRef {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return { remote: null, branch: null };
  }
  const parts = trimmed.split("/");
  if (parts.length < 2) {
    return { remote: trimmed, branch: null };
  }
  return {
    remote: parts[0] ?? null,
    branch: parts.slice(1).join("/") || null,
  };
}

function buildRemoteBranchList(branches: GitBranchListItem[] | undefined, remote: string | null) {
  if (!remote || !branches?.length) {
    return [];
  }
  const values = new Set<string>();
  for (const branch of branches) {
    const branchRemote = branch.remote?.trim() || parseRemoteBranchRef(branch.name).remote;
    if (!branchRemote || branchRemote !== remote) {
      continue;
    }
    const normalized = branch.name.startsWith(`${remote}/`) ? branch.name.slice(remote.length + 1) : branch.name;
    if (normalized) {
      values.add(normalized);
    }
  }
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function formatRelativeTime(timestamp: number) {
  const delta = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < hour) return `${Math.max(1, Math.round(delta / minute))}m ago`;
  if (delta < day) return `${Math.max(1, Math.round(delta / hour))}h ago`;
  return `${Math.max(1, Math.round(delta / day))}d ago`;
}

function buildFileKey(path: string, oldPath?: string | null) {
  return `${oldPath ?? ""}::${path}`;
}

function splitPath(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

function createBranchTreeBuilderNode(key: string, label: string): BranchTreeBuilderNode {
  return {
    key,
    label,
    children: new Map(),
    branches: [],
  };
}

function compareBranchTreeNodes(left: BranchTreeNode, right: BranchTreeNode) {
  if (left.label === "根分组") return -1;
  if (right.label === "根分组") return 1;
  return left.label.localeCompare(right.label);
}

function finalizeBranchTreeNode(node: BranchTreeBuilderNode): BranchTreeNode {
  return {
    key: node.key,
    label: node.label,
    children: Array.from(node.children.values()).map(finalizeBranchTreeNode).sort(compareBranchTreeNodes),
    branches: node.branches.slice().sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function getBranchScope(name: string) {
  const parts = splitPath(name);
  if (parts.length <= 1) return "__root__";
  return parts[0] ?? "__root__";
}

function getBranchLeafName(name: string) {
  const parts = splitPath(name);
  return parts[parts.length - 1] ?? name;
}

function getLocalBranchExpansionKeys(name: string) {
  const parts = splitPath(name);
  if (parts.length <= 1) return ["local:__root__"];
  const keys: string[] = [];
  let currentPath = "";
  for (const segment of parts.slice(0, -1)) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    keys.push(`local:${currentPath}`);
  }
  return keys;
}

function getRemoteBranchExpansionKeys(branch: GitBranchListItem) {
  const parts = splitPath(branch.name);
  const remote = branch.remote?.trim() || parts[0] || "remote";
  const relativeParts = parts[0] === remote ? parts.slice(1) : parts;
  const keys: string[] = [];
  let currentPath = remote;
  keys.push(`remote:${currentPath}`);
  for (const segment of relativeParts.slice(0, -1)) {
    currentPath = `${currentPath}/${segment}`;
    keys.push(`remote:${currentPath}`);
  }
  return keys;
}

function buildLocalBranchTree(items: GitBranchListItem[]) {
  const root = createBranchTreeBuilderNode("local:root", "本地");
  for (const branch of items) {
    const parts = splitPath(branch.name);
    const branchScope = getBranchScope(branch.name);
    const groupSegments = branchScope === "__root__" ? ["__root__"] : parts.slice(0, -1);
    let current = root;
    let currentPath = "";
    for (const segment of groupSegments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const childKey = `local:${currentPath}`;
      let child = current.children.get(childKey);
      if (!child) {
        child = createBranchTreeBuilderNode(childKey, segment === "__root__" ? "根分组" : segment);
        current.children.set(childKey, child);
      }
      current = child;
    }
    current.branches.push(branch);
  }
  return Array.from(root.children.values()).map(finalizeBranchTreeNode).sort(compareBranchTreeNodes);
}

function buildRemoteBranchTree(items: GitBranchListItem[]) {
  const root = createBranchTreeBuilderNode("remote:root", "远程");
  for (const branch of items) {
    const parts = splitPath(branch.name);
    const remote = branch.remote?.trim() || parts[0] || "remote";
    const relativeParts = parts[0] === remote ? parts.slice(1) : parts;
    let current = root;
    let currentPath = remote;
    let remoteNode = current.children.get(`remote:${currentPath}`);
    if (!remoteNode) {
      remoteNode = createBranchTreeBuilderNode(`remote:${currentPath}`, remote);
      current.children.set(`remote:${currentPath}`, remoteNode);
    }
    current = remoteNode;
    for (const segment of relativeParts.slice(0, -1)) {
      currentPath = `${currentPath}/${segment}`;
      let child = current.children.get(`remote:${currentPath}`);
      if (!child) {
        child = createBranchTreeBuilderNode(`remote:${currentPath}`, segment);
        current.children.set(`remote:${currentPath}`, child);
      }
      current = child;
    }
    current.branches.push(branch);
  }
  return Array.from(root.children.values()).map(finalizeBranchTreeNode).sort(compareBranchTreeNodes);
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
  file: DiffFileLike;
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
            <button
              type="button"
              className="diff-row-action diff-row-action--stage"
              onClick={() => void onStageFile?.(file.path)}
              data-tooltip="Stage file"
              aria-label="Stage file"
            >
              <Plus size={12} aria-hidden />
            </button>
          ) : null}
          {showUnstage ? (
            <button
              type="button"
              className="diff-row-action diff-row-action--unstage"
              onClick={() => void onUnstageFile?.(file.path)}
              data-tooltip="Unstage file"
              aria-label="Unstage file"
            >
              <Minus size={12} aria-hidden />
            </button>
          ) : null}
          {showDiscard ? (
            <button
              type="button"
              className="diff-row-action diff-row-action--discard"
              onClick={() => void onDiscardFile?.(file.path)}
              data-tooltip="Discard changes"
              aria-label="Discard changes"
            >
              <Undo2 size={12} aria-hidden />
            </button>
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
              <button
                type="button"
                className="diff-row-action diff-row-action--stage"
                onClick={onStageAll}
                data-tooltip="Stage all"
                aria-label="Stage all"
              >
                <Plus size={12} aria-hidden />
              </button>
              <button
                type="button"
                className="diff-row-action diff-row-action--discard"
                onClick={onDiscardAll}
                data-tooltip="Discard all"
                aria-label="Discard all"
              >
                <Undo2 size={12} aria-hidden />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="diff-row-action diff-row-action--unstage"
              onClick={onUnstageAll}
              data-tooltip="Unstage all"
              aria-label="Unstage all"
            >
              <Minus size={12} aria-hidden />
            </button>
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
              <button
                type="button"
                className="diff-row-action diff-row-action--stage"
                onClick={onStageAll}
                data-tooltip="Stage all"
                aria-label="Stage all"
              >
                <Plus size={12} aria-hidden />
              </button>
              <button
                type="button"
                className="diff-row-action diff-row-action--discard"
                onClick={onDiscardAll}
                data-tooltip="Discard all"
                aria-label="Discard all"
              >
                <Undo2 size={12} aria-hidden />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="diff-row-action diff-row-action--unstage"
              onClick={onUnstageAll}
              data-tooltip="Unstage all"
              aria-label="Unstage all"
            >
              <Minus size={12} aria-hidden />
            </button>
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
  const diffText = state.source === "worktree" ? state.diff?.diff ?? "" : state.diff.diff;
  const binary = state.source === "worktree" ? state.diff?.isBinary : state.diff.isBinary;
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

function GitToolbarConfirmDialog({
  title,
  icon,
  heroSource,
  heroTarget,
  command,
  fields,
  fieldsSingle = false,
  preflight,
  facts,
  confirmLabel,
  loading,
  onClose,
  onConfirm,
}: {
  title: string;
  icon: ReactNode;
  heroSource: string;
  heroTarget: string;
  command: string;
  fields?: ReactNode;
  fieldsSingle?: boolean;
  preflight?: ReactNode;
  facts: GitToolbarConfirmFact[];
  confirmLabel: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="git-history-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) {
          onClose();
        }
      }}
    >
      <div
        className="git-history-toolbar-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="git-history-dialog-title git-history-toolbar-confirm-title">
          {icon}
          <span>{title}</span>
        </div>
        <div className="git-history-toolbar-confirm-hero">
          <div className="git-history-toolbar-confirm-hero-line">
            <span>{heroSource}</span>
            <span aria-hidden>{"->"}</span>
            <span>{heroTarget}</span>
          </div>
          <code>{command}</code>
        </div>
        {fields ? (
          <div className={`git-history-toolbar-confirm-grid ${fieldsSingle ? "is-single" : ""}`}>
            {fields}
          </div>
        ) : null}
        {preflight ? <div className="git-history-toolbar-confirm-preflight">{preflight}</div> : null}
        <dl className="git-history-toolbar-confirm-facts">
          {facts.map((fact) => (
            <div key={fact.label} className="git-history-toolbar-confirm-fact">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
        <div className="git-history-toolbar-confirm-command">
          <span>命令预览</span>
          <code>{command}</code>
        </div>
        <div className="git-history-toolbar-confirm-actions">
          <button type="button" className="dcc-action-button secondary" onClick={onClose} disabled={loading}>
            取消
          </button>
          <button type="button" className="dcc-action-button" onClick={onConfirm} disabled={loading}>
            {loading ? "执行中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DesktopGitSection({
  activeWorkspace,
  availableWorkspaces = [],
  onSelectWorkspace,
}: {
  activeWorkspace: WorkspaceRef | null;
  availableWorkspaces?: WorkspaceRef[];
  onSelectWorkspace?: (workspaceId: string) => void;
}) {
  const projectRoot = activeWorkspace?.rootPath ?? null;
  const repositoryRootName = activeWorkspace ? splitPath(activeWorkspace.rootPath).at(-1) ?? activeWorkspace.name : "";

  const [changeView, setChangeView] = useState<ChangeViewMode>("flat");
  const [branchQuery, setBranchQuery] = useState("");
  const [commitQuery, setCommitQuery] = useState("");
  const [gitPanel, setGitPanel] = useState<GitPanelData | null>(null);
  const [branches, setBranches] = useState<GitBranchListResponse | null>(null);
  const [history, setHistory] = useState<GitHistoryResponse | null>(null);
  const [details, setDetails] = useState<GitCommitDetails | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [localSectionExpanded, setLocalSectionExpanded] = useState(true);
  const [remoteSectionExpanded, setRemoteSectionExpanded] = useState(true);
  const [expandedLocalScopes, setExpandedLocalScopes] = useState<Set<string>>(new Set());
  const [expandedRemoteScopes, setExpandedRemoteScopes] = useState<Set<string>>(new Set());
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null);
  const [selectedWorktreeFileKey, setSelectedWorktreeFileKey] = useState<string | null>(null);
  const [selectedDetailFileKey, setSelectedDetailFileKey] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [detailsCollapsedFolders, setDetailsCollapsedFolders] = useState<Set<string>>(new Set());
  const [diffModal, setDiffModal] = useState<DiffModalState | null>(null);
  const [diffViewStyle, setDiffViewStyle] = useState<GitDiffStyle>(() => {
    if (typeof window === "undefined") return "split";
    const stored = window.localStorage.getItem("desktop_settings_git_diff_style");
    return stored === "unified" ? "unified" : "split";
  });
  const [commitSectionCollapsed, setCommitSectionCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("desktop_settings_git_commit_collapsed") === "true";
  });
  const [commitMessage, setCommitMessage] = useState("");
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pullLoading, setPullLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [activeToolbarDialog, setActiveToolbarDialog] = useState<GitToolbarDialogKind | null>(null);
  const [pullRemoteDraft, setPullRemoteDraft] = useState("origin");
  const [pullTargetBranchDraft, setPullTargetBranchDraft] = useState("");
  const [pushRemoteDraft, setPushRemoteDraft] = useState("origin");
  const [pushTargetBranchDraft, setPushTargetBranchDraft] = useState("");
  const [syncRemoteDraft, setSyncRemoteDraft] = useState("origin");
  const [syncTargetBranchDraft, setSyncTargetBranchDraft] = useState("");
  const [fetchRemoteDraft, setFetchRemoteDraft] = useState("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [branchNameDraft, setBranchNameDraft] = useState("");
  const [sourceRefDraft, setSourceRefDraft] = useState("");
  const [checkoutAfterCreate, setCheckoutAfterCreate] = useState(true);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const historyLimit = 40;
  const [columnWidths, setColumnWidths] = useState<number[]>(() => {
    if (typeof window === "undefined") return getDefaultColumnWidths(1600);
    const raw = window.localStorage.getItem("desktop_settings_git_column_widths");
    if (!raw) return getDefaultColumnWidths(window.innerWidth);
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && (parsed.length === 3 || parsed.length === 4)) {
        return parsed.slice(0, 3).map((value, index) => {
          const min = GIT_COLUMN_MIN_WIDTHS[index];
          return Number.isFinite(value) ? Math.max(min, Number(value)) : getDefaultColumnWidths(window.innerWidth)[index];
        });
      }
    } catch {}
    return getDefaultColumnWidths(window.innerWidth);
  });
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const stagedFiles = gitPanel?.stagedFiles ?? [];
  const unstagedFiles = gitPanel?.unstagedFiles ?? [];
  const hasAnyChanges = stagedFiles.length > 0 || unstagedFiles.length > 0;
  const hasDualWorktreeSections = stagedFiles.length > 0 && unstagedFiles.length > 0;
  const primarySection = stagedFiles.length > 0 ? "staged" : unstagedFiles.length > 0 ? "unstaged" : null;

  const selectedBranchItem = useMemo(() => {
    const local = branches?.localBranches ?? [];
    const remote = branches?.remoteBranches ?? [];
    return [...local, ...remote].find((branch) => branch.name === selectedBranch) ?? null;
  }, [branches, selectedBranch]);
  const currentBranchItem = useMemo(() => {
    const local = branches?.localBranches ?? [];
    const remote = branches?.remoteBranches ?? [];
    return [...local, ...remote].find((branch) => branch.name === branches?.currentBranch) ?? null;
  }, [branches]);

  const visibleLocalBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase();
    const items = branches?.localBranches ?? [];
    return query ? items.filter((branch) => branch.name.toLowerCase().includes(query)) : items;
  }, [branchQuery, branches?.localBranches]);

  const visibleRemoteBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase();
    const items = branches?.remoteBranches ?? [];
    return query ? items.filter((branch) => branch.name.toLowerCase().includes(query)) : items;
  }, [branchQuery, branches?.remoteBranches]);

  const groupedLocalBranches = useMemo(() => buildLocalBranchTree(visibleLocalBranches), [visibleLocalBranches]);

  const groupedRemoteBranches = useMemo(() => buildRemoteBranchTree(visibleRemoteBranches), [visibleRemoteBranches]);

  const visibleCommits = history?.commits ?? [];
  const currentBranch = branches?.currentBranch ?? null;
  const commitsAhead = currentBranchItem?.ahead ?? 0;
  const commitsBehind = currentBranchItem?.behind ?? 0;
  const worktreeSummary = useMemo(
    () => summarizeWorktreeFiles(stagedFiles, unstagedFiles),
    [stagedFiles, unstagedFiles]
  );
  const currentUpstreamRef = useMemo(() => parseRemoteBranchRef(currentBranchItem?.upstream ?? null), [currentBranchItem?.upstream]);
  const remoteOptions = useMemo(() => {
    const values = new Set<string>();
    for (const branch of branches?.remoteBranches ?? []) {
      const remote = branch.remote?.trim() || parseRemoteBranchRef(branch.name).remote;
      if (remote) {
        values.add(remote);
      }
    }
    for (const branch of branches?.localBranches ?? []) {
      const remote = parseRemoteBranchRef(branch.upstream ?? null).remote;
      if (remote) {
        values.add(remote);
      }
    }
    if (currentUpstreamRef.remote) {
      values.add(currentUpstreamRef.remote);
    }
    if (!values.size) {
      values.add("origin");
    }
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [branches?.localBranches, branches?.remoteBranches, currentUpstreamRef.remote]);
  const pullBranchOptions = useMemo(
    () => buildRemoteBranchList(branches?.remoteBranches, pullRemoteDraft || currentUpstreamRef.remote),
    [branches?.remoteBranches, pullRemoteDraft, currentUpstreamRef.remote]
  );
  const pushBranchOptions = useMemo(
    () => buildRemoteBranchList(branches?.remoteBranches, pushRemoteDraft || currentUpstreamRef.remote),
    [branches?.remoteBranches, pushRemoteDraft, currentUpstreamRef.remote]
  );
  const syncBranchOptions = useMemo(
    () => buildRemoteBranchList(branches?.remoteBranches, syncRemoteDraft || currentUpstreamRef.remote),
    [branches?.remoteBranches, syncRemoteDraft, currentUpstreamRef.remote]
  );
  const toolbarBranchLabel = currentBranch ?? gitPanel?.branch ?? activeWorkspace?.branch ?? activeWorkspace?.name ?? "HEAD";
  const toolbarCommitCount = history?.total ?? 0;
  const toolbarActionDisabled =
    !projectRoot ||
    !gitPanel?.isGitRepo ||
    operationBusy ||
    pushLoading ||
    pullLoading ||
    syncLoading ||
    fetchLoading ||
    refreshLoading;
  const normalizedPullRemote = pullRemoteDraft.trim() || currentUpstreamRef.remote || remoteOptions[0] || "origin";
  const normalizedPushRemote = pushRemoteDraft.trim() || currentUpstreamRef.remote || remoteOptions[0] || "origin";
  const normalizedSyncRemote = syncRemoteDraft.trim() || currentUpstreamRef.remote || remoteOptions[0] || "origin";
  const normalizedFetchRemote = fetchRemoteDraft.trim() || "all";
  const normalizedPullTargetBranch = pullTargetBranchDraft.trim() || currentUpstreamRef.branch || currentBranch || "main";
  const normalizedPushTargetBranch = pushTargetBranchDraft.trim() || currentUpstreamRef.branch || currentBranch || "main";
  const normalizedSyncTargetBranch = syncTargetBranchDraft.trim() || currentUpstreamRef.branch || currentBranch || "main";
  const pullCommandPreview = `git pull ${normalizedPullRemote} ${normalizedPullTargetBranch} --no-edit`;
  const pushCommandPreview = `git push ${normalizedPushRemote} HEAD:${normalizedPushTargetBranch}`;
  const syncCommandPreview = `${pullCommandPreview} && ${pushCommandPreview}`;
  const fetchCommandPreview =
    normalizedFetchRemote === "all" ? "git fetch --all --prune" : `git fetch ${normalizedFetchRemote} --prune`;
  const detailTree = useMemo(
    () => (details ? buildDiffTree(details.files, "commit-details") : null),
    [details]
  );
  const detailRootFolderKey = "commit-details:__repo_root__/";

  async function refreshChanges() {
    if (!projectRoot) return;
    setPanelLoading(true);
    setPanelError(null);
    try {
      setGitPanel(await bridge.getGitPanel(projectRoot));
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    } finally {
      setPanelLoading(false);
    }
  }

  async function refreshBranches() {
    if (!projectRoot) return;
    setBranchesLoading(true);
    setBranchesError(null);
    try {
      const next = await bridge.listGitBranches(projectRoot);
      setBranches(next);
      setSelectedBranch((current) => current ?? next.currentBranch ?? next.localBranches[0]?.name ?? null);
    } catch (error) {
      setBranchesError(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchesLoading(false);
    }
  }

  async function loadHistory(reset = true, offset = 0) {
    if (!projectRoot) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const next = await bridge.getGitCommitHistory(projectRoot, {
        branch: selectedBranch,
        query: commitQuery.trim() || null,
        offset,
        limit: historyLimit,
      });
      setHistory((current) => (reset || !current ? next : { ...next, commits: [...current.commits, ...next.commits] }));
      setHistoryOffset(offset);
      if (reset) {
        setSelectedCommitSha(next.commits[0]?.sha ?? null);
      }
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadCommitDetails(commitSha: string | null) {
    if (!projectRoot || !commitSha) {
      setDetails(null);
      return;
    }
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      setDetails(await bridge.getGitCommitDetails(projectRoot, commitSha));
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : String(error));
      setDetails(null);
    } finally {
      setDetailsLoading(false);
    }
  }

  async function refreshAll() {
    await Promise.all([refreshChanges(), refreshBranches()]);
  }

  async function refreshWorkbenchData() {
    await Promise.all([refreshChanges(), refreshBranches()]);
    await loadHistory(true, 0);
  }

  async function refreshWorkbenchFromToolbar() {
    if (!projectRoot) return;
    setRefreshLoading(true);
    setOperationError(null);
    try {
      await refreshWorkbenchData();
    } finally {
      setRefreshLoading(false);
    }
  }

  function resolveDefaultRemoteBranch() {
    return {
      remote: currentUpstreamRef.remote ?? remoteOptions[0] ?? "origin",
      branch: currentUpstreamRef.branch ?? currentBranch ?? "main",
    };
  }

  function openPullDialog() {
    const defaults = resolveDefaultRemoteBranch();
    setPullRemoteDraft(defaults.remote);
    setPullTargetBranchDraft(defaults.branch);
    setActiveToolbarDialog("pull");
  }

  function openPushDialog() {
    const defaults = resolveDefaultRemoteBranch();
    setPushRemoteDraft(defaults.remote);
    setPushTargetBranchDraft(defaults.branch);
    setActiveToolbarDialog("push");
  }

  function openSyncDialog() {
    const defaults = resolveDefaultRemoteBranch();
    setSyncRemoteDraft(defaults.remote);
    setSyncTargetBranchDraft(defaults.branch);
    setActiveToolbarDialog("sync");
  }

  function openFetchDialog() {
    setFetchRemoteDraft("all");
    setActiveToolbarDialog("fetch");
  }

  useEffect(() => {
    if (!projectRoot) return;
    void refreshAll();
    setCollapsedFolders(new Set());
    setDetailsCollapsedFolders(new Set());
    setLocalSectionExpanded(true);
    setRemoteSectionExpanded(true);
    setExpandedLocalScopes(new Set());
    setExpandedRemoteScopes(new Set());
    setSelectedWorktreeFileKey(null);
    setSelectedDetailFileKey(null);
    setCommitMessage("");
    setCommitError(null);
    setPushError(null);
    setActiveToolbarDialog(null);
  }, [projectRoot]);

  useEffect(() => {
    setExpandedLocalScopes((current) => {
      const next = new Set(current);
      let changed = false;

      for (const node of groupedLocalBranches) {
        if (!next.has(node.key)) {
          next.add(node.key);
          changed = true;
        }
      }

      if (selectedBranchItem && !selectedBranchItem.isRemote) {
        for (const key of getLocalBranchExpansionKeys(selectedBranchItem.name)) {
          if (!next.has(key)) {
            next.add(key);
            changed = true;
          }
        }
      }

      return changed ? next : current;
    });
  }, [groupedLocalBranches, selectedBranchItem]);

  useEffect(() => {
    setExpandedRemoteScopes((current) => {
      const next = new Set(current);
      let changed = false;

      for (const node of groupedRemoteBranches) {
        if (!next.has(node.key)) {
          next.add(node.key);
          changed = true;
        }
      }

      if (selectedBranchItem?.isRemote) {
        for (const key of getRemoteBranchExpansionKeys(selectedBranchItem)) {
          if (!next.has(key)) {
            next.add(key);
            changed = true;
          }
        }
      }

      return changed ? next : current;
    });
  }, [groupedRemoteBranches, selectedBranchItem]);

  useEffect(() => {
    if (!projectRoot) return;
    const id = window.setTimeout(() => {
      void loadHistory(true, 0);
    }, 180);
    return () => window.clearTimeout(id);
  }, [projectRoot, selectedBranch, commitQuery]);

  useEffect(() => {
    if (!projectRoot) return;
    void loadCommitDetails(selectedCommitSha);
  }, [projectRoot, selectedCommitSha]);

  useEffect(() => {
    setDetailsCollapsedFolders(new Set());
    setSelectedDetailFileKey(details?.files[0] ? buildFileKey(details.files[0].path, details.files[0].oldPath) : null);
  }, [details?.sha]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("desktop_settings_git_diff_style", diffViewStyle);
  }, [diffViewStyle]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("desktop_settings_git_commit_collapsed", String(commitSectionCollapsed));
  }, [commitSectionCollapsed]);

  async function openWorktreeDiff(file: GitFileStatus) {
    if (!projectRoot) return;
    setSelectedWorktreeFileKey(buildFileKey(file.path, file.previousPath));
    setDiffModal({ source: "worktree", file, diff: null, loading: true, error: null });
    try {
      const diff = await bridge.getGitFileDiff(projectRoot, file.path);
      setDiffModal({ source: "worktree", file, diff, loading: false, error: null });
    } catch (error) {
      setDiffModal({
        source: "worktree",
        file,
        diff: null,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function openCommitDiff(file: GitCommitFileChange) {
    setDiffModal({ source: "commit", file, diff: file, loading: false, error: null });
  }

  function toggleCollapsedFolder(folderKey: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderKey)) next.delete(folderKey);
      else next.add(folderKey);
      return next;
    });
  }

  function toggleDetailsCollapsedFolder(folderKey: string) {
    setDetailsCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderKey)) next.delete(folderKey);
      else next.add(folderKey);
      return next;
    });
  }

  function toggleLocalScope(scopeKey: string) {
    setExpandedLocalScopes((current) => {
      const next = new Set(current);
      if (next.has(scopeKey)) next.delete(scopeKey);
      else next.add(scopeKey);
      return next;
    });
  }

  function toggleRemoteScope(scopeKey: string) {
    setExpandedRemoteScopes((current) => {
      const next = new Set(current);
      if (next.has(scopeKey)) next.delete(scopeKey);
      else next.add(scopeKey);
      return next;
    });
  }

  function renderBranchTreeNodes(nodes: BranchTreeNode[], section: "local" | "remote", depth = 0): ReactNode {
    const expandedKeys = section === "local" ? expandedLocalScopes : expandedRemoteScopes;
    const toggleScope = section === "local" ? toggleLocalScope : toggleRemoteScope;

    return nodes.map((node) => {
      const expanded = expandedKeys.has(node.key);
      const hasChildren = node.children.length > 0 || node.branches.length > 0;
      const scopeStyle = {
        ["--git-branch-tree-depth" as string]: depth,
      } as CSSProperties;

      return (
        <div key={node.key} className="git-history-tree-scope-group">
          <button
            type="button"
            className="git-history-tree-scope-toggle"
            style={scopeStyle}
            onClick={() => {
              if (hasChildren) toggleScope(node.key);
            }}
            aria-expanded={hasChildren ? expanded : undefined}
            aria-label={`切换 ${node.label}`}
          >
            {hasChildren ? (
              expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
            ) : (
              <span className="git-history-tree-toggle-spacer" aria-hidden />
            )}
            {expanded ? <FolderOpen size={12} /> : <Folder size={12} />}
            <span className="git-history-tree-scope-label">{node.label}</span>
          </button>

          {expanded ? (
            <div className="git-history-tree-node-children">
              {node.branches.map((branch) => (
                <div
                  key={`${section}:${branch.name}`}
                  className={`git-history-branch-row${section === "remote" ? " git-history-branch-row-remote" : ""}`}
                  style={scopeStyle}
                >
                  <button
                    type="button"
                    className={`git-history-branch-item git-history-branch-item-tree${
                      section === "remote" ? " git-history-branch-item-remote-tree" : ""
                    } ${selectedBranch === branch.name ? "is-active" : ""}`}
                    onClick={() => setSelectedBranch(branch.name)}
                  >
                    <span className="git-history-tree-branch-main">
                      <GitBranch size={11} />
                      <span className="git-history-branch-name">{getBranchLeafName(branch.name)}</span>
                    </span>
                    <span className="git-history-branch-badges">
                      {branch.isCurrent ? <i className="is-special">当前</i> : null}
                      {branch.ahead > 0 ? <i>↑{branch.ahead}</i> : null}
                      {branch.behind > 0 ? <i>↓{branch.behind}</i> : null}
                    </span>
                  </button>
                </div>
              ))}

              {renderBranchTreeNodes(node.children, section, depth + 1)}
            </div>
          ) : null}
        </div>
      );
    });
  }

  function renderCommitDetailsFolder(
    folder: DiffTreeFolderNode<GitCommitFileChange>,
    depth: number,
    parentKey?: string
  ): ReactNode {
    const isCollapsed = detailsCollapsedFolders.has(folder.key);
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
            if (hasChildren) toggleDetailsCollapsedFolder(folder.key);
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
            {Array.from(folder.folders.values()).map((child) => renderCommitDetailsFolder(child, depth + 1, folder.key))}
            {folder.files.map((file) => {
              const fileKey = buildFileKey(file.path, file.oldPath);
              return (
                <WorktreeFileRow
                  key={`commit-details-${fileKey}`}
                  file={file}
                  section="unstaged"
                  active={selectedDetailFileKey === fileKey}
                  treeItem
                  indentLevel={depth + 1}
                  treeDepth={depth + 2}
                  parentFolderKey={parentKey ?? folder.key}
                  showDirectory={false}
                  onOpen={() => {
                    setSelectedDetailFileKey(fileKey);
                    openCommitDiff(file);
                  }}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  async function runBranchOperation(action: () => Promise<void>) {
    setOperationBusy(true);
    setOperationError(null);
    try {
      await action();
      setCreateDialogOpen(false);
      setRenameDialogOpen(false);
      setDeleteDialogOpen(false);
      setMergeDialogOpen(false);
      await refreshBranches();
      await refreshChanges();
      await loadHistory(true, 0);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setOperationBusy(false);
    }
  }

  async function stageFile(path: string) {
    if (!projectRoot) return;
    setCommitError(null);
    setPushError(null);
    setPanelError(null);
    try {
      await bridge.stageGitFile(projectRoot, path);
      await refreshChanges();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    }
  }

  async function unstageFile(path: string) {
    if (!projectRoot) return;
    setCommitError(null);
    setPushError(null);
    setPanelError(null);
    try {
      await bridge.unstageGitFile(projectRoot, path);
      await refreshChanges();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    }
  }

  async function discardFile(path: string) {
    if (!projectRoot) return;
    setCommitError(null);
    setPushError(null);
    setPanelError(null);
    try {
      await bridge.discardGitFile(projectRoot, path);
      if (selectedWorktreeFileKey?.endsWith(`::${path}`)) {
        setSelectedWorktreeFileKey(null);
      }
      await refreshChanges();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    }
  }

  async function stageAllChanges() {
    if (!projectRoot) return;
    setCommitError(null);
    setPushError(null);
    setPanelError(null);
    try {
      for (const file of unstagedFiles) {
        await bridge.stageGitFile(projectRoot, file.path);
      }
      await refreshChanges();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    }
  }

  async function unstageAllChanges() {
    if (!projectRoot) return;
    setCommitError(null);
    setPushError(null);
    setPanelError(null);
    try {
      for (const file of stagedFiles) {
        await bridge.unstageGitFile(projectRoot, file.path);
      }
      await refreshChanges();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    }
  }

  async function discardAllChanges() {
    if (!projectRoot) return;
    setCommitError(null);
    setPushError(null);
    setPanelError(null);
    try {
      for (const file of unstagedFiles) {
        await bridge.discardGitFile(projectRoot, file.path);
      }
      setSelectedWorktreeFileKey(null);
      await refreshChanges();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    }
  }

  async function commitChanges() {
    if (!projectRoot) return;
    const trimmed = commitMessage.trim();
    if (!trimmed) return;
    setCommitLoading(true);
    setCommitError(null);
    try {
      await bridge.commitGitChanges(projectRoot, trimmed, { stageAll: stagedFiles.length === 0 && unstagedFiles.length > 0 });
      setCommitMessage("");
      setSelectedWorktreeFileKey(null);
      await refreshWorkbenchData();
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitLoading(false);
    }
  }

  async function pushChanges(params?: { remote?: string | null; targetBranch?: string | null }) {
    if (!projectRoot) return;
    setPushLoading(true);
    setPushError(null);
    setOperationError(null);
    try {
      await bridge.pushGit(projectRoot, params?.remote ?? null, params?.targetBranch ?? null);
      await refreshWorkbenchData();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPushError(message);
      setOperationError(message);
      return false;
    } finally {
      setPushLoading(false);
    }
  }

  async function pullChanges(params?: { remote?: string | null; targetBranch?: string | null }) {
    if (!projectRoot) return;
    setPullLoading(true);
    setOperationError(null);
    setPushError(null);
    setCommitError(null);
    try {
      await bridge.pullGit(projectRoot, params?.remote ?? null, params?.targetBranch ?? null);
      await refreshWorkbenchData();
      return true;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setPullLoading(false);
    }
  }

  async function fetchChanges(params?: { remote?: string | null }) {
    if (!projectRoot) return;
    setFetchLoading(true);
    setOperationError(null);
    try {
      await bridge.fetchGit(projectRoot, params?.remote ?? null);
      await refreshWorkbenchData();
      return true;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setFetchLoading(false);
    }
  }

  async function syncChanges(params?: { remote?: string | null; targetBranch?: string | null }) {
    if (!projectRoot) return;
    setSyncLoading(true);
    setOperationError(null);
    setPushError(null);
    setCommitError(null);
    try {
      await bridge.syncGit(projectRoot, params?.remote ?? null, params?.targetBranch ?? null);
      await refreshWorkbenchData();
      return true;
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSyncLoading(false);
    }
  }

  async function confirmPullDialog() {
    const ok = await pullChanges({
      remote: normalizedPullRemote,
      targetBranch: normalizedPullTargetBranch,
    });
    if (ok) {
      setActiveToolbarDialog(null);
    }
  }

  async function confirmPushDialog() {
    const ok = await pushChanges({
      remote: normalizedPushRemote,
      targetBranch: normalizedPushTargetBranch,
    });
    if (ok) {
      setActiveToolbarDialog(null);
    }
  }

  async function confirmSyncDialog() {
    const ok = await syncChanges({
      remote: normalizedSyncRemote,
      targetBranch: normalizedSyncTargetBranch,
    });
    if (ok) {
      setActiveToolbarDialog(null);
    }
  }

  async function confirmFetchDialog() {
    const ok = await fetchChanges({
      remote: normalizedFetchRemote === "all" ? null : normalizedFetchRemote,
    });
    if (ok) {
      setActiveToolbarDialog(null);
    }
  }

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
      resizeCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const container = workbenchRef.current?.parentElement;
    if (!container) return;

    const syncColumnWidthsToContainer = () => {
      const computed = window.getComputedStyle(container);
      const horizontalPadding = Number.parseFloat(computed.paddingLeft || "0") + Number.parseFloat(computed.paddingRight || "0");
      const availableWidth = container.clientWidth - horizontalPadding;

      setColumnWidths((current) => {
        const fitted = fitColumnWidthsToAvailable(current, availableWidth);
        const unchanged = fitted.every((value, index) => value === current[index]);
        if (unchanged) {
          return current;
        }
        window.localStorage.setItem("desktop_settings_git_column_widths", JSON.stringify(fitted));
        return fitted;
      });
    };

    syncColumnWidthsToContainer();

    const observer = new ResizeObserver(() => {
      syncColumnWidthsToContainer();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [projectRoot]);

  function persistColumnWidths(next: number[]) {
    setColumnWidths(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("desktop_settings_git_column_widths", JSON.stringify(next));
    }
  }

  function handleColumnResizeStart(index: 0 | 1 | 2, event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanupRef.current?.();

    const startX = event.clientX;
    const startWidths = [...columnWidths];
    const host = workbenchRef.current;
    if (!host) return;
    const hostWidth = host.getBoundingClientRect().width;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const next = [...startWidths];

      if (index === 0) {
        const maxOverviewWidth =
          hostWidth - GIT_RESIZER_TOTAL_WIDTH - startWidths[1] - startWidths[2] - GIT_DETAILS_MIN_WIDTH;
        next[0] = Math.max(GIT_OVERVIEW_MIN_WIDTH, Math.min(Math.round(startWidths[0] + deltaX), Math.max(GIT_OVERVIEW_MIN_WIDTH, Math.round(maxOverviewWidth))));
      } else if (index === 1) {
        const pairWidth = startWidths[1] + startWidths[2];
        const nextBranchesWidth = Math.max(
          GIT_BRANCHES_MIN_WIDTH,
          Math.min(Math.round(startWidths[1] + deltaX), pairWidth - GIT_COMMITS_MIN_WIDTH)
        );
        next[1] = nextBranchesWidth;
        next[2] = pairWidth - nextBranchesWidth;
      } else {
        const maxCommitsWidth =
          hostWidth - GIT_RESIZER_TOTAL_WIDTH - startWidths[0] - startWidths[1] - GIT_DETAILS_MIN_WIDTH;
        next[2] = Math.max(
          GIT_COMMITS_MIN_WIDTH,
          Math.min(Math.round(startWidths[2] + deltaX), Math.max(GIT_COMMITS_MIN_WIDTH, Math.round(maxCommitsWidth)))
        );
      }

      persistColumnWidths(next);
    };

    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
      resizeCleanupRef.current = null;
    };

    resizeCleanupRef.current = finish;
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", finish);
  }

  const canCommit = commitMessage.trim().length > 0 && hasAnyChanges && !commitLoading;

  if (!activeWorkspace || !projectRoot) {
    return (
      <section className="settings-section">
        <div className="settings-section-title">Git</div>
        <div className="settings-section-subtitle">Select a workspace to open the Git workbench.</div>
      </section>
    );
  }

  return (
    <section className="settings-section git-history-shell">
      {/* <div className="settings-section-title">Git</div>
      <div className="settings-section-subtitle">
        Desktop-style Git workbench for changes, branches, commits, and commit details.
      </div> */}

      <div className="git-history-toolbar">
        <div className="git-history-toolbar-left">
          <h2>Git</h2>
          <div className="git-history-project-picker">
            <select
              className="dcc-native-select git-history-project-select"
              value={activeWorkspace.id}
              onChange={(event) => onSelectWorkspace?.(event.target.value)}
              aria-label="选择 Git 工作区"
              title={activeWorkspace.rootPath}
              disabled={!availableWorkspaces.length}
            >
              {(availableWorkspaces.length ? availableWorkspaces : [activeWorkspace]).map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="git-history-project-select-chevron" aria-hidden />
          </div>
          <div className="git-history-toolbar-meta">
            <span className="git-history-head-pill">HEAD</span>
            <code className="git-history-current-branch" title={toolbarBranchLabel}>
              {toolbarBranchLabel}
            </code>
            <span className={`git-history-toolbar-worktree ${worktreeSummary.changedFiles > 0 ? "is-dirty" : "is-clean"}`}>
              {worktreeSummary.changedFiles > 0 ? `${worktreeSummary.changedFiles}个文件已更改` : "工作区干净"}
            </span>
            {worktreeSummary.changedFiles > 0 ? (
              <span className="git-history-toolbar-lines">
                <span className="git-history-diff-add">+{worktreeSummary.additions}</span>
                <span className="git-history-diff-sep" aria-hidden>
                  /
                </span>
                <span className="git-history-diff-del">-{worktreeSummary.deletions}</span>
              </span>
            ) : null}
            <span className="git-history-toolbar-count">
              {historyLoading && !history ? "加载提交中..." : `${toolbarCommitCount} 个提交`}
            </span>
          </div>
        </div>
        <div className="git-history-toolbar-actions">
          <div className="git-history-toolbar-action-group">
            <button
              type="button"
              className="git-history-chip"
              onClick={openPullDialog}
              disabled={toolbarActionDisabled}
              aria-busy={pullLoading}
              title="拉取远端变更"
            >
              <Download size={13} className={pullLoading ? "animate-spin" : ""} />
              <span>拉取</span>
            </button>
            <button
              type="button"
              className="git-history-chip"
              onClick={openPushDialog}
              disabled={toolbarActionDisabled}
              aria-busy={pushLoading}
              title="推送本地提交"
            >
              <Upload size={13} className={pushLoading ? "animate-spin" : ""} />
              <span>推送</span>
            </button>
            <button
              type="button"
              className="git-history-chip"
              onClick={openSyncDialog}
              disabled={toolbarActionDisabled}
              aria-busy={syncLoading}
              title="同步当前分支"
            >
              <Repeat size={13} className={syncLoading ? "animate-spin" : ""} />
              <span>同步</span>
            </button>
            <button
              type="button"
              className="git-history-chip"
              onClick={openFetchDialog}
              disabled={toolbarActionDisabled}
              aria-busy={fetchLoading}
              title="获取远端更新"
            >
              <Cloud size={13} className={fetchLoading ? "animate-spin" : ""} />
              <span>获取</span>
            </button>
            <button
              type="button"
              className="git-history-chip"
              onClick={() => void refreshWorkbenchFromToolbar()}
              disabled={toolbarActionDisabled}
              aria-busy={refreshLoading}
              title="刷新 Git 面板"
            >
              <RefreshCw size={13} className={refreshLoading ? "animate-spin" : ""} />
              <span>刷新</span>
            </button>
          </div>
        </div>
      </div>

      {operationError ? <div className="git-history-error">{operationError}</div> : null}

      <div
        ref={workbenchRef}
        className="git-history-workbench"
        style={{
          gridTemplateColumns: `${columnWidths[0]}px 8px ${columnWidths[1]}px 8px ${columnWidths[2]}px 8px minmax(${GIT_DETAILS_MIN_WIDTH}px, 1fr)`,
          minWidth: `${columnWidths.reduce((sum, value) => sum + value, 0) + GIT_DETAILS_MIN_WIDTH + GIT_RESIZER_TOTAL_WIDTH}px`,
        }}
      >
        <section className="git-history-changes diff-panel">
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
                onClick={() => void refreshWorkbenchFromToolbar()}
                title="Refresh Git data"
                aria-label="Refresh Git data"
              >
                <RefreshCw size={12} className={refreshLoading || panelLoading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          <div className="diff-list">
            {panelError ? <div className="git-history-error">{panelError}</div> : null}
            {panelLoading ? <div className="git-history-empty">Loading changes...</div> : null}
            {!panelLoading && !panelError ? (
              <>
                {hasAnyChanges && !commitSectionCollapsed ? (
                  <div className="commit-message-section">
                    <div className="commit-message-input-wrapper">
                      <textarea
                        className="commit-message-input"
                        placeholder="Commit message"
                        value={commitMessage}
                        onChange={(event) => setCommitMessage(event.target.value)}
                        rows={2}
                        disabled={commitLoading}
                      />
                    </div>
                    {commitError ? <div className="commit-message-error">{commitError}</div> : null}
                    <div className="commit-button-container">
                      <button
                        type="button"
                        className={`commit-button${commitLoading ? " is-loading" : ""}`}
                        onClick={() => void commitChanges()}
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

                {(stagedFiles.length > 0 || unstagedFiles.length > 0) ? (
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
                              onUnstageFile={(path) => void unstageFile(path)}
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
                              onUnstageFile={(path) => void unstageFile(path)}
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
                              onStageFile={(path) => void stageFile(path)}
                              onDiscardFile={(path) => void discardFile(path)}
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
                              onStageFile={(path) => void stageFile(path)}
                              onDiscardFile={(path) => void discardFile(path)}
                            />
                          )
                      : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </section>

        <div
          className="git-history-vertical-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize changes and branches"
          onMouseDown={(event) => handleColumnResizeStart(0, event)}
        />

        <section className="git-history-branches">
          <div className="git-history-column-header git-history-column-header--branches">
            <span>
              <GitBranch size={14} /> 分支
            </span>
            <div className="git-history-branch-actions" role="group" aria-label="分支操作">
              <button
                type="button"
                className="git-history-icon-action"
                onClick={() => {
                  setBranchNameDraft("");
                  setSourceRefDraft(currentBranch ?? "HEAD");
                  setCheckoutAfterCreate(true);
                  setCreateDialogOpen(true);
                }}
                title="新建分支"
                aria-label="新建分支"
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                className="git-history-icon-action"
                disabled={!selectedBranchItem || selectedBranchItem.isRemote}
                onClick={() => {
                  setBranchNameDraft(selectedBranchItem?.name ?? "");
                  setRenameDialogOpen(true);
                }}
                title="重命名分支"
                aria-label="重命名分支"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                className="git-history-icon-action"
                disabled={!selectedBranchItem || selectedBranchItem.isRemote}
                onClick={() => setDeleteDialogOpen(true)}
                title="删除分支"
                aria-label="删除分支"
              >
                <Trash2 size={13} />
              </button>
              <button
                type="button"
                className="git-history-icon-action"
                disabled={!selectedBranchItem || selectedBranchItem.isRemote || selectedBranchItem.isCurrent}
                onClick={() => setMergeDialogOpen(true)}
                title="合并分支"
                aria-label="合并分支"
              >
                <GitMerge size={13} />
              </button>
            </div>
          </div>
          <label className="git-history-search git-history-search--branches">
            <Search size={13} />
            <input value={branchQuery} onChange={(event) => setBranchQuery(event.target.value)} placeholder="搜索分支" />
          </label>
          <div className="git-history-pane-body">
            {branchesError ? <div className="git-history-error">{branchesError}</div> : null}
            {branchesLoading ? <div className="git-history-empty">正在加载分支…</div> : null}
            {!branchesLoading ? (
              <div className="git-history-branch-list">
                <div className="git-history-branch-section-label">全部分支</div>
                <div className="git-history-tree-section">
                  <button
                    type="button"
                    className="git-history-tree-section-toggle"
                    onClick={() => setLocalSectionExpanded((current) => !current)}
                    aria-expanded={localSectionExpanded}
                    aria-label="切换本地分支"
                  >
                    {localSectionExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <HardDrive size={13} />
                    <span>本地</span>
                  </button>
                  {localSectionExpanded ? (
                    <div className="git-history-tree-section-body">
                      {groupedLocalBranches.length ? renderBranchTreeNodes(groupedLocalBranches, "local") : <div className="git-history-empty">未找到本地分支。</div>}
                    </div>
                  ) : null}
                </div>

                <div className="git-history-tree-section">
                  <button
                    type="button"
                    className="git-history-tree-section-toggle"
                    onClick={() => setRemoteSectionExpanded((current) => !current)}
                    aria-expanded={remoteSectionExpanded}
                    aria-label="切换远程分支"
                  >
                    {remoteSectionExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <Cloud size={13} />
                    <span>远程</span>
                  </button>
                  {remoteSectionExpanded ? (
                    <div className="git-history-tree-section-body">
                      {groupedRemoteBranches.length ? renderBranchTreeNodes(groupedRemoteBranches, "remote") : <div className="git-history-empty">未找到远程分支。</div>}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <div
          className="git-history-vertical-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize branches and commits"
          onMouseDown={(event) => handleColumnResizeStart(1, event)}
        />

        <section className="git-history-commits">
          <div className="git-history-column-header">
            <span>
              <GitCommitHorizontal size={14} /> Commits
            </span>
          </div>
          <label className="git-history-search">
            <Search size={14} />
            <input value={commitQuery} onChange={(event) => setCommitQuery(event.target.value)} placeholder="Search commits" />
          </label>
          <div className="git-history-pane-body">
            {historyError ? <div className="git-history-error">{historyError}</div> : null}
            {historyLoading && !visibleCommits.length ? <div className="git-history-empty">Loading commits…</div> : null}
            {!historyLoading && !visibleCommits.length ? <div className="git-history-empty">No commits found.</div> : null}
            <div className="git-history-commit-list">
              {visibleCommits.map((entry, index) => {
                const active = selectedCommitSha === entry.sha;
                const graphClassName = [
                  "git-history-graph",
                  index === 0 ? "is-first" : "",
                  index === visibleCommits.length - 1 ? "is-last" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <button
                    key={entry.sha}
                    type="button"
                    className={`git-history-commit-row ${active ? "is-active" : ""}`}
                    onClick={() => setSelectedCommitSha(entry.sha)}
                  >
                    <span className={graphClassName} aria-hidden>
                      <i className="git-history-graph-line" />
                      <i className="git-history-graph-dot" />
                    </span>
                    <span className="git-history-commit-content">
                      <span className="git-history-commit-summary" title={entry.summary || "(no message)"}>
                        {entry.summary || "(no message)"}
                      </span>
                      <span className="git-history-commit-meta">
                        <code>{entry.shortSha}</code>
                        <em>{entry.author || "unknown"}</em>
                        <time>{formatRelativeTime(entry.timestamp * 1000)}</time>
                      </span>
                      {entry.refs.length > 0 ? (
                        <span className="git-history-commit-refs" title={entry.refs.join(", ")}>
                          {entry.refs.slice(0, 3).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            {history?.hasMore ? (
              <div className="git-history-load-more">
                <button
                  type="button"
                  className="git-history-load-more-chip"
                  disabled={historyLoading}
                  onClick={() => void loadHistory(false, visibleCommits.length)}
                >
                  {historyLoading ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <div
          className="git-history-vertical-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize commits and details"
          onMouseDown={(event) => handleColumnResizeStart(2, event)}
        />

        <section className="git-history-details">
          <div className="git-history-column-header">
            <span>{details ? <FolderTree size={14} /> : <GitCommitHorizontal size={14} />}{details ? " Changed Files" : " Commit Details"}</span>
            {details ? (
              <span className="git-history-file-tree-head-summary">
                {details.files.length} files · +{details.totalAdditions} / -{details.totalDeletions}
              </span>
            ) : null}
          </div>
          <div className="git-history-pane-body">
            {detailsError ? <div className="git-history-error">{detailsError}</div> : null}
            {detailsLoading ? <div className="git-history-empty">Loading commit details…</div> : null}
            {!detailsLoading && !details ? <div className="git-history-empty">Select a commit to view details.</div> : null}
            {details ? (
                <div className="git-history-details-body">
                  <div className="git-history-file-list git-filetree-section" role="tree" aria-label="Changed files">
                    {!detailTree || (detailTree.folders.size === 0 && detailTree.files.length === 0) ? (
                      <div className="git-history-empty">No file changes in this commit.</div>
                    ) : (
                      <>
                        {Array.from(detailTree.folders.values()).map((folder) => renderCommitDetailsFolder(folder, 1, detailRootFolderKey))}
                        {detailTree.files.map((file) => {
                          const fileKey = buildFileKey(file.path, file.oldPath);
                          return (
                            <WorktreeFileRow
                              key={`commit-details-${fileKey}`}
                              file={file}
                              section="unstaged"
                              active={selectedDetailFileKey === fileKey}
                              treeItem
                              indentLevel={1}
                              treeDepth={2}
                              parentFolderKey={detailRootFolderKey}
                              showDirectory={false}
                              onOpen={() => {
                                setSelectedDetailFileKey(fileKey);
                                openCommitDiff(file);
                              }}
                            />
                          );
                        })}
                      </>
                    )}
                  </div>

                <div className="git-history-diff-view">
                  <div className="git-history-message-panel">
                    <div className="git-history-message-row">
                      <span className="git-history-message-label">Title</span>
                      <strong className="git-history-message-title">{details.summary || "(no message)"}</strong>
                    </div>
                    <div className="git-history-message-row">
                      <span className="git-history-message-label">Message</span>
                      <div className="git-history-message-content">{details.message || details.summary || "(empty)"}</div>
                    </div>
                    <div className="git-history-message-meta-row">
                      <span className="git-history-message-meta-item"><i>Author</i><span>{details.author || "unknown"}</span></span>
                      <span className="git-history-message-meta-item"><i>Time</i><time>{new Date(details.commitTime * 1000).toLocaleString()}</time></span>
                      <span className="git-history-message-meta-item"><i>Commit</i><code>{details.sha}</code></span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {diffModal ? (
        <DiffModal
          state={diffModal}
          diffStyle={diffViewStyle}
          onDiffStyleChange={setDiffViewStyle}
          onClose={() => setDiffModal(null)}
        />
      ) : null}

      {activeToolbarDialog === "pull" ? (
        <GitToolbarConfirmDialog
          title="拉取变更"
          icon={<Download size={14} />}
          heroSource={normalizedPullRemote}
          heroTarget={normalizedPullTargetBranch}
          command={pullCommandPreview}
          fields={
            <>
              <label className="git-history-toolbar-confirm-field">
                <span>远端</span>
                <select
                  value={normalizedPullRemote}
                  disabled={pullLoading}
                  onChange={(event) => {
                    const nextRemote = event.target.value;
                    const nextBranches = buildRemoteBranchList(branches?.remoteBranches, nextRemote);
                    setPullRemoteDraft(nextRemote);
                    setPullTargetBranchDraft((current) =>
                      current && nextBranches.includes(current) ? current : nextBranches[0] ?? currentBranch ?? "main"
                    );
                  }}
                >
                  {remoteOptions.map((remote) => (
                    <option key={`pull-remote-${remote}`} value={remote}>
                      {remote}
                    </option>
                  ))}
                </select>
              </label>
              <label className="git-history-toolbar-confirm-field">
                <span>目标远端分支</span>
                <input
                  list="git-pull-target-branches"
                  value={pullTargetBranchDraft}
                  disabled={pullLoading}
                  onChange={(event) => setPullTargetBranchDraft(event.target.value)}
                  placeholder={currentBranch ?? "main"}
                />
                <datalist id="git-pull-target-branches">
                  {pullBranchOptions.map((branch) => (
                    <option key={`pull-branch-${branch}`} value={branch} />
                  ))}
                </datalist>
              </label>
            </>
          }
          preflight={
            <>
              <div>当前分支：{toolbarBranchLabel}</div>
              <div>将把远端提交集成到当前分支。</div>
            </>
          }
          facts={[
            { label: "操作意图", value: "将远端提交集成到当前分支。" },
            { label: "将会发生", value: "会按所选远端、目标分支执行 pull。" },
            { label: "不会发生", value: "不会主动把本地提交推送到远端。" },
          ]}
          confirmLabel="拉取"
          loading={pullLoading}
          onClose={() => setActiveToolbarDialog(null)}
          onConfirm={() => {
            void confirmPullDialog();
          }}
        />
      ) : null}

      {activeToolbarDialog === "push" ? (
        <GitToolbarConfirmDialog
          title="推送变更"
          icon={<Upload size={14} />}
          heroSource={toolbarBranchLabel}
          heroTarget={`${normalizedPushRemote}:${normalizedPushTargetBranch}`}
          command={pushCommandPreview}
          fields={
            <>
              <label className="git-history-toolbar-confirm-field">
                <span>远端</span>
                <select
                  value={normalizedPushRemote}
                  disabled={pushLoading}
                  onChange={(event) => {
                    const nextRemote = event.target.value;
                    const nextBranches = buildRemoteBranchList(branches?.remoteBranches, nextRemote);
                    setPushRemoteDraft(nextRemote);
                    setPushTargetBranchDraft((current) =>
                      current && nextBranches.includes(current) ? current : nextBranches[0] ?? currentBranch ?? "main"
                    );
                  }}
                >
                  {remoteOptions.map((remote) => (
                    <option key={`push-remote-${remote}`} value={remote}>
                      {remote}
                    </option>
                  ))}
                </select>
              </label>
              <label className="git-history-toolbar-confirm-field">
                <span>目标远端分支</span>
                <input
                  list="git-push-target-branches"
                  value={pushTargetBranchDraft}
                  disabled={pushLoading}
                  onChange={(event) => setPushTargetBranchDraft(event.target.value)}
                  placeholder={currentBranch ?? "main"}
                />
                <datalist id="git-push-target-branches">
                  {pushBranchOptions.map((branch) => (
                    <option key={`push-branch-${branch}`} value={branch} />
                  ))}
                </datalist>
              </label>
            </>
          }
          preflight={
            <>
              <div>当前分支：{toolbarBranchLabel}</div>
              <div>待推送提交：{commitsAhead} 个</div>
            </>
          }
          facts={[
            { label: "操作意图", value: "将当前分支的本地提交发送到选定远端分支。" },
            { label: "将会发生", value: "会按所选远端、目标分支执行 push。" },
            { label: "不会发生", value: "不会自动拉取或合并远端变更。" },
          ]}
          confirmLabel="推送"
          loading={pushLoading}
          onClose={() => setActiveToolbarDialog(null)}
          onConfirm={() => {
            void confirmPushDialog();
          }}
        />
      ) : null}

      {activeToolbarDialog === "sync" ? (
        <GitToolbarConfirmDialog
          title="同步分支"
          icon={<Repeat size={14} />}
          heroSource={toolbarBranchLabel}
          heroTarget={`${normalizedSyncRemote}:${normalizedSyncTargetBranch}`}
          command={syncCommandPreview}
          fields={
            <>
              <label className="git-history-toolbar-confirm-field">
                <span>远端</span>
                <select
                  value={normalizedSyncRemote}
                  disabled={syncLoading}
                  onChange={(event) => {
                    const nextRemote = event.target.value;
                    const nextBranches = buildRemoteBranchList(branches?.remoteBranches, nextRemote);
                    setSyncRemoteDraft(nextRemote);
                    setSyncTargetBranchDraft((current) =>
                      current && nextBranches.includes(current) ? current : nextBranches[0] ?? currentBranch ?? "main"
                    );
                  }}
                >
                  {remoteOptions.map((remote) => (
                    <option key={`sync-remote-${remote}`} value={remote}>
                      {remote}
                    </option>
                  ))}
                </select>
              </label>
              <label className="git-history-toolbar-confirm-field">
                <span>目标远端分支</span>
                <input
                  list="git-sync-target-branches"
                  value={syncTargetBranchDraft}
                  disabled={syncLoading}
                  onChange={(event) => setSyncTargetBranchDraft(event.target.value)}
                  placeholder={currentBranch ?? "main"}
                />
                <datalist id="git-sync-target-branches">
                  {syncBranchOptions.map((branch) => (
                    <option key={`sync-branch-${branch}`} value={branch} />
                  ))}
                </datalist>
              </label>
            </>
          }
          preflight={
            <>
              <div>领先 {commitsAhead} / 落后 {commitsBehind}</div>
              <div>会先拉取远端，再推送本地提交。</div>
            </>
          }
          facts={[
            { label: "操作意图", value: "将当前分支与目标远端分支同步。" },
            { label: "将会发生", value: "会按所选远端、目标分支依次执行 pull 和 push。" },
            { label: "不会发生", value: "不会执行额外的分支切换或修改其它 Git 选项。" },
          ]}
          confirmLabel="同步"
          loading={syncLoading}
          onClose={() => setActiveToolbarDialog(null)}
          onConfirm={() => {
            void confirmSyncDialog();
          }}
        />
      ) : null}

      {activeToolbarDialog === "fetch" ? (
        <GitToolbarConfirmDialog
          title="获取远端更新"
          icon={<Cloud size={14} />}
          heroSource={normalizedFetchRemote === "all" ? "全部远端" : normalizedFetchRemote}
          heroTarget="远端 refs"
          command={fetchCommandPreview}
          fieldsSingle
          fields={
            <label className="git-history-toolbar-confirm-field">
              <span>远端</span>
              <select value={normalizedFetchRemote} disabled={fetchLoading} onChange={(event) => setFetchRemoteDraft(event.target.value)}>
                <option value="all">全部远端</option>
                {remoteOptions.map((remote) => (
                  <option key={`fetch-remote-${remote}`} value={remote}>
                    {remote}
                  </option>
                ))}
              </select>
            </label>
          }
          preflight={
            <>
              <div>当前分支：{toolbarBranchLabel}</div>
              <div>{normalizedFetchRemote === "all" ? "将更新全部远端引用信息。" : `将更新 ${normalizedFetchRemote} 的远端引用信息。`}</div>
            </>
          }
          facts={[
            { label: "操作意图", value: "更新远端引用信息用于比对。" },
            { label: "将会发生", value: "会从所选远端获取最新 refs，并刷新当前 Git 面板。" },
            { label: "不会发生", value: "不会把远端变更合并到当前分支。" },
          ]}
          confirmLabel="获取"
          loading={fetchLoading}
          onClose={() => setActiveToolbarDialog(null)}
          onConfirm={() => {
            void confirmFetchDialog();
          }}
        />
      ) : null}

      {createDialogOpen ? (
        <div className="git-history-dialog-backdrop" onClick={() => !operationBusy && setCreateDialogOpen(false)}>
          <div className="git-history-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="git-history-dialog-title">新建分支</div>
            <label className="git-history-field">
              <span>来源</span>
              <input value={sourceRefDraft} onChange={(event) => setSourceRefDraft(event.target.value)} disabled={operationBusy} />
            </label>
            <label className="git-history-field">
              <span>名称</span>
              <input value={branchNameDraft} onChange={(event) => setBranchNameDraft(event.target.value)} disabled={operationBusy} />
            </label>
            <label className="git-history-checkbox">
              <input type="checkbox" checked={checkoutAfterCreate} onChange={(event) => setCheckoutAfterCreate(event.target.checked)} disabled={operationBusy} />
              创建后切换到该分支
            </label>
            <div className="git-history-dialog-actions">
              <button type="button" className="dcc-action-button secondary" onClick={() => setCreateDialogOpen(false)} disabled={operationBusy}>取消</button>
              <button
                type="button"
                className="dcc-action-button"
                disabled={operationBusy || !branchNameDraft.trim()}
                onClick={() =>
                  void runBranchOperation(() =>
                    bridge.createGitBranch(projectRoot, branchNameDraft.trim(), sourceRefDraft.trim() || null, checkoutAfterCreate)
                  )
                }
              >
                {operationBusy ? "创建中…" : "创建"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {renameDialogOpen && selectedBranchItem ? (
        <div className="git-history-dialog-backdrop" onClick={() => !operationBusy && setRenameDialogOpen(false)}>
          <div className="git-history-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="git-history-dialog-title">重命名分支</div>
            <label className="git-history-field">
              <span>原分支</span>
              <input value={selectedBranchItem.name} disabled />
            </label>
            <label className="git-history-field">
              <span>新名称</span>
              <input value={branchNameDraft} onChange={(event) => setBranchNameDraft(event.target.value)} disabled={operationBusy} />
            </label>
            <div className="git-history-dialog-actions">
              <button type="button" className="dcc-action-button secondary" onClick={() => setRenameDialogOpen(false)} disabled={operationBusy}>取消</button>
              <button
                type="button"
                className="dcc-action-button"
                disabled={operationBusy || !branchNameDraft.trim()}
                onClick={() =>
                  void runBranchOperation(() =>
                    bridge.renameGitBranch(projectRoot, selectedBranchItem.name, branchNameDraft.trim())
                  )
                }
              >
                {operationBusy ? "重命名中…" : "重命名"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteDialogOpen && selectedBranchItem ? (
        <div className="git-history-dialog-backdrop" onClick={() => !operationBusy && setDeleteDialogOpen(false)}>
          <div className="git-history-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="git-history-dialog-title">删除分支</div>
            <div className="git-history-dialog-copy">
              确认删除分支 <strong>{selectedBranchItem.name}</strong>？
            </div>
            <div className="git-history-dialog-actions">
              <button type="button" className="dcc-action-button secondary" onClick={() => setDeleteDialogOpen(false)} disabled={operationBusy}>取消</button>
              <button
                type="button"
                className="dcc-action-button danger"
                disabled={operationBusy}
                onClick={() =>
                  void runBranchOperation(() =>
                    bridge.deleteGitBranch(projectRoot, selectedBranchItem.name, false)
                  )
                }
              >
                {operationBusy ? "删除中…" : "删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mergeDialogOpen && selectedBranchItem && currentBranch ? (
        <div className="git-history-dialog-backdrop" onClick={() => !operationBusy && setMergeDialogOpen(false)}>
          <div className="git-history-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="git-history-dialog-title">合并分支</div>
            <div className="git-history-dialog-copy">
              将 <strong>{selectedBranchItem.name}</strong> 合并到当前分支 <strong>{currentBranch}</strong>。
            </div>
            <div className="git-history-dialog-actions">
              <button type="button" className="dcc-action-button secondary" onClick={() => setMergeDialogOpen(false)} disabled={operationBusy}>取消</button>
              <button
                type="button"
                className="dcc-action-button"
                disabled={operationBusy}
                onClick={() =>
                  void runBranchOperation(() => bridge.mergeGitBranch(projectRoot, selectedBranchItem.name))
                }
              >
                {operationBusy ? "合并中…" : "合并"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
