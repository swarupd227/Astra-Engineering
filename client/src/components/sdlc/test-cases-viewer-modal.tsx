import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  FileText,
  User,
  Loader2,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Info,
  RefreshCw,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";

interface TestCasesViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedAdoProject?: {
    id: string;
    name: string;
    organization: string;
    organizationUrl: string;
  } | null;
  apiProjectId?: string | null;
}

interface TestCase {
  id: string;
  title: string;
  category: string;
  priority: string;
  preconditions: string[];
  testCaseSteps?: Array<{
    Steps: number;
    Action: string;
    "Expected Results": string;
  }>;
  steps?: Array<{
    step: number;
    action: string;
    expectedResult: string;
  }>;
  postconditions: string[];
}

interface UserStoryTestCases {
  storyId: string;
  storyTitle: string;
  functional?: TestCase[];
  negative?: TestCase[];
  edgeCases?: TestCase[];
  accessibility?: TestCase[];
  testCases?: TestCase[]; // Fallback for old format
}

export function TestCasesViewerModal({
  open,
  onOpenChange,
  selectedAdoProject,
  apiProjectId,
}: TestCasesViewerModalProps) {
  const jiraOnly = useJiraOnlyWorkItems();
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [expandedTestCases, setExpandedTestCases] = useState<Set<string>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<string>("functional");

  const workItemsUrl = jiraOnly
    ? `/api/hub/artifacts/jira/${apiProjectId}/work-items`
    : `/api/hub/artifacts/${apiProjectId}/work-items`;

  // Fetch user stories
  const { data: workItems = [], isLoading: isLoadingStories } = useQuery<any[]>({
    queryKey: [workItemsUrl],
    enabled: !!apiProjectId && open,
    retry: false,
    throwOnError: false,
  });

  // Extract user stories from work items
  const userStories = workItems
    .filter((item) => item.type === "User Story")
    .sort((a, b) => a.title.localeCompare(b.title));

  // Fetch test cases for the selected user story
  const [testCasesData, setTestCasesData] = useState<UserStoryTestCases | null>(null);
  const [loadingTestCases, setLoadingTestCases] = useState(false);

  const loadTestCases = async (storyId: string, storyTitle: string) => {
    setLoadingTestCases(true);
    try {
      const organization = selectedAdoProject?.organization || 'unknown-org';
      const projectName = selectedAdoProject?.name || 'default-project';
      const sanitizeFileName = (name: string) =>
        name.replace(/[^a-zA-Z0-9\s\-_]/g, '').replace(/\s+/g, '-').toLowerCase();
      
      const directoryName = `${sanitizeFileName(organization)}-${sanitizeFileName(projectName)}`;
      const storyName = sanitizeFileName(storyTitle);
      
      // Try to fetch test cases JSON file from GitHub
      const response = await apiRequest(
        "GET",
        `/api/preview-file-content?filePath=AutomationScript/${directoryName}/${projectName}/${storyName}/${storyName}/test-cases.json`
      );

      if (response.ok) {
        const result = await response.json();
        const content = result.content;
        
        // Parse the JSON content
        try {
          const parsed = JSON.parse(content);
          setTestCasesData({
            storyId,
            storyTitle,
            functional: parsed.functional || [],
            negative: parsed.negative || [],
            edgeCases: parsed.edgeCases || [],
            accessibility: parsed.accessibility || [],
            testCases: parsed.testCases || [], // Fallback
          });
        } catch (parseError) {
          console.error("Error parsing test cases:", parseError);
          toast.error("Failed to parse test cases");
          setTestCasesData(null);
        }
      } else {
        toast.error("No test cases found for this user story");
        setTestCasesData(null);
      }
    } catch (error) {
      console.error("Error loading test cases:", error);
      toast.error("Failed to load test cases");
      setTestCasesData(null);
    } finally {
      setLoadingTestCases(false);
    }
  };

  const handleStoryClick = (story: any) => {
    setSelectedStoryId(story.id);
    setExpandedTestCases(new Set());
    loadTestCases(story.id, story.title);
  };

  const toggleTestCase = (testCaseId: string) => {
    const newExpanded = new Set(expandedTestCases);
    if (newExpanded.has(testCaseId)) {
      newExpanded.delete(testCaseId);
    } else {
      newExpanded.add(testCaseId);
    }
    setExpandedTestCases(newExpanded);
  };

  const renderTestCase = (testCase: TestCase) => {
    const isExpanded = expandedTestCases.has(testCase.id);
    const steps = testCase.testCaseSteps || testCase.steps || [];

    return (
      <Card
        key={testCase.id}
        className={cn(
          "mb-3 cursor-pointer transition-all hover:shadow-md",
          isExpanded && "shadow-lg border-primary"
        )}
        onClick={() => toggleTestCase(testCase.id)}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-primary flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-xs font-mono text-muted-foreground">{testCase.id}</span>
                <Badge
                  variant={
                    testCase.priority === "High"
                      ? "destructive"
                      : testCase.priority === "Medium"
                      ? "default"
                      : "secondary"
                  }
                  className="text-xs"
                >
                  {testCase.priority}
                </Badge>
              </div>
              <CardTitle className="text-sm font-semibold mt-2">{testCase.title}</CardTitle>
            </div>
          </div>
        </CardHeader>

        {isExpanded && (
          <CardContent className="pt-0 space-y-4">
            {/* Preconditions */}
            {testCase.preconditions && testCase.preconditions.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-500" />
                  Preconditions
                </h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground pl-6">
                  {testCase.preconditions.map((pre, idx) => (
                    <li key={idx}>{pre}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Test Steps */}
            {steps.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-green-500" />
                  Test Steps
                </h4>
                <div className="space-y-3">
                  {steps.map((step: any, idx: number) => {
                    const stepNumber = step.Steps || step.step || idx + 1;
                    const action = step.Action || step.action || "";
                    const expectedResult = step["Expected Results"] || step.expectedResult || "";

                    return (
                      <div
                        key={idx}
                        className="border-l-2 border-primary pl-4 py-2 bg-muted/30 rounded-r"
                      >
                        <div className="flex items-start gap-2 mb-2">
                          <Badge variant="outline" className="text-xs">
                            Step {stepNumber}
                          </Badge>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div>
                            <span className="font-semibold text-foreground">Action: </span>
                            <span className="text-muted-foreground">{action}</span>
                          </div>
                          <div>
                            <span className="font-semibold text-green-600">
                              Expected Result:{" "}
                            </span>
                            <span className="text-muted-foreground">{expectedResult}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Postconditions */}
            {testCase.postconditions && testCase.postconditions.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Postconditions
                </h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground pl-6">
                  {testCase.postconditions.map((post, idx) => (
                    <li key={idx}>{post}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    );
  };

  const renderTestCasesContent = () => {
    if (!selectedStoryId) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <div className="text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Select a user story to view test cases</p>
          </div>
        </div>
      );
    }

    if (loadingTestCases) {
      return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }

    if (!testCasesData) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50 text-orange-500" />
            <p>No test cases found for this user story</p>
            <p className="text-sm mt-2">Generate test cases first</p>
          </div>
        </div>
      );
    }

    const functionalTests = testCasesData.functional || [];
    const negativeTests = testCasesData.negative || [];
    const edgeCaseTests = testCasesData.edgeCases || [];
    const accessibilityTests = testCasesData.accessibility || [];
    const fallbackTests = testCasesData.testCases || [];

    return (
      <Tabs value={selectedCategory} onValueChange={setSelectedCategory} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="functional" className="text-xs">
            Functional ({functionalTests.length})
          </TabsTrigger>
          <TabsTrigger value="negative" className="text-xs">
            Negative ({negativeTests.length})
          </TabsTrigger>
          <TabsTrigger value="edgeCases" className="text-xs">
            Edge Cases ({edgeCaseTests.length})
          </TabsTrigger>
          <TabsTrigger value="accessibility" className="text-xs">
            Accessibility ({accessibilityTests.length})
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="h-[500px] mt-4">
          <TabsContent value="functional" className="mt-0">
            {functionalTests.length === 0 && fallbackTests.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No functional test cases found
              </div>
            ) : (
              <>
                {functionalTests.map(renderTestCase)}
                {fallbackTests.filter(tc => tc.category === "Functional").map(renderTestCase)}
              </>
            )}
          </TabsContent>

          <TabsContent value="negative" className="mt-0">
            {negativeTests.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No negative test cases found
              </div>
            ) : (
              negativeTests.map(renderTestCase)
            )}
          </TabsContent>

          <TabsContent value="edgeCases" className="mt-0">
            {edgeCaseTests.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No edge case test cases found
              </div>
            ) : (
              edgeCaseTests.map(renderTestCase)
            )}
          </TabsContent>

          <TabsContent value="accessibility" className="mt-0">
            {accessibilityTests.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No accessibility test cases found
              </div>
            ) : (
              accessibilityTests.map(renderTestCase)
            )}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] h-[95vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Manual Test Cases - {selectedAdoProject?.name || "Project"}
          </DialogTitle>
          <DialogDescription>
            View detailed manual test cases for user stories organized by category
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex gap-4 overflow-hidden">
          {/* Left Panel - User Stories List */}
          <div className="w-[30%] flex flex-col border-r">
            <div className="pb-3 border-b flex-shrink-0">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <User className="h-4 w-4" />
                User Stories ({userStories.length})
              </h3>
            </div>
            <ScrollArea className="flex-1 pr-4">
              {isLoadingStories ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : userStories.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  No user stories found
                </div>
              ) : (
                <div className="space-y-2 py-2">
                  {userStories.map((story) => (
                    <Card
                      key={story.id}
                      className={cn(
                        "cursor-pointer transition-all hover:shadow-md",
                        selectedStoryId === story.id && "border-primary shadow-md bg-accent"
                      )}
                      onClick={() => handleStoryClick(story)}
                    >
                      <CardContent className="p-3">
                        <p className="text-sm font-medium line-clamp-2">{story.title}</p>
                        {story.storyPoints && (
                          <Badge variant="outline" className="text-xs mt-2">
                            {story.storyPoints} pts
                          </Badge>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Right Panel - Test Cases with Tabs */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {renderTestCasesContent()}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
