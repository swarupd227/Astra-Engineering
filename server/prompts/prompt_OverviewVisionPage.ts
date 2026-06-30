const promptOverviewAndVisionWikiPage = (
    requirement: string,
    projectName: string,
    epics: any[],
    features: any[]
): string => { return `


Generate a comprehensive "Overview & Vision" Wiki page for Azure DevOps following these exact requirements:

**Project Context:**
${requirement}

**Project Name:** ${projectName}
**Number of Epics:** ${epics.length}
**Number of Features:** ${features.length}

Create a Wiki page with these EXACT sections (use this structure):

# ${projectName} - Overview & Vision

## Executive Summary
[2-3 paragraphs summarizing the project, problem being solved, and expected impact]

**Project Timeline:** [Estimated timeline based on scope]
**Project Status:** Planning
**Project Owner:** [To be assigned]
**Development Team:** [To be determined]

## Vision Statement
[1-2 paragraphs describing the long-term vision and strategic goals]

## Problem Statement
### Current Challenges
- [Challenge 1 with specific pain points]
- [Challenge 2 with quantified impact]
- [Challenge 3 with affected users/processes]

### Opportunity
[Description of the opportunity this project addresses]

## Business Objectives
1. **[Objective 1]:** [Specific, measurable goal]
   - Success Metric: [How we'll measure success]
   - Target: [Quantifiable target]

2. **[Objective 2]:** [Specific, measurable goal]
   - Success Metric: [How we'll measure success]
   - Target: [Quantifiable target]

3. **[Objective 3]:** [Specific, measurable goal]
   - Success Metric: [How we'll measure success]
   - Target: [Quantifiable target]

## Key Stakeholders
| Role | Name | Responsibility | Contact |
|------|------|----------------|---------|
| Project Sponsor | TBD | Overall project approval and funding | TBD |
| Product Owner | TBD | Requirements and prioritization | TBD |
| Technical Lead | TBD | Technical architecture and implementation | TBD |
| Business Analyst | TBD | Requirements gathering and documentation | TBD |

## Success Criteria
- [ ] [Specific criterion 1 with measurement]
- [ ] [Specific criterion 2 with measurement]
- [ ] [Specific criterion 3 with measurement]

## Project Scope
### In Scope
${features.slice(0, 5).map(f => `- ${f.title || f.description}`).join('\n') || '- [Feature/capability 1]\n- [Feature/capability 2]\n- [Feature/capability 3]'}

### Out of Scope (Future Phases)
- [Excluded feature 1 with reasoning]
- [Excluded feature 2 with reasoning]

## Project Risks & Mitigation
| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| [Risk 1] | High/Medium/Low | High/Medium/Low | [Strategy] |
| [Risk 2] | High/Medium/Low | High/Medium/Low | [Strategy] |

**Requirements:**
- Use professional enterprise language
- Be specific and detailed based on the requirements provided
- Include realistic timelines and metrics
- Format properly in Markdown
- Make it comprehensive and actionable

Return ONLY the generated Wiki page content in Markdown format.`};

export {promptOverviewAndVisionWikiPage};