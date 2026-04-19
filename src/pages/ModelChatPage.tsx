import {
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import { AssistantMessageContent } from "../components/chat/AssistantMessageContent";
import { SERVICE_ICONS } from "../components/modelProviders/ui";
import { bridge } from "../lib/bridge";
import {
  normalizeApiChatAttachments,
  normalizeApiChatGenerationMeta,
  normalizeApiChatMessage,
  normalizeApiChatSelection,
} from "../lib/apiChatFormatting";
import {
  createChatAttachment,
  formatAttachmentSummary,
} from "../lib/chatAttachments";
import {
  getEnabledProviderForServiceType,
  MODEL_PROVIDER_META,
  MODEL_PROVIDER_SERVICE_ORDER,
  normalizeProviderSettings,
} from "../lib/modelProviders";
import type {
  ApiChatGenerationMeta,
  ApiChatMessage,
  ApiChatSelection,
  ApiChatSession,
  AppSettings,
  ChatAttachment,
  ChatMessageBlock,
  ModelProviderConfig,
  ModelProviderModel,
  ModelProviderServiceType,
} from "../lib/models";

const STORAGE_KEY = "multi-cli-studio::api-chat-sessions";
const DEFAULT_MODEL_CHAT_CONTEXT_TURN_LIMIT = 4;

type PersistedChatState = {
  activeSessionId: string | null;
  sessions: ApiChatSession[];
};

type LiveApiStream = {
  sessionId: string;
  streamId: string;
  origin: ApiChatGenerationMeta;
  message: ApiChatMessage;
};

type ResolvedModelOption = {
  key: string;
  selection: ApiChatSelection;
  provider: ModelProviderConfig;
  model: ModelProviderModel;
  providerName: string;
  modelLabel: string;
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function truncate(value: string, maxChars = 42) {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

function isServiceType(value: unknown): value is ModelProviderServiceType {
  return value === "openaiCompatible" || value === "claude" || value === "gemini";
}

function selectionKey(selection: ApiChatSelection) {
  return `${selection.serviceType}::${selection.providerId}::${selection.modelId}`;
}

function deriveTitleFromMessages(messages: ApiChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user") ?? null;
  const firstUserText = firstUserMessage?.content ?? "";
  if (firstUserText.trim()) {
    return truncate(firstUserText, 30);
  }
  return formatAttachmentSummary(firstUserMessage?.attachments) || "New Chat";
}

function buildFallbackGenerationMeta(
  selection: ApiChatSelection | null | undefined
): ApiChatGenerationMeta | null {
  if (!selection) return null;
  return {
    ...selection,
    providerName: null,
    modelLabel: null,
    requestedAt: null,
    completedAt: null,
  };
}

function listAvailableModelOptions(settings: AppSettings): ResolvedModelOption[] {
  const options: ResolvedModelOption[] = [];
  for (const serviceType of MODEL_PROVIDER_SERVICE_ORDER) {
    const provider = getEnabledProviderForServiceType(settings, serviceType);
    if (!provider) continue;
    for (const model of provider.models) {
      const selection = {
        serviceType,
        providerId: provider.id,
        modelId: model.id,
      } satisfies ApiChatSelection;
      options.push({
        key: selectionKey(selection),
        selection,
        provider,
        model,
        providerName: provider.name,
        modelLabel: model.label?.trim() || model.name,
      });
    }
  }
  return options;
}

function getFirstAvailableSelection(settings: AppSettings) {
  return listAvailableModelOptions(settings)[0]?.selection ?? null;
}

function syncSelectionWithSettings(
  selection: ApiChatSelection | null | undefined,
  settings: AppSettings
): ApiChatSelection | null {
  if (!selection) {
    return getFirstAvailableSelection(settings);
  }
  const provider = getEnabledProviderForServiceType(settings, selection.serviceType);
  if (!provider || provider.models.length === 0) {
    return getFirstAvailableSelection(settings);
  }
  const model = provider.models.find((item) => item.id === selection.modelId) ?? provider.models[0];
  return {
    serviceType: selection.serviceType,
    providerId: provider.id,
    modelId: model.id,
  };
}

function resolveModelOption(
  settings: AppSettings,
  selection: ApiChatSelection | null | undefined
): ResolvedModelOption | null {
  if (!selection) return null;
  return (
    listAvailableModelOptions(settings).find((option) => option.key === selectionKey(selection)) ?? null
  );
}

function pickSelectionForServiceType(
  options: ResolvedModelOption[],
  serviceType: ModelProviderServiceType,
  preferredSelection?: ApiChatSelection | null
) {
  if (preferredSelection?.serviceType === serviceType) {
    const preferred = options.find(
      (option) => option.key === selectionKey(preferredSelection)
    );
    if (preferred) {
      return preferred.selection;
    }
  }
  return options.find((option) => option.selection.serviceType === serviceType)?.selection ?? null;
}

function hydrateGenerationMeta(
  settings: AppSettings,
  value: ApiChatGenerationMeta | null | undefined
): ApiChatGenerationMeta | null {
  const meta = normalizeApiChatGenerationMeta(value);
  if (!meta) return null;
  const option = resolveModelOption(settings, meta);
  return {
    ...meta,
    providerName: meta.providerName ?? option?.providerName ?? null,
    modelLabel: meta.modelLabel ?? option?.modelLabel ?? meta.modelId,
  };
}

function resolveLegacySelection(value: Partial<ApiChatSession>, settings: AppSettings) {
  const serviceType = isServiceType((value as { serviceType?: unknown }).serviceType)
    ? (value as { serviceType: ModelProviderServiceType }).serviceType
    : null;
  if (!serviceType) return null;
  const provider = getEnabledProviderForServiceType(settings, serviceType);
  const providerId =
    typeof (value as { providerId?: unknown }).providerId === "string" &&
    (value as { providerId: string }).providerId.trim()
      ? (value as { providerId: string }).providerId.trim()
      : provider?.id ?? "";
  const modelId =
    typeof (value as { modelId?: unknown }).modelId === "string" &&
    (value as { modelId: string }).modelId.trim()
      ? (value as { modelId: string }).modelId.trim()
      : provider?.models[0]?.id ?? "";
  if (!providerId || !modelId) return null;
  return syncSelectionWithSettings({ serviceType, providerId, modelId }, settings);
}

function normalizePersistedMessage(
  value: unknown,
  fallbackSelection: ApiChatSelection | null
): ApiChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ApiChatMessage>;
  if (raw.role !== "user" && raw.role !== "assistant" && raw.role !== "system") return null;
  if (typeof raw.content !== "string") return null;
  return normalizeApiChatMessage({
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : createId("api-msg"),
    role: raw.role,
    content: raw.content,
    timestamp:
      typeof raw.timestamp === "string" && raw.timestamp.trim()
        ? raw.timestamp
        : new Date().toISOString(),
    error: raw.error === true,
    attachments: normalizeApiChatAttachments((raw as { attachments?: unknown }).attachments),
    generationMeta:
      normalizeApiChatGenerationMeta(raw.generationMeta) ??
      buildFallbackGenerationMeta(fallbackSelection),
    rawContent: typeof raw.rawContent === "string" ? raw.rawContent : null,
    contentFormat:
      raw.contentFormat === "plain" || raw.contentFormat === "markdown" || raw.contentFormat === "log"
        ? raw.contentFormat
        : null,
    blocks: Array.isArray(raw.blocks) ? (raw.blocks as ChatMessageBlock[]) : null,
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : null,
    promptTokens: typeof raw.promptTokens === "number" ? raw.promptTokens : null,
    completionTokens: typeof raw.completionTokens === "number" ? raw.completionTokens : null,
    totalTokens: typeof raw.totalTokens === "number" ? raw.totalTokens : null,
  });
}

function syncSessionWithSettings(session: ApiChatSession, settings: AppSettings): ApiChatSession {
  return {
    ...session,
    defaultSelection: syncSelectionWithSettings(session.defaultSelection, settings),
  };
}

function normalizePersistedSession(
  value: unknown,
  settings: AppSettings
): ApiChatSession | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ApiChatSession>;
  const legacySelection = resolveLegacySelection(raw, settings);
  const defaultSelection = syncSelectionWithSettings(
    normalizeApiChatSelection((raw as { defaultSelection?: unknown }).defaultSelection) ??
      legacySelection,
    settings
  );
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map((message) => normalizePersistedMessage(message, legacySelection ?? defaultSelection))
        .filter(Boolean) as ApiChatMessage[]
    : [];

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : createId("api-session"),
    title:
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title
        : deriveTitleFromMessages(messages),
    defaultSelection,
    messages,
    createdAt:
      typeof raw.createdAt === "string" && raw.createdAt.trim()
        ? raw.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt.trim()
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}

function createSession(
  settings: AppSettings,
  preferredSelection?: ApiChatSelection | null
): ApiChatSession {
  return {
    id: createId("api-session"),
    title: "New Chat",
    defaultSelection: syncSelectionWithSettings(preferredSelection, settings),
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function loadPersistedChatState(settings: AppSettings): PersistedChatState {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const session = createSession(settings);
    return { activeSessionId: session.id, sessions: [session] };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedChatState>;
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions
          .map((session) => normalizePersistedSession(session, settings))
          .filter(Boolean) as ApiChatSession[]
      : [];
    if (sessions.length === 0) {
      const session = createSession(settings);
      return { activeSessionId: session.id, sessions: [session] };
    }
    return {
      activeSessionId:
        typeof parsed.activeSessionId === "string" &&
        sessions.some((session) => session.id === parsed.activeSessionId)
          ? parsed.activeSessionId
          : sessions[0].id,
      sessions,
    };
  } catch {
    const session = createSession(settings);
    return { activeSessionId: session.id, sessions: [session] };
  }
}

function persistChatState(state: PersistedChatState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatSessionTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getSessionAnchorMeta(session: ApiChatSession) {
  const lastTaggedMessage = [...session.messages]
    .reverse()
    .find((message) => normalizeApiChatGenerationMeta(message.generationMeta));
  return normalizeApiChatGenerationMeta(lastTaggedMessage?.generationMeta) ??
    buildFallbackGenerationMeta(session.defaultSelection) ??
    null;
}

function getSessionPreview(session: ApiChatSession, settings: AppSettings) {
  const previewMessage = [...session.messages]
    .reverse()
    .find((message) => {
      if (message.role === "system") return false;
      const normalized = normalizeApiChatMessage(message);
      return normalized.content.trim().length > 0 || (normalized.attachments?.length ?? 0) > 0;
    });
  if (previewMessage) {
    const normalized = normalizeApiChatMessage(previewMessage);
    if (normalized.content.trim()) {
      return truncate(normalized.content.replace(/\s+/g, " "), 58);
    }
    return formatAttachmentSummary(normalized.attachments) || "等待第一条消息";
  }
  const origin = hydrateGenerationMeta(settings, getSessionAnchorMeta(session));
  return origin
    ? `${origin.providerName ?? MODEL_PROVIDER_META[origin.serviceType].shortLabel} · ${origin.modelLabel ?? origin.modelId}`
    : "等待第一条消息";
}

function buildReplayHistory(
  messages: ApiChatMessage[],
  turnLimit = DEFAULT_MODEL_CHAT_CONTEXT_TURN_LIMIT
) {
  const normalizedMessages = messages
    .map((message) => {
      const normalized = normalizeApiChatMessage(message);
      if (normalized.error) return null;
      const content = normalized.content.trim();
      const attachments = normalized.attachments ?? null;
      if (!content && !attachments?.length) return null;
      return {
        id: normalized.id,
        role: normalized.role,
        content,
        attachments,
        timestamp: normalized.timestamp,
      } satisfies ApiChatMessage;
    })
    .filter(Boolean) as ApiChatMessage[];

  const systemMessages = normalizedMessages.filter((message) => message.role === "system");
  const conversationMessages = normalizedMessages.filter((message) => message.role !== "system");
  const normalizedTurnLimit =
    Number.isFinite(turnLimit) && turnLimit > 0 ? Math.floor(turnLimit) : DEFAULT_MODEL_CHAT_CONTEXT_TURN_LIMIT;

  if (conversationMessages.length === 0) {
    return systemMessages;
  }

  let userTurnCount = 0;
  let startIndex = 0;

  for (let index = conversationMessages.length - 1; index >= 0; index -= 1) {
    if (conversationMessages[index].role !== "user") continue;
    userTurnCount += 1;
    if (userTurnCount === normalizedTurnLimit) {
      startIndex = index;
      break;
    }
  }

  const trimmedConversation =
    userTurnCount < normalizedTurnLimit
      ? conversationMessages
      : conversationMessages.slice(startIndex);

  return [...systemMessages, ...trimmedConversation];
}

function SidebarPrimaryButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-[#151515] px-4 py-3 text-sm font-medium text-white transition-all hover:-translate-y-[1px] hover:bg-black"
    >
      {children}
    </button>
  );
}

function SidebarGhostButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-[12px] px-3 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-white hover:text-slate-900"
    >
      {children}
    </button>
  );
}

