import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { bridge } from "../lib/bridge";
import { AgentId, AgentResourceGroup, AgentResourceKind, AgentRuntimeResources, AppSettings } from "../lib/models";
import { useStore } from "../lib/store";
import { requestDesktopNotificationPermission } from "../lib/desktopNotifications";

// --- Configuration ---
const CLI_ORDER = ["codex", "claude", "gemini"] as const;
const PLATFORM_ORDER = ["windows", "macos", "linux"] as const;
const RESOURCE_ORDER: AgentResourceKind[] = ["mcp", "skill", "plugin", "extension"];

const INPUT_CLASS =
  "block w-full rounded-xl border-0 py-2.5 px-3.5 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm sm:leading-6 bg-white transition-all hover:bg-slate-50 focus:bg-white";

type Platform = (typeof PLATFORM_ORDER)[number];

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
  skill: "Skills",
  plugin: "Plugins",
  extension: "Extensions",
};

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

const CpuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
    <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M9 9H15V15H9V9Z" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M9 2V5M15 2V5M9 19V22M15 19V22M2 9H5M2 15H5M19 9H22M19 15H22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const RefreshIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
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
  if (!group.supported) return <span className="text-slate-300 italic">Unsupported</span>;
  if (group.error) return <span className="text-rose-400">Error</span>;
  if (group.items.length === 0) return <span className="text-slate-400 italic">None</span>;
  
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
      <div className="absolute inset-0 bg-gradient-to-b from-white/60 to-white/10 rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] pointer-events-none" />
      <div className="relative overflow-hidden rounded-[24px] bg-white backdrop-blur-xl ring-1 ring-slate-200/60 shadow-sm">
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
        "flex h-9 w-9 items-center justify-center rounded-xl transition-all active:scale-[0.92] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-slate-900 text-white hover:bg-slate-800 shadow-md shadow-slate-900/10 ring-1 ring-slate-900",
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

