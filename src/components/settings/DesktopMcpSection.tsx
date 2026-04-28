import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Settings, ShieldAlert, TerminalSquare, Wrench, CheckCircle2, AlertCircle, Box, Power } from "lucide-react";
import { bridge } from "../../lib/bridge";
import type { GlobalMcpServerEntry, SettingsEngineStatus, SettingsEngineType, WorkspaceRef } from "../../lib/models";

type CodexRuntimeServer = {
  name: string;
  authLabel: string | null;
  toolNames: string[];
  resourcesCount: number;
  templatesCount: number;
};

const ENGINE_ORDER: SettingsEngineType[] = ["claude", "codex", "gemini"];

function badgeClass(installed: boolean) {
  return installed ? "status-badge status-badge-success" : "status-badge status-badge-warn";
}

function engineLabel(engine: SettingsEngineType) {
  return engine === "codex" ? "Codex" : engine === "claude" ? "Claude Code" : "Gemini CLI";
}

function serverEndpointLabel(server: GlobalMcpServerEntry) {
  if (server.command?.trim()) return "命令";
  if (server.url?.trim()) return "地址";
  return "端点";
}

function serverEndpointValue(server: GlobalMcpServerEntry) {
  return server.command?.trim() || server.url?.trim() || "无";
}

function transportDisplay(server: GlobalMcpServerEntry) {
  return server.transport?.trim() || "无";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseCodexRuntimeServers(raw: unknown): CodexRuntimeServer[] {
  const payload = asRecord(raw);
  const result = asRecord(payload?.result) ?? payload;
  const data = Array.isArray(result?.data) ? result.data : [];

  return data
    .map((item) => {
      const row = asRecord(item);
      if (!row) return null;
      const name = String(row.name ?? "").trim();
      if (!name) return null;

      const auth = row.authStatus ?? row.auth_status;
      const authLabel =
        typeof auth === "string"
          ? auth
          : asRecord(auth)
            ? String(asRecord(auth)?.status ?? "").trim() || null
            : null;

      const toolsRecord = asRecord(row.tools) ?? {};
      const prefix = `mcp__${name}__`;
      const normalizedPrefix = prefix.toLowerCase();
      const toolNames = Object.keys(toolsRecord)
        .map((toolName) =>
          toolName.toLowerCase().startsWith(normalizedPrefix)
            ? toolName.slice(prefix.length)
            : toolName
        )
        .sort((left, right) => left.localeCompare(right));

      return {
        name,
        authLabel,
        toolNames,
        resourcesCount: Array.isArray(row.resources) ? row.resources.length : 0,
        templatesCount: Array.isArray(row.resourceTemplates)
          ? row.resourceTemplates.length
          : Array.isArray(row.resource_templates)
            ? row.resource_templates.length
            : 0,
      } satisfies CodexRuntimeServer;
    })
    .filter((item): item is CodexRuntimeServer => Boolean(item));
}

export function DesktopMcpSection({
  activeWorkspace,
}: {
  activeWorkspace: WorkspaceRef | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineStatuses, setEngineStatuses] = useState<SettingsEngineStatus[]>([]);
  const [globalServers, setGlobalServers] = useState<GlobalMcpServerEntry[]>([]);
  const [codexRuntimeServers, setCodexRuntimeServers] = useState<CodexRuntimeServer[]>([]);
  const [selectedEngine, setSelectedEngine] = useState<SettingsEngineType>("codex");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statuses, servers, codexRuntime] = await Promise.all([
        bridge.detectEngines(),
        bridge.listGlobalMcpServers(),
        bridge.listCodexMcpRuntimeServers(activeWorkspace?.id ?? null),
      ]);
      setEngineStatuses(statuses);
      setGlobalServers(servers);
      setCodexRuntimeServers(parseCodexRuntimeServers(codexRuntime));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const engineStatusMap = useMemo(() => {
    return new Map(engineStatuses.map((status) => [status.engineType, status]));
  }, [engineStatuses]);

  const selectedStatus = engineStatusMap.get(selectedEngine) ?? null;
  const selectedConfigServers = useMemo(() => {
    if (selectedEngine === "claude") {
      return globalServers.filter((entry) => entry.source === "claude_json");
    }
    return globalServers.filter((entry) => entry.source === "ccgui_config");
  }, [globalServers, selectedEngine]);

  const selectedToolCount =
    selectedEngine === "codex"
      ? codexRuntimeServers.reduce((sum, server) => sum + server.toolNames.length, 0)
      : 0;

  const engineName = engineLabel(selectedEngine);
  const configuredEnabledCount = selectedConfigServers.filter((server) => server.enabled).length;
  const configuredDisabledCount = Math.max(0, selectedConfigServers.length - configuredEnabledCount);
  const engineSummaryFields: Array<{
    label: string;
    value: string;
    tone: "default" | "muted" | "success" | "warn";
    monospace?: boolean;
  }> = [
    {
      label: "安装状态",
      value: selectedStatus?.installed ? "已安装" : "未安装",
      tone: selectedStatus?.installed ? "success" : "warn",
    },
    {
      label: "版本",
      value: selectedStatus?.version?.trim() || "未知",
      tone: "default",
      monospace: true,
    },
    {
      label: "命令路径",
      value: selectedStatus?.binPath?.trim() || "未检测到",
      tone: selectedStatus?.binPath?.trim() ? "default" : "muted",
      monospace: true,
    },
    {
      label: "错误状态",
      value: selectedStatus?.error?.trim() || "正常",
      tone: selectedStatus?.error?.trim() ? "warn" : "success",
    },
  ];

  return (
    <section className="settings-section" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <style>{`
        .refined-mcp-container {
          display: flex;
          flex-direction: column;
          gap: 18px;
          color: #09090b;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }
        .refined-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 4px;
        }
        .refined-title {
          font-size: 1.25rem;
          font-weight: 600;
          color: #09090b;
          letter-spacing: -0.02em;
        }
        .refined-subtitle {
          font-size: 0.875rem;
          color: #52525b;
          margin-top: 6px;
        }
        .refined-tabs {
          display: inline-flex;
          background: #f4f4f5;
          padding: 4px;
          border-radius: 10px;
          gap: 4px;
          align-self: flex-start;
          border: 1px solid #e4e4e7;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);
        }
        .refined-tab {
          padding: 6px 16px;
          font-size: 0.875rem;
          font-weight: 500;
          color: #52525b;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .refined-tab:hover {
          color: #09090b;
        }
        .refined-tab.is-active {
          background: #ffffff;
          color: #09090b;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1);
        }
        .refined-banner {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 14px;
          padding: 16px 18px;
          background: #ffffff;
          border: 1px solid #e4e4e7;
          border-radius: 12px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.035);
        }
        .refined-banner-left {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-width: 0;
        }
        .refined-banner-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .refined-banner-title {
          font-weight: 650;
          font-size: 0.98rem;
          color: #09090b;
        }
        .refined-banner-caption {
          margin-top: 4px;
          font-size: 0.78rem;
          color: #71717a;
          line-height: 1.5;
        }
        .refined-banner-meta {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .refined-banner-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
          padding: 9px 10px;
          border-radius: 10px;
          background: linear-gradient(180deg, #fcfcfd 0%, #f8fafc 100%);
          border: 1px solid #eceff3;
        }
        .refined-banner-field-label {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #71717a;
        }
        .refined-banner-field-value {
          min-width: 0;
          font-size: 0.77rem;
          color: #111827;
          line-height: 1.45;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .refined-banner-field-value.is-monospace {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.75rem;
        }
        .refined-banner-field-value.is-muted {
          color: #71717a;
        }
        .refined-banner-field-value.is-success {
          color: #047857;
          font-weight: 600;
        }
        .refined-banner-field-value.is-warn {
          color: #b45309;
          font-weight: 600;
        }
        .refined-button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 12px;
          background: #ffffff;
          border: 1px solid #e4e4e7;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 500;
          color: #09090b;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
          box-shadow: 0 1px 2px rgba(0,0,0,0.02);
          align-self: start;
        }
        .refined-button:hover:not(:disabled) {
          background: #fafafa;
          border-color: #d4d4d8;
        }
        .refined-button:active:not(:disabled) {
          background: #f4f4f5;
        }
        .refined-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        /* Status Badges */
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
          border: 1px solid transparent;
          letter-spacing: 0.02em;
        }
        .status-badge::before {
          content: "";
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .status-badge-success {
          background: #ecfdf5;
          color: #065f46;
          border-color: #a7f3d0;
        }
        .status-badge-success::before {
          background-color: #10b981;
        }
        .status-badge-warn {
          background: #fef2f2;
          color: #991b1b;
          border-color: #fecaca;
        }
        .status-badge-warn::before {
          background-color: #ef4444;
        }
        .status-badge-neutral {
          background: #f4f4f5;
          color: #3f3f46;
          border-color: #e4e4e7;
        }
        .status-badge-neutral::before {
          background-color: #71717a;
        }

        /* Overview Cards */
        .refined-overview-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 10px;
        }
        .refined-overview-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 14px;
          background: #ffffff;
          border: 1px solid #e4e4e7;
          border-radius: 10px;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.03);
        }
        .refined-overview-header {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #52525b;
          font-size: 0.875rem;
          font-weight: 500;
        }
        .refined-overview-value {
          font-size: 1.42rem;
          font-weight: 650;
          color: #09090b;
          line-height: 1;
          letter-spacing: -0.02em;
        }
        .refined-overview-note {
          font-size: 0.75rem;
          color: #71717a;
        }
        .refined-section-title {
          font-size: 1.125rem;
          font-weight: 600;
          color: #09090b;
          margin-bottom: 12px;
          padding-bottom: 10px;
          border-bottom: 1px solid #e4e4e7;
          display: flex;
          align-items: center;
          gap: 8px;
          letter-spacing: -0.01em;
        }
        
        /* List Rows */
        .refined-server-list {
          display: flex;
          flex-direction: column;
          gap: 0;
          border: 1px solid #e4e4e7;
          border-radius: 12px;
          overflow: hidden;
          background: #ffffff;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.03);
        }
        .refined-server-row {
          display: grid;
          grid-template-columns: minmax(180px, 0.9fr) minmax(0, 1.7fr) minmax(110px, 0.6fr) minmax(80px, 0.4fr) auto;
          gap: 16px;
          align-items: center;
          padding: 14px 16px;
          background: #ffffff;
          border-bottom: 1px solid #eef2f7;
          min-width: 0;
        }
        .refined-server-row:last-child {
          border-bottom: none;
        }
        .refined-server-row:hover {
          background: #fafafa;
        }
        .refined-provider-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .refined-provider-name {
          font-size: 0.93rem;
          font-weight: 650;
          color: #09090b;
          display: flex;
          align-items: flex-start;
          gap: 7px;
          min-width: 0;
          flex: 1 1 auto;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .refined-server-status {
          justify-self: end;
        }
        .refined-provider-meta {
          font-size: 0.75rem;
          color: #52525b;
          min-width: 0;
        }
        .refined-server-fields {
          display: contents;
        }
        .refined-server-field {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .refined-server-field-label {
          font-size: 0.6875rem;
          font-weight: 600;
          letter-spacing: 0.01em;
          color: #64748b;
        }
        .refined-server-field-value {
          min-width: 0;
          font-size: 0.76rem;
          color: #0f172a;
          line-height: 1.45;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .refined-server-field-value.is-monospace {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.75rem;
        }

        /* Runtime Cards */
        .refined-runtime-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 16px;
        }
        .refined-runtime-card {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 15px;
          background: #ffffff;
          border: 1px solid #e4e4e7;
          border-radius: 10px;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.03);
        }
        .refined-runtime-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .refined-runtime-stats span {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          min-width: 0;
          padding: 8px 10px;
          border-radius: 8px;
          background: #f8fafc;
          border: 1px solid #e8edf3;
          font-size: 0.75rem;
          color: #64748b;
        }
        .refined-runtime-stats strong {
          font-size: 0.92rem;
          color: #0f172a;
        }
        .refined-chip-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .refined-chip {
          padding: 3px 8px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 999px;
          font-size: 0.75rem;
          color: #334155;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          word-break: break-all;
        }
        .refined-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: #71717a;
          font-size: 0.9375rem;
          padding: 48px 24px;
          background: #fafafa;
          border: 1px dashed #d4d4d8;
          border-radius: 12px;
          text-align: center;
        }
        .refined-error {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #b91c1c;
          font-size: 0.875rem;
          font-weight: 500;
          padding: 16px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
        }
        @media (max-width: 900px) {
          .refined-banner {
            grid-template-columns: 1fr;
          }
          .refined-server-row {
            grid-template-columns: 1fr;
            gap: 10px;
          }
          .refined-server-fields {
            display: grid;
            grid-template-columns: 1fr;
            gap: 10px;
          }
          .refined-server-status {
            justify-self: start;
          }
          .refined-banner-meta,
          .refined-runtime-stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="refined-mcp-container">
        <div className="refined-header">
          <div>
            <div className="refined-title">MCP 服务器 (Model Context Protocol)</div>
            <div className="refined-subtitle">
              统一查看并管理当前工作区内不同引擎下的 MCP 运行时状态与服务器配置。
            </div>
          </div>
        </div>

        {/* 顶级选项卡 */}
        <div className="refined-tabs">
          {ENGINE_ORDER.map((engine) => (
            <button
              key={engine}
              type="button"
              className={`refined-tab ${selectedEngine === engine ? "is-active" : ""}`}
              onClick={() => setSelectedEngine(engine)}
            >
              {engine === "codex" ? "Codex" : engine === "claude" ? "Claude Code" : "Gemini CLI"}
            </button>
          ))}
        </div>

        {/* 引擎状态横幅 */}
        <div className="refined-banner">
          <div className="refined-banner-left">
            <div className="refined-banner-head">
              <div>
                <div className="refined-banner-title">{engineName} 引擎</div>
                <div className="refined-banner-caption">
                  当前工作区的 MCP 接入状态、命令路径与静态配置概览。
                </div>
              </div>
            </div>
            <div className="refined-banner-meta">
              {engineSummaryFields.map((field) => (
                <div key={field.label} className="refined-banner-field">
                  <span className="refined-banner-field-label">{field.label}</span>
                  <span
                    className={`refined-banner-field-value${field.monospace ? " is-monospace" : ""}${field.tone === "muted" ? " is-muted" : ""}${field.tone === "success" ? " is-success" : ""}${field.tone === "warn" ? " is-warn" : ""}`}
                    title={field.value}
                  >
                    {field.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <button type="button" className="refined-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "dcc-spin" : ""} />
            刷新状态
          </button>
        </div>

        {error && (
          <div className="refined-error">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
        {selectedStatus?.error && (
          <div className="refined-error">
            <AlertCircle size={16} />
            {selectedStatus.error}
          </div>
        )}

        {selectedStatus?.installed ? (
          <>
            {/* 数据概览 */}
          <div className="refined-overview-grid">
              <div className="refined-overview-card">
                <div className="refined-overview-header">
                  静态配置服务器
                </div>
                <div className="refined-overview-value">{selectedConfigServers.length}</div>
                <div className="refined-overview-note">
                  启用 {configuredEnabledCount} · 停用 {configuredDisabledCount}
                </div>
              </div>
              {selectedEngine === "codex" && (
                <div className="refined-overview-card">
                  <div className="refined-overview-header">
                    运行时服务器
                  </div>
                  <div className="refined-overview-value">{codexRuntimeServers.length}</div>
                  <div className="refined-overview-note">仅显示当前工作区运行时返回</div>
                </div>
              )}
              <div className="refined-overview-card">
                <div className="refined-overview-header">
                  累计可用工具
                </div>
                <div className="refined-overview-value">{selectedToolCount}</div>
                <div className="refined-overview-note">Codex 运行时工具总数</div>
              </div>
            </div>

            {/* 静态服务器列表 */}
            <div>
              <div className="refined-section-title">
                静态服务器配置
              </div>
              {selectedConfigServers.length > 0 ? (
                <div className="refined-server-list">
                  {selectedConfigServers.map((server) => (
                    <div key={`${server.source}:${server.name}`} className="refined-server-row">
                      {(() => {
                        const transport = transportDisplay(server);
                        return (
                          <>
                      <div className="refined-provider-name-row">
                        <span className="refined-provider-name">
                          <Box size={16} color="#52525b" />
                          {server.name}
                        </span>
                      </div>
                      <div className="refined-server-fields">
                        <div className="refined-server-field">
                          <span className="refined-server-field-label">{serverEndpointLabel(server)}</span>
                          <span className="refined-server-field-value is-monospace" title={serverEndpointValue(server)}>
                            {serverEndpointValue(server)}
                          </span>
                        </div>
                        <div className="refined-server-field">
                          <span className="refined-server-field-label">传输</span>
                          <span className="refined-server-field-value">{transport}</span>
                        </div>
                        <div className="refined-server-field">
                          <span className="refined-server-field-label">参数</span>
                          <span className="refined-server-field-value">
                            {server.argsCount > 0 ? server.argsCount : "无"}
                          </span>
                        </div>
                      </div>
                      <span className={`refined-server-status ${server.enabled ? "status-badge status-badge-success" : "status-badge status-badge-neutral"}`}>
                        {server.enabled ? "已启用" : "已禁用"}
                      </span>
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="refined-empty">未发现静态配置的 MCP 服务器。</div>
              )}
            </div>

            {/* 运行时卡片网格 (仅 Codex 展示) */}
            {selectedEngine === "codex" && (
              <div>
                <div className="refined-section-title">
                  运行时服务器
                </div>
                {codexRuntimeServers.length > 0 ? (
                  <div className="refined-runtime-grid">
                    {codexRuntimeServers.map((server) => (
                      <div key={server.name} className="refined-runtime-card">
                        <div className="refined-provider-name-row">
                          <span className="refined-provider-name">
                            <Power size={16} color="#059669" />
                            {server.name}
                          </span>
                          <span className="status-badge status-badge-neutral">
                            {server.authLabel ?? "无鉴权"}
                          </span>
                        </div>
                        <div className="refined-runtime-stats">
                          <span><strong>{server.resourcesCount}</strong>资源</span>
                          <span><strong>{server.templatesCount}</strong>模板</span>
                          <span><strong>{server.toolNames.length}</strong>工具</span>
                        </div>
                        {server.toolNames.length > 0 ? (
                          <div className="refined-chip-list">
                            {server.toolNames.map((tool) => (
                              <span key={`${server.name}:${tool}`} className="refined-chip">
                                {tool}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.8125rem', color: '#a1a1aa' }}>无可用工具</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="refined-empty">
                    当前工作区未检测到活跃的 Codex MCP 运行时节点。
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="refined-empty" style={{ padding: '80px 20px', flexDirection: 'column', border: 'none', background: 'transparent' }}>
            <ShieldAlert size={48} color="#d4d4d8" style={{ marginBottom: '8px' }} />
            <span style={{ fontSize: '1.125rem', color: '#3f3f46', fontWeight: 600 }}>引擎未就绪</span>
            <span style={{ fontSize: '0.875rem', color: '#71717a', maxWidth: '400px', lineHeight: 1.5 }}>
              未在本地环境中检测到 {engineName} 引擎。<br/>请完成安装和环境配置后，刷新以管理其 MCP 服务。
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
