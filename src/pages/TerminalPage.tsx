import { lazy, Suspense, useEffect, useState } from "react";
import { ProjectBar } from "../components/chat/ProjectBar";
import { ChatConversation } from "../components/chat/ChatConversation";
import { ChatPromptBar } from "../components/chat/ChatPromptBar";
import { TerminalDock, useTerminalDockState } from "../components/chat/TerminalDock";
import { useStore } from "../lib/store";

const WorkspaceRightPanel = lazy(async () =>
  import("../components/chat/WorkspaceRightPanel").then((module) => ({
    default: module.WorkspaceRightPanel,
  }))
);

const RIGHT_PANEL_STORAGE_KEY = "multi-cli-studio::terminal-right-panel-collapsed";

export function TerminalPage() {
  const activeTerminalTabId = useStore((state) => state.activeTerminalTabId);
  const hydrateTerminalSession = useStore((state) => state.hydrateTerminalSession);
  const { open: terminalDockOpen, toggle: toggleTerminalDock } = useTerminalDockState();
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEY);
    return raw == null ? true : raw === "true";
  });

  useEffect(() => {
    if (!activeTerminalTabId) return;
    void hydrateTerminalSession(activeTerminalTabId);
  }, [activeTerminalTabId, hydrateTerminalSession]);

  function toggleRightPanel() {
    setRightPanelCollapsed((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, String(next));
      }
      return next;
    });
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      <ProjectBar
        rightPanelCollapsed={rightPanelCollapsed}
        onToggleRightPanel={toggleRightPanel}
        terminalDockOpen={terminalDockOpen}
        onToggleTerminalDock={toggleTerminalDock}
      />
      <div className="flex-1 flex min-h-0 flex-col">
        <div className="flex min-h-0 flex-1">
          <div className="flex-1 flex flex-col min-w-0">
            <ChatConversation />
            <ChatPromptBar />
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
              <WorkspaceRightPanel />
            </Suspense>
          ) : null}
        </div>
        <TerminalDock isOpen={terminalDockOpen} onToggleOpen={toggleTerminalDock} />
      </div>
    </div>
  );
}
