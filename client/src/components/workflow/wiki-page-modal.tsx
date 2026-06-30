import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { WikiDocumentViewer } from "@/components/wiki-document-viewer";
import type { WikiPage } from "@shared/schema";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface WikiPageModalProps {
  wikiPage: WikiPage;
  open: boolean;
  onClose: () => void;
  integrationType?: string;
}

export function WikiPageModal({ wikiPage, open, onClose, integrationType }: WikiPageModalProps) {
  if (!wikiPage) return null;

  const docLabel = integrationType === "jira" ? "Confluence" : "Wiki";

  const [content, setContent] = useState<string>(wikiPage.content || "");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Keep local content in sync when a different page is opened
  useEffect(() => {
    setContent(wikiPage.content || "");
    setHasUnsavedChanges(false);
    setIsSaving(false);
  }, [wikiPage]);

  const handleSave = async () => {
    if (!hasUnsavedChanges || isSaving) return;

    try {
      setIsSaving(true);

      const res = await apiRequest(
        "PATCH",
        `/api/wiki-pages/${wikiPage.id}`,
        {
          title: wikiPage.title,
          content,
          sessionId: wikiPage.sessionId,
        }
      );

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || "Failed to update wiki page");
      }

      // Invalidate cached wiki pages so workflow view refreshes
      if (wikiPage.sessionId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/wiki/session", wikiPage.sessionId],
        });
      }

      toast.success(`${docLabel} page updated successfully`);
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error("[Wiki] Failed to save page from preview modal:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to save ${docLabel.toLowerCase()} page`
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[95vh] p-0 flex flex-col">
        <div className="flex-1 min-h-0">
          <WikiDocumentViewer
            content={content}
            title={wikiPage.title || "Untitled"}
            createdAt={wikiPage.createdAt}
            updatedAt={wikiPage.updatedAt}
            author={wikiPage.author}
            onContentChange={(next) => {
              setContent(next);
              setHasUnsavedChanges(true);
            }}
          />
        </div>

        <DialogFooter className="border-t bg-background px-6 py-3 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {hasUnsavedChanges
              ? "You have unsaved changes made by AI fixes."
              : `Previewing ${docLabel.toLowerCase()} page`}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={onClose}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!hasUnsavedChanges || isSaving}
            >
              {isSaving ? "Saving..." : `Save ${docLabel.toLowerCase()}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
