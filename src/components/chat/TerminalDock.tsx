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
import { useStore } from "../../lib/store";

const OPEN_STORAGE_KEY = "multi-cli-studio::terminal-dock-open";
const HEIGHT_STORAGE_KEY = "multi-cli-studio::terminal-dock-height";
const DEFAULT_HEIGHT = 220;
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 520;

function XtermSurface({
  terminalTabId,
  cwd,
  initialContent,
  onData,
}: {
  terminalTabId: string;
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
  }, [cwd, terminalTabId]);

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
}: {
  isOpen: boolean;
  onToggleOpen: () => void;
}) {
  const terminalTabs = useStore((state) => state.terminalTabs);
  const activeTerminalTabId = useStore((state) => state.activeTerminalTabId);
  const setActiveTerminalTab = useStore((state) => state.setActiveTerminalTab);
  const createTerminalTab = useStore((state) => state.createTerminalTab);
  const closeTerminalTab = useStore((state) => state.closeTerminalTab);
  const workspaces = useStore((state) => state.workspaces);

  const [height, setHeight] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_HEIGHT;
    const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY);
    const value = raw ? Number(raw) : DEFAULT_HEIGHT;
    return Number.isFinite(value) ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value)) : DEFAULT_HEIGHT;
  });
  const cleanupRef = useRef<(() => void) | null>(null);
  const outputBuffersRef = useRef<Record<string, string>>({});
  const previousTabIdsRef = useRef<string[]>([]);

  const activeTab = useMemo(
    () => terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null,
    [activeTerminalTabId, terminalTabs]
  );
  const activeWorkspace = useMemo(
    () => workspaces.find((item) => item.id === activeTab?.workspaceId) ?? null,
    [activeTab?.workspaceId, workspaces]
  );

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

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
    createTerminalTab(activeTab?.workspaceId);
  }

  function handleCloseTab(tabId: string) {
    void bridge.closePtySession(tabId);
    delete outputBuffersRef.current[tabId];
    closeTerminalTab(tabId);
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
            const workspace = workspaces.find((item) => item.id === tab.workspaceId) ?? null;
            const isActive = tab.id === activeTerminalTabId;
            return (
              <button
                key={tab.id}
                className={`terminal-tab${isActive ? " active" : ""}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTerminalTab(tab.id)}
                title={workspace?.rootPath ?? tab.title}
              >
                <span className="terminal-tab-label">{tab.title}</span>
                {terminalTabs.length > 1 ? (
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
                ) : null}
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
                cwd={activeWorkspace?.rootPath ?? null}
                initialContent={outputBuffersRef.current[activeTab.id] ?? ""}
                onData={handleBufferData}
              />
            ) : (
              <div className="terminal-overlay">
                <div className="terminal-status">No active terminal tab.</div>
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

  function toggle() {
    setOpen((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(OPEN_STORAGE_KEY, String(next));
      }
      return next;
    });
  }

  return { open, toggle };
}
