import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { AgentId, TerminalCliId } from "../../lib/models";
import { useStore } from "../../lib/store";
import openaiIcon from "../../media/svg/openai.svg";
import claudeIcon from "../../media/svg/claude-color.svg";
import geminiIcon from "../../media/svg/gemini-color.svg";

export const CLI_OPTIONS: { id: TerminalCliId; label: string; icon?: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "codex", label: "Codex", icon: openaiIcon },
  { id: "claude", label: "Claude", icon: claudeIcon },
  { id: "gemini", label: "Gemini", icon: geminiIcon },
];

export const CliSelector = memo(function CliSelector() {
  const activeTab = useStore(
    useShallow((state) => {
      const tab = state.terminalTabs.find((item) => item.id === state.activeTerminalTabId);
      return tab
        ? {
            id: tab.id,
            selectedCli: tab.selectedCli,
          }
        : null;
    })
  );
  const appState = useStore((s) => s.appState);
  const setTabSelectedCli = useStore((s) => s.setTabSelectedCli);

  const selectedCli = activeTab?.selectedCli ?? "codex";
  const selectedIndex = Math.max(
    0,
    CLI_OPTIONS.findIndex((option) => option.id === selectedCli)
  );

  return (
    <div className="relative inline-flex min-w-0 w-[208px] items-center rounded-[21px] border border-[#d9e1eb] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(243,247,251,0.94)_100%)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_22px_rgba(15,23,42,0.06)]">
      <span
        className="pointer-events-none absolute bottom-1 top-1 rounded-[16px] border border-white/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(247,250,252,0.96)_100%)] shadow-[0_10px_24px_rgba(15,23,42,0.10)] transition-transform duration-200 ease-out"
        style={{
          left: "4px",
          width: "calc((100% - 8px) / 4)",
          transform: `translateX(${selectedIndex * 100}%)`,
        }}
      />
      {CLI_OPTIONS.map((opt) => {
        const isSelected = selectedCli === opt.id;
        const runtime = opt.id === "auto" ? null : appState?.agents.find((a) => a.id === opt.id)?.runtime;
        const installed = runtime?.installed ?? false;

        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => activeTab && setTabSelectedCli(activeTab.id, opt.id)}
            title={
              opt.id === "auto"
                ? "Switch to Auto routing"
                : installed
                  ? opt.label
                  : `${opt.label} (not installed)`
            }
            aria-label={
              opt.id === "auto"
                ? "Switch to Auto routing"
                : installed
                  ? `Switch to ${opt.label}`
                  : `${opt.label} not installed`
            }
            className={`relative z-10 inline-flex h-9 flex-1 items-center justify-center rounded-[16px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
              isSelected
                ? "scale-[1.01]"
                : "opacity-[0.82] hover:bg-white/35 hover:opacity-100"
            }`}
          >
            {opt.id === "auto" ? (
              <span
                className={`text-[11px] font-semibold tracking-[0.02em] transition-all ${
                  isSelected ? "text-slate-900" : "text-slate-600"
                }`}
              >
                Auto
              </span>
            ) : (
              <img
                src={opt.icon}
                alt=""
                aria-hidden="true"
                className={`h-[17px] w-[17px] select-none object-contain transition-all ${
                  installed ? "" : "opacity-45 grayscale-[0.15]"
                } ${isSelected ? "scale-[1.06] opacity-100" : "opacity-80"}`}
              />
            )}
            <span
              className={`absolute bottom-[7px] right-[10px] h-1.5 w-1.5 rounded-full transition-colors ${
                opt.id === "auto"
                  ? isSelected
                    ? "bg-slate-900"
                    : "bg-slate-300"
                  : installed
                  ? isSelected
                    ? "bg-emerald-500"
                    : "bg-emerald-400/95"
                  : isSelected
                    ? "bg-rose-400"
                    : "bg-rose-300"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
});
