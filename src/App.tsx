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
        appendStreamChunk(event.terminalTabId, event.messageId, event.chunk);
      }
    }).then((unlisten) => {
      unlistenStream = unlisten;
    });

    return () => {
      cancelled = true;
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
