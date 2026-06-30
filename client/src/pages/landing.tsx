import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Code2,
  Workflow,
  Database,
  Sparkles,
  Shield,
  Zap,
} from "lucide-react";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { loginRequest } from "@/config/msalConfig";
import { isSessionExpired, resetSessionExpired } from "@/utils/api-interceptor";
import { useEffect, useMemo } from "react";
import { isAmplifyAuthMode } from "@/lib/auth-mode";
import { isKeycloakAuthMode } from "@/lib/auth-mode";
import { useAmplifyAuthOptional } from "@/contexts/amplify-auth-context";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import { getBuildVersionFooterLabel } from "@/lib/build-version-label";
import {
  consumeKeycloakError,
  isKeycloakAuthenticated,
  loginWithKeycloak,
} from "@/utils/keycloak-auth";
const astraLogo = "/astra-logo-sidebar.png";

export default function Landing() {
  const { instance } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const amplifyAuth = useAmplifyAuthOptional();
  const [, setLocation] = useLocation();
  const jiraOnly = useJiraOnlyWorkItems();
  const integrationName = jiraOnly ? "Jira" : "Azure DevOps";
  const signInLabel = isKeycloakAuthMode() ? "Sign In with Keycloak" : "Sign In with Microsoft";

  const isOAuthCallback = useMemo(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    if (params.has("code") && params.has("state")) return true;
    const hash = window.location.hash;
    return hash.includes("code=") && hash.includes("state=");
  }, []);

  const canEnterApp = isAmplifyAuthMode()
    ? !!amplifyAuth?.user
    : isKeycloakAuthMode()
      ? isKeycloakAuthenticated() && !isSessionExpired()
      : isAuthenticated && !isSessionExpired();

  const completingOAuth =
    isOAuthCallback &&
    (isAmplifyAuthMode()
      ? (amplifyAuth?.isLoading ?? true)
      : !canEnterApp);

  // Redirect authenticated users to Overview page ONLY if they're on the landing page (/)
  // This prevents redirects when user is on other routes and page reloads
  // Use window.location.pathname as source of truth to avoid race conditions during reload
  useEffect(() => {
    if (isAmplifyAuthMode() && isOAuthCallback && amplifyAuth?.isLoading) {
      return;
    }
    // Only redirect if:
    // 1. User is authenticated
    // 2. This component is actually mounted (meaning we're on the landing route)
    if (canEnterApp && typeof window !== "undefined") {
      if (isOAuthCallback) {
        const cleanPath =
          window.location.pathname === "/auth/callback"
            ? "/overview"
            : window.location.pathname || "/";
        window.history.replaceState({}, "", cleanPath);
        if (window.location.hash) {
          window.history.replaceState({}, "", cleanPath);
        }
      }
      // Check for intended route in sessionStorage
      const intendedRoute = sessionStorage.getItem("intendedRoute");
      if (intendedRoute && intendedRoute !== "/" && intendedRoute !== "") {
        setLocation(intendedRoute);
        sessionStorage.removeItem("intendedRoute");
        // Debug log
        console.log("[Auth] Restored intended route:", intendedRoute);
        return;
      }
      const currentPath = window.location.pathname;
      // Only redirect if we're actually on the root path
      if (currentPath === "/" || currentPath === "") {
        setLocation("/overview");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEnterApp, amplifyAuth?.isLoading, isOAuthCallback]);

  const handleSignIn = async () => {
    if (isAmplifyAuthMode()) {
      await amplifyAuth?.signInWithMicrosoft();
      return;
    }
    if (isKeycloakAuthMode()) {
      try {
        resetSessionExpired();
        await loginWithKeycloak();
      } catch (error: any) {
        alert(`${error?.message || "Keycloak login failed."}`);
      }
      return;
    }
    try {
      console.log("[MSAL] Starting login redirect from landing page...");
      resetSessionExpired();
      await instance.loginRedirect(loginRequest);
    } catch (error: any) {
      console.error("[MSAL] Login failed - Full error object:", error);
      console.error("[MSAL] Error details:", {
        errorCode: error.errorCode,
        errorMessage: error.errorMessage,
        message: error.message,
        stack: error.stack,
        name: error.name,
        correlationId: error.correlationId,
        subError: error.subError,
      });

      // Build detailed error message
      let errorMessage = "Login failed. ";
      let errorTitle = "Authentication Error";

      if (error.errorCode) {
        errorMessage += `\n\nError Code: ${error.errorCode}`;
      }

      if (error.errorMessage) {
        errorMessage += `\n\nMessage: ${error.errorMessage}`;
      } else if (error.message) {
        errorMessage += `\n\nMessage: ${error.message}`;
      }

      // Check for specific error types
      if (
        error.errorCode === "access_denied" ||
        error.errorCode === "AADSTS65005"
      ) {
        errorTitle = "Access Denied";
        errorMessage = `Access Denied\n\nYour sign-in was successful but you don't have permission to access this application.\n\nError Code: ${error.errorCode}\n\nPossible reasons:\n- Your account is not assigned to this application\n- Conditional access policies are blocking access\n- The application requires admin consent\n\nPlease contact your administrator to grant access to this application.\n\nAdditional details:\n${error.errorMessage || error.message || "No additional details available"}`;
      } else if (error.errorCode === "AADSTS50020") {
        errorTitle = "User Account Not Found";
        errorMessage = `User account not found in the tenant.\n\nError Code: ${error.errorCode}\n\nMessage: ${error.errorMessage || error.message || "The user account does not exist in this Azure AD tenant."}`;
      } else if (
        error.errorCode === "user_cancelled" ||
        error.errorCode === "user_cancel"
      ) {
        errorTitle = "Sign In Cancelled";
        errorMessage = "You cancelled the sign-in process.";
      } else if (error.errorCode === "interaction_required") {
        errorTitle = "Interaction Required";
        errorMessage = `Additional authentication required.\n\nError Code: ${error.errorCode}\n\nMessage: ${error.errorMessage || error.message || "Please try signing in again."}`;
      } else if (error.subError) {
        errorMessage += `\n\nSub Error: ${error.subError}`;
      }

      if (error.correlationId) {
        errorMessage += `\n\nCorrelation ID: ${error.correlationId}`;
      }

      // Show detailed alert
      alert(`${errorTitle}\n\n${errorMessage}`);
    }
  };

  useEffect(() => {
    const keycloakError = consumeKeycloakError();
    if (keycloakError) alert(keycloakError);
  }, []);
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20">
      {/* Hero Section */}
      <div className="container mx-auto px-6 py-20">
        <div className="mx-auto max-w-4xl text-center">
          {/* Logo/Brand */}
          <div className="mb-6 flex items-center justify-center">
            <img
              src={astraLogo}
              alt="Astra Platform"
              className="h-12 w-auto object-contain"
            />
          </div>

          {/* Headline */}
          <h2 className="mb-6 text-5xl font-bold leading-tight tracking-tight lg:text-6xl">
            Streamline Your SDLC with{" "}
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              AI-Powered
            </span>{" "}
            Development
          </h2>

          {/* Subheadline */}
          <p className="mb-10 text-xl text-muted-foreground">
            A multi-tenant platform that transforms requirements into agile
            artifacts, integrates seamlessly with {integrationName}, and accelerates
            your development workflow.
          </p>

          {/* CTA Button */}
          <div className="flex items-center justify-center gap-4">
            {completingOAuth ? (
              <Button size="lg" className="gap-2" disabled data-testid="button-sign-in-pending">
                Completing sign-in…
              </Button>
            ) : canEnterApp ? (
              <Button
                size="lg"
                className="group gap-2"
                data-testid="button-get-started"
                asChild
              >
                <Link href="/overview">
                  Get Started
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
            ) : (
              <Button
                size="lg"
                className="group gap-2"
                data-testid="button-sign-in"
                onClick={handleSignIn}
              >
                {signInLabel}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            )}
            {/* <Button size="lg" variant="outline" data-testid="button-view-demo" asChild>
              <Link href="/overview">
                View Demo
              </Link>
            </Button> */}
          </div>
        </div>

        {/* Features Grid */}
        <div className="mx-auto mt-24 max-w-6xl">
          <h3 className="mb-12 text-center text-3xl font-bold">
            Everything You Need to Build Better Software
          </h3>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {/* Feature 1 */}
            <div className="group rounded-lg border bg-card p-6 transition-all hover-elevate">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <h4 className="mb-2 text-xl font-semibold">
                AI-Powered Workflow
              </h4>
              <p className="text-muted-foreground">
                Transform requirements into detailed epics, features, and user
                stories with our intelligent AI assistant.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="group rounded-lg border bg-card p-6 transition-all hover-elevate">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Database className="h-6 w-6 text-primary" />
              </div>
              <h4 className="mb-2 text-xl font-semibold">
                {integrationName} Integration
              </h4>
              <p className="text-muted-foreground">
                Seamlessly sync with {integrationName} to manage work items,
                repositories, and pipelines.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="group rounded-lg border bg-card p-6 transition-all hover-elevate">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Workflow className="h-6 w-6 text-primary" />
              </div>
              <h4 className="mb-2 text-xl font-semibold">
                SDLC Phase Management
              </h4>
              <p className="text-muted-foreground">
                Track progress through all 6 phases with automated unlocking and
                real-time progress calculation.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="group rounded-lg border bg-card p-6 transition-all hover-elevate">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <h4 className="mb-2 text-xl font-semibold">
                Enterprise Security
              </h4>
              <p className="text-muted-foreground">
                AES-256-GCM encryption for credentials, comprehensive
                validation, and secure data isolation.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="group rounded-lg border bg-card p-6 transition-all hover-elevate">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Code2 className="h-6 w-6 text-primary" />
              </div>
              <h4 className="mb-2 text-xl font-semibold">
                Golden Repository Templates
              </h4>
              <p className="text-muted-foreground">
                Access pre-configured repositories across 5 business domains
                with live ADO integration.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="group rounded-lg border bg-card p-6 transition-all hover-elevate">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <h4 className="mb-2 text-xl font-semibold">
                Real-Time Collaboration
              </h4>
              <p className="text-muted-foreground">
                Multi-tenant architecture with comprehensive Hub features for
                teams and organizations.
              </p>
            </div>
          </div>
        </div>

        {/* Stats Section */}
        <div className="mx-auto mt-24 max-w-5xl rounded-2xl border bg-card/50 p-12">
          <div className="grid gap-12 md:grid-cols-3">
            <div className="text-center">
              <div className="mb-2 text-4xl font-bold text-primary">80%</div>
              <div className="text-muted-foreground">
                Faster Artifact Generation
              </div>
            </div>
            <div className="text-center">
              <div className="mb-2 text-4xl font-bold text-primary">6</div>
              <div className="text-muted-foreground">Automated SDLC Phases</div>
            </div>
            <div className="text-center">
              <div className="mb-2 text-4xl font-bold text-primary">100%</div>
              <div className="text-muted-foreground">
                {integrationName} Compatible
              </div>
            </div>
          </div>
        </div>

        {/* Final CTA */}
        <div className="mx-auto mt-24 max-w-3xl text-center">
          <h3 className="mb-4 text-3xl font-bold">
            Ready to Transform Your Development Process?
          </h3>
          <p className="mb-8 text-lg text-muted-foreground">
            Join teams that are building better software faster with
            Astra Platform.
          </p>
          {canEnterApp ? (
            <Button
              size="lg"
              className="group gap-2"
              data-testid="button-get-started-bottom"
              asChild
            >
              <Link href="/overview">
                Get Started Now
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
          ) : (
            <Button
              size="lg"
              className="group gap-2"
              data-testid="button-sign-in-bottom"
              onClick={handleSignIn}
            >
              {signInLabel}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-6 text-center text-sm text-muted-foreground">
          <p>
            &copy; {new Date().getFullYear()} Astra Platform. Multi-tenant web development platform for
            enterprise teams.
          </p>
          <p className="mt-1 font-mono text-xs opacity-80">
            {getBuildVersionFooterLabel()}
          </p>
        </div>
      </footer>
    </div>
  );
}
