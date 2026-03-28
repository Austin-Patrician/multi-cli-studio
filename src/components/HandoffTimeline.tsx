import { EnrichedHandoff } from "../lib/models";

interface Props {
  handoffs: EnrichedHandoff[];
  selectedId: string | null;
  onSelect: (handoffId: string) => void;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function statusTone(status: EnrichedHandoff["status"]) {
  switch (status) {
    case "completed":
      return "bg-emerald-500";
    case "ready":
      return "bg-sky-500";
    default:
      return "bg-amber-500";
  }
}

export function HandoffTimeline({ handoffs, selectedId, onSelect }: Props) {

  if (handoffs.length === 0) {
    return (
      <div className="px-5 py-8 text-sm text-slate-500">
        No handoffs recorded yet.
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-200">
      {handoffs.map((handoff) => {
        const isSelected = selectedId === handoff.id;
        return (
          <button
            key={handoff.id}
            type="button"
            onClick={() => onSelect(handoff.id)}
            className={`w-full border-l-2 px-4 py-4 text-left transition-colors ${
              isSelected
                ? "border-slate-900 bg-slate-50/80"
                : "border-transparent hover:bg-slate-50/60"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${statusTone(handoff.status)}`} />
                  <span className="text-sm font-semibold text-slate-900">
                    {handoff.from} → {handoff.to}
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                    {handoff.status}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-[13px] leading-6 text-slate-600">
                  {handoff.userGoal}
                </div>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
                  <span>{handoff.changedFiles.length} files</span>
                  <span>{handoff.previousTurns.length} turns</span>
                </div>
              </div>
              <div className="shrink-0 text-[11px] text-slate-400">
                {formatTimestamp(handoff.timestamp)}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
