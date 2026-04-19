import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useOutlet, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FolderOpen,
  Link2,
  Plus,
  Server,
  Settings,
} from "lucide-react";
import { DesktopConnectionsSection } from "../components/settings/DesktopConnectionsSection";
import { DesktopMcpSection } from "../components/settings/DesktopMcpSection";
import { DesktopSkillsSection } from "../components/settings/DesktopSkillsSection";
import { DesktopUsageSection } from "../components/settings/DesktopUsageSection";
import { DesktopVendorsSection } from "../components/settings/DesktopVendorsSection";
import { GlobalGitDrawer } from "../components/settings/GlobalGitDrawer";
import { useStore } from "../lib/store";
import type { AgentId, GitPanelData, TerminalTab, WorkspaceRef } from "../lib/models";

type SettingsSection =
  | "settings"
  | "models"
  | "agents"
  | "vendors"
  | "projects"
  | "connections"
  | "mcp"
  | "skills"
  | "usage";
type ProjectHealthTone = "clean" | "modified" | "attention" | "neutral";

type SidebarNavItem = {
  id: SettingsSection;
  label: string;
  icon: typeof Settings;
};

type ProjectView = {
  workspace: WorkspaceRef;
  tabs: TerminalTab[];
  primaryTab: TerminalTab | null;
  sessionCount: number;
  hasPlanModeSession: boolean;
  statusLabel: string;
  statusCopy: string;
  healthTone: ProjectHealthTone;
};

const NAV_ITEMS: SidebarNavItem[] = [
  { id: "settings", label: "设置", icon: Settings },
  { id: "models", label: "模型管理", icon: Cpu },
  { id: "agents", label: "智能体", icon: Bot },
  { id: "vendors", label: "供应商", icon: Settings },
  { id: "projects", label: "项目", icon: FolderOpen },
  { id: "connections", label: "连接", icon: Link2 },
  { id: "mcp", label: "MCP", icon: Server },
  { id: "skills", label: "技能", icon: BookOpen },
  { id: "usage", label: "使用统计", icon: BarChart3 },
];

