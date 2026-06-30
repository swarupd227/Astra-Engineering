# DevX 2.0 - AWS EC2 Deployment Guide

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [How the Pipeline Works](#2-how-the-pipeline-works)
3. [Frontend and Backend Deployment](#3-frontend-and-backend-deployment)
4. [AWS API Gateway Integration](#4-aws-api-gateway-integration)
5. [Security Layer Details](#5-security-layer-details)
6. [Step-by-Step Setup Guide](#6-step-by-step-setup-guide)
7. [Important Limitations and Workarounds](#7-important-limitations-and-workarounds)
8. [Cost Breakdown](#8-cost-breakdown)

---

## 1. Architecture Overview

### High-Level Flow

```
                          INTERNET
                             │
                    ┌────────▼────────┐
                    │  AWS API Gateway │  ← Rate limiting, IP whitelist, Auth check
                    │  (HTTP API)      │
                    └────────┬────────┘
                             │ (Private VPC Link)
                    ┌────────▼────────┐
                    │  EC2 Instance    │
                    │  (t3.medium)     │
                    │  Amazon Linux    │
                    │                  │
                    │  ┌────────────┐  │
                    │  │   Nginx    │  │  ← Reverse proxy (port 80 → 4000)
                    │  └─────┬──────┘  │
                    │        │         │
                    │  ┌─────▼──────┐  │
                    │  │  Node.js   │  │  ← Express server (port 4000)
                    │  │  (PM2)     │  │
                    │  │            │  │
                    │  │ ┌────────┐ │  │
                    │  │ │Frontend│ │  │  ← React SPA (dist/public/)
                    │  │ │(static)│ │  │
                    │  │ └────────┘ │  │
                    │  │ ┌────────┐ │  │
                    │  │ │Backend │ │  │  ← Express API routes (/api/*)
                    │  │ │(API)   │ │  │
                    │  │ └────────┘ │  │
                    │  └────────────┘  │
                    │                  │
                    │  IAM Role ───────┼──→ Secrets Manager
                    │                  │──→ Amazon Bedrock
                    │                  │──→ S3 Bucket
                    └──────────────────┘
                             │
                    ┌────────▼────────┐
                    │  MySQL / Aurora  │
                    └─────────────────┘
```

### How the Request Flows

1. User opens `https://<api-gateway-url>/` in browser
2. AWS API Gateway receives the request
3. API Gateway checks: Is this IP allowed? Is the rate limit exceeded?
4. If allowed, API Gateway forwards to EC2 via VPC Link (private network)
5. Nginx on EC2 receives on port 80, proxies to Node.js on port 4000
6. Node.js checks the path:
   - `/api/*` → handled by Express route handlers (backend logic)
   - Everything else → serves files from `dist/public/` (React frontend)
7. Response flows back: Node.js → Nginx → API Gateway → User's browser

### Why This Architecture

- **Single EC2 instance** serves both frontend and backend (no split deployment)
- **API Gateway** provides security (rate limiting, IP whitelist, auth) without code changes
- **Nginx** handles SSL termination, WebSocket upgrades, and large file uploads
- **PM2** keeps the Node.js process alive and auto-restarts on crash
- **IAM Role** provides credentials for AWS services (no hardcoded keys)

---

## 2. How the Pipeline Works

### Current Azure Pipeline (What Exists)

The existing `azure-pipelines.yml` has a **Build** stage that produces two artifacts:

```
Build Stage (runs on ADO-hosted ubuntu agent)
│
├── BuildFrontend job:
│   ├── npm install
│   ├── vite build (produces dist/public/ with React app)
│   └── Publish artifact: "frontend" (dist/public/ files)
│
└── BuildBackend job:
    ├── npm install
    ├── esbuild (bundles server/index.ts → dist/index.cjs)
    ├── Copy files: dist/, server/assets/fonts/, package.json, package-lock.json, startup.sh
    ├── Archive into zip
    └── Publish artifact: "backend" (zip file)
```

### New Deploy_AWS Stage (What We Add)

After the Build stage succeeds, a new `Deploy_AWS` stage runs:

```
Deploy_AWS Stage (runs on ADO-hosted ubuntu agent)
│
├── Step 1: Download "backend" artifact (the zip)
├── Step 2: Download "frontend" artifact (React build)
├── Step 3: Extract the backend zip
├── Step 4: Merge frontend files into dist/public/ inside the extracted backend
├── Step 5: Run npm ci --production (install only production dependencies)
├── Step 6: Create a tarball (devx-deploy.tar.gz) ~100 MB
├── Step 7: SCP the tarball to EC2 via SSH service connection
└── Step 8: SSH into EC2 and run:
    ├── Stop current app (pm2 stop devx)
    ├── Backup current dist/ folder
    ├── Extract new tarball to /opt/devx/
    ├── Start app (pm2 start dist/index.cjs)
    └── Verify app is running (pm2 status)
```

### Pipeline Trigger

The pipeline triggers when code is pushed to `feature/AWS-and-Jira_Integration`:

```
Push to branch → Build Stage → Deploy_AWS Stage → App live on EC2
                  (~3 min)       (~2 min)
```

Total deployment time: **~5 minutes** from push to live.

### What Happens on the ADO Agent (Build Machine)

The Azure DevOps hosted agent (`ubuntu-latest`) is a temporary virtual machine
that Azure provisions for each pipeline run. It:

1. Checks out your Git repository
2. Installs Node.js 20
3. Runs `npm install` to get all dependencies
4. Runs `vite build` to compile the React frontend into static files
5. Runs `esbuild` to bundle the Express server into a single `dist/index.cjs` file
6. Packages everything into artifacts (zip files)
7. Uses SSH to connect to your EC2 instance and deploy

After the pipeline finishes, the agent VM is destroyed. Nothing persists on it.

---

## 3. Frontend and Backend Deployment

### How Frontend and Backend Are Built

```
Source Code                          Build Output
─────────────────                    ─────────────────

client/src/                          dist/public/
├── App.tsx                          ├── index.html
├── pages/                  ──→      ├── assets/
│   ├── dashboard.tsx       vite     │   ├── index-a1b2c3.js    (all React code, minified)
│   ├── sdlc.tsx            build    │   ├── index-d4e5f6.css   (all styles, minified)
│   └── settings.tsx                 │   └── vendor-g7h8i9.js   (third-party libs)
└── components/                      └── staticwebapp.config.json

server/                              dist/
├── index.ts                         └── index.cjs              (entire server, one file)
├── routes.ts               ──→
├── db.ts                   esbuild
├── services/               bundle
└── integrations/

server/assets/fonts/         ──→     server/assets/fonts/       (copied as-is)
└── LiberationSans-Regular.ttf       └── LiberationSans-Regular.ttf
```

### How They're Served on EC2

Node.js serves BOTH from the same process:

```javascript
// In production mode (dist/index.cjs):
// 1. API routes are registered first
app.get('/api/projects', handler);
app.post('/api/specs/generate', handler);
// ... hundreds of API routes ...

// 2. Then static files are served for everything else
app.use(express.static('dist/public'));

// 3. SPA fallback: any non-API, non-file request returns index.html
// so React Router can handle client-side routing
app.get('*', (req, res) => res.sendFile('dist/public/index.html'));
```

When a browser hits the server:

```
GET /                     → dist/public/index.html (React app loads)
GET /assets/index-a1b.js  → dist/public/assets/index-a1b.js (JS bundle)
GET /sdlc                 → dist/public/index.html (React Router handles /sdlc)
GET /api/projects         → Express route handler (returns JSON)
POST /api/specs/generate  → Express route handler (calls Bedrock, returns JSON)
WS  /socket.io/           → Socket.IO WebSocket connection
```

### The Merged Deployment Package

On the ADO agent, before uploading to EC2, we merge frontend and backend:

```
devx-deploy.tar.gz (~100 MB)
├── dist/
│   ├── index.cjs                    ← Backend (bundled Express server)
│   └── public/                      ← Frontend (React build)
│       ├── index.html
│       ├── assets/
│       └── staticwebapp.config.json
├── server/
│   └── assets/
│       └── fonts/                   ← PDF generation fonts
├── node_modules/                    ← Production dependencies only
├── package.json
└── package-lock.json
```

This single tarball is SCP'd to EC2 and extracted to `/opt/devx/`.

---

## 4. AWS API Gateway Integration

### Why API Gateway

Your Express server already handles authentication internally (JWT validation,
Cognito tokens). API Gateway adds an **outer security perimeter**:

```
Without API Gateway:
  Internet → EC2 (port 80 open to world) → Node.js handles everything

With API Gateway:
  Internet → API Gateway (blocks bad traffic) → EC2 (port 80 closed to internet)
                                                    ↑
                                              Only API Gateway can reach EC2
```

### API Gateway Type: HTTP API (v2)

AWS offers two types of API Gateway:
- **REST API (v1)**: More features, higher cost, 29-second timeout
- **HTTP API (v2)**: Simpler, cheaper, 30-minute timeout with VPC Link

We use **HTTP API** because:
- 30-minute timeout (your spec generation can take several minutes)
- 60% cheaper than REST API
- VPC Link for private connectivity to EC2
- Supports WebSocket via a separate WebSocket API

### How API Gateway Connects to EC2

```
┌─────────────────────────────────────────────────┐
│                    AWS VPC                        │
│                                                   │
│   ┌──────────┐    VPC Link    ┌──────────────┐   │
│   │   API    │───────────────→│  Network Load │   │
│   │ Gateway  │   (private)    │  Balancer     │   │
│   │ (HTTP)   │                │  (NLB)        │   │
│   └──────────┘                └──────┬───────┘   │
│                                      │            │
│                               ┌──────▼───────┐   │
│                               │  EC2 Instance │   │
│                               │  port 80      │   │
│                               │  (Nginx)      │   │
│                               └──────────────┘   │
│                                                   │
└───────────────────────────────────────────────────┘
```

- **VPC Link**: A private tunnel from API Gateway to your VPC (no internet exposure)
- **Network Load Balancer (NLB)**: Required by VPC Link, routes traffic to EC2
- **EC2 Security Group**: Only allows traffic FROM the NLB (not from the internet)

### What the User Sees

```
User's URL:  https://abc123xyz.execute-api.ap-south-1.amazonaws.com

This URL:
1. Has HTTPS by default (API Gateway provides free SSL)
2. All /api/* requests pass through rate limiting and auth checks
3. All other requests (frontend) are also served through the same gateway
4. WebSocket connections go through a separate WebSocket API endpoint
```

### WebSocket Handling

API Gateway HTTP API does NOT natively proxy WebSocket connections. Two approaches:

**Option A (Recommended for now): Dual endpoint**
- API Gateway handles all HTTP requests (frontend + API)
- WebSocket connects directly to EC2's Elastic IP on a separate port (e.g., 4001)
- EC2 Security Group allows port 4001 from anywhere (just for WebSocket)

**Option B (Full API Gateway): Separate WebSocket API**
- Create a second API Gateway (WebSocket API type)
- Configure $connect, $disconnect, $default routes
- Requires Lambda functions to relay messages
- More complex, better for production

For your first deployment, Option A is simpler and works fine.

---

## 5. Security Layer Details

### Layer 1: Rate Limiting (API Gateway Throttling)

API Gateway provides built-in throttling:

```
Default limits (configurable):
  - 10,000 requests per second (burst)
  - 5,000 requests per second (sustained)

Per-route limits (via Usage Plans):
  /api/specs/generate     → 10 requests/minute  (expensive LLM calls)
  /api/codegen/generate   → 10 requests/minute  (expensive LLM calls)
  /api/*                  → 100 requests/minute  (general API)
  /*                      → 1000 requests/minute (frontend assets)
```

If the limit is exceeded, API Gateway returns `429 Too Many Requests` before the
request ever reaches your EC2 instance.

### Layer 2: IP Whitelisting (Resource Policy)

API Gateway resource policies can restrict access to specific IP addresses:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:*:*:*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": [
            "203.0.113.0/24",
            "198.51.100.0/24"
          ]
        }
      }
    }
  ]
}
```

Requests from non-whitelisted IPs get `403 Forbidden` instantly.

Note: IP whitelisting is only available on REST API (v1), not HTTP API (v2).
If you need IP whitelisting, we use REST API or add AWS WAF in front of HTTP API.

### Layer 3: Authentication Check (Lambda Authorizer)

A Lambda authorizer runs BEFORE your request reaches EC2:

```
Request with token → API Gateway → Lambda Authorizer → EC2
                                        │
                                        ├── Valid token? → Forward to EC2
                                        └── Invalid/missing? → Return 401
```

The Lambda authorizer can:
- Validate Cognito JWT tokens
- Check if the user exists in your database
- Add custom headers (user ID, tenant ID) before forwarding

For your initial deployment, this is OPTIONAL because your Express server
already validates tokens via `requireAuth` middleware. The Lambda authorizer
would be a defense-in-depth addition.

### Layer 4: AWS WAF (Web Application Firewall)

WAF can be attached to API Gateway for advanced protection:

```
WAF Rules:
  - Block SQL injection attempts
  - Block XSS (cross-site scripting) patterns
  - Geographic restrictions (block countries)
  - IP reputation lists (block known bad IPs)
  - Rate-based rules (per-IP throttling)
```

WAF costs ~$5/month + $0.60 per million requests. This is the recommended way
to get IP whitelisting with HTTP API.

### Security Summary

```
Layer              What It Does                       Status
──────────────────────────────────────────────────────────────
API Gateway        HTTPS, throttling, routing         Required
WAF                IP whitelist, SQL injection block   Recommended
Lambda Authorizer  Pre-auth token validation           Optional (app already does this)
EC2 Security Group Only allows traffic from NLB/VPC    Required
IAM Role           AWS service access (no keys)        Required
Secrets Manager    All secrets encrypted at rest        Already implemented
```

---

## 6. Step-by-Step Setup Guide

### Phase 1: EC2 Instance (15 minutes)

**Step 1.1: Launch EC2**
1. AWS Console → EC2 → Launch Instance
2. Name: `DevX-Server`
3. AMI: Amazon Linux 2023
4. Instance type: `t3.medium`
5. Key pair: Create new → `devx-ec2-key` → Download `.pem`
6. Network: Select your default VPC, a public subnet
7. Security Group: Create new, name it `devx-ec2-sg`:
   - SSH (22) from your IP only
   - HTTP (80) from NLB security group (we'll update this later)
   - Custom TCP (4001) from anywhere (WebSocket, optional)
8. Storage: 20 GB gp3
9. Advanced → IAM instance profile: Create/select role with:
   - `SecretsManagerReadWrite`
   - `AmazonBedrockFullAccess`
   - `AmazonS3FullAccess`
10. Launch

**Step 1.2: Allocate Elastic IP**
1. EC2 → Elastic IPs → Allocate
2. Associate with `DevX-Server`
3. Note the IP: `___.___.___.___ `

**Step 1.3: SSH and Setup**
```bash
ssh -i devx-ec2-key.pem ec2-user@<elastic-ip>

# System packages
sudo dnf update -y
sudo dnf install -y gcc-c++ make git

# Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# PM2
sudo npm install -g pm2

# Chromium dependencies
sudo dnf install -y nss atk at-spi2-atk cups-libs libdrm \
  libXcomposite libXdamage libXrandr pango alsa-lib \
  libxkbcommon mesa-libgbm gtk3 liberation-fonts

# Nginx
sudo dnf install -y nginx
sudo systemctl enable nginx

# App directory
sudo mkdir -p /opt/devx
sudo chown ec2-user:ec2-user /opt/devx

# PM2 auto-start on boot
pm2 startup systemd -u ec2-user --hp /home/ec2-user
# Run the sudo command it outputs
```

**Step 1.4: Configure Nginx**
```bash
sudo tee /etc/nginx/conf.d/devx.conf > /dev/null << 'NGINX'
server {
    listen 80 default_server;
    server_name _;
    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
    }
}
NGINX

