import { Link, matchPath, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useStore } from "../lib/store";

// --- Navigation Icons ---

const IconTerminal = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
    <path d="M4 17L10 12L4 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 18H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1" opacity="0.2"/>
  </svg>
);

const IconModelChat = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
    <path d="M7 8h10M7 12h6m7 8-3.4-2.2H6a3 3 0 01-3-3V7a3 3 0 013-3h12a3 3 0 013 3v10a3 3 0 01-1 2.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconProviders = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
    <rect x="3" y="5" width="18" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <rect x="3" y="10" width="18" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.5" opacity="0.75" />
    <rect x="3" y="15" width="18" height="4" rx="1.5" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
    <circle cx="8" cy="7" r="1" fill="currentColor" />
    <circle cx="15" cy="12" r="1" fill="currentColor" />
    <circle cx="11" cy="17" r="1" fill="currentColor" />
  </svg>
);

const IconAutomation = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
    <path d="M12 2V6M12 18V22M6 12H2M22 12H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M12 8V12L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M19 19L17 17M5 5L7 7M19 5L17 7M5 19L7 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
  </svg>
);

const IconWorkflow = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
    <circle cx="6" cy="6" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="18" cy="6" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="18" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 7.3l2.9 7.2M16 7.3l-2.9 7.2M8.25 6H15.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const IconGear = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
  </svg>
);

const IconChevron = ({ collapsed }: { collapsed: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`}>
    <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const IconCopy = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
    <rect x="8" y="8" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M6 14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const IconSparkles = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
    <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);

type SidebarMatchPattern = {
  path: string;
  end?: boolean;
};

type SidebarNavItem = {
  to: string;
  label: string;
  icon: ComponentType;
  matchPatterns: SidebarMatchPattern[];
};

type SettingsMenuSection =
  | "settings"
  | "models"
  | "agents"
  | "vendors"
  | "projects"
  | "git"
  | "mcp"
  | "skills";

const navItems: SidebarNavItem[] = [
  {
    to: "/terminal",
    label: "终端交互",
    icon: IconTerminal,
    matchPatterns: [{ path: "/terminal", end: false }],
  },
  {
    to: "/model-chat",
    label: "模型对话",
    icon: IconModelChat,
    matchPatterns: [{ path: "/model-chat", end: false }],
  },
  {
    to: "/automation",
    label: "CLI 自动化",
    icon: IconAutomation,
    matchPatterns: [
      { path: "/automation", end: true },
      { path: "/automation/new", end: true },
      { path: "/automation/jobs", end: false },
    ],
  },
  {
    to: "/automation/workflows",
    label: "CLI 工作流",
    icon: IconWorkflow,
    matchPatterns: [{ path: "/automation/workflows", end: false }],
  },
];

function matchesSidebarItem(pathname: string, matchPatterns: SidebarMatchPattern[]) {
  return matchPatterns.some((pattern) =>
    matchPath(
      {
        path: pattern.path,
        end: pattern.end ?? true,
      },
      pathname
    )
  );
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  collapsed,
  matchPatterns,
}: {
  to: string;
  label: string;
  icon: ComponentType;
  collapsed: boolean;
  matchPatterns: SidebarMatchPattern[];
}) {
  const { pathname } = useLocation();
  const isActive = matchesSidebarItem(pathname, matchPatterns);

  return (
    <Link
      to={to}
      aria-current={isActive ? "page" : undefined}
      className={`group relative flex items-center gap-2 px-2.5 py-2 rounded-xl text-[12px] font-semibold tracking-tight transition-all duration-200 ${
        isActive
          ? "bg-emerald-50 text-emerald-700"
          : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
      }`}
    >
      <>
        {/* Active indicator bar */}
        <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 rounded-r-full bg-emerald-500 transition-all duration-200 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'}`} />

        {/* Icon */}
        <div className={`flex shrink-0 items-center justify-center w-7 h-7 rounded-lg transition-all duration-200 ${
          isActive ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-600'
        }`}>
          <Icon />
        </div>

        {/* Label */}
        <span className={`truncate ${collapsed ? 'hidden' : ''}`}>{label}</span>
      </>
    </Link>
  );
}

