import { useMsal } from "@azure/msal-react";
import { useMemo } from "react";
import { getCurrentUserFromMsalAccounts } from "@/utils/msal-user";

/**
 * Example component showing how to get username and email from MSAL
 */
export function MsalUserExample() {
  const { accounts } = useMsal();

  // Get user info using the utility function
  const userInfo = useMemo(() => {
    return getCurrentUserFromMsalAccounts(accounts);
  }, [accounts]);

  if (!userInfo) {
    return <div>No user logged in</div>;
  }

  return (
    <div>
      <h2>User Information from MSAL</h2>
      <div>
        <p><strong>Username:</strong> {userInfo.username}</p>
        <p><strong>Email:</strong> {userInfo.email}</p>
        <p><strong>Name:</strong> {userInfo.name}</p>
        {userInfo.displayName && (
          <p><strong>Display Name:</strong> {userInfo.displayName}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Alternative: Direct access to MSAL account properties
 */
export function DirectMsalAccessExample() {
  const { accounts } = useMsal();

  const account = accounts[0]; // Get the first (active) account

  if (!account) {
    return <div>No user logged in</div>;
  }

  // Direct access to account properties
  const username = account.username; // Usually the email/UPN
  const name = account.name; // Display name
  const email = 
    account.username || // Usually contains email
    account.idTokenClaims?.email || // Email from ID token claims
    account.idTokenClaims?.preferred_username || // Preferred username (often email)
    "";

  return (
    <div>
      <h2>Direct MSAL Account Access</h2>
      <div>
        <p><strong>Username:</strong> {username}</p>
        <p><strong>Email:</strong> {email}</p>
        <p><strong>Name:</strong> {name}</p>
        <p><strong>Account ID:</strong> {account.homeAccountId}</p>
        <p><strong>Tenant ID:</strong> {account.tenantId}</p>
      </div>
    </div>
  );
}

