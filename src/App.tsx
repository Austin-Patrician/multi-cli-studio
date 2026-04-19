import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { useEffect } from "react";
import { AppLayout } from "./layouts/AppLayout";
import { TerminalPage } from "./pages/TerminalPage";
import { AutomationJobsPage } from "./pages/AutomationJobsPage";
import { AutomationJobEditorPage } from "./pages/AutomationJobEditorPage";
import { AutomationWorkflowsPage } from "./pages/AutomationWorkflowsPage";
import { AutomationWorkflowEditorPage } from "./pages/AutomationWorkflowEditorPage";
import { ModelChatPage } from "./pages/ModelChatPage";
import { ModelProviderEditorPage } from "./pages/ModelProviderEditorPage";
import { ModelProvidersPage } from "./pages/ModelProvidersPage";
import { DesktopAgentsPage } from "./pages/DesktopAgentsPage";
import { DesktopSettingsPage } from "./pages/DesktopSettingsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useStore } from "./lib/store";
import { bridge } from "./lib/bridge";

function ModelProvidersRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={{
        pathname: "/settings/model-providers",
        search: location.search,
      }}
      replace
    />
  );
}

function ModelProviderEditorRedirect() {
  const location = useLocation();
  const { serviceType, providerId } = useParams();
  const pathname =
    serviceType && providerId
      ? `/settings/model-providers/${serviceType}/${providerId}`
      : "/settings/model-providers";

  return (
    <Navigate
      to={{
        pathname,
        search: location.search,
      }}
      replace
    />
  );
}

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
          event.transportKind ?? null,
          event.interruptedByUser ?? null
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
      <Route path="/settings" element={<DesktopSettingsPage />}>
        <Route
          path="general"
          element={<SettingsPage embedded forcedSection="settings" hideSectionTabs />}
        />
        <Route path="model-providers" element={<ModelProvidersPage embedded />} />
        <Route path="model-providers/new" element={<ModelProviderEditorPage embedded />} />
        <Route
          path="model-providers/:serviceType/:providerId"
          element={<ModelProviderEditorPage embedded />}
        />
        <Route path="agents" element={<DesktopAgentsPage />} />
      </Route>
      <Route path="/model-providers" element={<ModelProvidersRedirect />} />
      <Route path="/model-providers/new" element={<ModelProviderEditorRedirect />} />
      <Route
        path="/model-providers/:serviceType/:providerId"
        element={<ModelProviderEditorRedirect />}
      />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/terminal" replace />} />
        <Route path="/terminal" element={<TerminalPage />} />
        <Route path="/model-chat" element={<ModelChatPage />} />
        <Route path="/automation" element={<AutomationJobsPage />} />
        <Route path="/automation/workflows" element={<AutomationWorkflowsPage />} />
        <Route path="/automation/workflows/new" element={<AutomationWorkflowEditorPage />} />
        <Route path="/automation/workflows/:workflowId" element={<AutomationWorkflowEditorPage />} />
        <Route path="/automation/new" element={<AutomationJobEditorPage />} />
        <Route path="/automation/jobs/new" element={<AutomationJobEditorPage />} />
        <Route path="/automation/jobs/:jobId" element={<AutomationJobEditorPage />} />
      </Route>
    </Routes>
  );
}

export default App;
