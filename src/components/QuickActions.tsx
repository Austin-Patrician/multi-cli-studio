import { useStore } from "../lib/store";
import { AgentId } from "../lib/models";

const AGENTS: { id: AgentId; label: string }[] = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
];

export function QuickActions() {
  const appState = useStore((s) => s.appState);
  const busyAction = useStore((s) => s.busyAction);
  const takeOverWriter = useStore((s) => s.takeOverWriter);
  const snapshotWorkspace = useStore((s) => s.snapshotWorkspace);
  const runChecks = useStore((s) => s.runChecks);

  const isBusy = busyAction !== null;
  const currentWriter = appState?.workspace.currentWriter;

  return (
    <div>
      <h2 className="text-sm font-semibold text-text mb-3">Quick Actions</h2>
      <div className="border border-border rounded-[8px] bg-bg p-4 space-y-3">
        <div className="flex gap-2">
          <button
            onClick={snapshotWorkspace}
            disabled={isBusy}
            className="flex-1 px-3 py-2 text-sm border border-border rounded-[8px] text-secondary hover:text-text hover:bg-surface disabled:opacity-50 disabled:cursor-default transition-colors"
          >
            Snapshot Workspace
          </button>
          <button
            onClick={runChecks}
            disabled={isBusy}
            className="flex-1 px-3 py-2 text-sm border border-border rounded-[8px] text-secondary hover:text-text hover:bg-surface disabled:opacity-50 disabled:cursor-default transition-colors"
          >
            Run Checks
          </button>
        </div>

        <div>
          <p className="text-xs text-muted mb-2">Switch Writer To</p>
          <div className="flex gap-2">
            {AGENTS.map((agent) => (
              <button
                key={agent.id}
                onClick={() => takeOverWriter(agent.id)}
                disabled={isBusy || agent.id === currentWriter}
                className={`flex-1 px-3 py-2 text-sm rounded-[8px] transition-colors disabled:opacity-50 disabled:cursor-default ${
                  agent.id === currentWriter
                    ? "bg-accent/10 text-accent border border-accent/30 font-medium"
                    : "border border-border text-secondary hover:text-text hover:bg-surface"
                }`}
              >
                {agent.label}
                {agent.id === currentWriter && " (active)"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
