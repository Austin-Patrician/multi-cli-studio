import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { bridge } from "../lib/bridge";
import { AgentId, AgentResourceGroup, AgentResourceKind, AgentRuntimeResources, AppSettings } from "../lib/models";
import refreshIcon from "../media/svg/refresh.svg";
import { useStore } from "../lib/store";
import { requestDesktopNotificationPermission } from "../lib/desktopNotifications";
import { getProvidersForServiceType, MODEL_PROVIDER_META, MODEL_PROVIDER_SERVICE_ORDER } from "../lib/modelProviders";
import { SERVICE_ICONS, maskSecret, relativeTime } from "../components/modelProviders/ui";
import { useAppUpdate } from "../features/update/AppUpdateProvider";

// --- Configuration ---
const CLI_ORDER = ["codex", "claude", "gemini"] as const;
const PLATFORM_ORDER = ["windows", "macos", "linux"] as const;
const RESOURCE_ORDER: AgentResourceKind[] = ["mcp", "skill", "plugin", "extension"];

const INPUT_CLASS =
  "block w-full rounded-xl border-0 py-2.5 px-3.5 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm sm:leading-6 bg-white transition-all hover:bg-slate-50 focus:bg-white";

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

const PLATFORM_LABEL: Record<Platform, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
};

const RESOURCE_LABEL: Record<AgentResourceKind, string> = {
  mcp: "MCP",
  skill: "技能",
  plugin: "插件",
  extension: "扩展",
};

const SETTINGS_SECTION_LABEL: Record<SettingsSection, string> = {
  settings: "设置",
  vendors: "供应商",
  projects: "项目",
  mcp: "MCP",
  skills: "Skills",
};

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

const GUIDES: Record<AgentId, { docs: string; install: Record<Platform, string> }> = {
  codex: {
    docs: "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
    install: { windows: "npm install -g @openai/codex", macos: "npm install -g @openai/codex", linux: "npm install -g @openai/codex" },
  },
  claude: {
    docs: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
    install: { windows: "npm install -g @anthropic-ai/claude-code", macos: "curl -fsSL https://claude.ai/install.sh | bash", linux: "curl -fsSL https://claude.ai/install.sh | bash" },
  },
  gemini: {
    docs: "https://github.com/google-gemini/gemini-cli",
    install: { windows: "npm install -g @google/gemini-cli", macos: "brew install gemini-cli", linux: "npm install -g @google/gemini-cli" },
  },
};

// --- Icons ---
const TerminalIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
    <path d="M4 17L10 12L4 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 18H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const FolderIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const BellIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
    <path d="M12 22C13.1046 22 14 21.1046 14 20H10C10 21.1046 10.8954 22 12 22Z" fill="currentColor"/>
    <path d="M18 8C18 4.68629 15.3137 2 12 2C8.68629 2 6 4.68629 6 8V13.5858L4.29289 15.2929C4.10536 15.4804 4 15.7348 4 16V17C4 17.5523 4.44772 18 5 18H19C19.5523 18 20 17.5523 20 17V16C20 15.7348 19.8946 15.4804 19.7071 15.2929L18 13.5858V8Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
    <path d="M4 7.5A1.5 1.5 0 015.5 6h13A1.5 1.5 0 0120 7.5v9A1.5 1.5 0 0118.5 18h-13A1.5 1.5 0 014 16.5v-9z" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M5 7l7 5 7-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const UpdateIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
    <path d="M12 3V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M8 10L12 14L16 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 16.5V18C5 19.1046 5.89543 20 7 20H17C18.1046 20 19 19.1046 19 18V16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const ChevronRightIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M9 6L15 12L9 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CpuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
    <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M9 9H15V15H9V9Z" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M9 2V5M15 2V5M9 19V22M15 19V22M2 9H5M2 15H5M19 9H22M19 15H22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const CheckIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

// --- Helpers ---
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

function resourceNamesRow(group: AgentResourceGroup) {
  if (!group.supported) return <span className="text-slate-300 italic">不支持</span>;
  if (group.error) return <span className="text-rose-400">异常</span>;
  if (group.items.length === 0) return <span className="px-0.5 py-0.5 rounded-lg text-[10px] font-bold ring-1 ring-inset bg-white text-slate-700 ring-slate-200 shadow-sm inline-flex items-center justify-center">无</span>;
  
  return (
    <div className="flex flex-wrap gap-1.5">
      {group.items.slice(0, 10).map((item) => (
        <span 
          key={item.name} 
          className={cx(
            "px-2 py-0.5 rounded-lg text-[10px] font-bold ring-1 ring-inset",
            item.enabled 
              ? "bg-white text-slate-700 ring-slate-200 shadow-sm" 
              : "bg-slate-50 text-slate-400 ring-slate-100 italic opacity-70"
          )}
        >
          {item.name}
        </span>
      ))}
      {group.items.length > 10 && (
        <span className="text-[10px] font-bold text-slate-400 self-center pl-1">+{group.items.length - 10}</span>
      )}
    </div>
  );
}

