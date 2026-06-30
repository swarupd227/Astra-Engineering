import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { BrandingProvider } from "@/contexts/BrandingContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { QELayout } from "@/components/layout";
import LandingPage from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import VisualRegressionPage from "@/pages/visual-regression";
import FunctionalTesting from "@/pages/functional-testing";
import SprintAgentV2 from "@/pages/sprint-agent-v2";
import SessionHistory from "@/pages/session-history";
import ReplaySession from "@/pages/replay-session";
import ProjectHistory from "@/pages/project-history";
import CodeReviewPage from "@/pages/code-review";
import RAGTestingPage from "@/pages/rag-testing";
import CICDIntegrationPage from "@/pages/cicd-integration";
import PerformanceTestingPage from "@/pages/performance-testing";
import SecurityTestingPage from "@/pages/security-testing";
import TeamCollaborationPage from "@/pages/team-collaboration";
import AccessibilityTestingPage from "@/pages/accessibility-testing";
import AgentConfigurations from "@/pages/agent-configurations";
import FrameworkConfig from "@/pages/framework-config";
import IntegrationConfigPage from "@/pages/integration-config";
import ExecutionModePage from "@/pages/execution-mode";
import SyntheticDataPage from "@/pages/synthetic-data";
import ReportsPage from "@/pages/reports";
import ImportExportPage from "@/pages/import-export";
import SettingsPage from "@/pages/settings";
import HelpPage from "@/pages/help";
import ProductTourPage from "@/pages/product-tour";
import NRadiVersePage from "@/pages/nradiverse";
import NRadiVerseVisualRegressionPage from "@/pages/nradiverse-visual-regression";
import NRadiVerseAccessibilityPage from "@/pages/nradiverse-accessibility";
import NRadiVerseResponsivePage from "@/pages/nradiverse-responsive";
import NRadiVersePixelComparisonPage from "@/pages/nradiverse-pixel-comparison";
import NRadiVerseSSRSPowerBIPage from "@/pages/nradiverse-ssrs-powerbi";
import NRadiVerseAPITestingPage from "@/pages/nradiverse-api-testing";
import NRadiVerseMigrationPage from "@/pages/nradiverse-migration";
import JavaMigrationPage from "@/pages/java-migration";
import NRadiVerseICUStreamingPage from "@/pages/nradiverse-icu-streaming";
import ArchitectureDiagramPage from "@/pages/architecture-diagram";
import RecorderPage from "@/pages/recorder";
import TestLibraryPage from "@/pages/test-library";
import TestManagementPage from "@/pages/test-management";
import CoveragePage from "@/pages/coverage";
import NotFound from "@/pages/not-found";

const basePath = "/qe";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const [, setLocation] = useLocation();
  const isAuthenticated = localStorage.getItem("isAuthenticated") === "true";

  useEffect(() => {
    if (!isAuthenticated) {
      setLocation("/landing");
    }
  }, [isAuthenticated, setLocation]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <QELayout>
      <Component />
    </QELayout>
  );
}

function RootRedirect() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const isAuthenticated = localStorage.getItem("isAuthenticated") === "true";
    if (isAuthenticated) {
      setLocation("/dashboard");
    } else {
      setLocation("/landing");
    }
  }, [setLocation]);

  return null;
}

