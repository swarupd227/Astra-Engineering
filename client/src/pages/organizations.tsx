import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { CardGridSkeleton } from "@/components/ui/page-skeletons";
import { OrganizationCard } from "@/components/organization-card";
import { AddOrganizationDialog } from "@/components/add-organization-dialog";
import {
  Plus,
  Loader2,
  Search,
  AlertCircle,
  Building2,
  Settings as SettingsIcon,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { SiJira } from "react-icons/si";
import { VscAzureDevops } from "react-icons/vsc";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocation } from "wouter";
import { useState, useMemo, useEffect } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { GenericModal } from "@/components/ui/generic-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMe } from "@/hooks/use-me";
import { useSelectedOrganization } from "@/contexts/selected-organization-context";
import { useDebounce } from "@/hooks/use-debounce";
import { useOrganizationProjectCounts } from "@/hooks/use-project-counts";
import { projectCountQueryPredicate } from "@/lib/project-counts";

interface ArtifactOrganization {
  id: string;
  projectName?: string | null;
  organizationUrl: string;
  patConfigured: boolean;
  createdAt: string;
  updatedAt: string;
  integrationType?: "ado" | "jira";
  ownerUserId?: string | null;
  ownerInfo?: {
    id?: string | null;
    email?: string | null;
    displayName?: string | null;
  } | null;
}

interface OrganizationWithCount extends ArtifactOrganization {
  name: string;
  projectCount: number;
  memberCount: number;
  status: "active" | "inactive";
  integrationType?: "ado" | "jira";
  email?: string;
}

interface GlobalOrganizationListItem {
  id: string;
  name: string;
  sourceType?: "ado" | "jira";
  description?: string;
  organizationUrl?: string;
  projectName?: string | null;
  patConfigured?: boolean;
  status?: "active" | "inactive";
  createdAt?: string;
  updatedAt?: string;
  email?: string;
  ownerUserId?: string | null;
  ownerInfo?: {
    id?: string | null;
    email?: string | null;
    displayName?: string | null;
  } | null;
}

const AdoLogo = ({ className }: { className?: string }) => (
  <div className={cn("flex items-center justify-center rounded overflow-hidden bg-blue-500/10 border border-blue-200/50", className)}>
    <VscAzureDevops className="h-4 w-4 text-[#0078D4]" />
  </div>
);

const JiraLogo = ({ className }: { className?: string }) => (
  <div className={cn("flex items-center justify-center rounded overflow-hidden bg-orange-500/10 border border-orange-200/50", className)}>
    <SiJira className="h-3.5 w-3.5 text-[#FF8B00]" />
  </div>
);

// Component wrapper that fetches and displays project count for a single organization
function OrganizationWithCount({
  organization,
  onViewDetails,
  onEdit,
  onDelete,
  onPermissions,
  currentUserId,
}: {
  organization: OrganizationWithCount;
  onViewDetails?: (org: OrganizationWithCount) => void;
  onEdit?: (org: OrganizationWithCount) => void;
  onDelete?: (org: OrganizationWithCount) => void;
  onPermissions?: (org: OrganizationWithCount) => void;
  currentUserId?: string | null;
}) {
  const [, setLocation] = useLocation();
  const { setSelectedOrganizationId } = useSelectedOrganization();

  const navigateToProjects = () => {
    setSelectedOrganizationId(organization.id);

    const params = new URLSearchParams();
    params.set("orgId", organization.id);
    if (organization.name) params.set("organizationName", organization.name);
    if (organization.organizationUrl) params.set("organizationUrl", organization.organizationUrl);
    if (organization.integrationType) params.set("integrationType", organization.integrationType);

    setLocation(`/projects?${params.toString()}`);
  };

  const handleViewDetails = () => {
    onViewDetails?.(organization);
  };

  const handleViewProjects = () => {
    navigateToProjects();
  };

  const handleEdit = () => {
    onEdit?.(organization);
  };

  const handleDelete = () => {
    onDelete?.(organization);
  };

  const handlePermissions = () => {
    onPermissions?.(organization);
  };

  return (
    <OrganizationCard
      {...organization}
      isLoadingCount={false}
      patConfigured={organization.patConfigured}
      integrationType={organization.integrationType}
      onViewDetails={handleViewDetails}
      onViewProjects={handleViewProjects}
      onEdit={handleEdit}
      onDelete={handleDelete}
      onPermissions={handlePermissions}
    />
  );
}

const formatDisplayDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 10);
};

function DetailRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}

export default function Organizations() {
  const { data: me } = useMe();
  const currentUserId = me?.user?.id ?? null;

  const {
    data: globalOrganizations = [],
    isLoading,
    isError,
    error,
  } = useQuery<GlobalOrganizationListItem[]>({
    queryKey: ["/api/global-organizations"],
  });

  const { toast } = useToast();

  const configuredOrgIds = useMemo(() => {
    return globalOrganizations
      .filter((org) => org.status === "active" || org.patConfigured)
      .map((org) => org.id);
  }, [globalOrganizations]);

  const { data: orgProjectCounts = {} } =
    useOrganizationProjectCounts(configuredOrgIds, currentUserId || "anonymous");

  const [addOrgDialogOpen, setAddOrgDialogOpen] = useState(false);
  const [editOrgDialogOpen, setEditOrgDialogOpen] = useState(false);
  const [deleteOrgDialogOpen, setDeleteOrgDialogOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<OrganizationWithCount | null>(
    null
  );
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [newOrgData, setNewOrgData] = useState({
    organizationUrl: "",
    patToken: "",
    email: "",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [sortBy, setSortBy] = useState<"name" | "projects">("name");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(
    "all"
  );
  const [projectsFilter, setProjectsFilter] = useState<
    "all" | "with-projects" | "without-projects"
  >("all");

  // Map API response to OrganizationCard props
  const mappedOrganizations: OrganizationWithCount[] = useMemo(() => {
    return globalOrganizations.map((org) => {
      const integrationType = org.sourceType === "jira" ? "jira" : "ado";
      const organizationUrl = org.organizationUrl || org.description || "";
      return {
        id: org.id,
        projectName: org.projectName || org.name,
        organizationUrl,
        patConfigured: Boolean(org.patConfigured || org.status === "active"),
        createdAt: org.createdAt || "",
        updatedAt: org.updatedAt || org.createdAt || "",
        name: org.name || "Jira Server",
        projectCount: orgProjectCounts[org.id]?.count || 0,
        memberCount: 0,
        status: (org.status || "inactive") as "active" | "inactive",
        integrationType,
        email: org.email,
        ownerUserId: org.ownerUserId,
        ownerInfo: org.ownerInfo,
      };
    });
  }, [globalOrganizations, orgProjectCounts]);

  // Filter and sort organizations
  const filteredAndSortedOrganizations = useMemo(() => {
    let filtered = [...mappedOrganizations];

    // Apply search filter
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase();
      filtered = filtered.filter((org) => {
        const projectMatch = org.projectName
          ? org.projectName.toLowerCase().includes(query)
          : false;

        return (
          org.name.toLowerCase().includes(query) ||
          projectMatch ||
          org.organizationUrl.toLowerCase().includes(query)
        );
      });
    }

    // Apply status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((org) => org.status === statusFilter);
    }

    // Apply projects filter
    if (projectsFilter !== "all") {
      filtered = filtered.filter((org) => {
        const count = org.projectCount || 0;
        if (projectsFilter === "with-projects") {
          return count > 0;
        }
        // "without-projects"
        return count === 0;
      });
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "projects":
          return (b.projectCount || 0) - (a.projectCount || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [mappedOrganizations, debouncedSearchQuery, sortBy, statusFilter, projectsFilter]);

  const totalCount = filteredAndSortedOrganizations.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const pageStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(page * pageSize, totalCount);
  const canGoPrevious = page > 1;
  const canGoNext = page < totalPages;
  
  const paginatedOrganizations = useMemo(() => {
    const startIndex = (page - 1) * pageSize;
    return filteredAndSortedOrganizations.slice(startIndex, startIndex + pageSize);
  }, [filteredAndSortedOrganizations, page, pageSize]);

  const createArtifactOrgMutation = useMutation({
    mutationFn: async (data: {
      organizationUrl: string;
      patToken?: string;
    }) => {
      const response = await apiRequest(
        "POST",
        "/api/artifact-organizations",
        data
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/artifact-organizations"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/global-organizations"] });
      queryClient.invalidateQueries({ predicate: projectCountQueryPredicate });
      setNewOrgData({ organizationUrl: "", patToken: "", email: "" });
      setAddOrgDialogOpen(false);
      toast({
        title: "Organization Added",
        description: "Organization has been added successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Add Organization",
        description: error.message || "Could not add organization",
        variant: "destructive",
      });
    },
  });

  const isEditingJiraOrg = selectedOrg?.integrationType === "jira";
  const isPersonalJiraCredentialMode = isEditingJiraOrg;
  const editDialogTitle = isPersonalJiraCredentialMode
    ? "Connect Your Jira Access"
    : "Edit Organization";
  const editDialogDescription = isPersonalJiraCredentialMode
    ? "Add your personal Jira API token for this organization. Shared organization settings will not be changed."
    : "Update the Personal Access Token (PAT) for this organization. The organization URL cannot be changed.";
  const editDialogButtonLabel = isPersonalJiraCredentialMode
    ? "Test and Save PAT"
    : "Update Organization";

  const savePersonalJiraCredentialMutation = useMutation({
    mutationFn: async (data: {
      instanceUrl: string;
      email: string;
      apiToken: string;
    }) => {
      const response = await apiRequest("POST", "/api/user/jira-credentials", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/jira-credentials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jira/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/global-organizations"] });
      queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey?.[0] === "string" &&
          (query.queryKey[0] as string).startsWith("/api/ado-projects"),
      });
      setEditOrgDialogOpen(false);
      setSelectedOrg(null);
      setNewOrgData({ organizationUrl: "", patToken: "", email: "" });
      toast({
        title: "Jira Access Connected",
        description: "Your personal Jira API token was tested and saved for this organization.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Save Jira PAT",
        description: error.message || "Could not save your personal Jira credential",
        variant: "destructive",
      });
    },
  });

  const updateArtifactOrgMutation = useMutation({
    mutationFn: async ({
      id,
      data,
      integrationType,
    }: {
      id: string;
      data: { organizationUrl?: string; patToken?: string; email?: string };
      integrationType?: string;
    }) => {
      if (integrationType === "jira") {
        const response = await apiRequest("PUT", `/api/jira/connections/${id}`, {
          instanceUrl: data.organizationUrl,
          apiToken: data.patToken,
          email: data.email
        });
        return response.json();
      } else {
        const response = await apiRequest(
          "PATCH",
          `/api/artifact-organizations/${id}`,
          data
        );
        return response.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/artifact-organizations"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/jira/connections"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/global-organizations"] });
      queryClient.invalidateQueries({ predicate: projectCountQueryPredicate });
      setEditOrgDialogOpen(false);
      setSelectedOrg(null);
      setNewOrgData({ organizationUrl: "", patToken: "", email: "" });
      toast({
        title: "Configuration Updated",
        description: "Organization settings updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update Organization",
        description: error.message || "Could not update organization",
        variant: "destructive",
      });
    },
  });

  const deleteArtifactOrgMutation = useMutation({
    mutationFn: async ({ id, integrationType }: { id: string, integrationType?: string }) => {
      if (integrationType === "jira") {
        const response = await apiRequest("DELETE", `/api/jira/connections/${id}`);
        return response.json();
      } else {
        const response = await apiRequest("DELETE", `/api/artifact-organizations/${id}`);
        return response.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/artifact-organizations"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/jira/connections"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/global-organizations"] });
      queryClient.invalidateQueries({ predicate: projectCountQueryPredicate });
      setDeleteOrgDialogOpen(false);
      setSelectedOrg(null);
      toast({
        title: "Organization Deleted",
        description: "Organization has been deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Delete Organization",
        description: error.message || "Could not delete organization",
        variant: "destructive",
      });
    },
  });

  const handleAddOrganization = () => {
    if (!newOrgData.organizationUrl) {
      toast({
        title: "Validation Error",
        description: "Organization URL is required",
        variant: "destructive",
      });
      return;
    }

    createArtifactOrgMutation.mutate(newOrgData);
  };

  const handleEditOrganization = (org: OrganizationWithCount) => {
    setSelectedOrg(org);
    setNewOrgData({
      organizationUrl: org.organizationUrl,
      patToken: "", // Don't pre-fill token for security
      email: org.integrationType === "jira"
        ? me?.user?.email || org.email || ""
        : org.email || "",
    });
    setEditOrgDialogOpen(true);
  };

  const handleViewOrganizationDetails = (org: OrganizationWithCount) => {
    setSelectedOrg(org);
    setDetailsDialogOpen(true);
  };

  const handleUpdateOrganization = () => {
    if (!selectedOrg) {
      toast({
        title: "Validation Error",
        description: "No organization selected",
        variant: "destructive",
      });
      return;
    }

    if (selectedOrg.integrationType === "jira" && !newOrgData.email.trim()) {
      toast({
        title: "Validation Error",
        description: "Jira email is required.",
        variant: "destructive",
      });
      return;
    }

    if (!newOrgData.patToken.trim()) {
      toast({
        title: "Validation Error",
        description: selectedOrg.integrationType === "jira"
          ? "Jira API token is required."
          : "Personal Access Token (PAT) is required to update.",
        variant: "destructive",
      });
      return;
    }

    if (isPersonalJiraCredentialMode) {
      savePersonalJiraCredentialMutation.mutate({
        instanceUrl: selectedOrg.organizationUrl,
        email: newOrgData.email.trim(),
        apiToken: newOrgData.patToken.trim(),
      });
      return;
    }

    // Only PAT can be updated from the edit dialog.
    // Organization URL is intentionally NOT editable here.
    const payload: { organizationUrl?: string; patToken?: string; email?: string } = {
      patToken: newOrgData.patToken.trim(),
      email: newOrgData.email.trim(),
    };

    updateArtifactOrgMutation.mutate({
      id: selectedOrg.id,
      data: payload,
      integrationType: selectedOrg.integrationType,
    });
  };

  const handleDeleteOrganization = (org: OrganizationWithCount) => {
    setSelectedOrg(org);
    setDeleteOrgDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (selectedOrg) {
      deleteArtifactOrgMutation.mutate({ id: selectedOrg.id, integrationType: selectedOrg.integrationType });
    }
  };

  const handlePermissions = (org: OrganizationWithCount) => {
    // TODO: Implement permissions dialog
    toast({
      title: "Permissions",
      description: `Permissions management for ${org.name} will be available soon.`,
    });
  };

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearchQuery, sortBy, statusFilter, projectsFilter, pageSize]);

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={Building2}
        title="Organizations"
        subtitle="Manage your organizations and teams"
        color="blue"
      >
        <Button
          onClick={() => setAddOrgDialogOpen(true)}
          size="sm"
          data-testid="button-add-organization"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Organization
        </Button>
      </PageHeader>

      {isLoading ? (
        <CardGridSkeleton columns={3} cardCount={6} />
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "Failed to load organizations. Please try again."}
          </AlertDescription>
        </Alert>
      ) : mappedOrganizations.length === 0 ? (
        <div className="text-center p-12">
          <p className="text-muted-foreground">No organizations found.</p>
          <p className="text-sm text-muted-foreground mt-2">
            Create your first organization to get started.
          </p>
        </div>
      ) : (
        <>
          {/* Search and Sort Controls */}
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="relative flex-1 w-full sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search organizations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-organizations"
              />
            </div>
            <div className="flex gap-2 items-center">
              <Select
                value={sortBy}
                onValueChange={(value: "name" | "projects") => setSortBy(value)}
              >
                <SelectTrigger className="w-[180px] h-10 border-2 border-border/50 hover:border-primary/50 transition-all shadow-sm" data-testid="select-sort">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Sort By</div>
                  <SelectItem value="name" className="cursor-pointer">Name (A-Z)</SelectItem>
                  <SelectItem value="projects" className="cursor-pointer">Project Count</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Pagination Controls */}
          <div className="mt-2 flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground" aria-live="polite">
              Showing <span className="font-semibold text-foreground">{pageStart}</span>-<span className="font-semibold text-foreground">{pageEnd}</span> of <span className="font-semibold text-foreground">{totalCount}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="organizations-page-size" className="text-xs text-muted-foreground">
                  Rows
                </Label>
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => setPageSize(Number(value))}
                >
                  <SelectTrigger id="organizations-page-size" className="h-9 w-20" data-testid="select-organizations-page-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex h-9 items-center rounded-md border border-border bg-background">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Previous organizations page"
                  disabled={!canGoPrevious}
                  onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                  data-testid="button-organizations-previous-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-20 px-2 text-center text-sm">
                  <span className="font-medium text-foreground">{page}</span>
                  <span className="text-muted-foreground"> / {totalPages}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Next organizations page"
                  disabled={!canGoNext}
                  onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
                  data-testid="button-organizations-next-page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Organizations Grid */}
          {paginatedOrganizations.length === 0 ? (
            <div className="text-center p-12">
              <p className="text-muted-foreground">
                No organizations match your search criteria.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Try adjusting your search or filters.
              </p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {paginatedOrganizations.map((org) => (
                <OrganizationWithCount
                  key={org.id}
                  organization={org}
                  onViewDetails={handleViewOrganizationDetails}
                  onEdit={handleEditOrganization}
                  onDelete={handleDeleteOrganization}
                  onPermissions={handlePermissions}
                  currentUserId={currentUserId}
                />
              ))}
            </div>
          )}

        </>
      )}

      {/* Transferred Add Organization Modal Logic to specialized component */}
      <AddOrganizationDialog 
        open={addOrgDialogOpen} 
        onOpenChange={setAddOrgDialogOpen} 
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: ["/api/artifact-organizations"],
          });
          queryClient.invalidateQueries({
            queryKey: ["/api/jira/connections"],
          });
          queryClient.invalidateQueries({ queryKey: ["/api/global-organizations"] });
        }}
      />

      <AddOrganizationDialog
        open={editOrgDialogOpen && isEditingJiraOrg}
        onOpenChange={(open) => {
          setEditOrgDialogOpen(open);
          if (!open) setSelectedOrg(null);
        }}
        initialJiraConnection={
          selectedOrg && isEditingJiraOrg
            ? {
                id: selectedOrg.id,
                name: selectedOrg.name,
                organizationUrl: selectedOrg.organizationUrl,
                email: selectedOrg.email,
              }
            : null
        }
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: ["/api/artifact-organizations"],
          });
          queryClient.invalidateQueries({
            queryKey: ["/api/jira/connections"],
          });
          queryClient.invalidateQueries({ queryKey: ["/api/global-organizations"] });
          queryClient.invalidateQueries({ predicate: projectCountQueryPredicate });
        }}
      />

      <Dialog
        open={detailsDialogOpen}
        onOpenChange={(open) => {
          setDetailsDialogOpen(open);
          if (!open) setSelectedOrg(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {selectedOrg?.integrationType === "jira" ? (
                <JiraLogo className="h-8 w-8" />
              ) : (
                <AdoLogo className="h-8 w-8" />
              )}
              <span className="truncate">{selectedOrg?.name || "Organization Details"}</span>
            </DialogTitle>
            <DialogDescription>
              Organization configuration and ownership details.
            </DialogDescription>
          </DialogHeader>

          {selectedOrg && (
            <dl className="space-y-4 rounded-md border bg-muted/20 p-4">
              <DetailRow
                label="Integration"
                value={selectedOrg.integrationType === "jira" ? "Jira" : "Azure DevOps"}
              />
              <DetailRow label="Organization URL" value={selectedOrg.organizationUrl} />
              <DetailRow label="Projects" value={selectedOrg.projectCount} />
              <DetailRow
                label="Status"
                value={selectedOrg.status === "active" ? "Active" : "Inactive"}
              />
              <DetailRow
                label="Credential"
                value={selectedOrg.patConfigured ? "Configured" : "Not configured"}
              />
              <DetailRow
                label="Owner"
                value={
                  selectedOrg.ownerInfo?.displayName ||
                  selectedOrg.ownerInfo?.email ||
                  "Unknown"
                }
              />
              {selectedOrg.ownerInfo?.email && (
                <DetailRow label="Owner Email" value={selectedOrg.ownerInfo.email} />
              )}
              {selectedOrg.integrationType === "jira" && selectedOrg.email && (
                <DetailRow label="Jira Email" value={selectedOrg.email} />
              )}
              <DetailRow label="Created" value={formatDisplayDate(selectedOrg.createdAt)} />
              <DetailRow label="Last Updated" value={formatDisplayDate(selectedOrg.updatedAt)} />
            </dl>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Organization Dialog */}
      <GenericModal
        open={editOrgDialogOpen && !isEditingJiraOrg}
        onOpenChange={setEditOrgDialogOpen}
        title={editDialogTitle}
        description={editDialogDescription}
        icon={SettingsIcon}
        iconClassName="bg-gradient-to-br from-blue-500 to-blue-600"
        contentClassName="space-y-4"
        footerButtons={[
          {
            label: "Cancel",
            onClick: () => {
              setEditOrgDialogOpen(false);
              setSelectedOrg(null);
              setNewOrgData({ organizationUrl: "", patToken: "", email: "" });
            },
            variant: "outline",
            "data-testid": "button-cancel-edit-org",
          },
          {
            label: updateArtifactOrgMutation.isPending || savePersonalJiraCredentialMutation.isPending
              ? isPersonalJiraCredentialMode ? "Saving..." : "Updating..."
              : editDialogButtonLabel,
            onClick: handleUpdateOrganization,
            disabled: updateArtifactOrgMutation.isPending || savePersonalJiraCredentialMutation.isPending,
            loading: updateArtifactOrgMutation.isPending || savePersonalJiraCredentialMutation.isPending,
            "data-testid": "button-confirm-edit-org",
          },
        ]}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-org-url">
              {selectedOrg?.integrationType === "jira" ? "Jira Instance URL" : "Organization URL"} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-org-url"
              placeholder={selectedOrg?.integrationType === "jira" ? "https://your-org.atlassian.net" : "https://dev.azure.com/YourOrg/"}
              value={selectedOrg?.organizationUrl ?? ""}
              readOnly
              data-testid="input-edit-org-url"
            />
            {isPersonalJiraCredentialMode && (
              <p className="text-xs text-muted-foreground">
                This Jira instance is shared by the organization. Only your personal credential will be saved.
              </p>
            )}
          </div>

          {selectedOrg?.integrationType === "jira" && (
            <div className="space-y-2">
              <Label htmlFor="edit-org-email">
                Jira Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-org-email"
                type="email"
                placeholder="email@example.com"
                value={newOrgData.email}
                onChange={(e) =>
                  setNewOrgData({ ...newOrgData, email: e.target.value })
                }
                data-testid="input-edit-org-email"
              />
              <p className="text-xs text-muted-foreground">
                Use the email address for your Atlassian account.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="edit-org-pat">
              {selectedOrg?.integrationType === "jira" ? "API Token" : "Personal Access Token"}
            </Label>
            <Input
              id="edit-org-pat"
              type="password"
              placeholder={selectedOrg?.integrationType === "jira" ? "Your Jira API token" : "Personal Access Token"}
              value={newOrgData.patToken}
              onChange={(e) =>
                setNewOrgData({ ...newOrgData, patToken: e.target.value })
              }
              data-testid="input-edit-org-pat"
            />
            <p className="text-xs text-muted-foreground">
              {isPersonalJiraCredentialMode
                ? "This token is stored only for your Astra user and this Jira instance."
                : selectedOrg?.integrationType === "jira"
                  ? "Enter a Jira API token to update the shared organization connection."
                  : "Enter a new token to update this organization connection."}
            </p>
          </div>
        </div>
      </GenericModal>

      {/* Delete Organization Dialog */}
      <GenericModal
        open={deleteOrgDialogOpen}
        onOpenChange={setDeleteOrgDialogOpen}
        title="Delete Organization"
        description="Are you sure you want to delete this organization? This action cannot be undone."
        icon={Trash2}
        iconClassName="bg-gradient-to-br from-red-500 to-red-600"
        contentClassName="space-y-4"
        footerButtons={[
          {
            label: "Cancel",
            onClick: () => {
              setDeleteOrgDialogOpen(false);
              setSelectedOrg(null);
            },
            variant: "outline",
            "data-testid": "button-cancel-delete-org",
          },
          {
            label: deleteArtifactOrgMutation.isPending
              ? "Deleting..."
              : "Delete Organization",
            onClick: handleConfirmDelete,
            disabled: deleteArtifactOrgMutation.isPending,
            loading: deleteArtifactOrgMutation.isPending,
            variant: "destructive",
            "data-testid": "button-confirm-delete-org",
          },
        ]}
      >
        {selectedOrg && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted p-4">
              <p className="font-medium">{selectedOrg.name}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {selectedOrg.organizationUrl}
              </p>
            </div>
          </div>
        )}
      </GenericModal>
    </div>
  );
}
