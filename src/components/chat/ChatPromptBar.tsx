import {
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Cpu,
  FileText,
  LoaderCircle,
  Paperclip,
  Image as ImageIcon,
  Route,
  SendHorizontal,
  Settings2,
  Shield,
  Square,
  Plus,
  X,
  Zap,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ACP_COMMANDS,
  AcpCliCapabilities,
  AcpCommandDef,
  AcpOptionDef,
  AcpPickerCommandKind,
  getCommandCategory,
  getCommandCategoryLabel,
  getPickerCatalog,
  isPickerCommandKind,
  mergeAcpModelCatalog,
  parseSlashCommand,
} from "../../lib/acp";
import {
  AgentId,
  ChatAttachment,
  ChatMessage,
  ChatMessageBlock,
  CliSkillItem,
  FileMentionCandidate,
  GitBranchListItem,
  GitHistoryCommit,
  SelectedCustomAgent,
  SshConnectionConfig,
  TerminalTab,
  TerminalCliId,
  ToolApprovalMode,
} from "../../lib/models";
import { bridge } from "../../lib/bridge";
import { createChatAttachment } from "../../lib/chatAttachments";
import { AgentIcon } from "../AgentIcon";
import { resolveSelectedCustomAgent } from "../../lib/customAgents";
import { useStore } from "../../lib/store";
import { useVendorModels, VENDOR_MODEL_STORAGE_KEYS } from "../../lib/vendorModels";
import { loadWorkspaceFileIndex } from "../../lib/workspaceFileIndex";
import { CLI_OPTIONS } from "./CliSelector";
import { PromptOverlay, PromptOverlayItem, PromptOverlaySection } from "./PromptOverlay";
import {
  ReviewInlinePrompt,
  type ReviewInlinePromptState,
  type ReviewPresetChoice,
} from "./ReviewInlinePrompt";

type InteractiveOverlayEntry =
  | { id: string; kind: "command"; command: AcpCommandDef }
  | { id: string; kind: "shortcut"; shortcut: "skills" }
  | { id: string; kind: "skill"; skill: CliSkillItem }
  | { id: string; kind: "mention"; mention: FileMentionCandidate }
  | { id: string; kind: "agent"; agent: SelectedCustomAgent | null; action: "select" | "create" }
  | { id: string; kind: "option"; commandKind: SelectableCommandKind; option: AcpOptionDef };

interface SkillOverlayState {
  title: string;
  description: string;
  footer: string;
  sections: PromptOverlaySection[];
  entries: InteractiveOverlayEntry[];
}

interface ChatPromptBarProps {
  statusPanelExpanded?: boolean;
  onToggleStatusPanel?: () => void;
}

type FooterMenuId = "config" | "agent" | "shortcuts" | "provider" | "mode" | "model" | "reasoning";

type FooterReasoningOption = {
  id: "low" | "medium" | "high" | "max";
  label: string;
  description: string;
};

type PromptShortcutAction = {
  key: string;
  trigger: string;
  label: string;
  onClick: () => void;
};

type SelectableCommandKind = AcpPickerCommandKind | "fast";
type ReviewPromptStep = "preset" | "baseBranch" | "commit" | "custom";

type FooterProviderItem = {
  id: TerminalCliId;
  label: string;
  icon?: string;
  installed: boolean;
  unavailable: boolean;
  remoteValidationKnown?: boolean;
};

type CommandOverlayState =
  | {
      kind: "command-list";
      title: string;
      description: string;
      footer: string;
      sections: PromptOverlaySection[];
      entries: InteractiveOverlayEntry[];
    }
  | {
      kind: "command-help";
      title: string;
      description: string;
      footer: string;
      sections: PromptOverlaySection[];
    }
  | {
      kind: "skill-command";
      title: string;
      description: string;
      footer: string;
      sections: PromptOverlaySection[];
      entries: InteractiveOverlayEntry[];
    }
  | {
      kind: "command-argument";
      title: string;
      description: string;
      footer: string;
      sections: PromptOverlaySection[];
      entries: InteractiveOverlayEntry[];
      commandKind: SelectableCommandKind;
      loading: boolean;
    };

function findMentionToken(value: string, caret: number) {
  const prefix = value.slice(0, caret);
  const match = prefix.match(/(?:^|\s)@([^\s@/]*)$/);
  if (!match || match.index == null) return null;
  const start = match.index + match[0].lastIndexOf("@");
  return {
    start,
    end: caret,
    query: match[1] ?? "",
  };
}

function findSkillToken(value: string, caret: number) {
  const prefix = value.slice(0, caret);
  const match = prefix.match(/^\s*\$([A-Za-z0-9._-]*)$/);
  if (!match || match.index == null) return null;
  const start = prefix.lastIndexOf("$");
  if (start < 0) return null;
  return {
    start,
    end: caret,
    query: match[1] ?? "",
  };
}

function findAgentToken(value: string, caret: number) {
  const prefix = value.slice(0, caret);
  const lineStart = prefix.lastIndexOf("\n") + 1;
  const linePrefix = prefix.slice(lineStart);
  const match = linePrefix.match(/^#([^\s#]*)$/);
  if (!match) return null;
  return {
    start: lineStart,
    end: caret,
    query: match[1] ?? "",
  };
}

function parseSkillSlashQuery(value: string) {
  const match = value.match(/^\/skills?(?:\s+(.*))?$/is);
  if (!match) return null;
  return match[1] ?? "";
}

function titleCaseCli(cliId: TerminalCliId) {
  if (cliId === "auto") return "Auto";
  return cliId.charAt(0).toUpperCase() + cliId.slice(1);
}

const CODEX_CONTEXT_COMPACTION_TEXT = "Codex compacted the thread context.";

function formatCompactCount(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) < 1000) return String(Math.round(value));
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: Math.abs(value) < 100_000 ? 1 : 0,
  }).format(value);
}

function hasRemoteCliDetection(connection: SshConnectionConfig | null | undefined) {
  if (!connection) return false;
  return Boolean(
    connection.lastValidatedAt ||
    connection.detectedCliPaths?.codex ||
    connection.detectedCliPaths?.claude ||
    connection.detectedCliPaths?.gemini
  );
}

function attachmentLabel(attachment: ChatAttachment) {
  return attachment.fileName;
}

function attachmentPreviewSrc(attachment: ChatAttachment) {
  if (attachment.source.startsWith("data:")) {
    return attachment.source;
  }
  if (attachment.source.startsWith("http://") || attachment.source.startsWith("https://")) {
    return attachment.source;
  }
  if (attachment.kind !== "image") {
    return "";
  }
  try {
    return convertFileSrc(attachment.source);
  } catch {
    return "";
  }
}

const CREATE_AGENT_ENTRY_ID = "__create-agent__";

const FOOTER_REASONING_OPTIONS: FooterReasoningOption[] = [
  { id: "low", label: "低", description: "更快响应，较少推理" },
  { id: "medium", label: "中", description: "平衡速度与推理深度" },
  { id: "high", label: "高", description: "更深入的推理与分析" },
  { id: "max", label: "最大", description: "最深推理，耗时更长" },
];

function footerModeLabel(value: string) {
  switch (value) {
    case "workspace-write":
      return "工作区写入";
    case "read-only":
      return "只读";
    case "acceptEdits":
      return "接受编辑";
    case "bypassPermissions":
      return "自动通过";
    case "auto_edit":
      return "自动编辑";
    case "default":
      return "默认";
    default:
      return value
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function footerEffortLabel(value: string | null | undefined) {
  switch (value) {
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
    case "max":
      return "最大";
    default:
      return "默认";
  }
}

function findOptionLabel(options: AcpOptionDef[] | null | undefined, value: string | null | undefined) {
  if (!value) return null;
  return options?.find((option) => option.value === value)?.label ?? null;
}

function footerOptionDescription(option: AcpOptionDef) {
  return option.description?.trim() || (
    option.source === "runtime"
      ? "从当前 CLI 能力中检测"
      : option.source === "fallback"
        ? "内置预设"
        : option.source === "custom"
          ? "来自供应商设置里的自定义模型"
        : "手动输入值"
  );
}

function toolApprovalModeLabel(value: ToolApprovalMode) {
  return value === "auto" ? "AUTO" : "MANUAL";
}

function isCliSessionRestartMessage(message: ChatMessage, cliId: AgentId) {
  return (
    message.role === "system" &&
    message.cliId === cliId &&
    message.content === `${titleCaseCli(cliId)} session restarted for this tab.`
  );
}

function hasContextCompactionStatus(message: ChatMessage, cliId: AgentId) {
  return (
    message.role === "assistant" &&
    message.cliId === cliId &&
    (message.blocks?.some(
      (block) =>
        block.kind === "status" &&
        block.level === "info" &&
        block.text === CODEX_CONTEXT_COMPACTION_TEXT
    ) ??
      false)
  );
}

function calculateCliSessionUsageTokens(
  messages: ChatMessage[] | null | undefined,
  cliId: AgentId
) {
  if (!messages?.length) return 0;

  let sessionBoundaryIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (
      isCliSessionRestartMessage(message, cliId) ||
      hasContextCompactionStatus(message, cliId)
    ) {
      sessionBoundaryIndex = index;
    }
  }

  return messages.reduce((sum, message, index) => {
    if (index < sessionBoundaryIndex) return sum;
    if (message.cliId !== cliId) return sum;
    return sum + (message.totalTokens ?? 0);
  }, 0);
}


function FooterMenuSection({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="footer-menu-section">
      {title ? <div className="selector-dropdown-title">{title}</div> : null}
      {children}
    </div>
  );
}

type ActivePlanTextBlock = Extract<ChatMessageBlock, { kind: "plan" }>;
type ActiveOrchestrationPlanBlock = Extract<ChatMessageBlock, { kind: "orchestrationPlan" }>;
type ActiveOrchestrationStepBlock = Extract<ChatMessageBlock, { kind: "orchestrationStep" }>;
type ActivePlanStatus =
  | "planning"
  | "planned"
  | "running"
  | "synthesizing"
  | "completed"
  | "failed"
  | "skipped";

type ActivePlanStep = {
  id: string;
  owner?: AgentId | null;
  title: string;
  summary?: string | null;
  status: ActivePlanStatus;
};

type ActivePlanGroup = {
  plan?: ActiveOrchestrationPlanBlock | null;
  steps: ActivePlanStep[];
  status: ActivePlanStatus;
  summary?: string | null;
  isLive: boolean;
};

function isActivePlanBlock(
  block: ChatMessageBlock
): block is ActivePlanTextBlock | ActiveOrchestrationPlanBlock | ActiveOrchestrationStepBlock {
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
      /^(?:step\s*)?(?:\d+|[a-z])(?:[\.\):\-]|(?:\s*[-:]))\s+(.+)$/i
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
  isStreaming: boolean
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
    return steps.every((step) => step.status === "completed") ? "completed" : "running";
  }
  return isStreaming ? "planning" : "completed";
}

