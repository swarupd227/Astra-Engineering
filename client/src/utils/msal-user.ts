import { AccountInfo } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { useAmplifyAuthOptional } from "@/contexts/amplify-auth-context";
import { isAmplifyAuthMode } from "@/lib/auth-mode";
import { isKeycloakAuthMode } from "@/lib/auth-mode";
import { getKeycloakAccount } from "@/utils/keycloak-auth";

export type SessionIdentity = {
  aadObjectId: string;
  userName: string;
  userEmail: string;
  displayName?: string;
  homeAccountId?: string;
  tenantId?: string;
};

/**
 * Unified hook: returns session identity from MSAL (Azure) or Amplify (AWS).
 */
export function useSessionIdentity(): SessionIdentity | null {
  const { accounts } = useMsal();
  const amplifyAuth = useAmplifyAuthOptional();
  const isAmp = isAmplifyAuthMode();
  const isKeycloak = isKeycloakAuthMode();

  if (isKeycloak) {
    const account = getKeycloakAccount();
    if (!account) return null;
    return {
      aadObjectId: account.subject,
      userName: account.email,
      userEmail: account.email,
      displayName: account.displayName,
      tenantId: account.provider,
    };
  }

  if (isAmp && amplifyAuth?.user) {
    return {
      aadObjectId: amplifyAuth.user.sub || amplifyAuth.user.email || "",
      userName: amplifyAuth.user.email || "",
      userEmail: amplifyAuth.user.email || "",
      displayName: amplifyAuth.user.name || amplifyAuth.user.email || "",
    };
  }

  return getSessionUserIdentity(accounts[0] ?? null);
}

/**
 * Extract user information from MSAL account
 * 
 * @param account - MSAL AccountInfo object
 * @returns Object containing username and email, or null if account is invalid
 */
export function getUserInfoFromMsalAccount(account: AccountInfo | null | undefined): {
  username: string;
  email: string;
  name: string;
  displayName?: string;
} | null {
  if (!account) {
    return null;
  }

  // MSAL AccountInfo properties:
  // - username: Usually the user's email/UPN (User Principal Name)
  // - name: Display name of the user
  // - idTokenClaims: Contains additional claims including 'email', 'preferred_username', etc.
  
  const email = 
    account.username || // Usually contains the email/UPN
    (account.idTokenClaims?.email as string) || // Email claim from ID token
    (account.idTokenClaims?.preferred_username as string) || // Preferred username (often email)
    (account.idTokenClaims?.upn as string) || // User Principal Name (often email)
    "";

  const username = 
    account.username || // Primary username/UPN
    (account.idTokenClaims?.preferred_username as string) ||
    (account.idTokenClaims?.upn as string) ||
    email || // Fallback to email if username not available
    "";

  const name = 
    account.name || // Display name
    (account.idTokenClaims?.name as string) || // Name claim from ID token
    username || // Fallback to username if name not available
    "";

  const displayName = 
    account.name ||
    (account.idTokenClaims?.name as string) ||
    undefined;

  return {
    username,
    email,
    name,
    displayName,
  };
}

/**
 * Hook-like function to get current user info from MSAL accounts array
 * 
 * @param accounts - Array of MSAL AccountInfo objects (from useMsal hook)
 * @returns User info object or null if no account found
 */
export function getCurrentUserFromMsalAccounts(
  accounts: AccountInfo[]
): ReturnType<typeof getUserInfoFromMsalAccount> {
  const account = accounts[0]; // Get the first (active) account
  return getUserInfoFromMsalAccount(account);
}

/**
 * Session API user identity – aadObjectId, userName, userEmail for session/backend calls.
 * Use with useMsal().accounts and pass to session APIs.
 */
export function getSessionUserIdentity(account: AccountInfo | null | undefined): {
  aadObjectId: string;
  userName: string;
  userEmail: string;
  displayName?: string;
  homeAccountId?: string;
  tenantId?: string;
} | null {
  if (!account) return null;
  const info = getUserInfoFromMsalAccount(account);
  if (!info) return null;
  // Azure AD: localAccountId is typically the object id; fallback to homeAccountId split
  const aadObjectId =
    account.localAccountId ||
    (account.homeAccountId?.split?.(".")?.[0] ?? "");
  if (!aadObjectId) return null;
  return {
    aadObjectId,
    userName: info.username,
    userEmail: info.email,
    displayName: info.displayName ?? info.name,
    homeAccountId: account.homeAccountId,
    tenantId: account.tenantId,
  };
}
