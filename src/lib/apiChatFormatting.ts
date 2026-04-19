import {
  AssistantContentFormat,
  ApiChatGenerationMeta,
  ApiChatMessage,
  ApiChatSelection,
  ChatAttachment,
  ChatMessageBlock,
  ModelProviderServiceType,
} from "./models";
import {
  detectAssistantContentFormat,
  normalizeAssistantContent,
} from "./messageFormatting";
import { cloneChatAttachments, isImageMediaType } from "./chatAttachments";

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

function isServiceType(value: unknown): value is ModelProviderServiceType {
  return value === "openaiCompatible" || value === "claude" || value === "gemini";
}

function normalizeApiChatAttachment(value: unknown): ChatAttachment | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ChatAttachment>;
  const kind = raw.kind === "image" || raw.kind === "fileReference" ? raw.kind : null;
  const fileName = typeof raw.fileName === "string" ? raw.fileName.trim() : "";
  const source = typeof raw.source === "string" ? raw.source.trim() : "";
  if (!kind || !fileName || !source) return null;
  const mediaType =
    typeof raw.mediaType === "string" && raw.mediaType.trim() ? raw.mediaType.trim() : null;
  const displayPath =
    typeof raw.displayPath === "string" && raw.displayPath.trim() ? raw.displayPath.trim() : null;
  return {
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : `${kind}-${fileName}-${source}`,
    kind:
      kind === "image" || isImageMediaType(mediaType) || source.startsWith("data:image/")
        ? "image"
        : "fileReference",
    fileName,
    mediaType,
    source,
    displayPath,
  };
}

export function normalizeApiChatAttachments(value: unknown): ChatAttachment[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const normalized = value
    .map((item) => normalizeApiChatAttachment(item))
    .filter(Boolean) as ChatAttachment[];
  return normalized.length > 0 ? normalized : null;
}

export interface ParsedApiAssistantContent {
  rawContent: string;
  content: string;
  contentFormat: AssistantContentFormat;
  blocks: ChatMessageBlock[];
}

function trimSegment(value: string) {
  return value.replace(/^\s+|\s+$/g, "");
}

function pushTextBlock(blocks: ChatMessageBlock[], text: string) {
  const normalized = trimSegment(text);
  if (!normalized) return;
  blocks.push({
    kind: "text",
    text: normalized,
    format: detectAssistantContentFormat(normalized),
  });
}

function pushReasoningBlock(blocks: ChatMessageBlock[], text: string) {
  const normalized = trimSegment(text);
  if (!normalized) return;
  blocks.push({
    kind: "reasoning",
    text: normalized,
  });
}

export function normalizeApiChatSelection(value: unknown): ApiChatSelection | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ApiChatSelection>;
  if (!isServiceType(raw.serviceType)) return null;
  if (typeof raw.providerId !== "string" || !raw.providerId.trim()) return null;
  if (typeof raw.modelId !== "string" || !raw.modelId.trim()) return null;
  return {
    serviceType: raw.serviceType,
    providerId: raw.providerId.trim(),
    modelId: raw.modelId.trim(),
  };
}

export function normalizeApiChatGenerationMeta(value: unknown): ApiChatGenerationMeta | null {
  const selection = normalizeApiChatSelection(value);
  if (!selection) return null;
  const raw = value as Partial<ApiChatGenerationMeta>;
  return {
    ...selection,
    providerName:
      typeof raw.providerName === "string" && raw.providerName.trim()
        ? raw.providerName.trim()
        : null,
    modelLabel:
      typeof raw.modelLabel === "string" && raw.modelLabel.trim() ? raw.modelLabel.trim() : null,
    requestedAt:
      typeof raw.requestedAt === "string" && raw.requestedAt.trim() ? raw.requestedAt : null,
    completedAt:
      typeof raw.completedAt === "string" && raw.completedAt.trim() ? raw.completedAt : null,
  };
}

export function parseApiAssistantContent(raw: string): ParsedApiAssistantContent {
  const normalized = normalizeAssistantContent(raw);
  const blocks: ChatMessageBlock[] = [];
  const visibleParts: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const openIndex = normalized.indexOf(THINK_OPEN, cursor);
    if (openIndex === -1) {
      const text = normalized.slice(cursor);
      visibleParts.push(text);
      pushTextBlock(blocks, text);
      break;
    }

    const leadingText = normalized.slice(cursor, openIndex);
    visibleParts.push(leadingText);
    pushTextBlock(blocks, leadingText);

    const reasoningStart = openIndex + THINK_OPEN.length;
    const closeIndex = normalized.indexOf(THINK_CLOSE, reasoningStart);
    if (closeIndex === -1) {
      pushReasoningBlock(blocks, normalized.slice(reasoningStart));
      cursor = normalized.length;
      break;
    }

    pushReasoningBlock(blocks, normalized.slice(reasoningStart, closeIndex));
    cursor = closeIndex + THINK_CLOSE.length;
  }

  const content = normalizeAssistantContent(visibleParts.join("")).trim();
  return {
    rawContent: normalized,
    content,
    contentFormat: detectAssistantContentFormat(content),
    blocks,
  };
}

export function normalizeApiChatMessage(message: ApiChatMessage): ApiChatMessage {
  if (message.role !== "assistant") {
    return {
      ...message,
      generationMeta: normalizeApiChatGenerationMeta(message.generationMeta),
      attachments: cloneChatAttachments(normalizeApiChatAttachments(message.attachments)),
      rawContent: message.rawContent ?? message.content,
      contentFormat: message.contentFormat ?? null,
      blocks: message.blocks ?? null,
      durationMs: message.durationMs ?? null,
      promptTokens: message.promptTokens ?? null,
      completionTokens: message.completionTokens ?? null,
      totalTokens: message.totalTokens ?? null,
    };
  }

  const parsed = parseApiAssistantContent(message.rawContent ?? message.content);
  return {
    ...message,
    generationMeta: normalizeApiChatGenerationMeta(message.generationMeta),
    attachments: cloneChatAttachments(normalizeApiChatAttachments(message.attachments)),
    rawContent: parsed.rawContent,
    content: parsed.content,
    contentFormat: message.contentFormat ?? parsed.contentFormat,
    blocks: message.blocks ?? parsed.blocks,
    durationMs: message.durationMs ?? null,
    promptTokens: message.promptTokens ?? null,
    completionTokens: message.completionTokens ?? null,
    totalTokens: message.totalTokens ?? null,
  };
}
