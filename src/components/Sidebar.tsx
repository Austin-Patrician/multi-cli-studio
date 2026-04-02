import { NavLink } from "react-router-dom";

/**
 * ELITE COMMERCIAL SAAS SIDEBAR
 * -----------------------------
 * Design Philosophy:
 * - "Tactile Depth": Active items feel like physical floating cards.
 * - "Refined Utility": Bespoke iconography with high-precision paths.
 * - "Visual Harmony": A balanced mix of Slate and White for a clean, stable feel.
 */

// --- Custom Bespoke Iconography ---

const BrandLogo = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-6 h-6">
    <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.3"/>
  </svg>
);

const IconDashboard = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
    <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M14 17.5H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M17.5 14V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconTerminal = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
    <path d="M4 17L10 12L4 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 18H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1" opacity="0.2"/>
  </svg>
);

const IconAutomation = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
    <path d="M12 2V6M12 18V22M6 12H2M22 12H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M12 8V12L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M19 19L17 17M5 5L7 7M19 5L17 7M5 19L7 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
  </svg>
);

const IconHandoff = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
    <path d="M17 8L21 12L17 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3 12H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M7 16L3 12L7 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="12" cy="12" r="2" fill="currentColor"/>
  </svg>
);

const IconGear = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
  </svg>
);

const navItems = [
  { to: "/", label: "控制面板", icon: IconDashboard },
  { to: "/terminal", label: "终端交互", icon: IconTerminal },
  { to: "/automation", label: "自动化批次", icon: IconAutomation },
];

function SidebarLink({ to, label, icon: Icon, end = false }: { to: string, label: string, icon: any, end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `group relative flex items-center gap-3.5 px-4 py-2.5 mx-3 rounded-xl text-[13.5px] font-bold tracking-tight transition-all duration-300 ${
          isActive
            ? "text-slate-950 bg-white shadow-sm ring-1 ring-slate-200"
            : "text-slate-500 hover:text-slate-800 hover:bg-white/50"
        }`
      }
    >
      <div className={`flex shrink-0 items-center justify-center transition-transform duration-300 group-hover:scale-110 ${(({ isActive }: any) => isActive ? 'text-indigo-600' : '') as any}`}>
        <Icon />
      </div>
      <span className="truncate">{label}</span>
      
      {/* Active Dot indicator */}
      <div className={`absolute right-3 w-1 h-1 rounded-full bg-indigo-500 transition-all duration-500 ${(({ isActive }: any) => isActive ? 'opacity-100 scale-100' : 'opacity-0 scale-0') as any}`} />
    </NavLink>
  );
}

export function Sidebar() {
  return (
    <aside className="w-[240px] shrink-0 h-full border-r border-slate-200 bg-[#fbfbfc] flex flex-col antialiased selection:bg-slate-900 selection:text-white">
      {/* Brand Header: Clean & Sophisticated */}
      <div className="px-7 pt-10 pb-12">
        <div className="flex items-center gap-3.5 group cursor-default">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-lg shadow-slate-200/50 ring-1 ring-slate-200/60 transition-all duration-500 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-slate-200/60">
            <BrandLogo />
          </div>
          <div className="flex flex-col">
            <span className="text-[17px] font-bold text-slate-900 tracking-tight leading-none">Studio</span>
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="h-1 w-1 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">v1.4.2</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Navigation: Floating Card Style */}
      <div className="flex-1 flex flex-col gap-1.5 pt-2">
        
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <SidebarLink key={item.to} {...item} end={item.to === "/"} />
          ))}
        </nav>
      </div>

      {/* Bottom Section: Utility & Preferences */}
      <div className="mt-auto border-t border-slate-200/60 pt-6 pb-10 bg-white/30">
        <SidebarLink to="/settings" label="系统设置" icon={IconGear} />
      </div>
    </aside>
  );
}