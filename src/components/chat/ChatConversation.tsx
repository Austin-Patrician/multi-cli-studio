import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { AgentId, AssistantApprovalDecision, AutoRouteAction } from "../../lib/models";
import { useStore } from "../../lib/store";
import { CliBubble } from "./CliBubble";
import { ChatSearchBar } from "./ChatSearchBar";
import { UserBubble } from "./UserBubble";

const AUTO_FOLLOW_THRESHOLD_PX = 120;
const SEARCHABLE_SELECTOR = "[data-chat-searchable-content='true']";
const SEARCH_MATCH_SELECTOR = "mark[data-chat-search-match='true']";
const SEARCH_MATCH_BASE_CLASS =
  "rounded-[4px] bg-[#fff0a8] px-0.5 text-inherit shadow-[inset_0_-1px_0_rgba(180,83,9,0.18)]";
const SEARCH_MATCH_CURRENT_CLASS =
  "rounded-[4px] bg-[#f59e0b] px-0.5 text-[#111827] shadow-[0_0_0_1px_rgba(255,255,255,0.55)]";

type SearchOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
};

type CompiledSearchPattern = {
  key: string;
  pattern: RegExp | null;
  invalid: boolean;
  hasQuery: boolean;
};

type SearchDomMatch = {
  element: HTMLElement;
  messageId: string;
};

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

function isNearBottom(element: HTMLDivElement) {
  const distanceFromBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceFromBottom <= AUTO_FOLLOW_THRESHOLD_PX;
}

function escapeForRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileSearchPattern(query: string, options: SearchOptions): CompiledSearchPattern {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      key: "",
      pattern: null,
      invalid: false,
      hasQuery: false,
    };
  }

  const source = options.regex ? trimmed : escapeForRegex(trimmed);
  const wrappedSource = options.wholeWord ? `\\b(?:${source})\\b` : source;
  const flags = options.caseSensitive ? "g" : "gi";

  try {
    return {
      key: `${wrappedSource}/${flags}`,
      pattern: new RegExp(wrappedSource, flags),
      invalid: false,
      hasQuery: true,
    };
  } catch {
    return {
      key: `${wrappedSource}/${flags}`,
      pattern: null,
      invalid: true,
      hasQuery: true,
    };
  }
}

function collectSearchTextNodes(scope: HTMLElement) {
  const walker = document.createTreeWalker(
    scope,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const text = node.textContent ?? "";
        const parent = node.parentElement;
        if (!text.trim() || !parent) {
          return NodeFilter.FILTER_REJECT;
        }
        if (
          parent.closest(
            "button, input, textarea, select, option, [contenteditable='true'], [data-chat-search-ignore='true'], mark[data-chat-search-match='true']"
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function findTextMatches(value: string, pattern: RegExp) {
  const matches: Array<{ start: number; end: number }> = [];
  const matcher = new RegExp(pattern.source, pattern.flags);
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(value)) !== null) {
    const found = match[0] ?? "";
    if (!found) {
      matcher.lastIndex += 1;
      continue;
    }
    matches.push({
      start: match.index,
      end: match.index + found.length,
    });
  }

  return matches;
}

function clearSearchHighlights(root: HTMLElement) {
  const marks = root.querySelectorAll<HTMLElement>(SEARCH_MATCH_SELECTOR);
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  }
}

function setCurrentMatchStyles(matches: SearchDomMatch[], currentIndex: number) {
  matches.forEach((match, index) => {
    match.element.className =
      index === currentIndex ? SEARCH_MATCH_CURRENT_CLASS : SEARCH_MATCH_BASE_CLASS;
  });
}

function applySearchHighlights(
  root: HTMLElement,
  pattern: RegExp,
  currentMatchIndex: number
) {
  const matches: SearchDomMatch[] = [];
  let globalIndex = 0;

  const scopes = root.querySelectorAll<HTMLElement>(SEARCHABLE_SELECTOR);
  for (const scope of scopes) {
    const messageId = scope.dataset.chatSearchMessageId ?? "";
    const textNodes = collectSearchTextNodes(scope);

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? "";
      const ranges = findTextMatches(text, pattern);
      if (ranges.length === 0) continue;

      const fragment = document.createDocumentFragment();
      let cursor = 0;

      for (const range of ranges) {
        if (range.start > cursor) {
          fragment.append(text.slice(cursor, range.start));
        }

        const mark = document.createElement("mark");
        mark.dataset.chatSearchMatch = "true";
        mark.dataset.chatSearchIndex = String(globalIndex);
        mark.dataset.chatSearchMessageId = messageId;
        mark.className =
          globalIndex === currentMatchIndex
            ? SEARCH_MATCH_CURRENT_CLASS
            : SEARCH_MATCH_BASE_CLASS;
        mark.textContent = text.slice(range.start, range.end);
        fragment.append(mark);

        matches.push({ element: mark, messageId });
        cursor = range.end;
        globalIndex += 1;
      }

      if (cursor < text.length) {
        fragment.append(text.slice(cursor));
      }

      textNode.parentNode?.replaceChild(fragment, textNode);
    }
  }

  return matches;
}

