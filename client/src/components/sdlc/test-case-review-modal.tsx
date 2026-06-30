import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getIntegrationLabels } from "@/lib/integration-config";
import { apiRequest } from "@/lib/queryClient";
import {
  FileText,
  Loader2,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Info,
  Save,
  Edit3,
  X,
  Plus,
  Trash2,
  FileSpreadsheet,
  Download,
  GitBranch,
  FlaskConical,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

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

import type { GenerationStageInfo } from "./test-generation-progress";

interface TestCaseReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testCasesData: {
    storyId: string;
    storyTitle: string;
    // Core test types
    functional?: TestCase[];
    negative?: TestCase[];
    edgeCases?: TestCase[];
    accessibility?: TestCase[];
    // Extended test types
    performance?: TestCase[];
    security?: TestCase[];
    usability?: TestCase[];
    reliability?: TestCase[];
    selectedTypes?: {
      // Core types
      functional: boolean;
      negative: boolean;
      edgeCases: boolean;
      accessibility: boolean;
      // Extended types
      performance?: boolean;
      security?: boolean;
      usability?: boolean;
      reliability?: boolean;
    };
    userStoryObject?: any; // Full user story object for saving
  } | null;
  onSave: (editedTestCases: any) => void;
  onGenerateBdd: (editedTestCases: any) => void;
  shouldShowBddButton?: boolean;
  isSaving?: boolean;
  integrationType?: string;
  generationStages?: GenerationStageInfo[]; // NEW: Progress tracking
  currentStage?: 'manual' | 'features' | 'stepDefinitions' | null; // NEW: Current stage
  // Push intimation + success notification
  pushMessage?: string;
  pushProgress?: number;
  pushCompleted?: boolean;
  pushedViewUrl?: string | null;
  pushedItemsSummary?: {
    created?: number;
    skipped?: number;
    failed?: number;
  } | null;
  onClose?: () => void;
}

