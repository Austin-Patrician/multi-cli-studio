import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { isTauri } from "@tauri-apps/api/core";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import { bridge } from "../lib/bridge";
import { AgentId, AgentResourceGroup, AgentResourceKind, AgentRuntimeResources, AppSettings, TerminalCliId } from "../lib/models";
import { useStore } from "../lib/store";
import { requestDesktopNotificationPermission } from "../lib/desktopNotifications";
import { getProvidersForServiceType, MODEL_PROVIDER_META, MODEL_PROVIDER_SERVICE_ORDER } from "../lib/modelProviders";
import { SERVICE_ICONS, maskSecret, relativeTime } from "../components/modelProviders/ui";
import { useAppUpdate } from "../features/update/AppUpdateProvider";
import { Save, Monitor, FolderKanban, Settings as SettingsIcon, BookOpen, Search, PlugZap } from "lucide-react";

// --- Configuration ---
const CLI_ORDER = ["codex", "claude", "gemini"] as const;
const PLATFORM_ORDER = ["windows", "macos", "linux"] as const;

type Platform = (typeof PLATFORM_ORDER)[number];
type SettingsSection = "settings" | "vendors" | "projects" | "mcp" | "skills";
type SettingsPageProps = {
  embedded?: boolean;
  forcedSection?: SettingsSection;
  hideSectionTabs?: boolean;
};

type SettingsAgent = {
  id: AgentId;
  runtime: {
    installed: boolean;
    version?: string | null;
    commandPath?: string | null;
    lastError?: string | null;
    resources: AgentRuntimeResources;
  };
};

const CLI_META: Record<AgentId, { label: string; prompt: string }> = {
  codex: { label: "Codex", prompt: "runtime.codex" },
  claude: { label: "Claude Code", prompt: "runtime.claude" },
  gemini: { label: "Gemini CLI", prompt: "runtime.gemini" },
};

const SETTINGS_SECTION_LABEL: Record<SettingsSection, string> = {
  settings: "通用设置",
  vendors: "AI 供应商",
  projects: "工作区项目",
  mcp: "MCP 资源",
  skills: "扩展技能",
};

const DEFAULT_ROUTE_OPTIONS: Array<{ id: TerminalCliId; label: string }> = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
  { id: "auto", label: "Auto" },
];

const FALLBACK_APP_VERSION =
  (tauriConfig as { version?: string }).version?.trim() || "0.0.0";

function parseSettingsSection(value: string | null): SettingsSection {
  switch (value) {
    case "vendors":
    case "projects":
    case "mcp":
    case "skills":
      return value;
    default:
      return "settings";
  }
}

// --- Helpers ---
function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "windows";
  const source = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (source.includes("mac")) return "macos";
  if (source.includes("linux")) return "linux";
  return "windows";
}

function fallbackGroup(supported: boolean): AgentResourceGroup {
  return { supported, items: [], error: null };
}

function fallbackResources(agentId: AgentId): AgentRuntimeResources {
  switch (agentId) {
    case "codex": return { mcp: fallbackGroup(true), skill: fallbackGroup(true), plugin: fallbackGroup(false), extension: fallbackGroup(false) };
    case "claude": return { mcp: fallbackGroup(true), skill: fallbackGroup(true), plugin: fallbackGroup(true), extension: fallbackGroup(false) };
    default: return { mcp: fallbackGroup(true), skill: fallbackGroup(true), plugin: fallbackGroup(false), extension: fallbackGroup(true) };
  }
}

function fallbackAgent(cli: AgentId): SettingsAgent {
  return { id: cli, runtime: { installed: false, version: null, commandPath: null, lastError: null, resources: fallbackResources(cli) } };
}

function runtimeResources(agent: SettingsAgent): AgentRuntimeResources {
  const fallback = fallbackResources(agent.id);
  const current = agent.runtime.resources;
  return {
    mcp: current?.mcp ?? fallback.mcp,
    skill: current?.skill ?? fallback.skill,
    plugin: current?.plugin ?? fallback.plugin,
    extension: current?.extension ?? fallback.extension,
  };
}

