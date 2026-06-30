import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  UserPlus,
  X,
  XCircle,
} from "lucide-react";
import { GenericModal, type ModalButtonConfig } from "@/components/ui/generic-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiUrl } from "@/lib/api-config";
import { useToast } from "@/hooks/use-toast";
import { useAdoAllowed, useJiraOnboardingWizardEnabled } from "@/hooks/use-hosting-config";
import { getIntegrationLabels } from "@/lib/integration-config";

interface AddOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialJiraConnection?: JiraConnectionEditData | null;
  jiraProjectScope?: JiraProjectScope | null;
}

interface JiraConnectionEditData {
  id: string;
  name?: string | null;
  organizationUrl?: string | null;
  instanceUrl?: string | null;
  email?: string | null;
}

interface JiraProjectScope {
  id?: string | null;
  projectId?: string | null;
  key?: string | null;
  jiraProjectKey?: string | null;
  name?: string | null;
}

interface ArtifactsOrganization {
  id: string;
  projectName?: string | null;
  organizationUrl: string;
  patConfigured: boolean;
}

interface GoldenRepoOrganization {
  id: string;
  name: string;
  organizationUrl: string;
  projectName: string;
  repositoryName: string;
  apiVersion: string;
  patConfigured: boolean;
}

interface ProviderProjectOption {
  id: string;
  key?: string;
  name: string;
  description?: string | null;
}

interface TenantUserOption {
  userId: string;
  displayName: string;
  email: string;
  isOwner?: boolean;
  isMember?: boolean;
}

type JiraWizardStep = "connection" | "projects" | "members";

const emptyJiraOrgData = {
  name: "",
  instanceUrl: "",
  email: "",
  apiToken: "",
};

