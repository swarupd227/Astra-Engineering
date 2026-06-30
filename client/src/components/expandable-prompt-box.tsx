import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Copy, Maximize2, ChevronDown, ChevronRight, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ExpandablePromptBoxProps {
  title: string;
  content: string;
  icon?: React.ReactNode;
  onCopy?: () => void;
  showCopyButton?: boolean;
  hideExpandButton?: boolean;
  actionButton?: {
    label: string;
    onClick: () => void;
  };
}

export function ExpandablePromptBox({
  title,
  content,
  icon,
  onCopy,
  showCopyButton = true,
  hideExpandButton = false,
  actionButton,
}: ExpandablePromptBoxProps) {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    onCopy?.();
    toast({
      title: "Copied!",
      description: "Content copied to clipboard",
    });
  };

  return (
    <>
      {/* Normal/Collapsed View */}
      <div className="space-y-3 bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {!hideExpandButton && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-8 w-8 p-0"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            )}
            <label className="text-base font-semibold flex items-center gap-2">
              {icon}
              {title}
            </label>
          </div>
          <div className="flex gap-2">
            {showCopyButton && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
              >
                <Copy className="h-3 w-3 mr-2" />
                Copy
              </Button>
            )}
            {actionButton && (
              <Button
                size="sm"
                onClick={actionButton.onClick}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {actionButton.label}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsFullscreen(true)}
              className="h-8 w-8 p-0"
              title="Expand to fullscreen"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {isExpanded && (
          <textarea
            readOnly
            value={content}
            className="w-full p-3 border border-blue-200 dark:border-blue-700 rounded-lg bg-white dark:bg-gray-900 text-sm resize-none"
            rows={10}
          />
        )}
      </div>

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
            <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden">
              <div className="px-6 py-4 border-b flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  {icon}
                  <h2 className="text-lg font-semibold">{title}</h2>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  {showCopyButton && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopy}
                    >
                      <Copy className="h-3 w-3 mr-2" />
                      Copy All
                    </Button>
                  )}
                </div>
              </div>
              <div className="px-6 py-4 overflow-y-auto max-h-[calc(90vh-120px)]">
                <textarea
                  readOnly
                  value={content}
                  className="w-full p-4 border border-blue-200 dark:border-blue-700 rounded-lg bg-white dark:bg-gray-900 text-sm font-mono resize-none"
                  rows={30}
                />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </>
  );
}
