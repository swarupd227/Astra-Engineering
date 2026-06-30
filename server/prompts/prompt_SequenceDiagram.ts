const sequenceDiagramPage= (
  contextSummary: string,
  userStories: any[],
  storiesSample: string,
  domain: string,
  featuresList: string,
  personas: { name: string }[]
): string => `
         


${contextSummary}

**CRITICAL - CREATE ONE SEQUENCE DIAGRAM PER USER STORY:**

**User Stories (Create ${Math.min(userStories.length, 8)} diagrams):**
${storiesSample}

**Features (System Components):**
${featuresList}

---

# Sequence Diagrams

Generate comprehensive sequence diagrams using standard Mermaid syntax wrapped in \`\`\`mermaid ... \`\`\` fenced code blocks.

**Structure: ONE detailed diagram PER user story above**

For each user story, create:

## Story X: [Title]

\`\`\`mermaid
sequenceDiagram
    participant Actor as ${personas[0]?.name || 'User'}
    participant UI as Frontend
    participant API as ${domain}API
    participant Service as ${domain}Service
    participant DB as Database
    
    Actor->>UI: initiates action
    UI->>API: POST /api/endpoint
    API->>Service: process()
    Service->>DB: query/update
    DB-->>Service: result
    Service-->>API: response
    API-->>UI: JSON data
    UI-->>Actor: display result
    
    alt Error Case
        Service-->>API: error
        API-->>UI: error response
    end
\`\`\`

**Description:** [Workflow explanation]

**Participants:**
- Actor: persona from project
- UI: Frontend layer
- API: REST endpoints
- Service: Business logic
- DB: Data persistence

**Interactions:** 10-15 steps minimum showing:
- Request/response flows
- Validation steps
- Database operations
- Error handling (alt blocks)
- Async operations if applicable

**MANDATORY for EACH diagram:**
- Participants = ${domain} components (NOT generic "System")
- Messages = realistic API calls (e.g., "POST /api/claims/submit")
- Show validation, business logic, data persistence
- Include error scenarios
- Return ONLY Markdown (NO \`\`\`markdown wrapper)

**CRITICAL MERMAID SEQUENCE DIAGRAM RULES:**
- NEVER use the word "end" at the end of an arrow message label — it is a RESERVED keyword that closes blocks (loop/alt/opt) and will cause a parse error. Write "complete", "done", "finish", or rephrase instead.
- WRONG: Service-->>API: No action required end
- CORRECT: Service-->>API: No action required
- Only use "end" alone on its own line to close a loop/alt/opt/par block.
- Do NOT write two participant definitions on the same line.`;

export { sequenceDiagramPage };