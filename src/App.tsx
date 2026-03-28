import { Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { AppLayout } from "./layouts/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { TerminalPage } from "./pages/TerminalPage";
import { HandoffPage } from "./pages/HandoffPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useStore } from "./lib/store";
import { bridge } from "./lib/bridge";

function App() {
  const loadInitialState = useStore((s) => s.loadInitialState);
  const setAppState = useStore((s) => s.setAppState);
  const appendTerminalLine = useStore((s) => s.appendTerminalLine);
  const appendStreamChunk = useStore((s) => s.appendStreamChunk);
  const finalizeStream = useStore((s) => s.finalizeStream);

  useEffect(() => {
    let cancelled = false;
    let unlistenState = () => {};
    let unlistenTerminal = () => {};
    let unlistenStream = () => {};
    let flushTimer: number | null = null;
    const pendingChunks = new Map<
      string,
      {
        terminalTabId: string;
        messageId: string;
        chunk: string;
        blocks: Parameters<typeof appendStreamChunk>[3];
      }
    >();

    function flushPendingChunks() {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
      for (const pending of pendingChunks.values()) {
        appendStreamChunk(
          pending.terminalTabId,
          pending.messageId,
          pending.chunk,
          pending.blocks ?? null
        );
      }
      pendingChunks.clear();
    }

    loadInitialState();

    bridge.onState((state) => {
      if (!cancelled) setAppState(state);
    }).then((unlisten) => {
      unlistenState = unlisten;
    });

    bridge.onTerminal((event) => {
      if (!cancelled) appendTerminalLine(event.agentId, event.line);
    }).then((unlisten) => {
      unlistenTerminal = unlisten;
    });

    bridge.onStream((event) => {
      if (cancelled) return;
      if (event.done) {
        flushPendingChunks();
        finalizeStream(
          event.terminalTabId,
          event.messageId,
          event.exitCode ?? null,
          event.durationMs ?? 0,
          event.finalContent ?? null,
          event.contentFormat ?? null,
          event.blocks ?? null,
          event.transportSession ?? null,
          event.transportKind ?? null
        );
      } else {
        const key = `${event.terminalTabId}:${event.messageId}`;
        const existing = pendingChunks.get(key);
        if (existing) {
          existing.chunk += event.chunk;
          existing.blocks = event.blocks ?? existing.blocks ?? null;
        } else {
          pendingChunks.set(key, {
            terminalTabId: event.terminalTabId,
            messageId: event.messageId,
            chunk: event.chunk,
            blocks: event.blocks ?? null,
          });
        }

        if (flushTimer === null) {
          flushTimer = window.setTimeout(() => {
            flushPendingChunks();
          }, 40);
        }
      }
    }).then((unlisten) => {
      unlistenStream = unlisten;
    });

    return () => {
      cancelled = true;
      flushPendingChunks();
      unlistenState();
      unlistenTerminal();
      unlistenStream();
    };
  }, []);

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/terminal" element={<TerminalPage />} />
        <Route path="/handoff" element={<HandoffPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
