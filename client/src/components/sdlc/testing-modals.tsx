import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { GenericModal } from "@/components/ui/generic-modal";
import {
  FileText,
  User,
  ArrowLeft,
  Folder,
  TestTube,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { TestPlanGenerationModal } from "./test-plan-generation-modal";
import { UserStorySelectionModal } from "../workflow/user-story-selection-modal";
import { useQuery } from "@tanstack/react-query";
import type { Epic, Feature, UserStory } from "@shared/schema";
import { getIntegrationLabels } from "@/lib/integration-config";

interface FileBrowserContent {
  currentPath?: string;
  projectId?: string;
  items?: Array<{ name: string; type: 'file' | 'dir'; path: string; fullPath: string }>;
  selectedFile?: string | null;
  fileContent?: string;
  message?: string;
}

interface ADOProject {
  id: string;
  name: string;
  organization: string;
  organizationUrl: string;
}

interface TestingModalsProps {
  fileBrowserModalOpen: boolean;
  setFileBrowserModalOpen: (open: boolean) => void;
  userStoriesModalOpen: boolean;
  setUserStoriesModalOpen: (open: boolean) => void;
  testPlanModalOpen: boolean;
  setTestPlanModalOpen: (open: boolean) => void;
  fileBrowserContent: FileBrowserContent | null;
  setFileBrowserContent: (content: FileBrowserContent | null | ((prev: FileBrowserContent | null) => FileBrowserContent | null)) => void;
  manualScriptsCount: number;
  automationScriptsCount: number;
  selectedAdoProject?: ADOProject | null;
  apiProjectId?: string | null;
  integrationType?: string;
  onTestPlanSaved?: () => void;
  onViewSavedTestPlans?: () => void;
}

export function TestingModals({
  fileBrowserModalOpen,
  setFileBrowserModalOpen,
  userStoriesModalOpen,
  setUserStoriesModalOpen,
  testPlanModalOpen,
  setTestPlanModalOpen,
  fileBrowserContent,
  setFileBrowserContent,
  manualScriptsCount,
  automationScriptsCount,
  selectedAdoProject,
  apiProjectId,
  integrationType,
  onTestPlanSaved,
  onViewSavedTestPlans,
}: TestingModalsProps) {
  const [testGenerationModalOpen, setTestGenerationModalOpen] = useState(false);
  const labels = getIntegrationLabels(integrationType);
  
  // Fetch epics, features, and user stories for test generation
  // **CRITICAL: Use the integration-aware hierarchy API to correctly fetch Jira/ADO work items**
  const { data: hierarchyData, isLoading: isLoadingHierarchy } = useQuery<any>({
    queryKey: ['/api/workflow/artifacts/hierarchy', apiProjectId, null, null, null, selectedAdoProject?.organization, selectedAdoProject?.name],
    queryFn: async () => {
      const params = new URLSearchParams({ projectId: apiProjectId as string });
      if (selectedAdoProject?.organization) params.append('organization', selectedAdoProject.organization);
      if (selectedAdoProject?.name) params.append('projectName', selectedAdoProject.name);
      
      const response = await apiRequest("GET", `/api/workflow/artifacts/hierarchy?${params.toString()}`);
      if (!response.ok) return { success: false, epics: [], features: [], userStories: [] };
      return response.json();
    },
    enabled: !!apiProjectId && testGenerationModalOpen,
  });

  const epics = (hierarchyData?.epics || []) as Epic[];
  const features = (hierarchyData?.features || []) as Feature[];
  const userStories = (hierarchyData?.userStories || []) as UserStory[];
  
  const handleGenerationComplete = () => {
    // Refresh any relevant data if needed
    queryClient.invalidateQueries({ 
      queryKey: [`/api/workflow-artifacts/${apiProjectId}`] 
    });
  };
  const handleFileBrowserItemClick = async (item: { name: string; type: 'file' | 'dir'; path: string; fullPath: string }) => {
    if (item.type === 'dir') {
      try {
        const response = await apiRequest(
          "GET",
          `/api/browse-directory?projectId=${encodeURIComponent(fileBrowserContent?.projectId || '')}&dirPath=${encodeURIComponent(item.fullPath)}`
        );

        // apiRequest already validates response.ok, so we can directly call .json()
        const result = await response.json();
        if (result.success) {
          const basePath = `AutomationScript/${fileBrowserContent?.projectId || ''}`;
          const relativePath = item.fullPath.startsWith(basePath + '/') 
            ? item.fullPath.substring(basePath.length + 1)
            : item.fullPath;

          setFileBrowserContent(prev => ({
            ...prev!,
            currentPath: relativePath,
            items: result.items || [],
            selectedFile: null,
            fileContent: ''
          }));
        }
      } catch (error) {
        console.error('Error navigating to directory:', error);
      }
    } else {
      try {
        const response = await apiRequest(
          "GET",
          `/api/preview-file-content?filePath=${encodeURIComponent(item.fullPath)}${fileBrowserContent?.projectId ? `&projectId=${encodeURIComponent(fileBrowserContent.projectId)}` : ""}`
        );

        // apiRequest already validates response.ok, so we can directly call .json()
        const result = await response.json();
        if (result.success) {
          setFileBrowserContent(prev => ({
            ...prev!,
            selectedFile: item.name,
            fileContent: result.content || 'File is empty or could not be loaded'
          }));
        }
      } catch (error) {
        console.error('Error loading file content:', error);
      }
    }
  };

  const handleFileBrowserNavigateBack = async () => {
    if (!fileBrowserContent?.currentPath || !fileBrowserContent?.projectId) return;
    
    try {
      const pathParts = fileBrowserContent.currentPath.split('/').filter(Boolean);
      pathParts.pop();
      
      const parentPath = pathParts.length > 0 
        ? `AutomationScript/${fileBrowserContent.projectId}/${pathParts.join('/')}`
        : undefined;
      
      const response = await apiRequest(
        "GET",
        `/api/browse-directory?projectId=${encodeURIComponent(fileBrowserContent.projectId)}${parentPath ? `&dirPath=${encodeURIComponent(parentPath)}` : ''}`
      );

      // apiRequest already validates response.ok, so we can directly call .json()
      const result = await response.json();
      if (result.success) {
        setFileBrowserContent(prev => ({
          ...prev!,
          currentPath: pathParts.join('/'),
          items: result.items || [],
          selectedFile: null,
          fileContent: ''
        }));
      }
    } catch (error) {
      console.error('Error navigating back:', error);
    }
  };

  return (
    <>
      {/* File Browser Modal for Testing Phase Automation Scripts */}
      <Dialog open={fileBrowserModalOpen} onOpenChange={setFileBrowserModalOpen}>
        <DialogContent className="max-w-6xl h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Test Automation Files</DialogTitle>
            <DialogDescription>
              Browse the generated test automation files in your GitHub repository.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex flex-1 gap-4 min-h-0 overflow-hidden">
            <div className="w-1/2 border rounded-lg flex flex-col">
              <div className="p-3 border-b flex justify-between items-center flex-shrink-0">
                <h3 className="font-medium text-sm">Project Structure</h3>
                {fileBrowserContent?.currentPath && (
                  <Button
                    variant="ghost" 
                    size="sm"
                    onClick={handleFileBrowserNavigateBack}
                    className="text-xs"
                  >
                    <ArrowLeft className="h-3 w-3 mr-1" />
                    Back
                  </Button>
                )}
              </div>
              
              <div className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  {fileBrowserContent ? (
                    <div className="p-3 space-y-1">
                      {fileBrowserContent.currentPath && (
                        <div className="text-xs text-muted-foreground mb-3 font-mono">
                          AutomationScript/{fileBrowserContent.projectId}{fileBrowserContent.currentPath && `/${fileBrowserContent.currentPath}`}
                        </div>
                      )}
                      
                      {fileBrowserContent.items && fileBrowserContent.items.length > 0 ? (
                        fileBrowserContent.items.map((item, index) => (
                          <button
                            key={index}
                            className={`flex items-center gap-2 p-2 text-sm rounded hover:bg-muted w-full text-left ${
                              item.type === 'dir' ? 'text-blue-600' : 'text-foreground'
                            }`}
                            onClick={() => handleFileBrowserItemClick(item)}
                          >
                            {item.type === 'dir' ? (
                              <Folder className="h-4 w-4 text-blue-500" />
                            ) : (
                              <FileText className="h-4 w-4 text-gray-500" />
                            )}
                            {item.name}
                          </button>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground text-center py-8">
                          {fileBrowserContent.message || 'No items found in this directory'}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                      Loading...
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>

            <div className="w-1/2 border rounded-lg flex flex-col">
              <div className="p-3 border-b">
                <h3 className="font-medium text-sm">
                  {fileBrowserContent?.selectedFile ? fileBrowserContent.selectedFile : 'Select a file to preview'}
                </h3>
              </div>
              
              <div className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  {fileBrowserContent?.fileContent ? (
                    <div className="p-4">
                      <div className="bg-muted rounded-lg p-4 max-h-none">
                        <pre className="text-sm whitespace-pre-wrap font-mono break-words overflow-wrap-anywhere">
                          {fileBrowserContent.fileContent}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      {fileBrowserContent?.selectedFile ? 'Loading file content...' : 'Click on a file to see its content'}
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setFileBrowserModalOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* User Stories Modal for Manual Scripts */}
      {apiProjectId && (selectedAdoProject || integrationType === "jira") && (
        <GenericModal
          open={userStoriesModalOpen}
          onOpenChange={setUserStoriesModalOpen}
          title="Manual Test Scripts"
          description="User stories available for manual testing"
          icon={FileText}
          iconClassName="bg-gradient-to-br from-purple-500 to-purple-600"
          fullScreen={false}
          contentClassName="max-w-3xl"
        >
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  User Stories Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-blue-600">{manualScriptsCount}</div>
                    <div className="text-sm text-muted-foreground">Total User Stories</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-600">{manualScriptsCount}</div>
                    <div className="text-sm text-muted-foreground">Ready for Testing</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-purple-600">100%</div>
                    <div className="text-sm text-muted-foreground">Coverage</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Project: {selectedAdoProject?.name || labels.repositoryLabel}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div>
                      <div className="font-medium">Manual Test Scenarios</div>
                      <div className="text-sm text-muted-foreground">
                        Each user story represents a test scenario that should be manually validated
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                      {manualScriptsCount} Stories
                    </Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                    <div>
                      <div className="font-medium text-green-700">Testing Status</div>
                      <div className="text-sm text-muted-foreground">
                        All user stories are ready for manual testing validation
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-green-100 text-green-700">
                      Ready
                    </Badge>
                  </div>

                  {/* Button to generate test cases */}
                  <div className="pt-2">
                    <Button
                      className="w-full"
                      onClick={() => {
                        setUserStoriesModalOpen(false);
                        setTestGenerationModalOpen(true);
                      }}
                    >
                      <TestTube className="h-4 w-4 mr-2" />
                      Generate Test Cases & Scripts
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </GenericModal>
      )}

      {/* Test Plan Generation Modal */}
      <TestPlanGenerationModal
        open={testPlanModalOpen}
        onOpenChange={setTestPlanModalOpen}
        projectId={apiProjectId}
        organizationId={selectedAdoProject?.organization || null}
        integrationType={integrationType}
        onSaved={onTestPlanSaved}
        onViewSaved={onViewSavedTestPlans}
      />

      {/* User Story Selection Modal for Test Generation */}
      {apiProjectId && (selectedAdoProject || integrationType === "jira") && (
        <UserStorySelectionModal
          open={testGenerationModalOpen}
          onOpenChange={setTestGenerationModalOpen}
          epics={epics}
          features={features}
          userStories={userStories}
          projectId={apiProjectId}
          sdlcProjectId={apiProjectId}
          projectName={selectedAdoProject?.name || labels.repositoryLabel}
          azureConfig={integrationType === "jira" ? null : {
            organization: selectedAdoProject?.organization || "",
            project: selectedAdoProject?.name || "",
          }}
          jiraConfig={integrationType === "jira" ? {
            instanceUrl: (selectedAdoProject as any)?.instanceUrl || "",
            projectKey: (selectedAdoProject as any)?.projectKey || "",
          } : null}
          wikiJobId={null}
          onGenerationComplete={handleGenerationComplete}
          integrationType={integrationType}
        />
      )}
    </>
  );
}