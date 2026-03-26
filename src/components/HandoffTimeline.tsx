import { useState } from "react";
import { EnrichedHandoff } from "../lib/models";

interface Props {
  handoffs: EnrichedHandoff[];
}

export function HandoffTimeline({ handoffs }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (handoffs.length === 0) {
    return <p className="text-sm text-muted py-4">No handoffs recorded yet.</p>;
  }

  return (
    <div className="border border-border rounded-[8px] bg-bg divide-y divide-border">
      {handoffs.map((handoff) => {
        const isExpanded = expandedId === handoff.id;
        return (
          <div key={handoff.id}>
            <button
              onClick={() => setExpandedId(isExpanded ? null : handoff.id)}
              className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-surface transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${
                  handoff.status === "completed" ? "bg-success" : handoff.status === "ready" ? "bg-accent" : "bg-muted"
                }`} />
                <span className="text-sm font-medium text-text">
                  {handoff.from} → {handoff.to}
                </span>
                <span className="text-xs text-muted capitalize">{handoff.status}</span>
              </div>
              <span className="text-xs text-muted">
                {new Date(handoff.timestamp).toLocaleString()}
              </span>
            </button>
            {isExpanded && (
              <HandoffDetail handoff={handoff} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function HandoffDetail({ handoff }: { handoff: EnrichedHandoff }) {
  return (
    <div className="px-4 pb-4 space-y-4">
      <div>
        <p className="text-xs text-muted uppercase tracking-wider mb-1">Goal</p>
        <p className="text-sm text-text">{handoff.userGoal}</p>
      </div>

      {handoff.changedFiles.length > 0 && (
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Changed Files</p>
          <div className="flex flex-wrap gap-1">
            {handoff.changedFiles.map((file) => (
              <span key={file} className="text-xs px-2 py-0.5 bg-surface rounded text-secondary font-mono">
                {file}
              </span>
            ))}
          </div>
        </div>
      )}

      {handoff.gitDiff && (
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Git Diff</p>
          <pre className="text-xs font-mono bg-surface rounded-[8px] p-3 overflow-x-auto text-secondary whitespace-pre-wrap">
            {handoff.gitDiff}
          </pre>
        </div>
      )}

      {handoff.previousTurns.length > 0 && (
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">
            Previous Turns ({handoff.previousTurns.length})
          </p>
          <div className="space-y-2">
            {handoff.previousTurns.map((turn) => (
              <ConversationTurnCard key={turn.id} turn={turn} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { ConversationTurn } from "../lib/models";

function ConversationTurnCard({ turn }: { turn: ConversationTurn }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-[8px] p-3 bg-bg">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            {turn.agentId} · {turn.writeMode ? "write" : "read-only"} · {turn.durationMs}ms
          </p>
          <p className="text-sm text-text mt-1 truncate">User: {turn.userPrompt}</p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-accent shrink-0"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      <p className="text-xs text-secondary mt-1">{turn.outputSummary}</p>
      {expanded && (
        <pre className="text-xs font-mono bg-surface rounded p-2 mt-2 overflow-x-auto whitespace-pre-wrap text-secondary max-h-60 overflow-y-auto">
          {turn.rawOutput}
        </pre>
      )}
    </div>
  );
}
