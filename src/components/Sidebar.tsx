import { NavLink } from "react-router-dom";
import { useStore } from "../lib/store";

const navItems = [
  { to: "/", label: "Dashboard", icon: DashboardIcon },
  { to: "/terminal", label: "Terminal", icon: TerminalIcon },
  { to: "/handoff", label: "Handoff", icon: HandoffIcon },
];

export function Sidebar() {
  const appState = useStore((s) => s.appState);
  const projectName = appState?.workspace.projectName ?? "Multi CLI Studio";
  const branch = appState?.workspace.branch ?? "main";

  return (
    <aside className="w-[220px] shrink-0 h-full border-r border-border bg-surface flex flex-col">
      <div className="px-4 pt-5 pb-4 border-b border-border">
        <p className="text-sm font-semibold text-text truncate">{projectName}</p>
        <p className="text-xs text-muted mt-0.5 truncate">{branch}</p>
      </div>

      <nav className="flex-1 py-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-accent/8 text-accent font-medium border-r-2 border-accent"
                  : "text-secondary hover:text-text hover:bg-surface"
              }`
            }
          >
            <item.icon />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border py-2">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
              isActive
                ? "bg-accent/8 text-accent font-medium border-r-2 border-accent"
                : "text-secondary hover:text-text hover:bg-surface"
            }`
          }
        >
          <SettingsIcon />
          Settings
        </NavLink>
      </div>
    </aside>
  );
}

function DashboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M4.5 6l2.5 2-2.5 2" />
      <path d="M8.5 10h3" />
    </svg>
  );
}

function HandoffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8h12" />
      <path d="M10 4l4 4-4 4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4" />
    </svg>
  );
}
