import { memo, useMemo } from "react";

import { getFileIcon, getFolderIcon } from "../utils/fileIcons";

type FileIconProps = {
  filePath: string;
  isFolder?: boolean;
  isOpen?: boolean;
  className?: string;
};

function getFileName(filePath: string) {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

function getFileIconSvg(filePath: string, isFolder?: boolean, isOpen?: boolean) {
  const name = getFileName(filePath);

  if (isFolder) {
    return getFolderIcon(name, isOpen);
  }

  const cleanName = name.replace(/:\d+(-\d+)?$/, "");
  const extension = cleanName.includes(".") ? cleanName.split(".").pop() : "";
  return getFileIcon(extension, cleanName);
}

const MemoizedFileIcon = memo(({ filePath, isFolder = false, isOpen = false, className }: FileIconProps) => {
  const svgContent = useMemo(() => getFileIconSvg(filePath, isFolder, isOpen), [filePath, isFolder, isOpen]);

  return (
    <span
      className={className}
      style={{ display: "inline-flex", width: 16, height: 16, flexShrink: 0, overflow: "hidden" }}
      dangerouslySetInnerHTML={{ __html: svgContent }}
      aria-hidden="true"
    />
  );
});

MemoizedFileIcon.displayName = "FileIcon";

export const FileIcon = MemoizedFileIcon;
export { getFileIconSvg, getFileName };
