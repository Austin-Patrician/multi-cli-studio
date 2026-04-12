import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import { AssistantMessageContent } from "../components/chat/AssistantMessageContent";
import { bridge } from "../lib/bridge";
import {
  ApiChatMessage,
  ApiChatSession,
  AppSettings,
  ChatMessageBlock,
  ModelProviderServiceType,
} from "../lib/models";
import { normalizeApiChatMessage } from "../lib/apiChatFormatting";
import {
  getEnabledProviderForServiceType,
  MODEL_PROVIDER_META,
  MODEL_PROVIDER_SERVICE_ORDER,
  normalizeProviderSettings,
} from "../lib/modelProviders";
import openaiIcon from "../media/svg/openai.svg";
import claudeIcon from "../media/svg/claude-color.svg";
import geminiIcon from "../media/svg/gemini-color.svg";

const STORAGE_KEY = "multi-cli-studio::api-chat-sessions";

const SERVICE_ICONS: Record<ModelProviderServiceType, string> = {
  openaiCompatible: openaiIcon,
  claude: claudeIcon,
  gemini: geminiIcon,
};

type PersistedChatState = {
  activeSessionId: string | null;
  sessions: ApiChatSession[];
};

type LiveApiStream = {
  sessionId: string;
  streamId: string;
  message: ApiChatMessage;
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

function deriveTitleFromMessages(messages: ApiChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content ?? "";
  return firstUserMessage.trim() ? truncate(firstUserMessage, 30) : "New Chat";
}

function isServiceType(value: unknown): value is ModelProviderServiceType {
  return value === "openaiCompatible" || value === "claude" || value === "gemini";
}

function normalizePersistedMessage(value: unknown): ApiChatMessage | null {
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

function normalizePersistedSession(
  value: unknown,
  settings: AppSettings
): ApiChatSession | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ApiChatSession>;
  const serviceType = isServiceType(raw.serviceType) ? raw.serviceType : "openaiCompatible";
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map((message) => normalizePersistedMessage(message))
        .filter(Boolean) as ApiChatMessage[]
    : [];
  return syncSessionWithSettings(
    {
      id: typeof raw.id === "string" && raw.id.trim() ? raw.id : createId("api-session"),
      title:
        typeof raw.title === "string" && raw.title.trim()
          ? raw.title
          : deriveTitleFromMessages(messages),
      serviceType,
      providerId: typeof raw.providerId === "string" ? raw.providerId : null,
      modelId: typeof raw.modelId === "string" ? raw.modelId : null,
      messages,
      createdAt:
        typeof raw.createdAt === "string" && raw.createdAt.trim()
          ? raw.createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof raw.updatedAt === "string" && raw.updatedAt.trim()
          ? raw.updatedAt
          : new Date().toISOString(),
    },
    settings
  );
}

function syncSessionWithSettings(
  session: ApiChatSession,
  settings: AppSettings
): ApiChatSession {
  const provider = getEnabledProviderForServiceType(settings, session.serviceType);
  const modelId = provider?.models.some((model) => model.id === session.modelId)
    ? session.modelId
    : provider?.models[0]?.id ?? null;
  return {
    ...session,
    providerId: provider?.id ?? null,
    modelId,
  };
}

function createSession(
  settings: AppSettings,
  serviceType: ModelProviderServiceType = "openaiCompatible"
): ApiChatSession {
  return syncSessionWithSettings(
    {
      id: createId("api-session"),
      title: "New Chat",
      serviceType,
      providerId: null,
      modelId: null,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    settings
  );
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

function getSessionPreview(session: ApiChatSession, providerName: string | null) {
  const previewMessage = [...session.messages]
    .reverse()
    .find((message) => message.role !== "system" && message.content.trim());
  if (previewMessage) {
    return truncate(normalizeApiChatMessage(previewMessage).content.replace(/\s+/g, " "), 58);
  }
  return providerName
    ? `${providerName} · ${session.modelId ?? "未选择模型"}`
    : "等待第一条消息";
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
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#151515] px-4 py-3 text-sm font-medium text-white transition-all hover:-translate-y-[1px] hover:bg-black"
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
      className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-white hover:text-slate-900"
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
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#e6e2d8] bg-white/90 text-slate-500 transition-all hover:-translate-y-[1px] hover:border-[#d8d3c7] hover:text-slate-900"
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
  const display = total ?? [prompt, completion].filter((value) => value != null).reduce((sum, value) => sum + (value ?? 0), 0);
  const title =
    prompt != null || completion != null
      ? `Prompt ${prompt ?? 0} · Completion ${completion ?? 0} · Total ${display}`
      : `Total ${display}`;
  return {
    display: `${display} tok`,
    title,
  };
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
      className="inline-flex items-center gap-1.5 rounded-full bg-[#f4f4f1] px-2.5 py-1 text-[11px] font-medium text-slate-500"
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
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition-all hover:border-slate-300 hover:text-slate-700"
    >
      {children}
    </button>
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
    <div className="rounded-[24px] border border-amber-200/80 bg-[linear-gradient(180deg,#fffdf7_0%,#fff9eb_100%)] px-4 py-3.5 shadow-[0_12px_30px_rgba(120,53,15,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
          <span className="inline-flex h-2 w-2 rounded-full bg-amber-400" />
          Reasoning
        </div>
        {showToggle ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-amber-200 bg-white/80 px-2.5 text-[11px] font-medium text-amber-700 transition-all hover:bg-white"
          >
            {expanded ? "收起" : "展开"}
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
          <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse rounded-full bg-amber-500 align-[-2px]" />
        ) : null}
      </div>
    </div>
  );
}

function ApiAssistantBlocks({
  message,
  serviceType,
  providerName,
  modelId,
  isStreaming,
  onCopy,
  onDelete,
}: {
  message: ApiChatMessage;
  serviceType: ModelProviderServiceType;
  providerName: string;
  modelId: string | null;
  isStreaming: boolean;
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
      <div className="mb-4 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
        <img src={SERVICE_ICONS[serviceType]} alt="" className="h-4 w-4 object-contain" />
        <span>{providerName}</span>
        <span className="text-slate-300">·</span>
        <span>{modelId ?? "未选择模型"}</span>
        {isStreaming ? (
          <>
            <span className="text-slate-300">·</span>
            <span className="text-sky-600">Streaming</span>
          </>
        ) : null}
      </div>

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
                    "rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-rose-700"
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
          <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm ring-1 ring-black/5">
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
  const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>({});
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
        setErrorText(error instanceof Error ? error.message : "加载模型对话配置失败。");
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
    bridge.onApiChatStream((event) => {
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
    }).then((nextUnlisten) => {
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

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null;
  const activeProvider =
    settings && activeSession
      ? getEnabledProviderForServiceType(settings, activeSession.serviceType)
      : null;
  const availableModels = activeProvider?.models ?? [];
  const activeDraft = activeSession ? composerDrafts[activeSession.id] ?? "" : "";
  const activeStreamMessage =
    liveStream && activeSession && liveStream.sessionId === activeSession.id
      ? liveStream.message
      : null;

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

  function selectServiceType(serviceType: ModelProviderServiceType) {
    if (!activeSession || !settings) return;
    const provider = getEnabledProviderForServiceType(settings, serviceType);
    updateSession(activeSession.id, (session) => ({
      ...session,
      serviceType,
      providerId: provider?.id ?? null,
      modelId: provider?.models[0]?.id ?? null,
      updatedAt: new Date().toISOString(),
    }));
    setStatusText(null);
    setErrorText(null);
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
      setErrorText(error instanceof Error ? error.message : "刷新 provider 配置失败。");
    }
  }

  function createChatSession(serviceType?: ModelProviderServiceType) {
    if (!settings) return;
    const session = createSession(
      settings,
      serviceType ?? activeSession?.serviceType ?? "openaiCompatible"
    );
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
        const session = createSession(settings);
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
    setLiveStream((current) => (current?.sessionId === sessionId ? null : current));
  }

  function deleteAssistantMessage(sessionId: string, messageId: string) {
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

  async function copyAssistantMessage(message: ApiChatMessage) {
    try {
      await navigator.clipboard.writeText(normalizeApiChatMessage(message).content);
      setStatusText("消息已复制。");
      setErrorText(null);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "复制消息失败。");
    }
  }

  async function sendMessage() {
    if (!settings || !activeSession || !activeProvider) return;
    const content = activeDraft.trim();
    if (!content || !activeSession.modelId) return;
    const streamId = createId("api-stream");

    const userMessage: ApiChatMessage = {
      id: createId("api-user"),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    const nextMessages = [...activeSession.messages, userMessage];
    const nextTitle =
      activeSession.messages.length === 0 && activeSession.title === "New Chat"
        ? deriveTitleFromMessages(nextMessages)
        : activeSession.title;

    flushSync(() => {
      updateSession(activeSession.id, (session) => ({
        ...session,
        title: nextTitle,
        providerId: activeProvider.id,
        messages: nextMessages,
        updatedAt: new Date().toISOString(),
      }));
      setComposerDrafts((current) => ({ ...current, [activeSession.id]: "" }));
      setLoading(true);
      setLiveStream({
        sessionId: activeSession.id,
        streamId,
        message: {
          id: createId("api-msg"),
          role: "assistant",
          content: "",
          rawContent: "",
          timestamp: new Date().toISOString(),
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
        serviceType: activeSession.serviceType,
        providerId: activeProvider.id,
        modelId: activeSession.modelId,
        messages: nextMessages,
        streamId,
      });
      const normalizedMessage = normalizeApiChatMessage(response.message);
      updateSession(activeSession.id, (session) => ({
        ...session,
        messages: [...nextMessages, normalizedMessage],
        updatedAt: new Date().toISOString(),
      }));
      setLiveStream((current) => (current?.streamId === streamId ? null : current));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "模型响应失败，请检查 provider 配置。";
      const errorMessage: ApiChatMessage = {
        id: createId("api-error"),
        role: "assistant",
        content: message,
        rawContent: message,
        timestamp: new Date().toISOString(),
        error: true,
      };
      updateSession(activeSession.id, (session) => ({
        ...session,
        messages: [...nextMessages, normalizeApiChatMessage(errorMessage)],
        updatedAt: new Date().toISOString(),
      }));
      setLiveStream((current) => (current?.streamId === streamId ? null : current));
      setErrorText(message);
    } finally {
      setLoading(false);
    }
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (loading) return;
    void sendMessage();
  }

  if (loadingSettings) {
    return (
      <div className="flex h-full items-center justify-center bg-[#f5f4ef]">
        <div className="rounded-full border border-[#e5e1d7] bg-white px-5 py-2 text-sm text-slate-500 shadow-sm">
          正在加载模型对话...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden bg-[#f5f4ef] text-slate-900">
      <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-[#e7e2d8] bg-[#f7f5ef]">
          <div className="px-4 pb-5 pt-4">
            <div className="flex items-center gap-3 px-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
                <img
                  src={activeSession ? SERVICE_ICONS[activeSession.serviceType] : openaiIcon}
                  alt=""
                  className="h-[18px] w-[18px] object-contain"
                />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">Model Chat</div>
                <div className="text-xs text-slate-500">Provider API only</div>
              </div>
            </div>

            <div className="mt-5">
              <SidebarPrimaryButton onClick={() => createChatSession()}>
                <PlusIcon />
                新聊天
              </SidebarPrimaryButton>
            </div>

            <div className="mt-5 space-y-1">
              {MODEL_PROVIDER_SERVICE_ORDER.map((serviceType) => {
                const isActive = activeSession?.serviceType === serviceType;
                return (
                  <button
                    key={serviceType}
                    type="button"
                    onClick={() => selectServiceType(serviceType)}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition-all",
                      isActive
                        ? "bg-white text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.05)]"
                        : "text-slate-600 hover:bg-white/80 hover:text-slate-900"
                    )}
                  >
                    <img
                      src={SERVICE_ICONS[serviceType]}
                      alt=""
                      className="h-4 w-4 shrink-0 object-contain"
                    />
                    <span className="font-medium">
                      {MODEL_PROVIDER_META[serviceType].shortLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-[#ece7dc]">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                最近会话
              </div>
              <div className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 shadow-sm ring-1 ring-black/5">
                {sessions.length}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
              {sessions.map((session) => {
                const provider = settings
                  ? getEnabledProviderForServiceType(settings, session.serviceType)
                  : null;
                const isActive = session.id === activeSessionId;
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
                      "group w-full rounded-2xl px-3 py-3 text-left transition-all",
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
                          {getSessionPreview(session, provider?.name ?? null)}
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
                          <img
                            src={SERVICE_ICONS[session.serviceType]}
                            alt=""
                            className="h-3.5 w-3.5 object-contain"
                          />
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
                        className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-300 opacity-0 transition-all hover:bg-[#f5f4ef] hover:text-slate-700 group-hover:opacity-100 group-focus-within:opacity-100"
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
            <div className="flex flex-wrap items-center gap-1">
              <SidebarGhostButton onClick={() => void refreshSettings()}>
                <RefreshIcon />
                刷新配置
              </SidebarGhostButton>
              <Link
                to="/model-providers"
                className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-white hover:text-slate-900"
              >
                <SettingsIcon />
                模型提供商
              </Link>
            </div>
          </div>
        </aside>

        <section className="relative flex min-h-0 flex-col bg-[#fbfaf7]">
          {activeSession && settings ? (
            <>
              <header className="sticky top-0 z-20 border-b border-[#ece7dc] bg-[#fbfaf7]/92 backdrop-blur-xl">
                <div className="mx-auto flex w-full max-w-[920px] items-center justify-between gap-4 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-3">
                      <img
                        src={SERVICE_ICONS[activeSession.serviceType]}
                        alt=""
                        className="h-5 w-5 shrink-0 object-contain"
                      />
                      <input
                        value={activeSession.title}
                        onChange={(event) =>
                          updateSession(activeSession.id, (session) => ({
                            ...session,
                            title: event.target.value || "New Chat",
                            updatedAt: new Date().toISOString(),
                          }))
                        }
                        className="min-w-0 flex-1 bg-transparent text-[28px] font-medium tracking-tight text-slate-950 outline-none placeholder:text-slate-400"
                        placeholder="New Chat"
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-8 text-xs text-slate-500">
                      <span>{MODEL_PROVIDER_META[activeSession.serviceType].label}</span>
                      <span className="text-slate-300">/</span>
                      <span>{activeProvider?.name ?? "未启用 Provider"}</span>
                      <span className="text-slate-300">/</span>
                      <span>{activeSession.modelId ?? "未选择模型"}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <div className="hidden rounded-full border border-[#e6e2d8] bg-white/90 px-4 py-2 shadow-sm sm:flex">
                      <select
                        value={activeSession.modelId ?? ""}
                        onChange={(event) =>
                          updateSession(activeSession.id, (session) => ({
                            ...session,
                            modelId: event.target.value || null,
                            updatedAt: new Date().toISOString(),
                          }))
                        }
                        className="min-w-[180px] bg-transparent text-sm text-slate-700 outline-none"
                      >
                        {availableModels.length === 0 ? (
                          <option value="">No models</option>
                        ) : (
                          availableModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label?.trim() || model.name}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                    <HeaderIconButton title="刷新配置" onClick={() => void refreshSettings()}>
                      <RefreshIcon />
                    </HeaderIconButton>
                    <Link
                      to="/model-providers"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#e6e2d8] bg-white/90 text-slate-500 transition-all hover:-translate-y-[1px] hover:border-[#d8d3c7] hover:text-slate-900"
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
                className="min-h-0 flex-1 overflow-y-auto px-4 pb-40 pt-6 sm:px-6"
              >
                <div className="mx-auto flex w-full max-w-[920px] flex-col">
                  {!activeProvider ? (
                    <div className="flex min-h-[calc(100vh-300px)] items-center justify-center py-16">
                      <div className="max-w-xl text-center">
                        <div className="text-sm font-medium text-slate-400">Provider Missing</div>
                        <div className="mt-3 text-4xl font-medium tracking-tight text-slate-950">
                          当前服务还没有可用的 provider
                        </div>
                        <div className="mt-4 text-sm leading-7 text-slate-500">
                          前往模型提供商页面启用一个 provider，然后返回当前会话继续对话。
                        </div>
                        <div className="mt-8">
                          <Link
                            to="/model-providers"
                            className="inline-flex items-center rounded-full bg-[#151515] px-5 py-3 text-sm font-medium text-white transition-all hover:-translate-y-[1px] hover:bg-black"
                          >
                            打开模型提供商
                          </Link>
                        </div>
                      </div>
                    </div>
                  ) : activeSession.messages.length === 0 && !activeStreamMessage ? (
                    <div className="flex min-h-[calc(100vh-300px)] items-center justify-center py-16">
                      <div className="max-w-2xl text-center">
                        <img
                          src={SERVICE_ICONS[activeSession.serviceType]}
                          alt=""
                          className="mx-auto h-10 w-10 object-contain"
                        />
                        <div className="mt-6 text-4xl font-medium tracking-tight text-slate-950 sm:text-5xl">
                          开始一段新对话
                        </div>
                        <div className="mt-4 text-sm leading-7 text-slate-500">
                          当前连接到 {activeProvider.name}，模型为{" "}
                          <span className="font-medium text-slate-700">
                            {activeSession.modelId ?? "未选择模型"}
                          </span>
                          。
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-10 pb-10 pt-4">
                      {activeSession.messages.map((message) =>
                        message.role === "user" ? (
                          <div key={message.id} className="flex justify-end">
                            <div className="max-w-[78%] rounded-[28px] bg-white px-5 py-3.5 text-[15px] leading-7 text-slate-800 shadow-[0_10px_32px_rgba(15,23,42,0.06)] ring-1 ring-black/5">
                              {message.content}
                            </div>
                          </div>
                        ) : (
                          <div key={message.id} className="flex justify-start">
                            <ApiAssistantBlocks
                              message={message}
                              serviceType={activeSession.serviceType}
                              providerName={activeProvider.name}
                              modelId={activeSession.modelId ?? null}
                              isStreaming={false}
                              onCopy={() => void copyAssistantMessage(message)}
                              onDelete={() => deleteAssistantMessage(activeSession.id, message.id)}
                            />
                          </div>
                        )
                      )}

                      {activeStreamMessage ? (
                        <div className="flex justify-start">
                          <ApiAssistantBlocks
                            message={activeStreamMessage}
                            serviceType={activeSession.serviceType}
                            providerName={activeProvider.name}
                            modelId={activeSession.modelId ?? null}
                            isStreaming
                          />
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div className="pointer-events-none sticky bottom-0 z-20 bg-[linear-gradient(180deg,rgba(251,250,247,0)_0%,rgba(251,250,247,0.82)_26%,#fbfaf7_58%)] px-4 pb-6 pt-12 sm:px-6">
                <div className="pointer-events-auto mx-auto w-full max-w-[920px]">
                  {statusText || errorText ? (
                    <div
                      className={cx(
                        "mb-3 rounded-2xl px-4 py-3 text-sm shadow-sm ring-1",
                        errorText
                          ? "bg-rose-50 text-rose-700 ring-rose-200"
                          : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      )}
                    >
                      {errorText ?? statusText}
                    </div>
                  ) : null}

                  <div className="rounded-[32px] border border-[#e2ddd2] bg-white/98 p-3 shadow-[0_24px_64px_rgba(15,23,42,0.10)] backdrop-blur">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2 rounded-full border border-[#e8e2d7] bg-[#faf8f2] px-3 py-1.5 text-[11px] font-medium text-slate-600">
                          <img
                            src={SERVICE_ICONS[activeSession.serviceType]}
                            alt=""
                            className="h-3.5 w-3.5 object-contain"
                          />
                          {activeProvider?.name ?? "未启用 Provider"}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-[#e8e2d7] bg-[#faf8f2] px-3 py-1.5 text-[11px] font-medium text-slate-500">
                          {activeSession.modelId ?? "未选择模型"}
                        </span>
                        {loading ? (
                          <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] font-medium text-sky-700">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                            正在流式响应
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-slate-400">Enter 发送 · Shift + Enter 换行</div>
                    </div>

                    <div className="flex items-end gap-3 rounded-[26px] border border-[#ece7dc] bg-[#fcfbf8] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                      <button
                        type="button"
                        onClick={() => createChatSession()}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#e6e2d8] bg-white text-slate-500 transition-all hover:-translate-y-[1px] hover:text-slate-900"
                        title="新聊天"
                        aria-label="新聊天"
                      >
                        <PlusIcon />
                      </button>

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
                        placeholder="给当前模型发送消息，支持 Markdown。"
                        className="max-h-[180px] min-h-[30px] flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2 text-[15px] leading-7 text-slate-900 outline-none placeholder:text-slate-400"
                      />

                      <button
                        type="button"
                        onClick={() => void sendMessage()}
                        disabled={
                          loading ||
                          !activeProvider ||
                          !activeSession.modelId ||
                          !activeDraft.trim()
                        }
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#111111] text-white transition-all hover:-translate-y-[1px] hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
                        title={loading ? "等待响应" : "发送"}
                        aria-label={loading ? "等待响应" : "发送"}
                      >
                        <SendIcon />
                      </button>
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
