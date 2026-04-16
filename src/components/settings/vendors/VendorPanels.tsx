import { useEffect, useState } from "react";
import type {
  AgentCard,
  AgentResourceKind,
  ModelProviderConfig,
  ModelProviderServiceType,
  VendorConfigField,
  VendorLocalConfigEntry,
} from "../../../lib/models";
import { MODEL_PROVIDER_META } from "../../../lib/modelProviders";
import type { CodexConfigFilesState } from "./hooks";
import type {
  GeminiAuthMode,
  GeminiPreflightCheck,
  GeminiVendorDraft,
  VendorCustomModel,
} from "./types";
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  LogIn,
  PackagePlus,
  Pencil,
  RefreshCw,
  Save,
  Server,
  Settings2,
  Trash2,
} from "lucide-react";

const RESOURCE_ORDER: AgentResourceKind[] = ["mcp", "skill", "plugin", "extension"];
const RESOURCE_LABEL: Record<AgentResourceKind, string> = {
  mcp: "MCP",
  skill: "技能",
  plugin: "插件",
  extension: "扩展",
};

const GEMINI_AUTH_MODE_ICON_MAP = {
  custom: Settings2,
  login_google: LogIn,
  gemini_api_key: KeyRound,
  vertex_adc: Cloud,
  vertex_service_account: Cloud,
  vertex_api_key: Cloud,
} as const;

function badgeToneClass(tone: "default" | "success" | "warn" = "default") {
  if (tone === "success") return "dcc-badge dcc-badge-success";
  if (tone === "warn") return "dcc-badge dcc-badge-warn";
  return "dcc-badge";
}

function maskSecret(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "未配置";
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}••••••${trimmed.slice(-2)}`;
}

function resourceSummary(agent: AgentCard | null, kind: AgentResourceKind) {
  const group = agent?.runtime.resources[kind];
  if (!group) return "未检测";
  if (!group.supported) return "不支持";
  if (group.error) return "异常";
  return `${group.items.length} 项`;
}

function copyText(value: string) {
  if (!value || typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }
  void navigator.clipboard.writeText(value);
}

function modeLabel(mode: GeminiAuthMode) {
  switch (mode) {
    case "custom":
      return "自定义网关";
    case "login_google":
      return "Google 登录";
    case "gemini_api_key":
      return "Gemini API Key";
    case "vertex_adc":
      return "Vertex AI (ADC)";
    case "vertex_service_account":
      return "Vertex Service Account";
    case "vertex_api_key":
      return "Vertex API Key";
    default:
      return mode;
  }
}

function redactAuthContent(content: string) {
  if (!content.trim()) {
    return content;
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    return JSON.stringify(redactAuthValue(parsed), null, 2);
  } catch {
    return content.replace(
      /("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|secret)"?\s*:\s*)"([^"]*)"/gi,
      (_match, prefix, value) => `${prefix}"${maskSecret(String(value))}"`,
    );
  }
}

function redactAuthValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuthValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|secret)/i.test(key)) {
      output[key] = typeof nested === "string" ? maskSecret(nested) : "***";
      continue;
    }
    output[key] = redactAuthValue(nested);
  }
  return output;
}

function renderConfigSection(
  state: CodexConfigFilesState["config"] | CodexConfigFilesState["auth"],
  contentId: string,
  emptyLabel: string,
  errorLabel: string,
  truncatedLabel: string,
) {
  if (state.loading) {
    return (
      <div id={contentId} className="vendor-codex-global-config-body">
        <div className="vendor-current-config-loading">正在加载...</div>
      </div>
    );
  }
  if (state.error) {
    return (
      <div id={contentId} className="vendor-codex-global-config-body">
        <div className="vendor-current-config-empty">
          {errorLabel}：{state.error}
        </div>
      </div>
    );
  }
  if (!state.path) {
    return (
      <div id={contentId} className="vendor-codex-global-config-body">
        <div className="vendor-current-config-empty">当前环境不支持读取该文件。</div>
      </div>
    );
  }
  if (!state.exists) {
    return (
      <div id={contentId} className="vendor-codex-global-config-body">
        <div className="vendor-current-config-empty">{emptyLabel}</div>
      </div>
    );
  }
  return (
    <div id={contentId} className="vendor-codex-global-config-body">
      <pre className="vendor-codex-global-config-content">{state.content}</pre>
      {state.truncated ? <div className="settings-help">{truncatedLabel}</div> : null}
    </div>
  );
}

export function VendorButton({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  onClick,
  className = "",
  title,
}: {
  children: React.ReactNode;
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "md" | "sm" | "icon";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`vendor-btn vendor-btn-${variant} vendor-btn-${size} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

