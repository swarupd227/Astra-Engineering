import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as HotToaster } from "react-hot-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { DomainProvider } from "@/contexts/domain-context";
import { SDLCProjectProvider } from "@/context/sdlc-project-context";
import { SettingsProvider } from "@/contexts/settings-context";
import { GoldenRepoSelectionProvider } from "@/contexts/golden-repo-selection-context";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Organizations from "@/pages/organizations";
import Projects from "@/pages/projects";
import GoldenRepos from "@/pages/golden-repos";
import GoldenRepoPreview from "@/pages/golden-repo-preview";
import CloudIntegration from "@/pages/cloud-integration";
import Workflow from "@/pages/workflow";
import SDLCPage from "@/pages/sdlc";
import SpecsPage from "@/pages/specs";
import ConversationalUI from "@/pages/conversational-ui";
import BRDGeneratorPage from "@/pages/brd";
import CodeGenPage from "@/pages/code-gen";
import Settings from "@/pages/settings";
import HubArtifacts from "@/pages/hub-artifacts";
import HubIntegrations from "@/pages/hub-integrations";
import HubKnowledgeBase from "@/pages/hub-knowledge-base";
import HubPersonas from "@/pages/hub-personas";
import HubPrompts from "@/pages/hub-prompts";
import Help from "@/pages/help";
import NotFound from "@/pages/not-found";
import AdminUserAccessPage from "@/pages/admin-user-access";
import TestGenerationPage from "@/pages/test-generation";
import TestDataGenerationPage from "@/pages/test-data-generation";
import TestCasesViewPage from "@/pages/test-cases-view";
import BDDFilesViewPage from "@/pages/bdd-files-view";
import BDDStepDefinitionsViewPage from "@/pages/bdd-step-definitions-view";
import AutonomousTestingPage from "@/pages/autonomous-testing";
import ApiTestingPage from "@/pages/api-testing";
import cioPage from "@/pages/cio-workflow";
import UniversalAgentPage from "@/pages/universal-agent";
import AdminActivityConfigPage from "@/pages/admin-activity-config";
import AdminTenantsPage from "@/pages/admin-tenants";
import AdminTenantDetailPage from "@/pages/admin-tenant-detail";
import StackModernizationPage from "@/pages/stack-modernization";
import StackModernizationV2Page from "@/pages/stack-modernization-v2";
import PipelineStudioPage from "@/pages/pipeline-studio";
import ProjectIntegrationsPage from "@/pages/project-integrations";
import ProfileSetup from "@/pages/profile-setup";
import ConnectJira from "@/pages/connect-jira";
import ProtectedRoute from "../src/components/ProtectedRoute";
import AdminProtectedRoute from "../src/components/AdminProtectedRoute";
import { AuthProvider } from "../src/contexts/auth-context";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import FloatingChatWidget from "@/components/FloatingChatWidget";
import { ProcessingStatusProvider } from "@/contexts/processing-status-context";
import { JiraReconnectBanner } from "@/components/jira-reconnect-banner";
import { NotificationBell } from "@/components/notification-bell";
import { useMe } from "@/hooks/use-me";
import { OrganizationSwitcher } from "@/components/organization-switcher";
import { useQuery } from "@tanstack/react-query";
import { useMsal } from "@azure/msal-react";
import { getApiUrl } from "@/lib/api-config";
import { getUserInfoFromMsalAccount } from "@/utils/msal-user";
import { addUserInfoToRequest } from "@/utils/api-interceptor";
import { MfaVerificationDialog } from "./components/mfa-verification-dialog";
import ProvisioningPage from "@/pages/provisioning/ProvisioningPage";
import InstancesListPage from "@/pages/instances/InstancesListPage";
import InstanceDetailsPage from "@/pages/instances/InstanceDetailsPage";
import { SelectedOrganizationProvider } from "@/contexts/selected-organization-context";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />

      <Route path="/profile-setup">
        <ProtectedRoute component={ProfileSetup} skipOnboardingCheck />
      </Route>

      <Route path="/connect-jira">
        <ProtectedRoute component={ConnectJira} />
      </Route>

      <Route path="/overview">
        <ProtectedRoute component={Dashboard} />
      </Route>

      <Route path="/organizations">
        <ProtectedRoute component={Organizations} />
      </Route>

      <Route path="/projects">
        <ProtectedRoute component={Projects} />
      </Route>

      <Route path="/golden-repos">
        <ProtectedRoute component={GoldenRepos} />
      </Route>

      <Route path="/golden-repos/preview">
        <ProtectedRoute component={GoldenRepoPreview} />
      </Route>

      <Route path="/cloud-integration">
        <ProtectedRoute component={CloudIntegration} />
      </Route>

      <Route path="/workflow">
        <ProtectedRoute component={Workflow} />
      </Route>

      <Route path="/specs">
        <ProtectedRoute component={SpecsPage} />
      </Route>

      <Route path="/universal-agent">
        <ProtectedRoute component={UniversalAgentPage} />
      </Route>

      <Route path="/sdlc">
        <ProtectedRoute component={SDLCPage} />
      </Route>

      <Route path="/sdlc/metrics/:projectId">
        <ProtectedRoute component={ProjectIntegrationsPage} />
      </Route>
      
      <Route path="/pipeline-studio">
        <ProtectedRoute component={PipelineStudioPage} />
      </Route>

      <Route path="/stack-modernization">
        <ProtectedRoute component={StackModernizationPage} />
      </Route>

      <Route path="/stack-modernization/:type">
        <ProtectedRoute component={StackModernizationPage} />
      </Route>

      <Route path="/stack-modernization-v2">
        <ProtectedRoute component={StackModernizationV2Page} />
      </Route>

      <Route path="/test-generation/:projectId">
        <ProtectedRoute component={TestGenerationPage} />
      </Route>

      <Route path="/test-data-generation/:projectId?">
        <ProtectedRoute component={TestDataGenerationPage} />
      </Route>

      <Route path="/test-cases-view/:projectId">
        <ProtectedRoute component={TestCasesViewPage} />
      </Route>

      <Route path="/bdd-files-view/:projectId">
        <ProtectedRoute component={BDDFilesViewPage} />
      </Route>

      <Route path="/bdd-step-definitions-view/:projectId">
        <ProtectedRoute component={BDDStepDefinitionsViewPage} />
      </Route>

      <Route path="/autonomous-testing">
        <ProtectedRoute component={AutonomousTestingPage} />
      </Route>

      <Route path="/api-testing/:projectId?">
        <ProtectedRoute component={ApiTestingPage} />
      </Route>

      <Route path="/sdlc/:projectId/code-gen">
        <ProtectedRoute component={CodeGenPage} />
      </Route>
      
      <Route path="/code-gen">
        <ProtectedRoute component={CodeGenPage} />
      </Route>

      <Route path="/chat">
        <ProtectedRoute component={ConversationalUI} />
      </Route>

            <Route path="/provisioning">
        <ProtectedRoute component={ProvisioningPage} />
      </Route>

      <Route path="/instances">
        <ProtectedRoute component={InstancesListPage} />
      </Route>

      <Route path="/instances/:id">
        <ProtectedRoute component={InstanceDetailsPage} />
      </Route>
 

      <Route path="/brd">
        <ProtectedRoute component={BRDGeneratorPage} />
      </Route>

      <Route path="/hub/artifacts">
        <ProtectedRoute component={HubArtifacts} />
      </Route>

      <Route path="/hub/integrations">
        <ProtectedRoute component={HubIntegrations} />
      </Route>

      <Route path="/hub/knowledge-base">
        <ProtectedRoute component={HubKnowledgeBase} />
      </Route>

      <Route path="/hub/personas">
        <ProtectedRoute component={HubPersonas} />
      </Route>

      <Route path="/hub/prompts">
        <ProtectedRoute component={HubPrompts} />
      </Route>

      <Route path="/cio-workflow">
        <ProtectedRoute component={cioPage} />
      </Route>

      <Route path="/settings">
        <ProtectedRoute component={Settings} />
      </Route>


      <Route path="/admin/user-access">
        <AdminProtectedRoute component={AdminUserAccessPage} />
      </Route>

      <Route path="/admin/activity-config">
        <AdminProtectedRoute
          component={AdminActivityConfigPage}
          allowedRoles={["TenantAdmin", "OrgAdmin", "ProjectAdmin"]}
        />
      </Route>

      <Route path="/admin/tenants">
        <AdminProtectedRoute component={AdminTenantsPage} />
      </Route>

      <Route path="/admin/tenants/:tenantId">
        <AdminProtectedRoute component={AdminTenantDetailPage} />
      </Route>

      <Route path="/help">
        <ProtectedRoute component={Help} />
      </Route>

      {/* Fallback */}
      <Route component={NotFound} />
    </Switch>
  );
}