sudo rm -f /etc/nginx/conf.d/default.conf
sudo nginx -t
sudo systemctl start nginx
```

**Step 1.5: Create Bootstrap .env**
```bash
cat > /opt/devx/.env << 'EOF'
DEVX_HOSTING=aws
AWS_SECRET_NAME=devx/platform/qa
AWS_REGION=ap-south-1
NODE_ENV=production
PORT=4000
EOF
```

### Phase 2: API Gateway + VPC Link (20 minutes)

**Step 2.1: Create a Network Load Balancer (NLB)**
1. EC2 → Load Balancers → Create → Network Load Balancer
2. Name: `devx-nlb`
3. Scheme: Internal
4. VPC: Same VPC as your EC2
5. Mappings: Select the subnet(s) where EC2 runs
6. Target Group:
   - Name: `devx-ec2-tg`
   - Protocol: TCP, Port: 80
   - Target type: Instance
   - Register your EC2 instance
   - Health check: TCP port 80
7. Create

**Step 2.2: Create VPC Link**
1. API Gateway Console → VPC Links → Create
2. Name: `devx-vpc-link`
3. Target: Select the NLB (`devx-nlb`)
4. Wait for status: "Available" (takes 2-5 minutes)

**Step 2.3: Create HTTP API**
1. API Gateway → Create API → HTTP API
2. Name: `devx-api`
3. Add integration:
   - Type: Private resource
   - Target: VPC Link → `devx-vpc-link`
   - Invoke URL: `http://<nlb-dns-name>`
