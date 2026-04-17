import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceRef } from "../../lib/models";
import {
  bridge,
  type RuntimeLogOutputEvent,
  type RuntimeLogSessionSnapshot,
  type RuntimeLogSessionStatus,
  type RuntimeProfileDescriptor,
} from "../../lib/bridge";

const RUNTIME_TERMINAL_ID = "runtime-console";
const MAX_LOG_LINES = 5000;
const EXIT_CODE_PATTERN = /\[(?:multi-cli|ccgui|CodeMoss) Run\] __EXIT__:(-?\d+)/;

export type RuntimeConsoleStatus = "idle" | "starting" | "running" | "stopped" | "error";
export type RuntimeCommandPresetId =
  | "auto"
  | "java-maven"
  | "java-gradle"
  | "node-dev"
  | "node-start"
  | "python-main"
  | "go-run"
  | "custom";

type RuntimeWorkspaceSession = {
  visible: boolean;
  status: RuntimeConsoleStatus;
  commandPreview: string | null;
  commandPresetId: RuntimeCommandPresetId;
  commandInput: string;
  log: string;
  error: string | null;
  truncated: boolean;
  exitCode: number | null;
  autoScroll: boolean;
  wrapLines: boolean;
};

export type RuntimeLogSessionState = {
  onOpenRuntimeConsole: () => void;
  onSelectRuntimeCommandPreset: (presetId: RuntimeCommandPresetId) => void;
  onChangeRuntimeCommandInput: (value: string) => void;
  onRunProject: () => Promise<void>;
  onRunProjectWithCommand: (command: string) => Promise<void>;
  onStopProject: () => Promise<void>;
  onClearRuntimeLogs: () => void;
  onCopyRuntimeLogs: () => Promise<void>;
  onToggleRuntimeAutoScroll: () => void;
  onToggleRuntimeWrapLines: () => void;
  onCloseRuntimeConsole: () => void;
  runtimeAutoScroll: boolean;
  runtimeWrapLines: boolean;
  runtimeConsoleVisible: boolean;
  runtimeConsoleStatus: RuntimeConsoleStatus;
  runtimeConsoleCommandPreview: string | null;
  runtimeCommandPresetOptions: RuntimeCommandPresetId[];
  runtimeCommandPresetId: RuntimeCommandPresetId;
  runtimeCommandInput: string;
  runtimeConsoleLog: string;
  runtimeConsoleError: string | null;
  runtimeConsoleTruncated: boolean;
  runtimeConsoleExitCode: number | null;
};

const DEFAULT_SESSION: RuntimeWorkspaceSession = {
  visible: false,
  status: "idle",
  commandPreview: null,
  commandPresetId: "auto",
  commandInput: "",
  log: "",
  error: null,
  truncated: false,
  exitCode: null,
  autoScroll: true,
  wrapLines: true,
};

function normalizeProfilePresetId(rawId: string | null | undefined): RuntimeCommandPresetId | null {
  switch (rawId) {
    case "java-maven":
    case "java-gradle":
    case "node-dev":
    case "node-start":
    case "python-main":
    case "go-run":
      return rawId;
    default:
      return null;
  }
}

function resolveCommandPresetId(
  command: string,
  detectedProfiles: RuntimeProfileDescriptor[],
  profileId?: string | null,
): RuntimeCommandPresetId {
  const matchedProfileId = normalizeProfilePresetId(profileId);
  if (matchedProfileId) {
    return matchedProfileId;
  }
  const normalized = command.trim();
  if (!normalized) {
    return "auto";
  }
  const matchedProfile = detectedProfiles.find(
    (profile) => profile.defaultCommand.trim() === normalized,
  );
  return normalizeProfilePresetId(matchedProfile?.id) ?? "custom";
}

function appendRuntimeLog(current: string, chunk: string): { next: string; truncated: boolean } {
  const merged = current + chunk;
  const segments = merged.split("\n");
  const maxSegments = MAX_LOG_LINES + 1;
  if (segments.length <= maxSegments) {
    return { next: merged, truncated: false };
  }
  return {
    next: segments.slice(segments.length - maxSegments).join("\n"),
    truncated: true,
  };
}

