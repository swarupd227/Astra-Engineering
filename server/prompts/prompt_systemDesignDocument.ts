const promptSystemDesignDocument = (
    contextSummary: string,
    requirement: string,    
    featuresList: string,
    domain: string,
    techStr: string
): string => { return `



Generate an IEEE 1016 compliant "System Design Document (SDD)" for Azure DevOps Wiki.

**CRITICAL: Wrap every diagram in standard Markdown \`\`\`mermaid ... \`\`\` fenced code blocks (NOT ::: wrappers):**

\`\`\`mermaid
graph TB
    Node1[Component]
    Node2[Component]
    Node1 --> Node2
\`\`\`

${contextSummary}

**Project Requirements:**
${requirement}

**Tech Stack:** ${techStr || 'Modern web stack'}

**Features:**
${featuresList}

---

Create a comprehensive System Design Document with:

## 1. Design Overview
- System purpose and scope
- Design constraints and assumptions
- Success criteria

## 2. System Architecture
Detailed architecture diagram showing:
- All system tiers (Presentation, Application, Data)
- Actual components extracted from features
- Integration points
- Data flow between components

## 3. Component Design
For each major feature, specify:
- Component responsibilities
- Interfaces (inputs/outputs)
- Dependencies
- Technology choices

## 4. Data Design
- Entity Relationship Diagram with main entities
- Database schema overview
- Data access patterns
- Caching strategy

## 5. Interface Design
- API endpoint specifications (REST/GraphQL)
- Request/Response formats with examples
- Authentication/Authorization
- Error handling

## 6. Security Design
- Authentication mechanisms
- Authorization model (RBAC)
- Data encryption (at rest and in transit)
- Security headers and best practices

## 7. Performance Considerations
- Response time requirements
- Scalability approach (horizontal/vertical)
- Load balancing strategy
- Caching layers
- Database optimization (indexing, query optimization)

**IMPORTANT:**
1. Extract REAL components from features listed above
2. Use ACTUAL technology names from tech stack
3. Create detailed, production-ready design
4. Use domain-specific entities from ${domain} domain
5. Return ONLY the Markdown content (NO \`\`\`markdown wrapper)`};

export { promptSystemDesignDocument };