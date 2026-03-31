import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { bridge } from "../lib/bridge";
import { AgentId, AgentRuntimeResources, AppSettings } from "../lib/models";
import { useStore } from "../lib/store";
import { requestDesktopNotificationPermission } from "../lib/desktopNotifications";

const CLI_ORDER = ["codex", "claude", "gemini"] as const;
const PLATFORM_ORDER = ["windows", "macos", "linux"] as const;

const TITLE_FONT = {
  fontFamily: '"IBM Plex Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
} as const;

const DATA_FONT = TITLE_FONT;

const INPUT_CLASS =
  "mt-3 w-full rounded-[16px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/50 focus:bg-white/[0.07]";

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

const CLI_META: Record<
  AgentId,
  {
    label: string;
    prompt: string;
  }
> = {
  codex: { label: "Codex", prompt: "runtime.codex" },
  claude: { label: "Claude Code", prompt: "runtime.claude" },
  gemini: { label: "Gemini CLI", prompt: "runtime.gemini" },
};

const PLATFORM_LABEL: Record<Platform, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
};

const GUIDES: Record<
  AgentId,
  {
    docs: string;
    install: Record<Platform, string>;
  }
> = {
  codex: {
    docs: "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
    install: {
      windows: "npm install -g @openai/codex",
      macos: "npm install -g @openai/codex",
      linux: "npm install -g @openai/codex",
    },
  },
  claude: {
    docs: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
    install: {
      windows: "npm install -g @anthropic-ai/claude-code",
      macos: "curl -fsSL https://claude.ai/install.sh | bash",
      linux: "curl -fsSL https://claude.ai/install.sh | bash",
    },
  },
  gemini: {
    docs: "https://github.com/google-gemini/gemini-cli",
    install: {
      windows: "npm install -g @google/gemini-cli",
      macos: "brew install gemini-cli",
      linux: "npm install -g @google/gemini-cli",
    },
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
    runtime: {
      installed: false,
      version: null,
      commandPath: null,
      lastError: null,
      resources: emptyResources(),
    },
  };
}

function stageStyle(mounted: boolean, delay: number): CSSProperties {
  return {
    opacity: mounted ? 1 : 0,
    transform: mounted ? "none" : "translateY(14px)",
    transition: `opacity 360ms ease ${delay}ms, transform 360ms ease ${delay}ms`,
  };
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatLimit(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function Panel({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-900/75 bg-[#0b0f19] text-slate-100 shadow-[0_22px_70px_rgba(2,6,23,0.18)]">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
        <div className="ml-3 text-[11px] uppercase tracking-[0.34em] text-slate-500" style={DATA_FONT}>
          {eyebrow}
        </div>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>

      <div className="px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold uppercase tracking-[0.18em] text-slate-100" style={TITLE_FONT}>
              {title}
            </h2>
            {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{description}</p> : null}
          </div>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}

function MetaChip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "ready" | "warn" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.22em]",
        tone === "ready" && "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
        tone === "warn" && "border-amber-400/25 bg-amber-300/10 text-amber-100",
        tone === "default" && "border-white/10 bg-white/[0.03] text-slate-300"
      )}
      style={DATA_FONT}
    >
      {children}
    </span>
  );
}

function CodeValue({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-slate-200",
        className
      )}
      style={DATA_FONT}
    >
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500" style={DATA_FONT}>
      {children}
    </div>
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
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "rounded-full px-4 py-2.5 text-sm font-medium transition disabled:cursor-wait disabled:opacity-60",
        variant === "primary" &&
          "bg-slate-950 text-white hover:bg-slate-800 shadow-[0_14px_24px_rgba(15,23,42,0.16)]",
        variant === "secondary" &&
          "border border-slate-300/80 bg-white/80 text-slate-700 hover:border-slate-400 hover:bg-white"
      )}
    >
      {children}
    </button>
  );
}

