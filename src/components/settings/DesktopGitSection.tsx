import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  Cloud,
  Download,
  FileText,
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
import { GitTooltipButton } from "../GitTooltipButton";
import { GitDiffBlock, type GitDiffStyle } from "./GitDiffBlock";
import type {
  GitBranchListItem,
  GitBranchListResponse,
  GitCommitDetails,
  GitCommitFileChange,
  GitFileDiff,
  GitFileStatus,
  GitHistoryCommit,
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
type PullDialogOption = "none" | "rebase" | "ff-only" | "no-ff" | "squash" | "no-commit" | "no-verify";
type RemoteBranchRef = {
  remote: string | null;
  branch: string | null;
};
type PopoverPlacement = "down" | "up";
type PushTargetBranchGroup = {
  scope: string;
  label: string;
  items: string[];
};
type PushPreviewTreeItem =
  | {
      id: string;
      type: "dir";
      label: string;
      path: string;
      depth: number;
      expanded: boolean;
    }
  | {
      id: string;
      type: "file";
      label: string;
      path: string;
      depth: number;
      change: GitCommitFileChange;
    };

const GIT_OVERVIEW_MIN_WIDTH = 170;
const GIT_BRANCHES_MIN_WIDTH = 220;
const GIT_COMMITS_MIN_WIDTH = 260;
const GIT_DETAILS_MIN_WIDTH = 260;
const GIT_COLUMN_MIN_WIDTHS = [GIT_OVERVIEW_MIN_WIDTH, GIT_BRANCHES_MIN_WIDTH, GIT_COMMITS_MIN_WIDTH] as const;
const GIT_RESIZER_TOTAL_WIDTH = 24;
const TREE_INDENT_STEP = 10;
const FILE_TREE_ROOT_PATH = "__repo_root__";
const PUSH_TARGET_MENU_VIEWPORT_PADDING = 16;
const PUSH_TARGET_MENU_MIN_HEIGHT = 148;
const PUSH_TARGET_MENU_MAX_HEIGHT = 320;
const PUSH_TARGET_MENU_ESTIMATED_ROW_HEIGHT = 31;
const REMOTE_GIT_BRANCH_CACHE_TTL_MS = 30_000;
const REMOTE_GIT_HISTORY_CACHE_TTL_MS = 20_000;
const remoteBranchCacheByWorkspace = new Map<
  string,
  {
    data: GitBranchListResponse;
    refreshedAt: number;
  }
>();
const remoteHistoryCacheByKey = new Map<
  string,
  {
    data: GitHistoryResponse;
    refreshedAt: number;
  }
>();
const remoteCommitDetailsCacheByKey = new Map<string, GitCommitDetails>();
const remoteCommitDetailsInflightByKey = new Map<string, Promise<GitCommitDetails>>();

function isGitCacheFresh(refreshedAt: number, ttlMs: number) {
  return Date.now() - refreshedAt < ttlMs;
}

function buildRemoteGitHistoryCacheKey(
  workspaceScopeKey: string,
  branch: string | null,
  query: string,
  limit: number,
  offset: number
) {
  return [workspaceScopeKey, branch ?? "", query.trim().toLowerCase(), String(limit), String(offset)].join("::");
}

function buildRemoteGitCommitDetailsCacheKey(
  workspaceScopeKey: string,
  commitSha: string,
  maxDiffLines: number
) {
  return [workspaceScopeKey, commitSha, String(maxDiffLines)].join("::");
}

function getCachedRemoteGitCommitDetails(
  workspaceScopeKey: string | null,
  commitSha: string,
  maxDiffLines: number | undefined,
  isRemoteWorkspace: boolean
) {
  if (!isRemoteWorkspace || !workspaceScopeKey) {
    return null;
  }
  return (
    remoteCommitDetailsCacheByKey.get(
      buildRemoteGitCommitDetailsCacheKey(workspaceScopeKey, commitSha, maxDiffLines ?? 10000)
    ) ?? null
  );
}

async function getGitCommitDetailsWithRemoteCache(
  projectRoot: string,
  commitSha: string,
  maxDiffLines: number | undefined,
  workspaceId: string | null,
  workspaceScopeKey: string | null,
  isRemoteWorkspace: boolean
) {
  const normalizedMaxDiffLines = maxDiffLines ?? 10000;
  if (!isRemoteWorkspace || !workspaceScopeKey) {
    return bridge.getGitCommitDetails(projectRoot, commitSha, normalizedMaxDiffLines, workspaceId);
  }

  const cacheKey = buildRemoteGitCommitDetailsCacheKey(workspaceScopeKey, commitSha, normalizedMaxDiffLines);
  const cached = remoteCommitDetailsCacheByKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  const inflight = remoteCommitDetailsInflightByKey.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const request = bridge
    .getGitCommitDetails(projectRoot, commitSha, normalizedMaxDiffLines, workspaceId)
    .then((details) => {
      remoteCommitDetailsCacheByKey.set(cacheKey, details);
      return details;
    })
    .finally(() => {
      remoteCommitDetailsInflightByKey.delete(cacheKey);
    });
  remoteCommitDetailsInflightByKey.set(cacheKey, request);
  return request;
}

const PULL_DIALOG_OPTIONS: Array<{
  id: PullDialogOption;
  label: string;
  flag: string | null;
  intent: string;
  willHappen: string;
  wontHappen: string;
}> = [
  {
    id: "none",
    label: "默认",
    flag: null,
    intent: "将远端提交按 Git 默认策略集成到当前分支。",
    willHappen: "会执行标准 pull，并由 Git 决定具体合并方式。",
    wontHappen: "不会强制使用 rebase、squash 或 fast-forward only。",
  },
  {
    id: "rebase",
    label: "--rebase",
    flag: "--rebase",
    intent: "将本地提交改写到远端提交之后，保持历史更线性。",
    willHappen: "会在 pull 时使用 rebase，把你的本地提交重新应用到最新远端之上。",
    wontHappen: "不会生成额外 merge commit。",
  },
  {
    id: "ff-only",
    label: "--ff-only",
    flag: "--ff-only",
    intent: "只允许快进更新，确保历史完全线性。",
    willHappen: "只有在当前分支可以 fast-forward 时才会成功 pull。",
    wontHappen: "不会发生 merge，也不会在需要 rebase 时自动处理。",
  },
  {
    id: "no-ff",
    label: "--no-ff",
    flag: "--no-ff",
    intent: "即使可以快进，也强制保留 merge commit。",
    willHappen: "会在 pull 合并后生成明确的 merge commit。",
    wontHappen: "不会把这次同步压平成 fast-forward 更新。",
  },
  {
    id: "squash",
    label: "--squash",
    flag: "--squash",
    intent: "把远端差异压成一组待提交改动，便于手动整理。",
    willHappen: "会拉取改动并以 squash 结果放入工作区，等待你后续提交。",
    wontHappen: "不会自动生成 merge commit。",
  },
  {
    id: "no-commit",
    label: "--no-commit",
    flag: "--no-commit",
    intent: "先完成合并但暂停在提交前，方便人工检查。",
    willHappen: "会把合并结果停留在待提交状态，让你确认后再 commit。",
    wontHappen: "不会自动创建合并提交。",
  },
  {
    id: "no-verify",
    label: "--no-verify",
    flag: "--no-verify",
    intent: "跳过本地 hook 检查，直接执行 pull。",
    willHappen: "会在 pull 时跳过 Git hooks 校验。",
    wontHappen: "不会运行本地 pre-merge / pre-commit 之类的 hook。",
  },
];

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

function splitCommaSeparated(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildGerritRefSpec(params: {
  targetBranch: string;
  topic?: string;
  reviewers?: string[];
  cc?: string[];
}) {
  const branch = params.targetBranch.trim() || "main";
  const parts: string[] = [];
  const topic = params.topic?.trim();
  if (topic) {
    parts.push(`topic=${topic}`);
  }
  for (const reviewer of params.reviewers ?? []) {
    parts.push(`r=${reviewer}`);
  }
  for (const item of params.cc ?? []) {
    parts.push(`cc=${item}`);
  }
  if (!parts.length) {
    return `HEAD:refs/for/${branch}`;
  }
  return `HEAD:refs/for/${branch}%${parts.join(",")}`;
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

function buildFileKey(
  pathOrFile:
    | string
    | {
        path: string;
        oldPath?: string | null;
        previousPath?: string | null;
      },
  oldPath?: string | null
) {
  if (typeof pathOrFile === "string") {
    return `${oldPath ?? ""}::${pathOrFile}`;
  }
  return `${pathOrFile.oldPath ?? pathOrFile.previousPath ?? ""}::${pathOrFile.path}`;
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

function collectDirPaths(files: GitCommitFileChange[]) {
  const paths = new Set<string>([FILE_TREE_ROOT_PATH]);
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index] ?? "";
      current = current ? `${current}/${part}` : part;
      paths.add(current);
    }
  }
  return paths;
}

function pickSelectedPushPreviewFileKey(previousKey: string | null, files: GitCommitFileChange[]) {
  if (!files.length) {
    return null;
  }
  if (previousKey && files.some((entry) => buildFileKey(entry) === previousKey)) {
    return previousKey;
  }
  return buildFileKey(files[0]);
}

function buildPushPreviewFileTreeItems(
  files: GitCommitFileChange[],
  expandedDirs: Set<string>,
  rootLabel?: string
): PushPreviewTreeItem[] {
  type FileTreeNode = {
    name: string;
    path: string;
    dirs: Map<string, FileTreeNode>;
    files: GitCommitFileChange[];
  };

  const root: FileTreeNode = {
    name: "",
    path: "",
    dirs: new Map(),
    files: [],
  };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (!parts.length) {
      root.files.push(file);
      continue;
    }

    let node = root;
    let currentPath = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index] ?? "";
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let child = node.dirs.get(part);
      if (!child) {
        child = {
          name: part,
          path: currentPath,
          dirs: new Map(),
          files: [],
        };
        node.dirs.set(part, child);
      }
      node = child;
    }
    node.files.push(file);
  }

  const items: PushPreviewTreeItem[] = [];

  const walk = (node: FileTreeNode, depth: number) => {
    const dirs = Array.from(node.dirs.values()).sort((left, right) => left.name.localeCompare(right.name));
    for (const dir of dirs) {
      const expanded = expandedDirs.has(dir.path);
      items.push({
        id: `dir:${dir.path}`,
        type: "dir",
        label: dir.name,
        path: dir.path,
        depth,
        expanded,
      });
      if (expanded) {
        walk(dir, depth + 1);
      }
    }

    const leafFiles = node.files.slice().sort((left, right) => left.path.localeCompare(right.path));
    for (const file of leafFiles) {
      const segments = file.path.split("/").filter(Boolean);
      items.push({
        id: `file:${buildFileKey(file)}`,
        type: "file",
        label: segments[segments.length - 1] ?? file.path,
        path: file.path,
        depth,
        change: file,
      });
    }
  };

  if (rootLabel?.trim()) {
    const rootExpanded = expandedDirs.has(FILE_TREE_ROOT_PATH);
    items.push({
      id: `dir:${FILE_TREE_ROOT_PATH}`,
      type: "dir",
      label: rootLabel,
      path: FILE_TREE_ROOT_PATH,
      depth: 0,
      expanded: rootExpanded,
    });
    if (rootExpanded) {
      walk(root, 1);
    }
    return items;
  }

  walk(root, 0);
  return items;
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
        <div className="git-history-toolbar-confirm-header">
          <div className="git-history-dialog-title git-history-toolbar-confirm-title">
            <span className="git-history-toolbar-confirm-icon">{icon}</span>
            <div className="git-history-toolbar-confirm-title-copy">
              <span>{title}</span>
              <small>确认本次 Git 操作的目标和影响后再执行。</small>
            </div>
          </div>
          <button
            type="button"
            className="git-history-toolbar-confirm-close"
            onClick={onClose}
            disabled={loading}
            aria-label="关闭"
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>

        {fields ? (
          <section className="git-history-toolbar-confirm-section">
            <div className="git-history-toolbar-confirm-section-title">参数设置</div>
            <div className={`git-history-toolbar-confirm-grid ${fieldsSingle ? "is-single" : ""}`}>
              {fields}
            </div>
          </section>
        ) : null}

        {preflight ? (
          <section className="git-history-toolbar-confirm-section">
            <div className="git-history-toolbar-confirm-section-title">执行前信息</div>
            <div className="git-history-toolbar-confirm-preflight">{preflight}</div>
          </section>
        ) : null}

        <section className="git-history-toolbar-confirm-section">
          <div className="git-history-toolbar-confirm-section-title">执行影响</div>
          <dl className="git-history-toolbar-confirm-facts">
            {facts.map((fact) => (
              <div key={fact.label} className="git-history-toolbar-confirm-fact">
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="git-history-toolbar-confirm-section">
          <div className="git-history-toolbar-confirm-section-title">命令预览</div>
          <div className="git-history-toolbar-confirm-command">
            <code>{command}</code>
          </div>
        </section>

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
  const workspaceId = activeWorkspace?.id ?? null;
  const workspaceScopeKey = projectRoot ? `${workspaceId ?? "local"}:${projectRoot}` : null;
  const isRemoteWorkspace = activeWorkspace?.locationKind === "ssh";
  const repositoryRootName = activeWorkspace ? splitPath(activeWorkspace.rootPath).at(-1) ?? activeWorkspace.name : "";

  const [changeView, setChangeView] = useState<ChangeViewMode>("flat");
  const [branchQuery, setBranchQuery] = useState("");
  const [commitQuery, setCommitQuery] = useState("");
  const [gitPanel, setGitPanel] = useState<GitPanelData | null>(null);
  const [branches, setBranches] = useState<GitBranchListResponse | null>(null);
  const [history, setHistory] = useState<GitHistoryResponse | null>(null);
  const [historyWorkspaceScopeKey, setHistoryWorkspaceScopeKey] = useState<string | null>(null);
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
  const [pullOptionDraft, setPullOptionDraft] = useState<PullDialogOption>("none");
  const [pushRemoteDraft, setPushRemoteDraft] = useState("origin");
  const [pushTargetBranchDraft, setPushTargetBranchDraft] = useState("");
  const [pushTags, setPushTags] = useState(false);
  const [pushRunHooks, setPushRunHooks] = useState(true);
  const [pushForceWithLease, setPushForceWithLease] = useState(false);
  const [pushToGerrit, setPushToGerrit] = useState(false);
  const [pushTopic, setPushTopic] = useState("");
  const [pushReviewers, setPushReviewers] = useState("");
  const [pushCc, setPushCc] = useState("");
  const [pushRemoteMenuOpen, setPushRemoteMenuOpen] = useState(false);
  const [pushRemoteMenuPlacement, setPushRemoteMenuPlacement] = useState<PopoverPlacement>("up");
  const [pushTargetBranchMenuOpen, setPushTargetBranchMenuOpen] = useState(false);
  const [pushTargetBranchMenuPlacement, setPushTargetBranchMenuPlacement] = useState<PopoverPlacement>("down");
  const [pushTargetBranchQuery, setPushTargetBranchQuery] = useState("");
  const [pushTargetBranchActiveScopeTab, setPushTargetBranchActiveScopeTab] = useState<string | null>(null);
  const [pushPreviewLoading, setPushPreviewLoading] = useState(false);
  const [pushPreviewError, setPushPreviewError] = useState<string | null>(null);
  const [pushPreviewHasMore, setPushPreviewHasMore] = useState(false);
  const [pushPreviewTargetFound, setPushPreviewTargetFound] = useState(true);
  const [pushPreviewCommits, setPushPreviewCommits] = useState<GitHistoryCommit[]>([]);
  const [pushPreviewDetails, setPushPreviewDetails] = useState<GitCommitDetails | null>(null);
  const [pushPreviewDetailsLoading, setPushPreviewDetailsLoading] = useState(false);
  const [pushPreviewDetailsError, setPushPreviewDetailsError] = useState<string | null>(null);
  const [pushPreviewExpandedDirs, setPushPreviewExpandedDirs] = useState<Set<string>>(new Set());
  const [pushPreviewSelectedFileKey, setPushPreviewSelectedFileKey] = useState<string | null>(null);
  const [pushPreviewSelectedSha, setPushPreviewSelectedSha] = useState<string | null>(null);
  const [syncRemoteDraft, setSyncRemoteDraft] = useState("origin");
  const [syncTargetBranchDraft, setSyncTargetBranchDraft] = useState("");
  const [syncPreviewLoading, setSyncPreviewLoading] = useState(false);
  const [syncPreviewError, setSyncPreviewError] = useState<string | null>(null);
  const [syncPreviewCommits, setSyncPreviewCommits] = useState<GitHistoryCommit[]>([]);
  const [syncPreviewTargetFound, setSyncPreviewTargetFound] = useState(true);
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
  const detailRequestSeqRef = useRef(0);
  const pushPreviewLoadSeqRef = useRef(0);
  const pushPreviewDetailsLoadSeqRef = useRef(0);
  const syncPreviewLoadSeqRef = useRef(0);
  const pushRemotePickerRef = useRef<HTMLDivElement | null>(null);
  const pushTargetBranchPickerRef = useRef<HTMLDivElement | null>(null);
  const pushTargetBranchFieldRef = useRef<HTMLLabelElement | null>(null);
  const pushTargetBranchMenuRef = useRef<HTMLDivElement | null>(null);

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
  const pushDialogOpen = activeToolbarDialog === "push";
  const syncDialogOpen = activeToolbarDialog === "sync";
  const fetchDialogOpen = activeToolbarDialog === "fetch";
  const pushSubmitting = pushLoading;
  const syncSubmitting = syncLoading;
  const fetchSubmitting = fetchLoading;
  const normalizedPullRemote = pullRemoteDraft.trim() || currentUpstreamRef.remote || remoteOptions[0] || "origin";
  const normalizedSyncRemote = syncRemoteDraft.trim() || currentUpstreamRef.remote || remoteOptions[0] || "origin";
  const normalizedPullTargetBranch = pullTargetBranchDraft.trim() || currentUpstreamRef.branch || currentBranch || "main";
  const normalizedSyncTargetBranch = syncTargetBranchDraft.trim() || currentUpstreamRef.branch || currentBranch || "main";
  const pushRemoteTrimmed = pushRemoteDraft.trim();
  const pushTargetBranchTrimmed = pushTargetBranchDraft.trim();
  const pushTargetBranchQueryTrimmed = pushTargetBranchQuery.trim();
  const pushTargetBranchOptions = useMemo(
    () => buildRemoteBranchList(branches?.remoteBranches, pushRemoteTrimmed || currentUpstreamRef.remote),
    [branches?.remoteBranches, currentUpstreamRef.remote, pushRemoteTrimmed]
  );
  const filteredPushTargetBranchOptions = useMemo(() => {
    const keyword = pushTargetBranchQueryTrimmed.toLowerCase();
    if (!keyword) {
      return pushTargetBranchOptions;
    }
    const matched = pushTargetBranchOptions.filter((branchName) => branchName.toLowerCase().includes(keyword));
    return matched.length > 0 ? matched : pushTargetBranchOptions;
  }, [pushTargetBranchOptions, pushTargetBranchQueryTrimmed]);
  const pushTargetBranchGroups = useMemo<PushTargetBranchGroup[]>(() => {
    const grouped = new Map<string, string[]>();
    for (const branchName of filteredPushTargetBranchOptions) {
      const scope = getBranchScope(branchName);
      const bucket = grouped.get(scope) ?? [];
      bucket.push(branchName);
      grouped.set(scope, bucket);
    }
    const scopes = Array.from(grouped.keys()).sort((left, right) => {
      if (left === "__root__") return -1;
      if (right === "__root__") return 1;
      return left.localeCompare(right);
    });
    return scopes.map((scope) => ({
      scope,
      label: scope === "__root__" ? "根分组" : scope,
      items: (grouped.get(scope) ?? []).sort((left, right) => left.localeCompare(right)),
    }));
  }, [filteredPushTargetBranchOptions]);
  const visiblePushTargetBranchGroups = useMemo(() => {
    if (pushTargetBranchGroups.length <= 1) {
      return pushTargetBranchGroups;
    }
    const activeScope = pushTargetBranchActiveScopeTab ?? pushTargetBranchGroups[0]?.scope ?? null;
    return pushTargetBranchGroups.filter((group) => group.scope === activeScope);
  }, [pushTargetBranchActiveScopeTab, pushTargetBranchGroups]);
  const pushTargetSummaryBranch = pushTargetBranchTrimmed || currentBranch || "main";
  const pushHasOutgoingCommits = pushPreviewCommits.length > 0;
  const pushIsNewBranchTarget = Boolean(
    activeToolbarDialog === "push" && !pushPreviewLoading && !pushPreviewError && !pushPreviewTargetFound
  );
  const pushPreviewSelectedCommit = useMemo(
    () => pushPreviewCommits.find((entry) => entry.sha === pushPreviewSelectedSha) ?? null,
    [pushPreviewCommits, pushPreviewSelectedSha]
  );
  const pushPreviewFileTreeItems = useMemo(
    () => (pushPreviewDetails ? buildPushPreviewFileTreeItems(pushPreviewDetails.files, pushPreviewExpandedDirs, repositoryRootName) : []),
    [pushPreviewDetails, pushPreviewExpandedDirs, repositoryRootName]
  );
  const pushReviewerList = useMemo(() => splitCommaSeparated(pushReviewers), [pushReviewers]);
  const pushCcList = useMemo(() => splitCommaSeparated(pushCc), [pushCc]);
  const pushRefSpec = pushToGerrit
    ? buildGerritRefSpec({
        targetBranch: pushTargetSummaryBranch,
        topic: pushTopic,
        reviewers: pushReviewerList,
        cc: pushCcList,
      })
    : `HEAD:${pushTargetSummaryBranch}`;
  const pushCanConfirm = Boolean(
    projectRoot &&
      !pushSubmitting &&
      pushRemoteTrimmed &&
      pushTargetBranchTrimmed &&
      !pushPreviewLoading &&
      !pushPreviewError &&
      pushHasOutgoingCommits
  );
  const selectedPullOption = PULL_DIALOG_OPTIONS.find((option) => option.id === pullOptionDraft) ?? PULL_DIALOG_OPTIONS[0];
  const pullCommandPreview = [
    "git pull",
    normalizedPullRemote,
    normalizedPullTargetBranch,
    selectedPullOption.flag,
    "--no-edit",
  ]
    .filter(Boolean)
    .join(" ");
  const syncPullCommandPreview = ["git pull", normalizedSyncRemote, normalizedSyncTargetBranch, "--no-edit"].filter(Boolean).join(" ");
  const syncPushCommandPreview = ["git push", normalizedSyncRemote, `HEAD:${normalizedSyncTargetBranch}`].filter(Boolean).join(" ");
  const syncCommandPreview = `${syncPullCommandPreview} && ${syncPushCommandPreview}`;
  const fetchCommandPreview = "git fetch --all";
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
      const overview = await bridge.getGitOverview(projectRoot, workspaceId);
      setGitPanel(overview.panel);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    } finally {
      setPanelLoading(false);
    }
  }

  async function refreshBranches(options?: { force?: boolean }) {
    if (!projectRoot || !workspaceId) return;
    const force = Boolean(options?.force);
    const cached = isRemoteWorkspace ? remoteBranchCacheByWorkspace.get(workspaceId) ?? null : null;
    if (cached && !force && isGitCacheFresh(cached.refreshedAt, REMOTE_GIT_BRANCH_CACHE_TTL_MS)) {
      setBranchesError(null);
      setBranchesLoading(false);
      setBranches(cached.data);
      setSelectedBranch(
        cached.data.currentBranch ?? cached.data.localBranches[0]?.name ?? cached.data.remoteBranches[0]?.name ?? null
      );
      return;
    }
    setBranchesLoading(true);
    setBranchesError(null);
    try {
      const next = await bridge.listGitBranches(projectRoot, workspaceId);
      if (isRemoteWorkspace) {
        remoteBranchCacheByWorkspace.set(workspaceId, {
          data: next,
          refreshedAt: Date.now(),
        });
      }
      setBranches(next);
      setSelectedBranch(next.currentBranch ?? next.localBranches[0]?.name ?? next.remoteBranches[0]?.name ?? null);
    } catch (error) {
      setBranchesError(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchesLoading(false);
    }
  }

  async function loadHistory(reset = true, offset = 0, options?: { force?: boolean }) {
    if (!projectRoot || !workspaceScopeKey) return;
    const force = Boolean(options?.force);
    const historyCacheKey = buildRemoteGitHistoryCacheKey(
      workspaceScopeKey,
      selectedBranch,
      commitQuery,
      historyLimit,
      offset
    );
    const cached = isRemoteWorkspace ? remoteHistoryCacheByKey.get(historyCacheKey) ?? null : null;
    if (cached && !force && isGitCacheFresh(cached.refreshedAt, REMOTE_GIT_HISTORY_CACHE_TTL_MS)) {
      setHistoryError(null);
      setHistoryLoading(false);
      setHistory((current) =>
        reset || !current ? cached.data : { ...cached.data, commits: [...current.commits, ...cached.data.commits] }
      );
      setHistoryWorkspaceScopeKey(workspaceScopeKey);
      setHistoryOffset(offset);
      if (reset) {
        setSelectedCommitSha(cached.data.commits[0]?.sha ?? null);
      }
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const next = await bridge.getGitCommitHistory(
        projectRoot,
        {
          branch: selectedBranch,
          query: commitQuery.trim() || null,
          offset,
          limit: historyLimit,
        },
        workspaceId
      );
      if (isRemoteWorkspace) {
        remoteHistoryCacheByKey.set(historyCacheKey, {
          data: next,
          refreshedAt: Date.now(),
        });
      }
      setHistory((current) => (reset || !current ? next : { ...next, commits: [...current.commits, ...next.commits] }));
      setHistoryWorkspaceScopeKey(workspaceScopeKey);
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
    const requestSeq = ++detailRequestSeqRef.current;
    const cached = getCachedRemoteGitCommitDetails(workspaceScopeKey, commitSha, undefined, isRemoteWorkspace);
    if (cached) {
      setDetails(cached);
      setDetailsError(null);
      setDetailsLoading(false);
      return;
    }
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const next = await getGitCommitDetailsWithRemoteCache(
        projectRoot,
        commitSha,
        undefined,
        workspaceId,
        workspaceScopeKey,
        isRemoteWorkspace
      );
      if (detailRequestSeqRef.current !== requestSeq) {
        return;
      }
      setDetails(next);
    } catch (error) {
      if (detailRequestSeqRef.current !== requestSeq) {
        return;
      }
      setDetailsError(error instanceof Error ? error.message : String(error));
      setDetails(null);
    } finally {
      if (detailRequestSeqRef.current === requestSeq) {
        setDetailsLoading(false);
      }
    }
  }

  async function loadPushPreview(remoteName: string, targetBranchName: string) {
    if (!projectRoot) {
      return;
    }
    const requestSeq = ++pushPreviewLoadSeqRef.current;
    setPushPreviewLoading(true);
    setPushPreviewError(null);
    try {
      const response = await bridge.getGitPushPreview(
        projectRoot,
        {
          remote: remoteName,
          branch: targetBranchName,
          limit: 120,
        },
        workspaceId
      );
      if (pushPreviewLoadSeqRef.current !== requestSeq) {
        return;
      }
      setPushPreviewTargetFound(response.targetFound);
      setPushPreviewHasMore(response.hasMore);
      setPushPreviewCommits(response.commits);
      setPushPreviewSelectedSha((current) => {
        if (!response.targetFound) {
          return null;
        }
        if (current && response.commits.some((entry) => entry.sha === current)) {
          return current;
        }
        return response.commits[0]?.sha ?? null;
      });
      if (!response.targetFound || !response.commits.length) {
        pushPreviewDetailsLoadSeqRef.current += 1;
        setPushPreviewDetails(null);
        setPushPreviewDetailsError(null);
        setPushPreviewDetailsLoading(false);
      }
    } catch (error) {
      if (pushPreviewLoadSeqRef.current !== requestSeq) {
        return;
      }
      pushPreviewDetailsLoadSeqRef.current += 1;
      setPushPreviewTargetFound(true);
      setPushPreviewHasMore(false);
      setPushPreviewCommits([]);
      setPushPreviewSelectedSha(null);
      setPushPreviewDetails(null);
      setPushPreviewDetailsLoading(false);
      setPushPreviewDetailsError(null);
      setPushPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      if (pushPreviewLoadSeqRef.current === requestSeq) {
        setPushPreviewLoading(false);
      }
    }
  }

  async function refreshAll(options?: { force?: boolean }) {
    await Promise.all([refreshChanges(), refreshBranches(options)]);
  }

  async function refreshWorkbenchData(options?: { force?: boolean }) {
    await Promise.all([refreshChanges(), refreshBranches(options)]);
    await loadHistory(true, 0, options);
  }

  async function refreshWorkbenchFromToolbar() {
    if (!projectRoot) return;
    setRefreshLoading(true);
    setOperationError(null);
    try {
      await refreshWorkbenchData({ force: true });
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
    setPullOptionDraft("none");
    setActiveToolbarDialog("pull");
  }

  function openPushDialog() {
    const defaultRemote = remoteOptions.includes("origin") ? "origin" : remoteOptions[0] ?? resolveDefaultRemoteBranch().remote;
    const defaultTargetOptions = buildRemoteBranchList(branches?.remoteBranches, defaultRemote);
    const defaultTargetBranch =
      (currentBranch && defaultTargetOptions.includes(currentBranch) ? currentBranch : null) ??
      currentUpstreamRef.branch ??
      defaultTargetOptions[0] ??
      currentBranch ??
      "";
    setPushRemoteDraft(defaultRemote);
    setPushTargetBranchDraft(defaultTargetBranch);
    setPushTags(false);
    setPushRunHooks(true);
    setPushForceWithLease(false);
    setPushToGerrit(false);
    setPushTopic("");
    setPushReviewers("");
    setPushCc("");
    setPushError(null);
    setPushRemoteMenuOpen(false);
    setPushRemoteMenuPlacement("up");
    setPushTargetBranchMenuOpen(false);
    setPushTargetBranchMenuPlacement("down");
    setPushTargetBranchQuery("");
    setPushTargetBranchActiveScopeTab(null);
    setPushPreviewLoading(false);
    setPushPreviewError(null);
    setPushPreviewHasMore(false);
    setPushPreviewTargetFound(true);
    setPushPreviewCommits([]);
    setPushPreviewDetails(null);
    setPushPreviewDetailsLoading(false);
    setPushPreviewDetailsError(null);
    setPushPreviewExpandedDirs(new Set());
    setPushPreviewSelectedFileKey(null);
    setPushPreviewSelectedSha(null);
    setActiveToolbarDialog("push");
  }

  function updatePushRemoteMenuPlacement() {
    setPushRemoteMenuPlacement("up");
  }

  function updatePushTargetBranchMenuPlacement() {
    if (typeof window === "undefined") {
      setPushTargetBranchMenuPlacement("down");
      return;
    }
    const anchorElement = pushTargetBranchPickerRef.current;
    if (!anchorElement) {
      setPushTargetBranchMenuPlacement("down");
      return;
    }
    const anchorRect = anchorElement.getBoundingClientRect();
    const spaceAbove = anchorRect.top - PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const spaceBelow = window.innerHeight - anchorRect.bottom - PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const estimatedRowCount = pushTargetBranchGroups.reduce((total, group) => total + group.items.length + 1, 0);
    const estimatedMenuHeight = Math.max(
      PUSH_TARGET_MENU_MIN_HEIGHT,
      Math.min(PUSH_TARGET_MENU_MAX_HEIGHT, estimatedRowCount * PUSH_TARGET_MENU_ESTIMATED_ROW_HEIGHT + 28)
    );
    const shouldOpenUpward =
      spaceBelow < estimatedMenuHeight &&
      spaceAbove > spaceBelow &&
      spaceAbove > PUSH_TARGET_MENU_MIN_HEIGHT;
    setPushTargetBranchMenuPlacement(shouldOpenUpward ? "up" : "down");
  }

  function openPushTargetBranchMenu(resetQuery: boolean) {
    if (pushSubmitting) {
      return;
    }
    setPushRemoteMenuOpen(false);
    if (resetQuery) {
      setPushTargetBranchQuery("");
    }
    updatePushTargetBranchMenuPlacement();
    setPushTargetBranchMenuOpen(true);
  }

  function handleSelectPushRemote(remoteName: string) {
    const normalizedRemote = remoteName.trim();
    const targetOptions = buildRemoteBranchList(branches?.remoteBranches, normalizedRemote);
    const nextTarget =
      (currentBranch && targetOptions.includes(currentBranch) ? currentBranch : null) ??
      (pushTargetBranchTrimmed && targetOptions.includes(pushTargetBranchTrimmed) ? pushTargetBranchTrimmed : null) ??
      targetOptions[0] ??
      currentBranch ??
      "";
    setPushRemoteDraft(normalizedRemote);
    setPushTargetBranchDraft(nextTarget);
    setPushTargetBranchQuery("");
    setPushRemoteMenuOpen(false);
  }

  function handleSelectPushTargetBranch(branchName: string) {
    setPushTargetBranchDraft(branchName);
    setPushTargetBranchQuery("");
    setPushTargetBranchMenuOpen(false);
  }

  function handlePushPreviewDirToggle(path: string) {
    setPushPreviewExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function openSyncDialog() {
    const defaults = resolveDefaultRemoteBranch();
    setSyncRemoteDraft(defaults.remote);
    setSyncTargetBranchDraft(defaults.branch);
    setSyncPreviewLoading(false);
    setSyncPreviewError(null);
    setSyncPreviewCommits([]);
    setSyncPreviewTargetFound(true);
    setActiveToolbarDialog("sync");
  }

  function openFetchDialog() {
    setActiveToolbarDialog("fetch");
  }

  useLayoutEffect(() => {
    if (!projectRoot || !workspaceScopeKey) return;
    detailRequestSeqRef.current += 1;
    pushPreviewLoadSeqRef.current += 1;
    pushPreviewDetailsLoadSeqRef.current += 1;
    setGitPanel(null);
    setBranches(null);
    setHistory(null);
    setHistoryWorkspaceScopeKey(null);
    setDetails(null);
    setPanelError(null);
    setBranchesError(null);
    setHistoryError(null);
    setDetailsError(null);
    setPanelLoading(false);
    setBranchesLoading(false);
    setHistoryLoading(false);
    setDetailsLoading(false);
    setSelectedBranch(null);
    setSelectedCommitSha(null);
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
    setPushPreviewError(null);
    setPushPreviewHasMore(false);
    setPushPreviewTargetFound(true);
    setPushPreviewCommits([]);
    setPushPreviewDetails(null);
    setPushPreviewDetailsError(null);
    setPushPreviewDetailsLoading(false);
    setPushPreviewExpandedDirs(new Set());
    setPushPreviewSelectedFileKey(null);
    setPushPreviewSelectedSha(null);
    syncPreviewLoadSeqRef.current += 1;
    setSyncPreviewLoading(false);
    setSyncPreviewError(null);
    setSyncPreviewCommits([]);
    setSyncPreviewTargetFound(true);
    setActiveToolbarDialog(null);
    void refreshAll();
  }, [projectRoot, workspaceScopeKey]);

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
    if (!pushDialogOpen || (!pushRemoteMenuOpen && !pushTargetBranchMenuOpen)) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (pushRemotePickerRef.current?.contains(target)) {
        return;
      }
      if (pushTargetBranchFieldRef.current?.contains(target)) {
        return;
      }
      setPushRemoteMenuOpen(false);
      setPushTargetBranchMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pushDialogOpen, pushRemoteMenuOpen, pushTargetBranchMenuOpen]);

  useEffect(() => {
    if (!pushDialogOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (pushRemoteMenuOpen || pushTargetBranchMenuOpen) {
        setPushRemoteMenuOpen(false);
        setPushTargetBranchMenuOpen(false);
        return;
      }
      if (!pushSubmitting) {
        setActiveToolbarDialog(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pushDialogOpen, pushRemoteMenuOpen, pushSubmitting, pushTargetBranchMenuOpen]);

  useEffect(() => {
    if (!pushDialogOpen || !pushRemoteMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePushRemoteMenuPlacement();
    handleLayoutChange();
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [pushDialogOpen, pushRemoteMenuOpen]);

  useEffect(() => {
    if (!pushDialogOpen || !pushTargetBranchMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePushTargetBranchMenuPlacement();
    handleLayoutChange();
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [pushDialogOpen, pushTargetBranchGroups, pushTargetBranchMenuOpen]);

  useEffect(() => {
    if (!pushTargetBranchMenuOpen) {
      return;
    }
    const availableScopes = pushTargetBranchGroups.map((group) => group.scope);
    const currentBranchScope = currentBranch ? getBranchScope(currentBranch) : null;
    const selectedScope = pushTargetBranchTrimmed ? getBranchScope(pushTargetBranchTrimmed) : null;
    setPushTargetBranchActiveScopeTab((current) => {
      if (currentBranchScope && availableScopes.includes(currentBranchScope)) {
        return currentBranchScope;
      }
      if (selectedScope && availableScopes.includes(selectedScope)) {
        return selectedScope;
      }
      if (current && availableScopes.includes(current)) {
        return current;
      }
      return availableScopes[0] ?? null;
    });
  }, [currentBranch, pushTargetBranchGroups, pushTargetBranchMenuOpen, pushTargetBranchTrimmed]);

  useEffect(() => {
    if (!pushTargetBranchMenuOpen) {
      return;
    }
    pushTargetBranchMenuRef.current?.scrollTo({ top: 0 });
  }, [pushTargetBranchActiveScopeTab, pushTargetBranchMenuOpen]);

  useEffect(() => {
    if (!projectRoot || !selectedBranch || !workspaceScopeKey) return;
    const id = window.setTimeout(() => {
      void loadHistory(true, 0);
    }, isRemoteWorkspace ? 360 : 180);
    return () => window.clearTimeout(id);
  }, [commitQuery, isRemoteWorkspace, projectRoot, selectedBranch, workspaceScopeKey]);

  useEffect(() => {
    if (!pushDialogOpen) {
      return;
    }
    if (!projectRoot || !workspaceScopeKey || !pushRemoteTrimmed || !pushTargetBranchTrimmed) {
      pushPreviewLoadSeqRef.current += 1;
      pushPreviewDetailsLoadSeqRef.current += 1;
      setPushPreviewLoading(false);
      setPushPreviewError(null);
      setPushPreviewTargetFound(true);
      setPushPreviewHasMore(false);
      setPushPreviewCommits([]);
      setPushPreviewSelectedSha(null);
      setPushPreviewDetails(null);
      setPushPreviewDetailsLoading(false);
      setPushPreviewDetailsError(null);
      return;
    }
    const id = window.setTimeout(() => {
      void loadPushPreview(pushRemoteTrimmed, pushTargetBranchTrimmed);
    }, 180);
    return () => window.clearTimeout(id);
  }, [projectRoot, pushDialogOpen, pushRemoteTrimmed, pushTargetBranchTrimmed, workspaceScopeKey]);

  useEffect(() => {
    if (!pushDialogOpen || !projectRoot || !workspaceScopeKey || !pushPreviewSelectedSha) {
      pushPreviewDetailsLoadSeqRef.current += 1;
      setPushPreviewDetails(null);
      setPushPreviewDetailsLoading(false);
      setPushPreviewDetailsError(null);
      return;
    }
    const requestSeq = ++pushPreviewDetailsLoadSeqRef.current;
    const cached = getCachedRemoteGitCommitDetails(
      workspaceScopeKey,
      pushPreviewSelectedSha,
      undefined,
      isRemoteWorkspace
    );
    if (cached) {
      setPushPreviewDetails(cached);
      setPushPreviewDetailsError(null);
      setPushPreviewDetailsLoading(false);
      return;
    }
    setPushPreviewDetailsLoading(true);
    setPushPreviewDetailsError(null);
    void getGitCommitDetailsWithRemoteCache(
      projectRoot,
      pushPreviewSelectedSha,
      undefined,
      workspaceId,
      workspaceScopeKey,
      isRemoteWorkspace
    )
      .then((next) => {
        if (pushPreviewDetailsLoadSeqRef.current !== requestSeq) {
          return;
        }
        setPushPreviewDetails(next);
      })
      .catch((error) => {
        if (pushPreviewDetailsLoadSeqRef.current !== requestSeq) {
          return;
        }
        setPushPreviewDetails(null);
        setPushPreviewDetailsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (pushPreviewDetailsLoadSeqRef.current === requestSeq) {
          setPushPreviewDetailsLoading(false);
        }
      });
  }, [isRemoteWorkspace, projectRoot, pushDialogOpen, pushPreviewSelectedSha, workspaceId, workspaceScopeKey]);

  useEffect(() => {
    if (!syncDialogOpen) {
      syncPreviewLoadSeqRef.current += 1;
      setSyncPreviewLoading(false);
      return;
    }
    if (!projectRoot || !normalizedSyncRemote || !normalizedSyncTargetBranch) {
      syncPreviewLoadSeqRef.current += 1;
      setSyncPreviewLoading(false);
      setSyncPreviewError(null);
      setSyncPreviewCommits([]);
      setSyncPreviewTargetFound(true);
      return;
    }
    const requestSeq = ++syncPreviewLoadSeqRef.current;
    const id = window.setTimeout(() => {
      setSyncPreviewLoading(true);
      setSyncPreviewError(null);
      void bridge
          .getGitPushPreview(
            projectRoot,
            {
              remote: normalizedSyncRemote,
              branch: normalizedSyncTargetBranch,
              limit: 5,
            },
            workspaceId
          )
        .then((response) => {
          if (syncPreviewLoadSeqRef.current !== requestSeq) {
            return;
          }
          setSyncPreviewTargetFound(response.targetFound);
          setSyncPreviewCommits(response.commits);
        })
        .catch((error) => {
          if (syncPreviewLoadSeqRef.current !== requestSeq) {
            return;
          }
          setSyncPreviewTargetFound(true);
          setSyncPreviewCommits([]);
          setSyncPreviewError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (syncPreviewLoadSeqRef.current === requestSeq) {
            setSyncPreviewLoading(false);
          }
        });
    }, 180);
    return () => {
      window.clearTimeout(id);
    };
  }, [normalizedSyncRemote, normalizedSyncTargetBranch, projectRoot, syncDialogOpen, workspaceScopeKey]);

  useEffect(() => {
    if (!projectRoot || !selectedCommitSha || !workspaceScopeKey) return;
    if (historyWorkspaceScopeKey !== workspaceScopeKey) {
      setDetails(null);
      setDetailsError(null);
      return;
    }
    const commitExists = history?.commits.some((entry) => entry.sha === selectedCommitSha) ?? false;
    if (!commitExists) {
      setDetails(null);
      setDetailsError(null);
      return;
    }
    void loadCommitDetails(selectedCommitSha);
  }, [projectRoot, selectedCommitSha, history?.snapshotId, historyWorkspaceScopeKey, workspaceScopeKey]);

  useEffect(() => {
    setDetailsCollapsedFolders(new Set());
    setSelectedDetailFileKey(details?.files[0] ? buildFileKey(details.files[0]) : null);
  }, [details?.sha]);

  useEffect(() => {
    if (!pushPreviewDetails) {
      setPushPreviewExpandedDirs(new Set());
      setPushPreviewSelectedFileKey(null);
      setDiffModal((current) => (current?.source === "commit" ? null : current));
      return;
    }
    setPushPreviewExpandedDirs(collectDirPaths(pushPreviewDetails.files));
    setPushPreviewSelectedFileKey((current) => pickSelectedPushPreviewFileKey(current, pushPreviewDetails.files));
    setDiffModal((current) => (current?.source === "commit" ? null : current));
  }, [pushPreviewDetails]);

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
      const diff = await bridge.getGitFileDiff(projectRoot, file.path, workspaceId);
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
      await refreshBranches({ force: true });
      await refreshChanges();
      await loadHistory(true, 0, { force: true });
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
      await bridge.stageGitFile(projectRoot, path, workspaceId);
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
      await bridge.unstageGitFile(projectRoot, path, workspaceId);
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
      await bridge.discardGitFile(projectRoot, path, workspaceId);
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
        await bridge.stageGitFile(projectRoot, file.path, workspaceId);
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
        await bridge.unstageGitFile(projectRoot, file.path, workspaceId);
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
        await bridge.discardGitFile(projectRoot, file.path, workspaceId);
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
      await bridge.commitGitChanges(projectRoot, trimmed, { stageAll: stagedFiles.length === 0 && unstagedFiles.length > 0 }, workspaceId);
      setCommitMessage("");
      setSelectedWorktreeFileKey(null);
      await refreshWorkbenchData({ force: true });
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitLoading(false);
    }
  }

  async function pushChanges(params?: {
    remote?: string | null;
    targetBranch?: string | null;
    pushTags?: boolean;
    noVerify?: boolean;
    forceWithLease?: boolean;
    pushToGerrit?: boolean;
    topic?: string | null;
    reviewers?: string | null;
    cc?: string | null;
  }) {
    if (!projectRoot) return;
    setPushLoading(true);
    setPushError(null);
    setOperationError(null);
    try {
      await bridge.pushGit(
        projectRoot,
        params?.remote ?? null,
        params?.targetBranch ?? null,
        {
          pushTags: params?.pushTags ?? false,
          noVerify: params?.noVerify ?? false,
          forceWithLease: params?.forceWithLease ?? false,
          pushToGerrit: params?.pushToGerrit ?? false,
          topic: params?.topic ?? null,
          reviewers: params?.reviewers ?? null,
          cc: params?.cc ?? null,
        },
        workspaceId
      );
      await refreshWorkbenchData({ force: true });
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

  async function pullChanges(params?: { remote?: string | null; targetBranch?: string | null; pullOption?: string | null }) {
    if (!projectRoot) return;
    setPullLoading(true);
    setOperationError(null);
    setPushError(null);
    setCommitError(null);
    try {
      await bridge.pullGit(
        projectRoot,
        params?.remote ?? null,
        params?.targetBranch ?? null,
        params?.pullOption ?? null,
        workspaceId
      );
      await refreshWorkbenchData({ force: true });
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
      await bridge.fetchGit(projectRoot, params?.remote ?? null, workspaceId);
      await refreshWorkbenchData({ force: true });
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
      await bridge.syncGit(projectRoot, params?.remote ?? null, params?.targetBranch ?? null, workspaceId);
      await refreshWorkbenchData({ force: true });
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
      pullOption: selectedPullOption.flag,
    });
    if (ok) {
      setActiveToolbarDialog(null);
    }
  }

  async function confirmPushDialog() {
    if (!pushCanConfirm) {
      return;
    }
    setPushRemoteMenuOpen(false);
    setPushTargetBranchMenuOpen(false);
    setActiveToolbarDialog(null);
    await pushChanges({
      remote: pushRemoteTrimmed,
      targetBranch: pushTargetSummaryBranch,
      pushTags,
      noVerify: !pushRunHooks,
      forceWithLease: pushForceWithLease,
      pushToGerrit,
      topic: pushTopic.trim() || null,
      reviewers: pushReviewers.trim() || null,
      cc: pushCc.trim() || null,
    });
  }

  async function confirmSyncDialog() {
    setActiveToolbarDialog(null);
    await syncChanges({
      remote: normalizedSyncRemote,
      targetBranch: normalizedSyncTargetBranch,
    });
  }

  async function confirmFetchDialog() {
    setActiveToolbarDialog(null);
    await fetchChanges({
      remote: null,
    });
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
                <select
                  value={normalizedPullTargetBranch}
                  disabled={pullLoading}
                  onChange={(event) => setPullTargetBranchDraft(event.target.value)}
                >
                  {pullBranchOptions.map((branch) => (
                    <option key={`pull-branch-${branch}`} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </label>
              <div className="git-history-toolbar-confirm-field git-history-toolbar-confirm-field-wide">
                <span>修改选项</span>
                <div className="git-history-toolbar-confirm-options" role="radiogroup" aria-label="拉取选项">
                  {PULL_DIALOG_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`git-history-toolbar-confirm-option ${pullOptionDraft === option.id ? "is-active" : ""}`}
                      onClick={() => setPullOptionDraft(option.id)}
                      role="radio"
                      aria-checked={pullOptionDraft === option.id}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="git-history-toolbar-confirm-option-summary">
                  {selectedPullOption.intent} {selectedPullOption.willHappen}
                </p>
              </div>
            </>
          }
          preflight={
            <>
              <div>当前分支：{toolbarBranchLabel}</div>
              <div>{selectedPullOption.intent}</div>
            </>
          }
          facts={[
            { label: "操作意图", value: selectedPullOption.intent },
            { label: "将会发生", value: `${selectedPullOption.willHappen} 会按所选远端、目标分支执行 pull。` },
            { label: "不会发生", value: selectedPullOption.wontHappen },
          ]}
          confirmLabel="拉取"
          loading={pullLoading}
          onClose={() => setActiveToolbarDialog(null)}
          onConfirm={() => {
            void confirmPullDialog();
          }}
        />
      ) : null}

      {pushDialogOpen ? (
        <div
          className="git-history-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pushSubmitting) {
              setActiveToolbarDialog(null);
            }
          }}
        >
          <div
            className="git-history-push-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="推送变更"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="git-history-push-hero">
              <div className="git-history-create-branch-title git-history-push-title">
                <Upload size={14} />
                <span>推送变更</span>
              </div>
              <div className="git-history-push-summary-row">
                <div className="git-history-push-target-wrap">
                  <div className="git-history-push-target">
                    将 <strong>{currentBranch || "HEAD"}</strong> 推送到{" "}
                    <strong>{pushRemoteTrimmed || "origin"}:{pushTargetSummaryBranch}</strong>
                  </div>
                  {pushIsNewBranchTarget ? <span className="git-history-push-target-badge">(新分支)</span> : null}
                </div>
                <code className="git-history-push-readonly">{currentBranch || "HEAD"}</code>
              </div>
            </div>

            <div className="git-history-push-section git-history-push-section-preview">
              <div className="git-history-push-preview">
                <div className="git-history-push-preview-pane is-commits">
                  <div className="git-history-push-preview-head">
                    <span className="git-history-push-preview-title">
                      <GitCommitHorizontal size={12} />
                      待推送提交
                    </span>
                    <strong>{pushIsNewBranchTarget ? "新分支" : pushPreviewCommits.length}</strong>
                  </div>
                  {!pushIsNewBranchTarget && !pushPreviewError && pushPreviewLoading ? (
                    <div className="git-history-push-preview-empty">
                      正在加载推送预览提交…
                    </div>
                  ) : null}
                  {pushPreviewError ? <div className="git-history-push-preview-error">{pushPreviewError}</div> : null}
                  {!pushIsNewBranchTarget && !pushPreviewError && !pushPreviewLoading && !pushHasOutgoingCommits ? (
                    <div className="git-history-push-preview-empty">当前分支没有可推送的领先提交。</div>
                  ) : null}
                  {!pushIsNewBranchTarget && !pushPreviewError && !pushPreviewLoading && pushHasOutgoingCommits ? (
                    <div className="git-history-push-preview-commit-list">
                      {pushPreviewCommits.map((entry) => {
                        const active = entry.sha === pushPreviewSelectedSha;
                        return (
                          <button
                            key={entry.sha}
                            type="button"
                            className={`git-history-push-preview-commit${active ? " is-active" : ""}`}
                            onClick={() => setPushPreviewSelectedSha(entry.sha)}
                          >
                            <span className="git-history-push-preview-commit-summary">{entry.summary || "(no message)"}</span>
                            <span className="git-history-push-preview-commit-meta">
                              <code>{entry.shortSha}</code>
                              <em>{entry.author || "unknown"}</em>
                              <time>{formatRelativeTime(entry.timestamp * 1000)}</time>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {!pushIsNewBranchTarget && !pushPreviewError && pushPreviewHasMore ? (
                    <div className="git-history-push-preview-hint">仅展示最近 {pushPreviewCommits.length} 条提交。</div>
                  ) : null}
                  {pushIsNewBranchTarget ? (
                    <>
                      <div className="git-history-push-preview-empty">目标远端分支不存在，将创建一个新的远端分支。</div>
                      <div className="git-history-push-preview-hint">
                        将推送到 <code>{pushRemoteTrimmed || "origin"}/{pushTargetBranchTrimmed || "main"}</code>。
                      </div>
                    </>
                  ) : null}
                </div>

                <div className="git-history-push-preview-pane is-details">
                  <div className="git-history-push-preview-head">
                    <span className="git-history-push-preview-title">
                      <FileText size={12} />
                      提交详情
                    </span>
                  </div>
                  {!pushIsNewBranchTarget && !pushPreviewError && pushPreviewDetailsLoading ? (
                    <div className="git-history-push-preview-empty">正在加载提交详情…</div>
                  ) : null}
                  {pushPreviewDetailsError ? <div className="git-history-push-preview-error">{pushPreviewDetailsError}</div> : null}
                  {!pushIsNewBranchTarget && !pushPreviewDetailsLoading && !pushPreviewDetailsError && !pushPreviewSelectedCommit ? (
                    <div className="git-history-push-preview-empty">选择左侧提交可查看详情。</div>
                  ) : null}
                  {pushPreviewDetails && !pushPreviewDetailsLoading && !pushPreviewDetailsError ? (
                    <div className="git-history-push-preview-details">
                      <div className="git-history-push-preview-metadata">
                        <strong>{pushPreviewDetails.summary || "(no message)"}</strong>
                        <span className="git-history-push-preview-metadata-row">
                          <code>{pushPreviewDetails.sha}</code>
                          <em>{pushPreviewDetails.author || "unknown"}</em>
                          <time>{new Date(pushPreviewDetails.commitTime * 1000).toLocaleString()}</time>
                        </span>
                      </div>
                      <div className="git-history-push-preview-file-head git-filetree-section-header">
                        <FolderTree size={12} />
                        <span>变更文件</span>
                        <i>{pushPreviewDetails.files.length}</i>
                      </div>
                      <div className="git-history-push-preview-file-tree git-filetree-list git-filetree-list--tree">
                        {pushPreviewFileTreeItems.length > 0 ? (
                          pushPreviewFileTreeItems.map((item) => {
                            const treeIndentPx = item.depth * 14;
                            const treeRowStyle = {
                              ["--git-tree-row-indent" as string]: `${treeIndentPx}px`,
                              ["--git-tree-indent-x" as string]: `calc(${treeIndentPx}px + var(--git-filetree-row-pad-x, 8px) - 7px)`,
                              ["--git-tree-line-opacity" as string]: getTreeLineOpacity(item.depth > 0 ? 1 : 0),
                            } as CSSProperties;

                            if (item.type === "dir") {
                              return (
                                <button
                                  key={`push-preview-${item.id}`}
                                  type="button"
                                  className="git-history-tree-item git-history-tree-dir git-filetree-folder-row"
                                  style={treeRowStyle}
                                  onClick={() => handlePushPreviewDirToggle(item.path)}
                                >
                                  <span className="git-history-tree-caret" aria-hidden>
                                    {item.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                  </span>
                                  <span className="git-history-tree-icon" aria-hidden>
                                    <FileIcon filePath={item.path} isFolder isOpen={item.expanded} />
                                  </span>
                                  <span className="git-history-tree-label">{item.label}</span>
                                </button>
                              );
                            }

                            const file = item.change;
                            const fileKey = buildFileKey(file);
                            const active = pushPreviewSelectedFileKey === fileKey;
                            return (
                              <button
                                key={`push-preview-${item.id}`}
                                type="button"
                                className={`git-history-tree-item git-history-file-item git-filetree-row${active ? " is-active" : ""}`}
                                style={treeRowStyle}
                                title={file.path}
                                onClick={() => {
                                  setPushPreviewSelectedFileKey(fileKey);
                                  openCommitDiff(file);
                                }}
                              >
                                <span className={`git-history-file-status ${statusToneClass(file.status)}`}>{normalizeStatus(file.status)}</span>
                                <span className="git-history-tree-icon is-file" aria-hidden>
                                  <FileIcon filePath={file.path} />
                                </span>
                                <span className="git-history-file-path">{item.label}</span>
                                <span className="git-history-file-stats git-filetree-badge">
                                  <span className="is-add">+{file.additions}</span>
                                  <span className="is-sep">/</span>
                                  <span className="is-del">-{file.deletions}</span>
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="git-history-push-preview-empty">这个提交没有文件变更。</div>
                        )}
                      </div>
                    </div>
                  ) : null}
                  {pushIsNewBranchTarget ? <div className="git-history-push-preview-empty">新分支预览不显示已有远端对比详情。</div> : null}
                </div>
              </div>
            </div>

            <div className="git-history-push-section git-history-push-section-controls">
              <div className="git-history-push-grid">
                <div className="git-history-create-branch-field">
                  <span className="git-history-push-field-label">
                    <Cloud size={12} />
                    远端
                  </span>
                  <div
                    className={`git-history-push-picker${pushRemoteMenuOpen ? " is-open" : ""}`}
                    ref={pushRemotePickerRef}
                  >
                    <button
                      type="button"
                      className="git-history-push-picker-trigger"
                      aria-label="远端"
                      aria-haspopup="listbox"
                      aria-expanded={pushRemoteMenuOpen}
                      disabled={pushSubmitting}
                      onClick={() => {
                        if (pushSubmitting) {
                          return;
                        }
                        setPushTargetBranchMenuOpen(false);
                        setPushRemoteMenuOpen((current) => {
                          const nextOpen = !current;
                          if (nextOpen) {
                            updatePushRemoteMenuPlacement();
                          }
                          return nextOpen;
                        });
                      }}
                    >
                      <Cloud size={12} className="git-history-push-picker-leading-icon" />
                      <span className="git-history-push-picker-value">{pushRemoteTrimmed || "origin"}</span>
                      <ChevronDown size={13} className="git-history-push-picker-caret" />
                    </button>
                    {pushRemoteMenuOpen ? (
                      <div
                        className={`git-history-push-picker-menu${pushRemoteMenuPlacement === "up" ? " is-upward" : ""}`}
                        role="listbox"
                        aria-label="远端"
                      >
                        {remoteOptions.map((remoteName) => (
                          <button
                            key={remoteName}
                            type="button"
                            className={`git-history-push-picker-item${remoteName === pushRemoteTrimmed ? " is-active" : ""}`}
                            role="option"
                            aria-selected={remoteName === pushRemoteTrimmed}
                            onClick={() => handleSelectPushRemote(remoteName)}
                          >
                            <Cloud size={12} className="git-history-push-picker-item-icon" />
                            <span className="git-history-push-picker-item-content">{remoteName}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <label className="git-history-create-branch-field git-history-push-target-field" ref={pushTargetBranchFieldRef}>
                  <span className="git-history-push-field-label">
                    <GitBranch size={12} />
                    目标远端分支
                  </span>
                  <div
                    className={`git-history-push-combobox${pushTargetBranchMenuOpen ? " is-open" : ""}`}
                    ref={pushTargetBranchPickerRef}
                  >
                    <input
                      value={pushTargetBranchDraft}
                      disabled={pushSubmitting}
                      onChange={(event) => {
                        setPushTargetBranchDraft(event.target.value);
                        setPushTargetBranchQuery(event.target.value);
                        if (!pushTargetBranchMenuOpen) {
                          openPushTargetBranchMenu(false);
                        }
                      }}
                      onFocus={() => openPushTargetBranchMenu(false)}
                      aria-label="目标远端分支"
                      placeholder={currentBranch ?? "main"}
                    />
                    <button
                      type="button"
                      className="git-history-push-combobox-toggle"
                      aria-label="切换目标远端分支列表"
                      aria-haspopup="listbox"
                      aria-expanded={pushTargetBranchMenuOpen}
                      disabled={pushSubmitting}
                      onClick={() => {
                        if (pushSubmitting) {
                          return;
                        }
                        const nextOpen = !pushTargetBranchMenuOpen;
                        if (nextOpen) {
                          openPushTargetBranchMenu(true);
                          return;
                        }
                        setPushTargetBranchMenuOpen(false);
                      }}
                    >
                      <ChevronDown size={13} />
                    </button>
                  </div>
                  {pushTargetBranchMenuOpen ? (
                    <div
                      className={`git-history-push-picker-menu git-history-push-target-menu${
                        pushTargetBranchMenuPlacement === "up" ? " is-upward" : ""
                      }`}
                      ref={pushTargetBranchMenuRef}
                      role="listbox"
                      aria-label="目标远端分支"
                    >
                      {pushTargetBranchGroups.length > 0 ? (
                        <>
                          {pushTargetBranchGroups.length > 1 ? (
                            <div className="git-history-push-picker-tabs" role="tablist">
                              {pushTargetBranchGroups.map((group) => {
                                const isActive = group.scope === pushTargetBranchActiveScopeTab;
                                return (
                                  <button
                                    key={`push-target-tab-${group.scope}`}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`git-history-push-picker-tab${isActive ? " is-active" : ""}`}
                                    onClick={() => setPushTargetBranchActiveScopeTab(group.scope)}
                                  >
                                    <span>{group.label}</span>
                                    <i>{group.items.length}</i>
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                          {visiblePushTargetBranchGroups.map((group) => (
                            <div key={group.scope} className="git-history-push-picker-group">
                              {pushTargetBranchGroups.length <= 1 ? (
                                <div className="git-history-push-picker-group-label">
                                  <FolderTree size={11} />
                                  <span>{group.label}</span>
                                  <i>{group.items.length}</i>
                                </div>
                              ) : null}
                              {group.items.map((branchName) => (
                                <button
                                  key={branchName}
                                  type="button"
                                  className={`git-history-push-picker-item${branchName === pushTargetBranchTrimmed ? " is-active" : ""}`}
                                  role="option"
                                  aria-selected={branchName === pushTargetBranchTrimmed}
                                  title={branchName}
                                  onClick={() => handleSelectPushTargetBranch(branchName)}
                                >
                                  <GitBranch size={12} className="git-history-push-picker-item-icon" />
                                  <span className="git-history-push-picker-item-content">
                                    <span className="git-history-push-picker-item-title">{getBranchLeafName(branchName)}</span>
                                    {getBranchScope(branchName) !== "__root__" ? (
                                      <>
                                        <span className="git-history-push-picker-item-separator"> · </span>
                                        <span className="git-history-push-picker-item-subtitle">{branchName}</span>
                                      </>
                                    ) : null}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ))}
                        </>
                      ) : (
                        <div className="git-history-push-picker-empty">当前远端没有可选分支。</div>
                      )}
                    </div>
                  ) : null}
                </label>
              </div>

              <button
                type="button"
                className={`git-history-push-toggle${pushToGerrit ? " is-active" : ""}`}
                aria-pressed={pushToGerrit}
                disabled={pushSubmitting}
                onClick={() => setPushToGerrit((previous) => !previous)}
              >
                <span className="git-history-push-toggle-indicator" aria-hidden>
                  {pushToGerrit ? "✓" : ""}
                </span>
                <Upload size={12} className="git-history-push-toggle-icon" />
                <span>Push to Gerrit</span>
              </button>

              {pushToGerrit ? (
                <>
                  <div className="git-history-push-hint">
                    将使用 <code>refs/for/{pushTargetSummaryBranch}</code> 推送，并附带 topic/reviewers/cc 参数。
                  </div>
                  <div className="git-history-push-grid">
                    <label className="git-history-create-branch-field">
                      <span>Topic</span>
                      <input
                        value={pushTopic}
                        disabled={pushSubmitting}
                        onChange={(event) => setPushTopic(event.target.value)}
                      />
                    </label>
                    <label className="git-history-create-branch-field">
                      <span>Reviewers</span>
                      <input
                        value={pushReviewers}
                        disabled={pushSubmitting}
                        onChange={(event) => setPushReviewers(event.target.value)}
                        placeholder="alice@corp.com,bob@corp.com"
                      />
                    </label>
                    <label className="git-history-create-branch-field">
                      <span>CC</span>
                      <input
                        value={pushCc}
                        disabled={pushSubmitting}
                        onChange={(event) => setPushCc(event.target.value)}
                        placeholder="team@corp.com"
                      />
                    </label>
                  </div>
                </>
              ) : null}
            </div>

            <div className="git-history-push-footer">
              <div className="git-history-push-options">
                <button
                  type="button"
                  className={`git-history-push-toggle${pushTags ? " is-active" : ""}`}
                  aria-pressed={pushTags}
                  disabled={pushSubmitting}
                  onClick={() => setPushTags((previous) => !previous)}
                >
                  <span className="git-history-push-toggle-indicator" aria-hidden>
                    {pushTags ? "✓" : ""}
                  </span>
                  <GitBranch size={12} className="git-history-push-toggle-icon" />
                  <span>推送 Tags</span>
                </button>
                <button
                  type="button"
                  className={`git-history-push-toggle${pushRunHooks ? " is-active" : ""}`}
                  aria-pressed={pushRunHooks}
                  disabled={pushSubmitting}
                  onClick={() => setPushRunHooks((previous) => !previous)}
                >
                  <span className="git-history-push-toggle-indicator" aria-hidden>
                    {pushRunHooks ? "✓" : ""}
                  </span>
                  <RefreshCw size={12} className="git-history-push-toggle-icon" />
                  <span>运行 Hooks</span>
                </button>
                <button
                  type="button"
                  className={`git-history-push-toggle${pushForceWithLease ? " is-active" : ""}`}
                  aria-pressed={pushForceWithLease}
                  disabled={pushSubmitting}
                  onClick={() => setPushForceWithLease((previous) => !previous)}
                >
                  <span className="git-history-push-toggle-indicator" aria-hidden>
                    {pushForceWithLease ? "✓" : ""}
                  </span>
                  <Repeat size={12} className="git-history-push-toggle-icon" />
                  <span>Force With Lease</span>
                </button>
              </div>

              <div className="git-history-create-branch-actions">
                <button
                  type="button"
                  className="git-history-create-branch-btn is-cancel"
                  onClick={() => setActiveToolbarDialog(null)}
                  disabled={pushSubmitting}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="git-history-create-branch-btn is-confirm"
                  disabled={!pushCanConfirm}
                  title={!pushCanConfirm && !pushPreviewLoading && !pushHasOutgoingCommits ? "当前没有可推送的领先提交。" : undefined}
                  onClick={() => {
                    void confirmPushDialog();
                  }}
                >
                  {pushSubmitting ? "执行中…" : "推送"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {syncDialogOpen ? (
        <div
          className="git-history-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !syncSubmitting) {
              setActiveToolbarDialog(null);
            }
          }}
        >
          <div
            className="git-history-toolbar-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="同步分支"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="git-history-create-branch-title git-history-push-title">
              <Repeat size={14} />
              <span>同步分支</span>
            </div>

            <div className="git-history-toolbar-confirm-hero">
              <div className="git-history-toolbar-confirm-hero-line">
                <span>{currentBranch || "HEAD"}</span>
                <span aria-hidden>{"->"}</span>
                <span>{`${normalizedSyncRemote}:${normalizedSyncTargetBranch}`}</span>
              </div>
              <code>{syncCommandPreview}</code>
            </div>

            <div className="git-history-toolbar-confirm-preflight">
              <div>
                将当前分支 {currentBranch || "HEAD"} 与 {normalizedSyncRemote}:{normalizedSyncTargetBranch} 同步。
              </div>
              <div>
                领先 {commitsAhead} / 落后 {commitsBehind}
              </div>
              {syncPreviewLoading ? <div>正在加载同步预览…</div> : null}
              {syncPreviewError ? <div className="git-history-error">{syncPreviewError}</div> : null}
              {!syncPreviewLoading && !syncPreviewError ? (
                <div className="git-history-toolbar-confirm-commit-list">
                  {syncPreviewCommits.slice(0, 5).map((entry) => (
                    <div key={entry.sha} className="git-history-toolbar-confirm-commit-item">
                      <code>{entry.shortSha}</code>
                      <span>{entry.summary || "(no message)"}</span>
                    </div>
                  ))}
                  {!syncPreviewCommits.length && syncPreviewTargetFound ? (
                    <div className="git-history-toolbar-confirm-note">当前没有待同步的领先提交。</div>
                  ) : null}
                  {!syncPreviewTargetFound ? (
                    <div className="git-history-toolbar-confirm-note">远端还没有这个目标分支，首次同步时会创建它。</div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <dl className="git-history-toolbar-confirm-facts">
              <div className="git-history-toolbar-confirm-fact">
                <dt>操作意图</dt>
                <dd>将当前分支与上游远端分支同步。</dd>
              </div>
              <div className="git-history-toolbar-confirm-fact">
                <dt>将会发生</dt>
                <dd>会先拉取远端最新提交，再把本地领先提交推送到目标分支。</dd>
              </div>
              <div className="git-history-toolbar-confirm-fact">
                <dt>不会发生</dt>
                <dd>不会切换分支，也不会附带额外的 pull 策略或 push 扩展参数。</dd>
              </div>
            </dl>

            <div className="git-history-toolbar-confirm-command">
              <span>示例命令</span>
              <code>{syncCommandPreview}</code>
            </div>

            <div className="git-history-create-branch-actions">
              <button
                type="button"
                className="git-history-create-branch-btn is-cancel"
                disabled={syncSubmitting}
                onClick={() => setActiveToolbarDialog(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="git-history-create-branch-btn"
                disabled={syncSubmitting}
                onClick={() => {
                  void confirmSyncDialog();
                }}
              >
                {syncSubmitting ? "执行中…" : "同步"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {fetchDialogOpen ? (
        <div
          className="git-history-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !fetchSubmitting) {
              setActiveToolbarDialog(null);
            }
          }}
        >
          <div
            className="git-history-toolbar-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="获取远端更新"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="git-history-create-branch-title git-history-push-title">
              <Cloud size={14} />
              <span>获取远端更新</span>
            </div>

            <div className="git-history-toolbar-confirm-hero">
              <div className="git-history-toolbar-confirm-hero-line">
                <span>全部远端</span>
                <span aria-hidden>{"->"}</span>
                <span>远端 refs</span>
              </div>
              <code>{fetchCommandPreview}</code>
            </div>

            <dl className="git-history-toolbar-confirm-facts">
              <div className="git-history-toolbar-confirm-fact">
                <dt>操作意图</dt>
                <dd>从全部远端获取最新 refs 和对象信息。</dd>
              </div>
              <div className="git-history-toolbar-confirm-fact">
                <dt>将会发生</dt>
                <dd>会把远端最新分支、标签以及提交元数据同步到本地仓库。</dd>
              </div>
              <div className="git-history-toolbar-confirm-fact">
                <dt>不会发生</dt>
                <dd>不会切换分支、不会自动 pull，也不会修改当前工作区文件。</dd>
              </div>
            </dl>

            <div className="git-history-toolbar-confirm-command">
              <span>示例命令</span>
              <code>{fetchCommandPreview}</code>
            </div>

            <div className="git-history-create-branch-actions">
              <button
                type="button"
                className="git-history-create-branch-btn is-cancel"
                disabled={fetchSubmitting}
                onClick={() => setActiveToolbarDialog(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="git-history-create-branch-btn"
                disabled={fetchSubmitting}
                onClick={() => {
                  void confirmFetchDialog();
                }}
              >
                {fetchSubmitting ? "执行中…" : "获取"}
              </button>
            </div>
          </div>
        </div>
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
                    bridge.createGitBranch(projectRoot, branchNameDraft.trim(), sourceRefDraft.trim() || null, checkoutAfterCreate, workspaceId)
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
                    bridge.renameGitBranch(projectRoot, selectedBranchItem.name, branchNameDraft.trim(), workspaceId)
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
                    bridge.deleteGitBranch(projectRoot, selectedBranchItem.name, false, workspaceId)
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
                  void runBranchOperation(() => bridge.mergeGitBranch(projectRoot, selectedBranchItem.name, workspaceId))
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
