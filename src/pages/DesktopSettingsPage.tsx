import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Plus,
  Server,
  Settings,
} from "lucide-react";
import { useStore } from "../lib/store";
import { DesktopMcpSection } from "../components/settings/DesktopMcpSection";
import { DesktopSkillsSection } from "../components/settings/DesktopSkillsSection";
import { DesktopUsageSection } from "../components/settings/DesktopUsageSection";
import type {
  ModelProviderServiceType,
} from "../lib/models";
import {
  getProvidersForServiceType,
  MODEL_PROVIDER_META,
} from "../lib/modelProviders";
import { SERVICE_ICONS, maskSecret, relativeTime } from "../components/modelProviders/ui";

type SettingsSection = "settings" | "vendors" | "projects" | "mcp" | "skills" | "usage";

type VendorTab = {
  serviceType: ModelProviderServiceType;
  label: string;
};

type SidebarNavItem = {
  id: SettingsSection;
  label: string;
  icon: typeof Settings;
};

const VENDOR_TABS: VendorTab[] = [
  { serviceType: "claude", label: "Claude Code" },
  { serviceType: "openaiCompatible", label: "Codex" },
  { serviceType: "gemini", label: "Gemini CLI" },
];
const NAV_ITEMS: SidebarNavItem[] = [
  { id: "settings", label: "设置", icon: Settings },
  { id: "vendors", label: "供应商", icon: Settings },
  { id: "projects", label: "项目", icon: FolderOpen },
  { id: "mcp", label: "MCP", icon: Server },
  { id: "skills", label: "技能", icon: BookOpen },
  { id: "usage", label: "使用统计", icon: BarChart3 },
];

