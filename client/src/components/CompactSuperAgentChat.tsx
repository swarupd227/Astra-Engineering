// TODO: Extract shared chat logic into a useSuperAgentChat() hook
// to eliminate duplication with SuperAgentChat.tsx
import { useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Send,
  Bot,
  User,
  Loader2,
  RefreshCw,
  Sparkles,
  BookOpen,
  Settings,
  MessageSquare,
  ChevronRight,
  CheckCircle,
  ExternalLink,
  History,
  MoreHorizontal,
  Pencil,
  Trash2,
  Ticket,
  Layers,
  Minus,
  Maximize2,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { ASK_DEVX_WELCOME_QUICK_REPLIES } from "@/hooks/use-hosting-config";
import { useMe } from "@/hooks/use-me";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type AssigneeAction = "leave_unassigned" | "assign_resolved" | "assign_manual";

interface ResolvedAssignee {
  displayName: string;
  uniqueName: string;
  mailAddress?: string;
}

interface WorkItemPayload {
  organizationUrl: string;
  projectName: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  testCases?: string[];
  priority: string;
  storyPoints: number;
  assigneeAction?: AssigneeAction;
  assigneeQuery?: string;
  assigneeResolved?: ResolvedAssignee;
  userStory: string;
}

interface AgentMetadata {
  quickReplies: string[];
  missingFields?: string[];
  repositories?: Array<{ id: string; name: string; description?: string }>;
  organizations?: Array<{
    id: string;
    name: string;
    organizationUrl: string;
    projectName: string;
    patConfigured: boolean;
  }>;
  projects?: Array<{ id: string; name: string; description?: string }>;
  generatedStory?: {
    title: string;
    userStory?: string;
    description: string;
    acceptanceCriteria: string[];
    testCases?: string[];
    priority: string;
    storyPoints: number;
    assigneeAction?: AssigneeAction;
    assigneeQuery?: string;
    assigneeResolved?: ResolvedAssignee;
  };
  error?: string;
  canCreateInADO?: boolean;
  workItemPayload?: WorkItemPayload;
  workItemId?: number;
  workItemUrl?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  agentUsed?: string;
  metadata?: AgentMetadata;
}

interface SuperAgentResponse {
  reply: string;
  usedAgent: string;
  metadata: AgentMetadata;
}

interface CreateWorkItemResponse {
  success: boolean;
  workItemId: number;
  workItemUrl: string;
  title: string;
  message: string;
}

interface ConversationTitle {
  conversationId: string;
  title: string;
}

interface BackendMessage {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  isSummarised?: boolean;
}

interface CompactSuperAgentChatProps {
  onClose: () => void;
  onExpand?: () => void;
}

const AGENT_BADGES: Record<
  string,
  { label: string; icon: typeof Bot; color: string }
> = {
  goldenRepo: {
    label: "Golden Repo",
    icon: BookOpen,
    color: "bg-blue-500/10 text-blue-500",
  },
  settings: {
    label: "Settings",
    icon: Settings,
    color: "bg-orange-500/10 text-orange-500",
  },
  ado: {
    label: "ADO Agent",
    icon: Bot,
    color: "bg-cyan-500/10 text-cyan-500",
  },
  jira: {
    label: "Jira Agent",
    icon: Ticket,
    color: "bg-indigo-500/10 text-indigo-500",
  },
  modernization: {
    label: "Modernization",
    icon: Layers,
    color: "bg-amber-500/10 text-amber-500",
  },
  general: {
    label: "General",
    icon: MessageSquare,
    color: "bg-green-500/10 text-green-500",
  },
};

export function CompactSuperAgentChat({ onClose, onExpand }: CompactSuperAgentChatProps) {
  const defaultQuickReplies = useMemo(
    () => [...ASK_DEVX_WELCOME_QUICK_REPLIES],
    [],
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [createdWorkItems, setCreatedWorkItems] = useState<Set<string>>(new Set());

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationSummary, setConversationSummary] = useState<string>("");

  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<ConversationTitle | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const { data: me } = useMe();

  const flushConversationSummary = async (convId: string) => {
    if (!convId) return;
    try {
      await apiRequest("POST", `/api/conversations/${convId}/flush-summary`, {});
    } catch (error) {
      console.error("Failed to flush conversation summary", error);
    }
  };

  const userId = me?.user?.id ?? "";

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!conversationId) return;
      try {
        const url = `/api/conversations/${conversationId}/flush-summary`;
        const body = JSON.stringify({});
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(url, blob);
      } catch (e) {
        console.error("Failed to send flush-summary beacon", e);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [conversationId]);

  const buildWelcomeMessage = (content?: string): ChatMessage => ({
    id: crypto.randomUUID(),
    role: "assistant",
    content:
      content ??
      "Hello! I'm Ask Astra, your intelligent assistant. I can help you explore golden repos, query Azure DevOps or Jira data, explain Stack Modernization upgrades, or answer questions about Astra. What would you like to know?",
    timestamp: new Date(),
    agentUsed: "general",
    metadata: { quickReplies: defaultQuickReplies },
  });

  useEffect(() => {
    setMessages([buildWelcomeMessage()]);
  }, []);

  const defaultQuickRepliesKey = defaultQuickReplies.join("|");
  useEffect(() => {
    setMessages((prev) => {
      if (prev.length !== 1 || prev[0].role !== "assistant") return prev;
      const cur = prev[0].metadata?.quickReplies?.join("|");
      if (cur === defaultQuickRepliesKey) return prev;
      return [
        {
          ...prev[0],
          metadata: { ...prev[0].metadata, quickReplies: defaultQuickReplies },
        },
      ];
    });
  }, [defaultQuickRepliesKey, defaultQuickReplies]);

  const { data: conversationsData, refetch: refetchConversations } = useQuery<{
    conversations: ConversationTitle[];
  }>({
    queryKey: ["/api/conversations/titles", userId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/conversations/titles?userId=${encodeURIComponent(userId)}`,
      );
      return res.json();
    },
    enabled: !!userId,
  });

  const conversationTitles = conversationsData?.conversations ?? [];

  const handleNewChat = async () => {
    if (conversationId) {
      await flushConversationSummary(conversationId);
    }
    setConversationId(null);
    setConversationSummary("");
    setCreatedWorkItems(new Set());
    setMessages([buildWelcomeMessage()]);
  };

  const loadConversation = async (convId: string) => {
    try {
      if (conversationId && conversationId !== convId) {
        await flushConversationSummary(conversationId);
      }
      setConversationId(convId);

      const messagesRes = await apiRequest("GET", `/api/conversations/${convId}/messages`);
      if (!messagesRes.ok) throw new Error("Failed to load messages");
      const messagesData = (await messagesRes.json()) as { messages: BackendMessage[] };

      const summaryRes = await apiRequest("GET", `/api/conversations/${convId}/summary`);
      if (summaryRes.ok) {
        const summaryData = (await summaryRes.json()) as {
          conversation: { summary: string; title: string };
        };
        setConversationSummary(summaryData.conversation.summary ?? "");
      } else {
        setConversationSummary("");
      }

      const uiMessages: ChatMessage[] = messagesData.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: String(m.id),
          role: m.role as "user" | "assistant",
          content: m.content,
          timestamp: new Date(m.createdAt * 1000),
          agentUsed: "general",
        }));

      setCreatedWorkItems(new Set());
      setMessages(
        uiMessages.length > 0
          ? uiMessages
          : [buildWelcomeMessage("This conversation has no messages yet. Start by asking something.")],
      );
    } catch (error) {
      console.error("Error loading conversation:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load conversation",
        variant: "destructive",
      });
    }
  };

  const startRename = (item: ConversationTitle) => {
    setEditingConversationId(item.conversationId);
    setEditingTitle(item.title);
  };

  const cancelRename = () => {
    setEditingConversationId(null);
    setEditingTitle("");
  };

  const submitRename = async (convId: string) => {
    const newTitle = editingTitle.trim();
    if (!newTitle) {
      toast({ title: "Title required", description: "Please enter a title before saving.", variant: "destructive" });
      return;
    }
    try {
      const res = await apiRequest("PUT", `/api/conversations/${convId}/title`, { title: newTitle });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.details || "Failed to rename conversation");
      }
      await refetchConversations();
      setEditingConversationId(null);
      setEditingTitle("");
      toast({ title: "Updated", description: "Conversation title updated." });
    } catch (error) {
      console.error("Rename error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to rename conversation.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    try {
      const res = await apiRequest("DELETE", `/api/conversations/${convId}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.details || "Failed to delete conversation");
      }
      if (conversationId === convId) handleNewChat();
      await refetchConversations();
      toast({ title: "Deleted", description: "Conversation deleted successfully." });
    } catch (error) {
      console.error("Delete error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete conversation.",
        variant: "destructive",
      });
    }
  };

  const chatMutation = useMutation({
    mutationFn: async (payload: {
      message: string;
      conversationId: string | null;
    }): Promise<SuperAgentResponse> => {
      const projectId =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem("sdlc:selectedProjectId")
          : null;
      const projectName =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem("sdlc:selectedProjectName")
          : null;

      const response = await apiRequest("POST", "/api/super-agent/chat", {
        sessionId,
        message: payload.message,
        conversationId: payload.conversationId ?? null,
        summary: conversationSummary || null,
        projectId: projectId || null,
        projectName: projectName || null,
      });
      return response.json();
    },
    onSuccess: (response, variables) => {
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.reply,
        timestamp: new Date(),
        agentUsed: response.usedAgent,
        metadata: response.metadata,
      };
      setMessages((prev) => [...prev, assistantMessage]);

      if (variables.conversationId) {
        (async () => {
          try {
            await apiRequest("POST", `/api/conversations/${variables.conversationId}/messages`, {
              role: "assistant",
              content: response.reply,
            });
          } catch (error) {
            console.error("Failed to persist assistant message:", error);
          }
        })();
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to get response",
        variant: "destructive",
      });
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "I'm sorry, I encountered an error. Please try again in a moment.",
          timestamp: new Date(),
          agentUsed: "general",
          metadata: { quickReplies: ["Try again"] },
        },
      ]);
    },
  });

  // Enhanced mutation: supports both ADO and Jira work item creation
  const createWorkItemMutation = useMutation({
    mutationFn: async (payload: WorkItemPayload & { integrationType?: "ado" | "jira"; workItemType?: string; projectId?: string }): Promise<any> => {
      // If integrationType is jira, use Jira endpoint
      if (payload.integrationType === "jira") {
        // Jira expects: /api/hub/artifacts/:projectName/work-item?projectId=... and body with workItemType, title, description
        const response = await apiRequest(
          "POST",
          `/api/hub/artifacts/${encodeURIComponent(payload.projectName)}/work-item?projectId=${encodeURIComponent(payload.projectId ?? payload.projectName)}`,
          {
            workItemType: payload.workItemType || "Story",
            title: payload.title,
            description: payload.description,
          }
        );
        return response.json();
      } else {
        // Default: ADO
        const response = await apiRequest("POST", "/api/ado/create-work-item", payload);
        return response.json();
      }
    },
    onSuccess: (response: any, payload: any) => {
      // Jira response: { issue, createdAt, updatedAt, createdBy }
      // ADO response: { success, workItemId, workItemUrl, title, message }
      setCreatedWorkItems((prev) => new Set([...Array.from(prev), payload.title]));
      if (payload.integrationType === "jira") {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              `Successfully created Jira Work Item!\n\n**Title:** ${response.issue?.title || payload.title}` +
              (response.issue?.key ? `\n**Key:** ${response.issue.key}` : "") +
              (response.issue?.url ? `\n[Open in Jira](${response.issue.url})` : "") +
              (response.createdAt || response.updatedAt || response.createdBy
                ? `\n\n**Metadata:**` : "") +
              (response.createdAt ? `\n- Created: ${new Date(response.createdAt).toLocaleString()}` : "") +
              (response.updatedAt ? `\n- Updated: ${new Date(response.updatedAt).toLocaleString()}` : "") +
              (response.createdBy ? `\n- Created By: ${response.createdBy}` : ""),
            timestamp: new Date(),
            agentUsed: "general",
            metadata: {
              quickReplies: ["Ask another question", "View settings"],
              workItemId: response.issue?.key,
              workItemUrl: response.issue?.url,
              createdAt: response.createdAt,
              updatedAt: response.updatedAt,
              createdBy: response.createdBy,
            },
          },
        ]);
        toast({ title: "Jira Work Item Created", description: `Jira work item created successfully` });
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Successfully created User Story #${response.workItemId} in Azure DevOps!\n\n**Title:** ${response.title}\n\nYou can view it here: ${response.workItemUrl}`,
            timestamp: new Date(),
            agentUsed: "general",
            metadata: {
              quickReplies: ["Ask another question", "View settings"],
              workItemId: response.workItemId,
              workItemUrl: response.workItemUrl,
            },
          },
        ]);
        toast({ title: "Work Item Created", description: `User Story #${response.workItemId} created successfully` });
      }
    },
    onError: (error, payload: any) => {
      toast({
        title: `Failed to Create Work Item`,
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Failed to create the work item in ${payload.integrationType === "jira" ? "Jira" : "Azure DevOps"}. ${error instanceof Error ? error.message : "Please try again."}`,
          timestamp: new Date(),
          agentUsed: "general",
          metadata: { quickReplies: ["Try again", "Ask another question"] },
        },
      ]);
    },
  });

  // Enhanced handler: supports both ADO and Jira
  const handleCreateInADO = async (payload: WorkItemPayload & { integrationType?: "ado" | "jira"; workItemType?: string; projectId?: string }) => {
    if (createdWorkItems.has(payload.title)) {
      toast({ title: "Already Created", description: `This work item has already been created in ${payload.integrationType === "jira" ? "Jira" : "Azure DevOps"}` });
      return;
    }

    if (payload.integrationType === "jira") {
      // For Jira, just pass through the required fields
      createWorkItemMutation.mutate({
        ...payload,
        integrationType: "jira",
      });
    } else {
      // Default: ADO logic (existing)
      const finalPayload: Record<string, unknown> = {
        organizationUrl: payload.organizationUrl,
        projectName: payload.projectName,
        title: payload.title,
        description: payload.description,
        acceptanceCriteria: payload.acceptanceCriteria,
        testCases: payload.testCases || [],
        priority: payload.priority,
        storyPoints: payload.storyPoints,
        userStory: payload.userStory,
      };

      const action = payload.assigneeAction || "leave_unassigned";
      finalPayload.assigneeAction = action;

      if (action === "assign_resolved" && payload.assigneeResolved?.uniqueName) {
        finalPayload.assigneeResolved = payload.assigneeResolved;
      } else if (action === "assign_manual" && payload.assigneeQuery) {
        try {
          const resolveResponse = await apiRequest("POST", "/api/ado/resolve-assignee", {
            organizationUrl: payload.organizationUrl,
            projectName: payload.projectName,
            assigneeName: payload.assigneeQuery,
          });
          const resolveResult = await resolveResponse.json();
          if (resolveResult.success && resolveResult.resolved && resolveResult.identity) {
            finalPayload.assigneeAction = "assign_resolved";
            finalPayload.assigneeResolved = resolveResult.identity;
          } else {
            toast({ title: "Assignee Not Found", description: `Could not verify "${payload.assigneeQuery}". Creating unassigned.` });
            finalPayload.assigneeAction = "leave_unassigned";
          }
        } catch {
          toast({ title: "Assignee Resolution Error", description: "Could not verify assignee. Creating unassigned." });
          finalPayload.assigneeAction = "leave_unassigned";
        }
      }

      createWorkItemMutation.mutate(finalPayload as unknown as WorkItemPayload);
    }
  };

  const handleSendMessage = async (messageText?: string) => {
    const message = messageText || inputValue.trim();
    if (!message || chatMutation.isPending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");

    let currentConversationId = conversationId;

    try {
      if (!currentConversationId) {
        const convRes = await apiRequest("POST", "/api/conversations", {
          userId,
          firstMessage: message,
        });
        if (!convRes.ok) {
          const errData = await convRes.json().catch(() => null);
          throw new Error(errData?.details || "Failed to create conversation");
        }
        const convData = (await convRes.json()) as { conversationId: string; title: string };
        currentConversationId = convData.conversationId;
        setConversationId(currentConversationId);
        refetchConversations();
      }

      if (currentConversationId) {
        const res = await apiRequest("POST", `/api/conversations/${currentConversationId}/messages`, {
          role: "user",
          content: message,
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.details || "Failed to save your message");
        }
      }

      chatMutation.mutate({ message, conversationId: currentConversationId });
    } catch (error) {
      console.error("Error in handleSendMessage:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send message. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleQuickReply = (reply: string) => {
    handleSendMessage(reply);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleResetSession = async () => {
    try {
      if (conversationId) {
        await flushConversationSummary(conversationId);
      }
      await apiRequest("DELETE", `/api/super-agent/session/${sessionId}`);
      setConversationId(null);
      setConversationSummary("");
      setCreatedWorkItems(new Set());
      toast({ title: "Session Reset", description: "Started a new conversation" });
      setMessages([buildWelcomeMessage()]);
    } catch {
      toast({ title: "Error", description: "Failed to reset session", variant: "destructive" });
    }
  };

  const getAgentBadge = (agentUsed?: string) => {
    const agent = AGENT_BADGES[agentUsed || "general"] || AGENT_BADGES.general;
    const Icon = agent.icon;
    return (
      <Badge variant="outline" className={`${agent.color} text-[10px] gap-0.5 px-1.5 py-0`}>
        <Icon className="h-2.5 w-2.5" />
        {agent.label}
      </Badge>
    );
  };

  return (
    <div className="relative flex flex-col h-full bg-background overflow-hidden">
      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteTarget?.title ?? "this conversation"}" and all its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) handleDeleteConversation(deleteTarget.conversationId);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* History slide-out panel (absolute, contained within widget) */}
      {isHistoryOpen && (
        <>
          <div
            className="absolute inset-0 z-[5] bg-black/20"
            onClick={() => setIsHistoryOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 z-10 w-64 flex flex-col border-r bg-card rounded-l-2xl">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <div className="flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" />
                <h3 className="font-semibold text-xs">History</h3>
              </div>
              <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={handleNewChat}>
                New Chat
              </Button>
            </div>
            <ScrollArea className="flex-1 p-2">
              <div className="space-y-1.5">
                {conversationTitles.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No conversation history yet
                  </p>
                ) : (
                  conversationTitles.map((item) => {
                    const isActive = item.conversationId === conversationId;
                    const isEditing = editingConversationId === item.conversationId;

                    return (
                      <div
                        key={item.conversationId}
                        className={cn(
                          "group flex items-center justify-between gap-1.5 rounded-md border px-2 py-1.5 text-xs hover:bg-muted transition",
                          isActive && "bg-muted",
                        )}
                      >
                        <button
                          className="flex-1 text-left min-w-0"
                          onClick={() => {
                            if (!isEditing) {
                              loadConversation(item.conversationId);
                              setIsHistoryOpen(false);
                            }
                          }}
                        >
                          {isEditing ? (
                            <Input
                              autoFocus
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  submitRename(item.conversationId);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelRename();
                                }
                              }}
                              onBlur={() => submitRename(item.conversationId)}
                              className="h-6 text-xs"
                            />
                          ) : (
                            <p className="line-clamp-2">{item.title}</p>
                          )}
                        </button>

                        {!isEditing && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  "h-6 w-6 shrink-0 hover:bg-muted-foreground/10 transition-opacity opacity-0 pointer-events-none",
                                  "group-hover:opacity-100 group-hover:pointer-events-auto",
                                  isActive && "opacity-100 pointer-events-auto",
                                )}
                              >
                                <MoreHorizontal className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-36 text-xs">
                              <DropdownMenuItem onClick={() => startRename(item)} className="flex items-center gap-2">
                                <Pencil className="h-3 w-3" />
                                <span>Rename</span>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(item)}
                                className="flex items-center gap-2 text-red-600 focus:text-red-600"
                              >
                                <Trash2 className="h-3 w-3" />
                                <span>Delete</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-card shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-semibold">Ask Astra</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsHistoryOpen(true)}
            title="History"
          >
            <History className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleResetSession}
            title="Reset session"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {onExpand && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onExpand}
              title="Open full chat"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            title="Minimize"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-2 ${message.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarFallback
                  className={
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }
                >
                  {message.role === "user" ? (
                    <User className="h-3 w-3" />
                  ) : (
                    <Bot className="h-3 w-3" />
                  )}
                </AvatarFallback>
              </Avatar>

              <div
                className={`flex flex-col gap-0.5 max-w-[85%] ${
                  message.role === "user" ? "items-end" : "items-start"
                }`}
              >
                {message.role === "assistant" && message.agentUsed && (
                  <div className="mb-0.5">{getAgentBadge(message.agentUsed)}</div>
                )}

                <div
                  className={`rounded-lg px-3 py-1.5 ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {message.role === "assistant" ? (
                    <div className="text-xs prose prose-sm dark:prose-invert max-w-none prose-p:my-0.5 prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0 prose-headings:my-1 prose-strong:text-foreground">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-xs whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>

                {message.role === "assistant" &&
                  message.metadata?.quickReplies &&
                  message.metadata.quickReplies.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {message.metadata.quickReplies.map((reply, index) => (
                        <Button
                          key={index}
                          variant="outline"
                          size="sm"
                          className="text-[10px] h-6 gap-0.5 px-2"
                          onClick={() => handleQuickReply(reply)}
                          disabled={chatMutation.isPending}
                        >
                          <ChevronRight className="h-2.5 w-2.5" />
                          {reply}
                        </Button>
                      ))}
                    </div>
                  )}

                {message.metadata?.canCreateInADO &&
                  message.metadata?.workItemPayload && (
                    <div className="mt-2">
                      {createdWorkItems.has(message.metadata.workItemPayload.title) ? (
                        <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                          <CheckCircle className="h-3 w-3" />
                          <span className="text-xs">Work item created</span>
                          {message.metadata.workItemUrl && (
                            <a
                              href={message.metadata.workItemUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline flex items-center gap-0.5 text-xs"
                            >
                              View <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>
                      ) : (
                        <Button
                          onClick={() => handleCreateInADO(message.metadata!.workItemPayload!)}
                          disabled={createWorkItemMutation.isPending}
                          size="sm"
                          className="gap-1.5 h-7 text-xs"
                        >
                          {createWorkItemMutation.isPending ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-3 w-3" />
                              Create in ADO
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  )}

                {message.metadata?.workItemId &&
                  message.metadata?.workItemUrl &&
                  !message.metadata?.canCreateInADO && (
                    <div className="mt-1 flex items-center gap-1.5 text-green-600 dark:text-green-400">
                      <CheckCircle className="h-3 w-3" />
                      <span className="text-xs">Work Item #{message.metadata.workItemId}</span>
                      <a
                        href={message.metadata.workItemUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-0.5 text-xs"
                      >
                        Open <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                  )}
              </div>
            </div>
          ))}

          {chatMutation.isPending && (
            <div className="flex gap-2">
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarFallback className="bg-muted">
                  <Bot className="h-3 w-3" />
                </AvatarFallback>
              </Avatar>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-xs">Thinking...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-2 shrink-0">
        <div className="flex items-end gap-1.5">
          <Textarea
            ref={textareaRef}
            rows={1}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            className="min-h-0 h-10 max-h-[80px] resize-none text-xs"
            disabled={chatMutation.isPending}
          />
          <Button
            onClick={() => handleSendMessage()}
            disabled={!inputValue.trim() || chatMutation.isPending}
            className="shrink-0 h-10 w-10 p-0"
          >
            {chatMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default CompactSuperAgentChat;
