import type { ComponentType } from "react";
import {
  Activity as ActivityIcon,
  FolderTree as FilesPanelIcon,
  GitBranch as GitIcon,
  Network as WorkflowIcon,
  LayoutList as RadarIcon,
  Search as SearchIcon,
} from "lucide-react";

export type WorkspacePanelMode = "activity" | "radar" | "workflow" | "git" | "files" | "search";

export const WORKSPACE_PANEL_STORAGE_KEY = "multi-cli-studio::workspace-right-panel-mode";

export const WORKSPACE_PANEL_MODES: Array<{
  id: WorkspacePanelMode;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "activity", label: "Activity", icon: ActivityIcon },
  { id: "radar", label: "Radar", icon: RadarIcon },
  { id: "workflow", label: "Workflow", icon: WorkflowIcon },
  { id: "git", label: "Git", icon: GitIcon },
  { id: "files", label: "Files", icon: FilesPanelIcon },
  { id: "search", label: "Search", icon: SearchIcon },
];
