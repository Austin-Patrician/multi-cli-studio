type UpdateStage =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "restarting"
  | "latest"
  | "error";

export type UpdateState = {
  stage: UpdateStage;
  version?: string;
  progress?: {
    totalBytes?: number;
    downloadedBytes: number;
  };
  error?: string;
};

type UpdateToastProps = {
  state: UpdateState;
  onUpdate: () => void;
  onDismiss: () => void;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}

export function UpdateToast({ state, onUpdate, onDismiss }: UpdateToastProps) {
  if (state.stage === "idle") {
    return null;
  }

  const totalBytes = state.progress?.totalBytes;
  const downloadedBytes = state.progress?.downloadedBytes ?? 0;
  const percent =
    totalBytes && totalBytes > 0
      ? Math.min(100, (downloadedBytes / totalBytes) * 100)
      : null;

  return (
    <div className="app-update-toasts" role="region" aria-live="polite">
      <div className="app-update-toast" role="status">
        <div className="app-update-toast-header">
          <div>
            <div className="app-update-toast-eyebrow">Application Update</div>
            <div className="app-update-toast-title">Multi CLI Studio</div>
          </div>
          {state.version ? <div className="app-update-toast-version">v{state.version}</div> : null}
        </div>

        {state.stage === "checking" ? (
          <div className="app-update-toast-body">正在检查更新…</div>
        ) : null}

        {state.stage === "available" ? (
          <>
            <div className="app-update-toast-body">发现新版本，可以现在下载安装。</div>
            <div className="app-update-toast-actions">
              <button type="button" className="app-update-toast-secondary" onClick={onDismiss}>
                稍后
              </button>
              <button type="button" className="app-update-toast-primary" onClick={onUpdate}>
                立即更新
              </button>
            </div>
          </>
        ) : null}

        {state.stage === "latest" ? (
          <div className="app-update-toast-inline">
            <div className="app-update-toast-body">当前已经是最新版本。</div>
            <button type="button" className="app-update-toast-secondary" onClick={onDismiss}>
              关闭
            </button>
          </div>
        ) : null}

        {state.stage === "downloading" ? (
          <>
            <div className="app-update-toast-body">正在下载更新包…</div>
            <div className="app-update-toast-progress">
              <div className="app-update-toast-progress-bar">
                <span
                  className="app-update-toast-progress-fill"
                  style={{ width: percent != null ? `${percent}%` : "18%" }}
                />
              </div>
              <div className="app-update-toast-meta">
                {totalBytes
                  ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
                  : `${formatBytes(downloadedBytes)} 已下载`}
              </div>
            </div>
          </>
        ) : null}

        {state.stage === "installing" ? (
          <div className="app-update-toast-body">正在安装更新…</div>
        ) : null}

        {state.stage === "restarting" ? (
          <div className="app-update-toast-body">安装完成，正在重启应用…</div>
        ) : null}

        {state.stage === "error" ? (
          <>
            <div className="app-update-toast-body">更新失败，请重试。</div>
            {state.error ? <div className="app-update-toast-error">{state.error}</div> : null}
            <div className="app-update-toast-actions">
              <button type="button" className="app-update-toast-secondary" onClick={onDismiss}>
                关闭
              </button>
              <button type="button" className="app-update-toast-primary" onClick={onUpdate}>
                重试
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
