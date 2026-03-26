import { useEffect } from "react";
import { useStore } from "../lib/store";
import { HandoffTimeline } from "../components/HandoffTimeline";
import { ConversationHistory } from "../components/ConversationHistory";

export function HandoffPage() {
  const contextStore = useStore((s) => s.contextStore);
  const loadContextStore = useStore((s) => s.loadContextStore);

  useEffect(() => {
    loadContextStore();
  }, []);

  const enrichedHandoffs = contextStore?.handoffs ?? [];

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-semibold text-text mb-6">Handoff History</h1>

      <HandoffTimeline handoffs={enrichedHandoffs} />

      <div className="mt-8">
        <ConversationHistory />
      </div>
    </div>
  );
}
