import { useEffect, useMemo, useState } from "react";
import { FolderOpen, GitBranch, Link2, Plus, TerminalSquare, Trash2 } from "lucide-react";
import type { TerminalTab, WorkspaceRef } from "../../lib/models";

const PROJECTS_PAGE_SIZE = 8;

export type DesktopProjectHealthTone = "clean" | "modified" | "attention" | "neutral";

export type DesktopProjectView = {
  workspace: WorkspaceRef;
  tabs: TerminalTab[];
  primaryTab: TerminalTab | null;
  sessionCount: number;
  hasPlanModeSession: boolean;
  statusLabel: string;
  statusCopy: string;
  healthTone: DesktopProjectHealthTone;
};

type DesktopProjectsSectionProps = {
  activeWorkspaceId: string | null;
  projects: DesktopProjectView[];
  onAddProject: () => void;
  onOpenConnections: () => void;
  onOpenWorkspaceTerminal: (workspaceId: string) => void;
  onOpenWorkspaceGitPanel: (workspaceId: string) => void;
  onDeleteProject: (project: DesktopProjectView) => void;
};

function projectLocation(project: DesktopProjectView) {
  const { workspace } = project;
  return workspace.locationKind === "ssh" && workspace.locationLabel
    ? `${workspace.locationLabel} · ${workspace.rootPath}`
    : workspace.rootPath;
}

export function DesktopProjectsSection({
  activeWorkspaceId,
  projects,
  onAddProject,
  onOpenConnections,
  onOpenWorkspaceTerminal,
  onOpenWorkspaceGitPanel,
  onDeleteProject,
}: DesktopProjectsSectionProps) {
  const [page, setPage] = useState(1);
  const projectSummary = {
    mountedProjects: projects.length,
    activeSessions: projects.reduce((sum, project) => sum + project.sessionCount, 0),
    changedProjects: projects.filter((project) => project.workspace.dirtyFiles > 0).length,
    cleanProjects: projects.filter((project) => project.workspace.dirtyFiles === 0 && project.workspace.failingChecks === 0).length,
  };
  const pageCount = Math.max(1, Math.ceil(projects.length / PROJECTS_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PROJECTS_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PROJECTS_PAGE_SIZE, projects.length);
  const pageProjects = useMemo(
    () => projects.slice(pageStart, pageEnd),
    [pageEnd, pageStart, projects],
  );

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(1, Math.ceil(projects.length / PROJECTS_PAGE_SIZE))));
  }, [projects.length]);

  return (
    <section className="settings-section dcc-projects-section">
      <div className="dcc-projects-hero">
        <div className="dcc-projects-hero-copy">
          <div className="settings-section-title">项目列表</div>
          <div className="settings-section-subtitle">管理已接入工作区，快速进入终端、Git 或删除项目。</div>
        </div>
        <div className="dcc-projects-hero-actions">
          <button
            type="button"
            className="dcc-action-button secondary dcc-project-icon-button"
            onClick={onOpenConnections}
            aria-label="管理 SSH 工作区"
            title="管理 SSH 工作区"
          >
            <Link2 size={15} />
          </button>
          <button
            type="button"
            className="dcc-action-button dcc-project-icon-button"
            onClick={onAddProject}
            aria-label="添加项目"
            title="添加一个本地工作区"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="dcc-projects-summary-grid">
        <div className="dcc-project-summary-card" title="当前已接入的工作区总数">
          <span className="dcc-project-summary-label">已接入项目</span>
          <strong className="dcc-project-summary-value">{projectSummary.mountedProjects}</strong>
        </div>
        <div className="dcc-project-summary-card" title="当前打开的终端标签页数量">
          <span className="dcc-project-summary-label">打开会话</span>
          <strong className="dcc-project-summary-value">{projectSummary.activeSessions}</strong>
        </div>
        <div className="dcc-project-summary-card" title="存在本地文件变更的工作区数量">
          <span className="dcc-project-summary-label">有变更项目</span>
          <strong className="dcc-project-summary-value">{projectSummary.changedProjects}</strong>
        </div>
        <div className="dcc-project-summary-card" title="没有变更且没有失败检查的工作区数量">
          <span className="dcc-project-summary-label">干净项目</span>
          <strong className="dcc-project-summary-value">{projectSummary.cleanProjects}</strong>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="dcc-projects-empty dcc-projects-ledger">
          <FolderOpen size={26} />
          <div className="dcc-card-title">还没有接入任何项目</div>
          <button type="button" className="dcc-action-button" onClick={onAddProject} title="添加一个本地工作区">
            <Plus size={14} />
            添加第一个项目
          </button>
        </div>
      ) : (
        <div className="dcc-projects-ledger">
          <div className="dcc-projects-list-head">
            <div>
              <div className="dcc-card-title">全部项目</div>
            </div>
          </div>

          <div className="dcc-projects-table">
            {pageProjects.map((project) => {
              const isCurrent = project.workspace.id === activeWorkspaceId;
              const location = projectLocation(project);
              const terminalTitle = project.primaryTab ? "打开已有终端会话" : "为该项目新建终端会话";

              return (
                <article className="dcc-project-table-row" key={project.workspace.id} title={project.statusCopy}>
                  <div className="dcc-project-table-name">
                    <span className="dcc-provider-name">{project.workspace.name}</span>
                    <div className="dcc-project-table-badges">
                      {isCurrent ? <span className="dcc-badge dcc-badge-success" title="当前工作区">当前</span> : null}
                      {project.hasPlanModeSession ? <span className="dcc-badge" title="存在 Plan Mode 会话">PLAN</span> : null}
                      {project.workspace.locationKind === "ssh" ? <span className="dcc-badge" title="远程 SSH 工作区">SSH</span> : null}
                    </div>
                  </div>
                  <div className="dcc-project-table-path" title={location}>{location}</div>
                  <div className="dcc-project-table-sessions" title="当前项目打开的会话数量">
                    {project.sessionCount} 个会话
                  </div>
                  <div className="dcc-project-row-actions">
                    <button
                      type="button"
                      className="dcc-action-button secondary dcc-project-icon-button"
                      onClick={() => onOpenWorkspaceTerminal(project.workspace.id)}
                      aria-label={terminalTitle}
                      title={terminalTitle}
                    >
                      <TerminalSquare size={15} />
                    </button>
                    <button
                      type="button"
                      className="dcc-action-button secondary dcc-project-icon-button"
                      onClick={() => onOpenWorkspaceGitPanel(project.workspace.id)}
                      aria-label="打开 Git 工作台"
                      title="打开 Git 工作台"
                    >
                      <GitBranch size={15} />
                    </button>
                    <button
                      type="button"
                      className="dcc-action-button danger dcc-project-icon-button"
                      onClick={() => onDeleteProject(project)}
                      aria-label="删除项目"
                      title="删除项目及关联本地记录"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {pageCount > 1 ? (
            <div className="dcc-projects-pagination">
              <div className="dcc-projects-pagination-summary">
                {pageStart + 1}-{pageEnd} / {projects.length}
              </div>
              <div className="dcc-projects-pagination-actions">
                <button
                  type="button"
                  className="dcc-action-button secondary dcc-project-icon-button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={currentPage <= 1}
                  aria-label="上一页"
                  title="上一页"
                >
                  ‹
                </button>
                <span className="dcc-projects-pagination-page">{currentPage} / {pageCount}</span>
                <button
                  type="button"
                  className="dcc-action-button secondary dcc-project-icon-button"
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  disabled={currentPage >= pageCount}
                  aria-label="下一页"
                  title="下一页"
                >
                  ›
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
