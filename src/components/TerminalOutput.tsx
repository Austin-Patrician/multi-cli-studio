import { useEffect, useRef } from "react";
import { useStore } from "../lib/store";
import { AgentId, TerminalLine } from "../lib/models";

const SPEAKER_COLORS: Record<string, string> = {
  system: "text-muted",
  user: "text-accent",
  codex: "text-blue-600",
  claude: "text-amber-600",
  gemini: "text-emerald-600",
};

export function TerminalOutput() {
  const appState = useStore((s) => s.appState);
  const feedRef = useRef<HTMLDivElement>(null);

  const activeAgent: AgentId = appState?.workspace.activeAgent ?? "codex";
  const lines: TerminalLine[] = appState?.terminalByAgent[activeAgent] ?? [];
  const isWriter = appState?.workspace.currentWriter === activeAgent;

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        className={`px-4 py-1.5 text-xs font-medium border-b border-border ${
          isWriter
            ? "bg-accent/5 text-accent"
            : "bg-surface text-secondary"
        }`}
      >
        {isWriter ? "Write mode — this agent can modify files" : "Read-only mode — planning and review only"}
      </div>

      <div
        ref={feedRef}
        className="flex-1 overflow-auto px-4 py-3 font-mono text-sm"
        role="log"
        aria-live="polite"
      >
        {lines.length === 0 ? (
          <p className="text-muted text-center py-8">No output yet. Send a prompt to get started.</p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="flex gap-3 py-1.5 border-b border-border/50 last:border-b-0">
              <span
                className={`shrink-0 w-16 text-right text-xs uppercase tracking-wide pt-0.5 ${
                  SPEAKER_COLORS[line.speaker] ?? "text-secondary"
                }`}
              >
                {line.speaker}
              </span>
              <div className="min-w-0 flex-1">
                <code className="whitespace-pre-wrap break-words text-text block">{line.content}</code>
                {line.time && (
                  <span className="text-xs text-muted">{line.time}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