function buildActivePlanGroup(
  blocks: Array<ActivePlanTextBlock | ActiveOrchestrationPlanBlock | ActiveOrchestrationStepBlock>,
  isStreaming: boolean
): ActivePlanGroup {
  const plan = blocks.find(
    (block): block is ActiveOrchestrationPlanBlock => block.kind === "orchestrationPlan"
  );
  const orchestrationSteps = blocks.filter(
    (block): block is ActiveOrchestrationStepBlock => block.kind === "orchestrationStep"
  );
  const planText = blocks
    .filter((block): block is ActivePlanTextBlock => block.kind === "plan")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
  const parsedPlan = planText ? parseActivePlanText(planText) : { intro: null, steps: [] };

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

function activePlanOwnerLabel(owner: AgentId) {
  return owner === "claude" ? "Claude" : owner === "gemini" ? "Gemini" : "Codex";
}

function activePlanStatusLabel(status: ActivePlanStatus) {
  return status === "synthesizing"
    ? "Synthesizing"
    : status.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function activePlanStatusBadge(status: ActivePlanStatus) {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (status === "running" || status === "synthesizing") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-slate-200 bg-white/80 text-slate-600";
}

function activePlanStepStyles(status: ActivePlanStatus, active: boolean) {
  if (status === "completed") {
    return {
      dot: "border-emerald-300 bg-emerald-500 text-white",
      card: active ? "border-emerald-200 bg-emerald-50/90" : "border-slate-200/80 bg-white/88",
      rail: "bg-emerald-200",
    };
  }
  if (status === "failed") {
    return {
      dot: "border-rose-300 bg-rose-500 text-white",
      card: active ? "border-rose-200 bg-rose-50/90" : "border-slate-200/80 bg-white/88",
      rail: "bg-rose-200",
    };
  }
  if (status === "running" || status === "synthesizing") {
    return {
      dot: "border-sky-300 bg-sky-500 text-white shadow-[0_0_0_4px_rgba(59,130,246,0.14)]",
      card: "border-sky-200 bg-sky-50/95",
      rail: "bg-sky-200",
    };
  }
  return {
    dot: active
      ? "border-violet-300 bg-violet-100 text-violet-700"
      : "border-slate-300 bg-white text-slate-500",
    card: active ? "border-violet-200 bg-violet-50/70" : "border-slate-200/80 bg-white/88",
    rail: "bg-slate-200",
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
          Boolean(message.blocks?.some((block) => isActivePlanBlock(block)))
      ) ?? null
  );
}

function ActivePlanOverlay({
  group,
  cliId,
}: {
  group: ActivePlanGroup;
  cliId: AgentId;
}) {
  const activeStepId =
    group.steps.find((step) => step.status === "running")?.id ??
    group.steps.find((step) => step.status === "failed")?.id ??
    group.steps.find((step) => step.status === "planned")?.id ??
    group.steps[group.steps.length - 1]?.id;
  const completedCount = group.steps.filter((step) => step.status === "completed").length;
  const heading = group.plan?.title ?? `${activePlanOwnerLabel(cliId)} plan`;
  const brief = (group.summary ?? group.plan?.goal ?? "").trim();
  const subtitle = brief.length > 96 ? `${brief.slice(0, 96).trimEnd()}…` : brief;

  return (
    <div
      className="pointer-events-none absolute bottom-full left-0 z-20 mb-3"
      style={{ width: "min(26rem, calc(100vw - 3rem))" }}
    >
      <div className="overflow-hidden rounded-[18px] border border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-[0_24px_70px_rgba(15,23,42,0.12)] backdrop-blur-md">
        <div className="border-b border-slate-200/80 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_36%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.92))] px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              Live plan
            </span>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${activePlanStatusBadge(group.status)}`}
            >
              {activePlanStatusLabel(group.status)}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
              {completedCount}/{group.steps.length || 1}
            </span>
            {group.isLive ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                Live
              </span>
            ) : null}
          </div>
          <div className="mt-2.5 text-[13px] font-semibold tracking-[-0.01em] text-slate-950">
            {heading}
          </div>
          {subtitle ? (
            <div className="mt-1 text-[11px] leading-5 text-slate-600">{subtitle}</div>
          ) : null}
        </div>

        <div className="px-4 py-3.5">
          {group.steps.length > 0 ? (
            <div className="relative">
              <div className="absolute bottom-2 left-[9px] top-2 w-px bg-[linear-gradient(180deg,rgba(148,163,184,0.08),rgba(148,163,184,0.45),rgba(148,163,184,0.08))]" />
              <div className="space-y-2.5">
                {group.steps.map((step, index) => {
                  const active = step.id === activeStepId;
                  const styles = activePlanStepStyles(step.status, active);
                  return (
                    <div key={step.id} className="relative pl-6">
                      {index < group.steps.length - 1 ? (
                        <div
                          className={`absolute left-[9px] top-5 w-px ${styles.rail}`}
                          style={{ height: "calc(100% + 0.625rem)" }}
                        />
                      ) : null}
                      <div
                        className={`absolute left-0 top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[10px] font-semibold ${styles.dot}`}
                      >
                        {step.status === "completed" ? (
                          <Check size={10} strokeWidth={2.4} />
                        ) : step.status === "running" || step.status === "synthesizing" ? (
                          <LoaderCircle size={10} className="animate-spin" strokeWidth={2.4} />
                        ) : (
                          <span>{index + 1}</span>
                        )}
                      </div>

                      <div className={`rounded-[14px] border px-3 py-2.5 ${styles.card}`}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-slate-900">{step.title}</span>
                          {step.owner ? (
                            <span className="rounded-full border border-slate-200 bg-white/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                              {activePlanOwnerLabel(step.owner)}
                            </span>
                          ) : null}
                        </div>
                        {step.summary ? (
                          <div className="mt-1 text-[11px] leading-5 text-slate-600">
                            {step.summary}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-[14px] border border-slate-200/80 bg-slate-50/80 px-3 py-2.5 text-[11px] leading-5 text-slate-600">
              Breaking the task into execution steps…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FooterMenuItem({
  label,
  description,
  onClick,
  disabled = false,
  selected = false,
  leading,
  trailing,
  title,
  className,
}: {
  label: string;
  description?: string;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`selector-option selector-option-button${selected ? " selected" : ""}${disabled ? " disabled" : ""}${className ? ` ${className}` : ""}`}
    >
      {leading ? <span className="footer-option-leading">{leading}</span> : null}
      <span className="footer-option-copy">
        <span className="footer-option-label">{label}</span>
        {description ? (
          <span className="footer-option-description model-description">{description}</span>
        ) : null}
      </span>
      {trailing ?? (selected ? <Check className="selector-option-check" size={14} aria-hidden /> : null)}
    </button>
  );
}

function StatusPanelToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M15 4v16" stroke="currentColor" strokeWidth="1.5" />
      {collapsed ? (
        <path
          d="M11 9l3 3-3 3"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M13 9l-3 3 3 3"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function resolveConcreteCli(activeTab: TerminalTab | null, fallback: AgentId | undefined): AgentId {
  if (activeTab?.selectedCli && activeTab.selectedCli !== "auto") {
    return activeTab.selectedCli;
  }
  return fallback ?? "codex";
}

function currentModelLabel(tab: TerminalTab) {
  if (tab.selectedCli === "auto") return "auto";
  return tab.modelOverrides[tab.selectedCli] ?? "default";
}

function currentPermissionLabel(tab: TerminalTab) {
  if (tab.selectedCli === "auto") return "auto";
  return tab.permissionOverrides[tab.selectedCli] ?? (
    tab.selectedCli === "codex"
      ? "workspace-write"
      : tab.selectedCli === "claude"
        ? "acceptEdits"
        : "auto_edit"
  );
}

function currentEffortLabel(tab: TerminalTab) {
  return tab.effortLevel ?? "default";
}

function commandStateMeta(command: AcpCommandDef, tab: TerminalTab) {
  switch (command.kind) {
    case "plan":
      return tab.planMode ? "ON" : "OFF";
    case "model":
      return currentModelLabel(tab);
    case "permissions":
      return currentPermissionLabel(tab);
    case "effort":
      return currentEffortLabel(tab);
    case "fast":
      return tab.selectedCli === "codex"
        ? tab.fastMode ? "FAST" : "STD"
        : tab.fastMode ? "ON" : "OFF";
    default:
      return undefined;
  }
}

function commandHelpSubtitle(command: AcpCommandDef, tab: TerminalTab) {
  const details = [command.description];
  const current = commandStateMeta(command, tab);
  if (current) {
    details.push(`Current: ${current}`);
  }
  return details.join("\n");
}

function buildReviewCommandText(target: ReviewPresetChoice | { type: "baseBranch"; branch: string } | { type: "commit"; sha: string; title?: string } | { type: "custom"; instructions: string }) {
  if (target === "uncommitted") {
    return "/review";
  }
  if (typeof target === "string") {
    return "/review";
  }
  if (target.type === "baseBranch") {
    return `/review base ${target.branch}`.trim();
  }
  if (target.type === "commit") {
    return target.title?.trim()
      ? `/review commit ${target.sha} ${target.title}`.trim()
      : `/review commit ${target.sha}`.trim();
  }
  return `/review custom ${target.instructions}`.trim();
}

function appendSectionItem(
  sections: PromptOverlaySection[],
  sectionId: string,
  sectionTitle: string,
  item: PromptOverlayItem
) {
  const existing = sections.find((section) => section.id === sectionId);
  if (existing) {
    existing.items.push(item);
    return;
  }
  sections.push({
    id: sectionId,
    title: sectionTitle,
    items: [item],
  });
}

function orderInteractiveEntries(
  sections: PromptOverlaySection[],
  entryById: Map<string, InteractiveOverlayEntry>
) {
  return sections.flatMap((section) =>
    section.items.flatMap((item) => {
      const entry = entryById.get(item.id);
      return entry ? [entry] : [];
    })
  );
}

function buildCommandListOverlay(
  activeTab: TerminalTab,
  query: string
): CommandOverlayState {
  const supportedCommands = ACP_COMMANDS.filter((command) =>
    activeTab.selectedCli === "auto" || command.supportedClis.includes(activeTab.selectedCli)
  ).filter((command) => {
    const normalized = query.toLowerCase();
    return (
      !normalized ||
      command.slash.slice(1).startsWith(normalized) ||
      command.label.toLowerCase().includes(normalized)
    );
  });

  const sections: PromptOverlaySection[] = [];
  const entryById = new Map<string, InteractiveOverlayEntry>();

  supportedCommands.forEach((command) => {
    const category = getCommandCategory(command.kind);
    const itemId = command.kind;
    appendSectionItem(sections, category, getCommandCategoryLabel(category), {
      id: itemId,
      title: command.slash,
      subtitle: command.description,
      meta: commandStateMeta(command, activeTab),
      badge: command.argsHint || command.kind === "fast" ? "pick" : undefined,
    });
    entryById.set(itemId, { id: itemId, kind: "command", command });
  });

  const normalized = query.trim().toLowerCase();
  if (
    activeTab.selectedCli !== "auto" &&
    (!normalized ||
      "skills".startsWith(normalized) ||
      "skill".startsWith(normalized) ||
      "prompt skills".includes(normalized))
  ) {
    appendSectionItem(sections, "prompt-tools", "Prompt Tools", {
      id: "shortcut-skills",
      title: "/skills",
      subtitle: "Browse installed skills for the active CLI and insert one into the prompt.",
      badge: "picker",
    });
    entryById.set("shortcut-skills", { id: "shortcut-skills", kind: "shortcut", shortcut: "skills" });
  }

  if (sections.length === 0) {
    sections.push({
      id: "empty",
      items: [
        {
          id: "empty",
          title: "No matching commands",
          subtitle: "Try another slash command or press Esc to return to the composer.",
        },
      ],
    });
  }

  const entries = orderInteractiveEntries(sections, entryById);

  return {
    kind: "command-list",
    title: `${titleCaseCli(activeTab.selectedCli)} Commands`,
    description: "Pick a command directly from the palette. Parameterized commands continue in-place with a second selection step.",
    footer: "Arrow keys move, Enter applies, Esc clears, Shift+Tab toggles plan mode when the palette is closed.",
    sections,
    entries,
  };
}

function buildHelpOverlay(activeTab: TerminalTab): CommandOverlayState {
  const commands = ACP_COMMANDS.filter((command) =>
    activeTab.selectedCli === "auto" || command.supportedClis.includes(activeTab.selectedCli)
  );
  const sections: PromptOverlaySection[] = [];

  commands.forEach((command) => {
    const category = getCommandCategory(command.kind);
    appendSectionItem(sections, category, getCommandCategoryLabel(category), {
      id: `help-${command.kind}`,
      title: `${command.slash}${command.argsHint ? ` ${command.argsHint}` : ""}`,
      subtitle: commandHelpSubtitle(command, activeTab),
      meta: command.label,
    });
  });

  if (activeTab.selectedCli !== "auto") {
    appendSectionItem(sections, "prompt-tools", "Prompt Tools", {
      id: "help-skills",
      title: "/skills",
      subtitle: "Open the skill picker for the active CLI and insert one at the start of the prompt.",
      meta: "Prompt Skills",
    });
  }

  return {
    kind: "command-help",
    title: `${titleCaseCli(activeTab.selectedCli)} Help`,
    description: "Reference view for the active CLI. This panel explains each command without executing anything.",
    footer: "Esc returns to the command palette.",
    sections,
  };
}

function optionMatchesQuery(option: AcpOptionDef, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    option.value.toLowerCase().includes(normalized) ||
    option.label.toLowerCase().includes(normalized) ||
    option.description?.toLowerCase().includes(normalized) === true
  );
}

function buildArgumentOverlay(
  activeTab: TerminalTab,
  commandKind: AcpPickerCommandKind,
  capabilities: AcpCliCapabilities | null | undefined,
  capabilityStatus: "idle" | "loading" | "ready" | "error" | undefined,
  query: string
): CommandOverlayState {
  const catalog = getPickerCatalog(capabilities, commandKind);
  const current =
    commandKind === "model"
      ? currentModelLabel(activeTab)
      : commandKind === "permissions"
        ? currentPermissionLabel(activeTab)
        : currentEffortLabel(activeTab);

  if (!catalog && (capabilityStatus === "loading" || capabilityStatus === "idle")) {
    return {
      kind: "command-argument",
      commandKind,
      loading: true,
      title: `Select ${commandKind} for ${titleCaseCli(activeTab.selectedCli)}`,
      description: `Current: ${current}. Loading available options from the installed CLI...`,
      footer: "Esc returns to the command palette.",
      sections: [
        {
          id: "loading",
          items: [
            {
              id: "loading",
              title: "Loading options",
              subtitle: "Inspecting CLI help output and available flags.",
              badge: "runtime",
            },
          ],
        },
      ],
      entries: [],
    };
  }

  if (!catalog || !catalog.supported) {
    return {
      kind: "command-argument",
      commandKind,
      loading: false,
      title: `Select ${commandKind} for ${titleCaseCli(activeTab.selectedCli)}`,
      description: `Current: ${current}. This parameter is not exposed by the active CLI.`,
      footer: "Esc returns to the command palette.",
      sections: [
        {
          id: "unsupported",
          items: [
            {
              id: "unsupported",
              title: "No selectable options",
              subtitle: catalog?.note ?? "The active CLI does not expose this parameter as a selectable flag.",
            },
          ],
        },
      ],
      entries: [],
    };
  }

  const filteredOptions = catalog.options.filter((option) => optionMatchesQuery(option, query));
  const options = [...filteredOptions];
  const trimmedQuery = query.trim();
  const hasExactQueryMatch = options.some((option) => option.value.toLowerCase() === trimmedQuery.toLowerCase());

  if (commandKind === "model" && trimmedQuery && !hasExactQueryMatch) {
    options.push({
      value: trimmedQuery,
      label: trimmedQuery,
      description: "Apply the typed model value directly.",
      source: "manual",
    });
  }

  const sections: PromptOverlaySection[] = [];
  const entryById = new Map<string, InteractiveOverlayEntry>();

  options.forEach((option) => {
    const sourceKey = option.source === "manual" ? "manual" : option.source;
    const sourceLabel =
      option.source === "runtime"
        ? "runtime"
        : option.source === "fallback"
          ? "preset"
          : option.source === "custom"
            ? "custom"
          : "manual";

    const itemId = `${commandKind}-${option.value}`;
    appendSectionItem(
      sections,
      sourceKey,
      sourceLabel === "runtime"
        ? "Detected"
        : sourceLabel === "preset"
          ? "Presets"
          : sourceLabel === "custom"
            ? "Custom"
            : "Typed Value",
      {
        id: itemId,
        title: option.label,
        subtitle: option.description ?? undefined,
        meta: current === option.value ? "current" : undefined,
        badge: sourceLabel,
      }
    );
    entryById.set(itemId, { id: itemId, kind: "option", commandKind, option });
  });

  if (sections.length === 0) {
    sections.push({
      id: "empty",
      items: [
        {
          id: "empty",
          title: "No matching options",
          subtitle: "Refine the filter or press Esc to return to the command palette.",
        },
      ],
    });
  }

  const entries = orderInteractiveEntries(sections, entryById);

  return {
    kind: "command-argument",
    commandKind,
    loading: false,
    title: `Select ${commandKind} for ${titleCaseCli(activeTab.selectedCli)}`,
    description:
      commandKind === "model" && activeTab.selectedCli === "codex"
        ? `Current: ${current}. After selecting a Codex model, you will immediately choose reasoning effort.${catalog.note ? ` ${catalog.note}` : ""}`
        : `Current: ${current}.${catalog.note ? ` ${catalog.note}` : ""}`,
    footer: "Arrow keys move, Enter applies, Esc returns to the command palette.",
    sections,
    entries,
  };
}

function buildFastModeOverlay(
  activeTab: TerminalTab,
  query: string,
  cliId: AgentId
): CommandOverlayState {
  const current = activeTab.fastMode ? "Fast" : "Standard";
  const options: AcpOptionDef[] = [
    {
      value: "off",
      label: "Standard",
      description: "Use the normal Codex speed setting.",
      source: "fallback" as const,
    },
    {
      value: "on",
      label: "Fast",
      description: "Enable faster Codex responses for this session.",
      source: "fallback" as const,
    },
  ].filter((option) => optionMatchesQuery(option, query));

  if (options.length === 0) {
    return {
      kind: "command-argument",
      commandKind: "fast",
      loading: false,
      title: `Select speed for ${titleCaseCli(cliId)}`,
      description: `Current: ${current}. This stays in sync with Session Config > Speed.`,
      footer: "Esc returns to the command palette.",
      sections: [
        {
          id: "empty",
          items: [
            {
              id: "empty",
              title: "No matching speed mode",
              subtitle: "Type fast or standard, or press Esc to return to the command palette.",
            },
          ],
        },
      ],
      entries: [],
    };
  }

  const sections: PromptOverlaySection[] = [];
  const entryById = new Map<string, InteractiveOverlayEntry>();

  options.forEach((option) => {
    const itemId = `fast-${option.value}`;
    appendSectionItem(sections, "speed", "Speed", {
      id: itemId,
      title: option.label,
      subtitle: option.description ?? undefined,
      meta:
        (option.value === "on" && activeTab.fastMode) || (option.value === "off" && !activeTab.fastMode)
          ? "current"
          : undefined,
      badge: "mode",
    });
    entryById.set(itemId, { id: itemId, kind: "option", commandKind: "fast", option });
  });

  return {
    kind: "command-argument",
    commandKind: "fast",
    loading: false,
    title: `Select speed for ${titleCaseCli(cliId)}`,
    description: `Current: ${current}. This stays in sync with Session Config > Speed.`,
    footer: "Arrow keys move, Enter applies, Esc returns to the command palette.",
    sections,
    entries: orderInteractiveEntries(sections, entryById),
  };
}

function skillChips(skill: CliSkillItem) {
  return [skill.scope, skill.source].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index
  );
}

function buildSkillOverlay(
  cliId: AgentId,
  query: string,
  skills: CliSkillItem[],
  status: "idle" | "loading" | "ready" | "error" | undefined
): SkillOverlayState {
  const normalized = query.trim().toLowerCase();
  const filteredSkills = skills.filter((skill) => {
    if (!normalized) return true;
    return (
      skill.name.toLowerCase().includes(normalized) ||
      skill.displayName?.toLowerCase().includes(normalized) === true ||
      skill.description?.toLowerCase().includes(normalized) === true
    );
  });

  if (status === "loading" && skills.length === 0) {
    return {
      title: `${titleCaseCli(cliId)} Skills`,
      description: `Loading the skills currently available for ${titleCaseCli(cliId)} in this workspace.`,
      footer: "Type to narrow the list. Enter inserts the selected skill at the start of the prompt.",
      sections: [
        {
          id: "loading",
          items: [
            {
              id: "loading",
              title: "Loading skills",
              subtitle: "Inspecting the active CLI runtime and local skill directories.",
              badge: "runtime",
            },
          ],
        },
      ],
      entries: [],
    };
  }

  if (status === "error") {
    return {
      title: `${titleCaseCli(cliId)} Skills`,
      description: `Skill discovery failed for ${titleCaseCli(cliId)}.`,
      footer: "Esc dismisses the picker.",
      sections: [
        {
          id: "error",
          items: [
            {
              id: "error",
              title: "Unable to load skills",
              subtitle: "Check the installed CLI runtime and local skill directories, then try again.",
            },
          ],
        },
      ],
      entries: [],
    };
  }

  if (filteredSkills.length === 0) {
    return {
      title: `${titleCaseCli(cliId)} Skills`,
      description: `Select one skill to apply to the next ${titleCaseCli(cliId)} turn.`,
      footer: "Esc dismisses the picker.",
      sections: [
        {
          id: "empty",
          items: [
            {
              id: "empty",
              title: skills.length === 0 ? "No skills available" : "No matching skills",
              subtitle:
                skills.length === 0
                  ? `${titleCaseCli(cliId)} does not expose any selectable skills for this workspace.`
                  : "Refine the filter or press Esc to return to the composer.",
            },
          ],
        },
      ],
      entries: [],
    };
  }

  const sections: PromptOverlaySection[] = [];
  const entryById = new Map<string, InteractiveOverlayEntry>();

  filteredSkills.forEach((skill) => {
    const sectionId = skill.scope ?? skill.source ?? "skills";
    const sectionTitle = skill.scope ?? skill.source ?? "Skills";
    const itemId = `skill:${skill.name}:${skill.path}`;
    appendSectionItem(sections, sectionId, sectionTitle, {
      id: itemId,
      title: skill.displayName || skill.name,
      subtitle: skill.description ?? skill.path,
      meta:
        skill.displayName && skill.displayName !== skill.name
          ? skill.name
          : undefined,
      chips: skillChips(skill),
    });
    entryById.set(itemId, { id: itemId, kind: "skill", skill });
  });

  return {
    title: `${titleCaseCli(cliId)} Skills`,
    description: `Select one skill to apply to the next ${titleCaseCli(cliId)} turn.`,
    footer: "Arrow keys move, Enter inserts the skill, Esc dismisses.",
    sections,
    entries: orderInteractiveEntries(sections, entryById),
  };
}

function buildSkillCommandOverlay(
  cliId: AgentId,
  query: string,
  skills: CliSkillItem[],
  status: "idle" | "loading" | "ready" | "error" | undefined
): CommandOverlayState {
  const base = buildSkillOverlay(cliId, query, skills, status);
  return {
    kind: "skill-command",
    title: `${titleCaseCli(cliId)} Skills`,
    description: base.description,
    footer: "Arrow keys move, Enter inserts the skill, Esc returns to the command palette.",
    sections: base.sections,
    entries: base.entries,
  };
}

export function ChatPromptBar({
  statusPanelExpanded = false,
  onToggleStatusPanel,
}: ChatPromptBarProps) {
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const footerMenuRef = useRef<HTMLDivElement>(null);
  const promptHistoryStateRef = useRef<{ index: number | null; draft: string }>({
    index: null,
    draft: "",
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mentionItems, setMentionItems] = useState<FileMentionCandidate[]>([]);
  const [dismissedMentionKey, setDismissedMentionKey] = useState<string | null>(null);
  const [dismissedSkillKey, setDismissedSkillKey] = useState<string | null>(null);
  const [dismissedAgentKey, setDismissedAgentKey] = useState<string | null>(null);
  const [openFooterMenu, setOpenFooterMenu] = useState<FooterMenuId | null>(null);
  const [hoveredConfigSubmenu, setHoveredConfigSubmenu] = useState<"agent" | "approval" | "speed" | "session" | null>(null);
  const [queueFeedback, setQueueFeedback] = useState<string | null>(null);
  const [reviewPrompt, setReviewPrompt] = useState<ReviewInlinePromptState | null>(null);
  const [highlightedPresetIndex, setHighlightedPresetIndex] = useState(0);
  const [highlightedBranchIndex, setHighlightedBranchIndex] = useState(0);
  const [highlightedCommitIndex, setHighlightedCommitIndex] = useState(0);

  const terminalTabs = useStore((s) => s.terminalTabs);
  const workspaces = useStore((s) => s.workspaces);
  const activeTerminalTabId = useStore((s) => s.activeTerminalTabId);
  const appState = useStore((s) => s.appState);
  const busyAction = useStore((s) => s.busyAction);
  const settings = useStore((s) => s.settings);
  const activeSession = useStore((s) =>
    s.activeTerminalTabId ? s.chatSessions[s.activeTerminalTabId] ?? null : null
  );
  const queuedPrompt = useStore((s) =>
    s.activeTerminalTabId ? s.queuedChatByTab[s.activeTerminalTabId] ?? null : null
  );
  const acpCapabilitiesByCli = useStore((s) => s.acpCapabilitiesByCli);
  const acpCapabilityStatusByCli = useStore((s) => s.acpCapabilityStatusByCli);
  const { models: claudeVendorModels } = useVendorModels(VENDOR_MODEL_STORAGE_KEYS.claude);
  const { models: codexVendorModels } = useVendorModels(VENDOR_MODEL_STORAGE_KEYS.codex);
  const { models: geminiVendorModels } = useVendorModels(VENDOR_MODEL_STORAGE_KEYS.gemini);
  const cliSkillsByContext = useStore((s) => s.cliSkillsByContext);
  const cliSkillStatusByContext = useStore((s) => s.cliSkillStatusByContext);
  const setTabDraftPrompt = useStore((s) => s.setTabDraftPrompt);
  const setTabSelectedCli = useStore((s) => s.setTabSelectedCli);
  const setTabSelectedAgent = useStore((s) => s.setTabSelectedAgent);
  const sendChatMessage = useStore((s) => s.sendChatMessage);
  const executeAcpCommand = useStore((s) => s.executeAcpCommand);
  const snapshotWorkspace = useStore((s) => s.snapshotWorkspace);
  const runChecks = useStore((s) => s.runChecks);
  const togglePlanMode = useStore((s) => s.togglePlanMode);
  const resetTerminalTabSession = useStore((s) => s.resetTerminalTabSession);
  const resetCliTransportSession = useStore((s) => s.resetCliTransportSession);
  const setTabToolApprovalMode = useStore((s) => s.setTabToolApprovalMode);
  const searchWorkspaceFiles = useStore((s) => s.searchWorkspaceFiles);
  const loadCliSkills = useStore((s) => s.loadCliSkills);
  const loadAcpCapabilities = useStore((s) => s.loadAcpCapabilities);
  const appendChatSystemMessage = useStore((s) => s.appendChatSystemMessage);
  const queueChatMessage = useStore((s) => s.queueChatMessage);
  const editQueuedChatMessage = useStore((s) => s.editQueuedChatMessage);
  const interruptChatTurn = useStore((s) => s.interruptChatTurn);
  const addDraftChatAttachments = useStore((s) => s.addDraftChatAttachments);
  const removeDraftChatAttachment = useStore((s) => s.removeDraftChatAttachment);

  const activeTab = terminalTabs.find((tab) => tab.id === activeTerminalTabId) ?? null;
  const workspace = workspaces.find((item) => item.id === activeTab?.workspaceId) ?? null;
  const effectiveCli = resolveConcreteCli(activeTab, workspace?.activeAgent);
  const supportsReviewQuickAction = effectiveCli === "codex" || effectiveCli === "claude";
  const reviewPromptOpen = Boolean(reviewPrompt);
  const activeSshConnection = useMemo(
    () =>
      workspace?.locationKind === "ssh" && workspace.connectionId
        ? settings?.sshConnections.find((item) => item.id === workspace.connectionId) ?? null
        : null,
    [settings?.sshConnections, workspace?.connectionId, workspace?.locationKind]
  );
  const remoteCliValidationKnown = hasRemoteCliDetection(activeSshConnection);
  const customAgents = settings?.customAgents ?? [];
  const prompt = activeTab?.draftPrompt ?? "";
  const draftAttachments = activeTab?.draftAttachments ?? [];
  const isStreaming = activeTab?.status === "streaming";
  const isBusy = busyAction === "checks" || busyAction?.startsWith("review-") || false;
  const cliSkillCacheKey = workspace ? `${effectiveCli}:${workspace.id}` : null;
  const cliSkills = cliSkillCacheKey ? cliSkillsByContext[cliSkillCacheKey] ?? [] : [];
  const cliSkillStatus = cliSkillCacheKey
    ? cliSkillStatusByContext[cliSkillCacheKey] ?? "idle"
    : "idle";
  const capabilities = acpCapabilitiesByCli[effectiveCli] ?? null;
  const capabilityStatus = acpCapabilityStatusByCli[effectiveCli] ?? "idle";
  const currentVendorModels = useMemo(() => {
    if (effectiveCli === "codex") return codexVendorModels;
    if (effectiveCli === "gemini") return geminiVendorModels;
    return claudeVendorModels;
  }, [claudeVendorModels, codexVendorModels, effectiveCli, geminiVendorModels]);
  const modelCatalog = useMemo(
    () => mergeAcpModelCatalog(capabilities?.model, currentVendorModels),
    [capabilities?.model, currentVendorModels],
  );
  const pickerCapabilities = useMemo(() => {
    if (!capabilities && !modelCatalog) {
      return null;
    }
    return {
      cliId: effectiveCli,
      model: modelCatalog ?? { supported: false, options: [], note: null },
      permissions: capabilities?.permissions ?? { supported: false, options: [], note: null },
      effort: capabilities?.effort ?? { supported: false, options: [], note: null },
    } satisfies AcpCliCapabilities;
  }, [capabilities, effectiveCli, modelCatalog]);
  const resolvedSelectedAgent = useMemo(
    () => resolveSelectedCustomAgent(activeTab?.selectedAgent ?? null, customAgents),
    [activeTab?.selectedAgent, customAgents]
  );

  const rawSlashPrompt = prompt.trimStart();
  const slashQuery = rawSlashPrompt.startsWith("/") ? rawSlashPrompt.slice(1).toLowerCase() : "";
  const skillSlashQuery = useMemo(() => {
    if (!activeTab || activeTab.selectedCli === "auto") return null;
    return parseSkillSlashQuery(rawSlashPrompt);
  }, [activeTab, rawSlashPrompt]);
  const promptHistory = useMemo(
    () =>
      activeSession?.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
        .filter((value) => value.trim().length > 0) ?? [],
    [activeSession?.messages]
  );
  const activePlanMessage = useMemo(
    () => findActivePlanMessage(activeSession?.messages),
    [activeSession?.messages]
  );
  const activePlanGroup = useMemo(() => {
    const timelineBlocks =
      activePlanMessage?.blocks?.filter((block) => isActivePlanBlock(block)) ?? [];
    if (timelineBlocks.length === 0) return null;
    return buildActivePlanGroup(timelineBlocks, Boolean(activePlanMessage?.isStreaming));
  }, [activePlanMessage]);

  function requestConversationScrollToBottom(tabId: string) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("terminal-chat-scroll-bottom", {
        detail: { tabId },
      })
    );
  }

  useEffect(() => {
    if (!activeTab) return;
    void loadAcpCapabilities(effectiveCli);
  }, [activeTab, effectiveCli, loadAcpCapabilities]);

  useEffect(() => {
    promptHistoryStateRef.current = {
      index: null,
      draft: "",
    };
  }, [activeTab?.id]);

  useEffect(() => {
    setQueueFeedback(null);
  }, [activeTab?.id]);

  useEffect(() => {
    setOpenFooterMenu(null);
  }, [activeTab?.id]);

  useEffect(() => {
    setReviewPrompt(null);
  }, [activeTab?.id, workspace?.id]);

  useEffect(() => {
    if (!activeTab || !supportsReviewQuickAction) {
      return;
    }
    if (!/^\/review\s*$/i.test(rawSlashPrompt)) {
      return;
    }
    setTabDraftPrompt(activeTab.id, "");
    openReviewPrompt();
  }, [activeTab, openFooterMenu, rawSlashPrompt, setTabDraftPrompt, supportsReviewQuickAction]);

  useEffect(() => {
    setDismissedAgentKey(null);
  }, [activeTab?.id]);

  const mentionToken = useMemo(() => {
    const caret = textareaRef.current?.selectionStart ?? prompt.length;
    return findMentionToken(prompt, caret);
  }, [prompt]);
  const agentToken = useMemo(() => {
    const caret = textareaRef.current?.selectionStart ?? prompt.length;
    return findAgentToken(prompt, caret);
  }, [prompt]);
  const skillToken = useMemo(() => {
    const caret = textareaRef.current?.selectionStart ?? prompt.length;
    return findSkillToken(prompt, caret);
  }, [prompt]);

  const mentionKey = mentionToken ? `${mentionToken.start}:${mentionToken.query}` : null;
  const agentKey = agentToken ? `${agentToken.start}:${agentToken.query}` : null;
  const skillKey = skillToken ? `${skillToken.start}:${skillToken.query}` : null;

  useEffect(() => {
    if (!activeTab || !workspace || activeTab.selectedCli === "auto") {
      return;
    }
    if (!skillToken && skillSlashQuery == null) {
      setDismissedSkillKey(null);
      return;
    }

    if (skillKey && dismissedSkillKey && skillKey !== dismissedSkillKey) {
      setDismissedSkillKey(null);
    }

    void loadCliSkills(effectiveCli, workspace.id);
  }, [
    activeTab,
    dismissedSkillKey,
    effectiveCli,
    loadCliSkills,
    rawSlashPrompt,
    skillSlashQuery,
    skillKey,
    skillToken,
    workspace,
  ]);

  useEffect(() => {
    if (!workspace) return;
    void loadWorkspaceFileIndex({
      workspaceId: workspace.id,
      projectRoot: workspace.rootPath,
    });
  }, [workspace]);

  useEffect(() => {
    if (!agentToken) {
      setDismissedAgentKey(null);
      return;
    }
    if (agentKey && dismissedAgentKey && agentKey !== dismissedAgentKey) {
      setDismissedAgentKey(null);
    }
  }, [agentKey, agentToken, dismissedAgentKey]);

  useEffect(() => {
    if (!activeTab || !workspace || rawSlashPrompt.startsWith("/")) return;
    if (!mentionToken) {
      setMentionItems([]);
      setDismissedMentionKey(null);
      return;
    }

    if (mentionKey && dismissedMentionKey && mentionKey !== dismissedMentionKey) {
      setDismissedMentionKey(null);
    }

    let cancelled = false;
    searchWorkspaceFiles(workspace.id, mentionToken.query).then((items) => {
      if (!cancelled) {
        setMentionItems(items);
        if (items.length > 0) {
          setSelectedIndex(0);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    dismissedMentionKey,
    mentionKey,
    mentionToken,
    rawSlashPrompt,
    searchWorkspaceFiles,
    workspace,
  ]);

  const commandOverlay = useMemo<CommandOverlayState | null>(() => {
    if (!activeTab || !rawSlashPrompt.startsWith("/")) return null;
    if (reviewPromptOpen || (/^\/review\b/i.test(rawSlashPrompt) && supportsReviewQuickAction)) {
      return null;
    }

    if (skillSlashQuery != null && activeTab.selectedCli !== "auto") {
      return buildSkillCommandOverlay(effectiveCli, skillSlashQuery, cliSkills, cliSkillStatus);
    }

    if (/^\/help\s*$/i.test(rawSlashPrompt)) {
      return buildHelpOverlay(activeTab);
    }

    const fastMatch = rawSlashPrompt.match(/^\/fast(?:\s+(.*))?$/is);
    if (fastMatch && effectiveCli === "codex") {
      return buildFastModeOverlay(activeTab, fastMatch[1] ?? "", effectiveCli);
    }

    const pickerMatch = rawSlashPrompt.match(/^\/(model|permissions|effort)\s+(.*)$/is);
    if (pickerMatch && isPickerCommandKind(pickerMatch[1] as AcpPickerCommandKind)) {
      const commandKind = pickerMatch[1] as AcpPickerCommandKind;
      return buildArgumentOverlay(
        activeTab,
        commandKind,
        pickerCapabilities,
        acpCapabilityStatusByCli[effectiveCli],
        pickerMatch[2] ?? ""
      );
    }

    return buildCommandListOverlay(activeTab, slashQuery);
  }, [
    activeTab,
    acpCapabilityStatusByCli,
    cliSkillStatus,
    cliSkills,
    effectiveCli,
    pickerCapabilities,
    rawSlashPrompt,
    reviewPromptOpen,
    slashQuery,
    skillSlashQuery,
    supportsReviewQuickAction,
  ]);

  const skillOverlay = useMemo<SkillOverlayState | null>(() => {
    if (!skillToken || !workspace || !activeTab || activeTab.selectedCli === "auto" || commandOverlay) {
      return null;
    }
    return buildSkillOverlay(effectiveCli, skillToken.query, cliSkills, cliSkillStatus);
  }, [activeTab, cliSkillStatus, cliSkills, commandOverlay, effectiveCli, skillToken, workspace]);

  const agentOverlay = useMemo(() => {
    if (!agentToken || commandOverlay || !activeTab) {
      return null;
    }

    const normalized = agentToken.query.trim().toLowerCase();
    const filteredAgents = customAgents.filter((agent) => {
      if (!normalized) return true;
      return (
        agent.name.toLowerCase().includes(normalized) ||
        agent.prompt?.toLowerCase().includes(normalized) === true
      );
    });

    const sections: PromptOverlaySection[] = [];
    const entries: InteractiveOverlayEntry[] = [];

    if (filteredAgents.length > 0) {
      sections.push({
        id: "agents",
        title: "智能体",
        items: filteredAgents.map((agent) => {
          entries.push({
            id: `agent:${agent.id}`,
            kind: "agent",
            agent: {
              id: agent.id,
              name: agent.name,
              prompt: agent.prompt ?? null,
              icon: agent.icon ?? null,
            },
            action: "select",
          });
          return {
            id: `agent:${agent.id}`,
            title: agent.name,
          } satisfies PromptOverlayItem;
        }),
      });
    }

    sections.push({
      id: "agent-actions",
      title: "管理",
      items: [
        {
          id: CREATE_AGENT_ENTRY_ID,
          title: "创建智能体",
        },
      ],
    });
    entries.push({
      id: CREATE_AGENT_ENTRY_ID,
      kind: "agent",
      agent: null,
      action: "create",
    });

    return {
      title: "智能体选择",
      description: "选择一个角色型智能体附着到当前会话。发送时会自动注入角色提示。",
      footer: "Arrow keys move, Enter applies, Esc dismisses.",
      sections,
      entries,
    };
  }, [activeTab, agentToken, commandOverlay, customAgents, resolvedSelectedAgent]);

  const showSkillOverlay =
    !commandOverlay &&
    !!skillToken &&
    activeTab?.selectedCli !== "auto" &&
    skillKey !== dismissedSkillKey &&
    !!skillOverlay;

  const showAgentOverlay =
    !commandOverlay &&
    !showSkillOverlay &&
    !!agentToken &&
    agentKey !== dismissedAgentKey &&
    !!agentOverlay;

  const showMentionOverlay =
    !commandOverlay &&
    !showAgentOverlay &&
    !showSkillOverlay &&
    !!mentionToken &&
    mentionItems.length > 0 &&
    mentionKey !== dismissedMentionKey;

  const activeSections = commandOverlay
    ? commandOverlay.sections
    : showAgentOverlay && agentOverlay
      ? agentOverlay.sections
    : showSkillOverlay && skillOverlay
      ? skillOverlay.sections
    : showMentionOverlay
      ? [
          {
            id: "mentions",
            items: mentionItems.map((item) => ({
              id: item.id,
              title: item.relativePath,
              subtitle: item.name,
            })),
          },
        ]
      : [];

  const interactiveEntries = commandOverlay
    ? "entries" in commandOverlay
      ? commandOverlay.entries
      : []
    : showAgentOverlay && agentOverlay
      ? agentOverlay.entries
    : showSkillOverlay && skillOverlay
      ? skillOverlay.entries
    : showMentionOverlay
      ? mentionItems.map<InteractiveOverlayEntry>((mention) => ({
          id: mention.id,
          kind: "mention",
          mention,
        }))
      : [];

  const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, interactiveEntries.length - 1));

  useEffect(() => {
    setSelectedIndex(0);
  }, [commandOverlay?.kind, rawSlashPrompt, mentionKey, agentKey, skillKey, skillSlashQuery]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [prompt]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!footerMenuRef.current?.contains(event.target as Node)) {
        setOpenFooterMenu(null);
      }
    }

    if (openFooterMenu) {
      window.addEventListener("mousedown", handlePointerDown);
    }

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [openFooterMenu]);

  useEffect(() => {
    function handleFocusQueuedEdit() {
      focusPromptAtEnd();
    }

    window.addEventListener("terminal-queue-edit-focus", handleFocusQueuedEdit);
    return () => {
      window.removeEventListener("terminal-queue-edit-focus", handleFocusQueuedEdit);
    };
  }, []);

  useEffect(() => {
    if (!queueFeedback || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      setQueueFeedback(null);
    }, 2600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [queueFeedback]);

  const providerItems = useMemo<FooterProviderItem[]>(
    () =>
      CLI_OPTIONS.map((option) => {
        if (option.id === "auto") {
          return {
            id: option.id,
            label: option.label,
            icon: option.icon,
            installed: true,
            unavailable: false,
            remoteValidationKnown: false,
          };
        }

        if (workspace?.locationKind === "ssh") {
          const installed = remoteCliValidationKnown
            ? Boolean(activeSshConnection?.detectedCliPaths?.[option.id])
            : true;
          return {
            id: option.id,
            label: option.label,
            icon: option.icon,
            installed,
            unavailable: remoteCliValidationKnown ? !installed : false,
            remoteValidationKnown: remoteCliValidationKnown,
          };
        }

        const runtime = appState?.agents.find((agent) => agent.id === option.id)?.runtime;
        const installed = runtime?.installed ?? true;
        return {
          id: option.id,
          label: option.label,
          icon: option.icon,
          installed,
          unavailable: runtime != null ? !runtime.installed : false,
          remoteValidationKnown: false,
        };
      }),
    [activeSshConnection, appState?.agents, remoteCliValidationKnown, workspace?.locationKind]
  );

  useEffect(() => {
    if (!activeTab || workspace?.locationKind !== "ssh" || activeTab.selectedCli === "auto") {
      return;
    }
    const currentItem = providerItems.find((item) => item.id === activeTab.selectedCli);
    if (!currentItem?.unavailable) {
      return;
    }
    const fallbackCli =
      providerItems.find((item) => item.id !== "auto" && !item.unavailable)?.id ?? "auto";
    if (fallbackCli !== activeTab.selectedCli) {
      setTabSelectedCli(activeTab.id, fallbackCli);
    }
  }, [activeTab, providerItems, setTabSelectedCli, workspace?.locationKind]);

  function setPrompt(value: string) {
    if (!activeTab) return;
    setTabDraftPrompt(activeTab.id, value);
  }

  function handlePromptChange(value: string) {
    if (promptHistoryStateRef.current.index !== null) {
      promptHistoryStateRef.current = {
        index: null,
        draft: "",
      };
    }
    setPrompt(value);
  }

  function focusPromptAtEnd() {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const caret = el.value.length;
      el.setSelectionRange(caret, caret);
    });
  }

  async function handlePickAttachments() {
    if (!activeTab || !workspace || isStreaming) return;
    closeFooterMenus();

    try {
      const picked = await bridge.pickChatAttachments();
      if (picked.length === 0) return;

      const prepared = picked
        .map((item) => createChatAttachment(item, workspace.rootPath))
        .filter((item): item is ChatAttachment => Boolean(item));
      const imageCount = prepared.filter((attachment) => attachment.kind === "image").length;
      const allowImages = activeTab.selectedCli === "codex";
      const allowedPicked = allowImages
        ? picked
        : picked.filter((item) => {
            const attachment = createChatAttachment(item, workspace.rootPath);
            return attachment?.kind !== "image";
          });

      const result = addDraftChatAttachments(activeTab.id, workspace.rootPath, allowedPicked);
      if (!allowImages && imageCount > 0) {
        setQueueFeedback("当前仅 Codex 支持图片附件，图片已忽略。");
      } else if (result.added === 0) {
        setQueueFeedback("没有可添加的新附件。");
      } else {
        setQueueFeedback(null);
      }
      focusPromptAtEnd();
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Attachment picker failed.";
      setQueueFeedback(detail);
    }
  }

  function handleRemoveDraftAttachment(attachmentId: string) {
    if (!activeTab) return;
    removeDraftChatAttachment(activeTab.id, attachmentId);
    focusPromptAtEnd();
  }

  function navigatePromptHistory(direction: -1 | 1) {
    if (!activeTab || promptHistory.length === 0) return;

    const current = promptHistoryStateRef.current;
    if (direction === -1) {
      const nextIndex =
        current.index == null
          ? promptHistory.length - 1
          : Math.max(current.index - 1, 0);
      promptHistoryStateRef.current = {
        index: nextIndex,
        draft: current.index == null ? prompt : current.draft,
      };
      setPrompt(promptHistory[nextIndex]);
      focusPromptAtEnd();
      return;
    }

    if (current.index == null) return;
    if (current.index >= promptHistory.length - 1) {
      setPrompt(current.draft);
      promptHistoryStateRef.current = {
        index: null,
        draft: "",
      };
      focusPromptAtEnd();
      return;
    }

    const nextIndex = current.index + 1;
    promptHistoryStateRef.current = {
      index: nextIndex,
      draft: current.draft,
    };
    setPrompt(promptHistory[nextIndex]);
    focusPromptAtEnd();
  }

  function handleSend() {
    if (!activeTab) return;
    closeFooterMenus();
    if (supportsReviewQuickAction && /^\/review\b/i.test(rawSlashPrompt)) {
      const normalized = rawSlashPrompt.trim();
      if (/^\/review\s*$/i.test(normalized)) {
        openReviewPrompt();
        setPrompt("");
        return;
      }
      setPrompt("");
      requestConversationScrollToBottom(activeTab.id);
      void sendChatMessage(activeTab.id, normalized, {
        cliIdOverride: activeTab.selectedCli,
      }).catch((error) => {
        const detail =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "发送失败";
        setQueueFeedback(detail);
      });
      return;
    }
    if (draftAttachments.some((attachment) => attachment.kind === "image") && activeTab.selectedCli !== "codex") {
      setQueueFeedback("当前仅 Codex 支持图片附件，请切换到 Codex 后发送。");
      return;
    }

    if (commandOverlay) {
      if (commandOverlay.kind === "command-help" || commandOverlay.kind === "skill-command") {
        return;
      }

      if (interactiveEntries.length > 0) {
        handleOverlaySelect(safeSelectedIndex);
        return;
      }

      const parsed = parseSlashCommand(rawSlashPrompt);
      if (parsed && commandOverlay.kind === "command-list") {
        setPrompt("");
        void executeAcpCommand(parsed, activeTab.id);
        return;
      }

      if (commandOverlay.kind === "command-argument") {
        if (commandOverlay.loading) {
          return;
        }
        appendChatSystemMessage(
          activeTab.id,
          effectiveCli,
          `No matching ${commandOverlay.commandKind} option for ${titleCaseCli(effectiveCli)}.`,
          1
        );
        return;
      }
    }

    promptHistoryStateRef.current = {
      index: null,
      draft: "",
    };

    if (isStreaming) {
      const result = queueChatMessage(activeTab.id, prompt, activeTab.selectedCli);
      if (result === "full") {
        setQueueFeedback("Only one queued message is allowed. Press Ctrl+B to edit it.");
      } else if (result === "unsupportedAttachments") {
        setQueueFeedback("当前仅 Codex 支持图片附件，请切换到 Codex 后再排队。");
      } else if (result === "queued") {
        setQueueFeedback(null);
        requestConversationScrollToBottom(activeTab.id);
      }
      return;
    }

    requestConversationScrollToBottom(activeTab.id);
    void sendChatMessage(activeTab.id).catch((error) => {
      const detail =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "发送失败";
      setQueueFeedback(detail);
    });
  }

  function handleEditQueuedMessage() {
    if (!activeTab) return;
    const applied = editQueuedChatMessage(activeTab.id);
    if (!applied) return;
    setQueueFeedback(null);
    focusPromptAtEnd();
  }

  function selectCommand(command: AcpCommandDef) {
    if (!activeTab) return;
    if (!command.supportedClis.includes(effectiveCli)) return;

    if (command.kind === "help") {
      setPrompt("/help");
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (command.kind === "review" && supportsReviewQuickAction) {
      openReviewPrompt();
      setPrompt("");
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (isPickerCommandKind(command.kind)) {
      void loadAcpCapabilities(effectiveCli);
      setPrompt(`${command.slash} `);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (command.kind === "fast" && effectiveCli === "codex") {
      setPrompt("/fast ");
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    const parsed = parseSlashCommand(command.slash);
    if (!parsed) return;
    setPrompt("");
    void executeAcpCommand(parsed, activeTab.id);
  }

  function selectShortcut(shortcut: "skills") {
    if (!activeTab) return;
    if (shortcut === "skills") {
      void loadCliSkills(effectiveCli, workspace?.id ?? "");
      setPrompt("/skills ");
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  function selectSkill(skill: CliSkillItem) {
    if (!activeTab) return;
    const trimmedPrompt = prompt.trimStart();
    const promptWithoutLeadingSkill = trimmedPrompt.replace(/^\$(?:[A-Za-z0-9._-]+)?\s*/, "");
    const fromSkillCommand = commandOverlay?.kind === "skill-command" || parseSkillSlashQuery(rawSlashPrompt) != null;
    const nextPrompt = fromSkillCommand
      ? `$${skill.name} `
      : `$${skill.name}${promptWithoutLeadingSkill ? ` ${promptWithoutLeadingSkill}` : " "}`;
    setPrompt(nextPrompt);
    setDismissedSkillKey(skillKey);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const nextCaret = `$${skill.name} `.length;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function selectMention(item: FileMentionCandidate) {
    if (!activeTab || !mentionToken) return;
    const next = `${prompt.slice(0, mentionToken.start)}@${item.relativePath} ${prompt.slice(mentionToken.end)}`;
    setPrompt(next);
    setDismissedMentionKey(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const nextCaret = mentionToken.start + item.relativePath.length + 2;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function selectAgent(agent: SelectedCustomAgent | null, action: "select" | "create") {
    if (!activeTab || !agentToken) return;
    const nextPrompt = `${prompt.slice(0, agentToken.start)}${prompt.slice(agentToken.end)}`.replace(/^\s+/, "");
    setPrompt(nextPrompt);
    setDismissedAgentKey(agentKey);
    if (action === "create") {
      closeFooterMenus();
      navigate("/settings/agents");
      return;
    }
    setTabSelectedAgent(activeTab.id, agent);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const nextCaret = Math.max(0, agentToken.start);
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function selectOption(commandKind: SelectableCommandKind, option: AcpOptionDef) {
    if (!activeTab) return;
    const command = {
      kind: commandKind,
      args: [option.value],
      rawInput: `/${commandKind} ${option.value}`,
    };

    if (commandKind === "fast") {
      setPrompt("");
      void executeAcpCommand(command, activeTab.id);
      return;
    }

    if (commandKind === "model" && effectiveCli === "codex") {
      setPrompt("/effort ");
      void loadAcpCapabilities(effectiveCli);
      void executeAcpCommand(command, activeTab.id);
      return;
    }

    setPrompt("");
    void executeAcpCommand(command, activeTab.id);
  }

  function handleOverlaySelect(index: number) {
    const entry = interactiveEntries[index];
    if (!entry) return;
    if (entry.kind === "command") {
      selectCommand(entry.command);
      return;
    }
    if (entry.kind === "shortcut") {
      selectShortcut(entry.shortcut);
      return;
    }
    if (entry.kind === "skill") {
      selectSkill(entry.skill);
      return;
    }
    if (entry.kind === "mention") {
      selectMention(entry.mention);
      return;
    }
    if (entry.kind === "agent") {
      selectAgent(entry.agent, entry.action);
      return;
    }
    selectOption(entry.commandKind, entry.option);
  }

  function handleEscape() {
    if (
      commandOverlay?.kind === "command-argument" ||
      commandOverlay?.kind === "command-help" ||
      commandOverlay?.kind === "skill-command"
    ) {
      setPrompt("/");
      return;
    }

    if (commandOverlay?.kind === "command-list") {
      setPrompt("");
      return;
    }

    if (showSkillOverlay && skillKey) {
      setDismissedSkillKey(skillKey);
      return;
    }

    if (showAgentOverlay && agentKey) {
      setDismissedAgentKey(agentKey);
      return;
    }

    if (showMentionOverlay && mentionKey) {
      setDismissedMentionKey(mentionKey);
      return;
    }

    if (openFooterMenu) {
      closeFooterMenus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const hasInteractiveOverlay = interactiveEntries.length > 0;
    const selectionStart = event.currentTarget.selectionStart ?? 0;
    const selectionEnd = event.currentTarget.selectionEnd ?? 0;
    const hasSelection = selectionStart !== selectionEnd;
    const atPromptStart = !hasSelection && selectionStart === 0;
    const atPromptEnd = !hasSelection && selectionEnd === event.currentTarget.value.length;

    if (event.key === "Tab" && event.shiftKey && activeTab && !commandOverlay && !showAgentOverlay && !showSkillOverlay && !showMentionOverlay) {
      event.preventDefault();
      togglePlanMode(activeTab.id);
      return;
    }

    if (
      activeTab &&
      queuedPrompt &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "b"
    ) {
      event.preventDefault();
      handleEditQueuedMessage();
      return;
    }

    if (hasInteractiveOverlay) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) => Math.min(current + 1, interactiveEntries.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleOverlaySelect(safeSelectedIndex);
        return;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        handleOverlaySelect(safeSelectedIndex);
        return;
      }
    }

    if (!commandOverlay && !showAgentOverlay && !showSkillOverlay && !showMentionOverlay && !openFooterMenu) {
      if (event.key === "ArrowUp" && atPromptStart) {
        event.preventDefault();
        navigatePromptHistory(-1);
        return;
      }
      if (event.key === "ArrowDown" && atPromptEnd && promptHistoryStateRef.current.index !== null) {
        event.preventDefault();
        navigatePromptHistory(1);
        return;
      }
    }

    if (event.key === "Escape" && (commandOverlay || showAgentOverlay || showSkillOverlay || showMentionOverlay || openFooterMenu)) {
      event.preventDefault();
      handleEscape();
      return;
    }

    if (event.key === "Escape" && activeTab && isStreaming) {
      event.preventDefault();
      void interruptChatTurn(activeTab.id);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  if (!activeTab || !workspace) return null;
  const isAutoMode = activeTab.selectedCli === "auto";
  const promptPlaceholder = isStreaming
    ? queuedPrompt
      ? "响应中，队列已满 · Ctrl+B 编辑队列 · Shift+Enter 换行 · ↑↓ 历史"
      : "响应中，可继续输入 · Enter 加入队列 · Shift+Enter 换行 · ↑↓ 历史"
    : isAutoMode
      ? "/指令中心 · @引用文件 · #智能体 · Enter 发送 · Shift+Enter 换行 · ↑↓ 历史"
      : "/指令中心 · @引用文件 · #智能体 · $调用技能 · Enter 发送 · Shift+Enter 换行 · ↑↓ 历史";
  const tabUsageTokens = activeSession
    ? activeSession.messages.reduce((sum, message) => sum + (message.totalTokens ?? 0), 0)
    : 0;
  const sessionUsageTokens = activeSession
    ? calculateCliSessionUsageTokens(activeSession.messages, effectiveCli)
    : 0;
  const activeTransportSession = activeTab?.transportSessions[effectiveCli] ?? null;
  const contextWindowTokens =
    activeTransportSession?.contextWindowTokens && activeTransportSession.contextWindowTokens > 0
      ? activeTransportSession.contextWindowTokens
      : null;
  const usagePercent = sessionUsageTokens > 0 && contextWindowTokens
    ? Math.min(100, (sessionUsageTokens / contextWindowTokens) * 100)
    : null;
  const usageRingPercentLabel = `${Math.round(usagePercent ?? 0)}%`;
  const usagePercentLabel = usagePercent === null ? "--" : `${Math.round(usagePercent)}%`;
  const messageCount = activeSession
    ? activeSession.messages.filter(
        (message) => message.role === "user" || message.role === "assistant"
      ).length
    : 0;
  const sessionUsageCompact = formatCompactCount(sessionUsageTokens);
  const tabUsageCompact = formatCompactCount(tabUsageTokens);
  const contextWindowCompact = formatCompactCount(contextWindowTokens ?? 0);
  const usageTooltip = contextWindowTokens
    ? `当前 session usage ${sessionUsageTokens.toLocaleString()} tokens，占 ${titleCaseCli(effectiveCli)} 当前上报的 context window ${contextWindowTokens.toLocaleString()} tokens 的 ${usagePercentLabel}。当前 tab 累计 usage 为 ${tabUsageTokens.toLocaleString()} tokens。`
    : `当前 session usage ${sessionUsageTokens.toLocaleString()} tokens。${titleCaseCli(effectiveCli)} 当前没有返回可用的 context window，因此不显示百分比。当前 tab 累计 usage 为 ${tabUsageTokens.toLocaleString()} tokens。`;
  const currentProviderItem =
    providerItems.find((item) => item.id === activeTab.selectedCli) ??
    providerItems[0];
  const permissionOptions = capabilities?.permissions.options ?? [];
  const modelOptions = modelCatalog?.options ?? [];
  const currentPermissionValue = currentPermissionLabel(activeTab);
  const currentModelValue = activeTab.modelOverrides[effectiveCli] ?? "";
  const currentPermissionDisplay =
    findOptionLabel(permissionOptions, currentPermissionValue) ?? footerModeLabel(currentPermissionValue);
  const currentModelDisplay =
    findOptionLabel(modelOptions, currentModelValue) ??
    (currentModelValue.trim() ? currentModelValue : "默认模型");
  const currentReasoningDisplay = footerEffortLabel(activeTab.effortLevel);
  const supportsReasoning = effectiveCli === "codex" || effectiveCli === "claude";
  const supportsFastMode = activeTab.selectedCli === "codex";
  const usesSpeedSubmenu = activeTab.selectedCli === "codex";
  const fastModeLabel = activeTab.selectedCli === "codex" ? "Speed" : "Fast Mode";
  const fastModeStateLabel =
    activeTab.selectedCli === "codex"
      ? activeTab.fastMode ? "FAST" : "STD"
      : activeTab.fastMode ? "ON" : "OFF";
  const footerSelectorsLocked = isStreaming;
  const sessionActionsLocked = footerSelectorsLocked || isBusy;
  const selectorLockTitle = isStreaming ? "响应进行中，当前不可修改会话配置" : undefined;
  const autoSelectorTitle = "Auto 路由下不可直接指定，先切换到具体 CLI";
  const reasoningSelectorTitle = !supportsReasoning
    ? `${titleCaseCli(effectiveCli)} 当前不支持思考深度选择`
    : undefined;
  const modeMenuLoading =
    !isAutoMode &&
    (capabilityStatus === "idle" || capabilityStatus === "loading") &&
    !capabilities?.permissions;
  const modelMenuLoading =
    !isAutoMode &&
    modelOptions.length === 0 &&
    (capabilityStatus === "idle" || capabilityStatus === "loading") &&
    !capabilities?.model;
  const sendDisabled = !isStreaming && prompt.trim().length === 0 && draftAttachments.length === 0;

  function handleToggleFooterMenu(menu: FooterMenuId, disabled = false) {
    if (disabled) return;
    if ((menu === "mode" || menu === "model") && !isAutoMode) {
      void loadAcpCapabilities(effectiveCli);
    }
    setHoveredConfigSubmenu(null);
    setOpenFooterMenu((current) => (current === menu ? null : menu));
  }

  function closeFooterMenus() {
    setHoveredConfigSubmenu(null);
    setOpenFooterMenu(null);
  }

  function handleProviderSelect(cliId: TerminalCliId, unavailable: boolean) {
    if (!activeTab || unavailable) return;
    setTabSelectedCli(activeTab.id, cliId);
    closeFooterMenus();
    if (cliId !== "auto") {
      void loadAcpCapabilities(cliId);
    }
    focusPromptAtEnd();
  }

  function handleSelectedAgentChange(agent: SelectedCustomAgent | null) {
    if (!activeTab) return;
    setTabSelectedAgent(activeTab.id, agent);
    closeFooterMenus();
    focusPromptAtEnd();
  }

  function handleOpenAgentSettings() {
    closeFooterMenus();
    navigate("/settings/agents");
  }

  function handlePermissionSelect(value: string) {
    if (!activeTab || isAutoMode) return;
    closeFooterMenus();
    void executeAcpCommand(
      {
        kind: "permissions",
        args: [value],
        rawInput: `/permissions ${value}`,
      },
      activeTab.id
    );
    focusPromptAtEnd();
  }

  function handleModelSelect(value: string) {
    if (!activeTab || isAutoMode) return;
    closeFooterMenus();
    void executeAcpCommand(
      {
        kind: "model",
        args: [value],
        rawInput: `/model ${value}`,
      },
      activeTab.id
    );
    focusPromptAtEnd();
  }

  function handleReasoningSelect(value: FooterReasoningOption["id"]) {
    if (!activeTab || isAutoMode || !supportsReasoning) return;
    closeFooterMenus();
    void executeAcpCommand(
      {
        kind: "effort",
        args: [value],
        rawInput: `/effort ${value}`,
      },
      activeTab.id
    );
    focusPromptAtEnd();
  }

  function openReviewPrompt() {
    if (!workspace || !supportsReviewQuickAction) {
      return;
    }

    setHighlightedPresetIndex(0);
    setHighlightedBranchIndex(0);
    setHighlightedCommitIndex(0);
    setReviewPrompt({
      workspaceName: workspace.name,
      step: "preset",
      branches: [],
      commits: [],
      isLoadingBranches: true,
      isLoadingCommits: true,
      selectedBranch: "",
      selectedCommitSha: "",
      selectedCommitTitle: "",
      customInstructions: "",
      error: null,
      isSubmitting: false,
    });

    void (async () => {
      try {
        const [branchResponse, commitResponse] = await Promise.all([
          bridge.listGitBranches(workspace.rootPath, workspace.id),
          bridge.getGitCommitHistory(
            workspace.rootPath,
            { limit: 100, offset: 0 },
            workspace.id
          ),
        ]);

        const branches = branchResponse.localBranches ?? [];
        const commits = commitResponse.commits ?? [];
        const preferredBranch =
          branches.find((branch) => branch.name === "main")?.name ??
          branches[0]?.name ??
          "";
        const preferredCommit = commits[0] ?? null;

        setReviewPrompt((current) =>
          current
            ? {
                ...current,
                branches,
                commits,
                isLoadingBranches: false,
                isLoadingCommits: false,
                selectedBranch: current.selectedBranch || preferredBranch,
                selectedCommitSha: current.selectedCommitSha || preferredCommit?.sha || "",
                selectedCommitTitle:
                  current.selectedCommitTitle ||
                  preferredCommit?.summary ||
                  preferredCommit?.sha ||
                  "",
              }
            : current
        );

        const nextBranchIndex = branches.findIndex((branch) => branch.name === preferredBranch);
        const nextCommitIndex = commits.findIndex((commit) => commit.sha === preferredCommit?.sha);
        setHighlightedBranchIndex(nextBranchIndex >= 0 ? nextBranchIndex : 0);
        setHighlightedCommitIndex(nextCommitIndex >= 0 ? nextCommitIndex : 0);
      } catch (error) {
        setReviewPrompt((current) =>
          current
            ? {
                ...current,
                isLoadingBranches: false,
                isLoadingCommits: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Unable to load Git history for review.",
              }
            : current
        );
      }
    })();
  }

  function closeReviewPrompt() {
    setReviewPrompt(null);
    focusPromptAtEnd();
  }

  function showReviewPresetStep() {
    setHighlightedPresetIndex(0);
    setReviewPrompt((current) => (current ? { ...current, step: "preset", error: null } : current));
  }

  function chooseReviewPreset(preset: ReviewPresetChoice) {
    if (preset === "uncommitted") {
      void submitReviewTarget("uncommitted");
      return;
    }
    setHighlightedBranchIndex(0);
    setHighlightedCommitIndex(0);
    setReviewPrompt((current) =>
      current
        ? {
            ...current,
            step: preset,
            error: null,
            selectedBranch:
              preset === "baseBranch"
                ? current.selectedBranch || current.branches.find((branch) => branch.name === "main")?.name || current.branches[0]?.name || ""
                : current.selectedBranch,
            selectedCommitSha:
              preset === "commit"
                ? current.selectedCommitSha || current.commits[0]?.sha || ""
                : current.selectedCommitSha,
            selectedCommitTitle:
              preset === "commit"
                ? current.selectedCommitTitle || current.commits[0]?.summary || current.commits[0]?.sha || ""
                : current.selectedCommitTitle,
          }
        : current
    );
  }

  function selectReviewBranch(value: string) {
    setReviewPrompt((current) => {
      if (!current) {
        return current;
      }
      const nextIndex = current.branches.findIndex((branch) => branch.name === value);
      if (nextIndex >= 0) {
        setHighlightedBranchIndex(nextIndex);
      }
      return { ...current, selectedBranch: value, error: null };
    });
  }

  function selectReviewCommit(sha: string, title: string) {
    setReviewPrompt((current) => {
      if (!current) {
        return current;
      }
      const nextIndex = current.commits.findIndex((commit) => commit.sha === sha);
      if (nextIndex >= 0) {
        setHighlightedCommitIndex(nextIndex);
      }
      return {
        ...current,
        selectedCommitSha: sha,
        selectedCommitTitle: title,
        error: null,
      };
    });
  }

  function updateReviewCustomInstructions(value: string) {
    setReviewPrompt((current) => (current ? { ...current, customInstructions: value, error: null } : current));
  }

  async function submitReviewTarget(
    target:
      | "uncommitted"
      | { type: "baseBranch"; branch: string }
      | { type: "commit"; sha: string; title?: string }
      | { type: "custom"; instructions: string }
  ) {
    if (!activeTab) {
      return;
    }

    setReviewPrompt((current) => (current ? { ...current, isSubmitting: true, error: null } : current));
    const commandText = buildReviewCommandText(target);

    try {
      await sendChatMessage(activeTab.id, commandText, {
        cliIdOverride: activeTab.selectedCli,
      });
      setReviewPrompt(null);
      focusPromptAtEnd();
    } catch (error) {
      setReviewPrompt((current) =>
        current
          ? {
              ...current,
              isSubmitting: false,
              error: error instanceof Error ? error.message : "Unable to start review.",
            }
          : current
      );
    }
  }

  async function confirmReviewBranch() {
    const branch = reviewPrompt?.selectedBranch.trim() ?? "";
    if (!branch) {
      setReviewPrompt((current) => (current ? { ...current, error: "Choose a base branch." } : current));
      return;
    }
    await submitReviewTarget({ type: "baseBranch", branch });
  }

  async function confirmReviewCommit() {
    const sha = reviewPrompt?.selectedCommitSha.trim() ?? "";
    if (!sha) {
      setReviewPrompt((current) => (current ? { ...current, error: "Choose a commit to review." } : current));
      return;
    }
    await submitReviewTarget({
      type: "commit",
      sha,
      title: reviewPrompt?.selectedCommitTitle.trim() || undefined,
    });
  }

  async function confirmReviewCustom() {
    const instructions = reviewPrompt?.customInstructions.trim() ?? "";
    if (!instructions) {
      setReviewPrompt((current) =>
        current ? { ...current, error: "Enter custom review instructions." } : current
      );
      return;
    }
    await submitReviewTarget({ type: "custom", instructions });
  }

  function handleReviewPromptKeyDown(event: {
    key: string;
    shiftKey?: boolean;
    preventDefault: () => void;
  }) {
    if (!reviewPrompt) {
      return false;
    }
    const { key } = event;
    if (reviewPrompt.isSubmitting) {
      if (key === "Enter" || key === "Escape" || key.startsWith("Arrow")) {
        event.preventDefault();
      }
      return true;
    }

    if (key === "Escape") {
      event.preventDefault();
      if (reviewPrompt.step === "preset") {
        closeReviewPrompt();
      } else {
        showReviewPresetStep();
      }
      return true;
    }

    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const direction = key === "ArrowDown" ? 1 : -1;
      if (reviewPrompt.step === "preset") {
        const presetCount = 4;
        setHighlightedPresetIndex((current) => (current + direction + presetCount) % presetCount);
        return true;
      }
      if (reviewPrompt.step === "baseBranch") {
        if (reviewPrompt.branches.length === 0) {
          return true;
        }
        const count = reviewPrompt.branches.length;
        const next = (highlightedBranchIndex + direction + count) % count;
        const branch = reviewPrompt.branches[next];
        if (branch) {
          selectReviewBranch(branch.name);
        }
        return true;
      }
      if (reviewPrompt.step === "commit") {
        if (reviewPrompt.commits.length === 0) {
          return true;
        }
        const count = reviewPrompt.commits.length;
        const next = (highlightedCommitIndex + direction + count) % count;
        const commit = reviewPrompt.commits[next];
        if (commit) {
          selectReviewCommit(commit.sha, commit.summary || commit.sha);
        }
        return true;
      }
    }

    if (key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (reviewPrompt.step === "preset") {
        const presets: ReviewPresetChoice[] = ["baseBranch", "uncommitted", "commit", "custom"];
        chooseReviewPreset(presets[highlightedPresetIndex] ?? "baseBranch");
        return true;
      }
      if (reviewPrompt.step === "baseBranch") {
        void confirmReviewBranch();
        return true;
      }
      if (reviewPrompt.step === "commit") {
        void confirmReviewCommit();
        return true;
      }
      if (reviewPrompt.step === "custom") {
        void confirmReviewCustom();
        return true;
      }
    }

    return false;
  }

  function handlePlanToggle() {
    if (!activeTab || footerSelectorsLocked) return;
    togglePlanMode(activeTab.id);
    closeFooterMenus();
    focusPromptAtEnd();
  }

  function handleReviewQuickStart() {
    if (!activeTab || isStreaming || isBusy || !supportsReviewQuickAction) return;
    closeFooterMenus();
    openReviewPrompt();
    focusPromptAtEnd();
  }

  function handleFreshTabSession() {
    if (!activeTab || footerSelectorsLocked || isBusy) return;
    resetTerminalTabSession(activeTab.id);
    closeFooterMenus();
    focusPromptAtEnd();
  }

  function handleCliSessionReset(cliId: AgentId) {
    if (!activeTab || footerSelectorsLocked || isBusy) return;
    resetCliTransportSession(cliId, activeTab.id);
    closeFooterMenus();
    focusPromptAtEnd();
  }

  function handleToolApprovalModeChange(mode: ToolApprovalMode) {
    if (!activeTab || footerSelectorsLocked || isBusy || activeTab.toolApprovalMode === mode) return;
    void setTabToolApprovalMode(activeTab.id, mode);
    closeFooterMenus();
    focusPromptAtEnd();
  }

  function handleFastToggle() {
    if (!activeTab || footerSelectorsLocked || !supportsFastMode) return;
    closeFooterMenus();
    void executeAcpCommand(
      {
        kind: "fast",
        args: [],
        rawInput: "/fast",
      },
      activeTab.id
    );
    focusPromptAtEnd();
  }

  function handleFastModeSelect(mode: "standard" | "fast") {
    if (!activeTab || footerSelectorsLocked || !supportsFastMode) return;
    const shouldBeFast = mode === "fast";
    if (activeTab.fastMode === shouldBeFast) {
      closeFooterMenus();
      focusPromptAtEnd();
      return;
    }
    closeFooterMenus();
    void executeAcpCommand(
      {
        kind: "fast",
        args: [shouldBeFast ? "on" : "off"],
        rawInput: `/fast ${shouldBeFast ? "on" : "off"}`,
      },
      activeTab.id
    );
    focusPromptAtEnd();
  }

  function handlePromptShortcutAction(trigger: "@" | "/" | "#" | "$") {
    closeFooterMenus();
    if (!activeTab) return;
    if (trigger === "#") {
      const nextPrompt = prompt.trim().length === 0 ? "#" : `${prompt.replace(/\s*$/, "")}\n#`;
      setPrompt(nextPrompt);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        const nextCaret = nextPrompt.length;
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      });
      return;
    }

    const needsLeadingSpace = prompt.length > 0 && !/\s$/.test(prompt);
    const nextPrompt = `${prompt}${needsLeadingSpace ? " " : ""}${trigger}`;
    setPrompt(nextPrompt);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const nextCaret = nextPrompt.length;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }

  const shortcutActions: PromptShortcutAction[] = [
    {
      key: "file",
      trigger: "@",
      label: "引用文件",
      onClick: () => handlePromptShortcutAction("@"),
    },
    {
      key: "command",
      trigger: "/",
      label: "指令中心",
      onClick: () => handlePromptShortcutAction("/"),
    },
    {
      key: "agent",
      trigger: "#",
      label: "智能体",
      onClick: () => handlePromptShortcutAction("#"),
    },
    ...(!isAutoMode
      ? [
          {
            key: "skill",
            trigger: "$",
            label: "调用技能",
            onClick: () => handlePromptShortcutAction("$"),
          },
        ]
      : []),
  ];

  return (
    <div
      data-chat-prompt-surface="true"
      className="terminal-chat-prompt px-5 py-2.5"
    >
      <div className="mx-auto max-w-5xl">
        <div className="relative overflow-visible">
          {activePlanGroup && activePlanMessage?.cliId ? (
            <ActivePlanOverlay
              group={activePlanGroup}
              cliId={activePlanMessage.cliId as AgentId}
            />
          ) : null}

          {(commandOverlay || showAgentOverlay || showSkillOverlay || showMentionOverlay) && (
            <PromptOverlay
              title={
                commandOverlay?.title ??
                (showAgentOverlay ? agentOverlay?.title : showSkillOverlay ? skillOverlay?.title : undefined)
              }
              description={
                commandOverlay?.description ??
                (showAgentOverlay
                  ? agentOverlay?.description
                  : showSkillOverlay
                    ? skillOverlay?.description
                    : undefined)
              }
              sections={activeSections}
              selectedIndex={safeSelectedIndex}
              interactive={interactiveEntries.length > 0}
              footer={
                commandOverlay?.footer ??
                (showAgentOverlay ? agentOverlay?.footer : showSkillOverlay ? skillOverlay?.footer : undefined)
              }
              onBack={
                commandOverlay?.kind === "command-argument" ||
                commandOverlay?.kind === "command-help" ||
                commandOverlay?.kind === "skill-command"
                  ? () => setPrompt("/")
                  : undefined
              }
              onSelect={(item) => {
                const index = interactiveEntries.findIndex((entry) => entry.id === item.id);
                if (index >= 0) handleOverlaySelect(index);
              }}
            />
          )}

          <div className="terminal-chat-prompt-shell">
            {reviewPrompt ? (
              <div className="terminal-chat-review-inline-suggestions">
                <ReviewInlinePrompt
                  reviewPrompt={reviewPrompt}
                  onClose={closeReviewPrompt}
                  onShowPreset={showReviewPresetStep}
                  onChoosePreset={chooseReviewPreset}
                  highlightedPresetIndex={highlightedPresetIndex}
                  onHighlightPreset={setHighlightedPresetIndex}
                  highlightedBranchIndex={highlightedBranchIndex}
                  onHighlightBranch={setHighlightedBranchIndex}
                  highlightedCommitIndex={highlightedCommitIndex}
                  onHighlightCommit={setHighlightedCommitIndex}
                  onSelectBranch={selectReviewBranch}
                  onConfirmBranch={confirmReviewBranch}
                  onSelectCommit={selectReviewCommit}
                  onConfirmCommit={confirmReviewCommit}
                  onUpdateCustomInstructions={updateReviewCustomInstructions}
                  onConfirmCustom={confirmReviewCustom}
                  onKeyDown={handleReviewPromptKeyDown}
                />
              </div>
            ) : null}
            <div className="terminal-chat-input-box">
              <div className="terminal-chat-input-area">
                {resolvedSelectedAgent || draftAttachments.length > 0 ? (
                  <div className="terminal-chat-input-context" data-chat-search-ignore="true">
                    {resolvedSelectedAgent ? (
                      <div
                        className="context-agent-chip context-agent-chip--input"
                        title={resolvedSelectedAgent.name}
                      >
                        <span className="context-agent-chip-main">
                          <AgentIcon
                            icon={resolvedSelectedAgent.icon}
                            seed={resolvedSelectedAgent.id || resolvedSelectedAgent.name}
                            size={14}
                          />
                          <span className="context-agent-chip-label">{resolvedSelectedAgent.name}</span>
                        </span>
                        <button
                          type="button"
                          className="context-agent-chip-clear"
                          onClick={() => handleSelectedAgentChange(null)}
                          aria-label="清除智能体"
                        >
                          <X size={12} aria-hidden="true" />
                        </button>
                      </div>
                    ) : null}

                    {draftAttachments.length > 0 ? (
                      <div className="terminal-chat-attachments">
                        {draftAttachments.map((attachment) => {
                          const previewSrc = attachmentPreviewSrc(attachment);
                          const label = attachmentLabel(attachment);
                          return (
                            <div
                              key={attachment.id}
                              className={`terminal-chat-attachment-chip terminal-chat-attachment-chip--${attachment.kind}`}
                              title={label}
                            >
                              {attachment.kind === "image" && previewSrc ? (
                                <span className="terminal-chat-attachment-thumb" aria-hidden="true">
                                  <img src={previewSrc} alt="" />
                                </span>
                              ) : (
                                <span className="terminal-chat-attachment-icon" aria-hidden="true">
                                  {attachment.kind === "image" ? (
                                    <ImageIcon size={13} />
                                  ) : (
                                    <FileText size={13} />
                                  )}
                                </span>
                              )}
                              <span className="terminal-chat-attachment-name">{label}</span>
                              <button
                                type="button"
                                className="terminal-chat-attachment-remove"
                                onClick={() => handleRemoveDraftAttachment(attachment.id)}
                                aria-label={`移除 ${label}`}
                              >
                                <X size={12} aria-hidden="true" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={prompt}
                  onChange={(event) => handlePromptChange(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={promptPlaceholder}
                  className="terminal-chat-textarea"
                />

                {queueFeedback ? (
                  <div className="terminal-chat-queue-feedback">{queueFeedback}</div>
                ) : null}
              </div>

              <div
                ref={footerMenuRef}
                className="button-area"
                data-provider={currentProviderItem.id}
              >
                <div className="button-area-left">
                  <div className="terminal-chat-footer-control">
                    <button
                      type="button"
                      onClick={() => handleToggleFooterMenu("config", footerSelectorsLocked)}
                      disabled={footerSelectorsLocked}
                      title={selectorLockTitle ?? "会话配置"}
                      className="selector-button config-button"
                    >
                      <Settings2 size={14} />
                    </button>

                    {openFooterMenu === "config" ? (
                      <div
                        className="selector-dropdown terminal-chat-dropdown--config terminal-chat-dropdown--config-menu"
                        onMouseLeave={() => setHoveredConfigSubmenu(null)}
                      >
                        <div className="footer-submenu-shell">
                          <div className="footer-submenu-primary">
                            <div
                              className="footer-submenu-trigger"
                              onPointerEnter={() => setHoveredConfigSubmenu("agent")}
                            >
                              <FooterMenuItem
                                label="Agent"
                                onClick={() =>
                                  setHoveredConfigSubmenu((current) => (current === "agent" ? null : "agent"))
                                }
                                trailing={
                                  <span className="footer-option-trailing">
                                    {resolvedSelectedAgent ? (
                                      <span className="footer-option-inline-value">
                                        {resolvedSelectedAgent.name}
                                      </span>
                                    ) : null}
                                    <ChevronRight size={14} aria-hidden />
                                  </span>
                                }
                              />
                            </div>
                            <div
                              className="footer-submenu-trigger"
                              onPointerEnter={() => setHoveredConfigSubmenu("session")}
                            >
                              <FooterMenuItem
                                label="New Session"
                                onClick={() =>
                                  setHoveredConfigSubmenu((current) => (current === "session" ? null : "session"))
                                }
                                disabled={sessionActionsLocked}
                                trailing={
                                  <span className="footer-option-trailing">
                                    <ChevronRight size={14} aria-hidden />
                                  </span>
                                }
                              />
                            </div>
                            <div
                              className="footer-submenu-trigger"
                              onPointerEnter={() => setHoveredConfigSubmenu("approval")}
                            >
                              <FooterMenuItem
                                label="Tool Approval"
                                onClick={() =>
                                  setHoveredConfigSubmenu((current) => (current === "approval" ? null : "approval"))
                                }
                                disabled={sessionActionsLocked}
                                trailing={
                                  <span className="footer-option-trailing">
                                    <span className="footer-option-inline-value">
                                      {toolApprovalModeLabel(activeTab.toolApprovalMode)}
                                    </span>
                                    <ChevronRight size={14} aria-hidden />
                                  </span>
                                }
                              />
                            </div>
                            <div className="footer-menu-divider" aria-hidden />
                            {supportsReviewQuickAction ? (
                              <FooterMenuItem
                                label="Review Code"
                                description="让当前 CLI 审查工作区并给出下一步建议。"
                                onClick={handleReviewQuickStart}
                                disabled={isStreaming || isBusy}
                                
                                className="selector-option-review-quick"
                              />
                            ) : null}
                            <FooterMenuItem
                              label="Plan Mode"
                              onClick={handlePlanToggle}
                              trailing={
                                <span
                                  className={`footer-option-switch ${activeTab.planMode ? "is-active" : ""}`}
                                  aria-hidden="true"
                                >
                                  <span className="footer-option-switch-thumb" />
                                </span>
                              }
                            />

                            {supportsFastMode ? (
                              usesSpeedSubmenu ? (
                                <>
                                  <div
                                    className="footer-submenu-trigger"
                                    onPointerEnter={() => setHoveredConfigSubmenu("speed")}
                                  >
                                    <FooterMenuItem
                                      label={fastModeLabel}
                                      onClick={() =>
                                        setHoveredConfigSubmenu((current) => (current === "speed" ? null : "speed"))
                                      }
                                      trailing={
                                        <span className="footer-option-trailing">
                                          <span className="footer-option-inline-value">{fastModeStateLabel}</span>
                                          <ChevronRight size={14} aria-hidden />
                                        </span>
                                      }
                                    />
                                  </div>
                                </>
                              ) : (
                                <FooterMenuItem
                                  label={fastModeLabel}
                                  onClick={handleFastToggle}
                                  trailing={
                                    <span className={`footer-option-state ${activeTab.fastMode ? "is-active" : ""}`}>
                                      {fastModeStateLabel}
                                    </span>
                                  }
                                />
                              )
                            ) : null}
                          </div>

                          {hoveredConfigSubmenu === "agent" ? (
                            <div
                              className="footer-submenu-panel"
                              onPointerEnter={() => setHoveredConfigSubmenu("agent")}
                            >
                              {customAgents.length > 0 ? (
                                customAgents.map((agent) => {
                                  const selected = resolvedSelectedAgent?.id === agent.id;
                                  return (
                                    <FooterMenuItem
                                      key={agent.id}
                                      label={agent.name}
                                      onClick={() =>
                                        handleSelectedAgentChange({
                                          id: agent.id,
                                          name: agent.name,
                                          prompt: agent.prompt ?? null,
                                          icon: agent.icon ?? null,
                                        })
                                      }
                                      selected={selected}
                                    />
                                  );
                                })
                              ) : (
                                <div className="selector-option disabled">还没有可选智能体。</div>
                              )}
                              <div className="footer-menu-divider" aria-hidden />
                              <FooterMenuItem
                                label="创建智能体"
                                onClick={handleOpenAgentSettings}
                                leading={<Plus size={14} />}
                              />
                            </div>
                          ) : hoveredConfigSubmenu === "session" ? (
                            <div
                              className="footer-submenu-panel"
                              onPointerEnter={() => setHoveredConfigSubmenu("session")}
                            >
                              <FooterMenuItem
                                label="Fresh Session for This Tab"
                                description="Clear this tab history and reset all underlying CLI sessions."
                                onClick={handleFreshTabSession}
                                disabled={sessionActionsLocked}
                              />
                              <div className="footer-menu-divider" aria-hidden />
                              <FooterMenuItem
                                label="Reset Codex Session"
                                description="Start a fresh Codex transport session for this tab."
                                onClick={() => handleCliSessionReset("codex")}
                                disabled={sessionActionsLocked}
                              />
                              <FooterMenuItem
                                label="Reset Claude Session"
                                description="Start a fresh Claude transport session for this tab."
                                onClick={() => handleCliSessionReset("claude")}
                                disabled={sessionActionsLocked}
                              />
                              <FooterMenuItem
                                label="Reset Gemini Session"
                                description="Start a fresh Gemini transport session for this tab."
                                onClick={() => handleCliSessionReset("gemini")}
                                disabled={sessionActionsLocked}
                              />
                            </div>
                          ) : hoveredConfigSubmenu === "approval" ? (
                            <div
                              className="footer-submenu-panel"
                              onPointerEnter={() => setHoveredConfigSubmenu("approval")}
                            >
                              <FooterMenuItem
                                label="Manual approval"
                                description="Always ask before running tools in this tab."
                                onClick={() => handleToolApprovalModeChange("manual")}
                                selected={activeTab.toolApprovalMode === "manual"}
                                disabled={sessionActionsLocked}
                              />
                              <FooterMenuItem
                                label="Auto-approve for This Tab"
                                description="Automatically approve tool requests in this tab until you turn it off."
                                onClick={() => handleToolApprovalModeChange("auto")}
                                selected={activeTab.toolApprovalMode === "auto"}
                                disabled={sessionActionsLocked}
                              />
                            </div>
                          ) : hoveredConfigSubmenu === "speed" ? (
                            <div
                              className="footer-submenu-panel"
                              onPointerEnter={() => setHoveredConfigSubmenu("speed")}
                            >
                              <FooterMenuItem
                                label="Standard"
                                onClick={() => handleFastModeSelect("standard")}
                                selected={!activeTab.fastMode}
                              />
                              <FooterMenuItem
                                label="Fast"
                                onClick={() => handleFastModeSelect("fast")}
                                selected={activeTab.fastMode}
                              />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {openFooterMenu === "agent" ? (
                      <div className="selector-dropdown terminal-chat-dropdown--config">
                        <FooterMenuSection title="选择智能体">
                          {customAgents.length > 0 ? (
                            customAgents.map((agent) => {
                              const selected = resolvedSelectedAgent?.id === agent.id;
                              return (
                                <FooterMenuItem
                                  key={agent.id}
                                  label={agent.name}
                                  onClick={() =>
                                    handleSelectedAgentChange({
                                      id: agent.id,
                                      name: agent.name,
                                      prompt: agent.prompt ?? null,
                                      icon: agent.icon ?? null,
                                    })
                                  }
                                  selected={selected}
                                />
                              );
                            })
                          ) : (
                            <div className="selector-option disabled">还没有可选智能体。</div>
                          )}
                        </FooterMenuSection>

                        <FooterMenuSection title="操作">
                          {resolvedSelectedAgent ? (
                            <FooterMenuItem
                              label="清除当前智能体"
                              description="恢复为普通会话，不附着角色提示。"
                              onClick={() => handleSelectedAgentChange(null)}
                              leading={<X size={14} />}
                            />
                          ) : null}
                          <FooterMenuItem
                            label="管理智能体"
                            description="打开设置页创建、编辑或导入智能体。"
                            onClick={handleOpenAgentSettings}
                            leading={<Plus size={14} />}
                          />
                        </FooterMenuSection>
                      </div>
                    ) : null}
                  </div>

                  <div className="terminal-chat-footer-control">
                    <button
                      type="button"
                      onClick={() => handleToggleFooterMenu("shortcuts", isStreaming || isBusy)}
                      disabled={isStreaming || isBusy}
                      title={isStreaming || isBusy ? "当前不可执行快捷动作" : "快捷动作"}
                      className="selector-button selector-shortcut-button"
                    >
                      <Zap size={14} />
                    </button>

                    {openFooterMenu === "shortcuts" ? (
                      <div className="selector-dropdown terminal-chat-dropdown--shortcuts">
                        {shortcutActions.map((action) => (
                          <button
                            key={action.key}
                            type="button"
                            className="selector-option selector-option-shortcut selector-option-button selector-option-shortcut-button"
                            onClick={action.onClick}
                          >
                            <span className="selector-shortcut-trigger">{action.trigger}</span>
                            <span>{action.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="terminal-chat-footer-control">
                    <button
                      type="button"
                      onClick={() => handleToggleFooterMenu("provider", footerSelectorsLocked)}
                      disabled={footerSelectorsLocked}
                      title={selectorLockTitle ?? `切换路由目标：${currentProviderItem.label}`}
                      className="selector-button selector-provider-button"
                    >
                      {currentProviderItem.id === "auto" ? (
                        <Route className="footer-provider-auto-mark" size={14} strokeWidth={1.9} aria-hidden />
                      ) : (
                        <img
                          src={currentProviderItem.icon}
                          alt=""
                          aria-hidden="true"
                          className="footer-provider-icon"
                          style={{ opacity: currentProviderItem.unavailable ? 0.45 : 1 }}
                        />
                      )}
                    </button>

                    {openFooterMenu === "provider" ? (
                      <div className="selector-dropdown terminal-chat-dropdown--provider">
                        <FooterMenuSection title="路由目标">
                          {providerItems.map((item) => {
                            const isSelected = item.id === activeTab.selectedCli;
                            return (
                              <FooterMenuItem
                                key={item.id}
                                label={item.label}
                                description={
                                  item.id === "auto"
                                    ? "按任务自动路由"
                                    : workspace?.locationKind === "ssh"
                                      ? item.unavailable
                                        ? "远程连接检测未发现该 CLI"
                                        : item.remoteValidationKnown
                                          ? "该 CLI 已在远程主机安装"
                                          : "尚未运行连接检测，暂按可用处理"
                                      : item.unavailable
                                        ? "当前 CLI 未安装"
                                        : "直接发送到该 CLI"
                                }
                                onClick={() => handleProviderSelect(item.id, item.unavailable)}
                                disabled={item.unavailable}
                                selected={isSelected}
                                leading={
                                  item.id === "auto" ? (
                                    <Route className="footer-provider-auto-mark" size={14} strokeWidth={1.9} aria-hidden />
                                  ) : (
                                    <img
                                      src={item.icon}
                                      alt=""
                                      aria-hidden="true"
                                      className="footer-provider-icon"
                                      style={{ opacity: item.unavailable ? 0.45 : 1 }}
                                    />
                                  )
                                }
                              />
                            );
                          })}
                        </FooterMenuSection>
                      </div>
                    ) : null}
                  </div>

                  <div className="terminal-chat-footer-control">
                    <button
                      type="button"
                      onClick={() => handleToggleFooterMenu("mode", isAutoMode || footerSelectorsLocked)}
                      disabled={isAutoMode || footerSelectorsLocked}
                      title={selectorLockTitle ?? (isAutoMode ? autoSelectorTitle : "规则模式")}
                      className="selector-button"
                    >
                      <Shield size={14} />
                      <span className="selector-button-text">{currentPermissionDisplay}</span>
                      {openFooterMenu === "mode" ? (
                        <ChevronUp className="selector-button-chevron" size={12} />
                      ) : (
                        <ChevronDown className="selector-button-chevron" size={12} />
                      )}
                    </button>

                    {openFooterMenu === "mode" ? (
                      <div className="selector-dropdown selector-dropdown--mode">
                        {modeMenuLoading ? (
                          <div className="selector-option disabled">
                            <LoaderCircle className="animate-spin" size={14} />
                            <span>正在加载该 CLI 的规则模式…</span>
                          </div>
                        ) : permissionOptions.length > 0 ? (
                          <FooterMenuSection title="规则模式">
                            {permissionOptions.map((option) => (
                              <FooterMenuItem
                                key={option.value}
                                label={option.label || footerModeLabel(option.value)}
                                description={footerOptionDescription(option)}
                                onClick={() => handlePermissionSelect(option.value)}
                                selected={option.value === currentPermissionValue}
                              />
                            ))}
                          </FooterMenuSection>
                        ) : (
                          <div className="selector-option disabled">当前 CLI 没有暴露可选的规则模式。</div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="terminal-chat-footer-control">
                    <button
                      type="button"
                      onClick={() => handleToggleFooterMenu("model", isAutoMode || footerSelectorsLocked)}
                      disabled={isAutoMode || footerSelectorsLocked}
                      title={selectorLockTitle ?? (isAutoMode ? autoSelectorTitle : `当前模型：${currentModelDisplay}`)}
                      className="selector-button"
                    >
                      <Cpu size={14} />
                      <span className="selector-button-text">{currentModelDisplay}</span>
                      {openFooterMenu === "model" ? (
                        <ChevronUp className="selector-button-chevron" size={12} />
                      ) : (
                        <ChevronDown className="selector-button-chevron" size={12} />
                      )}
                    </button>

                    {openFooterMenu === "model" ? (
                      <div className="selector-dropdown selector-dropdown--model">
                        {modelMenuLoading ? (
                          <div className="selector-option disabled">
                            <LoaderCircle className="animate-spin" size={14} />
                            <span>正在加载该 CLI 的模型列表…</span>
                          </div>
                        ) : modelOptions.length > 0 ? (
                          <FooterMenuSection title="模型选择">
                            {modelOptions.map((option) => (
                              <FooterMenuItem
                                key={option.value}
                                label={option.label || option.value}
                                description={footerOptionDescription(option)}
                                onClick={() => handleModelSelect(option.value)}
                                selected={option.value === currentModelValue}
                              />
                            ))}
                          </FooterMenuSection>
                        ) : (
                          <div className="selector-option disabled">当前 CLI 没有返回可选模型列表。</div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="terminal-chat-footer-control">
                    <button
                      type="button"
                      onClick={() => handleToggleFooterMenu(
                        "reasoning",
                        isAutoMode || footerSelectorsLocked || !supportsReasoning
                      )}
                      disabled={isAutoMode || footerSelectorsLocked || !supportsReasoning}
                      title={selectorLockTitle ?? (isAutoMode ? autoSelectorTitle : reasoningSelectorTitle ?? "思考深度")}
                      className="selector-button"
                    >
                      <Brain size={14} />
                      <span className="selector-button-text">{currentReasoningDisplay}</span>
                      {openFooterMenu === "reasoning" ? (
                        <ChevronUp className="selector-button-chevron" size={12} />
                      ) : (
                        <ChevronDown className="selector-button-chevron" size={12} />
                      )}
                    </button>

                    {openFooterMenu === "reasoning" ? (
                      <div className="selector-dropdown terminal-chat-dropdown--reasoning">
                        <FooterMenuSection title="思考深度">
                          {FOOTER_REASONING_OPTIONS.map((option) => (
                            <FooterMenuItem
                              key={option.id}
                              label={option.label}
                              description={option.description}
                              onClick={() => handleReasoningSelect(option.id)}
                              selected={option.id === activeTab.effortLevel}
                            />
                          ))}
                        </FooterMenuSection>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="button-area-right">
                  <button
                    type="button"
                    onClick={() => {
                      if (isStreaming && activeTab) {
                        void interruptChatTurn(activeTab.id);
                        return;
                      }
                      handleSend();
                    }}
                    disabled={sendDisabled}
                    title={isStreaming ? "停止生成" : "发送消息"}
                    className={`submit-button${isStreaming ? " stop-button" : ""}`}
                  >
                    {isStreaming ? <Square size={14} fill="currentColor" /> : <SendHorizontal size={14} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="context-bar">
              <div className="context-tools">
                <button
                  type="button"
                  onClick={() => void handlePickAttachments()}
                  disabled={isStreaming}
                  className="context-tool-btn context-tool-btn--labeled"
                  title={isStreaming ? "响应进行中，暂时无法添加附件" : "添加附件"}
                >
                  <span className="terminal-chat-status-icon">
                    <Paperclip size={14} />
                  </span>
                  <span className="context-tool-label">
                    附件{draftAttachments.length > 0 ? ` ${draftAttachments.length}` : ""}
                  </span>
                </button>

                <div className="context-dual-usage">
                  <button
                    type="button"
                    aria-label={usageTooltip}
                    className="context-tool-btn context-tool-btn--labeled"
                  >
                    <span
                      className="context-dual-usage-ring"
                      style={{ "--dual-usage-percent": usageRingPercentLabel } as CSSProperties}
                      aria-hidden="true"
                    >
                      <span className="context-dual-usage-ring-inner" />
                    </span>
                    <span className="context-dual-usage-percent">{usagePercentLabel}</span>
                  </button>

                  <div className="context-dual-tooltip">
                    <div className="context-dual-tooltip-title">上下文与用量</div>
                    <div className="context-dual-tooltip-grid">
                      <div className="context-dual-tooltip-kv">
                        <span className="context-dual-tooltip-key">Session usage</span>
                        <span className="context-dual-tooltip-value">{sessionUsageCompact}</span>
                      </div>
                      <div className="context-dual-tooltip-kv">
                        <span className="context-dual-tooltip-key">Context window</span>
                        <span className="context-dual-tooltip-value">{contextWindowCompact}</span>
                      </div>
                      <div className="context-dual-tooltip-kv">
                        <span className="context-dual-tooltip-key">Tab usage</span>
                        <span className="context-dual-tooltip-value">{tabUsageCompact}</span>
                      </div>
                      <div className="context-dual-tooltip-kv">
                        <span className="context-dual-tooltip-key">消息数量</span>
                        <span className="context-dual-tooltip-value">{messageCount}</span>
                      </div>
                    </div>
                    <div className="context-dual-tooltip-divider" />
                    <div className="context-dual-tooltip-foot">
                      <div className="context-dual-tooltip-note">
                        {contextWindowTokens
                          ? `百分比按当前 ${titleCaseCli(effectiveCli)} session usage 计算；发生 context compaction 或手动 reset 后会重新累计。`
                          : `${titleCaseCli(effectiveCli)} 当前未上报 context window，百分比已隐藏；session usage 仍会在 context compaction 或手动 reset 后重新累计。`}
                        </div>
                    </div>
                  </div>
                </div>
              </div>

              {onToggleStatusPanel ? (
                <div className="context-tools-right">
                  <button
                    type="button"
                    onClick={onToggleStatusPanel}
                    className={`context-tool-btn context-tool-btn--labeled status-panel-toggle ${statusPanelExpanded ? "expanded" : "collapsed"}`}
                    title={statusPanelExpanded ? "收起状态面板" : "展开状态面板"}
                  >
                    <span className="terminal-chat-status-icon">
                      <StatusPanelToggleIcon collapsed={!statusPanelExpanded} />
                    </span>
                    <span className="context-tool-label">状态面板</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
