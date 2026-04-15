import {
  FileArchive,
  FileCode2,
  FileImage,
  FileJson2,
  FileSpreadsheet,
  FileText,
  FileType2,
  Folder,
  FolderOpen,
} from "lucide-react";

type FileIconProps = {
  filePath: string;
  isFolder?: boolean;
  isOpen?: boolean;
  className?: string;
};

function extensionOf(filePath: string) {
  const normalized = filePath.replace(/[\\/]+$/, "");
  const name = normalized.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function iconConfig(filePath: string) {
  const ext = extensionOf(filePath);
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "rs":
    case "py":
    case "java":
    case "cs":
    case "go":
      return { Icon: FileCode2, color: "#2f7de1" };
    case "json":
    case "jsonc":
      return { Icon: FileJson2, color: "#b7791f" };
    case "md":
    case "txt":
      return { Icon: FileText, color: "#64748b" };
    case "css":
    case "scss":
    case "less":
    case "html":
    case "xml":
    case "yml":
    case "yaml":
    case "toml":
      return { Icon: FileType2, color: "#0f766e" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
      return { Icon: FileImage, color: "#9333ea" };
    case "csv":
    case "xlsx":
    case "xls":
      return { Icon: FileSpreadsheet, color: "#15803d" };
    case "zip":
    case "rar":
    case "7z":
    case "gz":
      return { Icon: FileArchive, color: "#c2410c" };
    default:
      return { Icon: FileText, color: "#64748b" };
  }
}

export function FileIcon({ filePath, isFolder = false, isOpen = false, className }: FileIconProps) {
  if (isFolder) {
    const FolderIcon = isOpen ? FolderOpen : Folder;
    return <FolderIcon className={className} style={{ color: isOpen ? "#d97706" : "#2563eb" }} aria-hidden />;
  }

  const { Icon, color } = iconConfig(filePath);
  return <Icon className={className} style={{ color }} aria-hidden />;
}
