import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import type { GeneratedFile } from "./types";
import type { SpecsGitProviderKey } from "./utils";
import { getSpecsGitProviderLabel } from "./utils";

export interface PushDialogProps {
  isPushDialogOpen: boolean;
  setIsPushDialogOpen: (open: boolean) => void;
  pushScope: "selected" | "all";
  selectedFile: GeneratedFile | null;
  pushRepoId: string;
  setPushRepoId: (v: string) => void;
  setPushBranch: (v: string) => void;
  isLoadingRepos: boolean;
  adoRepos: any[];
  reposError: Error | null;
  isLoadingBranches: boolean;
  branchesError?: Error | null;
  adoBranches: any[];
  pushBranch: string;
  pushBasePath: string;
  setPushBasePath: (v: string) => void;
  isPushing: boolean;
  generatedFiles: GeneratedFile[];
  latestBatchFiles?: GeneratedFile[];
  selectedPushFileIds: Set<string>;
  setSelectedPushFileIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  alreadyPushedIncludeIds: Set<string>;
  setAlreadyPushedIncludeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  handlePushToAdo: () => void;
  usesGenericGitPush?: boolean;
  specsGitProvider?: SpecsGitProviderKey;
  projectId?: string;
  handlePushToGit?: () => void;
}

export function PushDialog({
  isPushDialogOpen,
  setIsPushDialogOpen,
  pushScope,
  selectedFile,
  pushRepoId,
  setPushRepoId,
  setPushBranch,
  isLoadingRepos,
  adoRepos,
  reposError,
  isLoadingBranches,
  branchesError,
  adoBranches,
  pushBranch,
  pushBasePath,
  setPushBasePath,
  isPushing,
  generatedFiles,
  latestBatchFiles = [],
  selectedPushFileIds,
  setSelectedPushFileIds,
  alreadyPushedIncludeIds,
  setAlreadyPushedIncludeIds,
  handlePushToAdo,
  usesGenericGitPush = false,
  specsGitProvider = null,
  projectId = "",
  handlePushToGit,
}: PushDialogProps) {
  const [repoComboboxOpen, setRepoComboboxOpen] = useState(false);
  const [branchComboboxOpen, setBranchComboboxOpen] = useState(false);
  const platformName = getSpecsGitProviderLabel(specsGitProvider || (usesGenericGitPush ? "github" : "azure_repos"));
  const usesTenantGithub = specsGitProvider === "github-tenant";
  const settingsHint = usesTenantGithub
    ? "Uses the tenant-wide GitHub connection from Settings → Third-Party Integrations."
    : specsGitProvider
      ? `Uses the ${platformName} repository configured for this project in Edit project → Tool configuration.`
      : "Configure a repository tool for this project in Edit project → Tool configuration.";
  const pushCandidates = pushScope === "all" && latestBatchFiles.length > 0 ? latestBatchFiles : generatedFiles;
  const selectedRepo = useMemo(
    () => (Array.isArray(adoRepos) ? adoRepos : []).find((repo: any) => String(repo.id) === String(pushRepoId)),
    [adoRepos, pushRepoId],
  );
  const repositoryEmptyText =
    reposError instanceof Error
      ? reposError.message
      : usesTenantGithub
        ? "No repositories found. Check GitHub token in Settings (Test Connection)."
        : `No ${platformName} repositories found. Configure the repo tool on this project and test the connection.`;
  const repositoryButtonLabel = isLoadingRepos
    ? "Loading repositories..."
    : selectedRepo
      ? `${selectedRepo.name}${selectedRepo.projectName ? ` (${selectedRepo.projectName})` : ""}`
      : adoRepos.length === 0
        ? repositoryEmptyText
        : "Select repository";
  const selectedBranch = useMemo(
    () => (Array.isArray(adoBranches) ? adoBranches : []).find((branch: any) => String(branch.name) === String(pushBranch)),
    [adoBranches, pushBranch],
  );
  const branchEmptyText = branchesError instanceof Error ? "Failed to load branches" : "No branches found";
  const branchButtonLabel = isLoadingBranches
    ? "Loading branches..."
    : selectedBranch
      ? selectedBranch.name
      : adoBranches.length === 0
        ? branchEmptyText
        : "Select branch";

  return (
    <Dialog open={isPushDialogOpen} onOpenChange={setIsPushDialogOpen}>
      <DialogContent className="max-w-4xl pt-10 max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {pushScope === "selected"
              ? `Push file to ${platformName} Git`
              : `Push all specs to ${platformName} Git`}
          </DialogTitle>
          <DialogDescription>
            Select the target repository and base path for the specs folder. {settingsHint}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto flex-1 min-h-0 pr-1">
          <div className="space-y-2">
            <Label htmlFor="ado-repo-select">Repository</Label>
            <Popover open={repoComboboxOpen} onOpenChange={setRepoComboboxOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="ado-repo-select"
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={repoComboboxOpen}
                  disabled={isLoadingRepos || adoRepos.length === 0 || isPushing}
                  className="h-9 w-full justify-between px-3 font-normal"
                >
                  <span className="truncate">{repositoryButtonLabel}</span>
                  {isLoadingRepos ? (
                    <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-70" />
                  ) : (
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search repositories..." />
                  <CommandList onWheel={(e) => e.stopPropagation()}>
                    <CommandEmpty>{repositoryEmptyText}</CommandEmpty>
                    <CommandGroup>
                      {adoRepos.map((repo: any) => {
                        const repoValue = String(repo.id);
                        const repoLabel = `${repo.name}${repo.projectName ? ` (${repo.projectName})` : ""}`;

                        return (
                          <CommandItem
                            key={repoValue}
                            value={`${repo.name} ${repo.projectName ?? ""} ${repoValue}`}
                            onSelect={() => {
                              setPushRepoId(repoValue);
                              setPushBranch("");
                              setRepoComboboxOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                String(pushRepoId) === repoValue ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="truncate">{repoLabel}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              Select the {platformName} Git repository where specs should be
              saved.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ado-branch-select">Branch</Label>
            <Popover open={branchComboboxOpen} onOpenChange={setBranchComboboxOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="ado-branch-select"
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={branchComboboxOpen}
                  disabled={isLoadingBranches || adoBranches.length === 0 || isPushing}
                  className="h-9 w-full justify-between px-3 font-normal"
                >
                  <span className="truncate">{branchButtonLabel}</span>
                  {isLoadingBranches ? (
                    <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-70" />
                  ) : (
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search branches..." />
                  <CommandList onWheel={(e) => e.stopPropagation()}>
                    <CommandEmpty>{branchEmptyText}</CommandEmpty>
                    <CommandGroup>
                      {adoBranches.map((branch: any) => {
                        const branchValue = String(branch.name);

                        return (
                          <CommandItem
                            key={branchValue}
                            value={branchValue}
                            onSelect={() => {
                              setPushBranch(branchValue);
                              setBranchComboboxOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                String(pushBranch) === branchValue ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="truncate">{branchValue}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              {branchesError instanceof Error
                ? branchesError.message
                : "Select the branch to push specs to."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ado-base-path">Base path in repository</Label>
            <Input
              id="ado-base-path"
              placeholder="specs"
              value={pushBasePath}
              onChange={(e) => setPushBasePath(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Optional. For example, <code>specs</code> will create files
              under <code>/specs/...</code>. Leave empty to use the root.
            </p>
          </div>

          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1">
            <p>
              Scope:{" "}
              <span className="font-medium">
                {pushScope === "selected"
                  ? "Current spec/requirements file only"
                  : "Selected files from the latest generated batch"}
              </span>
            </p>
            {pushScope === "selected" && selectedFile && (
              <p>
                Selected file to push: <code>{selectedFile.path}</code>
              </p>
            )}
            {pushScope === "all" && (
              <p>
                Selected files: <span className="font-medium">{selectedPushFileIds.size}</span>
              </p>
            )}
          </div>

          {pushScope === "all" && (() => {
            const alreadyPushed = pushCandidates.filter((f) => f.pushedToAdo);
            const neverPushed = pushCandidates.filter((f) => !f.pushedToAdo);

            const byFeature = new Map<number, { featureTitle: string; files: GeneratedFile[] }>();
            for (const f of pushCandidates) {
              const group = byFeature.get(f.featureId) ?? { featureTitle: f.featureTitle, files: [] };
              group.files.push(f);
              byFeature.set(f.featureId, group);
            }

            return (
              <div className="space-y-2">
                <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">Choose the exact files to push</p>
                  <p>
                    {neverPushed.length} new file{neverPushed.length !== 1 ? "s" : ""} and{" "}
                    {alreadyPushed.length} previously pushed file{alreadyPushed.length !== 1 ? "s" : ""} are available in this batch.
                  </p>
                </div>

                <div className="rounded-md border border-border">
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-border bg-muted/40">
                    <p className="text-[11px] text-muted-foreground font-medium">
                      Select files to push:
                    </p>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setSelectedPushFileIds(new Set(pushCandidates.filter((f) => !f.pushedToAdo).map((f) => f.id)))}
                      >
                        New only
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setSelectedPushFileIds(new Set(pushCandidates.map((f) => f.id)))}
                      >
                        Select all
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setSelectedPushFileIds(new Set())}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-1.5 p-2 pr-3">
                    {Array.from(byFeature.entries()).map(([featureId, group]) => {
                      return (
                        <div key={featureId} className="space-y-1 rounded-md border border-border/60 p-2">
                          <div className="text-[11px] font-medium text-foreground truncate">{group.featureTitle}</div>
                          {group.files.map((file) => (
                            <label
                              key={file.id}
                              className="flex items-center gap-2 cursor-pointer text-xs py-1 px-1 rounded hover:bg-accent"
                            >
                              <Checkbox
                                checked={selectedPushFileIds.has(file.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedPushFileIds((prev) => {
                                    const next = new Set(prev);
                                    if (checked) {
                                      next.add(file.id);
                                      if (file.pushedToAdo) {
                                        setAlreadyPushedIncludeIds((innerPrev) => {
                                          const innerNext = new Set(innerPrev);
                                          innerNext.add(file.id);
                                          return innerNext;
                                        });
                                      }
                                    } else {
                                      next.delete(file.id);
                                      setAlreadyPushedIncludeIds((innerPrev) => {
                                        const innerNext = new Set(innerPrev);
                                        innerNext.delete(file.id);
                                        return innerNext;
                                      });
                                    }
                                    return next;
                                  });
                                }}
                              />
                              <span className="text-foreground truncate flex-1 min-w-0">{file.fileName}</span>
                              <span className="text-muted-foreground text-[10px] shrink-0">
                                {file.pushedToAdo
                                  ? `pushed${file.pushedToAdoAt ? ` ${new Date(file.pushedToAdoAt).toLocaleDateString()}` : ""}`
                                  : "new"}
                              </span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setIsPushDialogOpen(false)}
            disabled={isPushing}
          >
            Cancel
          </Button>
          <Button
            onClick={usesGenericGitPush && handlePushToGit ? handlePushToGit : handlePushToAdo}
            disabled={
              isPushing ||
              isLoadingRepos ||
              !pushRepoId ||
              adoRepos.length === 0
            }
          >
            {isPushing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Pushing...
              </>
            ) : (
              `Push to ${platformName}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