function HeaderIconButton({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-[#e6e2d8] bg-white/90 text-slate-500 transition-all hover:-translate-y-[1px] hover:border-[#d8d3c7] hover:text-slate-900"
    >
      {children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M20 11a8 8 0 10-2.3 5.6M20 11V5m0 6h-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M5 7h14M10 11v6M14 11v6M9 4h6l1 3H8l1-3z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 7l.8 11a2 2 0 002 1.9h2.4a2 2 0 002-1.9L17 7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M5 12.5L19 5l-3.8 14-4.3-4.9-5.9-1.6z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19.4 15a1 1 0 00.2 1.1l.1.1a1.7 1.7 0 01-1.2 2.9h-.2a1 1 0 00-.9.6l-.1.2a1.7 1.7 0 01-3.2 0l-.1-.2a1 1 0 00-.9-.6h-.2a1.7 1.7 0 01-1.2-2.9l.1-.1a1 1 0 00.2-1.1 1 1 0 00-.8-.5h-.2a1.7 1.7 0 010-3.4h.2a1 1 0 00.8-.5 1 1 0 00-.2-1.1l-.1-.1a1.7 1.7 0 011.2-2.9h.2a1 1 0 00.9-.6l.1-.2a1.7 1.7 0 013.2 0l.1.2a1 1 0 00.9.6h.2a1.7 1.7 0 011.2 2.9l-.1.1a1 1 0 00-.2 1.1 1 1 0 00.8.5h.2a1.7 1.7 0 010 3.4h-.2a1 1 0 00-.8.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <rect x="8" y="8" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M6 14H5a2 2 0 01-2-2V5a2 2 0 012-2h7a2 2 0 012 2v1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 8v4l2.5 1.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TokenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
      <path
        d="M7 7h10M7 12h10M7 17h6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cx("h-4 w-4 transition-transform", expanded && "rotate-180")}
    >
      <path
        d="M7 10l5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M6.5 12.5l3.3 3.3L17.5 8"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d={collapsed ? "M10 7l5 5-5 5" : "M14 7l-5 5 5 5"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatDuration(value?: number | null) {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 10000) return `${(value / 1000).toFixed(1)}s`;
  if (value < 60000) return `${Math.round(value / 1000)}s`;
  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatTokenUsage(message: ApiChatMessage) {
  const total = message.totalTokens ?? null;
  const prompt = message.promptTokens ?? null;
  const completion = message.completionTokens ?? null;
  if (total == null && prompt == null && completion == null) return null;
  const display =
    total ??
    [prompt, completion]
      .filter((value) => value != null)
      .reduce((sum, value) => sum + (value ?? 0), 0);
  const title =
    prompt != null || completion != null
      ? `Prompt ${prompt ?? 0} · Completion ${completion ?? 0} · Total ${display}`
      : `Total ${display}`;
  return {
    display: `${display} tok`,
    title,
  };
}

function attachmentLabel(attachment: ChatAttachment) {
  return attachment.displayPath?.trim() || attachment.fileName;
}

function attachmentPreviewSrc(attachment: ChatAttachment) {
  if (attachment.source.startsWith("data:")) return attachment.source;
  if (attachment.source.startsWith("http://") || attachment.source.startsWith("https://")) {
    return attachment.source;
  }
  if (attachment.kind !== "image") return "";
  try {
    return convertFileSrc(attachment.source);
  } catch {
    return "";
  }
}

function describeUiError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // ignore stringify failure
    }
  }
  return fallback;
}

function MessageMetaPill({
  icon,
  text,
  title,
}: {
  icon: ReactNode;
  text: string;
  title?: string;
}) {
  return (
    <div
      title={title}
      className="inline-flex items-center gap-1.5 rounded-[12px] bg-[#f4f4f1] px-2.5 py-1 text-[11px] font-medium text-slate-500"
    >
      <span className="text-slate-400">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function MessageActionIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-slate-400 transition-all hover:border-slate-300 hover:text-slate-700"
    >
      {children}
    </button>
  );
}

function ApiReasoningBlock({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const showToggle = useMemo(() => {
    const lineCount = text.split("\n").filter((line) => line.trim().length > 0).length;
    return lineCount > 2 || text.trim().length > 140 || isStreaming;
  }, [isStreaming, text]);

  return (
    <div className="rounded-[12px] border border-amber-200/80 bg-[linear-gradient(180deg,#fffdf7_0%,#fff9eb_100%)] px-4 py-3.5 shadow-[0_12px_30px_rgba(120,53,15,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
          <span className="inline-flex h-2 w-2 rounded-[12px] bg-amber-400" />
          Reasoning
        </div>
        {showToggle ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            title={expanded ? "收起推理" : "展开推理"}
            aria-label={expanded ? "收起推理" : "展开推理"}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[12px] border border-amber-200 bg-white/80 text-amber-700 transition-all hover:bg-white"
          >
            <ChevronIcon expanded={expanded} />
          </button>
        ) : null}
      </div>
      <div
        className={cx(
          "mt-3 whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-amber-950",
          !expanded && "line-clamp-2"
        )}
      >
        {text}
        {isStreaming ? (
          <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-[12px] bg-amber-500 align-[-2px]" />
        ) : null}
      </div>
    </div>
  );
}

function MessageOriginPill({ origin }: { origin: ApiChatGenerationMeta }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-[12px] border border-[#e7e1d6] bg-[#f8f5ee] px-3 py-1.5 text-[11px] font-medium text-slate-600">
      <img
        src={SERVICE_ICONS[origin.serviceType]}
        alt=""
        className="h-3.5 w-3.5 shrink-0 object-contain"
      />
      <span>{origin.providerName ?? MODEL_PROVIDER_META[origin.serviceType].shortLabel}</span>
      <span className="text-slate-300">/</span>
      <span>{origin.modelLabel ?? origin.modelId}</span>
    </div>
  );
}

function ServiceTypeSwitch({
  serviceType,
  active,
  disabled,
  onClick,
}: {
  serviceType: ModelProviderServiceType;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={MODEL_PROVIDER_META[serviceType].label}
      aria-label={MODEL_PROVIDER_META[serviceType].label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex h-8 w-8 items-center justify-center rounded-[12px] border transition-all disabled:cursor-not-allowed disabled:opacity-45",
        active
          ? "border-white bg-white text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.10)]"
          : "border-transparent bg-transparent text-slate-500 hover:bg-white/70 hover:text-slate-800"
      )}
    >
      <img
        src={SERVICE_ICONS[serviceType]}
        alt=""
        className="h-4 w-4 shrink-0 object-contain"
      />
    </button>
  );
}

function ModelSelectionControl({
  optionGroups,
  activeSelection,
  activeSelectionOrigin,
  onSelectServiceType,
  onSelectModel,
  className,
}: {
  optionGroups: Array<{
    serviceType: ModelProviderServiceType;
    options: ResolvedModelOption[];
  }>;
  activeSelection: ApiChatSelection | null;
  activeSelectionOrigin: ApiChatGenerationMeta | null;
  onSelectServiceType: (serviceType: ModelProviderServiceType) => void;
  onSelectModel: (selection: ApiChatSelection) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeServiceType = activeSelection?.serviceType ?? optionGroups[0]?.serviceType ?? null;
  const activeGroup =
    optionGroups.find((group) => group.serviceType === activeServiceType) ?? optionGroups[0] ?? null;
  const activeServiceModels = activeGroup?.options ?? [];
  const activeOption =
    activeServiceModels.find(
      (option) => activeSelection && option.key === selectionKey(activeSelection)
    ) ?? activeServiceModels[0] ?? null;

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (!open) return;
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    setOpen(false);
  }, [activeSelection?.serviceType, activeSelection?.providerId, activeSelection?.modelId]);

  return (
    <div
      ref={containerRef}
      className={cx(
        "relative flex items-center gap-2 rounded-[12px] border border-[#e7e1d5] bg-[linear-gradient(180deg,#fffdfa_0%,#f8f4eb_100%)] p-2 shadow-[0_10px_30px_rgba(15,23,42,0.06)]",
        className
      )}
    >
      <div className="flex shrink-0 items-center gap-1 rounded-[12px] border border-[#ebe5da] bg-white/90 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
        {MODEL_PROVIDER_SERVICE_ORDER.map((serviceType) => (
          <ServiceTypeSwitch
            key={serviceType}
            serviceType={serviceType}
            active={activeSelection?.serviceType === serviceType}
            disabled={!optionGroups.some((group) => group.serviceType === serviceType)}
            onClick={() => onSelectServiceType(serviceType)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={!activeGroup || activeServiceModels.length === 0}
        className={cx(
          "group flex min-w-0 flex-1 items-center gap-3 rounded-[12px] border border-[#ebe4d8] bg-white/88 px-3 py-2 text-left transition-all",
          "hover:border-[#ddd4c5] hover:bg-white",
          "disabled:cursor-not-allowed disabled:opacity-45"
        )}
        title={activeOption ? `${activeOption.providerName} / ${activeOption.modelLabel}` : "No models"}
        aria-label={activeOption ? `${activeOption.providerName} / ${activeOption.modelLabel}` : "No models"}
      >
        {activeSelectionOrigin ? (
          <img
            src={SERVICE_ICONS[activeSelectionOrigin.serviceType]}
            alt=""
            className="h-4.5 w-4.5 shrink-0 object-contain"
          />
        ) : (
          <div className="h-4.5 w-4.5 shrink-0 rounded-[12px] bg-slate-200" />
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            {activeOption?.providerName ?? "No provider"}
          </div>
          <div className="truncate text-[13px] font-semibold text-slate-800">
            {activeOption?.modelLabel ?? "No models"}
          </div>
        </div>

        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[12px] bg-[#f7f4ed] text-slate-500 transition-all group-hover:bg-[#f2eee5] group-hover:text-slate-800">
          <ChevronIcon expanded={open} />
        </div>
      </button>

      {open && activeGroup ? (
        <div className="absolute left-2 right-2 top-[calc(100%+10px)] z-30 overflow-hidden rounded-[12px] border border-[#e5ddcf] bg-[linear-gradient(180deg,#fffdf9_0%,#faf6ef_100%)] shadow-[0_24px_60px_rgba(15,23,42,0.14)]">
          <div className="border-b border-[#ece4d7] px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              <img
                src={SERVICE_ICONS[activeGroup.serviceType]}
                alt=""
                className="h-4 w-4 object-contain"
              />
              <span>{MODEL_PROVIDER_META[activeGroup.serviceType].label}</span>
            </div>
          </div>
          <div className="max-h-[280px] overflow-y-auto p-2">
            {activeGroup.options.map((option) => {
              const selected = activeSelection
                ? option.key === selectionKey(activeSelection)
                : false;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    onSelectModel(option.selection);
                    setOpen(false);
                  }}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-[12px] px-3 py-3 text-left transition-all",
                    selected
                      ? "bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
                      : "text-slate-600 hover:bg-white/82 hover:text-slate-900"
                  )}
                >
                  <div
                    className={cx(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border",
                      selected
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-[#e6dfd3] bg-[#f6f2ea] text-slate-500"
                    )}
                  >
                    {selected ? <CheckIcon /> : <img src={SERVICE_ICONS[option.selection.serviceType]} alt="" className="h-4 w-4 object-contain" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-current">
                      {option.modelLabel}
                    </div>
                    <div className="truncate text-[11px] text-slate-400">
                      {option.providerName}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UserMessageBubble({
  message,
  origin,
  onCopy,
  onDelete,
}: {
  message: ApiChatMessage;
  origin: ApiChatGenerationMeta | null;
  onCopy?: () => void;
  onDelete?: () => void;
}) {
  const attachments = message.attachments ?? [];
  const hasText = message.content.trim().length > 0;

  return (
    <div className="flex justify-end">
      <div className="flex max-w-[78%] flex-col items-end">
        {origin ? (
          <div className="mb-2 flex justify-end">
            <MessageOriginPill origin={origin} />
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="mb-3 flex max-w-full flex-wrap justify-end gap-2">
            {attachments.map((attachment) => {
              const label = attachmentLabel(attachment);
              if (attachment.kind === "image") {
                const previewSrc = attachmentPreviewSrc(attachment);
                return (
                  <div
                    key={attachment.id}
                    className="overflow-hidden rounded-[16px] border border-slate-200/85 bg-white shadow-[0_14px_28px_rgba(15,23,42,0.08)]"
                    title={label}
                  >
                    {previewSrc ? (
                      <img
                        src={previewSrc}
                        alt={attachment.fileName}
                        className="h-28 w-28 object-cover"
                      />
                    ) : (
                      <div className="flex h-28 w-28 items-center justify-center bg-slate-100 text-slate-400">
                        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
                          <path d="M5 7.5A2.5 2.5 0 017.5 5h9A2.5 2.5 0 0119 7.5v9a2.5 2.5 0 01-2.5 2.5h-9A2.5 2.5 0 015 16.5v-9z" stroke="currentColor" strokeWidth="1.6" />
                          <path d="M8 15l2.6-2.8a1 1 0 011.5.04L14 14l1.1-1.2a1 1 0 011.47-.02L18 14.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          <circle cx="9" cy="9" r="1.2" fill="currentColor" />
                        </svg>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 px-2.5 py-2 text-[11px] text-slate-600">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                        <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden="true">
                          <path d="M5 7.5A2.5 2.5 0 017.5 5h9A2.5 2.5 0 0119 7.5v9a2.5 2.5 0 01-2.5 2.5h-9A2.5 2.5 0 015 16.5v-9z" stroke="currentColor" strokeWidth="1.6" />
                          <path d="M8 15l2.6-2.8a1 1 0 011.5.04L14 14l1.1-1.2a1 1 0 011.47-.02L18 14.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          <circle cx="9" cy="9" r="1.2" fill="currentColor" />
                        </svg>
                      </span>
                      <span className="max-w-[108px] truncate">{label}</span>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={attachment.id}
                  className="inline-flex max-w-[280px] items-center gap-2 rounded-[16px] border border-slate-200/85 bg-white px-3 py-2 text-xs text-slate-700 shadow-[0_14px_28px_rgba(15,23,42,0.06)]"
                  title={label}
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-slate-100 text-slate-500">
                    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                      <path d="M8 4.5h6l4 4v10A1.5 1.5 0 0116.5 20h-9A1.5 1.5 0 016 18.5v-12A2 2 0 018 4.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      <path d="M14 4.5V9h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="truncate">{label}</span>
                </div>
              );
            })}
          </div>
        ) : null}
        {hasText ? (
          <div className="inline-block max-w-full rounded-[12px] bg-white px-4 py-2.5 text-[15px] leading-6 text-slate-800 shadow-[0_10px_32px_rgba(15,23,42,0.06)] ring-1 ring-black/5 whitespace-pre-wrap break-words">
            {message.content}
          </div>
        ) : null}
        {onCopy || onDelete ? (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {onCopy && hasText ? (
              <MessageActionIconButton title="复制消息" onClick={onCopy}>
                <CopyIcon />
              </MessageActionIconButton>
            ) : null}
            {onDelete ? (
              <MessageActionIconButton title="删除消息" onClick={onDelete}>
                <TrashIcon />
              </MessageActionIconButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ApiAssistantBlocks({
  message,
  origin,
  isStreaming,
  onRegenerate,
  onCopy,
  onDelete,
}: {
  message: ApiChatMessage;
  origin: ApiChatGenerationMeta | null;
  isStreaming: boolean;
  onRegenerate?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
}) {
  const normalized = normalizeApiChatMessage(message);
  const durationLabel = formatDuration(normalized.durationMs);
  const tokenUsage = formatTokenUsage(normalized);
  const blocks =
    normalized.blocks && normalized.blocks.length > 0
      ? normalized.blocks
      : normalized.content.trim()
        ? [
            {
              kind: "text",
              text: normalized.content,
              format: normalized.contentFormat ?? "plain",
            } satisfies ChatMessageBlock,
          ]
        : [];

  return (
    <div className="w-full max-w-[860px]">
      {origin ? (
        <div className="mb-4 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
          <img src={SERVICE_ICONS[origin.serviceType]} alt="" className="h-4 w-4 object-contain" />
          <span>{origin.providerName ?? MODEL_PROVIDER_META[origin.serviceType].shortLabel}</span>
          <span className="text-slate-300">·</span>
          <span>{origin.modelLabel ?? origin.modelId}</span>
          {isStreaming ? (
            <>
              <span className="text-slate-300">·</span>
              <span className="text-sky-600">Streaming</span>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-4">
        {blocks.map((block, index) => {
          if (block.kind === "reasoning") {
            return (
              <ApiReasoningBlock
                key={`${message.id}-reasoning-${index}`}
                text={block.text}
                isStreaming={isStreaming}
              />
            );
          }

          if (block.kind === "text") {
            return (
              <div
                key={`${message.id}-text-${index}`}
                className={cx(
                  "text-[15px] leading-8 text-slate-800",
                  message.error &&
                    "rounded-[12px] border border-rose-200 bg-rose-50 px-5 py-4 text-rose-700"
                )}
              >
                <AssistantMessageContent
                  content={block.text}
                  rawContent={block.text}
                  contentFormat={block.format}
                  isStreaming={isStreaming}
                  renderMode="rich"
                />
              </div>
            );
          }

          return null;
        })}

        {blocks.length === 0 && isStreaming ? (
          <div className="rounded-[12px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm ring-1 ring-black/5">
            Thinking…
          </div>
        ) : null}

        {!isStreaming ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {durationLabel ? (
              <MessageMetaPill icon={<ClockIcon />} text={durationLabel} title="响应时长" />
            ) : null}
            {tokenUsage ? (
              <MessageMetaPill
                icon={<TokenIcon />}
                text={tokenUsage.display}
                title={tokenUsage.title}
              />
            ) : null}
            {onRegenerate ? (
              <MessageActionIconButton title="重新生成" onClick={onRegenerate}>
                <RefreshIcon />
              </MessageActionIconButton>
            ) : null}
            {onCopy ? (
              <MessageActionIconButton title="复制消息" onClick={onCopy}>
                <CopyIcon />
              </MessageActionIconButton>
            ) : null}
            {onDelete ? (
              <MessageActionIconButton title="删除消息" onClick={onDelete}>
                <TrashIcon />
              </MessageActionIconButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ModelChatPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sessions, setSessions] = useState<ApiChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>({});
  const [composerAttachments, setComposerAttachments] = useState<Record<string, ChatAttachment[]>>({});
  const [loading, setLoading] = useState(false);
  const [liveStream, setLiveStream] = useState<LiveApiStream | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextSettings = normalizeProviderSettings(await bridge.getSettings());
        if (cancelled) return;
        const persisted = loadPersistedChatState(nextSettings);
        setSettings(nextSettings);
        setSessions(persisted.sessions);
        setActiveSessionId(persisted.activeSessionId);
      } catch (error) {
        if (cancelled) return;
        setErrorText(describeUiError(error, "加载模型对话配置失败。"));
      } finally {
        if (!cancelled) {
          setLoadingSettings(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settings || !sessions.length || !activeSessionId) return;
    persistChatState({ sessions, activeSessionId });
  }, [activeSessionId, sessions, settings]);

  useEffect(() => {
    let cancelled = false;
    let unlisten = () => {};
    bridge
      .onApiChatStream((event) => {
        if (cancelled) return;
        setLiveStream((current) => {
          if (!current || current.streamId !== event.streamId) {
            return current;
          }
          return {
            ...current,
            message: normalizeApiChatMessage({
              ...current.message,
              id: event.messageId || current.message.id,
              content: event.content ?? current.message.content,
              rawContent: event.rawContent ?? current.message.rawContent ?? current.message.content,
              contentFormat: event.contentFormat ?? current.message.contentFormat ?? null,
              blocks: event.blocks ?? current.message.blocks ?? null,
              durationMs: event.durationMs ?? current.message.durationMs ?? null,
              promptTokens: event.promptTokens ?? current.message.promptTokens ?? null,
              completionTokens: event.completionTokens ?? current.message.completionTokens ?? null,
              totalTokens: event.totalTokens ?? current.message.totalTokens ?? null,
            }),
          };
        });
      })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      });

    return () => {
      cancelled = true;
      unlisten();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [sessions, activeSessionId, loading, liveStream]);

  useEffect(() => {
    if (!statusText) return;
    const timer = window.setTimeout(() => {
      setStatusText((current) => (current === statusText ? null : current));
    }, 3000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [statusText]);

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  const availableOptions = useMemo(
    () => (settings ? listAvailableModelOptions(settings) : []),
    [settings]
  );
  const optionGroups = useMemo(
    () =>
      MODEL_PROVIDER_SERVICE_ORDER.map((serviceType) => ({
        serviceType,
        options: availableOptions.filter((option) => option.selection.serviceType === serviceType),
      })).filter((group) => group.options.length > 0),
    [availableOptions]
  );
  const activeDraft = activeSession ? composerDrafts[activeSession.id] ?? "" : "";
  const activeAttachments = activeSession ? composerAttachments[activeSession.id] ?? [] : [];
  const activeSelection =
    settings && activeSession
      ? syncSelectionWithSettings(activeSession.defaultSelection, settings)
      : null;
  const activeSelectionOption =
    settings && activeSelection ? resolveModelOption(settings, activeSelection) : null;
  const activeSelectionOrigin =
    settings && activeSelection
      ? hydrateGenerationMeta(settings, {
          ...activeSelection,
          providerName: activeSelectionOption?.providerName ?? null,
          modelLabel: activeSelectionOption?.modelLabel ?? null,
          requestedAt: null,
          completedAt: null,
        })
      : null;
  const activeStreamMessage =
    liveStream && activeSession && liveStream.sessionId === activeSession.id
      ? liveStream.message
      : null;
  const anyProviderEnabled = availableOptions.length > 0;

  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(Math.max(node.scrollHeight, 28), 180)}px`;
  }, [activeDraft, activeSessionId]);

  function updateSession(
    sessionId: string,
    updater: (session: ApiChatSession) => ApiChatSession
  ) {
    setSessions((current) =>
      current.map((session) => (session.id === sessionId ? updater(session) : session))
    );
  }

  function deleteMessage(sessionId: string, messageId: string) {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              messages: session.messages.filter((message) => message.id !== messageId),
              updatedAt: new Date().toISOString(),
            }
          : session
      )
    );
    setStatusText("消息已删除。");
    setErrorText(null);
  }

  async function copyMessage(message: ApiChatMessage) {
    try {
      await navigator.clipboard.writeText(normalizeApiChatMessage(message).content);
      setStatusText("消息已复制。");
      setErrorText(null);
    } catch (error) {
      setErrorText(describeUiError(error, "复制消息失败。"));
    }
  }

  function selectModel(selection: ApiChatSelection) {
    if (!activeSession) return;
    updateSession(activeSession.id, (session) => ({
      ...session,
      defaultSelection: selection,
      updatedAt: new Date().toISOString(),
    }));
    setStatusText(null);
    setErrorText(null);
  }

  function selectServiceType(serviceType: ModelProviderServiceType) {
    const nextSelection = pickSelectionForServiceType(
      availableOptions,
      serviceType,
      activeSelection
    );
    if (nextSelection) {
      selectModel(nextSelection);
    }
  }

  async function refreshSettings() {
    setErrorText(null);
    setStatusText(null);
    try {
      const nextSettings = normalizeProviderSettings(await bridge.getSettings());
      setSettings(nextSettings);
      setSessions((current) =>
        current.map((session) => syncSessionWithSettings(session, nextSettings))
      );
      setStatusText("已同步最新 provider 配置。");
    } catch (error) {
      setErrorText(describeUiError(error, "刷新 provider 配置失败。"));
    }
  }

  async function pickComposerAttachments() {
    if (!activeSession || loading) return;
    setErrorText(null);
    setStatusText(null);
    try {
      const picked = await bridge.pickChatAttachments();
      const prepared = picked
        .map((item) => createChatAttachment(item, null))
        .filter(Boolean) as ChatAttachment[];
      if (prepared.length === 0) {
        return;
      }
      const images = prepared.filter((attachment) => attachment.kind === "image");
      if (images.length === 0) {
        setErrorText("Model Chat 当前先只支持图片附件。");
        return;
      }
      if (images.length !== prepared.length) {
        setStatusText("已忽略非图片附件，仅保留图片。");
      }
      setComposerAttachments((current) => {
        const existing = current[activeSession.id] ?? [];
        const seen = new Set(existing.map((attachment) => attachment.source));
        const merged = [...existing];
        images.forEach((attachment) => {
          if (seen.has(attachment.source)) return;
          seen.add(attachment.source);
          merged.push(attachment);
        });
        return {
          ...current,
          [activeSession.id]: merged,
        };
      });
    } catch (error) {
      setErrorText(describeUiError(error, "选择附件失败。"));
    }
  }

  function removeComposerAttachment(attachmentId: string) {
    if (!activeSession) return;
    setComposerAttachments((current) => ({
      ...current,
      [activeSession.id]: (current[activeSession.id] ?? []).filter(
        (attachment) => attachment.id !== attachmentId
      ),
    }));
  }

  function createChatSession() {
    if (!settings) return;
    const session = createSession(settings, activeSession?.defaultSelection ?? activeSelection);
    setSessions((current) => [session, ...current]);
    setActiveSessionId(session.id);
    setComposerDrafts((current) => ({ ...current, [session.id]: "" }));
    setStatusText(null);
    setErrorText(null);
  }

  function deleteSession(sessionId: string) {
    setSessions((current) => {
      const nextSessions = current.filter((session) => session.id !== sessionId);
      if (nextSessions.length === 0 && settings) {
        const session = createSession(settings, activeSelection);
        setActiveSessionId(session.id);
        return [session];
      }
      if (activeSessionId === sessionId) {
        setActiveSessionId(nextSessions[0]?.id ?? null);
      }
      return nextSessions;
    });
    setComposerDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[sessionId];
      return nextDrafts;
    });
    setComposerAttachments((current) => {
      const nextAttachments = { ...current };
      delete nextAttachments[sessionId];
      return nextAttachments;
    });
    setLiveStream((current) => (current?.sessionId === sessionId ? null : current));
  }

  async function requestAssistantResponse({
    session,
    selection,
    origin,
    persistedMessages,
    requestMessages,
    title,
    successStatusText,
  }: {
    session: ApiChatSession;
    selection: ApiChatSelection;
    origin: ApiChatGenerationMeta;
    persistedMessages: ApiChatMessage[];
    requestMessages: ApiChatMessage[];
    title: string;
    successStatusText?: string | null;
  }) {
    if (loading) return;
    const streamId = createId("api-stream");
    const requestedAt = new Date().toISOString();

    flushSync(() => {
      updateSession(session.id, (currentSession) => ({
        ...currentSession,
        title,
        defaultSelection: selection,
        messages: persistedMessages,
        updatedAt: new Date().toISOString(),
      }));
      setLoading(true);
      setLiveStream({
        sessionId: session.id,
        streamId,
        origin,
        message: {
          id: createId("api-msg"),
          role: "assistant",
          content: "",
          rawContent: "",
          timestamp: requestedAt,
          generationMeta: origin,
          blocks: [],
          durationMs: null,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
      });
      setErrorText(null);
      setStatusText(null);
    });

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });

    try {
      const response = await bridge.sendApiChatMessage({
        selection,
        messages: requestMessages,
        streamId,
      });
      const normalizedMessage = normalizeApiChatMessage({
        ...response.message,
        generationMeta:
          normalizeApiChatGenerationMeta(response.message.generationMeta) ?? {
            ...origin,
            completedAt: new Date().toISOString(),
          },
      });
      updateSession(session.id, (currentSession) => ({
        ...currentSession,
        title,
        defaultSelection: selection,
        messages: [...persistedMessages, normalizedMessage],
        updatedAt: new Date().toISOString(),
      }));
      setLiveStream((current) => (current?.streamId === streamId ? null : current));
      if (successStatusText) {
        setStatusText(successStatusText);
      }
    } catch (error) {
      const message =
        describeUiError(error, "模型响应失败，请检查 provider 配置。");
      const errorMessage = normalizeApiChatMessage({
        id: createId("api-error"),
        role: "assistant",
        content: message,
        rawContent: message,
        timestamp: new Date().toISOString(),
        error: true,
        generationMeta: {
          ...origin,
          completedAt: new Date().toISOString(),
        },
      });
      updateSession(session.id, (currentSession) => ({
        ...currentSession,
        title,
        defaultSelection: selection,
        messages: [...persistedMessages, errorMessage],
        updatedAt: new Date().toISOString(),
      }));
      setLiveStream((current) => (current?.streamId === streamId ? null : current));
      setErrorText(message);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!settings || !activeSession || !activeSelection || !activeSelectionOption || loading) return;
    const content = activeDraft.trim();
    const attachments = activeAttachments;
    if (!content && attachments.length === 0) return;
    const requestedAt = new Date().toISOString();

    const origin: ApiChatGenerationMeta = {
      ...activeSelection,
      providerName: activeSelectionOption.providerName,
      modelLabel: activeSelectionOption.modelLabel,
      requestedAt,
      completedAt: null,
    };

    const userMessage: ApiChatMessage = {
      id: createId("api-user"),
      role: "user",
      content,
      attachments,
      timestamp: requestedAt,
      generationMeta: origin,
    };

    const nextMessages = [...activeSession.messages, userMessage];
    const requestMessages = buildReplayHistory(
      nextMessages,
      settings.modelChatContextTurnLimit
    );
    const nextTitle =
      activeSession.messages.length === 0 && activeSession.title === "New Chat"
        ? deriveTitleFromMessages(nextMessages)
        : activeSession.title;

    setComposerDrafts((current) => ({ ...current, [activeSession.id]: "" }));
    setComposerAttachments((current) => ({ ...current, [activeSession.id]: [] }));
    await requestAssistantResponse({
      session: activeSession,
      selection: activeSelection,
      origin,
      persistedMessages: nextMessages,
      requestMessages,
      title: nextTitle,
    });
  }

  function canRegenerateAssistantMessage(session: ApiChatSession, messageId: string) {
    if (loading || activeStreamMessage) return false;
    const index = session.messages.findIndex((message) => message.id === messageId);
    if (index === -1) return false;
    const target = session.messages[index];
    if (target.role !== "assistant") return false;
    return index === session.messages.length - 1;
  }

  async function regenerateAssistantMessage(session: ApiChatSession, messageId: string) {
    if (loading) return;
    const index = session.messages.findIndex((message) => message.id === messageId);
    if (index === -1) return;
    const target = session.messages[index];
    if (target.role !== "assistant" || index !== session.messages.length - 1) return;
    const selection =
      normalizeApiChatGenerationMeta(target.generationMeta) ??
      buildFallbackGenerationMeta(session.defaultSelection);
    if (!selection) {
      setErrorText("无法确定这条消息原本使用的模型。");
      return;
    }
    const option = settings ? resolveModelOption(settings, selection) : null;
    const previousMessages = session.messages.slice(0, index);
    const requestMessages = buildReplayHistory(
      previousMessages,
      settings?.modelChatContextTurnLimit
    );
    const origin: ApiChatGenerationMeta = {
      ...selection,
      providerName:
        option?.providerName ?? target.generationMeta?.providerName ?? MODEL_PROVIDER_META[selection.serviceType].shortLabel,
      modelLabel: option?.modelLabel ?? target.generationMeta?.modelLabel ?? selection.modelId,
      requestedAt: new Date().toISOString(),
      completedAt: null,
    };
    await requestAssistantResponse({
      session,
      selection,
      origin,
      persistedMessages: previousMessages,
      requestMessages,
      title: session.title,
      successStatusText: "已重新生成回复。",
    });
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (loading) return;
    void sendMessage();
  }

  if (loadingSettings) {
    return (
      <div className="flex h-full items-center justify-center bg-[#f7f7f5]">
        <div className="rounded-[12px] border border-[#e5e1d7] bg-white px-5 py-2 text-sm text-slate-500 shadow-sm">
          正在加载模型对话...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden bg-[#f7f7f5] text-slate-900">
      <div
        className={cx(
          "grid h-full min-h-0",
          sidebarCollapsed
            ? "grid-cols-[84px_minmax(0,1fr)]"
            : "grid-cols-1 xl:grid-cols-[296px_minmax(0,1fr)]"
        )}
      >
        <aside
          className={cx(
            "flex min-h-0 flex-col border-r border-[#e7e4dd] bg-[#f6f5f2]",
            sidebarCollapsed && "items-center"
          )}
        >
          {sidebarCollapsed ? (
            <>
              <div className="px-3 pb-4 pt-4">
                <button
                  type="button"
                  title="展开侧边栏"
                  aria-label="展开侧边栏"
                  onClick={() => setSidebarCollapsed(false)}
                  className="group relative inline-flex h-11 w-11 items-center justify-center rounded-[14px] bg-white shadow-sm ring-1 ring-black/5 transition-all hover:-translate-y-[1px] hover:shadow-md"
                >
                  <img
                    src={activeSelectionOrigin ? SERVICE_ICONS[activeSelectionOrigin.serviceType] : SERVICE_ICONS.openaiCompatible}
                    alt=""
                    className="h-[18px] w-[18px] object-contain transition-all duration-150 group-hover:scale-90 group-hover:opacity-0 group-focus-visible:scale-90 group-focus-visible:opacity-0"
                  />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-600 opacity-0 transition-all duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span className="transition-transform duration-150 group-hover:scale-100 group-focus-visible:scale-100 scale-90">
                      <SidebarToggleIcon collapsed />
                    </span>
                  </span>
                </button>
              </div>

              <div className="flex-1" />

              <div className="flex flex-col items-center gap-2 border-t border-[#ece7dc] px-3 py-3">
                <HeaderIconButton title="新聊天" onClick={createChatSession}>
                  <PlusIcon />
                </HeaderIconButton>
                <HeaderIconButton title="刷新配置" onClick={() => void refreshSettings()}>
                  <RefreshIcon />
                </HeaderIconButton>
                <Link
                  to="/settings/model-providers"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-[#e6e2d8] bg-white/90 text-slate-500 transition-all hover:-translate-y-[1px] hover:border-[#d8d3c7] hover:text-slate-900"
                  title="模型提供商"
                  aria-label="模型提供商"
                >
                  <SettingsIcon />
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="px-4 pb-5 pt-4">
                <div className="flex items-center justify-between gap-3 px-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-white shadow-sm ring-1 ring-black/5">
                    <img
                      src={activeSelectionOrigin ? SERVICE_ICONS[activeSelectionOrigin.serviceType] : SERVICE_ICONS.openaiCompatible}
                      alt=""
                      className="h-[18px] w-[18px] object-contain"
                    />
                  </div>
                  <HeaderIconButton
                    title="收起侧边栏"
                    onClick={() => setSidebarCollapsed(true)}
                  >
                    <SidebarToggleIcon collapsed={false} />
                  </HeaderIconButton>
                </div>

                <div className="mt-5">
                  <SidebarPrimaryButton onClick={createChatSession}>
                    <PlusIcon />
                    新聊天
                  </SidebarPrimaryButton>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col border-t border-[#ece7dc]">
                <div className="flex items-center justify-between px-6 py-4">
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                    Sessions
                  </div>
                  <div className="rounded-[12px] bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 shadow-sm ring-1 ring-black/5">
                    {sessions.length}
                  </div>
                </div>

                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
                  {sessions.map((session) => {
                    const isActive = session.id === activeSessionId;
                    const anchor = settings ? hydrateGenerationMeta(settings, getSessionAnchorMeta(session)) : null;
                    return (
                      <div
                        key={session.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setActiveSessionId(session.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setActiveSessionId(session.id);
                          }
                        }}
                        className={cx(
                          "group w-full rounded-[12px] px-3 py-3 text-left transition-all",
                          isActive
                            ? "bg-white shadow-[0_10px_28px_rgba(15,23,42,0.06)] ring-1 ring-black/5"
                            : "hover:bg-white/80"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-slate-900">
                              {session.title}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                              {settings ? getSessionPreview(session, settings) : "等待第一条消息"}
                            </div>
                            <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
                              {anchor ? (
                                <img
                                  src={SERVICE_ICONS[anchor.serviceType]}
                                  alt=""
                                  className="h-3.5 w-3.5 object-contain"
                                />
                              ) : null}
                              <span>{formatSessionTimestamp(session.updatedAt)}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            title="删除对话"
                            aria-label="删除对话"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteSession(session.id);
                            }}
                            className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-[12px] text-slate-300 opacity-0 transition-all hover:bg-[#f3f2ee] hover:text-slate-700 group-hover:opacity-100 group-focus-within:opacity-100"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-[#ece7dc] px-4 py-3">
                <div className="flex items-center gap-2">
                  <HeaderIconButton title="刷新配置" onClick={() => void refreshSettings()}>
                    <RefreshIcon />
                  </HeaderIconButton>
                  <Link
                    to="/settings/model-providers"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-[#e6e2d8] bg-white/90 text-slate-500 transition-all hover:-translate-y-[1px] hover:border-[#d8d3c7] hover:text-slate-900"
                    title="模型提供商"
                    aria-label="模型提供商"
                  >
                    <SettingsIcon />
                  </Link>
                </div>
              </div>
            </>
          )}
        </aside>

        <section className="relative flex min-h-0 flex-col bg-[#fbfbf9]">
          {activeSession && settings ? (
            <>
              <header className="sticky top-0 z-20 border-b border-[#eceae4] bg-[#fbfbf9]/92 backdrop-blur-xl">
                <div className="mx-auto flex w-full max-w-[960px] items-center justify-between gap-4 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <input
                      value={activeSession.title}
                      onChange={(event) =>
                        updateSession(activeSession.id, (session) => ({
                          ...session,
                          title: event.target.value || "New Chat",
                          updatedAt: new Date().toISOString(),
                        }))
                      }
                      className="w-full bg-transparent text-[28px] font-medium tracking-tight text-slate-950 outline-none placeholder:text-slate-400"
                      placeholder="New Chat"
                    />
                    <div className="mt-3 h-4">
                      {activeSelectionOrigin ? (
                        <img
                          src={SERVICE_ICONS[activeSelectionOrigin.serviceType]}
                          alt=""
                          className="h-4 w-4 object-contain"
                        />
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <ModelSelectionControl
                      optionGroups={optionGroups}
                      activeSelection={activeSelection}
                      activeSelectionOrigin={activeSelectionOrigin}
                      onSelectServiceType={selectServiceType}
                      onSelectModel={selectModel}
                      className="hidden min-w-[330px] lg:flex"
                    />
                    <HeaderIconButton title="刷新配置" onClick={() => void refreshSettings()}>
                      <RefreshIcon />
                    </HeaderIconButton>
                    <Link
                      to="/settings/model-providers"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-[#e6e2d8] bg-white/90 text-slate-500 transition-all hover:-translate-y-[1px] hover:border-[#d8d3c7] hover:text-slate-900"
                      title="模型提供商"
                      aria-label="模型提供商"
                    >
                      <SettingsIcon />
                    </Link>
                  </div>
                </div>
              </header>

              <div
                ref={scrollRef}
                className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-6 sm:px-6"
              >
                <div className="mx-auto flex w-full max-w-[960px] flex-col">
                  {!anyProviderEnabled ? (
                    <div className="flex min-h-[calc(100vh-300px)] items-center justify-center py-16">
                      <div className="max-w-xl text-center">
                        <div className="text-sm font-medium text-slate-400">Provider Missing</div>
                        <div className="mt-3 text-4xl font-medium tracking-tight text-slate-950">
                          当前还没有可用的模型提供商
                        </div>
                        <div className="mt-4 text-sm leading-7 text-slate-500">
                          先在模型提供商页面启用至少一个 OpenAI Compatible、Claude 或 Gemini provider，
                          然后就可以在同一段对话里自由切换模型。
                        </div>
                        <div className="mt-8">
                          <Link
                            to="/settings/model-providers"
                            className="inline-flex items-center rounded-[12px] bg-[#151515] px-5 py-3 text-sm font-medium text-white transition-all hover:-translate-y-[1px] hover:bg-black"
                          >
                            打开模型提供商
                          </Link>
                        </div>
                      </div>
                    </div>
                  ) : activeSession.messages.length === 0 && !activeStreamMessage ? (
                    <div className="flex min-h-[calc(100vh-300px)] items-center justify-center py-16">
                      <div className="text-center">
                        <div className="text-4xl font-medium tracking-tight text-slate-950 sm:text-5xl">
                          今天有什么计划？
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-10 pb-2 pt-4">
                      {activeSession.messages.map((message) => {
                        const origin = hydrateGenerationMeta(
                          settings,
                          normalizeApiChatGenerationMeta(message.generationMeta)
                        );
                        const canRegenerate =
                          message.role === "assistant" &&
                          canRegenerateAssistantMessage(activeSession, message.id);
                        return message.role === "user" ? (
                          <UserMessageBubble
                            key={message.id}
                            message={message}
                            origin={origin}
                            onCopy={() => void copyMessage(message)}
                            onDelete={() => deleteMessage(activeSession.id, message.id)}
                          />
                        ) : (
                          <div key={message.id} className="flex justify-start">
                            <ApiAssistantBlocks
                              message={message}
                              origin={origin}
                              isStreaming={false}
                              onRegenerate={
                                canRegenerate
                                  ? () => void regenerateAssistantMessage(activeSession, message.id)
                                  : undefined
                              }
                              onCopy={() => void copyMessage(message)}
                              onDelete={() => deleteMessage(activeSession.id, message.id)}
                            />
                          </div>
                        );
                      })}

                      {activeStreamMessage ? (
                        <div className="flex justify-start">
                          <ApiAssistantBlocks
                            message={activeStreamMessage}
                            origin={hydrateGenerationMeta(settings, liveStream?.origin)}
                            isStreaming
                          />
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div className="pointer-events-none sticky bottom-0 z-20 bg-[linear-gradient(180deg,rgba(251,250,247,0)_0%,rgba(251,250,247,0.82)_26%,#fbfaf7_58%)] px-4 pb-4 pt-8 sm:px-6">
                <div className="pointer-events-auto mx-auto w-full max-w-[960px]">
                  {statusText || errorText ? (
                    <div
                      className={cx(
                        "mb-3 rounded-[12px] px-4 py-3 text-sm shadow-sm ring-1",
                        errorText
                          ? "bg-rose-50 text-rose-700 ring-rose-200"
                          : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      )}
                    >
                      {errorText ?? statusText}
                    </div>
                  ) : null}

                  <div className="rounded-[12px] border border-[#e2ddd2] bg-white/98 p-3 shadow-[0_24px_64px_rgba(15,23,42,0.10)] backdrop-blur">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {activeSelectionOrigin ? <MessageOriginPill origin={activeSelectionOrigin} /> : null}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        图片多模态已启用 · Enter 发送 · Shift + Enter 换行
                      </div>
                    </div>

                    <ModelSelectionControl
                      optionGroups={optionGroups}
                      activeSelection={activeSelection}
                      activeSelectionOrigin={activeSelectionOrigin}
                      onSelectServiceType={selectServiceType}
                      onSelectModel={selectModel}
                      className="mb-3 lg:hidden"
                    />

                    <div className="rounded-[12px] border border-[#ece7dc] bg-[#fcfbf8] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                      {activeAttachments.length > 0 ? (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {activeAttachments.map((attachment) => {
                            const label = attachmentLabel(attachment);
                            const previewSrc = attachmentPreviewSrc(attachment);
                            return (
                              <div
                                key={attachment.id}
                                className="inline-flex max-w-full items-center gap-2 rounded-[14px] border border-[#e6dfd3] bg-white px-2 py-2 shadow-sm"
                                title={label}
                              >
                                {previewSrc ? (
                                  <img
                                    src={previewSrc}
                                    alt={attachment.fileName}
                                    className="h-10 w-10 rounded-[10px] object-cover"
                                  />
                                ) : (
                                  <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-slate-100 text-slate-400">
                                    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                                      <path d="M5 7.5A2.5 2.5 0 017.5 5h9A2.5 2.5 0 0119 7.5v9a2.5 2.5 0 01-2.5 2.5h-9A2.5 2.5 0 015 16.5v-9z" stroke="currentColor" strokeWidth="1.6" />
                                      <path d="M8 15l2.6-2.8a1 1 0 011.5.04L14 14l1.1-1.2a1 1 0 011.47-.02L18 14.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                      <circle cx="9" cy="9" r="1.2" fill="currentColor" />
                                    </svg>
                                  </div>
                                )}
                                <span className="max-w-[180px] truncate text-[12px] font-medium text-slate-700">
                                  {label}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeComposerAttachment(attachment.id)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                                  title="移除图片"
                                  aria-label="移除图片"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                  </svg>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void pickComposerAttachments()}
                          disabled={loading}
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-[#e1dbcf] bg-white text-slate-500 transition-all hover:-translate-y-[1px] hover:border-[#d4cbbb] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-45"
                          title="添加图片"
                          aria-label="添加图片"
                        >
                          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                            <path d="M8 7.5V6.8A2.8 2.8 0 0110.8 4h2.4A2.8 2.8 0 0116 6.8v.7h1.2A2.8 2.8 0 0120 10.3v6.9a2.8 2.8 0 01-2.8 2.8H6.8A2.8 2.8 0 014 17.2v-6.9a2.8 2.8 0 012.8-2.8H8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                            <path d="M12 10v4m-2-2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </button>

                        <div className="flex min-h-[44px] flex-1 items-center">
                          <textarea
                            ref={composerRef}
                            value={activeDraft}
                            onChange={(event) =>
                              setComposerDrafts((current) => ({
                                ...current,
                                [activeSession.id]: event.target.value,
                              }))
                            }
                            onKeyDown={handleComposerKeyDown}
                            rows={1}
                            placeholder="有问题，尽管问，也可以直接附图"
                            className="max-h-[180px] min-h-[30px] w-full resize-none overflow-y-auto bg-transparent px-1 py-2 text-[15px] leading-7 text-slate-900 outline-none placeholder:text-slate-400"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => void sendMessage()}
                          disabled={loading || !activeSelectionOption || (!activeDraft.trim() && activeAttachments.length === 0)}
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center self-end rounded-[12px] bg-[#111111] text-white transition-all hover:-translate-y-[1px] hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
                          title={loading ? "等待响应" : "发送"}
                          aria-label={loading ? "等待响应" : "发送"}
                        >
                          <SendIcon />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
