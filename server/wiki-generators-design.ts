import OpenAI from "openai";
import { normalizeRequestParams } from "./stack-modernization/services/token-manager";
import { withAiContext } from "./observability/ai-context";

// These will be initialized from ai-service.ts
let openai: OpenAI;
let useAzure = false;

export function initializeDesignGenerators(client: OpenAI, isAzure: boolean) {
  // Attribute all design-doc AI calls to feature=design (-> documentation_generation_count).
  openai = {
    ...(client as any),
    chat: {
      completions: {
        create: (params: any) =>
          withAiContext({ feature: "design", useCase: "design prompt" }, () =>
            (client as any).chat.completions.create(params),
          ),
      },
    },
  } as any;
  useAzure = isAzure;
}

// ============================================================================
// DESIGN PHASE GENERATORS
// ============================================================================

export async function generateSystemDesignDocumentPage(
  requirement: string,
  features: any[] = [],
  techStack: any = {}
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const techStackStr = Object.entries(techStack)
    .filter(([_, values]: [string, any]) => Array.isArray(values) && values.length > 0)
    .map(([key, values]: [string, any]) => `- **${key}**: ${values.join(', ')}`)
    .join('\n');

  const prompt = `Generate a comprehensive "System Design Document (SDD)" following IEEE 1016 standard for Azure DevOps Wiki.

**Project Context:**
${requirement}

**Tech Stack:**
${techStackStr || 'To be determined'}

**Features:** ${features.length}

Create an IEEE 1016 compliant SDD with Mermaid diagrams:

# System Design Document (SDD)

## 1. Introduction
### 1.1 Purpose
[Purpose of this design document]

### 1.2 Scope
[What this document covers]

### 1.3 Overview
[Document structure]

### 1.4 References
- SRS Document
- Architecture Document

## 2. System Overview
[High-level system description]

## 3. System Architecture

### 3.1 Architectural Design

\`\`\`mermaid
graph TB
    subgraph "Presentation Layer"
        UI[Web/Mobile UI]
        API_GW[API Gateway]
    end
    
    subgraph "Application Layer"
        Auth[Auth Service]
        Business[Business Logic]
        Workflow[Workflow Engine]
    end
    
    subgraph "Data Layer"
        Primary[(Primary DB)]
        Cache[(Redis Cache)]
        Queue[Message Queue]
    end
    
    subgraph "External Services"
        Email[Email Service]
        Storage[File Storage]
        Analytics[Analytics]
    end
    
    UI --> API_GW
    API_GW --> Auth
    API_GW --> Business
    Business --> Workflow
    Business --> Primary
    Business --> Cache
    Business --> Queue
    Queue --> Email
    Business --> Storage
    Business --> Analytics
\`\`\`

### 3.2 Component Description

#### 3.2.1 Presentation Layer
- **Web UI**: [Technology and purpose]
- **Mobile UI**: [Technology and purpose]
- **API Gateway**: [Role and responsibilities]

#### 3.2.2 Application Layer
- **Authentication Service**: [JWT-based auth, SSO]
- **Business Logic**: [Core application logic]
- **Workflow Engine**: [Process automation]

#### 3.2.3 Data Layer
- **Primary Database**: [Type, schema design]
- **Caching**: [Redis for performance]
- **Message Queue**: [Async processing]

## 4. Data Design

### 4.1 Entity Relationship Diagram

\`\`\`mermaid
erDiagram
    USER ||--o{ ORDER : places
    USER {
        string id PK
        string email
        string password_hash
        datetime created_at
    }
    ORDER ||--|{ ORDER_ITEM : contains
    ORDER {
        string id PK
        string user_id FK
        decimal total
        string status
        datetime created_at
    }
    PRODUCT ||--o{ ORDER_ITEM : "ordered in"
    PRODUCT {
        string id PK
        string name
        decimal price
        int stock
    }
    ORDER_ITEM {
        string id PK
        string order_id FK
        string product_id FK
        int quantity
        decimal price
    }
\`\`\`

### 4.2 Data Dictionary
[Detailed field descriptions]

### 4.3 Data Flow
[How data moves through the system]

## 5. Component Design

### 5.1 Module Specifications

#### Module: User Management
- **Purpose**: Handle user accounts and authentication
- **Inputs**: User credentials, profile data
- **Processing**: Validate, hash passwords, store securely
- **Outputs**: User session, JWT tokens
- **Interfaces**:
  - POST /api/auth/register
  - POST /api/auth/login
  - GET /api/users/:id

#### Module: [Feature Module 1]
[Detailed specification]

### 5.2 Interface Design

#### API Endpoints Summary
| Method | Endpoint | Purpose | Auth Required |
|--------|----------|---------|---------------|
| POST | /api/auth/login | User login | No |
| GET | /api/users/:id | Get user profile | Yes |
| POST | /api/orders | Create order | Yes |

## 6. User Interface Design

### 6.1 UI Architecture
- Component-based architecture (React/Angular/Vue)
- State management (Redux/MobX/Vuex)
- Responsive design (Mobile-first)

### 6.2 Screen Flow Diagram

\`\`\`mermaid
graph LR
    A[Login] --> B{Authenticated?}
    B -->|Yes| C[Dashboard]
    B -->|No| A
    C --> D[Feature 1]
    C --> E[Feature 2]
    C --> F[Profile]
    D --> G[Detail View]
    E --> H[List View]
\`\`\`

### 6.3 Key UI Components
- Navigation Menu
- Data Grid
- Forms
- Modals/Dialogs

## 7. Algorithm Design

### 7.1 Core Algorithms

#### Algorithm: Data Validation
\`\`\`
Input: userData
Output: validationResult

1. Check required fields
2. Validate email format
3. Check password strength
4. Verify uniqueness
5. Return result
\`\`\`

## 8. Security Design

### 8.1 Authentication
- JWT tokens with 24-hour expiry
- Refresh token mechanism
- Password hashing (bcrypt, 12 rounds)

### 8.2 Authorization
- Role-based access control (RBAC)
- Permission matrix
- API route protection

### 8.3 Data Protection
- Encryption at rest (AES-256)
- Encryption in transit (TLS 1.3)
- Input sanitization
- SQL injection prevention

## 9. Error Handling

### 9.1 Error Taxonomy
- Client errors (4xx)
- Server errors (5xx)
- Business logic errors
- Validation errors

### 9.2 Error Response Format
\`\`\`json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": []
  }
}
\`\`\`

## 10. Performance Considerations

### 10.1 Optimization Strategies
- Database indexing
- Query optimization
- Caching strategy
- Lazy loading
- Code splitting

### 10.2 Scalability
- Horizontal scaling
- Load balancing
- Database replication
- CDN for static assets

## 11. Deployment Architecture

\`\`\`mermaid
graph TB
    subgraph "Production"
        LB[Load Balancer]
        App1[App Server 1]
        App2[App Server 2]
        DB_Primary[(Primary DB)]
        DB_Replica[(Replica DB)]
    end
    
    LB --> App1
    LB --> App2
    App1 --> DB_Primary
    App2 --> DB_Primary
    DB_Primary --> DB_Replica
\`\`\`

Use IEEE 1016 standard format. Be comprehensive and technical.

Return ONLY the Markdown content.`;

  const modelName = useAzure ? process.env.AZURE_OPENAI_DEPLOYMENT! : "gpt-4o";
  // Use centralized normalizeRequestParams() — reads NEW_API_MODEL_SUBSTRINGS from
  // llm-config-constants.ts to detect modern models and swap max_tokens → max_completion_tokens.
  const sdRequestParams = normalizeRequestParams({
    model: modelName,
    messages: [
      { role: "system", content: "You are a senior software architect creating an IEEE 1016 compliant system design document." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 4000,
  });
  const response = await openai.chat.completions.create(sdRequestParams as any);

  return {
    pageType: "system-design",
    phase: "design",
    title: "System Design Document (SDD)",
    content: response.choices[0]?.message?.content || "",
    order: 11,
  };
}

export async function generateUIUXDesignSpecsPage(
  userStories: any[] = [],
  personas: any[] = [],
  domain: string = "General"
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const prompt = `Generate comprehensive "UI/UX Design Specifications" for Azure DevOps Wiki.

**Domain:** ${domain}
**Personas:** ${personas.length}
**User Stories:** ${userStories.length}

Create detailed UI/UX specifications:

# UI/UX Design Specifications

## 1. Design Philosophy
[Overall design approach and principles]

## 2. Design System

### 2.1 Color Palette

#### Primary Colors
- **Primary**: #2563EB (Blue-600)
- **Primary Dark**: #1E40AF (Blue-800)
- **Primary Light**: #3B82F6 (Blue-500)

#### Secondary Colors
- **Secondary**: #10B981 (Emerald-500)
- **Accent**: #F59E0B (Amber-500)

#### Neutral Colors
- **Text Primary**: #1F2937 (Gray-800)
- **Text Secondary**: #6B7280 (Gray-500)
- **Background**: #FFFFFF
- **Surface**: #F9FAFB (Gray-50)

#### Semantic Colors
- **Success**: #10B981 (Green)
- **Warning**: #F59E0B (Amber)
- **Error**: #EF4444 (Red)
- **Info**: #3B82F6 (Blue)

### 2.2 Typography

#### Font Family
- **Primary**: Inter, system-ui, sans-serif
- **Monospace**: 'Fira Code', monospace

#### Type Scale
| Style | Size | Weight | Line Height | Use Case |
|-------|------|--------|-------------|----------|
| H1 | 36px | 700 | 1.2 | Page titles |
| H2 | 30px | 600 | 1.3 | Section headers |
| H3 | 24px | 600 | 1.4 | Subsection headers |
| Body | 16px | 400 | 1.5 | Body text |
| Caption | 14px | 400 | 1.4 | Captions, labels |
| Small | 12px | 400 | 1.3 | Fine print |

### 2.3 Spacing System
- **Base Unit**: 4px
- **Scale**: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128px

### 2.4 Elevation & Shadows
\`\`\`css
/* Level 1 */
box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);

/* Level 2 */
box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);

/* Level 3 */
box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
\`\`\`

## 3. Component Library

### 3.1 Buttons

#### Primary Button
- **Background**: Primary color
- **Text**: White
- **Hover**: Primary dark
- **Border Radius**: 6px
- **Padding**: 12px 24px
- **Font Weight**: 500

#### Secondary Button
- **Background**: Transparent
- **Border**: 1px solid primary
- **Text**: Primary color
- **Hover**: Light primary background

### 3.2 Form Elements

#### Text Input
- **Border**: 1px solid gray-300
- **Focus**: 2px solid primary
- **Border Radius**: 6px
- **Padding**: 10px 12px
- **Error State**: Red border with error message

#### Dropdown/Select
[Specifications]

#### Checkbox/Radio
[Specifications]

### 3.3 Cards
- **Background**: White
- **Border**: 1px solid gray-200
- **Border Radius**: 8px
- **Padding**: 16px
- **Shadow**: Level 1

### 3.4 Navigation
[Menu, sidebar, breadcrumb specifications]

### 3.5 Data Display
- **Tables**: Specifications
- **Lists**: Specifications
- **Charts**: Specifications

## 4. Layout System

### 4.1 Grid System
- **Container Max Width**: 1280px
- **Gutter**: 24px
- **Columns**: 12

### 4.2 Responsive Breakpoints
| Breakpoint | Width | Columns |
|-----------|-------|---------|
| Mobile | < 640px | 4 |
| Tablet | 640px - 1024px | 8 |
| Desktop | > 1024px | 12 |

## 5. User Workflows

### 5.1 Login Flow

\`\`\`mermaid
graph TB
    A[Landing Page] --> B{Authenticated?}
    B -->|No| C[Login Form]
    B -->|Yes| D[Dashboard]
    C --> E{Valid Credentials?}
    E -->|No| F[Error Message]
    F --> C
    E -->|Yes| D
\`\`\`

### 5.2 Main User Journey

\`\`\`mermaid
journey
    title User Journey: Create New Item
    section Discovery
      Navigate to page: 5: User
      View options: 4: User
    section Action
      Click create button: 5: User
      Fill form: 3: User
      Submit: 5: User
    section Outcome
      See confirmation: 5: User
      View created item: 5: User
\`\`\`

## 6. Screen Specifications

### 6.1 Dashboard Screen

#### Layout
\`\`\`
┌─────────────────────────────────────────┐
│  Header (Navigation)                    │
├─────────────────────────────────────────┤
│ ┌─────────┐  ┌────────────────────────┐│
│ │ Sidebar │  │                        ││
│ │         │  │     Main Content       ││
│ │ Nav     │  │                        ││
│ │         │  │                        ││
│ └─────────┘  └────────────────────────┘│
└─────────────────────────────────────────┘
\`\`\`

#### Components
- Header with logo, search, user menu
- Sidebar navigation
- Main content area with cards/widgets
- Footer

## 7. Interaction Patterns

### 7.1 Hover States
- Cursor changes to pointer
- Slight elevation increase
- Color shift

### 7.2 Loading States
- Skeleton screens
- Spinner for long operations
- Progress bars for multi-step

### 7.3 Empty States
- Helpful illustration
- Clear message
- Call-to-action button

### 7.4 Error States
- Clear error message
- Suggested action
- Retry option

## 8. Accessibility (WCAG 2.1 Level AA)

### 8.1 Color Contrast
- Normal text: 4.5:1 minimum
- Large text: 3:1 minimum
- UI components: 3:1 minimum

### 8.2 Keyboard Navigation
- All interactive elements accessible via keyboard
- Visible focus indicators
- Logical tab order

### 8.3 Screen Reader Support
- Semantic HTML
- ARIA labels where needed
- Alt text for images

### 8.4 Responsive Text
- Text can be resized to 200%
- No horizontal scrolling at 320px width

## 9. Animation & Motion

### 9.1 Principles
- Subtle and purposeful
- Duration: 200-300ms
- Easing: ease-in-out

### 9.2 Use Cases
- Page transitions: fade
- Dropdown menus: slide down
- Modals: fade + scale
- Button clicks: ripple effect

## 10. Dark Mode (if applicable)
[Dark mode color palette and specifications]

## 11. Mobile Considerations

### 11.1 Touch Targets
- Minimum size: 44x44px
- Spacing between targets: 8px

### 11.2 Mobile Navigation
- Hamburger menu
- Bottom navigation for key actions
- Swipe gestures

## 12. Design Assets
- Figma/Sketch file location
- Icon library
- Illustration style guide

Be comprehensive and specific. Include visual examples where possible.

Return ONLY the Markdown content.`;

  const modelName = useAzure ? process.env.AZURE_OPENAI_DEPLOYMENT! : "gpt-4o";
  const uxRequestParams = normalizeRequestParams({
    model: modelName,
    messages: [
      { role: "system", content: "You are a UX designer creating comprehensive UI/UX design specifications." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 4000,
  });
  const response = await openai.chat.completions.create(uxRequestParams as any);

  return {
    pageType: "ui-ux-design",
    phase: "design",
    title: "UI/UX Design Specifications",
    content: response.choices[0]?.message?.content || "",
    order: 13,
  };
}

export async function generateDatabaseDesignDocumentPage(
  features: any[] = [],
  userStories: any[] = [],
  techStack: any = {}
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const dbType = techStack.database && techStack.database.length > 0 
    ? techStack.database[0] 
    : 'PostgreSQL';

  const prompt = `Generate a comprehensive "Database Design Document" for Azure DevOps Wiki.

**Database Type:** ${dbType}
**Features:** ${features.length}
**User Stories:** ${userStories.length}

Create detailed database design documentation:

# Database Design Document

## 1. Overview
[Database purpose and scope]

## 2. Database Technology
- **DBMS**: ${dbType}
- **Version**: [Latest stable]
- **Deployment**: [Cloud/On-premise]

## 3. Entity Relationship Diagram

\`\`\`mermaid
erDiagram
    users ||--o{ sessions : "has"
    users {
        uuid id PK
        string email UK
        string password_hash
        string first_name
        string last_name
        string role
        boolean is_active
        timestamp created_at
        timestamp updated_at
    }
    
    users ||--o{ orders : "places"
    orders {
        uuid id PK
        uuid user_id FK
        decimal total_amount
        string status
        timestamp ordered_at
        timestamp created_at
    }
    
    orders ||--|{ order_items : "contains"
    order_items {
        uuid id PK
        uuid order_id FK
        uuid product_id FK
        int quantity
        decimal unit_price
        decimal subtotal
    }
    
    products ||--o{ order_items : "ordered_in"
    products {
        uuid id PK
        string name
        string description
        decimal price
        int stock_quantity
        uuid category_id FK
        boolean is_active
        timestamp created_at
        timestamp updated_at
    }
    
    categories ||--o{ products : "contains"
    categories {
        uuid id PK
        string name
        string description
        uuid parent_id FK
    }
    
    sessions {
        uuid id PK
        uuid user_id FK
        string token
        timestamp expires_at
        timestamp created_at
    }
\`\`\`

## 4. Table Specifications

### 4.1 users
**Purpose**: Store user account information

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY, NOT NULL | Unique identifier |
| email | VARCHAR(255) | UNIQUE, NOT NULL | User email |
| password_hash | VARCHAR(255) | NOT NULL | Bcrypt hashed password |
| first_name | VARCHAR(100) | NOT NULL | First name |
| last_name | VARCHAR(100) | NOT NULL | Last name |
| role | VARCHAR(50) | NOT NULL, DEFAULT 'user' | User role (user, admin) |
| is_active | BOOLEAN | NOT NULL, DEFAULT true | Account status |
| created_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | Creation timestamp |
| updated_at | TIMESTAMP | NOT NULL, DEFAULT NOW() | Last update timestamp |

**Indexes:**
- idx_users_email ON (email)
- idx_users_role ON (role)
- idx_users_created_at ON (created_at)

**Constraints:**
- CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}$')
- CHECK (role IN ('user', 'admin', 'manager'))

### 4.2 orders
[Similar detailed specification]

### 4.3 products
[Similar detailed specification]

## 5. Relationships

### 5.1 Foreign Keys
| Table | Column | References | On Delete | On Update |
|-------|--------|------------|-----------|-----------|
| orders | user_id | users(id) | CASCADE | CASCADE |
| order_items | order_id | orders(id) | CASCADE | CASCADE |
| order_items | product_id | products(id) | RESTRICT | CASCADE |

## 6. Indexes

### 6.1 Performance Indexes
- **users.email**: UNIQUE index for fast login lookup
- **orders.user_id**: Index for user order history
- **orders.created_at**: Index for date range queries
- **products.category_id**: Index for category filtering

### 6.2 Full-Text Search
\`\`\`sql
CREATE INDEX idx_products_search ON products 
USING GIN(to_tsvector('english', name || ' ' || description));
\`\`\`

## 7. Data Types Rationale

### UUID vs Integer IDs
- Using UUIDs for better security (non-sequential)
- Distributed system compatibility
- Merge-friendly across environments

### Timestamp Fields
- All tables include created_at and updated_at
- Use TIMESTAMP WITH TIME ZONE for timezone awareness

### Decimal for Currency
- DECIMAL(10,2) for precise monetary calculations
- Avoids floating-point errors

## 8. Normalization

### Current Normal Form: 3NF (Third Normal Form)

**1NF**: All tables have atomic values, no repeating groups
**2NF**: No partial dependencies on composite keys
**3NF**: No transitive dependencies

### Denormalization Considerations
- Order totals: Calculated and cached for performance
- Product categories: Hierarchical, may denormalize for faster queries

## 9. Database Security

### 9.1 Access Control
- Least privilege principle
- Role-based access
- Separate read-only users for reporting

### 9.2 Data Encryption
- Sensitive fields (SSN, payment info) encrypted at rest
- TLS for data in transit

### 9.3 Audit Logging
\`\`\`sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY,
    table_name VARCHAR(100),
    record_id UUID,
    action VARCHAR(20),
    user_id UUID,
    old_data JSONB,
    new_data JSONB,
    timestamp TIMESTAMP DEFAULT NOW()
);
\`\`\`

## 10. Backup & Recovery

### 10.1 Backup Strategy
- **Full Backup**: Daily at 2 AM UTC
- **Incremental Backup**: Every 6 hours
- **Retention**: 30 days
- **Off-site**: Replicated to secondary region

### 10.2 Point-in-Time Recovery
- WAL archiving enabled
- 7-day recovery window

## 11. Scaling Considerations

### 11.1 Vertical Scaling
- Start: 4 vCPU, 16GB RAM
- Scale to: 16 vCPU, 64GB RAM

### 11.2 Horizontal Scaling
- Read replicas for reporting
- Sharding strategy by user_id if needed

### 11.3 Caching
- Redis for session storage
- Frequently accessed data cached
- Cache invalidation on updates

## 12. Performance Optimization

### 12.1 Query Optimization
- Use EXPLAIN ANALYZE for query planning
- Avoid N+1 queries
- Use connection pooling

### 12.2 Partitioning
- orders table partitioned by date (monthly)
- audit_log partitioned by date (weekly)

## 13. Migrations

### 13.1 Migration Tool
- Flyway / Liquibase / Prisma Migrate

### 13.2 Migration Strategy
- Version-controlled migrations
- Backward-compatible changes
- Testing on staging before production

## 14. Sample Queries

### 14.1 Get User Orders
\`\`\`sql
SELECT o.id, o.total_amount, o.status, o.ordered_at,
       json_agg(json_build_object(
           'product', p.name,
           'quantity', oi.quantity,
           'price', oi.unit_price
       )) as items
FROM orders o
JOIN order_items oi ON o.id = oi.order_id
JOIN products p ON oi.product_id = p.id
WHERE o.user_id = $1
GROUP BY o.id
ORDER BY o.ordered_at DESC;
\`\`\`

### 14.2 Product Search
\`\`\`sql
SELECT * FROM products
WHERE to_tsvector('english', name || ' ' || description) 
      @@ plainto_tsquery('english', $1)
AND is_active = true
ORDER BY stock_quantity DESC;
\`\`\`

## 15. Database Monitoring

### 15.1 Key Metrics
- Query performance (slow query log)
- Connection pool usage
- Disk I/O
- Replication lag

### 15.2 Alerts
- Connection pool > 80%
- Slow queries > 1 second
- Replication lag > 10 seconds
- Disk usage > 85%

Be comprehensive and technical. Use best practices for ${dbType}.

Return ONLY the Markdown content.`;

  const modelName = useAzure ? process.env.AZURE_OPENAI_DEPLOYMENT! : "gpt-4o";
  const dbRequestParams = normalizeRequestParams({
    model: modelName,
    messages: [
      { role: "system", content: "You are a database architect creating comprehensive database design documentation." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 4000,
  });
  const response = await openai.chat.completions.create(dbRequestParams as any);

  return {
    pageType: "database-design",
    phase: "design",
    title: "Database Design Document",
    content: response.choices[0]?.message?.content || "",
    order: 14,
  };
}

// Continue with more generators...
export const designGeneratorsReady = true;
