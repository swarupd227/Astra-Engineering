import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, Bot, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useWorkflow } from "@/context/workflow-context";
import type { ConversationMessage } from "@shared/schema";

interface ConversationPanelProps {
  onSendMessage: (message: string) => void;
  quickReplies?: string[];
  onQuickReply?: (reply: string) => void;
}

export function ConversationPanel({ onSendMessage, quickReplies, onQuickReply }: ConversationPanelProps) {
  const { conversationMessages, isConversationLoading, uploadedFiles, addUploadedFile } = useWorkflow();
  const [input, setInput] = useState("");
  const [selectedQuickReplies, setSelectedQuickReplies] = useState<string[]>([]);
  const [isSingleSelect] = useState(false); // This component doesn't receive singleSelect flag
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    // Use requestAnimationFrame to ensure DOM is updated before scrolling
    const timer = setTimeout(() => {
      // Try to find the actual scrollable viewport in ScrollArea
      const viewport = scrollContainer.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement;
      
      if (viewport) {
        // Scroll the Radix ScrollArea viewport
        viewport.scrollTop = viewport.scrollHeight;
      } else if (scrollContainer) {
        // Fallback to direct scroll if viewport not found
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [conversationMessages, isConversationLoading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const newHeight = Math.min(textareaRef.current.scrollHeight, 150);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [input]);

  const handleSend = () => {
    const manualInput = input.trim();
    if (!manualInput || isConversationLoading) return;
    
    onSendMessage(manualInput);
    setInput("");
    setSelectedQuickReplies([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach(file => addUploadedFile(file));
    }
  };

  const handleQuickReplyClick = (reply: string) => {
    // If single-select mode, send immediately (like old behavior)
    if (isSingleSelect) {
      setSelectedQuickReplies([]);
      if (onQuickReply) {
        onQuickReply(reply);
      }
      return;
    }
    
    // Otherwise, toggle selection for multi-select
    setSelectedQuickReplies((prev) => {
      if (prev.includes(reply)) {
        // Deselect if already selected
        return prev.filter((r) => r !== reply);
      } else {
        // Add to selection
        return [...prev, reply];
      }
    });
  };

  const handleRemoveChip = (reply: string) => {
    setSelectedQuickReplies((prev) => prev.filter((r) => r !== reply));
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Chat Messages Area */}
      <ScrollArea className="flex-1 px-4 md:px-6" ref={scrollRef}>
        <div className="mx-auto max-w-3xl space-y-6 py-6">
          {conversationMessages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex gap-3 md:gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
              data-testid={`message-${message.role}-${message.id}`}
            >
              {/* Assistant Avatar - left side */}
              {message.role === "assistant" && (
                <Avatar className="h-8 w-8 shrink-0" data-testid="avatar-assistant">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              )}

              {/* Message Bubble */}
              <div
                className={cn(
                  "max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 shadow-sm",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border"
                )}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {message.content}
                </p>
                <p className="mt-2 text-xs opacity-70">
                  {new Date(message.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>

              {/* User Avatar - right side */}
              {message.role === "user" && (
                <Avatar className="h-8 w-8 shrink-0" data-testid="avatar-user">
                  <AvatarFallback className="bg-muted">
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}

          {/* Typing Indicator */}
          {isConversationLoading && (
            <div className="flex gap-3 md:gap-4 animate-in fade-in duration-300" data-testid="typing-indicator">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  <Bot className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <div className="rounded-2xl bg-card border px-4 py-3 shadow-sm">
                <div className="flex gap-1">
                  <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Quick Reply Chips */}
      {quickReplies && quickReplies.length > 0 && !isConversationLoading && (
        <div className="border-t bg-muted/30 px-4 md:px-6 py-3">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs text-muted-foreground mb-2">
              {isSingleSelect ? "Choose one option:" : `Quick replies ${selectedQuickReplies.length > 0 ? `(${selectedQuickReplies.length} selected)` : ""}`}:
            </p>
            <div className="flex flex-wrap gap-2">
              {quickReplies
                .filter((reply) => !selectedQuickReplies.includes(reply))
                .map((reply, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickReplyClick(reply)}
                    data-testid={`quick-reply-${index}`}
                    className="hover-elevate active-elevate-2 transition-all"
                  >
                    {reply}
                  </Button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* File Upload Indicator */}
      {uploadedFiles.length > 0 && (
        <div className="border-t bg-muted/30 px-4 md:px-6 py-2">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs text-muted-foreground">
              {uploadedFiles.length} file{uploadedFiles.length > 1 ? "s" : ""} attached
            </p>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t bg-card px-4 md:px-6 py-4 shadow-lg">
        <div className="mx-auto max-w-3xl">
          <div className="flex gap-2">
            {/* File Upload Button */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
              multiple
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
              data-testid="input-file-upload"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isConversationLoading}
              data-testid="button-attach-file"
              className="shrink-0"
            >
              <Paperclip className="h-5 w-5" />
            </Button>

            {/* Text Input */}
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your response... (Shift+Enter for new line)"
              disabled={isConversationLoading}
              data-testid="input-message"
              className="min-h-[44px] max-h-[150px] resize-none"
              rows={1}
            />

            {/* Send Button */}
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isConversationLoading}
              data-testid="button-send-message"
              className="shrink-0"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
