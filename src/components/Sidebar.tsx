import { Link, matchPath, useLocation } from "react-router-dom";
import { useEffect, useId, useState, type ComponentType } from "react";

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

const BrandLogo = ({ collapsed }: { collapsed: boolean }) => {
  const gradientId = useId();
  const surfaceId = useId();
  const clipId = useId();
  const terminalGradientId = useId();

  if (collapsed) {
    return (
      <div className="relative h-[84px] w-full overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(56,189,248,0.2),transparent_46%),linear-gradient(180deg,#0f172a_0%,#111827_100%)]" />
        <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id={surfaceId} x1="18%" y1="14%" x2="84%" y2="88%">
              <stop offset="0%" stopColor="#111c31" />
              <stop offset="100%" stopColor="#0b1220" />
            </linearGradient>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#818cf8" />
            </linearGradient>
            <clipPath id={clipId}>
              <rect x="56" y="68" width="88" height="58" rx="4" />
            </clipPath>
          </defs>

          <style>
            {`
              @keyframes sidebarBrandCodeScroll {
                0% { transform: translateY(0); opacity: 0; }
                12% { opacity: 1; }
                88% { opacity: 1; }
                100% { transform: translateY(-18px); opacity: 0; }
              }

              @keyframes sidebarBrandBlink {
                0%, 100% { opacity: 0.35; }
                50% { opacity: 1; }
              }

              @keyframes sidebarBrandRotate {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }

              .sidebar-brand-code-line {
                animation: sidebarBrandCodeScroll 3s infinite linear;
              }

              .sidebar-brand-line-1 { animation-delay: 0s; }
              .sidebar-brand-line-2 { animation-delay: 1s; }
              .sidebar-brand-line-3 { animation-delay: 2s; }

              .sidebar-brand-agent-node {
                animation: sidebarBrandBlink 2.2s infinite ease-in-out;
              }

              .sidebar-brand-node-1 { animation-delay: 0s; }
              .sidebar-brand-node-2 { animation-delay: 0.7s; }
              .sidebar-brand-node-3 { animation-delay: 1.4s; }

              .sidebar-brand-cron-ring {
                transform-origin: center;
                animation: sidebarBrandRotate 18s infinite linear;
              }
            `}
          </style>

          <rect x="26" y="26" width="148" height="148" rx="42" fill={`url(#${surfaceId})`} />
          <circle cx="100" cy="100" r="66" stroke="#1e293b" strokeWidth="2" fill="none" />

          <g className="sidebar-brand-cron-ring">
            <line x1="100" y1="34" x2="100" y2="46" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" />
            <line x1="166" y1="100" x2="154" y2="100" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
            <line x1="100" y1="166" x2="100" y2="154" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
            <line x1="34" y1="100" x2="46" y2="100" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
          </g>

          <rect x="42" y="52" width="116" height="86" rx="12" fill="#1e293b" stroke={`url(#${gradientId})`} strokeWidth="2.4" />
          <path d="M54 52H146C152.627 52 158 57.373 158 64V66H42V64C42 57.373 47.373 52 54 52Z" fill="#334155" />
          <circle cx="54" cy="59" r="3" fill="#ef4444" />
          <circle cx="64" cy="59" r="3" fill="#f59e0b" />
          <circle cx="74" cy="59" r="3" fill="#10b981" />

          <g clipPath={`url(#${clipId})`}>
            <g className="sidebar-brand-code-line sidebar-brand-line-1">
              <rect x="68" y="106" width="38" height="5" rx="2.5" fill="#38bdf8" opacity="0.72" />
            </g>
            <g className="sidebar-brand-code-line sidebar-brand-line-2">
              <rect x="68" y="116" width="56" height="5" rx="2.5" fill="#818cf8" opacity="0.72" />
            </g>
            <g className="sidebar-brand-code-line sidebar-brand-line-3">
              <rect x="68" y="126" width="28" height="5" rx="2.5" fill="#38bdf8" opacity="0.72" />
            </g>
          </g>

          <text
            x="60"
            y="88"
            fill="#38bdf8"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontSize="14"
            fontWeight="700"
          >
            &gt;_
          </text>
        </svg>
      </div>
    );
  }

  return (
    <div className="relative h-[156px] w-full overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(56,189,248,0.2),transparent_34%),radial-gradient(circle_at_18%_100%,rgba(129,140,248,0.14),transparent_40%),linear-gradient(180deg,#08101d_0%,#0f172a_58%,#121b2e_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(148,163,184,0.08)_0,rgba(148,163,184,0)_24px),linear-gradient(90deg,rgba(148,163,184,0.03)_1px,transparent_1px)] bg-[size:100%_24px,20px_100%]" />
      <svg viewBox="0 0 320 220" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={terminalGradientId} x1="16%" y1="10%" x2="82%" y2="88%">
            <stop offset="0%" stopColor="#162235" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#818cf8" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="92" y="72" width="136" height="58" rx="8" />
          </clipPath>
        </defs>

        <style>
          {`
            @keyframes sidebarBrandCodeScroll {
              0% { transform: translateY(0); opacity: 0; }
              12% { opacity: 1; }
              88% { opacity: 1; }
              100% { transform: translateY(-18px); opacity: 0; }
            }

            @keyframes sidebarBrandBlink {
              0%, 100% { opacity: 0.35; }
              50% { opacity: 1; }
            }

            @keyframes sidebarBrandRotate {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }

            .sidebar-brand-code-line {
              animation: sidebarBrandCodeScroll 3.2s infinite linear;
            }

            .sidebar-brand-line-1 { animation-delay: 0s; }
            .sidebar-brand-line-2 { animation-delay: 0.9s; }
            .sidebar-brand-line-3 { animation-delay: 1.8s; }

            .sidebar-brand-agent-node {
              animation: sidebarBrandBlink 2.2s infinite ease-in-out;
            }

            .sidebar-brand-node-1 { animation-delay: 0s; }
            .sidebar-brand-node-2 { animation-delay: 0.7s; }
            .sidebar-brand-node-3 { animation-delay: 1.4s; }

            .sidebar-brand-cron-ring {
              transform-origin: center;
              animation: sidebarBrandRotate 22s infinite linear;
            }
          `}
        </style>

        <circle cx="160" cy="96" r="82" stroke="#20324a" strokeWidth="2" fill="none" opacity="0.9" />
        <circle cx="160" cy="96" r="62" stroke="#1e293b" strokeWidth="1.5" fill="none" opacity="0.9" />

        <g className="sidebar-brand-cron-ring">
          <line x1="160" y1="14" x2="160" y2="30" stroke="#38bdf8" strokeWidth="4.5" strokeLinecap="round" />
          <line x1="242" y1="96" x2="226" y2="96" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="160" y1="178" x2="160" y2="162" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="78" y1="96" x2="94" y2="96" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
        </g>

        <path d="M34 28H96" stroke="rgba(148,163,184,0.24)" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M224 192H286" stroke="rgba(148,163,184,0.16)" strokeWidth="1.4" strokeLinecap="round" />

        <rect x="74" y="48" width="172" height="98" rx="22" fill={`url(#${terminalGradientId})`} stroke={`url(#${gradientId})`} strokeWidth="2.4" />
        <path d="M96 48H224C236.15 48 246 57.85 246 70V74H74V70C74 57.85 83.85 48 96 48Z" fill="#334155" />
        <circle cx="94" cy="61" r="3.5" fill="#ef4444" />
        <circle cx="106" cy="61" r="3.5" fill="#f59e0b" />
        <circle cx="118" cy="61" r="3.5" fill="#10b981" />

        <text
          x="96"
          y="94"
          fill="#38bdf8"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="16"
          fontWeight="700"
        >
          &gt;_
        </text>

        <g clipPath={`url(#${clipId})`}>
          <g className="sidebar-brand-code-line sidebar-brand-line-1">
            <rect x="126" y="100" width="58" height="5.5" rx="2.75" fill="#38bdf8" opacity="0.76" />
          </g>
          <g className="sidebar-brand-code-line sidebar-brand-line-2">
            <rect x="126" y="112" width="82" height="5.5" rx="2.75" fill="#818cf8" opacity="0.76" />
          </g>
          <g className="sidebar-brand-code-line sidebar-brand-line-3">
            <rect x="126" y="124" width="42" height="5.5" rx="2.75" fill="#38bdf8" opacity="0.76" />
          </g>
        </g>

        <path d="M160 146L160 168" stroke="#475569" strokeWidth="1.7" strokeDasharray="4 4" />
        <path d="M160 146L108 176" stroke="#475569" strokeWidth="1.7" strokeDasharray="4 4" />
        <path d="M160 146L216 176" stroke="#475569" strokeWidth="1.7" strokeDasharray="4 4" />

        <circle className="sidebar-brand-agent-node sidebar-brand-node-2" cx="108" cy="178" r="7.5" fill="#818cf8" />
        <circle className="sidebar-brand-agent-node sidebar-brand-node-1" cx="160" cy="178" r="7.5" fill="#38bdf8" />
        <circle className="sidebar-brand-agent-node sidebar-brand-node-3" cx="216" cy="178" r="7.5" fill="#c084fc" />

        <text
          x="76"
          y="206"
          fill="#818cf8"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="11"
          fontWeight="700"
          letterSpacing="0.18em"
        >
          CDX
        </text>
        <text
          x="146"
          y="206"
          fill="#38bdf8"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="11"
          fontWeight="700"
          letterSpacing="0.18em"
        >
          CL
        </text>
        <text
          x="204"
          y="206"
          fill="#c084fc"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="11"
          fontWeight="700"
          letterSpacing="0.18em"
        >
          GEM
        </text>
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-sky-300/40 to-transparent" />
    </div>
  );
};

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

