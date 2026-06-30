import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronRight,
  ChevronDown,
  Edit,
  Sparkles,
  Eye,
  Link as LinkIcon,
  Trash2,
  Cloud,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Epic, Feature, UserStory } from "@shared/schema";
import { Filter } from "lucide-react";

type SourceFilter = "all" | "ado" | "db";

interface LinkedItemsTreeProps {
  epics: Epic[];
  features: Feature[];
  userStories: UserStory[];
  integrationType?: string;
  selectedItems?: Set<string>;
  onSelectionChange?: (selectedIds: Set<string>) => void;
  onEdit?: (item: any, type: "epic" | "feature" | "story") => void;
  onView?: (item: any, type: "epic" | "feature" | "story") => void;
  onPushToDevOps?: (item: any) => void;
  onDelete?: (item: any, type: "epic" | "feature" | "story") => void;
  showCheckboxes?: boolean;
  showActions?: boolean;
  compact?: boolean;
}

type ArtifactItem = Epic | Feature | UserStory;

const typeColorMap: Record<string, string> = {
  epic: "bg-purple-500",
  feature: "bg-blue-500",
  story: "bg-green-500",
};

const getItemType = (item: ArtifactItem): "epic" | "feature" | "story" => {
  if ("persona" in item) return "story";
  if ("epicId" in item) return "feature";
  return "epic";
};

const getTypeLabel = (type: "epic" | "feature" | "story"): string => {
  return type === "story" ? "User Story" : type.charAt(0).toUpperCase() + type.slice(1);
};

const isAdoItem = (item: any): boolean => {
  return item._isAdoItem === true;
};

