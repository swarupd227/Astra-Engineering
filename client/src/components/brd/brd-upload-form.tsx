import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sparkles } from "lucide-react";
import { Upload, FileText, X, Loader2, Paperclip, ImagePlus, Image as ImageIcon } from "lucide-react";
import { getApiUrl } from "@/lib/api-config";
import type { BRDDocument } from "@/components/brd/brd-preview";

/** Same shape as getBRDGenerate return — unified with Create BRD flow */
export interface BRDGenerateResult {
  success: boolean;
  brd: BRDDocument | null;
  brdId?: string;
  /** When server returns 202 Accepted, this is the async job ID for status polling. */
  jobId?: string;
  /** "processing" | "completed" | "failed" — only present in async upload flow. */
  status?: "processing" | "completed" | "failed";
}

interface BRDUploadFormProps {
  projectId: string | null;
  onUploadSuccess: (brdId: string, brd?: BRDGenerateResult["brd"]) => void;
  isUploading?: boolean;
  /** When provided, uses same generation path as Create BRD; response brd is passed to onUploadSuccess. */
  generateFromUpload?: (formData: FormData) => Promise<BRDGenerateResult>;
  /**
   * Live "what is the server doing right now?" string supplied by the
   * parent's polling helper. When present it OVERRIDES the form's local
   * `uploadStatusMessage` so the button label reflects whichever phase the
   * background job is actually in (e.g. `Extracting structured fields`,
   * `Generating 13-section BRD`, `Validating canonical structure`).
   *
   * When absent (e.g. a host that did not wire polling), the form falls
   * back to its internal upload-stage messages.
   */
  liveStepMessage?: string;
  onCancel?: () => Promise<void>;
  isCancelling?: boolean;
  // Confluence reference files (controlled by parent brd.tsx)
  confluenceFiles?: File[];
  onConfluenceFilesChange?: (files: File[]) => void;
}

/**
 * Inline fallback poller for `/api/brd/generate/status/:jobId`.
 *
 * The Create BRD page wires its own (richer) poll loop via `generateFromUpload`,
 * so this helper only runs when this component is dropped in elsewhere without
 * a parent-supplied generator. It mirrors the basic 2-second interval used by
 * the page-level poller and surfaces a human-readable status string.
 */
