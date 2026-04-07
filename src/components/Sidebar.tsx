import { NavLink } from "react-router-dom";
import { useState, useEffect } from "react";

/**
 * MULTI-CLI STUDIO SIDEBAR
 * ------------------------
 * Design Direction: "Circuit Pulse" Light Mode
 * - Light theme matching original aesthetic
 * - Animated brand logo with emerald pulse
 * - Collapsible with icon-only mode
 * - Minimal micro-interactions
 */

// --- Brand Logo with Circuit Pulse Animation ---

const BrandLogo = () => (
  <div className="relative w-8 h-8 flex items-center justify-center">
    {/* Outer rotating ring */}
    <svg viewBox="0 0 32 32" className="absolute inset-0 w-full h-full">
      <circle
        cx="16" cy="16" r="14"
        fill="none"
        stroke="#10b981"
        strokeWidth="0.75"
        strokeDasharray="3 4"
        className="animate-spin"
        style={{ animationDuration: '12s', transformOrigin: 'center' }}
        opacity="0.5"
      />
    </svg>

    {/* Main geometric mark */}
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 relative z-10">
      {/* Central core */}
      <circle cx="12" cy="12" r="2.5" fill="#10b981" className="animate-pulse" opacity="0.9" />

      {/* Cross axes */}
      <path d="M12 2V6M12 18V22M2 12H6M18 12H22" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />

      {/* Diagonal accents */}
      <path d="M5 5L8 8M16 16L19 19M5 19L8 16M16 8L19 5" stroke="#10b981" strokeWidth="1" strokeLinecap="round" opacity="0.4" />

      {/* Pulse ring */}
      <circle cx="12" cy="12" r="5" fill="none" stroke="#10b981" strokeWidth="0.5" className="animate-ping" style={{ animationDuration: '3s', opacity: '0.25' }} />
    </svg>

    {/* Glow aura */}
    <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-md animate-pulse" style={{ animationDuration: '2.5s' }} />
  </div>
);

// --- Navigation Icons ---

const IconDashboard = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
    <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M14 17.5H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M17.5 14V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconTerminal = () => (
  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
    <path d="M4 17L10 12L4 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 18H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1" opacity="0.2"/>
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

const navItems = [
  { to: "/", label: "控制面板", icon: IconDashboard },
  { to: "/terminal", label: "终端交互", icon: IconTerminal },
  { to: "/automation", label: "CLI 自动化", icon: IconAutomation },
];

function SidebarLink({
  to,
  label,
  icon: Icon,
  collapsed,
  end = false
}: {
  to: string;
  label: string;
  icon: any;
  collapsed: boolean;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `group relative flex items-center px-3 py-2.5 rounded-xl text-[13px] font-semibold tracking-tight transition-all duration-200 ${
          isActive
            ? "bg-emerald-50 text-emerald-700"
            : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* Active indicator bar */}
          <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 rounded-r-full bg-emerald-500 transition-all duration-200 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'}`} />

          {/* Icon */}
          <div className={`flex shrink-0 items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 ${
            isActive ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-600'
          }`}>
            <Icon />
          </div>

          {/* Label */}
          <span className={`truncate ${collapsed ? 'hidden' : ''}`}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  // Persist collapse state
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    if (saved !== null) {
      setCollapsed(JSON.parse(saved));
    }
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar_collapsed', JSON.stringify(next));
  };

  return (
    <aside
      className="relative h-full flex flex-col bg-white border-r border-slate-200 transition-all duration-300 ease-out overflow-hidden shadow-sm"
      style={{ width: collapsed ? '72px' : '220px' }}
    >
      {/* Subtle top gradient */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400/20 to-transparent" />

      {/* Brand Header */}
      <div className="relative px-4 pt-8 pb-6">
        <div className="flex items-center gap-3">
          {/* Animated Brand Logo */}
          <div className="flex shrink-0 items-center justify-center transition-transform duration-300 hover:scale-110">
            <BrandLogo />
          </div>

          {/* Wordmark */}
          <div className={`flex flex-col overflow-hidden transition-all duration-300 ${collapsed ? 'opacity-0 w-0' : 'opacity-100'}`}>
            <span className="text-[16px] font-bold text-slate-900 tracking-tight whitespace-nowrap">Studio</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">v1.4.2</span>
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-1 px-3 pt-5">
        {navItems.map((item) => (
          <SidebarLink key={item.to} {...item} collapsed={collapsed} end={item.to === "/"} />
        ))}
      </nav>

      {/* Bottom Section */}
      <div className="px-3 pb-5 pt-3">
        <div className="mx-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent mb-4" />

        {/* Settings */}
        <SidebarLink to="/settings" label="系统设置" icon={IconGear} collapsed={collapsed} />

        {/* Collapse Toggle - icon only */}
        <button
          onClick={toggleCollapsed}
          className="mt-2 w-full flex items-center justify-center p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all duration-200"
          title={collapsed ? "展开" : "收起"}
        >
          <IconChevron collapsed={collapsed} />
        </button>
      </div>

      {/* Bottom accent */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-100 to-transparent" />
    </aside>
  );
}
