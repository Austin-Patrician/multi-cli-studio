import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { bridge } from "../../lib/bridge";
import antigravityIcon from "../../assets/app-icons/antigravity.png";
import cursorIcon from "../../assets/app-icons/cursor.png";
import finderIcon from "../../assets/app-icons/finder.png";
import ghosttyIcon from "../../assets/app-icons/ghostty.png";
import vscodeIcon from "../../assets/app-icons/vscode.png";
import zedIcon from "../../assets/app-icons/zed.png";

const OPEN_WORKSPACE_STORAGE_KEY = "multi-cli-studio::open-workspace-app";
const DEFAULT_OPEN_WORKSPACE_ID = "vscode";
const GENERIC_APP_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'><rect x='4' y='3' width='16' height='18' rx='3' ry='3'/><path d='M9 7h6'/><path d='M9 11h6'/><path d='M9 15h4'/></svg>";
const GENERIC_APP_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(GENERIC_APP_SVG)}`;

type OpenWorkspaceTarget =
  | {
      id: string;
      label: string;
      kind: "system";
      icon: string;
      args: string[];
    }
  | {
      id: string;
      label: string;
      kind: "app";
      icon: string;
      appName: string;
      args: string[];
    }
  | {
      id: string;
      label: string;
      kind: "command";
      icon: string;
      command: string;
      args: string[];
    };

const OPEN_WORKSPACE_TARGETS: OpenWorkspaceTarget[] = [
  {
    id: "vscode",
    label: "VS Code",
    kind: "app",
    appName: "Visual Studio Code",
    icon: vscodeIcon,
    args: [],
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "app",
    appName: "Cursor",
    icon: cursorIcon,
    args: [],
  },
  {
    id: "zed",
    label: "Zed",
    kind: "app",
    appName: "Zed",
    icon: zedIcon,
    args: [],
  },
  {
    id: "ghostty",
    label: "Ghostty",
    kind: "app",
    appName: "Ghostty",
    icon: ghosttyIcon,
    args: [],
  },
  {
    id: "antigravity",
    label: "Antigravity",
    kind: "app",
    appName: "Antigravity",
    icon: antigravityIcon,
    args: [],
  },
  {
    id: "finder",
    label: "文件管理器",
    kind: "system",
    icon: finderIcon,
    args: [],
  },
  {
    id: "windsurf",
    label: "Windsurf",
    kind: "app",
    appName: "Windsurf",
    icon: GENERIC_APP_ICON,
    args: [],
  },
];
const FALLBACK_OPEN_WORKSPACE_TARGET = OPEN_WORKSPACE_TARGETS[0]!;

function readSelectedOpenWorkspaceId() {
  if (typeof window === "undefined") {
    return DEFAULT_OPEN_WORKSPACE_ID;
  }
  const stored = window.localStorage.getItem(OPEN_WORKSPACE_STORAGE_KEY)?.trim();
  if (!stored) {
    return DEFAULT_OPEN_WORKSPACE_ID;
  }
  return OPEN_WORKSPACE_TARGETS.some((target) => target.id === stored)
    ? stored
    : DEFAULT_OPEN_WORKSPACE_ID;
}

function persistSelectedOpenWorkspaceId(id: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(OPEN_WORKSPACE_STORAGE_KEY, id);
}

function formatOpenWorkspaceError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function OpenWorkspaceMenu({
  path,
  disabled = false,
}: {
  path: string;
  disabled?: boolean;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState(readSelectedOpenWorkspaceId);
  const [openingTargetId, setOpeningTargetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTarget = useMemo(
    () =>
      OPEN_WORKSPACE_TARGETS.find((target) => target.id === selectedTargetId) ??
      FALLBACK_OPEN_WORKSPACE_TARGET,
    [selectedTargetId],
  );

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const menuElement = menuRef.current;
      if (!menuElement || !(event.target instanceof Node)) {
        return;
      }
      if (!menuElement.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  async function openWithTarget(target: OpenWorkspaceTarget) {
    setOpeningTargetId(target.id);
    setError(null);

    try {
      if (target.kind === "system") {
        await bridge.openWorkspaceIn(path, {
          args: target.args,
        });
      } else if (target.kind === "command") {
        await bridge.openWorkspaceIn(path, {
          command: target.command,
          args: target.args,
        });
      } else {
        await bridge.openWorkspaceIn(path, {
          appName: target.appName,
          args: target.args,
        });
      }
      return true;
    } catch (openError) {
      setError(formatOpenWorkspaceError(openError));
      return false;
    } finally {
      setOpeningTargetId(null);
    }
  }

  async function handleOpenSelectedTarget() {
    if (disabled) return;
    const success = await openWithTarget(selectedTarget);
    if (!success) {
      setMenuOpen(true);
    }
  }

  async function handleSelectTarget(target: OpenWorkspaceTarget) {
    if (disabled) return;
    setSelectedTargetId(target.id);
    persistSelectedOpenWorkspaceId(target.id);
    setMenuOpen(false);
    const success = await openWithTarget(target);
    if (!success) {
      setMenuOpen(true);
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <div className="inline-flex overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
        <button
          type="button"
          onClick={() => {
            void handleOpenSelectedTarget();
          }}
          disabled={disabled || openingTargetId !== null}
          title={disabled ? "远程工作区不支持在本机打开" : `用 ${selectedTarget.label} 打开项目`}
          aria-label={disabled ? "远程工作区不支持在本机打开" : `用 ${selectedTarget.label} 打开项目`}
          className="inline-flex h-8 w-9 items-center justify-center text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <img
            src={selectedTarget.icon}
            alt=""
            aria-hidden="true"
            className="h-[19px] w-[19px] shrink-0 rounded-[3px] object-contain"
          />
        </button>
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            setError(null);
            setMenuOpen((current) => !current);
          }}
          disabled={disabled}
          title={disabled ? "远程工作区不支持在本机打开" : "选择打开方式"}
          aria-label={disabled ? "远程工作区不支持在本机打开" : "选择打开方式"}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="inline-flex h-8 w-8 items-center justify-center border-l border-slate-200 text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ChevronDown
            className={`h-[14px] w-[14px] transition-transform ${menuOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {menuOpen ? (
        <div
          className="absolute left-1/2 top-[calc(100%+6px)] z-30 -translate-x-1/2 rounded-[10px] border border-slate-200 bg-white p-1 shadow-[0_22px_48px_rgba(15,23,42,0.14)]"
          role="menu"
        >
          <div className="flex items-center gap-1">
            {OPEN_WORKSPACE_TARGETS.map((target) => {
              const isActive = target.id === selectedTarget.id;

              return (
                <button
                  key={target.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void handleSelectTarget(target);
                  }}
                  disabled={openingTargetId !== null}
                  title={target.label}
                  aria-label={target.label}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-[7px] border transition-all ${
                    isActive
                      ? "border-sky-200 bg-sky-50 text-sky-700 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.35)]"
                      : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <img
                    src={target.icon}
                    alt=""
                    aria-hidden="true"
                    className="h-[18px] w-[18px] rounded-[3px] object-contain"
                  />
                </button>
              );
            })}
          </div>
          {error ? (
            <div className="mx-1 mt-2 max-w-[260px] rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] leading-5 text-rose-700">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
