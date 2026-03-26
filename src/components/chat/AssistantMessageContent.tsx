import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AssistantContentFormat } from "../../lib/models";
import {
  detectAssistantContentFormat,
  normalizeAssistantContent,
} from "../../lib/messageFormatting";

interface AssistantMessageContentProps {
  content: string;
  rawContent?: string | null;
  contentFormat?: AssistantContentFormat | null;
  isStreaming: boolean;
  renderMode: "rich" | "raw";
}

function StreamingCursor() {
  return (
    <span className="ml-1 inline-block h-4 w-1.5 rounded-full bg-accent align-[-2px] animate-pulse" />
  );
}

const markdownComponents = {
  p: ({ children }) => <p className="my-0 text-[14px] leading-7 text-text">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5 text-[14px] leading-7 text-text">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5 text-[14px] leading-7 text-text">{children}</ol>,
  li: ({ children }) => <li className="marker:text-secondary">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-[#0f172a]">{children}</strong>,
  em: ({ children }) => <em className="italic text-secondary">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-accent/25 bg-[#f6f9ff] px-4 py-3 text-[14px] italic leading-7 text-secondary">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-accent underline decoration-accent/30 underline-offset-4"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-5 border-0 border-t border-border" />,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-[18px] border border-border">
      <table className="min-w-full border-collapse text-left text-[13px] leading-6 text-text">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#f8fafc] text-secondary">{children}</thead>,
  th: ({ children }) => <th className="border-b border-border px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t border-border px-3 py-2 align-top">{children}</td>,
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-[20px] border border-[#172033] bg-[#0f172a] px-4 py-4 text-[12px] leading-6 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }: any) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          {...props}
          className="rounded-md bg-[#eef2ff] px-1.5 py-0.5 font-mono text-[12px] text-[#334155]"
        >
          {children}
        </code>
      );
    }

    return (
      <code {...props} className={`${className ?? ""} font-mono text-[12px] leading-6`}>
        {children}
      </code>
    );
  },
} satisfies Components;

export function AssistantMessageContent({
  content,
  rawContent,
  contentFormat,
  isStreaming,
  renderMode,
}: AssistantMessageContentProps) {
  const rawText = normalizeAssistantContent(rawContent ?? content);
  const format = contentFormat ?? detectAssistantContentFormat(rawText);

  if (!rawText) {
    return isStreaming ? (
      <div className="min-h-6 text-[14px] leading-7 text-secondary">
        Thinking
        <StreamingCursor />
      </div>
    ) : null;
  }

  if (renderMode === "raw") {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-[#111827]">
        {rawText}
        {isStreaming && <StreamingCursor />}
      </pre>
    );
  }

  if (isStreaming) {
    return (
      <div className="whitespace-pre-wrap break-words text-[14px] leading-7 text-text">
        {rawText}
        <StreamingCursor />
      </div>
    );
  }

  if (format === "log") {
    return (
      <div className="overflow-hidden rounded-[20px] border border-[#172033] bg-[#0f172a]">
        <pre className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-4 font-mono text-[12px] leading-6 text-slate-100">
          {rawText}
        </pre>
      </div>
    );
  }

  if (format === "markdown") {
    return (
      <div className="space-y-3">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {rawText}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="whitespace-pre-wrap break-words text-[14px] leading-7 text-text">
      {rawText}
    </div>
  );
}
