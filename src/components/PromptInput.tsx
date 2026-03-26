import { useState } from "react";
import { useStore } from "../lib/store";

export function PromptInput() {
  const [prompt, setPrompt] = useState("");
  const appState = useStore((s) => s.appState);
  const busyAction = useStore((s) => s.busyAction);
  const submitPrompt = useStore((s) => s.submitPrompt);
  const snapshotWorkspace = useStore((s) => s.snapshotWorkspace);
  const runChecks = useStore((s) => s.runChecks);

  const activeAgent = appState?.workspace.activeAgent ?? "codex";
  const agentLabel = appState?.agents.find((a) => a.id === activeAgent)?.label ?? activeAgent;
  const isBusy = busyAction !== null;

  async function handleSubmit() {
    const text = prompt.trim();
    if (!text) return;
    setPrompt("");
    await submitPrompt(activeAgent, text);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-muted">
          Sending to <span className="font-medium text-text">{agentLabel}</span>
        </span>
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 px-3 py-2 text-sm border border-border rounded-[8px] bg-bg text-text placeholder:text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          placeholder={`Send a prompt to ${agentLabel}...`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isBusy}
        />
        <button
          onClick={snapshotWorkspace}
          disabled={isBusy}
          className="px-3 py-2 text-sm border border-border rounded-[8px] text-secondary hover:text-text hover:bg-surface disabled:opacity-50 disabled:cursor-default transition-colors"
        >
          Snapshot
        </button>
        <button
          onClick={runChecks}
          disabled={isBusy}
          className="px-3 py-2 text-sm border border-border rounded-[8px] text-secondary hover:text-text hover:bg-surface disabled:opacity-50 disabled:cursor-default transition-colors"
        >
          Run Checks
        </button>
        <button
          onClick={handleSubmit}
          disabled={isBusy || !prompt.trim()}
          className="px-4 py-2 text-sm bg-accent text-white rounded-[8px] hover:bg-accent/90 disabled:opacity-50 disabled:cursor-default transition-colors font-medium"
        >
          Send
        </button>
      </div>
    </div>
  );
}
