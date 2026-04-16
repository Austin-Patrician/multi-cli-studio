import { useCallback, useMemo, useState } from "react";
import {
  getProvidersForServiceType,
} from "../../lib/modelProviders";
import type {
  AgentCard,
  AgentId,
  AppSettings,
  VendorConfigField,
  VendorLocalConfigEntry,
} from "../../lib/models";
import { bridge } from "../../lib/bridge";
import { useStore } from "../../lib/store";
import { SERVICE_ICONS } from "../modelProviders/ui";
import {
  useClaudeConfigFile,
  useCodexConfigFiles,
  useGeminiVendorDraft,
  usePluginModels,
} from "./vendors/hooks";
import { VENDOR_MODEL_STORAGE_KEYS } from "./vendors/types";
import type { VendorTab } from "./vendors/types";
import {
  CurrentClaudeConfigCard,
  CurrentCodexGlobalConfigCard,
  CustomModelDialog,
  GeminiVendorPanel,
  PluginModelsEntry,
  VendorButton,
} from "./vendors/VendorPanels";

type CliVendorTab = {
  cli: VendorTab;
  label: string;
  description: string;
  icon: string;
};

type CodexReloadState = {
  status: "idle" | "reloading" | "applied" | "failed";
  message: string | null;
};

const VENDOR_TABS: CliVendorTab[] = [
  {
    cli: "claude",
    label: "Claude Code",
    description: "参考 `VendorSettingsPanel` 的完整配置与 provider 管理视图。",
    icon: SERVICE_ICONS.claude,
  },
  {
    cli: "codex",
    label: "Codex",
    description: "参考 `VendorSettingsPanel` 的完整配置与 provider 管理视图。",
    icon: SERVICE_ICONS.openaiCompatible,
  },
  {
    cli: "gemini",
    label: "Gemini CLI",
    description: "参考 `VendorSettingsPanel` 的完整配置与 provider 管理视图。",
    icon: SERVICE_ICONS.gemini,
  },
];

function maskSecret(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "未配置";
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}••••••${trimmed.slice(-2)}`;
}

function readJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readNestedString(source: Record<string, unknown> | null, path: string[]) {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return "";
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current.trim() : "";
}

function readStringArray(source: Record<string, unknown> | null, key: string) {
  const value = source?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readTomlString(content: string, key: string) {
  const match = content.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*["']([^"']+)["']`, "m"));
  return match?.[1]?.trim() || "";
}

