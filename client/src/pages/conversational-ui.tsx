import SuperAgentChat from "@/components/SuperAgentChat";

export default function ConversationalUI() {
  return (
    <div className="flex flex-col h-full" data-testid="conversational-ui-page">
      <SuperAgentChat />
    </div>
  );
}