4. Routes:
   - `ANY /{proxy+}` → VPC Link integration (catches all requests)
   - `ANY /` → VPC Link integration (catches root)
5. Stage: `$default` (auto-deploy enabled)
6. Create

**Step 2.4: Configure Throttling**
1. API Gateway → devx-api → Routes
2. For each route, set throttling:
   - Default: 100 requests/second burst, 50 sustained
3. Or attach a Usage Plan with specific limits per route

**Step 2.5: Add WAF (for IP Whitelisting)**
1. AWS WAF Console → Create Web ACL
2. Name: `devx-waf`
3. Resource type: API Gateway
4. Associate with: `devx-api`
5. Add rules:
   - IP Set rule: Create IP set with allowed IPs → Action: Allow
   - Default action: Block (blocks everything not in IP set)
   - AWS Managed Rules: Core rule set (blocks SQLi, XSS)
6. Create

**Step 2.6: Update EC2 Security Group**
1. EC2 → Security Groups → `devx-ec2-sg`
2. Edit inbound rules:
   - Remove: HTTP (80) from 0.0.0.0/0
   - Add: HTTP (80) from NLB's subnet CIDR (e.g., 10.0.0.0/16) or NLB security group
3. This ensures EC2 port 80 is ONLY reachable via the NLB/API Gateway, not directly