const navItems: SidebarNavItem[] = [
  {
    to: "/",
    label: "控制面板",
    icon: IconDashboard,
    matchPatterns: [{ path: "/", end: true }],
  },
  {
    to: "/terminal",
    label: "终端交互",
    icon: IconTerminal,
    matchPatterns: [{ path: "/terminal", end: false }],
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
  {
    to: "/settings",
    label: "系统设置",
    icon: IconGear,
    matchPatterns: [{ path: "/settings", end: false }],
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
      className={`group relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold tracking-tight transition-all duration-200 ${
        isActive
          ? "bg-emerald-50 text-emerald-700"
          : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
      }`}
    >
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
    </Link>
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
      style={{ width: collapsed ? '68px' : '204px' }}
    >
      {/* Subtle top gradient */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400/20 to-transparent" />

      {/* Brand Header */}
      <div className="relative px-0 pt-0 pb-4">
        <div className="flex items-center justify-center">
          {/* Animated Brand Logo */}
          <div className="flex w-full shrink-0 items-center justify-center transition-transform duration-300 hover:scale-[1.01]">
            <BrandLogo collapsed={collapsed} />
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-1 px-3 pt-5">
        {navItems.map((item) => (
          <SidebarLink key={item.to} {...item} collapsed={collapsed} />
        ))}
      </nav>

      {/* Bottom Section */}
      <div className="px-3 pb-5 pt-3">
        <div className="mx-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent mb-4" />

        {/* Collapse Toggle - icon only */}
        <button
          onClick={toggleCollapsed}
          className="w-full flex items-center justify-center p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all duration-200"
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
