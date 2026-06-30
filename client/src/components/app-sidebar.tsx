import {
  LayoutDashboard,
  FolderGit2,
  GitBranch,
  MessageSquare,
  Building2,
  FolderOpen,
  Settings,
  Layers,
  ChevronDown,
  Package,
  Users,
  FileText,
  Shield,
  RefreshCw,
  Server,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar";
import { Link, useLocation, useSearch } from "wouter";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useMemo, useState } from "react";
import { getBuildVersionFooterLabel } from "@/lib/build-version-label";
import { useQuery } from "@tanstack/react-query";
import { useMsal } from "@azure/msal-react";
import { getApiUrl } from "@/lib/api-config";
import { getUserInfoFromMsalAccount } from "@/utils/msal-user";
import { isFeatureEnabled, type FeatureKey } from "@/lib/features";
import { isAmplifyAuthMode, isKeycloakAuthMode } from "@/lib/auth-mode";
import { useAmplifyAuthOptional } from "@/contexts/amplify-auth-context";
import { getKeycloakAccount, isKeycloakAuthenticated } from "@/utils/keycloak-auth";
import { useHostingConfig } from "@/hooks/use-hosting-config";
import { addUserInfoToRequest } from "@/utils/api-interceptor";
const astraLogo = "/astra-logo-sidebar.png";

type MeRole = {
  role: string;
  scope: string;
  scopeId: string;
  tenantId: string;
  provider: string;
};

type MeResponse = {
  user: {
    id: string;
    email: string;
    displayName?: string | null;
    provider?: string;
  };
  roles: MeRole[];
};

type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  featureKey?: FeatureKey;
};

const foundationModeItems: NavItem[] = [
  {
    title: "SDLC",
    url: "/sdlc",
    icon: GitBranch,
    featureKey: "sdlc",
  },
  {
    title: "Quick Workflow",
    url: "/cio-workflow",
    icon: FileText,
    featureKey: "quick_workflow",
  },
];

const evolutionModeItems: NavItem[] = [
  {
    title: "Modernization",
    url: "/stack-modernization",
    icon: RefreshCw,
    featureKey: "stack_modernization",
  },
];

const configurationItems: NavItem[] = [
  {
    title: "Organizations",
    url: "/organizations",
    icon: Building2,
  },
  {
    title: "Projects",
    url: "/projects",
    icon: FolderOpen,
  },
  {
    title: "Golden Repo",
    url: "/golden-repos",
    icon: FolderGit2,
  },
];

const hubMenuItems = [
  {
    title: "Artifacts",
    url: "/hub/artifacts",
    icon: Package,
  },
  {
    title: "Persona Manager",
    url: "/hub/personas",
    icon: Users,
  },
  {
    title: "Skills",
    url: "/hub/prompts",
    icon: FileText,
  },
];

