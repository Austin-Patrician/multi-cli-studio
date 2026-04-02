import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { bridge } from "../lib/bridge";
import { AgentId, AgentRuntimeResources, AppSettings } from "../lib/models";
import { useStore } from "../lib/store";
import { requestDesktopNotificationPermission } from "../lib/desktopNotifications";

const CLI_ORDER = ["codex", "claude", "gemini"] as const;
const PLATFORM_ORDER = ["windows", "macos", "linux"] as const;

const INPUT_CLASS =
  "block w-full rounded-xl border-0 py-2.5 px-3.5 text-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-inset ring-slate-200/80 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:text-sm sm:leading-6 bg-slate-50/50 transition-all hover:bg-slate-50 focus:bg-white";

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

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "windows";
  const source = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (source.includes("mac")) return "macos";
  if (source.includes("linux")) return "linux";
  return "windows";
}

function emptyResources() {
  return {
    mcp: { supported: true, items: [], error: null },
    skill: { supported: true, items: [], error: null },
    plugin: { supported: true, items: [], error: null },
    extension: { supported: true, items: [], error: null },
  };
}

function fallbackAgent(cli: AgentId): SettingsAgent {
  return {
    id: cli,
    runtime: { installed: false, version: null, commandPath: null, lastError: null, resources: emptyResources() },
  };
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

// --- Icons ---
const TerminalIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const FolderIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
);

const BellIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
  </svg>
);

const CpuIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
  </svg>
);

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
      <div className="absolute inset-0 bg-gradient-to-b from-white/60 to-white/10 rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] pointer-events-none" />
      <div className="relative overflow-hidden rounded-[20px] bg-white/70 backdrop-blur-xl ring-1 ring-slate-200/60 shadow-[0_2px_10px_rgb(0,0,0,0.02)]">
        <div className="flex flex-col gap-4 border-b border-slate-100/80 bg-slate-50/50 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {icon ? (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/50 text-indigo-500">
                {icon}
              </div>
            ) : null}
            <div>
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              {description ? (
                <p className="mt-0.5 text-sm text-slate-500">{description}</p>
              ) : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        <div className="bg-white/40">{children}</div>
      </div>
    </section>
  );
}

function MetaChip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "ready" | "warn" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        tone === "ready" && "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
        tone === "warn" && "bg-amber-50 text-amber-700 ring-amber-600/20",
        tone === "default" && "bg-slate-100/80 text-slate-600 ring-slate-500/10"
      )}
    >
      {children}
    </span>
  );
}

function CodeValue({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-md bg-slate-50/80 px-2.5 py-1.5 text-[13px] font-mono text-slate-700 border border-slate-200/60 shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
      {children}
    </label>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = "secondary",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "outline";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-slate-900 text-white hover:bg-slate-800 shadow-md shadow-slate-900/10 ring-1 ring-slate-900",
        variant === "secondary" && "bg-white text-slate-700 hover:bg-slate-50 ring-1 ring-inset ring-slate-200 shadow-sm",
        variant === "outline" && "bg-transparent text-slate-600 hover:bg-slate-50 ring-1 ring-inset ring-slate-200 shadow-none"
      )}
    >
      {children}
    </button>
  );
}

