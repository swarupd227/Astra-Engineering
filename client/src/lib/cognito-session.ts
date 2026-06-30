import { fetchAuthSession, signOut } from "aws-amplify/auth";

/** True only when Cognito returned a usable ID token (not just cached username). */
export async function hasValidCognitoIdToken(): Promise<boolean> {
  try {
    const session = await fetchAuthSession();
    return !!session.tokens?.idToken?.toString();
  } catch {
    return false;
  }
}

/**
 * Clear broken Cognito local state (refresh 400 loops). Call after tokenRefresh_failure
 * or when APIs return 401 with no valid session.
 */
export async function clearStaleCognitoSession(): Promise<void> {
  try {
    await signOut();
  } catch {
    /* ignore */
  }
  if (typeof window === "undefined") return;
  try {
    for (const key of Object.keys(localStorage)) {
      if (
        key.startsWith("CognitoIdentityServiceProvider.") ||
        key.includes("amplify") ||
        key.includes("cognito")
      ) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
}
