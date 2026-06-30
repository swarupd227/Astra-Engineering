import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TestCaseReviewModal } from "../sdlc/test-case-review-modal";
import { BDDAssetsActionsModal } from "../sdlc/bdd-assets-actions-modal"; // NEW
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  FileText, 
  Loader2, 
  CheckCircle,
  TestTube,
  AlertCircle,
  User,
  Plus,
  Eye,
  Folder,
  ChevronRight,
  ChevronDown,
  Copy,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { pollAsyncJob } from "@/lib/async-job-poller";
import toast from "react-hot-toast";
import type { Epic, Feature, UserStory } from "@shared/schema";

interface UserStorySelectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  onGenerationComplete?: () => void;
  preSelectedStoryId?: string | null;
  integrationType?: string;
  jiraConfig?: {
    instanceUrl?: string;
    projectKey?: string;
  } | null;
}

interface TestCaseTypes {
  functional: boolean;
  negative: boolean;
  edgeCases: boolean;
  accessibility: boolean;
}

type TestFramework = 'playwright' | 'selenium';

interface GenerationStage {
  id: 'manual' | 'features' | 'stepDefinitions';
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  errorMessage?: string;
}

export function UserStorySelectionModal({
  open,
  onOpenChange,
  epics,
  features,
  userStories,
  projectId,
  sdlcProjectId,
  projectName,
  azureConfig,
  wikiJobId,
  onGenerationComplete,
  preSelectedStoryId,
  integrationType,
  jiraConfig,
}: UserStorySelectionModalProps) {
  const [selectedUserStoryId, setSelectedUserStoryId] = useState<string>("");
  const [selectedUserStory, setSelectedUserStory] = useState<UserStory | null>(null);
  const [githubConfig, setGithubConfig] = useState<{owner: string; repo: string; branch: string} | null>(null);
  const [testCaseTypes, setTestCaseTypes] = useState<TestCaseTypes>({
    functional: true,
    negative: true,
    edgeCases: true,
    accessibility: true,
  });
  const [testFramework, setTestFramework] = useState<TestFramework>('playwright'); // NEW: Framework selection
  const [generationStages, setGenerationStages] = useState<GenerationStage[]>([ // NEW: Multi-stage tracking
    { id: 'manual', title: 'Manual Test Cases', description: 'Generate comprehensive test case documentation', status: 'pending' },
    { id: 'features', title: 'Feature Files', description: 'Create BDD Gherkin feature files', status: 'pending' },
    { id: 'stepDefinitions', title: 'Step Definitions', description: 'Generate TypeScript step definition files', status: 'pending' },
  ]);
  const [currentStage, setCurrentStage] = useState<'manual' | 'features' | 'stepDefinitions' | null>(null);
  
  // BDD Assets state
  const [showBDDActionsModal, setShowBDDActionsModal] = useState(false);
  const [generatedBDDAssets, setGeneratedBDDAssets] = useState<{
    featureFiles: any[];
    stepDefFiles: any[];
    userStory: any;
    framework: string;
  } | null>(null);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState<string>("");
  const [generationResult, setGenerationResult] = useState<{
    success: boolean;
    message: string;
    gitHubUrls: string[];
    stats: any;
  } | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(false);
  const [existingTests, setExistingTests] = useState<any>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [generatedTestCasesForReview, setGeneratedTestCasesForReview] = useState<any>(null);
  const [isSavingReviewedCases, setIsSavingReviewedCases] = useState(false);
  
  // File browser states
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [loadingFileContent, setLoadingFileContent] = useState(false);
  const [directoryStructure, setDirectoryStructure] = useState<any>(null);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  
  // Fetch GitHub config on mount
  useEffect(() => {
    const fetchGithubConfig = async () => {
      try {
        const response = await apiRequest("GET", "/api/github-config");
        if (response.ok) {
          const config = await response.json();
          setGithubConfig({
            owner: config.owner || 'your-org',
            repo: config.repo || 'your-repo',
            branch: config.branch || 'main'
          });
        }
      } catch (error) {
        // Silently fail - GitHub config is optional
      }
    };
    fetchGithubConfig();
  }, []);

  // Reset state when modal opens/closes or pre-select story
  useEffect(() => {
    if (open) {
      // Pre-select story if provided
      if (preSelectedStoryId) {
        setSelectedUserStoryId(preSelectedStoryId);
      } else {
        setSelectedUserStoryId("");
        setSelectedUserStory(null);
      }
      
      setTestCaseTypes({
        functional: true,
        negative: true,
        edgeCases: true,
        accessibility: true,
      });
      setTestFramework('playwright'); // Reset to default
      setGenerationStages([ // Reset stages
        { id: 'manual', title: 'Manual Test Cases', description: 'Generate comprehensive test case documentation', status: 'pending' },
        { id: 'features', title: 'Feature Files', description: 'Create BDD Gherkin feature files', status: 'pending' },
        { id: 'stepDefinitions', title: 'Step Definitions', description: 'Generate TypeScript step definition files', status: 'pending' },
      ]);
      setCurrentStage(null);
      setIsGenerating(false);
      setGenerationProgress(0);
      setGenerationStatus("");
      setGenerationResult(null);
      setShowResult(false);
      // Reset file browser states
      setDirectoryStructure(null);
      setSelectedFilePath(null);
      setFileContent("");
      setExpandedFolders(new Set());
    }
  }, [open, preSelectedStoryId]);

  // Update selected user story when selection changes
  useEffect(() => {
    if (selectedUserStoryId) {
      const story = userStories.find(s => s.id === selectedUserStoryId);
      setSelectedUserStory(story || null);
      
      // Check if tests already exist for this story
      checkExistingTests(story);
    } else {
      setSelectedUserStory(null);
      setExistingTests(null);
    }
  }, [selectedUserStoryId, userStories]);

  // Sanitize filename the EXACT same way as backend automation-storage-service.ts
  const sanitizeFileName = (name: string): string => {
    return name
      .replace(/[^a-zA-Z0-9\s\-_]/g, '')  // Remove special characters
      .replace(/\s+/g, '-')                // Replace spaces with hyphens
      .toLowerCase()                        // Convert to lowercase
      .replace(/-+/g, '-')                 // Remove multiple consecutive hyphens
      .replace(/^-|-$/g, '');              // Remove leading/trailing hyphens
  };

  // Check if test cases already exist for the selected story
  const checkExistingTests = async (story: UserStory | null | undefined) => {
    const pid = projectId || sdlcProjectId;
    if (!story || !pid) return;
    
    setCheckingExisting(true);
    try {
      // Get organization and project EXACTLY like we do during generation
      const urlParams = new URLSearchParams(window.location.search);
      const organizationFromUrl = urlParams.get("organization") || urlParams.get("organizationName");
      const projectFromUrl = urlParams.get("project") || urlParams.get("projectName");
      
      const organizationRaw = organizationFromUrl || azureConfig?.organization || 'unknown-org';
      const projectRaw = projectFromUrl || azureConfig?.project || projectName || 'default-project';
      
      // Build directory path matching backend SIMPLIFIED structure:
      // AutomationScript/{organization}-{projectName}/{projectName}/{storyName}/{storyName}
      const organization = sanitizeFileName(organizationRaw);
      const project = sanitizeFileName(projectRaw);
      const directoryName = `${organization}-${project}`;
      const storyName = sanitizeFileName(story.title || `story-${story.id}`);
      
      // Simplified path structure
      const basePath = `AutomationScript/${directoryName}/${project}/${storyName}/${storyName}`;
      
      console.log("[UserStorySelectionModal] Checking for existing tests at:", basePath);
      
      const response = await apiRequest(
        "GET",
        `/api/browse-directory?projectId=${encodeURIComponent(pid)}&dirPath=${encodeURIComponent(basePath)}`
      );
      
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.items && result.items.length > 0) {
          setExistingTests({
            exists: true,
            fileCount: result.items.length,
            items: result.items,
            path: basePath,
          });
        } else {
          setExistingTests({ exists: false, path: basePath });
        }
      } else {
        setExistingTests({ exists: false, path: basePath });
      }
    } catch (error) {
      setExistingTests({ exists: false });
    } finally {
      setCheckingExisting(false);
    }
  };

  // Load directory structure for generated files
  const loadGeneratedFilesStructure = useCallback(async () => {
    const pid = projectId || sdlcProjectId;
    if (!selectedUserStory || !pid) return;
    
    setLoadingDirectory(true);
    try {
      // Get organization and project EXACTLY like we do during generation
      const urlParams = new URLSearchParams(window.location.search);
      const organizationFromUrl = urlParams.get("organization") || urlParams.get("organizationName");
      const projectFromUrl = urlParams.get("project") || urlParams.get("projectName");
      
      const organizationRaw = organizationFromUrl || azureConfig?.organization || 'unknown-org';
      const projectRaw = projectFromUrl || azureConfig?.project || projectName || 'default-project';
      
      const organization = sanitizeFileName(organizationRaw);
      const project = sanitizeFileName(projectRaw);
      const directoryName = `${organization}-${project}`;
      const storyName = sanitizeFileName(selectedUserStory.title || `story-${selectedUserStory.id}`);
      
      // Path: AutomationScript/{org-project}/{project}/{story}/{story}/
      const fullPath = `AutomationScript/${directoryName}/${project}/${storyName}/${storyName}`;
      
      console.log("[UserStorySelectionModal] ===== LOADING FILES =====");
      console.log("[UserStorySelectionModal] Organization (raw):", organizationRaw, "-> sanitized:", organization);
      console.log("[UserStorySelectionModal] Project (raw):", projectRaw, "-> sanitized:", project);
      console.log("[UserStorySelectionModal] Story:", selectedUserStory.title, "-> sanitized:", storyName);
      console.log("[UserStorySelectionModal] Directory name:", directoryName);
      console.log("[UserStorySelectionModal] Full path:", fullPath);
      console.log("[UserStorySelectionModal] Calling API with projectId:", directoryName, "dirPath:", fullPath);
      console.log("[UserStorySelectionModal] ========================");
      
      const response = await apiRequest(
        "GET",
        `/api/browse-directory?projectId=${encodeURIComponent(directoryName)}&dirPath=${encodeURIComponent(fullPath)}`
      );
      
      console.log("[UserStorySelectionModal] API Response status:", response.status, response.ok);
      
      if (response.ok) {
        const result = await response.json();
        
        console.log("[UserStorySelectionModal] API FULL RESPONSE:", result);
        
        if (result.success && result.items && result.items.length > 0) {
          console.log("[UserStorySelectionModal] ✅ Successfully loaded", result.items.length, "files");
          console.log("[UserStorySelectionModal] Files:", result.items.map((i: any) => i.name).join(", "));
          
          const structure = {
            name: storyName,
            path: fullPath,
            fullPath: fullPath,
            type: 'dir',
            children: result.items || []
          };
          
          setDirectoryStructure(structure);
          setExpandedFolders(new Set([fullPath]));
          
          console.log("[UserStorySelectionModal] ✅ File browser ready with", structure.children.length, "files");
        } else {
          console.error("[UserStorySelectionModal] ❌ No files found at path:", fullPath);
          setDirectoryStructure(null);
          toast.error("Generated files not found. The generation may have failed silently.");
        }
      } else {
        const errorText = await response.text();
        console.error("[UserStorySelectionModal] ❌ API failed:", response.status, errorText);
        setDirectoryStructure(null);
        toast.error("Failed to load generated files from GitHub.");
      }
    } catch (error) {
      console.error("[UserStorySelectionModal] ❌ Error:", error);
      setDirectoryStructure(null);
      toast.error("Error loading files. Check console for details.");
    } finally {
      setLoadingDirectory(false);
    }
  }, [projectId, sdlcProjectId, selectedUserStory, azureConfig?.organization, projectName]);

  // Note: File loading is now handled directly in handleGenerateTestCases after generation
  // to ensure proper timing and retry logic

  // Toggle folder expansion
  const toggleFolder = async (folderPath: string, currentChildren: any[]) => {
    console.log("[UserStorySelectionModal] Toggle folder:", {
      folderPath,
      hasChildren: currentChildren?.length > 0,
      childrenCount: currentChildren?.length || 0,
      isCurrentlyExpanded: expandedFolders.has(folderPath)
    });
    
    const newExpanded = new Set(expandedFolders);
    
    if (expandedFolders.has(folderPath)) {
      // Collapse
      console.log("[UserStorySelectionModal] Collapsing folder:", folderPath);
      newExpanded.delete(folderPath);
    } else {
      // Expand
      console.log("[UserStorySelectionModal] Expanding folder:", folderPath);
      newExpanded.add(folderPath);
      
      // Load children if not loaded yet
      if (!currentChildren || currentChildren.length === 0) {
        console.log("[UserStorySelectionModal] No children, loading from API...");
        const pid = projectId || sdlcProjectId;
        if (!pid) return;
        
        try {
          const response = await apiRequest(
            "GET",
            `/api/browse-directory?projectId=${encodeURIComponent(pid)}&dirPath=${encodeURIComponent(folderPath)}`
          );
          
          if (response.ok) {
            const result = await response.json();
            
            if (result.success && result.items) {
              
              const updateChildren = (node: any): any => {
                if (node.fullPath === folderPath || node.path === folderPath) {
                  return { ...node, children: result.items };
                }
                if (node.children) {
                  return { ...node, children: node.children.map(updateChildren) };
                }
                return node;
              };
              
              setDirectoryStructure((prev: any) => prev ? updateChildren(prev) : prev);
            }
          }
        } catch (error) {
          console.error("[UserStorySelectionModal] Error loading folder contents:", error);
        }
      } else {
        console.log("[UserStorySelectionModal] Children already loaded, count:", currentChildren.length);
      }
    }
    
    setExpandedFolders(newExpanded);
    console.log("[UserStorySelectionModal] New expanded folders:", Array.from(newExpanded));
  };

  // Load file content
  const loadFileContent = async (filePath: string) => {
    setSelectedFilePath(filePath);
    setLoadingFileContent(true);
    
    try {
      const response = await apiRequest(
        "GET",
        `/api/preview-file-content?filePath=${encodeURIComponent(filePath)}`
      );
      
      if (response.ok) {
        const result = await response.json();
        setFileContent(result.content || '');
      } else {
        toast.error("Failed to load file content");
        setFileContent('');
      }
    } catch (error) {
      console.error("Error loading file content:", error);
      toast.error("Error loading file content");
      setFileContent('');
    } finally {
      setLoadingFileContent(false);
    }
  };

  // Render file tree node recursively
  const renderFileTreeNode = (node: any, level: number = 0) => {
    const nodePath = node.fullPath || node.path;
    const isExpanded = expandedFolders.has(nodePath);
    const isSelected = selectedFilePath === nodePath;
    const isDir = node.type === 'dir';
    
    // Debug logging
    console.log(`[UserStorySelectionModal] Rendering node (level ${level}):`, {
      name: node.name,
      path: nodePath,
      type: node.type,
      isDir,
      isExpanded,
      hasChildren: !!node.children,
      childrenCount: node.children?.length || 0,
      expandedFoldersHas: expandedFolders.has(nodePath),
      expandedFoldersAll: Array.from(expandedFolders)
    });
    
    return (
      <div key={nodePath} className="w-full">
        <div
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent rounded-sm transition-colors w-full",
            isSelected && "bg-accent"
          )}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => {
            if (isDir) {
              console.log("[UserStorySelectionModal] Clicked folder:", nodePath, "Has children:", node.children?.length);
              toggleFolder(nodePath, node.children);
            } else {
              loadFileContent(nodePath);
            }
          }}
        >
          {isDir ? (
            <>
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 flex-shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 flex-shrink-0" />
              )}
              <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
            </>
          ) : (
            <>
              <div className="w-4 flex-shrink-0" />
              <FileText className="h-4 w-4 flex-shrink-0 text-gray-500" />
            </>
          )}
          <span className="text-sm truncate overflow-hidden" title={node.name}>{node.name}</span>
        </div>
        
        {(() => {
          const shouldRenderChildren = isDir && isExpanded && node.children && node.children.length > 0;
          console.log(`[UserStorySelectionModal] Children render check (level ${level}):`, {
            isDir,
            isExpanded,
            hasChildren: !!node.children,
            childrenLength: node.children?.length || 0,
            shouldRenderChildren,
            nodePath,
            children: node.children
          });
          return null;
        })()}
        
        {isDir && isExpanded && node.children && node.children.length > 0 ? (
          <div>
            {console.log(`[UserStorySelectionModal] ✅ RENDERING ${node.children.length} CHILDREN for:`, node.name)}
            {node.children.map((child: any, idx: number) => {
              console.log(`[UserStorySelectionModal] Rendering child ${idx}:`, child.name, child.type);
              return renderFileTreeNode(child, level + 1);
            })}
          </div>
        ) : (
          isDir && isExpanded && (() => {
            console.log(`[UserStorySelectionModal] ❌ NOT rendering children because:`,{
              hasChildren: !!node.children,
              childrenLength: node.children?.length,
              reason: !node.children ? 'no children array' : node.children.length === 0 ? 'children array is empty' : 'unknown'
            });
            return null;
          })()
        )}
      </div>
    );
  };

  // Get feature and epic info for selected user story
  const getStoryContext = () => {
    if (!selectedUserStory) return null;
    
    // Handle both regular IDs and db-prefixed IDs
    const featureId = selectedUserStory.featureId;
    const feature = features.find(f => 
      f.id === featureId || 
      f.id === `db-feature-${featureId}` || 
      `db-feature-${f.id}` === featureId
    );
    
    const epicId = (feature as any)?.epicId;
    const epic = epicId ? epics.find(e => 
      e.id === epicId || 
      e.id === `db-epic-${epicId}` || 
      `db-epic-${e.id}` === epicId
    ) : null;
    
    return { feature, epic };
  };

  const handleTestCaseTypeToggle = (type: keyof TestCaseTypes) => {
    setTestCaseTypes(prev => ({
      ...prev,
      [type]: !prev[type]
    }));
  };

  const handleGenerateTestCases = async () => {
    if (!selectedUserStory) {
      toast.error("Please select a user story");
      return;
    }

    const context = getStoryContext();
    
    // Feature and epic are optional - we can generate tests without them
    // But we'll use them if available for better organization
    console.log("[UserStorySelectionModal] Story context:", {
      userStory: selectedUserStory.title,
      feature: context?.feature?.title || "Not found",
      epic: context?.epic?.title || "Not found",
    });

    // Check if at least one test type is selected
    const hasSelectedTypes = Object.values(testCaseTypes).some(v => v);
    if (!hasSelectedTypes) {
      toast.error("Please select at least one test case type");
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(0);
    setGenerationStatus("Initializing test case generation...");

    try {
      const pid = projectId || sdlcProjectId;
      if (!pid) {
        throw new Error("No project ID found.");
      }

      // Get organization and project from URL or config
      const urlParams = new URLSearchParams(window.location.search);
      const organizationFromUrl = urlParams.get("organization") || urlParams.get("organizationName");
      const projectFromUrl = urlParams.get("project") || urlParams.get("projectName");
      
      const organization = organizationFromUrl || azureConfig?.organization || 'unknown-org';
      const project = projectFromUrl || azureConfig?.project || projectName || 'default-project';

      console.log("[UserStorySelectionModal] ===== GENERATING TEST CASES =====");
      console.log("[UserStorySelectionModal] URL organization:", organizationFromUrl);
      console.log("[UserStorySelectionModal] azureConfig.organization:", azureConfig?.organization);
      console.log("[UserStorySelectionModal] Final organization:", organization);
      console.log("[UserStorySelectionModal] URL project:", projectFromUrl);
      console.log("[UserStorySelectionModal] azureConfig.project:", azureConfig?.project);
      console.log("[UserStorySelectionModal] projectName prop:", projectName);
      console.log("[UserStorySelectionModal] Final project:", project);
      console.log("[UserStorySelectionModal] ====================================");

      // Generate job ID for this test generation session
      const testGenerationJobId = wikiJobId || crypto.randomUUID();

      setGenerationStatus("Generating test cases for review...");
      setGenerationProgress(20);

      // Call NEW backend API to generate test cases for REVIEW (no GitHub save)
      const response = await apiRequest(
        "POST",
        "/api/generate-testcases-preview",
        {
          userStory: selectedUserStory,
          projectId: pid,
          testCaseTypes: testCaseTypes, // Pass selected test case types
        }
      );

      setGenerationProgress(80);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to generate test cases");
      }

      const result = await response.json();
      
      console.log("[UserStorySelectionModal] ========== API RESPONSE ==========");
      console.log("[UserStorySelectionModal] Full response:", JSON.stringify(result, null, 2));
      console.log("[UserStorySelectionModal] result.success:", result.success);
      console.log("[UserStorySelectionModal] result.testCases:", result.testCases);
      console.log("[UserStorySelectionModal] testCases type:", typeof result.testCases);
      console.log("[UserStorySelectionModal] testCases is array?", Array.isArray(result.testCases));
      console.log("[UserStorySelectionModal] testCases keys:", result.testCases ? Object.keys(result.testCases) : 'null');
      console.log("[UserStorySelectionModal] =====================================");
      
      if (!result.success || !result.testCases) {
        throw new Error("No test cases generated");
      }
      
      // CRITICAL: Validate that we have actual test cases, not fallback data
      if (result.testCases.storyTitle === "Parsing failed - manual review required") {
        throw new Error("Test case generation failed - LLM response parsing error. Please try again.");
      }

      // CRITICAL: Validate that we have the expected categorized structure
      const hasCategories = 
        result.testCases.hasOwnProperty('functional') ||
        result.testCases.hasOwnProperty('negative') ||
        result.testCases.hasOwnProperty('edgeCases') ||
        result.testCases.hasOwnProperty('accessibility');
      
      if (!hasCategories) {
        console.error("[UserStorySelectionModal] Invalid data structure - missing category fields");
        console.error("[UserStorySelectionModal] Received:", result.testCases);
        throw new Error("Invalid test case structure - missing category fields (functional, negative, edgeCases, accessibility)");
      }
      
      console.log("[UserStorySelectionModal] Test cases received:", result.testCases);
      console.log("[UserStorySelectionModal] Has functional?", result.testCases.functional);
      console.log("[UserStorySelectionModal] Has negative?", result.testCases.negative);
      console.log("[UserStorySelectionModal] Has edgeCases?", result.testCases.edgeCases);
      console.log("[UserStorySelectionModal] Has accessibility?", result.testCases.accessibility);
      
      // Enhanced validation: Check if SELECTED categories are empty (potential truncation issue)
      const functionalCount = Array.isArray(result.testCases.functional) ? result.testCases.functional.length : 0;
      const negativeCount = Array.isArray(result.testCases.negative) ? result.testCases.negative.length : 0;
      const edgeCasesCount = Array.isArray(result.testCases.edgeCases) ? result.testCases.edgeCases.length : 0;
      const accessibilityCount = Array.isArray(result.testCases.accessibility) ? result.testCases.accessibility.length : 0;
      
      console.log("[UserStorySelectionModal] Category counts:", {
        functional: functionalCount,
        negative: negativeCount,
        edgeCases: edgeCasesCount,
        accessibility: accessibilityCount
      });
      console.log("[UserStorySelectionModal] Selected test case types:", testCaseTypes);
      
      // Warn if multiple SELECTED categories are empty (likely truncation during generation)
      const selectedEmptyCategories = [];
      if (testCaseTypes.functional && functionalCount === 0) selectedEmptyCategories.push('Functional');
      if (testCaseTypes.negative && negativeCount === 0) selectedEmptyCategories.push('Negative');
      if (testCaseTypes.edgeCases && edgeCasesCount === 0) selectedEmptyCategories.push('Edge Cases');
      if (testCaseTypes.accessibility && accessibilityCount === 0) selectedEmptyCategories.push('Accessibility');
      
      if (selectedEmptyCategories.length >= 2) {
        console.warn("[UserStorySelectionModal] ⚠️ Multiple selected categories are empty! This may indicate response truncation.");
        toast.error(
          `⚠️ Warning: ${selectedEmptyCategories.join(', ')} test cases were not generated.\n` +
          `This may be due to response truncation. Consider regenerating.`,
          { duration: 8000 }
        );
      }
      
      setGenerationProgress(100);
      setGenerationStatus("Generation completed! Ready for review.");

      // Show success message
      toast.success(
        `✅ Test cases generated successfully!\n` +
        `📝 User Story: ${selectedUserStory.title}\n` +
        `🔍 Review and edit before saving`
      );

      // Store generated test cases WITH selected types AND user story object
      const testCasesWithMetadata = {
        ...result.testCases,
        selectedTypes: testCaseTypes, // Pass selected types to review modal
        userStoryObject: selectedUserStory // Pass full user story object for saving
      };
      setGeneratedTestCasesForReview(testCasesWithMetadata);
      console.log("[UserStorySelectionModal] Opening review modal with data:", testCasesWithMetadata);
      
      // IMPORTANT: Only open modal after generation is complete
      setTimeout(() => {
        setShowReviewModal(true);
      }, 500);
      
      setIsGenerating(false);

      // Notify parent component to refresh badge counts
      onGenerationComplete?.();

      // Reset for next generation
      setTimeout(() => {
        setIsGenerating(false);
        setGenerationProgress(0);
        setGenerationStatus("");
      }, 1000);

    } catch (err: any) {
      console.error("Test case generation error:", err);
      setGenerationStatus("Generation failed");
      setGenerationResult({
        success: false,
        message: err instanceof Error ? err.message : "Unknown error",
        gitHubUrls: [],
        stats: {},
      });
      setShowResult(true);
      toast.error(
        `Failed to generate test cases: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
      setIsGenerating(false);
    }
  };

  const handleGenerateAnother = () => {
    setShowResult(false);
    setGenerationResult(null);
    setSelectedUserStoryId("");
    setSelectedUserStory(null);
    setTestCaseTypes({
      functional: true,
      negative: true,
      edgeCases: true,
      accessibility: true,
    });
    // Reset file browser states
    setDirectoryStructure(null);
    setSelectedFilePath(null);
    setFileContent("");
    setExpandedFolders(new Set());
  };

  // Handle saving reviewed test cases to GitHub + Generate BDD Assets
  const handleSaveReviewedTestCases = async (editedTestCases: any) => {
    // Get user story from review data or fallback to selectedUserStory
    const userStory = editedTestCases.userStoryObject || selectedUserStory;
    
    if (!userStory) {
      toast.error("No user story selected");
      console.error("[UserStorySelectionModal] No user story found in:", { editedTestCases, selectedUserStory });
      return;
    }
    
    console.log("[UserStorySelectionModal] Using user story:", userStory);

    try {
      setIsSavingReviewedCases(true);
      
      // Stage 1: Manual Test Cases - Mark as completed
      setGenerationStages(prev => prev.map(stage => 
        stage.id === 'manual' ? { ...stage, status: 'completed' } : stage
      ));

      const pid = sdlcProjectId || projectId;
      if (!pid) {
        throw new Error("No project ID found");
      }

      // Get organization and project info
      const urlParams = new URLSearchParams(window.location.search);
      const organizationFromUrl = urlParams.get("organization") || urlParams.get("organizationName");
      const projectFromUrl = urlParams.get("project") || urlParams.get("projectName");
      
      const organization = organizationFromUrl || azureConfig?.organization || 'unknown-org';
      const project = projectFromUrl || azureConfig?.project || projectName || 'default-project';

      console.log("[UserStorySelectionModal] ===== MULTI-STAGE GENERATION =====");
      
      // Stage 1: Pushing to ADO (Git) or Jira
      const isJira = integrationType === 'jira';
      console.log(`[UserStorySelectionModal] Stage 1: Pushing manual test cases to ${isJira ? 'Jira' : 'Git Repository'}`);

      // If it's a Jira project, push test cases as Jira issues
      if (isJira) {
        try {
          const jiraPushResponse = await apiRequest(
            "POST",
            `/api/sdlc/projects/${pid}/jira/push-test-cases`,
            {
              testCases: editedTestCases,
              userStory: userStory,
              projectId: pid
            }
          );
          
          if (!jiraPushResponse.ok) {
            const errorData = await jiraPushResponse.json();
            console.warn("[UserStorySelectionModal] Jira push failed, but continuing with Git archival:", errorData);
            toast.error(`⚠️ Jira push failed: ${errorData.error}. Continuing with repository save...`, { id: 'jira-push' });
          } else {
            let jiraResult = await jiraPushResponse.json();
            if (jiraPushResponse.status === 202 && jiraResult?.jobId) {
              try {
                jiraResult = await pollAsyncJob<typeof jiraResult>('test-cases-push-to-jira', jiraResult.jobId, {
                  onProgress: (message) => {
                    if (message) toast.loading(message, { id: 'jira-push' });
                  }
                });
              } catch (pollErr) {
                console.warn("[UserStorySelectionModal] Jira push polling failed:", pollErr);
                toast.error(`⚠️ Jira push failed: ${pollErr instanceof Error ? pollErr.message : 'unknown error'}. Continuing with repository save...`, { id: 'jira-push' });
                return;
              }
            }
            toast.success(jiraResult.message || "✅ Test cases pushed to Jira successfully!", { id: 'jira-push' });
          }
        } catch (jiraErr) {
          console.error("[UserStorySelectionModal] Error pushing to Jira:", jiraErr);
          toast.error("⚠️ Failed to push to Jira issues. Continuing with repository save...", { id: 'jira-push' });
        }
      }

      // Stage 1 (Archives): Save manual test cases to Git storage (always do this for parity)
      const saveResponse = await apiRequest(
        "POST",
        "/api/save-reviewed-testcases",
        {
          testCases: editedTestCases,
          userStory: userStory,
          projectId: pid,
          projectName: project,
          organization: organization,
        }
      );

      if (!saveResponse.ok) {
        const error = await saveResponse.json();
        throw new Error(error.error || "Failed to save test cases to repository");
      }

      if (!isJira) {
        toast.success("✅ Manual test cases saved to repository successfully!");
      }
      
      // Stage 2: Generate Feature Files
      setCurrentStage('features');
      setGenerationStages(prev => prev.map(stage => 
        stage.id === 'features' ? { ...stage, status: 'in-progress' } : stage
      ));
      
      console.log("[UserStorySelectionModal] Stage 2: Generating BDD assets (features + step definitions)");
      
      const bddResponse = await apiRequest(
        "POST",
        "/api/generate-bdd-assets",
        {
          testCases: editedTestCases,
          userStory: userStory,
          testFramework: testFramework
        }
      );

      if (!bddResponse.ok) {
        const error = await bddResponse.json();
        setGenerationStages(prev => prev.map(stage => 
          stage.id === 'features' ? { ...stage, status: 'error', errorMessage: error.details } : stage
        ));
        throw new Error(error.error || "Failed to generate BDD assets");
      }

      const bddResult = await bddResponse.json();
      
      // Stage 2 complete
      setGenerationStages(prev => prev.map(stage => 
        stage.id === 'features' ? { ...stage, status: 'completed' } : stage
      ));
      
      // Stage 3: Mark as in-progress
      setCurrentStage('stepDefinitions');
      setGenerationStages(prev => prev.map(stage => 
        stage.id === 'stepDefinitions' ? { ...stage, status: 'in-progress' } : stage
      ));
      
      console.log("[UserStorySelectionModal] BDD Assets generated:", bddResult);
      
      // Simulate processing time for UI feedback
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Stage 3 complete
      setGenerationStages(prev => prev.map(stage => 
        stage.id === 'stepDefinitions' ? { ...stage, status: 'completed' } : stage
      ));
      
      setCurrentStage(null);
      
      toast.success("🎉 All test assets generated successfully!");

      // Store BDD assets for GitHub push / ZIP export
      setGeneratedBDDAssets({
        featureFiles: bddResult.featureFiles,
        stepDefFiles: bddResult.stepDefFiles,
        userStory: userStory,
        framework: testFramework
      });

      // Close review modal
      setShowReviewModal(false);
      setGeneratedTestCasesForReview(null);
      
      // Show BDD actions modal
      setShowBDDActionsModal(true);
      
      // Load the generated files structure
      await loadGeneratedFilesStructure();
      
      // Call onGenerationComplete if provided
      if (onGenerationComplete) {
        onGenerationComplete();
      }

    } catch (error: any) {
      console.error("[UserStorySelectionModal] Multi-stage generation failed:", error);
      toast.error(error.message || "Failed during generation pipeline");
    } finally {
      setIsSavingReviewedCases(false);
    }
  };

  const handleClose = () => {
    if (!isGenerating) {
      onOpenChange(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[95vw] h-[95vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <TestTube className="h-5 w-5" />
            Generate Test Cases & Scripts
          </DialogTitle>
          <DialogDescription>
            Select a user story and configure test case types to generate
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex gap-4">
          {/* Show Result Panel if generation completed */}
          {showResult && generationResult ? (
            <div className="w-full border rounded-lg flex flex-col p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  {generationResult.success ? (
                    <>
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      Generation Successful!
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-5 w-5 text-red-600" />
                      Generation Failed
                    </>
                  )}
                </h3>
              </div>

              <ScrollArea className="flex-1">
                <div className="space-y-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm">{generationResult.message}</p>
                  </div>

                  {generationResult.success && generationResult.stats && (
                    <div className="grid grid-cols-3 gap-4">
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold text-blue-600">
                            {generationResult.stats.testCasesGenerated || 0}
                          </div>
                          <div className="text-xs text-muted-foreground">Test Cases</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold text-green-600">
                            {generationResult.stats.scriptsGenerated || 0}
                          </div>
                          <div className="text-xs text-muted-foreground">Playwright Scripts</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-2xl font-bold text-purple-600">
                            {generationResult.stats.bddFilesGenerated || 0}
                          </div>
                          <div className="text-xs text-muted-foreground">BDD Files</div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {generationResult.success && (
                    <div className="space-y-3">
                      <h4 className="font-medium text-sm">Generated Files:</h4>
                      
                      {/* Two-pane file browser */}
                      <div className="flex h-[450px] gap-4 overflow-hidden">
                        {/* Left Pane - Directory Tree */}
                        <Card className="w-[30%] flex-shrink-0 flex flex-col overflow-hidden">
                          <CardHeader className="pb-3">
                            <div className="flex justify-between items-center">
                              <CardTitle className="text-base flex items-center gap-2">
                                <Folder className="h-4 w-4" />
                                Generated Scripts
                              </CardTitle>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={loadGeneratedFilesStructure}
                                disabled={loadingDirectory}
                              >
                                <RefreshCw className={`h-3 w-3 ${loadingDirectory ? 'animate-spin' : ''}`} />
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent className="flex-1 overflow-hidden p-0">
                            <ScrollArea className="h-full px-4 pb-4">
                              {loadingDirectory ? (
                                <div className="flex items-center justify-center h-32">
                                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                                </div>
                              ) : !directoryStructure ? (
                                <div className="text-center text-sm text-muted-foreground py-8">
                                  <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                  <p>No generated content found</p>
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  {(() => {
                                    console.log("[UserStorySelectionModal] RENDER - Directory Structure:", {
                                      hasStructure: !!directoryStructure,
                                      name: directoryStructure?.name,
                                      childrenCount: directoryStructure?.children?.length || 0,
                                      children: directoryStructure?.children,
                                      expandedFolders: Array.from(expandedFolders),
                                      isRootExpanded: expandedFolders.has(directoryStructure?.fullPath || directoryStructure?.path)
                                    });
                                    return null;
                                  })()}
                                  {renderFileTreeNode(directoryStructure)}
                                </div>
                              )}
                            </ScrollArea>
                          </CardContent>
                        </Card>

                        {/* Right Pane - File Content */}
                        <Card className="w-[70%] flex-shrink-0 flex flex-col overflow-hidden">
                          <CardHeader className="pb-3">
                            <div className="flex justify-between items-center">
                              <CardTitle className="text-base flex items-center gap-2 truncate">
                                <FileText className="h-4 w-4 flex-shrink-0" />
                                {selectedFilePath ? selectedFilePath.split('/').pop() : 'Select a file'}
                              </CardTitle>
                              {selectedFilePath && fileContent && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    navigator.clipboard.writeText(fileContent);
                                    toast.success('Copied to clipboard!');
                                  }}
                                >
                                  <Copy className="h-3 w-3 mr-1" />
                                  Copy
                                </Button>
                              )}
                            </div>
                            {selectedFilePath && (
                              <p className="text-xs text-muted-foreground truncate">{selectedFilePath}</p>
                            )}
                          </CardHeader>
                          <CardContent className="flex-1 min-h-0 p-0 relative">
                            {loadingFileContent ? (
                              <div className="h-full flex items-center justify-center">
                                <div className="text-center">
                                  <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-primary" />
                                  <p className="text-sm text-muted-foreground">Loading file content...</p>
                                </div>
                              </div>
                            ) : !selectedFilePath ? (
                              <div className="h-full flex items-center justify-center text-muted-foreground">
                                <div className="text-center">
                                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                  <p>Select a file to view its content</p>
                                </div>
                              </div>
                            ) : (
                              <ScrollArea className="h-full">
                                <div className="p-4">
                                  <pre className="text-xs bg-muted/50 p-4 rounded-md overflow-x-auto">
                                    <code>{fileContent || 'Empty file'}</code>
                                  </pre>
                                </div>
                              </ScrollArea>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  )}

                  <div className="pt-4">
                    <Button
                      onClick={handleGenerateAnother}
                      className="w-full"
                      variant="outline"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Generate for Another User Story
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </div>
          ) : (
            <>
              {/* Left Panel - User Story Selection */}
              <div className="w-1/2 border rounded-lg flex flex-col">
            <div className="p-4 border-b space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-sm">Select User Story</h3>
                <Badge variant="secondary">
                  {userStories.length} Stories Available
                </Badge>
              </div>
              
              <Select 
                value={selectedUserStoryId} 
                onValueChange={setSelectedUserStoryId}
                disabled={isGenerating}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a user story..." />
                </SelectTrigger>
                <SelectContent>
                  {userStories.length === 0 ? (
                    <SelectItem value="empty" disabled>
                      No user stories available
                    </SelectItem>
                  ) : (
                    (() => {
                      // Deduplicate user stories by ID to prevent duplicate key warnings
                      const uniqueStories = Array.from(
                        new Map(userStories.map(story => [story.id, story])).values()
                      );
                      
                      return uniqueStories.map((story, index) => {
                        const feature = features.find(f => f.id === story.featureId);
                        const epic = epics.find(e => e.id === feature?.epicId);
                        
                        return (
                          <SelectItem key={`${story.id}-${index}`} value={story.id}>
                            <div className="flex flex-col py-1">
                              <span className="font-medium">{story.title}</span>
                              <span className="text-xs text-muted-foreground">
                                {epic?.title} → {feature?.title}
                              </span>
                            </div>
                          </SelectItem>
                        );
                      });
                    })()
                  )}
                </SelectContent>
              </Select>
            </div>
            
            {/* User Story Details */}
            <div className="flex-1 overflow-hidden p-4">
              {selectedUserStory ? (
                <ScrollArea className="h-full">
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Story Details</h4>
                      
                      {/* Show if tests already exist */}
                      {checkingExisting ? (
                        <div className="flex items-center gap-2 p-3 bg-muted rounded-md mb-3">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm">Checking for existing test cases...</span>
                        </div>
                ) : existingTests?.exists ? (
                  <div className="flex flex-col gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md mb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                        <span className="text-sm text-green-900 dark:text-green-100">
                          <strong>Test cases exist!</strong> ({existingTests.fileCount} files)
                        </span>
                      </div>
                      {existingTests.path && githubConfig && (
                        <a
                          href={`https://github.com/${githubConfig.owner}/${githubConfig.repo}/tree/${githubConfig.branch}/${existingTests.path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-green-700 dark:text-green-300 hover:underline flex items-center gap-1"
                        >
                          <Eye className="h-3 w-3" />
                          View in GitHub
                        </a>
                      )}
                    </div>
                    {existingTests.items && existingTests.items.length > 0 && (
                      <div className="text-xs text-green-800 dark:text-green-200 pl-6 space-y-1">
                        <div className="font-medium">Generated Files:</div>
                        {existingTests.items.slice(0, 5).map((item: any, idx: number) => (
                          <div key={idx} className="flex items-center gap-2">
                            {item.type === 'file' ? <FileText className="h-3 w-3" /> : <Folder className="h-3 w-3" />}
                            <span>{item.name}</span>
                          </div>
                        ))}
                        {existingTests.items.length > 5 && <div>+{existingTests.items.length - 5} more files</div>}
                      </div>
                    )}
                    <div className="text-xs text-green-800 dark:text-green-200 pl-6 italic mt-2">
                      Click "Generate Test Cases" below to regenerate/update tests
                    </div>
                  </div>
                      ) : existingTests && !existingTests.exists ? (
                        <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md mb-3">
                          <Plus className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          <span className="text-sm text-blue-900 dark:text-blue-100">
                            No test cases found. Generate new ones below.
                          </span>
                        </div>
                      ) : null}
                      
                      <div className="space-y-2 text-sm">
                        <div className="flex items-start gap-2">
                          <User className="h-4 w-4 mt-0.5 text-muted-foreground" />
                          <div>
                            <div className="font-medium">Persona</div>
                            <div className="text-muted-foreground">{selectedUserStory.persona}</div>
                          </div>
                        </div>
                        
                        <div className="pt-2">
                          <div className="font-medium mb-1">Description</div>
                          <div className="text-muted-foreground whitespace-pre-wrap">
                            {selectedUserStory.description || "No description available"}
                          </div>
                        </div>

                        {selectedUserStory.acceptanceCriteria && (
                          <div className="pt-2">
                            <div className="font-medium mb-1">Acceptance Criteria</div>
                            <div className="text-muted-foreground whitespace-pre-wrap bg-muted p-3 rounded">
                              {typeof selectedUserStory.acceptanceCriteria === 'string' 
                                ? selectedUserStory.acceptanceCriteria 
                                : Array.isArray(selectedUserStory.acceptanceCriteria)
                                ? selectedUserStory.acceptanceCriteria.map((ac: any, i: number) => (
                                    <div key={i} className="mb-1">• {ac.title || ac.description || ac}</div>
                                  ))
                                : JSON.stringify(selectedUserStory.acceptanceCriteria)}
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2 pt-2">
                          {selectedUserStory.priority && (
                            <Badge variant="outline">
                              Priority: {selectedUserStory.priority}
                            </Badge>
                          )}
                          {selectedUserStory.storyPoints && (
                            <Badge variant="outline">
                              {selectedUserStory.storyPoints} pts
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Select a user story to view details
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Test Configuration */}
          <div className="w-1/2 border rounded-lg flex flex-col">
            <div className="p-4 border-b">
              <h3 className="font-medium text-sm">Test Case Configuration</h3>
            </div>
            
            <div className="flex-1 overflow-hidden p-4">
              <ScrollArea className="h-full">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold mb-3">Test Case Types</h4>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3 p-3 border rounded-lg">
                        <Checkbox
                          id="functional"
                          checked={testCaseTypes.functional}
                          onCheckedChange={() => handleTestCaseTypeToggle('functional')}
                          disabled={isGenerating}
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="functional"
                            className="text-sm font-medium cursor-pointer"
                          >
                            Functional Test Cases
                          </label>
                          <p className="text-xs text-muted-foreground mt-1">
                            Tests for core functionality and expected behavior
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 border rounded-lg">
                        <Checkbox
                          id="negative"
                          checked={testCaseTypes.negative}
                          onCheckedChange={() => handleTestCaseTypeToggle('negative')}
                          disabled={isGenerating}
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="negative"
                            className="text-sm font-medium cursor-pointer"
                          >
                            Negative Test Cases
                          </label>
                          <p className="text-xs text-muted-foreground mt-1">
                            Tests for error handling and invalid inputs
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 border rounded-lg">
                        <Checkbox
                          id="edgeCases"
                          checked={testCaseTypes.edgeCases}
                          onCheckedChange={() => handleTestCaseTypeToggle('edgeCases')}
                          disabled={isGenerating}
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="edgeCases"
                            className="text-sm font-medium cursor-pointer"
                          >
                            Edge Cases
                          </label>
                          <p className="text-xs text-muted-foreground mt-1">
                            Tests for boundary conditions and unusual scenarios
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3 p-3 border rounded-lg">
                        <Checkbox
                          id="accessibility"
                          checked={testCaseTypes.accessibility}
                          onCheckedChange={() => handleTestCaseTypeToggle('accessibility')}
                          disabled={isGenerating}
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="accessibility"
                            className="text-sm font-medium cursor-pointer"
                          >
                            Accessibility Tests
                          </label>
                          <p className="text-xs text-muted-foreground mt-1">
                            Tests for WCAG compliance and screen reader support
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* NEW: Test Automation Framework Selection */}
                  <div className="pt-4 border-t">
                    <h4 className="text-sm font-semibold mb-3">Automation Framework</h4>
                    <div className="space-y-2">
                      <label htmlFor="framework" className="text-xs text-muted-foreground">
                        Select the test automation framework for step definitions:
                      </label>
                      <Select 
                        value={testFramework} 
                        onValueChange={(value: TestFramework) => setTestFramework(value)}
                        disabled={isGenerating}
                      >
                        <SelectTrigger id="framework" className="w-full">
                          <SelectValue placeholder="Choose framework..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="playwright">
                            <div className="flex flex-col py-1">
                              <span className="font-medium">Playwright (TypeScript)</span>
                              <span className="text-xs text-muted-foreground">Modern, fast, reliable E2E testing</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="selenium">
                            <div className="flex flex-col py-1">
                              <span className="font-medium">Selenium WebDriver (TypeScript)</span>
                              <span className="text-xs text-muted-foreground">Industry standard for web automation</span>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground italic mt-2">
                        💡 Step definitions will be generated for {testFramework === 'playwright' ? 'Playwright' : 'Selenium WebDriver'} in TypeScript
                      </p>
                    </div>
                  </div>

                  <div className="pt-4 border-t">
                    <h4 className="text-sm font-semibold mb-3">Generated Artifacts</h4>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        <span>Test case documentation (JSON & Markdown)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        <span>Feature files (BDD Gherkin)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        <span>Playwright automation scripts</span>
                      </div>
                    </div>
                  </div>

                  {/* Generation Progress */}
                  {isGenerating && (
                    <div className="pt-4 border-t space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {generationStatus}
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${generationProgress}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground text-right">
                        {generationProgress}%
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
            </>
          )}
        </div>

        <div className="flex justify-between items-center pt-4 border-t flex-shrink-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {selectedUserStory && !isGenerating && (
              <span className="flex items-center gap-1">
                <CheckCircle className="h-4 w-4 text-green-600" />
                Ready to generate
              </span>
            )}
            {!selectedUserStory && !isGenerating && (
              <span className="flex items-center gap-1">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                Select a user story to continue
              </span>
            )}
          </div>
          
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={handleClose}
              disabled={isGenerating}
            >
              {isGenerating ? "Generating..." : "Cancel"}
            </Button>
            
            <Button
              onClick={handleGenerateTestCases}
              disabled={!selectedUserStory || isGenerating || !Object.values(testCaseTypes).some(v => v)}
              className="min-w-[180px]"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <TestTube className="h-4 w-4 mr-2" />
                  Generate Test Cases
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

      {/* Test Case Review Modal - Outside parent dialog to avoid nesting issues */}
      <TestCaseReviewModal
        open={showReviewModal}
        onOpenChange={setShowReviewModal}
        testCasesData={generatedTestCasesForReview}
        onSave={handleSaveReviewedTestCases}
        isSaving={isSavingReviewedCases}
        generationStages={generationStages}
        currentStage={currentStage}
      />

      {/* BDD Assets Actions Modal - Push to Repository or Export ZIP */}
      {generatedBDDAssets && (
        <BDDAssetsActionsModal
          open={showBDDActionsModal}
          onOpenChange={setShowBDDActionsModal}
          featureFiles={generatedBDDAssets.featureFiles}
          stepDefFiles={generatedBDDAssets.stepDefFiles}
          userStory={generatedBDDAssets.userStory}
          framework={generatedBDDAssets.framework}
          projectId={projectId || sdlcProjectId}
          organization={azureConfig?.organization}
          projectName={projectName ?? azureConfig?.project}
        />
      )}
    </>
  );
}