function ToggleSwitch({ enabled, onClick, disabled }: { enabled: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={enabled}
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
  const branch = appState?.workspace.branch ?? "workspace";

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
      setBanner("Runtime detection refreshed.");
    } catch {
      setBanner("Could not refresh runtime detection.");
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
      setBanner("Settings saved.");
    } catch {
      setBanner("Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCompletionNotifications() {
    if (!local) return;
    if (local.notifyOnTerminalCompletion) {
      setLocal({ ...local, notifyOnTerminalCompletion: false });
      setBanner("Desktop notifications will be disabled after you save.");
      return;
    }

    setNotificationBusy(true);
    try {
      const permission = await requestDesktopNotificationPermission();
      if (permission !== "granted") {
        if (permission === "unsupported") {
          setBanner("Desktop notifications are not available in this runtime.");
        } else {
          setBanner("Desktop notification permission was not granted.");
        }
        return;
      }

      setLocal({ ...local, notifyOnTerminalCompletion: true });
      setBanner("Desktop notifications ready. Save changes to enable them.");
    } finally {
      setNotificationBusy(false);
    }
  }

  if (!local) {
    return (
      <div className="flex h-full items-center justify-center bg-[#fafafa]">
        <div className="text-sm text-slate-400 animate-pulse font-medium tracking-wide">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="min-h-full relative overflow-x-hidden bg-[#fafbfc]">
      {/* Soft background ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1000px] h-[500px] bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.08),transparent_70%)] pointer-events-none" />
      
      <div className="relative px-6 py-10 sm:px-8 lg:px-12 mx-auto max-w-5xl">
        <header className="mb-12" style={stageStyle(mounted, 0)}>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 drop-shadow-sm">
                Settings
              </h1>
              <p className="mt-2.5 max-w-2xl text-[15px] text-slate-500 leading-relaxed">
                Manage your runtime configuration, workspace paths, and app preferences.
              </p>
            </div>

            <div className="flex items-center gap-3 bg-white/50 p-1.5 rounded-2xl ring-1 ring-slate-200/50 backdrop-blur-md shadow-sm">
              <ActionButton onClick={refreshRuntime} disabled={refreshing} variant="secondary">
                {refreshing ? "Refreshing..." : "Refresh"}
              </ActionButton>
              <ActionButton onClick={handleSave} disabled={saving || !dirty} variant="primary">
                {saving ? "Saving..." : dirty ? "Save changes" : "Saved"}
              </ActionButton>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <MetaChip>{PLATFORM_LABEL[platform]}</MetaChip>
            <MetaChip>
              <span className="text-slate-400 mr-1.5">branch:</span>
              <span className="font-mono">{branch}</span>
            </MetaChip>
            <MetaChip tone={dirty ? "warn" : "ready"}>
              {dirty ? "Unsaved changes" : "Synced"}
            </MetaChip>
            
            {banner && (
              <div className="ml-auto animate-in fade-in slide-in-from-left-4 duration-300">
                <span className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-white shadow-md">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {banner}
                </span>
              </div>
            )}
          </div>
        </header>

        <main className="space-y-8">
          <div style={stageStyle(mounted, 50)}>
            <Panel
              title="CLI Runtimes"
              description="Auto-detect installed toolchains on this machine. Runtimes are checked inline, resolving path and version automatically."
              icon={<TerminalIcon />}
            >
              <div className="divide-y divide-slate-100/80">
                {agents.map((agent) => {
                  const cli = agent.id;
                  const guide = GUIDES[cli];
                  const missing = !agent.runtime.installed;
                  const installCommand = guide.install[platform];

                  return (
                    <div
                      key={cli}
                      className={cx(
                        "p-6 transition-all duration-300 hover:bg-slate-50/40",
                        missing ? "bg-amber-50/10" : ""
                      )}
                    >
                      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                        {/* Left Column: Info & Status */}
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 ring-1 ring-slate-200/50 text-slate-600 font-semibold text-xs uppercase tracking-wider">
                              {CLI_META[cli].label.charAt(0)}
                            </div>
                            <h3 className="text-[15px] font-semibold text-slate-900">
                              {CLI_META[cli].label}
                            </h3>
                            <MetaChip tone={missing ? "warn" : "ready"}>
                              {missing ? "Not installed" : "Installed"}
                            </MetaChip>
                          </div>
                          <div className="mt-2.5 font-mono text-[13px] text-slate-500 pl-11">
                            {CLI_META[cli].prompt}
                          </div>

                          {missing ? (
                            <div className="mt-5 pl-11 flex flex-col gap-3">
                              <div className="flex items-center gap-3">
                                <span className="text-[13px] font-medium text-slate-500 uppercase tracking-wider">Install</span>
                                <CodeValue className="!px-3 !py-1.5 shadow-none ring-slate-200">{installCommand}</CodeValue>
                              </div>
                              <div className="flex items-center gap-4 mt-1">
                                <button
                                  onClick={() =>
                                    copyText(
                                      installCommand,
                                      `${cli}-install`,
                                      `${CLI_META[cli].label} install command`
                                    )
                                  }
                                  className="text-[13px] font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                                >
                                  {copied === `${cli}-install` ? "Copied!" : "Copy command"}
                                </button>
                                <span className="text-slate-300">&bull;</span>
                                <a
                                  href={guide.docs}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[13px] font-semibold text-slate-500 hover:text-slate-800 transition-colors inline-flex items-center gap-1"
                                >
                                  View docs <span className="text-lg leading-none translate-y-[-1px]">&rarr;</span>
                                </a>
                              </div>
                            </div>
                          ) : null}

                          {agent.runtime.lastError ? (
                            <div className="mt-4 ml-11 rounded-xl border border-red-200 bg-red-50/50 p-3.5 font-mono text-[13px] text-red-700 shadow-sm">
                              {agent.runtime.lastError}
                            </div>
                          ) : null}
                        </div>

                        {/* Right Column: Version & Path */}
                        <div className="flex shrink-0 flex-col gap-5 sm:w-[240px] lg:w-[320px] bg-slate-50/50 rounded-xl p-4 ring-1 ring-slate-100">
                          <div>
                            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-slate-400">Version</span>
                            <span className={cx("font-mono text-[13px]", missing ? "text-slate-400 italic" : "text-slate-700")}>
                              {agent.runtime.version ?? (missing ? "—" : "not detected")}
                            </span>
                          </div>
                          <div className="h-[1px] w-full bg-slate-200/60" />
                          <div>
                            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-slate-400">Command Path</span>
                            <span className={cx("break-all font-mono text-[13px] leading-relaxed", missing ? "text-slate-400 italic" : "text-slate-700")}>
                              {agent.runtime.commandPath ?? (missing ? "—" : "awaiting refresh")}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div style={stageStyle(mounted, 100)}>
            <Panel
              title="Workspace Context"
              description="The primary project root for context mapping and application execution."
              icon={<FolderIcon />}
            >
              <div className="p-6 space-y-6">
                <div>
                  <FieldLabel>Project Root Directory</FieldLabel>
                  <div className="mt-2 relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <FolderIcon className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      className={cx(INPUT_CLASS, "pl-10 font-mono text-[13px]")}
                      value={local.projectRoot}
                      onChange={(event) => setLocal({ ...local, projectRoot: event.target.value })}
                    />
                  </div>
                </div>

                <div className="grid gap-6 sm:grid-cols-2 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-100">
                  <div>
                    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-slate-400">Active Branch</span>
                    <span className="font-mono text-[13px] text-slate-700 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.6)]"></span>
                      {branch}
                    </span>
                  </div>
                  <div>
                    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-slate-400">Runtime Status</span>
                    <span className="text-[13px] font-medium text-slate-700">{runtimeSummary}</span>
                  </div>
                </div>
              </div>
            </Panel>
          </div>

          <div style={stageStyle(mounted, 150)}>
            <Panel
              title="Desktop Alerts"
              description="Send a native OS notification when a background terminal task completes."
              icon={<BellIcon />}
            >
              <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/30 transition-colors">
                <div className="max-w-xl">
                  <div className="flex items-center gap-3">
                    <h3 className="text-[15px] font-semibold text-slate-900">Task Completion Notifications</h3>
                    <MetaChip tone={local.notifyOnTerminalCompletion ? "ready" : "default"}>
                      {local.notifyOnTerminalCompletion ? "Enabled" : "Disabled"}
                    </MetaChip>
                  </div>
                  <p className="mt-1.5 text-[14px] text-slate-500 leading-relaxed">
                    Enable this to receive Windows or macOS alerts when long-running agent processes finish execution.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4 bg-slate-50 px-4 py-2 rounded-full ring-1 ring-slate-200/60 shadow-sm">
                  <span className={cx("text-[11px] font-bold uppercase tracking-widest", local.notifyOnTerminalCompletion ? "text-indigo-600" : "text-slate-400")}>
                    {notificationBusy ? "Working..." : local.notifyOnTerminalCompletion ? "ON" : "OFF"}
                  </span>
                  <ToggleSwitch
                    enabled={local.notifyOnTerminalCompletion}
                    onClick={toggleCompletionNotifications}
                    disabled={notificationBusy}
                  />
                </div>
              </div>
            </Panel>
          </div>

          <div style={stageStyle(mounted, 200)}>
            <Panel
              title="Advanced Execution Limits"
              description="Configure safety boundaries for agent operations to prevent runaway loops."
              icon={<CpuIcon />}
              action={
                <button
                  onClick={() => setShowAdvanced((value) => !value)}
                  className="rounded-full bg-white px-3.5 py-1.5 text-[12px] font-bold uppercase tracking-wider text-slate-600 ring-1 ring-inset ring-slate-200 shadow-sm hover:bg-slate-50 transition-colors"
                >
                  {showAdvanced ? "Hide Settings" : "Configure"}
                </button>
              }
            >
              {!showAdvanced ? (
                <div className="grid gap-4 p-6 sm:grid-cols-3">
                  <div className="bg-slate-50/80 rounded-xl p-4 ring-1 ring-slate-100">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-400">Max Turns / Agent</span>
                    <span className="font-mono text-[15px] font-medium text-slate-800">{formatLimit(local.maxTurnsPerAgent)}</span>
                  </div>
                  <div className="bg-slate-50/80 rounded-xl p-4 ring-1 ring-slate-100">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-400">Max Output Chars</span>
                    <span className="font-mono text-[15px] font-medium text-slate-800">{formatLimit(local.maxOutputCharsPerTurn)}</span>
                  </div>
                  <div className="bg-slate-50/80 rounded-xl p-4 ring-1 ring-slate-100">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-400">Process Timeout (ms)</span>
                    <span className="font-mono text-[15px] font-medium text-slate-800">{formatLimit(local.processTimeoutMs)}</span>
                  </div>
                </div>
              ) : (
                <div className="grid gap-6 p-6 sm:grid-cols-3 bg-indigo-50/30">
                  <div>
                    <FieldLabel>Max Turns / Agent</FieldLabel>
                    <div className="mt-2">
                      <input
                        type="number"
                        className={INPUT_CLASS}
                        value={local.maxTurnsPerAgent}
                        onChange={(event) =>
                          setLocal({
                            ...local,
                            maxTurnsPerAgent: Number.parseInt(event.target.value, 10) || 50,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Max Output Chars</FieldLabel>
                    <div className="mt-2">
                      <input
                        type="number"
                        className={INPUT_CLASS}
                        value={local.maxOutputCharsPerTurn}
                        onChange={(event) =>
                          setLocal({
                            ...local,
                            maxOutputCharsPerTurn: Number.parseInt(event.target.value, 10) || 100000,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Process Timeout (ms)</FieldLabel>
                    <div className="mt-2">
                      <input
                        type="number"
                        className={INPUT_CLASS}
                        value={local.processTimeoutMs}
                        onChange={(event) =>
                          setLocal({
                            ...local,
                            processTimeoutMs: Number.parseInt(event.target.value, 10) || 300000,
                          })
                        }
                      />
                    </div>
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
