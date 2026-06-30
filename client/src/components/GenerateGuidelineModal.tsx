import React, { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { pollAsyncJob } from "@/lib/async-job-poller";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  X,
  FolderOpen,
  FileText,
  Eye,
  ExternalLink,
} from "lucide-react";
import { GenericModal } from "@/components/ui/generic-modal";
import { ExpandablePromptBox } from "@/components/expandable-prompt-box";
import { GoldenRepoGuidelineSelector } from "@/components/golden-repo-guideline-selector";
import { goldenRepoSelectorPropsFromRef } from "@/lib/golden-repositories";
import { AiEnhanceWithDiff } from "@/components/AiEnhanceWithDiff";
import ReactMarkdown from "react-markdown";

interface GenerateGuidelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  dbProjectId: string | null;
  linkedGoldenRepoId: string;
  linkedGoldenRepoName: string;
  projectData?: any;
  sdlcProjectData?: any;
  projectId?: string | null; // optional, same as dbProjectId but given generically for preview links
}

export const GenerateGuidelineModal: React.FC<GenerateGuidelineModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  dbProjectId,
  linkedGoldenRepoId,
  linkedGoldenRepoName,
  projectData,
  sdlcProjectData,
  projectId,
}) => {
  const { toast } = useToast();

  // Check if project has a valid golden repo reference
  const project = sdlcProjectData?.project || projectData?.project;
  const goldenRepoRef = project?.goldenRepoReference;
  const hasValidGoldenRepo = !!(
    goldenRepoRef?.repoId && goldenRepoRef?.repoName
  );

  // Debug golden repo data
  console.log("GenerateGuidelineModal - Golden Repo Debug:", {
    linkedGoldenRepoId,
    linkedGoldenRepoName,
    hasValidGoldenRepo,
    goldenRepoRef,
    projectData: projectData?.project,
    sdlcProjectData: sdlcProjectData?.project,
    hasProjectData: !!projectData,
    hasSdlcProjectData: !!sdlcProjectData,
  });

  // Generate Guideline specific state
  const [guidelineStep, setGuidelineStep] = useState<1 | 2 | 3 | 4>(1);
  const [uploadedGuidelineFiles, setUploadedGuidelineFiles] = useState<File[]>(
    [],
  );
  const [linkedGoldenRepoFilePaths, setLinkedGoldenRepoFilePaths] = useState<
    string[]
  >([]);
  const [generatedGuidelineContent, setGeneratedGuidelineContent] =
    useState<string>("");
  const [generatedPromptFromBackend, setGeneratedPromptFromBackend] =
    useState<string>(""); // Store backend-built prompt
  const [isGeneratingGuideline, setIsGeneratingGuideline] = useState(false);
  const [guidelineRequirementDocument, setGuidelineRequirementDocument] =
    useState<string>("");
  const [isPushingToAdo, setIsPushingToAdo] = useState(false);
  const [isPushingToDb, setIsPushingToDb] = useState(false);
  const [pushStatus, setPushStatus] = useState<string>("");
  const [figmaLink, setFigmaLink] = useState<string>("");
  const [guidelineRecord, setGuidelineRecord] = useState<any>(null);
  const [figmaLinkInput, setFigmaLinkInput] = useState<string>("");
  const [isSavingFigmaLink, setIsSavingFigmaLink] = useState(false);

  // Golden Repo Guidelines with preview functionality
  const [goldenRepoGuidelinesInfo, setGoldenRepoGuidelinesInfo] =
    useState<any>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Golden Repo Guideline Selector state
  const [guidelineSelectorOpen, setGuidelineSelectorOpen] = useState(false);
  const [
    selectedGoldenRepoIdForGuidelines,
    setSelectedGoldenRepoIdForGuidelines,
  ] = useState<string>("");
  const [
    selectedGoldenRepoNameForGuidelines,
    setSelectedGoldenRepoNameForGuidelines,
  ] = useState<string>("");

  const guidelineFilesInputRef = useRef<HTMLInputElement>(null);

  // Handle Golden Repo Guidelines Selection
  const handleSelectGoldenRepoGuidelines = (
    files: { name: string; path: string; content: string }[],
  ) => {
    if (files.length === 0) return;

    // Store the golden repo file paths
    const filePaths = files.map((f) => f.path);
    setLinkedGoldenRepoFilePaths(filePaths);
    setGuidelineSelectorOpen(false);

    toast({
      title: "Golden Repo Guidelines Selected",
      description: `Selected ${files.length} guideline file(s) from ${selectedGoldenRepoNameForGuidelines || "golden repository"}`,
    });
  };

  // Handle Golden Repo Guideline Preview (Eye Icon)
  const handlePreviewGoldenRepoGuideline = async () => {
    if (!goldenRepoGuidelinesInfo?.previewUrl) {
      toast({
        title: "Preview Not Available",
        description: "No preview URL found for golden repo guidelines",
        variant: "destructive",
      });
      return;
    }

    setIsLoadingPreview(true);
    try {
      const response = await apiRequest(
        "GET",
        goldenRepoGuidelinesInfo.previewUrl,
      );

      const result = await response.json();
      setPreviewContent(result.content || "No content available");
      setPreviewModalOpen(true);
    } catch (error: any) {
      console.error("[Preview] Error loading golden repo guideline:", error);
      toast({
        title: "Preview Failed",
        description: "Failed to load golden repo guideline content",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Handle preview for individually selected golden repo files
  const handlePreviewSelectedFile = async (
    filePath: string,
    fileName: string,
  ) => {
    if (!goldenRepoRef?.repoId) {
      toast({
        title: "Preview Not Available",
        description: "Golden repository information not available",
        variant: "destructive",
      });
      return;
    }

    setIsLoadingPreview(true);
    try {
      // Construct the API URL to fetch file content
      const params = new URLSearchParams();
      params.append("path", filePath);
      if (project?.organization) {
        params.append("organization", project.organization);
        params.append("linkedGoldenRepoOrg", project.organization);
      }
      if (project?.projectName) {
        params.append("projectName", project.projectName);
        params.append("linkedGoldenRepoProject", project.projectName);
      }

      const response = await apiRequest(
        "GET",
        `/api/ado/repository/${goldenRepoRef.repoId}/file?${params.toString()}`,
      );

      const result = await response.json();
      setPreviewContent(result.content || "No content available");
      setPreviewModalOpen(true);
    } catch (error: any) {
      console.error("[Preview] Error loading file:", error);
      toast({
        title: "Preview Failed",
        description: `Failed to load ${fileName}: ${error.message || "Unknown error"}`,
        variant: "destructive",
      });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Handle preview for uploaded files
  const handlePreviewUploadedFile = async (file: File) => {
    setIsLoadingPreview(true);
    try {
      const content = await file.text();
      setPreviewContent(content || "No content available");
      setPreviewModalOpen(true);
    } catch (error: any) {
      console.error("[Preview] Error reading file:", error);
      toast({
        title: "Preview Failed",
        description: `Failed to read ${file.name}: ${error.message || "Unknown error"}`,
        variant: "destructive",
      });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Handlers for Generate Guideline feature
  const handleGuidelinesUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []);
    setUploadedGuidelineFiles(files);

    toast({
      title: "Guidelines Uploaded",
      description: `Added ${files.length} guideline file(s)`,
    });
  };

  const handleRemoveGuidelineFile = async (indexToRemove: number) => {
    const updatedFiles = uploadedGuidelineFiles.filter(
      (_, i) => i !== indexToRemove,
    );
    setUploadedGuidelineFiles(updatedFiles);

    // Reset file input
    if (guidelineFilesInputRef.current) {
      guidelineFilesInputRef.current.value = "";
    }
  };

  // AI-powered guideline generation
  const handleGenerateGuidelineWithAI = async () => {
    console.log("=== GENERATE GUIDELINE DEBUG ===");
    console.log("dbProjectId:", dbProjectId);
    console.log(
      "guidelineRequirementDocument:",
      guidelineRequirementDocument,
      "length:",
      guidelineRequirementDocument?.length,
    );

    // Trim whitespace and validate
    const trimmedPrompt = guidelineRequirementDocument?.trim();

    if (!dbProjectId) {
      toast({
        title: "Missing Information",
        description: "Project ID is missing. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }

    if (!trimmedPrompt) {
      toast({
        title: "Missing Information",
        description:
          "Please provide a prompt describing your layout requirements",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingGuideline(true);

    try {
      toast({
        title: "Generating Figma Make Prompt",
        description: "Creating guideline-driven Figma prompt using AI...",
      });

      // Prepare guidelines content from uploaded files
      let combinedGuidelinesContent = "";

      // Add actual content from uploaded files
      if (uploadedGuidelineFiles.length > 0) {
        combinedGuidelinesContent += "## Uploaded Design Guidelines:\n";
        for (const file of uploadedGuidelineFiles) {
          try {
            const text = await file.text();
            combinedGuidelinesContent += `### ${file.name}\n${text}\n\n`;
          } catch (error) {
            combinedGuidelinesContent += `### ${file.name}\n(Error reading file content)\n\n`;
          }
        }
      }

      // Add golden repo guidelines
      if (linkedGoldenRepoFilePaths.length > 0) {
        combinedGuidelinesContent += "## Golden Repository Guidelines:\n";
        combinedGuidelinesContent += `Selected guidelines from ${linkedGoldenRepoName}:\n`;
        linkedGoldenRepoFilePaths.forEach((path) => {
          combinedGuidelinesContent += `- ${path}\n`;
        });
        combinedGuidelinesContent +=
          "\nCorporate design standards and component library guidelines from golden repository.\n\n";
      }

      console.log("[Generate Guideline] Request payload:", {
        promptLength: trimmedPrompt?.length,
        guidelinesContentLength: combinedGuidelinesContent?.length || 0,
      });

      const response = await apiRequest(
        "POST",
        `/api/sdlc/projects/${dbProjectId}/generate-guidelines`,
        {
          designType: "Guidelines",
          userPrompt: trimmedPrompt,
          requirementDocument: trimmedPrompt,
          guidelinesContent: combinedGuidelinesContent,
          context: {
            uploadedFiles: uploadedGuidelineFiles.length,
            goldenRepoFiles: linkedGoldenRepoFilePaths.length,
            goldenRepoName: linkedGoldenRepoName,
            selectedPaths: linkedGoldenRepoFilePaths,
          },
        },
      );

      let result = await response.json();

      if (response.status === 202 && result?.jobId) {
        const progressToast = toast({
          title: "Generating Figma Make Prompt",
          description: "Starting design guideline generation...",
        });
        try {
          result = await pollAsyncJob<typeof result>(
            "sdlc-generate-guidelines",
            result.jobId,
            {
              onProgress: (message) => {
                progressToast.update({
                  id: progressToast.id,
                  title: "Generating Figma Make Prompt",
                  description: message,
                });
              },
            },
          );
        } finally {
          progressToast.dismiss();
        }

        if (!result?.content && !result?.guidelineContent) {
          throw new Error(
            "Design guideline generation completed without content. Check server logs.",
          );
        }
      }

      console.log("[Generate Guideline] Response received:", {
        hasContent: !!result.content,
        hasFigmaPrompt: !!result.figmaPrompt,
        hasFigmaLink: !!result.figmaLink,
        hasGeneratedPrompt: !!result.generatedPrompt,
        contentLength: result.content?.length || 0,
        hasGoldenRepoGuidelines: !!result.goldenRepoGuidelines,
        goldenRepoGuidelinesInfo: result.goldenRepoGuidelines,
        fullResponse: result,
      });

      // Store the generated content - use AI response (content) not the original prompt (figmaPrompt)
      setGeneratedGuidelineContent(
        result.content || result.guidelineContent || "",
      );
      setGeneratedPromptFromBackend(result.generatedPrompt || "");
      setFigmaLink(result.figmaLink || "");
      setGuidelineRecord(result.guideline || null);

      // Store golden repo guidelines info for eye icon functionality
      if (result.goldenRepoGuidelines) {
        setGoldenRepoGuidelinesInfo(result.goldenRepoGuidelines);
        console.log(
          "[Generate Guideline] Golden Repo Guidelines found:",
          result.goldenRepoGuidelines,
        );
      } else {
        console.log(
          "[Generate Guideline] No golden repo guidelines in response",
        );
        setGoldenRepoGuidelinesInfo(null);
      }

      // Move to step 2 to show results
      setGuidelineStep(2);

      toast({
        title: "Guidelines Generated",
        description: "Figma Make prompt has been generated successfully!",
      });

      // Trigger success callback to refresh parent component validation
      onSuccess?.();
    } catch (error: any) {
      console.error("[Generate Guideline] Error:", error);

      // Handle validation errors specifically
      if (error.status === 400 && error.message) {
        toast({
          title: "Validation Error",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Generation Failed",
          description:
            error.message || "Failed to generate guidelines. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setIsGeneratingGuideline(false);
    }
  };

  const handleSaveFigmaLink = async () => {
    if (!guidelineRecord?.id || !figmaLinkInput.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter a valid Figma link.",
        variant: "destructive",
      });
      return;
    }

    setIsSavingFigmaLink(true);

    try {
      const response = await apiRequest(
        "PATCH",
        `/api/sdlc/projects/${dbProjectId}/design-guidelines/${guidelineRecord.id}/figma-link`,
        {
          figmaLink: figmaLinkInput.trim(),
        },
      );

      const result = await response.json();

      toast({
        title: "Figma Link Saved",
        description: "Your Figma link has been saved successfully!",
      });

      // Update the figmaLink state to show the saved link
      setFigmaLink(figmaLinkInput.trim());
      // Move to step 4 to show completion
      setGuidelineStep(4);

      // Trigger success callback to refresh parent component validation
      onSuccess?.();
    } catch (error: any) {
      console.error("[Save Figma Link] Error:", error);
      toast({
        title: "Save Failed",
        description:
          error.message || "Failed to save Figma link. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingFigmaLink(false);
    }
  };

  const handleClose = () => {
    setGuidelineStep(1);
    setUploadedGuidelineFiles([]);
    setLinkedGoldenRepoFilePaths([]);
    setGeneratedGuidelineContent("");
    setGuidelineRequirementDocument("");
    setFigmaLink("");
    setGuidelineRecord(null);
    setFigmaLinkInput("");
    setIsSavingFigmaLink(false);
    setGeneratedPromptFromBackend("");
    setPushStatus("");

    // Reset golden repo selector state
    setGuidelineSelectorOpen(false);
    setSelectedGoldenRepoIdForGuidelines("");
    setSelectedGoldenRepoNameForGuidelines("");

    // Reset file input
    if (guidelineFilesInputRef.current) {
      guidelineFilesInputRef.current.value = "";
    }

    onClose();
  };

  return (
    <GenericModal
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title="Generate Design Guidelines"
      width="800px"
    >
      <div className="space-y-6">
        {guidelineStep === 1 && (
          <div className="space-y-6">
            {/* Guidelines Selection Buttons */}
            <Card>
              <CardHeader>
                <CardTitle>Select Guidelines</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4">
                  {/* Golden Repo Guidelines Button */}
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!hasValidGoldenRepo) {
                        toast({
                          title: "No Golden Repo Linked",
                          description:
                            "No golden repository is linked to this project.",
                          variant: "destructive",
                        });
                        return;
                      }
                      console.log("[Browse Golden Repo] Opening dialog", {
                        goldenRepoRef,
                        currentSelectorOpen: guidelineSelectorOpen,
                      });
                      setSelectedGoldenRepoIdForGuidelines(
                        goldenRepoRef.repoId,
                      );
                      setSelectedGoldenRepoNameForGuidelines(
                        goldenRepoRef.repoName || "",
                      );
                      setGuidelineSelectorOpen(true);
                      console.log(
                        "[Browse Golden Repo] After setting state to true",
                      );
                    }}
                    disabled={!hasValidGoldenRepo}
                    className="flex-1"
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    {hasValidGoldenRepo
                      ? `Browse ${goldenRepoRef.repoName}`
                      : "No Golden Repo"}
                  </Button>

                  {/* Upload Guidelines Button */}
                  <Button
                    variant="outline"
                    onClick={() => guidelineFilesInputRef.current?.click()}
                    className="flex-1"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Upload Files
                  </Button>
                </div>

                {/* Hidden file input */}
                <Input
                  id="guideline-files"
                  type="file"
                  multiple
                  accept=".txt,.md,.pdf,.doc,.docx"
                  onChange={handleGuidelinesUpload}
                  ref={guidelineFilesInputRef}
                  className="hidden"
                />

                {/* Show selected files summary */}
                {(linkedGoldenRepoFilePaths.length > 0 ||
                  uploadedGuidelineFiles.length > 0) && (
                  <div className="text-sm text-green-600">
                    ✓{" "}
                    {linkedGoldenRepoFilePaths.length +
                      uploadedGuidelineFiles.length}{" "}
                    guideline file(s) selected
                  </div>
                )}
              </CardContent>
            </Card>

            {/* User Prompt */}
            <Card>
              <CardHeader>
                <CardTitle>Design Requirements</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="guideline-prompt">
                      Describe the UI layout you want to create
                    </Label>
                    <AiEnhanceWithDiff
                      value={guidelineRequirementDocument}
                      onEnhanced={setGuidelineRequirementDocument}
                      placeholderExtraPrompt="Add specific instructions for enhancing your design requirements (e.g., make it more detailed, add accessibility considerations, include responsive design notes)..."
                      buttonSize="sm"
                      buttonVariant="outline"
                      locationKey="hub.content"
                      itemName="Design Requirements"
                    />
                  </div>
                  <Textarea
                    id="guideline-prompt"
                    placeholder="Example: Create a dashboard with sidebar navigation, header, and main content area for an insurance application"
                    value={guidelineRequirementDocument}
                    onChange={(e) =>
                      setGuidelineRequirementDocument(e.target.value)
                    }
                    rows={4}
                    className="resize-none"
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-between">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleGenerateGuidelineWithAI}
                disabled={
                  isGeneratingGuideline || !guidelineRequirementDocument.trim()
                }
              >
                {isGeneratingGuideline ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate Guidelines"
                )}
              </Button>
            </div>
          </div>
        )}

        {guidelineStep === 2 && (
          <div className="space-y-6">
            {/* Generated Guidelines Display */}
            <div
              className="min-h-0 overflow-hidden"
              style={{ minHeight: "300px" }}
            >
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                <ExpandablePromptBox
                  content={generatedGuidelineContent}
                  title="Generated Design Guidelines"
                  hideExpandButton={true}
                  actionButton={{
                    label: "Open Figma",
                    onClick: () =>
                      window.open(
                        "https://www.figma.com/make/fDIj2darCHzgHbJXFtJbyo/Untitled?t=G7NHAtSr3v8ZXGXe-0",
                        "_blank",
                        "noopener,noreferrer",
                      ),
                  }}
                />
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setGuidelineStep(1)}>
                Back to Edit
              </Button>
              <Button onClick={() => setGuidelineStep(3)}>
                Next: Add Figma Link
              </Button>
            </div>
          </div>
        )}

        {guidelineStep === 3 && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Add Figma Link</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Input
                    id="figma-link-input"
                    type="url"
                    placeholder="https://www.figma.com/file/..."
                    value={figmaLinkInput}
                    onChange={(e) => setFigmaLinkInput(e.target.value)}
                    className="mt-2"
                  />
                  <p className="text-sm text-gray-600 mt-1">
                    Paste the Figma file URL after creating it with Figma Make
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setGuidelineStep(2)}>
                Back
              </Button>
              <Button
                onClick={handleSaveFigmaLink}
                disabled={isSavingFigmaLink || !figmaLinkInput.trim()}
              >
                {isSavingFigmaLink ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Figma Link"
                )}
              </Button>
            </div>
          </div>
        )}

        {guidelineStep === 4 && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Guidelines Generated Successfully!</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Generated Prompt</Label>
                  <ExpandablePromptBox
                    content={generatedGuidelineContent}
                    title="Design Guidelines"
                  />
                </div>

                {figmaLink && (
                  <div>
                    <Label>Figma File</Label>
                    <div className="mt-2">
                      <a
                        href={figmaLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 underline break-all"
                      >
                        {figmaLink}
                      </a>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        )}
      </div>

      {/* Golden Repo Guideline Selector Dialog */}
      <GoldenRepoGuidelineSelector
        open={guidelineSelectorOpen}
        onOpenChange={setGuidelineSelectorOpen}
        onSelectFiles={handleSelectGoldenRepoGuidelines}
        {...goldenRepoSelectorPropsFromRef(goldenRepoRef)}
        linkedGoldenRepoOrg={project?.linkedGoldenRepoOrg}
        linkedGoldenRepoProject={project?.linkedGoldenRepoProject}
        projectId={projectId || dbProjectId || undefined}
      />

      {/* Golden Repo Guidelines Preview Modal */}
      <GenericModal
        open={previewModalOpen}
        onOpenChange={(open) => !open && setPreviewModalOpen(false)}
        title={
          goldenRepoGuidelinesInfo
            ? `Preview: ${goldenRepoGuidelinesInfo.fileName || "Guidelines"}`
            : "Preview"
        }
        description={goldenRepoGuidelinesInfo?.filePath}
        icon={Eye}
        iconClassName="bg-gradient-to-br from-purple-500 to-purple-600"
        width="1024px"
        maxHeight="90vh"
        contentClassName="flex flex-col"
        footerButtons={[
          {
            label: "Close",
            onClick: () => setPreviewModalOpen(false),
            variant: "outline",
          },
        ]}
      >
        {/*
          flex-1 + min-h-0 lets the bordered preview box fill the entire modal
          content area instead of being capped at max-h-[60vh] (which left a
          blank gap below the preview and made long markdown look truncated).
        */}
        <div className="flex-1 min-h-0 border rounded-lg overflow-y-auto p-4 scrollbar-thin">
          {isLoadingPreview ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : previewContent ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{previewContent}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              No content available
            </div>
          )}
        </div>
      </GenericModal>
    </GenericModal>
  );
};