### Phase 3: Azure DevOps Pipeline (10 minutes)

**Step 3.1: Create SSH Service Connection in ADO**
1. Azure DevOps → Project Settings → Service connections → New → SSH
2. Host: Your EC2 Elastic IP
3. Port: 22
4. Username: `ec2-user`
5. Private key: Paste contents of `devx-ec2-key.pem`
6. Connection name: `devx-aws-ec2`

**Step 3.2: Add Pipeline Variables**
In the `DevX-Environment-Config` variable group or a new group:
- `ec2SshConnection`: `devx-aws-ec2`
- `ec2AppPath`: `/opt/devx`

**Step 3.3: Update azure-pipelines.yml**
Add `feature/AWS-and-Jira_Integration` to the branch trigger list.
Add the `Deploy_AWS` stage (code changes done by the assistant).

**Step 3.4: Push and Verify**
1. Push the branch to Azure DevOps
2. Pipeline triggers automatically
3. Build stage runs (~3 minutes)
4. Deploy_AWS stage runs (~2 minutes)
5. App is live at: `https://<api-gateway-id>.execute-api.<region>.amazonaws.com`

### Phase 4: Verification (5 minutes)

**Test the deployment:**
```
1. Open the API Gateway URL in browser → React app should load
2. Log in → Cognito/auth should work
3. Navigate to SDLC → Projects should load from MySQL
4. Generate specs → Bedrock should respond
5. Check Settings → Third-Party Integrations tab should show Datadog/ServiceNow
6. Push to Jira → Should work with configured tokens
```

