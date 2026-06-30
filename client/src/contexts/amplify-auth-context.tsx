import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  getCurrentUser,
  signInWithRedirect,
  signOut,
  fetchAuthSession,
  fetchUserAttributes,
} from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { clearStaleCognitoSession, hasValidCognitoIdToken } from "@/lib/cognito-session";
import { resetAmplifySessionExpired } from "@/utils/api-interceptor-amplify";
import { queryClient } from "@/lib/queryClient";

export type AmplifyAuthUser = {
  sub: string;
  email: string;
  name: string;
  displayName?: string;
};

export type AmplifyAuthContextValue = {
  user: AmplifyAuthUser | null;
  isLoading: boolean;
  signInWithMicrosoft: () => Promise<void>;
  signOutApp: () => Promise<void>;
};

// ── Global reactive store (survives Vite module duplication) ──
const STORE = Symbol.for("devx-amplify-auth-store");
const LISTENERS = Symbol.for("devx-amplify-auth-listeners");

type StoreShape = AmplifyAuthContextValue;
const g = globalThis as any;
if (!g[LISTENERS]) g[LISTENERS] = new Set<() => void>();

// Pre-seed the store with isLoading:true so that getSnapshot() never returns
// null during the async auth-restoration window on page refresh.
// Without this, ProtectedRoute sees null and treats it as "unauthenticated",
// causing a false redirect to "/" before loadUser() has a chance to resolve.
if (g[STORE] === undefined) {
  g[STORE] = {
    user: null,
    isLoading: true,
    signInWithMicrosoft: async () => {
      await signInWithRedirect({ provider: { custom: "Microsoft" } });
    },
    signOutApp: async () => {
      await signOut();
      sessionStorage.removeItem("mfa_verified");
    },
  } as StoreShape;
}

function getSnapshot(): StoreShape | null {
  return g[STORE] ?? null;
}

function subscribe(onStoreChange: () => void): () => void {
  (g[LISTENERS] as Set<() => void>).add(onStoreChange);
  return () => (g[LISTENERS] as Set<() => void>).delete(onStoreChange);
}

function publish(value: StoreShape) {
  g[STORE] = value;
  (g[LISTENERS] as Set<() => void>).forEach((l) => l());
}

// Require a valid ID token — getCurrentUser() alone can be true with stale/broken refresh tokens.
async function loadUser(): Promise<AmplifyAuthUser | null> {
  try {
    const hasToken = await hasValidCognitoIdToken();
    if (!hasToken) return null;

    const cognitoUser = await getCurrentUser();
    let email = "";
    let name = "";
    let displayName: string | undefined;

    try {
      const attributes = await fetchUserAttributes();
      email = attributes.email || "";
      name = attributes.name || attributes.email || "";
      displayName = attributes.name || undefined;
    } catch {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      if (idToken) {
        const payload = idToken.payload as Record<string, any>;
        email = payload.email || payload["cognito:username"] || "";
        name = payload.name || email;
        displayName = payload.name || undefined;
      }
    }

    if (!email) return null;

    return {
      sub: cognitoUser.userId,
      email,
      name: name || email,
      displayName,
    };
  } catch (err) {
    console.warn("[Auth] loadUser failed:", err);
    return null;
  }
}

// ── Provider ──
export function AmplifyAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AmplifyAuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const u = await loadUser();
    setUser(u);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refreshUser();
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      switch (payload.event) {
        case "signedIn":
          resetAmplifySessionExpired();
          refreshUser();
          break;
        case "signedOut":
          resetAmplifySessionExpired();
          setUser(null);
          setIsLoading(false);
          queryClient.removeQueries({ queryKey: ["/api/global-organizations"] });
          break;
        case "tokenRefresh":
          refreshUser();
          break;
        case "signInWithRedirect_failure":
        case "tokenRefresh_failure":
          console.error("[Auth] Cognito session error:", payload.event, payload.data);
          void clearStaleCognitoSession();
          setUser(null);
          setIsLoading(false);
          break;
      }
    });
    return unsubscribe;
  }, [refreshUser]);

  const signInWithMicrosoft = useCallback(async () => {
    try {
      const existing = await loadUser();
      if (existing) {
        setUser(existing);
        setIsLoading(false);
        return;
      }
    } catch {
      /* not signed in — proceed to redirect */
    }
    await signInWithRedirect({ provider: { custom: "Microsoft" } });
  }, []);

  const signOutApp = useCallback(async () => {
    await signOut();
    resetAmplifySessionExpired();
    setUser(null);
    sessionStorage.removeItem("mfa_verified");
    queryClient.removeQueries({ queryKey: ["/api/global-organizations"] });
  }, []);

  const value: AmplifyAuthContextValue = {
    user,
    isLoading,
    signInWithMicrosoft,
    signOutApp,
  };

  useEffect(() => {
    publish(value);
  });

  return <>{children}</>;
}

// ── Hook (works across module duplicates via Symbol.for global) ──
export function useAmplifyAuthOptional(): AmplifyAuthContextValue | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}
