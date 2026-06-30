import { useMemo, useState } from "react";
import { Building2, Check, ChevronDown, Search } from "lucide-react";
import { VscAzureDevops } from "react-icons/vsc";
import { SiJira } from "react-icons/si";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  GLOBAL_ALL_ORGANIZATIONS_ID,
  useSelectedOrganization,
} from "@/contexts/selected-organization-context";
import { useLocation } from "wouter";

type OrganizationSourceType = "all" | "ado" | "jira";

function getSourceBadgeClass(sourceType: OrganizationSourceType) {
  if (sourceType === "jira") {
    return "border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300";
  }

  if (sourceType === "ado") {
    return "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }

  return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function getSourceSubtitle(sourceType: Exclude<OrganizationSourceType, "all">) {
  return sourceType === "ado" ? "Azure DevOps" : "Jira";
}

export function OrganizationSwitcher() {
  const [, setLocation] = useLocation();
  const {
    organizations,
    selectedOrganizationId,
    selectedOrganization,
    isLoading,
    setSelectedOrganizationId,
  } = useSelectedOrganization();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allOrganizationsOption =
    organizations.find((organization) => organization.id === GLOBAL_ALL_ORGANIZATIONS_ID) ?? null;

  const adoOrganizations = useMemo(
    () =>
      organizations.filter(
        (organization) =>
          organization.sourceType === "ado" &&
          organization.name.toLowerCase().includes(search.trim().toLowerCase())
      ),
    [organizations, search]
  );

  const jiraOrganizations = useMemo(
    () =>
      organizations.filter(
        (organization) =>
          organization.sourceType === "jira" &&
          organization.name.toLowerCase().includes(search.trim().toLowerCase())
      ),
    [organizations, search]
  );

  const defaultTab =
    selectedOrganization?.sourceType === "ado"
      ? "ado"
      : "jira";

  const handleSelect = (organizationId: string) => {
    const organization = organizations.find((item) => item.id === organizationId) ?? null;
    setSelectedOrganizationId(organizationId);

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);

      if (!organization || organization.id === GLOBAL_ALL_ORGANIZATIONS_ID) {
        params.delete("orgId");
        params.delete("organizationName");
        params.delete("organizationUrl");
        params.delete("integrationType");
      } else {
        params.set("orgId", organization.id);
        params.set("organizationName", organization.name);
        params.set("integrationType", organization.sourceType);

        if (organization.description) {
          params.set("organizationUrl", organization.description);
        } else {
          params.delete("organizationUrl");
        }
      }

      const queryString = params.toString();
      setLocation(`${window.location.pathname}${queryString ? `?${queryString}` : ""}`);
    }

    setIsOpen(false);
    setSearch("");
  };

  return (
    <div className="hidden min-w-[260px] items-center gap-2 md:flex">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-muted/30 text-muted-foreground">
        <Building2 className="h-4 w-4" />
      </div>

      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isLoading || organizations.length === 0}
            data-testid="select-global-organization"
            className="flex h-10 min-w-[250px] items-center gap-2 rounded-lg border border-primary/70 bg-background px-3 text-left transition-colors hover:border-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
              {selectedOrganization?.name ??
                (isLoading
                  ? "Loading organizations..."
                  : organizations.length === 0
                    ? "No organizations"
                    : "Select organization")}
            </span>
            {selectedOrganization ? (
              <Badge
                variant="outline"
                className={`shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] ${getSourceBadgeClass(selectedOrganization.sourceType)}`}
              >
                {selectedOrganization.sourceType}
              </Badge>
            ) : null}
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          sideOffset={10}
          className="w-[420px] border-border/70 bg-popover p-0 text-popover-foreground shadow-2xl"
        >
          <div className="border-b border-border/60 p-3">
            {allOrganizationsOption ? (
              <button
                type="button"
                onClick={() => handleSelect(allOrganizationsOption.id)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  selectedOrganizationId === allOrganizationsOption.id
                    ? "border-emerald-500/25 bg-emerald-500/10"
                    : "border-border/50 bg-background/30 hover:bg-background/50"
                }`}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-foreground">All Organizations</div>
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    Show data across all connected organizations
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${getSourceBadgeClass("all")}`}
                  >
                    ALL
                  </Badge>
                  {selectedOrganizationId === allOrganizationsOption.id ? (
                    <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : null}
                </div>
              </button>
            ) : null}
          </div>

          <Tabs defaultValue={defaultTab} className="w-full">
            <div className="border-b border-border/60 p-3">
              <TabsList className="grid h-11 w-full grid-cols-2 bg-background/40">
                <TabsTrigger value="ado" className="font-semibold">
                  ADO ({organizations.filter((organization) => organization.sourceType === "ado").length})
                </TabsTrigger>
                <TabsTrigger value="jira" className="font-semibold">
                  Jira ({organizations.filter((organization) => organization.sourceType === "jira").length})
                </TabsTrigger>
              </TabsList>

              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search organizations..."
                  className="h-11 border-border/60 bg-background/30 pl-9"
                />
              </div>
            </div>

            <TabsContent value="ado" className="m-0">
              <div className="px-4 pt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                ADO Organizations
              </div>
              <ScrollArea className="h-[320px] px-3 pb-3 pt-2">
                <div className="space-y-2">
                  {adoOrganizations.length > 0 ? (
                    adoOrganizations.map((organization) => {
                      const isSelected = selectedOrganizationId === organization.id;

                      return (
                        <button
                          key={organization.id}
                          type="button"
                          onClick={() => handleSelect(organization.id)}
                          className={`flex w-full items-center gap-4 rounded-xl border px-3 py-3 text-left transition-colors ${
                            isSelected
                              ? "border-sky-500/25 bg-sky-500/10"
                              : "border-transparent hover:border-border/50 hover:bg-background/40"
                          }`}
                        >
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400">
                            <VscAzureDevops className="h-6 w-6" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[15px] font-bold text-foreground">
                              {organization.name}
                            </div>
                            <div className="mt-0.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                              {getSourceSubtitle("ado")}
                            </div>
                          </div>
                          {isSelected ? (
                            <Check className="h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" />
                          ) : null}
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
                      No ADO organizations match your search.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="jira" className="m-0">
              <div className="px-4 pt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Jira Organizations
              </div>
              <ScrollArea className="h-[320px] px-3 pb-3 pt-2">
                <div className="space-y-2">
                  {jiraOrganizations.length > 0 ? (
                    jiraOrganizations.map((organization) => {
                      const isSelected = selectedOrganizationId === organization.id;

                      return (
                        <button
                          key={organization.id}
                          type="button"
                          onClick={() => handleSelect(organization.id)}
                          className={`flex w-full items-center gap-4 rounded-xl border px-3 py-3 text-left transition-colors ${
                            isSelected
                              ? "border-orange-500/25 bg-orange-500/10"
                              : "border-transparent hover:border-border/50 hover:bg-background/40"
                          }`}
                        >
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400">
                            <SiJira className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[15px] font-bold text-foreground">
                              {organization.name}
                            </div>
                            <div className="mt-0.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                              {getSourceSubtitle("jira")}
                            </div>
                          </div>
                          {isSelected ? (
                            <Check className="h-5 w-5 shrink-0 text-orange-600 dark:text-orange-400" />
                          ) : null}
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground">
                      No Jira organizations match your search.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </PopoverContent>
      </Popover>
    </div>
  );
}
