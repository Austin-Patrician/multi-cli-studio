import type { ComponentType } from "react";
import {
  Activity as ActivityIcon,
  FolderTree as FilesPanelIcon,
  GitBranch as GitIcon,
  LayoutList as RadarIcon,
  Search as SearchIcon,
} from "lucide-react";

export type WorkspacePanelMode = "activity" | "radar" | "git" | "files" | "search";

export const WORKSPACE_PANEL_STORAGE_KEY = "multi-cli-studio::workspace-right-panel-mode";

export const WORKSPACE_PANEL_MODES: Array<{
  id: WorkspacePanelMode;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: "activity", label: "Activity", icon: ActivityIcon },
  { id: "radar", label: "Radar", icon: RadarIcon },
  { id: "git", label: "Git", icon: GitIcon },
  { id: "files", label: "Files", icon: FilesPanelIcon },
  { id: "search", label: "Search", icon: SearchIcon },
];
