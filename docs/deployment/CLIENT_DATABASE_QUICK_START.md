# DevX — Database Setup (Client Quick Start)

**Goal:** Set up the DevX database **automatically** when you deploy.  
**You do not** need to run SQL files (`01_schema.sql`, `02_seed.sql`, etc.) by hand.

---

## What happens when you deploy

```text
Deploy DevX  →  Database migration runs automatically  →  App starts  →  Users log in (SSO)
```

The application container includes the full database schema (**173 tables**) and applies it to your MySQL / Aurora database on startup or on deploy (see options below).

---

## Before first deploy (one-time)

### Step 1 — Create an empty database

Ask your DBA to create a database on Aurora MySQL, for example:

```sql
CREATE DATABASE devx_prod
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
```

### Step 2 — Save database credentials in secrets

Store these in **AWS Secrets Manager** and/or your **Kubernetes secret** (e.g. `devx-runtime-env`):

| Key | Example |
|-----|---------|
| `MYSQL_HOST` | `your-cluster.region.rds.amazonaws.com` |
| `MYSQL_PORT` | `3306` |
| `MYSQL_USER` | `devxadmin` |
| `MYSQL_PASSWORD` | *(your password)* |
| `MYSQL_DATABASE` | `devx_prod` |

### Step 3 — Network

Ensure your **EKS cluster** can reach **RDS** (security groups / VPC).

---

## On every deploy (what you run)

### Step 4 — Deploy DevX (normal release)

Use your usual process:

- Build & push Docker image to ECR  
- Run `helm upgrade --install` (or your Azure Pipeline)

**That’s it.** Migrations run as part of deploy — no separate DBA script step.

---

## Two ways migrations run (pick one)

### Option A — Recommended for EKS (default)

Migrations run in a **one-time Job** before app pods start.

**Helm settings (already default):**

```yaml
migrations:
  runAsJob: true
  seed: "true"
```

**You run:** `helm upgrade --install` only.

**Check it worked:**

```bash
kubectl get jobs -n devx
kubectl logs -n devx job/devx-db-migrate-<revision>
```

---

### Option B — On every container start

If you require migrations **inside the app container** on start, set these environment variables on the Deployment:

```yaml
RUN_DB_MIGRATIONS: "true"
RUN_DB_SEED: "true"
```

And in Helm:

```yaml
migrations:
  runAsJob: false
  runOnPodStart: true
```

**Note:** For production with multiple replicas, Option A is safer.

---

## Already created some tables earlier?

**No problem.** You do **not** need to drop the database.

- Existing tables are kept  
- Missing tables are added automatically  
- Deploy the same way as above  

After deploy, you should have **~173 tables**.

---

## After deploy — quick verification

### 1. Database (optional — DBA)

```sql
-- Table count (expect ~173)
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema = 'devx_prod';

-- Seed data
SELECT code, name FROM subscription_types;
SELECT id, name FROM roles;
```

### 2. Application

- Open DevX in the browser  
- Log in with SSO (Azure AD / Cognito)  
- Open **Settings** and **Projects** — no database errors  

### 3. Re-deploy test

Deploy again. Migrations should **skip** already-applied steps (fast, no errors).

---

## What is created automatically vs at login

| Created by migration | Created at first login / in app |
|----------------------|----------------------------------|
| All 173 tables | Users |
| Roles | Tenants / organizations |
| Subscription types | Projects |
| Default personas | License / tenant setup |

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| Migration Job failed | `kubectl logs` on migration job; verify `MYSQL_*` in secret |
| Cannot connect to DB | RDS security group; EKS → RDS network |
| Fewer than 173 tables | Re-check job logs; contact DevX support |
| App works but no users | Normal — users are created on **SSO login** |

---

## Summary — what the client runs

| When | Who | Action |
|------|-----|--------|
| Once | DBA | Create empty database |
| Once | DevOps | Put `MYSQL_*` in secrets |
| Once | DevOps | Allow EKS → RDS network |
| Every release | DevOps | Deploy app (`helm upgrade` / pipeline) |
| Never | Anyone | Manual SQL migration scripts |

---

## Need more detail?

- **MSAL login on EKS:** [CLIENT_MSAL_EKS_SETUP.md](./CLIENT_MSAL_EKS_SETUP.md)
- Full DB guide: [CLIENT_DATABASE_MIGRATION_GUIDE.md](./CLIENT_DATABASE_MIGRATION_GUIDE.md)

---

*DevX 2.0 — Database auto-migration at deploy / container startup*