function parseEmailRecipients(value: string) {
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

// --- UI Components ---
function RefinedToggle({ enabled, onClick, disabled }: { enabled: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "relative inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer rounded-full border border-transparent transition-all duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]",
        enabled ? "bg-blue-500" : "bg-slate-200"
      )}
    >
      <span
        className={cx(
          "pointer-events-none inline-block h-[20px] w-[20px] transform rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.1)] ring-0 transition duration-200 ease-in-out m-[1px]",
          enabled ? "translate-x-[18px]" : "translate-x-0"
        )}
      />
    </button>
  );
}

function SegmentedControl({ options, value, onChange }: { options: Array<{id: string, label: string}>, value: string, onChange: (val: string) => void }) {
  return (
    <div className="flex bg-slate-100/80 p-1 rounded-[10px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] border border-slate-200/60 relative">
      {options.map(o => {
        const isActive = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cx(
              "relative px-5 py-1.5 text-[13px] font-medium rounded-[7px] transition-all duration-200 ease-out flex-1 z-10",
              isActive ? "text-slate-900" : "text-slate-500 hover:text-slate-900"
            )}
          >
            {isActive && (
              <div className="absolute inset-0 bg-white rounded-[7px] shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_1px_rgba(0,0,0,0.04)] border border-slate-200/50 -z-10" />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FormGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-10 last:mb-0">
      <h3 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider mb-3 pl-1 flex items-center gap-2">
        {title}
      </h3>
      <div className="rounded-xl border border-slate-200/80 bg-white overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.03),0_1px_2px_rgba(0,0,0,0.02)]">
        {children}
      </div>
    </div>
  );
}

function FormRow({ 
  label, 
  description, 
  control, 
  vertical = false 
}: { 
  label: ReactNode; 
  description?: ReactNode; 
  control: ReactNode; 
  vertical?: boolean 
}) {
  return (
    <div className={cx(
      "p-5 border-b border-slate-100 last:border-b-0 transition-colors hover:bg-slate-50/40",
      vertical ? "flex flex-col gap-3" : "flex items-center justify-between gap-8"
    )}>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-slate-900">{label}</div>
        {description && <div className="text-[13px] text-slate-500 mt-1 leading-relaxed">{description}</div>}
      </div>
      <div className={cx("shrink-0", vertical && "w-full")}>
        {control}
      </div>
    </div>
  );
}

function Input({ value, onChange, placeholder, type = "text", className }: any) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={cx(
        "w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all",
        className
      )}
    />
  );
}

function PrimaryButton({ children, onClick, disabled, className, icon: Icon }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-b from-slate-800 to-slate-900 text-white text-[13px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_1px_2px_rgba(0,0,0,0.2)] border border-slate-950 hover:from-slate-700 hover:to-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all",
        className
      )}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, disabled, className, icon: Icon }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white text-slate-700 text-[13px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.05)] border border-slate-200 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:bg-slate-100",
        className
      )}
    >
      {Icon && <Icon className="w-4 h-4 text-slate-500" />}
      {children}
    </button>
  );
}

