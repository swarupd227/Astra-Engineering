import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  ChevronRight,
  ChevronDown,
  FolderTree,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  EpicNode,
  FeatureNode,
  SpecsArchitectureStyle,
  SpecsDeliveryOrder,
  UserStoryNode,
} from "./types";

export interface ArtifactsPanelProps {
  epicNodes: EpicNode[];
  featureNodes: FeatureNode[];
  orphanUserStories: UserStoryNode[];
  filteredFeatureNodes: FeatureNode[];
  filteredOrphanUserStories: UserStoryNode[];
  selectedFeatureIds: Set<number>;
  selectedStoryIds: Set<number>;
  expandedFeatures: Set<number>;
  setExpandedFeatures: React.Dispatch<React.SetStateAction<Set<number>>>;
  generatedFeatureIds: Set<number>;
  pushedFeatureIds: Set<number>;
  isLoading: boolean;
  isGenerating: boolean;
  isValidating: boolean;
  enableTdd: boolean;
  setEnableTdd: (v: boolean) => void;
  specsArchitectureStyle: SpecsArchitectureStyle | null;
  setSpecsArchitectureStyle: (v: SpecsArchitectureStyle | null) => void;
  specsDeliveryOrder: SpecsDeliveryOrder | null;
  setSpecsDeliveryOrder: (v: SpecsDeliveryOrder | null) => void;
  specsProgress: number | null;
  specsTotalFeatures: number;
  specsProcessedFeatures: number;
  specsCurrentStep: string;
  selectedAll: boolean;
  artifactSearchQuery: string;
  setArtifactSearchQuery: (v: string) => void;
  selectedIterationPath: string;
  setSelectedIterationPath: (v: string) => void;
  artifactGeneratedFilter: "all" | "generated" | "not-generated";
  setArtifactGeneratedFilter: (v: "all" | "generated" | "not-generated") => void;
  iterationsData: Array<{ id: string; name: string; path: string }>;
  specsPollingTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  projectId: string;
  setIsGenerating: (v: boolean) => void;
  setSpecsJobId: (v: string | null) => void;
  setSpecsProgress: (v: number | null) => void;
  setSpecsProcessedFeatures: (v: number) => void;
  setSpecsTotalFeatures: (v: number) => void;
  setSpecsCurrentStep: (v: string) => void;
  handleToggleEpic: (features: FeatureNode[]) => void;
  handleToggleFeature: (featureId: number) => void;
  handleToggleStory: (featureId: number, storyId: number) => void;
  handleSelectAll: () => void;
  handleDeselectAll: () => void;
  handleGenerate: () => void;
  clearSpecsJob: (projectId: string) => void;
  toast: (opts: { title: string; description?: string; variant?: "destructive" | "default" }) => void;
  setSelectedStoryIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  integrationType?: string;
}

