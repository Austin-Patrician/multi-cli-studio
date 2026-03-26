import { ProjectBar } from "../components/chat/ProjectBar";
import { ChatConversation } from "../components/chat/ChatConversation";
import { ChatPromptBar } from "../components/chat/ChatPromptBar";
import { GitPanel } from "../components/chat/GitPanel";
import { TerminalTabStrip } from "../components/chat/TerminalTabStrip";

export function TerminalPage() {
  return (
    <div className="h-full flex flex-col bg-bg">
      <TerminalTabStrip />
      <ProjectBar />
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <ChatConversation />
          <ChatPromptBar />
        </div>
        <GitPanel />
      </div>
    </div>
  );
}
