import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Cloud,
  Settings,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Save,
} from "lucide-react";
import type { Epic, Feature, UserStory, Persona } from "@shared/schema";
import toast from "react-hot-toast";
import { getApiUrl } from "@/lib/api-config";
import { pollAsyncJob } from "@/lib/async-job-poller";

interface DevOpsPushModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  epics: Epic[];
  features: Feature[];
  userStories: UserStory[];
  personas?: Persona[];
  artifactId?: string | null;
  selectedItems?: Set<string>;
  initialSelectedEpics?: Iterable<string>;
  initialSelectedFeatures?: Iterable<string>;
  initialSelectedStories?: Iterable<string>;
  lockedEpics?: Iterable<string>;
  lockedFeatures?: Iterable<string>;
  lockedStories?: Iterable<string>;
  onSuccess?: () => void;
  projectId?: string;
  adoOrganization?: string | null;
  adoOrganizationDisplay?: string | null;
  adoProjectName?: string | null;
  integrationType?: string;
}

export function DevOpsPushModal({
  open,
  onOpenChange,
  epics,
  features,
  userStories,
  personas = [],
  artifactId,
  selectedItems: initialSelectedItems,
  initialSelectedEpics,
  initialSelectedFeatures,
  initialSelectedStories,
  lockedEpics,
  lockedFeatures,
  lockedStories,
  onSuccess,
  projectId,
  adoOrganization,
  adoOrganizationDisplay,
  adoProjectName,
  integrationType = "ado",
}: DevOpsPushModalProps) {
  const isJira = integrationType === "jira";
  const providerName = isJira ? "Jira" : "Azure DevOps";
  const providerShort = isJira ? "Jira" : "ADO";
  const [configOpen, setConfigOpen] = useState(!isJira);
  const [isPushing, setIsPushing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [pushProgress, setPushProgress] = useState(0);
  const [pushProgressMessage, setPushProgressMessage] = useState("");
  
  const createSet = (input?: Iterable<string>, fallback?: Iterable<string>) =>
    new Set(input ? Array.from(input) : fallback ? Array.from(fallback) : []);

  const lockedEpicSet = createSet(lockedEpics);
  const lockedFeatureSet = createSet(lockedFeatures);
  const lockedStorySet = createSet(lockedStories);
  const fallbackSelection = initialSelectedItems ? Array.from(initialSelectedItems) : [];

  // Azure DevOps Configuration
  const [organization, setOrganization] = useState("");
  const [project, setProject] = useState("");
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [pat, setPat] = useState("");

  // Local selection state
  const [selectedEpics, setSelectedEpics] = useState<Set<string>>(
    createSet(initialSelectedEpics, fallbackSelection)
  );
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(
    createSet(initialSelectedFeatures, fallbackSelection)
  );
  const [selectedStories, setSelectedStories] = useState<Set<string>>(
    createSet(initialSelectedStories, fallbackSelection)
  );

  useEffect(() => {
    setSelectedEpics(createSet(initialSelectedEpics, fallbackSelection));
  }, [initialSelectedEpics, initialSelectedItems]);

  useEffect(() => {
    setSelectedFeatures(createSet(initialSelectedFeatures, fallbackSelection));
  }, [initialSelectedFeatures, initialSelectedItems]);

  useEffect(() => {
    setSelectedStories(createSet(initialSelectedStories, fallbackSelection));
  }, [initialSelectedStories, initialSelectedItems]);

  const totalSelected = selectedEpics.size + selectedFeatures.size + selectedStories.size;

  // Fetch ADO config when modal opens, and prefer values from the currently selected ADO project.
  // IMPORTANT: always run when the selected project/org changes so we don't keep stale values
  // from the previous project.
  useEffect(() => {
    if (!open || !projectId) return;

    const fetchAdoConfig = async () => {
      try {
        const params = new URLSearchParams();
        if (adoOrganization) {
          params.append("organization", adoOrganization);
        }
        if (adoProjectName) {
          params.append("projectName", adoProjectName);
        }

        const url = `/api/sdlc/projects/${projectId}/ado-config${
          params.toString() ? `?${params.toString()}` : ""
        }`;

        const response = await fetch(url);
        if (response.ok) {
          const config = await response.json();

          // Prefer values from the selected ADO project, fall back to server config
          const displayOrg =
            adoOrganizationDisplay || adoOrganization || config.organization || "";
          setOrganization(displayOrg);
          setProject(adoProjectName || config.project || "");
        } else {
          // Even if the API fails, still prepopulate from selected ADO project if available
          if (adoOrganizationDisplay || adoOrganization) {
            setOrganization(adoOrganizationDisplay || adoOrganization || "");
          } else {
            setOrganization("");
          }
          if (adoProjectName) {
            setProject(adoProjectName);
          } else {
            setProject("");
          }
        }
      } catch (error) {
        console.log("Could not fetch ADO config (non-critical):", error);
        if (adoOrganizationDisplay || adoOrganization) {
          setOrganization(adoOrganizationDisplay || adoOrganization || "");
        } else {
          setOrganization("");
        }
        if (adoProjectName) {
          setProject(adoProjectName);
        } else {
          setProject("");
        }
      }
    };

    fetchAdoConfig();
  }, [open, projectId, adoOrganization, adoOrganizationDisplay, adoProjectName]);

  const toggleEpic = (id: string) => {
    if (lockedEpicSet.has(id)) return;
    const newSet = new Set(selectedEpics);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedEpics(newSet);
  };

  const toggleFeature = (id: string) => {
    if (lockedFeatureSet.has(id)) return;
    const newSet = new Set(selectedFeatures);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedFeatures(newSet);
  };

  const toggleStory = (id: string) => {
    if (lockedStorySet.has(id)) return;
    const newSet = new Set(selectedStories);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedStories(newSet);
  };

  const selectAll = () => {
    setSelectedEpics(new Set(epics.map((e) => e.id)));
    setSelectedFeatures(new Set(features.map((f) => f.id)));
    setSelectedStories(new Set(userStories.map((s) => s.id)));
  };

  const deselectAll = () => {
    setSelectedEpics(new Set(lockedEpicSet));
    setSelectedFeatures(new Set(lockedFeatureSet));
    setSelectedStories(new Set(lockedStorySet));
  };

  const handleSaveArtifacts = async () => {
    if (artifactId) {
      toast.success("Artifacts already saved!");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(getApiUrl("/api/workflow/save-artifacts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          epics,
          features,
          userStories,
          personas,
          requirement: "", // Add if available
          guidelines: "", // Add if available
        }),
      });

      if (!response.ok) throw new Error("Failed to save artifacts");

      const data = await response.json();
      toast.success("Artifacts saved successfully!");
      onSuccess?.();
    } catch (error) {
      console.error("Save artifacts error:", error);
      toast.error("Failed to save artifacts. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePush = async () => {
    if (totalSelected === 0) {
      toast.error("Please select at least one item to push");
      return;
    }

    if (!projectId) {
      toast.error("Project ID is required");
      return;
    }

    setIsPushing(true);
    setPushSuccess(false);
    setPushProgress(0);
    setPushProgressMessage(`Preparing ${providerName} push...`);

    try {
      // When a user story is selected, automatically include its parent feature and epic
      // When a feature is selected, automatically include its parent epic
      // This ensures hierarchical integrity in Azure DevOps
      
      const epicsToCreate = new Set(selectedEpics);
      const featuresToCreate = new Set(selectedFeatures);
      const storiesToCreate = new Set(selectedStories);

      // For each selected story, ensure its parent feature and epic are included
      for (const storyId of storiesToCreate) {
        const story = userStories.find((s: UserStory) => s.id === storyId);
        if (story && story.featureId) {
          featuresToCreate.add(story.featureId);
          // Also add the feature's parent epic
          const feature = features.find((f: Feature) => f.id === story.featureId);
          if (feature && feature.epicId) {
            epicsToCreate.add(feature.epicId);
          }
        }
      }

      // For each selected feature, ensure its parent epic is included
      for (const featureId of featuresToCreate) {
        const feature = features.find((f: Feature) => f.id === featureId);
        if (feature && feature.epicId) {
          epicsToCreate.add(feature.epicId);
        }
      }

      // Build selected items array with auto-included parents
      const selectedItemsArray = [
        ...Array.from(epicsToCreate).map((id) => ({ type: "epic", id })),
        ...Array.from(featuresToCreate).map((id) => ({ type: "feature", id })),
        ...Array.from(storiesToCreate).map((id) => ({ type: "story", id })),
      ];

      // Log what's being pushed
      const userSelected = {
        epics: selectedEpics.size,
        features: selectedFeatures.size,
        stories: selectedStories.size,
      };
      const actualPushing = {
        epics: epicsToCreate.size,
        features: featuresToCreate.size,
        stories: storiesToCreate.size,
      };

      console.log("[Push to ADO] User selected:", userSelected);
      console.log("[Push to ADO] Actually pushing (with parents):", actualPushing);

      // Show info if parents were auto-included
      if (epicsToCreate.size > selectedEpics.size || featuresToCreate.size > selectedFeatures.size) {
        toast.success(
          `Including parent items to maintain hierarchy: ${epicsToCreate.size} epics, ${featuresToCreate.size} features, ${storiesToCreate.size} stories`,
          { duration: 4000 }
        );
      }

      // Fetch brdId from workflow artifact if available
      let brdId = null;
      if (artifactId) {
        try {
          const artifactResponse = await fetch(
            getApiUrl(`/api/workflow/artifacts/${artifactId}`),
            {
              method: "GET",
              credentials: "include",
            }
          );
          if (artifactResponse.ok) {
            const artifactData = await artifactResponse.json();
            const artifact = artifactData.artifact || artifactData;
            brdId = artifact.brdId || null;
          }
        } catch (error) {
          console.warn("[Push to ADO] Failed to fetch brdId from artifact:", error);
        }
      }

      // Use the SDLC endpoint for pushing SDLC artifacts
      // Filter arrays to ONLY include selected items (and auto-included parents)
      const requestBody: any = {
        epics: epics.filter((e: Epic) => epicsToCreate.has(e.id)),
        features: features.filter((f: Feature) => featuresToCreate.has(f.id)),
        userStories: userStories.filter((s: UserStory) => storiesToCreate.has(s.id)),
        selectedItems: selectedItemsArray,
        phaseNumber: 3, // Push to Azure is typically step 3
        artifactId: artifactId || undefined,
        brdId: brdId,
      };

      // Include Azure DevOps config if user provided it
      if (organization && project) {
        requestBody.config = {
          organization: organization.trim(),
          project: project.trim(),
          pat: pat && pat.trim() ? pat.trim() : undefined, // Optional
        };
      }

      const pushEndpoint = isJira
        ? `/api/sdlc/projects/${projectId}/push-to-jira`
        : `/api/sdlc/projects/${projectId}/push-to-ado`;
      const response = await fetch(getApiUrl(pushEndpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to push to ${providerName}`);
      }

      let result = await response.json();

      // Async-job pattern: server returns 202 + jobId immediately to avoid
      // AWS API Gateway's 29s timeout (which surfaces as 503 Service
      // Unavailable). Poll until the job completes, then use its result.
      if (response.status === 202 && result?.jobId) {
        const namespace = isJira ? "sdlc-push-to-jira" : "sdlc-push-to-ado";
        result = await pollAsyncJob<typeof result>(namespace, result.jobId, {
          onProgress: (message, percent) => {
            if (message) {
              setPushProgressMessage(message);
              toast.loading(message, { id: "push-progress" });
            }
            if (percent !== undefined) {
              setPushProgress(percent);
            }
          },
        });
        setPushProgress(100);
        setPushProgressMessage(`Finished pushing to ${providerName}.`);
        toast.dismiss("push-progress");
      }

      const createdCount = typeof result.created === 'number'
        ? result.created
        : (result.createdItems?.length || 0);
      const skippedCount = typeof result.skipped === 'number'
        ? result.skipped
        : (result.skippedItems?.length || 0);
      const failedCount = typeof result.failed === 'number'
        ? result.failed
        : (result.failedItems?.length || 0);
      const hasAnyResult = createdCount > 0 || skippedCount > 0;

      if (result.success || hasAnyResult) {
        setPushSuccess(true);
        const wikiPagesCount = result.wikiPagesCreated || 0;
        
        // Show warnings for skipped items with missing parents
        const skippedWithMissingParents = (result.skippedItems || []).filter(
          (item: any) => item.reason === 'missing_parent_epic' || item.reason === 'missing_parent_feature'
        );

        if (skippedWithMissingParents.length > 0) {
          const warningMsg = `${skippedWithMissingParents.length} item(s) were skipped because their parent items don't exist in ${providerName}. Please push parent items first.`;
          toast.error(warningMsg, { duration: 8000 });
          
          console.log('[Push] Skipped items:', skippedWithMissingParents.map((i: any) => ({
            type: i.type,
            title: i.title,
            reason: i.reason,
            parentEpicId: i.parentEpicId,
            parentFeatureId: i.parentFeatureId
          })));
        }

        if (failedCount > 0) {
          toast.error(`${failedCount} item(s) failed due to Jira server errors. The rest were pushed successfully.`, { duration: 8000 });
          console.error('[Push] Failed items:', result.failedItems);
        }
        
        const successMsg = [];
        if (createdCount > 0) {
          successMsg.push(`${createdCount} work item${createdCount > 1 ? 's' : ''} created`);
        }
        if (skippedCount > 0) {
          const alreadyExistCount = (result.skippedItems || []).filter((i: any) => i.reason === 'already_exists').length;
          if (alreadyExistCount > 0) {
            successMsg.push(`${alreadyExistCount} already existed`);
          }
        }
        if (wikiPagesCount > 0) {
          successMsg.push(`${wikiPagesCount} wiki page${wikiPagesCount > 1 ? 's' : ''}`);
        }
        
        if (successMsg.length > 0) {
          toast.success(
            result.message || `Successfully pushed to ${providerName}: ${successMsg.join(', ')}`,
            { duration: 5000 }
          );
        }

        if (result.browseUrls?.length > 0) {
          console.log(`[Push] Browse URLs (first 5):`, result.browseUrls.slice(0, 5));
        }
        
        setTimeout(() => onSuccess?.(), 800);
      } else {
        throw new Error(result.message || result.error || "Push failed");
      }
    } catch (error) {
      console.error(`Error pushing to ${providerName}:`, error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : `Failed to push to ${providerName}. Please try again.`;
      toast.error(errorMessage, { duration: 5000 });
    } finally {
      setIsPushing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[90vw] h-[85vh] p-0 flex flex-col">
        {/* Workflow-style Header */}
        <div className="px-6 pt-6 pb-4 border-b bg-gradient-to-r from-blue-600/10 to-purple-600/10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold">Hybrid SDLC Workflow</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Push your artifacts to {providerName}
              </p>
            </div>
          </div>
          
          {/* Step Indicator */}
          <div className="flex items-center gap-2 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-white" />
              </div>
              <span className="text-sm font-medium">Step 1: Requirements</span>
            </div>
            <div className="flex-1 h-0.5 bg-green-500"></div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-white" />
              </div>
              <span className="text-sm font-medium">Step 2: Generated Content</span>
            </div>
            <div className="flex-1 h-0.5 bg-green-500"></div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-white font-bold text-sm">3</span>
              </div>
              <span className="text-sm font-medium text-blue-500">Step 3: DevOps Push</span>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 px-6">
          <div className="space-y-6 py-4">
            {isPushing && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    <span className="truncate">
                      {pushProgressMessage || `Pushing to ${providerName}...`}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-primary">{pushProgress}%</span>
                </div>
                <Progress value={pushProgress} className="h-2" />
              </div>
            )}

            {/* Azure DevOps Configuration */}
            <Collapsible open={configOpen} onOpenChange={setConfigOpen}>
              <Card>
                <CardHeader className="pb-3">
                  <CollapsibleTrigger className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Settings className="h-5 w-5" />
                      <h3 className="text-lg font-semibold">{providerName} Configuration</h3>
                    </div>
                    {configOpen ? (
                      <ChevronUp className="h-5 w-5" />
                    ) : (
                      <ChevronDown className="h-5 w-5" />
                    )}
                  </CollapsibleTrigger>
                </CardHeader>
                <CollapsibleContent>
                  <div className="px-6 pb-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="organization">Organization</Label>
                        <Input
                          id="organization"
                          placeholder="your-org"
                          value={organization}
                          onChange={(e) => setOrganization(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="project">Project</Label>
                        <Input
                          id="project"
                          placeholder="your-project"
                          value={project}
                          onChange={(e) => setProject(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="repository">Repository</Label>
                        <Input
                          id="repository"
                          placeholder="your-repo"
                          value={repository}
                          onChange={(e) => setRepository(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="branch">Branch</Label>
                        <Input
                          id="branch"
                          placeholder="main"
                          value={branch}
                          onChange={(e) => setBranch(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="pat">
                        Personal Access Token (PAT)
                        {projectId && (
                          <span className="text-xs text-muted-foreground ml-2">
                            (Optional - will use PAT from Settings if not provided)
                          </span>
                        )}
                      </Label>
                      <Input
                        id="pat"
                        type="password"
                        placeholder={projectId ? "Leave empty to use token from Settings" : `Enter your ${providerName} token`}
                        value={pat}
                        onChange={(e) => setPat(e.target.value)}
                      />
                    </div>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Select Items to Push */}
            <Card>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Select Items to Push</h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={selectAll}>
                      Select All
                    </Button>
                    <Button size="sm" variant="outline" onClick={deselectAll}>
                      Deselect All
                    </Button>
                  </div>
                </div>

                <div className="flex gap-3 mb-4">
                  <Badge variant="secondary">
                    {selectedEpics.size} Epics
                  </Badge>
                  <Badge variant="secondary">
                    {selectedFeatures.size} Features
                  </Badge>
                  <Badge variant="secondary">
                    {selectedStories.size} Stories
                  </Badge>
                  <Badge className="bg-primary">Total: {totalSelected}</Badge>
                </div>

                <ScrollArea className="h-[300px] pr-4">
                  <div className="space-y-4">
                    {/* Epics */}
                    {epics.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Epics</h4>
                        <div className="space-y-2">
                          {epics.map((epic) => {
                            const alreadyPushed = (epic as any).adoWorkItemId || (epic as any).jiraIssueId;
                            return (
                              <div
                                key={epic.id}
                                className="flex items-start gap-3 p-3 rounded-lg border"
                              >
                                <Checkbox
                                  checked={selectedEpics.has(epic.id)}
                                  onCheckedChange={() => toggleEpic(epic.id)}
                                  className="mt-1"
                                  disabled={lockedEpicSet.has(epic.id)}
                                />
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium">{epic.title}</p>
                                    {alreadyPushed && (
                                      <Badge variant="outline" className="text-xs border-blue-500 text-blue-500">
                                        In {providerShort} #{alreadyPushed}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-sm text-muted-foreground line-clamp-2">
                                    {epic.description}
                                  </p>
                                  <Badge className="mt-2 bg-purple-500 text-white">
                                    {epic.priority || "Medium"}
                                  </Badge>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Features */}
                    {features.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Features</h4>
                        <div className="space-y-2">
                          {features.map((feature) => {
                            const alreadyPushed = (feature as any).adoWorkItemId || (feature as any).jiraIssueId;
                            return (
                              <div
                                key={feature.id}
                                className="flex items-start gap-3 p-3 rounded-lg border"
                              >
                                <Checkbox
                                  checked={selectedFeatures.has(feature.id)}
                                  onCheckedChange={() => toggleFeature(feature.id)}
                                  className="mt-1"
                                  disabled={lockedFeatureSet.has(feature.id)}
                                />
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium">{feature.title}</p>
                                    {alreadyPushed && (
                                      <Badge variant="outline" className="text-xs border-blue-500 text-blue-500">
                                        In {providerShort} #{alreadyPushed}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-sm text-muted-foreground line-clamp-2">
                                    {feature.description}
                                  </p>
                                  <div className="flex gap-2 mt-2">
                                    <Badge className="bg-blue-500 text-white">
                                      {feature.priority || "Medium"}
                                    </Badge>
                                    {feature.epicId && (
                                      <Badge variant="outline">Epic: {feature.epicId}</Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* User Stories */}
                    {userStories.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">User Stories</h4>
                        <div className="space-y-2">
                          {userStories.map((story) => {
                            const alreadyPushed = (story as any).adoWorkItemId || (story as any).jiraIssueId;
                            return (
                              <div
                                key={story.id}
                                className="flex items-start gap-3 p-3 rounded-lg border"
                              >
                                <Checkbox
                                  checked={selectedStories.has(story.id)}
                                  onCheckedChange={() => toggleStory(story.id)}
                                  className="mt-1"
                                  disabled={lockedStorySet.has(story.id)}
                                />
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium">{story.title}</p>
                                    {alreadyPushed && (
                                      <Badge variant="outline" className="text-xs border-blue-500 text-blue-500">
                                        In {providerShort} #{alreadyPushed}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-sm text-muted-foreground line-clamp-2">
                                    {story.description}
                                  </p>
                                  <div className="flex gap-2 mt-2">
                                    <Badge className="bg-green-500 text-white">
                                      {story.priority || "Medium"}
                                    </Badge>
                                    {story.storyPoints && (
                                      <Badge variant="outline">{story.storyPoints} pts</Badge>
                                    )}
                                    {story.persona && (
                                      <Badge variant="outline">{story.persona}</Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </Card>
          </div>
        </ScrollArea>

        {/* Footer Actions */}
        <div className="border-t p-6 flex justify-between">
          <Button
            variant="outline"
            onClick={handleSaveArtifacts}
            disabled={isSaving || !!artifactId}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Artifacts
              </>
            )}
          </Button>

          <Button
            onClick={handlePush}
            disabled={isPushing || totalSelected === 0}
            className="bg-orange-600 hover:bg-orange-700"
          >
            {isPushing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Pushing...
              </>
            ) : pushSuccess ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Pushed Successfully
              </>
            ) : (
              <>
                <Cloud className="h-4 w-4 mr-2" />
                Push to {providerName} ({totalSelected} items)
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
