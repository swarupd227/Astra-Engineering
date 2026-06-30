# DevX on EKS — MSAL Login (Where to Configure)

**Auth mode:** Direct Microsoft Entra ID (MSAL) — not Cognito.

---

## Where each setting lives

| What | Where | Keys |
|------|--------|------|
| **Login (browser)** — client ID & tenant | **AWS Secrets Manager** (`devx/platform/qa`) | `AZURE_AD_CLIENT_ID`, `AZURE_AD_TENANT_ID` |
| **API (server)** — validate tokens | Same secret | `DEVX_AUTH_MODE=msal`, `AZURE_AD_CLIENT_ID` |
| **Database** | Same secret | `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` |
| **Entra redirect URI** | **Azure Portal** → App registration → Authentication | `https://<your-cloudfront-or-alb-url>/` |

On pod start the app loads Secrets Manager, then the browser calls **`GET /api/auth/msal-config`** to get Entra IDs (no pipeline build vars required).

**Optional fallback:** `VITE_AZURE_AD_CLIENT_ID` / `VITE_AZURE_AD_TENANT_ID` in the Azure DevOps pipeline Docker build if you prefer build-time config.

---

## Secrets Manager JSON (example)

```json
{
  "DEVX_AUTH_MODE": "msal",
  "AZURE_AD_CLIENT_ID": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "AZURE_AD_TENANT_ID": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "MYSQL_HOST": "your-aurora-cluster.region.rds.amazonaws.com",
  "MYSQL_PORT": "3306",
  "MYSQL_USER": "devxadmin",
  "MYSQL_PASSWORD": "your-password",
  "MYSQL_DATABASE": "devx_prod"
}
```

After updating Secrets Manager: **restart pods** or redeploy (`helm upgrade`).

---

## Azure Entra (one-time)

1. App registration → **SPA** platform  
2. Redirect URI: your public URL root, e.g. `https://d20yf69hjpkbfu.cloudfront.net/`  
3. API permission: `Microsoft Graph` → `User.Read`

---

## Verify

### 1. API returns MSAL config

```bash
curl -s https://<your-url>/api/auth/msal-config
```

Expect:

```json
{
  "clientId": "<guid>",
  "tenantId": "<guid>",
  "authMode": "msal"
}
```

If `503` → missing keys in Secrets Manager.

### 2. Browser console

After opening the app:

```text
[Auth] MSAL config from server (Secrets Manager)
[Auth] MSAL/Azure AD mode active
```

Login URL must **not** contain `undefined` or empty `client_id=`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `login.microsoftonline.com/undefined` | Add `AZURE_AD_CLIENT_ID` + `AZURE_AD_TENANT_ID` to Secrets Manager; restart pods |
| `/api/auth/msal-config` 503 | Same — keys missing in SM |
| Login works, API 401 | Set `DEVX_AUTH_MODE=msal` and `AZURE_AD_CLIENT_ID` in SM |
| Redirect error from Microsoft | Add exact CloudFront/ALB URL in Entra SPA redirect URIs |

---

## Related

- Database migration: [CLIENT_DATABASE_QUICK_START.md](./CLIENT_DATABASE_QUICK_START.md)
