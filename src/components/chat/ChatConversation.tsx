import { useEffect, useMemo, useRef } from "react";
import { useStore } from "../../lib/store";
import { UserBubble } from "./UserBubble";
import { CliBubble } from "./CliBubble";

export function ChatConversation() {
  const activeTerminalTabId = useStore((s) => s.activeTerminalTabId);
  const chatSessions = useStore((s) => s.chatSessions);
  const terminalTabs = useStore((s) => s.terminalTabs);
  const workspaces = useStore((s) => s.workspaces);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;
  const activeSession = activeTerminalTabId ? chatSessions[activeTerminalTabId] ?? null : null;
  const workspace = workspaces.find((item) => item.id === activeTab?.workspaceId) ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: activeTab?.status === "streaming" ? "auto" : "smooth",
      block: "end",
    });
  }, [activeSession?.messages]);

  const emptyMessage = useMemo(() => {
    if (!workspace) return "No workspace attached yet.";
    return `No messages yet for ${workspace.name}. Type / for commands or @ to mention files.`;
  }, [workspace]);

  if (!activeSession || !activeTab) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        No conversation started yet.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,#eef4ff_0%,#ffffff_42%)] px-5 py-5">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex items-center justify-between rounded-[22px] border border-border bg-white/85 px-4 py-3 backdrop-blur">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
              Active Terminal
            </div>
            <div className="mt-1 text-sm font-semibold text-text">
              {workspace?.name} · {activeTab.selectedCli}
            </div>
          </div>
          <div className="text-right text-xs text-secondary">
            <div>{activeTab.planMode ? "Plan mode" : "Execution mode"}</div>
            <div>{activeSession.messages.length} messages</div>
          </div>
        </div>

        {activeSession.messages.length === 0 && (
          <div className="flex items-center justify-center rounded-[22px] border border-dashed border-border bg-white px-6 py-12 text-sm text-muted">
            {emptyMessage}
          </div>
        )}

        {activeSession.messages.map((msg) => {
          if (msg.role === "system") {
            return (
              <div key={msg.id} className="flex justify-center">
                <span className="rounded-full border border-border bg-white px-3 py-1 text-xs text-secondary">
                  {msg.content}
                </span>
              </div>
            );
          }
          if (msg.role === "user") {
            return <UserBubble key={msg.id} message={msg} />;
          }
          return <CliBubble key={msg.id} message={msg} />;
        })}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
