import { useEffect, useRef, useState } from "react";
import { useStore } from "../../lib/store";
import { DesktopGitSection } from "./DesktopGitSection";

export function GlobalGitDrawer() {
  const gitWorkbenchOpen = useStore((state) => state.gitWorkbenchOpen);
  const closeGitWorkbench = useStore((state) => state.closeGitWorkbench);
  const workspaces = useStore((state) => state.workspaces);
  const terminalTabs = useStore((state) => state.terminalTabs);
  const activeTerminalTabId = useStore((state) => state.activeTerminalTabId);

  const [drawerHeight, setDrawerHeight] = useState<number>(() => {
    if (typeof window === "undefined") return 720;
    const raw = window.localStorage.getItem("global_git_drawer_height");
    const parsed = raw ? Number(raw) : 720;
    return Number.isFinite(parsed) ? Math.min(960, Math.max(420, parsed)) : 720;
  });
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const openedRef = useRef(false);

  const activeTerminalTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeTerminalTab?.workspaceId) ?? workspaces[0] ?? null;
  const availableWorkspaces = Array.from(new Set(terminalTabs.map((tab) => tab.workspaceId)))
    .map((workspaceId) => workspaces.find((workspace) => workspace.id === workspaceId) ?? null)
    .filter((workspace): workspace is NonNullable<typeof workspace> => Boolean(workspace));
  const effectiveWorkspaces = availableWorkspaces.length ? availableWorkspaces : workspaces;
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(activeWorkspace?.id ?? workspaces[0]?.id ?? null);
  const selectedWorkspace =
    effectiveWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? activeWorkspace ?? effectiveWorkspaces[0] ?? null;

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
      resizeCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (gitWorkbenchOpen && !openedRef.current) {
      setSelectedWorkspaceId(activeWorkspace?.id ?? effectiveWorkspaces[0]?.id ?? null);
    }
    openedRef.current = gitWorkbenchOpen;
  }, [gitWorkbenchOpen, activeWorkspace?.id, effectiveWorkspaces]);

  useEffect(() => {
    if (selectedWorkspaceId && effectiveWorkspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      return;
    }
    setSelectedWorkspaceId(activeWorkspace?.id ?? effectiveWorkspaces[0]?.id ?? null);
  }, [selectedWorkspaceId, activeWorkspace?.id, effectiveWorkspaces]);

  function persistHeight(next: number) {
    setDrawerHeight(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("global_git_drawer_height", String(next));
    }
  }

  function handleResizeStart(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeCleanupRef.current?.();

    const startY = event.clientY;
    const startHeight = drawerHeight;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const viewportMax = typeof window !== "undefined" ? window.innerHeight - 40 : 960;
      const next = Math.max(420, Math.min(viewportMax, startHeight + deltaY));
      persistHeight(next);
    };

    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
      resizeCleanupRef.current = null;
    };

    resizeCleanupRef.current = finish;
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", finish);
  }

  if (!gitWorkbenchOpen) {
    return null;
  }

  return (
    <div className="settings-git-drawer-shell">
      <div className="settings-git-drawer" style={{ height: drawerHeight }}>
        <div
          className="settings-git-drawer-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize Git drawer"
          onMouseDown={handleResizeStart}
        />
        <div className="settings-git-drawer-handle" />
        <div className="settings-git-drawer-body">
          <button
            type="button"
            className="settings-git-drawer-close settings-git-drawer-close-floating"
            onClick={closeGitWorkbench}
            aria-label="Close Git drawer"
            title="Close Git drawer"
          >
            ×
          </button>
          <DesktopGitSection
            activeWorkspace={selectedWorkspace}
            availableWorkspaces={effectiveWorkspaces}
            onSelectWorkspace={setSelectedWorkspaceId}
          />
        </div>
      </div>
    </div>
  );
}
