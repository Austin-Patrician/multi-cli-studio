import { AgentCard } from "../lib/models";
import { useStore } from "../lib/store";

interface Props {
  agent: AgentCard;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-success",
  ready: "bg-success",
  busy: "bg-warning",
  offline: "bg-muted",
};

export function AgentStatusCard({ agent }: Props) {
  const appState = useStore((s) => s.appState);
  const isWriter = appState?.workspace.currentWriter === agent.id;

  return (
    <div className="border border-border rounded-[8px] p-4 bg-bg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${STATUS_COLORS[agent.status] ?? "bg-muted"}`} />
          <span className="font-medium text-sm text-text">{agent.label}</span>
          {isWriter && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium">
              writer
            </span>
          )}
        </div>
        <span className="text-xs text-muted capitalize">{agent.status}</span>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted">Mode</span>
          <span className="text-secondary capitalize">{agent.mode}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Specialty</span>
          <span className="text-secondary truncate ml-4 text-right">{agent.specialty}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Runtime</span>
          <span className="text-secondary">
            {agent.runtime.installed
              ? agent.runtime.version ?? "installed"
              : "missing"}
          </span>
        </div>
      </div>

      <p className="text-xs text-muted mt-3 leading-relaxed">{agent.summary}</p>
    </div>
  );
}
