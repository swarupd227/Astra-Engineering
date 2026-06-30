/**
 * Cognito + Amplify hosted UI.
 * Activates when VITE_AUTH_MODE=amplify OR when DEVX_HOSTING=aws
 * (server exposes hosting via VITE_DEVX_HOSTING at build time).
 */
function isOidcFlagEnabled(): boolean {
  return ["true", "1", "yes", "on"].includes(
    String(import.meta.env.VITE_KEYCLOAK_ENABLED || import.meta.env.VITE_OIDC_ENABLED || "")
      .toLowerCase()
      .trim(),
  );
}

export function isAmplifyAuthMode(): boolean {
  if (isOidcFlagEnabled()) return false;
  if (import.meta.env.VITE_AUTH_MODE === "amplify") return true;
  if (import.meta.env.VITE_AUTH_MODE === "keycloak") return false;
  if (import.meta.env.VITE_AUTH_MODE === "oidc") return false;
  if (import.meta.env.VITE_AUTH_MODE === "msal") return false;
  return import.meta.env.VITE_DEVX_HOSTING === "aws";
}

export function isKeycloakAuthMode(): boolean {
  if (isOidcFlagEnabled()) return true;
  const mode = String(import.meta.env.VITE_AUTH_MODE || "").toLowerCase().trim();
  if (mode === "keycloak" || mode === "oidc") return true;
  if (mode === "msal" || mode === "amplify") return false;
  return false;
}
