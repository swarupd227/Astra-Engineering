import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Copy, Sparkles, Check, Loader2, MessageSquare, Trash2, Pencil, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PageHeaderSkeleton, CardGridSkeleton } from "@/components/ui/page-skeletons";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { AiEnhance } from "@/components/AiEnhance";

interface Prompt {
  id: string;
  title: string;
  description: string | null;
  content: string;
  category: string;
  tags: string[] | null;
  usageCount: number | null;
}

type PromptFormData = {
  title: string;
  description: string;
  content: string;
  category: string;
  tags: string[];
};

const emptyForm: PromptFormData = {
  title: "",
  description: "",
  content: "",
  category: "General",
  tags: [],
};

export default function HubPrompts() {
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<Prompt | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState<Prompt | null>(null);
  const { toast } = useToast();

  // Override the global "never refetch" defaults so external DB changes show up:
  //  - poll every 10s while the tab is open
  //  - refetch when the user returns to the tab
  //  - treat data as immediately stale so the polling actually fires
  const { data: allPrompts = [], isLoading, isFetching, refetch } = useQuery<Prompt[]>({
    queryKey: ["/api/hub/prompts"],
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const [formData, setFormData] = useState<PromptFormData>(emptyForm);

  const [generateFormData, setGenerateFormData] = useState({
    description: "",
    category: "General",
    context: "",
  });

  const usageMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/hub/prompts/${id}/use`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hub/prompts"] });
    },
  });

  const handleCopy = (prompt: Prompt) => {
    navigator.clipboard.writeText(prompt.content);
    setCopiedId(prompt.id);
    setTimeout(() => setCopiedId(null), 2000);
    usageMutation.mutate(prompt.id);
    toast({
      title: "Copied to clipboard",
      description: "Skill content has been copied.",
    });
  };

  const handleView = (prompt: Prompt) => {
    setSelectedPrompt(prompt);
    usageMutation.mutate(prompt.id);
  };

  const createMutation = useMutation({
    mutationFn: async (newPrompt: PromptFormData) => {
      const res = await apiRequest("POST", "/api/hub/prompts", newPrompt);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hub/prompts"] });
      setDialogOpen(false);
      toast({
        title: "Skill Saved",
        description: `${formData.title} has been added to your library.`,
      });
      setFormData(emptyForm);
    },
    onError: (error) => {
      toast({
        title: "Save Failed",
        description: error instanceof Error ? error.message : "Failed to save skill",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: PromptFormData }) => {
      const res = await apiRequest("PUT", `/api/hub/prompts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hub/prompts"] });
      setDialogOpen(false);
      setIsEditing(false);
      setEditingId(null);
      toast({
        title: "Skill Updated",
        description: `${formData.title} has been updated.`,
      });
      setFormData(emptyForm);
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error instanceof Error ? error.message : "Failed to update skill",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/hub/prompts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hub/prompts"] });
      setDeleteDialogOpen(false);
      setPromptToDelete(null);
      // If currently viewing the deleted prompt, leave detail view
      if (selectedPrompt && promptToDelete && selectedPrompt.id === promptToDelete.id) {
        setSelectedPrompt(null);
      }
      toast({
        title: "Skill Deleted",
        description: "The skill has been removed from your library.",
      });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Failed to delete skill",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!formData.title || !formData.content) {
      toast({
        title: "Validation Error",
        description: "Title and content are required.",
        variant: "destructive",
      });
      return;
    }
    if (isEditing && editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const openEditDialog = (prompt: Prompt) => {
    setIsEditing(true);
    setEditingId(prompt.id);
    setFormData({
      title: prompt.title,
      description: prompt.description ?? "",
      content: prompt.content,
      category: prompt.category,
      tags: prompt.tags ?? [],
    });
    setDialogOpen(true);
  };

  const confirmDelete = (prompt: Prompt) => {
    setPromptToDelete(prompt);
    setDeleteDialogOpen(true);
  };

  const handleGeneratePrompt = async () => {
    setIsGenerating(true);
    try {
      const response = await apiRequest(
        "POST",
        "/api/hub/prompts/generate",
        generateFormData,
      );
      const result = await response.json();

      const generated: Prompt = {
        id: result.id ?? "",
        title: result.title || "",
        description: result.description ?? null,
        content: result.content || "",
        category: result.category || generateFormData.category,
        tags: Array.isArray(result.tags) ? result.tags : [],
        usageCount: result.usageCount ?? 0,
      };

      setGeneratedPrompt(generated);
      setHasGenerated(true);

      queryClient.invalidateQueries({ queryKey: ["/api/hub/prompts"] });

      toast({
        title: "Skill Generated & Saved",
        description: "AI has generated and saved a skill based on your description.",
      });
    } catch (error) {
      toast({
        title: "Skill Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate skill",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyGeneratedPrompt = async () => {
    if (!generatedPrompt) return;

    const textToCopy = [
      `Title: ${generatedPrompt.title}`,
      ``,
      `Description:`,
      generatedPrompt.description || "-",
      ``,
      `Category: ${generatedPrompt.category}`,
      `Tags: ${(generatedPrompt.tags ?? []).join(", ") || "-"}`,
      ``,
      `Prompt:`,
      generatedPrompt.content || "-",
    ].join("\n");

    await navigator.clipboard.writeText(textToCopy);

    toast({
      title: "Copied to clipboard",
      description: "Generated prompt (all fields) has been copied.",
    });

    setGenerateDialogOpen(false);
    setHasGenerated(false);
    setGeneratedPrompt(null);
    setGenerateFormData({
      description: "",
      category: "General",
      context: "",
    });
  };

  if (isLoading) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <PageHeaderSkeleton />
        <CardGridSkeleton columns={3} cardCount={6} />
      </div>
    );
  }

  const categories = Array.from(new Set(allPrompts.map((p) => p.category)));
  const hasPrompts = allPrompts.length > 0;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={MessageSquare}
        title="Skills"
        subtitle="Reusable AI skills and templates for your workflow"
        color="amber"
        data-testid="text-page-title"
      >
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh"
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button
            onClick={() => {
              setHasGenerated(false);
              setGeneratedPrompt(null);
              setGenerateFormData({
                description: "",
                category: "General",
                context: "",
              });
              setGenerateDialogOpen(true);
            }}
            data-testid="button-generate-prompt"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Generate Skill
          </Button>
        </div>
      </PageHeader>

      {selectedPrompt ? (
        <div className="space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedPrompt(null)}
            data-testid="button-back"
          >
            ← Back to Skills
          </Button>

          <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-amber-500">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">{selectedPrompt.category}</Badge>
                    <Badge variant="outline" className="text-xs">
                      Used {selectedPrompt.usageCount ?? 0} times
                    </Badge>
                  </div>
                  <CardTitle className="text-2xl">{selectedPrompt.title}</CardTitle>
                  {selectedPrompt.description && (
                    <CardDescription className="text-base">
                      {selectedPrompt.description}
                    </CardDescription>
                  )}
                  {selectedPrompt.tags && selectedPrompt.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {selectedPrompt.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    onClick={() => handleCopy(selectedPrompt)}
                    data-testid="button-copy"
                  >
                    {copiedId === selectedPrompt.id ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => openEditDialog(selectedPrompt)}
                    data-testid="button-edit"
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => confirmDelete(selectedPrompt)}
                    data-testid="button-delete"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="p-4 rounded-md bg-muted font-mono text-sm whitespace-pre-wrap">
                {selectedPrompt.content}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : !hasPrompts ? (
        <Card className="rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-amber-500">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-4">
            <div className="rounded-full bg-amber-500/10 p-4">
              <MessageSquare className="h-8 w-8 text-amber-500" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">No skills yet</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Skills are reusable AI prompt templates for your workflow. Generate one with AI or create your own from scratch.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => {
                  setHasGenerated(false);
                  setGeneratedPrompt(null);
                  setGenerateDialogOpen(true);
                }}
                data-testid="button-empty-generate"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Skill
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {categories.map((category) => {
            const categoryPrompts = allPrompts.filter((p) => p.category === category);

            return (
              <div key={category} className="space-y-3">
                <h2 className="text-xl font-semibold">{category}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categoryPrompts.map((prompt) => (
                    <Card
                      key={prompt.id}
                      className="hover-elevate cursor-pointer rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-amber-500"
                      data-testid={`card-prompt-${prompt.id}`}
                      onClick={() => handleView(prompt)}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base truncate">
                              {prompt.title}
                            </CardTitle>
                            {prompt.description && (
                              <CardDescription className="mt-1 line-clamp-2">
                                {prompt.description}
                              </CardDescription>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-1.5 min-h-[1.25rem]">
                          {(prompt.tags ?? []).slice(0, 2).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                          {(prompt.tags ?? []).length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{(prompt.tags ?? []).length - 2}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center justify-between pt-2">
                          <span className="text-xs text-muted-foreground">
                            {prompt.usageCount ?? 0} uses
                          </span>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopy(prompt);
                              }}
                              data-testid={`button-copy-${prompt.id}`}
                              title="Copy"
                            >
                              {copiedId === prompt.id ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditDialog(prompt);
                              }}
                              data-testid={`button-edit-${prompt.id}`}
                              title="Edit"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                confirmDelete(prompt);
                              }}
                              data-testid={`button-delete-${prompt.id}`}
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Skill with AI</DialogTitle>
            <DialogDescription>
              Describe what you need and let AI create a skill for you
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!hasGenerated && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="gen-description">What do you need the skill for?</Label>
                  <Textarea
                    id="gen-description"
                    value={generateFormData.description}
                    onChange={(e) =>
                      setGenerateFormData({ ...generateFormData, description: e.target.value })
                    }
                    placeholder="e.g., Create a template for bug reports with severity levels..."
                    rows={4}
                    data-testid="input-generate-description"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="gen-category">Category</Label>
                  <Input
                    id="gen-category"
                    value={generateFormData.category}
                    onChange={(e) =>
                      setGenerateFormData({ ...generateFormData, category: e.target.value })
                    }
                    placeholder="e.g., Testing, Documentation"
                    data-testid="input-generate-category"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="gen-context">Additional Context (Optional)</Label>
                  <Textarea
                    id="gen-context"
                    value={generateFormData.context}
                    onChange={(e) =>
                      setGenerateFormData({ ...generateFormData, context: e.target.value })
                    }
                    placeholder="Any specific requirements or examples..."
                    rows={3}
                    data-testid="input-generate-context"
                  />
                </div>
              </>
            )}

            {hasGenerated && generatedPrompt && (
              <div className="space-y-2 pt-2">
                <Label>Generated Skill Preview</Label>
                <div className="rounded-md border bg-muted/60 p-3 space-y-2 text-sm">
                  <div>
                    <p className="font-semibold">{generatedPrompt.title}</p>
                    {generatedPrompt.description && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {generatedPrompt.description}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="secondary">{generatedPrompt.category}</Badge>
                    {(generatedPrompt.tags ?? []).map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <div className="rounded bg-background/80 border border-dashed p-2 max-h-64 overflow-auto font-mono whitespace-pre-wrap">
                    {generatedPrompt.content || "No content generated yet."}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setGenerateDialogOpen(false)}
                disabled={isGenerating}
                data-testid="button-cancel-generate"
              >
                Cancel
              </Button>
              <Button
                onClick={hasGenerated ? handleCopyGeneratedPrompt : handleGeneratePrompt}
                disabled={isGenerating || (!generateFormData.description && !hasGenerated)}
                data-testid="button-confirm-generate"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : hasGenerated ? (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy to Clipboard
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Skill
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Skill" : "Create New Skill"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the details of this skill"
                : "Add a reusable skill to your library"}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[600px] pr-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g., User Story Template"
                  data-testid="input-prompt-title"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="description">Description</Label>
                  <AiEnhance
                    value={formData.description}
                    onEnhanced={(text) => setFormData({ ...formData, description: text })}
                    locationKey="hub.description"
                    placeholderExtraPrompt="e.g., make it more concise, target product managers..."
                  />
                </div>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of what this skill does"
                  rows={2}
                  data-testid="input-prompt-description"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="content">Skill Content</Label>
                  <AiEnhance
                    value={formData.content}
                    onEnhanced={(text) => setFormData({ ...formData, content: text })}
                    locationKey="hub.content"
                    placeholderExtraPrompt="e.g., add structured sections, include examples, tighten the wording..."
                  />
                </div>
                <Textarea
                  id="content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="Enter your skill template here..."
                  rows={10}
                  className="font-mono"
                  data-testid="input-prompt-content"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="e.g., Requirements, Development"
                  data-testid="input-prompt-category"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-prompt"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {isEditing ? "Update Skill" : "Save Skill"}
                </Button>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Skill</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{promptToDelete?.title}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => promptToDelete && deleteMutation.mutate(promptToDelete.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete Skill
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
