# Figma Make Guidelines - Requirements Context Integration

## Issue Identified ✅

**Problem:** The `generateDesignGuidelines()` function was receiving only a plain `requirement` string but not the **rich, structured context** captured during Step 1 conversation (business goals, target users, key features, technical constraints, etc.).

**Impact:** Figma Make guidelines were being generated in a **generic, one-size-fits-all manner** instead of being tailored to the specific project requirements, user types, and business context.

---

## Solution Implemented ✅

### 1. Updated Function Signature

**File:** `server/ai-service.ts`

```typescript
// BEFORE
export async function generateDesignGuidelines(
  requirement: string,
): Promise<string>

// AFTER
export async function generateDesignGuidelines(
  requirement: string,
  capturedRequirements?: {
    businessGoals?: string[];
    targetUsers?: string[];
    keyFeatures?: string[];
    technicalConstraints?: string[];
    functionalRequirements?: string[];
    nonFunctionalRequirements?: string[];
  }
): Promise<string>
```

### 2. Requirements Context Builder

Added logic to format captured requirements into a structured context section:

```typescript
let requirementsContext = "";
if (capturedRequirements) {
  requirementsContext = "\n\n## 🎯 PROJECT CONTEXT FROM USER REQUIREMENTS\n\n";
  
  // Business Goals
  if (capturedRequirements.businessGoals?.length > 0) {
    requirementsContext += "**Business Goals:**\n";
    capturedRequirements.businessGoals.forEach(goal => {
      requirementsContext += `• ${goal}\n`;
    });
  }
  
  // Target Users
  if (capturedRequirements.targetUsers?.length > 0) {
    requirementsContext += "**Target Users:**\n";
    capturedRequirements.targetUsers.forEach(user => {
      requirementsContext += `• ${user}\n`;
    });
  }
  
  // Key Features, Technical Constraints, etc.
  // ... (similar formatting for all requirement categories)
}
```

### 3. Enhanced AI Prompt with Context

The requirements context is now injected into the AI prompt with **explicit instructions**:

```typescript
${requirementsContext ? `${requirementsContext}**CRITICAL INSTRUCTION:** 
The design guidelines MUST be tailored to the project context above. Consider:
• Design for the specific target users mentioned (their expertise level, domain, workflows)
• Support the key features and functional requirements listed
• Incorporate technical constraints and non-functional requirements into design decisions
• Align visual design language with business goals
• Include realistic content examples that match the domain, user types, and workflows

For example:
- If target users are "developers/engineers", design for information-dense, technical UIs
- If target users are "non-technical users/customers", prioritize simplicity and onboarding
- If key features include "real-time collaboration", include presence indicators and activity feeds
- If key features include "data visualization", emphasize chart components and color coding
- If technical constraints mention "mobile-first", prioritize mobile layouts and touch targets
- If business goals include "enterprise adoption", emphasize professional aesthetics and accessibility
- If non-functional requirements mention "high performance", optimize for skeleton screens and lazy loading
` : ''}
```

### 4. Updated API Route

**File:** `server/routes.ts`

```typescript
// BEFORE
app.post("/api/workflow/generate-guidelines", async (req, res) => {
  const { input } = req.body;
  const guidelines = await generateDesignGuidelines(input);
  res.json({ guidelines });
});

// AFTER
app.post("/api/workflow/generate-guidelines", async (req, res) => {
  const { input, capturedRequirements } = req.body;
  console.log("[Routes] Generating design guidelines with captured requirements:", !!capturedRequirements);
  const guidelines = await generateDesignGuidelines(input, capturedRequirements);
  res.json({ guidelines });
});
```

---

## How It Works Now 🚀

### Step-by-Step Flow

1. **Step 1: User Conversation** (Requirement Gathering)
   - AI agent asks questions to understand the project
   - Captures structured requirements:
     - Business Goals (e.g., "Improve developer productivity", "Enterprise adoption")
     - Target Users (e.g., "Software developers", "DevOps engineers", "Product managers")
     - Key Features (e.g., "Real-time collaboration", "Code generation", "Version control")
     - Technical Constraints (e.g., "Mobile-first", "Accessibility required", "Offline support")
     - Functional Requirements (e.g., "User authentication", "Role-based permissions")
     - Non-Functional Requirements (e.g., "High performance", "Scalability", "Security")

