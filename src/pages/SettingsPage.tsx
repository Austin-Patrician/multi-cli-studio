import { useEffect, useMemo, useState } from "react";
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

type Platform = (typeof PLATFORM_ORDER)[number];

const CLI_META: Record<AgentId, { label: string; tint: string; line: string; text: string }> = {
  codex: { label: "Codex", tint: "from-blue-50", line: "border-blue-200", text: "text-blue-700" },
  claude: { label: "Claude Code", tint: "from-amber-50", line: "border-amber-200", text: "text-amber-700" },
  gemini: { label: "Gemini CLI", tint: "from-emerald-50", line: "border-emerald-200", text: "text-emerald-700" },
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
    note: string;
    install: Record<Platform, string>;
    verify: string;
  }
> = {
  codex: {
    docs: "https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started",
    note: "Use the official Codex getting-started flow, then sign in on first launch.",
    install: {
      windows: "npm install -g @openai/codex",
      macos: "npm install -g @openai/codex",
      linux: "npm install -g @openai/codex",
    },
    verify: "codex --version",
  },
  claude: {
    docs: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
    note: "npm is the cleanest cross-platform path here; Anthropic also documents native installers.",
    install: {
      windows: "npm install -g @anthropic-ai/claude-code",
      macos: "curl -fsSL https://claude.ai/install.sh | bash",
      linux: "curl -fsSL https://claude.ai/install.sh | bash",
    },
    verify: "claude --version",
  },
  gemini: {
    docs: "https://github.com/google-gemini/gemini-cli",
    note: "Gemini CLI drives this app through ACP, so PATH visibility matters after install.",
    install: {
      windows: "npm install -g @google/gemini-cli",
      macos: "brew install gemini-cli",
      linux: "npm install -g @google/gemini-cli",
    },
    verify: "gemini --version",
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

function resourceSummary(resources: Pick<AgentRuntimeResources, "mcp" | "skill" | "plugin" | "extension">) {
  const parts = [
    resources.mcp.items.length ? `${resources.mcp.items.length} MCP` : null,
    resources.skill.items.length ? `${resources.skill.items.length} skill` : null,
    resources.plugin.items.length ? `${resources.plugin.items.length} plugin` : null,
    resources.extension.items.length ? `${resources.extension.items.length} extension` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" • ") : "No extra runtime surfaces detected";
}

export function SettingsPage() {
  const storedSettings = useStore((s) => s.settings);
  const appState = useStore((s) => s.appState);
  const updateSettings = useStore((s) => s.updateSettings);
  const setAppState = useStore((s) => s.setAppState);
  const [local, setLocal] = useState<AppSettings | null>(null);
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editingCli, setEditingCli] = useState<AgentId | null>(null);
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

  const agents = useMemo(
    () =>
      CLI_ORDER.map((cli) => {
        const agent = appState?.agents.find((item) => item.id === cli);
        return agent ?? {
          id: cli,
          label: CLI_META[cli].label,
          runtime: { installed: false, version: null, commandPath: null, lastError: null, resources: emptyResources() },
        };
      }),
    [appState]
  );
  const installedCount = agents.filter((agent) => agent.runtime.installed).length;
  const missingAgents = agents.filter((agent) => !agent.runtime.installed);
  const customPathCount = local ? CLI_ORDER.filter((cli) => local.cliPaths[cli] !== "auto").length : 0;
  const dirty = !!storedSettings && !!local && JSON.stringify(storedSettings) !== JSON.stringify(local);

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
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_28%),radial-gradient(circle_at_95%_10%,_rgba(16,185,129,0.1),_transparent_20%),linear-gradient(180deg,_#f8fafc_0%,_#ffffff_42%)] px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="overflow-hidden rounded-[34px] border border-slate-200/80 bg-white/88 px-6 py-7 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:px-8 lg:px-10" style={{ opacity: mounted ? 1 : 0, transform: mounted ? "none" : "translateY(16px)", transition: "all 650ms ease" }}>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_320px]">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">Runtime control center</span>
                <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">{PLATFORM_LABEL[platform]}</span>
                <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1">{missingAgents.length === 0 ? "All runtimes ready" : `${missingAgents.length} missing`}</span>
              </div>
              <h1 className="mt-6 max-w-4xl text-[44px] leading-[0.96] tracking-[-0.06em] text-slate-950 sm:text-[58px]" style={DISPLAY_FONT}>Detect, repair, and steer the local runtimes behind this workspace.</h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">Settings now leads with runtime health first. Codex, Claude Code, and Gemini CLI each get a dedicated lane with install guidance, verification commands, and manual path override when auto-detect is not enough.</p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button onClick={handleSave} disabled={saving} className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:bg-slate-700">{saving ? "Saving..." : dirty ? "Save changes" : "Saved state"}</button>
                <button onClick={refreshRuntime} disabled={refreshing} className="rounded-full border border-slate-200 bg-white/85 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white disabled:cursor-wait">{refreshing ? "Refreshing..." : "Refresh detection"}</button>
                <span className="text-sm text-slate-500">{dirty ? "Unsaved changes are staged locally." : "Local settings match the saved configuration."}</span>
              </div>
              {banner ? <div className="mt-5 inline-flex rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">{banner}</div> : null}
            </div>
            <div className="border-t border-slate-200 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">Runtime posture</div>
              <div className="mt-4 text-[92px] leading-none tracking-[-0.08em] text-slate-950 sm:text-[112px]" style={DISPLAY_FONT}>{installedCount}</div>
              <div className="mt-2 max-w-[16rem] text-sm leading-6 text-slate-500">of {CLI_ORDER.length} runtimes are currently detected on this machine.</div>
              <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
                <div className="border-t border-slate-200 pt-4"><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Missing</div><div className="mt-2 text-3xl tracking-[-0.05em] text-slate-950" style={DISPLAY_FONT}>{missingAgents.length}</div></div>
                <div className="border-t border-slate-200 pt-4"><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Custom paths</div><div className="mt-2 text-3xl tracking-[-0.05em] text-slate-950" style={DISPLAY_FONT}>{customPathCount}</div></div>
                <div className="border-t border-slate-200 pt-4"><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Backend</div><div className="mt-2 text-3xl tracking-[-0.05em] text-slate-950" style={DISPLAY_FONT}>{(appState?.environment.backend ?? "tauri").toUpperCase()}</div></div>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[30px] border border-slate-200/80 bg-white/84 shadow-[0_24px_60px_rgba(15,23,42,0.06)] backdrop-blur" style={{ opacity: mounted ? 1 : 0, transform: mounted ? "none" : "translateY(16px)", transition: "all 650ms ease 90ms" }}>
          <div className="border-b border-slate-200/80 px-6 py-5 sm:px-8"><div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Detected runtimes</div><h2 className="mt-3 text-[30px] tracking-[-0.05em] text-slate-950" style={DISPLAY_FONT}>Local CLI lanes</h2></div>
          <div className="divide-y divide-slate-200/80">
            {agents.map((agent) => {
              const cli = agent.id as AgentId;
              const guide = GUIDES[cli];
              const installCommand = guide.install[platform];
              const pathValue = local.cliPaths[cli];
              return (
                <article key={cli} className={`grid gap-5 bg-gradient-to-r ${CLI_META[cli].tint} via-white to-white px-6 py-6 sm:px-8 lg:grid-cols-[210px_minmax(0,1fr)_220px]`}>
                  <div>
                    <div className={`inline-flex rounded-full border ${CLI_META[cli].line} bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${CLI_META[cli].text}`}>{CLI_META[cli].label}</div>
                    <div className="mt-4 text-sm font-medium text-slate-800">{agent.runtime.installed ? "Detected" : "Missing"}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-500">{agent.runtime.installed ? "Version, path resolution, and runtime surfaces are already visible." : guide.note}</div>
                  </div>
                  <div className="grid gap-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-[20px] border border-slate-200 bg-white/80 px-4 py-4"><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Version</div><div className="mt-2 text-sm text-slate-800" style={DATA_FONT}>{agent.runtime.version ?? "Not detected"}</div></div>
                      <div className="rounded-[20px] border border-slate-200 bg-white/80 px-4 py-4"><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Path mode</div><div className="mt-2 text-sm text-slate-800">{pathValue === "auto" ? "Auto-detect" : "Custom path"}</div></div>
                      <div className="rounded-[20px] border border-slate-200 bg-white/80 px-4 py-4"><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Detected command</div><div className="mt-2 truncate text-sm text-slate-800" style={DATA_FONT}>{agent.runtime.commandPath ?? "No command resolved"}</div></div>
                    </div>
                    <div className="rounded-[22px] border border-slate-200 bg-white/84 px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm leading-6 text-slate-600">{agent.runtime.installed ? resourceSummary(agent.runtime.resources) : agent.runtime.lastError ?? "Waiting for install or a manual path."}</div>
                        <button onClick={() => setEditingCli(editingCli === cli ? null : cli)} className="rounded-full border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">{editingCli === cli ? "Hide path override" : "Edit path override"}</button>
                      </div>
                      {editingCli === cli ? <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><input className="rounded-[16px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-400" value={pathValue} onChange={(event) => setLocal({ ...local, cliPaths: { ...local.cliPaths, [cli]: event.target.value } })} placeholder="auto" /><button onClick={() => setLocal({ ...local, cliPaths: { ...local.cliPaths, [cli]: "auto" } })} className="rounded-full border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">Use auto</button></div> : null}
                      {!agent.runtime.installed ? <pre className="mt-4 overflow-x-auto rounded-[18px] bg-slate-950 px-4 py-4 text-sm text-slate-100" style={DATA_FONT}><code>{installCommand}</code></pre> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-start gap-3 lg:flex-col">
                    <a href={guide.docs} target="_blank" rel="noreferrer" className="rounded-full border border-slate-200 bg-white/90 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white">Open docs</a>
                    <button onClick={() => copyText(agent.runtime.installed ? guide.verify : installCommand, `${cli}-cmd`, `${CLI_META[cli].label} command`)} className="rounded-full border border-slate-200 bg-white/90 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white">{copied === `${cli}-cmd` ? "Copied" : agent.runtime.installed ? "Copy verify" : "Copy install"}</button>
                    <div className="text-xs leading-6 text-slate-500" style={DATA_FONT}>{agent.runtime.installed ? guide.verify : guide.docs}</div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="overflow-hidden rounded-[30px] border border-slate-200/80 bg-white/84 shadow-[0_24px_60px_rgba(15,23,42,0.06)] backdrop-blur" style={{ opacity: mounted ? 1 : 0, transform: mounted ? "none" : "translateY(16px)", transition: "all 650ms ease 180ms" }}>
          <div className="border-b border-slate-200/80 px-6 py-5 sm:px-8"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Install guidance</div><h2 className="mt-3 text-[30px] tracking-[-0.05em] text-slate-950" style={DISPLAY_FONT}>Official docs and command runbook</h2></div><div className="flex flex-wrap gap-2">{PLATFORM_ORDER.map((item) => <button key={item} onClick={() => setPlatform(item)} className={`rounded-full px-4 py-2 text-sm font-medium transition ${platform === item ? "bg-slate-950 text-white" : "border border-slate-200 bg-white/90 text-slate-600 hover:border-slate-300"}`}>{PLATFORM_LABEL[item]}</button>)}</div></div></div>
          <div className="grid gap-6 px-6 py-6 sm:px-8 xl:grid-cols-2">
            {(missingAgents.length ? missingAgents : agents).map((agent) => {
              const cli = agent.id as AgentId;
              const guide = GUIDES[cli];
              return (
                <div key={`${cli}-guide`} className="rounded-[24px] border border-slate-200 bg-white/92 p-5">
                  <div className={`text-sm font-semibold ${CLI_META[cli].text}`}>{CLI_META[cli].label}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-500">{guide.note}</div>
                  <pre className="mt-4 overflow-x-auto rounded-[18px] bg-slate-950 px-4 py-4 text-sm text-slate-100" style={DATA_FONT}><code>{missingAgents.length ? guide.install[platform] : guide.verify}</code></pre>
                  <div className="mt-4 flex flex-wrap gap-3"><button onClick={() => copyText(missingAgents.length ? guide.install[platform] : guide.verify, `${cli}-guide`, `${CLI_META[cli].label} guide command`)} className="rounded-full border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">{copied === `${cli}-guide` ? "Copied" : "Copy command"}</button><a href={guide.docs} target="_blank" rel="noreferrer" className="rounded-full border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">Official docs</a></div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="overflow-hidden rounded-[30px] border border-slate-200/80 bg-white/84 shadow-[0_24px_60px_rgba(15,23,42,0.06)] backdrop-blur" style={{ opacity: mounted ? 1 : 0, transform: mounted ? "none" : "translateY(16px)", transition: "all 650ms ease 270ms" }}>
          <button onClick={() => setAdvancedOpen((value) => !value)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left sm:px-8"><div><div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Advanced</div><h2 className="mt-3 text-[30px] tracking-[-0.05em] text-slate-950" style={DISPLAY_FONT}>Low-level limits and workspace defaults</h2></div><div className="text-sm text-slate-500">{advancedOpen ? "Collapse" : "Expand"}</div></button>
          {advancedOpen ? <div className="grid gap-6 border-t border-slate-200/80 px-6 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Project root</div><input className="mt-3 w-full rounded-[16px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-400" value={local.projectRoot} onChange={(event) => setLocal({ ...local, projectRoot: event.target.value })} /></div><div><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Max turns</div><input type="number" className="mt-3 w-full rounded-[16px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-400" style={DATA_FONT} value={local.maxTurnsPerAgent} onChange={(event) => setLocal({ ...local, maxTurnsPerAgent: Number.parseInt(event.target.value, 10) || 50 })} /></div><div><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Max output chars</div><input type="number" className="mt-3 w-full rounded-[16px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-400" style={DATA_FONT} value={local.maxOutputCharsPerTurn} onChange={(event) => setLocal({ ...local, maxOutputCharsPerTurn: Number.parseInt(event.target.value, 10) || 100000 })} /></div><div><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Timeout ms</div><input type="number" className="mt-3 w-full rounded-[16px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-slate-400" style={DATA_FONT} value={local.processTimeoutMs} onChange={(event) => setLocal({ ...local, processTimeoutMs: Number.parseInt(event.target.value, 10) || 300000 })} /></div></div><div className="rounded-[22px] border border-slate-200 bg-white/92 px-5 py-5 text-sm text-slate-600"><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">Environment</div><div className="mt-4 space-y-3"><div className="flex justify-between gap-3"><span>Backend</span><span className="font-medium text-slate-800">{appState?.environment.backend ?? "unknown"}</span></div><div className="flex justify-between gap-3"><span>Tauri ready</span><span className="font-medium text-slate-800">{appState?.environment.tauriReady ? "Yes" : "No"}</span></div><div className="flex justify-between gap-3"><span>Rust available</span><span className="font-medium text-slate-800">{appState?.environment.rustAvailable ? "Yes" : "No"}</span></div>{appState?.environment.notes.map((note) => <p key={note} className="border-t border-slate-200 pt-3 text-xs leading-6 text-slate-500">{note}</p>)}</div></div></div> : null}
        </section>
      </div>
    </div>
  );
}
