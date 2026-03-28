import { useEffect, useRef, useState } from "react";
import { useStore } from "../../lib/store";

export function TerminalTabStrip() {
  const terminalTabs = useStore((s) => s.terminalTabs);
  const workspaces = useStore((s) => s.workspaces);
  const activeTerminalTabId = useStore((s) => s.activeTerminalTabId);
  const setActiveTerminalTab = useStore((s) => s.setActiveTerminalTab);
  const closeTerminalTab = useStore((s) => s.closeTerminalTab);
  const openWorkspaceFolder = useStore((s) => s.openWorkspaceFolder);
  const cloneTerminalTab = useStore((s) => s.cloneTerminalTab);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;
  const canCloneActiveTab = !!activeTab && activeTab.status !== "streaming";

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  async function handleOpenWorkspaceFolder() {
    setMenuOpen(false);
    await openWorkspaceFolder();
  }

  function handleCloneActiveTab() {
    if (!canCloneActiveTab) return;
    setMenuOpen(false);
    cloneTerminalTab(activeTerminalTabId ?? undefined);
  }

  return (
    <div className="border-b border-border bg-[#f5f7fb]">
      <div className="flex items-center px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <div className="overflow-x-auto pr-2">
            <div className="flex min-w-max items-center gap-2 pr-1">
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
                        <span className="truncate text-sm font-semibold">{tab.title}</span>
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
                          isActive
                            ? "text-white/70 hover:bg-white/12 hover:text-white"
                            : "text-muted hover:bg-surface hover:text-text"
                        }`}
                      >
                        ×
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-r from-transparent via-[#f5f7fb]/86 to-[#f5f7fb]" />
        </div>

        <div ref={menuRef} className="relative ml-1 shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="Add terminal"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            title="Add terminal"
            className="flex items-center gap-1.5 rounded-2xl border border-dashed border-border bg-white px-3 py-2.5 text-secondary transition-colors hover:border-accent hover:text-accent"
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
            <svg
              className={`h-3.5 w-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {menuOpen ? (
            <div className="absolute right-0 top-full z-20 mt-2 min-w-[220px] rounded-2xl border border-border bg-white p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
              <button
                type="button"
                onClick={() => void handleOpenWorkspaceFolder()}
                className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface"
              >
                <span className="mt-0.5 text-text">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h5l2 2h11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text">Open folder…</span>
                  <span className="mt-0.5 block text-xs text-muted">Attach a new workspace in a new tab.</span>
                </span>
              </button>

              <button
                type="button"
                onClick={handleCloneActiveTab}
                disabled={!canCloneActiveTab}
                className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
              >
                <span className="mt-0.5 text-text">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9h10v10H9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text">Clone active tab</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {canCloneActiveTab
                      ? "Copy the current tab context into a new independent tab."
                      : "Wait for the current response to finish before cloning."}
                  </span>
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