2. **Step 2: Figma Make Guidelines Generation**
   - User triggers design guideline generation
   - Frontend sends both:
     - `input`: The main requirement text
     - `capturedRequirements`: The structured context from Step 1
   - Backend builds a formatted context section
   - AI receives comprehensive project context
   - AI generates **tailored** Figma Make guidelines that:
     - Match the target user's expertise level and needs
     - Include components that support the key features
     - Respect technical constraints (mobile-first, accessibility, etc.)
     - Align visual language with business goals
     - Use realistic content examples from the project domain

### Example Context Injection

**Captured Requirements:**
```json
{
  "businessGoals": ["Improve developer productivity", "Enable rapid prototyping"],
  "targetUsers": ["Software developers", "Technical leads"],
  "keyFeatures": ["Code generation", "Real-time preview", "Git integration"],
  "technicalConstraints": ["Web-based", "Dark mode support"],
  "functionalRequirements": ["User authentication", "Project management"],
  "nonFunctionalRequirements": ["Fast performance", "Keyboard shortcuts"]
}
```

**Formatted Context in AI Prompt:**
```markdown
## 🎯 PROJECT CONTEXT FROM USER REQUIREMENTS

**Business Goals:**
• Improve developer productivity
• Enable rapid prototyping

**Target Users:**
• Software developers
• Technical leads

**Key Features:**
• Code generation
• Real-time preview
• Git integration

**Technical Constraints:**
• Web-based
• Dark mode support

**Functional Requirements:**
• User authentication
• Project management

**Non-Functional Requirements:**
• Fast performance
• Keyboard shortcuts
```

**AI Response Will Be Tailored:**
- **Color System:** Include dark mode as primary theme (due to "Dark mode support" constraint)
- **Typography:** Use monospace fonts for code (because target users are "Software developers")
- **Components:** Include code editor components, syntax highlighting, file tree navigation (for "Code generation" feature)
- **Interactions:** Emphasize keyboard shortcuts (due to "Keyboard shortcuts" requirement)
- **Content Examples:** Use technical terminology, code snippets, Git branch names (matching developer domain)
- **Performance:** Optimize for "Fast performance" with skeleton screens, lazy loading

---

## Benefits ✅

### 1. Context-Aware Guidelines
✅ Guidelines are tailored to specific user types (developers vs customers vs administrators)
✅ Components match the actual features needed (collaboration tools, data viz, forms, etc.)
✅ Visual language aligns with business goals (professional vs playful, minimal vs feature-rich)

### 2. Technical Constraint Integration
✅ Mobile-first projects get mobile-optimized layouts by default
✅ Accessibility requirements automatically enforced in component specs
✅ Performance requirements reflected in loading states and optimizations

### 3. Domain-Specific Content
✅ Realistic examples use project-specific terminology
✅ User workflows reflected in navigation and information architecture
✅ Data types match what users will actually see (not Lorem Ipsum)

### 4. Reduced Iteration Cycles
✅ First-pass guidelines are highly relevant
✅ Less back-and-forth to customize guidelines
✅ Faster time-to-prototype

---

## Example Comparisons

### Generic Guidelines (Before)

```markdown
## 1. COLOR SYSTEM
PRIMARY COLORS:
• Brand Primary: #0066CC
• Brand Secondary: #6366F1
...

## DASHBOARD VIEW
Create a dashboard with:
• Top navigation bar
• Sidebar navigation
• Metric cards showing KPIs
• Data table
...
```

**Issues:**
- No consideration of target users
- Generic component selection
- Doesn't address specific requirements

### Tailored Guidelines (After)

**For Developer Platform (target users: "Software developers", key features: "Code generation, Git integration"):**

