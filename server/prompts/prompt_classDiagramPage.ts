const promptClassDiagramPage = (
    contextSummary: string,
    features: string[],
    featuresList: string,
    userStories: string[],
    storiesSample: string,
    domain: string
    ): string =>  { return `
)


${contextSummary}

**CRITICAL - USE THIS REAL PROJECT DATA (NOT PLACEHOLDERS):**

**Features (Extract Domain Classes): ${features.length} total**
${featuresList}

**User Stories (Extract Methods/Behaviors): ${userStories.length} total**
${storiesSample}

---

# Class Diagrams

Generate comprehensive UML class diagrams using standard Mermaid syntax wrapped in \`\`\`mermaid ... \`\`\` fenced code blocks.

**Structure (Create 5-6 detailed diagrams):**

## 1. Core Domain Model
\`\`\`mermaid
classDiagram
    class ${domain}Entity {
        +String attribute
        +method() ReturnType
    }
\`\`\`
- Extract 6-10 main domain classes from features
- Each class: 4-6 attributes, 3-5 methods
- Show relationships (inheritance, composition, aggregation, association)
- Use ${domain} terminology (e.g., Claim, Policy for Insurance)

## 2. Service Layer Classes
- Business logic services
- DTOs, Request/Response models
- Service interfaces

## 3. Data Layer / Repository Pattern
- Repository classes
- Database entities
- ORM models

## 4. API/Controller Layer
- API controllers
- Route handlers
- Middleware classes

## 5. Design Patterns (if applicable)
- Factory, Strategy, Observer patterns
- Dependency injection

## 6. Complete System Class View
- All layers integrated
- Full dependency graph

## 7. Class Specifications Table
| Class | Type | Responsibilities | Key Methods | Features |

**Relationships:**
- Inheritance: --|>
- Composition (strong): --*
- Aggregation (weak): --o
- Association: -->
- Multiplicity: 1, *, 0..1, 1..*

**MANDATORY:**
- Classes = ${domain} domain entities (NOT "Entity1", "Class1")
- Attributes from feature descriptions
- Methods from user story actions
- Each diagram 6-12 classes
- Return ONLY Markdown (NO \`\`\`markdown wrapper)`};

export { promptClassDiagramPage };