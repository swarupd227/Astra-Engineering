# SSO User Bootstrap & RBAC

This module implements automatic user persistence and default role assignment for SSO-authenticated users (Azure AD and GitHub).

## Overview

When a user successfully authenticates via Microsoft SSO or GitHub OAuth:
1. User information is extracted from the authentication token
2. User record is created in the `users` table if it doesn't exist
3. Default "Viewer" role is assigned at organization scope if user has no roles
4. All operations are idempotent and safe to run on every login

## Features

- ✅ Automatic user creation on SSO login
- ✅ Default Viewer role assignment for new users
- ✅ Support for Azure AD and GitHub OAuth
- ✅ Idempotent operations (safe to run multiple times)
- ✅ RBAC-ready with user_roles table
- ✅ Organization-based role scoping

## Database Schema

### Users Table (Extended)
- `azure_oid` - Azure AD Object ID (unique identifier for Azure users)
- `github_id` - GitHub user ID (unique identifier for GitHub users)
- `email` - User email address
- `display_name` - User display name
- `tenant_id` - Azure AD Tenant ID
- `provider` - Authentication provider ('azure' or 'github')
- `password` - Made nullable (SSO users don't have passwords)

### User Roles Table (New)
- `user_id` - Foreign key to users table
- `role` - Role name ('Viewer', 'OrgAdmin', 'ProjectAdmin', etc.)
- `scope` - Role scope ('org', 'project', 'global')
- `scope_id` - Organization ID, Project ID, or reserved value **`ALL`**

**Reserved `scope_id` value: `ALL`**  
When `scope_id = 'ALL'`, the role applies to all organizations (if `scope_type = 'org'`) or all projects (if `scope_type = 'project'`). No database migration is required: the column remains `VARCHAR(36)`; `'ALL'` is stored as a literal. Any permission checks that compare `scope_id` to a specific org or project should treat `'ALL'` as matching.

## API Endpoints

### POST `/api/auth/bootstrap-user`

Bootstrap a user after successful SSO login. Call this from the frontend after MSAL/GitHub OAuth login.

**Request Body:**
```json
{
  "tokenClaims": {
    "oid": "azure-object-id",
    "email": "user@example.com",
    "name": "User Name",
    "tid": "tenant-id"
  },
  "provider": "azure" // or "github"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user-uuid",
    "email": "user@example.com",
    "displayName": "User Name",
    "provider": "azure"
  }
}
```

### GET `/api/auth/me`

Get current user information and roles.

**Query Parameters:**
- `email` - User email (optional)
- `azureOid` - Azure Object ID (optional)
- `provider` - Provider type (optional)

**Response:**
```json
{
  "user": {
    "id": "user-uuid",
    "email": "user@example.com",
    "displayName": "User Name",
    "provider": "azure"
  },
  "roles": [
    {
      "role": "Viewer",
      "scope": "org",
      "scopeId": "org-uuid"
    }
  ]
}
```

## Frontend Integration

### Azure AD (MSAL)

After successful MSAL login, call the bootstrap endpoint:

```typescript
import { useMsal } from "@azure/msal-react";

const { instance, accounts } = useMsal();

async function handleLogin() {
  try {
    const response = await instance.loginPopup(loginRequest);
    const account = response.account;
    
    // Extract token claims
    const tokenClaims = account?.idTokenClaims;
    
    // Bootstrap user on backend
    await fetch("/api/auth/bootstrap-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenClaims,
        provider: "azure"
      })
    });
  } catch (error) {
    console.error("Login failed:", error);
  }
}
```

### GitHub OAuth

After successful GitHub OAuth, call the bootstrap endpoint:

```typescript
async function handleGitHubLogin(githubUser: any) {
  await fetch("/api/auth/bootstrap-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenClaims: githubUser,
      provider: "github"
    })
  });
}
```

## Middleware

### Auto-Bootstrap Middleware

The `autoBootstrapUser` middleware automatically bootstraps users when user info is detected in:
- Request body (`tokenClaims`, `userInfo`, or direct fields)
- Query parameters (`email`, `azureOid`, etc.)
- Custom headers (`x-user-email`, `x-user-oid`, etc.)

**Usage:**
```typescript
import { autoBootstrapUser } from "./auth/middleware";

app.use("/api", autoBootstrapUser);
```

### Require Authentication

Use `requireAuth` middleware on protected routes:

```typescript
import { requireAuth } from "./auth/middleware";

app.get("/api/protected", requireAuth, (req, res) => {
  // req.user is available here
  res.json({ user: req.user });
});
```

### Require Role

Use `requireRole` middleware to enforce role-based access:

```typescript
import { requireRole } from "./auth/middleware";

app.post("/api/admin/action", requireRole(["OrgAdmin", "ProjectAdmin"]), (req, res) => {
  // Only users with OrgAdmin or ProjectAdmin role can access
});
```

## Default Role Assignment

When a new user is created:
1. System checks if user has any existing roles
2. If no roles exist, assigns "Viewer" role at organization scope
3. Organization is resolved from `tenant_id` or uses default organization
4. Role assignment is idempotent (won't duplicate if already exists)

## Constraints

- ✅ Does NOT overwrite existing users
- ✅ Does NOT overwrite existing roles
- ✅ Does NOT auto-assign elevated roles (OrgAdmin, ProjectAdmin)
- ✅ Only assigns Viewer as default role
- ✅ All operations are safe to run on every login

## Database Migration

Run the migration script to update the database schema:

```bash
mysql -h <host> -u <user> -p <database> < migrations/manual/add-sso-user-bootstrap-migration.sql
```

Or use the migration runner:
```bash
node migrations/scripts/run-migration-nodejs.ts migrations/manual/add-sso-user-bootstrap-migration.sql
```

## Testing

1. **Test Azure SSO:**
   - Login via MSAL
   - Call `/api/auth/bootstrap-user` with token claims
   - Verify user is created in `users` table
   - Verify Viewer role is assigned in `user_roles` table

2. **Test GitHub OAuth:**
   - Login via GitHub OAuth
   - Call `/api/auth/bootstrap-user` with GitHub user info
   - Verify user is created with `provider='github'`
   - Verify Viewer role is assigned

3. **Test Idempotency:**
   - Call bootstrap endpoint multiple times with same user
   - Verify no duplicate users or roles are created

4. **Test Role Assignment:**
   - Create user manually with existing role
   - Call bootstrap endpoint
   - Verify default Viewer role is NOT assigned (user already has roles)

## Troubleshooting

### User not created
- Check that `email` is provided in token claims
- Check that `azureOid` (for Azure) or `githubId` (for GitHub) is provided
- Check database connection and migration status

### Default role not assigned
- Check that user has no existing roles (bootstrap only assigns if user has zero roles)
- Check that organizations table has at least one organization
- Check database logs for errors

### Migration errors
- Ensure MySQL version supports `IF NOT EXISTS` syntax
- For older MySQL versions, remove `IF NOT EXISTS` and handle errors manually
- Check that `users` table exists before running migration
