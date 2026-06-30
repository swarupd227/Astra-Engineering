import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WikiPage } from "@shared/schema";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface WikiEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wikiPage: WikiPage | null;
  onSave: (updatedPage: WikiPage) => Promise<void> | void;
  integrationType?: string;
}

export function WikiEditDialog({
  open,
  onOpenChange,
  wikiPage,
  onSave,
  integrationType,
}: WikiEditDialogProps) {
  const [editedPage, setEditedPage] = useState<WikiPage | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const docLabel = integrationType === "jira" ? "Confluence" : "Wiki";

  useEffect(() => {
    if (wikiPage) {
      setEditedPage({ ...wikiPage });
    }
  }, [wikiPage]);

  if (!editedPage) return null;

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onSave(editedPage);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit {docLabel} Page</DialogTitle>
          <DialogDescription>
            Edit the {docLabel.toLowerCase()} page content below (Markdown format)
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="edit" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="flex-1 space-y-4 overflow-y-auto mt-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="edit-wiki-title">Title</Label>
              <Input
                id="edit-wiki-title"
                value={editedPage.title || ""}
                onChange={(e) => setEditedPage({ ...editedPage, title: e.target.value })}
                data-testid="input-edit-wiki-title"
              />
            </div>

            {/* Content */}
            <div className="space-y-2 flex-1">
              <Label htmlFor="edit-wiki-content">Content (Markdown)</Label>
              <Textarea
                id="edit-wiki-content"
                value={editedPage.content || ""}
                onChange={(e) => setEditedPage({ ...editedPage, content: e.target.value })}
                className="h-96 font-mono text-sm"
                data-testid="textarea-edit-wiki-content"
              />
            </div>
          </TabsContent>

          <TabsContent value="preview" className="flex-1 overflow-y-auto mt-4">
            <div className="border rounded-md p-4 min-h-[400px]">
              <h2 className="text-2xl font-bold mb-4">{editedPage.title}</h2>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-md">
                  {editedPage.content}
                </pre>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-wiki">
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
