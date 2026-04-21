import { useMemo } from "react";
import { DesktopSessionManagementSection } from "../components/settings/DesktopSessionManagementSection";
import { useStore } from "../lib/store";

export function DesktopSessionManagementPage() {
  const workspaces = useStore((state) => state.workspaces);
  const terminalTabs = useStore((state) => state.terminalTabs);
  const activeTerminalTabId = useStore((state) => state.activeTerminalTabId);

  const initialWorkspaceId = useMemo(() => {
    const activeTab =
      terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? terminalTabs[0] ?? null;
    return activeTab?.workspaceId ?? workspaces[0]?.id ?? null;
  }, [activeTerminalTabId, terminalTabs, workspaces]);

  return (
    <section className="settings-section">
      <DesktopSessionManagementSection
        title="项目会话管理"
        description="按项目统一管理真实会话历史，支持分页读取、筛选、批量归档、取消归档与删除。"
        workspaces={workspaces}
        initialWorkspaceId={initialWorkspaceId}
      />
    </section>
  );
}
