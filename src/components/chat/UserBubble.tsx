import { useEffect, useState, type ReactNode } from "react";
import { ChatMessage } from "../../lib/models";

const CLI_COLORS: Record<string, string> = {
  codex: "bg-blue-100 text-blue-700",
  claude: "bg-amber-100 text-amber-700",
  gemini: "bg-emerald-100 text-emerald-700",
};

function CopyIcon({ copied = false }: { copied?: boolean }) {
  if (copied) {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M5 10.5l3 3 7-7"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="7" y="3.5" width="9" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4 12.5V7a2 2 0 012-2h1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4.5 6h11m-8.5 0V4.8A1.3 1.3 0 018.3 3.5h3.4A1.3 1.3 0 0113 4.8V6m-7.5 0l.6 8.1A1.5 1.5 0 007.6 15.5h4.8a1.5 1.5 0 001.5-1.4L14.5 6m-5.7 2.5v4m2.4-4v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ActionIconButton({
  label,
  icon,
  onClick,
  disabled = false,
  tone = "neutral",
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-200/90 bg-rose-50/90 text-rose-600 hover:border-rose-300 hover:bg-rose-100 hover:text-rose-700"
      : "border-slate-200/90 bg-white/92 text-slate-500 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${toneClass}`}
    >
      {icon}
    </button>
  );
}

export function UserBubble({
  message,
  onCopy,
  onDelete,
  deleteDisabled = false,
}: {
  message: ChatMessage;
  onCopy?: (content: string) => Promise<boolean> | boolean;
  onDelete?: (messageId: string) => void;
  deleteDisabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const cliBadge = message.cliId ? CLI_COLORS[message.cliId] ?? "bg-gray-100 text-gray-600" : null;
  const time = new Date(message.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  async function handleCopy() {
    if (!onCopy) return;
    const result = await onCopy(message.content);
    if (result !== false) {
      setCopied(true);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {message.cliId && cliBadge && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cliBadge}`}>
            {message.cliId}
          </span>
        )}
        <span className="text-[10px] text-muted">{time}</span>
      </div>

      <div className="flex w-fit max-w-[75%] flex-col items-end gap-1.5">
        <div className="max-w-full rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-sm whitespace-pre-wrap text-white">
          {message.content}
        </div>

        {(onCopy || onDelete) && (
          <div className="flex items-center justify-end gap-1 pr-1">
            {onCopy && (
              <ActionIconButton
                label={copied ? "Copied" : "Copy"}
                icon={<CopyIcon copied={copied} />}
                onClick={() => void handleCopy()}
              />
            )}
            {onDelete && (
              <ActionIconButton
                label="Delete"
                icon={<DeleteIcon />}
                onClick={() => onDelete(message.id)}
                disabled={deleteDisabled}
                tone="danger"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
