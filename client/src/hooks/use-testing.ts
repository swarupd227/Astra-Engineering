import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import {
  GLOBAL_ALL_ORGANIZATIONS_ID,
  useSelectedOrganization,
} from "@/contexts/selected-organization-context";

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
}

interface FileBrowserContent {
  currentPath?: string;
  projectId?: string;
  items?: Array<{ name: string; type: 'file' | 'dir'; path: string; fullPath: string }>;
  selectedFile?: string | null;
  fileContent?: string;
  message?: string;
}

export function useTestingCounts(
  urlProjectId: string | null,
  selectedOrganization: string | null,
  selectedAdoProject: ADOProject | null,
  projectName: string | null,
  apiProjectId: string | null,
  refetchKey: number = 0
) {
  const jiraOnly = useJiraOnlyWorkItems();
  const { selectedOrganization: globalSelectedOrganization } =
    useSelectedOrganization();
  const [manualScriptsCount, setManualScriptsCount] = useState(0);
  const [automationScriptsCount, setAutomationScriptsCount] = useState(0);
  const [testPlansCount, setTestPlansCount] = useState(0);
  const effectiveSelectedOrganization =
    selectedOrganization ||
    (globalSelectedOrganization &&
    globalSelectedOrganization.id !== GLOBAL_ALL_ORGANIZATIONS_ID
      ? globalSelectedOrganization.name
      : null);

  const { data: testPlansData } = useQuery({
    queryKey: ["/api/testing/test-plans", apiProjectId, effectiveSelectedOrganization],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (apiProjectId) params.append("projectId", apiProjectId);
      if (effectiveSelectedOrganization) params.append("organizationId", effectiveSelectedOrganization);
      
      const response = await apiRequest(
        "GET",
        `/api/testing/test-plans${params.toString() ? `?${params.toString()}` : ""}`
      );
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!apiProjectId && !!effectiveSelectedOrganization,
  });

  useEffect(() => {
    if (Array.isArray(testPlansData)) {
      setTestPlansCount(testPlansData.length);
    }
  }, [testPlansData]);

  useEffect(() => {
    if (!urlProjectId || !effectiveSelectedOrganization || !apiProjectId) {
      return;
    }

    const fetchTestingCounts = async () => {
      try {
        const organizationFromUrl = effectiveSelectedOrganization;
        const projectFromUrl = selectedAdoProject?.name || projectName;
        
        if (!organizationFromUrl || !projectFromUrl) return;

        let manualCount = 0;
        let automationCount = 0;

        // 1. Get Manual Scripts count from ADO (user stories count) — skip if Jira-only
        try {
          if (selectedAdoProject?.id && apiProjectId && !jiraOnly) {
            const userStoriesResponse = await apiRequest(
              "GET",
              `/api/sdlc/projects/${apiProjectId}/ado/user-stories?organization=${encodeURIComponent(organizationFromUrl)}&project=${encodeURIComponent(selectedAdoProject.id)}`
            );

            if (userStoriesResponse.ok) {
              const userStoriesResult = await userStoriesResponse.json();
              if (userStoriesResult.userStories) {
                manualCount = userStoriesResult.userStories.length;
              }
            }
          }
        } catch (error) {
          console.warn('[Testing Counts] Error fetching user stories from ADO:', error);
        }

        // 2. Get Automation Scripts count from GitHub (epics with test scripts)
        try {
          const sanitizeFileName = (name: string): string => {
            return name
              .replace(/[^a-zA-Z0-9\s\-_]/g, '')
              .replace(/\s+/g, '-')
              .toLowerCase()
              .replace(/-+/g, '-')
              .replace(/^-|-$/g, '');
          };

          const sanitizedOrg = sanitizeFileName(organizationFromUrl);
          const sanitizedProject = sanitizeFileName(projectFromUrl);
          const projectId = `${sanitizedOrg}-${sanitizedProject}`;

          const response = await apiRequest(
            "GET", 
            `/api/browse-directory?projectId=${encodeURIComponent(projectId)}`
          );

          if (response.ok) {
            const result = await response.json();
            if (result.success && result.items) {
              automationCount = result.items.filter((item: any) => item.type === 'dir').length;
            }
          }
        } catch (error) {
          console.warn('[Testing Counts] Error fetching automation scripts from GitHub:', error);
        }

        setManualScriptsCount(manualCount);
        setAutomationScriptsCount(automationCount);
      } catch (error) {
        console.warn('[Testing Counts] Error fetching testing counts:', error);
      }
    };

    fetchTestingCounts();
  }, [urlProjectId, effectiveSelectedOrganization, selectedAdoProject?.name, projectName, apiProjectId, refetchKey, jiraOnly]);

  return { manualScriptsCount, automationScriptsCount, testPlansCount };
}


export function useFileBrowser() {
  const { selectedOrganization: globalSelectedOrganization } =
    useSelectedOrganization();
  const [fileBrowserModalOpen, setFileBrowserModalOpen] = useState(false);
  const [userStoriesModalOpen, setUserStoriesModalOpen] = useState(false);
  const [testPlanModalOpen, setTestPlanModalOpen] = useState(false);
  const [fileBrowserContent, setFileBrowserContent] = useState<FileBrowserContent | null>(null);
  const { toast } = useToast();

  const openFileBrowserModal = async (
    selectedOrganization: string | null,
    selectedAdoProject: ADOProject | null,
    projectName: string | null
  ) => {
    const effectiveSelectedOrganization =
      selectedOrganization ||
      (globalSelectedOrganization &&
      globalSelectedOrganization.id !== GLOBAL_ALL_ORGANIZATIONS_ID
        ? globalSelectedOrganization.name
        : null);

    if (!effectiveSelectedOrganization) {
      toast({ description: 'Please select an organization first' });
      return;
    }

    const organizationFromUrl = effectiveSelectedOrganization;
    const projectFromUrl = selectedAdoProject?.name || projectName;
    
    if (!organizationFromUrl || !projectFromUrl) {
      toast({ description: 'Project information is not available' });
      return;
    }

    const sanitizeFileName = (name: string): string => {
      return name
        .replace(/[^a-zA-Z0-9\s\-_]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .toLowerCase() // Convert to lowercase
        .replace(/-+/g, '-') // Remove multiple consecutive hyphens
        .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
    };

    const sanitizedOrg = sanitizeFileName(organizationFromUrl);
    const sanitizedProject = sanitizeFileName(projectFromUrl);
    const projectId = `${sanitizedOrg}-${sanitizedProject}`;

    try {
      const response = await apiRequest(
        "GET",
        `/api/browse-directory?projectId=${encodeURIComponent(projectId)}`
      );

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setFileBrowserContent({
            currentPath: '',
            projectId: projectId,
            items: result.items || [],
            selectedFile: null,
            fileContent: '',
            message: result.message
          });
          setFileBrowserModalOpen(true);
        } else {
          toast({ description: result.error || 'Failed to load project files' });
        }
      } else {
        const error = await response.json();
        toast({ description: error.error || 'Failed to load project files' });
      }
    } catch (error) {
      console.error('Error loading project files:', error);
      toast({ description: 'Failed to load project files' });
    }
  };

  return {
    fileBrowserModalOpen,
    setFileBrowserModalOpen,
    userStoriesModalOpen,
    setUserStoriesModalOpen,
    testPlanModalOpen,
    setTestPlanModalOpen,
    fileBrowserContent,
    setFileBrowserContent,
    openFileBrowserModal
  };
}
