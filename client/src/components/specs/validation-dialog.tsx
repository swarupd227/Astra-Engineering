import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ValidationResult, UserStoryNode } from "./types";

export interface ValidationDialogProps {
  showValidationDialog: boolean;
  setShowValidationDialog: (open: boolean) => void;
  validationResult: ValidationResult | null;
  pendingFeatures: Array<{
    id: number;
    title: string;
    state: string;
    description?: string;
    userStories: UserStoryNode[];
  }>;
  removedAutoAddedIds: Set<number>;
  setRemovedAutoAddedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  skipIdempotent: boolean;
  setSkipIdempotent: (v: boolean) => void;
  generateSpecsForFeatures: (
    features: Array<{
      id: number;
      title: string;
      state: string;
      description?: string;
      userStories: UserStoryNode[];
    }>,
    skipIdempotent?: boolean,
  ) => Promise<void>;
}

export function ValidationDialog({
  showValidationDialog,
  setShowValidationDialog,
  validationResult,
  pendingFeatures,
  removedAutoAddedIds,
  setRemovedAutoAddedIds,
  skipIdempotent,
  setSkipIdempotent,
  generateSpecsForFeatures,
}: ValidationDialogProps) {
  return (
    <Dialog open={showValidationDialog} onOpenChange={setShowValidationDialog}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Review Before Generating</DialogTitle>
          <DialogDescription>
            Check the details below before starting generation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {/* Auto-added features */}
          {validationResult && validationResult.autoAdded.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-blue-600 flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Auto-added related features
              </p>
              <div className="space-y-1">
                {validationResult.autoAdded.map((a) => (
                  <div key={a.id} className={cn("flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs border", removedAutoAddedIds.has(a.id) ? "opacity-40 line-through border-dashed" : "bg-blue-500/5 border-blue-500/20")}>
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{a.title}</span>
                      <span className="text-muted-foreground ml-1">← {a.reason}</span>
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => setRemovedAutoAddedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                        return next;
                      })}
                      title={removedAutoAddedIds.has(a.id) ? "Re-add" : "Remove from batch"}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Warnings */}
          {validationResult && validationResult.warnings.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-amber-600 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Warnings
              </p>
              <ul className="space-y-0.5">
                {validationResult.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-muted-foreground px-2">• {w.message}</li>
                ))}
              </ul>
            </div>
          )}
          {/* Idempotent features */}
          {validationResult && validationResult.idempotentFeatures.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> No changes detected
              </p>
              <ul className="space-y-0.5">
                {pendingFeatures.filter((f) => validationResult.idempotentFeatures.includes(f.id)).map((f) => (
                  <li key={f.id} className="text-xs text-muted-foreground px-2">• {f.title}</li>
                ))}
              </ul>
              <div className="flex items-center gap-2 px-2">
                <input
                  type="checkbox"
                  id="skip-idempotent"
                  checked={skipIdempotent}
                  onChange={(e) => setSkipIdempotent(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <label htmlFor="skip-idempotent" className="text-xs text-muted-foreground cursor-pointer">
                  Skip unchanged features (recommended)
                </label>
              </div>
            </div>
          )}
          {/* Final batch summary */}
          {pendingFeatures.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-emerald-600 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> Will generate ({pendingFeatures.filter((f) => !removedAutoAddedIds.has(f.id) && (!skipIdempotent || !validationResult?.idempotentFeatures.includes(f.id))).length} features)
              </p>
              <div className="flex flex-wrap gap-1 px-2">
                {pendingFeatures.filter((f) => !removedAutoAddedIds.has(f.id) && (!skipIdempotent || !validationResult?.idempotentFeatures.includes(f.id))).map((f) => (
                  <span key={f.id} className="text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded">{f.title}</span>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setShowValidationDialog(false)}>Cancel</Button>
          <Button
            size="sm"
            onClick={async () => {
              setShowValidationDialog(false);
              const finalFeatures = pendingFeatures.filter((f) => !removedAutoAddedIds.has(f.id));
              await generateSpecsForFeatures(finalFeatures, skipIdempotent);
            }}
            disabled={pendingFeatures.filter((f) => !removedAutoAddedIds.has(f.id) && (!skipIdempotent || !validationResult?.idempotentFeatures.includes(f.id))).length === 0}
          >
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
