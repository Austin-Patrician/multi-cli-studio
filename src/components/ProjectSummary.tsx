import { useStore } from "../lib/store";

export function ProjectSummary() {
  const appState = useStore((s) => s.appState);
  if (!appState) return null;

  const { workspace, environment } = appState;

  return (
    <div className="border border-border rounded-[8px] p-4 bg-bg">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Project</p>
          <p className="text-sm font-medium text-text">{workspace.projectName}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Branch</p>
          <p className="text-sm font-medium text-text">{workspace.branch}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Dirty Files</p>
          <p className="text-sm font-medium text-text">{workspace.dirtyFiles}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Failing Checks</p>
          <p className="text-sm font-medium text-text">{workspace.failingChecks}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3 pt-3 border-t border-border">
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Writer</p>
          <p className="text-sm font-medium text-text capitalize">{workspace.currentWriter}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Last Snapshot</p>
          <p className="text-sm text-secondary">{workspace.lastSnapshot ?? "not captured"}</p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Host</p>
          <p className="text-sm text-secondary">
            {environment.backend === "tauri" ? "Desktop" : "Browser preview"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wider mb-1">Handoff</p>
          <p className="text-sm text-secondary">{workspace.handoffReady ? "Ready" : "Not ready"}</p>
        </div>
      </div>
    </div>
  );
}
