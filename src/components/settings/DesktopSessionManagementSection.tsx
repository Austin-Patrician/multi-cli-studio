import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  RotateCw,
  Trash2,
  Undo2,
} from "lucide-react";
import openaiIcon from "../../media/svg/openai.svg";
import claudeIcon from "../../media/svg/claude-color.svg";
import geminiIcon from "../../media/svg/gemini-color.svg";
import { bridge } from "../../lib/bridge";
import type {
  WorkspaceRef,
  WorkspaceSessionBatchMutationResponse,
  WorkspaceSessionCatalogEntry,
  WorkspaceSessionCatalogQuery,
  WorkspaceSessionProjectionSummary,
} from "../../lib/models";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";

type WorkspaceSessionCatalogStatus = "active" | "archived" | "all";
type WorkspaceSessionCatalogMode = "project" | "global";
type WorkspaceSessionCatalogSource = "strict" | "related";
type MutationKind = "archive" | "unarchive" | "delete";

type WorkspaceSessionCatalogFilters = {
  keyword: string;
  engine: string;
  status: WorkspaceSessionCatalogStatus;
};

type WorkspaceSessionCatalogMutationResult = {
  selectionKey: string;
  sessionId: string;
  workspaceId: string;
  ok: boolean;
  archivedAt?: number | null;
  error?: string | null;
  code?: string | null;
};

type WorkspaceSessionCatalogMutationResponse = {
  results: WorkspaceSessionCatalogMutationResult[];
};

type WorkspaceOption = {
  id: string;
  label: string;
  pickerLabel: string;
};

type NoticeState =
  | { kind: "success"; text: string }
  | { kind: "error"; text: string }
  | null;

type SessionListSectionProps = {
  title: string;
  description?: string;
  entries: WorkspaceSessionCatalogEntry[];
  selectedIds: Record<string, true>;
  workspaceLabelById: Map<string, string>;
  locale: string;
  onToggleSelection: (selectionKey: string) => void;
};

type DesktopSessionManagementSectionProps = {
  title: string;
  description: string;
  workspaces: WorkspaceRef[];
  initialWorkspaceId?: string | null;
  onSessionsMutated?: (workspaceId: string) => void;
};

const SESSION_CATALOG_PAGE_SIZE = 100;
const ENGINE_FILTER_ALL_VALUE = "__all__";
const UNASSIGNED_WORKSPACE_ID = "__global_unassigned__";
const OWNER_UNRESOLVED_CODE = "OWNER_WORKSPACE_UNRESOLVED";
const MISSING_MUTATION_RESULT_CODE = "MISSING_MUTATION_RESULT";

const DEFAULT_FILTERS: WorkspaceSessionCatalogFilters = {
  keyword: "",
  engine: "",
  status: "active",
};

const ENGINE_LABELS: Record<string, string> = {
  all: "全部引擎",
  codex: "Codex",
  claude: "Claude",
  gemini: "Gemini",
  opencode: "OpenCode",
};

const ENGINE_ICONS: Record<string, string> = {
  codex: openaiIcon,
  claude: claudeIcon,
  gemini: geminiIcon,
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function normalizeEngineType(engine: string) {
  if (engine === "claude" || engine === "gemini" || engine === "opencode") {
    return engine;
  }
  return "codex";
}

function formatCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function buildWorkspaceOptions(workspaces: WorkspaceRef[]): WorkspaceOption[] {
  return [...workspaces]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((workspace) => ({
      id: workspace.id,
      label: workspace.name,
      pickerLabel: workspace.locationKind === "ssh" ? `[SSH] ${workspace.name}` : workspace.name,
    }));
}

function buildWorkspaceSessionSelectionKey(
  entry: Pick<WorkspaceSessionCatalogEntry, "workspaceId" | "sessionId">,
) {
  return `${entry.workspaceId}::${entry.sessionId}`;
}

function formatUpdatedAtDisplay(updatedAt: number, locale: string) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return "--";
  }
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function statusFilterLabel(status: WorkspaceSessionCatalogStatus) {
  if (status === "archived") return "仅显示归档";
  if (status === "all") return "显示全部";
  return "仅显示活跃";
}

function resolveMutationFailureReason(
  result: WorkspaceSessionCatalogMutationResponse["results"][number],
) {
  if (result.code === OWNER_UNRESOLVED_CODE) {
    return "这条会话还没有解析出唯一归属项目，当前不能直接归档、取消归档或删除。";
  }
  if (result.code === MISSING_MUTATION_RESULT_CODE) {
    return "会话治理结果不完整，请刷新后重试。";
  }
  return result.error?.trim() || "未知错误";
}

function collectSucceededWorkspaceIds(
  results: WorkspaceSessionCatalogMutationResponse["results"],
) {
  return [...new Set(results.filter((item) => item.ok).map((item) => item.workspaceId))];
}

