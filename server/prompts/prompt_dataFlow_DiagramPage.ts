const dataFlowDiagramPage = (
  featuresList: string,
  contextSummary: string,
  domain: string,
  features: string[],
  userStories: string[],
  storiesSample: string
): string => {
  return `
${contextSummary}

**CRITICAL - USE THIS REAL PROJECT DATA (NOT PLACEHOLDERS):**

**Features (Extract Processes): ${features.length} total**
${featuresList}

**User Stories (Extract Data Flows): ${userStories.length} total**
${storiesSample}

---

# Data Flow Diagrams (DFD)

Generate comprehensive Data Flow Diagrams for the ${domain} system.

## Instructions
1. Create a 4-level DFD hierarchy:
   - Level 0: Context Diagram (System vs External Entities).
   - Level 1: Major Process Decomposition (Main system processes and data flows).
   - Level 2: Detailed Sub-process (Deep dive into the 2-3 most complex features).
   - Level 3: Data Dictionary/Summary Table.
2. Use specific ${domain} terminology for processes, data stores, and external entities.
3. Every diagram must be rendered using Mermaid syntax.
4. Mermaid Syntax Requirements:
   - Start every block with \`graph TB\` or \`flowchart TD\`.
   - Node shapes: [Rect], ((Circle)), [(Database)], {Diamond}.
   - Edges: \`A -->|label| B\`.
   - Dotted edges: \`A -.->|label| B\`.
   - ALWAYS use double-quoted labels when the text contains parentheses, &, <, >, or <br/>: \`A["Label & Text"]\`.
   - NEVER leave special characters unquoted: wrong=\`A[Process (Step 1)]\`, correct=\`A["Process (Step 1)"]\`.
   - Node IDs must be single words — no spaces: use ProcessStep1 not "Process Step 1".
   - Use <br/> for multi-line labels ONLY inside double-quoted labels: \`A["Line 1<br/>Line 2"]\`.
5. Ensure logical flow between processes and data stores.

## Expected Output
Provide the full architectural documentation including:
- Narrative analysis for each DFD level.
- Mermaid code blocks for the visualizations.
- A summary table mapping processes to inputs, outputs, data stores, and external entities.

**MANDATORY:**
- Use real ${domain}-specific process names from the features (NO generic "Process1").
- Data stores must use specific ${domain} terminology (e.g., "CustomerOrdersDB" NOT "Database1").
- Wrap every diagram in \`\`\`mermaid ... \`\`\`.
- Return ONLY Markdown.
`;
};
export { dataFlowDiagramPage };
