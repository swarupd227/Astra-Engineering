import type { Persona, Epic, Feature, UserStory } from "@shared/schema";

export const PERSONAS: Persona[] = [
  {
    id: "persona-1",
    name: "Michael Chen",
    role: "Senior Developer",
    color: "blue",
    focus: "Code quality, architecture, performance",
    painPoints: ["Legacy systems", "Technical debt", "Complex integrations"],
    goals: ["Scalable solutions", "Clean code", "Modern architecture"],
  },
  {
    id: "persona-2",
    name: "Sarah Johnson",
    role: "QA Engineer",
    color: "green",
    focus: "Test coverage, automation, quality gates",
    painPoints: ["Manual testing", "Regression issues", "Limited automation"],
    goals: ["Comprehensive testing", "Early bug detection", "Automated test suites"],
  },
  {
    id: "persona-3",
    name: "David Williams",
    role: "Project Manager",
    color: "purple",
    focus: "Timeline, resource allocation, stakeholder communication",
    painPoints: ["Scope creep", "Delays", "Resource constraints"],
    goals: ["On-time delivery", "Clear milestones", "Effective communication"],
  },
  {
    id: "persona-4",
    name: "Emily Rodriguez",
    role: "Business Analyst",
    color: "orange",
    focus: "Requirements clarity, user needs, business value",
    painPoints: ["Ambiguous requirements", "Changing priorities", "Stakeholder alignment"],
    goals: ["Clear specifications", "User-centric design", "Business value delivery"],
  },
  {
    id: "persona-5",
    name: "Alex Kumar",
    role: "DevOps Engineer",
    color: "red",
    focus: "CI/CD, infrastructure, deployment automation",
    painPoints: ["Manual deployments", "Environment inconsistencies", "Configuration drift"],
    goals: ["Automated pipelines", "Reliable releases", "Infrastructure as code"],
  },
];

export function generateInsuranceGuidelines(requirement: string): string {
  return `# Design Guidelines: Insurance Rating Algorithm System

## Executive Summary
This document outlines the design guidelines for building a modern insurance rating algorithm system that enables actuaries to import bureau filings and create AI-powered premium calculations.

## System Overview
The system will provide a comprehensive platform for actuaries to:
- Import and parse bureau rating algorithms from various sources
- Create and manage rating calculations using AI/ML capabilities
- Generate premium calculations with high accuracy and compliance
- Maintain audit trails for regulatory requirements

## Technical Architecture

### Frontend Components
- **File Import Module**: Support for multiple file formats (PDF, Excel, XML)
- **Algorithm Builder**: Visual interface for creating rating formulas
- **AI Calculation Engine**: Integration with Azure OpenAI for premium optimization
- **Results Dashboard**: Real-time visualization of rating outputs

### Backend Services
- **Import Service**: Parse and validate bureau filing data
- **Rating Engine**: Execute complex actuarial calculations
- **AI/ML Service**: Apply machine learning models for risk assessment
- **Audit Service**: Track all changes and calculations for compliance

### Data Layer
- **Filing Repository**: Store bureau rating algorithms
- **Calculation History**: Maintain version history of all ratings
- **Audit Logs**: Comprehensive logging for regulatory compliance

## Design Principles

### 1. Regulatory Compliance
- All calculations must be auditable
- Maintain complete history of rating changes
- Support regulatory filing export formats
- Implement role-based access controls

### 2. Actuarial Accuracy
- Validate all imported algorithms against business rules
- Support multiple rating methodologies (Loss Cost, Pure Premium, etc.)
- Enable actuarial review workflows
- Provide detailed calculation breakdowns

### 3. User Experience
- Intuitive interface for actuaries (non-technical users)
- Clear visualization of rating factors and impacts
- Easy comparison of different rating scenarios
- Responsive design for desktop and tablet use

### 4. AI Integration
- Transparent AI decision-making process
- Configurable confidence thresholds
- Human-in-the-loop validation
- Explainable AI outputs for regulatory review

## UI/UX Guidelines

### Color Scheme
- Primary: Professional blues (#1e40af, #3b82f6)
- Secondary: Trust greens (#059669, #10b981)
- Accent: Warning oranges for attention items
- Neutral: Grays for backgrounds and borders

### Typography
- Headers: Inter, 24-32px, semibold
- Body: Inter, 14-16px, regular
- Code/Numbers: JetBrains Mono for calculations

### Layout
- Dashboard: Card-based layout with key metrics
- Forms: Multi-step wizards for complex workflows
- Tables: Sortable, filterable data grids for rating factors
- Modals: For detailed reviews and confirmations

## Security Requirements
- Azure AD integration for authentication
- Row-level security for multi-tenant data
- Encryption at rest and in transit
- Regular security audits and penetration testing

## Performance Requirements
- Rating calculations < 2 seconds for standard algorithms
- File imports < 30 seconds for typical bureau filings
- Dashboard load time < 1 second
- Support concurrent users (minimum 50)

## Integration Points
- Azure OpenAI API for AI-powered calculations
- Azure DevOps for deployment and version control
- Power BI for advanced analytics and reporting
- Third-party rating bureaus for data imports

## Accessibility
- WCAG 2.1 AA compliance
- Keyboard navigation support
- Screen reader compatibility
- High contrast mode for visually impaired users`;
}