export function SettingsPage() {
  const storedSettings = useStore((s) => s.settings);
  const appState = useStore((s) => s.appState);
  const updateSettings = useStore((s) => s.updateSettings);
  const setAppState = useStore((s) => s.setAppState);

  const [local, setLocal] = useState<AppSettings | null>(null);
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const [mounted, setMounted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);

  useEffect(() => {
    if (storedSettings) {
      setLocal({ ...storedSettings, cliPaths: { ...storedSettings.cliPaths } });
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
  const runtimeSummary = `${installedCount}/${CLI_ORDER.length} runtimes ready on ${PLATFORM_LABEL[platform]}.`;
  const branch = appState?.workspace.branch ?? "main";

  async function copyText(value: string, key: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setBanner(`${label} copied.`);
    } catch {
      setBanner(`Could not copy ${label.toLowerCase()}.`);
    }
  }

  async function refreshRuntime() {
    if (!local) return;
    setRefreshing(true);
    try {
      const state = await bridge.loadAppState(local.projectRoot);
      setAppState(state);
      setBanner("Detection Complete");
    } catch {
      setBanner("Detection Failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSave() {
    if (!local) return;
    setSaving(true);
    try {
      await updateSettings(local);
      const state = await bridge.loadAppState(local.projectRoot);
      setAppState(state);
      setBanner("Settings Saved");
    } catch {
      setBanner("Save Failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCompletionNotifications() {
    if (!local) return;
    if (local.notifyOnTerminalCompletion) {
      setLocal({ ...local, notifyOnTerminalCompletion: false });
      setBanner("Notifications disabled.");
      return;
    }

    setNotificationBusy(true);
    try {
      const permission = await requestDesktopNotificationPermission();
      if (permission !== "granted") {
        setBanner("Permission denied.");
        return;
      }
      setLocal({ ...local, notifyOnTerminalCompletion: true });
      setBanner("Notifications enabled.");
    } finally {
      setNotificationBusy(false);
    }
  }

  if (!local) {
    return (
      <div className="flex h-full items-center justify-center bg-[#fafafa]">
        <div className="text-[11px] text-slate-400 animate-pulse font-bold tracking-widest uppercase">Booting preferences...</div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#f8fafc] px-6 py-10 sm:px-8 lg:px-12 relative overflow-x-hidden antialiased">
      {/* Soft background ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1200px] h-[600px] bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.08),transparent_70%)] pointer-events-none" />
      
      <div className="relative px-6 py-10 mx-auto max-w-5xl">
        <header className="mb-12" style={stageStyle(mounted, 0)}>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-600 ring-1 ring-indigo-500/20 shadow-sm mb-4">
                 System Preferences
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-slate-900 drop-shadow-sm">
                Settings
              </h1>
              <p className="mt-2.5 max-w-2xl text-[15px] text-slate-500 leading-relaxed font-medium">
                Manage runtime toolchains, execution constraints, and local environment variables.
              </p>
            </div>

            <div className="flex items-center gap-2 bg-white/50 p-1.5 rounded-2xl ring-1 ring-slate-200/50 backdrop-blur-md shadow-sm">
              <IconButton 
                icon={<RefreshIcon className={cx(refreshing && "animate-spin")} />} 
                onClick={refreshRuntime} 
                disabled={refreshing} 
                title="Scan Runtime" 
              />
              <IconButton 
                icon={<CheckIcon />} 
                onClick={handleSave} 
                disabled={saving || !dirty} 
                variant="primary" 
                title={dirty ? "Save changes" : "All changes saved"} 
              />
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <MetaChip>{PLATFORM_LABEL[platform]}</MetaChip>
            <MetaChip>
              <span className="text-slate-400 mr-1.5 font-bold italic">GIT:</span>
              <span className="font-mono">{branch}</span>
            </MetaChip>
            <MetaChip tone={dirty ? "warn" : "ready"}>
              {dirty ? "Unsaved changes" : "Synced"}
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
        </header>

        <main className="space-y-10">
          {/* CLI Runtimes */}
          <div style={stageStyle(mounted, 50)}>
            <Panel
              title="CLI Runtimes"
              description="Hardware-accelerated toolchain discovery and inventory."
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
                                <MetaChip tone={missing ? "warn" : "ready"}>{missing ? "Missing" : "Installed"}</MetaChip>
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
                              <div className="bg-white border border-rose-100 rounded-2xl p-5 shadow-sm">
                                <FieldLabel>Run this command to install:</FieldLabel>
                                <div className="bg-rose-50/30 border border-rose-100 rounded-xl px-4 py-3 font-mono text-[13px] font-bold text-rose-900 mb-4 break-all">
                                  {guide.install[platform]}
                                </div>
                                <div className="flex items-center gap-6">
                                  <button onClick={() => copyText(guide.install[platform], `${cli}-i`, 'Install')} className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 hover:text-indigo-700 underline underline-offset-4 transition-colors">Copy Command</button>
                                  <a href={guide.docs} target="_blank" rel="noreferrer" className="text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-colors inline-flex items-center gap-1">Documentation <ChevronRightIcon className="w-3 h-3" /></a>
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
                        <div className="mt-6 ml-14 rounded-xl border border-rose-200 bg-rose-50 p-4 font-mono text-[12px] text-rose-700 shadow-inner break-all">
                          <span className="font-bold uppercase tracking-wider block mb-1 text-[10px]">Critical Error</span>
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
          <div style={stageStyle(mounted, 100)}>
            <Panel title="Workspace Context" description="Root directory mappings for execution and context extraction." icon={<FolderIcon />}>
              <div className="p-8 space-y-8">
                <div>
                  <FieldLabel required>System Project Root</FieldLabel>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                      <FolderIcon className="w-4 h-4" />
                    </div>
                    <input className={cx(INPUT_CLASS, "pl-11 font-mono text-[13px] font-bold")} value={local.projectRoot} onChange={(e) => setLocal({ ...local, projectRoot: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 border border-slate-100 p-5 ring-1 ring-inset ring-white">
                    <FieldLabel>Git Environment</FieldLabel>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                      <span className="font-mono text-[14px] font-bold text-slate-900 uppercase tracking-tight">{branch}</span>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 border border-slate-100 p-5 ring-1 ring-inset ring-white">
                    <FieldLabel>Ready Runtimes</FieldLabel>
                    <div className="text-[14px] font-bold text-slate-900 mt-1 uppercase tracking-tight">{runtimeSummary}</div>
                  </div>
                </div>
              </div>
            </Panel>
          </div>

          {/* Alerts */}
          <div style={stageStyle(mounted, 150)}>
            <Panel title="System Alerts" description="Native relays for process completion states." icon={<BellIcon />}>
              <div className="flex flex-col gap-6 p-8 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/20 transition-colors">
                <div className="max-w-xl">
                  <div className="flex items-center gap-3">
                    <h3 className="text-[15px] font-bold text-slate-900 uppercase tracking-tight">Completion Notifications</h3>
                    <MetaChip tone={local.notifyOnTerminalCompletion ? "ready" : "default"}>{local.notifyOnTerminalCompletion ? "Active" : "Off"}</MetaChip>
                  </div>
                  <p className="mt-2 text-[14px] text-slate-500 leading-relaxed font-medium">Receive Windows/macOS alerts when long-running agent threads finish execution.</p>
                </div>
                <div className="flex items-center gap-4 bg-white p-3 rounded-2xl ring-1 ring-slate-200 shadow-sm">
                  <span className={cx("text-[10px] font-bold uppercase tracking-widest", local.notifyOnTerminalCompletion ? "text-indigo-600" : "text-slate-400")}>
                    {notificationBusy ? "Working..." : local.notifyOnTerminalCompletion ? "ON" : "OFF"}
                  </span>
                  <ToggleSwitch enabled={local.notifyOnTerminalCompletion} onClick={toggleCompletionNotifications} disabled={notificationBusy} />
                </div>
              </div>
            </Panel>
          </div>

          {/* Limits */}
          <div style={stageStyle(mounted, 200)}>
            <Panel title="Execution Limits" description="Safety boundaries for automated agent operations." icon={<CpuIcon />} action={
              <button onClick={() => setShowAdvanced((v) => !v)} className="rounded-xl bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-600 ring-1 ring-slate-200 shadow-sm hover:bg-slate-50 transition-all">
                {showAdvanced ? "Lock Settings" : "Configure Limits"}
              </button>
            }>
              {!showAdvanced ? (
                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                  <div className="p-8">
                    <FieldLabel>Rounds / Agent</FieldLabel>
                    <span className="text-[22px] font-bold text-slate-900 font-mono tracking-tighter">{formatLimit(local.maxTurnsPerAgent)}</span>
                  </div>
                  <div className="p-8">
                    <FieldLabel>Output Limit</FieldLabel>
                    <span className="text-[22px] font-bold text-slate-900 font-mono tracking-tighter">{formatLimit(local.maxOutputCharsPerTurn)}</span>
                  </div>
                  <div className="p-8">
                    <FieldLabel>Process Timeout</FieldLabel>
                    <span className="text-[22px] font-bold text-slate-900 font-mono tracking-tighter">{formatLimit(local.processTimeoutMs)}<span className="text-xs ml-1 text-slate-400 uppercase tracking-widest">ms</span></span>
                  </div>
                </div>
              ) : (
                <div className="grid gap-8 p-8 sm:grid-cols-3 bg-indigo-50/20">
                  <div>
                    <FieldLabel>Rounds / Agent</FieldLabel>
                    <input type="number" className={INPUT_CLASS} value={local.maxTurnsPerAgent} onChange={(e) => setLocal({ ...local, maxTurnsPerAgent: parseInt(e.target.value, 10) || 50 })} />
                  </div>
                  <div>
                    <FieldLabel>Output limit (chars)</FieldLabel>
                    <input type="number" className={INPUT_CLASS} value={local.maxOutputCharsPerTurn} onChange={(e) => setLocal({ ...local, maxOutputCharsPerTurn: parseInt(e.target.value, 10) || 100000 })} />
                  </div>
                  <div>
                    <FieldLabel>Timeout buffer (ms)</FieldLabel>
                    <input type="number" className={INPUT_CLASS} value={local.processTimeoutMs} onChange={(e) => setLocal({ ...local, processTimeoutMs: parseInt(e.target.value, 10) || 300000 })} />
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </main>
      </div>
    </div>
  );
}