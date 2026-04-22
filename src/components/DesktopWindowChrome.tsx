import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeIcon({ maximized }: { maximized: boolean }) {
  return maximized ? (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <path d="M5 3.75h6.25v6.25H5z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.75 5V12.25H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <rect x="3.75" y="3.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

type DesktopWindowHandle = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (handler: () => void | Promise<void>) => Promise<() => void>;
  startDragging: () => Promise<void>;
};

async function withCurrentWindow<T>(action: (windowHandle: DesktopWindowHandle) => Promise<T> | T) {
  if (!isTauriRuntime()) {
    throw new Error("Desktop window controls are only available in the Tauri runtime.");
  }
  return action(getCurrentWindow());
}

export function DesktopWindowControls({ className = "" }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    async function setup() {
      if (!isTauriRuntime()) return;
      try {
        await withCurrentWindow(async (currentWindow) => {
          if (cancelled) return;
          setMaximized(await currentWindow.isMaximized());
          unlisten = await currentWindow.onResized(async () => {
            if (cancelled) return;
            try {
              setMaximized(await currentWindow.isMaximized());
            } catch {
              // Ignore transient window state errors.
            }
          });
        });
      } catch {}
    }

    void setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  async function handleMinimize() {
    try {
      await withCurrentWindow((currentWindow) => currentWindow.minimize());
    } catch {}
  }

  async function handleToggleMaximize() {
    try {
      await withCurrentWindow(async (currentWindow) => {
        await currentWindow.toggleMaximize();
        setMaximized(await currentWindow.isMaximized());
      });
    } catch {}
  }

  async function handleClose() {
    try {
      await withCurrentWindow((currentWindow) => currentWindow.close());
    } catch {}
  }

  return (
    <div className={`flex shrink-0 items-center gap-1 ${className}`.trim()}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void handleMinimize();
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-white/88 text-slate-400 shadow-[0_6px_20px_rgba(15,23,42,0.06)] backdrop-blur-sm transition-colors hover:bg-slate-100 hover:text-slate-700"
        aria-label="最小化窗口"
        title="最小化"
      >
        <MinimizeIcon />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void handleToggleMaximize();
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-white/88 text-slate-400 shadow-[0_6px_20px_rgba(15,23,42,0.06)] backdrop-blur-sm transition-colors hover:bg-slate-100 hover:text-slate-700"
        aria-label={maximized ? "还原窗口" : "最大化窗口"}
        title={maximized ? "还原" : "最大化"}
      >
        <MaximizeIcon maximized={maximized} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void handleClose();
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-white/88 text-slate-400 shadow-[0_6px_20px_rgba(15,23,42,0.06)] backdrop-blur-sm transition-colors hover:bg-rose-50 hover:text-rose-600"
        aria-label="关闭窗口"
        title="关闭"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

export function DesktopWindowChrome({ showControls = true }: { showControls?: boolean }) {
  const isDesktop = useMemo(() => isTauriRuntime(), []);

  async function handleStartDragging() {
    try {
      await withCurrentWindow((currentWindow) => currentWindow.startDragging());
    } catch {}
  }

  async function handleToggleMaximize() {
    try {
      await withCurrentWindow((currentWindow) => currentWindow.toggleMaximize());
    } catch {}
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-0">
      <div
        className="pointer-events-auto absolute inset-x-0 top-0 h-3"
        data-tauri-drag-region={isDesktop ? "" : undefined}
        onDoubleClick={() => void handleToggleMaximize()}
        onMouseDown={(event) => {
          if (!isDesktop || event.button !== 0) return;
          void handleStartDragging();
        }}
      />
      {showControls ? (
        <DesktopWindowControls className="pointer-events-auto absolute right-2 top-[10px]" />
      ) : null}
    </div>
  );
}