export function AddOrganizationDialog({
  open,
  onOpenChange,
  onSuccess,
  initialJiraConnection,
  jiraProjectScope,
}: AddOrganizationDialogProps) {
  const { toast } = useToast();
  const adoAllowed = useAdoAllowed();
  const jiraWizardEnabled = useJiraOnboardingWizardEnabled();
  const isJiraEditMode = Boolean(initialJiraConnection?.id);
  const initialJiraConnectionId = initialJiraConnection?.id || "";
  const initialJiraConnectionName = initialJiraConnection?.name || "";
  const initialJiraConnectionUrl = initialJiraConnection?.instanceUrl || initialJiraConnection?.organizationUrl || "";
  const initialJiraConnectionEmail = initialJiraConnection?.email || "";
  const [integrationType, setIntegrationType] = useState<"ado" | "jira">(
    adoAllowed && !isJiraEditMode ? "ado" : "jira",
  );
  const [newOrgData, setNewOrgData] = useState({
    organizationUrl: "",
    patToken: "",
  });
  const [jiraOrgData, setJiraOrgData] = useState(emptyJiraOrgData);
  const [jiraStep, setJiraStep] = useState<JiraWizardStep>("connection");
  const [savedConnectionId, setSavedConnectionId] = useState("");
  const [registeredProjectIds, setRegisteredProjectIds] = useState<string[]>([]);
  const [orgUrlError, setOrgUrlError] = useState<string | null>(null);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [adoTestStatus, setAdoTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [adoTestMessage, setAdoTestMessage] = useState("");
  const [jiraTestStatus, setJiraTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [jiraTestMessage, setJiraTestMessage] = useState("");
  const [adoProjects, setAdoProjects] = useState<ProviderProjectOption[]>([]);
  const [selectedAdoProjectId, setSelectedAdoProjectId] = useState("");
  const [jiraProjects, setJiraProjects] = useState<ProviderProjectOption[]>([]);
  const [selectedJiraProjectIds, setSelectedJiraProjectIds] = useState<string[]>([]);
	  const [jiraProjectSearch, setJiraProjectSearch] = useState("");
	  const [selectedMemberUserIds, setSelectedMemberUserIds] = useState<string[]>([]);
	  const [existingMemberUserIds, setExistingMemberUserIds] = useState<string[]>([]);
	  const [memberSearch, setMemberSearch] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberEmails, setNewMemberEmails] = useState<string[]>([]);
  const hasJiraProjectScope = Boolean(jiraProjectScope);
  const isScopedJiraInviteMode = isJiraEditMode && hasJiraProjectScope;

  const normalizeProjectCandidate = (value: unknown): string =>
    String(value || "").trim().toLowerCase();

  const jiraProjectScopeCandidates = useMemo(() => {
    const candidates = [
      jiraProjectScope?.id,
      jiraProjectScope?.projectId,
      jiraProjectScope?.key,
      jiraProjectScope?.jiraProjectKey,
      jiraProjectScope?.name,
    ]
      .map(normalizeProjectCandidate)
      .filter(Boolean);
    return new Set(candidates);
  }, [
    jiraProjectScope?.id,
    jiraProjectScope?.jiraProjectKey,
    jiraProjectScope?.key,
    jiraProjectScope?.name,
    jiraProjectScope?.projectId,
  ]);

  const matchesJiraProjectScope = (project: {
    id?: string | null;
    projectId?: string | null;
    key?: string | null;
    name?: string | null;
  }) => {
    if (!hasJiraProjectScope) return true;
    return [project.id, project.projectId, project.key, project.name]
      .map(normalizeProjectCandidate)
      .filter(Boolean)
      .some((candidate) => jiraProjectScopeCandidates.has(candidate));
  };

  const scopedFallbackJiraProject = useMemo<ProviderProjectOption | null>(() => {
    if (!hasJiraProjectScope || !jiraProjectScope) return null;
    const key = jiraProjectScope.jiraProjectKey || jiraProjectScope.key || undefined;
    const id = jiraProjectScope.projectId || key || jiraProjectScope.id || jiraProjectScope.name;
    const name = jiraProjectScope.name || key || jiraProjectScope.projectId || jiraProjectScope.id;
    if (!id || !name) return null;
    return {
      id: String(id),
      key: key ? String(key) : undefined,
      name: String(name),
    };
  }, [hasJiraProjectScope, jiraProjectScope]);

  const availableJiraProjects = useMemo(() => {
    if (!hasJiraProjectScope) return jiraProjects;
    const scopedProjects = jiraProjects.filter(matchesJiraProjectScope);
    return scopedProjects.length > 0
      ? scopedProjects
      : scopedFallbackJiraProject
        ? [scopedFallbackJiraProject]
        : [];
  }, [hasJiraProjectScope, jiraProjects, jiraProjectScopeCandidates, scopedFallbackJiraProject]);

  const filteredJiraProjects = useMemo(() => {
    const term = jiraProjectSearch.trim().toLowerCase();
    if (!term) return availableJiraProjects;
    return availableJiraProjects.filter((project) =>
      [project.key, project.name, project.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [availableJiraProjects, jiraProjectSearch]);

  const visibleJiraProjectIds = useMemo(
    () => filteredJiraProjects.map((project) => String(project.id)),
    [filteredJiraProjects],
  );
  const selectedVisibleJiraProjectCount = visibleJiraProjectIds.filter((id) =>
    selectedJiraProjectIds.includes(id),
  ).length;
  const allVisibleJiraProjectsSelected =
    visibleJiraProjectIds.length > 0 &&
    selectedVisibleJiraProjectCount === visibleJiraProjectIds.length;

  const tenantUsersQuery = useQuery<{ users: TenantUserOption[] }>({
    queryKey: ["/api/jira/connections", savedConnectionId, "tenant-users", memberSearch],
    enabled: open && integrationType === "jira" && jiraStep === "members" && !!savedConnectionId && !isScopedJiraInviteMode,
    queryFn: async () => {
      const search = memberSearch.trim();
      const url = `/api/jira/connections/${savedConnectionId}/tenant-users${
        search ? `?search=${encodeURIComponent(search)}` : ""
      }`;
      const response = await apiRequest("GET", url);
      return response.json();
    },
  });
  const scopedProjectMembersQuery = useQuery<{ users: TenantUserOption[] }>({
    queryKey: ["/api/sdlc/projects", jiraProjectScope?.id, "available-members", memberSearch],
    enabled: open && integrationType === "jira" && jiraStep === "members" && isScopedJiraInviteMode && !!jiraProjectScope?.id,
    queryFn: async () => {
      const search = memberSearch.trim();
      const url = `/api/sdlc/projects/${jiraProjectScope!.id}/available-members${
        search ? `?search=${encodeURIComponent(search)}` : ""
      }`;
      const response = await apiRequest("GET", url);
      return response.json();
    },
  });
  const tenantUsers = isScopedJiraInviteMode
    ? scopedProjectMembersQuery.data?.users ?? []
    : tenantUsersQuery.data?.users ?? [];
  const tenantUsersLoading = isScopedJiraInviteMode
    ? scopedProjectMembersQuery.isLoading
    : tenantUsersQuery.isLoading;
  const existingProjectMemberUserIds = useMemo(
    () => new Set(existingMemberUserIds),
    [existingMemberUserIds],
  );
	  const selectedAssignableMemberUserIds = useMemo(
	    () => selectedMemberUserIds.filter((userId) => !existingProjectMemberUserIds.has(userId)),
	    [existingProjectMemberUserIds, selectedMemberUserIds],
	  );

  useEffect(() => {
    if (!isScopedJiraInviteMode || tenantUsers.length === 0) return;
    const existingIds = tenantUsers
      .filter((user) => user.isOwner || user.isMember)
      .map((user) => user.userId);
    setExistingMemberUserIds((current) => Array.from(new Set([...current, ...existingIds])));
    setSelectedMemberUserIds((current) => Array.from(new Set([...current, ...existingIds])));
  }, [isScopedJiraInviteMode, tenantUsers]);

  const onboardingQuery = useQuery<{
    connection: { id: string; name?: string; instanceUrl: string; email?: string };
    projects: ProviderProjectOption[];
    registeredProjects: Array<{ id: string; projectId?: string | null; key?: string }>;
    members?: Array<{ userId: string; displayName?: string; email: string; role?: string }>;
  }>({
    queryKey: ["/api/jira/connections", initialJiraConnection?.id, "onboarding"],
    enabled: open && isJiraEditMode && !!initialJiraConnection?.id,
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/jira/connections/${initialJiraConnection!.id}/onboarding`);
      return response.json();
    },
  });

  useEffect(() => {
    if (!open) return;
    if (isJiraEditMode && initialJiraConnection) {
      setIntegrationType("jira");
      setSavedConnectionId(initialJiraConnectionId);
      setJiraStep(isScopedJiraInviteMode ? "members" : "connection");
      setJiraOrgData({
        name: initialJiraConnectionName,
        instanceUrl: initialJiraConnectionUrl,
        email: initialJiraConnectionEmail,
        apiToken: "",
      });
      setSelectedMemberUserIds([]);
      setExistingMemberUserIds([]);
      setNewMemberEmail("");
      setNewMemberEmails([]);
      setMemberSearch("");
      setJiraTestStatus("success");
      setJiraTestMessage("Connection loaded. Enter a token only if you want to update credentials.");
      return;
    }
    setIntegrationType(adoAllowed ? "ado" : "jira");
  }, [
    adoAllowed,
    initialJiraConnectionEmail,
    initialJiraConnectionId,
    initialJiraConnectionName,
    initialJiraConnectionUrl,
    isJiraEditMode,
    isScopedJiraInviteMode,
    open,
  ]);

  useEffect(() => {
    if (!onboardingQuery.data) return;
    const registeredExternalIds = new Set(
      onboardingQuery.data.registeredProjects
        .map((project) => String(project.projectId || project.key || ""))
        .filter(Boolean),
    );
    setJiraOrgData((current) => ({
      ...current,
      name: onboardingQuery.data.connection.name || current.name,
      instanceUrl: onboardingQuery.data.connection.instanceUrl || current.instanceUrl,
      email: onboardingQuery.data.connection.email || current.email,
    }));
    setJiraProjects(onboardingQuery.data.projects || []);
    setSelectedJiraProjectIds(
      (onboardingQuery.data.projects || [])
        .filter(matchesJiraProjectScope)
        .filter((project) => registeredExternalIds.has(String(project.id)) || registeredExternalIds.has(String(project.key || "")))
        .map((project) => String(project.id)),
    );
    setRegisteredProjectIds(
      onboardingQuery.data.registeredProjects
        .filter((project) => matchesJiraProjectScope(project))
        .map((project) => project.id),
    );
    setSelectedMemberUserIds((current) => {
      if (isScopedJiraInviteMode) return current;
      if (current.length > 0) return current;
      return (onboardingQuery.data.members || []).map((member) => member.userId).filter(Boolean);
    });
  }, [isScopedJiraInviteMode, jiraProjectScopeCandidates, onboardingQuery.data]);

  useEffect(() => {
    if (!hasJiraProjectScope) return;
    setSelectedJiraProjectIds(availableJiraProjects.map((project) => String(project.id)));
    setJiraProjectSearch("");
  }, [availableJiraProjects, hasJiraProjectScope]);

  const resetJiraProgress = () => {
    setJiraStep("connection");
    setSavedConnectionId("");
    setRegisteredProjectIds([]);
    setJiraProjects([]);
    setSelectedJiraProjectIds([]);
    setJiraProjectSearch("");
    setSelectedMemberUserIds([]);
    setExistingMemberUserIds([]);
    setMemberSearch("");
    setNewMemberEmail("");
    setNewMemberEmails([]);
    setJiraTestStatus("idle");
    setJiraTestMessage("");
  };

  const resetAllState = () => {
    setNewOrgData({ organizationUrl: "", patToken: "" });
    setJiraOrgData(emptyJiraOrgData);
    setOrgUrlError(null);
    setJiraError(null);
    setAdoTestStatus("idle");
    setAdoTestMessage("");
    setAdoProjects([]);
    setSelectedAdoProjectId("");
    resetJiraProgress();
    setIntegrationType(adoAllowed ? "ado" : "jira");
  };

  const setAllVisibleJiraProjects = (checked: boolean) => {
    setSelectedJiraProjectIds((current) => {
      const next = new Set(current);
      visibleJiraProjectIds.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return Array.from(next);
    });
  };

  const toggleJiraProject = (projectId: string, checked: boolean) => {
    setSelectedJiraProjectIds((current) => {
      if (checked) return current.includes(projectId) ? current : [...current, projectId];
      return current.filter((id) => id !== projectId);
    });
  };

  const toggleMember = (userId: string, checked: boolean) => {
    setSelectedMemberUserIds((current) => {
      if (checked) return current.includes(userId) ? current : [...current, userId];
      return current.filter((id) => id !== userId);
    });
  };

  const addNewMemberEmail = () => {
    const email = newMemberEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    setNewMemberEmails((current) => current.includes(email) ? current : [...current, email]);
    setNewMemberEmail("");
  };

  const selectedJiraProjects = useMemo(
    () => availableJiraProjects.filter((project) => selectedJiraProjectIds.includes(String(project.id))),
    [availableJiraProjects, selectedJiraProjectIds],
  );
  const projectIdsForMemberAssignment = useMemo(() => {
    if (hasJiraProjectScope) {
      const scopedRegisteredIds = onboardingQuery.data?.registeredProjects
        .filter((project) => matchesJiraProjectScope(project))
        .map((project) => project.id)
        .filter(Boolean) ?? [];
      if (registeredProjectIds.length > 0) return registeredProjectIds;
      if (scopedRegisteredIds.length > 0) return scopedRegisteredIds;
      return jiraProjectScope?.id ? [String(jiraProjectScope.id)] : [];
    }
    if (registeredProjectIds.length > 0) return registeredProjectIds;
    return onboardingQuery.data?.registeredProjects.map((project) => project.id) ?? [];
  }, [
    hasJiraProjectScope,
    jiraProjectScope?.id,
    jiraProjectScopeCandidates,
    onboardingQuery.data?.registeredProjects,
    registeredProjectIds,
  ]);

  const { data: artifactOrgsData } = useQuery<{ organizations: ArtifactsOrganization[] }>({
    queryKey: ["/api/artifact-organizations"],
    enabled: open && adoAllowed,
  });

  const { data: goldenRepoOrgsData } = useQuery<{ organizations: GoldenRepoOrganization[] }>({
    queryKey: ["/api/golden-repo-organizations"],
    enabled: open && adoAllowed,
  });

  const artifactsOrgs = artifactOrgsData?.organizations || [];
  const goldenRepoOrgs = goldenRepoOrgsData?.organizations || [];

  const normalizeOrganizationUrl = (url: string): string => {
    if (!url) return "";
    try {
      const parsedUrl = new URL(url);
      const normalizedPath = parsedUrl.pathname.replace(/\/$/, "");
      return `${parsedUrl.protocol}//${parsedUrl.hostname}${normalizedPath}`.toLowerCase();
    } catch {
      return url.trim().replace(/\/$/, "").toLowerCase();
    }
  };

  const isOrganizationDuplicate = (organizationUrl: string): boolean => {
    if (!organizationUrl) return false;
    const normalizedNewUrl = normalizeOrganizationUrl(organizationUrl);
    return artifactsOrgs.some((org) => normalizeOrganizationUrl(org.organizationUrl) === normalizedNewUrl);
  };

  const isGoldenRepoOrganization = (organizationUrl: string): boolean => {
    if (!organizationUrl || !goldenRepoOrgs.length) return false;
    const normalizedNewUrl = normalizeOrganizationUrl(organizationUrl);
    return goldenRepoOrgs.some((org) => normalizeOrganizationUrl(org.organizationUrl) === normalizedNewUrl);
  };

  const createArtifactOrgMutation = useMutation({
    mutationFn: async (data: {
      organizationUrl: string;
      patToken?: string;
      selectedProject: ProviderProjectOption;
    }) => {
      const response = await apiRequest("POST", "/api/artifact-organizations", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/artifact-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/global-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ado-projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jira/projects"] });
      resetAllState();
      onOpenChange(false);
      toast({ title: "Organization Added", description: "Organization has been added successfully" });
      onSuccess?.();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Add Organization",
        description: error.message || "Could not add organization",
        variant: "destructive",
      });
    },
  });

  const testAdoConnectionMutation = useMutation({
    mutationFn: async (data: { organizationUrl: string; patToken: string }) => {
      setAdoTestStatus("testing");
      setAdoTestMessage("");
      const response = await fetch(getApiUrl("/api/test-ado-connection"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.error || "Connection test failed");
      return result;
    },
    onSuccess: (result) => {
      if (result?.success) {
        const projects = Array.isArray(result.projects) ? result.projects : [];
        setAdoProjects(projects);
        setSelectedAdoProjectId(projects[0]?.id ? String(projects[0].id) : "");
        setAdoTestStatus("success");
        setAdoTestMessage(
          projects.length > 0
            ? result.message || `Connection successful. Found ${projects.length} project(s).`
            : "Connection successful, but no projects were visible.",
        );
      } else {
        setAdoTestStatus("error");
        setAdoProjects([]);
        setSelectedAdoProjectId("");
        setAdoTestMessage(result?.message || "Connection failed");
      }
    },
    onError: (error: any) => {
      setAdoTestStatus("error");
      setAdoProjects([]);
      setSelectedAdoProjectId("");
      setAdoTestMessage(error.message || "Connection test failed");
    },
  });

  const testAndSaveJiraMutation = useMutation({
    mutationFn: async () => {
      setJiraTestStatus("testing");
      setJiraTestMessage("");
      const testResponse = await fetch(getApiUrl("/api/jira/test-connection"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(jiraOrgData),
      });
      const testResult = await testResponse.json();
      if (!testResponse.ok || !testResult?.success) {
        throw new Error(testResult.message || testResult.error || "Connection test failed");
      }

      const saveResponse = isJiraEditMode && savedConnectionId
        ? await apiRequest("PUT", `/api/jira/connections/${savedConnectionId}`, jiraOrgData)
        : await apiRequest("POST", "/api/jira/connections", jiraOrgData);
      const saveResult = await saveResponse.json();
      return { testResult, saveResult };
    },
    onSuccess: ({ testResult, saveResult }) => {
      const projects = Array.isArray(testResult.projects) ? testResult.projects : [];
      setSavedConnectionId(saveResult.id);
      setJiraProjects(projects);
      setSelectedJiraProjectIds([]);
      setRegisteredProjectIds([]);
      setJiraProjectSearch("");
      setJiraTestStatus("success");
      setJiraTestMessage(testResult.message || `Connected successfully. Found ${projects.length} project(s).`);
      setJiraStep("projects");
      queryClient.invalidateQueries({ queryKey: ["/api/jira/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/global-organizations"] });
      toast({
        title: "Connection saved",
        description: `Found ${projects.length} project(s). You can register projects now or skip.`,
      });
    },
    onError: (error: any) => {
      setJiraTestStatus("error");
      setJiraTestMessage(error.message || "Connection test failed");
      toast({
        title: "Connection test failed",
        description: error.message || "Connection test failed",
        variant: "destructive",
      });
    },
  });

  const testJiraConnectionMutation = useMutation({
    mutationFn: async () => {
      setJiraTestStatus("testing");
      setJiraTestMessage("");
      const response = await fetch(getApiUrl("/api/jira/test-connection"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(jiraOrgData),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result.message || result.error || "Connection test failed");
      }
      return result;
    },
    onSuccess: (result) => {
      const projects = Array.isArray(result.projects) ? result.projects : [];
      setJiraProjects(projects);
      setSelectedJiraProjectIds(projects.map((project: ProviderProjectOption) => String(project.id)));
      setRegisteredProjectIds([]);
      setJiraProjectSearch("");
      setJiraTestStatus("success");
      setJiraTestMessage(
        result.message ||
          (projects.length > 0
            ? `Connected successfully. Found ${projects.length} project(s).`
            : "Connection successful, but no projects were visible."),
      );
    },
    onError: (error: any) => {
      setJiraProjects([]);
      setSelectedJiraProjectIds([]);
      setRegisteredProjectIds([]);
      setJiraTestStatus("error");
      setJiraTestMessage(error.message || "Connection test failed");
    },
  });

  const registerJiraProjectsMutation = useMutation({
    mutationFn: async () => {
      if (!savedConnectionId) throw new Error("Save the Jira connection first");
      const response = await apiRequest("POST", `/api/jira/connections/${savedConnectionId}/projects`, {
        selectedProjects: selectedJiraProjects,
      });
      return response.json();
    },
    onSuccess: (result) => {
      const registeredProjects = Array.isArray(result.registeredProjects) ? result.registeredProjects : [];
      setRegisteredProjectIds(registeredProjects.map((project: any) => String(project.id)));
      setJiraStep("members");
      queryClient.invalidateQueries({ queryKey: ["/api/jira/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/global-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jira/projects"] });
      toast({
        title: "Projects registered",
        description: `${result.registeredProjectCount || 0} project(s) registered successfully.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Register Projects",
        description: error.message || "Could not register Jira projects",
        variant: "destructive",
      });
    },
  });

  const saveLegacyJiraMutation = useMutation({
    mutationFn: async () => {
      if (selectedJiraProjects.length === 0) {
        throw new Error("Select at least one Jira project to register");
      }

      if (isJiraEditMode && savedConnectionId) {
        await apiRequest("PUT", `/api/jira/connections/${savedConnectionId}`, jiraOrgData);
        const projectsResponse = await apiRequest("POST", `/api/jira/connections/${savedConnectionId}/projects`, {
          selectedProjects: selectedJiraProjects,
        });
        return projectsResponse.json();
      }

      const response = await apiRequest("POST", "/api/jira/connections", {
        ...jiraOrgData,
        selectedProject: selectedJiraProjects[0],
        selectedProjects: selectedJiraProjects,
      });
      return response.json();
    },
    onSuccess: (result) => {
      const count =
        result?.registeredProjectCount ??
        result?.registeredProjects?.length ??
        selectedJiraProjects.length;
      finishJiraWizard(`${count} project(s) registered successfully.`);
    },
    onError: (error: any) => {
      toast({
        title: isJiraEditMode ? "Failed to Update Jira Connection" : "Failed to Add Jira Connection",
        description: error.message || "Could not save Jira connection",
        variant: "destructive",
      });
    },
  });

  const handleJiraProjectsNext = () => {
    if (selectedJiraProjects.length > 0) {
      registerJiraProjectsMutation.mutate();
      return;
    }
    setJiraStep("members");
  };

  const addProjectMembersMutation = useMutation({
    mutationFn: async () => {
      if (!savedConnectionId) throw new Error("Save the Jira connection first");
	      if (selectedAssignableMemberUserIds.length === 0 && newMemberEmails.length === 0) {
	        return { memberCount: 0, projectCount: projectIdsForMemberAssignment.length };
	      }
	      const response = await apiRequest("POST", `/api/jira/connections/${savedConnectionId}/project-members`, {
	        projectIds: projectIdsForMemberAssignment,
	        userIds: selectedAssignableMemberUserIds,
	        emails: newMemberEmails,
	      });
	      return response.json();
    },
    onSuccess: (result) => {
      finishJiraWizard(
        result?.memberCount
          ? `${result.memberCount} member(s) added across ${result.projectCount} project(s).`
          : "Jira connection setup completed.",
      );
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Add Members",
        description: error.message || "Could not add project members",
        variant: "destructive",
      });
    },
  });

  const removeProjectMemberMutation = useMutation({
    mutationFn: async (user: TenantUserOption) => {
      if (!jiraProjectScope?.id) throw new Error("Project is missing");
      const response = await apiRequest(
        "DELETE",
        `/api/sdlc/projects/${jiraProjectScope.id}/members/${encodeURIComponent(user.userId)}`,
      );
      await response.json().catch(() => ({}));
      return user;
    },
    onSuccess: (user) => {
      setExistingMemberUserIds((current) => current.filter((id) => id !== user.userId));
      setSelectedMemberUserIds((current) => current.filter((id) => id !== user.userId));
      queryClient.invalidateQueries({
        queryKey: ["/api/sdlc/projects", jiraProjectScope?.id, "available-members"],
      });
      queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey?.[0] === "string" &&
          (query.queryKey[0] as string).startsWith("/api/ado-projects"),
      });
      toast({
        title: "Member removed",
        description: `${user.displayName || user.email} no longer has access to this project.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Remove Member",
        description: error.message || "Could not remove project member",
        variant: "destructive",
      });
    },
  });

  const finishJiraWizard = (description: string) => {
    queryClient.invalidateQueries({ queryKey: ["/api/jira/connections"] });
    queryClient.invalidateQueries({ queryKey: ["/api/global-organizations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/jira/projects"] });
    resetAllState();
    onOpenChange(false);
    toast({ title: isJiraEditMode ? "Jira Connection Updated" : "Jira Connection Added", description });
    onSuccess?.();
  };

  const handleAddOrganization = () => {
    if (!newOrgData.organizationUrl) {
      setOrgUrlError("Organization URL is required");
      return;
    }
    if (isGoldenRepoOrganization(newOrgData.organizationUrl)) {
      setOrgUrlError("This organization is configured as a Golden Repository organization and cannot be added here");
      return;
    }
    if (isOrganizationDuplicate(newOrgData.organizationUrl)) {
      setOrgUrlError("This organization already exists");
      return;
    }
    if (adoTestStatus !== "success") {
      setOrgUrlError("Test the ADO connection before adding the organization");
      return;
    }
    const selectedProject = adoProjects.find((project) => project.id === selectedAdoProjectId);
    if (!selectedProject) {
      setOrgUrlError("Select a project to register in DevX");
      return;
    }
    setOrgUrlError(null);
    createArtifactOrgMutation.mutate({ ...newOrgData, selectedProject });
  };

  const handleTestAdoConnection = () => {
    if (!newOrgData.organizationUrl.trim()) {
      setOrgUrlError("Organization URL is required");
      return;
    }
    if (!newOrgData.patToken.trim()) {
      setOrgUrlError("PAT token is required for testing");
      return;
    }
    setOrgUrlError(null);
    setAdoProjects([]);
    setSelectedAdoProjectId("");
    testAdoConnectionMutation.mutate(newOrgData);
  };

  const handleTestAndSaveJira = () => {
    setJiraError(null);
    if (!jiraOrgData.instanceUrl.trim()) {
      setJiraError("Jira instance URL is required");
      return;
    }
    if (!jiraOrgData.email.trim()) {
      setJiraError("Jira email is required");
      return;
    }
    if (!jiraOrgData.apiToken.trim()) {
      setJiraError("Jira API token is required");
      return;
    }
    testAndSaveJiraMutation.mutate();
  };

  const handleTestJiraConnection = () => {
    setJiraError(null);
    if (!jiraOrgData.instanceUrl.trim()) {
      setJiraError("Jira instance URL is required");
      return;
    }
    if (!jiraOrgData.email.trim()) {
      setJiraError("Jira email is required");
      return;
    }
    if (!jiraOrgData.apiToken.trim()) {
      setJiraError("Jira API token is required");
      return;
    }
    testJiraConnectionMutation.mutate();
  };

  const handleSaveLegacyJira = () => {
    setJiraError(null);
    if (!jiraOrgData.instanceUrl.trim()) {
      setJiraError("Jira instance URL is required");
      return;
    }
    if (!jiraOrgData.email.trim()) {
      setJiraError("Jira email is required");
      return;
    }
    if (!isJiraEditMode && !jiraOrgData.apiToken.trim()) {
      setJiraError("Jira API token is required");
      return;
    }
    if (jiraTestStatus !== "success") {
      setJiraError("Test the Jira connection before adding the organization");
      return;
    }
    if (selectedJiraProjects.length === 0) {
      setJiraError("Select at least one Jira project to register");
      return;
    }
    saveLegacyJiraMutation.mutate();
  };

  const handleDialogClose = (nextOpen: boolean) => {
    if (!nextOpen) resetAllState();
    onOpenChange(nextOpen);
  };

	  const getFooterButtons = (): ModalButtonConfig[] => {
	    if (integrationType === "ado") {
	      return [
        { label: "Cancel", onClick: () => handleDialogClose(false), variant: "outline", "data-testid": "button-cancel-add-org" },
        {
          label: createArtifactOrgMutation.isPending ? "Adding..." : "Add Organization",
          onClick: handleAddOrganization,
          disabled:
            createArtifactOrgMutation.isPending ||
            !!orgUrlError ||
            !newOrgData.organizationUrl.trim() ||
            adoTestStatus !== "success" ||
            !selectedAdoProjectId,
          loading: createArtifactOrgMutation.isPending,
          "data-testid": "button-confirm-add-org",
        },
	      ];
	    }
	
	    if (isScopedJiraInviteMode) {
	      return [
	        { label: "Cancel", onClick: () => handleDialogClose(false), variant: "outline", "data-testid": "button-jira-members-cancel" },
	        {
	          label: addProjectMembersMutation.isPending ? "Adding..." : "Add members",
	          onClick: () => addProjectMembersMutation.mutate(),
	          disabled:
	            addProjectMembersMutation.isPending ||
	            projectIdsForMemberAssignment.length === 0 ||
	            (selectedAssignableMemberUserIds.length === 0 && newMemberEmails.length === 0),
	          loading: addProjectMembersMutation.isPending,
	          "data-testid": "button-jira-members-complete",
	        },
	      ];
	    }
	
	    if (!jiraWizardEnabled) {
	      return [
        { label: "Cancel", onClick: () => handleDialogClose(false), variant: "outline", "data-testid": "button-cancel-add-org" },
        {
          label: saveLegacyJiraMutation.isPending
            ? (isJiraEditMode ? "Updating..." : "Adding...")
            : (isJiraEditMode ? "Update Organization" : "Add Organization"),
          onClick: handleSaveLegacyJira,
          disabled:
            saveLegacyJiraMutation.isPending ||
            onboardingQuery.isLoading ||
            !jiraOrgData.instanceUrl.trim() ||
            !jiraOrgData.email.trim() ||
            (!isJiraEditMode && !jiraOrgData.apiToken.trim()) ||
            jiraTestStatus !== "success" ||
            selectedJiraProjectIds.length === 0,
          loading: saveLegacyJiraMutation.isPending,
          "data-testid": "button-confirm-add-jira-org",
        },
      ];
    }

    if (jiraStep === "connection") {
      return [
        { label: "Cancel", onClick: () => handleDialogClose(false), variant: "outline", "data-testid": "button-cancel-add-org" },
        {
          label: onboardingQuery.isLoading ? "Loading..." : "Next",
          onClick: () => setJiraStep("projects"),
          disabled: !savedConnectionId || onboardingQuery.isLoading,
          loading: onboardingQuery.isLoading,
          "data-testid": "button-jira-connection-next",
        },
      ];
    }

    if (jiraStep === "projects") {
      return [
        { label: "Back", onClick: () => setJiraStep("connection"), variant: "outline", "data-testid": "button-jira-projects-back" },
        { label: "Skip", onClick: () => setJiraStep("members"), variant: "outline", "data-testid": "button-jira-projects-skip" },
        {
          label: registerJiraProjectsMutation.isPending ? "Registering..." : "Next",
          onClick: handleJiraProjectsNext,
          disabled: registerJiraProjectsMutation.isPending,
          loading: registerJiraProjectsMutation.isPending,
          "data-testid": "button-jira-projects-next",
        },
      ];
    }

	    return [
      { label: "Back", onClick: () => setJiraStep("projects"), variant: "outline", "data-testid": "button-jira-members-back" },
      {
        label: "Skip",
        onClick: () => finishJiraWizard("Jira connection setup completed. You can add members later."),
        variant: "outline",
        "data-testid": "button-jira-members-skip",
      },
      {
        label: addProjectMembersMutation.isPending ? "Completing..." : "Complete",
        onClick: () => addProjectMembersMutation.mutate(),
        disabled: addProjectMembersMutation.isPending,
        loading: addProjectMembersMutation.isPending,
        "data-testid": "button-jira-members-complete",
      },
    ];
  };

  const renderJiraStepIndicator = () => (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
      {(["connection", "projects", "members"] as JiraWizardStep[]).map((step, index) => (
        <div key={step} className="flex items-center gap-2">
          <span
            className={
              step === jiraStep
                ? "font-medium text-foreground"
                : "text-muted-foreground"
            }
          >
            {index + 1}. {step === "connection" ? "Connect" : step === "projects" ? "Projects" : "Members"}
          </span>
          {index < 2 && <span className="text-muted-foreground">/</span>}
        </div>
      ))}
    </div>
  );

  const renderAdoFields = () => (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-org-url">Organization URL <span className="text-destructive">*</span></Label>
        <Input
          id="new-org-url"
          placeholder="https://dev.azure.com/YourOrg/"
          value={newOrgData.organizationUrl}
          onChange={(event) => {
            const url = event.target.value;
            setNewOrgData({ ...newOrgData, organizationUrl: url });
            setAdoTestStatus("idle");
            setAdoTestMessage("");
            setAdoProjects([]);
            setSelectedAdoProjectId("");
            if (!url.trim()) setOrgUrlError(null);
            else if (isGoldenRepoOrganization(url)) setOrgUrlError("This organization is configured as a Golden Repository organization and cannot be added here");
            else if (isOrganizationDuplicate(url)) setOrgUrlError("This organization already exists");
            else setOrgUrlError(null);
          }}
          className={orgUrlError ? "border-destructive" : ""}
          data-testid="input-new-org-url"
        />
        {orgUrlError && <p className="text-sm text-destructive">{orgUrlError}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="new-org-pat">Personal Access Token</Label>
        <div className="flex gap-2">
          <Input
            id="new-org-pat"
            type="password"
            placeholder={`Enter your ${getIntegrationLabels("ado").name} PAT token`}
            value={newOrgData.patToken}
            onChange={(event) => {
              setNewOrgData({ ...newOrgData, patToken: event.target.value });
              setAdoTestStatus("idle");
              setAdoTestMessage("");
              setAdoProjects([]);
              setSelectedAdoProjectId("");
            }}
            className="flex-1"
            data-testid="input-new-org-pat"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleTestAdoConnection}
            disabled={testAdoConnectionMutation.isPending || !newOrgData.organizationUrl.trim() || !newOrgData.patToken.trim()}
            data-testid="button-test-ado-connection"
          >
            {testAdoConnectionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {testAdoConnectionMutation.isPending ? "Testing..." : "Test"}
          </Button>
        </div>
        {adoTestStatus === "success" && <StatusLine status="success" message={adoTestMessage || "Connection successful"} />}
        {adoTestStatus === "error" && <StatusLine status="error" message={adoTestMessage || "Connection failed"} />}
        {adoTestStatus === "testing" && <StatusLine status="loading" message="Testing connection..." />}
      </div>

      {adoTestStatus === "success" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="ado-project-select">Project to register <span className="text-destructive">*</span></Label>
          <Select value={selectedAdoProjectId} onValueChange={setSelectedAdoProjectId} disabled={adoProjects.length === 0}>
            <SelectTrigger id="ado-project-select" data-testid="select-ado-onboarding-project">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {adoProjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {adoProjects.length === 0 && <p className="text-xs text-muted-foreground">No projects are visible for this PAT.</p>}
        </div>
      )}
    </>
  );

  const renderJiraConnectionStep = () => (
    <>
      {renderJiraStepIndicator()}
      <div className="flex flex-col gap-2">
        <Label htmlFor="jira-connection-name">Connection Name</Label>
        <Input
          id="jira-connection-name"
          placeholder="e.g. My Team Jira, Production Jira"
          value={jiraOrgData.name}
          onChange={(event) => setJiraOrgData({ ...jiraOrgData, name: event.target.value })}
          data-testid="input-jira-connection-name"
        />
        <p className="text-xs text-muted-foreground">A friendly name to identify this connection. Defaults to the instance hostname if left empty.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jira-instance-url">Jira Instance URL <span className="text-destructive">*</span></Label>
        <Input
          id="jira-instance-url"
          placeholder={`https://your-company.${getIntegrationLabels("jira").name.toLowerCase()}.net`}
          value={jiraOrgData.instanceUrl}
          readOnly={isJiraEditMode}
          onChange={(event) => {
            setJiraOrgData({ ...jiraOrgData, instanceUrl: event.target.value });
            resetJiraProgress();
          }}
          data-testid="input-jira-instance-url"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jira-email">Jira Email <span className="text-destructive">*</span></Label>
        <Input
          id="jira-email"
          type="email"
          placeholder="your-email@company.com"
          value={jiraOrgData.email}
          onChange={(event) => {
            setJiraOrgData({ ...jiraOrgData, email: event.target.value });
            setJiraTestStatus("idle");
            setJiraTestMessage("");
          }}
          data-testid="input-jira-email"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jira-api-token">Jira API Token <span className="text-destructive">*</span></Label>
        <div className="flex gap-2">
          <Input
            id="jira-api-token"
            type="password"
            placeholder={isJiraEditMode ? "Enter a token only to update credentials" : `Enter your ${getIntegrationLabels("jira").name} API token`}
            value={jiraOrgData.apiToken}
            onChange={(event) => {
              setJiraOrgData({ ...jiraOrgData, apiToken: event.target.value });
              setJiraTestStatus("idle");
              setJiraTestMessage("");
            }}
            className="flex-1"
            data-testid="input-jira-api-token"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleTestAndSaveJira}
            disabled={testAndSaveJiraMutation.isPending || !jiraOrgData.instanceUrl.trim() || !jiraOrgData.email.trim() || !jiraOrgData.apiToken.trim()}
            data-testid="button-test-jira-connection"
          >
            {testAndSaveJiraMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {testAndSaveJiraMutation.isPending ? "Saving..." : "Test & Save"}
          </Button>
        </div>
        {jiraTestStatus === "success" && <StatusLine status="success" message={jiraTestMessage || "Connection successful"} />}
        {jiraTestStatus === "error" && <StatusLine status="error" message={jiraTestMessage || "Connection failed"} />}
        {jiraTestStatus === "testing" && <StatusLine status="loading" message="Testing connection..." />}
        <p className="text-xs text-muted-foreground">Generate an API token from your Atlassian account settings.</p>
      </div>
      {jiraError && <p className="text-sm text-destructive" data-testid="error-jira-validation">{jiraError}</p>}
    </>
  );

  const renderJiraProjectsStep = () => (
    <>
      {renderJiraStepIndicator()}
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label htmlFor="jira-project-search">Projects to register</Label>
          <p className="text-xs text-muted-foreground">
            {hasJiraProjectScope ? "Only the selected project from the project card is included." : "Optional. You can skip and come back later."}
          </p>
        </div>
        <span className="text-sm text-muted-foreground">{selectedJiraProjectIds.length} selected</span>
      </div>
      {!hasJiraProjectScope && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            id="jira-project-search"
            value={jiraProjectSearch}
            onChange={(event) => setJiraProjectSearch(event.target.value)}
            placeholder="Search projects"
            className="pl-8"
            disabled={availableJiraProjects.length === 0}
            data-testid="input-jira-project-search"
          />
        </div>
      )}
      <div className="rounded-md border">
        {!hasJiraProjectScope && (
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
            <label className="flex min-w-0 items-center gap-2 text-sm">
              <Checkbox
                checked={allVisibleJiraProjectsSelected}
                onCheckedChange={(checked) => setAllVisibleJiraProjects(Boolean(checked))}
                disabled={visibleJiraProjectIds.length === 0}
                data-testid="checkbox-jira-select-all"
              />
              <span>Select all visible</span>
            </label>
            <span className="text-xs text-muted-foreground">{selectedVisibleJiraProjectCount}/{visibleJiraProjectIds.length}</span>
          </div>
        )}
        <ScrollArea className="h-[420px]">
          {filteredJiraProjects.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">No matching projects.</p>
          ) : (
            <div className="grid grid-cols-1 divide-y md:grid-cols-2 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
              {filteredJiraProjects.map((project) => {
                const projectId = String(project.id);
                const checked = selectedJiraProjectIds.includes(projectId);
                return (
                  <label key={projectId} className="flex min-h-14 cursor-pointer items-start gap-3 border-b px-3 py-2 hover:bg-muted/50">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => toggleJiraProject(projectId, Boolean(value))}
                        disabled={hasJiraProjectScope}
                        data-testid={`checkbox-jira-project-${projectId}`}
                      />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{project.key ? `${project.key} - ${project.name}` : project.name}</span>
                      {project.description && <span className="block truncate text-xs text-muted-foreground">{project.description}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </>
  );

  const renderLegacyJiraFields = () => (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jira-connection-name">Connection Name</Label>
        <Input
          id="jira-connection-name"
          placeholder="e.g. My Team Jira, Production Jira"
          value={jiraOrgData.name}
          onChange={(event) => setJiraOrgData({ ...jiraOrgData, name: event.target.value })}
          data-testid="input-jira-connection-name"
        />
        <p className="text-xs text-muted-foreground">A friendly name to identify this connection. Defaults to the instance hostname if left empty.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jira-instance-url">Jira Instance URL <span className="text-destructive">*</span></Label>
        <Input
          id="jira-instance-url"
          placeholder={`https://your-company.${getIntegrationLabels("jira").name.toLowerCase()}.net`}
          value={jiraOrgData.instanceUrl}
          readOnly={isJiraEditMode}
          onChange={(event) => {
            setJiraOrgData({ ...jiraOrgData, instanceUrl: event.target.value });
            resetJiraProgress();
          }}
          data-testid="input-jira-instance-url"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jira-email">Jira Email <span className="text-destructive">*</span></Label>
        <Input
          id="jira-email"
          type="email"
          placeholder="your-email@company.com"
          value={jiraOrgData.email}
          onChange={(event) => {
            setJiraOrgData({ ...jiraOrgData, email: event.target.value });
            setJiraTestStatus("idle");
            setJiraTestMessage("");
          }}
          data-testid="input-jira-email"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jira-api-token">Jira API Token <span className="text-destructive">*</span></Label>
        <div className="flex gap-2">
          <Input
            id="jira-api-token"
            type="password"
            placeholder={isJiraEditMode ? "Enter a token only to update credentials" : `Enter your ${getIntegrationLabels("jira").name} API token`}
            value={jiraOrgData.apiToken}
            onChange={(event) => {
              setJiraOrgData({ ...jiraOrgData, apiToken: event.target.value });
              setJiraTestStatus("idle");
              setJiraTestMessage("");
            }}
            className="flex-1"
            data-testid="input-jira-api-token"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleTestJiraConnection}
            disabled={testJiraConnectionMutation.isPending || !jiraOrgData.instanceUrl.trim() || !jiraOrgData.email.trim() || !jiraOrgData.apiToken.trim()}
            data-testid="button-test-jira-connection"
          >
            {testJiraConnectionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {testJiraConnectionMutation.isPending ? "Testing..." : "Test"}
          </Button>
        </div>
        {jiraTestStatus === "success" && <StatusLine status="success" message={jiraTestMessage || "Connection successful"} />}
        {jiraTestStatus === "error" && <StatusLine status="error" message={jiraTestMessage || "Connection failed"} />}
        {jiraTestStatus === "testing" && <StatusLine status="loading" message="Testing connection..." />}
        <p className="text-xs text-muted-foreground">Generate an API token from your Atlassian account settings.</p>
      </div>
      {jiraTestStatus === "success" && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="jira-project-search">Projects to register <span className="text-destructive">*</span></Label>
              <p className="text-xs text-muted-foreground">
                {hasJiraProjectScope ? "Only the selected project from the project card is included." : "Select the Jira projects to add to DevX."}
              </p>
            </div>
            <span className="text-sm text-muted-foreground">{selectedJiraProjectIds.length} selected</span>
          </div>
          {!hasJiraProjectScope && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="jira-project-search"
                value={jiraProjectSearch}
                onChange={(event) => setJiraProjectSearch(event.target.value)}
                placeholder="Search projects"
                className="pl-8"
                disabled={availableJiraProjects.length === 0}
                data-testid="input-jira-project-search"
              />
            </div>
          )}
          <div className="rounded-md border">
            {!hasJiraProjectScope && (
              <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                <label className="flex min-w-0 items-center gap-2 text-sm">
                  <Checkbox
                    checked={allVisibleJiraProjectsSelected}
                    onCheckedChange={(checked) => setAllVisibleJiraProjects(Boolean(checked))}
                    disabled={visibleJiraProjectIds.length === 0}
                    data-testid="checkbox-jira-select-all"
                  />
                  <span>Select all visible</span>
                </label>
                <span className="text-xs text-muted-foreground">{selectedVisibleJiraProjectCount}/{visibleJiraProjectIds.length}</span>
              </div>
            )}
            <ScrollArea className="h-[320px]">
              {filteredJiraProjects.length === 0 ? (
                <p className="px-3 py-10 text-center text-sm text-muted-foreground">No matching projects.</p>
              ) : (
                <div className="grid grid-cols-1 divide-y md:grid-cols-2 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
                  {filteredJiraProjects.map((project) => {
                    const projectId = String(project.id);
                    const checked = selectedJiraProjectIds.includes(projectId);
                    return (
                      <label key={projectId} className="flex min-h-14 cursor-pointer items-start gap-3 border-b px-3 py-2 hover:bg-muted/50">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleJiraProject(projectId, Boolean(value))}
                          disabled={hasJiraProjectScope}
                          data-testid={`checkbox-jira-project-${projectId}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{project.key ? `${project.key} - ${project.name}` : project.name}</span>
                          {project.description && <span className="block truncate text-xs text-muted-foreground">{project.description}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </>
      )}
      {jiraError && <p className="text-sm text-destructive" data-testid="error-jira-validation">{jiraError}</p>}
    </>
  );

  const renderJiraMembersStep = () => (
    <>
      {renderJiraStepIndicator()}
      <div>
        <Label htmlFor="jira-member-search">Members to add</Label>
        <p className="text-xs text-muted-foreground">
          {isScopedJiraInviteMode
            ? "Selected members will be added to this project."
            : "Optional. Selected members will be added to all projects registered in this wizard."}
        </p>
      </div>
      {projectIdsForMemberAssignment.length === 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          No projects were registered in Step 2. Skip this step or go back and register projects before adding members.
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          id="jira-member-search"
          value={memberSearch}
          onChange={(event) => setMemberSearch(event.target.value)}
          placeholder="Search current users"
          className="pl-8"
          disabled={!savedConnectionId}
          data-testid="input-jira-member-search"
        />
      </div>
      <div className="rounded-md border">
        <ScrollArea className="h-56">
	          {tenantUsersLoading ? (
	            <StatusLine status="loading" message="Loading users..." className="p-3" />
	          ) : tenantUsers.length === 0 ? (
	            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No users found.</p>
          ) : (
            <div className="divide-y">
	              {tenantUsers.map((user) => {
	                const checked = selectedMemberUserIds.includes(user.userId);
	                const alreadyHasAccess = Boolean(user.isOwner || user.isMember);
	                const canRemoveMember = isScopedJiraInviteMode && user.isMember && !user.isOwner;
	                return (
	                  <div
	                    key={user.userId}
	                    className={`flex items-center gap-3 px-3 py-2 ${
	                      alreadyHasAccess
	                        ? "bg-muted/30 text-muted-foreground"
	                        : "hover:bg-muted/50"
	                    }`}
	                  >
	                    <Checkbox
	                      checked={checked}
	                      onCheckedChange={(value) => toggleMember(user.userId, Boolean(value))}
	                      disabled={alreadyHasAccess}
	                      data-testid={`checkbox-jira-member-${user.userId}`}
	                    />
	                    <span className="min-w-0 flex-1">
	                      <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
	                        <span className="truncate">{user.displayName || user.email}</span>
	                        {alreadyHasAccess && (
	                          <span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
	                            {user.isOwner ? "Owner" : "Already assigned"}
	                          </span>
	                        )}
	                      </span>
	                      <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
	                    </span>
	                    {canRemoveMember && (
	                      <Button
	                        type="button"
	                        variant="ghost"
	                        size="sm"
	                        className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
	                        disabled={removeProjectMemberMutation.isPending}
	                        onClick={() => removeProjectMemberMutation.mutate(user)}
	                        data-testid={`button-remove-jira-member-${user.userId}`}
	                      >
	                        <X className="mr-1 h-3.5 w-3.5" />
	                        Remove
	                      </Button>
	                    )}
	                  </div>
	                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jira-new-member-email">Add new user by email</Label>
        <div className="flex gap-2">
          <Input
            id="jira-new-member-email"
            type="email"
            value={newMemberEmail}
            onChange={(event) => setNewMemberEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addNewMemberEmail();
              }
            }}
            placeholder="person@example.com"
            data-testid="input-jira-new-member-email"
          />
          <Button type="button" variant="outline" onClick={addNewMemberEmail} data-testid="button-jira-add-member-email">
            <UserPlus className="mr-2 h-4 w-4" />
            Add
          </Button>
        </div>
        {newMemberEmails.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {newMemberEmails.map((email) => (
              <span key={email} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                {email}
                <button
                  type="button"
                  onClick={() => setNewMemberEmails((current) => current.filter((value) => value !== email))}
                  aria-label={`Remove ${email}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <GenericModal
      open={open}
      onOpenChange={handleDialogClose}
      title={isScopedJiraInviteMode ? "Invite Project Members" : isJiraEditMode ? "Manage Jira Connection" : "Add Organization"}
      description={
        isScopedJiraInviteMode
          ? "Add existing users or invite new people to this Jira project."
          : isJiraEditMode
            ? "Update Jira projects and project members"
            : "Add a new organization for work item management"
      }
      icon={Building2}
      iconClassName="bg-gradient-to-br from-blue-500 to-blue-600"
      contentClassName="flex flex-col gap-4"
      closeOnOverlayClick={false}
      closeOnEscape={false}
      footerButtons={getFooterButtons()}
    >
      <div className="flex flex-col gap-4">
        {!isJiraEditMode && (
          <div className="flex flex-col gap-3">
            <Label>Integration Type <span className="text-destructive">*</span></Label>
            <RadioGroup
              value={integrationType}
              onValueChange={(value: "ado" | "jira") => {
                setIntegrationType(value);
                setOrgUrlError(null);
                setJiraError(null);
              }}
              className="flex gap-4"
              data-testid="radio-integration-type"
            >
              {adoAllowed && (
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="ado" id="type-ado" data-testid="radio-ado" />
                  <Label htmlFor="type-ado" className="cursor-pointer font-normal">{getIntegrationLabels("ado").longName}</Label>
                </div>
              )}
              <div className="flex items-center gap-2">
                <RadioGroupItem value="jira" id="type-jira" data-testid="radio-jira" />
                <Label htmlFor="type-jira" className="cursor-pointer font-normal">{getIntegrationLabels("jira").name}</Label>
              </div>
            </RadioGroup>
          </div>
        )}

	        {integrationType === "ado" && renderAdoFields()}
	        {integrationType === "jira" && isScopedJiraInviteMode && renderJiraMembersStep()}
	        {integrationType === "jira" && !isScopedJiraInviteMode && !jiraWizardEnabled && renderLegacyJiraFields()}
	        {integrationType === "jira" && !isScopedJiraInviteMode && jiraWizardEnabled && jiraStep === "connection" && renderJiraConnectionStep()}
	        {integrationType === "jira" && !isScopedJiraInviteMode && jiraWizardEnabled && jiraStep === "projects" && renderJiraProjectsStep()}
	        {integrationType === "jira" && !isScopedJiraInviteMode && jiraWizardEnabled && jiraStep === "members" && renderJiraMembersStep()}
	      </div>
    </GenericModal>
  );
}

function StatusLine({
  status,
  message,
  className = "",
}: {
  status: "success" | "error" | "loading";
  message: string;
  className?: string;
}) {
  const Icon = status === "success" ? CheckCircle2 : status === "error" ? XCircle : Loader2;
  const colorClass =
    status === "success"
      ? "text-green-600"
      : status === "error"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className={`flex items-center gap-2 text-sm ${colorClass} ${className}`}>
      <Icon className={`h-4 w-4 ${status === "loading" ? "animate-spin" : ""}`} />
      <span>{message}</span>
    </div>
  );
}
