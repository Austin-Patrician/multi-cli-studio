import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../lib/store";
import { Construction, FolderOpen, TerminalSquare } from "lucide-react";
import { LaunchScriptButton } from "./LaunchScriptButton";
import { OpenWorkspaceMenu } from "./OpenWorkspaceMenu";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";

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
  runtimeConsoleOpen,
  onToggleRuntimeConsole,
  launchScript,
  launchScriptEditorOpen,
  launchScriptDraft,
  launchScriptSaving,
  launchScriptError,
  onRunLaunchScript,
  onOpenLaunchScriptEditor,
  onCloseLaunchScriptEditor,
  onLaunchScriptDraftChange,
  onSaveLaunchScript,
}: {
  rightPanelCollapsed: boolean;
  onToggleRightPanel: () => void;
  terminalDockOpen: boolean;
  onToggleTerminalDock: () => void;
  runtimeConsoleOpen: boolean;
  onToggleRuntimeConsole: () => void;
  launchScript: string | null;
  launchScriptEditorOpen: boolean;
  launchScriptDraft: string;
  launchScriptSaving: boolean;
  launchScriptError: string | null;
  onRunLaunchScript: () => void;
  onOpenLaunchScriptEditor: () => void;
  onCloseLaunchScriptEditor: () => void;
  onLaunchScriptDraftChange: (value: string) => void;
  onSaveLaunchScript: () => void;
}) {
  const persistenceIssue = useStore((state) => state.persistenceIssue);
  const workspaces = useStore((state) => state.workspaces);
  const terminalTabs = useStore((state) => state.terminalTabs);
  const activeTerminalTabId = useStore((state) => state.activeTerminalTabId);
  const setActiveTerminalTab = useStore((state) => state.setActiveTerminalTab);
  const createTerminalTab = useStore((state) => state.createTerminalTab);
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
            locationKind: item.locationKind,
            locationLabel: item.locationLabel,
          }
        : null;
    })
  );

  if (!workspace || !activeTab) return null;
  const activeWorkspaceId = workspace.id;

  function handleWorkspaceChange(nextWorkspaceId: string) {
    if (!nextWorkspaceId || nextWorkspaceId === activeWorkspaceId) {
      return;
    }

    const candidateTabs = terminalTabs
      .filter((tab) => tab.workspaceId === nextWorkspaceId)
      .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt));

    const targetTab =
      candidateTabs.find((tab) => tab.id !== activeTerminalTabId) ??
      candidateTabs[0] ??
      null;

    if (targetTab) {
      setActiveTerminalTab(targetTab.id);
      return;
    }

    createTerminalTab(nextWorkspaceId);
  }

  return (
    <div className="border-b border-border bg-white">
      <div className="px-4 py-2.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="min-w-0 w-[min(360px,52vw)]">
                <Select
                  value={workspace.id}
                  onValueChange={(value) => handleWorkspaceChange(String(value))}
                >
                  <SelectTrigger
                    className="min-h-10 rounded-xl border-slate-200 bg-slate-50/80 px-3 text-slate-900 hover:border-slate-300 hover:bg-white"
                  >
                    <span className="min-w-0 inline-flex items-center gap-2.5">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
                        <FolderOpen className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-slate-900">
                        {workspace.name}
                      </span>
                    </span>
                  </SelectTrigger>
                  <SelectPopup className="p-1">
                    {workspaces.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        <span className="flex min-w-0 items-center gap-2">
                          <FolderOpen className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="truncate">{item.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              {activeTab.planMode ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  plan only
                </span>
              ) : null}
            </div>
            {persistenceIssue ? (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Persistence warning: {persistenceIssue}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <OpenWorkspaceMenu path={workspace.rootPath} disabled={workspace.locationKind === "ssh"} />
            <LaunchScriptButton
              launchScript={launchScript}
              editorOpen={launchScriptEditorOpen}
              draftScript={launchScriptDraft}
              isSaving={launchScriptSaving}
              error={launchScriptError}
              onRun={onRunLaunchScript}
              onOpenEditor={onOpenLaunchScriptEditor}
              onCloseEditor={onCloseLaunchScriptEditor}
              onDraftChange={onLaunchScriptDraftChange}
              onSave={onSaveLaunchScript}
            />
            <button
              type="button"
              onClick={onToggleRuntimeConsole}
              title={runtimeConsoleOpen ? "收起运行控制台" : "打开运行控制台"}
              aria-label={runtimeConsoleOpen ? "收起运行控制台" : "打开运行控制台"}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
                runtimeConsoleOpen
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-500 hover:-translate-y-[1px] hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              <Construction className="h-[15px] w-[15px]" />
            </button>
            <button
              type="button"
              onClick={onToggleTerminalDock}
              title={terminalDockOpen ? "收起终端面板" : "打开终端面板"}
              aria-label={terminalDockOpen ? "收起终端面板" : "打开终端面板"}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
                terminalDockOpen
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-500 hover:-translate-y-[1px] hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              <TerminalSquare className="h-[15px] w-[15px]" />
            </button>
            <button
              type="button"
              onClick={onToggleRightPanel}
              title={rightPanelCollapsed ? "展开右侧边栏" : "收起右侧边栏"}
              aria-label={rightPanelCollapsed ? "展开右侧边栏" : "收起右侧边栏"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-all hover:-translate-y-[1px] hover:border-slate-300 hover:text-slate-900"
            >
              <RightPanelToggleIcon collapsed={rightPanelCollapsed} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
