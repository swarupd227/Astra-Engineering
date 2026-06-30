/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_MODE?: string;
  readonly VITE_DEVX_HOSTING?: string;
  // Azure AD / MSAL (used when VITE_AUTH_MODE=msal)
  readonly VITE_AZURE_AD_CLIENT_ID?: string;
  readonly VITE_AZURE_AD_TENANT_ID?: string;
  readonly VITE_MSAL_REDIRECT_URI?: string;
  // Keycloak / generic OIDC (used when VITE_AUTH_MODE=keycloak)
  readonly VITE_OIDC_ENABLED?: string;
  readonly VITE_OIDC_PROVIDER_ID?: string;
  readonly VITE_OIDC_PROVIDER_NAME?: string;
  readonly VITE_OIDC_AUTHORITY?: string;
  readonly VITE_OIDC_AUTHORIZATION_ENDPOINT?: string;
  readonly VITE_OIDC_LOGOUT_ENDPOINT?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
  readonly VITE_OIDC_REDIRECT_URI?: string;
  readonly VITE_OIDC_SCOPE?: string;
  readonly VITE_OIDC_CLOCK_TOLERANCE_SECONDS?: string;
  readonly VITE_OIDC_PROVIDER_LOGOUT_ENABLED?: string;
  readonly VITE_OIDC_POST_LOGOUT_REDIRECT_URI?: string;
  readonly VITE_KEYCLOAK_ENABLED?: string;
  readonly VITE_KEYCLOAK_PROVIDER_ID?: string;
  readonly VITE_KEYCLOAK_PROVIDER_NAME?: string;
  readonly VITE_KEYCLOAK_AUTHORITY?: string;
  readonly VITE_KEYCLOAK_AUTHORIZATION_ENDPOINT?: string;
  readonly VITE_KEYCLOAK_LOGOUT_ENDPOINT?: string;
  readonly VITE_KEYCLOAK_CLIENT_ID?: string;
  readonly VITE_KEYCLOAK_REDIRECT_URI?: string;
  readonly VITE_KEYCLOAK_SCOPE?: string;
  readonly VITE_KEYCLOAK_CLOCK_TOLERANCE_SECONDS?: string;
  readonly VITE_KEYCLOAK_PROVIDER_LOGOUT_ENABLED?: string;
  readonly VITE_KEYCLOAK_POST_LOGOUT_REDIRECT_URI?: string;
  // Cognito / Amplify (used when VITE_AUTH_MODE=amplify)
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_APP_CLIENT_ID?: string;
  readonly VITE_COGNITO_REGION?: string;
  readonly VITE_COGNITO_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
