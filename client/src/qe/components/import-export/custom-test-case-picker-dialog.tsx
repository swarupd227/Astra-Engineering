import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search } from "lucide-react";
import type { ExportableTestCase } from "./types";
import { normalizeTestCase } from "./utils";

interface CustomTestCasePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
  functionalRunId?: string;
  selectedIds: string[];
  onConfirm: (ids: string[]) => void;
}

async function fetchProjectTestCases(
  projectId: string,
  functionalRunId?: string,
): Promise<ExportableTestCase[]> {
  const requests = [
    fetch(
      `/api/execution/test-cases?${new URLSearchParams({
        source: "autonomous",
        projectId,
        strictProject: "true",
        ...(functionalRunId && functionalRunId !== "all"
          ? { functionalRunId }
          : {}),
      }).toString()}`,
    ),
    fetch(
      `/api/execution/test-cases?${new URLSearchParams({
        source: "sprint",
        projectId,
      }).toString()}`,
    ),
  ];

  const responses = await Promise.all(requests);
  const byId = new Map<string, ExportableTestCase>();

  for (const response of responses) {
    if (!response.ok) continue;
    const data = (await response.json()) as { testCases?: Record<string, unknown>[] };
    for (const raw of data.testCases || []) {
      const testCase = normalizeTestCase(raw);
      if (testCase.id) byId.set(testCase.id, testCase);
    }
  }

  return Array.from(byId.values());
}

export function CustomTestCasePickerDialog({
  open,
  onOpenChange,
  projectId,
  functionalRunId,
  selectedIds,
  onConfirm,
}: CustomTestCasePickerDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [testCases, setTestCases] = useState<ExportableTestCase[]>([]);
  const [draftSelected, setDraftSelected] = useState<Set<string>>(new Set(selectedIds));

  useEffect(() => {
    if (!open) return;
    setDraftSelected(new Set(selectedIds));
    setSearchTerm("");
  }, [open, selectedIds]);

  useEffect(() => {
    if (!open || !projectId) {
      setTestCases([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void fetchProjectTestCases(projectId, functionalRunId)
      .then((cases) => {
        if (!cancelled) setTestCases(cases);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId, functionalRunId]);

  const filteredCases = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return testCases;
    return testCases.filter(
      (tc) =>
        tc.name.toLowerCase().includes(query) ||
        tc.id.toLowerCase().includes(query) ||
        (tc.category || "").toLowerCase().includes(query),
    );
  }, [searchTerm, testCases]);

  const toggleCase = (id: string, checked: boolean) => {
    setDraftSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setDraftSelected((current) => {
      const next = new Set(current);
      for (const testCase of filteredCases) {
        if (checked) next.add(testCase.id);
        else next.delete(testCase.id);
      }
      return next;
    });
  };

  const allVisibleSelected =
    filteredCases.length > 0 &&
    filteredCases.every((tc) => draftSelected.has(tc.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose Test Cases</DialogTitle>
          <DialogDescription>
            Select the test cases you want to include in this export.
          </DialogDescription>
        </DialogHeader>

        {!projectId ? (
          <div className="rounded-lg border border-border/50 bg-muted/30 p-6 text-sm text-muted-foreground">
            Select a project first, then choose specific test cases.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name, ID, or category"
                className="pl-9"
                data-testid="input-custom-test-case-search"
              />
            </div>

            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all-visible"
                  checked={allVisibleSelected}
                  onCheckedChange={(checked) => toggleAllVisible(checked === true)}
                  disabled={filteredCases.length === 0}
                />
                <label htmlFor="select-all-visible" className="cursor-pointer text-muted-foreground">
                  Select all visible
                </label>
              </div>
              <span className="text-muted-foreground">
                {draftSelected.size} selected
              </span>
            </div>

            <div className="max-h-80 overflow-y-auto rounded-lg border border-border/50">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading test cases...
                </div>
              ) : filteredCases.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No test cases found for this project.
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {filteredCases.map((testCase) => (
                    <label
                      key={testCase.id}
                      className="flex cursor-pointer items-start gap-3 p-4 hover:bg-muted/30"
                    >
                      <Checkbox
                        checked={draftSelected.has(testCase.id)}
                        onCheckedChange={(checked) =>
                          toggleCase(testCase.id, checked === true)
                        }
                        data-testid={`checkbox-test-case-${testCase.id}`}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {testCase.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {testCase.id}
                          </span>
                          <Badge variant="secondary">{testCase.category}</Badge>
                          <Badge variant="outline">{testCase.priority}</Badge>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirm(Array.from(draftSelected));
              onOpenChange(false);
            }}
            disabled={!projectId || draftSelected.size === 0}
            data-testid="button-confirm-custom-selection"
          >
            Use {draftSelected.size} Test Case{draftSelected.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
