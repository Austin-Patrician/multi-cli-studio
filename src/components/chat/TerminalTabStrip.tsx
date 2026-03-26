import { useStore } from "../../lib/store";

export function TerminalTabStrip() {
  const terminalTabs = useStore((s) => s.terminalTabs);
  const workspaces = useStore((s) => s.workspaces);
  const activeTerminalTabId = useStore((s) => s.activeTerminalTabId);
  const setActiveTerminalTab = useStore((s) => s.setActiveTerminalTab);
  const closeTerminalTab = useStore((s) => s.closeTerminalTab);
  const openWorkspaceFolder = useStore((s) => s.openWorkspaceFolder);

  return (
    <div className="border-b border-border bg-[#f5f7fb]">
      <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto">
        {terminalTabs.map((tab) => {
          const workspace = workspaces.find((item) => item.id === tab.workspaceId);
          const isActive = tab.id === activeTerminalTabId;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTerminalTab(tab.id)}
              className={`group min-w-0 shrink-0 flex items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-colors ${
                isActive
                  ? "border-[#111827] bg-[#111827] text-white"
                  : "border-border bg-white text-text hover:border-[#b8c0cc]"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">
                    {workspace?.name ?? tab.title}
                  </span>
                  {tab.planMode && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        isActive ? "bg-white/12 text-white" : "bg-accent/10 text-accent"
                      }`}
                    >
                      PLAN
                    </span>
                  )}
                </div>
                <div className={`truncate text-[11px] ${isActive ? "text-white/70" : "text-muted"}`}>
                  {workspace?.rootPath ?? "Detached workspace"}
                </div>
              </div>
              {terminalTabs.length > 1 && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTerminalTab(tab.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      closeTerminalTab(tab.id);
                    }
                  }}
                  className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                    isActive ? "text-white/70 hover:bg-white/12 hover:text-white" : "text-muted hover:bg-surface hover:text-text"
                  }`}
                >
                  ×
                </span>
              )}
            </button>
          );
        })}

        <button
          onClick={() => void openWorkspaceFolder()}
          aria-label="Add terminal"
          title="Add terminal"
          className="shrink-0 rounded-2xl border border-dashed border-border bg-white p-2.5 text-secondary transition-colors hover:border-accent hover:text-accent"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </div>
  );
}