function stageStyle(mounted: boolean, delay: number): CSSProperties {
  return {
    opacity: mounted ? 1 : 0,
    transform: mounted ? "none" : "translateY(12px)",
    transition: `opacity 400ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms, transform 400ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
  };
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatLimit(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function parseEmailRecipients(value: string) {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// --- Components ---

function Panel({
  title,
  description,
  icon,
  action,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-10 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-white/60 to-white/10 rounded-[10px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] pointer-events-none" />
      <div className="relative overflow-hidden rounded-[10px] bg-white backdrop-blur-xl ring-1 ring-slate-200/60 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100/80 bg-slate-50/50 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {icon ? (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200/50 text-indigo-500">
                {icon}
              </div>
            ) : null}
            <div>
              <h2 className="text-base font-bold text-slate-900 tracking-tight uppercase tracking-wider">{title}</h2>
              {description ? (
                <p className="mt-0.5 text-sm text-slate-500 font-medium">{description}</p>
              ) : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        <div>{children}</div>
      </div>
    </section>
  );
}

function MetaChip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "ready" | "warn" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset",
        tone === "ready" && "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
        tone === "warn" && "bg-amber-50 text-amber-700 ring-amber-600/20",
        tone === "default" && "bg-slate-100/80 text-slate-600 ring-slate-500/10"
      )}
    >
      {children}
    </span>
  );
}

function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-2">
      {children}
      {required && <span className="text-rose-500 ml-1">*</span>}
    </label>
  );
}

function IconButton({
  icon,
  onClick,
  disabled,
  variant = "secondary",
  title,
}: {
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl box-border transition-all active:scale-[0.92] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-slate-900 text-white hover:bg-slate-800 shadow-sm ring-1 ring-inset ring-slate-900",
        variant === "secondary" && "bg-white text-slate-600 hover:bg-slate-50 ring-1 ring-inset ring-slate-200 shadow-sm"
      )}
    >
      {icon}
    </button>
  );
}

function ToggleSwitch({ enabled, onClick, disabled }: { enabled: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 shadow-inner",
        enabled ? "bg-indigo-500" : "bg-slate-200"
      )}
    >
      <span
        className={cx(
          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
          enabled ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

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
  const setAppState = useStore((s) => s.setAppState);
  const workspaces = useStore((s) => s.workspaces);
  const terminalTabs = useStore((s) => s.terminalTabs);
  const activeTerminalTabId = useStore((s) => s.activeTerminalTabId);
  const setActiveTerminalTab = useStore((s) => s.setActiveTerminalTab);
  const openWorkspaceFolder = useStore((s) => s.openWorkspaceFolder);
  const loadCliSkills = useStore((s) => s.loadCliSkills);
  const cliSkillsByContext = useStore((s) => s.cliSkillsByContext);
  const cliSkillStatusByContext = useStore((s) => s.cliSkillStatusByContext);
  const {
    supported: updateSupported,
    configured: updateConfigured,
    state: updaterState,
    checkForUpdates,
    startUpdate,
  } = useAppUpdate();

  const [local, setLocal] = useState<AppSettings | null>(null);
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const [mounted, setMounted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [updateNotificationBusy, setUpdateNotificationBusy] = useState(false);
  const [emailTestBusy, setEmailTestBusy] = useState(false);
  const [emailRecipientsInput, setEmailRecipientsInput] = useState("");
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
    setMounted(true);
    setPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    if (!banner && !copied) return;
    const id = window.setTimeout(() => {
      setBanner(null);
      setCopied(null);
    }, 2000);
    return () => window.clearTimeout(id);
  }, [banner, copied]);

  const agents = CLI_ORDER.map((cli) => {
    const agent = appState?.agents.find((item) => item.id === cli);
    return (agent ? { id: agent.id, runtime: agent.runtime } : fallbackAgent(cli)) as SettingsAgent;
  });

  const installedCount = agents.filter((agent) => agent.runtime.installed).length;
  const dirty = !!storedSettings && !!local && JSON.stringify(storedSettings) !== JSON.stringify(local);
  const runtimeSummary = `${installedCount}/${CLI_ORDER.length} 个运行时已在 ${PLATFORM_LABEL[platform]} 上就绪。`;
  const branch = appState?.workspace.branch ?? "main";
  const updateStatusLabel =
    updaterState.stage === "available" && updaterState.version
      ? `发现 v${updaterState.version}`
      : updaterState.stage === "downloading"
        ? "下载中"
        : updaterState.stage === "installing"
          ? "安装中"
          : updaterState.stage === "restarting"
            ? "重启中"
            : updaterState.stage === "error"
              ? "检查失败"
              : updaterState.stage === "latest"
                ? "已是最新"
                : updaterState.stage === "checking"
                  ? "检查中"
                  : "待检查";
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

  async function copyText(value: string, key: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setBanner(`已复制${label}`);
    } catch {
      setBanner(`无法复制${label}`);
    }
  }

  async function refreshRuntime() {
    if (!local) return;
    setRefreshing(true);
    try {
      const state = await bridge.loadAppState(local.projectRoot, true);
      setAppState(state);
      setBanner("运行时扫描完成");
    } catch {
      setBanner("运行时扫描失败");
    } finally {
      setRefreshing(false);
    }
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

    if (nextSettings.notificationConfig.smtpEnabled) {
      if (!nextSettings.notificationConfig.smtpHost) {
        setBanner("请填写 SMTP 主机");
        return;
      }
      if (!nextSettings.notificationConfig.smtpPort || nextSettings.notificationConfig.smtpPort < 1) {
        setBanner("SMTP 端口无效");
        return;
      }
      if (!nextSettings.notificationConfig.smtpUsername) {
        setBanner("请填写 SMTP 用户名");
        return;
      }
      if (!nextSettings.notificationConfig.smtpPassword) {
        setBanner("请填写 SMTP 密码");
        return;
      }
      if (!nextSettings.notificationConfig.smtpFrom || !isLikelyEmail(nextSettings.notificationConfig.smtpFrom)) {
        setBanner("发件人邮箱无效");
        return;
      }
      if (recipients.length === 0) {
        setBanner("请至少填写一个收件人");
        return;
      }
      if (recipients.some((item) => !isLikelyEmail(item))) {
        setBanner("收件人邮箱格式无效");
        return;
      }
    }

    setSaving(true);
    try {
      setLocal(nextSettings);
      await updateSettings(nextSettings);
      setBanner("设置已保存");
    } catch (error) {
      setBanner(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleSendTestEmail() {
    if (!local) return;
    const config: AppSettings["notificationConfig"] = {
      ...local.notificationConfig,
      smtpHost: local.notificationConfig.smtpHost.trim(),
      smtpUsername: local.notificationConfig.smtpUsername.trim(),
      smtpPassword: local.notificationConfig.smtpPassword,
      smtpFrom: local.notificationConfig.smtpFrom.trim(),
      emailRecipients: parseEmailRecipients(emailRecipientsInput),
    };
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
      setBanner("桌面通知已关闭。");
      return;
    }

    setNotificationBusy(true);
    try {
      const permission = await requestDesktopNotificationPermission();
      if (permission !== "granted") {
        setBanner("通知权限未授予。");
        return;
      }
      setLocal({ ...local, notifyOnTerminalCompletion: true });
      setBanner("桌面通知已开启。");
    } finally {
      setNotificationBusy(false);
    }
  }

  async function toggleUpdateNotifications() {
    if (!local) return;
    if (local.updateConfig.notifyOnUpdateAvailable) {
      setLocal({
        ...local,
        updateConfig: {
          ...local.updateConfig,
          notifyOnUpdateAvailable: false,
        },
      });
      setBanner("新版本桌面提醒已关闭。");
      return;
    }

    setUpdateNotificationBusy(true);
    try {
      const permission = await requestDesktopNotificationPermission();
      if (permission !== "granted") {
        setBanner("通知权限未授予。");
        return;
      }
      setLocal({
        ...local,
        updateConfig: {
          ...local.updateConfig,
          notifyOnUpdateAvailable: true,
        },
      });
      setBanner("新版本桌面提醒已开启。");
    } finally {
      setUpdateNotificationBusy(false);
    }
  }

  async function handleCheckForUpdates() {
    await checkForUpdates({
      announceNoUpdate: true,
      userInitiated: true,
    });
  }

  if (!local) {
    return (
      <div className={cx("flex items-center justify-center", embedded ? "min-h-[280px]" : "h-full bg-[#fafafa]")}>
        <div className="text-[11px] text-slate-400 animate-pulse font-bold tracking-widest uppercase">正在加载设置...</div>
      </div>
    );
  }

  return (
    <div
      className={cx(
        "relative overflow-x-hidden antialiased",
        embedded ? "min-h-0" : "min-h-full bg-[#f8fafc] px-6 py-10 sm:px-8 lg:px-12"
      )}
    >
      {!embedded ? (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1200px] h-[600px] bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.08),transparent_70%)] pointer-events-none" />
      ) : null}

      <div className={cx("relative mx-auto max-w-5xl", embedded ? "space-y-10" : "px-6 py-10")}>
        <header className="mb-12" style={stageStyle(mounted, 0)}>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              {/* <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-600 ring-1 ring-indigo-500/20 shadow-sm mb-4">
                 系统设置
              </div> */}
              <h1 className="text-4xl font-bold tracking-tight text-slate-900 drop-shadow-sm">
                设置
              </h1>
              <p className="mt-2.5 max-w-2xl text-[15px] text-slate-500 leading-relaxed font-medium">
                管理运行时工具链、执行限制，以及本地环境相关配置。
              </p>
            </div>

          <div className="flex items-center gap-2 bg-white/50 p-1.5 rounded-[10px] ring-1 ring-slate-200/50 backdrop-blur-md shadow-sm">
              <IconButton 
                icon={<img src={refreshIcon} alt="" className={cx("h-4 w-4", refreshing && "animate-spin")} />} 
                onClick={refreshRuntime} 
                disabled={refreshing} 
                title="扫描运行时" 
              />
              <IconButton 
                icon={<CheckIcon />} 
                onClick={handleSave} 
                disabled={saving || !dirty} 
                variant="primary" 
                title={dirty ? "保存更改" : "所有更改已保存"} 
              />
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <MetaChip>{PLATFORM_LABEL[platform]}</MetaChip>
            <MetaChip tone={dirty ? "warn" : "ready"}>
              {dirty ? "有未保存更改" : "已同步"}
            </MetaChip>
            
            {banner && (
              <div className="ml-auto animate-in fade-in slide-in-from-left-4 duration-300">
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1 text-[11px] font-bold text-white shadow-md uppercase tracking-wider">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {banner}
                </span>
              </div>
            )}
          </div>

          {dirty ? (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 shadow-sm">
              <div className="text-sm font-semibold">
                检测到未保存的更改，点击保存后才会生效。
              </div>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex h-9 items-center justify-center rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                立即保存
              </button>
            </div>
          ) : null}

          {!hideSectionTabs ? (
            <div className="mt-8 flex flex-wrap items-center gap-2 rounded-[12px] border border-slate-200 bg-white/85 p-2 shadow-sm">
              {(["settings", "vendors", "projects", "mcp", "skills"] as SettingsSection[]).map((section) => (
                <button
                  key={section}
                  type="button"
                  onClick={() => openSection(section)}
                  className={cx(
                    "inline-flex items-center rounded-[10px] px-3 py-2 text-sm font-semibold transition-all",
                    activeSection === section
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  {SETTINGS_SECTION_LABEL[section]}
                </button>
              ))}
            </div>
          ) : null}
        </header>

        <main className="space-y-10">
          {activeSection === "vendors" ? (
            <div style={stageStyle(mounted, 50)}>
              <Panel
                title="供应商"
                description="集中管理 OpenAI Compatible、Claude、Gemini 的 Provider 配置。"
                icon={<CpuIcon />}
                action={
                  <Link
                    to="/settings/model-providers"
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50"
                  >
                    打开模型管理
                  </Link>
                }
              >
                <div className="p-8 space-y-5">
                  {providerGroups.map(({ serviceType, meta, providers }) => (
                    <div key={serviceType} className="rounded-[12px] border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <img src={SERVICE_ICONS[serviceType]} alt="" className="h-5 w-5 object-contain" />
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-900">{meta.label}</div>
                            <div className="text-xs text-slate-500">{meta.description}</div>
                          </div>
                        </div>
                        <MetaChip tone={providers.some((provider) => provider.enabled) ? "ready" : "default"}>
                          {providers.length} Providers
                        </MetaChip>
                      </div>
                      <div className="mt-4 space-y-3">
                        {providers.map((provider) => (
                          <div key={provider.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-slate-100 bg-slate-50/70 px-4 py-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-semibold text-slate-900">{provider.name}</span>
                                <MetaChip tone={provider.enabled ? "ready" : "default"}>
                                  {provider.enabled ? "Enabled" : "Disabled"}
                                </MetaChip>
                              </div>
                              <div className="mt-1 truncate text-xs text-slate-500">{provider.baseUrl}</div>
                              <div className="mt-1 text-[11px] text-slate-400">
                                {provider.models.length} models · key {maskSecret(provider.apiKey)} · {relativeTime(provider.lastRefreshedAt)}
                              </div>
                            </div>
                            <Link
                              to={`/settings/model-providers/${serviceType}/${provider.id}`}
                              className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-all hover:bg-slate-50"
                            >
                              编辑
                            </Link>
                          </div>
                        ))}
                        {providers.length === 0 ? (
                          <div className="rounded-[10px] border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                            当前还没有配置 {meta.label} Provider。
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          ) : null}

          {activeSection === "projects" ? (
            <div style={stageStyle(mounted, 50)}>
              <Panel
                title="项目"
                description="查看当前已附加工作区，并快速切回对应终端工作区。"
                icon={<FolderIcon />}
                action={
                  <button
                    type="button"
                    onClick={() => void openWorkspaceFolder()}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50"
                  >
                    添加工作区
                  </button>
                }
              >
                <div className="p-8 space-y-5">
                  <div className="rounded-[12px] border border-slate-200 bg-slate-50/70 p-5">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">当前项目根目录</div>
                    <div className="mt-3 font-mono text-sm font-semibold text-slate-900">{local.projectRoot}</div>
                  </div>
                  {workspaces.map((workspace) => {
                    const workspaceTab = terminalTabs.find((tab) => tab.workspaceId === workspace.id) ?? null;
                    const isActiveWorkspace = workspace.id === activeWorkspace?.id;
                    return (
                      <div key={workspace.id} className="rounded-[12px] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-bold text-slate-900">{workspace.name}</span>
                              {isActiveWorkspace ? <MetaChip tone="ready">Active</MetaChip> : null}
                            </div>
                            <div className="mt-1 truncate text-xs text-slate-500">{workspace.rootPath}</div>
                            <div className="mt-2 text-[11px] text-slate-400">
                              Branch {workspace.branch} · Dirty {workspace.dirtyFiles} · Failing {workspace.failingChecks}
                            </div>
                          </div>
                          {workspaceTab ? (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTerminalTab(workspaceTab.id);
                                navigate("/terminal");
                              }}
                              className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-all hover:bg-slate-50"
                            >
                              打开终端
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {workspaces.length === 0 ? (
                    <div className="rounded-[12px] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                      当前还没有已附加的工作区。
                    </div>
                  ) : null}
                </div>
              </Panel>
            </div>
          ) : null}

          {activeSection === "mcp" ? (
            <div style={stageStyle(mounted, 50)}>
              <Panel title="MCP" description="显示当前各 CLI 已检测到的 MCP 资源。" icon={<CpuIcon />}>
                <div className="p-8 grid gap-5 md:grid-cols-3">
                  {agents.map((agent) => {
                    const group = runtimeResources(agent).mcp;
                    return (
                      <div key={agent.id} className="rounded-[12px] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-slate-900">{CLI_META[agent.id].label}</div>
                            <div className="text-xs text-slate-500">MCP resources</div>
                          </div>
                          <MetaChip tone={group.items.length > 0 ? "ready" : group.error ? "warn" : "default"}>
                            {group.items.length}
                          </MetaChip>
                        </div>
                        <div className="mt-4">
                          {resourceNamesRow(group)}
                        </div>
                        {group.error ? (
                          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                            {group.error}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </div>
          ) : null}

          {activeSection === "skills" ? (
            <div style={stageStyle(mounted, 50)}>
              <Panel title="Skills" description="显示运行时已检测技能，以及当前工作区可加载技能。" icon={<CpuIcon />}>
                <div className="p-8 grid gap-5 md:grid-cols-3">
                  {agents.map((agent) => {
                    const runtimeGroup = runtimeResources(agent).skill;
                    const workspaceSkillKey = activeWorkspace ? cliSkillCacheKeys[agent.id] : null;
                    const workspaceSkills = workspaceSkillKey ? cliSkillsByContext[workspaceSkillKey] ?? [] : [];
                    const workspaceSkillStatus = workspaceSkillKey ? cliSkillStatusByContext[workspaceSkillKey] ?? "idle" : "idle";
                    return (
                      <div key={agent.id} className="rounded-[12px] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-slate-900">{CLI_META[agent.id].label}</div>
                            <div className="text-xs text-slate-500">
                              {activeWorkspace ? `${activeWorkspace.name} workspace skills` : "Runtime skills"}
                            </div>
                          </div>
                          <MetaChip tone={workspaceSkills.length > 0 || runtimeGroup.items.length > 0 ? "ready" : "default"}>
                            {workspaceSkills.length > 0 ? workspaceSkills.length : runtimeGroup.items.length}
                          </MetaChip>
                        </div>
                        <div className="mt-4">
                          {workspaceSkills.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {workspaceSkills.slice(0, 12).map((item) => (
                                <span key={item.name} className="px-2 py-0.5 rounded-lg text-[10px] font-bold ring-1 ring-inset bg-white text-slate-700 ring-slate-200 shadow-sm">
                                  {item.displayName ?? item.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            resourceNamesRow(runtimeGroup)
                          )}
                        </div>
                        {activeWorkspace ? (
                          <div className="mt-3 text-[11px] text-slate-400">
                            {workspaceSkillStatus === "loading" ? "正在加载工作区技能…" : workspaceSkillStatus === "error" ? "工作区技能加载失败" : "工作区技能已同步"}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </div>
          ) : null}

          {activeSection === "settings" ? (
            <>
          {/* CLI Runtimes */}
          <div style={stageStyle(mounted, 50)}>
            <Panel
              title="CLI 运行时"
              description="扫描并展示当前可用的 CLI 工具链与资源清单。"
              icon={<TerminalIcon />}
            >
              <div className="divide-y divide-slate-100">
                {agents.map((agent) => {
                  const cli = agent.id;
                  const guide = GUIDES[cli];
                  const missing = !agent.runtime.installed;
                  const resources = runtimeResources(agent);

                  return (
                    <div key={cli} className={cx("p-8 transition-colors", missing ? "bg-rose-50/10" : "hover:bg-slate-50/30")}>
                      <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-4">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white font-bold text-lg shadow-sm">
                              {CLI_META[cli].label.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-3">
                                <h3 className="text-[16px] font-bold text-slate-900 tracking-tight">{CLI_META[cli].label}</h3>
                                <MetaChip tone={missing ? "warn" : "ready"}>{missing ? "未安装" : "已安装"}</MetaChip>
                                {!missing && (
                                  <span className="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-600 font-mono text-xs font-bold ring-1 ring-indigo-500/10">
                                    v{agent.runtime.version ?? "?.?.?"}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {missing && (
                            <div className="mt-6 pl-14 max-w-2xl">
                              <div className="bg-white border border-rose-100 rounded-[10px] p-5 shadow-sm">
                                <FieldLabel>请运行以下命令进行安装：</FieldLabel>
                                <div className="bg-rose-50/30 border border-rose-100 rounded-xl px-4 py-3 font-mono text-[13px] font-bold text-rose-900 mb-4 break-all">
                                  {guide.install[platform]}
                                </div>
                                <div className="flex items-center gap-6">
                                  <button onClick={() => copyText(guide.install[platform], `${cli}-i`, '安装命令')} className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 hover:text-indigo-700 underline underline-offset-4 transition-colors">复制命令</button>
                                  <a href={guide.docs} target="_blank" rel="noreferrer" className="text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-colors inline-flex items-center gap-1">查看文档 <ChevronRightIcon className="w-3 h-3" /></a>
                                </div>
                              </div>
                            </div>
                          )}

                          {!missing && (
                            <div className="mt-6 pl-14 flex flex-wrap gap-x-10 gap-y-4">
                              {RESOURCE_ORDER.map((kind) => {
                                const group = resources[kind];
                                if (!group.supported) return null;
                                return (
                                  <div key={`${cli}-${kind}`} className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-2 border-b border-slate-50 pb-1">
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{RESOURCE_LABEL[kind]}</span>
                                      <span className="text-[10px] font-bold text-slate-900 px-1.5 py-0.5 rounded bg-slate-100 ring-1 ring-slate-200">{group.items.length}</span>
                                    </div>
                                    {resourceNamesRow(group)}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {agent.runtime.lastError && (
                        <div className="mt-6 ml-14 rounded-[10px] border border-rose-200 bg-rose-50 p-4 font-mono text-[12px] text-rose-700 shadow-inner break-all">
                          <span className="font-bold uppercase tracking-wider block mb-1 text-[10px]">严重错误</span>
                          {agent.runtime.lastError}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* Workspace */}
          {/* <div style={stageStyle(mounted, 100)}>
            <Panel title="工作区上下文" description="用于执行与上下文提取的根目录映射配置。" icon={<FolderIcon />}>
              <div className="p-8 space-y-8">
                <div>
                  <FieldLabel required>系统项目根目录</FieldLabel>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                      <FolderIcon className="w-4 h-4" />
                    </div>
                    <input className={cx(INPUT_CLASS, "pl-11 font-mono text-[13px] font-bold")} value={local.projectRoot} onChange={(e) => setLocal({ ...local, projectRoot: e.target.value })} />
                  </div>
                </div>
              </div>
            </Panel>
          </div> */}

          {/* Alerts */}
          <div style={stageStyle(mounted, 150)}>
            <Panel title="系统提醒" description="用于任务完成状态的本地桌面提醒配置。" icon={<BellIcon />}>
              <div className="flex flex-col gap-6 p-8 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/20 transition-colors">
                <div className="max-w-xl">
                  <div className="flex items-center gap-3">
                    <h3 className="text-[15px] font-bold text-slate-900 uppercase tracking-tight">完成通知</h3>
                    <MetaChip tone={local.notifyOnTerminalCompletion ? "ready" : "default"}>{local.notifyOnTerminalCompletion ? "已开启" : "已关闭"}</MetaChip>
                  </div>
                  <p className="mt-2 text-[14px] text-slate-500 leading-relaxed font-medium">当长时间运行的智能体线程执行完成时，接收 Windows/macOS 的桌面提醒。</p>
                </div>
                <div className="flex items-center gap-4 bg-white p-3 rounded-[10px] ring-1 ring-slate-200 shadow-sm">
                  <span className={cx("text-[10px] font-bold uppercase tracking-widest", local.notifyOnTerminalCompletion ? "text-indigo-600" : "text-slate-400")}>
                    {notificationBusy ? "处理中..." : local.notifyOnTerminalCompletion ? "开启" : "关闭"}
                  </span>
                  <ToggleSwitch enabled={local.notifyOnTerminalCompletion} onClick={toggleCompletionNotifications} disabled={notificationBusy} />
                </div>
              </div>
            </Panel>
          </div>

          <div style={stageStyle(mounted, 165)}>
            <Panel title="应用更新" description="配置桌面版自动检查更新、用户提醒与当前版本安装状态。" icon={<UpdateIcon />}>
              <div className="p-8 space-y-6">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-2xl">
                    <div className="flex items-center gap-3">
                      <h3 className="text-[15px] font-bold text-slate-900 uppercase tracking-tight">更新检测</h3>
                      <MetaChip tone={updaterState.stage === "error" ? "warn" : updaterState.stage === "available" ? "ready" : "default"}>
                        {updateStatusLabel}
                      </MetaChip>
                      <MetaChip tone={updateConfigured ? "ready" : "warn"}>
                        {updateConfigured ? "Feed 已配置" : "待配置签名"}
                      </MetaChip>
                    </div>
                    <p className="mt-2 text-[14px] text-slate-500 leading-relaxed font-medium">
                      桌面版会通过 GitHub Release feed 检查新版本。发现更新后会弹出下载提示，并支持一键安装重启。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void handleCheckForUpdates()}
                      disabled={!updateSupported || updaterState.stage === "checking" || updaterState.stage === "downloading" || updaterState.stage === "installing" || updaterState.stage === "restarting"}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {updaterState.stage === "checking" ? "检查中..." : "检查更新"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void startUpdate()}
                      disabled={!updateSupported || updaterState.stage !== "available"}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {updaterState.stage === "available" ? "立即更新" : "等待新版本"}
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="flex items-center justify-between gap-4 rounded-[12px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">启动后自动检查</div>
                      <div className="mt-1 text-xs leading-relaxed text-slate-500">
                        发布版应用启动后和后台轮询时自动检查是否有新版本。
                      </div>
                    </div>
                    <ToggleSwitch
                      enabled={local.updateConfig.autoCheckForUpdates}
                      onClick={() =>
                        setLocal({
                          ...local,
                          updateConfig: {
                            ...local.updateConfig,
                            autoCheckForUpdates: !local.updateConfig.autoCheckForUpdates,
                          },
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-[12px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">发现更新时桌面提醒</div>
                      <div className="mt-1 text-xs leading-relaxed text-slate-500">
                        应用在后台或失焦时，额外发送系统通知提醒用户安装新版本。
                      </div>
                    </div>
                    <ToggleSwitch
                      enabled={local.updateConfig.notifyOnUpdateAvailable}
                      onClick={() => void toggleUpdateNotifications()}
                      disabled={updateNotificationBusy}
                    />
                  </div>
                </div>

                {!updateSupported ? (
                  <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    当前是开发环境或非桌面运行时，在线更新仅在发布版桌面应用中生效。
                  </div>
                ) : null}

                {updateSupported ? (
                  <div className="rounded-[10px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    当前桌面版采用 GitHub Releases 低成本分发，不包含 Apple notarization 或 Windows 代码签名。
                    macOS 首次打开下载的应用时，可能需要前往系统“隐私与安全性”里手动点“仍要打开”。
                  </div>
                ) : null}

                {!updateConfigured ? (
                  <div className="rounded-[10px] border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                    还需要将真实的 Tauri updater 公钥写入 <span className="font-mono">src-tauri/tauri.conf.json</span>，
                    并在 GitHub Actions 中配置 updater 私钥后，应用内更新才会真正可用。这个流程不依赖 Apple 证书。
                  </div>
                ) : null}

                {updaterState.error ? (
                  <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {updaterState.error}
                  </div>
                ) : null}
              </div>
            </Panel>
          </div>

          <div style={stageStyle(mounted, 175)}>
            <Panel title="模型对话" description="配置模型对话页发给 AI 的上下文窗口大小。" icon={<CpuIcon />}>
              <div className="p-8 space-y-6">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                  <div className="rounded-[12px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
                    <FieldLabel>上下文保留轮数</FieldLabel>
                    <input
                      type="number"
                      min={1}
                      className={INPUT_CLASS}
                      value={local.modelChatContextTurnLimit}
                      onChange={(e) =>
                        setLocal({
                          ...local,
                          modelChatContextTurnLimit: Math.max(1, parseInt(e.target.value, 10) || 4),
                        })
                      }
                    />
                  </div>

                  <div className="rounded-[12px] border border-slate-200 bg-slate-50 px-5 py-5 text-sm text-slate-600">
                    <div className="text-sm font-semibold text-slate-900">当前行为</div>
                    <div className="mt-2 leading-relaxed">
                      模型对话页会始终保留所有 system 消息，并额外附带最近{" "}
                      <span className="font-semibold text-slate-900">{local.modelChatContextTurnLimit}</span>{" "}
                      轮 user / assistant 对话作为上下文。
                    </div>
                    <div className="mt-3 leading-relaxed text-slate-500">
                      数值越小，响应越省 token、越稳定；数值越大，模型对更早对话的记忆更完整。
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          </div>

          <div style={stageStyle(mounted, 185)}>
            <Panel title="邮件通知" description="供自动化任务在启用完成邮件时使用的 SMTP 配置。" icon={<MailIcon />}>
              <div className="p-8 space-y-8">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="max-w-2xl">
                    <div className="flex items-center gap-3">
                      <h3 className="text-[15px] font-bold text-slate-900 uppercase tracking-tight">SMTP 投递</h3>
                      <MetaChip tone={local.notificationConfig.smtpEnabled ? "ready" : "default"}>
                        {local.notificationConfig.smtpEnabled ? "已启用" : "已关闭"}
                      </MetaChip>
                    </div>
                    <p className="mt-2 text-[14px] text-slate-500 leading-relaxed font-medium">
                      配置统一的 SMTP 账号与全局收件人。启用了完成邮件通知的自动化任务会复用这里的配置。
                    </p>
                  </div>
                  <div className="flex items-center gap-4 bg-white p-3 rounded-[10px] ring-1 ring-slate-200 shadow-sm">
                    <span className={cx("text-[10px] font-bold uppercase tracking-widest", local.notificationConfig.smtpEnabled ? "text-indigo-600" : "text-slate-400")}>
                      {local.notificationConfig.smtpEnabled ? "开启" : "关闭"}
                    </span>
                    <ToggleSwitch
                      enabled={local.notificationConfig.smtpEnabled}
                      onClick={() =>
                        setLocal({
                          ...local,
                          notificationConfig: {
                            ...local.notificationConfig,
                            smtpEnabled: !local.notificationConfig.smtpEnabled,
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <FieldLabel required>SMTP 主机</FieldLabel>
                    <input
                      className={INPUT_CLASS}
                      placeholder="smtp.example.com"
                      value={local.notificationConfig.smtpHost}
                      onChange={(e) =>
                        setLocal({
                          ...local,
                          notificationConfig: { ...local.notificationConfig, smtpHost: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel required>SMTP 端口</FieldLabel>
                    <input
                      type="number"
                      className={INPUT_CLASS}
                      value={local.notificationConfig.smtpPort}
                      onChange={(e) =>
                        setLocal({
                          ...local,
                          notificationConfig: {
                            ...local.notificationConfig,
                            smtpPort: parseInt(e.target.value, 10) || 587,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel required>SMTP 用户名</FieldLabel>
                    <input
                      className={INPUT_CLASS}
                      placeholder="notifications@example.com"
                      value={local.notificationConfig.smtpUsername}
                      onChange={(e) =>
                        setLocal({
                          ...local,
                          notificationConfig: { ...local.notificationConfig, smtpUsername: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel required>SMTP 密码</FieldLabel>
                    <input
                      type="password"
                      className={INPUT_CLASS}
                      placeholder="应用专用密码或 SMTP 密码"
                      value={local.notificationConfig.smtpPassword}
                      onChange={(e) =>
                        setLocal({
                          ...local,
                          notificationConfig: { ...local.notificationConfig, smtpPassword: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <FieldLabel required>发件人地址</FieldLabel>
                    <input
                      className={INPUT_CLASS}
                      placeholder="noreply@example.com"
                      value={local.notificationConfig.smtpFrom}
                      onChange={(e) =>
                        setLocal({
                          ...local,
                          notificationConfig: { ...local.notificationConfig, smtpFrom: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <FieldLabel required>默认收件人</FieldLabel>
                    <textarea
                      className={cx(INPUT_CLASS, "min-h-[110px] resize-none py-3 leading-relaxed")}
                      placeholder="alice@example.com, bob@example.com"
                      value={emailRecipientsInput}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setEmailRecipientsInput(nextValue);
                        setLocal({
                          ...local,
                          notificationConfig: {
                            ...local.notificationConfig,
                            emailRecipients: parseEmailRecipients(nextValue),
                          },
                        });
                      }}
                    />
                    <p className="text-xs text-slate-500">可使用逗号、分号或换行来分隔多个收件人地址。</p>
                  </div>
                </div>

                <div className="rounded-[10px] border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  <div className="font-semibold">Plunk SMTP 提示</div>
                  <div className="mt-1 text-xs leading-relaxed text-sky-700">
                    如果你使用 Plunk，请将主机设置为 <span className="font-mono">smtp.useplunk.com</span>，端口使用 <span className="font-mono">2587</span>（STARTTLS）或 <span className="font-mono">2465</span>（SSL/TLS），用户名填写 <span className="font-mono">plunk</span>，密码填写你的 Plunk Secret API Key。
                  </div>
                </div>

                <div className="flex items-center justify-end border-t border-slate-100 pt-6">
                  <button
                    type="button"
                    onClick={handleSendTestEmail}
                    disabled={emailTestBusy}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {emailTestBusy ? "发送中..." : "发送测试邮件"}
                  </button>
                </div>
              </div>
            </Panel>
          </div>

          {/* Limits */}
          {/* <div style={stageStyle(mounted, 200)}>
            <Panel title="执行限制" description="用于自动化智能体操作的安全边界配置。" icon={<CpuIcon />}>
              <div className="grid gap-6 p-8 sm:grid-cols-3">
                <div className="rounded-[10px] border border-slate-100 bg-slate-50/50 p-5">
                  <FieldLabel>每个智能体轮数</FieldLabel>
                  <input
                    type="number"
                    className={INPUT_CLASS}
                    value={local.maxTurnsPerAgent}
                    onChange={(e) =>
                      setLocal({
                        ...local,
                        maxTurnsPerAgent: parseInt(e.target.value, 10) || 50,
                      })
                    }
                  />
                </div>
                <div className="rounded-[10px] border border-slate-100 bg-slate-50/50 p-5">
                  <FieldLabel>输出上限（字符）</FieldLabel>
                  <input
                    type="number"
                    className={INPUT_CLASS}
                    value={local.maxOutputCharsPerTurn}
                    onChange={(e) =>
                      setLocal({
                        ...local,
                        maxOutputCharsPerTurn: parseInt(e.target.value, 10) || 100000,
                      })
                    }
                  />
                </div>
                <div className="rounded-[10px] border border-slate-100 bg-slate-50/50 p-5">
                  <FieldLabel>超时缓冲（毫秒）</FieldLabel>
                  <input
                    type="number"
                    className={INPUT_CLASS}
                    value={local.processTimeoutMs}
                    onChange={(e) =>
                      setLocal({
                        ...local,
                        processTimeoutMs: parseInt(e.target.value, 10) || 300000,
                      })
                    }
                  />
                </div>
              </div>
              <div className="px-8 pb-8 text-xs text-slate-500">
                当前生效值：轮数 {formatLimit(local.maxTurnsPerAgent)} / 输出{" "}
                {formatLimit(local.maxOutputCharsPerTurn)} / 超时{" "}
                {formatLimit(local.processTimeoutMs)}ms
              </div>
            </Panel>
          </div> */}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
