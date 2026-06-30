import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";
import type { PhaseConfirmation } from "@shared/schema";

interface PhaseConfirmationCardProps {
  phaseId: string;
  phaseName: string;
  confirmations: PhaseConfirmation[];
  onSubmitConfirmation: (confirmation: PhaseConfirmation) => void;
}

export function PhaseConfirmationCard({
  phaseId,
  phaseName,
  confirmations,
  onSubmitConfirmation,
}: PhaseConfirmationCardProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle2 className="h-5 w-5 text-green-500" data-testid={`icon-status-approved`} />;
      case "rejected":
        return <XCircle className="h-5 w-5 text-red-500" data-testid={`icon-status-rejected`} />;
      case "pending":
        return <Clock className="h-5 w-5 text-yellow-500" data-testid={`icon-status-pending`} />;
      default:
        return <AlertCircle className="h-5 w-5 text-muted-foreground" data-testid={`icon-status-unknown`} />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return <Badge variant="default" className="bg-green-600" data-testid={`badge-status-approved`}>🟢 Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive" data-testid={`badge-status-rejected`}>🔴 Rejected</Badge>;
      case "pending":
        return <Badge variant="secondary" data-testid={`badge-status-pending`}>🟡 Pending</Badge>;
      default:
        return <Badge variant="secondary" data-testid={`badge-status-unknown`}>Unknown</Badge>;
    }
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

  const approvedCount = confirmations.filter(c => c.status === "approved").length;
  const rejectedCount = confirmations.filter(c => c.status === "rejected").length;
  const pendingCount = confirmations.filter(c => c.status === "pending").length;

  const isFullyApproved = approvedCount === 3;
  const hasRejections = rejectedCount > 0;

  return (
    <Card className="border-2" data-testid={`card-phase-confirmation-${phaseId}`}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Phase Confirmation Checkpoint</span>
          {isFullyApproved && (
            <Badge variant="default" className="bg-green-600" data-testid="badge-fully-approved">
              🟢 Ready to Proceed
            </Badge>
          )}
          {hasRejections && (
            <Badge variant="destructive" data-testid="badge-has-rejections">
              🔴 Needs Rework
            </Badge>
          )}
          {!isFullyApproved && !hasRejections && (
            <Badge variant="secondary" data-testid="badge-pending">
              🟡 Awaiting Confirmations ({approvedCount}/3)
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {phaseName} requires 3 confirmations before proceeding to the next phase
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {confirmations.map((confirmation) => (
          <div 
            key={confirmation.id} 
            className="flex items-center justify-between gap-4 p-3 rounded-lg border hover-elevate"
            data-testid={`confirmation-item-${confirmation.confirmerRole}`}
          >
            <div className="flex items-center gap-3 flex-1">
              {getStatusIcon(confirmation.status)}
              <div className="flex-1">
                <div className="font-medium text-sm" data-testid={`text-confirmer-role-${confirmation.confirmerRole}`}>
                  {getRoleName(confirmation.confirmerRole)}
                </div>
                {confirmation.confirmerName && (
                  <div className="text-xs text-muted-foreground" data-testid={`text-confirmer-name-${confirmation.confirmerRole}`}>
                    {confirmation.confirmerName}
                  </div>
                )}
                {confirmation.comments && (
                  <div className="text-xs text-muted-foreground mt-1" data-testid={`text-confirmer-comments-${confirmation.confirmerRole}`}>
                    "{confirmation.comments}"
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(confirmation.status)}
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSubmitConfirmation(confirmation)}
                data-testid={`button-submit-confirmation-${confirmation.confirmerRole}`}
              >
                {confirmation.status === "pending" ? "Submit" : "Update"}
              </Button>
            </div>
          </div>
        ))}

        {confirmations.length === 0 && (
          <div className="text-center py-4 text-muted-foreground" data-testid="text-no-confirmations">
            No confirmations initialized for this phase
          </div>
        )}

        {isFullyApproved && (
          <div className="mt-4 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg" data-testid="alert-ready-to-proceed">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <div className="font-medium">All confirmations approved!</div>
            </div>
            <div className="text-sm text-green-600 dark:text-green-500 mt-1">
              This phase is ready to proceed to the next stage.
            </div>
          </div>
        )}

        {hasRejections && (
          <div className="mt-4 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg" data-testid="alert-needs-rework">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <XCircle className="h-5 w-5" />
              <div className="font-medium">Phase requires rework</div>
            </div>
            <div className="text-sm text-red-600 dark:text-red-500 mt-1">
              Please address the feedback and resubmit for approval.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