// --- Main Page Component ---
export function SettingsPage({
  embedded = false,
  forcedSection,
  hideSectionTabs = false,
}: SettingsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const storedSettings = useStore((s) => s.settings);
  const appState = useStore((s) => s.appState);
  const updateSettings = useStore((s) => s.updateSettings);
  const workspaces = useStore((s) => s.workspaces);
  const terminalTabs = useStore((s) => s.terminalTabs);
  const activeTerminalTabId = useStore((s) => s.activeTerminalTabId);
  const setActiveTerminalTab = useStore((s) => s.setActiveTerminalTab);
  const openWorkspaceFolder = useStore((s) => s.openWorkspaceFolder);
  const loadCliSkills = useStore((s) => s.loadCliSkills);
  const cliSkillsByContext = useStore((s) => s.cliSkillsByContext);
  const {
    supported: updateSupported,
    state: updaterState,
    checkForUpdates,
    startUpdate,
  } = useAppUpdate();

  const [local, setLocal] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [updateNotificationBusy, setUpdateNotificationBusy] = useState(false);
  const [emailTestBusy, setEmailTestBusy] = useState(false);
  const [emailRecipientsInput, setEmailRecipientsInput] = useState("");
  const [appVersion, setAppVersion] = useState(FALLBACK_APP_VERSION);

  const activeSection = forcedSection ?? parseSettingsSection(searchParams.get("section"));

  useEffect(() => {
    if (storedSettings) {
      setLocal({
        ...storedSettings,
        cliPaths: { ...storedSettings.cliPaths },
        notificationConfig: { ...storedSettings.notificationConfig },
        updateConfig: { ...storedSettings.updateConfig },
      });
      setEmailRecipientsInput((storedSettings.notificationConfig.emailRecipients ?? []).join(", "));
    }
  }, [storedSettings]);

  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(null), 3000);
    return () => window.clearTimeout(id);
  }, [banner]);

  useEffect(() => {
    let cancelled = false;

    async function loadAppVersion() {
      if (!isTauri()) {
        setAppVersion(FALLBACK_APP_VERSION);
        return;
      }

      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const version = await getVersion();
        if (!cancelled) {
          setAppVersion(version?.trim() || FALLBACK_APP_VERSION);
        }
      } catch {
        if (!cancelled) {
          setAppVersion(FALLBACK_APP_VERSION);
        }
      }
    }

    void loadAppVersion();

    return () => {
      cancelled = true;
    };
  }, []);

  const agents = CLI_ORDER.map((cli) => {
    const agent = appState?.agents.find((item) => item.id === cli);
    return (agent ? { id: agent.id, runtime: agent.runtime } : fallbackAgent(cli)) as SettingsAgent;
  });

  const dirty = !!storedSettings && !!local && JSON.stringify(storedSettings) !== JSON.stringify(local);
  const activeTerminalTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeTerminalTab?.workspaceId) ??
    workspaces.find((workspace) => workspace.rootPath === local?.projectRoot) ??
    workspaces[0] ??
    null;

  const providerGroups = local
    ? MODEL_PROVIDER_SERVICE_ORDER.map((serviceType) => ({
        serviceType,
        meta: MODEL_PROVIDER_META[serviceType],
        providers: getProvidersForServiceType(local, serviceType),
      }))
    : [];

  const cliSkillCacheKeys = useMemo<Partial<Record<AgentId, string>>>(
    () =>
      activeWorkspace
        ? Object.fromEntries(CLI_ORDER.map((cli) => [cli, `${cli}:${activeWorkspace.id}`]))
        : {},
    [activeWorkspace]
  );

  useEffect(() => {
    if (activeSection !== "skills" || !activeWorkspace) return;
    CLI_ORDER.forEach((cli) => {
      void loadCliSkills(cli, activeWorkspace.id);
    });
  }, [activeSection, activeWorkspace, loadCliSkills]);

  function openSection(section: SettingsSection) {
    const next = new URLSearchParams(searchParams);
    next.set("section", section);
    setSearchParams(next, { replace: true });
  }

  async function handleSave() {
    if (!local) return;
    const recipients = parseEmailRecipients(emailRecipientsInput);
    const nextSettings: AppSettings = {
      ...local,
      notificationConfig: {
        ...local.notificationConfig,
        smtpHost: local.notificationConfig.smtpHost.trim(),
        smtpUsername: local.notificationConfig.smtpUsername.trim(),
        smtpPassword: local.notificationConfig.smtpPassword,
        smtpFrom: local.notificationConfig.smtpFrom.trim(),
        emailRecipients: recipients,
      },
    };

    setSaving(true);
    try {
      setLocal(nextSettings);
      await updateSettings(nextSettings);
      setBanner("更改已成功保存");
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleSendTestEmail() {
    if (!local) return;
    const config = { ...local.notificationConfig, emailRecipients: parseEmailRecipients(emailRecipientsInput) };
    setEmailTestBusy(true);
    try {
      const result = await bridge.sendTestEmailNotification(config);
      setBanner(result);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "测试邮件发送失败");
    } finally {
      setEmailTestBusy(false);
    }
  }

  async function toggleCompletionNotifications() {
    if (!local) return;
    if (local.notifyOnTerminalCompletion) {
      setLocal({ ...local, notifyOnTerminalCompletion: false });
      return;
    }
    setNotificationBusy(true);
    try {
      const permission = await requestDesktopNotificationPermission();
      if (permission === "granted") setLocal({ ...local, notifyOnTerminalCompletion: true });
      else setBanner("需要通知权限");
    } finally {
      setNotificationBusy(false);
    }
  }

  async function toggleUpdateNotifications() {
    if (!local) return;
    if (local.updateConfig.notifyOnUpdateAvailable) {
      setLocal({ ...local, updateConfig: { ...local.updateConfig, notifyOnUpdateAvailable: false } });
      return;
    }
    setUpdateNotificationBusy(true);
    try {
      const permission = await requestDesktopNotificationPermission();
      if (permission === "granted") setLocal({ ...local, updateConfig: { ...local.updateConfig, notifyOnUpdateAvailable: true } });
      else setBanner("需要通知权限");
    } finally {
      setUpdateNotificationBusy(false);
    }
  }

  async function handleCheckForUpdates() {
    await checkForUpdates({
      userInitiated: true,
      announceNoUpdate: true,
    });
  }

  if (!local) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 font-sans">
        <div className="text-[13px] text-slate-500 font-medium tracking-wide animate-pulse">加载偏好设置...</div>
      </div>
    );
  }

  const updateStatusText =
    updaterState.stage === "available" ? `新版本可用 (v${updaterState.version})` :
    updaterState.stage === "downloading" ? "正在下载..." :
    updaterState.stage === "checking" ? "检查中..." : "已是最新版本";

  const SidebarItem = ({ id, icon: Icon, label }: { id: SettingsSection, icon: any, label: string }) => {
    const isActive = activeSection === id;
    return (
      <button
        onClick={() => openSection(id)}
        className={cx(
          "w-full flex items-center gap-3 px-3 py-2 rounded-[8px] text-[14px] font-medium transition-all border border-transparent",
          isActive 
            ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] border-slate-200/60 text-blue-600" 
            : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900"
        )}
      >
        <Icon className={cx("w-[18px] h-[18px]", isActive ? "text-blue-500" : "text-slate-400")} />
        {label}
      </button>
    );
  };

  return (
    <div className={cx(
      "flex w-full bg-[#fbfbfe] text-slate-900 antialiased",
      embedded ? "min-h-0 flex-col" : "h-[100vh] flex-row font-[-apple-system,BlinkMacSystemFont,'SF_Pro_Text','Segoe_UI',Roboto,sans-serif]"
    )}>
      <style>{`
        .custom-slider { -webkit-appearance: none; width: 100%; background: transparent; }
        .custom-slider::-webkit-slider-thumb {
          -webkit-appearance: none; height: 20px; width: 20px; border-radius: 50%;
          background: #ffffff; border: 1px solid #d1d5db;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06); cursor: pointer; margin-top: -8px; transition: all 0.15s;
        }
        .custom-slider::-webkit-slider-runnable-track {
          width: 100%; height: 4px; cursor: pointer; background: #e2e8f0; border-radius: 4px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);
        }
        .custom-slider:focus { outline: none; }
        .custom-slider:focus::-webkit-slider-thumb { border-color: #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.1), 0 1px 3px rgba(0,0,0,0.1); }
      `}</style>

      {/* Sidebar Navigation */}
      {!embedded && !hideSectionTabs && (
        <aside className="w-[260px] shrink-0 border-r border-slate-200/80 bg-slate-50/80 backdrop-blur-md flex flex-col z-10 shadow-[1px_0_10px_rgba(0,0,0,0.02)]">
          <div className="px-6 py-8">
            <h1 className="text-[20px] font-bold tracking-tight text-slate-900">偏好设置</h1>
          </div>
          <nav className="flex-1 px-4 space-y-1">
            <SidebarItem id="settings" icon={SettingsIcon} label="通用设置" />
            <SidebarItem id="vendors" icon={Monitor} label="AI 供应商" />
            <SidebarItem id="projects" icon={FolderKanban} label="工作区项目" />
            <SidebarItem id="mcp" icon={PlugZap} label="MCP 资源" />
            <SidebarItem id="skills" icon={BookOpen} label="扩展技能" />
          </nav>
        </aside>
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative bg-[#fbfbfe]">
        {/* Banner Alert */}
        <div className={cx(
          "fixed top-4 right-6 z-50 transition-all duration-300 ease-out flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-slate-900 text-white shadow-xl shadow-slate-900/10 text-[13px] font-medium tracking-wide border border-slate-800",
          banner ? "translate-y-0 opacity-100" : "-translate-y-12 opacity-0 pointer-events-none"
        )}>
          <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
          {banner}
        </div>

        <div className={cx("mx-auto max-w-3xl", embedded ? "p-6" : "px-12 py-14 pb-24")}>
          <header className="flex items-end justify-between mb-12">
            <div>
              <h2 className="text-[28px] font-bold tracking-tight leading-none text-slate-900">
                {SETTINGS_SECTION_LABEL[activeSection]}
              </h2>
            </div>
            
            <div className="flex items-center gap-3">
              {dirty && (
                <span className="text-[13px] text-amber-500 font-medium flex items-center gap-1.5 animate-pulse bg-amber-50 px-2 py-1 rounded-md border border-amber-200/50">
                  <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
                  未保存的更改
                </span>
              )}
              <button
                onClick={handleSave}
                disabled={!dirty || saving}
                className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-b from-slate-800 to-slate-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_1px_2px_rgba(0,0,0,0.2)] border border-slate-950 hover:from-slate-700 hover:to-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                title={saving ? "保存中..." : "应用更改"}
              >
                <Save className="w-[18px] h-[18px]" />
              </button>
            </div>
          </header>

          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both">
            {/* --- General Settings --- */}
            {activeSection === "settings" && (
              <>
                <FormGroup title="工作区默认路由">
                  <FormRow
                    label="默认命令行接口"
                    description="新建项目工作区时，优先启动并路由至此工具链。"
                    control={
                      <SegmentedControl
                        options={DEFAULT_ROUTE_OPTIONS}
                        value={local.defaultNewWorkspaceCli}
                        onChange={(val) => setLocal({ ...local, defaultNewWorkspaceCli: val as any })}
                      />
                    }
                  />
                </FormGroup>

                <FormGroup title="系统通知与更新">
                  <FormRow
                    label="当前版本"
                    description="显示当前正在运行的桌面应用版本号。"
                    control={
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-semibold text-slate-700 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)]">
                        v{appVersion}
                      </div>
                    }
                  />
                  <FormRow
                    label="任务完成通知"
                    description="长耗时智能体任务完成时，通过桌面系统通知提醒。"
                    control={<RefinedToggle enabled={local.notifyOnTerminalCompletion} onClick={toggleCompletionNotifications} disabled={notificationBusy} />}
                  />
                  <FormRow
                    label="应用内自动更新"
                    description="启动及后台自动检测新版本。"
                    control={<RefinedToggle enabled={local.updateConfig.autoCheckForUpdates} onClick={() => setLocal({ ...local, updateConfig: { ...local.updateConfig, autoCheckForUpdates: !local.updateConfig.autoCheckForUpdates } })} />}
                  />
                  <FormRow
                    label="新版本可用提醒"
                    description="发现应用更新时发送桌面通知。"
                    control={<RefinedToggle enabled={local.updateConfig.notifyOnUpdateAvailable} onClick={toggleUpdateNotifications} disabled={updateNotificationBusy} />}
                  />
                  <FormRow
                    label={
                      <span className="flex items-center gap-2">
                        系统更新检查
                        <span className={cx("text-[12px] font-medium px-2 py-0.5 rounded-full", updaterState.stage === "available" ? "bg-blue-50 text-blue-600 border border-blue-200/50" : "bg-slate-100 text-slate-500")}>
                          {updateStatusText}
                        </span>
                      </span>
                    }
                    control={
                      <div className="flex gap-2">
                        <SecondaryButton onClick={() => void handleCheckForUpdates()} disabled={!updateSupported || updaterState.stage === "checking"}>
                          检查更新
                        </SecondaryButton>
                        {updaterState.stage === "available" && (
                          <PrimaryButton onClick={() => void startUpdate()}>
                            立即重启更新
                          </PrimaryButton>
                        )}
                      </div>
                    }
                  />
                </FormGroup>

                <FormGroup title="模型对话上下文">
                  <FormRow
                    vertical
                    label="多轮对话记忆深度"
                    description="调节独立会话窗口发送给 AI 的历史轮数。较大的数值能保留更多语境，但会增加 Token 消耗。"
                    control={
                      <div className="flex items-center gap-5 mt-2 bg-slate-50/50 p-4 rounded-lg border border-slate-100">
                        <input
                          type="range"
                          min="1"
                          max="20"
                          value={local.modelChatContextTurnLimit}
                          onChange={(e) => setLocal({ ...local, modelChatContextTurnLimit: parseInt(e.target.value, 10) || 4 })}
                          className="custom-slider flex-1"
                        />
                        <div className="w-14 text-right text-[16px] font-bold text-slate-700 bg-white px-2 py-1 rounded shadow-sm border border-slate-200/50">
                          {local.modelChatContextTurnLimit} <span className="text-[12px] text-slate-400 font-normal">轮</span>
                        </div>
                      </div>
                    }
                  />
                </FormGroup>

                <FormGroup title="SMTP 邮件聚合服务">
                  <FormRow
                    label="启用 SMTP 邮件支持"
                    description="为自动化工作流提供全局的邮件投递能力。"
                    control={<RefinedToggle enabled={local.notificationConfig.smtpEnabled} onClick={() => setLocal({ ...local, notificationConfig: { ...local.notificationConfig, smtpEnabled: !local.notificationConfig.smtpEnabled } })} />}
                  />
                  {local.notificationConfig.smtpEnabled && (
                    <div className="p-5 bg-slate-50/50 border-t border-slate-100 grid grid-cols-2 gap-5">
                       <div className="space-y-1.5">
                         <label className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">SMTP 主机</label>
                         <Input value={local.notificationConfig.smtpHost} onChange={(e: any) => setLocal({...local, notificationConfig: {...local.notificationConfig, smtpHost: e.target.value}})} placeholder="smtp.example.com" />
                       </div>
                       <div className="space-y-1.5">
                         <label className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">端口</label>
                         <Input type="number" value={local.notificationConfig.smtpPort} onChange={(e: any) => setLocal({...local, notificationConfig: {...local.notificationConfig, smtpPort: parseInt(e.target.value, 10)}})} placeholder="587" />
                       </div>
                       <div className="space-y-1.5">
                         <label className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">用户名</label>
                         <Input value={local.notificationConfig.smtpUsername} onChange={(e: any) => setLocal({...local, notificationConfig: {...local.notificationConfig, smtpUsername: e.target.value}})} placeholder="user@example.com" />
                       </div>
                       <div className="space-y-1.5">
                         <label className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">密码</label>
                         <Input type="password" value={local.notificationConfig.smtpPassword} onChange={(e: any) => setLocal({...local, notificationConfig: {...local.notificationConfig, smtpPassword: e.target.value}})} placeholder="••••••••" />
                       </div>
                       <div className="space-y-1.5 col-span-2">
                         <label className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">发件人 (From)</label>
                         <Input value={local.notificationConfig.smtpFrom} onChange={(e: any) => setLocal({...local, notificationConfig: {...local.notificationConfig, smtpFrom: e.target.value}})} placeholder="noreply@example.com" />
                       </div>
                       <div className="space-y-1.5 col-span-2">
                         <label className="text-[12px] font-semibold text-slate-500 uppercase tracking-wider">全局抄送收件人</label>
                         <textarea 
                           className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] text-slate-900 placeholder:text-slate-400 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all min-h-[80px]" 
                           value={emailRecipientsInput} 
                           onChange={(e) => { setEmailRecipientsInput(e.target.value); setLocal({...local, notificationConfig: {...local.notificationConfig, emailRecipients: parseEmailRecipients(e.target.value)}}); }}
                           placeholder="alice@example.com, bob@example.com"
                         />
                       </div>
                       <div className="col-span-2 flex justify-end mt-2 pt-4 border-t border-slate-200/60">
                         <SecondaryButton onClick={handleSendTestEmail} disabled={emailTestBusy}>
                           {emailTestBusy ? "投递中..." : "发送测试邮件"}
                         </SecondaryButton>
                       </div>
                    </div>
                  )}
                </FormGroup>
              </>
            )}

            {/* --- AI Vendors --- */}
            {activeSection === "vendors" && (
              <>
                <div className="mb-6 flex justify-end">
                  <Link to="/settings/model-providers">
                    <SecondaryButton icon={SettingsIcon}>
                      模型路由高级配置
                    </SecondaryButton>
                  </Link>
                </div>
                {providerGroups.map(({ serviceType, meta, providers }) => (
                  <FormGroup key={serviceType} title={meta.label}>
                    {providers.length === 0 ? (
                      <div className="p-8 text-center text-[13px] text-slate-500">暂未配置该平台模型。</div>
                    ) : (
                      providers.map((p) => (
                        <div key={p.id} className="flex items-center justify-between p-5 border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center">
                              <img src={SERVICE_ICONS[serviceType]} alt="" className="w-6 h-6 object-contain" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-[15px] font-semibold text-slate-900">{p.name}</span>
                                {p.enabled && <span className="px-1.5 py-0.5 rounded flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200/50 uppercase tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active</span>}
                              </div>
                              <div className="text-[13px] text-slate-500 mt-0.5 max-w-sm truncate">{p.baseUrl} · {p.models.length} 模型接入</div>
                            </div>
                          </div>
                          <Link to={`/settings/model-providers/${serviceType}/${p.id}`}>
                             <SecondaryButton>编辑</SecondaryButton>
                          </Link>
                        </div>
                      ))
                    )}
                  </FormGroup>
                ))}
              </>
            )}

            {/* --- Workspaces --- */}
            {activeSection === "projects" && (
              <>
                <div className="mb-6 flex justify-end">
                  <SecondaryButton onClick={() => void openWorkspaceFolder()} icon={Search}>
                    扫描并载入新工作区
                  </SecondaryButton>
                </div>
                <FormGroup title="活跃项目上下文">
                  {workspaces.map((workspace) => {
                    const workspaceTab = terminalTabs.find((tab) => tab.workspaceId === workspace.id);
                    const isActive = workspace.id === activeWorkspace?.id;
                    return (
                      <div key={workspace.id} className="flex items-center justify-between p-5 border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[15px] font-semibold text-slate-900">{workspace.name}</span>
                            {isActive && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-200/50 uppercase tracking-wider">Focused</span>}
                          </div>
                          <div className="text-[12px] font-mono text-slate-500 mt-1">{workspace.rootPath}</div>
                          <div className="flex items-center gap-3 mt-2.5 text-[12px] font-medium text-slate-500">
                             <span className="flex items-center gap-1"><Monitor className="w-3.5 h-3.5"/> {workspace.branch}</span>
                             {workspace.dirtyFiles > 0 && <span className="text-amber-600 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500"/> 未提交: {workspace.dirtyFiles}</span>}
                          </div>
                        </div>
                        {workspaceTab && (
                           <SecondaryButton onClick={() => { setActiveTerminalTab(workspaceTab.id); navigate("/terminal"); }}>
                             切至终端
                           </SecondaryButton>
                        )}
                      </div>
                    );
                  })}
                  {workspaces.length === 0 && <div className="p-8 text-center text-[13px] text-slate-500">尚未附加工作区。</div>}
                </FormGroup>
              </>
            )}

            {/* --- MCP --- */}
            {activeSection === "mcp" && (
              <FormGroup title="模型上下文协议 (MCP) 资源">
                {agents.map((agent) => {
                  const group = runtimeResources(agent).mcp;
                  return (
                    <div key={agent.id} className="flex flex-col p-5 border-b border-slate-100 last:border-0">
                      <div className="flex items-center justify-between">
                        <div className="text-[15px] font-semibold text-slate-900">{CLI_META[agent.id].label}</div>
                        <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[12px] font-semibold border border-slate-200/60 shadow-sm">
                          {group.items.length} 激活项
                        </span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                         {group.items.length > 0 ? group.items.slice(0, 15).map(item => (
                           <span key={item.name} className="px-2.5 py-1 bg-white border border-slate-200/80 shadow-sm rounded-md text-[12px] font-medium text-slate-700">
                             {item.name}
                           </span>
                         )) : <span className="text-[13px] text-slate-400 italic">暂无探测到可用 MCP 服务器</span>}
                      </div>
                    </div>
                  );
                })}
              </FormGroup>
            )}

            {/* --- Skills --- */}
            {activeSection === "skills" && (
              <FormGroup title="智能体扩展技能包">
                {agents.map((agent) => {
                  const runtimeGroup = runtimeResources(agent).skill;
                  const workspaceSkillKey = activeWorkspace ? cliSkillCacheKeys[agent.id] : null;
                  const workspaceSkills = workspaceSkillKey ? cliSkillsByContext[workspaceSkillKey] ?? [] : [];
                  return (
                    <div key={agent.id} className="flex flex-col p-5 border-b border-slate-100 last:border-0">
                      <div className="flex items-center justify-between">
                        <div className="text-[15px] font-semibold text-slate-900">{CLI_META[agent.id].label}</div>
                        <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[12px] font-semibold border border-slate-200/60 shadow-sm">
                          {workspaceSkills.length > 0 ? workspaceSkills.length : runtimeGroup.items.length} 技能
                        </span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                         {workspaceSkills.length > 0 ? workspaceSkills.map(item => (
                           <span key={item.name} className="px-2.5 py-1 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] border border-slate-200 rounded-md text-[12px] font-medium text-slate-700 flex items-center gap-1.5">
                             <BookOpen className="w-3.5 h-3.5 text-slate-400"/>
                             {item.displayName ?? item.name}
                           </span>
                         )) : runtimeGroup.items.length > 0 ? runtimeGroup.items.slice(0, 15).map(item => (
                           <span key={item.name} className="px-2.5 py-1 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] border border-slate-200 rounded-md text-[12px] font-medium text-slate-700 flex items-center gap-1.5">
                             <BookOpen className="w-3.5 h-3.5 text-slate-400"/>
                             {item.name}
                           </span>
                         )) : <span className="text-[13px] text-slate-400 italic">该引擎当前未装载定制技能</span>}
                      </div>
                    </div>
                  );
                })}
              </FormGroup>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
