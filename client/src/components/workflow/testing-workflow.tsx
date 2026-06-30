import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TestTube } from "lucide-react";
import { toast } from "react-hot-toast";
import type { Epic, Feature, UserStory } from "@shared/schema";
import TestGenerationPage from "@/pages/test-generation";

interface TestingWorkflowProps {
  epics: Epic[];
  features: Feature[];
  userStories: UserStory[];
  projectId?: string | null;
  sdlcProjectId?: string | null;
  projectName?: string | null;
  azureConfig?: {
    organization?: string;
    project?: string;
  } | null;
  wikiJobId?: string | null;
  isArtifactActionsDisabled: boolean;
  addGenerationLog: (message: string) => void;
}

export function TestingWorkflow({
  epics,
  features,
  userStories,
  projectId,
  sdlcProjectId,
  projectName,
  azureConfig,
  wikiJobId,
  isArtifactActionsDisabled,
  addGenerationLog
}: TestingWorkflowProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Check if structure is valid for testing
  const hasValidStructure = (() => {
    const totalUserStories = userStories?.length || 0;
    const totalFeatures = features?.length || 0;
    const totalEpics = epics?.length || 0;
    
    return totalUserStories > 0 && totalFeatures > 0 && totalEpics > 0;
  })();

  const pid = projectId || sdlcProjectId;
  const organization = azureConfig?.organization || '';
  const project = azureConfig?.project || projectName || '';

  return (
    <>
      {/* Testing Generation Button */}
      {hasValidStructure ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!pid) {
              toast.error("Project ID not found. Please ensure you have a valid project.");
              return;
            }
            addGenerationLog("Opening Test Artifacts Generator...");
            setIsModalOpen(true);
          }}
          disabled={isArtifactActionsDisabled}
          className={`text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 border-green-200 dark:border-green-900 hover:border-green-300 dark:hover:border-green-800 ${isArtifactActionsDisabled ? "opacity-50 pointer-events-none" : ""}`}
          title={`Generate manual test cases and BDD automation scripts (${userStories?.length || 0} stories available)`}
        >
          <TestTube className="h-4 w-4 mr-1" />
          Generate Test Artifacts
        </Button>
      ) : null}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-[95vw] h-[90vh] p-0 overflow-hidden flex flex-col">
          {isModalOpen && (
            <TestGenerationPage 
              embeddedProjectId={pid || undefined}
              embeddedOrganization={organization || undefined}
              embeddedProjectName={project || undefined}
              onEmbeddedClose={() => setIsModalOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// OLD CODE - REMOVE EVERYTHING BELOW
/*
  const handleGenerateAllTestCases = async () => {
    // Validate tree structure: Epic → Features → User Stories
    const validFeatureGroups = epics.flatMap(epic => {
      const epicFeatures = features.filter(f => f.epicId === epic.id);
      return epicFeatures.map(feature => ({
        epicId: epic.id,
        epicName: epic.title,
        featureId: feature.id,
        featureName: feature.title,
        userStories: userStories.filter(story => story.featureId === feature.id)
      })).filter(group => group.userStories.length > 0);
    });

    if (validFeatureGroups.length === 0) {
      toast.error("No valid Epic → Feature → User Story structure found. Please generate artifacts first.");
      return;
    }

    setIsGeneratingTestCases(true);
    setTestCaseGenerationProgress(0);
    addGenerationLog(`Starting test case generation for ${validFeatureGroups.length} features...`);

    try {
      const pid = projectId || sdlcProjectId;
      if (!pid) {
        throw new Error("No project ID found.");
      }

      // Generate ONE job ID for the entire test generation process
      // Use existing wikiJobId or generate a new UUID for this test generation session
      const testGenerationJobId = wikiJobId || crypto.randomUUID();
      setGeneratedJobId(testGenerationJobId); // Store job ID for later preview use
      addGenerationLog(`Using Job ID: ${testGenerationJobId} for all test generation`);

      // Send parallel requests to backend for each feature
      const totalFeatures = validFeatureGroups.length;
      let completedFeatures = 0;

      const results = await Promise.all(
        validFeatureGroups.map(async (group) => {
          addGenerationLog(`Generating test cases for ${group.epicName} → ${group.featureName}...`);

          // Get organization and project from the same source as the display
          // Check URL params first (this is how BRD page gets these values)
          const urlParams = new URLSearchParams(window.location.search);
          const organizationFromUrl = urlParams.get("organization") || urlParams.get("organizationName");
          const projectFromUrl = urlParams.get("project") || urlParams.get("projectName");
          
          // Fallback to workflow azureConfig if URL params not available
          const organization = organizationFromUrl || azureConfig?.organization || 'unknown-org';
          const project = projectFromUrl || azureConfig?.project || projectName || 'default-project';

          const response = await apiRequest(
            "POST",
            "/api/generate-testcases-and-scripts",
            {
              featureId: group.featureId,
              featureName: group.featureName,
              userStories: group.userStories,
              projectId: pid,
              projectName: project,
              organization: organization,
              epicId: group.epicId,
              epicName: group.epicName,
              jobId: testGenerationJobId // Use single job ID for entire test generation
            }
          );

          completedFeatures++;
          setTestCaseGenerationProgress(
            Math.round((completedFeatures / totalFeatures) * 100)
          );
          
          addGenerationLog(`✅ Completed test cases for ${group.epicName} → ${group.featureName}`);

          if (!response.ok) {
            const error = await response.json();
            throw new Error(
              `Failed to generate test cases for ${group.epicName} → ${group.featureName}: ${error.error}`
            );
          }

          return response.json();
        })
      );

      addGenerationLog("📋 Finalizing and pushing to GitHub...");
      setTestCaseGenerationProgress(95);

      // Show success message
      toast.success(
        `✅ All test cases and Playwright scripts generated successfully!\n📁 Pushed to GitHub: AutomationScript/${pid}/`
      );

      setTestCaseGenerationProgress(100);
      addGenerationLog(`🎉 Test case generation completed! Generated test cases for ${validFeatureGroups.length} features.`);

      // Reset after 2 seconds and mark as generated
      setTimeout(() => {
        setIsGeneratingTestCases(false);
        setTestCaseGenerationProgress(0);
        setHasGeneratedTestCases(true);
      }, 2000);
    } catch (err: any) {
      addGenerationLog(`❌ Test case generation failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      toast.error(
        `Failed to generate test cases: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
      setIsGeneratingTestCases(false);
    }
  };
*/

/*
  const handlePreviewTestCases = async () => {
    try {
      // Get the project identifier (use organizationName-projectName format)
      const urlParams = new URLSearchParams(window.location.search);
      const organizationFromUrl = urlParams.get("organizationName");
      const projectFromUrl = urlParams.get("projectName");
      
      let projectId;
      
      if (organizationFromUrl && projectFromUrl) {
        // Combine them as the generation logic does
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
        projectId = `${sanitizedOrg}-${sanitizedProject}`;
      } else {
        projectId = azureConfig?.organization || 'unknown-project';
      }

      // Start hierarchical browsing - first show epics
      const response = await apiRequest(
        "GET",
        `/api/browse-directory?projectId=${encodeURIComponent(projectId)}`
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to browse directory");
      }

      const result = await response.json();
      
      if (result.success) {
        // Set up hierarchical browsing state
        setPreviewContent({
          currentPath: '',
          projectId,
          items: result.items || [],
          selectedFile: null,
          fileContent: ''
        });
        setShowPreviewModal(true);
        
        if (result.message) {
          toast.success(result.message);
        }
      } else {
        console.error(`[PreviewTestCases] Browse failed:`, result);
        toast.error(result.error || "Failed to browse test automation files.");
      }
    } catch (err: any) {
      toast.error(
        `Failed to browse test files: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
  };

  // Navigation functions for hierarchical file browser
  const handleItemClick = async (item: { name: string; type: 'file' | 'dir'; path: string; fullPath: string }) => {
    if (item.type === 'dir') {
      // Navigate into directory
      try {
        const response = await apiRequest(
          "GET",
          `/api/browse-directory?projectId=${encodeURIComponent(previewContent?.projectId || '')}&dirPath=${encodeURIComponent(item.fullPath)}`
        );

        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            // Calculate relative path for display
            const basePath = `AutomationScript/${previewContent?.projectId || ''}`;
            const relativePath = item.fullPath.startsWith(basePath + '/') 
              ? item.fullPath.substring(basePath.length + 1)
              : item.fullPath;

            setPreviewContent(prev => ({
              ...prev!,
              currentPath: relativePath,
              items: result.items || [],
              selectedFile: null,
              fileContent: ''
            }));
          } else {
            toast.error(result.error || 'Failed to load directory');
          }
        } else {
          const error = await response.json();
          toast.error(error.error || 'Failed to load directory');
        }
      } catch (error) {
        console.error('Error navigating to directory:', error);
        toast.error('Failed to load directory contents');
      }
    } else {
      // Load file content
      try {
        const response = await apiRequest(
          "GET",
          `/api/preview-file-content?filePath=${encodeURIComponent(item.fullPath)}${previewContent?.projectId ? `&projectId=${encodeURIComponent(previewContent.projectId)}` : ""}`
        );

        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            setPreviewContent(prev => ({
              ...prev!,
              selectedFile: item.name,
              fileContent: result.content || 'File is empty or could not be loaded'
            }));
          } else {
            toast.error(result.error || 'Failed to load file content');
          }
        } else {
          const error = await response.json();
          toast.error(error.error || 'Failed to load file content');
        }
      } catch (error) {
        console.error('Error loading file content:', error);
        toast.error('Failed to load file content');
      }
    }
  };

  const navigateBack = async () => {
    if (!previewContent?.currentPath || !previewContent?.projectId) return;
    
    try {
      // Calculate parent path
      const pathParts = previewContent.currentPath.split('/').filter(Boolean);
      pathParts.pop(); // Remove last part
      
      const parentPath = pathParts.length > 0 
        ? `AutomationScript/${previewContent.projectId}/${pathParts.join('/')}`
        : undefined;
      
      const response = await apiRequest(
        "GET",
        `/api/browse-directory?projectId=${encodeURIComponent(previewContent.projectId)}${parentPath ? `&dirPath=${encodeURIComponent(parentPath)}` : ''}`
      );

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setPreviewContent(prev => ({
            ...prev!,
            currentPath: pathParts.join('/'),
            items: result.items || [],
            selectedFile: null,
            fileContent: ''
          }));
        } else {
          toast.error(result.error || 'Failed to navigate back');
        }
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to navigate back');
      }
    } catch (error) {
      console.error('Error navigating back:', error);
      toast.error('Failed to navigate back');
    }
  };
*/