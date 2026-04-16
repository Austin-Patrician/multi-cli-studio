import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import tauriConfig from "../../../src-tauri/tauri.conf.json";
import { notifyUpdateAvailable } from "../../lib/desktopNotifications";
import { useStore } from "../../lib/store";
import { UpdateToast, type UpdateState } from "./UpdateToast";

type UpdateCheckOptions = {
  announceNoUpdate?: boolean;
  userInitiated?: boolean;
  silent?: boolean;
};

type UpdateController = {
  supported: boolean;
  configured: boolean;
  state: UpdateState;
  checkForUpdates: (options?: UpdateCheckOptions) => Promise<void>;
  startUpdate: () => Promise<void>;
  dismissUpdate: () => Promise<void>;
};

const AUTO_UPDATE_POLL_MS = 6 * 60 * 60 * 1000;
const LATEST_TOAST_DURATION_MS = 2000;
const UPDATER_PUBKEY_PLACEHOLDER = "TAURI_UPDATER_PUBKEY_PLACEHOLDER";

const updatePluginConfig = (tauriConfig as { plugins?: { updater?: { pubkey?: string } } }).plugins?.updater;
const updaterConfigured =
  typeof updatePluginConfig?.pubkey === "string" &&
  updatePluginConfig.pubkey.trim().length > 0 &&
  updatePluginConfig.pubkey !== UPDATER_PUBKEY_PLACEHOLDER;

const AppUpdateContext = createContext<UpdateController | null>(null);

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const settings = useStore((state) => state.settings);
  const [state, setState] = useState<UpdateState>({ stage: "idle" });
  const updateRef = useRef<Update | null>(null);
  const latestTimeoutRef = useRef<number | null>(null);
  const notifiedVersionRef = useRef<string | null>(null);

  const supported = !import.meta.env.DEV && isTauri();
  const autoCheckForUpdates = settings?.updateConfig.autoCheckForUpdates ?? true;
  const notifyOnUpdateAvailable = settings?.updateConfig.notifyOnUpdateAvailable ?? false;

  const clearLatestTimeout = useCallback(() => {
    if (latestTimeoutRef.current !== null) {
      window.clearTimeout(latestTimeoutRef.current);
      latestTimeoutRef.current = null;
    }
  }, []);

  const resetToIdle = useCallback(async () => {
    clearLatestTimeout();
    const update = updateRef.current;
    updateRef.current = null;
    setState({ stage: "idle" });
    await update?.close();
  }, [clearLatestTimeout]);

  const checkForUpdates = useCallback(
    async (options?: UpdateCheckOptions) => {
      const silent = options?.silent === true;
      const userInitiated = options?.userInitiated === true;

      if (!supported) {
        if (userInitiated) {
          setState({ stage: "error", error: "当前环境不支持桌面更新检查。" });
        }
        return;
      }

      if (!updaterConfigured) {
        if (userInitiated) {
          setState({
            stage: "error",
            error: "Updater 公钥尚未配置。请先在发布配置里写入真实公钥，并为 GitHub Actions 配置 updater 私钥。",
          });
        }
        return;
      }

      if (state.stage === "downloading" || state.stage === "installing" || state.stage === "restarting") {
        return;
      }

      if (!silent) {
        clearLatestTimeout();
        setState({ stage: "checking" });
      }

      let update: Update | null = null;

      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        update = await check();

        if (!update) {
          if (options?.announceNoUpdate) {
            setState({ stage: "latest" });
            latestTimeoutRef.current = window.setTimeout(() => {
              latestTimeoutRef.current = null;
              setState({ stage: "idle" });
            }, LATEST_TOAST_DURATION_MS);
          } else if (!silent) {
            setState({ stage: "idle" });
          }
          return;
        }

        updateRef.current = update;
        setState({
          stage: "available",
          version: update.version,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown updater error.";
        if (silent) {
          setState((current) => (current.stage === "checking" ? { stage: "idle" } : current));
          return;
        }
        setState({ stage: "error", error: message });
      } finally {
        if (!updateRef.current) {
          await update?.close();
        }
      }
    },
    [clearLatestTimeout, state.stage, supported]
  );

  const startUpdate = useCallback(async () => {
    if (!supported) {
      setState({ stage: "error", error: "当前环境不支持桌面更新安装。" });
      return;
    }

    if (!updaterConfigured) {
      setState({
        stage: "error",
        error: "Updater 签名配置尚未完成，暂时无法从 GitHub Release 下载安装更新。",
      });
      return;
    }

    if (!updateRef.current) {
      await checkForUpdates({ userInitiated: true });
      if (!updateRef.current) {
        return;
      }
    }

    const update = updateRef.current;
    if (!update) {
      return;
    }

    setState((current) => ({
      ...current,
      stage: "downloading",
      progress: { totalBytes: undefined, downloadedBytes: 0 },
      error: undefined,
    }));

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          setState((current) => ({
            ...current,
            progress: {
              totalBytes: event.data.contentLength,
              downloadedBytes: 0,
            },
          }));
          return;
        }

        if (event.event === "Progress") {
          setState((current) => ({
            ...current,
            progress: {
              totalBytes: current.progress?.totalBytes,
              downloadedBytes:
                (current.progress?.downloadedBytes ?? 0) + (event.data.chunkLength ?? 0),
            },
          }));
          return;
        }

        if (event.event === "Finished") {
          setState((current) => ({ ...current, stage: "installing" }));
        }
      });

      setState((current) => ({ ...current, stage: "restarting" }));
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown updater error.";
      setState((current) => ({
        ...current,
        stage: "error",
        error: message,
      }));
    }
  }, [checkForUpdates, supported]);

  useEffect(() => {
    if (!supported || !updaterConfigured || settings == null || !autoCheckForUpdates) {
      return;
    }

    void checkForUpdates({ silent: true });
    const intervalId = window.setInterval(() => {
      void checkForUpdates({ silent: true });
    }, AUTO_UPDATE_POLL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [autoCheckForUpdates, checkForUpdates, settings, supported]);

  useEffect(() => {
    if (state.stage !== "available" || !notifyOnUpdateAvailable || !state.version) {
      return;
    }
    if (notifiedVersionRef.current === state.version) {
      return;
    }
    notifiedVersionRef.current = state.version;
    void notifyUpdateAvailable({ version: state.version });
  }, [notifyOnUpdateAvailable, state.stage, state.version]);

  useEffect(() => {
    return () => {
      clearLatestTimeout();
    };
  }, [clearLatestTimeout]);

  const contextValue = useMemo<UpdateController>(
    () => ({
      supported,
      configured: updaterConfigured,
      state,
      checkForUpdates,
      startUpdate,
      dismissUpdate: resetToIdle,
    }),
    [checkForUpdates, resetToIdle, startUpdate, state, supported]
  );

  return (
    <AppUpdateContext.Provider value={contextValue}>
      {children}
      <UpdateToast state={state} onUpdate={() => void startUpdate()} onDismiss={() => void resetToIdle()} />
    </AppUpdateContext.Provider>
  );
}

export function useAppUpdate() {
  const context = useContext(AppUpdateContext);
  if (!context) {
    throw new Error("useAppUpdate must be used within AppUpdateProvider.");
  }
  return context;
}