function AppHeader() {
  const { data: me } = useMe();
  return (
    <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
      <MfaVerificationDialog user={me?.user} />
      <div className="flex items-center gap-4">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
      </div>
      <div className="flex items-center gap-3">
        <OrganizationSwitcher />
        <NotificationBell userId={me?.user?.id} />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

function App() {
  const [location] = useLocation();
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <SelectedOrganizationProvider>
            <DomainProvider>
              <SDLCProjectProvider>
                <GoldenRepoSelectionProvider>
                  <ThemeProvider defaultTheme="dark">
                    <ProcessingStatusProvider>
                    <TooltipProvider>
                    <Switch>
                      {/* Landing page - no sidebar */}
                      <Route path="/">
                        <AppErrorBoundary>
                          <Landing />
                        </AppErrorBoundary>
                      </Route>

                      <Route path="/auth/callback">
                        <AppErrorBoundary>
                          <Landing />
                        </AppErrorBoundary>
                      </Route>

                      {/* All other routes - with sidebar */}
                      <Route>
                        <SidebarProvider style={style as React.CSSProperties}>
                          <div className="flex h-screen w-full">
                            <AppSidebar />
                            <div className="flex flex-1 flex-col min-w-0">
                              <AppHeader />
                              <JiraReconnectBanner />
                              <main className="flex-1 overflow-y-auto overflow-x-hidden">
                                <AppErrorBoundary key={location}>
                                  <Router />
                                </AppErrorBoundary>
                              </main>
                            </div>
                          </div>
                        </SidebarProvider>
                      </Route>
                    </Switch>
                    <FloatingChatWidget />
                    <Toaster />
                    <HotToaster
                      position="top-right"
                      toastOptions={{
                        duration: 3000,
                        style: {
                          background: "hsl(var(--background))",
                          color: "hsl(var(--foreground))",
                          border: "1px solid hsl(var(--border))",
                        },
                      }}
                    />
                    </TooltipProvider>
                    </ProcessingStatusProvider>
                  </ThemeProvider>
                </GoldenRepoSelectionProvider>
              </SDLCProjectProvider>
            </DomainProvider>
          </SelectedOrganizationProvider>
        </SettingsProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
