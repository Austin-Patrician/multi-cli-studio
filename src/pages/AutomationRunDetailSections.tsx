import type { ReactNode } from "react";
import type { AutomationRunDetail, ChatMessage } from "../lib/models";
import { cn, parameterValueText, statusText, statusTone } from "./automationUi";
import { buildAutomationConversationLog, messageText, orderedMessages } from "./automationLog";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset", statusTone(status))}>
      {statusText(status)}
    </span>
  );
}

export function AutomationRunConversationSection({
  messages,
  title = "执行日志",
  emptyText = "当前没有可展示的日志输出。",
  actions,
}: {
  messages: ChatMessage[];
  title?: string;
  emptyText?: string;
  actions?: ReactNode;
}) {
  const ordered = orderedMessages(messages);
  const logText = buildAutomationConversationLog(ordered);
  const entryCount = ordered.filter((message) => messageText(message)).length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-slate-900 bg-[#050c16] shadow-[0_24px_70px_rgba(2,8,23,0.32)]">
      <div className="flex items-center justify-between gap-4 border-b border-slate-800 bg-[#0a1422] px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-100">{title}</h2>
        </div>
        <div className="flex items-center gap-3">
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{entryCount} entries</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {!logText ? (
          <div className="text-sm text-slate-400">{emptyText}</div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-7 text-slate-100">{logText}</pre>
        )}
      </div>
    </div>
  );
}

export function AutomationRunSnapshotSection({ detail }: { detail: AutomationRunDetail }) {
  return (
    <div className="space-y-4 text-sm text-slate-600">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">任务目标</div>
        <div className="mt-2 whitespace-pre-wrap leading-7 text-slate-900">{detail.goal}</div>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">期望结果</div>
        <div className="mt-2 whitespace-pre-wrap leading-7 text-slate-900">{detail.expectedOutcome}</div>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">参数快照</div>
        <div className="mt-2 space-y-2">
          {Object.entries(detail.run.parameterValues).length === 0 ? (
            <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">本次运行没有额外参数。</div>
          ) : (
            Object.entries(detail.run.parameterValues).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="font-medium text-slate-700">{key}</span>
                <span className="text-slate-500">{parameterValueText(value)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
