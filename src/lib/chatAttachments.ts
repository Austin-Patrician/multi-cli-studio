import type { ChatAttachment, PickedChatAttachment } from "./models";

const IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
  csv: "text/csv",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  txt: "text/plain",
  yml: "text/yaml",
  yaml: "text/yaml",
};

function attachmentId() {
  return `att-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function normalizeAttachmentPath(value: string) {
  return value.replace(/\\/g, "/");
}

export function attachmentBaseName(value: string) {
  const normalized = normalizeAttachmentPath(value).replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

export function attachmentExtension(value: string) {
  const name = attachmentBaseName(value);
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === name.length - 1) return "";
  return name.slice(dotIndex + 1).toLowerCase();
}

export function guessAttachmentMediaType(value: string) {
  const extension = attachmentExtension(value);
  return MIME_BY_EXTENSION[extension] ?? null;
}

export function isImageMediaType(mediaType: string | null | undefined) {
  return typeof mediaType === "string" && mediaType.toLowerCase().startsWith("image/");
}

export function isImageAttachment(attachment: Pick<ChatAttachment, "fileName" | "mediaType" | "source">) {
  if (isImageMediaType(attachment.mediaType)) return true;
  if (attachment.source.startsWith("data:image/")) return true;
  return IMAGE_EXTENSIONS.has(attachmentExtension(attachment.fileName || attachment.source));
}

export function relativeAttachmentDisplayPath(
  absolutePath: string,
  workspaceRoot: string | null | undefined
) {
  const normalizedPath = normalizeAttachmentPath(absolutePath);
  const normalizedRoot = normalizeAttachmentPath(workspaceRoot ?? "").replace(/\/+$/, "");
  if (!normalizedRoot) return normalizedPath;
  if (normalizedPath === normalizedRoot) return attachmentBaseName(normalizedPath);
  const prefix = `${normalizedRoot}/`;
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }
  return normalizedPath;
}

export function createChatAttachment(
  picked: PickedChatAttachment,
  workspaceRoot: string | null | undefined
): ChatAttachment | null {
  const localPath = picked.path?.trim() ?? "";
  const source = localPath || picked.source?.trim() || "";
  if (!source) return null;

  const fileName = picked.fileName?.trim() || attachmentBaseName(source);
  const mediaType = picked.mediaType?.trim() || guessAttachmentMediaType(fileName);
  const kind = isImageAttachment({ fileName, mediaType, source }) ? "image" : "fileReference";

  return {
    id: attachmentId(),
    kind,
    fileName,
    mediaType,
    source,
    displayPath: localPath ? relativeAttachmentDisplayPath(localPath, workspaceRoot) : fileName,
  };
}

export function cloneChatAttachments(attachments: ChatAttachment[] | null | undefined) {
  if (!attachments?.length) return attachments ?? null;
  return attachments.map((attachment) => ({ ...attachment }));
}

export function buildPromptWithAttachments(
  prompt: string,
  attachments: ChatAttachment[] | null | undefined
) {
  const trimmed = prompt.trim();
  const referenceLines =
    attachments
      ?.filter((attachment) => attachment.kind === "fileReference")
      .map((attachment) => `@${attachment.displayPath || attachment.source}`) ?? [];

  if (referenceLines.length === 0) {
    return trimmed;
  }

  return [trimmed, ...referenceLines].filter(Boolean).join("\n");
}

export function summarizeChatAttachments(attachments: ChatAttachment[] | null | undefined) {
  const imageCount =
    attachments?.filter((attachment) => attachment.kind === "image").length ?? 0;
  const fileCount =
    attachments?.filter((attachment) => attachment.kind === "fileReference").length ?? 0;

  return {
    imageCount,
    fileCount,
    totalCount: imageCount + fileCount,
  };
}

export function formatAttachmentSummary(attachments: ChatAttachment[] | null | undefined) {
  const { imageCount, fileCount } = summarizeChatAttachments(attachments);
  const parts: string[] = [];
  if (imageCount > 0) {
    parts.push(`${imageCount} 张图片`);
  }
  if (fileCount > 0) {
    parts.push(`${fileCount} 个文件`);
  }
  return parts.join(" · ");
}
