import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ACP_COMMANDS, AcpCommandDef, parseSlashCommand } from "../../lib/acp";
import { FileMentionCandidate } from "../../lib/models";
import { useStore } from "../../lib/store";
import { CliSelector } from "./CliSelector";
import { PromptOverlay } from "./PromptOverlay";

type OverlayKind = "slash" | "mention" | null;

function findMentionToken(value: string, caret: number) {
  const prefix = value.slice(0, caret);
  const match = prefix.match(/(?:^|\s)@([^\s@/]*)$/);
  if (!match || match.index == null) return null;
  const start = match.index + match[0].lastIndexOf("@");
  return {
    start,
    end: caret,
    query: match[1] ?? "",
  };
}

export function ChatPromptBar() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const [overlayKind, setOverlayKind] = useState<OverlayKind>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionItems, setMentionItems] = useState<FileMentionCandidate[]>([]);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);

  const terminalTabs = useStore((s) => s.terminalTabs);
  const workspaces = useStore((s) => s.workspaces);
  const activeTerminalTabId = useStore((s) => s.activeTerminalTabId);
  const busyAction = useStore((s) => s.busyAction);
  const setTabDraftPrompt = useStore((s) => s.setTabDraftPrompt);
  const sendChatMessage = useStore((s) => s.sendChatMessage);
  const executeAcpCommand = useStore((s) => s.executeAcpCommand);
  const snapshotWorkspace = useStore((s) => s.snapshotWorkspace);
  const runChecks = useStore((s) => s.runChecks);
  const togglePlanMode = useStore((s) => s.togglePlanMode);
  const searchWorkspaceFiles = useStore((s) => s.searchWorkspaceFiles);

  const activeTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;
  const workspace = workspaces.find((item) => item.id === activeTab?.workspaceId) ?? null;
  const prompt = activeTab?.draftPrompt ?? "";
  const isStreaming = activeTab?.status === "streaming";
  const isBusy = busyAction === "checks" || busyAction?.startsWith("review-") || false;

  const slashCommands = useMemo(() => {
    const raw = prompt.trimStart();
    if (!raw.startsWith("/") || raw.includes(" ")) return [];
    const q = raw.toLowerCase().replace(/^\//, "");
    return ACP_COMMANDS
      .filter((cmd) => !q || cmd.slash.slice(1).startsWith(q) || cmd.label.toLowerCase().includes(q))
      .sort((a, b) => {
        const aSupported = activeTab ? (a.supportedClis.includes(activeTab.selectedCli) ? 0 : 1) : 1;
        const bSupported = activeTab ? (b.supportedClis.includes(activeTab.selectedCli) ? 0 : 1) : 1;
        return aSupported - bSupported;
      });
  }, [activeTab, prompt]);

  const mentionToken = useMemo(() => {
    const caret = textareaRef.current?.selectionStart ?? prompt.length;
    return findMentionToken(prompt, caret);
  }, [prompt]);

  useEffect(() => {
    if (!activeTab || !workspace) return;
    if (!mentionToken) {
      setMentionItems([]);
      if (overlayKind === "mention") setOverlayKind(null);
      return;
    }

    let cancelled = false;
    searchWorkspaceFiles(workspace.id, mentionToken.query).then((items) => {
      if (!cancelled) {
        setMentionItems(items);
        if (items.length > 0) {
          setOverlayKind("mention");
          setSelectedIndex(0);
        } else if (overlayKind === "mention") {
          setOverlayKind(null);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, mentionToken, overlayKind, searchWorkspaceFiles, workspace]);

  useEffect(() => {
    if (slashCommands.length > 0) {
      setOverlayKind("slash");
      setSelectedIndex(0);
      return;
    }
    if (overlayKind === "slash") {
      setOverlayKind(null);
    }
  }, [overlayKind, slashCommands]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [prompt]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!actionMenuRef.current?.contains(event.target as Node)) {
        setIsActionMenuOpen(false);
      }
    }

    if (isActionMenuOpen) {
      window.addEventListener("mousedown", handlePointerDown);
    }

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isActionMenuOpen]);

  const overlayItems = overlayKind === "slash"
    ? slashCommands.map((cmd) => ({
        id: cmd.kind,
        title: cmd.slash,
        subtitle: cmd.description,
        meta: cmd.argsHint,
        chips: cmd.supportedClis,
        disabled: activeTab ? !cmd.supportedClis.includes(activeTab.selectedCli) : true,
      }))
    : mentionItems.map((item) => ({
        id: item.id,
        title: item.relativePath,
        subtitle: item.name,
      }));

  const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, overlayItems.length - 1));

  function setPrompt(value: string) {
    if (!activeTab) return;
    setTabDraftPrompt(activeTab.id, value);
  }

  function handleSend() {
    if (!activeTab) return;
    setIsActionMenuOpen(false);
    void sendChatMessage(activeTab.id);
  }

  function selectSlashCommand(cmd: AcpCommandDef) {
    if (!activeTab) return;
    if (!cmd.supportedClis.includes(activeTab.selectedCli)) return;
    if (cmd.argsHint) {
      setPrompt(`${cmd.slash} `);
      setOverlayKind(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    const parsed = parseSlashCommand(cmd.slash);
    if (!parsed) return;
    setPrompt("");
    setOverlayKind(null);
    void executeAcpCommand(parsed, activeTab.id);
  }

  function selectMention(item: FileMentionCandidate) {
    if (!activeTab || !mentionToken) return;
    const next = `${prompt.slice(0, mentionToken.start)}@${item.relativePath} ${prompt.slice(mentionToken.end)}`;
    setPrompt(next);
    setOverlayKind(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const nextCaret = mentionToken.start + item.relativePath.length + 2;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function handleOverlaySelect(index: number) {
    if (overlayKind === "slash") {
      const command = slashCommands[index];
      if (command) selectSlashCommand(command);
      return;
    }
    const item = mentionItems[index];
    if (item) selectMention(item);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Tab" && event.shiftKey && activeTab && (!overlayKind || overlayItems.length === 0)) {
      event.preventDefault();
      togglePlanMode(activeTab.id);
      return;
    }

    if (overlayKind && overlayItems.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) => Math.min(current + 1, overlayItems.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleOverlaySelect(safeSelectedIndex);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        handleOverlaySelect(safeSelectedIndex);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setOverlayKind(null);
        return;
      }
    }

    if (event.key === "Escape" && isActionMenuOpen) {
      event.preventDefault();
      setIsActionMenuOpen(false);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  if (!activeTab || !workspace) return null;
  const cliLabel =
    activeTab.selectedCli.charAt(0).toUpperCase() + activeTab.selectedCli.slice(1);

  return (
    <div className="border-t border-border bg-[radial-gradient(circle_at_top,#f8fbff_0%,#ffffff_48%)] px-5 py-4">
      <div className="mx-auto max-w-5xl">
        <div className="relative overflow-visible">
          <PromptOverlay
            items={overlayItems}
            selectedIndex={safeSelectedIndex}
            onSelect={(item) => {
              const index = overlayItems.findIndex((entry) => entry.id === item.id);
              if (index >= 0) handleOverlaySelect(index);
            }}
          />

          <div className="rounded-[28px] border border-[#d7e0eb] bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-4 pt-3 pb-3.5 shadow-[0_18px_54px_rgba(15,23,42,0.08)] transition-colors focus-within:border-accent/40 focus-within:shadow-[0_22px_64px_rgba(59,130,246,0.09)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <CliSelector />
              </div>

              <div ref={actionMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setOverlayKind(null);
                    setIsActionMenuOpen((current) => !current);
                  }}
                  disabled={isStreaming || isBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#dbe4ef] bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-secondary transition-colors hover:border-accent/35 hover:text-text disabled:cursor-not-allowed disabled:opacity-45"
                >
                  More
                  <svg
                    className={`h-3 w-3 transition-transform ${isActionMenuOpen ? "rotate-180" : ""}`}
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 7.5L10 12.5L15 7.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                {isActionMenuOpen && (
                  <div className="absolute bottom-full right-0 z-20 mb-3 w-[210px] overflow-hidden rounded-[18px] border border-[#dce4ef] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.14)]">
                    <button
                      type="button"
                      onClick={() => {
                        setIsActionMenuOpen(false);
                        void snapshotWorkspace();
                      }}
                      disabled={isStreaming || isBusy}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[#f7f9fc] disabled:cursor-not-allowed disabled:opacity-45"
                      title="Mark this workspace as ready for handoff"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-2xl bg-[#eef4ff] text-accent">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <path d="M10 3v9m0 0l3-3m-3 3L7 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M4 13.5v1A1.5 1.5 0 005.5 16h9A1.5 1.5 0 0016 14.5v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-text">Snapshot</div>
                        <div className="mt-0.5 text-[11px] leading-5 text-secondary">
                          Mark handoff
                        </div>
                      </div>
                    </button>

                    <div className="border-t border-border" />

                    <button
                      type="button"
                      onClick={() => {
                        setIsActionMenuOpen(false);
                        void runChecks();
                      }}
                      disabled={isStreaming || isBusy}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[#f7f9fc] disabled:cursor-not-allowed disabled:opacity-45"
                      title="Run the default validation command for this workspace"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-2xl bg-[#f4f7fb] text-[#334155]">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                          <path d="M4.5 10.5l3 3L15.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-text">Run Checks</div>
                        <div className="mt-0.5 text-[11px] leading-5 text-secondary">
                          Validate
                        </div>
                      </div>
                    </button>

                    <div className="border-t border-border bg-[#fbfcfe] px-3.5 py-2 text-[10px] text-muted">
                      Shift+Tab toggles plan mode.
                    </div>
                  </div>
                )}
              </div>
            </div>

            <textarea
              ref={textareaRef}
              rows={1}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isStreaming
                  ? "Waiting for response..."
                  : `Message ${cliLabel}`
              }
              disabled={isStreaming}
              className="min-h-[3.5rem] w-full resize-none bg-transparent px-0 py-0 text-[15px] leading-8 text-text placeholder:text-secondary/65 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="mt-3 flex flex-col gap-1 text-[11px] text-muted md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>/ commands</span>
              <span>@ files</span>
              <span>Shift+Tab for plan</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Enter sends</span>
              <span>Shift+Enter for newline</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