export function VendorRuntimeOverviewCard({
  agent,
  icon,
  label,
  configuredPath,
}: {
  agent: AgentCard | null;
  icon: string;
  label: string;
  configuredPath: string;
}) {
  const runtimeInstalled = agent?.runtime.installed ?? false;
  const runtimeVersion = agent?.runtime.version?.trim() || "未检测";
  const resolvedPath = agent?.runtime.commandPath?.trim() || "未检测";
  const pathConfiguredManually = configuredPath !== "自动检测";

  return (
    <div className="dcc-surface-card vendor-runtime-card">
      <div className="dcc-card-head">
        <div>
          <div className="dcc-card-title-row">
            <img src={icon} alt="" className="dcc-provider-service-icon" />
            <div className="dcc-card-title">{label}</div>
            <span className={badgeToneClass(runtimeInstalled ? "success" : "warn")}>
              {runtimeInstalled ? "已安装" : "未安装"}
            </span>
            <span className={badgeToneClass(pathConfiguredManually ? "success" : "default")}>
              {pathConfiguredManually ? "自定义路径" : "自动检测"}
            </span>
          </div>
          <div className="dcc-card-description">
            展示当前 CLI 的路径、运行时版本与资源能力概览。
          </div>
        </div>
      </div>

      <div className="dcc-detail-grid">
        <div className="dcc-detail-panel">
          <div className="dcc-panel-title">路径配置</div>
          <div className="dcc-detail-row">
            <span>配置路径</span>
            <strong>{configuredPath}</strong>
          </div>
          <div className="dcc-detail-row">
            <span>解析路径</span>
            <strong>{resolvedPath}</strong>
          </div>
        </div>

        <div className="dcc-detail-panel">
          <div className="dcc-panel-title">运行时状态</div>
          <div className="dcc-detail-row">
            <span>安装状态</span>
            <strong>{runtimeInstalled ? "已安装" : "未安装"}</strong>
          </div>
          <div className="dcc-detail-row">
            <span>版本</span>
            <strong>{runtimeVersion}</strong>
          </div>
        </div>

        <div className="dcc-detail-panel">
          <div className="dcc-panel-title">资源能力</div>
          {RESOURCE_ORDER.map((kind) => (
            <div key={kind} className="dcc-detail-row">
              <span>{RESOURCE_LABEL[kind]}</span>
              <strong>{resourceSummary(agent, kind)}</strong>
            </div>
          ))}
        </div>

        <div className="dcc-detail-panel">
          <div className="dcc-panel-title">诊断</div>
          <div className="dcc-detail-row">
            <span>最后错误</span>
            <strong>{agent?.runtime.lastError?.trim() || "无"}</strong>
          </div>
          <div className="dcc-detail-row">
            <span>技能目录</span>
            <strong>{resourceSummary(agent, "skill")}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CurrentClaudeConfigCard({
  kicker,
  title,
  subtitle,
  badgeLabel,
  badgeTone = "default",
  fields,
  emptyLabel,
}: {
  kicker?: string | null;
  title: string;
  subtitle?: string;
  badgeLabel?: string | null;
  badgeTone?: "default" | "success" | "warn";
  fields: VendorConfigField[];
  emptyLabel: string;
}) {
  return (
    <div className="vendor-current-config vendor-current-config-hero">
      <div className="vendor-current-config-header">
        <div className="vendor-current-config-heading">
          {kicker ? <span className="vendor-current-config-kicker">{kicker}</span> : null}
          <div className="vendor-current-config-title-row">
            <span className="vendor-current-config-title">{title}</span>
            {badgeLabel ? (
              <span className={`${badgeToneClass(badgeTone)} vendor-current-config-badge`}>
                {badgeLabel}
              </span>
            ) : null}
          </div>
          {subtitle ? <div className="vendor-current-config-subtitle">{subtitle}</div> : null}
        </div>
      </div>

      {fields.length === 0 ? (
        <div className="vendor-current-config-empty">{emptyLabel}</div>
      ) : (
        <div className="vendor-current-config-grid">
          {fields.map((field) => (
            <div
              key={`${field.label}-${field.value}`}
              className={`vendor-current-config-item is-${field.tone ?? "default"}`}
            >
              <span className="vendor-current-config-item-label">{field.label}</span>
              <strong
                className={`vendor-current-config-item-value ${
                  field.monospace ? "is-monospace" : ""
                }`}
              >
                {field.value}
              </strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CurrentCodexGlobalConfigCard({
  state,
}: {
  state: CodexConfigFilesState;
}) {
  const [configExpanded, setConfigExpanded] = useState(true);
  const [authExpanded, setAuthExpanded] = useState(false);
  const [showSensitive, setShowSensitive] = useState(false);
  const authDisplayContent = showSensitive
    ? state.auth.content
    : redactAuthContent(state.auth.content);

  return (
    <div className="vendor-codex-config-stack">
      <div className="vendor-codex-config-panel">
        <div className="vendor-current-config-header">
          <button
            type="button"
            className="vendor-codex-global-config-toggle"
            onClick={() => setConfigExpanded((current) => !current)}
            aria-expanded={configExpanded}
            aria-controls="codex-global-config-content"
          >
            {configExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="vendor-current-config-title">当前 Codex 全局配置</span>
          </button>
          <code className="vendor-codex-global-config-path">
            {state.config.path || "路径不可用"}
          </code>
        </div>
        {configExpanded
          ? renderConfigSection(
              state.config,
              "codex-global-config-content",
              "当前未发现 config.toml。",
              "读取 config.toml 失败",
              "内容已截断显示",
            )
          : null}
      </div>

      <div className="vendor-codex-config-panel">
        <div className="vendor-current-config-header">
          <button
            type="button"
            className="vendor-codex-global-config-toggle"
            onClick={() => setAuthExpanded((current) => !current)}
            aria-expanded={authExpanded}
            aria-controls="codex-auth-config-content"
          >
            {authExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="vendor-current-config-title">当前 Codex Auth 配置</span>
          </button>
          <div className="vendor-codex-global-config-header-actions">
            <button
              type="button"
              className="vendor-codex-sensitive-toggle"
              onClick={() => setShowSensitive((current) => !current)}
            >
              {showSensitive ? "隐藏敏感字段" : "显示敏感字段"}
            </button>
            <code className="vendor-codex-global-config-path">
              {state.auth.path || "路径不可用"}
            </code>
          </div>
        </div>
        {authExpanded ? (
          <div id="codex-auth-config-content" className="vendor-codex-global-config-body">
            {state.auth.loading ? (
              <div className="vendor-current-config-loading">正在加载...</div>
            ) : state.auth.error ? (
              <div className="vendor-current-config-empty">
                读取 auth.json 失败：{state.auth.error}
              </div>
            ) : !state.auth.path ? (
              <div className="vendor-current-config-empty">当前环境不支持读取该文件。</div>
            ) : !state.auth.exists ? (
              <div className="vendor-current-config-empty">当前未发现 auth.json。</div>
            ) : (
              <>
                <pre className="vendor-codex-global-config-content">{authDisplayContent}</pre>
                {state.auth.truncated ? (
                  <div className="settings-help">内容已截断显示</div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ProviderList({
  title,
  serviceType,
  providers,
  onAdd,
  onEdit,
  onDelete,
  onEnable,
}: {
  title: string;
  serviceType: ModelProviderServiceType;
  providers: ModelProviderConfig[];
  onAdd: () => void;
  onEdit: (provider: ModelProviderConfig) => void;
  onDelete: (provider: ModelProviderConfig) => void;
  onEnable: (id: string) => void;
}) {
  const meta = MODEL_PROVIDER_META[serviceType];
  return (
    <div className="vendor-provider-list">
      <div className="vendor-list-header">
        <span className="vendor-list-title">{title}</span>
        <div className="vendor-list-actions">
          <VendorButton size="sm" onClick={onAdd}>
            + 新增
          </VendorButton>
        </div>
      </div>

      <div className="vendor-cards">
        {providers.map((provider) => (
          <div key={provider.id} className={`vendor-card ${provider.enabled ? "active" : ""}`}>
            <div className="vendor-card-info">
              <div className="vendor-card-name">
                {provider.name}
                {provider.enabled ? <span className="vendor-active-badge">使用中</span> : null}
              </div>
              <div className="vendor-card-remark">
                {provider.note?.trim() || provider.websiteUrl || meta.description}
              </div>
              <div className="vendor-card-meta">
                {provider.baseUrl} · {provider.models.length} 个模型
              </div>
            </div>
            <div className="vendor-card-actions">
              {!provider.enabled ? (
                <VendorButton
                  variant="outline"
                  size="sm"
                  onClick={() => onEnable(provider.id)}
                >
                  启用
                </VendorButton>
              ) : (
                <span className="dcc-badge dcc-badge-success">当前</span>
              )}
              <span className="vendor-card-divider" />
              <VendorButton
                variant="ghost"
                size="icon"
                onClick={() => onEdit(provider)}
                title="编辑 provider"
              >
                <Pencil size={14} />
              </VendorButton>
              <VendorButton
                variant="ghost"
                size="icon"
                className="vendor-btn-danger"
                onClick={() => onDelete(provider)}
                title="删除 provider"
              >
                <Trash2 size={14} />
              </VendorButton>
            </div>
          </div>
        ))}
      </div>

      {providers.length === 0 ? <div className="vendor-empty">当前还没有配置任何 provider。</div> : null}
    </div>
  );
}

export function VendorLocalConfigList({
  title,
  entries,
  emptyLabel,
}: {
  title: string;
  entries: VendorLocalConfigEntry[];
  emptyLabel: string;
}) {
  return (
    <div className="vendor-provider-list">
      <div className="vendor-list-header">
        <span className="vendor-list-title">{title}</span>
      </div>

      {entries.length === 0 ? (
        <div className="vendor-empty">{emptyLabel}</div>
      ) : (
        <div className="vendor-cards">
          {entries.map((entry) => (
            <div key={entry.id} className="vendor-card vendor-local-config-card">
              <div className="vendor-local-config-main">
                <div className="vendor-local-config-top">
                  <div className="vendor-card-name">{entry.name}</div>
                  {entry.badgeLabel ? (
                    <span className={badgeToneClass(entry.badgeTone === "muted" ? "default" : entry.badgeTone)}>
                      {entry.badgeLabel}
                    </span>
                  ) : null}
                </div>
                <div className="vendor-card-remark">{entry.summary}</div>
                {entry.meta ? <div className="vendor-card-meta">{entry.meta}</div> : null}
                <div className="vendor-local-config-fields">
                  {entry.fields.map((field) => (
                    <div
                      key={`${entry.id}-${field.label}`}
                      className={`vendor-local-config-field is-${field.tone ?? "default"}`}
                    >
                      <span className="vendor-local-config-field-label">{field.label}</span>
                      <strong
                        className={`vendor-local-config-field-value ${
                          field.monospace ? "is-monospace" : ""
                        }`}
                        title={field.value}
                      >
                        {field.value}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="vendor-local-config-source" title={entry.sourcePath}>
                  来源：{entry.sourcePath}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PluginModelsEntry({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <div
      className="vendor-plugin-model-entry"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <div className="vendor-plugin-model-entry-main">
        <PackagePlus size={16} />
        <span className="vendor-plugin-model-entry-title">Plugin Models</span>
        {count > 0 ? <span className="vendor-plugin-model-entry-count">{count}</span> : null}
      </div>
      <VendorButton variant="outline" size="sm" onClick={onClick}>
        <PackagePlus size={14} />
        管理模型
      </VendorButton>
    </div>
  );
}

export function ProviderDialog({
  isOpen,
  isNew,
  serviceType,
  provider,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  isNew: boolean;
  serviceType: ModelProviderServiceType;
  provider: ModelProviderConfig | null;
  onClose: () => void;
  onSave: (provider: ModelProviderConfig) => void;
}) {
  const meta = MODEL_PROVIDER_META[serviceType];
  const [draft, setDraft] = useState<ModelProviderConfig | null>(provider);
  const [modelsText, setModelsText] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setDraft(provider);
    setModelsText(
      provider?.models
        .map((model) => (model.label?.trim() ? `${model.id} | ${model.label.trim()}` : model.id))
        .join("\n") ?? "",
    );
  }, [isOpen, provider]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen || !draft) {
    return null;
  }

  return (
    <div className="vendor-dialog-overlay" onClick={onClose}>
      <div className="vendor-dialog vendor-dialog-wide" onClick={(event) => event.stopPropagation()}>
        <div className="vendor-dialog-header">
          <h3>{isNew ? `新增 ${meta.shortLabel} Provider` : `编辑 ${meta.shortLabel} Provider`}</h3>
          <button type="button" className="vendor-dialog-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="vendor-dialog-body">
          <div className="vendor-form-grid">
            <div className="vendor-form-group">
              <label>Provider 名称</label>
              <input
                className="vendor-input"
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
              />
            </div>
            <div className="vendor-form-group">
              <label>官网地址</label>
              <input
                className="vendor-input"
                value={draft.websiteUrl}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, websiteUrl: event.target.value } : current,
                  )
                }
              />
            </div>
          </div>

          <div className="vendor-form-grid">
            <div className="vendor-form-group">
              <label>Base URL</label>
              <input
                className="vendor-input"
                value={draft.baseUrl}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, baseUrl: event.target.value } : current,
                  )
                }
              />
            </div>
            <div className="vendor-form-group">
              <label>API Key</label>
              <input
                className="vendor-input"
                value={draft.apiKey}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, apiKey: event.target.value } : current,
                  )
                }
              />
            </div>
          </div>

          <div className="vendor-form-group">
            <label>模型列表</label>
            <textarea
              className="vendor-code-editor"
              rows={7}
              value={modelsText}
              onChange={(event) => setModelsText(event.target.value)}
              placeholder="model-id | 可选展示名"
            />
            <div className="vendor-hint">
              每行一个模型，格式为 `model-id` 或 `model-id | Label`。
            </div>
          </div>

          <div className="vendor-form-group">
            <label>备注</label>
            <textarea
              className="vendor-code-editor vendor-code-editor-sm"
              rows={4}
              value={draft.note}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, note: event.target.value } : current,
                )
              }
            />
          </div>
        </div>

        <div className="vendor-dialog-footer">
          <VendorButton variant="outline" onClick={onClose}>
            取消
          </VendorButton>
          <VendorButton
            onClick={() => {
              const models = modelsText
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => {
                  const [rawId, rawLabel] = line.split("|");
                  const id = rawId?.trim() ?? "";
                  const label = rawLabel?.trim() ?? "";
                  if (!id) {
                    return null;
                  }
                  return {
                    id,
                    name: id,
                    label: label || null,
                  };
                })
                .filter((item): item is NonNullable<typeof item> => Boolean(item));

              onSave({
                ...draft,
                name: draft.name.trim() || `${meta.shortLabel} Provider`,
                baseUrl: draft.baseUrl.trim(),
                apiKey: draft.apiKey.trim(),
                websiteUrl: draft.websiteUrl.trim(),
                note: draft.note,
                models,
              });
            }}
            disabled={!draft.name.trim()}
          >
            保存
          </VendorButton>
        </div>
      </div>
    </div>
  );
}

export function DeleteConfirmDialog({
  isOpen,
  providerName,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  providerName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onCancel]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="vendor-dialog-overlay" onClick={onCancel}>
      <div className="vendor-dialog vendor-dialog-sm" onClick={(event) => event.stopPropagation()}>
        <div className="vendor-dialog-header">
          <h3>删除 Provider</h3>
        </div>
        <div className="vendor-dialog-body">
          <p>确认删除 “{providerName}” 吗？该操作不会恢复。</p>
        </div>
        <div className="vendor-dialog-footer">
          <VendorButton variant="outline" onClick={onCancel}>
            取消
          </VendorButton>
          <VendorButton variant="danger" onClick={onConfirm}>
            删除
          </VendorButton>
        </div>
      </div>
    </div>
  );
}

export function CustomModelDialog({
  isOpen,
  models,
  onModelsChange,
  onClose,
}: {
  isOpen: boolean;
  models: VendorCustomModel[];
  onModelsChange: (models: VendorCustomModel[]) => void;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modelId, setModelId] = useState("");
  const [modelLabel, setModelLabel] = useState("");
  const [modelDescription, setModelDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setEditingId(null);
      setModelId("");
      setModelLabel("");
      setModelDescription("");
      setError(null);
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  const handleStartEdit = (model: VendorCustomModel) => {
    setEditingId(model.id);
    setModelId(model.id);
    setModelLabel(model.label);
    setModelDescription(model.description ?? "");
    setError(null);
  };

  const resetEditor = () => {
    setEditingId(null);
    setModelId("");
    setModelLabel("");
    setModelDescription("");
    setError(null);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="vendor-dialog-overlay" onClick={onClose}>
      <div
        className="vendor-dialog vendor-dialog-wide vendor-model-manager-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="vendor-dialog-header">
          <h3>管理 Plugin Models</h3>
          <button type="button" className="vendor-dialog-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="vendor-dialog-body">
          <div className="vendor-hint">
            为当前 CLI 维护一组额外模型 ID，便于在模型选择器中直接使用。
          </div>

          <div className="vendor-model-manager-list" role="list">
            {models.length === 0 ? (
              <div className="vendor-empty">当前还没有自定义 Plugin Models。</div>
            ) : (
              models.map((model) => (
                <div key={model.id} className="vendor-model-manager-item" role="listitem">
                  <div className="vendor-model-manager-main">
                    <div className="vendor-model-manager-id">{model.id}</div>
                    {model.label !== model.id ? (
                      <div className="vendor-model-manager-label">{model.label}</div>
                    ) : null}
                    {model.description ? (
                      <div className="vendor-model-manager-desc">{model.description}</div>
                    ) : null}
                  </div>
                  <div className="vendor-model-manager-actions">
                    <VendorButton
                      variant="ghost"
                      size="icon"
                      onClick={() => handleStartEdit(model)}
                    >
                      <Pencil size={14} />
                    </VendorButton>
                    <VendorButton
                      variant="ghost"
                      size="icon"
                      className="vendor-btn-danger"
                      onClick={() =>
                        onModelsChange(models.filter((item) => item.id !== model.id))
                      }
                    >
                      <Trash2 size={14} />
                    </VendorButton>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="vendor-model-manager-form">
            <div className="vendor-model-add">
              <input
                type="text"
                className="vendor-input vendor-input-sm"
                value={modelId}
                onChange={(event) => {
                  setModelId(event.target.value);
                  if (error) setError(null);
                }}
                placeholder="Model ID"
              />
              <input
                type="text"
                className="vendor-input vendor-input-sm"
                value={modelLabel}
                onChange={(event) => setModelLabel(event.target.value)}
                placeholder="显示名称"
              />
            </div>
            <input
              type="text"
              className="vendor-input vendor-input-sm"
              value={modelDescription}
              onChange={(event) => setModelDescription(event.target.value)}
              placeholder="描述（可选）"
            />
            {error ? <div className="vendor-json-error">{error}</div> : null}
            <div className="vendor-model-manager-form-actions">
              {editingId ? (
                <VendorButton variant="outline" onClick={resetEditor}>
                  取消编辑
                </VendorButton>
              ) : null}
              <VendorButton
                onClick={() => {
                  const nextId = modelId.trim();
                  if (!nextId) {
                    setError("Model ID 不能为空。");
                    return;
                  }
                  const duplicate = models.some(
                    (item) => item.id === nextId && item.id !== editingId,
                  );
                  if (duplicate) {
                    setError("Model ID 已存在。");
                    return;
                  }
                  const nextModel: VendorCustomModel = {
                    id: nextId,
                    label: modelLabel.trim() || nextId,
                    description: modelDescription.trim() || undefined,
                  };
                  if (editingId) {
                    onModelsChange(
                      models.map((item) => (item.id === editingId ? nextModel : item)),
                    );
                  } else {
                    onModelsChange([...models, nextModel]);
                  }
                  resetEditor();
                }}
              >
                {editingId ? "保存变更" : "新增模型"}
              </VendorButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GeminiVendorPanel({
  draft,
  preflightChecks,
  preflightLoading,
  savingEnv,
  savingConfig,
  showKey,
  error,
  savedAt,
  setShowKey,
  refreshPreflight,
  handleDraftEnvTextChange,
  handleSaveEnv,
  handleGeminiAuthModeChange,
  handleGeminiFieldChange,
  handleSaveConfig,
}: {
  draft: GeminiVendorDraft;
  preflightChecks: GeminiPreflightCheck[];
  preflightLoading: boolean;
  savingEnv: boolean;
  savingConfig: boolean;
  showKey: boolean;
  error: string | null;
  savedAt: number | null;
  setShowKey: React.Dispatch<React.SetStateAction<boolean>>;
  refreshPreflight: () => Promise<void>;
  handleDraftEnvTextChange: (value: string) => void;
  handleSaveEnv: () => Promise<void>;
  handleGeminiAuthModeChange: (mode: GeminiAuthMode) => void;
  handleGeminiFieldChange: (
    field:
      | "apiBaseUrl"
      | "geminiApiKey"
      | "googleApiKey"
      | "googleCloudProject"
      | "googleCloudLocation"
      | "googleApplicationCredentials"
      | "model",
    value: string,
  ) => void;
  handleSaveConfig: () => Promise<void>;
}) {
  const isVertexMode =
    draft.authMode === "vertex_adc" ||
    draft.authMode === "vertex_service_account" ||
    draft.authMode === "vertex_api_key";
  const shouldShowApiBaseUrl = draft.authMode === "custom";
  const shouldShowApiKey =
    draft.authMode === "custom" ||
    draft.authMode === "gemini_api_key" ||
    draft.authMode === "vertex_api_key";
  const keyLabel =
    draft.authMode === "vertex_api_key" ? "GOOGLE_API_KEY" : "GEMINI_API_KEY";
  const keyValue =
    draft.authMode === "vertex_api_key" ? draft.googleApiKey : draft.geminiApiKey;
  const SelectedModeIcon = GEMINI_AUTH_MODE_ICON_MAP[draft.authMode];

  return (
    <div className="vendor-gemini-shell">
      <div className="vendor-gemini-primary-grid">
        <section className="vendor-gemini-card vendor-gemini-card-checks">
          <div className="vendor-gemini-section-head">
            <span className="vendor-gemini-section-title vendor-gemini-section-title-grow">
              运行前检查 ({preflightChecks.length})
            </span>
            <VendorButton
              size="sm"
              variant="outline"
              className="vendor-gemini-refresh-btn"
              disabled={preflightLoading}
              onClick={() => {
                void refreshPreflight();
              }}
            >
              <RefreshCw className={preflightLoading ? "vendor-spin" : ""} size={14} />
              刷新
            </VendorButton>
          </div>
          <div className="vendor-gemini-check-list">
            {preflightChecks.map((check) => (
              <div key={check.id} className="vendor-gemini-check-row" title={check.message}>
                <div className="vendor-gemini-check-copy">
                  <span className="vendor-gemini-check-label">{check.label}</span>
                  <span className="vendor-gemini-check-message">{check.message}</span>
                </div>
                <span
                  className={`vendor-gemini-check-status ${
                    check.status === "pass" ? "is-pass" : "is-fail"
                  }`}
                >
                  {check.status.toUpperCase()}
                </span>
              </div>
            ))}
            {preflightChecks.length === 0 ? (
              <div className="vendor-gemini-empty-checks">
                {preflightLoading ? "正在刷新预检..." : "当前还没有可显示的预检项。"}
              </div>
            ) : null}
          </div>
        </section>

        <section className="vendor-gemini-card vendor-gemini-card-auth">
          <div className="vendor-gemini-auth-header">
            <div>
              <label className="vendor-gemini-section-title">认证配置</label>
            </div>
            <div className="vendor-gemini-auth-header-actions">
              <VendorButton
                size="sm"
                variant="outline"
                onClick={() => {
                  window.open(
                    "https://geminicli.com/docs/get-started/authentication/",
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
              >
                <ExternalLink size={14} />
                文档
              </VendorButton>
              <VendorButton
                size="sm"
                onClick={() => {
                  void handleSaveConfig();
                }}
                disabled={savingConfig}
              >
                <Save size={14} />
                {savingConfig ? "保存中..." : "保存配置"}
              </VendorButton>
            </div>
          </div>

          <div className="vendor-gemini-auth-grid">
            <div className="vendor-form-group vendor-gemini-auth-field vendor-gemini-auth-field-wide">
              <div className="vendor-gemini-auth-mode-selected">
                <SelectedModeIcon className="vendor-gemini-auth-mode-icon" />
                <span className="vendor-gemini-auth-mode-text">{modeLabel(draft.authMode)}</span>
              </div>
              <select
                id="gemini-auth-mode"
                className="vendor-input vendor-gemini-auth-mode-trigger"
                value={draft.authMode}
                onChange={(event) =>
                  handleGeminiAuthModeChange(event.target.value as GeminiAuthMode)
                }
              >
                {Object.keys(GEMINI_AUTH_MODE_ICON_MAP).map((mode) => {
                  const nextMode = mode as GeminiAuthMode;
                  return (
                    <option key={nextMode} value={nextMode}>
                      {modeLabel(nextMode)}
                    </option>
                  );
                })}
              </select>
            </div>

            {shouldShowApiBaseUrl ? (
              <div className="vendor-form-group vendor-gemini-auth-field vendor-gemini-auth-field-wide">
                <label htmlFor="gemini-api-base-url">GOOGLE_GEMINI_BASE_URL</label>
                <input
                  id="gemini-api-base-url"
                  className="vendor-input"
                  value={draft.apiBaseUrl}
                  placeholder="https://your-gemini-endpoint.example.com"
                  onChange={(event) =>
                    handleGeminiFieldChange("apiBaseUrl", event.target.value)
                  }
                />
              </div>
            ) : null}

            {shouldShowApiKey ? (
              <div className="vendor-form-group vendor-gemini-auth-field vendor-gemini-auth-field-wide">
                <label htmlFor="gemini-api-key">{keyLabel}</label>
                <div className="vendor-input-row">
                  <input
                    id="gemini-api-key"
                    className="vendor-input"
                    type={showKey ? "text" : "password"}
                    value={keyValue}
                    placeholder="AIza..."
                    onChange={(event) => {
                      if (draft.authMode === "vertex_api_key") {
                        handleGeminiFieldChange("googleApiKey", event.target.value);
                      } else {
                        handleGeminiFieldChange("geminiApiKey", event.target.value);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="vendor-btn-icon"
                    onClick={() => setShowKey((current) => !current)}
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            ) : null}

            {isVertexMode ? (
              <div className="vendor-model-grid vendor-gemini-auth-field vendor-gemini-auth-field-wide">
                <div>
                  <label htmlFor="gemini-cloud-project">GOOGLE_CLOUD_PROJECT</label>
                  <input
                    id="gemini-cloud-project"
                    className="vendor-input"
                    value={draft.googleCloudProject}
                    placeholder="my-gcp-project-id"
                    onChange={(event) =>
                      handleGeminiFieldChange("googleCloudProject", event.target.value)
                    }
                  />
                </div>
                <div>
                  <label htmlFor="gemini-cloud-location">GOOGLE_CLOUD_LOCATION</label>
                  <input
                    id="gemini-cloud-location"
                    className="vendor-input"
                    value={draft.googleCloudLocation}
                    placeholder="global / us-central1"
                    onChange={(event) =>
                      handleGeminiFieldChange("googleCloudLocation", event.target.value)
                    }
                  />
                </div>
              </div>
            ) : null}

            {draft.authMode === "vertex_service_account" ? (
              <div className="vendor-form-group vendor-gemini-auth-field vendor-gemini-auth-field-wide">
                <label htmlFor="gemini-google-application-credentials">
                  GOOGLE_APPLICATION_CREDENTIALS
                </label>
                <input
                  id="gemini-google-application-credentials"
                  className="vendor-input"
                  value={draft.googleApplicationCredentials}
                  placeholder="C:\\path\\to\\service-account.json"
                  onChange={(event) =>
                    handleGeminiFieldChange(
                      "googleApplicationCredentials",
                      event.target.value,
                    )
                  }
                />
              </div>
            ) : null}

          </div>
        </section>
      </div>

      <section className="vendor-gemini-card vendor-gemini-card-env">
        <label className="vendor-gemini-section-title">环境变量草稿</label>
        <textarea
          className="vendor-code-editor vendor-gemini-env-editor"
          value={draft.envText}
          onChange={(event) => handleDraftEnvTextChange(event.target.value)}
          placeholder={"GEMINI_API_KEY=...\nGEMINI_MODEL=gemini-3-pro-preview"}
        />
        <div className="vendor-gemini-actions-row">
          <VendorButton
            size="sm"
            onClick={() => {
              void handleSaveEnv();
            }}
            disabled={savingEnv}
          >
            <Save size={14} />
            {savingEnv ? "保存中..." : "保存环境变量"}
          </VendorButton>
        </div>
      </section>

      {error ? <div className="vendor-json-error">{error}</div> : null}
      {savedAt ? (
        <div className="vendor-gemini-saved-hint">
          上次保存于 {new Date(savedAt).toLocaleTimeString("zh-CN")}
        </div>
      ) : null}
    </div>
  );
}
