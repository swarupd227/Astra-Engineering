import { useState } from "react";
import { useLocation } from "wouter";
import { BotMessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProcessingStatus } from "@/contexts/processing-status-context";
import CompactSuperAgentChat from "./CompactSuperAgentChat";

export function FloatingChatWidget() {
  const [location, setLocation] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const { isProcessing } = useProcessingStatus();

  // Hide on landing page and on the full /chat page
  if (location === "/" || location === "/chat") return null;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none overflow-hidden">
      {/* FAB Button with processing ring */}
      <div
        className={cn(
          "absolute bottom-6 right-6 pointer-events-auto",
          "transition-all duration-300 ease-in-out",
          isOpen && "scale-0 opacity-0 pointer-events-none",
        )}
      >
        {/* Animated processing ring */}
        {isProcessing && (
          <div className="absolute inset-[-5px] rounded-full border-[2.5px] border-transparent border-t-violet-400 border-r-violet-400/40 animate-spin" />
        )}
        {/* Pulse glow when processing */}
        {isProcessing && (
          <div className="absolute inset-[-2px] rounded-full bg-violet-500/20 animate-pulse" />
        )}
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Open chat assistant"
          className={cn(
            "relative h-14 w-14 rounded-full shadow-lg cursor-pointer",
            "bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 dark:from-violet-700 dark:via-purple-700 dark:to-indigo-800 text-white hover:shadow-xl",
            "flex items-center justify-center",
            "transition-all duration-300 ease-in-out",
          )}
        >
          <BotMessageSquare className="h-6 w-6" />
        </button>
      </div>

      {/* Floating Chat Panel */}
      <div
        className={cn(
          "absolute bottom-6 right-6 pointer-events-auto",
          "w-[420px] h-[600px]",
          "rounded-2xl border border-border/40 bg-card shadow-2xl overflow-hidden",
          "flex flex-col",
          "transition-all duration-300 ease-in-out origin-bottom-right",
          "max-sm:w-[calc(100vw-1.5rem)] max-sm:h-[calc(100vh-6rem)] max-sm:bottom-3 max-sm:right-3",
          isOpen
            ? "scale-100 opacity-100 translate-y-0"
            : "scale-95 opacity-0 translate-y-4 pointer-events-none",
        )}
      >
        <CompactSuperAgentChat
          onClose={() => setIsOpen(false)}
          onExpand={() => {
            setIsOpen(false);
            setLocation("/chat");
          }}
        />
      </div>
    </div>
  );
}

export default FloatingChatWidget;
