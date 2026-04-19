import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  Bot,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AgentIcon } from "../AgentIcon";
import { bridge } from "../../lib/bridge";
import { AGENT_ICON_GROUPS, DEFAULT_AGENT_ICON, resolveAgentIconForAgent } from "../../lib/agentIcons";
import type { CustomAgentConfig } from "../../lib/models";
import { useStore } from "../../lib/store";

type AgentDialogState = {
  open: boolean;
  mode: "create" | "edit";
  targetId: string | null;
  name: string;
  prompt: string;
  icon: string;
  error: string | null;
  saving: boolean;
};

type AgentNotice = {
  kind: "success" | "error";
  message: string;
} | null;

type ImportStrategy = "skip" | "overwrite" | "duplicate";

type ImportPreviewItem = {
  incoming: CustomAgentConfig;
  existing: CustomAgentConfig | null;
  status: "new" | "update";
};

type ImportState = {
  open: boolean;
  loading: boolean;
  applying: boolean;
  fileName: string;
  items: ImportPreviewItem[];
  selectedIds: Set<string>;
  strategy: ImportStrategy;
};

type ExportState = {
  open: boolean;
  saving: boolean;
  selectedIds: Set<string>;
};

function createAgentId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `agent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeImportedAgent(input: unknown): CustomAgentConfig | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : createAgentId();
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return null;
  const prompt =
    typeof value.prompt === "string" && value.prompt.trim() ? value.prompt.trim() : null;
  const createdAt =
    typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
      ? value.createdAt
      : Date.now();

  return {
    id,
    name,
    prompt,
    icon: resolveAgentIconForAgent({
      id,
      name,
      icon: typeof value.icon === "string" ? value.icon : null,
    }, DEFAULT_AGENT_ICON),
    createdAt,
  };
}

function duplicateImportedAgent(
  incoming: CustomAgentConfig,
  existingAgents: CustomAgentConfig[]
): CustomAgentConfig {
  const existingNames = new Set(existingAgents.map((agent) => agent.name));
  const baseName = incoming.name.trim() || "智能体";
  let nextName = `${baseName} Copy`;
  let index = 2;
  while (existingNames.has(nextName)) {
    nextName = `${baseName} Copy ${index}`;
    index += 1;
  }
  return {
    ...incoming,
    id: createAgentId(),
    name: nextName,
    createdAt: Date.now(),
  };
}

async function exportAgentsJson(agents: CustomAgentConfig[]) {
  const fileName = `agents-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  const payload = JSON.stringify(agents, null, 2);
  const pickerHost = window as Window & {
    showSaveFilePicker?: (options: {
      suggestedName?: string;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (content: Blob | string) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };

  if (typeof pickerHost.showSaveFilePicker === "function") {
    const handle = await pickerHost.showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(payload);
    await writable.close();
    return;
  }

  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function DesktopAgentsSection() {
  const settings = useStore((state) => state.settings);
  const terminalTabs = useStore((state) => state.terminalTabs);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const agents = settings?.customAgents ?? [];
  const [notice, setNotice] = useState<AgentNotice>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(agents[0]?.id ?? null);
  const [dialog, setDialog] = useState<AgentDialogState>({
    open: false,
    mode: "create",
    targetId: null,
    name: "",
    prompt: "",
    icon: DEFAULT_AGENT_ICON,
    error: null,
    saving: false,
  });
  const [deleteTarget, setDeleteTarget] = useState<CustomAgentConfig | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [exportState, setExportState] = useState<ExportState>({
    open: false,
    saving: false,
    selectedIds: new Set<string>(),
  });
  const [importState, setImportState] = useState<ImportState>({
    open: false,
    loading: false,
    applying: false,
    fileName: "",
    items: [],
    selectedIds: new Set<string>(),
    strategy: "skip",
  });

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? agents[0] ?? null,
    [agents, selectedId]
  );
  const usageByAgentId = useMemo(() => {
    const counts = new Map<string, number>();
    terminalTabs.forEach((tab) => {
      const agentId = tab.selectedAgent?.id;
      if (!agentId) return;
      counts.set(agentId, (counts.get(agentId) ?? 0) + 1);
    });
    return counts;
  }, [terminalTabs]);

  useEffect(() => {
    if (!agents.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !agents.some((agent) => agent.id === selectedId)) {
      setSelectedId(agents[0]?.id ?? null);
    }
  }, [agents, selectedId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function saveAgents(nextAgents: CustomAgentConfig[]) {
    if (!settings) {
      throw new Error("设置尚未加载完成。");
    }
    const updated = await bridge.updateSettings({
      ...settings,
      customAgents: nextAgents,
    });
    useStore.setState({ settings: updated });
  }

  async function handleRefreshAgents() {
    setRefreshing(true);
    try {
      const updated = await bridge.getSettings();
      useStore.setState({ settings: updated });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRefreshing(false);
    }
  }

  function openCreateDialog() {
    setDialog({
      open: true,
      mode: "create",
      targetId: null,
      name: "",
      prompt: "",
      icon: DEFAULT_AGENT_ICON,
      error: null,
      saving: false,
    });
  }

  function openEditDialog(agent: CustomAgentConfig) {
    setDialog({
      open: true,
      mode: "edit",
      targetId: agent.id,
      name: agent.name ?? "",
      prompt: agent.prompt ?? "",
      icon: resolveAgentIconForAgent(agent, DEFAULT_AGENT_ICON),
      error: null,
      saving: false,
    });
  }

  async function handleSaveDialog() {
    const trimmedName = dialog.name.trim();
    const trimmedPrompt = dialog.prompt.trim();
    if (!trimmedName || trimmedName.length > 20) {
      setDialog((current) => ({
        ...current,
        error: "名称长度需要在 1 到 20 个字符之间。",
      }));
      return;
    }
    if (trimmedPrompt.length > 100000) {
      setDialog((current) => ({
        ...current,
        error: "提示词长度不能超过 100000 个字符。",
      }));
      return;
    }

    setDialog((current) => ({ ...current, saving: true, error: null }));
    try {
      if (dialog.mode === "create") {
        const nextAgent: CustomAgentConfig = {
          id: createAgentId(),
          name: trimmedName,
          prompt: trimmedPrompt || null,
          icon: dialog.icon,
          createdAt: Date.now(),
        };
        await saveAgents([nextAgent, ...agents]);
        setSelectedId(nextAgent.id);
        setNotice({ kind: "success", message: "已创建智能体。" });
      } else {
        const nextAgents = agents.map((agent) =>
          agent.id === dialog.targetId
            ? {
                ...agent,
                name: trimmedName,
                prompt: trimmedPrompt || null,
                icon: dialog.icon,
              }
            : agent
        );
        await saveAgents(nextAgents);
        setNotice({ kind: "success", message: "已更新智能体。" });
      }
      setDialog((current) => ({ ...current, open: false, saving: false }));
    } catch (error) {
      setDialog((current) => ({
        ...current,
        saving: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function handleDeleteAgent() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await saveAgents(agents.filter((agent) => agent.id !== deleteTarget.id));
      setNotice({ kind: "success", message: "已删除智能体。" });
      setDeleteTarget(null);
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDeleteBusy(false);
    }
  }

  function openExportDialog() {
    if (!agents.length) {
      setNotice({ kind: "error", message: "当前没有可导出的智能体。" });
      return;
    }
    setExportState({
      open: true,
      saving: false,
      selectedIds: new Set(agents.map((agent) => agent.id)),
    });
  }

  async function handleExportAgents() {
    try {
      setExportState((current) => ({ ...current, saving: true }));
      const picked = agents.filter((agent) => exportState.selectedIds.has(agent.id));
      await exportAgentsJson(picked);
      setExportState({ open: false, saving: false, selectedIds: new Set<string>() });
      setNotice({ kind: "success", message: "已导出智能体配置。" });
    } catch (error) {
      setExportState((current) => ({ ...current, saving: false }));
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;

    setImportState({
      open: true,
      loading: true,
      applying: false,
      fileName: file.name,
      items: [],
      selectedIds: new Set<string>(),
      strategy: "skip",
    });

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const normalizedList = (Array.isArray(parsed) ? parsed : [])
        .map(normalizeImportedAgent)
        .filter((item): item is CustomAgentConfig => Boolean(item));

      const items = normalizedList.map<ImportPreviewItem>((incoming) => {
        const existing = agents.find((agent) => agent.id === incoming.id) ?? null;
        return {
          incoming,
          existing,
          status: existing ? "update" : "new",
        };
      });

      setImportState({
        open: true,
        loading: false,
        applying: false,
        fileName: file.name,
        items,
        selectedIds: new Set(items.map((item) => item.incoming.id)),
        strategy: "skip",
      });
    } catch (error) {
      setImportState({
        open: false,
        loading: false,
        applying: false,
        fileName: "",
        items: [],
        selectedIds: new Set<string>(),
        strategy: "skip",
      });
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "导入文件解析失败。",
      });
    }
  }

  async function handleApplyImport() {
    setImportState((current) => ({ ...current, applying: true }));
    try {
      let nextAgents = [...agents];
      const selectedItems = importState.items.filter((item) =>
        importState.selectedIds.has(item.incoming.id)
      );

      selectedItems.forEach((item) => {
        if (!item.existing) {
          nextAgents = [item.incoming, ...nextAgents];
          return;
        }
        if (importState.strategy === "skip") {
          return;
        }
        if (importState.strategy === "overwrite") {
          nextAgents = nextAgents.map((agent) =>
            agent.id === item.existing?.id
              ? {
                  ...item.existing,
                  ...item.incoming,
                  createdAt: item.existing.createdAt ?? item.incoming.createdAt ?? Date.now(),
                }
              : agent
          );
          return;
        }
        const duplicated = duplicateImportedAgent(item.incoming, nextAgents);
        nextAgents = [duplicated, ...nextAgents];
      });

      await saveAgents(nextAgents);
      setImportState({
        open: false,
        loading: false,
        applying: false,
        fileName: "",
        items: [],
        selectedIds: new Set<string>(),
        strategy: "skip",
      });
      setNotice({ kind: "success", message: "已导入智能体配置。" });
    } catch (error) {
      setImportState((current) => ({ ...current, applying: false }));
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const importSummary = useMemo(
    () => ({
      total: importState.items.length,
      newCount: importState.items.filter((item) => item.status === "new").length,
      updateCount: importState.items.filter((item) => item.status === "update").length,
    }),
    [importState.items]
  );

  return (
    <>
      <section className="settings-section">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="settings-section-title">智能体</div>
            <div className="settings-section-subtitle">
              管理可选的角色型智能体。选中的智能体会附着在会话上，并在发送时把角色提示注入到真实请求里。
            </div>
          </div>
          <button type="button" className="dcc-action-button" onClick={openCreateDialog}>
            <Plus size={14} />
            新建智能体
          </button>
        </div>

        {notice ? (
          <div className={cx("settings-agent-notice", notice.kind === "error" && "is-error")}>
            {notice.message}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="settings-agent-surface">
            <div className="settings-agent-surface-head">
              <div>
                <div className="text-sm font-semibold text-slate-900">已保存智能体</div>
                <div className="text-xs text-slate-500">在这里维护当前可选的角色配置。</div>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {agents.length} 个
              </span>
            </div>

            <div className="settings-agent-toolbar">
              <button
                type="button"
                className="dcc-action-button secondary"
                onClick={() => void handleRefreshAgents()}
                disabled={refreshing}
              >
                <RefreshCw size={14} />
                {refreshing ? "刷新中..." : "刷新"}
              </button>
              <button
                type="button"
                className="dcc-action-button secondary"
                onClick={openExportDialog}
                disabled={agents.length === 0}
              >
                <Download size={14} />
                导出
              </button>
              <button type="button" className="dcc-action-button secondary" onClick={triggerImport}>
                <Upload size={14} />
                导入
              </button>
            </div>

            {agents.length === 0 ? (
              <div className="settings-agent-empty">
                <Bot size={16} aria-hidden />
                <span>还没有创建任何智能体。</span>
              </div>
            ) : (
              <div className="settings-agent-list">
                {agents.map((agent) => {
                  const isSelected = agent.id === selectedAgent?.id;
                  const usageCount = usageByAgentId.get(agent.id) ?? 0;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      className={cx("settings-agent-card", isSelected && "is-selected")}
                      onClick={() => setSelectedId(agent.id)}
                    >
                      <div className="settings-agent-card-main">
                        <div className="settings-agent-card-title">
                          <AgentIcon
                            icon={agent.icon}
                            seed={agent.id || agent.name}
                            size={20}
                          />
                          <span>{agent.name}</span>
                        </div>
                        <div className="settings-agent-card-prompt" title={agent.prompt ?? ""}>
                          {agent.prompt?.trim() || "未设置角色提示词。"}
                        </div>
                      </div>
                      <div className="settings-agent-card-meta">
                        {usageCount > 0 ? (
                          <span className="dcc-badge">会话中 {usageCount}</span>
                        ) : null}
                        <div className="settings-agent-card-actions">
                          <span
                            role="button"
                            tabIndex={0}
                            className="settings-agent-card-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditDialog(agent);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                openEditDialog(agent);
                              }
                            }}
                          >
                            <Pencil size={14} aria-hidden />
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            className="settings-agent-card-action danger"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeleteTarget(agent);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                setDeleteTarget(agent);
                              }
                            }}
                          >
                            <Trash2 size={14} aria-hidden />
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="settings-agent-surface settings-agent-surface-detail">
            {selectedAgent ? (
              <>
                <div className="settings-agent-preview-head">
                  <div className="settings-agent-preview-title">
                    <AgentIcon
                      icon={selectedAgent.icon}
                      seed={selectedAgent.id || selectedAgent.name}
                      size={24}
                    />
                    <div>
                      <div className="dcc-card-title">{selectedAgent.name}</div>
                      <div className="dcc-card-description">
                        ID: {selectedAgent.id}
                      </div>
                    </div>
                  </div>
                  <div className="settings-agent-preview-actions">
                    <button
                      type="button"
                      className="dcc-action-button secondary"
                      onClick={() => openEditDialog(selectedAgent)}
                    >
                      <Pencil size={14} />
                      编辑
                    </button>
                    <button
                      type="button"
                      className="dcc-action-button secondary"
                      onClick={() => setDeleteTarget(selectedAgent)}
                    >
                      <Trash2 size={14} />
                      删除
                    </button>
                  </div>
                </div>
                <div className="settings-agent-preview-body">
                  <div className="settings-agent-preview-block">
                    <div className="settings-agent-preview-label">角色提示词</div>
                    <pre className="settings-agent-preview-prompt">
                      {selectedAgent.prompt?.trim() || "未设置角色提示词。"}
                    </pre>
                  </div>
                </div>
              </>
            ) : (
              <div className="settings-agent-detail-empty">
                <Bot size={18} aria-hidden />
                <div className="dcc-card-title">选择一个智能体</div>
                <div className="dcc-card-description">
                  左侧列表用于切换当前查看对象，也可以直接新建一个角色型智能体。
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportFileChange}
      />

      {dialog.open ? (
        <div className="vendor-dialog-overlay" onClick={() => setDialog((current) => ({ ...current, open: false }))}>
          <div className="vendor-dialog vendor-dialog-wide" onClick={(event) => event.stopPropagation()}>
            <div className="vendor-dialog-header">
              <h3>{dialog.mode === "create" ? "新建智能体" : "编辑智能体"}</h3>
              <button type="button" className="vendor-dialog-close" onClick={() => setDialog((current) => ({ ...current, open: false }))}>
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="vendor-dialog-body">
              <div className="vendor-form-group">
                <label htmlFor="agent-name-input">名称</label>
                <input
                  id="agent-name-input"
                  className="vendor-input"
                  value={dialog.name}
                  maxLength={20}
                  placeholder="例如：架构审查官"
                  onChange={(event) =>
                    setDialog((current) => ({
                      ...current,
                      name: event.target.value,
                      error: null,
                    }))
                  }
                />
                <div className="settings-agent-counter">{dialog.name.length}/20</div>
              </div>

              <div className="vendor-form-group">
                <label>头像</label>
                <div className="settings-agent-icon-groups">
                  {AGENT_ICON_GROUPS.map((group) => (
                    <div key={group.id} className="settings-agent-icon-group">
                      <div className="settings-agent-icon-group-label">{group.label}</div>
                      <div className="settings-agent-icon-grid">
                        {group.icons.map((icon) => {
                          const selected = dialog.icon === icon;
                          return (
                            <button
                              key={icon}
                              type="button"
                              className={cx("settings-agent-icon-option", selected && "is-selected")}
                              onClick={() =>
                                setDialog((current) => ({
                                  ...current,
                                  icon,
                                }))
                              }
                            >
                              <AgentIcon icon={icon} size={28} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="vendor-form-group">
                <label htmlFor="agent-prompt-input">角色提示词</label>
                <textarea
                  id="agent-prompt-input"
                  className="vendor-code-editor settings-agent-prompt-editor"
                  rows={8}
                  maxLength={100000}
                  placeholder="描述这个智能体的职责、风格、限制和交付方式。"
                  value={dialog.prompt}
                  onChange={(event) =>
                    setDialog((current) => ({
                      ...current,
                      prompt: event.target.value,
                      error: null,
                    }))
                  }
                />
                <div className="settings-agent-counter">{dialog.prompt.length}/100000</div>
              </div>

              {dialog.error ? <div className="settings-inline-error">{dialog.error}</div> : null}
            </div>
            <div className="vendor-dialog-footer">
              <button type="button" className="dcc-action-button secondary" onClick={() => setDialog((current) => ({ ...current, open: false }))}>
                取消
              </button>
              <button type="button" className="dcc-action-button" onClick={() => void handleSaveDialog()} disabled={dialog.saving}>
                {dialog.saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="vendor-dialog-overlay" onClick={() => !deleteBusy && setDeleteTarget(null)}>
          <div className="vendor-dialog vendor-dialog-sm" onClick={(event) => event.stopPropagation()}>
            <div className="vendor-dialog-header">
              <h3>删除智能体</h3>
              <button type="button" className="vendor-dialog-close" onClick={() => !deleteBusy && setDeleteTarget(null)}>
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="vendor-dialog-body">
              <div className="settings-agent-confirm-copy">
                <AlertTriangle size={16} aria-hidden />
                <span>确认删除 “{deleteTarget.name}” 吗？当前会话里保留的历史快照不会被移除。</span>
              </div>
            </div>
            <div className="vendor-dialog-footer">
              <button type="button" className="dcc-action-button secondary" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                取消
              </button>
              <button type="button" className="dcc-action-button danger" onClick={() => void handleDeleteAgent()} disabled={deleteBusy}>
                {deleteBusy ? "删除中..." : "删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {exportState.open ? (
        <div className="vendor-dialog-overlay" onClick={() => !exportState.saving && setExportState((current) => ({ ...current, open: false }))}>
          <div className="vendor-dialog vendor-dialog-wide" onClick={(event) => event.stopPropagation()}>
            <div className="vendor-dialog-header">
              <h3>导出智能体</h3>
              <button type="button" className="vendor-dialog-close" onClick={() => !exportState.saving && setExportState((current) => ({ ...current, open: false }))}>
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="vendor-dialog-body">
              <div className="settings-agent-export-list">
                {agents.map((agent) => {
                  const checked = exportState.selectedIds.has(agent.id);
                  return (
                    <label key={agent.id} className="settings-agent-export-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setExportState((current) => {
                            const nextIds = new Set(current.selectedIds);
                            if (event.target.checked) {
                              nextIds.add(agent.id);
                            } else {
                              nextIds.delete(agent.id);
                            }
                            return {
                              ...current,
                              selectedIds: nextIds,
                            };
                          })
                        }
                      />
                      <AgentIcon icon={agent.icon} seed={agent.id || agent.name} size={18} />
                      <span>{agent.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="vendor-dialog-footer">
              <button type="button" className="dcc-action-button secondary" onClick={() => setExportState((current) => ({ ...current, open: false }))} disabled={exportState.saving}>
                取消
              </button>
              <button
                type="button"
                className="dcc-action-button"
                onClick={() => void handleExportAgents()}
                disabled={exportState.saving || exportState.selectedIds.size === 0}
              >
                {exportState.saving ? "导出中..." : `导出 ${exportState.selectedIds.size} 个`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {importState.open ? (
        <div className="vendor-dialog-overlay" onClick={() => !importState.applying && !importState.loading && setImportState((current) => ({ ...current, open: false }))}>
          <div className="vendor-dialog vendor-dialog-wide" onClick={(event) => event.stopPropagation()}>
            <div className="vendor-dialog-header">
              <h3>导入智能体</h3>
              <button type="button" className="vendor-dialog-close" onClick={() => !importState.applying && !importState.loading && setImportState((current) => ({ ...current, open: false }))}>
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="vendor-dialog-body">
              {importState.loading ? (
                <div className="settings-agent-empty">
                  <RefreshCw size={16} className="animate-spin" aria-hidden />
                  <span>正在解析 {importState.fileName} ...</span>
                </div>
              ) : (
                <>
                  <div className="settings-agent-import-summary">
                    <span>共 {importSummary.total} 个</span>
                    <span>新增 {importSummary.newCount}</span>
                    <span>冲突 {importSummary.updateCount}</span>
                  </div>
                  <div className="settings-agent-strategy-row">
                    {([
                      ["skip", "跳过冲突"],
                      ["overwrite", "覆盖现有"],
                      ["duplicate", "创建副本"],
                    ] as const).map(([value, label]) => (
                      <label key={value} className="settings-agent-strategy-pill">
                        <input
                          type="radio"
                          name="agent-import-strategy"
                          checked={importState.strategy === value}
                          onChange={() =>
                            setImportState((current) => ({
                              ...current,
                              strategy: value,
                            }))
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="settings-agent-import-table">
                    {importState.items.map((item) => {
                      const checked = importState.selectedIds.has(item.incoming.id);
                      return (
                        <label key={item.incoming.id} className="settings-agent-import-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setImportState((current) => {
                                const nextIds = new Set(current.selectedIds);
                                if (event.target.checked) {
                                  nextIds.add(item.incoming.id);
                                } else {
                                  nextIds.delete(item.incoming.id);
                                }
                                return {
                                  ...current,
                                  selectedIds: nextIds,
                                };
                              })
                            }
                          />
                          <AgentIcon icon={item.incoming.icon} seed={item.incoming.id || item.incoming.name} size={18} />
                          <div className="settings-agent-import-copy">
                            <span className="settings-agent-import-name">{item.incoming.name}</span>
                            <span className="settings-agent-import-meta">
                              {item.status === "new" ? "新建" : `将更新 ${item.existing?.name || item.incoming.name}`}
                            </span>
                          </div>
                          <span className={cx("settings-agent-import-badge", item.status === "update" && "is-update")}>
                            {item.status === "new" ? "NEW" : "UPDATE"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <div className="vendor-dialog-footer">
              <button type="button" className="dcc-action-button secondary" onClick={() => setImportState((current) => ({ ...current, open: false }))} disabled={importState.applying || importState.loading}>
                取消
              </button>
              <button
                type="button"
                className="dcc-action-button"
                onClick={() => void handleApplyImport()}
                disabled={importState.loading || importState.applying || importState.selectedIds.size === 0}
              >
                {importState.applying ? "导入中..." : `导入 ${importState.selectedIds.size} 个`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default DesktopAgentsSection;