function ToggleSwitch({
  enabled,
  onClick,
  disabled,
}: {
  enabled: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={enabled}
      className={cx(
        "relative inline-flex h-8 w-14 items-center rounded-full border transition disabled:cursor-wait disabled:opacity-60",
        enabled
          ? "border-cyan-400/50 bg-cyan-400/20"
          : "border-white/10 bg-white/[0.04]"
      )}
    >
      <span
        className={cx(
          "inline-block h-5 w-5 rounded-full bg-white shadow-[0_4px_12px_rgba(15,23,42,0.35)] transition",
          enabled ? "translate-x-8" : "translate-x-1"
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
    }, 1800);
    return () => window.clearTimeout(id);
  }, [banner, copied]);

  const agents = CLI_ORDER.map((cli) => {
    const agent = appState?.agents.find((item) => item.id === cli);
    return (agent ? { id: agent.id, runtime: agent.runtime } : fallbackAgent(cli)) as SettingsAgent;
  });

  const installedCount = agents.filter((agent) => agent.runtime.installed).length;
  const dirty = !!storedSettings && !!local && JSON.stringify(storedSettings) !== JSON.stringify(local);
  const runtimeSummary = `${installedCount}/${CLI_ORDER.length} runtimes ready on ${PLATFORM_LABEL[platform]}.`;
  const statusText = banner ?? (dirty ? "Unsaved changes." : runtimeSummary);
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
    return <div className="p-6 text-muted">Loading runtime settings...</div>;
  }

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.14),_transparent_34%),linear-gradient(180deg,_#f6f3eb_0%,_#fbfaf6_46%,_#f4efe7_100%)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="relative" style={stageStyle(mounted, 0)}>
          <div className="absolute left-0 top-0 h-28 w-28 rounded-full bg-cyan-200/30 blur-3xl" aria-hidden />
          <div className="relative">
            <div className="inline-flex rounded-full border border-slate-300/70 bg-white/70 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-slate-500 backdrop-blur">
              settings.ts
            </div>

            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-[30px] font-semibold tracking-[-0.06em] text-slate-950 sm:text-[38px]" style={TITLE_FONT}>
                  Runtime Settings
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                  Auto-detect what exists on this machine, keep the workspace root editable, and move the actual runtime caps into a quieter advanced block.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <ActionButton onClick={refreshRuntime} disabled={refreshing}>
                  {refreshing ? "Refreshing..." : "Refresh"}
                </ActionButton>
                <ActionButton onClick={handleSave} disabled={saving || !dirty} variant="primary">
                  {saving ? "Saving..." : dirty ? "Save changes" : "Saved"}
                </ActionButton>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <MetaChip>{PLATFORM_LABEL[platform]}</MetaChip>
              <MetaChip>{branch}</MetaChip>
              <MetaChip tone={dirty ? "warn" : "ready"}>{dirty ? "Pending save" : "Synced"}</MetaChip>
            </div>

            <div className="mt-4 max-w-2xl rounded-[18px] border border-slate-300/80 bg-white/75 px-4 py-3 text-sm text-slate-600 backdrop-blur">
              {statusText}
            </div>
          </div>
        </header>

        <main className="mt-8 space-y-6">
          <div style={stageStyle(mounted, 50)}>
            <Panel
              eyebrow="runtime.detect()"
              title="CLI Runtime Snapshot"
              description="Only the current machine matters here. Each runtime is checked as installed or missing, with the resolved command and version shown inline."
              action={<MetaChip>{PLATFORM_LABEL[platform]}</MetaChip>}
            >
              <div className="space-y-4">
                {agents.map((agent, index) => {
                  const cli = agent.id;
                  const guide = GUIDES[cli];
                  const missing = !agent.runtime.installed;
                  const installCommand = guide.install[platform];

                  return (
                    <article
                      key={cli}
                      className={cx(
                        "rounded-[18px] border px-4 py-4 sm:px-5",
                        missing ? "border-amber-300/20 bg-amber-200/[0.05]" : "border-white/10 bg-white/[0.03]"
                      )}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-100">{CLI_META[cli].label}</span>
                            <MetaChip tone={missing ? "warn" : "ready"}>{missing ? "Not installed" : "Installed"}</MetaChip>
                          </div>
                          <div className="mt-2 text-[11px] uppercase tracking-[0.26em] text-slate-500" style={DATA_FONT}>
                            {CLI_META[cli].prompt}
                          </div>
                        </div>

                        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500" style={DATA_FONT}>
                          line {index + 1}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div>
                          <FieldLabel>version</FieldLabel>
                          <CodeValue className="mt-2">{agent.runtime.version ?? (missing ? "not installed" : "not detected")}</CodeValue>
                        </div>
                        <div>
                          <FieldLabel>resolved_command</FieldLabel>
                          <CodeValue className="mt-2 break-all">
                            {agent.runtime.commandPath ?? (missing ? "not resolved" : "awaiting refresh")}
                          </CodeValue>
                        </div>
                      </div>

                      {agent.runtime.lastError ? (
                        <div className="mt-3">
                          <FieldLabel>last_error</FieldLabel>
                          <CodeValue className="mt-2 break-all text-amber-100">{agent.runtime.lastError}</CodeValue>
                        </div>
                      ) : null}

                      {missing ? (
                        <div className="mt-4 border-t border-white/10 pt-4">
                          <FieldLabel>install_command</FieldLabel>
                          <CodeValue className="mt-2 break-all text-slate-100">{installCommand}</CodeValue>
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <button
                              onClick={() => copyText(installCommand, `${cli}-install`, `${CLI_META[cli].label} install command`)}
                              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/[0.08]"
                            >
                              {copied === `${cli}-install` ? "Copied" : "Copy install"}
                            </button>
                            <a
                              href={guide.docs}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-medium text-cyan-200 transition hover:text-cyan-100"
                            >
                              Open docs
                            </a>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </Panel>
          </div>

          <div style={stageStyle(mounted, 110)}>
            <Panel
              eyebrow="workspace.root"
              title="Workspace"
              description="This is the only editable project pointer kept in the main view."
            >
              <div className="space-y-4">
                <div>
                  <FieldLabel>project_root</FieldLabel>
                  <input
                    className={INPUT_CLASS}
                    style={DATA_FONT}
                    value={local.projectRoot}
                    onChange={(event) => setLocal({ ...local, projectRoot: event.target.value })}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <FieldLabel>branch</FieldLabel>
                    <CodeValue className="mt-2">{branch}</CodeValue>
                  </div>
                  <div>
                    <FieldLabel>runtime_status</FieldLabel>
                    <CodeValue className="mt-2">{runtimeSummary}</CodeValue>
                  </div>
                </div>
              </div>
            </Panel>
          </div>

          <div style={stageStyle(mounted, 150)}>
            <Panel
              eyebrow="alerts.desktop"
              title="Desktop Alerts"
              description="Send a native OS notification when a terminal reply finishes. In desktop builds this uses the system notification center; browser preview falls back to web notifications when available."
            >
              <div className="flex flex-col gap-4 rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <FieldLabel>notify_on_terminal_completion</FieldLabel>
                    <MetaChip tone={local.notifyOnTerminalCompletion ? "ready" : "default"}>
                      {local.notifyOnTerminalCompletion ? "Enabled" : "Disabled"}
                    </MetaChip>
                  </div>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
                    Turn this on if you want a Windows/macOS notification when Codex, Claude, or Gemini finishes responding in the terminal.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500" style={DATA_FONT}>
                    {notificationBusy ? "requesting" : local.notifyOnTerminalCompletion ? "on" : "off"}
                  </div>
                  <ToggleSwitch
                    enabled={local.notifyOnTerminalCompletion}
                    onClick={toggleCompletionNotifications}
                    disabled={notificationBusy}
                  />
                </div>
              </div>
            </Panel>
          </div>

          <div style={stageStyle(mounted, 190)}>
            <Panel
              eyebrow="advanced.runtime"
              title="Advanced Limits"
              description="These values still affect runtime behavior, so they stay available, but they do not need primary emphasis."
              action={
                <button
                  onClick={() => setShowAdvanced((value) => !value)}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-slate-300 transition hover:bg-white/[0.08]"
                  style={DATA_FONT}
                >
                  {showAdvanced ? "Collapse" : "Expand"}
                </button>
              }
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <FieldLabel>max_turns</FieldLabel>
                  <CodeValue className="mt-2">{formatLimit(local.maxTurnsPerAgent)}</CodeValue>
                </div>
                <div>
                  <FieldLabel>max_output_chars</FieldLabel>
                  <CodeValue className="mt-2">{formatLimit(local.maxOutputCharsPerTurn)}</CodeValue>
                </div>
                <div>
                  <FieldLabel>process_timeout_ms</FieldLabel>
                  <CodeValue className="mt-2">{formatLimit(local.processTimeoutMs)}</CodeValue>
                </div>
              </div>

              {showAdvanced ? (
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <div>
                    <FieldLabel>max_turns</FieldLabel>
                    <input
                      type="number"
                      className={INPUT_CLASS}
                      style={DATA_FONT}
                      value={local.maxTurnsPerAgent}
                      onChange={(event) =>
                        setLocal({
                          ...local,
                          maxTurnsPerAgent: Number.parseInt(event.target.value, 10) || 50,
                        })
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel>max_output_chars</FieldLabel>
                    <input
                      type="number"
                      className={INPUT_CLASS}
                      style={DATA_FONT}
                      value={local.maxOutputCharsPerTurn}
                      onChange={(event) =>
                        setLocal({
                          ...local,
                          maxOutputCharsPerTurn: Number.parseInt(event.target.value, 10) || 100000,
                        })
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel>process_timeout_ms</FieldLabel>
                    <input
                      type="number"
                      className={INPUT_CLASS}
                      style={DATA_FONT}
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
              ) : null}
            </Panel>
          </div>
        </main>
      </div>
    </div>
  );
}