function buildClaudeLocalView(settingsFile: {
  path: string;
  exists: boolean;
  content: string;
  error: string | null;
}) {
  const parsed = settingsFile.exists ? readJsonObject(settingsFile.content) : null;
  const env = parsed?.env;
  const envObject =
    env && typeof env === "object" && !Array.isArray(env)
      ? (env as Record<string, unknown>)
      : null;
  const baseUrl = readNestedString({ env: envObject ?? {} }, ["env", "ANTHROPIC_BASE_URL"]);
  const authToken = readNestedString({ env: envObject ?? {} }, ["env", "ANTHROPIC_AUTH_TOKEN"]);
  const primaryModel =
    readNestedString(parsed, ["model"]) ||
    readNestedString({ env: envObject ?? {} }, ["env", "ANTHROPIC_MODEL"]) ||
    readNestedString({ env: envObject ?? {} }, ["env", "ANTHROPIC_DEFAULT_SONNET_MODEL"]) ||
    "跟随 Claude CLI 默认";
  const availableModels = readStringArray(parsed, "availableModels");
  const aliasModels = [
    readNestedString({ env: envObject ?? {} }, ["env", "ANTHROPIC_DEFAULT_HAIKU_MODEL"]),
    readNestedString({ env: envObject ?? {} }, ["env", "ANTHROPIC_DEFAULT_SONNET_MODEL"]),
    readNestedString({ env: envObject ?? {} }, ["env", "ANTHROPIC_DEFAULT_OPUS_MODEL"]),
  ].filter((value, index, array) => value && array.indexOf(value) === index);
  const hasConfig = settingsFile.exists && Boolean(parsed);

  const fields: VendorConfigField[] = hasConfig
    ? [
        { label: "主模型", value: primaryModel },
        { label: "API Base URL", value: baseUrl || "Anthropic 官方默认", monospace: Boolean(baseUrl) },
        { label: "认证 Token", value: maskSecret(authToken), monospace: Boolean(authToken) },
        {
          label: "可选模型",
          value: availableModels.length > 0 ? `${availableModels.length} 个` : "未在 settings.json 中声明",
        },
      ]
    : [];

  const entryFields: VendorConfigField[] = hasConfig
    ? [
        { label: "主模型", value: primaryModel },
        { label: "Base URL", value: baseUrl || "官方默认", monospace: Boolean(baseUrl) },
        {
          label: "认证状态",
          value: authToken ? "已配置 ANTHROPIC_AUTH_TOKEN" : "未配置 Token",
          tone: authToken ? "success" : "warn",
        },
        {
          label: "模型来源",
          value:
            availableModels.length > 0
              ? `availableModels ${availableModels.length} 项`
              : aliasModels.length > 0
                ? `默认模型别名 ${aliasModels.length} 项`
                : "仅使用 CLI 默认模型",
        },
      ]
    : [];

  const entries: VendorLocalConfigEntry[] = hasConfig
    ? [
        {
          id: "claude-local-settings",
          name: "本地 Claude settings.json",
          sourcePath: settingsFile.path || "~/.claude/settings.json",
          summary: "页面直接读取 Claude CLI 本地配置文件中的模型与环境变量。",
          meta:
            availableModels.length > 0
              ? `availableModels ${availableModels.length} 项`
              : aliasModels.length > 0
                ? `默认模型别名 ${aliasModels.length} 项`
                : "当前未声明额外模型列表",
          badgeLabel: authToken ? "已配置" : "部分配置",
          badgeTone: authToken ? "success" : "warn",
          fields: entryFields,
        },
      ]
    : [];
  const badgeTone: "default" | "success" | "warn" = hasConfig
    ? "success"
    : settingsFile.error
      ? "warn"
      : "default";

  return {
    title: "当前 Claude CLI 配置",
    subtitle: settingsFile.path || "~/.claude/settings.json",
    badgeLabel: hasConfig ? "settings.json" : settingsFile.error ? "读取失败" : "未发现配置",
    badgeTone,
    fields,
    emptyLabel: settingsFile.error
      ? `读取 Claude 配置失败：${settingsFile.error}`
      : "当前未发现 ~/.claude/settings.json，无法展示本地 Claude CLI 配置。",
    entries,
  };
}

function buildCodexLocalView(configFiles: {
  config: { path: string; exists: boolean; content: string; error: string | null };
  auth: { path: string; exists: boolean; content: string; error: string | null };
}) {
  const model = readTomlString(configFiles.config.content, "model") || "跟随 Codex CLI 默认";
  const providerName =
    readTomlString(configFiles.config.content, "model_provider") ||
    readTomlString(configFiles.config.content, "provider") ||
    "默认 provider";
  const baseUrl = readTomlString(configFiles.config.content, "base_url");
  const hasConfig = configFiles.config.exists;
  const hasAuth = configFiles.auth.exists && configFiles.auth.content.trim().length > 0;
  const authParsed = readJsonObject(configFiles.auth.content);
  const authEntryCount = authParsed ? Object.keys(authParsed).length : 0;

  const fields: VendorConfigField[] = hasConfig
    ? [
        { label: "默认模型", value: model },
        { label: "Provider 标识", value: providerName, monospace: providerName !== "默认 provider" },
        { label: "Base URL", value: baseUrl || "未在 config.toml 中声明", monospace: Boolean(baseUrl) },
        {
          label: "Auth 配置",
          value: hasAuth ? `auth.json 已存在${authEntryCount > 0 ? ` · ${authEntryCount} 个顶层键` : ""}` : "未发现 auth.json",
          tone: hasAuth ? "success" : "warn",
        },
      ]
    : [];

  const entries: VendorLocalConfigEntry[] = hasConfig
    ? [
        {
          id: "codex-local-config",
          name: "本地 Codex config.toml",
          sourcePath: configFiles.config.path || "~/.codex/config.toml",
          summary: "页面直接读取 Codex CLI 本地配置与认证文件。",
          meta: hasAuth ? "auth.json 已联动读取" : "当前未发现 auth.json",
          badgeLabel: hasAuth ? "已联动 auth" : "仅 config",
          badgeTone: hasAuth ? "success" : "warn",
          fields: [
            { label: "模型", value: model },
            { label: "Provider", value: providerName, monospace: providerName !== "默认 provider" },
            { label: "Base URL", value: baseUrl || "未声明", monospace: Boolean(baseUrl) },
            {
              label: "认证状态",
              value: hasAuth ? "auth.json 已存在" : "未发现 auth.json",
              tone: hasAuth ? "success" : "warn",
            },
          ],
        },
      ]
    : [];
  const badgeTone: "default" | "success" | "warn" = hasConfig
    ? "success"
    : configFiles.config.error
      ? "warn"
      : "default";

  return {
    title: "当前 Codex CLI 配置",
    subtitle: configFiles.config.path || "~/.codex/config.toml",
    badgeLabel: hasConfig ? "config.toml" : configFiles.config.error ? "读取失败" : "未发现配置",
    badgeTone,
    fields,
    emptyLabel: configFiles.config.error
      ? `读取 Codex 配置失败：${configFiles.config.error}`
      : "当前未发现 ~/.codex/config.toml，无法展示本地 Codex CLI 配置。",
    entries,
  };
}

