import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sparkles,
  Merge,
  Loader2,
  ChevronDown,
  ChevronRight,
  X,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Epic, Feature, UserStory } from "@shared/schema";
import type { MergeKind, MergeSuggestionGroup, MergeGroupInput } from "./use-epic-merge";

const UNASSIGNED = 0;

const GROUP_STYLES = [
  "border-l-violet-500 bg-violet-500/5",
  "border-l-emerald-500 bg-emerald-500/5",
  "border-l-amber-500 bg-amber-500/5",
  "border-l-blue-500 bg-blue-500/5",
  "border-l-rose-500 bg-rose-500/5",
  "border-l-cyan-500 bg-cyan-500/5",
];

const GROUP_BADGE_STYLES = [
  "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
];

const GROUP_DOT_STYLES = [
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-blue-500",
  "bg-rose-500",
  "bg-cyan-500",
];

const priorityBadge: Record<string, string> = {
  High: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  Medium: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  Low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

interface NormalizedItem {
  id: string;
  title: string;
  description: string;
  priority: string;
  parentId?: string;
  parentLabel?: string;
}

interface BulkMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  epics: Epic[];
  features: Feature[];
  userStories: UserStory[];
  epicTitleById: Record<string, string>;
  featureTitleById: Record<string, string>;
  isMerging: boolean;
  isSuggesting: boolean;
  /** When true, automatically run AI suggestions for the Epics tab when the dialog opens. */
  autoSuggestOnOpen?: boolean;
  onSuggest: (kind: MergeKind, candidateIds: string[]) => Promise<MergeSuggestionGroup[]>;
  onMerge: (kind: MergeKind, groups: MergeGroupInput[]) => Promise<void>;
}

const KIND_LABELS: Record<MergeKind, { tab: string; singular: string; plural: string; parent?: string }> = {
  epic: { tab: "Epics", singular: "epic", plural: "epics" },
  feature: { tab: "Features", singular: "feature", plural: "features", parent: "epic" },
  userStory: { tab: "Stories", singular: "story", plural: "stories", parent: "feature" },
};

type ReasonMap = Record<number, { title: string; reason: string }>;