export function ArtifactsPanel({
  epicNodes,
  featureNodes,
  orphanUserStories,
  filteredFeatureNodes,
  filteredOrphanUserStories,
  selectedFeatureIds,
  selectedStoryIds,
  expandedFeatures,
  setExpandedFeatures,
  generatedFeatureIds,
  pushedFeatureIds,
  isLoading,
  isGenerating,
  isValidating,
  enableTdd,
  setEnableTdd,
  specsArchitectureStyle,
  setSpecsArchitectureStyle,
  specsDeliveryOrder,
  setSpecsDeliveryOrder,
  specsProgress,
  specsTotalFeatures,
  specsProcessedFeatures,
  specsCurrentStep,
  selectedAll,
  artifactSearchQuery,
  setArtifactSearchQuery,
  selectedIterationPath,
  setSelectedIterationPath,
  artifactGeneratedFilter,
  setArtifactGeneratedFilter,
  iterationsData,
  specsPollingTimeoutRef,
  projectId,
  setIsGenerating,
  setSpecsJobId,
  setSpecsProgress,
  setSpecsProcessedFeatures,
  setSpecsTotalFeatures,
  setSpecsCurrentStep,
  handleToggleEpic,
  handleToggleFeature,
  handleToggleStory,
  handleSelectAll,
  handleDeselectAll,
  handleGenerate,
  clearSpecsJob,
  toast,
  setSelectedStoryIds,
  integrationType,
}: ArtifactsPanelProps) {
  const [isEditingArchitecture, setIsEditingArchitecture] = useState(false);
  const [expandedEpics, setExpandedEpics] = useState<Set<number>>(() => new Set());

  const filteredFeaturesByEpicId = useMemo(() => {
    const grouped = new Map<number, FeatureNode[]>();
    for (const feature of filteredFeatureNodes) {
      if (!feature.parentEpicId) continue;
      const features = grouped.get(feature.parentEpicId) ?? [];
      features.push(feature);
      grouped.set(feature.parentEpicId, features);
    }
    return grouped;
  }, [filteredFeatureNodes]);

  const artifactSearchText = artifactSearchQuery.trim().toLowerCase();
  const filteredEpicNodes = useMemo(
    () =>
      epicNodes.filter(
        (epic) =>
          (artifactSearchText && epic.title.toLowerCase().includes(artifactSearchText)) ||
          filteredFeaturesByEpicId.has(epic.id) ||
          (!artifactSearchText &&
            epic.childFeatureIds.some((id) =>
              filteredFeatureNodes.some((feature) => feature.id === id),
            )),
      ),
    [artifactSearchText, epicNodes, filteredFeatureNodes, filteredFeaturesByEpicId],
  );

  const unparentedFeatureNodes = useMemo(
    () => filteredFeatureNodes.filter((feature) => !feature.parentEpicId),
    [filteredFeatureNodes],
  );

  const hasEpicHierarchy = filteredEpicNodes.length > 0;
  const allEpicsExpanded =
    hasEpicHierarchy && filteredEpicNodes.every((epic) => expandedEpics.has(epic.id));

  const toggleEpic = (epicId: number) => {
    setExpandedEpics((previous) => {
      const next = new Set(previous);
      if (next.has(epicId)) next.delete(epicId);
      else next.add(epicId);
      return next;
    });
  };

  const getEpicFeatures = (epic: EpicNode) => {
    const epicTitleMatches =
      !!artifactSearchText && epic.title.toLowerCase().includes(artifactSearchText);
    if (!epicTitleMatches) return filteredFeaturesByEpicId.get(epic.id) ?? [];
    return featureNodes.filter((feature) => feature.parentEpicId === epic.id);
  };

  const getEpicSelectionState = (features: FeatureNode[]): boolean | "indeterminate" => {
    if (features.length === 0) return false;
    const featureIds = features.map((feature) => feature.id);
    const storyIds = features.flatMap((feature) => feature.userStories.map((story) => story.id));
    const selectedCount =
      featureIds.filter((id) => selectedFeatureIds.has(id)).length +
      storyIds.filter((id) => selectedStoryIds.has(id)).length;
    const selectableCount = featureIds.length + storyIds.length;
    if (selectedCount === 0) return false;
    if (selectedCount === selectableCount) return true;
    return "indeterminate";
  };

  const needsArchitectureSelection =
    specsArchitectureStyle == null ||
    (specsArchitectureStyle === "microservices" && !specsDeliveryOrder);

  const renderFeatureRow = (feature: FeatureNode) => {
    const isSelected = selectedFeatureIds.has(feature.id);
    const isExpanded = expandedFeatures.has(feature.id);
    const storyCount = feature.userStories.length;
    const isGenerated = generatedFeatureIds.has(feature.id);
    const isPushed = pushedFeatureIds.has(feature.id);
    const isUnpushed = isGenerated && !isPushed;

    const childIds = feature.userStories.map((s) => s.id);
    const selectedChildCount = childIds.filter((id) => selectedStoryIds.has(id)).length;
    const allChildrenSelected = childIds.length > 0 && selectedChildCount === childIds.length;
    const someChildrenSelected = selectedChildCount > 0 && !allChildrenSelected;
    const checkState: boolean | "indeterminate" =
      allChildrenSelected || (isSelected && childIds.length === 0)
        ? true
        : someChildrenSelected
          ? "indeterminate"
          : false;

    return (
      <div key={feature.id} className="space-y-0.5">
        <div
          className={cn(
            "flex items-center gap-2.5 pl-2 pr-3 py-2 rounded-lg border border-transparent hover:border-border hover:bg-accent/50 transition-all cursor-pointer group min-w-0 overflow-hidden",
            (isSelected || someChildrenSelected) &&
              !isUnpushed && "bg-blue-500/10 border-blue-500/30",
            isUnpushed &&
              "bg-emerald-500/10 border-l-[3px] border-l-emerald-500",
          )}
          onClick={() => handleToggleFeature(feature.id)}
        >
          <Checkbox
            checked={checkState}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleFeature(feature.id);
            }}
            className="h-4 w-4 flex-shrink-0"
          />
          {storyCount > 0 ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 p-0 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                setExpandedFeatures((prev) => {
                  const next = new Set(prev);
                  if (next.has(feature.id)) {
                    next.delete(feature.id);
                  } else {
                    next.add(feature.id);
                  }
                  return next;
                });
              }}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </Button>
          ) : (
            <div className="w-5 flex-shrink-0" />
          )}
          <Badge className="bg-blue-500 text-white text-[10px] px-1.5 py-0 flex-shrink-0">
            F
          </Badge>
          <Badge
            variant="secondary"
            className="text-[10px] capitalize flex-shrink-0"
          >
            {feature.state || "planned"}
          </Badge>
          <div className="w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">
              {feature.title}
              {isGenerated && (
                <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide align-middle">
                  Generated
                </span>
              )}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {storyCount} user stor
              {storyCount === 1 ? "y" : "ies"}
            </p>
          </div>
        </div>

        {isExpanded && storyCount > 0 && (
          <div className="space-y-0.5 ml-6 border-l border-border/50 pl-2">
            {feature.userStories.map((story) => {
              return (
                <div
                  key={story.id}
                  className={cn(
                    "flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-lg border border-transparent hover:border-border hover:bg-accent/50 transition-all cursor-pointer group min-w-0 overflow-hidden",
                    selectedStoryIds.has(story.id) &&
                      "bg-green-500/10 border-green-500/30",
                  )}
                >
                  <Checkbox
                    checked={selectedStoryIds.has(story.id)}
                    onCheckedChange={() =>
                      handleToggleStory(feature.id, story.id)
                    }
                    className="h-4 w-4 flex-shrink-0"
                    aria-label="Toggle user story selection"
                  />
                  <Badge className="bg-green-500 text-white text-[10px] px-1.5 py-0 flex-shrink-0">
                    U
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="text-[10px] capitalize flex-shrink-0"
                  >
                    {story.state || "planned"}
                  </Badge>
                  <div className="w-0 flex-1">
                    <p className="text-xs sm:text-sm font-medium text-foreground truncate">
                      {story.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {story.storyPoints != null &&
                        `${story.storyPoints} pts`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="h-full overflow-hidden flex flex-col min-w-0">
      <CardHeader className="pb-3 flex-shrink-0 min-w-0 overflow-hidden">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 min-w-0">
            <FolderTree className="h-4 w-4 text-muted-foreground" />
            Artifacts
          </span>
          <div className="flex items-center gap-3">
            {needsArchitectureSelection || isEditingArchitecture ? (
              <div className="flex items-center gap-2">
                <Select
                  value={specsArchitectureStyle ?? undefined}
                  onValueChange={(v) => {
                    const next = v === "microservices" ? "microservices" : "monolith";
                    setSpecsArchitectureStyle(next);
                    if (next === "monolith") {
                      setSpecsDeliveryOrder(null);
                    }
                  }}
                >
                  <SelectTrigger className="h-7 w-[140px] text-xs">
                    <SelectValue placeholder="Architecture" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monolith">Monolithic</SelectItem>
                    <SelectItem value="microservices">Microservice</SelectItem>
                  </SelectContent>
                </Select>
                {specsArchitectureStyle === "microservices" && (
                  <Select
                    value={specsDeliveryOrder ?? undefined}
                    onValueChange={(v) =>
                      setSpecsDeliveryOrder(v === "api-first" ? "api-first" : "ui-first")
                    }
                  >
                    <SelectTrigger className="h-7 w-[120px] text-xs">
                      <SelectValue placeholder="Delivery" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ui-first">UI-first</SelectItem>
                      <SelectItem value="api-first">API-first</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {!needsArchitectureSelection && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setIsEditingArchitecture(false)}
                  >
                    Done
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="h-6 text-[11px]">
                  {specsArchitectureStyle === "microservices" ? "Microservice" : "Monolithic"}
                </Badge>
                {specsArchitectureStyle === "microservices" && specsDeliveryOrder && (
                  <Badge variant="secondary" className="h-6 text-[11px]">
                    {specsDeliveryOrder === "api-first" ? "API-first" : "UI-first"}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setIsEditingArchitecture(true)}
                >
                  Edit
                </Button>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Switch
                id="enable-tdd"
                checked={enableTdd}
                onCheckedChange={setEnableTdd}
                disabled={isLoading || isGenerating}
              />
              <Label
                htmlFor="enable-tdd"
                className="text-xs cursor-pointer whitespace-nowrap"
              >
                TDD
              </Label>
            </div>
            {isGenerating ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs gap-1.5"
                onClick={() => {
                  if (specsPollingTimeoutRef.current) {
                    clearTimeout(specsPollingTimeoutRef.current);
                    specsPollingTimeoutRef.current = null;
                  }
                  clearSpecsJob(projectId);
                  setIsGenerating(false);
                  setSpecsJobId(null);
                  setSpecsProgress(null);
                  setSpecsProcessedFeatures(0);
                  setSpecsTotalFeatures(0);
                  setSpecsCurrentStep("");
                  toast({
                    title: "Generation cancelled",
                    description: "Specs generation was cancelled. Already generated files are kept.",
                  });
                }}
              >
                <X className="h-3 w-3" />
                Cancel
                {specsTotalFeatures > 0 && (
                  <span className="opacity-75">
                    {typeof specsProgress === "number"
                      ? ` ${specsProgress.toFixed(0)}%`
                      : ""}
                    {` · ${specsProcessedFeatures}/${specsTotalFeatures}`}
                  </span>
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  void handleGenerate();
                }}
                disabled={
                  isValidating ||
                  isLoading ||
                  (featureNodes.length === 0 && orphanUserStories.length === 0) ||
                  (selectedFeatureIds.size === 0 && selectedStoryIds.size === 0)
                }
              >
                {isValidating ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                    Validating...
                  </>
                ) : "Generate"}
              </Button>
            )}
          </div>
        </CardTitle>
        {isGenerating && (
          <div className="mt-2 space-y-1.5 animate-in fade-in duration-300">
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                style={{ width: `${specsProgress ?? 5}%` }}
              />
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
              <span className="truncate">
                {specsCurrentStep || "Initializing specs generation..."}
              </span>
            </div>
          </div>
        )}
        <div className="space-y-3 pt-2 w-full min-w-0">
          {/* Stats row */}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {epicNodes.length > 0 ? `${epicNodes.length} epics · ` : ""}
              {featureNodes.length} features ·{" "}
              {featureNodes.reduce(
                (sum, f) => sum + f.userStories.length,
                0,
              ) + orphanUserStories.length}{" "}
              stories
            </span>
            <span>
              <span className="font-medium text-foreground">
                {selectedFeatureIds.size}
              </span>{" "}
              F /{" "}
              <span className="font-medium text-foreground">
                {selectedStoryIds.size}
              </span>{" "}
              U selected ·{" "}
              <span className="font-medium text-foreground">
                {Array.from(generatedFeatureIds).length}
              </span>{" "}
              generated
            </span>
          </div>
          {/* Filters row: search + iteration + generated filter */}
          <div className="flex items-center gap-2 w-full min-w-0">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search artifacts..."
                value={artifactSearchQuery}
                onChange={(e) => setArtifactSearchQuery(e.target.value)}
                className="h-8 pl-7 pr-2 text-xs w-full"
              />
            </div>
            <Select
              value={selectedIterationPath || "__none__"}
              onValueChange={(v) =>
                setSelectedIterationPath(v === "__none__" ? "" : v)
              }
            >
              <SelectTrigger className="h-8 w-[160px] text-xs flex-shrink-0">
                <SelectValue placeholder="All iterations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs">
                  All iterations
                </SelectItem>
                {iterationsData.map((iter) => (
                  <SelectItem
                    key={iter.id}
                    value={iter.path}
                    className="text-xs"
                  >
                    {iter.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={artifactGeneratedFilter}
              onValueChange={(v) =>
                setArtifactGeneratedFilter(
                  v as "all" | "generated" | "not-generated",
                )
              }
            >
              <SelectTrigger className="h-8 w-[130px] text-xs flex-shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  All
                </SelectItem>
                <SelectItem value="generated" className="text-xs">
                  Generated
                </SelectItem>
                <SelectItem value="not-generated" className="text-xs">
                  Not generated
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <div className="mx-4 border-t border-border/60" />
      <CardContent className="pt-3 flex-1 min-h-0 flex flex-col overflow-hidden min-w-0">
        {filteredFeatureNodes.length === 0 &&
        filteredOrphanUserStories.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center space-y-3 py-6">
            <AlertCircle className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {featureNodes.length === 0 && orphanUserStories.length === 0
                ? selectedIterationPath
                  ? "No artifacts in this iteration. Select another iteration or No iteration to see all."
                  : integrationType === "jira"
                    ? "No work items found in the Jira backlog for this project."
                    : "No Features found in the Azure DevOps backlog for this project."
                : "No artifacts match your search or filter. Try a different term or show All."}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between pl-2 pr-3 py-1.5 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <Checkbox
                  id="select-all-artifacts"
                  checked={
                    selectedAll
                      ? true
                      : selectedFeatureIds.size > 0 || selectedStoryIds.size > 0
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={() => {
                    if (selectedAll) {
                      handleDeselectAll();
                    } else {
                      handleSelectAll();
                    }
                  }}
                  disabled={
                    featureNodes.length === 0 && orphanUserStories.length === 0
                  }
                  className="h-4 w-4"
                />
                <Label
                  htmlFor="select-all-artifacts"
                  className="text-xs text-muted-foreground cursor-pointer"
                >
                  {selectedAll ? "Deselect all" : "Select all"}
                </Label>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-muted-foreground gap-1"
                onClick={() => {
                  if (hasEpicHierarchy && allEpicsExpanded && expandedFeatures.size > 0) {
                    setExpandedEpics(new Set());
                    setExpandedFeatures(new Set());
                  } else if (!hasEpicHierarchy && expandedFeatures.size > 0) {
                    setExpandedFeatures(new Set());
                  } else {
                    if (hasEpicHierarchy) {
                      setExpandedEpics(new Set(filteredEpicNodes.map((epic) => epic.id)));
                    }
                    setExpandedFeatures(new Set(filteredFeatureNodes.map((f) => f.id)));
                  }
                }}
              >
                {(hasEpicHierarchy ? allEpicsExpanded && expandedFeatures.size > 0 : expandedFeatures.size > 0) ? (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    Collapse
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-3 w-3" />
                    Expand
                  </>
                )}
              </Button>
            </div>
            <ScrollArea className="flex-1 min-h-0 overflow-hidden">
              <div className="space-y-3 pt-0 pr-3 min-w-0 overflow-hidden">
                {hasEpicHierarchy ? (
                  <>
                    {filteredEpicNodes.map((epic) => {
                      const epicFeatures = getEpicFeatures(epic);
                      const epicStoryCount = epicFeatures.reduce(
                        (sum, feature) => sum + feature.userStories.length,
                        0,
                      );
                      const generatedEpicFeatureCount = epicFeatures.filter((feature) =>
                        generatedFeatureIds.has(feature.id),
                      ).length;
                      const isEpicGenerated =
                        epicFeatures.length > 0 &&
                        generatedEpicFeatureCount === epicFeatures.length;
                      const isEpicPartiallyGenerated =
                        generatedEpicFeatureCount > 0 && !isEpicGenerated;
                      const isExpanded = expandedEpics.has(epic.id);
                      const epicSelectionState = getEpicSelectionState(epicFeatures);
                      return (
                        <div key={epic.id} className="space-y-1">
                          <div
                            className={cn(
                              "flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/30 py-2 pl-2 pr-3 transition-all min-w-0 overflow-hidden",
                              isEpicGenerated &&
                                "bg-emerald-500/10 border-l-[3px] border-l-emerald-500",
                              isEpicPartiallyGenerated &&
                                !isEpicGenerated &&
                                "bg-emerald-500/5 border-l-[3px] border-l-emerald-400/70",
                            )}
                            onClick={() => toggleEpic(epic.id)}
                          >
                            <Checkbox
                              checked={epicSelectionState}
                              disabled={epicFeatures.length === 0}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleToggleEpic(epicFeatures);
                                if (epicFeatures.length > 0) {
                                  setExpandedEpics((previous) => new Set(previous).add(epic.id));
                                }
                              }}
                              className="h-4 w-4 flex-shrink-0"
                              aria-label="Toggle epic selection"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 p-0 flex-shrink-0"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleEpic(epic.id);
                              }}
                              aria-label={isExpanded ? "Collapse epic" : "Expand epic"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <Badge className="bg-violet-500 text-white text-[10px] px-1.5 py-0 flex-shrink-0">
                              E
                            </Badge>
                            <Badge variant="secondary" className="text-[10px] capitalize flex-shrink-0">
                              {epic.state || "planned"}
                            </Badge>
                            <div className="w-0 flex-1">
                              <p className="text-sm font-semibold text-foreground truncate">
                                {epic.title}
                                {isEpicGenerated && (
                                  <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide align-middle">
                                    Generated
                                  </span>
                                )}
                                {isEpicPartiallyGenerated && (
                                  <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide align-middle">
                                    {generatedEpicFeatureCount}/{epicFeatures.length} generated
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] text-muted-foreground truncate">
                                {epicFeatures.length} feature
                                {epicFeatures.length === 1 ? "" : "s"} · {" "}
                                {epicStoryCount} user stor
                                {epicStoryCount === 1 ? "y" : "ies"}
                              </p>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="ml-6 space-y-1 border-l border-border/50 pl-2">
                              {epicFeatures.map(renderFeatureRow)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {unparentedFeatureNodes.length > 0 && (
                      <div className="space-y-1">
                        <div className="px-2 pt-1 text-[11px] font-medium text-muted-foreground">
                          Features without epic
                        </div>
                        {unparentedFeatureNodes.map(renderFeatureRow)}
                      </div>
                    )}
                  </>
                ) : (
                  filteredFeatureNodes.map(renderFeatureRow)
                )}
                {/* User stories without a Feature parent — shown directly */}
                {filteredOrphanUserStories.map((story) => {
                  const isOrphanGenerated = generatedFeatureIds.has(-story.id);
                  const isOrphanPushed = pushedFeatureIds.has(-story.id);
                  const isOrphanUnpushed = isOrphanGenerated && !isOrphanPushed;
                  return (
                  <div
                    key={story.id}
                    className={cn(
                      "flex items-center gap-2.5 pl-2 pr-3 py-2 rounded-lg border border-transparent hover:border-border hover:bg-accent/50 transition-all cursor-pointer group min-w-0 overflow-hidden",
                      selectedStoryIds.has(story.id) &&
                        !isOrphanUnpushed && "bg-green-500/10 border-green-500/30",
                      isOrphanUnpushed &&
                        "bg-emerald-500/10 border-l-[3px] border-l-emerald-500",
                    )}
                    onClick={() => {
                      setSelectedStoryIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(story.id)) next.delete(story.id);
                        else next.add(story.id);
                        return next;
                      });
                    }}
                  >
                    <Checkbox
                      checked={selectedStoryIds.has(story.id)}
                      onCheckedChange={() => {
                        setSelectedStoryIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(story.id)) next.delete(story.id);
                          else next.add(story.id);
                          return next;
                        });
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 flex-shrink-0"
                      aria-label="Toggle user story selection"
                    />
                    <div className="w-5 flex-shrink-0" />
                    <Badge className="bg-green-500 text-white text-[10px] px-1.5 py-0 flex-shrink-0">
                      U
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="text-[10px] capitalize flex-shrink-0"
                    >
                      {story.state || "planned"}
                    </Badge>
                    <div className="w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {story.title}
                        {generatedFeatureIds.has(-story.id) && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide align-middle">
                            Generated
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {story.storyPoints != null
                          ? `${story.storyPoints} pts`
                          : ""}
                      </p>
                    </div>
                  </div>
                  );
                })}
              </div>
            </ScrollArea>
            <p className="mt-3 text-xs text-muted-foreground flex-shrink-0">
              Select Features or User Stories under each Epic to generate specs
              and requirements.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
