import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CheckCircle2, XCircle } from "lucide-react";
import type { PhaseConfirmation } from "@shared/schema";

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confirmation: PhaseConfirmation | null;
  onSubmit: (data: { status: string; confirmerName: string; comments: string }) => void;
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  confirmation,
  onSubmit,
}: ConfirmationDialogProps) {
  const [status, setStatus] = useState<string>("pending");
  const [confirmerName, setConfirmerName] = useState<string>("");
  const [comments, setComments] = useState<string>("");

  // Reset state when confirmation changes or dialog opens
  useEffect(() => {
    if (confirmation && open) {
      setStatus(confirmation.status || "pending");
      setConfirmerName(confirmation.confirmerName || "");
      setComments(confirmation.comments || "");
    }
  }, [confirmation, open]);

  const handleSubmit = () => {
    onSubmit({
      status,
      confirmerName: confirmerName.trim(),
      comments: comments.trim(),
    });
    onOpenChange(false);
  };

  const getRoleName = (role: string) => {
    switch (role) {
      case "business":
        return "Business/Product Owner";
      case "technical":
        return "Technical Lead/Architect";
      case "qa":
        return "QA/Reviewer";
      default:
        return role;
    }
  };

  if (!confirmation) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-phase-confirmation">
        <DialogHeader>
          <DialogTitle>Submit Confirmation</DialogTitle>
          <DialogDescription>
            Provide your confirmation for {getRoleName(confirmation.confirmerRole)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="confirmer-name">Your Name</Label>
            <Input
              id="confirmer-name"
              placeholder="Enter your name"
              value={confirmerName}
              onChange={(e) => setConfirmerName(e.target.value)}
              data-testid="input-confirmer-name"
            />
          </div>

          <div className="space-y-2">
            <Label>Confirmation Decision</Label>
            <RadioGroup value={status} onValueChange={setStatus}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="approved" id="status-approved" data-testid="radio-status-approved" />
                <label htmlFor="status-approved" className="flex items-center gap-2 cursor-pointer text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Approve - Requirements met, ready to proceed
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="rejected" id="status-rejected" data-testid="radio-status-rejected" />
                <label htmlFor="status-rejected" className="flex items-center gap-2 cursor-pointer text-sm">
                  <XCircle className="h-4 w-4 text-red-500" />
                  Reject - Needs rework and corrections
                </label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comments">Comments {status === "rejected" && <span className="text-red-500">*</span>}</Label>
            <Textarea
              id="comments"
              placeholder={
                status === "approved"
                  ? "Optional: Add any comments or feedback..."
                  : "Required: Explain what needs to be corrected..."
              }
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={4}
              data-testid="textarea-comments"
            />
            {status === "rejected" && !comments.trim() && (
              <p className="text-xs text-red-500">Comments are required when rejecting</p>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-confirmation"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!confirmerName.trim() || (status === "rejected" && !comments.trim())}
              data-testid="button-submit-confirmation"
            >
              Submit Confirmation
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
