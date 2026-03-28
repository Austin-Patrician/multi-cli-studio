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
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Conversation History</h2>
        <div className="ml-auto flex gap-1">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedAgent(a.id)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                selectedAgent === a.id
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 text-slate-500 hover:bg-slate-50"
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

      <div className="divide-y divide-slate-200 border-t border-slate-200">
        {turns.length === 0 ? (
          <p className="py-6 text-sm text-slate-500">No conversation history for {selectedAgent}.</p>
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
    <div className="py-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="capitalize">{turn.agentId}</span>
            <span>{turn.writeMode ? "write" : "read-only"}</span>
            <span>{turn.durationMs}ms</span>
            {turn.exitCode !== null && <span>exit: {turn.exitCode}</span>}
          </div>
          <p className="mt-1 text-sm text-slate-900">User: {turn.userPrompt}</p>
          <p className="mt-1 text-[13px] leading-6 text-slate-500">{turn.outputSummary}</p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 shrink-0 text-xs text-slate-500 transition-colors hover:text-slate-900"
        >
          {expanded ? "Collapse" : "Output"}
        </button>
      </div>
      {expanded && (
        <pre className="mt-3 max-h-80 overflow-y-auto overflow-x-auto rounded-[12px] border border-slate-200 bg-slate-50 p-3 text-xs font-mono whitespace-pre-wrap text-slate-600">
          {turn.rawOutput}
        </pre>
      )}
    </div>
  );
}
