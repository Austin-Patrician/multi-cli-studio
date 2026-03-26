import { useStore } from "../lib/store";
import { AgentId } from "../lib/models";

const AGENT_IDS: AgentId[] = ["codex", "claude", "gemini"];

export function AgentTabs() {
  const appState = useStore((s) => s.appState);
  const switchAgent = useStore((s) => s.switchAgent);

  if (!appState) return null;

  const activeAgent = appState.workspace.activeAgent;
  const writer = appState.workspace.currentWriter;

  return (
    <div className="flex items-center gap-1 border-b border-border px-4">
      {AGENT_IDS.map((id) => {
        const agent = appState.agents.find((a) => a.id === id);
        if (!agent) return null;
        const isActive = id === activeAgent;
        const statusColor =
          agent.status === "active" || agent.status === "ready"
            ? "bg-success"
            : agent.status === "busy"
              ? "bg-warning"
              : "bg-muted";

        return (
          <button
            key={id}
            onClick={() => switchAgent(id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm transition-colors border-b-2 -mb-px ${
              isActive
                ? "border-accent text-accent font-medium bg-accent/5"
                : "border-transparent text-secondary hover:text-text"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${statusColor}`} />
            {agent.label}
          </button>
        );
      })}
      <div className="ml-auto flex items-center gap-2 text-xs text-muted pr-2">
        <span>writer:</span>
        <span className="font-medium text-text">{writer}</span>
      </div>
    </div>
  );
}
