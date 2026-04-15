import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../lib/store";
import { TerminalSquare } from "lucide-react";

function RightPanelToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M15 4v16" stroke="currentColor" strokeWidth="1.5" />
      {collapsed ? (
        <path d="M11 9l3 3-3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M13 9l-3 3 3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export function ProjectBar({
  rightPanelCollapsed,
  onToggleRightPanel,
  terminalDockOpen,
  onToggleTerminalDock,
}: {
  rightPanelCollapsed: boolean;
  onToggleRightPanel: () => void;
  terminalDockOpen: boolean;
  onToggleTerminalDock: () => void;
}) {
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
        <div className="flex min-w-0 items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-text">{workspace.name}</span>
              {activeTab.planMode ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  plan only
                </span>
              ) : null}
            </div>
            <div className="truncate text-xs text-muted">{workspace.rootPath}</div>
            {persistenceIssue ? (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Persistence warning: {persistenceIssue}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onToggleTerminalDock}
              title={terminalDockOpen ? "收起终端面板" : "打开终端面板"}
              aria-label={terminalDockOpen ? "收起终端面板" : "打开终端面板"}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
                terminalDockOpen
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-500 hover:-translate-y-[1px] hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              <TerminalSquare className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onToggleRightPanel}
              title={rightPanelCollapsed ? "展开右侧边栏" : "收起右侧边栏"}
              aria-label={rightPanelCollapsed ? "展开右侧边栏" : "收起右侧边栏"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-all hover:-translate-y-[1px] hover:border-slate-300 hover:text-slate-900"
            >
              <RightPanelToggleIcon collapsed={rightPanelCollapsed} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
