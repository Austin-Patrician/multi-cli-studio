import { Outlet } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { GlobalGitDrawer } from "../components/settings/GlobalGitDrawer";

export function AppLayout() {
  return (
    <div className="relative flex h-full">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-hidden bg-bg">
        <div className="h-full overflow-auto">
          <Outlet />
        </div>
      </main>
      <GlobalGitDrawer />
    </div>
  );
}
