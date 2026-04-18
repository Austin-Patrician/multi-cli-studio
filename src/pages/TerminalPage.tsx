import { lazy, Suspense, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ProjectBar } from "../components/chat/ProjectBar";
import { ChatConversation } from "../components/chat/ChatConversation";
import { ChatPromptBar } from "../components/chat/ChatPromptBar";
import { TerminalDock, useTerminalDockState } from "../components/chat/TerminalDock";
import { RuntimeLogDock } from "../components/chat/RuntimeLogDock";
import { useRuntimeLogSession } from "../components/chat/useRuntimeLogSession";
import { useWorkspaceLaunchScript } from "../components/chat/useWorkspaceLaunchScript";
import { useStore } from "../lib/store";

const WorkspaceRightPanel = lazy(async () =>
  import("../components/chat/WorkspaceRightPanel").then((module) => ({
    default: module.WorkspaceRightPanel,
  }))
);

const RIGHT_PANEL_STORAGE_KEY = "multi-cli-studio::terminal-right-panel-collapsed";
const STATUS_PANEL_STORAGE_KEY = "multi-cli-studio::terminal-status-panel-collapsed";

export function TerminalPage() {
  const activeTerminalTabId = useStore((state) => state.activeTerminalTabId);
  const hydrateTerminalSession = useStore((state) => state.hydrateTerminalSession);
  const { open: terminalDockOpen, toggle: toggleTerminalDock, openDock, closeDock } =
    useTerminalDockState();
  const activeWorkspace = useStore(
    useShallow((state) => {
      const tab = state.terminalTabs.find((item) => item.id === state.activeTerminalTabId);
      return state.workspaces.find((item) => item.id === tab?.workspaceId) ?? null;
    }),
  );
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEY);
    return raw == null ? true : raw === "true";
  });
  const [statusPanelCollapsed, setStatusPanelCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const raw = window.localStorage.getItem(STATUS_PANEL_STORAGE_KEY);
    return raw == null ? false : raw === "true";
  });
  const runtimeRunState = useRuntimeLogSession({ activeWorkspace });
  const launchScriptState = useWorkspaceLaunchScript({
    activeWorkspace,
    onOpenRuntimeConsole: () => {
      closeDock();
      runtimeRunState.onOpenRuntimeConsole();
    },
    onRunProjectWithCommand: runtimeRunState.onRunProjectWithCommand,
  });

  useEffect(() => {
    if (!activeTerminalTabId) return;
    void hydrateTerminalSession(activeTerminalTabId);
  }, [activeTerminalTabId, hydrateTerminalSession]);

  useEffect(() => {
    if (terminalDockOpen && runtimeRunState.runtimeConsoleVisible) {
      closeDock();
    }
  }, [closeDock, runtimeRunState.runtimeConsoleVisible, terminalDockOpen]);

  function toggleRightPanel() {
    setRightPanelCollapsed((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, String(next));
      }
      return next;
    });
  }

  function toggleStatusPanel() {
    setStatusPanelCollapsed((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STATUS_PANEL_STORAGE_KEY, String(next));
      }
      return next;
    });
  }

  function handleToggleRuntimeConsole() {
    if (runtimeRunState.runtimeConsoleVisible) {
      runtimeRunState.onCloseRuntimeConsole();
      return;
    }
    closeDock();
    runtimeRunState.onOpenRuntimeConsole();
  }

  function handleToggleTerminalPanel() {
    if (!terminalDockOpen) {
      runtimeRunState.onCloseRuntimeConsole();
      openDock();
      return;
    }
    toggleTerminalDock();
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      <ProjectBar
        rightPanelCollapsed={rightPanelCollapsed}
        onToggleRightPanel={toggleRightPanel}
        terminalDockOpen={terminalDockOpen}
        onToggleTerminalDock={handleToggleTerminalPanel}
        runtimeConsoleOpen={runtimeRunState.runtimeConsoleVisible}
        onToggleRuntimeConsole={handleToggleRuntimeConsole}
        launchScript={launchScriptState.launchScript}
        launchScriptEditorOpen={launchScriptState.editorOpen}
        launchScriptDraft={launchScriptState.draftScript}
        launchScriptSaving={launchScriptState.isSaving}
        launchScriptError={launchScriptState.error}
        onRunLaunchScript={() => {
          void launchScriptState.onRunLaunchScript();
        }}
        onOpenLaunchScriptEditor={launchScriptState.onOpenEditor}
        onCloseLaunchScriptEditor={launchScriptState.onCloseEditor}
        onLaunchScriptDraftChange={launchScriptState.onDraftScriptChange}
        onSaveLaunchScript={() => {
          void launchScriptState.onSaveLaunchScript();
        }}
      />
      <div className="flex-1 flex min-h-0 flex-col">
        <div className="flex min-h-0 flex-1">
          <div className="flex-1 flex flex-col min-w-0">
            <ChatConversation />
            <ChatPromptBar
              statusPanelExpanded={!statusPanelCollapsed}
              onToggleStatusPanel={toggleStatusPanel}
            />
          </div>
          {!rightPanelCollapsed ? (
            <Suspense
              fallback={
                <aside className="w-[380px] min-w-[340px] border-l border-border bg-[#fcfcfd]">
                  <div className="flex h-full items-center justify-center text-sm text-secondary">
                    Loading workspace panel…
                  </div>
                </aside>
              }
            >
              <WorkspaceRightPanel statusPanelCollapsed={statusPanelCollapsed} />
            </Suspense>
          ) : null}
        </div>
        {runtimeRunState.runtimeConsoleVisible ? (
          <RuntimeLogDock
            isVisible={runtimeRunState.runtimeConsoleVisible}
            status={runtimeRunState.runtimeConsoleStatus}
            commandPreview={runtimeRunState.runtimeConsoleCommandPreview}
            log={runtimeRunState.runtimeConsoleLog}
            error={runtimeRunState.runtimeConsoleError}
            exitCode={runtimeRunState.runtimeConsoleExitCode}
            truncated={runtimeRunState.runtimeConsoleTruncated}
            autoScroll={runtimeRunState.runtimeAutoScroll}
            wrapLines={runtimeRunState.runtimeWrapLines}
            commandPresetOptions={runtimeRunState.runtimeCommandPresetOptions}
            commandPresetId={runtimeRunState.runtimeCommandPresetId}
            commandInput={runtimeRunState.runtimeCommandInput}
            onRun={runtimeRunState.onRunProject}
            onCommandPresetChange={runtimeRunState.onSelectRuntimeCommandPreset}
            onCommandInputChange={runtimeRunState.onChangeRuntimeCommandInput}
            onStop={runtimeRunState.onStopProject}
            onClear={runtimeRunState.onClearRuntimeLogs}
            onCopy={runtimeRunState.onCopyRuntimeLogs}
            onToggleAutoScroll={runtimeRunState.onToggleRuntimeAutoScroll}
            onToggleWrapLines={runtimeRunState.onToggleRuntimeWrapLines}
          />
        ) : (
          <TerminalDock
            isOpen={terminalDockOpen}
            onToggleOpen={handleToggleTerminalPanel}
            defaultWorkspace={
              activeWorkspace
                ? {
                    id: activeWorkspace.id,
                    rootPath: activeWorkspace.rootPath,
                    name: activeWorkspace.name,
                  }
                : null
            }
          />
        )}
      </div>
    </div>
  );
}
