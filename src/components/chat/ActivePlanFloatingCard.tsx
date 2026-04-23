import { Check, ChevronDown, ChevronUp, LoaderCircle } from "lucide-react";
import {
  AgentId,
  ChatMessage,
  ChatMessageBlock,
  LivePlanState,
} from "../../lib/models";

type ActivePlanTextBlock = Extract<ChatMessageBlock, { kind: "plan" }>;
type ActiveOrchestrationPlanBlock = Extract<
  ChatMessageBlock,
  { kind: "orchestrationPlan" }
>;
type ActiveOrchestrationStepBlock = Extract<
  ChatMessageBlock,
  { kind: "orchestrationStep" }
>;

export type ActivePlanStatus =
  | "planning"
  | "planned"
  | "running"
  | "synthesizing"
  | "completed"
  | "failed"
  | "skipped";

export type ActivePlanStep = {
  id: string;
  owner?: AgentId | null;
  title: string;
  summary?: string | null;
  status: ActivePlanStatus;
};

export type ActivePlanGroup = {
  plan?: ActiveOrchestrationPlanBlock | null;
  steps: ActivePlanStep[];
  status: ActivePlanStatus;
  summary?: string | null;
  isLive: boolean;
};

export type ActivePlanSurface = {
  group: ActivePlanGroup;
  cliId: AgentId;
};

function isActivePlanBlock(
  block: ChatMessageBlock,
): block is
  | ActivePlanTextBlock
  | ActiveOrchestrationPlanBlock
  | ActiveOrchestrationStepBlock {
  return (
    block.kind === "plan" ||
    block.kind === "orchestrationPlan" ||
    block.kind === "orchestrationStep"
  );
}

function normalizeActivePlanStatus(status?: string | null): ActivePlanStatus {
  switch (status) {
    case "planned":
    case "running":
    case "synthesizing":
    case "completed":
    case "failed":
    case "skipped":
      return status;
    default:
      return "planning";
  }
}

function parseActivePlanText(text: string) {
  const introLines: string[] = [];
  const steps: Array<{ title: string; summary?: string | null }> = [];
  let current: { title: string; details: string[] } | null = null;

  const flushCurrent = () => {
    if (!current) return;
    steps.push({
      title: current.title.trim(),
      summary: current.details.join("\n").trim() || null,
    });
    current = null;
  };

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current && current.details[current.details.length - 1] !== "") {
        current.details.push("");
      } else if (!current && introLines[introLines.length - 1] !== "") {
        introLines.push("");
      }
      continue;
    }

    const numberedMatch = trimmed.match(
      /^(?:step\s*)?(?:\d+|[a-z])(?:[\.\):\-]|(?:\s*[-:]))\s+(.+)$/i,
    );
    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    const stepTitle = numberedMatch?.[1] ?? bulletMatch?.[1] ?? null;

    if (stepTitle) {
      flushCurrent();
      current = { title: stepTitle, details: [] };
      continue;
    }

    if (current) {
      current.details.push(trimmed);
    } else {
      introLines.push(trimmed);
    }
  }

  flushCurrent();

  const intro = introLines.join("\n").trim() || null;
  if (steps.length > 0) {
    return { intro, steps };
  }

  const fallback = text.trim();
  return {
    intro: null,
    steps: fallback
      ? [
          {
            title: fallback,
            summary: null,
          },
        ]
      : [],
  };
}

function deriveActivePlanStatus(
  plan: ActiveOrchestrationPlanBlock | null | undefined,
  steps: ActivePlanStep[],
  isStreaming: boolean,
): ActivePlanStatus {
  if (plan?.status) {
    return normalizeActivePlanStatus(plan.status);
  }
  if (steps.some((step) => step.status === "failed")) {
    return "failed";
  }
  if (steps.some((step) => step.status === "running")) {
    return "running";
  }
  if (steps.some((step) => step.status === "completed")) {
    return steps.every((step) => step.status === "completed")
      ? "completed"
      : "running";
  }
  return isStreaming ? "planning" : "completed";
}

function buildActivePlanGroup(
  blocks: Array<
    ActivePlanTextBlock | ActiveOrchestrationPlanBlock | ActiveOrchestrationStepBlock
  >,
  isStreaming: boolean,
): ActivePlanGroup {
  const plan = blocks.find(
    (block): block is ActiveOrchestrationPlanBlock =>
      block.kind === "orchestrationPlan",
  );
  const orchestrationSteps = blocks.filter(
    (block): block is ActiveOrchestrationStepBlock =>
      block.kind === "orchestrationStep",
  );
  const planText = blocks
    .filter((block): block is ActivePlanTextBlock => block.kind === "plan")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
  const parsedPlan = planText
    ? parseActivePlanText(planText)
    : { intro: null, steps: [] };

  const steps: ActivePlanStep[] =
    orchestrationSteps.length > 0
      ? orchestrationSteps.map((block, index) => ({
          id: block.stepId || `overlay-step-${index + 1}`,
          owner: block.owner,
          title: block.title,
          summary: block.summary,
          status: normalizeActivePlanStatus(block.status ?? "planned"),
        }))
      : parsedPlan.steps.map((step, index) => ({
          id: `overlay-plan-${index + 1}`,
          owner: null,
          title: step.title,
          summary: step.summary,
          status:
            isStreaming && index === 0
              ? "running"
              : !isStreaming && index === parsedPlan.steps.length - 1
                ? "completed"
                : "planned",
        }));

  return {
    plan,
    steps,
    status: deriveActivePlanStatus(plan, steps, isStreaming),
    summary: plan?.summary ?? parsedPlan.intro ?? null,
    isLive: isStreaming || steps.some((step) => step.status === "running"),
  };
}