async function pollBrdGenerationStatus(
  jobId: string,
  onProgress: (message: string) => void,
): Promise<{ brdId: string | undefined; brd: BRDDocument | null }> {
  const POLL_INTERVAL_MS = 2000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resp = await fetch(getApiUrl(`/api/brd/generate/status/${jobId}`), {
      method: "GET",
      credentials: "include",
    });
    if (!resp.ok) {
      // Transient errors are retried; only hard-fail on 4xx that aren't 408/429.
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429) {
        const errBody = await resp.json().catch(() => ({} as any));
        throw new Error(
          errBody?.message ||
            errBody?.error ||
            `Failed to fetch BRD generation status (HTTP ${resp.status})`,
        );
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    const data = await resp.json().catch(() => ({} as any));
    if (data?.progress?.message) {
      onProgress(String(data.progress.message));
    } else if (data?.step) {
      onProgress(`Generating: ${data.step}`);
    }
    if (data?.status === "completed") {
      return {
        brdId: data?.result?.brdId || data?.brdId,
        brd: data?.result?.brd ?? null,
      };
    }
    if (data?.status === "failed") {
      throw new Error(
        data?.error || "BRD generation failed on the server.",
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export function BRDUploadForm({
  projectId,
  onUploadSuccess,
  isUploading = false,
  generateFromUpload,
  liveStepMessage,
  onCancel,
  isCancelling = false,
  confluenceFiles = [],
  onConfluenceFilesChange,
}: BRDUploadFormProps) {
  const [brdTitle, setBrdTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingState, setIsUploadingState] = useState(false);
  const [uploadStatusMessage, setUploadStatusMessage] = useState<string>("");
  const [useGoldenRepo, setUseGoldenRepo] = useState(true); // Default ON
  const [diagramImages, setDiagramImages] = useState<File[]>([]);
  const [diagramWarning, setDiagramWarning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confluenceInputRef = useRef<HTMLInputElement>(null);
  const diagramInputRef = useRef<HTMLInputElement>(null);
  const [maxFilesWarning, setMaxFilesWarning] = useState(false);

  const MAX_DIAGRAM_IMAGES = 5;
  const MAX_DIAGRAM_SIZE_MB = 10;
  const DIAGRAM_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif";
  const ALLOWED_DIAGRAM_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];

  const allowedExtensions = [".docx", ".pdf", ".doc"];
  const maxFileSize = 50 * 1024 * 1024; // 50MB

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file extension
    const fileExtension = file.name
      .substring(file.name.lastIndexOf("."))
      .toLowerCase();
    if (!allowedExtensions.includes(fileExtension)) {
      alert(
        `Invalid file type. Please upload a ${allowedExtensions.join(
          ", "
        )} file.`
      );
      return;
    }

    // Validate file size
    if (file.size > maxFileSize) {
      alert(`File size exceeds ${maxFileSize / 1024 / 1024}MB limit.`);
      return;
    }

    setSelectedFile(file);

    // Auto-generate BRD title from filename if title is empty
    if (!brdTitle.trim()) {
      // Strip file extension
      const fileNameWithoutExt = file.name
        .substring(0, file.name.lastIndexOf("."))
        .trim();

      // Ensure "BRD-" prefix (avoid double prefixing)
      const prefix = "BRD-";
      const generatedTitle = fileNameWithoutExt.startsWith(prefix)
        ? fileNameWithoutExt
        : `${prefix}${fileNameWithoutExt}`;

      setBrdTitle(generatedTitle);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUpload = async () => {
    if (!brdTitle.trim()) {
      alert("Please enter a BRD title.");
      return;
    }

    if (!selectedFile) {
      alert("Please select a file to upload.");
      return;
    }

    if (!projectId) {
      alert("Project ID is required. Please select a project first.");
      return;
    }

    setIsUploadingState(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("title", brdTitle.trim());
      formData.append("projectId", projectId);
      formData.append("createdBy", "system"); // TODO: Get actual user ID
      formData.append("uploadedBy", "system"); // TODO: Get actual user ID

      formData.append("useGoldenRepo", useGoldenRepo ? "true" : "false");

      // Append any user-attached diagram / architecture images
      diagramImages.forEach((img, i) => {
        formData.append(`diagram_image_${i}`, img, img.name);
      });

      setUploadStatusMessage("Uploading file…");
      const result = generateFromUpload
        ? await generateFromUpload(formData)
        : await (async () => {
            // Inline fallback: upload + 202 + poll status (only used when parent
            // does not supply its own generateFromUpload). The Create BRD page
            // (which IS our parent) overrides this with its own polling loop
            // that surfaces section-level progress to the BRD preview pane.
            const response = await fetch(getApiUrl("/api/brd/upload"), {
              method: "POST",
              body: formData,
              credentials: "include",
            });
            const data = await response.json().catch(() => ({} as any));
            if (!response.ok) {
              throw new Error(
                data?.details ||
                  data?.message ||
                  data?.error ||
                  `Failed to upload BRD (HTTP ${response.status})`
              );
            }
            // New 202 + jobId asynchronous response (introduced to avoid the
            // AWS API Gateway 30s timeout). The synchronous `success + brdId`
            // path is kept for backward compatibility with older deployments.
            if (data?.jobId) {
              setUploadStatusMessage("Processing on server…");
              const polledBrd = await pollBrdGenerationStatus(
                data.jobId,
                (msg) => setUploadStatusMessage(msg),
              );
              return {
                success: true,
                brd: polledBrd.brd,
                brdId: polledBrd.brdId || data.brdId,
                jobId: data.jobId,
                status: "completed",
              } as BRDGenerateResult;
            }
            if (!data?.success || !data?.brdId) {
              throw new Error(
                data?.details ||
                  data?.message ||
                  data?.error ||
                  "Server did not return a BRD ID. The upload may have failed on the server."
              );
            }
            return {
              success: true,
              brd: data.brd ?? null,
              brdId: data.brdId,
            } as BRDGenerateResult;
          })();

      if (!result.success && !result.brdId) {
        // Silently abort — this happens when the user explicitly cancelled generation.
        return;
      }

      if (!result.success || !result.brdId) {
        throw new Error(
          "Server did not return a BRD ID. The upload may have failed on the server."
        );
      }

      // Reset form
      setBrdTitle("");
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      onUploadSuccess(result.brdId, result.brd ?? undefined);
    } catch (error) {
      console.error("Failed to upload BRD:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to upload BRD. Please try again."
      );
    } finally {
      setIsUploadingState(false);
      setUploadStatusMessage("");
    }
  };

  const canUpload =
    brdTitle.trim() &&
    selectedFile &&
    projectId &&
    !isUploadingState &&
    !isUploading;

  return (
    <Card className="lg:h-full min-h-0 flex flex-col overflow-hidden">
      <CardHeader className="pb-4">
        <div className="rounded-lg border bg-muted/50 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Upload className="h-5 w-5" />
            </div>
            <div className="flex-1 pt-0.5">
              <CardTitle className="leading-tight">Upload BRD</CardTitle>
              <CardDescription className="mt-1 leading-relaxed">
                Upload an existing BRD document to add it to your project
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto">
        <div className="space-y-6">
          {/* Golden Repo Toggle */}
          <div className="flex flex-row items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Use Golden Repo Guidance
              </Label>
              <div className="text-sm text-muted-foreground">
                Enable RAG guidance from organizational golden repositories for higher quality results.
              </div>
            </div>
            <Switch
              checked={useGoldenRepo}
              onCheckedChange={setUseGoldenRepo}
              disabled={isUploadingState || isUploading}
              data-testid="toggle-use-golden-repo-upload"
            />
          </div>
          {/* BRD Title */}
          <div className="space-y-2">
            <Label htmlFor="brd-title">
              BRD Title <span className="text-destructive">*</span>
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">
                BRD-
              </span>
              <Input
                id="brd-title"
                placeholder="e.g., Customer Portal Requirements v1.0"
                value={
                  brdTitle.startsWith("BRD-") ? brdTitle.substring(4) : brdTitle
                }
                onChange={(e) => {
                  const customTitle = e.target.value;
                  const trimmed = customTitle.trim();
                  setBrdTitle(trimmed ? `BRD-${trimmed}` : "");
                }}
                disabled={isUploadingState || isUploading}
                className="flex-1"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              A unique name to identify this BRD document (without "BRD-"
              prefix)
            </p>
          </div>

          {/* File Upload */}
          <div className="space-y-2">
            <Label htmlFor="brd-file">
              BRD File <span className="text-destructive">*</span>
            </Label>
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                id="brd-file"
                accept=".docx,.pdf,.doc"
                onChange={handleFileSelect}
                disabled={isUploadingState || isUploading}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingState || isUploading}
                className="w-full"
              >
                <Upload className="h-4 w-4 mr-2" />
                {selectedFile ? "Change File" : "Select File"}
              </Button>

              {selectedFile && (
                <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 text-sm truncate">
                    {selectedFile.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleRemoveFile}
                    disabled={isUploadingState || isUploading}
                    className="h-6 w-6"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Supported formats: DOCX, PDF, DOC (Max size: 50MB)
              </p>
            </div>
          </div>

          {/* Diagram / Architecture Image Attachment Panel */}
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-3">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-shrink-0">
                <ImagePlus className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  Diagrams &amp; Images
                </span>
              </div>

              {/* Image badge pills with thumbnail preview */}
              {diagramImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {diagramImages.map((img, idx) => (
                    <span
                      key={`${img.name}-${idx}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-700 px-3 py-1 text-xs font-medium text-violet-800 dark:text-violet-200 max-w-[220px]"
                    >
                      <ImageIcon className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate" title={img.name}>{img.name}</span>
                      <button
                        type="button"
                        disabled={isUploadingState || isUploading}
                        className="ml-0.5 rounded-full hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        onClick={() =>
                          setDiagramImages(diagramImages.filter((_, i) => i !== idx))
                        }
                        aria-label={`Remove ${img.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Add button — hidden when cap reached */}
              {diagramImages.length < MAX_DIAGRAM_IMAGES && (
                <button
                  type="button"
                  disabled={isUploadingState || isUploading}
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-violet-400 dark:border-violet-600 px-3 py-1 text-xs font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  onClick={() => diagramInputRef.current?.click()}
                >
                  <ImagePlus className="h-3 w-3" />
                  Attach diagram / screenshot
                </button>
              )}

              {/* Hidden file input */}
              <input
                ref={diagramInputRef}
                type="file"
                accept={DIAGRAM_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  const incoming = Array.from(e.target.files ?? []);
                  if (incoming.length === 0) return;
                  // Filter to valid types + size
                  const valid = incoming.filter((f) => {
                    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
                    if (!ALLOWED_DIAGRAM_EXTS.includes(ext)) return false;
                    if (f.size > MAX_DIAGRAM_SIZE_MB * 1024 * 1024) return false;
                    return true;
                  });
                  const combined = [...diagramImages, ...valid].slice(0, MAX_DIAGRAM_IMAGES);
                  const overflow = diagramImages.length + valid.length > MAX_DIAGRAM_IMAGES;
                  setDiagramWarning(overflow);
                  if (overflow) setTimeout(() => setDiagramWarning(false), 3000);
                  setDiagramImages(combined);
                  e.target.value = "";
                }}
              />

              <span className="text-xs text-muted-foreground ml-auto self-center">
                {diagramWarning
                  ? `Max ${MAX_DIAGRAM_IMAGES} images — extra ignored`
                  : diagramImages.length === 0
                  ? `Attach up to ${MAX_DIAGRAM_IMAGES} workflow/architecture diagrams (PNG, JPEG, WEBP, GIF · max ${MAX_DIAGRAM_SIZE_MB} MB each)`
                  : diagramImages.length === MAX_DIAGRAM_IMAGES
                  ? `${MAX_DIAGRAM_IMAGES} / ${MAX_DIAGRAM_IMAGES} images attached`
                  : `${diagramImages.length} / ${MAX_DIAGRAM_IMAGES} image${diagramImages.length !== 1 ? "s" : ""} attached`}
              </span>
            </div>
          </div>

          {/* Confluence Reference Panel */}
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-3">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-shrink-0">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  Confluence Reference
                </span>
              </div>

              {/* File badges */}
              {confluenceFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {confluenceFiles.map((file, idx) => (
                    <span
                      key={`${file.name}-${idx}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 px-3 py-1 text-xs font-medium text-blue-800 dark:text-blue-200 max-w-[220px]"
                    >
                      <FileText className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate" title={file.name}>{file.name}</span>
                      <button
                        type="button"
                        disabled={isUploadingState || isUploading}
                        className="ml-0.5 rounded-full hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        onClick={() =>
                          onConfluenceFilesChange?.(
                            confluenceFiles.filter((_, i) => i !== idx),
                          )
                        }
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Add button — hidden when 2 files already attached */}
              {confluenceFiles.length < 2 && (
                <button
                  type="button"
                  disabled={isUploadingState || isUploading}
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-blue-400 dark:border-blue-600 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  onClick={() => confluenceInputRef.current?.click()}
                >
                  <Paperclip className="h-3 w-3" />
                  Attach Confluence page (.docx)
                </button>
              )}

              {/* Hidden file input */}
              <input
                ref={confluenceInputRef}
                type="file"
                accept=".docx,.doc"
                multiple
                className="hidden"
                onChange={(e) => {
                  const incoming = Array.from(e.target.files ?? []);
                  if (incoming.length === 0) return;
                  const combined = [...confluenceFiles, ...incoming].slice(0, 2);
                  if (confluenceFiles.length + incoming.length > 2) {
                    setMaxFilesWarning(true);
                    setTimeout(() => setMaxFilesWarning(false), 3000);
                  } else {
                    setMaxFilesWarning(false);
                  }
                  onConfluenceFilesChange?.(combined);
                  e.target.value = "";
                }}
              />

              <span className="text-xs text-muted-foreground ml-auto self-center">
                {maxFilesWarning
                  ? "Max 2 files — extra files ignored"
                  : confluenceFiles.length === 0
                  ? "Attach up to 2 Confluence Word exports to use as reference"
                  : confluenceFiles.length === 2
                  ? "2 / 2 files attached"
                  : `${confluenceFiles.length} / 2 file${confluenceFiles.length !== 1 ? "s" : ""} attached`}
              </span>
            </div>
          </div>

          {/* Upload Button */}
          <div className="pt-4">
            <Button
              onClick={handleUpload}
              disabled={!canUpload}
              className="w-full"
              size="lg"
            >
              {isUploadingState || isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {liveStepMessage?.trim() ||
                    uploadStatusMessage ||
                    "Uploading..."}
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload BRD
                </>
              )}
            </Button>
            {(isUploadingState || isUploading) && onCancel && (
              <Button
                variant="ghost"
                onClick={onCancel}
                disabled={isCancelling}
                className="w-full mt-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                size="sm"
              >
                {isCancelling ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <X className="h-4 w-4 mr-2" />
                )}
                Cancel Upload
              </Button>
            )}
            {(isUploadingState || isUploading) &&
              (liveStepMessage?.trim() || uploadStatusMessage) && (
                <p
                  className="mt-2 text-xs text-muted-foreground text-center"
                  data-testid="upload-status-message"
                >
                  {liveStepMessage?.trim() || uploadStatusMessage}
                </p>
              )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
