import { useState, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import toast from "react-hot-toast";
import type { Epic, Feature, UserStory, AcceptanceCriterion } from "@shared/schema";

export type MergeKind = "epic" | "feature" | "userStory";

export interface MergeSuggestionGroup {
  ids: string[];
  suggestedTitle: string;
  reason: string;
}

/** A group of item ids to merge, optionally carrying a pre-decided title. */
export interface MergeGroupInput {
  ids: string[];
  title?: string;
}

interface MergeHistoryEntry {
  label: string;
  epicsSnapshot: Epic[];
  featuresSnapshot: Feature[];
  userStoriesSnapshot: UserStory[];
  timestamp: Date;
}

interface UseEpicMergeParams {
  epics: Epic[];
  features: Feature[];
  userStories: UserStory[];
  setEpics: (epics: Epic[]) => void;
  setFeatures: (features: Feature[]) => void;
  setUserStories: (stories: UserStory[]) => void;
  requirement?: string;
  projectName?: string;
  /** Called with the ids of every source epic consumed by a merge, so the caller can clear selections. */
  onMergeComplete?: (mergedSourceIds: string[]) => void;
}

const pickHighestPriority = (priorities: Array<Epic["priority"]>): Epic["priority"] => {
  if (priorities.includes("High")) return "High";
  if (priorities.includes("Medium")) return "Medium";
  return "Low";
};

const asText = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));

/** Remove every item matching `isInGroup` and insert `merged` at the position of the first removed item. */
function replaceInPlace<T>(arr: T[], isInGroup: (item: T) => boolean, merged: T): T[] {
  const firstIndex = arr.findIndex(isInGroup);
  if (firstIndex === -1) return [...arr, merged];
  const before = arr.slice(0, firstIndex).filter((item) => !isInGroup(item));
  const after = arr.slice(firstIndex).filter((item) => !isInGroup(item));
  return [...before, merged, ...after];
}

/**
 * Build the merged title + description locally (no network round-trip). When the
 * AI has already suggested a title (e.g. from "AI Suggest"), it is used as-is so
 * merging is instant; otherwise a keyword-based title is derived. The description
 * is always composed from the source items so the merge never blocks on the LLM.
 */
function buildLocalContent(
  items: Array<{ title: string; description: string }>,
  providedTitle?: string,
): { title: string; description: string } {
  const fallback = buildFallbackContent(items);
  const title = providedTitle && providedTitle.trim() ? providedTitle.trim() : fallback.title;
  return { title, description: fallback.description };
}

