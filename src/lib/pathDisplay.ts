type CompactPathOptions = {
  maxChars?: number;
  maxSegments?: number;
};

export function compactPathForDisplay(path: string, options: CompactPathOptions = {}) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
  if (!normalized) return path;

  const maxChars = Math.max(12, options.maxChars ?? 72);
  const maxSegments = Math.max(1, options.maxSegments ?? 4);
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length <= maxSegments && normalized.length <= maxChars) {
    return normalized;
  }

  const tailSegments = segments.slice(-maxSegments);
  let visibleTail = tailSegments.join("/");

  while (visibleTail.length > maxChars && tailSegments.length > 1) {
    tailSegments.shift();
    visibleTail = tailSegments.join("/");
  }

  if (visibleTail.length > maxChars) {
    const tailChars = Math.max(8, maxChars - 4);
    visibleTail = visibleTail.slice(-tailChars);
  }

  return `.../${visibleTail}`;
}
