import { bridge } from "./bridge";
import type { FileMentionCandidate, WorkspaceFileIndexResponse } from "./models";

const WORKSPACE_FILE_INDEX_TTL_MS = 30_000;

const workspaceFileIndexCache = new Map<
  string,
  {
    value: WorkspaceFileIndexResponse;
    refreshedAt: number;
  }
>();
const workspaceFileIndexInflight = new Map<string, Promise<WorkspaceFileIndexResponse>>();

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

export function peekWorkspaceFileIndex(workspaceId: string) {
  return workspaceFileIndexCache.get(workspaceId)?.value ?? null;
}

export function isWorkspaceFileIndexFresh(workspaceId: string, maxAgeMs = WORKSPACE_FILE_INDEX_TTL_MS) {
  const cached = workspaceFileIndexCache.get(workspaceId);
  if (!cached) return false;
  return Date.now() - cached.refreshedAt < maxAgeMs;
}

export function invalidateWorkspaceFileIndex(workspaceId: string) {
  workspaceFileIndexCache.delete(workspaceId);
}

export async function loadWorkspaceFileIndex(options: {
  workspaceId: string;
  projectRoot: string;
  force?: boolean;
  maxAgeMs?: number;
}) {
  const { workspaceId, projectRoot, force = false, maxAgeMs = WORKSPACE_FILE_INDEX_TTL_MS } = options;
  if (!force && isWorkspaceFileIndexFresh(workspaceId, maxAgeMs)) {
    return workspaceFileIndexCache.get(workspaceId)?.value ?? { entriesByParent: {}, files: [] };
  }

  const inflight = workspaceFileIndexInflight.get(workspaceId);
  if (inflight) {
    return inflight;
  }

  const next = bridge
    .getWorkspaceFileIndex(projectRoot, workspaceId)
    .then((value) => {
      workspaceFileIndexCache.set(workspaceId, {
        value,
        refreshedAt: Date.now(),
      });
      return value;
    })
    .finally(() => {
      workspaceFileIndexInflight.delete(workspaceId);
    });

  workspaceFileIndexInflight.set(workspaceId, next);
  return next;
}

export function searchWorkspaceFileIndex(
  workspaceId: string,
  query: string,
  limit = 40
): FileMentionCandidate[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];
  const cached = peekWorkspaceFileIndex(workspaceId);
  if (!cached) return [];
  return cached.files
    .filter((item) => {
      const relativePath = item.relativePath.toLowerCase();
      return relativePath.includes(normalized) || item.name.toLowerCase().includes(normalized);
    })
    .slice(0, limit);
}