/** Keyword-analysis fallback used when the AI title service fails. */
function buildFallbackContent(items: Array<{ title: string; description: string }>): {
  title: string;
  description: string;
} {
  const summaries = items.map((item) => {
    const titleWords = item.title
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 2 &&
          !/^(epic|the|and|for|with|from|this|that|will|can|should|want|need|like|have|get|make|create|add|update|delete|manage)$/i.test(
            word,
          ),
      );

    const descWords = asText(item.description)
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 3 &&
          !/^(epic|the|and|for|with|from|this|that|will|can|should|want|need|like|have|get|make|create|add|update|delete|manage|system|module|feature|component)$/i.test(
            word,
          ),
      );

    return [...titleWords, ...descWords.slice(0, 3)];
  });

  const allWords = summaries.flat();
  const wordCounts = allWords.reduce(
    (acc, word) => {
      const normalized = word.toLowerCase().replace(/[^a-z]/g, "");
      if (normalized.length > 2) {
        acc[normalized] = (acc[normalized] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>,
  );

  const commonWords = Object.entries(wordCounts)
    .filter(([word, count]) => count > 1 && word.length > 3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([word]) => word);

  const significantWords =
    commonWords.length > 0
      ? commonWords
      : summaries.map((summary) => summary[0]).filter((word) => word && word.length > 3).slice(0, 3);

  const titleCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

  let title: string;
  if (significantWords.length >= 3) {
    title = significantWords.slice(0, 3).map(titleCase).join(" ");
  } else if (significantWords.length >= 2) {
    title = significantWords.slice(0, 2).map(titleCase).join(" ") + " Integration";
  } else if (significantWords.length === 1) {
    title = titleCase(significantWords[0]) + " Solution";
  } else {
    const firstWords = items[0]?.title
      ?.split(/\s+/)
      .filter((word) => word.length > 3 && !/^(epic|system|module|feature)$/i.test(word));
    title = firstWords?.[0] ? titleCase(firstWords[0]) + " Consolidation" : "Consolidated Item";
  }

  const description = `Consolidated from: ${items.map((e) => e.title).join(", ")}.

Detailed breakdown:
${items.map((item, index) => `${index + 1}. ${item.title}: ${asText(item.description)}`).join("\n\n")}`;

  return { title, description };
}

export function useEpicMerge({
  epics,
  features,
  userStories,
  setEpics,
  setFeatures,
  setUserStories,
  requirement,
  projectName,
  onMergeComplete,
}: UseEpicMergeParams) {
  const [mergeHistory, setMergeHistory] = useState<MergeHistoryEntry[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);

  const pushHistory = useCallback(
    (label: string) => {
      setMergeHistory((prev) => [
        ...prev,
        {
          label,
          epicsSnapshot: epics.map((e) => ({ ...e })),
          featuresSnapshot: features.map((f) => ({ ...f })),
          userStoriesSnapshot: userStories.map((s) => ({ ...s })),
          timestamp: new Date(),
        },
      ]);
    },
    [epics, features, userStories],
  );

  /**
   * Merge one or more groups of epics in a single operation. Each group with
   * >= 2 epics becomes one new merged epic. The whole operation is recorded as
   * a single undo entry.
   */
  const mergeGroups = useCallback(
    async (groups: MergeGroupInput[]) => {
      const validGroups = groups
        .map((g) => ({
          ids: Array.from(new Set(g.ids)).filter((id) => epics.some((e) => e.id === id)),
          title: g.title,
        }))
        .filter((g) => g.ids.length >= 2);

      if (validGroups.length === 0) {
        toast.error("Select at least 2 epics to merge");
        return;
      }

      setIsMerging(true);

      let workingEpics = [...epics];
      let workingFeatures = [...features];
      let workingUserStories = [...userStories];

      const createdMergedEpics: Epic[] = [];
      const allMergedSourceIds: string[] = [];

      try {
        for (let groupIndex = 0; groupIndex < validGroups.length; groupIndex++) {
          const groupIds = validGroups[groupIndex].ids;
          const epicsToMerge = workingEpics.filter((e) => groupIds.includes(e.id));
          const relatedFeatures = workingFeatures.filter((f) => groupIds.includes(f.epicId));

          const { title, description } = buildLocalContent(
            epicsToMerge.map((e) => ({ title: e.title, description: asText(e.description) })),
            validGroups[groupIndex].title,
          );

          const mergedEpic: Epic = {
            id: `merged-epic-${Date.now()}-${groupIndex}`,
            title,
            description,
            priority: pickHighestPriority(epicsToMerge.map((e) => e.priority)),
            featureCount: relatedFeatures.length,
          };

          workingFeatures = workingFeatures.map((feature) =>
            groupIds.includes(feature.epicId) ? { ...feature, epicId: mergedEpic.id } : feature,
          );
          workingUserStories = workingUserStories.map((story) =>
            groupIds.includes(story.epicId) ? { ...story, epicId: mergedEpic.id } : story,
          );
          workingEpics = replaceInPlace(workingEpics, (e) => groupIds.includes(e.id), mergedEpic);

          createdMergedEpics.push(mergedEpic);
          allMergedSourceIds.push(...groupIds);
        }

        pushHistory(`${allMergedSourceIds.length} epics`);
        setEpics(workingEpics);
        setFeatures(workingFeatures);
        setUserStories(workingUserStories);

        onMergeComplete?.(allMergedSourceIds);

        if (createdMergedEpics.length === 1) {
          toast.success(`Successfully merged ${allMergedSourceIds.length} epics into "${createdMergedEpics[0].title}"`);
        } else {
          toast.success(
            `Successfully merged ${allMergedSourceIds.length} epics into ${createdMergedEpics.length} epics`,
          );
        }
      } catch (error) {
        console.error("Error during bulk merge:", error);
        toast.error("Failed to merge epics");
      } finally {
        setIsMerging(false);
      }
    },
    [epics, features, userStories, setEpics, setFeatures, setUserStories, requirement, projectName, onMergeComplete, pushHistory],
  );

  /** Merge all currently-selected epics into a single epic. */
  const mergeSelected = useCallback(
    async (selectedEpicIds: string[]) => {
      await mergeGroups([{ ids: selectedEpicIds }]);
    },
    [mergeGroups],
  );

  /**
   * Merge groups of features. Each group is auto-split by epic so only features
   * sharing the same epic are ever combined; their user stories re-parent to the
   * merged feature.
   */
  const mergeFeatureGroups = useCallback(
    async (groups: MergeGroupInput[]) => {
      // Partition each group by epic to enforce the same-parent constraint,
      // carrying the group's suggested title onto each partition.
      const partitioned: Array<{ ids: string[]; title?: string }> = [];
      for (const group of groups) {
        const ids = Array.from(new Set(group.ids)).filter((id) => features.some((f) => f.id === id));
        const byEpic = new Map<string, string[]>();
        ids.forEach((id) => {
          const epicId = features.find((f) => f.id === id)!.epicId;
          if (!byEpic.has(epicId)) byEpic.set(epicId, []);
          byEpic.get(epicId)!.push(id);
        });
        byEpic.forEach((featureIds) => {
          if (featureIds.length >= 2) partitioned.push({ ids: featureIds, title: group.title });
        });
      }

      if (partitioned.length === 0) {
        toast.error("Select at least 2 features in the same epic to merge");
        return;
      }

      setIsMerging(true);

      let workingFeatures = [...features];
      let workingUserStories = [...userStories];
      const created: Feature[] = [];
      let totalSources = 0;

      try {
        for (let groupIndex = 0; groupIndex < partitioned.length; groupIndex++) {
          const groupIds = partitioned[groupIndex].ids;
          const featuresToMerge = workingFeatures.filter((f) => groupIds.includes(f.id));
          const epicId = featuresToMerge[0].epicId;
          const childStories = workingUserStories.filter((s) => groupIds.includes(s.featureId));

          const { title, description } = buildLocalContent(
            featuresToMerge.map((f) => ({ title: f.title, description: asText(f.description) })),
            partitioned[groupIndex].title,
          );

          const mergedFeature: Feature = {
            id: `merged-feature-${Date.now()}-${groupIndex}`,
            title,
            description,
            epicId,
            priority: pickHighestPriority(featuresToMerge.map((f) => f.priority)),
            storyCount: childStories.length,
          };

          workingUserStories = workingUserStories.map((story) =>
            groupIds.includes(story.featureId) ? { ...story, featureId: mergedFeature.id } : story,
          );
          workingFeatures = replaceInPlace(workingFeatures, (f) => groupIds.includes(f.id), mergedFeature);

          created.push(mergedFeature);
          totalSources += groupIds.length;
        }

        pushHistory(`${totalSources} features`);
        setFeatures(workingFeatures);
        setUserStories(workingUserStories);

        toast.success(
          created.length === 1
            ? `Successfully merged ${totalSources} features into "${created[0].title}"`
            : `Successfully merged ${totalSources} features into ${created.length} features`,
        );
      } catch (error) {
        console.error("Error during feature merge:", error);
        toast.error("Failed to merge features");
      } finally {
        setIsMerging(false);
      }
    },
    [features, userStories, setFeatures, setUserStories, requirement, projectName, pushHistory],
  );

  /**
   * Merge groups of user stories. Each group is auto-split by feature so only
   * stories sharing the same feature are combined. Acceptance criteria from every
   * merged story are concatenated.
   */
  const mergeStoryGroups = useCallback(
    async (groups: MergeGroupInput[]) => {
      const partitioned: Array<{ ids: string[]; title?: string }> = [];
      for (const group of groups) {
        const ids = Array.from(new Set(group.ids)).filter((id) => userStories.some((s) => s.id === id));
        const byFeature = new Map<string, string[]>();
        ids.forEach((id) => {
          const featureId = userStories.find((s) => s.id === id)!.featureId;
          if (!byFeature.has(featureId)) byFeature.set(featureId, []);
          byFeature.get(featureId)!.push(id);
        });
        byFeature.forEach((storyIds) => {
          if (storyIds.length >= 2) partitioned.push({ ids: storyIds, title: group.title });
        });
      }

      if (partitioned.length === 0) {
        toast.error("Select at least 2 stories in the same feature to merge");
        return;
      }

      setIsMerging(true);

      let workingStories = [...userStories];
      const created: UserStory[] = [];
      let totalSources = 0;

      try {
        for (let groupIndex = 0; groupIndex < partitioned.length; groupIndex++) {
          const groupIds = partitioned[groupIndex].ids;
          const storiesToMerge = workingStories.filter((s) => groupIds.includes(s.id));
          const first = storiesToMerge[0];

          const { title, description } = buildLocalContent(
            storiesToMerge.map((s) => ({ title: s.title, description: asText(s.description) })),
            partitioned[groupIndex].title,
          );

          const combinedCriteria: AcceptanceCriterion[] = storiesToMerge.flatMap((s) =>
            Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria : [],
          );
          const totalPoints = storiesToMerge.reduce((sum, s) => sum + (s.storyPoints || 0), 0);

          const mergedStory: UserStory = {
            ...first,
            id: `merged-story-${Date.now()}-${groupIndex}`,
            title,
            description,
            acceptanceCriteria: combinedCriteria,
            priority: pickHighestPriority(storiesToMerge.map((s) => s.priority)),
            storyPoints: totalPoints,
          };

          workingStories = replaceInPlace(workingStories, (s) => groupIds.includes(s.id), mergedStory);
          created.push(mergedStory);
          totalSources += groupIds.length;
        }

        pushHistory(`${totalSources} stories`);
        setUserStories(workingStories);

        toast.success(
          created.length === 1
            ? `Successfully merged ${totalSources} stories into "${created[0].title}"`
            : `Successfully merged ${totalSources} stories into ${created.length} stories`,
        );
      } catch (error) {
        console.error("Error during story merge:", error);
        toast.error("Failed to merge stories");
      } finally {
        setIsMerging(false);
      }
    },
    [userStories, setUserStories, requirement, projectName, pushHistory],
  );

  /** Ask the AI which items of the given kind should be merged. */
  const suggestMergesFor = useCallback(
    async (kind: MergeKind, candidateIds?: string[]): Promise<MergeSuggestionGroup[]> => {
      setIsSuggesting(true);
      try {
        if (kind === "epic") {
          const candidates =
            candidateIds && candidateIds.length > 0 ? epics.filter((e) => candidateIds.includes(e.id)) : epics;
          if (candidates.length < 2) {
            toast.error("Need at least 2 epics to suggest merges");
            return [];
          }
          const candidateIdSet = new Set(candidates.map((e) => e.id));
          const relatedFeatures = features.filter((f) => candidateIdSet.has(f.epicId));
          const relatedUserStories = userStories.filter((s) => candidateIdSet.has(s.epicId));

          const res = await apiRequest("POST", "/api/ai/suggest-epic-merges", {
            epics: candidates.map((epic) => ({
              id: epic.id,
              title: epic.title,
              description: epic.description,
              priority: epic.priority,
            })),
            features: relatedFeatures.map((f) => ({
              id: f.id,
              title: f.title,
              description: f.description,
              epicId: f.epicId,
              priority: f.priority,
            })),
            userStories: relatedUserStories.map((s) => ({
              id: s.id,
              title: s.title,
              description: s.description,
              epicId: s.epicId,
              featureId: s.featureId,
            })),
            requirement: requirement || "",
            projectContext: projectName || "Project",
          });
          const data = (await res.json()) as { groups?: Array<{ epicIds: string[]; suggestedTitle: string; reason: string }> };
          const raw = Array.isArray(data?.groups) ? data.groups : [];
          return validateSuggestions(
            raw.map((g) => ({ ids: g.epicIds || [], suggestedTitle: g.suggestedTitle, reason: g.reason })),
            new Set(candidates.map((e) => e.id)),
          );
        }

        // feature / userStory
        const source = kind === "feature" ? features : userStories;
        const candidates =
          candidateIds && candidateIds.length > 0 ? source.filter((i) => candidateIds.includes(i.id)) : source;
        if (candidates.length < 2) {
          toast.error(`Need at least 2 ${kind === "feature" ? "features" : "stories"} to suggest merges`);
          return [];
        }

        const res = await apiRequest("POST", "/api/ai/suggest-merges", {
          itemType: kind,
          items: candidates.map((item: any) => ({
            id: item.id,
            title: item.title,
            description: asText(item.description),
            priority: item.priority,
            parentId: kind === "feature" ? item.epicId : item.featureId,
          })),
          requirement: requirement || "",
          projectContext: projectName || "Project",
        });
        const data = (await res.json()) as { groups?: Array<{ itemIds: string[]; suggestedTitle: string; reason: string }> };
        const raw = Array.isArray(data?.groups) ? data.groups : [];
        return validateSuggestions(
          raw.map((g) => ({ ids: g.itemIds || [], suggestedTitle: g.suggestedTitle, reason: g.reason })),
          new Set(candidates.map((i: any) => i.id)),
        );
      } catch (error) {
        console.error("Error suggesting merges:", error);
        toast.error("Failed to get merge suggestions");
        return [];
      } finally {
        setIsSuggesting(false);
      }
    },
    [epics, features, userStories, requirement, projectName],
  );

  /** Undo the most recent merge operation (LIFO). Restores the full pre-merge snapshot. */
  const undoMerge = useCallback(() => {
    if (mergeHistory.length === 0) {
      toast.error("No merges to undo");
      return;
    }

    try {
      const lastMerge = mergeHistory[mergeHistory.length - 1];
      setEpics(lastMerge.epicsSnapshot);
      setFeatures(lastMerge.featuresSnapshot);
      setUserStories(lastMerge.userStoriesSnapshot);
      setMergeHistory((prev) => prev.slice(0, -1));
      toast.success(`Undid merge of ${lastMerge.label}`);
    } catch (error) {
      console.error("Error undoing merge:", error);
      toast.error("Failed to undo merge operation");
    }
  }, [mergeHistory, setEpics, setFeatures, setUserStories]);

  return {
    mergeHistory,
    isMerging,
    isSuggesting,
    mergeGroups,
    mergeSelected,
    mergeFeatureGroups,
    mergeStoryGroups,
    suggestMergesFor,
    undoMerge,
  };
}

/** Client-side guard: drop ids outside the candidate set and any overlaps. */
function validateSuggestions(groups: MergeSuggestionGroup[], candidateIds: Set<string>): MergeSuggestionGroup[] {
  const used = new Set<string>();
  const valid = groups
    .map((group) => ({
      ...group,
      ids: (group.ids || []).filter((id) => candidateIds.has(id) && !used.has(id)),
    }))
    .filter((group) => group.ids.length >= 2)
    .map((group) => {
      group.ids.forEach((id) => used.add(id));
      return group;
    });

  if (valid.length === 0) {
    toast("AI found no items that should be merged");
  }

  return valid;
}
