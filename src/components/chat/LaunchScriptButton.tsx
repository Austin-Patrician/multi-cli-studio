import { useEffect, useRef } from "react";
import { Play } from "lucide-react";

export function LaunchScriptButton({
  launchScript,
  editorOpen,
  draftScript,
  isSaving,
  error,
  onRun,
  onOpenEditor,
  onCloseEditor,
  onDraftChange,
  onSave,
}: {
  launchScript: string | null;
  editorOpen: boolean;
  draftScript: string;
  isSaving: boolean;
  error: string | null;
  onRun: () => void;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const hasLaunchScript = Boolean(launchScript?.trim());

  useEffect(() => {
    if (!editorOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const popoverElement = popoverRef.current;
      if (!popoverElement || !(event.target instanceof Node)) return;
      if (popoverElement.contains(event.target)) return;
      onCloseEditor();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [editorOpen, onCloseEditor]);

  return (
    <div className="launch-script-menu" ref={popoverRef}>
      <button
        type="button"
        onClick={onRun}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenEditor();
        }}
        title={hasLaunchScript ? "运行启动脚本" : "设置启动脚本"}
        aria-label={hasLaunchScript ? "运行启动脚本" : "设置启动脚本"}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
          hasLaunchScript
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:-translate-y-[1px] hover:border-emerald-300 hover:text-emerald-800"
            : "border-slate-200 bg-white text-slate-500 hover:-translate-y-[1px] hover:border-slate-300 hover:text-slate-900"
        }`}
      >
        <Play className="h-[15px] w-[15px]" />
      </button>

      {editorOpen ? (
        <div className="launch-script-popover" role="dialog" onPointerDown={(event) => event.stopPropagation()}>
          <div className="launch-script-title">启动脚本</div>
          <textarea
            className="launch-script-textarea"
            placeholder="例如 npm run dev"
            value={draftScript}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={6}
          />
          {error ? <div className="launch-script-error">{error}</div> : null}
          <div className="launch-script-actions">
            <button type="button" className="launch-script-secondary" onClick={onCloseEditor}>
              取消
            </button>
            <button type="button" className="launch-script-primary" onClick={onSave} disabled={isSaving}>
              {isSaving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