const helpItems = [
  {
    title: "Ask Astra",
    url: "/chat",
    icon: MessageSquare,
  },
  {
    title: "Provisioning",
    url: "/provisioning",
    icon: Server,
  },
  {
    title: "Instances",
    url: "/instances",
    icon: Server,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const search = useSearch();
  const [hubOpen, setHubOpen] = useState(false);
  const { accounts } = useMsal();
  const account = accounts[0] ?? null;
  const isAmp = isAmplifyAuthMode();
  const isKeycloak = isKeycloakAuthMode();
  const amplifyCtx = useAmplifyAuthOptional();
  const { data: hostingConfig } = useHostingConfig();

  const isAws = hostingConfig?.hosting === "aws";

  const helpItemsFiltered = useMemo(() => {
    if (isAws) {
      return helpItems.filter(
        (i) => i.url !== "/provisioning" && i.url !== "/instances"
      );
    }
    return helpItems;
  }, [isAws]);

  const configItemsFiltered = useMemo(() => {
    return configurationItems;
  }, []);

  const sdlcNavUrl = useMemo(() => {
    const params = new URLSearchParams(search);
    const nextParams = new URLSearchParams();
    const keysToPreserve = [
      "organization",
      "projectId",
      "projectName",
      "organizationUrl",
      "phase",
    ];

    keysToPreserve.forEach((key) => {
      const value = params.get(key);
      if (value) nextParams.set(key, value);
    });

    // Normalize common cross-page param names into SDLC expected params.
    const orgFromAltParam =
      params.get("organizationName") || params.get("organization");
    if (orgFromAltParam && !nextParams.get("organization")) {
      nextParams.set("organization", orgFromAltParam);
    }

    const projectIdFromAltParam =
      params.get("projectId") || params.get("jiraProjectId") || params.get("adoProjectId");
    if (projectIdFromAltParam && !nextParams.get("projectId")) {
      nextParams.set("projectId", projectIdFromAltParam);
    }

    // Some pages keep projectId in route params (path segment), not query params.
    // Preserve project context for sidebar SDLC navigation from those routes too.
    if (!nextParams.get("projectId")) {
      const routePatterns = [
        /^\/test-generation\/([^/?]+)/,
        /^\/test-data-generation\/([^/?]+)/,
        /^\/test-cases-view\/([^/?]+)/,
        /^\/bdd-files-view\/([^/?]+)/,
        /^\/bdd-step-definitions-view\/([^/?]+)/,
        /^\/autonomous-testing\/([^/?]+)/,
        /^\/sdlc\/([^/?]+)\/code-gen/,
      ];

      for (const pattern of routePatterns) {
        const match = location.match(pattern);
        if (match?.[1]) {
          nextParams.set("projectId", decodeURIComponent(match[1]));
          break;
        }
      }
    }

    // Fallback for flows where current route doesn't carry params.
    // Keep this session-scoped only to avoid reviving stale prior-session state.
    if (nextParams.toString() === "" && typeof window !== "undefined") {
      const sessionOrg = window.sessionStorage.getItem(
        "sdlc:selectedOrganization",
      );
      const sessionProjectId = window.sessionStorage.getItem(
        "sdlc:selectedProjectId",
      );
      const sessionProjectName = window.sessionStorage.getItem(
        "sdlc:selectedProjectName",
      );

      if (sessionOrg) nextParams.set("organization", sessionOrg);
      if (sessionProjectId) nextParams.set("projectId", sessionProjectId);
      if (sessionProjectName) nextParams.set("projectName", sessionProjectName);
    }

    const query = nextParams.toString();
    return query ? `/sdlc?${query}` : "/sdlc";
  }, [search, location]);

  const keycloakAccount = isKeycloak ? getKeycloakAccount() : null;
  const authKey = isAmp
    ? amplifyCtx?.user?.sub ?? ""
    : isKeycloak
      ? keycloakAccount?.accountKey ?? ""
      : account?.localAccountId ?? "";
  const authEnabled = isAmp
    ? !!amplifyCtx?.user
    : isKeycloak
      ? isKeycloakAuthenticated()
      : !!account;

  const { data: me } = useQuery<MeResponse | null>({
    queryKey: ["/api/auth/me", authKey],
    enabled: authEnabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async () => {
      const url = getApiUrl("/api/auth/me");
      if ((isAmp && amplifyCtx?.user) || isKeycloak) {
        const options = await addUserInfoToRequest(url, { credentials: "include" });
        const res = await fetch(url, options);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            (err as { message?: string }).message ?? `auth/me ${res.status}`,
          );
        }
        return (await res.json()) as MeResponse;
      }
      if (!account) return null;
      const userInfo = getUserInfoFromMsalAccount(account);
      const azureOid =
        (account.idTokenClaims?.oid as string) ??
        (account.idTokenClaims?.sub as string) ??
        account.localAccountId ??
        account.homeAccountId?.split(".")[0];
      const email = userInfo?.email ?? account.username ?? "";
      const displayName = userInfo?.displayName ?? userInfo?.name ?? "";
      const tenantId =
        account.tenantId ?? (account.idTokenClaims?.tid as string) ?? "";

      const headers = new Headers();
      if (email) headers.set("x-user-email", email);
      if (azureOid) headers.set("x-user-oid", azureOid);
      if (displayName) headers.set("x-user-name", displayName);
      if (tenantId) headers.set("x-tenant-id", tenantId);
      headers.set("x-auth-provider", "azure");

      const res = await fetch(url, {
        credentials: "include",
        headers,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ?? `auth/me ${res.status}`,
        );
      }
      return (await res.json()) as MeResponse;
    },
  });

  // check Admin section role flags and label — used when Admin (TenantAdmin) block is enabled (see commented block below).
  const isTenantAdmin =
    me?.roles?.some((r) => r.role === "TenantAdmin") ?? false;
  const isOrgAdmin = me?.roles?.some((r) => r.role === "OrgAdmin") ?? false;
  const isProjectAdmin =
    me?.roles?.some((r) => r.role === "ProjectAdmin") ?? false;
  const canSeeAdminSection = isTenantAdmin || isOrgAdmin || isProjectAdmin;

  const adminRoleLabels: string[] = [];
  if (isTenantAdmin) adminRoleLabels.push("TenantAdmin");
  if (isOrgAdmin) adminRoleLabels.push("OrgAdmin");
  if (isProjectAdmin) adminRoleLabels.push("ProjectAdmin");
  const adminSectionLabel =
    adminRoleLabels.length > 0
      ? `Admin (${adminRoleLabels.join(", ")})`
      : "Admin";

  const serverFeatures = hostingConfig?.features;

  const checkFeature = (key: FeatureKey): boolean => {
    if (serverFeatures && key in serverFeatures) return !!serverFeatures[key];
    return isFeatureEnabled(key);
  };

  const visibleFoundationItems = foundationModeItems.filter((item) =>
    item.featureKey ? checkFeature(item.featureKey) : true,
  );

  const visibleEvolutionItems = evolutionModeItems.filter((item) =>
    item.featureKey ? checkFeature(item.featureKey) : true,
  );

  return (
    <Sidebar>
      <SidebarHeader className="py-4 pl-4 pr-4">
        <div className="flex h-16 items-center">
          <img
            src={astraLogo}
            alt="Astra"
            className="h-[22px] w-auto shrink-0 object-contain"
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/overview"}>
                  <Link href="/overview" data-testid="link-overview">
                    <LayoutDashboard className="h-4 w-4" />
                    <span>Overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {visibleFoundationItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Foundation Mode</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleFoundationItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={
                        item.title === "SDLC"
                          ? location.startsWith("/sdlc")
                          : location === item.url
                      }
                    >
                      <Link
                        href={item.title === "SDLC" ? sdlcNavUrl : item.url}
                        data-testid={`link-${item.title
                          .toLowerCase()
                          .replace(/\s+/g, "-")}`}
                        onClick={() => {
                          if (item.title === "SDLC") {
                            window.dispatchEvent(new CustomEvent("reset-sdlc-view"));
                          }
                        }}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {visibleEvolutionItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Evolution Mode</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleEvolutionItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link
                        href={item.url}
                        data-testid={`link-${item.title
                          .toLowerCase()
                          .replace(/\s+/g, "-")}`}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Configuration</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {configItemsFiltered.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link
                      href={item.url}
                      data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              <Collapsible open={hubOpen} onOpenChange={setHubOpen}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton data-testid="button-hub-dropdown">
                      <Layers className="h-4 w-4" />
                      <span>Hubs</span>
                      <ChevronDown
                        className={`ml-auto h-4 w-4 transition-transform ${hubOpen ? "rotate-180" : ""}`}
                      />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {hubMenuItems.map((item) => (
                        <SidebarMenuSubItem key={item.title}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={location === item.url}
                          >
                            <Link
                              href={item.url}
                              data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                            >
                              <item.icon className="h-4 w-4" />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {canSeeAdminSection && (
          <SidebarGroup>
            <SidebarGroupLabel>{adminSectionLabel}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {isTenantAdmin && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location === "/admin/user-access"}
                    >
                      <Link
                        href="/admin/user-access"
                        data-testid="link-admin-user-access"
                      >
                        <Shield className="h-4 w-4" />
                        <span>User Access</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/admin/activity-config"}
                  >
                    <Link
                      href="/admin/activity-config"
                      data-testid="link-admin-activity-config"
                    >
                      <Shield className="h-4 w-4" />
                      <span>Activity Configuration</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {isTenantAdmin && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location === "/admin/tenants" || location.startsWith("/admin/tenants/")}
                    >
                      <Link
                        href="/admin/tenants"
                        data-testid="link-admin-tenants"
                      >
                        <Shield className="h-4 w-4" />
                        <span>Subscription</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Help</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {helpItemsFiltered.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link
                      href={item.url}
                      data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/settings" data-testid="link-settings">
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <p
          className="mt-2 px-2 font-mono text-[10px] text-muted-foreground opacity-80"
          title="Build version from pipeline; build date shown for manual apiVersion only"
        >
          {getBuildVersionFooterLabel()}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
