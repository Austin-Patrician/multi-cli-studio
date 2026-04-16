import { AgentId } from "./models";

export type DesktopNotificationPermission =
  | "granted"
  | "denied"
  | "default"
  | "unsupported";

export type TerminalCompletionNotice = {
  cliId: AgentId;
  workspaceName: string;
  tabTitle: string;
  exitCode: number | null;
  content: string;
  durationMs: number;
};

export type UpdateAvailableNotice = {
  version: string;
};

const CLI_LABEL: Record<AgentId, string> = {
  codex: "Codex",
  claude: "Claude Code",
  gemini: "Gemini CLI",
};

let trackedFocusState = true;
let focusTrackingReady: Promise<void> | null = null;

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : value;
}

function compactLabel(value: string) {
  return truncate(value.replace(/\s+/g, " ").trim(), 48);
}

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 10000) return `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 60000) return `${Math.round(durationMs / 1000)}s`;

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function currentDocumentFocus() {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

async function ensureFocusTracking() {
  if (typeof window === "undefined") return;
  if (focusTrackingReady) {
    await focusTrackingReady;
    return;
  }

  focusTrackingReady = (async () => {
    trackedFocusState = currentDocumentFocus();

    window.addEventListener("focus", () => {
      trackedFocusState = true;
    });
    window.addEventListener("blur", () => {
      trackedFocusState = false;
    });
    document.addEventListener("visibilitychange", () => {
      trackedFocusState = currentDocumentFocus();
    });

    if (isTauriRuntime()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        trackedFocusState = await currentWindow.isFocused();
        await currentWindow.onFocusChanged(({ payload }) => {
          trackedFocusState = payload;
        });
      } catch {
        trackedFocusState = currentDocumentFocus();
      }
    }
  })();

  await focusTrackingReady;
}

async function isAppFocused() {
  await ensureFocusTracking();
  return trackedFocusState;
}

async function getDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  if (isTauriRuntime()) {
    try {
      const { isPermissionGranted } = await import("@tauri-apps/plugin-notification");
      return (await isPermissionGranted()) ? "granted" : "default";
    } catch {
      return "unsupported";
    }
  }

  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  if (isTauriRuntime()) {
    try {
      const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
      if (await isPermissionGranted()) return "granted";
      return await requestPermission();
    } catch {
      return "unsupported";
    }
  }

  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  return Notification.requestPermission();
}

export async function notifyTerminalCompletion(notice: TerminalCompletionNotice): Promise<boolean> {
  const permission = await getDesktopNotificationPermission();
  if (permission !== "granted") return false;
  if (await isAppFocused()) return false;

  const title =
    notice.exitCode != null && notice.exitCode !== 0
      ? `${CLI_LABEL[notice.cliId]} failed`
      : `${CLI_LABEL[notice.cliId]} finished`;

  const status =
    notice.exitCode != null && notice.exitCode !== 0 ? `exit ${notice.exitCode}` : "reply ready";
  const body = [compactLabel(notice.workspaceName || notice.tabTitle), status, formatDuration(notice.durationMs)]
    .filter(Boolean)
    .join(" • ");

  if (isTauriRuntime()) {
    try {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      await sendNotification({ title, body });
      return true;
    } catch {
      return false;
    }
  }

  if (typeof Notification === "undefined") return false;
  new Notification(title, { body, tag: `terminal:${notice.tabTitle}:${notice.cliId}` });
  return true;
}

export async function notifyUpdateAvailable(notice: UpdateAvailableNotice): Promise<boolean> {
  const permission = await getDesktopNotificationPermission();
  if (permission !== "granted") return false;
  if (await isAppFocused()) return false;

  const title = "Multi CLI Studio update available";
  const body = `Version ${notice.version} is ready to install.`;

  if (isTauriRuntime()) {
    try {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      await sendNotification({ title, body });
      return true;
    } catch {
      return false;
    }
  }

  if (typeof Notification === "undefined") return false;
  new Notification(title, { body, tag: `update:${notice.version}` });
  return true;
}