---

## 7. Important Limitations and Workarounds

### API Gateway Payload Limit: 10 MB

API Gateway (both REST and HTTP) has a **10 MB maximum payload** for request and response.

**Impact on your app:**
- `express.json` is configured for 50 MB (`MAX_REQUEST_BODY_SIZE`)
- Stack modernization file uploads can be up to 500 MB
- Large spec generation responses could exceed 10 MB

**Workaround:**
- For file uploads > 10 MB: Use S3 presigned URLs (client uploads directly to S3,
  server processes from S3)
- For large responses: Paginate or stream results
- For now: Most normal operations (BRD generation, code gen, Jira push) are well under 10 MB

### API Gateway Timeout: 30 Minutes (HTTP API)

HTTP API with VPC Link supports up to 30-minute timeout. Your longest operations
(spec generation, automated testing) typically take 2-10 minutes, so this is fine.

### WebSocket Connections

HTTP API does not proxy WebSocket. Options:
- **Simple**: Allow direct WebSocket to EC2 on port 4001 (bypass API Gateway)
- **Full**: Create a separate WebSocket API in API Gateway (complex)

For initial deployment, the simple approach works. Progress tracking (Socket.IO)
connects directly to EC2.

### Cold Start After Deployment

After each deployment, the first request takes longer because:
- Node.js loads all 132 dependencies
- Secrets Manager is queried
- Database connection is established
- FAISS initializes

