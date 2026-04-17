import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspaceRef } from "../../lib/models";

const STORAGE_KEY = "multi-cli-studio::workspace-launch-scripts";

type LaunchScriptMap = Record<string, string>;

function readLaunchScripts(): LaunchScriptMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as LaunchScriptMap;
  } catch {
    return {};
  }
}

function writeLaunchScripts(next: LaunchScriptMap) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export type WorkspaceLaunchScriptState = {
  launchScript: string | null;
  editorOpen: boolean;
  draftScript: string;
  isSaving: boolean;
  error: string | null;
  onRunLaunchScript: () => Promise<void>;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
  onDraftScriptChange: (value: string) => void;
  onSaveLaunchScript: () => Promise<void>;
};

export function useWorkspaceLaunchScript({
  activeWorkspace,
  onOpenRuntimeConsole,
  onRunProjectWithCommand,
}: {
  activeWorkspace: WorkspaceRef | null;
  onOpenRuntimeConsole: () => void;
  onRunProjectWithCommand: (command: string) => Promise<void>;
}): WorkspaceLaunchScriptState {
  const workspaceKey = activeWorkspace?.rootPath ?? null;
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftScript, setDraftScript] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storedScripts, setStoredScripts] = useState<LaunchScriptMap>(() => readLaunchScripts());

  const launchScript = useMemo(() => {
    if (!workspaceKey) return null;
    const next = storedScripts[workspaceKey]?.trim() ?? "";
    return next.length > 0 ? storedScripts[workspaceKey] ?? null : null;
  }, [storedScripts, workspaceKey]);

  useEffect(() => {
    setEditorOpen(false);
    setDraftScript(launchScript ?? "");
    setError(null);
  }, [launchScript, workspaceKey]);

  const onOpenEditor = useCallback(() => {
    setDraftScript(launchScript ?? "");
    setEditorOpen(true);
    setError(null);
  }, [launchScript]);

  const onCloseEditor = useCallback(() => {
    setEditorOpen(false);
    setError(null);
  }, []);

  const onDraftScriptChange = useCallback((value: string) => {
    setDraftScript(value);
  }, []);

  const onSaveLaunchScript = useCallback(async () => {
    if (!workspaceKey) return;

    setIsSaving(true);
    setError(null);
    try {
      const trimmed = draftScript.trim();
      const next = { ...readLaunchScripts() };
      if (trimmed.length === 0) {
        delete next[workspaceKey];
      } else {
        next[workspaceKey] = draftScript;
      }
      writeLaunchScripts(next);
      setStoredScripts(next);
      setEditorOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  }, [draftScript, workspaceKey]);

  const onRunLaunchScript = useCallback(async () => {
    const script = launchScript?.trim() ?? "";
    if (!script) {
      onOpenEditor();
      return;
    }
    setError(null);
    onOpenRuntimeConsole();
    try {
      await onRunProjectWithCommand(script);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    }
  }, [launchScript, onOpenEditor, onOpenRuntimeConsole, onRunProjectWithCommand]);

  return {
    launchScript,
    editorOpen,
    draftScript,
    isSaving,
    error,
    onRunLaunchScript,
    onOpenEditor,
    onCloseEditor,
    onDraftScriptChange,
    onSaveLaunchScript,
  };
}
