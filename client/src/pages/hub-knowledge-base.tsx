import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Search, FileText, Plus } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PageHeader } from "@/components/ui/page-header";

interface KnowledgeBaseArticle {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  content: string;
  lastUpdated: string;
}

const sampleArticles: KnowledgeBaseArticle[] = [
  {
    id: "1",
    title: "Getting Started with SDLC Management",
    description: "Complete guide to understanding and implementing software development lifecycle processes",
    category: "Getting Started",
    tags: ["sdlc", "beginner", "guide", "fundamentals"],
    content: `# Getting Started with SDLC Management

The Software Development Lifecycle (SDLC) is a structured approach to software development that defines the phases and activities required to deliver high-quality software products.

## What is SDLC?

SDLC is a systematic process for planning, creating, testing, and deploying software applications. It provides a framework that ensures software is developed efficiently, meets requirements, and is delivered on time and within budget.

## The 6 Phases of SDLC

### 1. Requirements & Analysis
This initial phase focuses on gathering and analyzing business requirements. Key activities include:
- **Stakeholder interviews**: Understanding business needs and goals
- **Requirements documentation**: Creating detailed requirement specifications
- **Feasibility analysis**: Assessing technical, operational, and economic viability
- **Scope definition**: Establishing project boundaries and deliverables

**Deliverables**: Business Requirements Document (BRD), Functional Requirements Specification (FRS), Use Cases

### 2. Design
Transform requirements into a blueprint for development:
- **System architecture**: Define high-level system structure
- **Database design**: Design data models and relationships
- **UI/UX design**: Create wireframes, mockups, and prototypes
- **API specifications**: Define interfaces and integration points
- **Security design**: Plan authentication, authorization, and data protection

**Deliverables**: System Design Document, Database Schema, UI/UX Prototypes, Technical Specifications

### 3. Development
The actual coding and implementation phase:
- **Development environment setup**: Configure tools, IDEs, and repositories
- **Code implementation**: Write application code following coding standards
- **Version control**: Use Git for source code management
- **Code reviews**: Peer review code for quality and maintainability
- **Documentation**: Create inline code comments and technical docs

**Deliverables**: Source Code, Unit Tests, Technical Documentation

### 4. Build & Testing
Ensure the software works correctly and meets requirements:
- **Unit testing**: Test individual components in isolation
- **Integration testing**: Verify components work together correctly
- **System testing**: Test the complete, integrated system
- **Performance testing**: Validate speed, scalability, and reliability
- **Security testing**: Identify vulnerabilities and security risks
- **User acceptance testing (UAT)**: Verify software meets user needs

**Deliverables**: Test Plans, Test Cases, Test Results, Bug Reports

### 5. Deployment
Release the software to production:
- **Deployment planning**: Define rollout strategy and timeline
- **Environment setup**: Configure production infrastructure
- **Data migration**: Transfer data from legacy systems if needed
- **Release execution**: Deploy application to production
- **Monitoring**: Set up logging, alerts, and health checks
- **User training**: Train end-users on new system

**Deliverables**: Deployment Plan, Release Notes, Training Materials

### 6. Maintenance
Ongoing support and enhancement:
- **Bug fixes**: Address defects found in production
- **Performance optimization**: Improve system efficiency
- **Feature enhancements**: Add new capabilities based on feedback
- **Security patches**: Apply updates to address vulnerabilities
- **Technical debt management**: Refactor code and update dependencies

**Deliverables**: Maintenance Logs, Change Requests, Updated Documentation

## Benefits of SDLC

1. **Structured approach**: Clear phases and deliverables
2. **Quality assurance**: Built-in testing and validation
3. **Risk management**: Early identification of issues
4. **Cost control**: Better estimation and budget management
5. **Stakeholder alignment**: Regular communication and feedback
6. **Documentation**: Comprehensive records for future reference

## Best Practices

- **Start with clear requirements**: Invest time upfront to understand needs
- **Involve stakeholders early and often**: Regular communication prevents surprises
- **Adopt iterative development**: Deliver value incrementally
- **Automate testing**: Catch bugs early with automated test suites
- **Maintain documentation**: Keep docs up-to-date throughout the lifecycle
- **Monitor and measure**: Track metrics to improve processes
- **Plan for security**: Build security in from the start, not as an afterthought

## Common SDLC Challenges

- **Changing requirements**: Use Agile methodologies to adapt
- **Communication gaps**: Establish clear channels and regular meetings
- **Technical debt**: Allocate time for refactoring and improvements
- **Resource constraints**: Prioritize features and manage scope
- **Integration issues**: Plan integration points early in design phase`,
    lastUpdated: "2024-11-04"
  },
  {
    id: "2",
    title: "Agile Methodology: Principles and Practices",
    description: "Comprehensive guide to Agile software development methodology and implementation",
    category: "Methodologies",
    tags: ["agile", "scrum", "methodology", "best-practices"],
    content: `# Agile Methodology: Principles and Practices

Agile is an iterative approach to software development that emphasizes flexibility, collaboration, and customer satisfaction through continuous delivery of working software.

## The Agile Manifesto

Agile is built on four core values:

1. **Individuals and interactions** over processes and tools
2. **Working software** over comprehensive documentation
3. **Customer collaboration** over contract negotiation
4. **Responding to change** over following a plan

## 12 Agile Principles

1. Satisfy customers through early and continuous delivery
2. Welcome changing requirements, even late in development
3. Deliver working software frequently (weeks not months)
4. Business people and developers must work together daily
5. Build projects around motivated individuals
6. Face-to-face conversation is the most effective communication
7. Working software is the primary measure of progress
8. Maintain a sustainable development pace indefinitely
9. Continuous attention to technical excellence and good design
10. Simplicity - maximize the amount of work not done
11. Self-organizing teams produce the best results
12. Regular reflection and adjustment for effectiveness

## Scrum Framework

Scrum is the most popular Agile framework for managing product development.

### Scrum Roles

**Product Owner**
- Defines product vision and priorities
- Manages and prioritizes product backlog
- Accepts or rejects completed work
- Represents stakeholder interests

**Scrum Master**
- Facilitates Scrum ceremonies
- Removes impediments for the team
- Coaches team on Agile practices
- Shields team from external interruptions

**Development Team**
- Cross-functional team members (5-9 people)
- Self-organizing and autonomous
- Collectively responsible for delivering increment
- No hierarchical structure within team

### Scrum Artifacts

**Product Backlog**
- Prioritized list of features, enhancements, and fixes
- Owned and maintained by Product Owner
- Items described as user stories
- Continuously refined and reprioritized

**Sprint Backlog**
- Subset of product backlog selected for current sprint
- Owned by Development Team
- Includes tasks to complete selected items
- Updated daily during sprint

**Increment**
- Sum of all completed product backlog items
- Must be in usable condition
- Meets Definition of Done
- Potentially shippable product

### Scrum Ceremonies

**Sprint Planning** (2-4 hours for 2-week sprint)
- What can be delivered this sprint?
- How will the work be accomplished?
- Create sprint goal and sprint backlog

**Daily Standup** (15 minutes)
- What did I complete yesterday?
- What will I work on today?
- What impediments are blocking me?

**Sprint Review** (1-2 hours)
- Demo completed work to stakeholders
- Gather feedback
- Update product backlog based on feedback

**Sprint Retrospective** (1-1.5 hours)
- What went well?
- What could be improved?
- Action items for next sprint

## Kanban Framework

Alternative Agile framework focused on continuous flow:

### Key Principles
- **Visualize workflow**: Use Kanban board
- **Limit work in progress**: Prevent context switching
- **Manage flow**: Optimize movement through pipeline
- **Make policies explicit**: Clear process rules
- **Implement feedback loops**: Regular reviews
- **Improve collaboratively**: Evolve incrementally

### Kanban Board Columns
- **Backlog**: Prioritized work items
- **To Do**: Ready for development
- **In Progress**: Active work (WIP limited)
- **In Review**: Code review or QA
- **Done**: Completed and deployed

## Agile Best Practices

### User Stories
Format: "As a [role], I want [feature] so that [benefit]"

**Example**:
"As a project manager, I want to view team velocity metrics so that I can forecast delivery dates accurately"

**Good User Story Characteristics (INVEST)**:
- **Independent**: Can be developed separately
- **Negotiable**: Details can be discussed
- **Valuable**: Delivers business value
- **Estimable**: Team can estimate effort
- **Small**: Fits within one sprint
- **Testable**: Clear acceptance criteria

### Story Points and Estimation

Use relative sizing (Fibonacci sequence: 1, 2, 3, 5, 8, 13, 21):
- **1-2 points**: Simple change, few hours
- **3-5 points**: Standard feature, 1-2 days
- **8-13 points**: Complex feature, 3-5 days
- **21+ points**: Epic, needs decomposition

**Planning Poker**: Team-based estimation technique
1. Each member selects estimate privately
2. Reveal estimates simultaneously
3. Discuss discrepancies
4. Re-estimate until consensus

### Definition of Done (DoD)

Checklist for completed work:
- ☐ Code complete and follows standards
- ☐ Unit tests written (>80% coverage)
- ☐ Integration tests passing
- ☐ Code reviewed and approved
- ☐ Documentation updated
- ☐ Deployed to staging
- ☐ Acceptance criteria met
- ☐ Product owner accepted

### Velocity Tracking

- **Velocity**: Story points completed per sprint
- **Average velocity**: Mean over last 3-5 sprints
- **Use for forecasting**: Predict future capacity
- **Don't compare teams**: Velocity is team-specific

## Common Agile Challenges

**Challenge**: Scope creep during sprint
**Solution**: Protect sprint commitment, defer new items to backlog

**Challenge**: Unclear requirements
**Solution**: Invest time in backlog refinement, define acceptance criteria

**Challenge**: Technical debt accumulation
**Solution**: Allocate 20% sprint capacity for technical work

**Challenge**: Distributed teams
**Solution**: Use video conferencing, async communication, overlap hours

**Challenge**: Resistance to change
**Solution**: Start small, demonstrate value, provide training

## Measuring Agile Success

### Team Metrics
- Sprint velocity (trending up or stable)
- Sprint commitment reliability (70-90%)
- Cycle time (time from start to done)
- Lead time (time from request to delivery)
- Escaped defects (bugs found in production)

### Product Metrics
- Customer satisfaction (NPS, CSAT)
- Feature adoption rate
- Time to market
- Business value delivered
- Technical debt ratio

## Transitioning to Agile

1. **Educate the organization**: Training and workshops
2. **Start with one team**: Pilot program
3. **Establish ceremonies**: Regular cadence
4. **Create backlogs**: Prioritized work items
5. **Iterative delivery**: Short sprints
6. **Inspect and adapt**: Continuous improvement
7. **Scale gradually**: Expand to more teams

Agile is a journey, not a destination. Continuously reflect, learn, and improve your processes.`,
    lastUpdated: "2024-11-04"
  },
  {
    id: "3",
    title: "Azure DevOps Integration Guide",
    description: "Complete guide to integrating and managing work items with Azure DevOps",
    category: "Integrations",
    tags: ["azure", "devops", "integration", "setup"],
    content: `# Azure DevOps Integration Guide

Azure DevOps provides a comprehensive suite of development tools for planning, development, delivery, and operations. This guide covers how to integrate Azure DevOps with DevPlatform.

## What is Azure DevOps?

Azure DevOps is a cloud-based service that provides:
- **Azure Boards**: Agile planning and work tracking
- **Azure Repos**: Git repositories for source control
- **Azure Pipelines**: CI/CD automation
- **Azure Test Plans**: Manual and exploratory testing
- **Azure Artifacts**: Package management

## Prerequisites

Before integrating, ensure you have:
1. Azure DevOps organization and project
2. Personal Access Token (PAT) with appropriate permissions
3. Project configured in Azure DevOps
4. Work item types defined (Epic, Feature, User Story, Task, Bug)

## Setting Up Integration

### Step 1: Create Personal Access Token

1. Navigate to Azure DevOps
2. Click on User Settings (top right) → Personal Access Tokens
3. Click "+ New Token"
4. Configure token:
   - **Name**: DevPlatform Integration
   - **Organization**: Select your organization
   - **Expiration**: 90 days or custom
   - **Scopes**: Select "Work Items" (Read, Write, & Manage)
5. Click "Create"
6. **Important**: Copy the token immediately (it won't be shown again)

### Step 2: Configure Integration in DevPlatform

1. Navigate to Hub → Integrations → Azure DevOps
2. Enter your Azure DevOps details:
   - **Organization URL**: https://dev.azure.com/{your-organization}
   - **Project Name**: Your project name
   - **Personal Access Token**: Paste the PAT created in Step 1
3. Click "Test Connection"
4. Once verified, click "Save"

### Step 3: Verify Integration

- Navigate to Hub → Artifacts
- You should see your Azure DevOps projects listed
- Click on a project to view work items

## Work Item Hierarchy

Azure DevOps supports hierarchical work item relationships:

\`\`\`
Epic
  └── Feature
       └── User Story
            ├── Task
            └── Bug
\`\`\`

### Work Item Types

**Epic**
- Large body of work that spans multiple sprints
- Strategic initiatives or major features
- Contains multiple Features

**Feature**
- Shippable functionality
- Typically completed in one sprint
- Contains User Stories

**User Story**
- Smallest unit of user-facing functionality
- Written from user perspective
- Contains Tasks and Bugs

**Task**
- Technical work to complete User Story
- Development, testing, documentation tasks
- Measured in hours

**Bug**
- Defect or issue in the software
- Linked to User Story or Feature
- Prioritized and tracked separately

**Issue**
- Impediment or blocker
- Not directly related to features
- Requires resolution before progress

## Using WIQL Queries

Work Item Query Language (WIQL) allows advanced work item filtering.

### Basic Query Structure

\`\`\`sql
SELECT [System.Id], [System.Title], [System.State]
FROM WorkItems
WHERE [System.WorkItemType] = 'User Story'
  AND [System.State] = 'Active'
ORDER BY [System.CreatedDate] DESC
\`\`\`

### Common WIQL Queries

**All Active User Stories**
\`\`\`sql
SELECT *
FROM WorkItems
WHERE [System.WorkItemType] = 'User Story'
  AND [System.State] IN ('New', 'Active', 'Resolved')
\`\`\`

**High Priority Bugs**
\`\`\`sql
SELECT *
FROM WorkItems
WHERE [System.WorkItemType] = 'Bug'
  AND [Microsoft.VSTS.Common.Priority] <= 2
  AND [System.State] <> 'Closed'
\`\`\`

**Work Items Assigned to Me**
\`\`\`sql
SELECT *
FROM WorkItems
WHERE [System.AssignedTo] = @Me
  AND [System.State] <> 'Closed'
\`\`\`

**Epics and Their Children**
\`\`\`sql
SELECT *
FROM WorkItemLinks
WHERE [Source].[System.WorkItemType] = 'Epic'
  AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward'
MODE (Recursive)
\`\`\`

## Work Item States

Default workflow states:

1. **New**: Work item created, not started
2. **Active**: Work in progress
3. **Resolved**: Work complete, awaiting verification
4. **Closed**: Work verified and accepted
5. **Removed**: Work item cancelled or deleted

## Creating Work Items via API

### Create Epic

\`\`\`http
POST https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/${`$`}Epic?api-version=7.1
Content-Type: application/json-patch+json

[
  {
    "op": "add",
    "path": "/fields/System.Title",
    "value": "Customer Portal Redesign"
  },
  {
    "op": "add",
    "path": "/fields/System.Description",
    "value": "Modernize customer-facing portal..."
  }
]
\`\`\`

### Create User Story with Parent

\`\`\`http
POST https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/${`$`}User Story?api-version=7.1

[
  {
    "op": "add",
    "path": "/fields/System.Title",
    "value": "User can reset password"
  },
  {
    "op": "add",
    "path": "/relations/-",
    "value": {
      "rel": "System.LinkTypes.Hierarchy-Reverse",
      "url": "https://dev.azure.com/{org}/_apis/wit/workitems/{parentId}"
    }
  }
]
\`\`\`

## Link Types

Azure DevOps supports various link relationships:

- **Parent**: Hierarchical parent
- **Child**: Hierarchical child
- **Related**: Non-hierarchical association
- **Successor**: Follows this work item
- **Predecessor**: Precedes this work item
- **Duplicate**: Duplicate of another item
- **Tested By**: Associated test case

## Best Practices

### Organization

- **Use Area Paths**: Organize work by team or feature area
- **Use Iteration Paths**: Track work by sprint or release
- **Tag Work Items**: Add searchable tags (#ui, #backend, #bug)
- **Link Related Items**: Create traceability between work items

### Workflow Management

- **Keep Work Items Updated**: Move cards as work progresses
- **Add Details**: Include acceptance criteria, tasks, attachments
- **Estimate Accurately**: Use story points or hours
- **Track Time**: Log completed work for analytics

### Integration Maintenance

- **Rotate PAT Tokens**: Renew before expiration
- **Monitor API Usage**: Stay within rate limits
- **Handle Errors Gracefully**: Implement retry logic
- **Cache Work Items**: Reduce API calls with caching

## Troubleshooting

**Issue**: "Unauthorized" error
**Solution**: Verify PAT token has correct scopes and hasn't expired

**Issue**: Work items not appearing
**Solution**: Check project permissions and area path access

**Issue**: Slow query performance
**Solution**: Add indexes, limit result set, use specific filters

**Issue**: Rate limiting errors
**Solution**: Implement exponential backoff, reduce API call frequency

## Advanced Features

### Custom Fields

Add custom fields to work items:
- Navigate to Organization Settings → Boards → Process
- Select process template
- Add custom field to work item type

### Automation Rules

Create rules to automate work item updates:
- Auto-assign work items
- Send notifications
- Update fields based on state changes
- Close parent when all children complete

### Analytics and Reporting

- **Velocity Chart**: Track team capacity over sprints
- **Burndown Chart**: Monitor progress toward sprint goal
- **Cumulative Flow**: Visualize work item distribution
- **Cycle Time**: Measure time from start to completion

## Resources

- Azure DevOps Documentation: https://docs.microsoft.com/azure/devops
- REST API Reference: https://docs.microsoft.com/rest/api/azure/devops
- WIQL Syntax Guide: https://docs.microsoft.com/azure/devops/boards/queries/wiql-syntax`,
    lastUpdated: "2024-11-04"
  },
  {
    id: "4",
    title: "AI-Powered Requirements Analysis with Tia Bot",
    description: "Leverage AI capabilities to gather, analyze, and refine project requirements using conversational AI",
    category: "AI Features",
    tags: ["ai", "requirements", "tia-bot", "workflow"],
    content: `# AI-Powered Requirements Analysis with Tia Bot

Tia (The Interactive Agile Assistant) is an AI-powered conversational agent that helps teams gather comprehensive requirements and generate high-quality agile artifacts.

## What is Tia Bot?

Tia Bot uses advanced natural language processing to:
- Guide interactive requirement gathering sessions
- Ask clarifying questions to uncover hidden requirements
- Identify missing details and edge cases
- Generate well-structured agile artifacts (Epics, User Stories, Tasks)
- Maintain context throughout conversations
- Adapt to different project domains and complexity levels

## Getting Started with Tia

### Accessing Tia Bot

1. Navigate to any project in DevPlatform
2. Enter an SDLC phase (Requirements & Analysis recommended)
3. Click the "Start Workflow" button
4. Tia Bot will initialize and greet you

### Initial Conversation

Tia introduces herself and asks for basic project information:
- **Project context**: What are you building?
- **Target users**: Who will use this feature?
- **Business goals**: Why is this needed?
- **Success criteria**: How will you measure success?

## How Tia Gathers Requirements

### Conversational Refinement

Tia uses a structured but flexible approach:

**Phase 1: Understanding**
- Asks open-ended questions about the feature
- Probes for context and background
- Identifies stakeholders and users

**Phase 2: Exploration**
- Explores specific use cases and scenarios
- Asks "What if?" questions to uncover edge cases
- Clarifies technical constraints and dependencies

**Phase 3: Validation**
- Confirms understanding with summaries
- Identifies gaps or ambiguities
- Asks for prioritization guidance

**Phase 4: Refinement**
- Generates draft artifacts
- Requests feedback and iterations
- Finalizes detailed specifications

### One Question at a Time

Tia asks focused, single-topic questions to:
- Maintain conversation flow
- Prevent cognitive overload
- Ensure thorough answers
- Build requirements incrementally

### Smart Follow-ups

Based on your answers, Tia adaptively asks:
- **Clarifying questions**: "Could you elaborate on what you mean by 'fast'?"
- **Edge case questions**: "What should happen if the user is offline?"
- **Completeness questions**: "Are there other types of users we should consider?"
- **Validation questions**: "Did I understand correctly that...?"

## What Tia Can Generate

### User Stories

Tia creates well-structured user stories following the template:
\`\`\`
As a [user role]
I want [capability]
So that [benefit]

Acceptance Criteria:
1. Given [context]
   When [action]
   Then [outcome]
\`\`\`

### Epics

High-level initiatives with:
- Clear business objectives
- Scope and boundaries
- Success metrics
- Feature breakdown

### Tasks

Granular implementation tasks with:
- Technical details
- Effort estimates
- Dependencies
- Acceptance criteria

### Backlog Items

Prioritized list of features with:
- Priority levels (P0, P1, P2)
- Dependencies mapped
- Estimated complexity
- Business value scores

### Requirements Documentation

Comprehensive docs including:
- Functional requirements
- Non-functional requirements (performance, security, etc.)
- User personas
- Use cases and user flows
- Technical constraints

## Best Practices for Using Tia

### Provide Context

**Good**: "I'm building an e-commerce checkout flow for a B2B marketplace that handles enterprise purchases with approval workflows"

**Better**: "I'm building a checkout feature for our B2B marketplace. Our users are procurement managers at mid-size companies who need to request approval from finance before completing purchases over ${`$`}10,000. The current process is manual via email and takes 3-5 days."

### Be Specific

**Vague**: "The system should be fast"

**Specific**: "Search results should load in under 2 seconds for 95% of queries, even with 10 million products in the catalog"

### Share Constraints Early

Tell Tia about:
- **Technical constraints**: "We must use our existing payment API"
- **Business constraints**: "Launch needed by Q1 2025"
- **Regulatory requirements**: "GDPR and CCPA compliance required"
- **Budget limitations**: "Cannot exceed 200 hours development time"

### Iterate and Refine

- Review Tia's generated artifacts
- Provide feedback: "This is close, but we also need to handle..."
- Ask Tia to revise specific sections
- Request alternative approaches

### Ask for Examples

If Tia's question is unclear:
"Could you give me an example of what you're asking about?"

## Advanced Tia Features

### Multi-Domain Expertise

Tia understands various domains:
- **E-commerce**: Cart, checkout, inventory, payments
- **SaaS**: Subscriptions, user management, billing
- **Healthcare**: HIPAA compliance, patient records, scheduling
- **Finance**: Transactions, reporting, compliance
- **Enterprise**: Workflows, approvals, integrations

### Context Retention

Tia remembers previous conversations:
- Refers back to earlier decisions
- Builds on existing requirements
- Maintains consistency across artifacts
- Connects related work items

### Intelligent Suggestions

Tia proactively suggests:
- **Security considerations**: "Should we add two-factor authentication?"
- **Accessibility features**: "Have you considered screen reader support?"
- **Performance optimizations**: "Should we implement caching for this?"
- **Error handling**: "What happens if the API call fails?"

## Real-World Example

**User**: "I need to add a dashboard for project managers"

**Tia**: "Great! Let's build a comprehensive dashboard together. First, what key metrics or information do project managers need to see at a glance?"

**User**: "They need to see team velocity, sprint progress, and upcoming deadlines"

**Tia**: "Perfect. Let's dig deeper into team velocity. How far back should the velocity trend go? Last 3 sprints, 6 sprints, or custom range?"

**User**: "Last 6 sprints with option to customize"

**Tia**: "Excellent. For sprint progress, should this show:
1. Current sprint only
2. All active sprints across teams
3. Both options with a toggle?"

**User**: "Both options with a toggle"

**Tia**: "Understood. One more question about deadlines: Should these include only project-level milestones, or also individual work item due dates?"

*...conversation continues...*

**Final Output**: Tia generates a detailed Epic with 5 User Stories, each with acceptance criteria, including:
- Velocity chart component (configurable date range)
- Sprint progress visualization (with team toggle)
- Deadline tracker (with filtering options)
- Dashboard customization (save layouts)
- Performance optimization (lazy loading, caching)

## Tips for Maximum Value

1. **Set aside focused time**: 15-30 minutes uninterrupted
2. **Have relevant docs ready**: Existing specs, designs, or notes
3. **Involve stakeholders**: Use Tia in collaborative sessions
4. **Think through edge cases**: Mention unusual scenarios
5. **Prioritize ruthlessly**: Tell Tia what must have vs. nice to have
6. **Request technical details**: Ask for API specs, database schemas
7. **Validate assumptions**: Check that Tia understood correctly
8. **Iterate on output**: Don't settle for first draft
9. **Export and share**: Download artifacts for team review
10. **Continuous improvement**: Provide feedback to improve Tia

## Common Questions

**Q: Can Tia replace requirement gathering meetings?**
A: Tia augments but doesn't replace human collaboration. Use Tia to prepare detailed requirements, then validate with stakeholders.

**Q: How technical can I get with Tia?**
A: Very technical! Tia understands architecture patterns, data structures, APIs, and can help with technical specifications.

**Q: What if Tia doesn't understand my domain?**
A: Provide more context and examples. Tia learns from your explanations and adapts.

**Q: Can I edit Tia's output?**
A: Absolutely! All generated artifacts are editable. Use Tia as a starting point.

**Q: How does Tia handle sensitive information?**
A: Conversations are private to your organization. Tia doesn't store or share data outside your instance.`,
    lastUpdated: "2024-11-04"
  },
  {
    id: "5",
    title: "Creating Effective User Personas",
    description: "Build detailed user personas to guide product decisions and user-centered design",
    category: "Best Practices",
    tags: ["persona", "ux", "planning", "user-research"],
    content: `# Creating Effective User Personas

User personas are fictional representations of your target users based on real data and research. They help teams make user-centered design decisions and prioritize features effectively.

## What is a User Persona?

A user persona is a detailed profile that represents a segment of your user base. It includes:
- **Demographics**: Age, location, occupation, education
- **Psychographics**: Goals, motivations, frustrations, values
- **Behaviors**: Usage patterns, preferences, tech savviness
- **Context**: Environment, devices, constraints

## Why Create Personas?

### Benefits

1. **User Empathy**: Help teams understand and empathize with users
2. **Decision Making**: Guide feature prioritization and design choices
3. **Communication**: Provide common language for discussing users
4. **Focus**: Prevent feature bloat by staying user-centered
5. **Alignment**: Ensure entire team understands who they're building for

### When to Use Personas

- **Product planning**: Define roadmap and features
- **Design**: Create user flows and interfaces
- **Development**: Make technical trade-offs
- **Marketing**: Craft messaging and campaigns
- **Support**: Understand user needs and pain points

## Persona Components

### 1. Basic Information

**Name**: Give your persona a realistic name (e.g., "Sarah the Startup Founder")

**Photo**: Use a stock photo or illustration to humanize

**Quote**: A memorable statement that captures their essence
> "I need tools that just work - I don't have time to learn complex systems"

### 2. Demographics

- **Age**: 28-35
- **Location**: San Francisco Bay Area
- **Occupation**: Startup Founder / CEO
- **Education**: BS in Computer Science
- **Income**: ${`$`}120K-${`$`}180K
- **Family**: Single, no children

### 3. Background

Brief narrative about their professional and personal background:

"Sarah founded a B2B SaaS startup 2 years ago after working as a senior engineer at a tech giant. She's technical but now spends 80% of her time on business operations, fundraising, and team management. She's constantly juggling priorities and values efficiency above all else."

### 4. Goals & Motivations

**Primary Goals**:
- Scale the company to 50 employees by next year
- Achieve product-market fit and secure Series A funding
- Build a strong engineering culture

**Secondary Goals**:
- Maintain work-life balance (struggles with this)
- Stay technically sharp despite management responsibilities
- Build a diverse and inclusive team

**Motivations**:
- Impact: Want to solve real problems for customers
- Achievement: Drive to succeed and prove herself
- Autonomy: Values independence and ownership

### 5. Pain Points & Frustrations

**Top Frustrations**:
1. **Time scarcity**: Overwhelmed with too many tools and processes
2. **Context switching**: Constantly interrupted and unable to focus
3. **Information overload**: Drowning in notifications and messages
4. **Tool complexity**: Doesn't have time to learn enterprise software
5. **Integration hell**: Tired of tools that don't work together

**Emotional State**:
- Stressed about company growth and funding
- Excited about product potential
- Frustrated with administrative overhead

### 6. Behaviors & Patterns

**Tech Usage**:
- Heavy Slack user (100+ messages/day)
- Manages projects in Linear or Notion
- Lives in Google Calendar
- Checks email on phone constantly
- Prefers mobile apps for quick tasks

**Work Patterns**:
- Starts work early (7 AM)
- Most productive in early morning
- Meetings from 10 AM - 4 PM
- Catches up on work in evening
- Works weekends occasionally

**Decision-Making**:
- Values recommendations from peers
- Reads reviews and comparisons
- Starts with free trials
- Willing to pay for quality tools
- Makes quick decisions (limited patience)

### 7. Technology Profile

**Skill Level**: Advanced (engineering background)

**Preferred Devices**:
- MacBook Pro (primary work)
- iPhone 14 Pro (constant companion)
- iPad for presentations

**Favorite Tools**:
- Communication: Slack, Zoom
- Project Management: Linear, Notion
- Development: GitHub, VS Code
- Design: Figma
- Analytics: Mixpanel, Google Analytics

**Adoption Pattern**: Early adopter, willing to try new tools

### 8. Scenarios & Use Cases

**Scenario 1: Weekly Planning**
Every Monday morning, Sarah reviews the week ahead. She checks sprint progress, upcoming deadlines, team capacity, and adjusts priorities. She needs a quick overview without diving into details.

**Scenario 2: Investor Update**
Sarah prepares monthly investor updates. She needs to gather metrics on product progress, team growth, revenue, and key achievements. Time is limited - she needs to compile this information quickly.

**Scenario 3: Sprint Planning**
Before each sprint, Sarah joins the planning meeting to align on priorities. She needs to understand engineering capacity, prioritize features based on business value, and communicate strategic direction.

## Persona Template

\`\`\`markdown
# [Persona Name]

## Overview
**Age**: [Range]
**Occupation**: [Title/Role]
**Location**: [City/Region]
**Quote**: "[Memorable statement]"

## Background
[2-3 sentence narrative about their background and current situation]

## Goals
1. [Primary goal]
2. [Secondary goal]
3. [Tertiary goal]

## Pain Points
1. [Top frustration]
2. [Second frustration]
3. [Third frustration]

## Behaviors
- [Key behavior 1]
- [Key behavior 2]
- [Key behavior 3]

## Technology Profile
- **Skill Level**: [Novice/Intermediate/Advanced/Expert]
- **Preferred Devices**: [List devices]
- **Favorite Tools**: [List tools they use]

## Scenarios
### Scenario 1: [Title]
[Description of how they would use your product]

### Scenario 2: [Title]
[Description of another use case]
\`\`\`

## Creating Personas: Step-by-Step

### Step 1: Gather Data

**Qualitative Research**:
- User interviews (8-12 interviews minimum)
- Contextual inquiry (observe users in their environment)
- Focus groups
- Support ticket analysis
- User feedback and surveys

**Quantitative Data**:
- Analytics (behavior patterns, feature usage)
- Demographics (from sign-up data)
- Survey responses
- A/B test results

### Step 2: Identify Patterns

Look for commonalities across users:
- Similar goals and motivations
- Shared pain points
- Common behaviors and workflows
- Demographic clusters
- Technology adoption patterns

### Step 3: Define Segments

Group users into 3-5 distinct segments based on:
- **Behavioral differences**: How they use the product
- **Goal differences**: What they want to achieve
- **Context differences**: When and where they use it

Avoid creating too many personas - 3-5 is optimal for most products.

### Step 4: Build Persona Profiles

For each segment, create a detailed profile:
1. Start with demographics (but don't over-index on this)
2. Focus on goals and motivations
3. Detail pain points and frustrations
4. Describe behaviors and patterns
5. Add context and scenarios

### Step 5: Validate with Team

Review personas with:
- Product team
- Design team
- Engineering team
- Sales and support teams
- Actual users (if possible)

Refine based on feedback.

### Step 6: Make Personas Accessible

- Create visual one-pagers for each persona
- Post in shared spaces (Figma, Miro, Confluence)
- Reference in meetings and docs
- Include in onboarding materials
- Update quarterly based on new data

## Using Personas Effectively

### In Product Development

**Feature Prioritization**:
- Will this help Sarah achieve her goals?
- Does this address a top pain point?
- Which persona benefits most?

**Design Decisions**:
- Would Sarah find this intuitive?
- Does this fit her workflow?
- Is this too complex for her limited time?

### In User Stories

\`\`\`
As Sarah the Startup Founder,
I want to see sprint progress at a glance,
So that I can quickly update investors without digging through details.
\`\`\`

### In Testing

- Recruit test participants that match personas
- Create scenarios based on persona contexts
- Evaluate designs from each persona's perspective

## Common Mistakes to Avoid

1. **Making assumptions**: Base personas on data, not stereotypes
2. **Too many personas**: Stick to 3-5 core personas
3. **Too generic**: Personas should be specific and memorable
4. **Creating and forgetting**: Reference and update regularly
5. **Demographic focus**: Behaviors and goals matter more than age/gender
6. **No negative personas**: Define who you're NOT building for

## Example: Complete Persona

\`\`\`markdown
# Marcus the Engineering Manager

**Age**: 35-42
**Occupation**: Engineering Manager at mid-size tech company
**Location**: Austin, TX
**Quote**: "I need visibility into team health and velocity, not just task completion"

## Background
Marcus leads a team of 12 engineers building a cloud infrastructure platform. He's been in engineering for 15 years and management for 5. He's technical enough to review architecture decisions but primarily focuses on team performance, hiring, and cross-functional collaboration.

## Goals
1. Improve team velocity and predictability
2. Identify and remove blockers before they impact delivery
3. Develop engineers and create growth paths
4. Maintain healthy work-life balance for team

## Pain Points
1. Lacks real-time visibility into sprint health
2. Spends too much time in status meetings
3. Difficult to track individual growth and contributions
4. Struggles to forecast capacity for roadmap planning
5. Too many tools to check (Jira, GitHub, Slack, calendar)

## Behaviors
- Checks sprint board 3-4 times per day
- Holds 1:1s with each engineer biweekly
- Reviews PRs for critical features
- Facilitates sprint planning and retrospectives
- Escalates blockers to senior leadership

## Technology Profile
- **Skill Level**: Expert (former senior engineer)
- **Preferred Devices**: MacBook Pro, iPhone
- **Favorite Tools**: Jira, Linear, GitHub, Slack, Zoom, Notion
- **Adoption Pattern**: Pragmatic - needs proven value

## Scenarios
### Scenario 1: Monday Morning Check-in
Marcus starts Monday by reviewing sprint progress. He checks burn down, identifies at-risk stories, and prepares for standup. He needs a dashboard that shows team health metrics, blockers, and capacity at a glance.

### Scenario 2: Quarterly Planning
Marcus needs to forecast team capacity for Q1 roadmap planning. He analyzes historical velocity, upcoming PTO, and ongoing projects. He needs accurate data to commit to feature delivery dates confidently.
\`\`\`

Remember: Personas are tools, not goals. Use them to drive better decisions and build products that truly serve your users' needs.`,
    lastUpdated: "2024-11-04"
  },
  {
    id: "6",
    title: "Git Branching Strategies and Workflow",
    description: "Best practices for Git branching, version control, and collaboration",
    category: "Development",
    tags: ["git", "version-control", "workflow", "collaboration"],
    content: `# Git Branching Strategies and Workflow

Effective Git workflows enable teams to collaborate efficiently, maintain code quality, and ship features reliably.

## Common Branching Strategies

### 1. Git Flow

Traditional workflow for release-based development.

**Branches**:
- \`main\`: Production-ready code
- \`develop\`: Integration branch for features
- \`feature/*\`: New features
- \`release/*\`: Release preparation
- \`hotfix/*\`: Emergency production fixes

**Workflow**:
1. Create feature branch from \`develop\`
2. Develop and test feature
3. Merge back to \`develop\` via PR
4. Create release branch when ready
5. Merge release to \`main\` and \`develop\`

**Best For**: Projects with scheduled releases, multiple versions in production

### 2. GitHub Flow

Simplified workflow for continuous deployment.

**Branches**:
- \`main\`: Always deployable
- \`feature/*\`: All changes (features, fixes, experiments)

**Workflow**:
1. Create feature branch from \`main\`
2. Make changes and commit
3. Open pull request
4. Review and discuss
5. Deploy to test environment
6. Merge to \`main\` and deploy

**Best For**: SaaS products, continuous deployment, small teams

### 3. Trunk-Based Development

Single main branch with short-lived feature branches.

**Branches**:
- \`main\`: Single source of truth
- \`feature/*\`: Short-lived (< 2 days)

**Workflow**:
1. Create small feature branch
2. Commit frequently
3. Merge back to \`main\` within 1-2 days
4. Use feature flags for incomplete work
5. Deploy from \`main\` continuously

**Best For**: High-velocity teams, DevOps culture, CI/CD maturity

## Branch Naming Conventions

\`\`\`
feature/add-user-authentication
bugfix/fix-login-timeout
hotfix/critical-security-patch
release/v2.3.0
refactor/simplify-api-client
docs/update-readme
test/add-integration-tests
\`\`\`

## Commit Message Best Practices

### Conventional Commits Format

\`\`\`
<type>(<scope>): <subject>

<body>

<footer>
\`\`\`

**Types**:
- \`feat\`: New feature
- \`fix\`: Bug fix
- \`docs\`: Documentation only
- \`style\`: Formatting, white-space
- \`refactor\`: Code restructuring
- \`test\`: Adding tests
- \`chore\`: Maintenance tasks

**Examples**:
\`\`\`
feat(auth): add password reset functionality

Implemented email-based password reset flow with token expiration.
Includes email templates and rate limiting.

Closes #123
\`\`\`

\`\`\`
fix(api): handle null response in user endpoint

Added null check to prevent app crashes when API returns empty user.

\`\`\`

## Pull Request Workflow

### Creating PRs

1. **Clear title**: Summarize the change
2. **Detailed description**: Explain what, why, and how
3. **Link issues**: Reference related tickets
4. **Screenshots**: Include visual changes
5. **Test plan**: Describe how to test
6. **Checklist**: Ensure completeness

### PR Template

\`\`\`markdown
## Description
[Brief description of changes]

## Related Issues
Closes #[issue number]

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
[How to test these changes]

## Screenshots (if applicable)
[Add screenshots]

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] All tests passing
- [ ] No merge conflicts
\`\`\`

### Code Review Guidelines

**For Authors**:
- Keep PRs small (< 400 lines)
- Provide context in description
- Respond to feedback promptly
- Be open to suggestions

**For Reviewers**:
- Review within 24 hours
- Be constructive and specific
- Ask questions, don't assume
- Approve when ready, request changes when needed

## Merge Strategies

### Merge Commit
Creates a merge commit preserving full history.
\`\`\`bash
git merge feature/new-feature
\`\`\`
**Pros**: Full history, clear feature boundaries
**Cons**: Cluttered history

### Squash and Merge
Combines all commits into one.
\`\`\`bash
git merge --squash feature/new-feature
\`\`\`
**Pros**: Clean linear history
**Cons**: Loses intermediate commits

### Rebase and Merge
Replays commits on top of base branch.
\`\`\`bash
git rebase main
git merge feature/new-feature
\`\`\`
**Pros**: Linear history, preserves commits
**Cons**: More complex, can rewrite history

## Handling Merge Conflicts

1. **Pull latest changes**
   \`\`\`bash
   git checkout main
   git pull origin main
   \`\`\`

2. **Merge main into feature branch**
   \`\`\`bash
   git checkout feature/my-feature
   git merge main
   \`\`\`

3. **Resolve conflicts**
   - Open conflicted files
   - Look for \`<<<<<<\`, \`======\`, \`>>>>>>\` markers
   - Choose or combine changes
   - Remove conflict markers

4. **Test and commit**
   \`\`\`bash
   git add .
   git commit -m "Merge main and resolve conflicts"
   git push origin feature/my-feature
   \`\`\`

## Protecting Main Branch

Configure branch protection rules:
- [x] Require pull request before merging
- [x] Require approvals (1-2 reviewers)
- [x] Dismiss stale approvals
- [x] Require status checks to pass
- [x] Require conversation resolution
- [x] Restrict who can push

## Useful Git Commands

\`\`\`bash
# Create and switch to new branch
git checkout -b feature/new-feature

# View branch history
git log --oneline --graph --all

# Stash uncommitted changes
git stash
git stash pop

# Cherry-pick a commit
git cherry-pick <commit-hash>

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Amend last commit
git commit --amend

# Interactive rebase
git rebase -i HEAD~3
\`\`\`

## Common Workflows

### Feature Development
\`\`\`bash
# 1. Create feature branch
git checkout -b feature/user-profile

# 2. Make changes
git add src/profile.ts
git commit -m "feat(profile): add user profile page"

# 3. Push and create PR
git push origin feature/user-profile
# Open PR on GitHub/GitLab

# 4. Address review feedback
git add src/profile.ts
git commit -m "refactor: simplify profile rendering"
git push origin feature/user-profile

# 5. After approval, merge via UI
\`\`\`

### Hotfix Workflow
\`\`\`bash
# 1. Create hotfix from main
git checkout main
git pull origin main
git checkout -b hotfix/critical-security-fix

# 2. Fix issue
git add src/auth.ts
git commit -m "fix(auth): patch security vulnerability"

# 3. Push and create urgent PR
git push origin hotfix/critical-security-fix

# 4. Fast-track review and merge
# 5. Deploy immediately

# 6. Merge back to develop (if using Git Flow)
git checkout develop
git merge hotfix/critical-security-fix
\`\`\`

Effective Git workflows require discipline, communication, and continuous improvement. Adapt these practices to fit your team's needs.`,
    lastUpdated: "2024-11-04"
  }
];

