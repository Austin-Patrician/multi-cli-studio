import {
  Fragment,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronsUp, Flag } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  AgentId,
  AssistantApprovalDecision,
  AutoRouteAction,
  ChatAttachment,
  SelectedCustomAgent,
  TerminalCliId,
} from "../../lib/models";
import { formatAttachmentSummary } from "../../lib/chatAttachments";
import { useStore } from "../../lib/store";
import { CliBubble } from "./CliBubble";
import { CLI_OPTIONS } from "./CliSelector";
import { ChatSearchBar } from "./ChatSearchBar";
import { UserBubble } from "./UserBubble";

const AUTO_FOLLOW_THRESHOLD_PX = 120;
const LOAD_MORE_THRESHOLD_PX = 72;
const INITIAL_VISIBLE_MESSAGE_COUNT = 8;
const VISIBLE_MESSAGE_BATCH = 60;
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

function formatQueuedPromptPreview(value: string, attachments?: ChatAttachment[] | null) {
  const text = value.replace(/\s+/g, " ").trim();
  const attachmentSummary = formatAttachmentSummary(attachments);
  if (text && attachmentSummary) {
    return `${text} · ${attachmentSummary}`;
  }
  return text || attachmentSummary;
}

function QueuedIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 6.6V10l2.3 1.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M13.9 3.9a1.9 1.9 0 112.7 2.7l-8 8L5 15l.5-3.6 8.4-7.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5.5 5.5l9 9m0-9l-9 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function queuedCliTone(cliId: TerminalCliId) {
  if (cliId === "claude") return "border-amber-200 bg-amber-50 text-amber-700";
  if (cliId === "gemini") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-blue-200 bg-blue-50 text-blue-700";
}

function QueuedIconButton({
  label,
  icon,
  onClick,
  tone = "neutral",
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  tone?: "neutral" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-200/90 bg-rose-50/90 text-rose-600 hover:border-rose-300 hover:bg-rose-100 hover:text-rose-700"
      : "border-slate-200/90 bg-white/92 text-slate-500 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800";

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${toneClass}`}
    >
      {icon}
    </button>
  );
}

function QueuedCliBadge({ cliId }: { cliId: TerminalCliId }) {
  const option = CLI_OPTIONS.find((item) => item.id === cliId) ?? null;

  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full border bg-white/85 ${queuedCliTone(
        cliId
      )}`}
      title={`Queued for ${option?.label ?? cliId}`}
      aria-label={`Queued for ${option?.label ?? cliId}`}
    >
      {option?.icon ? (
        <img
          src={option.icon}
          alt=""
          aria-hidden="true"
          className="h-3.5 w-3.5 select-none object-contain"
        />
      ) : (
        <span className="text-[9px] font-bold uppercase leading-none">A</span>
      )}
    </span>
  );
}

function formatFinalMessageTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) {
    return null;
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function FinalMessageBoundary({ timestamp }: { timestamp?: string | null }) {
  const metaText = formatFinalMessageTimestamp(timestamp);

  return (
    <div
      className="my-1 flex w-full items-center gap-3 py-1 text-[12px] text-slate-500"
      role="separator"
    >
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300/80 to-slate-300/90" />
      <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/92 px-3 py-1 font-semibold text-slate-600 shadow-[0_8px_22px_rgba(15,23,42,0.05)]">
        <span className="inline-flex items-center gap-1.5">
          <Flag size={13} aria-hidden className="text-slate-500" />
          <span>最终消息</span>
        </span>
        {metaText ? (
          <span className="border-l border-slate-200/90 pl-2 text-[11px] font-medium text-slate-500">
            {metaText}
          </span>
        ) : null}
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent via-slate-300/80 to-slate-300/90" />
    </div>
  );
}

export function ChatConversation() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shouldAutoFollowRef = useRef(true);
  const searchMatchesRef = useRef<SearchDomMatch[]>([]);
  const suppressMutationObserverRef = useRef(false);
  const pendingPrependScrollRef = useRef<{ previousScrollHeight: number; previousScrollTop: number } | null>(null);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGE_COUNT);
  const [showLoadOlderHint, setShowLoadOlderHint] = useState(false);
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
  const queuedPrompt = useStore((state) =>
    state.activeTerminalTabId ? state.queuedChatByTab[state.activeTerminalTabId] ?? null : null
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
  const setTabSelectedAgent = useStore((state) => state.setTabSelectedAgent);
  const sendChatMessage = useStore((state) => state.sendChatMessage);
  const interruptChatTurn = useStore((state) => state.interruptChatTurn);
  const deleteChatMessage = useStore((state) => state.deleteChatMessage);
  const respondAssistantApproval = useStore((state) => state.respondAssistantApproval);
  const respondAutoRoute = useStore((state) => state.respondAutoRoute);
  const clearQueuedChatMessage = useStore((state) => state.clearQueuedChatMessage);
  const editQueuedChatMessage = useStore((state) => state.editQueuedChatMessage);

  const allMessages = activeSession?.messages ?? [];
  const shouldShowAllMessages = isSearchOpen && compiledSearch.hasQuery;
  const visibleMessages = useMemo(() => {
    if (shouldShowAllMessages) {
      return allMessages;
    }
    return allMessages.slice(Math.max(0, allMessages.length - visibleMessageCount));
  }, [allMessages, shouldShowAllMessages, visibleMessageCount]);
  const hasHiddenMessages =
    !shouldShowAllMessages && allMessages.length > visibleMessages.length;
  const hiddenMessageCount = Math.max(0, allMessages.length - visibleMessages.length);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    if (!shouldAutoFollowRef.current || isSearchOpen) return;

    bottomRef.current?.scrollIntoView({
      behavior: activeTab?.status === "streaming" ? "auto" : "smooth",
      block: "end",
    });
  }, [visibleMessages, activeTab?.status, isSearchOpen, queuedPrompt?.queuedAt]);

  useEffect(() => {
    shouldAutoFollowRef.current = true;
  }, [activeTab?.id]);

  useEffect(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    setCurrentMatchIndex(0);
    setMatchCount(0);
    setSearchRefreshTick(0);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGE_COUNT);
    setShowLoadOlderHint(false);
    pendingPrependScrollRef.current = null;
    searchMatchesRef.current = [];
  }, [activeTab?.id]);

  useEffect(() => {
    if (shouldShowAllMessages) {
      return;
    }
    setVisibleMessageCount((current) => Math.max(INITIAL_VISIBLE_MESSAGE_COUNT, Math.min(current, allMessages.length || INITIAL_VISIBLE_MESSAGE_COUNT)));
  }, [allMessages.length, shouldShowAllMessages]);

  useEffect(() => {
    if (!hasHiddenMessages) {
      setShowLoadOlderHint(false);
    }
  }, [hasHiddenMessages]);

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
    const pendingScroll = pendingPrependScrollRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!pendingScroll || !scrollContainer) {
      return;
    }
    pendingPrependScrollRef.current = null;
    const nextScrollTop =
      scrollContainer.scrollHeight - pendingScroll.previousScrollHeight + pendingScroll.previousScrollTop;
    scrollContainer.scrollTop = nextScrollTop;
  }, [visibleMessages.length]);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || !shouldAutoFollowRef.current || isSearchOpen) {
      return;
    }
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [activeTab?.id, visibleMessages.length, isSearchOpen]);

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
        return;
      }

      if (event.key === "Escape" && activeTab.status === "streaming") {
        const target =
          event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest("[data-chat-prompt-surface='true']")) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void interruptChatTurn(activeTab.id);
      }
    }

    document.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown, true);
    };
  }, [activeTab, interruptChatTurn, isSearchOpen]);

  const emptyMessage = useMemo(() => {
    if (!workspace) return "No workspace attached yet.";
    return `No messages yet for ${workspace.name}. Type / for commands or @ to mention files.`;
  }, [workspace]);

  const activeMatchNumber =
    matchCount === 0 ? 0 : Math.min(currentMatchIndex + 1, matchCount);
  const queuedPromptPreview = useMemo(
    () => (queuedPrompt ? formatQueuedPromptPreview(queuedPrompt.text, queuedPrompt.attachments) : ""),
    [queuedPrompt]
  );

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

  function handleRegeneratePrompt(
    prompt: string,
    cliId: AgentId | null,
    attachments?: ChatAttachment[] | null,
    selectedAgent?: SelectedCustomAgent | null
  ) {
    if (!activeTab || activeTab.status === "streaming") return;
    if (cliId && cliId !== activeTab.selectedCli) {
      setTabSelectedCli(activeTab.id, cliId);
    }
    setTabSelectedAgent(activeTab.id, selectedAgent ?? null);
    void sendChatMessage(activeTab.id, prompt, {
      attachmentsOverride: attachments ?? null,
      selectedAgentOverride: selectedAgent ?? null,
    }).catch(() => {});
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

  function loadOlderMessages() {
    if (shouldShowAllMessages || !hasHiddenMessages || pendingPrependScrollRef.current) return;
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    pendingPrependScrollRef.current = {
      previousScrollHeight: scrollContainer.scrollHeight,
      previousScrollTop: scrollContainer.scrollTop,
    };
    setVisibleMessageCount((current) => current + VISIBLE_MESSAGE_BATCH);
  }

  function handleScroll() {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    shouldAutoFollowRef.current = isNearBottom(scrollContainer);
    setShowLoadOlderHint(
      hasHiddenMessages && scrollContainer.scrollTop <= LOAD_MORE_THRESHOLD_PX
    );
  }

  function handleEditQueuedPrompt() {
    if (!activeTab) return;
    const applied = editQueuedChatMessage(activeTab.id);
    if (!applied) return;
    window.dispatchEvent(new Event("terminal-queue-edit-focus"));
  }

  function handleClearQueuedPrompt() {
    if (!activeTab) return;
    clearQueuedChatMessage(activeTab.id);
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
          <div className="flex items-center justify-between rounded-[12px] border border-border bg-white/85 px-4 py-3 backdrop-blur">
            <div>
              <div className="text-base font-bold text-text">
                Active Terminal
              </div>
            <div className="mt-1 text-sm font-medium text-text/70">
              {workspace?.name} · {activeTab.selectedCli}
            </div>
            </div>
            <div className="text-right text-xs text-secondary">
              <div>
                <div>{activeTab.planMode ? "Plan mode" : "Execution mode"}</div>
                <div>{allMessages.length} messages</div>
              </div>
            </div>
          </div>

          {hasHiddenMessages && showLoadOlderHint && (
            <div className="sticky top-2 z-10 flex justify-center px-2">
              <button
                type="button"
                onClick={loadOlderMessages}
                aria-label={`加载更早消息，还有 ${hiddenMessageCount} 条历史记录`}
                className="group inline-flex items-center gap-2 rounded-full border border-[#e6ddd0] bg-white/92 px-3.5 py-1.5 text-[12px] font-medium text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.06)] ring-1 ring-white/75 backdrop-blur-md transition-all hover:-translate-y-[1px] hover:border-[#d8cfbf] hover:bg-white hover:text-slate-900 hover:shadow-[0_14px_30px_rgba(15,23,42,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7cdbd]"
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f4efe6] text-[#8b7b63] transition-colors group-hover:bg-[#eee6d8] group-hover:text-slate-800">
                  <ChevronsUp size={12} aria-hidden />
                </span>
                <span>加载更早消息</span>
              </button>
            </div>
          )}

          {allMessages.length === 0 && (
            <div className="flex items-center justify-center rounded-[22px] border border-dashed border-border bg-white px-6 py-12 text-sm text-muted">
              {emptyMessage}
            </div>
          )}

          {(() => {
            let lastUserPrompt:
              | {
                  content: string;
                  cliId: AgentId | null;
                  attachments?: ChatAttachment[] | null;
                  selectedAgent?: SelectedCustomAgent | null;
                }
              | null = null;

            return visibleMessages.map((msg, index) => {
              const isLastVisibleMessage = index === visibleMessages.length - 1;

              if (msg.role === "system") {
                const systemTone =
                  msg.exitCode != null && msg.exitCode !== 0
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-border bg-white text-secondary";
                return (
                  <Fragment key={msg.id}>
                    <div className="flex justify-center">
                      <span
                        data-chat-search-ignore="true"
                        className={`rounded-full border px-3 py-1 text-xs ${systemTone}`}
                      >
                        {msg.content}
                      </span>
                    </div>
                    {isLastVisibleMessage ? (
                      <FinalMessageBoundary timestamp={msg.timestamp} />
                    ) : null}
                  </Fragment>
                );
              }

              if (msg.role === "user") {
                lastUserPrompt = {
                  content: msg.content,
                  cliId: msg.cliId,
                  attachments: msg.attachments ?? null,
                  selectedAgent: msg.selectedAgent ?? null,
                };
                return (
                  <Fragment key={msg.id}>
                    <UserBubble
                      message={msg}
                      onCopy={handleCopyPrompt}
                      onDelete={handleDeleteMessage}
                      deleteDisabled={activeTab.status === "streaming"}
                    />
                    {isLastVisibleMessage ? (
                      <FinalMessageBoundary timestamp={msg.timestamp} />
                    ) : null}
                  </Fragment>
                );
              }

              const regeneratePrompt = lastUserPrompt;

              return (
                <Fragment key={msg.id}>
                  <CliBubble
                    message={msg}
                    workspaceRoot={workspace?.rootPath ?? null}
                    onRegenerate={
                      !msg.isStreaming && regeneratePrompt
                        ? () =>
                            handleRegeneratePrompt(
                              regeneratePrompt.content,
                              regeneratePrompt.cliId,
                              regeneratePrompt.attachments,
                              regeneratePrompt.selectedAgent
                            )
                        : null
                    }
                    onDelete={!msg.isStreaming ? handleDeleteMessage : null}
                    actionsDisabled={activeTab.status === "streaming" || msg.isStreaming}
                    onApprovalDecision={handleAssistantApproval}
                    onAutoRouteAction={handleAutoRoute}
                  />
                  {isLastVisibleMessage ? (
                    <FinalMessageBoundary timestamp={msg.timestamp} />
                  ) : null}
                </Fragment>
              );
            });
          })()}

          {queuedPrompt && (
            <div className="flex justify-end">
              <div
                data-chat-search-ignore="true"
                className="flex w-fit max-w-[75%] flex-col items-end gap-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-sky-700"
                    title="Queued message"
                    aria-label="Queued message"
                  >
                    <QueuedIcon />
                  </span>
                  <QueuedCliBadge cliId={queuedPrompt.cliId} />
                </div>
                <div
                  className="max-w-full rounded-[12px] border border-sky-200/90 bg-sky-50/90 px-3.5 py-2.5 text-sm whitespace-pre-wrap text-sky-950 shadow-[0_14px_34px_rgba(14,116,144,0.08)]"
                  title={queuedPromptPreview || queuedPrompt.text}
                >
                  {queuedPromptPreview || "Queued attachment message"}
                </div>
                <div className="flex items-center justify-end gap-1 pr-1">
                  <QueuedIconButton
                    label="Edit queued message (Ctrl+B)"
                    icon={<EditIcon />}
                    onClick={handleEditQueuedPrompt}
                  />
                  <QueuedIconButton
                    label="Clear queued message"
                    icon={<ClearIcon />}
                    onClick={handleClearQueuedPrompt}
                    tone="danger"
                  />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
