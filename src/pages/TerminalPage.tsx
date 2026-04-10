import { lazy, Suspense, useEffect } from "react";
import { ProjectBar } from "../components/chat/ProjectBar";
import { ChatConversation } from "../components/chat/ChatConversation";
import { ChatPromptBar } from "../components/chat/ChatPromptBar";
import { TerminalTabStrip } from "../components/chat/TerminalTabStrip";
import { useStore } from "../lib/store";

const GitPanel = lazy(async () => import("../components/chat/GitPanel").then((module) => ({ default: module.GitPanel })));

export function TerminalPage() {
  const activeTerminalTabId = useStore((state) => state.activeTerminalTabId);
  const hydrateTerminalSession = useStore((state) => state.hydrateTerminalSession);

  useEffect(() => {
    if (!activeTerminalTabId) return;
    void hydrateTerminalSession(activeTerminalTabId);
  }, [activeTerminalTabId, hydrateTerminalSession]);

  return (
    <div className="h-full flex flex-col bg-bg">
      <TerminalTabStrip />
      <ProjectBar />
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <ChatConversation />
          <ChatPromptBar />
        </div>
        <Suspense
          fallback={
            <aside className="w-[320px] border-l border-border bg-[#fcfcfd]">
              <div className="flex h-full items-center justify-center text-sm text-secondary">
                Loading changes…
              </div>
            </aside>
          }
        >
          <GitPanel />
        </Suspense>
      </div>
    </div>
  );
}
