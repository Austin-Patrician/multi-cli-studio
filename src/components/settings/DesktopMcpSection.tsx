import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Server, ShieldCheck, TriangleAlert, Wrench } from "lucide-react";
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
  return installed ? "refined-badge refined-badge-success" : "refined-badge refined-badge-warn";
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

  const selectedVisibleServerCount =
    selectedEngine === "codex"
      ? new Set(
          [...selectedConfigServers.map((entry) => entry.name), ...codexRuntimeServers.map((entry) => entry.name)].map((name) =>
            name.toLowerCase()
          )
        ).size
      : selectedConfigServers.length;

  const selectedToolCount =
    selectedEngine === "codex"
      ? codexRuntimeServers.reduce((sum, server) => sum + server.toolNames.length, 0)
      : 0;

  return (
    <section className="settings-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <style>{`
        .refined-mcp-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
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
          align-items: center;
          gap: 12px;
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
        .refined-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .refined-engine-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 12px;
        }
        .refined-engine-card {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px;
          background: #ffffff;
          border: 1px solid #e5e5e5;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s;
          text-align: left;
        }
        .refined-engine-card:hover {
          border-color: #d4d4d8;
          box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }
        .refined-engine-card.is-active {
          border-color: #18181b;
          box-shadow: 0 0 0 1px #18181b;
        }
        .refined-engine-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .refined-engine-title {
          font-size: 0.9375rem;
          font-weight: 600;
          color: #1a1a1a;
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
        .refined-badge-success {
          background: #ecfdf5;
          border-color: #a7f3d0;
          color: #065f46;
        }
        .refined-badge-warn {
          background: #fef2f2;
          border-color: #fecaca;
          color: #991b1b;
        }
        .refined-engine-meta {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .refined-detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.8125rem;
        }
        .refined-detail-label {
          color: #71717a;
        }
        .refined-detail-value {
          color: #18181b;
          font-weight: 500;
          max-width: 60%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .refined-overview-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .refined-overview-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 16px;
          background: #fafafa;
          border: 1px solid #f0f0f0;
          border-radius: 10px;
        }
        .refined-overview-icon {
          color: #71717a;
        }
        .refined-overview-label {
          font-size: 0.8125rem;
          color: #71717a;
        }
        .refined-overview-value {
          font-size: 1.5rem;
          font-weight: 600;
          color: #18181b;
          line-height: 1;
        }
        .refined-panels-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 16px;
        }
        .refined-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 20px;
          background: #ffffff;
          border: 1px solid #e5e5e5;
          border-radius: 10px;
        }
        .refined-panel-span-2 {
          grid-column: 1 / -1;
        }
        .refined-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }
        .refined-panel-title {
          font-size: 0.9375rem;
          font-weight: 600;
          color: #1a1a1a;
        }
        .refined-server-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .refined-server-row {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 12px;
          background: #fafafa;
          border: 1px solid #f0f0f0;
          border-radius: 8px;
        }
        .refined-provider-name-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .refined-provider-name {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1a1a1a;
        }
        .refined-provider-meta {
          font-size: 0.75rem;
          color: #71717a;
        }
        .refined-runtime-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          gap: 12px;
        }
        .refined-runtime-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          background: #fafafa;
          border: 1px solid #f0f0f0;
          border-radius: 8px;
        }
        .refined-chip-list {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 4px;
        }
        .refined-chip {
          padding: 2px 6px;
          background: #f4f4f5;
          border: 1px solid #e5e5e5;
          border-radius: 4px;
          font-size: 0.6875rem;
          color: #555;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .refined-empty {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #999;
          font-size: 0.8125rem;
          padding: 12px 0;
        }
        .refined-error {
          color: #ef4444;
          font-size: 0.8125rem;
          padding: 8px;
          background: #fef2f2;
          border-radius: 6px;
        }
      `}</style>

      <div className="refined-mcp-container">
        <div className="refined-header">
          <div className="refined-title">MCP 服务器</div>
          <div className="refined-subtitle">
            查看并管理各个引擎下的 MCP (Model Context Protocol) 运行时与服务器配置。
          </div>
        </div>

        <div className="refined-toolbar">
          <button type="button" className="refined-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "dcc-spin" : ""} />
            刷新
          </button>
        </div>

        <div className="refined-engine-grid">
          {ENGINE_ORDER.map((engine) => {
            const status = engineStatusMap.get(engine) ?? null;
            return (
              <button
                key={engine}
                type="button"
                className={`refined-engine-card ${selectedEngine === engine ? "is-active" : ""}`}
                onClick={() => setSelectedEngine(engine)}
              >
                <div className="refined-engine-head">
                  <div className="refined-engine-title">{engine === "codex" ? "Codex" : engine === "claude" ? "Claude Code" : "Gemini CLI"}</div>
                  <span className={badgeClass(Boolean(status?.installed))}>
                    {status?.installed ? "已安装" : "未安装"}
                  </span>
                </div>
                <div className="refined-engine-meta">
                  <div className="refined-detail-row">
                    <span className="refined-detail-label">服务器数</span>
                    <strong className="refined-detail-value">
                      {engine === "codex"
                        ? `${new Set(
                            [...globalServers.filter((entry) => entry.source === "ccgui_config").map((entry) => entry.name), ...codexRuntimeServers.map((entry) => entry.name)].map((name) =>
                              name.toLowerCase()
                            )
                          ).size}`
                        : `${globalServers.filter((entry) => entry.source === (engine === "claude" ? "claude_json" : "ccgui_config")).length}`}
                    </strong>
                  </div>
                  <div className="refined-detail-row">
                    <span className="refined-detail-label">执行路径</span>
                    <strong className="refined-detail-value" title={status?.binPath ?? "不可用"}>{status?.binPath ?? "不可用"}</strong>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="refined-overview-grid">
          <div className="refined-overview-card">
            <div className="refined-overview-icon"><Server size={16} /></div>
            <div className="refined-overview-label">可见服务器</div>
            <div className="refined-overview-value">{selectedVisibleServerCount}</div>
          </div>
          <div className="refined-overview-card">
            <div className="refined-overview-icon"><Wrench size={16} /></div>
            <div className="refined-overview-label">可用工具</div>
            <div className="refined-overview-value">{selectedToolCount}</div>
          </div>
          <div className="refined-overview-card">
            <div className="refined-overview-icon"><ShieldCheck size={16} /></div>
            <div className="refined-overview-label">引擎状态</div>
            <div className="refined-overview-value" style={{ fontSize: '1.125rem' }}>{selectedStatus?.installed ? "就绪" : "缺失"}</div>
          </div>
        </div>

        <div className="refined-panels-grid">
          <div className="refined-panel">
            <div className="refined-panel-header">
              <div className="refined-panel-title">引擎详情</div>
              <span className={badgeClass(Boolean(selectedStatus?.installed))}>
                {selectedStatus?.installed ? "就绪" : "缺失"}
              </span>
            </div>
            <div style={{ color: '#18181b', fontWeight: 500, fontSize: '0.875rem' }}>
              {selectedEngine === "codex" ? "Codex" : selectedEngine === "claude" ? "Claude" : "Gemini"}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
              <div className="refined-detail-row">
                <span className="refined-detail-label">版本</span>
                <strong className="refined-detail-value">{selectedStatus?.version ?? "未知"}</strong>
              </div>
              <div className="refined-detail-row">
                <span className="refined-detail-label">执行路径</span>
                <strong className="refined-detail-value" title={selectedStatus?.binPath ?? "不可用"}>{selectedStatus?.binPath ?? "不可用"}</strong>
              </div>
              <div className="refined-detail-row">
                <span className="refined-detail-label">工作区</span>
                <strong className="refined-detail-value" title={activeWorkspace?.rootPath ?? "不可用"}>{activeWorkspace?.rootPath ?? "不可用"}</strong>
              </div>
            </div>
            {selectedStatus?.error ? <div className="refined-error">{selectedStatus.error}</div> : null}
            {error ? <div className="refined-error">{error}</div> : null}
          </div>

          <div className="refined-panel">
            <div className="refined-panel-title" style={{ marginBottom: '8px' }}>已配置的服务器</div>
            {selectedConfigServers.length > 0 ? (
              <div className="refined-server-list">
                {selectedConfigServers.map((server) => (
                  <div key={`${server.source}:${server.name}`} className="refined-server-row">
                    <div className="refined-provider-name-row">
                      <span className="refined-provider-name">{server.name}</span>
                      <span className={server.enabled ? "refined-badge refined-badge-success" : "refined-badge"}>
                        {server.enabled ? "已启用" : "已禁用"}
                      </span>
                    </div>
                    <div className="refined-provider-meta">
                      {server.command || server.url || "无命令/链接"} · {server.transport || "未知传输协议"} · 参数数 {server.argsCount}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="refined-empty">当前引擎未找到已配置的 MCP 服务器。</div>
            )}
          </div>

          {selectedEngine === "codex" ? (
            <div className="refined-panel refined-panel-span-2">
              <div className="refined-panel-title" style={{ marginBottom: '8px' }}>Codex 运行时服务器</div>
              {codexRuntimeServers.length > 0 ? (
                <div className="refined-runtime-grid">
                  {codexRuntimeServers.map((server) => (
                    <div key={server.name} className="refined-runtime-card">
                      <div className="refined-provider-name-row">
                        <span className="refined-provider-name">{server.name}</span>
                        <span className="refined-badge">{server.authLabel ?? "未知验证"}</span>
                      </div>
                      <div className="refined-provider-meta">
                        {server.resourcesCount} 资源 · {server.templatesCount} 模板 · {server.toolNames.length} 工具
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
                        <div className="refined-empty" style={{ padding: 0 }}>运行时未返回工具。</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="refined-empty">
                  <TriangleAlert size={14} />
                  <span>运行时 MCP 列表为空，或者本地 Codex CLI 不支持。</span>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
