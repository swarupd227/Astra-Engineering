import { isAmplifyAuthMode } from "@/lib/auth-mode";
import { addUserInfoToRequest } from "@/utils/api-interceptor";
import {
  addUserInfoToRequestAmplify,
  isAmplifySessionExpired,
} from "@/utils/api-interceptor-amplify";
import { isSessionExpired as isMsalSessionExpired } from "@/utils/api-interceptor";

/** Attach Bearer token and org headers for API calls (MSAL or Cognito). */
export async function addAuthToRequest(
  url: string,
  options: RequestInit = {},
): Promise<RequestInit> {
  return isAmplifyAuthMode()
    ? addUserInfoToRequestAmplify(url, options)
    : addUserInfoToRequest(url, options);
}

export function isAuthSessionExpired(): boolean {
  return isAmplifyAuthMode() ? isAmplifySessionExpired() : isMsalSessionExpired();
}