function SidebarSectionTitle({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return null;
  return (
    <div className="px-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
      {label}
    </div>
  );
}

function WorkspaceTabItem({
  title,
  subtitle,
  locationKind,
  active,
  collapsed,
  planMode,
  dragging,
  dragOver,
  onClick,
  onClose,
  onPointerDown,
  onPointerEnter,
}: {
  title: string;
  subtitle: string;
  locationKind: "local" | "ssh";
  active: boolean;
  collapsed: boolean;
  planMode: boolean;
  dragging?: boolean;
  dragOver?: boolean;
  onClick: () => void;
  onClose: () => void;
  onPointerDown?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onPointerEnter?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onPointerDown}
      onMouseEnter={onPointerEnter}
      className={`group relative flex w-full cursor-grab items-center gap-2 overflow-hidden rounded-xl border px-2.5 py-2 text-left transition-all active:cursor-grabbing ${
        dragging
          ? "border-slate-300 bg-slate-100 text-slate-500 opacity-60"
          : dragOver
            ? "border-emerald-300 bg-emerald-50/80 text-slate-800 shadow-[0_10px_24px_rgba(16,185,129,0.10)]"
          : active
          ? "border-slate-900 bg-slate-900 text-white shadow-[0_8px_20px_rgba(15,23,42,0.14)]"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
      title={collapsed ? `${title}\n${subtitle}` : title}
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${active ? "bg-white/10" : "bg-slate-100 text-slate-500"}`}>
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
          <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4l1.3 1.6H18.5A1.5 1.5 0 0 1 20 9.1v7.4A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-9Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
      {!collapsed ? (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12px] font-semibold">{title}</span>
            {locationKind === "ssh" ? (
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.08em] ${
                  active ? "bg-emerald-400/18 text-emerald-100" : "bg-emerald-100 text-emerald-700"
                }`}
              >
                SSH
              </span>
            ) : null}
            {planMode ? (
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${active ? "bg-white/12 text-white" : "bg-amber-100 text-amber-700"}`}>
                PLAN
              </span>
            ) : null}
          </div>
          <div className={`truncate text-[10px] ${active ? "text-white/65" : "text-slate-400"}`}>{subtitle}</div>
        </div>
      ) : null}
      {!collapsed ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
          className={`rounded-full px-1.5 py-0.5 text-xs transition-colors ${active ? "text-white/65 hover:bg-white/10 hover:text-white" : "text-slate-300 hover:bg-slate-100 hover:text-slate-700"}`}
        >
          ×
        </span>
      ) : null}
    </button>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; tabId: string } | null>(null);
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const draggingTabIdRef = useRef<string | null>(null);
  const dragOverTabIdRef = useRef<string | null>(null);
  const terminalTabs = useStore((s) => s.terminalTabs);
  const workspaces = useStore((s) => s.workspaces);
  const activeTerminalTabId = useStore((s) => s.activeTerminalTabId);
  const setActiveTerminalTab = useStore((s) => s.setActiveTerminalTab);
  const closeTerminalTab = useStore((s) => s.closeTerminalTab);
  const openWorkspaceFolder = useStore((s) => s.openWorkspaceFolder);
  const cloneTerminalTab = useStore((s) => s.cloneTerminalTab);
  const reorderTerminalTabs = useStore((s) => s.reorderTerminalTabs);
  const gitWorkbenchOpen = useStore((s) => s.gitWorkbenchOpen);
  const openGitWorkbench = useStore((s) => s.openGitWorkbench);

  const activeTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;
  const workspaceById = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace])), [workspaces]);
  const canCloneActiveTab = !!activeTab && activeTab.status !== "streaming";
  const settingsIsActive = matchesSidebarItem(location.pathname, [{ path: "/settings", end: false }]);
  const activeSettingsSection = useMemo<SettingsMenuSection>(() => {
    if (matchesSidebarItem(location.pathname, [{ path: "/settings/model-providers", end: false }])) {
      return "models";
    }
    if (matchesSidebarItem(location.pathname, [{ path: "/settings/agents", end: false }])) {
      return "agents";
    }
    const section = new URLSearchParams(location.search).get("section");
    switch (section) {
      case "models":
      case "agents":
      case "vendors":
      case "projects":
      case "git":
      case "mcp":
      case "skills":
        return section;
      default:
        return "settings";
    }
  }, [location.search]);

  // Persist collapse state
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    if (saved !== null) {
      setCollapsed(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    if (!settingsMenuOpen) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(target) &&
        settingsButtonRef.current &&
        !settingsButtonRef.current.contains(target)
      ) {
        setSettingsMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSettingsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsMenuOpen]);

  useEffect(() => {
    setSettingsMenuOpen(false);
  }, [location.pathname, location.search]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar_collapsed', JSON.stringify(next));
  };

  const settingsMenuItems = useMemo(
    () => [
      { id: "settings", label: "设置", section: "settings" as const, icon: IconGear },
      { id: "agents", label: "智能体", section: "agents" as const, icon: IconSparkles },
      // { id: "models", label: "模型管理", section: "models" as const, icon: IconProviders },
      // { id: "vendors", label: "供应商", section: "vendors" as const, icon: IconProviders },
      // { id: "projects", label: "项目", section: "projects" as const, icon: IconPlus },
      { id: "git", label: "Git", section: "git" as const, icon: IconWorkflow },
      // { id: "mcp", label: "MCP", section: "mcp" as const, icon: IconWorkflow },
      // { id: "skills", label: "Skills", section: "skills" as const, icon: IconSparkles },
    ],
    []
  );

  function openSettingsSection(section: SettingsMenuSection) {
    setSettingsMenuOpen(false);
    if (section === "git") {
      openGitWorkbench();
      return;
    }
    if (section === "settings") {
      navigate("/settings/general");
      return;
    }
    if (section === "models") {
      navigate("/settings/model-providers");
      return;
    }
    if (section === "agents") {
      navigate("/settings/agents");
      return;
    }
    navigate(`/settings?section=${section}`);
  }

  function setDraggingState(tabId: string | null) {
    draggingTabIdRef.current = tabId;
    setDraggingTabId(tabId);
  }

  function setDragOverState(tabId: string | null) {
    dragOverTabIdRef.current = tabId;
    setDragOverTabId(tabId);
  }

  function finishDrag() {
    const sourceTabId = draggingTabIdRef.current || dragStartRef.current?.tabId || null;
    const targetTabId = dragOverTabIdRef.current;

    if (dragMovedRef.current && sourceTabId && targetTabId && sourceTabId !== targetTabId) {
      reorderTerminalTabs(sourceTabId, targetTabId);
    }

    dragStartRef.current = null;
    dragMovedRef.current = false;
    setDraggingState(null);
    setDragOverState(null);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }

  function startPointerDrag(tabId: string, event: React.MouseEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement | null)?.closest("[role='button']")) {
      return;
    }

    dragStartRef.current = { x: event.clientX, y: event.clientY, tabId };
    dragMovedRef.current = false;
    suppressClickRef.current = false;

    const handleMove = (moveEvent: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const deltaX = moveEvent.clientX - start.x;
      const deltaY = moveEvent.clientY - start.y;
      if (!dragMovedRef.current && Math.hypot(deltaX, deltaY) < 6) {
        return;
      }
      dragMovedRef.current = true;
      suppressClickRef.current = true;
      setDraggingState(start.tabId);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      finishDrag();
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  return (
    <aside
      className="relative h-full flex flex-col bg-white border-r border-slate-200 transition-all duration-300 ease-out overflow-hidden shadow-sm"
      style={{ width: collapsed ? '72px' : '228px' }}
    >
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400/20 to-transparent" />

      <div className="flex h-6 shrink-0" />

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <div className="space-y-4">
          <div className="space-y-1">
            {navItems.map((item) => (
              <SidebarLink key={item.to} {...item} collapsed={collapsed} />
            ))}
          </div>

          <div className="mx-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

          <div className="space-y-2">
            <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} gap-2 px-2.5`}>
              <SidebarSectionTitle label="工作区" collapsed={collapsed} />
              {!collapsed ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void openWorkspaceFolder()}
                    title="打开目录"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-700"
                  >
                    <IconPlus />
                  </button>
                  <button
                    type="button"
                    onClick={() => canCloneActiveTab && cloneTerminalTab(activeTerminalTabId ?? undefined)}
                    title="克隆当前工作区"
                    disabled={!canCloneActiveTab}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <IconCopy />
                  </button>
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              {terminalTabs.map((tab) => (
                <WorkspaceTabItem
                  key={tab.id}
                  title={tab.title}
                  subtitle={workspaceById.get(tab.workspaceId)?.rootPath ?? "Detached workspace"}
                  locationKind={workspaceById.get(tab.workspaceId)?.locationKind ?? "local"}
                  active={tab.id === activeTerminalTabId}
                  collapsed={collapsed}
                  planMode={tab.planMode}
                  dragging={draggingTabId === tab.id}
                  dragOver={dragOverTabId === tab.id && draggingTabId !== tab.id}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      return;
                    }
                    setActiveTerminalTab(tab.id);
                    navigate("/terminal");
                  }}
                  onClose={() => closeTerminalTab(tab.id)}
                  onPointerDown={(event) => startPointerDrag(tab.id, event)}
                  onPointerEnter={() => {
                    if (draggingTabIdRef.current && draggingTabIdRef.current !== tab.id) {
                      setDragOverState(tab.id);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-3 pb-5 pt-3">
        <div className="mx-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent mb-4" />
        <div className="flex items-center gap-2">
          <div className={collapsed ? "relative" : "relative flex-1"} ref={settingsMenuRef}>
            <button
              ref={settingsButtonRef}
              type="button"
              onClick={() => setSettingsMenuOpen((value) => !value)}
              className={cx(
                "inline-flex items-center justify-center rounded-xl transition-all duration-200",
                settingsIsActive
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
                collapsed ? "h-9 w-9" : "w-full justify-between gap-2 px-3 py-2"
              )}
              title="设置"
              aria-label="设置"
              aria-expanded={settingsMenuOpen}
            >
              <span className={`inline-flex items-center ${collapsed ? "" : "gap-2"}`}>
                <IconGear />
                {!collapsed ? <span className="text-[12px] font-semibold text-slate-600">设置</span> : null}
              </span>
              {/* {!collapsed ? (
                <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 transition-transform ${settingsMenuOpen ? "rotate-180" : ""}`}>
                  <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null} */}
            </button>
            {settingsMenuOpen ? (
              <div className={`absolute bottom-[calc(100%+8px)] z-30 min-w-[196px] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.14)] ${collapsed ? "left-0" : "left-0 right-0"}`}>
                {settingsMenuItems.map((item) => {
                  const Icon = item.icon;
                  const itemActive =
                    item.section === "git"
                      ? gitWorkbenchOpen
                      : settingsIsActive && activeSettingsSection === item.section;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openSettingsSection(item.section)}
                      className={cx(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all",
                        itemActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      <span
                        className={cx(
                          "inline-flex h-8 w-8 items-center justify-center rounded-xl",
                          itemActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        )}
                      >
                        <Icon />
                      </span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button
            onClick={toggleCollapsed}
            className={`inline-flex items-center justify-center rounded-xl text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600 ${collapsed ? "h-9 w-9" : "h-9 w-9"}`}
            title={collapsed ? "展开" : "收起"}
          >
            <IconChevron collapsed={collapsed} />
          </button>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-100 to-transparent" />
    </aside>
  );
}
