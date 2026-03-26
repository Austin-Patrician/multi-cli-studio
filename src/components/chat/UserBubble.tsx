import { ChatMessage } from "../../lib/models";

const CLI_COLORS: Record<string, string> = {
  codex: "bg-blue-100 text-blue-700",
  claude: "bg-amber-100 text-amber-700",
  gemini: "bg-emerald-100 text-emerald-700",
};

export function UserBubble({ message }: { message: ChatMessage }) {
  const cliBadge = message.cliId ? CLI_COLORS[message.cliId] ?? "bg-gray-100 text-gray-600" : null;
  const time = new Date(message.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {message.cliId && cliBadge && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cliBadge}`}>
            {message.cliId}
          </span>
        )}
        <span className="text-[10px] text-muted">{time}</span>
      </div>
      <div className="max-w-[75%] px-3.5 py-2.5 rounded-2xl rounded-br-md bg-accent text-white text-sm whitespace-pre-wrap">
        {message.content}
      </div>
    </div>
  );
}
