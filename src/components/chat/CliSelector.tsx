import { AgentId } from "../../lib/models";
import { useStore } from "../../lib/store";

const CLI_OPTIONS: { id: AgentId; label: string }[] = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
];

export function CliSelector() {
  const activeTerminalTabId = useStore((s) => s.activeTerminalTabId);
  const terminalTabs = useStore((s) => s.terminalTabs);
  const appState = useStore((s) => s.appState);
  const setTabSelectedCli = useStore((s) => s.setTabSelectedCli);

  const activeTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;
  const selectedCli = activeTab?.selectedCli ?? "codex";

  return (
    <div className="inline-flex min-w-0 items-center gap-1 rounded-full bg-[#f4f7fb]/90 p-0.5">
      {CLI_OPTIONS.map((opt) => {
        const isSelected = selectedCli === opt.id;
        const runtime = appState?.agents.find((a) => a.id === opt.id)?.runtime;
        const installed = runtime?.installed ?? false;

        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => activeTab && setTabSelectedCli(activeTab.id, opt.id)}
            className={`relative flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
              isSelected
                ? "bg-[#111827] text-white shadow-[0_10px_22px_rgba(15,23,42,0.16)]"
                : "text-secondary hover:bg-white hover:text-text"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                installed ? (isSelected ? "bg-emerald-300" : "bg-emerald-500") : "bg-rose-400"
              }`}
            />
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
