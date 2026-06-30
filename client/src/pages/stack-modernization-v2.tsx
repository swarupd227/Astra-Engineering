/**
 * Stack Modernization V2 - Compact Single-Page Design
 * NO SCROLLING - Everything fits on one screen with progressive disclosure
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload,
  Sparkles,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  GitBranch,
  FileCode,
  Settings
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { TargetPromptCard } from "@/components/stack-modernization/TargetPromptCard";
import { DiffViewer } from "@/components/stack-modernization/DiffViewer";
import { PublishModal } from "@/components/stack-modernization/PublishModal";

type WorkflowStage = "upload" | "analyze" | "prompt" | "upgrade" | "review" | "publish" | "complete";

interface AnalysisResult {
  analysisId: string;
  detectedStack: {
    runtime?: string;
    runtimeVersion?: string;
    frameworks?: Array<{ name: string; version: string }>;
    languages?: string[];
    projectType?: string;
  };
}

interface CodeUpgradeResult {
  modifiedFiles: Array<{
    path: string;
    content: string;
    originalContent: string;
    changes: any[];
  }>;
  summary: {
    totalFilesModified: number;
    totalPackagesUpgraded: number;
    success: boolean;
  };
}

export default function StackModernizationV2() {
  const { toast } = useToast();
  
  // State
  const [stage, setStage] = useState<WorkflowStage>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  
  // Analysis results
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [detectedStack, setDetectedStack] = useState<any>(null);
  const [userPrompt, setUserPrompt] = useState("");
  const [enhancedPlan, setEnhancedPlan] = useState("");
  
  // Code upgrade results
  const [upgradeResult, setUpgradeResult] = useState<CodeUpgradeResult | null>(null);
  
  // Publish modal
  const [showPublishModal, setShowPublishModal] = useState(false);

  // File upload handler
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  // Upload & Analyze
  const handleUploadAndAnalyze = async () => {
    if (files.length === 0) {
      toast({
        title: "No Files Selected",
        description: "Please select a ZIP file or code files to upload",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setStatusMessage("Uploading files...");

    try {
      // Step 1: Upload
      const formData = new FormData();
      files.forEach(file => formData.append('files', file));

      setProgress(10);
      const uploadRes = await apiRequest("POST", "/api/stack-modernization/upload", formData);

      if (!uploadRes.ok) {
        const error = await uploadRes.json();
        throw new Error(error.error || "Upload failed");
      }

      const uploadData = await uploadRes.json();
      
      setProgress(30);
      setStatusMessage("Analyzing code repository...");

      // Step 2: Analyze
      const analyzeRes = await apiRequest("POST", "/api/stack-modernization/analyze", {
        sessionId: uploadData.sessionId,
        modernizationType: "upgrade",
        tempDir: uploadData.tempDir || "",
        llmProvider: "gpt-5.4"
      });

      if (!analyzeRes.ok) {
        const error = await analyzeRes.json();
        throw new Error(error.error || "Analysis failed");
      }

      const analyzeData = await analyzeRes.json();
      const newAnalysisId = analyzeData.analysisId;
      setAnalysisId(newAnalysisId);

      setProgress(50);
      setStatusMessage("Running AI agents...");

      // Poll for completion — no artificial timeout; stops when server reports done or failed
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 5000));

        const progressRes = await apiRequest("GET", `/api/stack-modernization/analysis/${newAnalysisId}/progress`);
        
        if (!progressRes.ok) {
          throw new Error("Failed to get analysis progress");
        }

        const progressData = await progressRes.json();
        
        setProgress(50 + (progressData.progress * 0.4));
        setStatusMessage(`${progressData.currentStage}...`);

        if (progressData.currentStage === "awaiting_user_selection" || progressData.currentStage === "completed") {
          const resultsRes = await apiRequest("GET", `/api/stack-modernization/analysis/${newAnalysisId}/results`);
          
          if (resultsRes.ok) {
            const results = await resultsRes.json();
            
            setDetectedStack({
              runtime: results.repoProfile?.runtimes?.[0]?.name || "Unknown",
              runtimeVersion: results.repoProfile?.runtimes?.[0]?.version,
              frameworks: results.repoProfile?.frameworks || [],
              languages: results.repoProfile?.languages || [],
              projectType: results.repoProfile?.projectType
            });
            
            setProgress(100);
            setStatusMessage("Analysis complete!");
            setStage("prompt");
            
            toast({
              title: "✅ Analysis Complete",
              description: "Detected tech stack successfully. Proceed to specify upgrade requirements.",
            });
          }
          
          break;
        }

        if (progressData.currentStage === "failed") {
          throw new Error(progressData.errors?.[0] || "Analysis failed");
        }
      }

    } catch (error) {
      console.error("[StackModernization] Error:", error);
      toast({
        title: "Process Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
      setStage("upload"); // Reset
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle prompt submission
  const handlePromptSubmit = (prompt: string, plan: string, upgradePath?: any) => {
    setUserPrompt(prompt);
    setEnhancedPlan(plan);
    setStage("upgrade");
    startUpgradeProcess();
  };

  // Start upgrade process
  const startUpgradeProcess = async () => {
    if (!analysisId) return;

    setIsProcessing(true);
    setProgress(0);
    setStatusMessage("Starting code upgrade...");

    try {
      setProgress(20);
      
      const upgradeRes = await apiRequest("POST", `/api/stack-modernization/analysis/${analysisId}/execute-upgrade`, {});

      if (!upgradeRes.ok) {
        const error = await upgradeRes.json();
        throw new Error(error.error || "Upgrade failed");
      }

      setProgress(50);
      setStatusMessage("Generating and validating code...");

      // Poll for upgrade completion
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 5000));

        const progressRes = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/progress`);
        
        if (!progressRes.ok) {
          throw new Error("Failed to get upgrade progress");
        }

        const progressData = await progressRes.json();
        
        setProgress(50 + (progressData.progress * 0.5));
        setStatusMessage(`${progressData.currentStage}...`);

        if (progressData.currentStage === "completed") {
          const resultsRes = await apiRequest("GET", `/api/stack-modernization/analysis/${analysisId}/results`);
          
          if (resultsRes.ok) {
            const results = await resultsRes.json();
            
            if (results.codeUpgrade) {
              setUpgradeResult(results.codeUpgrade);
              setProgress(100);
              setStatusMessage("Upgrade complete!");
              setStage("review");
              
              toast({
                title: "✅ Upgrade Complete",
                description: `Modified ${results.codeUpgrade.summary.totalFilesModified} files successfully`,
              });
            }
          }
          
          break;
        }

        if (progressData.currentStage === "failed") {
          throw new Error(progressData.errors?.[0] || "Upgrade failed");
        }
      }

    } catch (error) {
      console.error("[Upgrade] Error:", error);
      toast({
        title: "Upgrade Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Render stage content
  const renderStageContent = () => {
    switch (stage) {
      case "upload":
        return (
          <Card className="border-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                Upload Code Repository
              </CardTitle>
              <CardDescription>
                Upload a ZIP file or select individual code files for analysis
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed rounded-lg p-8 text-center hover:bg-accent/50 transition-colors">
                <input
                  type="file"
                  multiple
                  accept=".zip,.cs,.java,.js,.ts,.tsx,.jsx,.py,.go,.csproj,.pom.xml,.package.json"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-sm font-medium">Click to upload files</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    ZIP, .csproj, or individual source files
                  </p>
                </label>
              </div>

              {files.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Selected Files ({files.length}):</p>
                  <div className="space-y-1">
                    {files.slice(0, 3).map((file, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <FileCode className="h-4 w-4 text-muted-foreground" />
                        <span className="font-mono truncate">{file.name}</span>
                        <Badge variant="outline" className="ml-auto">
                          {(file.size / 1024).toFixed(1)} KB
                        </Badge>
                      </div>
                    ))}
                    {files.length > 3 && (
                      <p className="text-xs text-muted-foreground">
                        +{files.length - 3} more files
                      </p>
                    )}
                  </div>
                </div>
              )}

              <Button 
                onClick={handleUploadAndAnalyze} 
                disabled={files.length === 0 || isProcessing}
                className="w-full"
                size="lg"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Upload & Analyze
                  </>
                )}
              </Button>

              {isProcessing && (
                <div className="space-y-2">
                  <Progress value={progress} className="h-2" />
                  <p className="text-sm text-center text-muted-foreground">{statusMessage}</p>
                </div>
              )}
            </CardContent>
          </Card>
        );

      case "prompt":
        return detectedStack ? (
          <TargetPromptCard
            detectedStack={detectedStack}
            onSubmit={handlePromptSubmit}
            disabled={isProcessing}
          />
        ) : null;

      case "upgrade":
        return (
          <Card className="border-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Upgrading Code
              </CardTitle>
              <CardDescription>
                Generating, validating, and compiling upgraded code
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-center text-muted-foreground">{statusMessage}</p>
              
              <Alert>
                <Settings className="h-4 w-4" />
                <AlertTitle>AI Code Generation Loop</AlertTitle>
                <AlertDescription className="text-xs">
                  The system is generating code, validating syntax, and attempting compilation. 
                  If issues are found, it will automatically retry with fixes.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        );

      case "review":
        return upgradeResult ? (
          <div className="space-y-4">
            <DiffViewer 
              files={upgradeResult.modifiedFiles}
              summary={upgradeResult.summary}
            />
            
            <div className="flex gap-2">
              <Button 
                onClick={() => setShowPublishModal(true)}
                size="lg"
                className="flex-1"
              >
                <GitBranch className="h-4 w-4 mr-2" />
                Publish to Repository
              </Button>
              <Button 
                onClick={() => {
                  // Download all files as ZIP
                  toast({
                    title: "Download Feature",
                    description: "ZIP download coming soon",
                  });
                }}
                variant="outline"
                size="lg"
              >
                Download Upgraded Code
              </Button>
            </div>
          </div>
        ) : null;

      default:
        return null;
    }
  };

  // Stage indicators
  const stages = [
    { id: "upload", label: "Upload", icon: Upload },
    { id: "prompt", label: "Define Target", icon: Sparkles },
    { id: "upgrade", label: "Upgrade Code", icon: Settings },
    { id: "review", label: "Review & Publish", icon: GitBranch }
  ];

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={Sparkles}
        title="Stack Modernization"
        subtitle="AI-powered code upgrade and modernization"
        color="violet"
      />

      {/* Compact Stage Indicators */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            {stages.map((s, idx) => {
              const StageIcon = s.icon;
              const isActive = stage === s.id;
              const isCompleted = stages.findIndex(st => st.id === stage) > idx;
              
              return (
                <div key={s.id} className="flex items-center">
                  <div className={`
                    flex items-center gap-2 px-4 py-2 rounded-lg transition-colors
                    ${isActive ? 'bg-primary text-primary-foreground' : ''}
                    ${isCompleted ? 'bg-accent' : ''}
                  `}>
                    {isCompleted ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <StageIcon className={`h-4 w-4 ${isActive ? '' : 'text-muted-foreground'}`} />
                    )}
                    <span className={`text-sm font-medium ${isActive ? '' : 'text-muted-foreground'}`}>
                      {s.label}
                    </span>
                  </div>
                  {idx < stages.length - 1 && (
                    <div className={`h-px w-12 mx-2 ${isCompleted ? 'bg-primary' : 'bg-border'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      {renderStageContent()}

      {/* Publish Modal */}
      {analysisId && (
        <PublishModal
          open={showPublishModal}
          onClose={() => setShowPublishModal(false)}
          analysisId={analysisId}
        />
      )}
    </div>
  );
}
