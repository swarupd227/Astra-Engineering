import { useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
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
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { ASK_DEVX_WELCOME_QUICK_REPLIES, useAdoAllowed } from "@/hooks/use-hosting-config";
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
  repositories?: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
  organizations?: Array<{
    id: string;
    name: string;
    organizationUrl: string;
    projectName: string;
    patConfigured: boolean;
  }>;
  projects?: Array<{
    id: string;
    name: string;
    description?: string;
  }>;
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

const AGENT_BADGES: Record<
  string,
  { label: string; icon: typeof Bot; color: string }
> = {
  // Removed story agent badge - disabled
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

export function SuperAgentChat() {
  const defaultQuickReplies = useMemo(
    () => [...ASK_DEVX_WELCOME_QUICK_REPLIES],
    [],
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [createdWorkItems, setCreatedWorkItems] = useState<Set<string>>(
    new Set(),
  );

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationSummary, setConversationSummary] = useState<string>("");

  const [editingConversationId, setEditingConversationId] = useState<
    string | null
  >(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<ConversationTitle | null>(
    null,
  );
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const adoAllowed = useAdoAllowed();

  // =======================================
  // Helper functions - Added for conversational UI history
  // =======================================
  const flushConversationSummary = async (convId: string) => {
    if (!convId) return;
    try {
      await apiRequest(
        "POST",
        `/api/conversations/${convId}/flush-summary`,
        {},
      );
    } catch (error) {
      console.error("Failed to flush conversation summary", error);
      // no toast here: this is a background housekeeping call
    }
  };

  // Use a simple user ID for conversation history (Replit environment)
  const userId = useMemo(() => {
    // Try to get a persistent user ID from localStorage, or create one
    const storedId = localStorage.getItem('superagent-user-id');
    if (storedId) return storedId;
    const newId = `user-${crypto.randomUUID()}`;
    localStorage.setItem('superagent-user-id', newId);
    return newId;
  }, []);

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
        // sendBeacon is best-effort; no await
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
      "Hello! I'm Ask Astra, your intelligent assistant for the Astra platform. I can help you understand Astra features, explore golden repository templates, query Azure DevOps or Jira data, walk you through Stack Modernization (tech stack upgrades), or provide guidance on using the platform. What would you like to know today?",
    timestamp: new Date(),
    agentUsed: "general",
    metadata: {
      quickReplies: defaultQuickReplies,
    },
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
    // flush current conversation summary before starting a new one
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
      // Flush previous conversation (if any) before switching
      if (conversationId && conversationId !== convId) {
        await flushConversationSummary(conversationId);
      }

      setConversationId(convId);

      // 1) Messages
      const messagesRes = await apiRequest(
        "GET",
        `/api/conversations/${convId}/messages`,
      );
      if (!messagesRes.ok) {
        throw new Error("Failed to load messages");
      }
      const messagesData = (await messagesRes.json()) as {
        messages: BackendMessage[];
      };

      const summaryRes = await apiRequest(
        "GET",
        `/api/conversations/${convId}/summary`,
      );
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
          : [
              buildWelcomeMessage(
                "This conversation has no messages yet. Start by asking something about your Agile stories or repositories.",
              ),
            ],
      );
    } catch (error) {
      console.error("Error loading conversation:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to load conversation",
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
      toast({
        title: "Title required",
        description: "Please enter a title before saving.",
        variant: "destructive",
      });
      return;
    }

    try {
      const res = await apiRequest(
        "PUT",
        `/api/conversations/${convId}/title`,
        { title: newTitle },
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.details || "Failed to rename conversation");
      }
      await refetchConversations();
      setEditingConversationId(null);
      setEditingTitle("");
      toast({
        title: "Updated",
        description: "Conversation title updated.",
      });
    } catch (error) {
      console.error("Rename error:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to rename conversation.",
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

      if (conversationId === convId) {
        handleNewChat();
      }

      await refetchConversations();

      toast({
        title: "Deleted",
        description: "Conversation deleted successfully.",
      });
    } catch (error) {
      console.error("Delete error:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to delete conversation.",
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
        conversationId: payload.conversationId ?? null, // NEW
        summary: conversationSummary || null, // NEW
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
            await apiRequest(
              "POST",
              `/api/conversations/${variables.conversationId}/messages`,
              {
                role: "assistant",
                content: response.reply,
              },
            );
          } catch (error) {
            console.error(
              "Failed to persist assistant message to conversation:",
              error,
            );
          }
        })();
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to get response",
        variant: "destructive",
      });
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "I'm sorry, I encountered an error. Please try again in a moment.",
        timestamp: new Date(),
        agentUsed: "general",
        metadata: {
          quickReplies: ["Try again"],
        },
      };
      setMessages((prev) => [...prev, errorMessage]);
    },
  });

  const createWorkItemMutation = useMutation({
    mutationFn: async (
      payload: WorkItemPayload,
    ): Promise<CreateWorkItemResponse> => {
      const response = await apiRequest(
        "POST",
        "/api/ado/create-work-item",
        payload,
      );
      return response.json();
    },
    onSuccess: (response: CreateWorkItemResponse, payload: WorkItemPayload) => {
      setCreatedWorkItems((prev) => new Set([...Array.from(prev), payload.title]));

      const successMessage: ChatMessage = {
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
      };
      setMessages((prev) => [...prev, successMessage]);

      toast({
        title: "Work Item Created",
        description: `User Story #${response.workItemId} created successfully`,
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to Create Work Item",
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });

      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Failed to create the work item in Azure DevOps. ${
          error instanceof Error ? error.message : "Please try again."
        }`,
        timestamp: new Date(),
        agentUsed: "general",
        metadata: {
          quickReplies: ["Try again", "Ask another question"],
        },
      };
      setMessages((prev) => [...prev, errorMessage]);
    },
  });

  const handleCreateInADO = async (payload: WorkItemPayload) => {
    if (!adoAllowed) {
      toast({ title: "Unavailable", description: "Azure DevOps is not available in AWS hosting mode." });
      return;
    }
    if (createdWorkItems.has(payload.title)) {
      toast({
        title: "Already Created",
        description: "This work item has already been created in Azure DevOps",
      });
      return;
    }

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
        const resolveResponse = await apiRequest(
          "POST",
          "/api/ado/resolve-assignee",
          {
            organizationUrl: payload.organizationUrl,
            projectName: payload.projectName,
            assigneeName: payload.assigneeQuery,
          },
        );
        const resolveResult = await resolveResponse.json();

        if (
          resolveResult.success &&
          resolveResult.resolved &&
          resolveResult.identity
        ) {
          finalPayload.assigneeAction = "assign_resolved";
          finalPayload.assigneeResolved = resolveResult.identity;
        } else {
          toast({
            title: "Assignee Not Found",
            description: `Could not verify "${payload.assigneeQuery}" in Azure DevOps. Creating unassigned.`,
          });
          finalPayload.assigneeAction = "leave_unassigned";
        }
      } catch (error) {
        toast({
          title: "Assignee Resolution Error",
          description: "Could not verify assignee. Creating unassigned.",
        });
        finalPayload.assigneeAction = "leave_unassigned";
      }
    }

    createWorkItemMutation.mutate(finalPayload as unknown as WorkItemPayload);
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

        const convData = (await convRes.json()) as {
          conversationId: string;
          title: string;
        };

        currentConversationId = convData.conversationId;
        setConversationId(currentConversationId);
        refetchConversations();
      }

      if (currentConversationId) {
        const res = await apiRequest(
          "POST",
          `/api/conversations/${currentConversationId}/messages`,
          {
            role: "user",
            content: message,
          },
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.details || "Failed to save your message");
        }
      }

      chatMutation.mutate({
        message,
        conversationId: currentConversationId,
      });
    } catch (error) {
      console.error("Error in handleSendMessage:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to send message. Please try again.",
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

  const handleResetSession = () => {
    // Clear UI immediately for instant feedback
    setConversationId(null);
    setConversationSummary("");
    setCreatedWorkItems(new Set());
    setMessages([buildWelcomeMessage()]);
    toast({
      title: "Session Reset",
      description: "Started a new conversation",
    });

    // Perform cleanup operations in the background without blocking UI
    const convId = conversationId;
    if (convId) {
      flushConversationSummary(convId).catch((error) => {
        console.error("Failed to flush conversation summary:", error);
      });
    }

    apiRequest("DELETE", `/api/super-agent/session/${sessionId}`).catch((error) => {
      console.error("Failed to reset session on backend:", error);
    });
  };

  const getAgentBadge = (agentUsed?: string) => {
    const agent = AGENT_BADGES[agentUsed || "general"] || AGENT_BADGES.general;
    const Icon = agent.icon;
    return (
      <Badge variant="outline" className={`${agent.color} text-xs gap-1`}>
        <Icon className="h-3 w-3" />
        {agent.label}
      </Badge>
    );
  };

  return (
    <div className="relative flex h-full bg-background">
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
              This will permanently delete "
              {deleteTarget?.title ?? "this conversation"}" and all its
              messages. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  handleDeleteConversation(deleteTarget.conversationId);
                }
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* History slide-out panel */}
      {isHistoryOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/20"
            onClick={() => setIsHistoryOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-40 w-72 flex flex-col border-r bg-card">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4" />
                <h3 className="font-semibold text-sm">Conversation History</h3>
              </div>
            </div>
            <ScrollArea className="flex-1 p-3">
              <div className="space-y-2">
                {conversationTitles.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No conversation history yet
                  </p>
                ) : (
                  conversationTitles.map((item) => {
                    const isActive = item.conversationId === conversationId;
                    const isEditing =
                      editingConversationId === item.conversationId;

                    return (
                      <div
                        key={item.conversationId}
                        className={cn(
                          "group flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted transition",
                          isActive && "bg-muted",
                        )}
                        data-testid={`history-item-${item.conversationId}`}
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
                              className="h-7 text-xs"
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
                                  "h-7 w-7 shrink-0 hover:bg-muted-foreground/10 transition-opacity opacity-0 pointer-events-none",
                                  "group-hover:opacity-100 group-hover:pointer-events-auto",
                                  isActive && "opacity-100 pointer-events-auto",
                                )}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="w-40 text-xs"
                            >
                              <DropdownMenuItem
                                onClick={() => startRename(item)}
                                className="flex items-center gap-2"
                              >
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

      {/* Main chat */}
      <div className="flex flex-col flex-1">
        <Card className="flex flex-col flex-1 overflow-hidden rounded-none border-0">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-950">
                  <Bot className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">Ask Astra</h1>
                  <p className="text-xs text-muted-foreground">Your intelligent assistant for the Astra platform</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsHistoryOpen(true)}
                  className="gap-1"
                  data-testid="button-open-history"
                >
                  <History className="h-4 w-4" />
                  History
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetSession}
                  className="gap-1"
                  data-testid="button-reset-session"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reset
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${
                      message.role === "user" ? "flex-row-reverse" : ""
                    }`}
                    data-testid={`message-${message.role}-${message.id}`}
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback
                        className={
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }
                      >
                        {message.role === "user" ? (
                          <User className="h-4 w-4" />
                        ) : (
                          <Bot className="h-4 w-4" />
                        )}
                      </AvatarFallback>
                    </Avatar>

                    <div
                      className={`flex flex-col gap-1 max-w-[80%] ${
                        message.role === "user" ? "items-end" : "items-start"
                      }`}
                    >
                      {message.role === "assistant" && message.agentUsed && (
                        <div className="mb-1">
                          {getAgentBadge(message.agentUsed)}
                        </div>
                      )}

                      <div
                        className={`rounded-lg px-4 py-2 ${
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        {message.role === "assistant" ? (
                          <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-strong:text-foreground">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">
                            {message.content}
                          </p>
                        )}
                      </div>

                      {message.role === "assistant" &&
                        message.metadata?.quickReplies &&
                        message.metadata.quickReplies.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {message.metadata.quickReplies.map(
                              (reply, index) => (
                                <Button
                                  key={index}
                                  variant="outline"
                                  size="sm"
                                  className="text-xs h-7 gap-1"
                                  onClick={() => handleQuickReply(reply)}
                                  disabled={chatMutation.isPending}
                                  data-testid={`button-quick-reply-${index}`}
                                >
                                  <ChevronRight className="h-3 w-3" />
                                  {reply}
                                </Button>
                              ),
                            )}
                          </div>
                        )}



                      {message.metadata?.canCreateInADO &&
                        message.metadata?.workItemPayload && (
                          <div className="mt-3">
                            {createdWorkItems.has(
                              message.metadata.workItemPayload.title,
                            ) ? (
                              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                                <CheckCircle className="h-4 w-4" />
                                <span className="text-sm">
                                  Work item created
                                </span>
                                {message.metadata.workItemUrl && (
                                  <a
                                    href={message.metadata.workItemUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:underline flex items-center gap-1"
                                  >
                                    View in ADO
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                            ) : (
                              <Button
                                onClick={() =>
                                  handleCreateInADO(
                                    message.metadata!.workItemPayload!,
                                  )
                                }
                                disabled={createWorkItemMutation.isPending}
                                className="gap-2"
                                data-testid="button-create-in-ado"
                              >
                                {createWorkItemMutation.isPending ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Creating...
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="h-4 w-4" />
                                    Create in Azure DevOps
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                        )}

                      {message.metadata?.workItemId &&
                        message.metadata?.workItemUrl &&
                        !message.metadata?.canCreateInADO && (
                          <div className="mt-2 flex items-center gap-2 text-green-600 dark:text-green-400">
                            <CheckCircle className="h-4 w-4" />
                            <span className="text-sm">
                              Work Item #{message.metadata.workItemId}
                            </span>
                            <a
                              href={message.metadata.workItemUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline flex items-center gap-1"
                            >
                              Open in ADO
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        )}

                      <span className="text-xs text-muted-foreground">
                        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}

                {chatMutation.isPending && (
                  <div className="flex gap-3">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="bg-muted">
                        <Bot className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Thinking...</span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <Separator />

            <div className="p-4">
              <div className="flex gap-2">
                <Textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your message..."
                  className="min-h-[60px] resize-none"
                  disabled={chatMutation.isPending}
                  data-testid="input-chat-message"
                />
                <Button
                  onClick={() => handleSendMessage()}
                  disabled={!inputValue.trim() || chatMutation.isPending}
                  className="shrink-0"
                  data-testid="button-send-message"
                >
                  {chatMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default SuperAgentChat;
