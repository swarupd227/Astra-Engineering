import type { ResourcesConfig } from "@aws-amplify/core";

const domainPrefix = import.meta.env.VITE_COGNITO_DOMAIN ?? "";
const region = import.meta.env.VITE_COGNITO_REGION ?? "ap-south-1";

const oauthDomain = domainPrefix.includes(".")
  ? domainPrefix
  : `${domainPrefix}.auth.${region}.amazoncognito.com`;

/** Must match Cognito app client callback URLs exactly (see docs/deployment/EKS_CLIENT_SETUP_GUIDE.md). */
function oauthRedirectUrls(): string[] {
  if (typeof window === "undefined") return [];
  const origin = window.location.origin;
  const urls = new Set<string>([
    `${origin}/auth/callback`,
    `${origin}/auth/callback/`,
    origin,
    `${origin}/`,
  ]);
  return [...urls];
}

/** Sign-out should return to app root only (not /auth/callback). */
function oauthSignOutUrls(): string[] {
  if (typeof window === "undefined") return [];
  const origin = window.location.origin;
  return [origin, `${origin}/`];
}

export const amplifyConfig: ResourcesConfig = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? "",
      userPoolClientId:
        import.meta.env.VITE_COGNITO_APP_CLIENT_ID ??
        import.meta.env.VITE_COGNITO_CLIENT_ID ??
        "",
      loginWith: {
        oauth: {
          domain: oauthDomain,
          // aws.cognito.signin.user.admin required for Hosted UI token refresh (matches Cognito app client).
          scopes: ["openid", "email", "profile", "aws.cognito.signin.user.admin"],
          redirectSignIn: oauthRedirectUrls(),
          redirectSignOut: oauthSignOutUrls(),
          responseType: "code",
        },
      },
    },
  },
};
