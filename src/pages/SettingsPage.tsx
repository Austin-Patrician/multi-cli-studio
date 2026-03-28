import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { bridge } from "../lib/bridge";
import { AgentId, AgentRuntimeResources, AppSettings } from "../lib/models";
import { useStore } from "../lib/store";

const CLI_ORDER = ["codex", "claude", "gemini"] as const;
const PLATFORM_ORDER = ["windows", "macos", "linux"] as const;

const DISPLAY_FONT = {
  fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
} as const;

const DATA_FONT = {
  fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
} as const;

const INPUT_CLASS =
  "mt-2 w-full rounded-[14px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-400";

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

const CLI_META: Record<AgentId, { label: string }> = {
  codex: { label: "Codex" },
  claude: { label: "Claude Code" },
  gemini: { label: "Gemini CLI" },
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
    transform: mounted ? "none" : "translateY(12px)",
    transition: `opacity 380ms ease ${delay}ms, transform 380ms ease ${delay}ms`,
  };
}

function runtimeTone(installed: boolean) {
  return installed ? "text-emerald-700" : "text-amber-700";
}

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-slate-950">{title}</h2>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function SettingLabel({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">{children}</div>;
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
  const statusText = banner ?? (dirty ? "Unsaved changes." : `${installedCount} of ${CLI_ORDER.length} runtimes ready.`);

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

  if (!local) {
    return <div className="p-6 text-muted">Loading runtime settings...</div>;
  }

  return (
    <div className="min-h-full bg-[linear-gradient(180deg,_#f5f5f4_0%,_#fafaf9_100%)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header
          className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between"
          style={stageStyle(mounted, 0)}
        >
          <div>
            <h1 className="text-[34px] tracking-[-0.05em] text-slate-950 sm:text-[40px]" style={DISPLAY_FONT}>
              Settings
            </h1>
            <p className="mt-2 text-sm text-slate-500">Paths and execution defaults.</p>
          </div>

          <div className="flex flex-col items-start gap-3 sm:items-end">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:bg-slate-700"
              >
                {saving ? "Saving..." : dirty ? "Save changes" : "Saved"}
              </button>
              <button
                onClick={refreshRuntime}
                disabled={refreshing}
                className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-wait"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="text-sm text-slate-500">{statusText}</div>
          </div>
        </header>

        <main
          className="mt-8 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.04)]"
          style={stageStyle(mounted, 60)}
        >
          <section className="px-6 py-6 sm:px-8">
            <SectionHeader
              title="CLI paths"
              action={
                <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                  {PLATFORM_ORDER.map((item) => (
                    <button
                      key={item}
                      onClick={() => setPlatform(item)}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                        platform === item ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {PLATFORM_LABEL[item]}
                    </button>
                  ))}
                </div>
              }
            />

            <div className="mt-6 divide-y divide-slate-200">
              {agents.map((agent) => {
                const cli = agent.id;
                const guide = GUIDES[cli];
                const pathValue = local.cliPaths[cli];

                return (
                  <div key={cli} className="grid gap-4 py-5 first:pt-0 last:pb-0 lg:grid-cols-[170px_minmax(0,1fr)]">
                    <div className="flex items-center justify-between gap-4 lg:block">
                      <div className="text-sm font-semibold text-slate-900">{CLI_META[cli].label}</div>
                      <div className={`mt-1 text-sm ${runtimeTone(agent.runtime.installed)}`}>
                        {agent.runtime.installed ? "Ready" : "Missing"}
                      </div>
                    </div>

                    <div className="grid gap-4">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_92px]">
                        <div>
                          <SettingLabel>Path</SettingLabel>
                          <input
                            className={INPUT_CLASS}
                            value={pathValue}
                            onChange={(event) =>
                              setLocal({
                                ...local,
                                cliPaths: { ...local.cliPaths, [cli]: event.target.value },
                              })
                            }
                            placeholder="auto"
                          />
                        </div>

                        <div className="sm:pt-[25px]">
                          <button
                            onClick={() =>
                              setLocal({
                                ...local,
                                cliPaths: { ...local.cliPaths, [cli]: "auto" },
                              })
                            }
                            className="w-full rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            Auto
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <SettingLabel>Version</SettingLabel>
                          <div className="mt-2 text-sm text-slate-700" style={DATA_FONT}>
                            {agent.runtime.version ?? "Not detected"}
                          </div>
                        </div>
                        <div>
                          <SettingLabel>Resolved command</SettingLabel>
                          <div className="mt-2 break-all text-sm text-slate-700" style={DATA_FONT}>
                            {agent.runtime.commandPath ?? "No command resolved"}
                          </div>
                        </div>
                      </div>

                      {!agent.runtime.installed ? (
                        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                          <span className="text-xs text-slate-500">Install</span>
                          <code className="break-all text-[13px] leading-6 text-slate-700" style={DATA_FONT}>
                            {guide.install[platform]}
                          </code>
                          <button
                            onClick={() => copyText(guide.install[platform], `${cli}-install`, `${CLI_META[cli].label} install command`)}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          >
                            {copied === `${cli}-install` ? "Copied" : "Copy"}
                          </button>
                          <a
                            href={guide.docs}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-medium text-slate-500 transition hover:text-slate-900"
                          >
                            Docs
                          </a>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="border-t border-slate-200 px-6 py-6 sm:px-8">
            <SectionHeader title="Workspace" />

            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div>
                <SettingLabel>Project root</SettingLabel>
                <input
                  className={INPUT_CLASS}
                  value={local.projectRoot}
                  onChange={(event) => setLocal({ ...local, projectRoot: event.target.value })}
                />
              </div>

              <dl className="grid gap-3 text-sm text-slate-500 lg:pt-[25px]">
                <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2">
                  <dt>Backend</dt>
                  <dd className="font-medium text-slate-900">{(appState?.environment.backend ?? "unknown").toUpperCase()}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt>Branch</dt>
                  <dd className="font-medium text-slate-900">{appState?.workspace.branch ?? "workspace"}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="border-t border-slate-200 px-6 py-6 sm:px-8">
            <SectionHeader title="Limits" />

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div>
                <SettingLabel>Max turns</SettingLabel>
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
                <SettingLabel>Max output chars</SettingLabel>
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
                <SettingLabel>Timeout ms</SettingLabel>
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
          </section>

          <section className="border-t border-slate-200 px-6 py-6 sm:px-8">
            <SectionHeader title="Environment" />

            <dl className="mt-6 divide-y divide-slate-100 text-sm">
              <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
                <dt className="text-slate-500">Tauri ready</dt>
                <dd className="font-medium text-slate-900">{appState?.environment.tauriReady ? "Yes" : "No"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
                <dt className="text-slate-500">Rust available</dt>
                <dd className="font-medium text-slate-900">{appState?.environment.rustAvailable ? "Yes" : "No"}</dd>
              </div>
            </dl>

            {(appState?.environment.notes ?? []).length ? (
              <div className="mt-4 space-y-2 text-sm leading-6 text-slate-500">
                {appState?.environment.notes.map((note) => <p key={note}>{note}</p>)}
              </div>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  );
}
