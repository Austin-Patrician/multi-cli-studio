import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useOutlet, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileText,
  FolderOpen,
  Link2,
  Monitor,
  Server,
  Settings,
  Trash2,
  Webhook,
} from "lucide-react";
import { DesktopConnectionsSection } from "../components/settings/DesktopConnectionsSection";
import { DesktopMcpSection } from "../components/settings/DesktopMcpSection";
import { DesktopAgentsSection } from "../components/settings/DesktopAgentsSection";
import { DesktopPromptsSection } from "../components/settings/DesktopPromptsSection";
import { DesktopSkillsSection } from "../components/settings/DesktopSkillsSection";
import { DesktopUsageSection } from "../components/settings/DesktopUsageSection";
import { DesktopVendorsSection } from "../components/settings/DesktopVendorsSection";
import { DesktopHooksSection } from "../components/settings/DesktopHooksSection";
import { DesktopProjectsSection, type DesktopProjectHealthTone, type DesktopProjectView } from "../components/settings/DesktopProjectsSection";
import { DesktopWindowControls } from "../components/DesktopWindowChrome";
import { GlobalGitDrawer } from "../components/settings/GlobalGitDrawer";
import { useStore } from "../lib/store";
import type { AgentId, GitPanelData, TerminalTab, WorkspaceRef } from "../lib/models";

type SettingsSection =
  | "settings"
  | "models"
  | "agents"
  | "prompts"
  | "vendors"
  | "projects"
  | "connections"
  | "mcp"
  | "hooks"
  | "skills"
  | "session-management"
  | "usage";
type SidebarNavItem = {
  id: SettingsSection;
  label: string;
  icon: typeof Settings;
};

const NAV_ITEMS: SidebarNavItem[] = [
  { id: "settings", label: "通用设置", icon: Settings },
  { id: "models", label: "对话模型", icon: Cpu },
  { id: "agents", label: "智能体", icon: Bot },
  { id: "prompts", label: "提示词", icon: FileText },
  { id: "vendors", label: "供应商", icon: Building2 },
  { id: "projects", label: "项目", icon: FolderOpen },
  { id: "session-management", label: "会话", icon: Archive },
  { id: "connections", label: "连接", icon: Link2 },
  { id: "mcp", label: "MCP", icon: Server },
  { id: "hooks", label: "Hooks", icon: Webhook },
  { id: "skills", label: "Skill", icon: BookOpen },
  { id: "usage", label: "使用统计", icon: BarChart3 },
];

function parseSettingsSection(value: string | null): SettingsSection {
  switch (value) {
    case "models":
    case "agents":
    case "prompts":
    case "projects":
    case "connections":
    case "mcp":
    case "hooks":
    case "skills":
    case "session-management":
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
      tone: "neutral" as DesktopProjectHealthTone,
    };
  }

  if (workspace.failingChecks > 0) {
    return {
      label: "需要关注",
      copy: `${workspace.failingChecks} 项检查失败`,
      tone: "attention" as DesktopProjectHealthTone,
    };
  }

  if (workspace.dirtyFiles > 0) {
    return {
      label: "有代码变更",
      copy: `${workspace.dirtyFiles} 个文件待整理`,
      tone: "modified" as DesktopProjectHealthTone,
    };
  }

  if (!gitPanel) {
    return {
      label: "同步中",
      copy: "准备项目状态",
      tone: "neutral" as DesktopProjectHealthTone,
    };
  }

  return {
    label: "状态稳定",
    copy: "可直接进入工作",
    tone: "clean" as DesktopProjectHealthTone,
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
  const deleteWorkspace = useStore((state) => state.deleteWorkspace);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeVendorTab, setActiveVendorTab] = useState<AgentId>("claude");
  const [deleteTarget, setDeleteTarget] = useState<DesktopProjectView | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const isGeneralSettingsRoute = location.pathname.startsWith("/settings/general");
  const isModelProvidersRoute = location.pathname.startsWith("/settings/model-providers");
  const isSessionManagementRoute = location.pathname.startsWith("/settings/session-management");
  const activeSection = isModelProvidersRoute
    ? "models"
    : isSessionManagementRoute
      ? "session-management"
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

  const projectViews = useMemo<DesktopProjectView[]>(() => {
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

  function openSection(section: SettingsSection) {
    if (section === "settings") {
      navigate("/settings/general");
      return;
    }

    if (section === "models") {
      navigate("/settings/model-providers");
      return;
    }

    if (section === "session-management") {
      navigate("/settings/session-management");
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

  async function confirmDeleteWorkspace() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteWorkspace(deleteTarget.workspace.id);
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className={cx("settings-embedded", "dcc-settings-root", gitWorkbenchOpen && "is-git-drawer-open", "flex h-full flex-col")}>
      <header className="settings-header">
        <div className="settings-header-copy">
          <div className="settings-header-title">Settings</div>
          <div className="settings-header-subtitle">Multi CLI Studio desktop configuration</div>
        </div>
        <div className="settings-header-drag-region" data-tauri-drag-region="" />
        <DesktopWindowControls className="settings-header-window-controls" />
      </header>
      <div className={cx("settings-body", sidebarCollapsed && "is-sidebar-collapsed", "min-h-0 flex-1")}>
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
              <DesktopProjectsSection
                activeWorkspaceId={activeWorkspace?.id ?? null}
                projects={projectViews}
                onAddProject={() => void openWorkspaceFolder()}
                onOpenConnections={() => openSection("connections")}
                onOpenWorkspaceTerminal={openWorkspaceTerminal}
                onOpenWorkspaceGitPanel={openWorkspaceGitPanel}
                onDeleteProject={setDeleteTarget}
              />
            ) : null}
            {!outlet && activeSection === "connections" ? (
              <DesktopConnectionsSection settings={settings} />
            ) : null}

            {!outlet && activeSection === "agents" ? (
              <DesktopAgentsSection />
            ) : null}

            {!outlet && activeSection === "prompts" ? (
              <DesktopPromptsSection activeWorkspace={activeWorkspace} workspaces={workspaces} />
            ) : null}

            {!outlet && activeSection === "mcp" ? (
              <DesktopMcpSection activeWorkspace={activeWorkspace} />
            ) : null}

            {!outlet && activeSection === "hooks" ? (
              <DesktopHooksSection activeWorkspace={activeWorkspace} workspaces={workspaces} />
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
      {deleteTarget ? (
        <div className="vendor-dialog-overlay" onClick={() => !deleteBusy && setDeleteTarget(null)}>
          <div className="vendor-dialog vendor-dialog-sm dcc-project-delete-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="vendor-dialog-header dcc-project-delete-header">
              <div className="dcc-project-delete-title-wrap">
                <div className="dcc-project-delete-icon" aria-hidden>
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3>删除项目</h3>
                </div>
              </div>
              <button type="button" className="vendor-dialog-close" onClick={() => !deleteBusy && setDeleteTarget(null)}>
                ×
              </button>
            </div>
            <div className="vendor-dialog-body">
              <div className="settings-agent-confirm-copy">
                删除 '{deleteTarget.workspace.name}' 后，会移除该项目关联的会话、终端标签页、本地持久化记录，以及后台保存的项目级 session 数据。此操作不可撤销。
              </div>
            </div>
            <div className="vendor-dialog-footer dcc-project-delete-footer">
              <button type="button" className="dcc-action-button secondary" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                取消
              </button>
              <button type="button" className="dcc-action-button danger" onClick={() => void confirmDeleteWorkspace()} disabled={deleteBusy}>
                {deleteBusy ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <GlobalGitDrawer />
    </div>
  );
}
