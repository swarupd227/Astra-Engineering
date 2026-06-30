const generateUseCaseDiagramPagee  = (
    contextSummary: string,
    personas: { name: string; description: string }[],
    storiesByPersona: string,
    featuresList: string,
    domain: string,
    personasList: string

): string => `
          

${contextSummary}

**CRITICAL - USE THIS REAL PROJECT DATA (NOT PLACEHOLDERS):**

**Personas (Actors): ${personas.map(p => p.name).join(', ')}**
${personasList}

**User Stories (Extract Use Cases):**
${storiesByPersona}

**Features (Group Use Cases):**
${featuresList}

---

# Use Case Diagrams

Generate comprehensive use case diagrams using standard Mermaid syntax wrapped in \`\`\`mermaid ... \`\`\` fenced code blocks.

**Structure (Create 4-5 detailed diagrams):**

## 1. Overview
- Actor table with roles, goals, related use cases
- System scope description

## 2. High-Level System Context
\`\`\`mermaid
graph TB
    Actor1((${personas[0]?.name || 'Actor1'}))
    Actor2((${personas[1]?.name || 'Actor2'}))
    System[${domain} System]
    Actor1 --> System
    Actor2 --> System
\`\`\`
- Show ALL personas as actors
- Extract primary use cases from features
- System boundary

## 3. Feature-Specific Diagrams (Create 3-4)
For each major feature:
- Detailed mermaid diagram (10-15 nodes)
- Actor interactions
- Include/extend relationships
- Description explaining workflow

## 4. Actor-Use Case Matrix
Table showing actor-to-use-case mappings

## 5. Priority Matrix
Use case priorities, complexity, dependencies

**MANDATORY:**
- Actors = ${personas.map(p => p.name).join(', ')} (NO generic names)
- Extract REAL use cases from user stories above
- Each diagram 10-15 nodes minimum
- Show relationships using plain edge labels like \`-->|include|\` or \`-->|extend|\` — NEVER use \`<<include>>\` or \`<<extend>>\` notation (angle brackets break Mermaid parsing)
- ${domain} domain terminology
- Return ONLY Markdown (NO \`\`\`markdown wrapper)`;

export { generateUseCaseDiagramPagee }