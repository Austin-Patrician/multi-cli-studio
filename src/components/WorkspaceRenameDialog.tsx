import { useEffect } from "react";
import { X } from "lucide-react";
import type { WorkspaceRef } from "../lib/models";

type WorkspaceRenameDialogProps = {
  isOpen: boolean;
  workspace: WorkspaceRef | null;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function WorkspaceRenameDialog({
  isOpen,
  workspace,
  value,
  onChange,
  onClose,
  onSubmit,
}: WorkspaceRenameDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !workspace) {
    return null;
  }

  return (
    <div className="vendor-dialog-overlay" onClick={onClose}>
      <div
        className="vendor-dialog vendor-dialog-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-rename-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="vendor-dialog-header">
          <h3 id="workspace-rename-dialog-title">重命名工作区</h3>
          <button type="button" className="vendor-dialog-close" onClick={onClose} aria-label="关闭重命名对话框">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="vendor-dialog-body">
          <div className="vendor-form-group">
            <label htmlFor="workspace-rename-input">工作区名称</label>
            <input
              id="workspace-rename-input"
              autoFocus
              className="vendor-input"
              value={value}
              placeholder={workspace.defaultName}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmit();
                }
              }}
            />
            <div className="vendor-hint">留空会恢复默认名称。默认名称：{workspace.defaultName}</div>
          </div>
        </div>
        <div className="vendor-dialog-footer" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="dcc-action-button secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="dcc-action-button" onClick={onSubmit}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