function SessionEngineIcon({ engine }: { engine: string }) {
  const normalized = normalizeEngineType(engine);
  const icon = ENGINE_ICONS[normalized];
  if (icon) {
    return <img src={icon} alt="" />;
  }
  return <span className="dcc-badge">{ENGINE_LABELS[normalized] ?? normalized}</span>;
}

function SessionListSection({
  title,
  description,
  entries,
  selectedIds,
  workspaceLabelById,
  locale,
  onToggleSelection,
}: SessionListSectionProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-semibold">{title}</div>
        {description ? (
          <div className="text-sm text-slate-500">{description}</div>
        ) : null}
      </div>
      <ul className="settings-project-sessions-list">
        {entries.map((entry) => {
          const selectionKey = buildWorkspaceSessionSelectionKey(entry);
          const selected = Boolean(selectedIds[selectionKey]);
          const engineLabel = ENGINE_LABELS[normalizeEngineType(entry.engine)] ?? entry.engine;
          const ownerWorkspaceLabel =
            entry.workspaceId === UNASSIGNED_WORKSPACE_ID
              ? "未归属历史"
              : entry.workspaceLabel ??
                workspaceLabelById.get(entry.workspaceId) ??
                entry.workspaceId;

          return (
            <li key={selectionKey}>
              <label
                className={`settings-project-sessions-item${
                  selected ? " is-selected" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelection(selectionKey)}
                  aria-label={entry.title}
                />
                <span className="settings-project-sessions-item-engine" aria-hidden>
                  <SessionEngineIcon engine={entry.engine} />
                </span>
                <span className="settings-project-sessions-item-content">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="settings-project-sessions-item-title">
                        {entry.title.trim() || "未命名会话"}
                      </span>
                      {entry.archivedAt ? <span className="dcc-badge">已归档</span> : null}
                      {entry.attributionStatus === "inferred-related" ? (
                        <span className="dcc-badge">推断相关</span>
                      ) : null}
                      {entry.attributionConfidence === "high" ? (
                        <span className="dcc-badge">高置信</span>
                      ) : null}
                      {entry.attributionConfidence === "medium" ? (
                        <span className="dcc-badge">中置信</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="settings-project-sessions-item-meta">
                    <span>{engineLabel}</span>
                    <span> · </span>
                    <span>{formatUpdatedAtDisplay(entry.updatedAt, locale)}</span>
                    <span> · </span>
                    <span>{ownerWorkspaceLabel}</span>
                    {entry.sourceLabel ? (
                      <>
                        <span> · </span>
                        <span>{entry.sourceLabel}</span>
                      </>
                    ) : null}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toQuery(filters: WorkspaceSessionCatalogFilters): WorkspaceSessionCatalogQuery {
  return {
    keyword: filters.keyword.trim() || null,
    engine: filters.engine.trim() || null,
    status: filters.status,
  };
}

function patchArchivedState(
  current: WorkspaceSessionCatalogEntry[],
  results: WorkspaceSessionCatalogMutationResponse["results"],
) {
  if (results.length === 0) {
    return current;
  }
  const archivedAtBySelectionKey = new Map(
    results
      .filter((item) => item.ok)
      .map((item) => [item.selectionKey, item.archivedAt ?? null] as const),
  );
  return current.map((entry) =>
    archivedAtBySelectionKey.has(buildWorkspaceSessionSelectionKey(entry))
      ? {
          ...entry,
          archivedAt:
            archivedAtBySelectionKey.get(buildWorkspaceSessionSelectionKey(entry)) ??
            null,
        }
      : entry,
  );
}

function useWorkspaceSessionCatalog({
  mode,
  workspaceId,
  filters,
  source = "strict",
  enabled = true,
}: {
  mode: WorkspaceSessionCatalogMode;
  workspaceId: string | null;
  filters: WorkspaceSessionCatalogFilters;
  source?: WorkspaceSessionCatalogSource;
  enabled?: boolean;
}) {
  const [entries, setEntries] = useState<WorkspaceSessionCatalogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [partialSource, setPartialSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const requestSeqRef = useRef(0);
  const query = useMemo(() => toQuery(filters), [filters]);

  const loadPage = useCallback(
    async (pageMode: "replace" | "append", cursor?: string | null) => {
      const requestId = requestSeqRef.current + 1;
      requestSeqRef.current = requestId;
      const relatedEngineFilteredOut =
        mode === "project" &&
        source === "related" &&
        Boolean(filters.engine) &&
        filters.engine !== "codex";

      if (!enabled || relatedEngineFilteredOut || (mode === "project" && !workspaceId)) {
        setEntries([]);
        setNextCursor(null);
        setPartialSource(null);
        setError(null);
        setIsLoading(false);
        setIsLoadingMore(false);
        return;
      }

      if (pageMode === "append") {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      try {
        const response =
          mode === "global"
            ? await bridge.listGlobalCodexSessions({
                query: { ...query, engine: "codex" },
                cursor: cursor ?? null,
                limit: SESSION_CATALOG_PAGE_SIZE,
              })
            : source === "related"
              ? await bridge.listProjectRelatedCodexSessions(workspaceId!, {
                  query: { ...query, engine: "codex" },
                  cursor: cursor ?? null,
                  limit: SESSION_CATALOG_PAGE_SIZE,
                })
              : await bridge.listWorkspaceSessions(workspaceId!, {
                  query,
                  cursor: cursor ?? null,
                  limit: SESSION_CATALOG_PAGE_SIZE,
                });

        if (requestSeqRef.current !== requestId) {
          return;
        }

        setEntries((current) =>
          pageMode === "append"
            ? [...current, ...(response.data ?? [])]
            : response.data ?? [],
        );
        setNextCursor(response.nextCursor ?? null);
        setPartialSource(response.partialSource ?? null);
        setError(null);
      } catch (incomingError) {
        if (requestSeqRef.current !== requestId) {
          return;
        }
        if (pageMode !== "append") {
          setEntries([]);
          setNextCursor(null);
          setPartialSource(null);
        }
        setError(normalizeErrorMessage(incomingError));
      } finally {
        if (requestSeqRef.current === requestId) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [enabled, filters.engine, mode, query, source, workspaceId],
  );

  useEffect(() => {
    void loadPage("replace", null);
  }, [loadPage]);

  const reload = useCallback(async () => {
    await loadPage("replace", null);
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) {
      return;
    }
    await loadPage("append", nextCursor);
  }, [isLoadingMore, loadPage, nextCursor]);

  const mutate = useCallback(
    async (
      kind: MutationKind,
      selectedEntries: WorkspaceSessionCatalogEntry[],
    ): Promise<WorkspaceSessionCatalogMutationResponse> => {
      if (mode === "project" && !workspaceId) {
        throw new Error("workspace_id is required");
      }
      if (selectedEntries.length === 0) {
        return { results: [] };
      }

      setIsMutating(true);
      try {
        const entriesByWorkspaceId = new Map<string, WorkspaceSessionCatalogEntry[]>();
        const unresolvedEntries: WorkspaceSessionCatalogMutationResult[] = [];

        selectedEntries.forEach((entry) => {
          if (entry.workspaceId === UNASSIGNED_WORKSPACE_ID) {
            unresolvedEntries.push({
              selectionKey: buildWorkspaceSessionSelectionKey(entry),
              sessionId: entry.sessionId,
              workspaceId: entry.workspaceId,
              ok: false,
              archivedAt: null,
              error:
                "这条会话还没有解析出唯一归属项目，当前不能直接归档、取消归档或删除。",
              code: OWNER_UNRESOLVED_CODE,
            });
            return;
          }

          const bucket = entriesByWorkspaceId.get(entry.workspaceId) ?? [];
          bucket.push(entry);
          entriesByWorkspaceId.set(entry.workspaceId, bucket);
        });

        const mutationResults: WorkspaceSessionCatalogMutationResult[] = [
          ...unresolvedEntries,
        ];

        for (const [entryWorkspaceId, entryBucket] of entriesByWorkspaceId) {
          const sessionIds = entryBucket.map((entry) => entry.sessionId);
          const selectionKeyBySessionId = new Map(
            entryBucket.map((entry) => [
              entry.sessionId,
              buildWorkspaceSessionSelectionKey(entry),
            ]),
          );

          try {
            let response: WorkspaceSessionBatchMutationResponse;
            if (kind === "archive") {
              response = await bridge.archiveWorkspaceSessions(entryWorkspaceId, sessionIds);
            } else if (kind === "unarchive") {
              response = await bridge.unarchiveWorkspaceSessions(
                entryWorkspaceId,
                sessionIds,
              );
            } else {
              response = await bridge.deleteWorkspaceSessions(entryWorkspaceId, sessionIds);
            }

            const respondedSessionIds = new Set<string>();
            response.results.forEach((item) => {
              respondedSessionIds.add(item.sessionId);
              mutationResults.push({
                selectionKey:
                  selectionKeyBySessionId.get(item.sessionId) ??
                  `${entryWorkspaceId}::${item.sessionId}`,
                sessionId: item.sessionId,
                workspaceId: entryWorkspaceId,
                ok: item.ok,
                archivedAt: item.archivedAt,
                error: item.error,
                code: item.code,
              });
            });

            entryBucket.forEach((entry) => {
              if (respondedSessionIds.has(entry.sessionId)) {
                return;
              }
              mutationResults.push({
                selectionKey: buildWorkspaceSessionSelectionKey(entry),
                sessionId: entry.sessionId,
                workspaceId: entry.workspaceId,
                ok: false,
                archivedAt: null,
                error: "会话治理结果不完整，请刷新后重试。",
                code: MISSING_MUTATION_RESULT_CODE,
              });
            });
          } catch (error) {
            entryBucket.forEach((entry) => {
              mutationResults.push({
                selectionKey: buildWorkspaceSessionSelectionKey(entry),
                sessionId: entry.sessionId,
                workspaceId: entry.workspaceId,
                ok: false,
                archivedAt: null,
                error: normalizeErrorMessage(error),
                code: "MUTATION_REQUEST_FAILED",
              });
            });
          }
        }

        const succeededSelectionKeys = mutationResults
          .filter((item) => item.ok)
          .map((item) => item.selectionKey);
        if (succeededSelectionKeys.length > 0) {
          const succeededSelectionKeySet = new Set(succeededSelectionKeys);
          setEntries((current) => {
            if (kind === "delete") {
              return current.filter(
                (entry) =>
                  !succeededSelectionKeySet.has(
                    buildWorkspaceSessionSelectionKey(entry),
                  ),
              );
            }
            if (filters.status === "all") {
              return patchArchivedState(current, mutationResults);
            }
            return current.filter(
              (entry) =>
                !succeededSelectionKeySet.has(buildWorkspaceSessionSelectionKey(entry)),
            );
          });
        }
        return { results: mutationResults };
      } finally {
        setIsMutating(false);
      }
    },
    [filters.status, mode, workspaceId],
  );

  return {
    entries,
    nextCursor,
    partialSource,
    error,
    isLoading,
    isLoadingMore,
    isMutating,
    reload,
    loadMore,
    mutate,
  };
}

function useWorkspaceSessionProjectionSummary({
  workspaceId,
  query,
  enabled = true,
}: {
  workspaceId: string | null;
  query?: WorkspaceSessionCatalogQuery | null;
  enabled?: boolean;
}) {
  const [summary, setSummary] = useState<WorkspaceSessionProjectionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const normalizedQuery = useMemo(
    () => ({
      keyword: query?.keyword?.trim() || null,
      engine: query?.engine?.trim() || null,
      status: query?.status ?? "active",
    }),
    [query],
  );

  const load = useCallback(async () => {
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;

    if (!enabled || !workspaceId) {
      setSummary(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const nextSummary = await bridge.getWorkspaceSessionProjectionSummary(workspaceId, {
        query: normalizedQuery,
      });
      if (requestSeqRef.current !== requestId) {
        return;
      }
      setSummary(nextSummary);
      setError(null);
    } catch (incomingError) {
      if (requestSeqRef.current !== requestId) {
        return;
      }
      setSummary(null);
      setError(normalizeErrorMessage(incomingError));
    } finally {
      if (requestSeqRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [enabled, normalizedQuery, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    summary,
    error,
    isLoading,
    reload: load,
  };
}

export function DesktopSessionManagementSection({
  title,
  description,
  workspaces,
  initialWorkspaceId = null,
  onSessionsMutated,
}: DesktopSessionManagementSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const workspaceOptions = useMemo(() => buildWorkspaceOptions(workspaces), [workspaces]);
  const workspaceLabelById = useMemo(
    () => new Map(workspaceOptions.map((option) => [option.id, option.label])),
    [workspaceOptions],
  );
  const workspacePickerLabelById = useMemo(
    () => new Map(workspaceOptions.map((option) => [option.id, option.pickerLabel])),
    [workspaceOptions],
  );
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    initialWorkspaceId && workspaceOptions.some((item) => item.id === initialWorkspaceId)
      ? initialWorkspaceId
      : workspaceOptions[0]?.id ?? null,
  );
  const [mode, setMode] = useState<WorkspaceSessionCatalogMode>("project");
  const [filters, setFilters] = useState<WorkspaceSessionCatalogFilters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Record<string, true>>({});
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const summaryQuery = useMemo(
    () => ({
      keyword: filters.keyword,
      engine: mode === "project" ? filters.engine : "",
      status: filters.status,
    }),
    [filters.engine, filters.keyword, filters.status, mode],
  );

  const {
    summary: projectionSummary,
    error: projectionSummaryError,
    isLoading: projectionSummaryLoading,
    reload: reloadProjectionSummary,
  } = useWorkspaceSessionProjectionSummary({
    workspaceId: mode === "project" ? workspaceId : null,
    query: summaryQuery,
    enabled: mode === "project" && Boolean(workspaceId),
  });

  const {
    entries: primaryEntries,
    nextCursor: primaryNextCursor,
    partialSource: primaryPartialSource,
    error: primaryError,
    isLoading: primaryIsLoading,
    isLoadingMore: primaryIsLoadingMore,
    isMutating,
    reload: reloadPrimary,
    loadMore: loadMorePrimary,
    mutate,
  } = useWorkspaceSessionCatalog({
    mode,
    workspaceId,
    filters,
    source: "strict",
  });

  const {
    entries: relatedEntries,
    nextCursor: relatedNextCursor,
    partialSource: relatedPartialSource,
    error: relatedError,
    isLoading: relatedIsLoading,
    isLoadingMore: relatedIsLoadingMore,
    reload: reloadRelated,
    loadMore: loadMoreRelated,
  } = useWorkspaceSessionCatalog({
    mode: "project",
    workspaceId,
    filters,
    source: "related",
    enabled: mode === "project",
  });

  const visibleEntries = useMemo(
    () => (mode === "global" ? primaryEntries : [...primaryEntries, ...relatedEntries]),
    [mode, primaryEntries, relatedEntries],
  );
  const visiblePrimaryCount = primaryEntries.length;
  const filteredTotalCount =
    mode === "project"
      ? projectionSummary?.filteredTotal ?? visiblePrimaryCount
      : primaryEntries.length;
  const currentPageVisibleCount = visiblePrimaryCount;
  const activeProjectionOwnerCount = projectionSummary?.ownerWorkspaceIds.length ?? 0;
  const activeTotalCount = projectionSummary?.activeTotal ?? 0;
  const summaryPartialSource =
    projectionSummary?.partialSources && projectionSummary.partialSources.length > 0
      ? projectionSummary.partialSources.join(",")
      : null;
  const primaryPartialSourceNotice =
    primaryPartialSource && primaryPartialSource !== summaryPartialSource
      ? primaryPartialSource
      : null;
  const selectedWorkspace = useMemo(
    () => workspaces.find((entry) => entry.id === workspaceId) ?? null,
    [workspaceId, workspaces],
  );

  const selectedCount = useMemo(() => Object.keys(selectedIds).length, [selectedIds]);
  const allSelected =
    visibleEntries.length > 0 &&
    visibleEntries.every((entry) =>
      Boolean(selectedIds[buildWorkspaceSessionSelectionKey(entry)]),
    );

  const toggleSelection = (selectionKey: string) => {
    setSelectedIds((current) => {
      if (current[selectionKey]) {
        const next = { ...current };
        delete next[selectionKey];
        return next;
      }
      return { ...current, [selectionKey]: true };
    });
  };

  const resetSelection = () => {
    setSelectedIds({});
    setDeleteArmed(false);
  };

  const keepOnlySelected = (selectionKeys: string[]) => {
    const next: Record<string, true> = {};
    selectionKeys.forEach((selectionKey) => {
      next[selectionKey] = true;
    });
    setSelectedIds(next);
    setDeleteArmed(false);
  };

  const handleSelectAll = () => {
    const next: Record<string, true> = {};
    visibleEntries.forEach((entry) => {
      next[buildWorkspaceSessionSelectionKey(entry)] = true;
    });
    setSelectedIds(next);
  };

  const handleWorkspaceChange = (nextWorkspaceId: string | null) => {
    setWorkspaceId(nextWorkspaceId || null);
    resetSelection();
    setNotice(null);
  };

  const handleFiltersChange = (
    nextFilters: Partial<WorkspaceSessionCatalogFilters>,
  ) => {
    setFilters((current) => ({ ...current, ...nextFilters }));
    resetSelection();
    setNotice(null);
  };

  const handleRefresh = async () => {
    await Promise.all([
      reloadPrimary(),
      mode === "project" ? reloadRelated() : Promise.resolve(),
      mode === "project" && workspaceId
        ? reloadProjectionSummary()
        : Promise.resolve(),
    ]);
    resetSelection();
  };

  const handleModeChange = (nextMode: WorkspaceSessionCatalogMode) => {
    setMode(nextMode);
    resetSelection();
    setNotice(null);
  };

  useEffect(() => {
    if (workspaceOptions.length === 0) {
      if (workspaceId !== null) {
        setWorkspaceId(null);
      }
      return;
    }
    if (workspaceId && workspaceLabelById.has(workspaceId)) {
      return;
    }
    setWorkspaceId(workspaceOptions[0]?.id ?? null);
  }, [workspaceId, workspaceLabelById, workspaceOptions]);

  const handleMutation = async (kind: MutationKind) => {
    const selectedEntries = visibleEntries.filter((entry) =>
      Boolean(selectedIds[buildWorkspaceSessionSelectionKey(entry)]),
    );
    if (selectedEntries.length === 0) {
      return;
    }

    const relatedSelectionKeys = new Set(
      relatedEntries.map((entry) => buildWorkspaceSessionSelectionKey(entry)),
    );
    const hasSelectedRelatedEntry = selectedEntries.some((entry) =>
      relatedSelectionKeys.has(buildWorkspaceSessionSelectionKey(entry)),
    );

    if (kind === "delete" && !deleteArmed) {
      setDeleteArmed(true);
      return;
    }

    try {
      const response = await mutate(kind, selectedEntries);
      const succeeded = response.results.filter((item) => item.ok);
      const failed = response.results.filter((item) => !item.ok);

      if (failed.length === 0) {
        setNotice({
          kind: "success",
          text:
            kind === "archive"
              ? `已归档 ${succeeded.length} 条会话。`
              : kind === "unarchive"
                ? `已取消归档 ${succeeded.length} 条会话。`
                : `已删除 ${succeeded.length} 条会话。`,
        });
      } else {
        setNotice({
          kind: "error",
          text: `已处理 ${succeeded.length} 条，${failed.length} 条失败。${failed
            .map((item) => resolveMutationFailureReason(item))
            .join(" · ")}`,
        });
      }

      const shouldReloadPrimary = kind !== "delete" || failed.length > 0;
      const shouldReloadRelated =
        mode === "project" && (shouldReloadPrimary || hasSelectedRelatedEntry);
      const shouldReloadProjectionSummary =
        mode === "project" && Boolean(workspaceId);

      if (shouldReloadPrimary || shouldReloadRelated) {
        void Promise.all([
          shouldReloadPrimary ? reloadPrimary() : Promise.resolve(),
          shouldReloadRelated ? reloadRelated() : Promise.resolve(),
          shouldReloadProjectionSummary
            ? reloadProjectionSummary()
            : Promise.resolve(),
        ]);
      } else if (shouldReloadProjectionSummary) {
        void reloadProjectionSummary();
      }

      collectSucceededWorkspaceIds(response.results).forEach((ownerWorkspaceId) => {
        onSessionsMutated?.(ownerWorkspaceId);
      });

      if (failed.length > 0) {
        keepOnlySelected(failed.map((item) => item.selectionKey));
      } else {
        resetSelection();
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: normalizeErrorMessage(error),
      });
    }
  };

  const expandCount = mode === "global" ? primaryEntries.length : filteredTotalCount;
  const showProjectStrictEmpty =
    mode === "project" && !primaryIsLoading && primaryEntries.length === 0;
  const showRelatedSection =
    mode === "project" &&
    (relatedIsLoading ||
      Boolean(relatedError) ||
      Boolean(relatedPartialSource) ||
      relatedEntries.length > 0);

  return (
    <div className={`settings-project-sessions${expanded ? " is-open" : ""}`}>
      <button
        type="button"
        className={`settings-project-sessions-expand-btn${
          expanded ? " is-open" : ""
        }`}
        onClick={() => setExpanded((current) => !current)}
        data-testid="settings-project-sessions-expand-toggle"
      >
        {expanded ? (
          <ChevronDown
            className="settings-project-sessions-expand-icon"
            size={14}
            aria-hidden
          />
        ) : (
          <ChevronRight
            className="settings-project-sessions-expand-icon"
            size={14}
            aria-hidden
          />
        )}
        <span className="settings-project-sessions-expand-label">{title}</span>
        <span className="settings-project-sessions-expand-count">
          ({formatCount(expandCount)})
        </span>
      </button>

      {expanded ? (
        <div className="mt-4 space-y-4">
          <div className="settings-project-sessions-header">
            <div className="settings-project-sessions-title-wrap">
              <h3 className="text-sm font-semibold">{title}</h3>
              <p>{description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="dcc-action-button secondary"
                onClick={() => void handleRefresh()}
                disabled={
                  (mode === "project" && !workspaceId) || primaryIsLoading || isMutating
                }
              >
                <RotateCw
                  size={14}
                  aria-hidden
                  className={primaryIsLoading ? "dcc-spin" : ""}
                />
                刷新会话
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={cx(
                "dcc-action-button secondary",
                mode === "project" && "is-active",
              )}
              onClick={() => handleModeChange("project")}
            >
              项目视图
            </button>
            <button
              type="button"
              className={cx(
                "dcc-action-button secondary",
                mode === "global" && "is-active",
              )}
              onClick={() => handleModeChange("global")}
            >
              全局归档
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(180px,1.1fr)_minmax(160px,.8fr)_minmax(140px,.7fr)_minmax(140px,.7fr)]">
            {mode === "project" ? (
              workspaceOptions.length > 0 ? (
                <Select value={workspaceId ?? ""} onValueChange={handleWorkspaceChange}>
                  <SelectTrigger data-testid="settings-project-sessions-workspace-picker-trigger">
                    <span className="truncate">
                      {workspaceId
                        ? workspacePickerLabelById.get(workspaceId)
                        : "工作区"}
                    </span>
                  </SelectTrigger>
                  <SelectPopup>
                    {workspaceOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.pickerLabel}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : (
                <div className="rounded-md border px-3 py-2 text-sm text-slate-500">
                  暂无可用工作区
                </div>
              )
            ) : (
              <div className="rounded-md border px-3 py-2 text-sm text-slate-500">
                全局历史当前仅展示这个客户端可见的 Codex 会话。
              </div>
            )}

            <input
              value={filters.keyword}
              onChange={(event) =>
                handleFiltersChange({ keyword: event.target.value })
              }
              placeholder="搜索会话标题、ID 或来源..."
              aria-label="搜索会话标题、ID 或来源..."
              className="dcc-search-input"
            />

            {mode === "project" ? (
              <Select
                value={filters.engine || ENGINE_FILTER_ALL_VALUE}
                onValueChange={(value) =>
                  handleFiltersChange({
                    engine:
                      value === ENGINE_FILTER_ALL_VALUE || value == null ? "" : value,
                  })
                }
              >
                <SelectTrigger>
                  <span className="truncate">
                    {ENGINE_LABELS[(filters.engine || "all").toString()] ??
                      ENGINE_LABELS.all}
                  </span>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={ENGINE_FILTER_ALL_VALUE}>
                    {ENGINE_LABELS.all}
                  </SelectItem>
                  <SelectItem value="codex">{ENGINE_LABELS.codex}</SelectItem>
                  <SelectItem value="claude">{ENGINE_LABELS.claude}</SelectItem>
                  <SelectItem value="gemini">{ENGINE_LABELS.gemini}</SelectItem>
                  <SelectItem value="opencode">{ENGINE_LABELS.opencode}</SelectItem>
                </SelectPopup>
              </Select>
            ) : (
              <div className="rounded-md border px-3 py-2 text-sm text-slate-500">
                Codex
              </div>
            )}

            <Select
              value={filters.status}
              onValueChange={(value) =>
                handleFiltersChange({
                  status: value as WorkspaceSessionCatalogStatus,
                })
              }
            >
              <SelectTrigger>
                <span>{statusFilterLabel(filters.status)}</span>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="active">仅显示活跃</SelectItem>
                <SelectItem value="archived">仅显示归档</SelectItem>
                <SelectItem value="all">显示全部</SelectItem>
              </SelectPopup>
            </Select>
          </div>

          <div className="settings-project-sessions-toolbar">
            <span className="settings-project-sessions-selected">
              已选 {formatCount(selectedCount)} 条
            </span>
            {mode === "project" ? (
              <span className="settings-project-sessions-selected">
                筛选后共 {formatCount(filteredTotalCount)} 条
              </span>
            ) : null}
            {mode === "project" ? (
              <span className="settings-project-sessions-selected">
                当前页 {formatCount(currentPageVisibleCount)} 条
              </span>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="settings-project-sessions-btn"
                onClick={handleSelectAll}
                disabled={visibleEntries.length === 0 || allSelected}
              >
                全选
              </button>
              <button
                type="button"
                className="settings-project-sessions-btn"
                onClick={resetSelection}
                disabled={selectedCount === 0}
              >
                取消全选
              </button>
              <button
                type="button"
                className="settings-project-sessions-btn"
                onClick={() => void handleMutation("archive")}
                disabled={selectedCount === 0 || isMutating}
              >
                <Archive size={14} aria-hidden />
                归档已选
              </button>
              <button
                type="button"
                className="settings-project-sessions-btn"
                onClick={() => void handleMutation("unarchive")}
                disabled={selectedCount === 0 || isMutating}
              >
                <Undo2 size={14} aria-hidden />
                取消归档
              </button>
              <button
                type="button"
                className="settings-project-sessions-btn is-danger"
                onClick={() => void handleMutation("delete")}
                disabled={selectedCount === 0 || isMutating}
                data-testid="settings-project-sessions-delete-selected"
              >
                <Trash2 size={14} aria-hidden />
                {deleteArmed
                  ? `确认删除 ${formatCount(selectedCount)} 条`
                  : "删除已选"}
              </button>
            </div>
          </div>

          {notice ? (
            <div className={`settings-project-sessions-notice is-${notice.kind}`}>
              {notice.text}
            </div>
          ) : null}
          {mode === "project" && filters.status !== "active" ? (
            <div className="settings-project-sessions-notice">
              当前筛选为“{statusFilterLabel(filters.status)}”；侧边栏默认只显示活跃且未归档的会话，所以数量可能更少。
            </div>
          ) : null}
          {mode === "project" && filteredTotalCount > currentPageVisibleCount ? (
            <div className="settings-project-sessions-notice">
              当前页只加载了 {formatCount(currentPageVisibleCount)} 条，但这个筛选条件下的项目总量是{" "}
              {formatCount(filteredTotalCount)} 条。
            </div>
          ) : null}
          {mode === "project" && activeProjectionOwnerCount > 1 ? (
            <div className="settings-project-sessions-notice">
              默认 active projection 当前覆盖 {formatCount(activeProjectionOwnerCount)} 个
              workspace，共 {formatCount(activeTotalCount)} 条活跃会话。
            </div>
          ) : null}
          {selectedWorkspace?.locationKind === "ssh" ? (
            <div className="settings-project-sessions-notice">
              远程 SSH 工作区当前只支持展示本机可见历史，结果可能为空。
            </div>
          ) : null}
          {projectionSummaryLoading ? (
            <div className="settings-project-sessions-notice">
              正在同步共享项目投影...
            </div>
          ) : null}
          {projectionSummaryError ? (
            <div className="settings-project-sessions-notice is-error">
              {projectionSummaryError}
            </div>
          ) : null}
          {summaryPartialSource ? (
            <div className="settings-project-sessions-notice">
              当前结果包含降级来源：{summaryPartialSource}
            </div>
          ) : null}
          {primaryPartialSourceNotice ? (
            <div className="settings-project-sessions-notice">
              当前结果包含降级来源：{primaryPartialSourceNotice}
            </div>
          ) : null}
          {primaryError ? (
            <div className="settings-project-sessions-notice is-error">
              {primaryError}
            </div>
          ) : null}

          {mode === "project" && !workspaceId ? (
            <div className="settings-project-sessions-empty">请先选择一个项目。</div>
          ) : primaryIsLoading ? (
            <div className="settings-project-sessions-empty">正在加载会话...</div>
          ) : mode === "global" && primaryEntries.length === 0 ? (
            <div className="settings-project-sessions-empty space-y-3">
              <div>当前没有可见的全局 Codex 历史。</div>
            </div>
          ) : (
            <>
              {mode === "project" ? (
                <>
                  {showProjectStrictEmpty ? (
                    <div className="settings-project-sessions-empty space-y-3">
                      <div>该项目暂无会话。</div>
                      <div className="text-sm text-slate-500">
                        这里显示的是当前项目 strict 命中的真实会话；为空不代表这台机器没有其他可见历史。
                      </div>
                      <button
                        type="button"
                        className="dcc-action-button secondary"
                        onClick={() => handleModeChange("global")}
                      >
                        查看全局归档
                      </button>
                    </div>
                  ) : (
                    <SessionListSection
                      title="Strict 项目会话"
                      entries={primaryEntries}
                      selectedIds={selectedIds}
                      workspaceLabelById={workspaceLabelById}
                      locale="zh-CN"
                      onToggleSelection={toggleSelection}
                    />
                  )}

                  {primaryNextCursor ? (
                    <div className="flex justify-center">
                      <button
                        type="button"
                        className="dcc-action-button secondary"
                        onClick={() => void loadMorePrimary()}
                        disabled={primaryIsLoadingMore}
                      >
                        {primaryIsLoadingMore ? "加载更多中..." : "加载更多"}
                      </button>
                    </div>
                  ) : null}

                  {showRelatedSection ? (
                    <div className="space-y-3">
                      {relatedPartialSource ? (
                        <div className="settings-project-sessions-notice">
                          当前结果包含降级来源：{relatedPartialSource}
                        </div>
                      ) : null}
                      {relatedError ? (
                        <div className="settings-project-sessions-notice is-error">
                          {relatedError}
                        </div>
                      ) : null}
                      {relatedIsLoading ? (
                        <div className="settings-project-sessions-empty">
                          正在加载会话...
                        </div>
                      ) : relatedEntries.length > 0 ? (
                        <>
                          <SessionListSection
                            title="Related 历史"
                            description="这些结果和当前项目有关，但不是 strict path 命中。"
                            entries={relatedEntries}
                            selectedIds={selectedIds}
                            workspaceLabelById={workspaceLabelById}
                            locale="zh-CN"
                            onToggleSelection={toggleSelection}
                          />
                          {relatedNextCursor ? (
                            <div className="flex justify-center">
                              <button
                                type="button"
                                className="dcc-action-button secondary"
                                onClick={() => void loadMoreRelated()}
                                disabled={relatedIsLoadingMore}
                              >
                                {relatedIsLoadingMore ? "加载更多中..." : "加载更多"}
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <SessionListSection
                    title="全局 Codex 历史"
                    description="这里展示当前客户端本机可见的 Codex 历史全集。"
                    entries={primaryEntries}
                    selectedIds={selectedIds}
                    workspaceLabelById={workspaceLabelById}
                    locale="zh-CN"
                    onToggleSelection={toggleSelection}
                  />
                  {primaryNextCursor ? (
                    <div className="flex justify-center">
                      <button
                        type="button"
                        className="dcc-action-button secondary"
                        onClick={() => void loadMorePrimary()}
                        disabled={primaryIsLoadingMore}
                      >
                        {primaryIsLoadingMore ? "加载更多中..." : "加载更多"}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
