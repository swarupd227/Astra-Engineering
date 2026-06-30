// const promptComponentDiagram = (
    const generateComponentDiagramPagee = (
    featuresList: string,
    domain: string, 
    techStr: string,
    contextSummary: string
): string  => `
  
${contextSummary}

**CRITICAL - MAP FEATURES TO COMPONENTS:**

**Features (Map to Technical Components):**
${featuresList}

**Tech Stack:**
${techStr || 'React, Node.js, Express, MySQL'}

---

# Component Diagrams

Generate comprehensive component diagrams using standard Mermaid syntax wrapped in \`\`\`mermaid ... \`\`\` fenced code blocks.

**Structure (Create 4 detailed diagrams):**
## 1. High-Level System Architecture
\`\`\`mermaid
graph TB
    subgraph Client["Client Layer"]
        Web[Web App]
        Mobile[Mobile App]
    end
    subgraph App["Application Layer"]
        API[API Gateway]
        Services[Business Services]
    end
    subgraph Data["Data Layer"]
        DB[(Database)]
        Cache[(Cache)]
    end
    Web --> API
    Mobile --> API
    API --> Services
    Services --> DB
    Services --> Cache
\`\`\`
- Show all layers (15-20 components)
- External integrations
- Component dependencies

## 2. Frontend Component Breakdown
- UI modules mapped to features
- State management
- Routing components
- Shared libraries

## 3. Backend Service Components
- API controllers per feature
- Business logic services
- Domain models
- Middleware

## 4. Data Access & Integration Layer
- Repositories per domain entity
- Database connections
- External API clients
- Message queues

**Component Naming:**
- Map each feature to specific components
- Use ${domain} terminology
- Include tech stack (e.g., React components, Express routes, MySQL repositories)

**MANDATORY:**
- Components from features (NOT "Component1")
- Use actual tech stack: ${techStr}
- Show layers: Presentation, Application, Domain, Infrastructure
- Each diagram 12-20 components
- Return ONLY Markdown (NO \`\`\`markdown wrapper)`;

// export { promptComponentDiagram }
export { generateComponentDiagramPagee };