import { useState } from "react";
import { useStore } from "../lib/store";
import { AgentId, ConversationTurn } from "../lib/models";

const AGENTS: { id: AgentId; label: string }[] = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
];

export function ConversationHistory() {
  const contextStore = useStore((s) => s.contextStore);
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("codex");

  const turns = contextStore?.agents[selectedAgent]?.conversationHistory ?? [];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-text">Conversation History</h2>
        <div className="flex gap-1 ml-auto">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedAgent(a.id)}
              className={`px-2.5 py-1 text-xs rounded-[8px] transition-colors ${
                selectedAgent === a.id
                  ? "bg-accent text-white"
                  : "text-secondary hover:bg-surface border border-border"
              }`}
            >
              {a.label}
              {contextStore?.agents[a.id]?.conversationHistory.length
                ? ` (${contextStore.agents[a.id].conversationHistory.length})`
                : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-border rounded-[8px] bg-bg divide-y divide-border">
        {turns.length === 0 ? (
          <p className="p-4 text-sm text-muted">No conversation history for {selectedAgent}.</p>
        ) : (
          turns.map((turn) => <TurnRow key={turn.id} turn={turn} />)
        )}
      </div>
    </div>
  );
}

function TurnRow({ turn }: { turn: ConversationTurn }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="capitalize">{turn.agentId}</span>
            <span>{turn.writeMode ? "write" : "read-only"}</span>
            <span>{turn.durationMs}ms</span>
            {turn.exitCode !== null && <span>exit: {turn.exitCode}</span>}
          </div>
          <p className="text-sm text-text mt-1">User: {turn.userPrompt}</p>
          <p className="text-xs text-secondary mt-1">{turn.outputSummary}</p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-accent shrink-0 mt-1"
        >
          {expanded ? "Collapse" : "Full output"}
        </button>
      </div>
      {expanded && (
        <pre className="text-xs font-mono bg-surface rounded-[8px] p-3 mt-2 overflow-x-auto whitespace-pre-wrap text-secondary max-h-80 overflow-y-auto">
          {turn.rawOutput}
        </pre>
      )}
    </div>
  );
}
