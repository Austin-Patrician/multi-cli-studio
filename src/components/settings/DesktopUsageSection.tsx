import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CreditCard,
  GitCommitHorizontal,
  Layers3,
  MessageSquare,
  RefreshCw,
  Sigma,
} from "lucide-react";
import { bridge } from "../../lib/bridge";
import type {
  LocalUsageDailyCodeChange,
  LocalUsageDailyUsage,
  LocalUsageSessionSummary,
  LocalUsageStatistics,
  WorkspaceRef,
} from "../../lib/models";

type UsageScope = "current" | "all";
type UsageTab = "overview" | "models" | "sessions" | "timeline";
type DateRange = "7d" | "30d" | "all";

const SESSIONS_PER_PAGE = 20;

function formatNumber(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  if (safe >= 1_000_000_000) return `${(safe / 1_000_000_000).toFixed(1)}B`;
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1)}M`;
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}K`;
  return Math.max(0, Math.round(safe)).toString();
}

function formatCost(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `$${safe.toFixed(4)}`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays}天前`;

  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;

  return formatDate(timestamp);
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return dateStr;
  }
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKeyToLocalTimestamp(dateStr: string): number {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (matched) {
    const year = Number.parseInt(matched[1], 10);
    const month = Number.parseInt(matched[2], 10);
    const day = Number.parseInt(matched[3], 10);
    const localDate = new Date(year, month - 1, day);
    if (!Number.isNaN(localDate.getTime())) {
      return localDate.getTime();
    }
  }
  const fallback = new Date(dateStr).getTime();
  return Number.isFinite(fallback) ? fallback : 0;
}

function filterByDateRange<T extends { timestamp?: number; date?: string }>(items: T[], dateRange: DateRange) {
  if (dateRange === "all") return items;
  const now = Date.now();
  const cutoff =
    dateRange === "7d" ? now - 7 * 24 * 60 * 60 * 1000 : now - 30 * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    const time = item.timestamp ?? (item.date ? parseDateKeyToLocalTimestamp(item.date) : 0);
    return time >= cutoff;
  });
}

function calculateTrend(current: number, last: number) {
  if (!last) return 0;
  return ((current - last) / last) * 100;
}

function renderTrend(value: number) {
  if (value === 0) {
    return <span className="settings-usage-trend neutral">→ 0% 对比上周</span>;
  }
  const isUp = value > 0;
  return (
    <span className={`settings-usage-trend ${isUp ? "up" : "down"}`}>
      {isUp ? "↑" : "↓"} {Math.abs(value).toFixed(1)}% 对比上周
    </span>
  );
}

export function DesktopUsageSection({
  activeWorkspace,
  workspaces,
}: {
  activeWorkspace: WorkspaceRef | null;
  workspaces: WorkspaceRef[];
}) {
  const [scope, setScope] = useState<UsageScope>("current");
  const [activeTab, setActiveTab] = useState<UsageTab>("overview");
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionSortBy, setSessionSortBy] = useState<"cost" | "time">("cost");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statistics, setStatistics] = useState<LocalUsageStatistics | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(activeWorkspace?.id ?? workspaces[0]?.id ?? "");
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    content: { date: string; cost: number; sessions: number };
  }>({
    visible: false,
    x: 0,
    y: 0,
    content: { date: "", cost: 0, sessions: 0 },
  });

  useEffect(() => {
    if (activeWorkspace?.id) {
      setSelectedWorkspaceId((current) => current || activeWorkspace.id);
    } else if (!selectedWorkspaceId && workspaces[0]?.id) {
      setSelectedWorkspaceId(workspaces[0].id);
    }
  }, [activeWorkspace?.id, selectedWorkspaceId, workspaces]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? activeWorkspace ?? null,
    [activeWorkspace, selectedWorkspaceId, workspaces]
  );

  const loadStatistics = useCallback(async () => {
    if (scope === "current" && !selectedWorkspace?.rootPath) {
      setStatistics(null);
      setError("请选择一个工作区后再查看当前项目的使用统计。");
      return;
    }
    if (scope === "current" && selectedWorkspace?.locationKind === "ssh") {
      setStatistics(null);
      setError("远程 SSH 工作区暂不支持本地使用统计。");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await bridge.localUsageStatistics({
        scope,
        provider: "all",
        dateRange,
        workspacePath: scope === "current" ? selectedWorkspace?.rootPath ?? null : null,
      });
      setStatistics(next);
    } catch (loadError) {
      setStatistics(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [dateRange, scope, selectedWorkspace?.rootPath]);

  useEffect(() => {
    void loadStatistics();
  }, [loadStatistics]);

  useEffect(() => {
    setSessionPage(1);
  }, [scope, dateRange]);

  const filteredSessions = useMemo(() => {
    const source = filterByDateRange<LocalUsageSessionSummary>(statistics?.sessions ?? [], dateRange);
    return source.slice().sort((a, b) => {
      if (sessionSortBy === "cost") return b.cost - a.cost;
      return b.timestamp - a.timestamp;
    });
  }, [dateRange, sessionSortBy, statistics?.sessions]);

  const paginatedSessions = useMemo(
    () => filteredSessions.slice((sessionPage - 1) * SESSIONS_PER_PAGE, sessionPage * SESSIONS_PER_PAGE),
    [filteredSessions, sessionPage]
  );
  const totalPages = Math.max(1, Math.ceil(filteredSessions.length / SESSIONS_PER_PAGE));

  const filteredDailyUsage = useMemo(
    () => filterByDateRange<LocalUsageDailyUsage>(statistics?.dailyUsage ?? [], dateRange),
    [dateRange, statistics?.dailyUsage]
  );
  const filteredDailyCodeChanges = useMemo(
    () =>
      filterByDateRange<LocalUsageDailyCodeChange>(statistics?.dailyCodeChanges ?? [], dateRange).map((item) => ({
        ...item,
        modifiedLines: Math.max(0, item.modifiedLines),
      })),
    [dateRange, statistics?.dailyCodeChanges]
  );
  const engineUsageItems = useMemo(
    () =>
      (statistics?.engineUsage ?? []).map((item) => ({
        ...item,
        count: Math.max(0, item.count),
      })),
    [statistics?.engineUsage]
  );

  const maxDailyCost = useMemo(() => Math.max(1, ...filteredDailyUsage.map((day) => day.cost)), [filteredDailyUsage]);
  const maxEngineUsageCount = useMemo(
    () => Math.max(1, ...engineUsageItems.map((item) => item.count)),
    [engineUsageItems]
  );
  const maxDailyCodeLines = useMemo(
    () => Math.max(1, ...filteredDailyCodeChanges.map((item) => item.modifiedLines)),
    [filteredDailyCodeChanges]
  );

  const weeklyComparison = statistics?.weeklyComparison ?? {
    currentWeek: { sessions: 0, cost: 0, tokens: 0 },
    lastWeek: { sessions: 0, cost: 0, tokens: 0 },
    trends: { sessions: 0, cost: 0, tokens: 0 },
  };
  const totalUsage = statistics?.totalUsage ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
  };

  const totalEngineUsageCount =
    statistics?.totalEngineUsageCount ??
    engineUsageItems.reduce((sum, item) => sum + Math.max(0, item.count), 0);
  const aiCodeModifiedLines =
    statistics?.aiCodeModifiedLines ??
    filteredDailyCodeChanges.reduce((sum, item) => sum + Math.max(0, item.modifiedLines), 0);

  const getTokenPercentage = useCallback(
    (value: number) => {
      if (!statistics || totalUsage.totalTokens === 0) return 0;
      return (value / totalUsage.totalTokens) * 100;
    },
    [statistics, totalUsage.totalTokens]
  );

  return (
    <section className="settings-section">
      <div className="settings-section-title">使用统计</div>
      <div className="settings-section-subtitle">查看 CLI 会话的 Token 消耗、预估成本和使用趋势。</div>
      <div className="settings-usage-workspace-picker">
        {workspaces.length > 0 ? (
          <div className="settings-select-wrap">
            <select
              className="settings-select"
              value={selectedWorkspaceId}
              onChange={(event) => setSelectedWorkspaceId(event.target.value)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="settings-inline-muted">当前还没有可用工作区。</div>
        )}
      </div>

      <div className="settings-usage-panel">
        <div className="settings-usage-notice">
          <span>!</span>
          当前统计主要用于趋势参考，不建议作为正式计费凭据。
        </div>

        <div className="settings-usage-controls">
          <div className="settings-usage-controls-left">
            <div className="settings-usage-segmented">
              <button
                type="button"
                className={`settings-usage-segmented-btn ${scope === "current" ? "active" : ""}`}
                onClick={() => setScope("current")}
              >
                当前项目
              </button>
              <button
                type="button"
                className={`settings-usage-segmented-btn ${scope === "all" ? "active" : ""}`}
                onClick={() => setScope("all")}
              >
                全部项目
              </button>
            </div>

            <div className="settings-usage-segmented settings-usage-segmented--range">
              <button
                type="button"
                className={`settings-usage-segmented-btn ${dateRange === "7d" ? "active" : ""}`}
                onClick={() => setDateRange("7d")}
              >
                近 7 天
              </button>
              <button
                type="button"
                className={`settings-usage-segmented-btn ${dateRange === "30d" ? "active" : ""}`}
                onClick={() => setDateRange("30d")}
              >
                近 30 天
              </button>
              <button
                type="button"
                className={`settings-usage-segmented-btn ${dateRange === "all" ? "active" : ""}`}
                onClick={() => setDateRange("all")}
              >
                全部
              </button>
            </div>
          </div>

          <button
            type="button"
            className="dcc-action-button secondary"
            onClick={() => void loadStatistics()}
            disabled={loading}
            title="刷新使用统计"
            aria-label="刷新使用统计"
          >
            <RefreshCw size={14} className={loading ? "dcc-spin" : ""} />
          </button>
        </div>

        {statistics?.lastUpdated ? (
          <div className="settings-help">最近更新：{formatRelativeTime(statistics.lastUpdated)}</div>
        ) : null}

        {error ? <div className="settings-inline-error">{error}</div> : null}
        {loading && !statistics ? <div className="settings-inline-muted">加载中...</div> : null}
        {!loading && !statistics && !error ? <div className="settings-inline-muted">暂无使用数据。</div> : null}

        {statistics ? (
          <>
            <div className="settings-usage-tabs">
              <button type="button" className={`settings-usage-tab-btn ${activeTab === "overview" ? "active" : ""}`} onClick={() => setActiveTab("overview")}>
                <BarChart3 size={14} />
                概览
              </button>
              <button type="button" className={`settings-usage-tab-btn ${activeTab === "models" ? "active" : ""}`} onClick={() => setActiveTab("models")}>
                <Layers3 size={14} />
                模型
              </button>
              <button type="button" className={`settings-usage-tab-btn ${activeTab === "sessions" ? "active" : ""}`} onClick={() => setActiveTab("sessions")}>
                <MessageSquare size={14} />
                会话
              </button>
              <button type="button" className={`settings-usage-tab-btn ${activeTab === "timeline" ? "active" : ""}`} onClick={() => setActiveTab("timeline")}>
                <GitCommitHorizontal size={14} />
                趋势
              </button>
            </div>

            <div className="settings-usage-content">
              {activeTab === "overview" ? (
                <div className="settings-usage-overview">
                  <div className="settings-usage-project-info">
                    <span className="project-name">
                      {scope === "all" ? "全部项目" : statistics.projectName}
                    </span>
                  </div>

                  <div className="settings-usage-stat-cards">
                    <div className="settings-usage-stat-card cost-card">
                      <div className="stat-icon"><CreditCard size={18} /></div>
                      <div className="stat-content">
                        <div className="stat-label">总成本</div>
                        <div className="stat-value">{formatCost(statistics.estimatedCost)}</div>
                        {renderTrend(weeklyComparison.trends.cost)}
                      </div>
                    </div>

                    <div className="settings-usage-stat-card sessions-card">
                      <div className="stat-icon"><MessageSquare size={18} /></div>
                      <div className="stat-content">
                        <div className="stat-label">总会话数</div>
                        <div className="stat-value">{statistics.totalSessions}</div>
                        {renderTrend(weeklyComparison.trends.sessions)}
                      </div>
                    </div>

                    <div className="settings-usage-stat-card tokens-card">
                      <div className="stat-icon"><Sigma size={18} /></div>
                      <div className="stat-content">
                        <div className="stat-label">总 Token</div>
                        <div className="stat-value">{formatNumber(totalUsage.totalTokens)}</div>
                        {renderTrend(weeklyComparison.trends.tokens)}
                      </div>
                    </div>

                    <div className="settings-usage-stat-card engine-card">
                      <div className="stat-icon"><Layers3 size={18} /></div>
                      <div className="stat-content">
                        <div className="stat-label">引擎使用次数</div>
                        <div className="stat-value">{formatNumber(totalEngineUsageCount)}</div>
                      </div>
                    </div>

                    <div className="settings-usage-stat-card code-lines-card">
                      <div className="stat-icon"><GitCommitHorizontal size={18} /></div>
                      <div className="stat-content">
                        <div className="stat-label">AI 修改代码行数</div>
                        <div className="stat-value">{formatNumber(aiCodeModifiedLines)}</div>
                      </div>
                    </div>

                    <div className="settings-usage-stat-card avg-card">
                      <div className="stat-icon"><BarChart3 size={18} /></div>
                      <div className="stat-content">
                        <div className="stat-label">平均每会话成本</div>
                        <div className="stat-value">
                          {statistics.totalSessions > 0 ? formatCost(statistics.estimatedCost / statistics.totalSessions) : "$0.0000"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="settings-usage-token-breakdown">
                    <h4>Token 分解</h4>
                    <div className="settings-usage-token-breakdown-inner">
                      {[
                        { label: "输入", value: totalUsage.inputTokens, cls: "input" },
                        { label: "输出", value: totalUsage.outputTokens, cls: "output" },
                        { label: "缓存写入", value: totalUsage.cacheWriteTokens, cls: "cache-write" },
                        { label: "缓存读取", value: totalUsage.cacheReadTokens, cls: "cache-read" },
                      ].map((item) => (
                        <div key={item.label} className="settings-usage-token-row">
                          <div className="settings-usage-token-header">
                            <span>{item.label}</span>
                            <span>{formatNumber(item.value)}</span>
                          </div>
                          <div className="settings-usage-token-track">
                            <div className={`settings-usage-token-fill ${item.cls}`} style={{ width: `${getTokenPercentage(item.value)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="settings-usage-engine-distribution">
                    <h4>引擎分布</h4>
                    {engineUsageItems.length > 0 ? (
                      <div className="settings-usage-engine-list">
                        {engineUsageItems.map((item) => (
                          <div key={item.engine} className="settings-usage-engine-row">
                            <div className="settings-usage-engine-header">
                              <span>{item.engine}</span>
                              <span>{item.count}</span>
                            </div>
                            <div className="settings-usage-engine-track">
                              <div className="settings-usage-engine-fill" style={{ width: `${Math.max(0, Math.min(100, (item.count / maxEngineUsageCount) * 100))}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="settings-inline-muted">当前时间范围内暂无数据。</div>
                    )}
                  </div>

                  <div className="settings-usage-code-changes">
                    <h4>每日代码改动</h4>
                    {filteredDailyCodeChanges.length > 0 ? (
                      <div className="settings-usage-code-change-list">
                        {filteredDailyCodeChanges.map((item) => (
                          <div key={item.date} className="settings-usage-code-change-row">
                            <div className="settings-usage-code-change-header">
                              <span>{formatShortDate(item.date)}</span>
                              <span>{formatNumber(item.modifiedLines)} 行</span>
                            </div>
                            <div className="settings-usage-code-change-track">
                              <div className="settings-usage-code-change-fill" style={{ width: `${Math.max(0, Math.min(100, (item.modifiedLines / maxDailyCodeLines) * 100))}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="settings-inline-muted">当前时间范围内暂无数据。</div>
                    )}
                  </div>

                  {statistics.byModel.length > 0 ? (
                    <div className="settings-usage-top-models">
                      <h4>Top Models</h4>
                      <div className="settings-usage-top-models-list">
                        {statistics.byModel.slice(0, 3).map((model, index) => (
                          <div key={model.model} className="settings-usage-model-card">
                            <div className="model-rank">#{index + 1}</div>
                            <div className="model-info">
                              <div className="model-name">{model.model}</div>
                              <div className="model-stats">
                                <span>{formatCost(model.totalCost)}</span>
                                <span className="separator">•</span>
                                <span>{formatNumber(model.totalTokens)} tokens</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "models" ? (
                <div className="settings-usage-models-tab">
                  <h4>按模型统计</h4>
                  <div className="settings-usage-model-list">
                    {statistics.byModel.map((model) => (
                      <div key={model.model} className="settings-usage-model-item">
                        <div className="model-header">
                          <span className="model-name">{model.model}</span>
                          <span className="model-cost">{formatCost(model.totalCost)}</span>
                        </div>
                        <div className="model-details">
                          <div className="detail-item"><span className="detail-label">会话数:</span><span className="detail-value">{model.sessionCount}</span></div>
                          <div className="detail-item"><span className="detail-label">总 Token:</span><span className="detail-value">{formatNumber(model.totalTokens)}</span></div>
                          <div className="detail-item"><span className="detail-label">输入:</span><span className="detail-value">{formatNumber(model.inputTokens)}</span></div>
                          <div className="detail-item"><span className="detail-label">输出:</span><span className="detail-value">{formatNumber(model.outputTokens)}</span></div>
                        </div>
                      </div>
                    ))}
                    {statistics.byModel.length === 0 ? <div className="settings-inline-muted">当前没有模型统计数据。</div> : null}
                  </div>
                </div>
              ) : null}

              {activeTab === "sessions" ? (
                <div className="settings-usage-sessions-tab">
                  <div className="sessions-header">
                    <h4>会话列表 ({filteredSessions.length})</h4>
                    <div className="settings-usage-sort-buttons">
                      <button type="button" className={`sort-btn ${sessionSortBy === "cost" ? "active" : ""}`} onClick={() => setSessionSortBy("cost")}>按成本</button>
                      <button type="button" className={`sort-btn ${sessionSortBy === "time" ? "active" : ""}`} onClick={() => setSessionSortBy("time")}>按时间</button>
                    </div>
                  </div>

                  <div className="settings-usage-session-list">
                    {paginatedSessions.map((session, index) => (
                      <div key={session.sessionId} className="settings-usage-session-item">
                        <div className="session-rank">{(sessionPage - 1) * SESSIONS_PER_PAGE + index + 1}</div>
                        <div className="session-info">
                          <div className="session-title">{session.summary || session.sessionId}</div>
                          {session.summary ? <div className="session-id-small">{session.sessionId}</div> : null}
                          <div className="session-meta">
                            <span>{formatDate(session.timestamp)}</span>
                            <span className="separator">•</span>
                            <span>{session.model}</span>
                            <span className="separator">•</span>
                            <span>{formatNumber(session.usage.totalTokens)} tokens</span>
                          </div>
                        </div>
                        <div className="session-cost">{formatCost(session.cost)}</div>
                      </div>
                    ))}
                    {paginatedSessions.length === 0 ? <div className="settings-inline-muted">当前没有会话数据。</div> : null}
                  </div>

                  {totalPages > 1 ? (
                    <div className="settings-usage-pagination">
                      <button type="button" onClick={() => setSessionPage((prev) => Math.max(1, prev - 1))} disabled={sessionPage === 1} className="page-btn">‹</button>
                      <span className="page-info">{sessionPage} / {totalPages}</span>
                      <button type="button" onClick={() => setSessionPage((prev) => Math.min(totalPages, prev + 1))} disabled={sessionPage === totalPages} className="page-btn">›</button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "timeline" ? (
                <div className="settings-usage-timeline-tab">
                  <h4>每日趋势</h4>
                  <div className="settings-usage-timeline-chart">
                    {filteredDailyUsage.length > 0 ? (
                      <div className="settings-usage-chart-with-axis">
                        <div className="settings-usage-chart-y-axis">
                          {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
                            <div key={ratio} className="y-axis-label">{formatCost(maxDailyCost * ratio)}</div>
                          ))}
                        </div>
                        <div className="settings-usage-chart-main">
                          <div className="settings-usage-chart-grid">
                            {[0, 1, 2, 3, 4].map((index) => (
                              <div key={index} className="chart-grid-line" style={{ bottom: `${index * 25}%` }} />
                            ))}
                          </div>
                          <div className="settings-usage-chart-scroll-view">
                            <div className="settings-usage-chart-bars">
                              {filteredDailyUsage.map((day) => {
                                const height = maxDailyCost > 0 ? (day.cost / maxDailyCost) * 100 : 0;
                                return (
                                  <div key={day.date} className="chart-bar-wrapper">
                                    <div className="chart-bar-container">
                                      <div
                                        className="chart-bar"
                                        style={{ height: `${height}%` }}
                                        onMouseEnter={(event) => {
                                          const rect = event.currentTarget.getBoundingClientRect();
                                          setTooltip({
                                            visible: true,
                                            x: rect.left + rect.width / 2,
                                            y: rect.top,
                                            content: { date: day.date, cost: day.cost, sessions: day.sessions },
                                          });
                                        }}
                                        onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
                                      />
                                    </div>
                                    <div className="chart-label">{formatShortDate(day.date)}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="settings-inline-muted">当前时间范围内暂无数据。</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {tooltip.visible ? (
        <div className="settings-usage-chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="tooltip-date">{formatShortDate(tooltip.content.date)}</div>
          <div className="tooltip-cost">{formatCost(tooltip.content.cost)}</div>
          <div className="tooltip-sessions">{tooltip.content.sessions} 个会话</div>
        </div>
      ) : null}
    </section>
  );
}
