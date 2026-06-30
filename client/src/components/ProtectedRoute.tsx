import { Redirect } from "wouter";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { ComponentType } from "react";
import { useEffect, useState } from "react";
import { isAmplifyAuthMode } from "@/lib/auth-mode";
import { isKeycloakAuthMode } from "@/lib/auth-mode";
import { useAmplifyAuthOptional } from "@/contexts/amplify-auth-context";
import { isKeycloakAuthenticated } from "@/utils/keycloak-auth";

interface ProtectedRouteProps {
  component: ComponentType<any>;
  // Kept for route compatibility. Profile setup is now optional and contextual
  // credential prompts are shown where credentials are actually needed.
  skipOnboardingCheck?: boolean;
}

export default function ProtectedRoute({ component: Component }: ProtectedRouteProps) {
  const isAuthenticated = useIsAuthenticated();
  const { inProgress } = useMsal();
  const amplifyAuth = useAmplifyAuthOptional();
  const isAmp = isAmplifyAuthMode();
  const isKeycloak = isKeycloakAuthMode();

  const [hasCheckedAuth, setHasCheckedAuth] = useState(false);

  useEffect(() => {
    if (inProgress === "none") {
      setHasCheckedAuth(true);
    }
  }, [inProgress]);

  // Helper to persist intended route
  const persistIntendedRoute = () => {
    if (typeof window !== "undefined") {
      const currentPath = window.location.pathname + window.location.search;
      if (currentPath !== "/" && currentPath !== "") {
        sessionStorage.setItem("intendedRoute", currentPath);
        // Debug log
        console.log("[Auth] Persisted intended route:", currentPath);
      }
    }
  };

  if (isAmp) {
    // amplifyAuth is null when the global store hasn't published yet (first render).
    // Treat null the same as isLoading:true — do NOT redirect, just wait.
    if (!amplifyAuth || amplifyAuth.isLoading) {
      return null;
    }
    if (!amplifyAuth.user) {
      persistIntendedRoute();
      return <Redirect to="/" />;
    }
    return <Component />;
  }

  if (isKeycloak) {
    if (!isKeycloakAuthenticated()) {
      persistIntendedRoute();
      return <Redirect to="/" />;
    }
    return <Component />;
  }

  if (inProgress !== "none" || !hasCheckedAuth) {
    return null;
  }


  if (!isAuthenticated) {
    persistIntendedRoute();
    return <Redirect to="/" />;
  }

  return <Component />;
}
