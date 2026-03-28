import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { AgentId, ClaudeApprovalDecision } from "../../lib/models";
import { useStore } from "../../lib/store";
import { UserBubble } from "./UserBubble";
import { CliBubble } from "./CliBubble";

async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the legacy copy path below.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function ChatConversation() {
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeTab = useStore(
    useShallow((state) => {
      const tab = state.terminalTabs.find((item) => item.id === state.activeTerminalTabId);
      return tab
        ? {
            id: tab.id,
            workspaceId: tab.workspaceId,
            selectedCli: tab.selectedCli,
            planMode: tab.planMode,
            status: tab.status,
          }
        : null;
    })
  );
  const activeSession = useStore((state) =>
    state.activeTerminalTabId ? state.chatSessions[state.activeTerminalTabId] ?? null : null
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
  const setTabSelectedCli = useStore((state) => state.setTabSelectedCli);
  const sendChatMessage = useStore((state) => state.sendChatMessage);
  const deleteChatMessage = useStore((state) => state.deleteChatMessage);
  const respondClaudeApproval = useStore((state) => state.respondClaudeApproval);

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

  function handleCopyPrompt(prompt: string) {
    return copyTextToClipboard(prompt);
  }

  function handleRegeneratePrompt(prompt: string, cliId: AgentId | null) {
    if (!activeTab || activeTab.status === "streaming") return;
    if (cliId && cliId !== activeTab.selectedCli) {
      setTabSelectedCli(activeTab.id, cliId);
    }
    void sendChatMessage(activeTab.id, prompt);
  }

  function handleDeleteMessage(messageId: string) {
    if (!activeTab || activeTab.status === "streaming") return;
    deleteChatMessage(activeTab.id, messageId);
  }

  function handleClaudeApproval(requestId: string, decision: ClaudeApprovalDecision) {
    void respondClaudeApproval(requestId, decision);
  }

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

        {(() => {
          let lastUserPrompt: { content: string; cliId: AgentId | null } | null = null;

          return activeSession.messages.map((msg) => {
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
              lastUserPrompt = { content: msg.content, cliId: msg.cliId };
              return (
                <UserBubble
                  key={msg.id}
                  message={msg}
                  onCopy={handleCopyPrompt}
                  onDelete={handleDeleteMessage}
                  deleteDisabled={activeTab.status === "streaming"}
                />
              );
            }

            const regeneratePrompt = lastUserPrompt;

            return (
              <CliBubble
                key={msg.id}
                message={msg}
                workspaceRoot={workspace?.rootPath ?? null}
                onRegenerate={
                  !msg.isStreaming && regeneratePrompt
                    ? () => handleRegeneratePrompt(regeneratePrompt.content, regeneratePrompt.cliId)
                    : null
                }
                onDelete={!msg.isStreaming ? handleDeleteMessage : null}
                actionsDisabled={activeTab.status === "streaming" || msg.isStreaming}
                onClaudeApproval={handleClaudeApproval}
              />
            );
          });
        })()}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
