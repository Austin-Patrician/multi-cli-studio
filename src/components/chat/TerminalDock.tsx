import "xterm/css/xterm.css";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { bridge } from "../../lib/bridge";

const OPEN_STORAGE_KEY = "multi-cli-studio::terminal-dock-open";
const HEIGHT_STORAGE_KEY = "multi-cli-studio::terminal-dock-height";
const TABS_STORAGE_KEY = "multi-cli-studio::terminal-dock-tabs";
const ACTIVE_TAB_STORAGE_KEY = "multi-cli-studio::terminal-dock-active-tab";
const DEFAULT_HEIGHT = 220;
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 520;

type DockTerminalTab = {
  id: string;
  title: string;
  workspaceId: string | null;
  cwd: string | null;
};

function createDockTerminalId() {
  return `dock-terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStoredTabs(): DockTerminalTab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TABS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DockTerminalTab[];
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item?.id === "string" && typeof item?.title === "string")
      : [];
  } catch {
    return [];
  }
}

function readStoredActiveTabId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
}

function persistTabs(tabs: DockTerminalTab[], activeTabId: string | null) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
  if (activeTabId) {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
  } else {
    window.localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
  }
}

function nextTerminalTitle(tabs: DockTerminalTab[]) {
  const numbers = tabs
    .map((tab) => {
      const match = tab.title.match(/^终端\s*(\d+)$/);
      return match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
    })
    .filter((value) => Number.isFinite(value));
  const next = numbers.length ? Math.max(...numbers) + 1 : 1;
  return `终端 ${next}`;
}

function createDockTerminalTab(defaults?: {
  workspaceId?: string | null;
  cwd?: string | null;
  title?: string;
}): DockTerminalTab {
  return {
    id: createDockTerminalId(),
    title: defaults?.title ?? "终端 1",
    workspaceId: defaults?.workspaceId ?? null,
    cwd: defaults?.cwd ?? null,
  };
}

function XtermSurface({
  terminalTabId,
  workspaceId,
  cwd,
  initialContent,
  onData,
}: {
  terminalTabId: string;
  workspaceId: string | null;
  cwd: string | null;
  initialContent: string;
  onData: (tabId: string, data: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initialContentRef = useRef(initialContent);

  useEffect(() => {
    initialContentRef.current = initialContent;
  }, [initialContent]);

  useEffect(() => {
    if (!hostRef.current) return;

    const terminal = new Terminal({
      fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.45,
      cursorBlink: true,
      allowTransparency: false,
      theme: {
        background: "#0f141c",
        foreground: "#d9dee7",
        cursor: "#d9dee7",
        selectionBackground: "rgba(96, 165, 250, 0.28)",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    if (initialContentRef.current) {
      terminal.write(initialContentRef.current);
    }

    const dataDisposable = terminal.onData((data) => {
      void bridge.writePtyInput({ terminalTabId, data });
    });

    void bridge.ensurePtySession({
      terminalTabId,
      workspaceId,
      cwd,
      cols: terminal.cols,
      rows: terminal.rows,
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!terminalRef.current || !fitAddonRef.current) return;
      fitAddonRef.current.fit();
      void bridge.resizePtySession({
        terminalTabId,
        cols: terminalRef.current.cols,
        rows: terminalRef.current.rows,
      });
    });
    resizeObserver.observe(hostRef.current);

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [cwd, terminalTabId, workspaceId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.reset();
    if (initialContent) {
      terminal.write(initialContent);
    }
  }, [initialContent, terminalTabId]);

  useEffect(() => {
    const unlistenPromise = bridge.onPtyOutput((event) => {
      if (event.terminalTabId !== terminalTabId) return;
      onData(terminalTabId, event.data);
      terminalRef.current?.write(event.data);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [onData, terminalTabId]);

  return <div ref={hostRef} className="terminal-xterm-host" />;
}

export function TerminalDock({
  isOpen,
  onToggleOpen,
  defaultWorkspace,
}: {
  isOpen: boolean;
  onToggleOpen: () => void;
  defaultWorkspace?: {
    id: string;
    rootPath: string;
    name: string;
  } | null;
}) {
  const [height, setHeight] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_HEIGHT;
    const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY);
    const value = raw ? Number(raw) : DEFAULT_HEIGHT;
    return Number.isFinite(value) ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value)) : DEFAULT_HEIGHT;
  });
  const [terminalTabs, setTerminalTabs] = useState<DockTerminalTab[]>(() => readStoredTabs());
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string | null>(() => readStoredActiveTabId());
  const cleanupRef = useRef<(() => void) | null>(null);
  const outputBuffersRef = useRef<Record<string, string>>({});
  const previousTabIdsRef = useRef<string[]>([]);
  const wasOpenRef = useRef(false);

  const activeTab = useMemo(
    () => terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null,
    [activeTerminalTabId, terminalTabs]
  );
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (activeTerminalTabId && terminalTabs.some((tab) => tab.id === activeTerminalTabId)) {
      persistTabs(terminalTabs, activeTerminalTabId);
      return;
    }
    const fallbackId = terminalTabs[0]?.id ?? null;
    if (fallbackId !== activeTerminalTabId) {
      setActiveTerminalTabId(fallbackId);
      persistTabs(terminalTabs, fallbackId);
      return;
    }
    persistTabs(terminalTabs, fallbackId);
  }, [activeTerminalTabId, terminalTabs]);

  useEffect(() => {
    const openedNow = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (!isOpen || terminalTabs.length > 0 || !openedNow) {
      return;
    }
    const nextTab = createDockTerminalTab({
      title: "终端 1",
      workspaceId: defaultWorkspace?.id ?? null,
      cwd: defaultWorkspace?.rootPath ?? null,
    });
    setTerminalTabs([nextTab]);
    setActiveTerminalTabId(nextTab.id);
  }, [defaultWorkspace?.id, defaultWorkspace?.rootPath, isOpen, terminalTabs.length]);

  useEffect(() => {
    const previous = previousTabIdsRef.current;
    const current = terminalTabs.map((tab) => tab.id);
    const removed = previous.filter((id) => !current.includes(id));
    removed.forEach((id) => {
      delete outputBuffersRef.current[id];
      void bridge.closePtySession(id);
    });
    previousTabIdsRef.current = current;
  }, [terminalTabs]);

  function persistHeight(next: number) {
    setHeight(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(next));
    }
  }

  function handleResizeStart(event: ReactMouseEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    cleanupRef.current?.();

    const startY = event.clientY;
    const startHeight = height;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + deltaY));
      persistHeight(next);
    };

    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
      cleanupRef.current = null;
    };

    cleanupRef.current = finish;
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", finish);
  }

  function handleNewTerminal() {
    const nextTab = createDockTerminalTab({
      title: nextTerminalTitle(terminalTabs),
      workspaceId: defaultWorkspace?.id ?? activeTab?.workspaceId ?? null,
      cwd: defaultWorkspace?.rootPath ?? activeTab?.cwd ?? null,
    });
    setTerminalTabs((current) => [...current, nextTab]);
    setActiveTerminalTabId(nextTab.id);
  }

  function handleCloseTab(tabId: string) {
    void bridge.closePtySession(tabId);
    delete outputBuffersRef.current[tabId];
    setTerminalTabs((current) => {
      const nextTabs = current.filter((tab) => tab.id !== tabId);
      setActiveTerminalTabId((currentActive) => {
        if (currentActive !== tabId) {
          return currentActive;
        }
        const closedIndex = current.findIndex((tab) => tab.id === tabId);
        return nextTabs[closedIndex]?.id ?? nextTabs[closedIndex - 1]?.id ?? nextTabs[0]?.id ?? null;
      });
      return nextTabs;
    });
  }

  function handleBufferData(tabId: string, data: string) {
    outputBuffersRef.current[tabId] = `${outputBuffersRef.current[tabId] ?? ""}${data}`;
  }

  if (!isOpen) {
    return null;
  }

  return (
    <section className="terminal-panel" style={{ height }}>
      <div
        className="terminal-panel-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
        onMouseDown={handleResizeStart}
      />
      <div className="terminal-header">
        <div className="terminal-tabs" role="tablist" aria-label="Terminal tabs">
          {terminalTabs.map((tab) => {
            const isActive = tab.id === activeTerminalTabId;
            return (
              <button
                key={tab.id}
                className={`terminal-tab${isActive ? " active" : ""}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTerminalTabId(tab.id)}
                title={tab.cwd ?? tab.title}
              >
                <span className="terminal-tab-label">{tab.title}</span>
                <span
                  className="terminal-tab-close"
                  role="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={(innerEvent) => {
                    innerEvent.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                >
                  ×
                </span>
              </button>
            );
          })}
          <button
            className="terminal-tab-add"
            type="button"
            onClick={handleNewTerminal}
            aria-label="New terminal"
            title="New terminal"
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="terminal-dock-toggle"
          onClick={onToggleOpen}
          aria-label="Hide terminal panel"
          title="Hide terminal panel"
        >
          ×
        </button>
      </div>
      <div className="terminal-body">
        <div className="terminal-shell">
          <div className="terminal-surface">
            {activeTab ? (
              <XtermSurface
                terminalTabId={activeTab.id}
                workspaceId={activeTab.workspaceId}
                cwd={activeTab.cwd}
                initialContent={outputBuffersRef.current[activeTab.id] ?? ""}
                onData={handleBufferData}
              />
            ) : (
              <div className="terminal-overlay">
                <div className="terminal-status">没有终端，点击 + 创建一个。</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function useTerminalDockState() {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(OPEN_STORAGE_KEY) === "true";
  });

  function persist(next: boolean) {
    setOpen(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(OPEN_STORAGE_KEY, String(next));
    }
  }

  function toggle() {
    setOpen((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(OPEN_STORAGE_KEY, String(next));
      }
      return next;
    });
  }

  function openDock() {
    persist(true);
  }

  function closeDock() {
    persist(false);
  }

  return { open, toggle, openDock, closeDock };
}