export function DesktopVendorsSection({
  settings,
  agents,
  activeVendorTab,
  onChangeVendorTab,
  title = "供应商",
  subtitle = "在这里统一管理 Claude Code、Codex、Gemini CLI 的 provider、plugin models 与本地配置。",
}: {
  settings: AppSettings | null;
  agents: AgentCard[];
  activeVendorTab: AgentId;
  onChangeVendorTab: (cli: AgentId) => void;
  title?: string;
  subtitle?: string;
}) {
  const activeAgent = agents.find((item) => item.id === activeVendorTab) ?? null;
  const [modelDialogTarget, setModelDialogTarget] = useState<VendorTab | null>(null);
  const [codexReloadState, setCodexReloadState] = useState<CodexReloadState>({
    status: "idle",
    message: null,
  });

  const claudeModels = usePluginModels(VENDOR_MODEL_STORAGE_KEYS.claude);
  const codexModels = usePluginModels(VENDOR_MODEL_STORAGE_KEYS.codex);
  const geminiModels = usePluginModels(VENDOR_MODEL_STORAGE_KEYS.gemini);
  const claudeConfigFile = useClaudeConfigFile();
  const codexConfigFiles = useCodexConfigFiles();

  const geminiProviders = settings ? getProvidersForServiceType(settings, "gemini") : [];
  const geminiDraft = useGeminiVendorDraft(activeAgent, geminiProviders);
  const claudeLocalView = useMemo(
    () => buildClaudeLocalView(claudeConfigFile.settings),
    [claudeConfigFile.settings],
  );
  const codexLocalView = useMemo(
    () => buildCodexLocalView(codexConfigFiles),
    [codexConfigFiles],
  );

  const refreshRuntimeState = useCallback(
    async (refreshRuntime = true) => {
      if (!settings?.projectRoot) {
        return;
      }
      try {
        const nextState = await bridge.loadAppState(settings.projectRoot, refreshRuntime);
        useStore.getState().setAppState(nextState);
      } catch {
        // ignore runtime refresh failures
      }
    },
    [settings?.projectRoot],
  );

  const handleReloadCodexRuntimeConfig = useCallback(async () => {
    setCodexReloadState({ status: "reloading", message: null });
    try {
      const result = await bridge.reloadCodexRuntimeConfig();
      setCodexReloadState({
        status: "applied",
        message: result.message ?? `已刷新，影响会话 ${result.restartedSessions} 个。`,
      });
    } catch (error) {
      setCodexReloadState({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await codexConfigFiles.refresh();
      await refreshRuntimeState(true);
    }
  }, [codexConfigFiles, refreshRuntimeState]);

  const currentModelDialogModels = useMemo(() => {
    if (modelDialogTarget === "codex") return codexModels.models;
    if (modelDialogTarget === "gemini") return geminiModels.models;
    return claudeModels.models;
  }, [claudeModels.models, codexModels.models, geminiModels.models, modelDialogTarget]);

  const updateCurrentModelDialogModels = (models: typeof currentModelDialogModels) => {
    if (modelDialogTarget === "codex") {
      codexModels.updateModels(models);
      return;
    }
    if (modelDialogTarget === "gemini") {
      geminiModels.updateModels(models);
      return;
    }
    claudeModels.updateModels(models);
  };

  return (
    <>
      <section className="settings-section vendor-settings-panel">
        <div className="vendor-section-title">{title}</div>
        <div className="vendor-section-desc">{subtitle}</div>

        <div className="vendor-tabs" role="tablist" aria-label="Vendors">
          {VENDOR_TABS.map((tab) => (
            <button
              key={tab.cli}
              type="button"
              className="vendor-tab"
              data-state={activeVendorTab === tab.cli ? "active" : "inactive"}
              data-active={activeVendorTab === tab.cli ? "" : undefined}
              onClick={() => onChangeVendorTab(tab.cli)}
            >
              <span className="vendor-tab-label">
                <img src={tab.icon} alt="" className="dcc-vendors-tab-icon" />
                <span>{tab.label}</span>
              </span>
            </button>
          ))}
        </div>

        {activeVendorTab === "claude" ? (
          <div className="vendor-tab-content">
            <PluginModelsEntry
              count={claudeModels.models.length}
              onClick={() => setModelDialogTarget("claude")}
            />
            <CurrentClaudeConfigCard
              kicker="LOCAL CLI"
              title={claudeLocalView.title}
              subtitle={claudeLocalView.subtitle}
              badgeLabel={claudeLocalView.badgeLabel}
              badgeTone={claudeLocalView.badgeTone}
              fields={claudeLocalView.fields}
              emptyLabel={claudeLocalView.emptyLabel}
            />
          </div>
        ) : null}

        {activeVendorTab === "codex" ? (
          <div className="vendor-tab-content">
            <div className="vendor-inline-toolbar">
              <VendorButton
                variant="outline"
                size="sm"
                onClick={() => {
                  void handleReloadCodexRuntimeConfig();
                }}
                disabled={codexReloadState.status === "reloading"}
              >
                刷新 Codex 运行时
              </VendorButton>
              <span className="settings-inline-muted">
                读取 `~/.codex/config.toml` 与 `auth.json`，并刷新当前运行时状态。
              </span>
            </div>
            {codexReloadState.status !== "idle" ? (
              <div className="settings-help">
                {codexReloadState.status === "failed" ? "刷新失败" : "刷新完成"}
                {codexReloadState.message ? `：${codexReloadState.message}` : ""}
              </div>
            ) : null}
            <CurrentClaudeConfigCard
              title={codexLocalView.title}
              subtitle={codexLocalView.subtitle}
              badgeLabel={codexLocalView.badgeLabel}
              badgeTone={codexLocalView.badgeTone}
              fields={codexLocalView.fields}
              emptyLabel={codexLocalView.emptyLabel}
            />
            <CurrentCodexGlobalConfigCard state={codexConfigFiles} />
            <PluginModelsEntry
              count={codexModels.models.length}
              onClick={() => setModelDialogTarget("codex")}
            />
          </div>
        ) : null}

        {activeVendorTab === "gemini" ? (
          <div className="vendor-tab-content">
            <PluginModelsEntry
              count={geminiModels.models.length}
              onClick={() => setModelDialogTarget("gemini")}
            />
            <GeminiVendorPanel {...geminiDraft} />
          </div>
        ) : null}

        {!activeAgent?.runtime.installed ? (
          <div className="dcc-empty-state">
            当前未检测到该 CLI。可先在“设置”页填写自定义 CLI 路径，或安装后重新刷新运行时。
          </div>
        ) : null}
      </section>

      <CustomModelDialog
        isOpen={Boolean(modelDialogTarget)}
        models={currentModelDialogModels}
        onModelsChange={updateCurrentModelDialogModels}
        onClose={() => setModelDialogTarget(null)}
      />
    </>
  );
}
