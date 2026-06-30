/**
 * BDD Assets Actions Modal
 * Push to repository (GitHub or ADO per project config) or export as ZIP
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GitBranch,
  Download,
  FolderTree,
  FileCode,
  CheckCircle2,
  Loader2,
  AlertCircle,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { apiRequest } from "@/lib/queryClient";

interface BDDAsset {
  filename: string;
  content: string;
  category: string;
}

interface BDDAssetsActionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureFiles: BDDAsset[];
  stepDefFiles: BDDAsset[];
  userStory: { id: string; title: string };
  framework: string;
  projectId?: string | null;
  organization?: string | null;
  projectName?: string | null;
}

export function BDDAssetsActionsModal({
  open,
  onOpenChange,
  featureFiles,
  stepDefFiles,
  userStory,
  framework,
  projectId,
  organization,
  projectName,
}: BDDAssetsActionsModalProps) {
  const [isPushingToRepo, setIsPushingToRepo] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [pushComplete, setPushComplete] = useState(false);
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const [bddBranch, setBddBranch] = useState("main");
  const [bddTargetPath, setBddTargetPath] = useState("");

  const handlePushToRepository = async () => {
    try {
      setIsPushingToRepo(true);
      const url = projectId
        ? "/api/bdd-assets/push-to-git"
        : "/api/bdd-assets/push-to-github";
      const body: Record<string, unknown> = {
        featureFiles,
        stepDefFiles,
        userStory,
        branch: bddBranch || undefined,
        targetPath: bddTargetPath || undefined,
      };
      if (projectId) {
        body.projectId = projectId;
        body.organization = organization ?? undefined;
        body.projectName = projectName ?? undefined;
      }
      const response = await apiRequest("POST", url, body);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || "Failed to push to repository");
      }

      const result = await response.json();
      setCommitSha(result.commitSha);
      setPushComplete(true);
      toast.success("BDD assets pushed to repository successfully");
    } catch (error: any) {
      console.error("[BDDAssetsActionsModal] Push failed:", error);
      toast.error(error.message || "Failed to push to repository");
    } finally {
      setIsPushingToRepo(false);
    }
  };

  const handleExportZip = async () => {
    try {
      setIsExportingZip(true);

      console.log("[BDDAssetsActionsModal] Exporting as ZIP...");

      const response = await apiRequest("POST", "/api/bdd-assets/export-zip", {
        featureFiles,
        stepDefFiles,
        userStory,
      });

      // apiRequest already validates response.ok, so we can directly call .blob()
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      
      // Extract filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = "bdd-assets.zip";
      if (contentDisposition) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
        if (matches && matches[1]) {
          filename = matches[1].replace(/['"]/g, "");
        }
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      console.log("[BDDAssetsActionsModal] ZIP export successful");
      toast.success(`✅ BDD assets exported as ${filename}`);
    } catch (error: any) {
      console.error("[BDDAssetsActionsModal] ZIP export failed:", error);
      toast.error(error.message || "Failed to export ZIP");
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleClose = () => {
    if (!isPushingToRepo && !isExportingZip) {
      onOpenChange(false);
      setPushComplete(false);
      setCommitSha(null);
    }
  };

  const categories = Array.from(
    new Set([...featureFiles.map((f) => f.category), ...stepDefFiles.map((f) => f.category)])
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FolderTree className="h-5 w-5 text-green-600" />
            BDD Assets Generated Successfully
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 overflow-y-auto flex-1 pr-2">
          {/* Summary Card */}
          <Card className="p-4 bg-emerald-500/10 border-emerald-500/30">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-500 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="font-semibold text-lg mb-2">Generation Complete!</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  All BDD test assets have been generated for: <strong>{userStory.title}</strong>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="bg-white">
                    <FileCode className="h-3 w-3 mr-1" />
                    {featureFiles.length} Feature Files
                  </Badge>
                  <Badge variant="outline" className="bg-white">
                    <FileCode className="h-3 w-3 mr-1" />
                    {stepDefFiles.length} Step Definition Files
                  </Badge>
                  <Badge variant="outline" className="bg-white">
                    {framework === "playwright" ? "🎭 Playwright" : "🔧 Selenium"}
                  </Badge>
                </div>
              </div>
            </div>
          </Card>

          {/* Folder Structure Preview */}
          <div className="bg-muted/30 rounded-lg p-4">
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <FolderTree className="h-4 w-4" />
              Folder Structure
            </h4>
            <div className="font-mono text-xs space-y-1 text-muted-foreground">
              <div>📁 {userStory.id.toLowerCase()}-{userStory.title.toLowerCase().substring(0, 20)}...</div>
              <div className="ml-4">├── 📁 features/</div>
              {categories.map((cat, idx) => (
                <div key={`feat-${cat}`} className="ml-8">
                  {idx === categories.length - 1 && stepDefFiles.length === 0 ? "└──" : "├──"} 📁 {cat}/
                </div>
              ))}
              <div className="ml-4">├── 📁 step-definitions/</div>
              {categories.map((cat, idx) => (
                <div key={`step-${cat}`} className="ml-8">
                  {idx === categories.length - 1 ? "└──" : "├──"} 📁 {cat}/
                </div>
              ))}
              <div className="ml-4">└── 📄 README.md</div>
            </div>
          </div>

          {/* Branch / Folder Selection */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="bdd-branch" className="text-xs font-medium">Branch</Label>
              <Input id="bdd-branch" value={bddBranch} onChange={(e) => setBddBranch(e.target.value)} placeholder="main" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bdd-target-path" className="text-xs font-medium">Target Folder (optional)</Label>
              <Input id="bdd-target-path" value={bddTargetPath} onChange={(e) => setBddTargetPath(e.target.value)} placeholder="test-artifacts" className="h-8 text-sm" />
            </div>
          </div>

          {/* Push Status */}
          {pushComplete && commitSha && (
            <Card className="p-4 bg-emerald-500/10 border-emerald-500/30">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <div>
                  <p className="font-semibold text-sm text-foreground">Pushed to Repository</p>
                  <p className="text-xs text-muted-foreground">Commit: {commitSha.substring(0, 7)}</p>
                </div>
              </div>
            </Card>
          )}

          {/* Actions */}
          <div className="grid grid-cols-1 gap-3">
            <Button
              onClick={handlePushToRepository}
              disabled={isPushingToRepo || isExportingZip || pushComplete}
              className="w-full h-auto py-4 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800"
            >
              {isPushingToRepo ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Pushing to repository...
                </>
              ) : pushComplete ? (
                <>
                  <CheckCircle2 className="mr-2 h-5 w-5" />
                  Pushed to repository
                </>
              ) : (
                <>
                  <GitBranch className="mr-2 h-5 w-5" />
                  Push to Repository
                </>
              )}
            </Button>

            <Button
              onClick={handleExportZip}
              disabled={isPushingToRepo || isExportingZip}
              variant="outline"
              className="w-full h-auto py-4"
            >
              {isExportingZip ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Creating ZIP...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-5 w-5" />
                  Export as ZIP
                </>
              )}
            </Button>
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 border-t pt-4 mt-4">
          <Button
            onClick={handleClose}
            disabled={isPushingToRepo || isExportingZip}
            variant="ghost"
          >
            {isPushingToRepo || isExportingZip ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Please wait...
              </>
            ) : (
              <>
                <X className="mr-2 h-4 w-4" />
                Close
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
