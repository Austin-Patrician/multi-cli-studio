import { useEffect, useMemo, useState } from "react";
import type { EnrichedHandoff, HandoffPack } from "../lib/models";
import { useStore } from "../lib/store";
import { HandoffTimeline } from "../components/HandoffTimeline";
import { ConversationHistory } from "../components/ConversationHistory";

const DISPLAY_FONT = {
  fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
} as const;

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function statusLabel(status: EnrichedHandoff["status"]) {
  switch (status) {
    case "completed":
      return "Completed";
    case "ready":
      return "Ready";
    default:
      return "Draft";
  }
}

function summaryDiff(diffText: string) {
  const lines = diffText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("diff --git"));
  return lines.slice(0, 6);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
      {children}
    </div>
  );
}

function fallbackHandoffTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function toLedgerHandoff(handoff: HandoffPack): EnrichedHandoff {
  return {
    id: handoff.id,
    from: handoff.from,
    to: handoff.to,
    timestamp: fallbackHandoffTimestamp(handoff.updatedAt),
    gitDiff: "",
    changedFiles: handoff.files,
    previousTurns: [],
    userGoal: handoff.goal,
    status: handoff.status === "ready" ? "ready" : "draft",
  };
}

function DetailSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-slate-200 pt-5 first:border-t-0 first:pt-0">
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SelectedHandoffDetail({ handoff }: { handoff: EnrichedHandoff | null }) {
  if (!handoff) {
    return (
      <div className="flex h-full items-center justify-center px-8 py-12 text-sm text-slate-500">
        Select a handoff to inspect its context.
      </div>
    );
  }

  const diffLines = summaryDiff(handoff.gitDiff);

  return (
    <div className="flex h-full flex-col px-6 py-6 sm:px-8">
      <div className="border-b border-slate-200 pb-5">
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          <span>{statusLabel(handoff.status)}</span>
          <span>·</span>
          <span>{formatTimestamp(handoff.timestamp)}</span>
        </div>
        <div className="mt-3 text-[28px] tracking-[-0.05em] text-slate-950" style={DISPLAY_FONT}>
          {handoff.from} to {handoff.to}
        </div>
        <div className="mt-3 max-w-2xl text-[14px] leading-7 text-slate-600">
          {handoff.userGoal}
        </div>
      </div>

      <div className="mt-6 space-y-5">
        <DetailSection label="Changed files">
          {handoff.changedFiles.length === 0 ? (
            <div className="text-sm text-slate-500">No tracked file changes.</div>
          ) : (
            <div className="space-y-1.5">
              {handoff.changedFiles.map((file) => (
                <div
                  key={file}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 text-sm last:border-b-0 last:pb-0"
                >
                  <span className="min-w-0 truncate text-slate-900">{file}</span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">
                    file
                  </span>
                </div>
              ))}
            </div>
          )}
        </DetailSection>

        <DetailSection label="Diff summary">
          {diffLines.length === 0 ? (
            <div className="text-sm text-slate-500">No diff summary captured.</div>
          ) : (
            <div className="space-y-1.5 font-mono text-[11px] leading-5 text-slate-600">
              {diffLines.map((line, index) => (
                <div key={`${handoff.id}-${index}`} className="whitespace-pre-wrap break-all">
                  {line}
                </div>
              ))}
            </div>
          )}
        </DetailSection>

        <DetailSection label={`Previous turns (${handoff.previousTurns.length})`}>
          {handoff.previousTurns.length === 0 ? (
            <div className="text-sm text-slate-500">No prior turns attached to this handoff.</div>
          ) : (
            <div className="space-y-3">
              {handoff.previousTurns.slice(0, 4).map((turn) => (
                <div
                  key={turn.id}
                  className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <span className="capitalize">{turn.agentId}</span>
                    <span>·</span>
                    <span>{turn.writeMode ? "write" : "read-only"}</span>
                    <span>·</span>
                    <span>{turn.durationMs}ms</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-900">{turn.userPrompt}</div>
                  <div className="mt-1 text-[13px] leading-6 text-slate-500">
                    {turn.outputSummary}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DetailSection>
      </div>
    </div>
  );
}

export function HandoffPage() {
  const contextStore = useStore((s) => s.contextStore);
  const appState = useStore((s) => s.appState);
  const loadContextStore = useStore((s) => s.loadContextStore);
  const [selectedHandoffId, setSelectedHandoffId] = useState<string | null>(null);

  useEffect(() => {
    loadContextStore();
  }, []);

  const enrichedHandoffs = useMemo(() => {
    if ((contextStore?.handoffs?.length ?? 0) > 0) {
      return contextStore?.handoffs ?? [];
    }
    return (appState?.handoffs ?? []).map(toLedgerHandoff);
  }, [contextStore?.handoffs, appState?.handoffs]);

  useEffect(() => {
    if (enrichedHandoffs.length === 0) {
      setSelectedHandoffId(null);
      return;
    }

    if (
      !selectedHandoffId ||
      !enrichedHandoffs.some((handoff) => handoff.id === selectedHandoffId)
    ) {
      setSelectedHandoffId(enrichedHandoffs[0].id);
    }
  }, [enrichedHandoffs, selectedHandoffId]);

  const selectedHandoff = useMemo(
    () =>
      enrichedHandoffs.find((handoff) => handoff.id === selectedHandoffId) ?? null,
    [enrichedHandoffs, selectedHandoffId]
  );

  return (
    <div className="min-h-full bg-[linear-gradient(180deg,_#f5f6f7_0%,_#fbfbfb_45%,_#f2f3f5_100%)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1380px] space-y-6">
        <section className="border-b border-slate-200 pb-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Handoff
          </div>
          <div
            className="mt-2 text-[38px] tracking-[-0.06em] text-slate-950 sm:text-[46px]"
            style={DISPLAY_FONT}
          >
            Handoff ledger
          </div>
          <div className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
            Review recorded transfers, inspect the current handoff payload, and revisit prior context only when needed.
          </div>
        </section>

        <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.05)]">
          <div className="grid min-h-[560px] xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="border-b border-slate-200 xl:border-b-0 xl:border-r">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Recorded handoffs
                </div>
                <div className="mt-1 text-sm font-medium text-slate-700">
                  {enrichedHandoffs.length} item{enrichedHandoffs.length === 1 ? "" : "s"}
                </div>
              </div>

              <div className="max-h-[560px] overflow-y-auto">
                <HandoffTimeline
                  handoffs={enrichedHandoffs}
                  selectedId={selectedHandoffId}
                  onSelect={setSelectedHandoffId}
                />
              </div>
            </div>

            <SelectedHandoffDetail handoff={selectedHandoff} />
          </div>
        </section>

        <section className="rounded-[22px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)] sm:px-6">
          <div className="mb-5 border-b border-slate-200 pb-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Archive
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              Conversation history
            </div>
          </div>
          <ConversationHistory />
        </section>
      </div>
    </div>
  );
}
