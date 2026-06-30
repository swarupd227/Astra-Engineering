import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, MoreVertical, Edit, Trash2, Shield, Loader2, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface OrganizationCardProps {
  name: string;
  projectCount: number;
  memberCount: number;
  status: "active" | "inactive";
  updatedAt?: string;
  isLoadingCount?: boolean;
  isCheckingAccess?: boolean;
  patConfigured?: boolean;
  integrationType?: "ado" | "jira";
  ownerInfo?: {
    id?: string | null;
    email?: string | null;
    displayName?: string | null;
  } | null;
  onViewDetails?: () => void;
  onViewProjects?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPermissions?: () => void;
}

export function OrganizationCard({
  name,
  projectCount,
  memberCount,
  status,
  updatedAt,
  isLoadingCount = false,
  isCheckingAccess = false,
  patConfigured = false,
  integrationType = "ado",
  ownerInfo,
  onViewDetails,
  onViewProjects,
  onEdit,
  onDelete,
  onPermissions,
}: OrganizationCardProps) {
  const formattedUpdatedAt =
    updatedAt
      ? new Date(updatedAt).toISOString().slice(0, 10)
      : null;
  const ownerLabel =
    ownerInfo?.displayName?.trim() ||
    ownerInfo?.email?.trim() ||
    "Unknown";

  return (
    <Card
      className={`hover-elevate py-2 border-l-[3px] ${
        integrationType === "jira" ? "border-l-orange-500" : "border-l-blue-500"
      }`}
      data-testid={`card-org-${name.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted/70 flex-shrink-0">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-semibold leading-tight text-sm truncate">{name}</h3>
              <Badge
                variant="outline"
                className={`text-[10px] py-0 h-4 flex-shrink-0 ${
                  integrationType === "jira"
                    ? "bg-orange-500/10 text-orange-600 border-orange-500/20"
                    : "bg-blue-500/10 text-blue-500 border-blue-500/30"
                }`}
              >
                {integrationType === "jira" ? "Jira" : "ADO"}
              </Badge>
            </div>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-testid={`button-org-menu-${name
                .toLowerCase()
                .replace(/\s+/g, "-")}`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit} data-testid={`button-edit-org-${name.toLowerCase().replace(/\s+/g, "-")}`}>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPermissions} data-testid={`button-permissions-org-${name.toLowerCase().replace(/\s+/g, "-")}`}>
              <Shield className="mr-2 h-4 w-4" />
              Permissions
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={onDelete} 
              className="text-destructive focus:text-destructive"
              data-testid={`button-delete-org-${name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {/* Metadata section to match desired organization card layout */}
        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground flex items-center gap-2">
            {!patConfigured ? (
              <span className="text-muted-foreground">PAT not configured</span>
            ) : isLoadingCount ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span>Loading...</span>
              </>
            ) : (
              <>
                {projectCount} {projectCount === 1 ? "Project" : "Projects"}
              </>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Last Updated: {formattedUpdatedAt ?? "—"}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
            <UserRound className="h-3 w-3 flex-shrink-0" />
            <span className="flex-shrink-0">Owner:</span>
            <span className="truncate" title={ownerInfo?.email || ownerLabel}>
              {ownerLabel}
            </span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            className="h-8 min-w-0 px-2 text-xs font-medium border-0 bg-primary/10 text-foreground hover:bg-primary/15 hover:text-foreground"
            variant="secondary"
            onClick={onViewDetails}
            data-testid={`button-view-details-org-${name
              .toLowerCase()
              .replace(/\s+/g, "-")}`}
          >
            View Details
          </Button>
          <Button
            className="h-8 min-w-0 px-2 text-xs font-medium"
            variant="default"
            disabled={isCheckingAccess}
            onClick={onViewProjects}
            data-testid={`button-view-projects-org-${name
              .toLowerCase()
              .replace(/\s+/g, "-")}`}
          >
            {isCheckingAccess ? (
              <>
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                Checking
              </>
            ) : (
              "View Projects"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
