import React, { useEffect, useState } from "react";
import { useWorkflow } from "../../context/workflow-context";
import type { ConversationMessage } from "@shared/schema";

export default function BrdChatConsole() {
  const {
    requirement,
    userRequirementSummary,
    addConversationMessage,
    conversationMessages,
    setConversationMessages,
    setIsConversationLoading,
    isConversationLoading,
    capturedRequirements,
    askedQuestions,
    complianceGuidelines,
    isRegenerating,
    originalRequirement,
    projectId,
    sdlcProjectId,
  } = useWorkflow();

  const [localInput, setLocalInput] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    // initialize local input with the best available BRD content
    if (userRequirementSummary && userRequirementSummary.length > 10) {
      setLocalInput(userRequirementSummary);
    } else if (requirement && requirement.length > 10) {
      setLocalInput(requirement);
    }
  }, [userRequirementSummary, requirement]);

  const postConversation = async (messageContent: string) => {
    setLastError(null);
    setIsConversationLoading(true);

    // Append user message locally
    const userMsg: ConversationMessage = { role: "user", content: messageContent } as any;
    setConversationMessages([...conversationMessages, userMsg]);

    try {
      const body = {
        conversationHistory: [...conversationMessages, userMsg],
        capturedRequirements: capturedRequirements || {},
        currentPhase: "understanding",
        askedQuestions: askedQuestions || [],
        complianceGuidelines: complianceGuidelines || [],
        isRegenerating: isRegenerating || false,
        originalRequirement: originalRequirement || "",
        projectId: projectId || sdlcProjectId,
      };

      const resp = await fetch("/api/workflow/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Server error: ${resp.status} ${text}`);
      }

      const json = await resp.json();

      // The API returns an object with `question`, `phase`, `quickReplies`, etc.
      const assistantContent = json.question || json; // fallback
      const assistantMsg: ConversationMessage = { role: "assistant", content: String(assistantContent) } as any;

      setConversationMessages((prev) => [...prev, assistantMsg]);

      // If the API indicates readyToGenerate, also add a system hint
      if (json.readyToGenerate) {
        const sys: ConversationMessage = { role: "system", content: "AI indicated ready to generate artifacts." } as any;
        setConversationMessages((prev) => [...prev, sys]);
      }

      setIsConversationLoading(false);
    } catch (err: any) {
      setIsConversationLoading(false);
      setLastError(err?.message || String(err));
      console.error("[BrdChatConsole] Error sending conversation request:", err);
    }
  };

  const handleFeedBrd = async () => {
    const contentToSend = (userRequirementSummary && userRequirementSummary.length > 10) ? userRequirementSummary : requirement;
    if (!contentToSend || contentToSend.length < 10) {
      setLastError("No BRD summary or requirement available to feed to the chatbot.");
      return;
    }
    await postConversation(contentToSend);
  };

  const handleSendManual = async () => {
    if (!localInput || localInput.trim().length === 0) return;
    await postConversation(localInput.trim());
    // keep the textarea content so user can send follow-ups
  };

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, maxWidth: 900 }}>
      <h3 style={{ marginTop: 0 }}>BRD Chat Console</h3>

      <div style={{ marginBottom: 8 }}>
        <label style={{ display: "block", fontSize: 12, color: "#374151" }}>BRD / Requirement (editable)</label>
        <textarea
          value={localInput}
          onChange={(e) => setLocalInput(e.target.value)}
          rows={6}
          style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #d1d5db", fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={handleFeedBrd} disabled={isConversationLoading} style={{ padding: "8px 12px" }}>
          Feed BRD to Chatbot
        </button>
        <button onClick={handleSendManual} disabled={isConversationLoading || !localInput} style={{ padding: "8px 12px" }}>
          Send as Message
        </button>
        <div style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280", alignSelf: "center" }}>
          {isConversationLoading ? "Sending..." : "Idle"}
        </div>
      </div>

      {lastError && (
        <div style={{ marginBottom: 12, color: "#b91c1c" }}>
          Error: {lastError}
        </div>
      )}

      <div style={{ maxHeight: 360, overflowY: "auto", borderTop: "1px solid #f3f4f6", paddingTop: 8 }}>
        {conversationMessages && conversationMessages.length > 0 ? (
          conversationMessages.map((m: any, idx: number) => (
            <div key={idx} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: m.role === "user" ? "#1f2937" : m.role === "assistant" ? "#065f46" : "#374151", fontWeight: 600 }}>
                {m.role.toUpperCase()}
              </div>
              <div style={{ whiteSpace: "pre-wrap", background: m.role === "assistant" ? "#ecfdf5" : "#ffffff", padding: 8, borderRadius: 6, border: "1px solid #e6f4ea" }}>
                {m.content}
              </div>
            </div>
          ))
        ) : (
          <div style={{ color: "#6b7280" }}>No conversation messages yet. Click "Feed BRD to Chatbot" to start.</div>
        )}
      </div>
    </div>
  );
}
