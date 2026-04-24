import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  ArrowRightLeft,
  Copy,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { bridge } from "../../lib/bridge";
import { getPromptArgumentHint } from "../../lib/customPrompts";
import type { CustomPromptTemplate, WorkspaceRef } from "../../lib/models";
import { useStore } from "../../lib/store";

type PromptScope = "workspace" | "global";

type PromptEditorState = {
  mode: "create" | "edit";
  targetId: string | null;
  scope: PromptScope;
  name: string;
  description: string;
  argumentHint: string;
  content: string;
};

type PromptImportPayload = {
  format?: string;
  prompts?: Array<{
    name?: string;
    description?: string;
    argumentHint?: string;
    content?: string;
    scope?: PromptScope;
  }>;
};

type PromptNotice =
  | {
      kind: "success" | "error";
      message: string;
    }
  | null;

const PROMPT_EXPORT_FORMAT = "multi-cli-studio-prompts-export-v1";

function createPromptId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `prompt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeScope(prompt: CustomPromptTemplate): PromptScope {
  return prompt.scope === "workspace" ? "workspace" : "global";
}

function filterPromptsForSelectedWorkspace(
  prompts: CustomPromptTemplate[],
  workspaceId: string | null,
) {
  return prompts.filter((prompt) => {
    if (prompt.scope === "global") return true;
    return Boolean(workspaceId) && prompt.workspaceId === workspaceId;
  });
}

function normalizeImportedPrompt(input: unknown, workspaceId: string | null): CustomPromptTemplate | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const content = typeof value.content === "string" ? value.content : "";
  if (!name) return null;
  const scope: PromptScope = value.scope === "workspace" ? "workspace" : "global";
  return {
    id: createPromptId(),
    name,
    description:
      typeof value.description === "string" && value.description.trim() ? value.description.trim() : null,
    argumentHint:
      typeof value.argumentHint === "string" && value.argumentHint.trim() ? value.argumentHint.trim() : null,
    content,
    scope,
    workspaceId: scope === "workspace" ? workspaceId : null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function copyPromptsJson(prompts: CustomPromptTemplate[]) {
  const payload = JSON.stringify(
    {
      format: PROMPT_EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      prompts: prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description ?? null,
        argumentHint: prompt.argumentHint ?? null,
        content: prompt.content,
        scope: prompt.scope,
      })),
    },
    null,
    2,
  );
  await navigator.clipboard.writeText(payload);
}

export function DesktopPromptsSection({
  activeWorkspace,
  workspaces,
}: {
  activeWorkspace: WorkspaceRef | null;
  workspaces: WorkspaceRef[];
}) {
  const settings = useStore((state) => state.settings);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(activeWorkspace?.id ?? null);
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | PromptScope>("all");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [editor, setEditor] = useState<PromptEditorState | null>(null);
  const [notice, setNotice] = useState<PromptNotice>(null);

  const prompts = settings?.customPrompts ?? [];

  useEffect(() => {
    setSelectedWorkspaceId(activeWorkspace?.id ?? null);
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const visiblePrompts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return filterPromptsForSelectedWorkspace(prompts, selectedWorkspaceId).filter((prompt) => {
      if (scopeFilter !== "all" && normalizeScope(prompt) !== scopeFilter) return false;
      if (!normalizedQuery) return true;
      const haystack =
        `${prompt.name} ${prompt.description ?? ""} ${prompt.argumentHint ?? ""} ${prompt.content}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [prompts, query, scopeFilter, selectedWorkspaceId]);

  const groupedPrompts = useMemo(() => {
    const workspaceItems: CustomPromptTemplate[] = [];
    const globalItems: CustomPromptTemplate[] = [];
    visiblePrompts.forEach((prompt) => {
      if (prompt.scope === "workspace") {
        workspaceItems.push(prompt);
      } else {
        globalItems.push(prompt);
      }
    });
    return { workspace: workspaceItems, global: globalItems };
  }, [visiblePrompts]);

  async function savePrompts(nextPrompts: CustomPromptTemplate[]) {
    if (!settings) throw new Error("设置尚未加载完成。");
    const updated = await bridge.updateSettings({
      ...settings,
      customPrompts: nextPrompts,
    });
    useStore.setState({ settings: updated });
  }

  async function refreshPrompts() {
    setLoading(true);
    try {
      const updated = await bridge.getSettings();
      useStore.setState({ settings: updated });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }

  function startCreate(scope: PromptScope) {
    setEditor({
      mode: "create",
      targetId: null,
      scope,
      name: "",
      description: "",
      argumentHint: "",
      content: "",
    });
    setNotice(null);
  }

  function startEdit(prompt: CustomPromptTemplate) {
    setEditor({
      mode: "edit",
      targetId: prompt.id,
      scope: normalizeScope(prompt),
      name: prompt.name,
      description: prompt.description ?? "",
      argumentHint: prompt.argumentHint ?? "",
      content: prompt.content,
    });
    setNotice(null);
  }

  async function handleSaveEditor() {
    if (!editor) return;
    const trimmedName = editor.name.trim();
    if (!trimmedName) {
      setNotice({ kind: "error", message: "提示词名称不能为空。" });
      return;
    }
    if (editor.scope === "workspace" && !selectedWorkspaceId) {
      setNotice({ kind: "error", message: "请先选择一个工作区。" });
      return;
    }
    setSaving(true);
    try {
      const nextPrompt: CustomPromptTemplate = {
        id: editor.targetId ?? createPromptId(),
        name: trimmedName,
        description: editor.description.trim() || null,
        argumentHint: editor.argumentHint.trim() || null,
        content: editor.content,
        scope: editor.scope,
        workspaceId: editor.scope === "workspace" ? selectedWorkspaceId : null,
        createdAt: editor.mode === "create" ? Date.now() : prompts.find((item) => item.id === editor.targetId)?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      if (editor.mode === "create") {
        await savePrompts([nextPrompt, ...prompts]);
        setNotice({ kind: "success", message: "已创建提示词。" });
      } else {
        await savePrompts(prompts.map((prompt) => (prompt.id === editor.targetId ? nextPrompt : prompt)));
        setNotice({ kind: "success", message: "已更新提示词。" });
      }
      setEditor(null);
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePrompt(prompt: CustomPromptTemplate) {
    const ok = window.confirm(`确定删除提示词 “${prompt.name}” 吗？`);
    if (!ok) return;
    try {
      await savePrompts(prompts.filter((item) => item.id !== prompt.id));
      setNotice({ kind: "success", message: "已删除提示词。" });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleMovePrompt(prompt: CustomPromptTemplate, scope: PromptScope) {
    try {
      await savePrompts(
        prompts.map((item) =>
          item.id === prompt.id
            ? {
                ...item,
                scope,
                workspaceId: scope === "workspace" ? selectedWorkspaceId : null,
                updatedAt: Date.now(),
              }
            : item,
        ),
      );
      setNotice({ kind: "success", message: "已移动提示词。" });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleExport() {
    try {
      await copyPromptsJson(filterPromptsForSelectedWorkspace(prompts, selectedWorkspaceId));
      setNotice({ kind: "success", message: "已复制提示词 JSON。" });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleImport() {
    let payload: PromptImportPayload;
    try {
      payload = JSON.parse(importText) as PromptImportPayload;
    } catch {
      setNotice({ kind: "error", message: "导入 JSON 格式无效。" });
      return;
    }
    const incoming = Array.isArray(payload.prompts) ? payload.prompts : [];
    if (incoming.length === 0) {
      setNotice({ kind: "error", message: "没有可导入的提示词。" });
      return;
    }
    setSaving(true);
    try {
      let nextPrompts = [...prompts];
      incoming.forEach((entry) => {
        const normalized = normalizeImportedPrompt(entry, selectedWorkspaceId);
        if (!normalized) return;
        const existingIndex = nextPrompts.findIndex(
          (prompt) =>
            prompt.name === normalized.name &&
            prompt.scope === normalized.scope &&
            (prompt.scope !== "workspace" || prompt.workspaceId === normalized.workspaceId),
        );
        if (existingIndex >= 0) {
          nextPrompts[existingIndex] = {
            ...nextPrompts[existingIndex],
            ...normalized,
            id: nextPrompts[existingIndex]?.id ?? normalized.id,
            createdAt: nextPrompts[existingIndex]?.createdAt ?? normalized.createdAt,
            updatedAt: Date.now(),
          };
        } else {
          nextPrompts.unshift(normalized);
        }
      });
      await savePrompts(nextPrompts);
      setShowImport(false);
      setImportText("");
      setNotice({ kind: "success", message: "已导入提示词。" });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  function renderPromptCard(prompt: CustomPromptTemplate) {
    const scope = normalizeScope(prompt);
    return (
      <div key={prompt.id} className="settings-prompt-card">
        <div className="settings-prompt-card-head">
          <div className="settings-prompt-card-copy">
            <div className="settings-prompt-name-row">
              <div className="settings-prompt-name">{prompt.name}</div>
              <span className={`settings-prompt-scope-badge is-${scope}`}>
                {scope === "workspace" ? "WORKSPACE" : "GLOBAL"}
              </span>
            </div>
            {prompt.description ? <div className="settings-prompt-description">{prompt.description}</div> : null}
            <div className="settings-prompt-command">
              {`/${prompt.name.startsWith("prompts:") ? prompt.name : `prompts:${prompt.name}`}`}
              {getPromptArgumentHint(prompt) ? ` ${getPromptArgumentHint(prompt)}` : ""}
            </div>
          </div>
          <div className="settings-prompt-card-actions">
            <button type="button" className="settings-agent-card-action" onClick={() => startEdit(prompt)} title="编辑">
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="settings-agent-card-action"
              onClick={() => void handleMovePrompt(prompt, scope === "workspace" ? "global" : "workspace")}
              title={scope === "workspace" ? "移动到全局" : "移动到工作区"}
            >
              <ArrowRightLeft size={14} />
            </button>
            <button
              type="button"
              className="settings-agent-card-action danger"
              onClick={() => void handleDeletePrompt(prompt)}
              title="删除"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <div className="settings-prompt-preview">{prompt.content}</div>
      </div>
    );
  }

  const workspaceAvailable = Boolean(selectedWorkspaceId);

  return (
    <section className="settings-section">
      <div className="settings-section-title">Prompt Library</div>
      <div className="settings-section-subtitle">管理可在输入框中通过 slash command 注入的自定义提示词模板。</div>

      {notice ? (
        <div className={`settings-agent-notice ${notice.kind === "success" ? "is-success" : "is-error"}`}>
          {notice.message}
        </div>
      ) : null}

      <div className="settings-workspace-picker settings-workspace-picker--section settings-workspace-picker--prompt">
        <div className="settings-workspace-picker-label">工作区</div>
        {workspaces.length > 0 ? (
          <div className="settings-select-wrap">
            <select
              className="settings-select"
              value={selectedWorkspaceId ?? ""}
              onChange={(event) => setSelectedWorkspaceId(event.target.value || null)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="settings-inline-muted">还没有可用工作区。</div>
        )}
      </div>

      {!workspaceAvailable ? (
        <div className="settings-inline-muted">请先选择一个工作区后再管理提示词。</div>
      ) : (
        <>
          <div className="settings-prompt-search-row">
            <input
              className="vendor-input"
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
              placeholder="搜索提示词名称、描述或正文"
            />
          </div>

          <div className="settings-prompt-toolbar settings-prompt-toolbar--primary">
            <div className="settings-select-wrap settings-prompt-filter-wrap">
              <select
                className="settings-select settings-select--compact"
                value={scopeFilter}
                onChange={(event) => setScopeFilter(event.target.value as "all" | PromptScope)}
              >
                <option value="all">全部范围</option>
                <option value="workspace">仅工作区</option>
                <option value="global">仅全局</option>
              </select>
            </div>
            <button type="button" className="dcc-action-button secondary" onClick={() => void refreshPrompts()} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              刷新
            </button>
            <button type="button" className="dcc-action-button secondary" onClick={() => void handleExport()}>
              <Copy size={14} />
              复制 JSON
            </button>
            <button type="button" className="dcc-action-button secondary" onClick={() => setShowImport((prev) => !prev)}>
              <Upload size={14} />
              导入 JSON
            </button>
            <button type="button" className="dcc-action-button" onClick={() => startCreate("workspace")}>
              <Plus size={14} />
              新建提示词
            </button>
          </div>

          <div className="settings-prompt-toolbar settings-prompt-toolbar--secondary">
            <button type="button" className="dcc-action-button secondary" onClick={() => startCreate("workspace")}>
              <FileText size={14} />
              新建工作区 Prompt
            </button>
            <button type="button" className="dcc-action-button secondary" onClick={() => startCreate("global")}>
              <Plus size={14} />
              新建全局 Prompt
            </button>
          </div>

          {showImport ? (
            <div className="settings-prompt-editor-card">
              <div className="settings-subsection-title">导入提示词</div>
              <textarea
                className="vendor-code-editor settings-prompt-textarea"
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder='粘贴 {"format":"multi-cli-studio-prompts-export-v1","prompts":[...]}'
              />
              <div className="settings-prompt-actions">
                <button
                  type="button"
                  className="dcc-action-button secondary"
                  onClick={() => {
                    setShowImport(false);
                    setImportText("");
                  }}
                >
                  取消
                </button>
                <button type="button" className="dcc-action-button" onClick={() => void handleImport()} disabled={saving}>
                  <Upload size={14} />
                  应用导入
                </button>
              </div>
            </div>
          ) : null}

          {editor ? (
            <div className="settings-prompt-editor-card">
              <div className="settings-subsection-title">{editor.mode === "create" ? "创建提示词" : "编辑提示词"}</div>
              <div className="settings-prompt-grid">
                <label className="settings-field">
                  <span>名称</span>
                  <input
                    className="vendor-input"
                    value={editor.name}
                    onChange={(event) => setEditor((current) => (current ? { ...current, name: event.target.value } : current))}
                  />
                </label>
                <label className="settings-field">
                  <span>范围</span>
                  <select
                    className="settings-select"
                    value={editor.scope}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, scope: event.target.value as PromptScope } : current,
                      )
                    }
                  >
                    <option value="workspace">工作区</option>
                    <option value="global">全局</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>描述</span>
                  <input
                    className="vendor-input"
                    value={editor.description}
                    onChange={(event) =>
                      setEditor((current) => (current ? { ...current, description: event.target.value } : current))
                    }
                  />
                </label>
                <label className="settings-field">
                  <span>参数提示</span>
                  <input
                    className="vendor-input"
                    value={editor.argumentHint}
                    onChange={(event) =>
                      setEditor((current) => (current ? { ...current, argumentHint: event.target.value } : current))
                    }
                    placeholder='例如：LANG="" STYLE=""'
                  />
                </label>
              </div>
              <label className="settings-field">
                <span>正文</span>
                <textarea
                  className="vendor-code-editor settings-prompt-textarea"
                  value={editor.content}
                  onChange={(event) =>
                    setEditor((current) => (current ? { ...current, content: event.target.value } : current))
                  }
                />
              </label>
              <div className="settings-agent-counter">{editor.content.length}/100000</div>
              <div className="settings-prompt-actions">
                <button type="button" className="dcc-action-button secondary" onClick={() => setEditor(null)} disabled={saving}>
                  取消
                </button>
                <button type="button" className="dcc-action-button" onClick={() => void handleSaveEditor()} disabled={saving}>
                  {saving ? "保存中..." : "保存提示词"}
                </button>
              </div>
            </div>
          ) : null}

          {loading ? <div className="settings-inline-muted">正在刷新提示词…</div> : null}

          {!loading && groupedPrompts.workspace.length === 0 && groupedPrompts.global.length === 0 ? (
            <div className="settings-agent-empty">
              <FileText size={16} />
              当前范围下还没有提示词，创建一个后就能在输入框里用 `/prompts:名称` 调出。
            </div>
          ) : (
            <div className="settings-prompt-list">
              {groupedPrompts.workspace.length > 0 ? (
                <>
                  <div className="settings-subsection-title">工作区 Prompt</div>
                  {groupedPrompts.workspace.map((prompt) => renderPromptCard(prompt))}
                </>
              ) : null}
              {groupedPrompts.global.length > 0 ? (
                <>
                  <div className="settings-subsection-title">全局 Prompt</div>
                  {groupedPrompts.global.map((prompt) => renderPromptCard(prompt))}
                </>
              ) : null}
            </div>
          )}
        </>
      )}
    </section>
  );
}