function parseSettingsSection(value: string | null): SettingsSection {
  switch (value) {
    case "models":
    case "agents":
    case "projects":
    case "connections":
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

function parseDateValue(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function projectHealth(workspace: WorkspaceRef, gitPanel: GitPanelData | null) {
  if (gitPanel && !gitPanel.isGitRepo) {
    return {
      label: "非 Git 项目",
      copy: "普通目录入口",
      tone: "neutral" as const,
    };
  }

  if (workspace.failingChecks > 0) {
    return {
      label: "需要关注",
      copy: `${workspace.failingChecks} 项检查失败`,
      tone: "attention" as const,
    };
  }

  if (workspace.dirtyFiles > 0) {
    return {
      label: "有代码变更",
      copy: `${workspace.dirtyFiles} 个文件待整理`,
      tone: "modified" as const,
    };
  }

  if (!gitPanel) {
    return {
      label: "同步中",
      copy: "准备项目状态",
      tone: "neutral" as const,
    };
  }

  return {
    label: "状态稳定",
    copy: "可直接进入工作",
    tone: "clean" as const,
  };
}

function workspacePrimaryTab(
  tabs: TerminalTab[],
  activeTerminalTabId: string | null,
) {
  if (tabs.length === 0) return null;
  const activeTab = tabs.find((tab) => tab.id === activeTerminalTabId);
  if (activeTab) return activeTab;

  return [...tabs].sort(
    (left, right) => parseDateValue(right.lastActiveAt) - parseDateValue(left.lastActiveAt),
  )[0] ?? null;
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
  const gitPanelsByWorkspace = useStore((state) => state.gitPanelsByWorkspace);
  const gitWorkbenchOpen = useStore((state) => state.gitWorkbenchOpen);
  const setActiveTerminalTab = useStore((state) => state.setActiveTerminalTab);
  const createTerminalTab = useStore((state) => state.createTerminalTab);
  const openWorkspaceFolder = useStore((state) => state.openWorkspaceFolder);
  const openGitWorkbench = useStore((state) => state.openGitWorkbench);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeVendorTab, setActiveVendorTab] = useState<AgentId>("claude");

  const isGeneralSettingsRoute = location.pathname.startsWith("/settings/general");
  const isModelProvidersRoute = location.pathname.startsWith("/settings/model-providers");
  const isAgentsRoute = location.pathname.startsWith("/settings/agents");
  const activeSection = isModelProvidersRoute
    ? "models"
    : isAgentsRoute
      ? "agents"
    : isGeneralSettingsRoute
      ? "settings"
      : parseSettingsSection(searchParams.get("section"));
  const activeTerminalTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeTerminalTab?.workspaceId) ?? workspaces[0] ?? null;

  useEffect(() => {
    const saved = window.localStorage.getItem("desktop_settings_sidebar_collapsed");
    if (saved) {
      setSidebarCollapsed(saved === "1");
    }
  }, []);

  const projectViews = useMemo<ProjectView[]>(() => {
    return workspaces
      .map((workspace) => {
        const tabs = terminalTabs.filter((tab) => tab.workspaceId === workspace.id);
        const primaryTab = workspacePrimaryTab(tabs, activeTerminalTabId);
        const gitPanel = gitPanelsByWorkspace[workspace.id] ?? null;
        const health = projectHealth(workspace, gitPanel);

        return {
          workspace,
          tabs,
          primaryTab,
          sessionCount: tabs.length,
          hasPlanModeSession: tabs.some((tab) => tab.planMode),
          statusLabel: health.label,
          statusCopy: health.copy,
          healthTone: health.tone,
        };
      })
      .sort((left, right) => {
        const leftIsCurrent = left.workspace.id === activeWorkspace?.id ? 1 : 0;
        const rightIsCurrent = right.workspace.id === activeWorkspace?.id ? 1 : 0;
        if (leftIsCurrent !== rightIsCurrent) {
          return rightIsCurrent - leftIsCurrent;
        }

        const leftNeedsAttention = left.workspace.failingChecks > 0 ? 1 : 0;
        const rightNeedsAttention = right.workspace.failingChecks > 0 ? 1 : 0;
        if (leftNeedsAttention !== rightNeedsAttention) {
          return rightNeedsAttention - leftNeedsAttention;
        }

        const leftHasChanges = left.workspace.dirtyFiles > 0 ? 1 : 0;
        const rightHasChanges = right.workspace.dirtyFiles > 0 ? 1 : 0;
        if (leftHasChanges !== rightHasChanges) {
          return rightHasChanges - leftHasChanges;
        }

        const leftActivity = Math.max(...left.tabs.map((tab) => parseDateValue(tab.lastActiveAt)), 0);
        const rightActivity = Math.max(...right.tabs.map((tab) => parseDateValue(tab.lastActiveAt)), 0);
        if (leftActivity !== rightActivity) {
          return rightActivity - leftActivity;
        }

        return left.workspace.name.localeCompare(right.workspace.name);
      });
  }, [activeTerminalTabId, activeWorkspace?.id, gitPanelsByWorkspace, terminalTabs, workspaces]);

  const projectSummary = useMemo(() => {
    return {
      mountedProjects: workspaces.length,
      activeSessions: terminalTabs.length,
      changedProjects: workspaces.filter((workspace) => workspace.dirtyFiles > 0).length,
      cleanProjects: workspaces.filter((workspace) => workspace.dirtyFiles === 0 && workspace.failingChecks === 0).length,
    };
  }, [terminalTabs.length, workspaces]);

  function openSection(section: SettingsSection) {
    if (section === "settings") {
      navigate("/settings/general");
      return;
    }

    if (section === "models") {
      navigate("/settings/model-providers");
      return;
    }

    if (section === "agents") {
      navigate("/settings/agents");
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

  function openWorkspaceTerminal(workspaceId: string, forceNewTab = false) {
    const project = projectViews.find((item) => item.workspace.id === workspaceId) ?? null;
    if (!project) return;

    if (forceNewTab || !project.primaryTab) {
      createTerminalTab(workspaceId);
      navigate("/terminal");
      return;
    }

    setActiveTerminalTab(project.primaryTab.id);
    navigate("/terminal");
  }

  function openWorkspaceGitPanel(workspaceId: string) {
    const project = projectViews.find((item) => item.workspace.id === workspaceId) ?? null;
    if (!project) return;

    if (project.primaryTab) {
      setActiveTerminalTab(project.primaryTab.id);
    } else {
      createTerminalTab(workspaceId);
    }

    openGitWorkbench();
  }

  return (
    <div className={cx("settings-embedded", "dcc-settings-root", gitWorkbenchOpen && "is-git-drawer-open")}>
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
                    <div className="dcc-detail-row">
                      <span>自动检查更新</span>
                      <strong>{settings?.updateConfig.autoCheckForUpdates ? "已启用" : "已禁用"}</strong>
                    </div>
                    <div className="dcc-detail-row">
                      <span>更新桌面提醒</span>
                      <strong>{settings?.updateConfig.notifyOnUpdateAvailable ? "已启用" : "已禁用"}</strong>
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
                    <div className="dcc-detail-row">
                      <span>模型对话上下文轮数</span>
                      <strong>{settings?.modelChatContextTurnLimit ?? 0}</strong>
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
              <section className="settings-section dcc-projects-section">
                <div className="dcc-projects-hero">
                  <div className="dcc-projects-hero-copy">
                    <div className="settings-section-title">项目列表</div>
                    <div className="settings-section-subtitle">
                      这里只保留项目状态和入口动作，方便从设置页快速回到正确的工作区。
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" className="dcc-action-button secondary" onClick={() => openSection("connections")}>
                      <Link2 size={14} />
                      SSH 工作区
                    </button>
                    <button type="button" className="dcc-action-button" onClick={() => void openWorkspaceFolder()}>
                      <Plus size={14} />
                      添加项目
                    </button>
                  </div>
                </div>

                <div className="dcc-projects-summary-grid">
                  <div className="dcc-project-summary-card">
                    <span className="dcc-project-summary-label">已接入项目</span>
                    <strong className="dcc-project-summary-value">{projectSummary.mountedProjects}</strong>
                    <span className="dcc-project-summary-meta">工作区总数</span>
                  </div>
                  <div className="dcc-project-summary-card">
                    <span className="dcc-project-summary-label">打开会话</span>
                    <strong className="dcc-project-summary-value">{projectSummary.activeSessions}</strong>
                    <span className="dcc-project-summary-meta">终端标签页</span>
                  </div>
                  <div className="dcc-project-summary-card">
                    <span className="dcc-project-summary-label">有变更项目</span>
                    <strong className="dcc-project-summary-value">{projectSummary.changedProjects}</strong>
                    <span className="dcc-project-summary-meta">待整理工作区</span>
                  </div>
                  <div className="dcc-project-summary-card">
                    <span className="dcc-project-summary-label">干净项目</span>
                    <strong className="dcc-project-summary-value">{projectSummary.cleanProjects}</strong>
                    <span className="dcc-project-summary-meta">可直接开始</span>
                  </div>
                </div>

                {projectViews.length === 0 ? (
                  <div className="dcc-projects-empty dcc-projects-ledger">
                    <FolderOpen size={26} />
                    <div className="dcc-card-title">还没有接入任何项目</div>
                    <div className="dcc-card-description">
                      添加一个工作区后，这里会展示项目状态、终端入口和 Git 入口。
                    </div>
                    <button type="button" className="dcc-action-button" onClick={() => void openWorkspaceFolder()}>
                      <Plus size={14} />
                      添加第一个项目
                    </button>
                  </div>
                ) : (
                  <div className="dcc-projects-ledger">
                    <div className="dcc-projects-list-head">
                      <div>
                        <div className="dcc-card-title">全部项目</div>
                        <div className="dcc-card-description">
                          当前项目优先，其次是需要处理的工作区。
                        </div>
                      </div>
                      <div className="dcc-projects-head-note">列表只保留必要信息</div>
                    </div>

                    <div className="dcc-projects-ledger-list">
                      {projectViews.map((project) => {
                        const isCurrent = project.workspace.id === activeWorkspace?.id;
                        const primaryActionLabel = project.primaryTab ? "打开终端" : "新建会话";

                        return (
                          <article
                            key={project.workspace.id}
                            className={cx(
                              "dcc-project-row-shell",
                              isCurrent && "is-current",
                              `is-${project.healthTone}`,
                            )}
                          >
                            <div className="dcc-project-row-rail" aria-hidden />
                            <div className="dcc-project-row-main">
                              <div className="dcc-project-row-title">
                                <div className="dcc-provider-name-row">
                                  <span className="dcc-provider-name">{project.workspace.name}</span>
                                  {isCurrent ? <span className={badgeToneClass("success")}>当前</span> : null}
                                  {project.hasPlanModeSession ? <span className="dcc-badge">PLAN</span> : null}
                                  {project.workspace.locationKind === "ssh" ? <span className="dcc-badge">SSH</span> : null}
                                </div>
                                <span className={cx("dcc-project-health-pill", `dcc-project-health-pill-${project.healthTone}`)}>
                                  {project.statusLabel}
                                </span>
                              </div>

                              <div className="dcc-provider-url">
                                {project.workspace.locationKind === "ssh" && project.workspace.locationLabel
                                  ? `${project.workspace.locationLabel} · ${project.workspace.rootPath}`
                                  : project.workspace.rootPath}
                              </div>

                              <div className="dcc-project-row-ledger">
                                <div className="dcc-project-ledger-item">
                                  <span>Branch</span>
                                  <strong>{project.workspace.branch || "未识别"}</strong>
                                </div>
                                <div className="dcc-project-ledger-item">
                                  <span>Changes</span>
                                  <strong>{project.workspace.dirtyFiles}</strong>
                                </div>
                                <div className="dcc-project-ledger-item">
                                  <span>Checks</span>
                                  <strong>{project.workspace.failingChecks}</strong>
                                </div>
                                <div className="dcc-project-ledger-item">
                                  <span>Sessions</span>
                                  <strong>{project.sessionCount}</strong>
                                </div>
                                <div className="dcc-project-ledger-note">{project.statusCopy}</div>
                              </div>
                            </div>

                            <div className="dcc-project-row-actions">
                              <button
                                type="button"
                                className="dcc-action-button secondary"
                                onClick={() => openWorkspaceTerminal(project.workspace.id)}
                              >
                                {primaryActionLabel}
                              </button>
                              <button
                                type="button"
                                className="dcc-action-button secondary"
                                onClick={() => openWorkspaceGitPanel(project.workspace.id)}
                              >
                                Git
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            ) : null}

            {!outlet && activeSection === "connections" ? (
              <DesktopConnectionsSection settings={settings} />
            ) : null}

            {!outlet && activeSection === "mcp" ? (
              <DesktopMcpSection activeWorkspace={activeWorkspace} />
            ) : null}

            {!outlet && activeSection === "skills" ? (
              <DesktopSkillsSection activeWorkspace={activeWorkspace} />
            ) : null}

            {!outlet && activeSection === "usage" ? (
              <DesktopUsageSection activeWorkspace={activeWorkspace} workspaces={workspaces} />
            ) : null}
          </div>
        </main>
      </div>
      <GlobalGitDrawer />
    </div>
  );
}
