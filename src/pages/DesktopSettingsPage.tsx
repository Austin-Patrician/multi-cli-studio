import { useEffect, useState } from "react";
import { useLocation, useNavigate, useOutlet, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Cpu,
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
import { DesktopVendorsSection } from "../components/settings/DesktopVendorsSection";
import type {
  AgentId,
} from "../lib/models";

type SettingsSection = "settings" | "models" | "vendors" | "projects" | "mcp" | "skills" | "usage";

type SidebarNavItem = {
  id: SettingsSection;
  label: string;
  icon: typeof Settings;
};

const NAV_ITEMS: SidebarNavItem[] = [
  { id: "settings", label: "设置", icon: Settings },
  { id: "models", label: "模型管理", icon: Cpu },
  { id: "vendors", label: "供应商", icon: Settings },
  { id: "projects", label: "项目", icon: FolderOpen },
  { id: "mcp", label: "MCP", icon: Server },
  { id: "skills", label: "技能", icon: BookOpen },
  { id: "usage", label: "使用统计", icon: BarChart3 },
];

function parseSettingsSection(value: string | null): SettingsSection {
  switch (value) {
    case "models":
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
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();

  const settings = useStore((state) => state.settings);
  const appState = useStore((state) => state.appState);
  const workspaces = useStore((state) => state.workspaces);
  const terminalTabs = useStore((state) => state.terminalTabs);
  const activeTerminalTabId = useStore((state) => state.activeTerminalTabId);
  const setActiveTerminalTab = useStore((state) => state.setActiveTerminalTab);
  const openWorkspaceFolder = useStore((state) => state.openWorkspaceFolder);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeVendorTab, setActiveVendorTab] = useState<AgentId>("claude");

  const isGeneralSettingsRoute = location.pathname.startsWith("/settings/general");
  const isModelProvidersRoute = location.pathname.startsWith("/settings/model-providers");
  const activeSection = isModelProvidersRoute
    ? "models"
    : isGeneralSettingsRoute
      ? "settings"
      : parseSettingsSection(searchParams.get("section"));
  const activeTerminalTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === activeTerminalTab?.workspaceId) ?? workspaces[0] ?? null;

  useEffect(() => {
    const saved = window.localStorage.getItem("desktop_settings_sidebar_collapsed");
    if (saved) {
      setSidebarCollapsed(saved === "1");
    }
  }, []);

  function openSection(section: SettingsSection) {
    if (section === "settings") {
      navigate("/settings/general");
      return;
    }

    if (section === "models") {
      navigate("/settings/model-providers");
      return;
    }

    const next = new URLSearchParams();
    next.set("section", section);
    navigate(
      next.toString().length > 0 ? `/settings?${next.toString()}` : "/settings",
      { replace: location.pathname === "/settings" }
    );
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
          <div className={cx("dcc-settings-scroll", outlet && "is-full-width")}>
            {outlet ? (
              outlet
            ) : activeSection === "settings" ? (
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

            {!outlet && activeSection === "vendors" ? (
              <DesktopVendorsSection
                settings={settings}
                agents={appState?.agents ?? []}
                activeVendorTab={activeVendorTab}
                onChangeVendorTab={setActiveVendorTab}
                subtitle="这里只展示当前接入的 Claude Code、Codex、Gemini CLI 配置。"
              />
            ) : null}

            {!outlet && activeSection === "projects" ? (
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

            {!outlet && activeSection === "mcp" ? (
              <DesktopMcpSection activeWorkspace={selectedWorkspace} />
            ) : null}

            {!outlet && activeSection === "skills" ? (
              <DesktopSkillsSection activeWorkspace={selectedWorkspace} />
            ) : null}

            {!outlet && activeSection === "usage" ? (
              <DesktopUsageSection activeWorkspace={selectedWorkspace} workspaces={workspaces} />
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