export function BulkMergeDialog({
  open,
  onOpenChange,
  epics,
  features,
  userStories,
  epicTitleById,
  featureTitleById,
  isMerging,
  isSuggesting,
  autoSuggestOnOpen,
  onSuggest,
  onMerge,
}: BulkMergeDialogProps) {
  const [activeKind, setActiveKind] = useState<MergeKind>("epic");

  // Per-kind state so switching tabs preserves work.
  const [assignments, setAssignments] = useState<Record<MergeKind, Record<string, number>>>({
    epic: {},
    feature: {},
    userStory: {},
  });
  const [reasons, setReasons] = useState<Record<MergeKind, ReasonMap>>({
    epic: {},
    feature: {},
    userStory: {},
  });
  const [selected, setSelected] = useState<Record<MergeKind, Set<string>>>({
    epic: new Set(),
    feature: new Set(),
    userStory: new Set(),
  });
  // Collapsed group clusters, keyed by `${kind}:${group}`.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setActiveKind("epic");
      setAssignments({ epic: {}, feature: {}, userStory: {} });
      setReasons({ epic: {}, feature: {}, userStory: {} });
      setSelected({ epic: new Set(), feature: new Set(), userStory: new Set() });
      setCollapsed(new Set());
    }
  }, [open]);

  const items: Record<MergeKind, NormalizedItem[]> = useMemo(
    () => ({
      epic: epics.map((e) => ({
        id: e.id,
        title: e.title,
        description: typeof e.description === "string" ? e.description : String(e.description ?? ""),
        priority: e.priority,
      })),
      feature: features.map((f) => ({
        id: f.id,
        title: f.title,
        description: typeof f.description === "string" ? f.description : String(f.description ?? ""),
        priority: f.priority,
        parentId: f.epicId,
        parentLabel: epicTitleById[f.epicId] || "Unknown epic",
      })),
      userStory: userStories.map((s) => ({
        id: s.id,
        title: s.title,
        description: typeof s.description === "string" ? s.description : String(s.description ?? ""),
        priority: s.priority,
        parentId: s.featureId,
        parentLabel: featureTitleById[s.featureId] || "Unknown feature",
      })),
    }),
    [epics, features, userStories, epicTitleById, featureTitleById],
  );

  const currentItems = items[activeKind];
  const currentAssignments = assignments[activeKind];
  const currentReasons = reasons[activeKind];
  const currentSelected = selected[activeKind];

  const setGroup = (id: string, group: number) => {
    setAssignments((prev) => ({ ...prev, [activeKind]: { ...prev[activeKind], [id]: group } }));
  };

  // Resolve the actual merge groups, splitting each visual group by parent so
  // only items sharing a parent are ever merged together.
  const resolvedGroups = useMemo<MergeGroupInput[]>(() => {
    const visualGroups = new Map<number, NormalizedItem[]>();
    for (const item of currentItems) {
      const group = currentAssignments[item.id] ?? UNASSIGNED;
      if (group === UNASSIGNED) continue;
      if (!visualGroups.has(group)) visualGroups.set(group, []);
      visualGroups.get(group)!.push(item);
    }

    const result: MergeGroupInput[] = [];
    visualGroups.forEach((groupItems, group) => {
      const title = currentReasons[group]?.title?.trim() || undefined;
      if (activeKind === "epic") {
        if (groupItems.length >= 2) result.push({ ids: groupItems.map((i) => i.id), title });
        return;
      }
      const byParent = new Map<string, string[]>();
      groupItems.forEach((i) => {
        const parent = i.parentId || "";
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent)!.push(i.id);
      });
      byParent.forEach((ids) => {
        if (ids.length >= 2) result.push({ ids, title });
      });
    });
    return result;
  }, [currentItems, currentAssignments, activeKind, currentReasons]);

  const mergedCount = resolvedGroups.length;
  const consumedCount = resolvedGroups.reduce((sum, g) => sum + g.ids.length, 0);
  const labels = KIND_LABELS[activeKind];

  // Grouped clusters (items that are assigned to a group), and the leftover list.
  const groupsPreview = useMemo(() => {
    const map = new Map<number, NormalizedItem[]>();
    for (const item of currentItems) {
      const group = currentAssignments[item.id] ?? UNASSIGNED;
      if (group === UNASSIGNED) continue;
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(item);
    }
    return Array.from(map.entries())
      .map(([group, members]) => ({ group, members }))
      .sort((a, b) => a.group - b.group);
  }, [currentItems, currentAssignments]);

  const ungroupedItems = useMemo(
    () => currentItems.filter((i) => (currentAssignments[i.id] ?? UNASSIGNED) === UNASSIGNED),
    [currentItems, currentAssignments],
  );

  const nextGroupNumber = useMemo(() => {
    const used = Object.values(currentAssignments).filter((g) => g > 0);
    return (used.length ? Math.max(...used) : 0) + 1;
  }, [currentAssignments]);

  const isCollapsed = (group: number) => collapsed.has(`${activeKind}:${group}`);
  const toggleCollapsed = (group: number) => {
    const key = `${activeKind}:${group}`;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev[activeKind]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [activeKind]: next };
    });
  };

  const selectAllUngrouped = (value: boolean) => {
    setSelected((prev) => ({
      ...prev,
      [activeKind]: value ? new Set(ungroupedItems.map((i) => i.id)) : new Set(),
    }));
  };

  const groupSelected = () => {
    const ids = ungroupedItems.filter((i) => currentSelected.has(i.id)).map((i) => i.id);
    if (ids.length < 2) return;
    const groupNumber = nextGroupNumber;
    setAssignments((prev) => {
      const next = { ...prev[activeKind] };
      ids.forEach((id) => {
        next[id] = groupNumber;
      });
      return { ...prev, [activeKind]: next };
    });
    setSelected((prev) => ({ ...prev, [activeKind]: new Set() }));
  };

  // Send an item back to the ungrouped pool, dissolving the group if it drops below 2.
  const removeFromGroup = (id: string) => {
    setAssignments((prev) => {
      const next = { ...prev[activeKind] };
      const group = next[id];
      next[id] = UNASSIGNED;
      if (group > 0) {
        const remaining = Object.keys(next).filter((k) => next[k] === group);
        if (remaining.length < 2) {
          remaining.forEach((k) => (next[k] = UNASSIGNED));
          setReasons((r) => {
            const copy = { ...r[activeKind] };
            delete copy[group];
            return { ...r, [activeKind]: copy };
          });
        }
      }
      return { ...prev, [activeKind]: next };
    });
  };

  const clearGroup = (group: number) => {
    setAssignments((prev) => {
      const next = { ...prev[activeKind] };
      Object.keys(next).forEach((id) => {
        if (next[id] === group) next[id] = UNASSIGNED;
      });
      return { ...prev, [activeKind]: next };
    });
    setReasons((prev) => {
      const next = { ...prev[activeKind] };
      delete next[group];
      return { ...prev, [activeKind]: next };
    });
  };

  const clearAll = () => {
    setAssignments((prev) => ({ ...prev, [activeKind]: {} }));
    setReasons((prev) => ({ ...prev, [activeKind]: {} }));
    setSelected((prev) => ({ ...prev, [activeKind]: new Set() }));
  };

  const runSuggest = async (kind: MergeKind) => {
    const candidateIds = items[kind].map((i) => i.id);
    const suggestions = await onSuggest(kind, candidateIds);
    if (suggestions.length === 0) return;

    const nextAssignments: Record<string, number> = {};
    const nextReasons: ReasonMap = {};
    const collapsedKeys: string[] = [];
    suggestions.forEach((group, index) => {
      const groupNumber = index + 1;
      group.ids.forEach((id) => {
        nextAssignments[id] = groupNumber;
      });
      nextReasons[groupNumber] = { title: group.suggestedTitle, reason: group.reason };
      collapsedKeys.push(`${kind}:${groupNumber}`);
    });

    setAssignments((prev) => ({ ...prev, [kind]: nextAssignments }));
    setReasons((prev) => ({ ...prev, [kind]: nextReasons }));
    setSelected((prev) => ({ ...prev, [kind]: new Set() }));
    // Start collapsed right after generation; the user can expand groups themselves.
    setCollapsed((prev) => {
      const next = new Set(prev);
      collapsedKeys.forEach((key) => next.add(key));
      return next;
    });
  };

  const handleAiSuggest = () => runSuggest(activeKind);

  // When opened via "AI bulk merge", auto-run suggestions on the Epics tab.
  useEffect(() => {
    if (open && autoSuggestOnOpen) {
      setActiveKind("epic");
      void runSuggest("epic");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoSuggestOnOpen]);

  const handleMerge = async () => {
    if (resolvedGroups.length === 0) return;
    await onMerge(activeKind, resolvedGroups);
    onOpenChange(false);
  };

  const busy = isMerging || isSuggesting;
  const selectedCount = ungroupedItems.filter((i) => currentSelected.has(i.id)).length;
  const allUngroupedSelected = ungroupedItems.length > 0 && selectedCount === ungroupedItems.length;

  return (
    <Dialog open={open} onOpenChange={(next) => (!busy ? onOpenChange(next) : undefined)}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col gap-4">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-5 w-5 text-violet-500" />
            Bulk Merge
          </DialogTitle>
          <DialogDescription>
            Tick the {labels.plural} you want to combine, then group them — or let AI suggest groupings.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeKind}
          onValueChange={(v) => setActiveKind(v as MergeKind)}
          className="flex flex-1 min-h-0 flex-col gap-4"
        >
          <TabsList className="w-full justify-start">
            {(Object.keys(KIND_LABELS) as MergeKind[]).map((kind) => (
              <TabsTrigger key={kind} value={kind} disabled={busy}>
                {KIND_LABELS[kind].tab} ({items[kind].length})
              </TabsTrigger>
            ))}
          </TabsList>

          {(Object.keys(KIND_LABELS) as MergeKind[]).map((kind) => (
            <TabsContent
              key={kind}
              value={kind}
              className="flex flex-1 min-h-0 flex-col gap-3 data-[state=inactive]:hidden"
            >
              {/* Action bar — one smart button: AI suggests when nothing is
                  selected, otherwise it groups the ticked items. */}
              <div className="flex flex-wrap items-center gap-2">
                {selectedCount > 0 ? (
                  <Button size="sm" onClick={groupSelected} disabled={busy || selectedCount < 2}>
                    <Layers className="h-4 w-4 mr-1.5" />
                    Group selected ({selectedCount})
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleAiSuggest}
                    disabled={busy || currentItems.length < 2}
                    className="border-violet-200 text-violet-700 hover:text-violet-800 dark:border-violet-900 dark:text-violet-300"
                    variant="outline"
                  >
                    {isSuggesting ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-1.5" />
                    )}
                    AI Suggest Merges
                  </Button>
                )}
                {groupsPreview.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearAll} disabled={busy}>
                    Clear all
                  </Button>
                )}
                <div className="ml-auto text-xs text-muted-foreground">
                  {groupsPreview.length > 0 && (
                    <span className="font-medium text-foreground">{groupsPreview.length}</span>
                  )}
                  {groupsPreview.length > 0 ? " grouped · " : ""}
                  <span className="font-medium text-foreground">{ungroupedItems.length}</span> to assign
                </div>
              </div>

              {/* Single unified scroll area */}
              <div className="scrollbar-none flex-1 min-h-0 space-y-3 overflow-y-auto overflow-x-hidden pr-0.5">
                {currentItems.length === 0 && (
                  <div className="rounded-xl border border-border/60 p-10 text-center text-sm text-muted-foreground">
                    No {labels.plural} available to merge.
                  </div>
                )}

                {/* Grouped clusters */}
                {groupsPreview.map(({ group, members }) => {
                  const info = currentReasons[group];
                  const idx = (group - 1) % GROUP_BADGE_STYLES.length;
                  const collapsedRow = isCollapsed(group);
                  const willMerge =
                    activeKind === "epic" || new Set(members.map((m) => m.parentId)).size === 1;
                  return (
                    <div
                      key={group}
                      className={cn(
                        "overflow-hidden rounded-xl border border-border/60 border-l-[3px]",
                        GROUP_STYLES[(group - 1) % GROUP_STYLES.length],
                      )}
                    >
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => toggleCollapsed(group)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          {collapsedRow ? (
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span
                            className={cn(
                              "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold",
                              GROUP_BADGE_STYLES[idx],
                            )}
                          >
                            Group {group}
                          </span>
                          <span className="truncate text-sm font-medium text-foreground">
                            {info?.title || `${members.length} ${labels.plural}`}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">· {members.length}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => clearGroup(group)}
                          disabled={busy}
                          title="Dissolve this group"
                          className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-background/70 hover:text-foreground disabled:opacity-50"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      {!collapsedRow && (
                        <div className="border-t border-border/40 bg-background/40 px-3 py-2">
                          {info?.reason ? (
                            <p className="mb-2 text-xs italic leading-relaxed text-muted-foreground">
                              {info.reason}
                            </p>
                          ) : null}
                          {!willMerge && (
                            <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                              Spans different {labels.parent}s — only same-{labels.parent} items will merge.
                            </p>
                          )}
                          <ul className="space-y-1">
                            {members.map((m) => (
                              <li
                                key={m.id}
                                title={`${m.title}${m.parentLabel ? `\n\n${labels.parent}: ${m.parentLabel}` : ""}${m.description ? `\n\n${m.description}` : ""}`}
                                className="group/item flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/50"
                              >
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 shrink-0 rounded-full",
                                    GROUP_DOT_STYLES[(group - 1) % GROUP_DOT_STYLES.length],
                                  )}
                                />
                                <span className="truncate text-foreground">{m.title}</span>
                                {m.parentLabel ? (
                                  <span className="shrink-0 text-[11px] text-muted-foreground/70">
                                    ({m.parentLabel})
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => removeFromGroup(m.id)}
                                  disabled={busy}
                                  title="Remove from group"
                                  className="ml-auto shrink-0 rounded-md p-0.5 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover/item:opacity-100 disabled:opacity-50"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Ungrouped pool */}
                {ungroupedItems.length > 0 && (
                  <div className="rounded-xl border border-border/60">
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => selectAllUngrouped(!allUngroupedSelected)}
                        disabled={busy}
                        className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        <Checkbox checked={allUngroupedSelected} className="pointer-events-none" />
                        {allUngroupedSelected ? "Deselect all" : "Select all"}
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {groupsPreview.length > 0 ? "Ungrouped" : "All"} {labels.plural} ({ungroupedItems.length})
                      </span>
                    </div>
                    <div className="divide-y divide-border/40 border-t border-border/40">
                      {ungroupedItems.map((item) => {
                        const checked = currentSelected.has(item.id);
                        return (
                          <label
                            key={item.id}
                            title={`${item.title}${item.parentLabel ? `\n\n${labels.parent}: ${item.parentLabel}` : ""}${item.description ? `\n\n${item.description}` : ""}`}
                            className={cn(
                              "flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors",
                              checked ? "bg-violet-500/5" : "hover:bg-muted/30",
                            )}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleSelect(item.id)}
                              disabled={busy}
                              className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                                <Badge
                                  variant="secondary"
                                  className={cn("shrink-0 text-[10px]", priorityBadge[item.priority])}
                                >
                                  {item.priority}
                                </Badge>
                              </div>
                              {item.parentLabel ? (
                                <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
                                  {labels.parent}: {item.parentLabel}
                                </p>
                              ) : null}
                              {item.description ? (
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.description}</p>
                              ) : null}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <DialogFooter className="flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {mergedCount === 0 ? (
              `Select at least 2 ${labels.plural}${labels.parent ? ` (within the same ${labels.parent})` : ""} and group them.`
            ) : (
              <>
                <span className="font-medium text-foreground">{consumedCount}</span> {labels.plural} in{" "}
                <span className="font-medium text-foreground">{mergedCount}</span> group
                {mergedCount > 1 ? "s" : ""} →{" "}
                <span className="font-medium text-foreground">{mergedCount}</span> merged {labels.singular}
                {mergedCount > 1 ? "s" : ""}
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleMerge} disabled={busy || mergedCount === 0}>
              {isMerging ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Merge className="h-4 w-4 mr-1" />}
              Merge {mergedCount > 0 ? `(${mergedCount})` : ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