export default function HubKnowledgeBase() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<KnowledgeBaseArticle | null>(null);

  const filteredArticles = sampleArticles.filter(article =>
    article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    article.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    article.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const categories = Array.from(new Set(sampleArticles.map(a => a.category)));

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={BookOpen}
        title="Knowledge Base"
        subtitle="Documentation and guides for DevPlatform"
        color="emerald"
        data-testid="text-page-title"
      >
        <Button data-testid="button-new-article">
          <Plus className="h-4 w-4 mr-2" />
          New Article
        </Button>
      </PageHeader>

      {selectedArticle ? (
        <div className="space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedArticle(null)}
            data-testid="button-back"
          >
            ← Back to Articles
          </Button>

          <Card className="border-l-[3px] border-l-emerald-500">
            <CardHeader>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{selectedArticle.category}</Badge>
                  <span className="text-sm text-muted-foreground">
                    Last updated: {selectedArticle.lastUpdated}
                  </span>
                </div>
                <CardTitle className="text-2xl">{selectedArticle.title}</CardTitle>
                <CardDescription className="text-base">
                  {selectedArticle.description}
                </CardDescription>
                <div className="flex flex-wrap gap-2">
                  {selectedArticle.tags.map(tag => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="prose dark:prose-invert max-w-none">
                  <p>{selectedArticle.content}</p>
                  <p className="mt-4">
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor 
                    incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud 
                    exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
                  </p>
                  <h2>Key Points</h2>
                  <ul>
                    <li>Understand the core concepts</li>
                    <li>Follow best practices</li>
                    <li>Leverage available tools</li>
                    <li>Iterate and improve continuously</li>
                  </ul>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search articles, guides, and documentation..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search"
            />
          </div>

          <div className="space-y-6">
            {categories.map(category => {
              const categoryArticles = filteredArticles.filter(a => a.category === category);
              if (categoryArticles.length === 0) return null;

              return (
                <div key={category} className="space-y-3">
                  <h2 className="text-xl font-semibold">{category}</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {categoryArticles.map(article => (
                      <Card
                        key={article.id}
                        className="hover-elevate active-elevate-2 cursor-pointer border-l-[3px] border-l-emerald-500"
                        onClick={() => setSelectedArticle(article)}
                        data-testid={`card-article-${article.id}`}
                      >
                        <CardHeader>
                          <div className="flex items-start gap-3">
                            <FileText className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <CardTitle className="text-base">{article.title}</CardTitle>
                              <CardDescription className="mt-1 line-clamp-2">
                                {article.description}
                              </CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex flex-wrap gap-1.5">
                            {article.tags.slice(0, 3).map(tag => (
                              <Badge key={tag} variant="secondary" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                            {article.tags.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{article.tags.length - 3} more
                              </Badge>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}

            {filteredArticles.length === 0 && (
              <Card className="border-l-[3px] border-l-emerald-500">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <BookOpen className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No articles found</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
