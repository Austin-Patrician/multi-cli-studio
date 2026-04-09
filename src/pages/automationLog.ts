import type { ChatMessage } from "../lib/models";
import { formatStamp } from "./automationUi";

function roleLabel(message: ChatMessage) {
  switch (message.role) {
    case "user":
      return "INPUT";
    case "assistant":
      return message.cliId ? message.cliId.toUpperCase() : "ASSISTANT";
    default:
      return "SYSTEM";
  }
}

export function messageText(message: ChatMessage) {
  return (message.rawContent ?? message.content ?? "").trim();
}

export function orderedMessages(messages: ChatMessage[]) {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftTs = Date.parse(left.message.timestamp);
      const rightTs = Date.parse(right.message.timestamp);
      if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
        return leftTs - rightTs;
      }
      return left.index - right.index;
    })
    .map(({ message }) => message);
}

export function buildAutomationConversationLog(messages: ChatMessage[]) {
  return orderedMessages(messages)
    .map((message) => {
      const text = messageText(message);
      if (!text) return null;
      return [`[${formatStamp(message.timestamp)}] ${roleLabel(message)}`, text].join("\n");
    })
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}
