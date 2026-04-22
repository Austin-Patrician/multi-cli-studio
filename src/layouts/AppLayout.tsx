import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { DesktopWindowChrome } from "../components/DesktopWindowChrome";
import { GlobalGitDrawer } from "../components/settings/GlobalGitDrawer";

export function AppLayout() {
  const location = useLocation();
  const showChromeControls = !location.pathname.startsWith("/terminal");

  return (
    <div className="relative flex h-full flex-col">
      <DesktopWindowChrome showControls={showChromeControls} />
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-hidden bg-bg">
          <div className="h-full overflow-auto">
            <Outlet />
          </div>
        </main>
      </div>
      <GlobalGitDrawer />
    </div>
  );
}
