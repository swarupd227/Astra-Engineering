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
import { Loader2, Sparkles, RotateCcw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { waitForAiEnhanceJob } from "@/lib/ai-enhance-poll";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { AiEnhanceLocationKey } from "@/config/ai-enhance-locations";

interface AiEnhanceProps {
  value: string;
  onEnhanced: (enhancedText: string) => void;
  locationKey: AiEnhanceLocationKey;
  placeholderExtraPrompt?: string;
  className?: string;
  buttonSize?: "sm" | "default" | "lg" | "icon";
  buttonVariant?: "default" | "outline" | "ghost" | "secondary";
}

export function AiEnhance({
  value,
  onEnhanced,
  locationKey,
  placeholderExtraPrompt = "Add any additional instructions or context for enhancement (optional)...",
  className = "",
  buttonSize = "sm",
  buttonVariant = "outline",
}: AiEnhanceProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [extraPrompt, setExtraPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [previousValue, setPreviousValue] = useState<string | null>(null);
  const [showUndo, setShowUndo] = useState(false);
  const [useGuidelines, setUseGuidelines] = useState(true);
  const { toast } = useToast();

  // Load any mapped guideline file for this locationKey so we can
  // tell the user what is being used and warn when nothing is mapped.
  const { data: mappingData } = useQuery<{
    mappings: { fileName?: string; filePath: string }[];
  }>({
    queryKey: ["/api/ai-enhance/mappings", locationKey],
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/ai-enhance/mappings?locationKey=${encodeURIComponent(
          locationKey
        )}`
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
  
  // Debug: Log which mapping is being used
  if (mappedFile && process.env.NODE_ENV === "development") {
    console.log(`[AI Enhance] Using mapping for ${locationKey}:`, {
      fileName: mappedFile.fileName,
      filePath: mappedFile.filePath,
    });
  }

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
      let usedGuidelinesFlag = false;

      if (result.success && typeof result.enhancedText === "string") {
        enhancedText = result.enhancedText;
        usedGuidelinesFlag = !!result.usedGuidelines;
      } else if (result.success && result.jobId) {
        const final = await waitForAiEnhanceJob(result.jobId);
        if (!final.success) {
          throw new Error(final.error);
        }
        enhancedText = final.enhancedText;
        usedGuidelinesFlag = final.usedGuidelines;
      } else {
        throw new Error(result.error || "Failed to enhance text");
      }

      if (enhancedText) {
        setPreviousValue(value);
        setShowUndo(true);

        onEnhanced(enhancedText);

        setDialogOpen(false);
        setExtraPrompt("");

        if (usedGuidelinesFlag && mappedFile?.fileName) {
          toast({
            title: "Success",
            description: `Text enhanced using guideline file "${mappedFile.fileName}".`,
          });
        } else if (usedGuidelinesFlag && mappedFile) {
          toast({
            title: "Success",
            description: `Text enhanced using mapped guideline file "${mappedFile.filePath}".`,
          });
        } else {
          toast({
            title: "Success",
            description: "Text enhanced without using a mapped guideline file.",
          });
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
    if (previousValue !== null) {
      onEnhanced(previousValue);
      setShowUndo(false);
      setPreviousValue(null);
      toast({
        title: "Undone",
        description: "Changes have been reverted",
      });
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      // Clear extra prompt when dialog closes
      setExtraPrompt("");
      // Reset useGuidelines to default when dialog closes
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
        
        {showUndo && (
          <Button
            type="button"
            size={buttonSize}
            variant="outline"
            onClick={handleUndo}
            className="gap-1.5 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Undo</span>
          </Button>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI Enhance Text
            </DialogTitle>
            <DialogDescription className="space-y-1">
              <p>
                Add optional instructions to guide the AI enhancement, or leave blank for automatic improvement.
                {mappedFile && ` This enhancement will use guidelines from ${mappedFile.fileName || mappedFile.filePath}.`}
              </p>
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
    </>
  );
}