export function generateInsuranceArtifacts(requirement: string): {
  epics: Epic[];
  features: Feature[];
  userStories: UserStory[];
} {
  const epics: Epic[] = [
    {
      id: "epic-1",
      title: "Bureau Rating Algorithm Import System",
      description: "Enable actuaries to import, parse, and validate bureau rating algorithms from multiple sources and formats",
      priority: "High",
      featureCount: 3,
    },
    {
      id: "epic-2",
      title: "AI-Powered Premium Calculation Engine",
      description: "Build an intelligent rating engine that uses AI/ML to optimize premium calculations while maintaining actuarial accuracy",
      priority: "High",
      featureCount: 3,
    },
    {
      id: "epic-3",
      title: "Compliance & Audit Management",
      description: "Implement comprehensive audit trails and regulatory compliance features for all rating activities",
      priority: "Medium",
      featureCount: 2,
    },
  ];

  const features: Feature[] = [
    {
      id: "feature-1",
      title: "Multi-Format File Import",
      description: "Support import of bureau filings from PDF, Excel, XML, and CSV formats with automatic data extraction",
      epicId: "epic-1",
      priority: "High",
      storyCount: 4,
    },
    {
      id: "feature-2",
      title: "Algorithm Validation Engine",
      description: "Validate imported algorithms against business rules and actuarial standards",
      epicId: "epic-1",
      priority: "High",
      storyCount: 3,
    },
    {
      id: "feature-3",
      title: "Rating Factor Management",
      description: "Manage and configure rating factors, territories, and classification systems",
      epicId: "epic-1",
      priority: "Medium",
      storyCount: 3,
    },
    {
      id: "feature-4",
      title: "AI Calculation Interface",
      description: "Integrate Azure OpenAI to enhance premium calculations with machine learning insights",
      epicId: "epic-2",
      priority: "High",
      storyCount: 4,
    },
    {
      id: "feature-5",
      title: "Premium Optimization Dashboard",
      description: "Visualize rating results, compare scenarios, and analyze premium impacts",
      epicId: "epic-2",
      priority: "High",
      storyCount: 3,
    },
    {
      id: "feature-6",
      title: "Actuarial Review Workflow",
      description: "Enable actuarial peer review and approval processes for AI-generated calculations",
      epicId: "epic-2",
      priority: "Medium",
      storyCount: 3,
    },
    {
      id: "feature-7",
      title: "Audit Trail System",
      description: "Comprehensive logging of all rating changes, calculations, and user actions",
      epicId: "epic-3",
      priority: "High",
      storyCount: 3,
    },
    {
      id: "feature-8",
      title: "Regulatory Reporting",
      description: "Generate regulatory filing reports and export data in required formats",
      epicId: "epic-3",
      priority: "Medium",
      storyCount: 2,
    },
  ];

  const userStories: UserStory[] = [
    // Feature 1: Multi-Format File Import
    {
      id: "story-1",
      title: "As a Senior Developer, I want to implement a robust PDF parsing service",
      description: "Implement a service that can extract rating tables and algorithms from PDF bureau filings with 95%+ accuracy",
      persona: "Michael Chen",
      personaId: "persona-1",
      acceptanceCriteria: [
        "Given a PDF bureau filing, when uploaded, then extract all rating tables accurately",
        "When parsing fails, then provide clear error messages with line numbers",
        "Then validate extracted data against expected schema",
      ],
      priority: "High",
      storyPoints: 8,
      featureId: "feature-1",
      epicId: "epic-1",
    },
    {
      id: "story-2",
      title: "As a Business Analyst, I want to map imported data to our rating structure",
      description: "Create a mapping interface that allows BAs to define how bureau data maps to our internal rating structure",
      persona: "Emily Rodriguez",
      personaId: "persona-4",
      acceptanceCriteria: [
        "Given imported bureau data, when viewing in mapper, then see all available fields",
        "When creating mappings, then save configurations for reuse",
        "Then validate mappings before applying to production",
      ],
      priority: "High",
      storyPoints: 5,
      featureId: "feature-1",
      epicId: "epic-1",
    },
    {
      id: "story-3",
      title: "As a QA Engineer, I want automated validation of imported algorithms",
      description: "Build automated tests that verify imported algorithms match bureau specifications",
      persona: "Sarah Johnson",
      personaId: "persona-2",
      acceptanceCriteria: [
        "Given an imported algorithm, when validation runs, then check all required fields present",
        "When data type mismatches occur, then flag for manual review",
        "Then generate validation report with pass/fail status",
      ],
      priority: "High",
      storyPoints: 5,
      featureId: "feature-1",
      epicId: "epic-1",
    },
    {
      id: "story-4",
      title: "As a Project Manager, I want to track import progress and errors",
      description: "Dashboard showing real-time progress of file imports and any errors encountered",
      persona: "David Williams",
      personaId: "persona-3",
      acceptanceCriteria: [
        "Given active imports, when viewing dashboard, then see progress percentage",
        "When errors occur, then display error count and details",
        "Then provide option to download error logs",
      ],
      priority: "Medium",
      storyPoints: 3,
      featureId: "feature-1",
      epicId: "epic-1",
    },
    // Feature 2: Algorithm Validation Engine
    {
      id: "story-5",
      title: "As a Business Analyst, I want to define business rules for validation",
      description: "Create a rule engine that allows BAs to define and manage validation rules without coding",
      persona: "Emily Rodriguez",
      personaId: "persona-4",
      acceptanceCriteria: [
        "Given validation needs, when creating rules, then use no-code interface",
        "When rules are saved, then apply to all new imports automatically",
        "Then test rules against sample data before activation",
      ],
      priority: "High",
      storyPoints: 8,
      featureId: "feature-2",
      epicId: "epic-1",
    },
    {
      id: "story-6",
      title: "As a Senior Developer, I want to implement actuarial calculation validators",
      description: "Build validators that check mathematical accuracy of rating algorithms",
      persona: "Michael Chen",
      personaId: "persona-1",
      acceptanceCriteria: [
        "Given rating formulas, when validating, then verify mathematical correctness",
        "When edge cases found, then log warnings for actuarial review",
        "Then ensure performance under load (1000+ validations/minute)",
      ],
      priority: "High",
      storyPoints: 8,
      featureId: "feature-2",
      epicId: "epic-1",
    },
    {
      id: "story-7",
      title: "As a QA Engineer, I want comprehensive test coverage for validation",
      description: "Create test suites covering all validation scenarios including edge cases",
      persona: "Sarah Johnson",
      personaId: "persona-2",
      acceptanceCriteria: [
        "Given validation logic, when testing, then achieve 90%+ code coverage",
        "When running tests, then complete full suite in under 5 minutes",
        "Then include regression tests for all found bugs",
      ],
      priority: "High",
      storyPoints: 5,
      featureId: "feature-2",
      epicId: "epic-1",
    },
    // Feature 3: Rating Factor Management
    {
      id: "story-8",
      title: "As a Business Analyst, I want to configure rating territories",
      description: "Interface for managing geographical territories and their rating factors",
      persona: "Emily Rodriguez",
      personaId: "persona-4",
      acceptanceCriteria: [
        "Given territory data, when configuring, then support ZIP code ranges",
        "When territories overlap, then flag for resolution",
        "Then export territory maps for actuarial review",
      ],
      priority: "Medium",
      storyPoints: 5,
      featureId: "feature-3",
      epicId: "epic-1",
    },
    {
      id: "story-9",
      title: "As a Senior Developer, I want to implement classification system versioning",
      description: "Build version control for rating classification systems to track changes over time",
      persona: "Michael Chen",
      personaId: "persona-1",
      acceptanceCriteria: [
        "Given classification changes, when saving, then create new version",
        "When comparing versions, then show diff of changes",
        "Then allow rollback to previous versions",
      ],
      priority: "Medium",
      storyPoints: 5,
      featureId: "feature-3",
      epicId: "epic-1",
    },
    {
      id: "story-10",
      title: "As a Project Manager, I want to track classification system changes",
      description: "Dashboard showing history of all classification system modifications",
      persona: "David Williams",
      personaId: "persona-3",
      acceptanceCriteria: [
        "Given classification history, when viewing, then see chronological timeline",
        "When filtering by date range, then show relevant changes",
        "Then export change log for stakeholder reviews",
      ],
      priority: "Low",
      storyPoints: 3,
      featureId: "feature-3",
      epicId: "epic-1",
    },
    // Feature 4: AI Calculation Interface
    {
      id: "story-11",
      title: "As a Senior Developer, I want to integrate Azure OpenAI API",
      description: "Build robust integration with Azure OpenAI for premium calculation enhancement",
      persona: "Michael Chen",
      personaId: "persona-1",
      acceptanceCriteria: [
        "Given rating inputs, when calling AI, then receive premium recommendations",
        "When API fails, then fallback to traditional calculation",
        "Then implement rate limiting and error handling",
      ],
      priority: "High",
      storyPoints: 8,
      featureId: "feature-4",
      epicId: "epic-2",
    },
    {
      id: "story-12",
      title: "As a Business Analyst, I want to configure AI confidence thresholds",
      description: "Interface for setting minimum confidence levels for AI-generated premiums",
      persona: "Emily Rodriguez",
      personaId: "persona-4",
      acceptanceCriteria: [
        "Given AI results, when confidence is low, then flag for manual review",
        "When setting thresholds, then validate against historical accuracy",
        "Then document threshold rationale for regulatory compliance",
      ],
      priority: "High",
      storyPoints: 5,
      featureId: "feature-4",
      epicId: "epic-2",
    },
    {
      id: "story-13",
      title: "As a QA Engineer, I want to validate AI calculation accuracy",
      description: "Create test framework comparing AI calculations against known-good results",
      persona: "Sarah Johnson",
      personaId: "persona-2",
      acceptanceCriteria: [
        "Given test cases, when running AI calculations, then compare to baseline",
        "When accuracy drops below threshold, then alert development team",
        "Then maintain test data library of edge cases",
      ],
      priority: "High",
      storyPoints: 8,
      featureId: "feature-4",
      epicId: "epic-2",
    },
    {
      id: "story-14",
      title: "As a DevOps Engineer, I want to monitor AI API performance",
      description: "Implement monitoring and alerting for Azure OpenAI API usage and performance",
      persona: "Alex Kumar",
      personaId: "persona-5",
      acceptanceCriteria: [
        "Given API calls, when monitoring, then track latency and success rate",
        "When errors spike, then send alerts to on-call team",
        "Then dashboard showing API usage vs. quota",
      ],
      priority: "Medium",
      storyPoints: 5,
      featureId: "feature-4",
      epicId: "epic-2",
    },
    // Feature 5: Premium Optimization Dashboard
    {
      id: "story-15",
      title: "As a Business Analyst, I want to visualize rating scenario comparisons",
      description: "Interactive dashboard comparing different rating scenarios side-by-side",
      persona: "Emily Rodriguez",
      personaId: "persona-4",
      acceptanceCriteria: [
        "Given multiple scenarios, when viewing dashboard, then see side-by-side comparison",
        "When changing inputs, then update visualizations in real-time",
        "Then export comparison reports for stakeholders",
      ],
      priority: "High",
      storyPoints: 8,
      featureId: "feature-5",
      epicId: "epic-2",
    },
    {
      id: "story-16",
      title: "As a Senior Developer, I want real-time calculation performance",
      description: "Optimize calculation engine for sub-2-second response times",
      persona: "Michael Chen",
      personaId: "persona-1",
      acceptanceCriteria: [
        "Given rating inputs, when calculating, then return results in under 2 seconds",
        "When load increases, then maintain performance through caching",
        "Then implement query optimization for database access",
      ],
      priority: "High",
      storyPoints: 8,
      featureId: "feature-5",
      epicId: "epic-2",
    },
    {
      id: "story-17",
      title: "As a Project Manager, I want premium impact analysis reports",
      description: "Generate reports showing premium changes across different customer segments",
      persona: "David Williams",
      personaId: "persona-3",
      acceptanceCriteria: [
        "Given rating changes, when generating report, then segment by demographics",
        "When reviewing impacts, then highlight outliers and extremes",
        "Then schedule automated report generation",
      ],
      priority: "Medium",
      storyPoints: 5,
      featureId: "feature-5",
      epicId: "epic-2",
    },
    // Feature 6: Actuarial Review Workflow
    {
      id: "story-18",
      title: "As a Business Analyst, I want peer review workflows for calculations",
      description: "Implement approval workflows requiring actuarial sign-off before production",
      persona: "Emily Rodriguez",
      personaId: "persona-4",
      acceptanceCriteria: [
        "Given AI calculations, when submitting for review, then assign to actuarial team",
        "When reviews complete, then require digital signature",
        "Then track review cycle time and bottlenecks",
      ],
      priority: "Medium",
      storyPoints: 5,
      featureId: "feature-6",
      epicId: "epic-2",
    },
    {
      id: "story-19",
      title: "As a Senior Developer, I want explainable AI outputs",
      description: "Generate detailed explanations of how AI arrived at premium recommendations",
      persona: "Michael Chen",
      personaId: "persona-1",
      acceptanceCriteria: [
        "Given AI calculation, when explaining, then show factor contributions",
        "When reviewing logic, then display decision tree visualization",
        "Then export explanation for regulatory documentation",
      ],
      priority: "High",
      storyPoints: 8,
      featureId: "feature-6",
      epicId: "epic-2",
    },
    {
      id: "story-20",
      title: "As a QA Engineer, I want automated regression testing for approved calculations",
      description: "Lock in approved calculations as regression tests for future changes",
      persona: "Sarah Johnson",
      personaId: "persona-2",
      acceptanceCriteria: [
        "Given approved calculation, when saving, then create regression test",
        "When code changes, then run all regression tests automatically",
        "Then alert if previously-approved calculations change",
      ],
      priority: "Medium",
      storyPoints: 5,
      featureId: "feature-6",
      epicId: "epic-2",
    },
    // Feature 7: Audit Trail System
    {
      id: "story-21",
      title: "As a DevOps Engineer, I want comprehensive system logging",
      description: "Implement centralized logging for all user actions and system events",
      persona: "Alex Kumar",
      personaId: "persona-5",
      acceptanceCriteria: [
        "Given user actions, when performing operations, then log to centralized system",
        "When querying logs, then support filtering by user, action, timestamp",
        "Then retain logs for minimum 7 years for regulatory compliance",
      ],
      priority: "High",
      storyPoints: 8,
      featureId: "feature-7",
      epicId: "epic-3",
    },
    {
      id: "story-22",
      title: "As a Business Analyst, I want to view audit history for calculations",
      description: "Interface showing complete history of all changes to rating calculations",
      persona: "Emily Rodriguez",
      personaId: "persona-4",
      acceptanceCriteria: [
        "Given calculation ID, when viewing history, then see all versions chronologically",
        "When comparing versions, then highlight differences",
        "Then export audit trail for regulatory requests",
      ],
      priority: "High",
      storyPoints: 5,
      featureId: "feature-7",
      epicId: "epic-3",
    },
    {
      id: "story-23",
      title: "As a Senior Developer, I want tamper-proof audit logs",
      description: "Implement cryptographic signing of audit logs to prevent tampering",
      persona: "Michael Chen",
      personaId: "persona-1",
      acceptanceCriteria: [
        "Given audit entry, when creating, then cryptographically sign",
        "When verifying logs, then detect any modifications",
        "Then use blockchain-style chain of custody",
      ],
      priority: "Medium",
      storyPoints: 8,
      featureId: "feature-7",
      epicId: "epic-3",
    },
    // Feature 8: Regulatory Reporting
    {
      id: "story-24",
      title: "As a Business Analyst, I want to generate regulatory filing exports",
      description: "Export rating data in formats required by state insurance departments",
      persona: "Emily Rodriguez",
      personaId: "persona-4",
      acceptanceCriteria: [
        "Given rating algorithms, when exporting, then format per state requirements",
        "When selecting state, then apply jurisdiction-specific rules",
        "Then validate export against state filing schemas",
      ],
      priority: "Medium",
      storyPoints: 5,
      featureId: "feature-8",
      epicId: "epic-3",
    },
    {
      id: "story-25",
      title: "As a Project Manager, I want filing deadline tracking",
      description: "Dashboard tracking upcoming regulatory filing deadlines and submission status",
      persona: "David Williams",
      personaId: "persona-3",
      acceptanceCriteria: [
        "Given filing deadlines, when approaching, then send reminder notifications",
        "When filings submitted, then mark as complete with submission ID",
        "Then generate compliance status reports for leadership",
      ],
      priority: "Low",
      storyPoints: 3,
      featureId: "feature-8",
      epicId: "epic-3",
    },
  ];

  return { epics, features, userStories };
}
