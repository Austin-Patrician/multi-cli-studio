import { useStore } from "../lib/store";

const TONE_COLORS: Record<string, string> = {
  info: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function RecentActivity() {
  const appState = useStore((s) => s.appState);
  if (!appState) return null;

  const items = appState.activity.slice(0, 10);

  return (
    <div>
      <h2 className="text-sm font-semibold text-text mb-3">Recent Activity</h2>
      <div className="border border-border rounded-[8px] bg-bg divide-y divide-border">
        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted">No activity yet.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="px-4 py-3 flex gap-3">
              <div className="pt-1.5">
                <span className={`block w-2 h-2 rounded-full ${TONE_COLORS[item.tone] ?? "bg-muted"}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-text">{item.title}</span>
                  <span className="text-xs text-muted shrink-0">{item.time}</span>
                </div>
                <p className="text-xs text-secondary mt-0.5">{item.detail}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