function findActivePlanMessage(messages: ChatMessage[] | null | undefined) {
  if (!messages?.length) return null;
  return (
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          message.isStreaming &&
          Boolean(message.blocks?.some((block) => isActivePlanBlock(block))),
      ) ?? null
  );
}

function activePlanOwnerLabel(owner: AgentId) {
  return owner === "claude" ? "Claude" : owner === "gemini" ? "Gemini" : "Codex";
}

function activePlanStatusLabel(status: ActivePlanStatus) {
  return status === "synthesizing"
    ? "Synthesizing"
    : status.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function activePlanStatusTone(status: ActivePlanStatus) {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (status === "running" || status === "synthesizing") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-slate-200 bg-white text-slate-600";
}

function activePlanStepTone(status: ActivePlanStatus, current: boolean) {
  if (status === "completed") {
    return {
      dot: "border-emerald-300 bg-emerald-500 text-white",
      row: "border-emerald-200/80 bg-emerald-50/85",
    };
  }
  if (status === "failed") {
    return {
      dot: "border-rose-300 bg-rose-500 text-white",
      row: "border-rose-200/80 bg-rose-50/85",
    };
  }
  if (status === "running" || status === "synthesizing") {
    return {
      dot: "border-sky-300 bg-sky-500 text-white shadow-[0_0_0_3px_rgba(59,130,246,0.12)]",
      row: "border-sky-200/90 bg-sky-50/90",
    };
  }
  return {
    dot: current
      ? "border-violet-300 bg-violet-100 text-violet-700"
      : "border-slate-300 bg-white text-slate-500",
    row: current ? "border-violet-200/80 bg-violet-50/75" : "border-slate-200/80 bg-white/92",
  };
}

function currentActiveStep(group: ActivePlanGroup) {
  return (
    group.steps.find((step) => step.status === "running") ??
    group.steps.find((step) => step.status === "failed") ??
    group.steps.find((step) => step.status === "planned") ??
    group.steps[group.steps.length - 1] ??
    null
  );
}

export function resolveActivePlanSurface(
  messages: ChatMessage[] | null | undefined,
  livePlan: LivePlanState | null | undefined,
): ActivePlanSurface | null {
  const activePlanMessage = findActivePlanMessage(messages);
  const timelineBlocks = livePlan
    ? livePlan.blocks.filter((block) => isActivePlanBlock(block))
    : activePlanMessage?.blocks?.filter((block) => isActivePlanBlock(block)) ?? [];

  if (timelineBlocks.length === 0) {
    return null;
  }

  const group = buildActivePlanGroup(
    timelineBlocks,
    livePlan ? true : Boolean(activePlanMessage?.isStreaming),
  );
  const cliId = (livePlan?.cliId ?? activePlanMessage?.cliId ?? null) as AgentId | null;

  if (!cliId) {
    return null;
  }

  return { group, cliId };
}

export function ActivePlanFloatingCard({
  group,
  cliId,
  collapsed,
  onToggle,
}: {
  group: ActivePlanGroup;
  cliId: AgentId;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const currentStep = currentActiveStep(group);
  const completedCount = group.steps.filter(
    (step) => step.status === "completed",
  ).length;
  const heading = currentStep?.title ?? group.plan?.title ?? `${activePlanOwnerLabel(cliId)} plan`;

  return (
    <div className="pointer-events-auto w-full max-w-[min(34rem,calc(100vw-3rem))]">
      <div className="overflow-hidden rounded-[14px] border border-slate-200/90 bg-white/92 shadow-[0_14px_34px_rgba(15,23,42,0.08)] ring-1 ring-white/80 backdrop-blur-md">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50/90"
          aria-expanded={!collapsed}
        >
          <span className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
            Plan
          </span>
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${activePlanStatusTone(group.status)}`}
          >
            {activePlanStatusLabel(group.status)}
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-slate-600">
            {completedCount}/{group.steps.length || 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-900">
            {heading}
          </span>
          <span className="inline-flex shrink-0 items-center justify-center text-slate-500">
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </span>
        </button>

        {!collapsed ? (
          <div className="border-t border-slate-200/80 px-3.5 py-3">
            {group.steps.length > 0 ? (
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {group.steps.map((step) => {
                  const isCurrent = currentStep?.id === step.id;
                  const tone = activePlanStepTone(step.status, isCurrent);
                  return (
                    <div
                      key={step.id}
                      className={`flex items-center gap-2.5 rounded-[12px] border px-2.5 py-2 ${tone.row}`}
                    >
                      <span
                        className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${tone.dot}`}
                      >
                        {step.status === "completed" ? (
                          <Check size={10} strokeWidth={2.4} />
                        ) : step.status === "running" ||
                          step.status === "synthesizing" ? (
                          <LoaderCircle
                            size={10}
                            className="animate-spin"
                            strokeWidth={2.4}
                          />
                        ) : (
                          <span>{group.steps.indexOf(step) + 1}</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-900">
                        {step.title}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[12px] border border-slate-200/80 bg-slate-50/90 px-3 py-2 text-[11px] text-slate-600">
                Preparing execution steps...
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