function QERouter() {
  return (
    <Switch>
      <Route path="/landing" component={LandingPage} />
      <Route path="/" component={RootRedirect} />
      <Route path="/dashboard">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      <Route path="/visual-regression">
        {() => <ProtectedRoute component={VisualRegressionPage} />}
      </Route>
      <Route path="/functional-testing">
        {() => <ProtectedRoute component={FunctionalTesting} />}
      </Route>
      <Route path="/sprint-agent">
        {() => <ProtectedRoute component={SprintAgentV2} />}
      </Route>
      <Route path="/history">
        {() => <ProtectedRoute component={SessionHistory} />}
      </Route>
      <Route path="/projects">
        {() => <ProtectedRoute component={ProjectHistory} />}
      </Route>
      <Route path="/replay/:id">
        {() => <ProtectedRoute component={ReplaySession} />}
      </Route>
      <Route path="/code-review">
        {() => <ProtectedRoute component={CodeReviewPage} />}
      </Route>
      <Route path="/rag-testing">
        {() => <ProtectedRoute component={RAGTestingPage} />}
      </Route>
      <Route path="/cicd-integration">
        {() => <ProtectedRoute component={CICDIntegrationPage} />}
      </Route>
      <Route path="/performance-testing">
        {() => <ProtectedRoute component={PerformanceTestingPage} />}
      </Route>
      <Route path="/security-testing">
        {() => <ProtectedRoute component={SecurityTestingPage} />}
      </Route>
      <Route path="/team-collaboration">
        {() => <ProtectedRoute component={TeamCollaborationPage} />}
      </Route>
      <Route path="/accessibility-testing">
        {() => <ProtectedRoute component={AccessibilityTestingPage} />}
      </Route>
      <Route path="/framework-config">
        {() => <ProtectedRoute component={FrameworkConfig} />}
      </Route>
      <Route path="/integration-management">
        {() => <ProtectedRoute component={AgentConfigurations} />}
      </Route>
      <Route path="/integration-management/:platform">
        {() => <ProtectedRoute component={IntegrationConfigPage} />}
      </Route>
      <Route path="/execution-mode">
        {() => <ProtectedRoute component={ExecutionModePage} />}
      </Route>
      <Route path="/synthetic-data">
        {() => <ProtectedRoute component={SyntheticDataPage} />}
      </Route>
      <Route path="/reports">
        {() => <ProtectedRoute component={ReportsPage} />}
      </Route>
      <Route path="/import-export">
        {() => <ProtectedRoute component={ImportExportPage} />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute component={SettingsPage} />}
      </Route>
      <Route path="/help">
        {() => <ProtectedRoute component={HelpPage} />}
      </Route>
      <Route path="/product-tour" component={ProductTourPage} />
      <Route path="/nradiverse">
        {() => <ProtectedRoute component={NRadiVersePage} />}
      </Route>
      <Route path="/nradiverse/visual-regression">
        {() => <ProtectedRoute component={NRadiVerseVisualRegressionPage} />}
      </Route>
      <Route path="/nradiverse/accessibility">
        {() => <ProtectedRoute component={NRadiVerseAccessibilityPage} />}
      </Route>
      <Route path="/nradiverse/responsive">
        {() => <ProtectedRoute component={NRadiVerseResponsivePage} />}
      </Route>
      <Route path="/nradiverse/pixel-comparison">
        {() => <ProtectedRoute component={NRadiVersePixelComparisonPage} />}
      </Route>
      <Route path="/nradiverse/ssrs-powerbi">
        {() => <ProtectedRoute component={NRadiVerseSSRSPowerBIPage} />}
      </Route>
      <Route path="/nradiverse/api-testing">
        {() => <ProtectedRoute component={NRadiVerseAPITestingPage} />}
      </Route>
      <Route path="/nradiverse/migration">
        {() => <ProtectedRoute component={NRadiVerseMigrationPage} />}
      </Route>
      <Route path="/nradiverse/java-migration">
        {() => <ProtectedRoute component={JavaMigrationPage} />}
      </Route>
      <Route path="/nradiverse/icu-streaming">
        {() => <ProtectedRoute component={NRadiVerseICUStreamingPage} />}
      </Route>
      <Route path="/architecture">
        {() => <ProtectedRoute component={ArchitectureDiagramPage} />}
      </Route>
      <Route path="/recorder">
        {() => <ProtectedRoute component={RecorderPage} />}
      </Route>
      <Route path="/test-library">
        {() => <ProtectedRoute component={TestLibraryPage} />}
      </Route>
      <Route path="/test-management">
        {() => <ProtectedRoute component={TestManagementPage} />}
      </Route>
      <Route path="/coverage">
        {() => <ProtectedRoute component={CoveragePage} />}
      </Route>
      <Route path="/remote-agents">
        {() => { const [, setLocation] = useLocation(); useEffect(() => { setLocation("/settings"); }, []); return null; }}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isFromDevX = params.get("source") === "devx" || params.get("fromDevX") === "true";

    if (isFromDevX) {
      localStorage.setItem("isAuthenticated", "true");
    }

    const isAuthenticated = localStorage.getItem("isAuthenticated") === "true";
    if (!isAuthenticated && location !== "/landing") {
      setLocation("/landing");
    } else if (isAuthenticated && (location === "/landing" || location === "/")) {
      setLocation("/dashboard");
    }
  }, [location, setLocation]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <QERouter />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrandingProvider>
            <ProjectProvider>
              <WouterRouter base={basePath}>
                <TooltipProvider>
                  <Toaster />
                  <AppContent />
                </TooltipProvider>
              </WouterRouter>
            </ProjectProvider>
          </BrandingProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
