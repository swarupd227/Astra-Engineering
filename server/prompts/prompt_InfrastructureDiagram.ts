const promptInfraStructureDiagram = (
    contextSummary: string, 
    featuresList: string,
    cloudProvider: string,
    frontend: string,
    backend: string,
    database: string,
    domain: string
    ): string => { return `




${contextSummary}
**CRITICAL - CREATE INFRASTRUCTURE FOR:**

**Features:**
${featuresList}

**Tech Stack:**
Cloud: ${cloudProvider} | Frontend: ${frontend} | Backend: ${backend} | DB: ${database}

---

# Infrastructure Architecture Diagrams

Generate 6 comprehensive infrastructure diagrams using standard Mermaid syntax wrapped in \`\`\`mermaid ... \`\`\` fenced code blocks.

## 1. System Architecture Overview (15-20 nodes)
\`\`\`mermaid
graph TB
    Users[Users]
    CDN[CDN]
    LB[Load Balancer]
    App1[${backend} Server 1]
    App2[${backend} Server 2]
    DB[(${database})]
    Cache[(Redis)]
    Users --> CDN
    CDN --> LB
    LB --> App1
    LB --> App2
    App1 --> DB
    App2 --> DB
    App1 --> Cache
\`\`\`
- Client → CDN → LB → App → DB → External APIs
- Complete end-to-end flow

**CRITICAL MERMAID SYNTAX RULES — follow exactly or the diagram will fail to parse:**
1. Node IDs must be single words with NO spaces: use WebApp1 not "Web App 1"
2. When a node label contains parentheses ALWAYS wrap in double quotes: WebApp1["Web Application (React)"]
3. One node definition OR one arrow per line — never two node definitions on the same line
4. Database cylinder shape: DB[(${database})] — only use [( for databases
5. Arrow labels use pipes: A -->|label text| B

## 2. ${cloudProvider} Infrastructure Topology (12-18 nodes)
\`\`\`mermaid
graph TB
    subgraph PublicSubnet["Public Subnet"]
        IGW["Internet Gateway"]
        NAT["NAT Gateway"]
        LB["Load Balancer"]
    end
    subgraph PrivateSubnet["Private Subnet (AZ-1)"]
        App1["${backend} Server 1"]
        DB1[(${database} Primary)]
    end
    subgraph PrivateSubnet2["Private Subnet (AZ-2)"]
        App2["${backend} Server 2"]
        DB2[(${database} Replica)]
    end
    IGW --> LB
    LB --> App1
    LB --> App2
    App1 --> DB1
    App2 --> DB2
    DB1 -->|replication| DB2
    App1 --> NAT
    App2 --> NAT
\`\`\`

## 3. Application Deployment (10-15 nodes)
\`\`\`mermaid
graph TB
    Registry["Container Registry"]
    Orchestrator["K8s / ECS Cluster"]
    subgraph Services["Application Services"]
        FE["${frontend} Pod"]
        BE1["${backend} Pod 1"]
        BE2["${backend} Pod 2"]
        Worker["Background Worker"]
    end
    subgraph Data["Data Layer"]
        DB[(${database})]
        Cache["Redis Cache"]
        Queue["Message Queue"]
    end
    Registry --> Orchestrator
    Orchestrator --> FE
    Orchestrator --> BE1
    Orchestrator --> BE2
    Orchestrator --> Worker
    BE1 --> DB
    BE2 --> DB
    BE1 --> Cache
    Worker --> Queue
\`\`\`

## 4. CI/CD Pipeline (10-12 stages)
\`\`\`mermaid
graph LR
    Repo["Git Repository"]
    Build["Build & Test"]
    Lint["Lint & SAST"]
    Docker["Docker Build"]
    DevDeploy["Deploy to Dev"]
    StagingDeploy["Deploy to Staging"]
    ProdApproval["Manual Approval"]
    ProdDeploy["Deploy to Prod"]
    Rollback["Rollback"]
    Repo --> Build
    Build --> Lint
    Lint --> Docker
    Docker --> DevDeploy
    DevDeploy --> StagingDeploy
    StagingDeploy --> ProdApproval
    ProdApproval -->|approved| ProdDeploy
    ProdDeploy -->|failure| Rollback
\`\`\`

## 5. Security & Networking (8-12 nodes)
\`\`\`mermaid
graph TB
    Internet["Internet"]
    WAF["WAF / DDoS Protection"]
    LB["TLS Termination (Load Balancer)"]
    Auth["Auth Service (OAuth / JWT)"]
    Vault["Secrets Vault"]
    App["Application Layer"]
    DB[(${database})]
    Internet --> WAF
    WAF --> LB
    LB --> Auth
    Auth -->|valid token| App
    App --> Vault
    App --> DB
\`\`\`

## 6. Monitoring & Observability (8-10 nodes)
\`\`\`mermaid
graph TB
    App["Application"]
    APM["APM (Traces & Metrics)"]
    Logs["Log Aggregator"]
    Metrics["Metrics Collector"]
    Alerts["Alerting Engine"]
    Dashboard["Dashboard"]
    App --> APM
    App --> Logs
    App --> Metrics
    Metrics --> Alerts
    APM --> Dashboard
    Logs --> Dashboard
    Metrics --> Dashboard
\`\`\`

**MANDATORY for ALL diagrams:**
- Use ${cloudProvider}, ${backend}, ${frontend}, ${database}
- ${domain} domain-specific naming
- Data flows clearly labeled
- HA/scalability patterns
- Return ONLY Markdown (NO \`\`\`markdown wrapper)`};

export { promptInfraStructureDiagram };