export function LinkedItemsTree({
  epics,
  features,
  userStories,
  selectedItems = new Set(),
  onSelectionChange,
  onEdit,
  onView,
  onPushToDevOps,
  onDelete,
  showCheckboxes = true,
  showActions = true,
  compact = false,
  integrationType = "ado",
}: LinkedItemsTreeProps) {
  const providerName = integrationType === "jira" ? "Jira" : "Azure DevOps";
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedEpics, setExpandedEpics] = useState<Set<string>>(
    new Set(epics.map((e) => e.id))
  );
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  // Build hierarchy: Epic -> Features -> User Stories
  const hierarchy = useMemo(() => {
    return epics.map((epic) => {
      const epicFeatures = features.filter((f) => f.epicId === epic.id);
      return {
        epic,
        features: epicFeatures.map((feature) => {
          const featureStories = userStories.filter((s) => s.epicId === epic.id && (s as any).featureId === feature.id);
          return {
            feature,
            stories: featureStories,
          };
        }),
      };
    });
  }, [epics, features, userStories]);

  // Filter items based on source (ADO vs DB)
  const filteredHierarchy = useMemo(() => {
    if (sourceFilter === "all") return hierarchy;

    const isMatchingSource = (item: any) => {
      if (sourceFilter === "ado") return isAdoItem(item);
      if (sourceFilter === "db") return !isAdoItem(item);
      return true;
    };

    return hierarchy
      .map((epicData) => {
        const filteredFeatures = epicData.features
          .map((featureData) => {
            const filteredStories = featureData.stories.filter(isMatchingSource);
            return {
              feature: featureData.feature,
              stories: filteredStories,
            };
          })
          .filter((fd) => isMatchingSource(fd.feature) || fd.stories.length > 0);

        return {
          epic: epicData.epic,
          features: filteredFeatures,
        };
      })
      .filter((ed) => isMatchingSource(ed.epic) || ed.features.length > 0);
  }, [hierarchy, sourceFilter]);

  // Calculate counts for each source
  const counts = useMemo(() => {
    const adoEpics = epics.filter(isAdoItem).length;
    const dbEpics = epics.length - adoEpics;
    const adoFeatures = features.filter(isAdoItem).length;
    const dbFeatures = features.length - adoFeatures;
    const adoStories = userStories.filter(isAdoItem).length;
    const dbStories = userStories.length - adoStories;

    return {
      ado: adoEpics + adoFeatures + adoStories,
      db: dbEpics + dbFeatures + dbStories,
      total: epics.length + features.length + userStories.length,
    };
  }, [epics, features, userStories]);

  const toggleEpicExpanded = (epicId: string) => {
    setExpandedEpics((prev) => {
      const next = new Set(prev);
      if (next.has(epicId)) {
        next.delete(epicId);
      } else {
        next.add(epicId);
      }
      return next;
    });
  };

  const toggleItemExpanded = (itemId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleSelectionChange = (itemId: string) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedItems);
    if (next.has(itemId)) {
      next.delete(itemId);
    } else {
      next.add(itemId);
    }
    onSelectionChange(next);
  };

  const renderActionButtons = (item: ArtifactItem, type: "epic" | "feature" | "story") => {
    if (!showActions) return null;

    return (
      <div className="flex items-center gap-1">
        {onView && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onView(item, type);
            }}
            title="View details"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
        )}
        {onEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(item, type);
            }}
            title="Edit"
          >
            <Edit className="h-3.5 w-3.5" />
          </Button>
        )}
        {onPushToDevOps && type === "story" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onPushToDevOps(item);
            }}
            title={`Push to ${providerName}`}
          >
            <Cloud className="h-3.5 w-3.5" />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item, type);
            }}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  };

  const renderStory = (story: UserStory, level = 2) => {
    const isSelected = selectedItems.has(story.id);
    const status = (story as any).status || "planned";

    return (
      <div key={story.id} className={cn("space-y-2", compact && "space-y-1")}>
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-md border border-transparent hover:border-border hover:bg-accent/50 transition-all cursor-pointer group",
            isSelected && "bg-green-500/10 border-green-500/30",
            !compact && "gap-3 px-4 py-3"
          )}
          style={{ marginLeft: `${level * 1.5}rem` }}
        >
          {showCheckboxes && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => handleSelectionChange(story.id)}
              className="h-4 w-4 flex-shrink-0"
            />
          )}
          <Badge className="bg-green-500 text-white text-xs flex-shrink-0">
            User Story
          </Badge>
          {(story as any)._isAdoItem && (
            <Badge variant="outline" className="text-xs border-blue-500 text-blue-500 flex-shrink-0">
              ADO
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs capitalize flex-shrink-0">
            {status}
          </Badge>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground line-clamp-1">
              {story.title}
            </p>
            {!compact && story.description && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {story.description}
              </p>
            )}
          </div>
          {(story as any).storyPoints && (
            <Badge variant="outline" className="text-xs flex-shrink-0">
              {(story as any).storyPoints} pts
            </Badge>
          )}
          {renderActionButtons(story, "story")}
        </div>
      </div>
    );
  };

  const renderFeature = (feature: Feature, stories: UserStory[], epicId: string, level = 1) => {
    const isSelected = selectedItems.has(feature.id);
    const isExpanded = expandedIds.has(feature.id);
    const status = (feature as any).status || "planned";
    const hasStories = stories.length > 0;

    return (
      <div key={feature.id} className={cn("space-y-2", compact && "space-y-1")}>
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-md border border-transparent hover:border-border hover:bg-accent/50 transition-all cursor-pointer group",
            isSelected && "bg-blue-500/10 border-blue-500/30",
            !compact && "gap-3 px-4 py-3"
          )}
          style={{ marginLeft: `${level * 1.5}rem` }}
        >
          {hasStories && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                toggleItemExpanded(feature.id);
              }}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          )}
          {!hasStories && <div className="w-6 flex-shrink-0" />}
          {showCheckboxes && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => handleSelectionChange(feature.id)}
              className="h-4 w-4 flex-shrink-0"
            />
          )}
          <Badge className="bg-blue-500 text-white text-xs flex-shrink-0">
            Feature
          </Badge>
          {(feature as any)._isAdoItem && (
            <Badge variant="outline" className="text-xs border-blue-500 text-blue-500 flex-shrink-0">
              ADO
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs capitalize flex-shrink-0">
            {status}
          </Badge>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground line-clamp-1">
              {feature.title}
            </p>
            {!compact && feature.description && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {feature.description}
              </p>
            )}
          </div>
          {renderActionButtons(feature, "feature")}
        </div>

        {hasStories && isExpanded && (
          <div className="space-y-2">
            {stories.map((story) => renderStory(story, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderEpic = (epicData: (typeof hierarchy)[0], level = 0) => {
    const { epic, features: epicFeatures } = epicData;
    const isSelected = selectedItems.has(epic.id);
    const isExpanded = expandedEpics.has(epic.id);
    const status = (epic as any).status || "planned";

    return (
      <div key={epic.id} className={cn("space-y-2", compact && "space-y-1")}>
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-md border border-transparent hover:border-border hover:bg-accent/50 transition-all cursor-pointer group",
            isSelected && "bg-purple-500/10 border-purple-500/30",
            !compact && "gap-3 px-4 py-3"
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              toggleEpicExpanded(epic.id);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
          {showCheckboxes && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => handleSelectionChange(epic.id)}
              className="h-4 w-4 flex-shrink-0"
            />
          )}
          <Badge className="bg-purple-500 text-white text-xs flex-shrink-0">
            Epic
          </Badge>
          {(epic as any)._isAdoItem && (
            <Badge variant="outline" className="text-xs border-blue-500 text-blue-500 flex-shrink-0">
              ADO
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs capitalize flex-shrink-0">
            {status}
          </Badge>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground line-clamp-1">
              {epic.title}
            </p>
            {!compact && epic.description && (
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {epic.description}
              </p>
            )}
          </div>
          {renderActionButtons(epic, "epic")}
        </div>

        {isExpanded && epicFeatures.length > 0 && (
          <div className="space-y-2">
            {epicFeatures.map((featureData) =>
              renderFeature(
                featureData.feature,
                featureData.stories,
                epic.id,
                level + 1
              )
            )}
          </div>
        )}
      </div>
    );
  };

  if (hierarchy.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Sparkles className="h-12 w-12 text-muted-foreground mb-3" />
        <p className="text-muted-foreground">
          No epics found. Create one to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap px-4">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Button
          size="sm"
          variant={sourceFilter === "all" ? "default" : "outline"}
          onClick={() => setSourceFilter("all")}
        >
          All ({counts.total})
        </Button>
        <Button
          size="sm"
          variant={sourceFilter === "ado" ? "default" : "outline"}
          onClick={() => setSourceFilter("ado")}
        >
          ADO ({counts.ado})
        </Button>
        <Button
          size="sm"
          variant={sourceFilter === "db" ? "default" : "outline"}
          onClick={() => setSourceFilter("db")}
        >
          Draft ({counts.db})
        </Button>
      </div>

      <ScrollArea className="h-[calc(100vh-300px)] w-full">
        <div className={cn("space-y-3 pr-4 pl-4", compact && "space-y-2")}>
          {filteredHierarchy.map((epicData) => renderEpic(epicData))}
        </div>
      </ScrollArea>
    </div>
  );
}