export function TestCaseReviewModal({
  open,
  onOpenChange,
  testCasesData,
  onSave,
  onGenerateBdd,
  shouldShowBddButton = false,
  isSaving = false,
  integrationType,
  generationStages,
  currentStage,
  pushMessage,
  pushProgress,
  pushCompleted = false,
  pushedViewUrl,
  pushedItemsSummary,
  onClose,
}: TestCaseReviewModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("functional");
  const [expandedTestCases, setExpandedTestCases] = useState<Set<string>>(new Set());
  const [editingTestCase, setEditingTestCase] = useState<string | null>(null);
  const [editedData, setEditedData] = useState<any>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Determine which categories are selected (default to core types if not specified)
  const selectedTypes = testCasesData?.selectedTypes || {
    functional: true,
    negative: true,
    edgeCases: true,
    accessibility: true,
    performance: false,
    security: false,
    usability: false,
    reliability: false,
  };
  
  // Get list of available categories based on selection (includes both core and extended types)
  const availableCategories = [
    // Core test types
    selectedTypes.functional && { key: 'functional', label: 'Functional', icon: '✓', color: 'blue' },
    selectedTypes.negative && { key: 'negative', label: 'Negative', icon: '✗', color: 'red' },
    selectedTypes.edgeCases && { key: 'edgeCases', label: 'Edge Cases', icon: '⚡', color: 'orange' },
    selectedTypes.accessibility && { key: 'accessibility', label: 'Accessibility', icon: '♿', color: 'purple' },
    // Extended test types
    selectedTypes.performance && { key: 'performance', label: 'Performance', icon: '🚀', color: 'green' },
    selectedTypes.security && { key: 'security', label: 'Security', icon: '🔒', color: 'yellow' },
    selectedTypes.usability && { key: 'usability', label: 'Usability', icon: '👥', color: 'pink' },
    selectedTypes.reliability && { key: 'reliability', label: 'Reliability', icon: '⚡', color: 'teal' },
  ].filter(Boolean) as Array<{ key: string; label: string; icon: string; color: string }>;

  // Update edited data when testCasesData changes
  useEffect(() => {
    if (testCasesData) {
      setEditedData(JSON.parse(JSON.stringify(testCasesData)));
      
      // Set initial selected category to first available category
      if (availableCategories.length > 0) {
        setSelectedCategory(availableCategories[0].key);
      }
    }
  }, [testCasesData]);

  // Update selected category if current one becomes unavailable
  useEffect(() => {
    const categoryKeys = availableCategories.map(c => c.key);
    if (!categoryKeys.includes(selectedCategory) && categoryKeys.length > 0) {
      setSelectedCategory(categoryKeys[0]);
    }
  }, [availableCategories, selectedCategory]);

  const toggleTestCase = (testCaseId: string) => {
    const newExpanded = new Set(expandedTestCases);
    if (newExpanded.has(testCaseId)) {
      newExpanded.delete(testCaseId);
    } else {
      newExpanded.add(testCaseId);
    }
    setExpandedTestCases(newExpanded);
  };

  const startEditing = (testCaseId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTestCase(testCaseId);
  };

  const stopEditing = () => {
    setEditingTestCase(null);
  };

  // Export to Excel function
  const handleExportExcel = async () => {
    if (!editedData) {
      toast.error("No test cases to export");
      return;
    }

    setIsExporting(true);
    try {
      const response = await apiRequest('POST', '/api/export-testcases-excel', {
        testCases: editedData,
        metadata: {
          storyTitle: editedData.storyTitle || storyTitle || 'Test Cases',
          storyId: editedData.storyId,
          generatedAt: new Date().toISOString()
        }
      });

      const blob = await response.blob();
      
      // Check if blob has content
      if (blob.size === 0) {
        toast.error("Excel file is empty. Please check that test cases were generated.");
        return;
      }
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // Generate filename
      const dateStr = new Date().toISOString().split('T')[0];
      const titleSlug = (editedData.storyTitle || storyTitle || 'TestCases')
        .replace(/[^a-z0-9]/gi, '_')
        .substring(0, 50);
      link.download = `DevX_TestCases_${titleSlug}_${dateStr}.xlsx`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success("Test cases exported to Excel successfully!");
    } catch (error) {
      console.error('[TestCaseReviewModal] Export error:', error);
      toast.error(
        error instanceof Error ? error.message : "Failed to export test cases to Excel"
      );
    } finally {
      setIsExporting(false);
    }
  };

  const updateTestCase = (category: string, testCaseId: string, field: string, value: any) => {
    setEditedData((prev: any) => {
      const updated = { ...prev };
      // Handle nested data structure
      const dataToUpdate = updated.testCases || updated;
      const categoryKey = category === "edgeCases" ? "edgeCases" : category;
      const testCases = dataToUpdate[categoryKey] || [];
      const index = testCases.findIndex((tc: TestCase) => tc.id === testCaseId);
      
      if (index !== -1) {
        testCases[index] = {
          ...testCases[index],
          [field]: value,
        };
        dataToUpdate[categoryKey] = testCases;
        if (updated.testCases) {
          updated.testCases = dataToUpdate;
        }
      }
      
      return updated;
    });
  };

  const addPrecondition = (category: string, testCaseId: string) => {
    setEditedData((prev: any) => {
      const updated = JSON.parse(JSON.stringify(prev)); // Deep clone
      const categoryKey = category === "edgeCases" ? "edgeCases" : category;
      const testCases = updated[categoryKey] || [];
      const index = testCases.findIndex((tc: TestCase) => tc.id === testCaseId);
      
      if (index !== -1) {
        testCases[index].preconditions = [...(testCases[index].preconditions || []), "New precondition"];
        updated[categoryKey] = testCases;
      }
      
      return updated;
    });
  };

  const removePrecondition = (category: string, testCaseId: string, preconditionIndex: number) => {
    setEditedData((prev: any) => {
      const updated = JSON.parse(JSON.stringify(prev)); // Deep clone
      const categoryKey = category === "edgeCases" ? "edgeCases" : category;
      const testCases = updated[categoryKey] || [];
      const tcIndex = testCases.findIndex((tc: TestCase) => tc.id === testCaseId);
      
      if (tcIndex !== -1 && testCases[tcIndex].preconditions) {
        testCases[tcIndex].preconditions.splice(preconditionIndex, 1);
        updated[categoryKey] = testCases;
      }
      
      return updated;
    });
  };

  const updatePrecondition = (category: string, testCaseId: string, index: number, value: string) => {
    setEditedData((prev: any) => {
      const updated = JSON.parse(JSON.stringify(prev)); // Deep clone
      const categoryKey = category === "edgeCases" ? "edgeCases" : category;
      const testCases = updated[categoryKey] || [];
      const tcIndex = testCases.findIndex((tc: TestCase) => tc.id === testCaseId);
      
      if (tcIndex !== -1 && testCases[tcIndex].preconditions) {
        testCases[tcIndex].preconditions[index] = value;
        updated[categoryKey] = testCases;
      }
      
      return updated;
    });
  };

  const addPostcondition = (category: string, testCaseId: string) => {
    setEditedData((prev: any) => {
      const updated = JSON.parse(JSON.stringify(prev)); // Deep clone
      const categoryKey = category === "edgeCases" ? "edgeCases" : category;
      const testCases = updated[categoryKey] || [];
      const index = testCases.findIndex((tc: TestCase) => tc.id === testCaseId);
      
      if (index !== -1) {
        testCases[index].postconditions = [...(testCases[index].postconditions || []), "New postcondition"];
        updated[categoryKey] = testCases;
      }
      
      return updated;
    });
  };

  const removePostcondition = (category: string, testCaseId: string, postconditionIndex: number) => {
    setEditedData((prev: any) => {
      const updated = JSON.parse(JSON.stringify(prev)); // Deep clone
      const categoryKey = category === "edgeCases" ? "edgeCases" : category;
      const testCases = updated[categoryKey] || [];
      const tcIndex = testCases.findIndex((tc: TestCase) => tc.id === testCaseId);
      
      if (tcIndex !== -1 && testCases[tcIndex].postconditions) {
        testCases[tcIndex].postconditions.splice(postconditionIndex, 1);
        updated[categoryKey] = testCases;
      }
      
      return updated;
    });
  };

  const updatePostcondition = (category: string, testCaseId: string, index: number, value: string) => {
    setEditedData((prev: any) => {
      const updated = JSON.parse(JSON.stringify(prev)); // Deep clone
      const categoryKey = category === "edgeCases" ? "edgeCases" : category;
      const testCases = updated[categoryKey] || [];
      const tcIndex = testCases.findIndex((tc: TestCase) => tc.id === testCaseId);
      
      if (tcIndex !== -1 && testCases[tcIndex].postconditions) {
        testCases[tcIndex].postconditions[index] = value;
        updated[categoryKey] = testCases;
      }
      
      return updated;
    });
  };

  const addTestStep = (category: string, testCaseId: string) => {
    setEditedData((prev: any) => {
      const updated = JSON.parse(JSON.stringify(prev)); // Deep clone
      const categoryKey = category === "edgeCases" ? "edgeCases" : category;
      const testCases = updated[categoryKey] || [];
      const index = testCases.findIndex((tc: TestCase) => tc.id === testCaseId);
      
      if (index !== -1) {
        const testCase = testCases[index];
        const steps = testCase.steps || [];
        steps.push({
          step: steps.length + 1,
          action: "New action - describe what to do",
          expectedResult: "New expected result - describe what should happen"
        });
        testCase.steps = steps;
        updated[categoryKey] = testCases;
      }
      
      return updated;
    });
  };

  const removeTestStep = (category: string, testCaseId: string, stepIndex: number) => {
    setEditedData((prev: any) => {
      const updated = JSON.parse(JSON.stringify(prev)); // Deep clone
      const categoryKey = category === "edgeCases" ? "edgeCases" : category;
      const testCases = updated[categoryKey] || [];
      const tcIndex = testCases.findIndex((tc: TestCase) => tc.id === testCaseId);
      
      if (tcIndex !== -1) {
        const testCase = testCases[tcIndex];
        const steps = testCase.steps || [];
        steps.splice(stepIndex, 1);
        
        // Renumber steps
        steps.forEach((step: any, idx: number) => {
          step.step = idx + 1;
        });
        
        testCase.steps = steps;
        updated[categoryKey] = testCases;
      }
      
      return updated;
    });
  };

  const updateTestCaseStep = (
    category: string,
    testCaseId: string,
    stepIndex: number,
    field: string,
    value: any
  ) => {
    setEditedData((prev: any) => {
      const updated = { ...prev };
      // Handle nested data structure
      const dataToUpdate = updated.testCases || updated;
      const categoryKey = category === "edgeCases" ? "edgeCases" : category;
      const testCases = dataToUpdate[categoryKey] || [];
      const tcIndex = testCases.findIndex((tc: TestCase) => tc.id === testCaseId);
      
      if (tcIndex !== -1) {
        const testCase = testCases[tcIndex];
        const steps = testCase.testCaseSteps || testCase.steps || [];
        
        if (steps[stepIndex]) {
          steps[stepIndex] = {
            ...steps[stepIndex],
            [field]: value,
          };
          
          if (testCase.testCaseSteps) {
            testCase.testCaseSteps = steps;
          } else {
            testCase.steps = steps;
          }
          
          testCases[tcIndex] = testCase;
          dataToUpdate[categoryKey] = testCases;
          if (updated.testCases) {
            updated.testCases = dataToUpdate;
          }
        }
      }
      
      return updated;
    });
  };

  const handleSave = () => {
    // Include user story object when saving
    const dataToSave = {
      ...editedData,
      userStoryObject: testCasesData?.userStoryObject
    };
    onSave(dataToSave);
  };

  const handleGenerateBDD = () => {
    // Include user story object when saving
    const dataToSave = {
      ...editedData,
      userStoryObject: testCasesData?.userStoryObject
    };
    onGenerateBdd(dataToSave);
  };

  const renderTestCase = (testCase: TestCase, category: string) => {
    const isExpanded = expandedTestCases.has(testCase.id);
    const isEditing = editingTestCase === testCase.id;
    const steps = testCase.testCaseSteps || testCase.steps || [];

    return (
      <Card
        key={testCase.id}
        className={cn(
          "mb-4 transition-all duration-200 border-2",
          isExpanded && "shadow-xl border-primary bg-gradient-to-br from-background to-muted/20",
          !isExpanded && "hover:shadow-lg hover:border-primary/50",
          !isEditing && "cursor-pointer"
        )}
        onClick={() => !isEditing && toggleTestCase(testCase.id)}
      >
        <CardHeader className={cn(
          "pb-4 transition-colors",
          isExpanded ? "bg-gradient-to-r from-primary/5 to-primary/10" : "bg-muted/30"
        )}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <div className={cn(
                  "p-1.5 rounded-full transition-all",
                  isExpanded ? "bg-primary text-primary-foreground" : "bg-muted"
                )}>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </div>
                <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded">
                  {testCase.id}
                </span>
                <Badge
                  variant={
                    testCase.priority === "High"
                      ? "destructive"
                      : testCase.priority === "Medium"
                      ? "default"
                      : "secondary"
                  }
                  className={cn(
                    "text-xs font-semibold px-3 py-1",
                    testCase.priority === "High" && "bg-red-100 text-red-800 border-red-300 dark:bg-red-900 dark:text-red-200"
                  )}
                >
                  {testCase.priority} Priority
                </Badge>
              </div>
              {isEditing ? (
                <Input
                  value={testCase.title}
                  onChange={(e) =>
                    updateTestCase(category, testCase.id, "title", e.target.value)
                  }
                  onClick={(e) => e.stopPropagation()}
                  className="text-base font-semibold mt-2 bg-white dark:bg-gray-800 border-2 focus:border-primary"
                />
              ) : (
                <CardTitle className="text-base font-semibold mt-2 leading-relaxed">
                  {testCase.title}
                </CardTitle>
              )}
            </div>
            {isExpanded && (
              <Button
                variant={isEditing ? "default" : "outline"}
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  isEditing ? stopEditing() : startEditing(testCase.id, e);
                }}
                className={cn(
                  "shrink-0 gap-2 font-semibold",
                  isEditing && "bg-primary hover:bg-primary/90"
                )}
              >
                {isEditing ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Done Editing
                  </>
                ) : (
                  <>
                    <Edit3 className="h-4 w-4" />
                    Edit Test Case
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>

        {isExpanded && (
          <CardContent className="pt-0 space-y-6" onClick={(e) => e.stopPropagation()}>
            {/* Preconditions */}
            <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-600" />
                  Preconditions
                </h4>
                {isEditing && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => addPrecondition(category, testCase.id)}
                    className="h-7 px-2 text-blue-600 hover:text-blue-700"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {testCase.preconditions && testCase.preconditions.length > 0 ? (
                  testCase.preconditions.map((pre, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="text-blue-600 font-mono text-xs mt-2">{idx + 1}.</span>
                      {isEditing ? (
                        <>
                          <Input
                            value={pre}
                            onChange={(e) => updatePrecondition(category, testCase.id, idx, e.target.value)}
                            className="flex-1"
                            placeholder="Enter precondition..."
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removePrecondition(category, testCase.id, idx)}
                            className="h-9 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      ) : (
                        <span className="text-sm text-foreground flex-1">{pre}</span>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground italic">No preconditions defined</p>
                )}
              </div>
            </div>

            {/* Test Steps */}
            <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-green-600" />
                  Test Steps
                </h4>
                {isEditing && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => addTestStep(category, testCase.id)}
                    className="h-7 px-2 text-green-600 hover:text-green-700"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Step
                  </Button>
                )}
              </div>
              
              {steps.length > 0 ? (
                <div className="border rounded-lg overflow-hidden bg-white dark:bg-gray-900">
                  <table className="w-full text-sm">
                    <thead className="bg-green-100 dark:bg-green-900">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold w-20">Step</th>
                        <th className="px-4 py-3 text-left font-semibold w-[40%]">Action</th>
                        <th className="px-4 py-3 text-left font-semibold w-[40%]">Expected Result</th>
                        {isEditing && <th className="px-4 py-3 w-16"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {steps.map((step: any, idx: number) => {
                        const stepNumber = step.Steps || step.step || idx + 1;
                        const action = step.Action || step.action || "";
                        const expectedResult = step["Expected Results"] || step.expectedResult || "";

                        return (
                          <tr key={idx} className="border-t hover:bg-green-50/50 dark:hover:bg-green-950/50">
                            <td className="px-4 py-3 align-top">
                              <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-300">
                                {stepNumber}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 align-top">
                              {isEditing ? (
                                <Textarea
                                  value={action}
                                  onChange={(e) =>
                                    updateTestCaseStep(
                                      category,
                                      testCase.id,
                                      idx,
                                      step.Action ? "Action" : "action",
                                      e.target.value
                                    )
                                  }
                                  className="w-full min-h-[60px]"
                                  rows={2}
                                />
                              ) : (
                                <div className="text-foreground whitespace-pre-wrap">{action}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 align-top">
                              {isEditing ? (
                                <Textarea
                                  value={expectedResult}
                                  onChange={(e) =>
                                    updateTestCaseStep(
                                      category,
                                      testCase.id,
                                      idx,
                                      step["Expected Results"] ? "Expected Results" : "expectedResult",
                                      e.target.value
                                    )
                                  }
                                  className="w-full min-h-[60px]"
                                  rows={2}
                                />
                              ) : (
                                <div className="text-green-700 dark:text-green-400 font-medium whitespace-pre-wrap">{expectedResult}</div>
                              )}
                            </td>
                            {isEditing && (
                              <td className="px-4 py-3 align-top">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => removeTestStep(category, testCase.id, idx)}
                                  className="h-9 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">No test steps defined</p>
              )}
            </div>

            {/* Postconditions */}
            <div className="bg-purple-50 dark:bg-purple-950 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-purple-600" />
                  Postconditions
                </h4>
                {isEditing && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => addPostcondition(category, testCase.id)}
                    className="h-7 px-2 text-purple-600 hover:text-purple-700"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {testCase.postconditions && testCase.postconditions.length > 0 ? (
                  testCase.postconditions.map((post, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="text-purple-600 font-mono text-xs mt-2">{idx + 1}.</span>
                      {isEditing ? (
                        <>
                          <Input
                            value={post}
                            onChange={(e) => updatePostcondition(category, testCase.id, idx, e.target.value)}
                            className="flex-1"
                            placeholder="Enter postcondition..."
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removePostcondition(category, testCase.id, idx)}
                            className="h-9 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      ) : (
                        <span className="text-sm text-foreground flex-1">{post}</span>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground italic">No postconditions defined</p>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    );
  };

  if (!testCasesData || !editedData) {
    return null;
  }

  if (editedData.storyTitle === "Parsing failed - manual review required") {
    console.error("[TestCaseReviewModal] Generation failed - received fallback data");
  }

  // Handle different data formats - backend might return nested structure
  // The backend returns: { storyId, storyTitle, functional: [], negative: [], edgeCases: [], accessibility: [] }
  const data = editedData;
  
  // Core test case arrays
  const functionalTests = data.functional || [];
  const negativeTests = data.negative || [];
  const edgeCaseTests = data.edgeCases || [];
  const accessibilityTests = data.accessibility || [];
  
  // Extended test case arrays
  const performanceTests = data.performance || [];
  const securityTests = data.security || [];
  const usabilityTests = data.usability || [];
  const reliabilityTests = data.reliability || [];

  const totalTests =
    (selectedTypes.functional ? functionalTests.length : 0) +
    (selectedTypes.negative ? negativeTests.length : 0) +
    (selectedTypes.edgeCases ? edgeCaseTests.length : 0) +
    (selectedTypes.accessibility ? accessibilityTests.length : 0) +
    (selectedTypes.performance ? performanceTests.length : 0) +
    (selectedTypes.security ? securityTests.length : 0) +
    (selectedTypes.usability ? usabilityTests.length : 0) +
    (selectedTypes.reliability ? reliabilityTests.length : 0);

  const selectedTestCount = availableCategories.length;
  const storyTitle = data.storyTitle || editedData.storyTitle || testCasesData.storyTitle || "User Story";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] h-[95vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0 pb-3 border-b">
          <DialogTitle className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <span className="text-lg">Review & Edit Test Cases</span>
            </div>
            <Badge variant="default" className="text-sm px-3 py-1">
              {totalTests} test cases
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-sm mt-1 line-clamp-1">
            {storyTitle}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden pt-3">

          <Tabs
            value={selectedCategory}
            onValueChange={setSelectedCategory}
            className="flex-1 flex flex-col overflow-hidden"
          >
            <TabsList className={`grid w-full flex-shrink-0 h-12 bg-gradient-to-r from-muted to-muted/50`} style={{ gridTemplateColumns: `repeat(${availableCategories.length}, 1fr)` }}>
              {selectedTypes.functional && (
                <TabsTrigger value="functional" className="text-sm font-semibold data-[state=active]:bg-blue-500 data-[state=active]:text-white">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Functional
                    <Badge variant="secondary" className="ml-1 bg-white/20 text-current">
                      {functionalTests.length}
                    </Badge>
                  </div>
                </TabsTrigger>
              )}
              {selectedTypes.negative && (
                <TabsTrigger value="negative" className="text-sm font-semibold data-[state=active]:bg-red-500 data-[state=active]:text-white">
                  <div className="flex items-center gap-2">
                    <X className="h-4 w-4" />
                    Negative
                    <Badge variant="secondary" className="ml-1 bg-white/20 text-current">
                      {negativeTests.length}
                    </Badge>
                  </div>
                </TabsTrigger>
              )}
              {selectedTypes.edgeCases && (
                <TabsTrigger value="edgeCases" className="text-sm font-semibold data-[state=active]:bg-orange-500 data-[state=active]:text-white">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Edge Cases
                    <Badge variant="secondary" className="ml-1 bg-white/20 text-current">
                      {edgeCaseTests.length}
                    </Badge>
                  </div>
                </TabsTrigger>
              )}
              {selectedTypes.accessibility && (
                <TabsTrigger value="accessibility" className="text-sm font-semibold data-[state=active]:bg-purple-500 data-[state=active]:text-white">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Accessibility
                    <Badge variant="secondary" className="ml-1 bg-white/20 text-current">
                      {accessibilityTests.length}
                    </Badge>
                  </div>
                </TabsTrigger>
              )}
              {selectedTypes.performance && (
                <TabsTrigger value="performance" className="text-sm font-semibold data-[state=active]:bg-green-500 data-[state=active]:text-white">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🚀</span>
                    Performance
                    <Badge variant="secondary" className="ml-1 bg-white/20 text-current">
                      {performanceTests.length}
                    </Badge>
                  </div>
                </TabsTrigger>
              )}
              {selectedTypes.security && (
                <TabsTrigger value="security" className="text-sm font-semibold data-[state=active]:bg-yellow-500 data-[state=active]:text-white">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🔒</span>
                    Security
                    <Badge variant="secondary" className="ml-1 bg-white/20 text-current">
                      {securityTests.length}
                    </Badge>
                  </div>
                </TabsTrigger>
              )}
              {selectedTypes.usability && (
                <TabsTrigger value="usability" className="text-sm font-semibold data-[state=active]:bg-pink-500 data-[state=active]:text-white">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">👥</span>
                    Usability
                    <Badge variant="secondary" className="ml-1 bg-white/20 text-current">
                      {usabilityTests.length}
                    </Badge>
                  </div>
                </TabsTrigger>
              )}
              {selectedTypes.reliability && (
                <TabsTrigger value="reliability" className="text-sm font-semibold data-[state=active]:bg-teal-500 data-[state=active]:text-white">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">⚡</span>
                    Reliability
                    <Badge variant="secondary" className="ml-1 bg-white/20 text-current">
                      {reliabilityTests.length}
                    </Badge>
                  </div>
                </TabsTrigger>
              )}
            </TabsList>

            <ScrollArea className="flex-1 mt-4">
              {selectedTypes.functional && (
                <TabsContent value="functional" className="mt-0 px-2">
                  {functionalTests.length === 0 ? (
                    <div className="text-center py-16 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 rounded-lg border-2 border-dashed border-blue-300">
                      <CheckCircle2 className="h-12 w-12 mx-auto text-blue-400 mb-4" />
                      <div className="text-lg font-semibold text-blue-700 dark:text-blue-300">No functional test cases generated</div>
                      <div className="text-sm text-blue-600 dark:text-blue-400 mt-2">Response may have been truncated. Try generating again.</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {functionalTests.map((tc: TestCase) => renderTestCase(tc, "functional"))}
                    </div>
                  )}
                </TabsContent>
              )}

              {selectedTypes.negative && (
                <TabsContent value="negative" className="mt-0 px-2">
                  {negativeTests.length === 0 ? (
                    <div className="text-center py-16 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900 rounded-lg border-2 border-dashed border-red-300">
                      <X className="h-12 w-12 mx-auto text-red-400 mb-4" />
                      <div className="text-lg font-semibold text-red-700 dark:text-red-300">No negative test cases generated</div>
                      <div className="text-sm text-red-600 dark:text-red-400 mt-2">Response may have been truncated. Try generating again.</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {negativeTests.map((tc: TestCase) => renderTestCase(tc, "negative"))}
                    </div>
                  )}
                </TabsContent>
              )}

              {selectedTypes.edgeCases && (
                <TabsContent value="edgeCases" className="mt-0 px-2">
                  {edgeCaseTests.length === 0 ? (
                    <div className="text-center py-16 bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900 rounded-lg border-2 border-dashed border-orange-300">
                      <Info className="h-12 w-12 mx-auto text-orange-400 mb-4" />
                      <div className="text-lg font-semibold text-orange-700 dark:text-orange-300">No edge case test cases generated</div>
                      <div className="text-sm text-orange-600 dark:text-orange-400 mt-2">Response may have been truncated. Try generating again.</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {edgeCaseTests.map((tc: TestCase) => renderTestCase(tc, "edgeCases"))}
                    </div>
                  )}
                </TabsContent>
              )}

              {selectedTypes.accessibility && (
                <TabsContent value="accessibility" className="mt-0 px-2">
                  {accessibilityTests.length === 0 ? (
                    <div className="text-center py-16 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 rounded-lg border-2 border-dashed border-purple-300">
                      <FileText className="h-12 w-12 mx-auto text-purple-400 mb-4" />
                      <div className="text-lg font-semibold text-purple-700 dark:text-purple-300">No accessibility test cases generated</div>
                      <div className="text-sm text-purple-600 dark:text-purple-400 mt-2">Response may have been truncated. Try generating again.</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {accessibilityTests.map((tc: TestCase) => renderTestCase(tc, "accessibility"))}
                    </div>
                  )}
                </TabsContent>
              )}

              {/* Extended Test Types */}
              {selectedTypes.performance && (
                <TabsContent value="performance" className="mt-0 px-2">
                  {performanceTests.length === 0 ? (
                    <div className="text-center py-16 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 rounded-lg border-2 border-dashed border-green-300">
                      <span className="text-4xl mb-4 block">🚀</span>
                      <div className="text-lg font-semibold text-green-700 dark:text-green-300">No performance test cases generated</div>
                      <div className="text-sm text-green-600 dark:text-green-400 mt-2">Performance tests were not generated or response was truncated.</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {performanceTests.map((tc: TestCase) => renderTestCase(tc, "performance"))}
                    </div>
                  )}
                </TabsContent>
              )}

              {selectedTypes.security && (
                <TabsContent value="security" className="mt-0 px-2">
                  {securityTests.length === 0 ? (
                    <div className="text-center py-16 bg-gradient-to-br from-yellow-50 to-yellow-100 dark:from-yellow-950 dark:to-yellow-900 rounded-lg border-2 border-dashed border-yellow-300">
                      <span className="text-4xl mb-4 block">🔒</span>
                      <div className="text-lg font-semibold text-yellow-700 dark:text-yellow-300">No security test cases generated</div>
                      <div className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">Security tests were not generated or response was truncated.</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {securityTests.map((tc: TestCase) => renderTestCase(tc, "security"))}
                    </div>
                  )}
                </TabsContent>
              )}

              {selectedTypes.usability && (
                <TabsContent value="usability" className="mt-0 px-2">
                  {usabilityTests.length === 0 ? (
                    <div className="text-center py-16 bg-gradient-to-br from-pink-50 to-pink-100 dark:from-pink-950 dark:to-pink-900 rounded-lg border-2 border-dashed border-pink-300">
                      <span className="text-4xl mb-4 block">👥</span>
                      <div className="text-lg font-semibold text-pink-700 dark:text-pink-300">No usability test cases generated</div>
                      <div className="text-sm text-pink-600 dark:text-pink-400 mt-2">Usability tests were not generated or response was truncated.</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {usabilityTests.map((tc: TestCase) => renderTestCase(tc, "usability"))}
                    </div>
                  )}
                </TabsContent>
              )}

              {selectedTypes.reliability && (
                <TabsContent value="reliability" className="mt-0 px-2">
                  {reliabilityTests.length === 0 ? (
                    <div className="text-center py-16 bg-gradient-to-br from-teal-50 to-teal-100 dark:from-teal-950 dark:to-teal-900 rounded-lg border-2 border-dashed border-teal-300">
                      <span className="text-4xl mb-4 block">⚡</span>
                      <div className="text-lg font-semibold text-teal-700 dark:text-teal-300">No reliability test cases generated</div>
                      <div className="text-sm text-teal-600 dark:text-teal-400 mt-2">Reliability tests were not generated or response was truncated.</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {reliabilityTests.map((tc: TestCase) => renderTestCase(tc, "reliability"))}
                    </div>
                  )}
                </TabsContent>
              )}
            </ScrollArea>
          </Tabs>
        </div>

        {/* Push intimation — labelled progress bar shown while pushing to ADO/Jira */}
        {isSaving && !pushCompleted && (
          <div className="mx-6 mb-4 space-y-3 p-4 bg-primary/5 rounded-xl border border-primary/10 animate-in fade-in slide-in-from-top-2 duration-500">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />
                <span className="font-medium text-sm truncate">
                  {pushMessage || `Pushing test cases to ${getIntegrationLabels(integrationType).longName}…`}
                </span>
              </div>
              <span className="text-sm font-bold text-primary flex-shrink-0 ml-3">
                {Math.min(100, Math.max(0, pushProgress ?? 0))}%
              </span>
            </div>
            <Progress value={Math.min(100, Math.max(0, pushProgress ?? 0))} className="h-2" />
          </div>
        )}

        {/* Push success card — replaces the bar once the push finishes successfully */}
        {pushCompleted && (
          <div className="mx-6 mb-4 p-6 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-800 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6" />
              <span className="font-bold text-lg">Push Completed!</span>
            </div>
            {pushedItemsSummary && (
              <p className="text-sm">
                {pushedItemsSummary.created ?? 0} created
                {pushedItemsSummary.skipped ? ` · ${pushedItemsSummary.skipped} skipped` : ""}
                {pushedItemsSummary.failed ? ` · ${pushedItemsSummary.failed} failed` : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              {pushedViewUrl && (
                <Button asChild variant="outline" className="bg-background">
                  <a
                    href={pushedViewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gap-2"
                  >
                    View in {getIntegrationLabels(integrationType).longName}
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="flex-shrink-0 pt-6 border-t bg-gradient-to-r from-muted/30 to-muted/10">
          <div className="flex items-center justify-between w-full">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Info className="h-4 w-4" />
              <span>
                {pushCompleted
                  ? `Test cases were pushed to ${getIntegrationLabels(integrationType).longName}. Click Done to close this window.`
                  : shouldShowBddButton 
                    ? `Review test cases, then click "${getIntegrationLabels(integrationType).pushActionLabel}" or "Generate Automation Script" to complete your workflow`
                    : `Review test cases, then click "${getIntegrationLabels(integrationType).pushActionLabel}" to push them to ${getIntegrationLabels(integrationType).longName}`}
              </span>
            </div>
            <div className="flex gap-3">
              {pushCompleted ? (
                <Button
                  onClick={() => (onClose ? onClose() : onOpenChange(false))}
                  className="min-w-[120px] bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Done
                </Button>
              ) : (
                <>
                  <Button 
                    variant="outline" 
                    onClick={() => onOpenChange(false)} 
                    className="min-w-[100px]"
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleExportExcel} 
                    disabled={isExporting || isSaving}
                    variant="outline"
                    className="min-w-[180px] bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white border-green-600 hover:border-green-700"
                  >
                    {isExporting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Exporting...
                      </>
                    ) : (
                      <>
                        <FileSpreadsheet className="mr-2 h-4 w-4" />
                        Export to Excel
                      </>
                    )}
                  </Button>
                  <Button 
                    onClick={handleSave} 
                    disabled={isSaving || isExporting}
                    className="min-w-[160px] bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Pushing...
                      </>
                    ) : (
                      <>
                        <GitBranch className="mr-2 h-4 w-4" />
                        {getIntegrationLabels(integrationType).pushActionLabel}
                      </>
                    )}
                  </Button>
                  {shouldShowBddButton && (
                    <Button 
                      onClick={handleGenerateBDD} 
                      disabled={isExporting || isSaving}
                      className="min-w-[200px] bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
                    >
                      <FlaskConical className="mr-2 h-4 w-4" />
                      Generate Automation Script
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