function parseSettingsSection(value: string | null): SettingsSection {
  switch (value) {
    case "projects":
    case "mcp":
    case "skills":
    case "vendors":
    case "settings":
    case "usage":
      return value;
    default:
      return "settings";
  }
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function badgeToneClass(tone: "default" | "success" | "warn" = "default") {
  if (tone === "success") return "dcc-badge dcc-badge-success";
  if (tone === "warn") return "dcc-badge dcc-badge-warn";
  return "dcc-badge";
}

export function DesktopSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const settings = useStore((state) => state.settings);
  const workspaces = useStore((state) => state.workspaces);
  const terminalTabs = useStore((state) => state.terminalTabs);
  const activeTerminalTabId = useStore((state) => state.activeTerminalTabId);
  const setActiveTerminalTab = useStore((state) => state.setActiveTerminalTab);
  const openWorkspaceFolder = useStore((state) => state.openWorkspaceFolder);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeVendorTab, setActiveVendorTab] = useState<ModelProviderServiceType>("claude");

  const activeSection = parseSettingsSection(searchParams.get("section"));
  const activeTerminalTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === activeTerminalTab?.workspaceId) ?? workspaces[0] ?? null;

  const providerGroups = useMemo(() => {
    if (!settings) return [];
    return VENDOR_TABS.map(({ serviceType, label }) => ({
      serviceType,
      label,
      providers: getProvidersForServiceType(settings, serviceType),
      meta: MODEL_PROVIDER_META[serviceType],
    }));
  }, [settings]);

  useEffect(() => {
    const saved = window.localStorage.getItem("desktop_settings_sidebar_collapsed");
    if (saved) {
      setSidebarCollapsed(saved === "1");
    }
  }, []);

  function openSection(section: SettingsSection) {
    const next = new URLSearchParams(searchParams);
    next.set("section", section);
    setSearchParams(next, { replace: true });
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("desktop_settings_sidebar_collapsed", next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className="settings-embedded dcc-settings-root">
      <div className="settings-header" />
      <div className={cx("settings-body", sidebarCollapsed && "is-sidebar-collapsed")}>
        <aside className={cx("settings-sidebar", sidebarCollapsed && "is-collapsed")}>
          <button
            type="button"
            className="settings-nav settings-nav-return"
            onClick={() => navigate("/terminal")}
            title={sidebarCollapsed ? "返回应用" : ""}
          >
            <ArrowLeft aria-hidden />
            {!sidebarCollapsed ? "返回应用" : null}
          </button>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={cx("settings-nav", activeSection === item.id && "active")}
                onClick={() => openSection(item.id)}
                title={sidebarCollapsed ? item.label : ""}
              >
                <Icon aria-hidden />
                {!sidebarCollapsed ? item.label : null}
              </button>
            );
          })}
          <button
            type="button"
            className="settings-sidebar-toggle"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </aside>

        <main className="settings-content">
          <div className="dcc-settings-scroll">
            {activeSection === "settings" ? (
              <section className="settings-section">
                <div className="settings-section-title">设置</div>
                <div className="settings-section-subtitle">
                  管理运行时路径、项目根目录、通知能力和执行限制。
                </div>
                <div className="dcc-detail-grid">
                  <div className="dcc-detail-panel">
                    <div className="dcc-panel-title">CLI 路径</div>
                    <div className="dcc-detail-row">
                      <span>Codex</span>
                      <strong>{settings?.cliPaths.codex || "自动检测"}</strong>
                    </div>
                    <div className="dcc-detail-row">
                      <span>Claude Code</span>
                      <strong>{settings?.cliPaths.claude || "自动检测"}</strong>
                    </div>
                    <div className="dcc-detail-row">
                      <span>Gemini CLI</span>
                      <strong>{settings?.cliPaths.gemini || "自动检测"}</strong>
                    </div>
                  </div>
                  <div className="dcc-detail-panel">
                    <div className="dcc-panel-title">工作区默认值</div>
                    <div className="dcc-detail-row">
                      <span>项目根目录</span>
                      <strong>{settings?.projectRoot || "不可用"}</strong>
                    </div>
                    <div className="dcc-detail-row">
                      <span>桌面通知</span>
                      <strong>{settings?.notifyOnTerminalCompletion ? "已启用" : "已禁用"}</strong>
                    </div>
                    <div className="dcc-detail-row">
                      <span>邮件通知</span>
                      <strong>{settings?.notificationConfig.smtpEnabled ? "已启用" : "已禁用"}</strong>
                    </div>
                  </div>
                  <div className="dcc-detail-panel">
                    <div className="dcc-panel-title">执行限制</div>
                    <div className="dcc-detail-row">
                      <span>每个代理最大轮次</span>
                      <strong>{settings?.maxTurnsPerAgent ?? 0}</strong>
                    </div>
                    <div className="dcc-detail-row">
                      <span>每轮最大输出字符数</span>
                      <strong>{settings?.maxOutputCharsPerTurn ?? 0}</strong>
                    </div>
                    <div className="dcc-detail-row">
                      <span>进程超时</span>
                      <strong>{settings?.processTimeoutMs ?? 0} ms</strong>
                    </div>
                  </div>
                  <div className="dcc-detail-panel">
                    <div className="dcc-panel-title">快捷设置</div>
                    <div className="dcc-empty-state">
                      当前设置页已经独立于主界面布局，后续可以继续把更多通用设置编辑能力补到这里。
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {activeSection === "vendors" ? (
              <section className="settings-section">
                <div className="settings-section-title">供应商</div>
                <div className="settings-section-subtitle">
                  这里展示设置壳中的供应商概览。`/model-providers` 页面仍然是独立的模型对话提供商管理页面。
                </div>
                <div className="dcc-vendors-tabs">
                  {VENDOR_TABS.map((tab) => (
                    <button
                      key={tab.serviceType}
                      type="button"
                      className={cx("dcc-vendors-tab", activeVendorTab === tab.serviceType && "is-active")}
                      onClick={() => setActiveVendorTab(tab.serviceType)}
                    >
                      <img src={SERVICE_ICONS[tab.serviceType]} alt="" className="dcc-vendors-tab-icon" />
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>
                {providerGroups
                  .filter((group) => group.serviceType === activeVendorTab)
                  .map((group) => (
                    <div key={group.serviceType} className="dcc-surface-card">
                      <div className="dcc-card-head">
                        <div>
                          <div className="dcc-card-title-row">
                            <img src={SERVICE_ICONS[group.serviceType]} alt="" className="dcc-provider-service-icon" />
                            <div className="dcc-card-title">{group.label}</div>
                            <span className={badgeToneClass(group.providers.some((provider) => provider.enabled) ? "success" : "default")}>
                              {group.providers.length} 个提供商
                            </span>
                          </div>
                          <div className="dcc-card-description">{group.meta.description}</div>
                        </div>
                      </div>
                      <div className="dcc-provider-list">
                        {group.providers.map((provider) => (
                          <div key={provider.id} className="dcc-provider-row">
                            <div className="dcc-provider-main">
                              <div className="dcc-provider-name-row">
                                <span className="dcc-provider-name">{provider.name}</span>
                                <span className={badgeToneClass(provider.enabled ? "success" : "default")}>
                                  {provider.enabled ? "已启用" : "已禁用"}
                                </span>
                              </div>
                              <div className="dcc-provider-url">{provider.baseUrl}</div>
                              <div className="dcc-provider-meta">
                                {provider.models.length} 个模型 · 密钥 {maskSecret(provider.apiKey)} · {relativeTime(provider.lastRefreshedAt)}
                              </div>
                            </div>
                            <Link
                              to={`/model-providers/${provider.serviceType}/${provider.id}`}
                              className="dcc-action-button secondary"
                            >
                              编辑
                            </Link>
                          </div>
                        ))}
                        {group.providers.length === 0 ? (
                          <div className="dcc-empty-state">当前分类下还没有配置任何提供商。</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
              </section>
            ) : null}

            {activeSection === "projects" ? (
              <section className="settings-section">
                <div className="settings-section-title">项目</div>
                <div className="settings-section-subtitle">
                  查看已挂载的工作区，并直接跳回对应终端工作区。
                </div>
                <div className="dcc-toolbar-row">
                  <button type="button" className="dcc-action-button" onClick={() => void openWorkspaceFolder()}>
                    <Plus size={14} />
                    添加项目
                  </button>
                </div>
                <div className="dcc-surface-card">
                  <div className="dcc-card-head">
                    <div>
                      <div className="dcc-card-title">已挂载项目</div>
                      <div className="dcc-card-description">
                        当前共挂载 {workspaces.length} 个项目。
                      </div>
                    </div>
                  </div>
                  <div className="dcc-project-list">
                    {workspaces.map((workspace) => {
                      const workspaceTab = terminalTabs.find((tab) => tab.workspaceId === workspace.id) ?? null;
                      const isActive = workspace.id === selectedWorkspace?.id;
                      return (
                        <div key={workspace.id} className="dcc-project-row">
                          <div className="dcc-project-main">
                            <div className="dcc-provider-name-row">
                              <span className="dcc-provider-name">{workspace.name}</span>
                              {isActive ? <span className={badgeToneClass("success")}>当前</span> : null}
                            </div>
                            <div className="dcc-provider-url">{workspace.rootPath}</div>
                            <div className="dcc-provider-meta">
                              分支 {workspace.branch} · 已修改 {workspace.dirtyFiles} · 失败检查 {workspace.failingChecks}
                            </div>
                          </div>
                          {workspaceTab ? (
                            <button
                              type="button"
                              className="dcc-action-button secondary"
                              onClick={() => {
                                setActiveTerminalTab(workspaceTab.id);
                                navigate("/terminal");
                              }}
                            >
                              打开终端
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                    {workspaces.length === 0 ? (
                      <div className="dcc-empty-state">暂时还没有挂载任何项目。</div>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}

            {activeSection === "mcp" ? (
              <DesktopMcpSection activeWorkspace={selectedWorkspace} />
            ) : null}

            {activeSection === "skills" ? (
              <DesktopSkillsSection activeWorkspace={selectedWorkspace} />
            ) : null}

            {activeSection === "usage" ? (
              <DesktopUsageSection activeWorkspace={selectedWorkspace} workspaces={workspaces} />
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