function mapRuntimeStatus(status: RuntimeLogSessionStatus): RuntimeConsoleStatus {
  switch (status) {
    case "starting":
      return "starting";
    case "running":
    case "stopping":
      return "running";
    case "stopped":
      return "stopped";
    case "failed":
      return "error";
    default:
      return "idle";
  }
}

function applyRuntimeSnapshot(
  current: RuntimeWorkspaceSession,
  snapshot: RuntimeLogSessionSnapshot,
  detectedProfiles: RuntimeProfileDescriptor[],
): RuntimeWorkspaceSession {
  const mappedStatus = mapRuntimeStatus(snapshot.status);
  const nextCommandInput =
    current.commandInput.trim().length === 0 && snapshot.commandPreview
      ? snapshot.commandPreview
      : current.commandInput;
  return {
    ...current,
    visible:
      current.visible ||
      mappedStatus === "running" ||
      mappedStatus === "starting",
    status: mappedStatus,
    commandPreview: snapshot.commandPreview,
    commandPresetId: resolveCommandPresetId(
      nextCommandInput,
      detectedProfiles,
      snapshot.profileId,
    ),
    commandInput: nextCommandInput,
    exitCode: snapshot.exitCode,
    error: snapshot.error,
  };
}

export function useRuntimeLogSession({
  activeWorkspace,
}: {
  activeWorkspace: WorkspaceRef | null;
}): RuntimeLogSessionState {
  const [sessionByWorkspace, setSessionByWorkspace] = useState<Record<string, RuntimeWorkspaceSession>>(
    {},
  );
  const [detectedProfilesByWorkspace, setDetectedProfilesByWorkspace] = useState<
    Record<string, RuntimeProfileDescriptor[]>
  >({});
  const exitBufferByWorkspaceRef = useRef<Record<string, string>>({});
  const detectedProfilesByWorkspaceRef = useRef<Record<string, RuntimeProfileDescriptor[]>>({});
  const previousWorkspaceIdRef = useRef<string | null>(null);
  const activeWorkspaceId = activeWorkspace?.id ?? null;

  useEffect(() => {
    detectedProfilesByWorkspaceRef.current = detectedProfilesByWorkspace;
  }, [detectedProfilesByWorkspace]);

  const switchedWorkspace = previousWorkspaceIdRef.current !== activeWorkspaceId;

  useEffect(() => {
    previousWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  const updateWorkspaceSession = useCallback(
    (
      workspaceId: string,
      updater: (current: RuntimeWorkspaceSession) => RuntimeWorkspaceSession,
    ) => {
      setSessionByWorkspace((prev) => {
        const current = prev[workspaceId] ?? {
          ...DEFAULT_SESSION,
        };
        return {
          ...prev,
          [workspaceId]: updater(current),
        };
      });
    },
    [],
  );

  const appendWorkspaceLog = useCallback(
    (workspaceId: string, chunk: string) => {
      updateWorkspaceSession(workspaceId, (current) => {
        const appended = appendRuntimeLog(current.log, chunk);
        return {
          ...current,
          log: appended.next,
          truncated: current.truncated || appended.truncated,
        };
      });
    },
    [updateWorkspaceSession],
  );

  const consumeExitCode = useCallback(
    (workspaceId: string, chunk: string) => {
      const combined = `${exitBufferByWorkspaceRef.current[workspaceId] ?? ""}${chunk}`;
      const matches = Array.from(combined.matchAll(EXIT_CODE_PATTERN));
      exitBufferByWorkspaceRef.current[workspaceId] = combined.slice(-160);
      if (matches.length === 0) {
        return null;
      }
      const last = matches[matches.length - 1];
      const parsed = Number.parseInt(last?.[1] ?? "", 10);
      return Number.isNaN(parsed) ? null : parsed;
    },
    [],
  );

  useEffect(() => {
    const handleOutput = (event: RuntimeLogOutputEvent) => {
      if (event.terminalId !== RUNTIME_TERMINAL_ID) {
        return;
      }
      appendWorkspaceLog(event.workspaceId, event.data);

      const exitCode = consumeExitCode(event.workspaceId, event.data);
      if (exitCode === null) {
        updateWorkspaceSession(event.workspaceId, (current) => ({
          ...current,
          visible: true,
          status:
            current.status === "starting" || current.status === "idle" || current.status === "stopped"
              ? "running"
              : current.status,
        }));
        return;
      }

      updateWorkspaceSession(event.workspaceId, (current) => ({
        ...current,
        visible: true,
        exitCode,
        status: exitCode === 0 ? "stopped" : "error",
        error: exitCode === 0 ? null : `Process exited with code ${exitCode}.`,
      }));
      void bridge.runtimeLogMarkExit(event.workspaceId, exitCode).catch(() => undefined);
    };

    let unlisten: (() => void) | null = null;
    void bridge.onRuntimeLogOutput(handleOutput).then((next) => {
      unlisten = next;
    });
    return () => {
      unlisten?.();
    };
  }, [appendWorkspaceLog, consumeExitCode, updateWorkspaceSession]);

  useEffect(() => {
    let unlistenStatus: (() => void) | null = null;
    let unlistenExited: (() => void) | null = null;

    void bridge
      .onRuntimeLogStatus((event) => {
        updateWorkspaceSession(event.workspaceId, (current) =>
          applyRuntimeSnapshot(
            current,
            event,
            detectedProfilesByWorkspaceRef.current[event.workspaceId] ?? [],
          ),
        );
      })
      .then((next) => {
        unlistenStatus = next;
      });

    void bridge
      .onRuntimeLogExited((event) => {
        updateWorkspaceSession(event.workspaceId, (current) =>
          applyRuntimeSnapshot(
            current,
            event,
            detectedProfilesByWorkspaceRef.current[event.workspaceId] ?? [],
          ),
        );
      })
      .then((next) => {
        unlistenExited = next;
      });

    return () => {
      unlistenStatus?.();
      unlistenExited?.();
    };
  }, [updateWorkspaceSession]);

  useEffect(() => {
    setSessionByWorkspace((prev) => {
      let changed = false;
      const next: Record<string, RuntimeWorkspaceSession> = {};

      for (const [workspaceId, session] of Object.entries(prev)) {
        if (
          session.visible &&
          session.status !== "running" &&
          session.status !== "starting"
        ) {
          next[workspaceId] = {
            ...session,
            visible: false,
          };
          changed = true;
        } else {
          next[workspaceId] = session;
        }
      }

      return changed ? next : prev;
    });
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    let cancelled = false;
    bridge.runtimeLogDetectProfiles(activeWorkspaceId)
      .then((profiles) => {
        if (cancelled) {
          return;
        }
        setDetectedProfilesByWorkspace((prev) => ({
          ...prev,
          [activeWorkspaceId]: profiles,
        }));
        updateWorkspaceSession(activeWorkspaceId, (current) => ({
          ...current,
          commandPresetId: resolveCommandPresetId(
            current.commandInput,
            profiles,
            current.commandPresetId === "custom" ? null : current.commandPresetId,
          ),
        }));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setDetectedProfilesByWorkspace((prev) => ({
          ...prev,
          [activeWorkspaceId]: [],
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, updateWorkspaceSession]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    let cancelled = false;
    bridge.runtimeLogGetSession(activeWorkspaceId)
      .then((snapshot) => {
        if (cancelled || !snapshot) {
          return;
        }
        updateWorkspaceSession(activeWorkspaceId, (current) =>
          applyRuntimeSnapshot(
            current,
            snapshot,
            detectedProfilesByWorkspaceRef.current[activeWorkspaceId] ?? [],
          ),
        );
      })
      .catch(() => {
        // Ignore restore failures.
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, updateWorkspaceSession]);

  const activeDetectedProfiles = useMemo(
    () => (activeWorkspaceId ? detectedProfilesByWorkspace[activeWorkspaceId] ?? [] : []),
    [activeWorkspaceId, detectedProfilesByWorkspace],
  );

  const activeSession = useMemo<RuntimeWorkspaceSession>(() => {
    if (!activeWorkspaceId) {
      return {
        ...DEFAULT_SESSION,
      };
    }
    const session = sessionByWorkspace[activeWorkspaceId] ?? {
      ...DEFAULT_SESSION,
    };
    if (
      switchedWorkspace &&
      session.visible &&
      session.status !== "running" &&
      session.status !== "starting"
    ) {
      return {
        ...session,
        visible: false,
      };
    }
    return session;
  }, [activeWorkspaceId, sessionByWorkspace]);

  const onSelectRuntimeCommandPreset = useCallback(
    (presetId: RuntimeCommandPresetId) => {
      if (!activeWorkspaceId) {
        return;
      }
      updateWorkspaceSession(activeWorkspaceId, (current) => {
        if (presetId === "custom") {
          return {
            ...current,
            commandPresetId: "custom",
          };
        }
        if (presetId === "auto") {
          return {
            ...current,
            commandPresetId: "auto",
            commandInput: "",
          };
        }
        const selectedProfile = activeDetectedProfiles.find((profile) => profile.id === presetId);
        if (!selectedProfile) {
          return current;
        }
        return {
          ...current,
          commandPresetId: presetId,
          commandInput: selectedProfile.defaultCommand,
        };
      });
    },
    [activeDetectedProfiles, activeWorkspaceId, updateWorkspaceSession],
  );

  const onChangeRuntimeCommandInput = useCallback(
    (value: string) => {
      if (!activeWorkspaceId) {
        return;
      }
      updateWorkspaceSession(activeWorkspaceId, (current) => ({
        ...current,
        commandInput: value,
        commandPresetId: resolveCommandPresetId(value, activeDetectedProfiles),
      }));
    },
    [activeDetectedProfiles, activeWorkspaceId, updateWorkspaceSession],
  );

  const runtimeCommandPresetOptions = useMemo<RuntimeCommandPresetId[]>(() => {
    const detectedIds = activeDetectedProfiles
      .map((profile) => normalizeProfilePresetId(profile.id))
      .filter((value): value is Exclude<RuntimeCommandPresetId, "auto" | "custom"> => value !== null);
    return ["auto", ...Array.from(new Set(detectedIds)), "custom"];
  }, [activeDetectedProfiles]);

  const runProjectWithCommand = useCallback(async (explicitCommand?: string | null) => {
    const workspaceId = activeWorkspace?.id;
    if (!workspaceId) {
      return;
    }

    const normalizedInput = (explicitCommand ?? activeSession.commandInput).trim();
    const selectedProfile =
      activeDetectedProfiles.find(
        (profile) => normalizeProfilePresetId(profile.id) === activeSession.commandPresetId,
      ) ?? null;
    const selectedDefaultCommand = selectedProfile?.defaultCommand.trim() ?? "";
    const shouldUseDetectedProfile =
      Boolean(selectedProfile) &&
      activeSession.commandPresetId !== "auto" &&
      activeSession.commandPresetId !== "custom" &&
      (normalizedInput.length === 0 || normalizedInput === selectedDefaultCommand);
    const profileId = shouldUseDetectedProfile ? selectedProfile?.id ?? null : null;
    const commandOverride =
      normalizedInput.length > 0 && !shouldUseDetectedProfile ? normalizedInput : null;

    exitBufferByWorkspaceRef.current[workspaceId] = "";
    updateWorkspaceSession(workspaceId, (current) => ({
      ...current,
      visible: true,
      status: "starting",
      commandPreview: null,
      commandInput: normalizedInput,
      commandPresetId: resolveCommandPresetId(normalizedInput, activeDetectedProfiles),
      error: null,
      exitCode: null,
      truncated: false,
      autoScroll: true,
    }));
    appendWorkspaceLog(
      workspaceId,
      `\n[multi-cli Run] Starting at ${new Date().toLocaleTimeString()}\n`,
    );

    try {
      const snapshot = await bridge.runtimeLogStart(workspaceId, {
        profileId,
        commandOverride,
      });
      updateWorkspaceSession(workspaceId, (current) => ({
        ...applyRuntimeSnapshot(current, snapshot, activeDetectedProfiles),
        visible: true,
        status: "running",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateWorkspaceSession(workspaceId, (current) => ({
        ...current,
        status: "error",
        error: message,
      }));
      appendWorkspaceLog(
        workspaceId,
        `[multi-cli Run] Failed to start runtime: ${message}\n`,
      );
    }
  }, [
    activeDetectedProfiles,
    activeSession.commandInput,
    activeSession.commandPresetId,
    activeWorkspace,
    appendWorkspaceLog,
    updateWorkspaceSession,
  ]);

  const onRunProject = useCallback(async () => {
    await runProjectWithCommand(null);
  }, [runProjectWithCommand]);

  const onRunProjectWithCommand = useCallback(
    async (command: string) => {
      await runProjectWithCommand(command);
    },
    [runProjectWithCommand],
  );

  const onOpenRuntimeConsole = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    updateWorkspaceSession(activeWorkspaceId, (current) => ({
      ...current,
      visible: true,
    }));
  }, [activeWorkspaceId, updateWorkspaceSession]);

  const onStopProject = useCallback(async () => {
    const workspaceId = activeWorkspace?.id;
    if (!workspaceId) {
      return;
    }
    try {
      const snapshot = await bridge.runtimeLogStop(workspaceId);
      updateWorkspaceSession(workspaceId, (current) => ({
        ...applyRuntimeSnapshot(current, snapshot, activeDetectedProfiles),
        status: "stopped",
      }));
      appendWorkspaceLog(workspaceId, "[multi-cli Run] Stopped.\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateWorkspaceSession(workspaceId, (current) => ({
        ...current,
        status: "error",
        error: message,
      }));
      appendWorkspaceLog(workspaceId, `[multi-cli Run] Failed to stop runtime: ${message}\n`);
    }
  }, [activeDetectedProfiles, activeWorkspace, appendWorkspaceLog, updateWorkspaceSession]);

  const onClearRuntimeLogs = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    updateWorkspaceSession(activeWorkspaceId, (current) => ({
      ...current,
      log: "",
      error: null,
      truncated: false,
      exitCode: null,
    }));
    exitBufferByWorkspaceRef.current[activeWorkspaceId] = "";
  }, [activeWorkspaceId, updateWorkspaceSession]);

  const onCopyRuntimeLogs = useCallback(async () => {
    if (!activeSession.log || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(activeSession.log);
  }, [activeSession.log]);

  const onToggleRuntimeAutoScroll = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    updateWorkspaceSession(activeWorkspaceId, (current) => ({
      ...current,
      autoScroll: !current.autoScroll,
    }));
  }, [activeWorkspaceId, updateWorkspaceSession]);

  const onToggleRuntimeWrapLines = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    updateWorkspaceSession(activeWorkspaceId, (current) => ({
      ...current,
      wrapLines: !current.wrapLines,
    }));
  }, [activeWorkspaceId, updateWorkspaceSession]);

  const onCloseRuntimeConsole = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    updateWorkspaceSession(activeWorkspaceId, (current) => ({
      ...current,
      visible: false,
    }));
  }, [activeWorkspaceId, updateWorkspaceSession]);

  return {
    onOpenRuntimeConsole,
    onSelectRuntimeCommandPreset,
    onChangeRuntimeCommandInput,
    onRunProject,
    onRunProjectWithCommand,
    onStopProject,
    onClearRuntimeLogs,
    onCopyRuntimeLogs,
    onToggleRuntimeAutoScroll,
    onToggleRuntimeWrapLines,
    onCloseRuntimeConsole,
    runtimeAutoScroll: activeSession.autoScroll,
    runtimeWrapLines: activeSession.wrapLines,
    runtimeConsoleVisible: activeSession.visible,
    runtimeConsoleStatus: activeSession.status,
    runtimeConsoleCommandPreview: activeSession.commandPreview,
    runtimeCommandPresetOptions,
    runtimeCommandPresetId: activeSession.commandPresetId,
    runtimeCommandInput: activeSession.commandInput,
    runtimeConsoleLog: activeSession.log,
    runtimeConsoleError: activeSession.error,
    runtimeConsoleTruncated: activeSession.truncated,
    runtimeConsoleExitCode: activeSession.exitCode,
  };
}
