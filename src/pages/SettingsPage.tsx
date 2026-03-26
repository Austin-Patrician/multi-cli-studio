import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { AppSettings } from "../lib/models";

export function SettingsPage() {
  const storedSettings = useStore((s) => s.settings);
  const appState = useStore((s) => s.appState);
  const updateSettings = useStore((s) => s.updateSettings);
  const [local, setLocal] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (storedSettings) {
      setLocal({ ...storedSettings });
    }
  }, [storedSettings]);

  function handleSave() {
    if (!local) return;
    updateSettings(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!local) {
    return (
      <div className="p-6 text-muted">Loading settings...</div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text">Settings</h1>
        <button
          onClick={handleSave}
          className="px-4 py-2 text-sm bg-accent text-white rounded-[8px] hover:bg-accent/90 transition-colors font-medium"
        >
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </div>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-text mb-3">CLI Paths</h2>
        <p className="text-xs text-muted mb-3">Set to "auto" for automatic detection, or provide a full path.</p>
        <div className="space-y-3">
          {(["codex", "claude", "gemini"] as const).map((cli) => (
            <div key={cli} className="flex items-center gap-3">
              <label className="w-20 text-sm text-secondary capitalize">{cli}</label>
              <input
                className="flex-1 px-3 py-2 text-sm border border-border rounded-[8px] bg-bg text-text focus:outline-none focus:border-accent"
                value={local.cliPaths[cli]}
                onChange={(e) =>
                  setLocal({
                    ...local,
                    cliPaths: { ...local.cliPaths, [cli]: e.target.value },
                  })
                }
              />
              <span className="text-xs text-muted w-20">
                {appState?.agents.find((a) => a.id === cli)?.runtime.installed
                  ? "found"
                  : "missing"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-text mb-3">Project</h2>
        <div className="flex items-center gap-3">
          <label className="w-24 text-sm text-secondary">Root</label>
          <input
            className="flex-1 px-3 py-2 text-sm border border-border rounded-[8px] bg-bg text-text focus:outline-none focus:border-accent"
            value={local.projectRoot}
            onChange={(e) => setLocal({ ...local, projectRoot: e.target.value })}
          />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-text mb-3">Context Limits</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="w-48 text-sm text-secondary">Max conversation turns</label>
            <input
              type="number"
              className="w-24 px-3 py-2 text-sm border border-border rounded-[8px] bg-bg text-text focus:outline-none focus:border-accent"
              value={local.maxTurnsPerAgent}
              onChange={(e) => setLocal({ ...local, maxTurnsPerAgent: parseInt(e.target.value) || 50 })}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-48 text-sm text-secondary">Max output chars/turn</label>
            <input
              type="number"
              className="w-24 px-3 py-2 text-sm border border-border rounded-[8px] bg-bg text-text focus:outline-none focus:border-accent"
              value={local.maxOutputCharsPerTurn}
              onChange={(e) => setLocal({ ...local, maxOutputCharsPerTurn: parseInt(e.target.value) || 100000 })}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-48 text-sm text-secondary">Process timeout (ms)</label>
            <input
              type="number"
              className="w-24 px-3 py-2 text-sm border border-border rounded-[8px] bg-bg text-text focus:outline-none focus:border-accent"
              value={local.processTimeoutMs}
              onChange={(e) => setLocal({ ...local, processTimeoutMs: parseInt(e.target.value) || 300000 })}
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-text mb-3">Environment</h2>
        <div className="border border-border rounded-[8px] bg-bg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Backend</span>
            <span className="text-secondary">{appState?.environment.backend ?? "unknown"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Tauri Ready</span>
            <span className="text-secondary">{appState?.environment.tauriReady ? "Yes" : "No"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Rust Available</span>
            <span className="text-secondary">{appState?.environment.rustAvailable ? "Yes" : "No"}</span>
          </div>
          {appState?.environment.notes.map((note, i) => (
            <p key={i} className="text-xs text-muted">{note}</p>
          ))}
        </div>
      </section>
    </div>
  );
}
