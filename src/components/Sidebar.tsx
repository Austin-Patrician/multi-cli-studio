import { NavLink } from "react-router-dom";

/**
 * ARCHITECTURAL DESIGN NOTES:
 * - Minimalist "Cold" Palette: Utilizing Slate scales for depth without warmth.
 * - Precision Typography: Focused on readability and structured hierarchy.
 * - Subtle Interactivity: Moving away from high-contrast blocks to refined state indicators.
 */

// --- Custom Refined Icons (Thinner stroke for professional look) ---
const StudioLogo = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
    <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const DashboardIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25a2.25 2.25 0 01-2.25 2.25h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
  </svg>
);

const TerminalIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const AutomationIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.841m1.861-4.413a10.12 10.12 0 00-3.446 3.446m4.033-3.59a10.047 10.047 0 012.705 2.705" />
  </svg>
);

const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 1115 0 7.5 7.5 0 01-15 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 0v3.75m0-3.75h3.75m-3.75 0H8.25" />
  </svg>
);

const navItems = [
  { to: "/", label: "控制面板", icon: DashboardIcon },
  { to: "/terminal", label: "终端交互", icon: TerminalIcon },
  { to: "/automation", label: "自动化批次", icon: AutomationIcon },
];

function SidebarLink({ to, label, icon: Icon, end = false }: { to: string, label: string, icon: any, end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `group relative flex items-center gap-3.5 px-4 py-2 text-[13px] font-medium transition-all duration-300 ${
          isActive
            ? "text-slate-900 bg-slate-100/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"
            : "text-slate-500 hover:text-slate-800 hover:bg-slate-50/80"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* Vertical Active Indicator */}
          {isActive && (
            <div className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-slate-900 rounded-r-full" />
          )}
          
          <div className={`flex shrink-0 items-center justify-center transition-transform duration-300 ${isActive ? 'scale-105' : 'group-hover:scale-105 opacity-70 group-hover:opacity-100'}`}>
            <Icon />
          </div>
          <span className="truncate tracking-tight">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  return (
    <aside className="w-[220px] shrink-0 h-full border-r border-slate-200 bg-white flex flex-col antialiased">
      {/* Brand Header: Architectural & Industrial */}
      <div className="px-6 pt-10 pb-12">
        <div className="flex items-center gap-3 group cursor-default">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm ring-1 ring-slate-900/10 transition-transform duration-500 group-hover:rotate-12">
            <StudioLogo />
          </div>
          <div className="flex flex-col">
            <span className="text-[14px] font-bold text-slate-900 tracking-[0.05em] uppercase leading-none">Studio</span>
            <span className="text-[10px] font-bold text-slate-400 tracking-[0.2em] uppercase mt-1">Multi-CLI</span>
          </div>
        </div>
      </div>

      {/* Main Navigation: Minimalist List */}
      <div className="flex-1 flex flex-col gap-1">
        <nav className="flex flex-col">
          {navItems.map((item) => (
            <SidebarLink key={item.to} {...item} end={item.to === "/"} />
          ))}
        </nav>
      </div>

      {/* Bottom Section: Utility */}
      <div className="mt-auto border-t border-slate-100 pt-4 pb-8">
        <SidebarLink to="/settings" label="系统设置" icon={SettingsIcon} />
      </div>
    </aside>
  );
}