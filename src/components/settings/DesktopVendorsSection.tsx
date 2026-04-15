import type { AgentCard, AgentId, AppSettings, AgentResourceKind } from "../../lib/models";
import { SERVICE_ICONS } from "../modelProviders/ui";

type CliVendorTab = {
  cli: AgentId;
  label: string;
  description: string;
  icon: string;
};

const VENDOR_TABS: CliVendorTab[] = [
  {
    cli: "claude",
    label: "Claude Code",
    description: "展示 Claude Code 的本地路径、运行时状态与资源支持情况。",
    icon: SERVICE_ICONS.claude,
  },
  {
    cli: "codex",
    label: "Codex",
    description: "展示 Codex 的本地路径、运行时状态与资源支持情况。",
    icon: SERVICE_ICONS.openaiCompatible,
  },
  {
    cli: "gemini",
    label: "Gemini CLI",
    description: "展示 Gemini CLI 的本地路径、运行时状态与资源支持情况。",
    icon: SERVICE_ICONS.gemini,
  },
];

const RESOURCE_ORDER: AgentResourceKind[] = ["mcp", "skill", "plugin", "extension"];
const RESOURCE_LABEL: Record<AgentResourceKind, string> = {
  mcp: "MCP",
  skill: "技能",
  plugin: "插件",
  extension: "扩展",
};

function badgeToneClass(tone: "default" | "success" | "warn" = "default") {
  if (tone === "success") return "dcc-badge dcc-badge-success";
  if (tone === "warn") return "dcc-badge dcc-badge-warn";
  return "dcc-badge";
}

function cliPath(settings: AppSettings | null, cli: AgentId) {
  return settings?.cliPaths[cli]?.trim() || "自动检测";
}

function resourceSummary(agent: AgentCard | null, kind: AgentResourceKind) {
  const group = agent?.runtime.resources[kind];
  if (!group) return "未检测";
  if (!group.supported) return "不支持";
  if (group.error) return "异常";
  return `${group.items.length} 项`;
}

export function DesktopVendorsSection({
  settings,
  agents,
  activeVendorTab,
  onChangeVendorTab,
  title = "供应商",
  subtitle = "这里只展示当前接入的 Claude Code、Codex、Gemini CLI 配置。",
}: {
  settings: AppSettings | null;
  agents: AgentCard[];
  activeVendorTab: AgentId;
  onChangeVendorTab: (cli: AgentId) => void;
  title?: string;
  subtitle?: string;
}) {
  const activeTab = VENDOR_TABS.find((item) => item.cli === activeVendorTab) ?? VENDOR_TABS[0];
  const activeAgent = agents.find((item) => item.id === activeTab.cli) ?? null;
  const runtimeInstalled = activeAgent?.runtime.installed ?? false;
  const runtimeVersion = activeAgent?.runtime.version?.trim() || "未检测";
  const configuredPath = cliPath(settings, activeTab.cli);
  const resolvedPath = activeAgent?.runtime.commandPath?.trim() || "未检测";
  const pathConfiguredManually = configuredPath !== "自动检测";

  return (
    <section className="settings-section">
      <div className="settings-section-title">{title}</div>
      <div className="settings-section-subtitle">{subtitle}</div>

      <div className="dcc-vendors-tabs">
        {VENDOR_TABS.map((tab) => (
          <button
            key={tab.cli}
            type="button"
            className={`dcc-vendors-tab ${activeVendorTab === tab.cli ? "is-active" : ""}`}
            onClick={() => onChangeVendorTab(tab.cli)}
          >
            <img src={tab.icon} alt="" className="dcc-vendors-tab-icon" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="dcc-surface-card">
        <div className="dcc-card-head">
          <div>
            <div className="dcc-card-title-row">
              <img src={activeTab.icon} alt="" className="dcc-provider-service-icon" />
              <div className="dcc-card-title">{activeTab.label}</div>
              <span className={badgeToneClass(runtimeInstalled ? "success" : "warn")}>
                {runtimeInstalled ? "已安装" : "未安装"}
              </span>
              <span className={badgeToneClass(pathConfiguredManually ? "success" : "default")}>
                {pathConfiguredManually ? "自定义路径" : "自动检测"}
              </span>
            </div>
            <div className="dcc-card-description">{activeTab.description}</div>
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
                <strong>{resourceSummary(activeAgent, kind)}</strong>
              </div>
            ))}
          </div>

          <div className="dcc-detail-panel">
            <div className="dcc-panel-title">全局执行</div>
            <div className="dcc-detail-row">
              <span>项目根目录</span>
              <strong>{settings?.projectRoot || "不可用"}</strong>
            </div>
            <div className="dcc-detail-row">
              <span>进程超时</span>
              <strong>{settings?.processTimeoutMs ?? 0} ms</strong>
            </div>
          </div>
        </div>

        {activeAgent?.runtime.lastError ? (
          <div className="dcc-inline-error">{activeAgent.runtime.lastError}</div>
        ) : null}

        {!runtimeInstalled ? (
          <div className="dcc-empty-state">
            当前未检测到该 CLI。可先在“设置”页填写自定义 CLI 路径，或安装后重新刷新运行时。
          </div>
        ) : null}
      </div>
    </section>
  );
}