function focusSearchInput(
  input: HTMLInputElement | null,
  selectAll = false
) {
  if (!input) return;
  input.focus();
  if (selectAll) {
    input.select();
  }
}

export function ChatConversation() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shouldAutoFollowRef = useRef(true);
  const searchMatchesRef = useRef<SearchDomMatch[]>([]);
  const suppressMutationObserverRef = useRef(false);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [searchRefreshTick, setSearchRefreshTick] = useState(0);

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const compiledSearch = useMemo(
    () => compileSearchPattern(deferredSearchQuery, searchOptions),
    [
      deferredSearchQuery,
      searchOptions.caseSensitive,
      searchOptions.regex,
      searchOptions.wholeWord,
    ]
  );

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
  const respondAssistantApproval = useStore((state) => state.respondAssistantApproval);
  const respondAutoRoute = useStore((state) => state.respondAutoRoute);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    if (!shouldAutoFollowRef.current || isSearchOpen) return;

    bottomRef.current?.scrollIntoView({
      behavior: activeTab?.status === "streaming" ? "auto" : "smooth",
      block: "end",
    });
  }, [activeSession?.messages, activeTab?.status, isSearchOpen]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    shouldAutoFollowRef.current = isNearBottom(scrollContainer);
  }, [activeTab?.id]);

  useEffect(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    setCurrentMatchIndex(0);
    setMatchCount(0);
    setSearchRefreshTick(0);
    searchMatchesRef.current = [];
  }, [activeTab?.id]);

  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [
    searchQuery,
    searchOptions.caseSensitive,
    searchOptions.regex,
    searchOptions.wholeWord,
  ]);

  useEffect(() => {
    if (!isSearchOpen) return;
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || typeof MutationObserver === "undefined") return;

    let frameId = 0;
    const observer = new MutationObserver((records) => {
      if (suppressMutationObserverRef.current) return;

      const hasExternalMutation = records.some((record) => {
        const target = record.target instanceof Text
          ? record.target.parentElement
          : record.target instanceof Element
            ? record.target
            : null;
        return !target?.closest(SEARCH_MATCH_SELECTOR);
      });

      if (!hasExternalMutation) return;

      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        setSearchRefreshTick((value) => value + 1);
      });
    });

    observer.observe(scrollContainer, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [isSearchOpen, activeTab?.id]);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    suppressMutationObserverRef.current = true;
    clearSearchHighlights(scrollContainer);
    searchMatchesRef.current = [];

    if (!isSearchOpen || !compiledSearch.pattern) {
      if (matchCount !== 0) {
        setMatchCount(0);
      }
      queueMicrotask(() => {
        suppressMutationObserverRef.current = false;
      });
      return;
    }

    const matches = applySearchHighlights(
      scrollContainer,
      compiledSearch.pattern,
      currentMatchIndex
    );

    searchMatchesRef.current = matches;
    if (matchCount !== matches.length) {
      setMatchCount(matches.length);
    }

    const clampedIndex =
      matches.length === 0 ? 0 : Math.min(currentMatchIndex, matches.length - 1);

    if (clampedIndex !== currentMatchIndex) {
      queueMicrotask(() => {
        setCurrentMatchIndex(clampedIndex);
        suppressMutationObserverRef.current = false;
      });
      return;
    }

    if (matches.length > 0) {
      queueMicrotask(() => {
        shouldAutoFollowRef.current = false;
        matches[clampedIndex]?.element.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
        suppressMutationObserverRef.current = false;
      });
      return;
    }

    queueMicrotask(() => {
      suppressMutationObserverRef.current = false;
    });
  }, [
    activeSession?.messages,
    compiledSearch.key,
    compiledSearch.pattern,
    isSearchOpen,
    currentMatchIndex,
    matchCount,
    searchRefreshTick,
  ]);

  useEffect(() => {
    if (!isSearchOpen || matchCount === 0) return;
    setCurrentMatchStyles(searchMatchesRef.current, currentMatchIndex);
  }, [currentMatchIndex, matchCount, isSearchOpen]);

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (!activeTab || event.isComposing) return;

      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        event.stopPropagation();
        shouldAutoFollowRef.current = false;
        openSearch(true);
        return;
      }

      if (event.key === "Escape" && isSearchOpen) {
        event.preventDefault();
        event.stopPropagation();
        setIsSearchOpen(false);
        setSearchQuery("");
        setCurrentMatchIndex(0);
      }
    }

    document.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown, true);
    };
  }, [activeTab, isSearchOpen]);

  const emptyMessage = useMemo(() => {
    if (!workspace) return "No workspace attached yet.";
    return `No messages yet for ${workspace.name}. Type / for commands or @ to mention files.`;
  }, [workspace]);

  const activeMatchNumber =
    matchCount === 0 ? 0 : Math.min(currentMatchIndex + 1, matchCount);

  function openSearch(selectAll = false) {
    shouldAutoFollowRef.current = false;
    setIsSearchOpen(true);
    requestAnimationFrame(() => {
      focusSearchInput(searchInputRef.current, selectAll);
    });
  }

  function closeSearch() {
    setIsSearchOpen(false);
    setSearchQuery("");
    setCurrentMatchIndex(0);
  }

  function jumpToRelativeMatch(direction: 1 | -1) {
    if (matchCount === 0) return;
    shouldAutoFollowRef.current = false;
    setCurrentMatchIndex((value) => {
      const next = value + direction;
      if (next < 0) return matchCount - 1;
      if (next >= matchCount) return 0;
      return next;
    });
  }

  function handleSearchInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      jumpToRelativeMatch(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    }
  }

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

  function handleAssistantApproval(
    requestId: string,
    decision: AssistantApprovalDecision
  ) {
    void respondAssistantApproval(requestId, decision);
  }

  function handleAutoRoute(action: AutoRouteAction) {
    if (!activeTab) return;
    void respondAutoRoute(activeTab.id, action);
  }

  function handleScroll() {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    shouldAutoFollowRef.current = isNearBottom(scrollContainer);
  }

  if (!activeSession || !activeTab) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        No conversation started yet.
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0 bg-[radial-gradient(circle_at_top,#eef4ff_0%,#ffffff_42%)]">
      {isSearchOpen && (
        <ChatSearchBar
          query={searchQuery}
          totalMatches={matchCount}
          currentMatch={activeMatchNumber}
          isCaseSensitive={searchOptions.caseSensitive}
          isWholeWord={searchOptions.wholeWord}
          isRegex={searchOptions.regex}
          invalidPattern={compiledSearch.invalid}
          inputRef={searchInputRef}
          onQueryChange={setSearchQuery}
          onInputKeyDown={handleSearchInputKeyDown}
          onToggleCaseSensitive={() => {
            setSearchOptions((current) => ({
              ...current,
              caseSensitive: !current.caseSensitive,
            }));
          }}
          onToggleWholeWord={() => {
            setSearchOptions((current) => ({
              ...current,
              wholeWord: !current.wholeWord,
            }));
          }}
          onToggleRegex={() => {
            setSearchOptions((current) => ({
              ...current,
              regex: !current.regex,
            }));
          }}
          onPrevious={() => jumpToRelativeMatch(-1)}
          onNext={() => jumpToRelativeMatch(1)}
          onClose={closeSearch}
        />
      )}

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-5 py-5"
      >
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
              <div>
                <div>{activeTab.planMode ? "Plan mode" : "Execution mode"}</div>
                <div>{activeSession.messages.length} messages</div>
              </div>
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
                    <span
                      data-chat-search-ignore="true"
                      className="rounded-full border border-border bg-white px-3 py-1 text-xs text-secondary"
                    >
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
                      ? () =>
                          handleRegeneratePrompt(
                            regeneratePrompt.content,
                            regeneratePrompt.cliId
                          )
                      : null
                  }
                  onDelete={!msg.isStreaming ? handleDeleteMessage : null}
                  actionsDisabled={activeTab.status === "streaming" || msg.isStreaming}
                  onApprovalDecision={handleAssistantApproval}
                  onAutoRouteAction={handleAutoRoute}
                />
              );
            });
          })()}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
