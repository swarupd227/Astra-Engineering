import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, FileText } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { waitForAiEnhanceJob } from "@/lib/ai-enhance-poll";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import SimpleDiffViewer from "./SimpleDiffViewer";
import type { AiEnhanceLocationKey } from "@/config/ai-enhance-locations";

interface AiEnhanceWithDiffProps {
  value: string;
  onEnhanced: (enhancedText: string) => void;
  locationKey: AiEnhanceLocationKey;
  placeholderExtraPrompt?: string;
  className?: string;
  buttonSize?: "sm" | "default" | "lg" | "icon";
  buttonVariant?: "default" | "outline" | "ghost" | "secondary";
  itemName?: string; // e.g., "Acceptance Criteria 1", "User Story Title"
  // Raise the dialogs above a high-z-index overlay (e.g. BRD full-screen view,
  // which sits at z-100). Defaults to normal stacking when omitted.
  elevated?: boolean;
}

export function AiEnhanceWithDiff({
  value,
  onEnhanced,
  locationKey,
  placeholderExtraPrompt = "Add any additional instructions or context for enhancement (optional)...",
  className = "",
  buttonSize = "sm",
  buttonVariant = "outline",
  itemName = "Text",
  elevated = false,
}: AiEnhanceWithDiffProps) {
  // When rendered over a high z-index layer (BRD full-screen = z-100), the
  // default dialog stacking (z-50) hides the dialog behind that layer. Bump both
  // the overlay and content above it so the dialog is visible and clickable.
  const elevatedZ = "z-[150]";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [diffDialogOpen, setDiffDialogOpen] = useState(false);
  const [extraPrompt, setExtraPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [originalValue, setOriginalValue] = useState(value);
  const [enhancedValue, setEnhancedValue] = useState<string | null>(null);
  const [useGuidelines, setUseGuidelines] = useState(true);
  const { toast } = useToast();

  const hasEnhancement = enhancedValue && enhancedValue !== originalValue;

  // Update original value when prop changes
  useEffect(() => {
    if (value !== originalValue && !hasEnhancement) {
      setOriginalValue(value);
    }
  }, [value]);

  // Load any mapped guideline file for this locationKey
  const { data: mappingData } = useQuery<{
    mappings: { fileName?: string; filePath: string }[];
  }>({
    queryKey: ["/api/ai-enhance/mappings", locationKey],
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/ai-enhance/mappings?locationKey=${encodeURIComponent(locationKey)}`
      );
      return response.json();
    },
  });

  const mappedFile = mappingData?.mappings?.[0];
  
  // Set default useGuidelines based on whether a mapped file exists
  useEffect(() => {
    if (mappedFile) {
      setUseGuidelines(true);
    }
  }, [mappedFile]);

  const handleEnhance = async () => {
    if (!value || value.trim().length === 0) {
      toast({
        title: "Error",
        description: "Please provide text to enhance",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const response = await apiRequest("POST", "/api/ai/enhance", {
        locationKey: mappedFile ? locationKey : undefined,
        text: value,
        extraPrompt: extraPrompt.trim() || undefined,
        useGuidelines: useGuidelines && !!mappedFile,
      });

      const result = await response.json();

      let enhancedText: string | undefined;

      if (result.success && typeof result.enhancedText === "string") {
        enhancedText = result.enhancedText;
      } else if (result.success && result.jobId) {
        const final = await waitForAiEnhanceJob(result.jobId);
        if (!final.success) {
          throw new Error(final.error);
        }
        enhancedText = final.enhancedText;
      } else {
        throw new Error(result.error || "Failed to enhance text");
      }

      if (enhancedText) {
        setOriginalValue(value);
        setEnhancedValue(enhancedText);

        setDialogOpen(false);
        setExtraPrompt("");

        if (enhancedText !== value) {
          setDiffDialogOpen(true);
        } else {
          onEnhanced(enhancedText);
        }
      } else {
        throw new Error("Failed to enhance text");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to enhance text. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = () => {
    if (originalValue) {
      onEnhanced(originalValue);
      setEnhancedValue(null);
      setShowUndo(false);
      toast({
        title: "Undone",
        description: "Changes have been reverted to original text",
      });
    }
  };

  const handleDiffSave = (updatedText: string) => {
    // Update the enhanced value state
    setEnhancedValue(updatedText);
    
    // Call the parent's onEnhanced callback to update the form field
    onEnhanced(updatedText);
    
    // Close the diff dialog
    setDiffDialogOpen(false);
    
    // Also close the main enhancement dialog
    setDialogOpen(false);
    
    // Clear any temporary states
    setExtraPrompt("");
    if (mappedFile) {
      setUseGuidelines(true);
    }
    
    // Note: Parent component will handle success notification
  };

  const handleDiffCancel = () => {
    // Don't apply any changes, just close the dialog
    setDiffDialogOpen(false);
    toast({
      title: "Changes Discarded", 
      description: "Original text has been preserved",
    });
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setExtraPrompt("");
      if (mappedFile) {
        setUseGuidelines(true);
      }
    }
  };

  return (
    <>
      <div className={cn("flex items-center gap-2", className)}>
        <Button
          type="button"
          size={buttonSize}
          variant={buttonVariant}
          onClick={() => setDialogOpen(true)}
          disabled={!value || value.trim().length === 0}
          className="gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>AI Enhance</span>
        </Button>
      </div>

      {/* Enhancement Dialog */}
      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className={cn("sm:max-w-[500px]", elevated && elevatedZ)}
          overlayClassName={elevated ? elevatedZ : undefined}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI Enhance {itemName}
            </DialogTitle>
            <DialogDescription className="space-y-1">
              <span>
                Add optional instructions to guide the AI enhancement, or leave blank for automatic improvement.
                {mappedFile && ` This enhancement will use guidelines from ${mappedFile.fileName || mappedFile.filePath}.`}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {mappedFile && (
              <div className="flex items-center space-x-2 rounded-md border p-3">
                <Checkbox
                  id="use-guidelines"
                  checked={useGuidelines}
                  onCheckedChange={(checked) => setUseGuidelines(checked === true)}
                  disabled={loading}
                />
                <Label
                  htmlFor="use-guidelines"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
                >
                  Use mapped guideline
                </Label>
              </div>
            )}
            
            <div className="space-y-2">
              {mappedFile && (
                <p className={cn(
                  "text-xs",
                  useGuidelines 
                    ? "text-muted-foreground" 
                    : "text-yellow-600 dark:text-yellow-400"
                )}>
                  {useGuidelines 
                    ? `Using guidelines from "${mappedFile.fileName || mappedFile.filePath}"`
                    : "Not using mapped guideline. Enhancement will use generic rules."}
                </p>
              )}
              {!mappedFile && (
                <p className="text-xs text-yellow-600 dark:text-yellow-400">
                  No guideline file is mapped for this field. Enhancement will use generic rules unless you map a file in Settings.
                </p>
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="extra-prompt" className="text-sm font-medium">
                Additional Instructions (Optional)
              </Label>
              <Textarea
                id="extra-prompt"
                placeholder={placeholderExtraPrompt}
                value={extraPrompt}
                onChange={(e) => setExtraPrompt(e.target.value)}
                className="min-h-[100px] resize-none"
                disabled={loading}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleEnhance}
              disabled={loading || !value || value.trim().length === 0}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enhancing...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Enhance
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diff Viewer Dialog */}
      <Dialog open={diffDialogOpen} onOpenChange={setDiffDialogOpen}>
        <DialogContent
          className={cn(
            "max-w-7xl w-[95vw] h-[95vh] p-0 flex flex-col",
            elevated && elevatedZ
          )}
          overlayClassName={elevated ? elevatedZ : undefined}
        >
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {itemName} Enhancement Review
            </DialogTitle>
            <DialogDescription>
              Review the AI-enhanced text below. You can edit the enhanced version in the right panel, 
              then choose to apply the changes or keep the original text.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 p-6 pt-4" style={{ minHeight: 0 }}>
            {hasEnhancement && (
              <SimpleDiffViewer
                original={originalValue}
                modified={enhancedValue!}
                onModifiedChange={setEnhancedValue}
                title={`${itemName} Enhancement`}
                className="h-full"
              />
            )}
          </div>

          <DialogFooter className="p-6 pt-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleDiffCancel}
            >
              Keep Original
            </Button>
            <Button
              type="button"
              onClick={() => handleDiffSave(enhancedValue!)}
              className="bg-green-600 hover:bg-green-700"
            >
              Apply Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default AiEnhanceWithDiff;