This is a one-time ~5 second delay after each deploy, not an ongoing issue.

---

## 8. Cost Breakdown

### Monthly Cost Estimate (Single Environment)

```
Service                              Monthly Cost
───────────────────────────────────────────────────
EC2 t3.medium (on-demand)           $30.37
Elastic IP (attached)               $0.00 (free while attached)
EBS 20 GB gp3                       $1.60
API Gateway HTTP API                $1.00/million requests (~$1-3)
NLB (hourly + LCU)                  $16.43 + ~$5 data
WAF (Web ACL + rules)               $6.00 + $0.60/million requests
Data Transfer (first 100 GB)        $0.00 (free tier)
───────────────────────────────────────────────────
Total (estimated):                  ~$60-65/month
```

### Cost Without API Gateway + WAF (Basic Setup)

If you skip API Gateway and access EC2 directly via Elastic IP:

```
EC2 t3.medium                       $30.37
Elastic IP                          $0.00
EBS 20 GB                           $1.60
───────────────────────────────────────────────────
Total:                              ~$32/month
```

### Cost Saving Tips
- Use **EC2 Reserved Instance** (1-year commitment): ~$19/month (37% savings)
- Use **EC2 Savings Plan**: ~$21/month (30% savings)
- Start without API Gateway, add it later when needed

---

## Summary

```
What                        How
──────────────────────────────────────────────────────────
Code repo                   Azure DevOps Git
CI/CD Pipeline              Azure DevOps Pipelines (existing)
Build agent                 ADO-hosted ubuntu-latest
Build artifact              tarball (~100 MB) with frontend + backend + node_modules
Deployment method           SCP + SSH to EC2
Frontend hosting            Express static middleware on EC2
Backend hosting             Express API server on EC2 (same process)
Process manager             PM2 (auto-restart, boot startup)
Reverse proxy               Nginx on EC2 (port 80 → 4000)
Security gateway            AWS API Gateway (HTTP API) + WAF
Private connectivity        VPC Link + NLB
Secrets                     AWS Secrets Manager (loaded at startup)
AI/LLM                      Amazon Bedrock (via IAM role)
Storage                     S3 (via IAM role)
Database                    MySQL/Aurora (connection string from Secrets Manager)
SSL/HTTPS                   Free via API Gateway
Domain                      API Gateway auto-generated URL
```
