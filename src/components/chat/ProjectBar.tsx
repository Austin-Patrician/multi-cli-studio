import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../lib/store";

export function ProjectBar() {
  const persistenceIssue = useStore((state) => state.persistenceIssue);
  const activeTab = useStore(
    useShallow((state) => {
      const tab = state.terminalTabs.find((item) => item.id === state.activeTerminalTabId);
      return tab
        ? {
            workspaceId: tab.workspaceId,
            planMode: tab.planMode,
          }
        : null;
    })
  );
  const workspace = useStore(
    useShallow((state) => {
      const tab = state.terminalTabs.find((item) => item.id === state.activeTerminalTabId);
      const item = state.workspaces.find((workspace) => workspace.id === tab?.workspaceId);
      return item
        ? {
            id: item.id,
            name: item.name,
            rootPath: item.rootPath,
          }
        : null;
    })
  );

  if (!workspace || !activeTab) return null;

  return (
    <div className="border-b border-border bg-white">
      <div className="px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#111827] text-white shadow-[0_12px_30px_rgba(17,24,39,0.18)]">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-text">{workspace.name}</span>
              {/* <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                {workspace.branch}
              </span> */}
              {/* <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-secondary">
                {activeTab.selectedCli}
              </span> */}
              {activeTab.planMode && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  plan only
                </span>
              )}
            </div>
            <div className="truncate text-xs text-muted">{workspace.rootPath}</div>
            {persistenceIssue ? (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Persistence warning: {persistenceIssue}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