```markdown
## EXECUTIVE SUMMARY
This is a developer-focused platform for software engineers and technical leads who need efficient code generation and Git-based workflows. The design emphasizes information density, keyboard shortcuts, and a dark-mode-first aesthetic familiar to developers.

## 1. COLOR SYSTEM & THEMING
### Dark Mode Palette (Primary)
• Background Primary: #0F172A (Deep navy for reduced eye strain)
• Background Secondary: #1E293B (Code editor surface)
• Syntax Colors: #10B981 (strings), #F59E0B (functions), #3B82F6 (keywords)
...

## DASHBOARD VIEW
Create a developer dashboard with:
• Code-friendly monospace typography (JetBrains Mono)
• Sidebar with collapsible file tree (Git repository structure)
• Main editor area with syntax highlighting
• Bottom panel for terminal/console output
• Top bar with Git branch indicator, commit button, real-time preview toggle
• Metric cards: Build status, Test coverage, Deployment status, API latency
• Keyboard shortcuts displayed in tooltips (Cmd+K for command palette)
...

**Content Examples:**
• File names: `src/components/Button.tsx`, `utils/formatDate.ts`
• Commit messages: "feat: add user authentication", "fix: resolve merge conflict"
• User names: "john.doe@company.com", "jane.smith"
• Branch names: "feature/login-page", "bugfix/api-error"
```

**Benefits:**
- Dark mode prioritized (matching developer preferences)
- Code-specific components (syntax highlighting, file tree, terminal)
- Realistic developer content (file names, commit messages, Git branches)
- Keyboard shortcuts emphasized (developer productivity)
- Technical terminology throughout

---

## Frontend Integration Required

To fully utilize this feature, the frontend must pass `capturedRequirements` when calling the API:

```typescript
// When generating design guidelines
const response = await fetch('/api/workflow/generate-guidelines', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    input: requirementText,
    capturedRequirements: {
      businessGoals: workflowState.capturedRequirements.businessGoals,
      targetUsers: workflowState.capturedRequirements.targetUsers,
      keyFeatures: workflowState.capturedRequirements.keyFeatures,
      technicalConstraints: workflowState.capturedRequirements.technicalConstraints,
      functionalRequirements: workflowState.capturedRequirements.functionalRequirements,
      nonFunctionalRequirements: workflowState.capturedRequirements.nonFunctionalRequirements,
    }
  })
});
```

---

## Validation & Testing

### Test Cases

1. **Developer Platform**
   - Input: "Build a code editor platform"
   - Captured: Target users = "Software developers", Features = "Syntax highlighting, Git integration"
   - Expected: Dark mode, monospace fonts, code components, keyboard shortcuts

2. **E-commerce App**
   - Input: "Create an online shopping experience"
   - Captured: Target users = "Customers", Features = "Product catalog, Shopping cart, Payment"
   - Expected: Light, inviting colors; large product images; prominent CTAs; simple navigation

3. **Analytics Dashboard**
   - Input: "Design a business intelligence platform"
   - Captured: Target users = "Business analysts", Features = "Data visualization, Reporting, Filters"
   - Expected: Chart-focused layout; filter panels; export buttons; professional color scheme

4. **Mobile-First App**
   - Input: "Build a fitness tracking app"
   - Captured: Constraints = "Mobile-first, Offline support", Users = "Fitness enthusiasts"
   - Expected: Touch-optimized (48x48px); bottom navigation; swipe gestures; vibrant colors

---

## Summary

**Before:**
- ❌ Generic, one-size-fits-all guidelines
- ❌ No awareness of target users
- ❌ Ignored technical constraints
- ❌ Placeholder content (Lorem Ipsum)

**After:**
- ✅ Tailored to specific user types and domains
- ✅ Components match actual feature requirements
- ✅ Respects technical and business constraints
- ✅ Realistic, domain-specific content examples
- ✅ Aligned with business goals

**Result:** Figma Make guidelines that produce **highly relevant, production-ready prototypes** on the first try, dramatically reducing iteration cycles and accelerating the design-to-development workflow.

---

**Updated:** January 2025  
**Files Modified:**
- `server/ai-service.ts` - Updated `generateDesignGuidelines()` function
- `server/routes.ts` - Updated API route to accept `capturedRequirements`
