const promptArtifactSummary = (artifacts: {
  epics: any[];
  features: any[];
  userStories: any[];
  guidelines?: any;
}): string => {
  // Build artifact details string with testcases included
  const artifactDetails = `
## Generated Artifacts Summary

### Epics (${artifacts.epics.length})
${artifacts.epics.map((epic, idx) => `${idx + 1}. **${epic.title}** (ID: ${epic.id})`).join('\n')}

### Features (${artifacts.features.length})
${artifacts.features.map((feature, idx) => `${idx + 1}. **${feature.title}** (ID: ${feature.id}) - Part of Epic: ${feature.epicId}`).join('\n')}

### User Stories (${artifacts.userStories.length})
${artifacts.userStories.map((story, idx) => {
  const acCount = story.acceptanceCriteria?.length || 0;
  const subtaskCount = story.subtasks?.length || 0;
  const testcaseCount = story.testCases?.length || 0;
  return `${idx + 1}. **${story.title}** (${story.storyPoints} pts) - Feature: ${story.featureId}
   - Acceptance Criteria: ${acCount}
   - Subtasks: ${subtaskCount}
   - Testcases: ${testcaseCount}`;
}).join('\n')}

${artifacts.userStories.length > 0 ? `### Total Acceptance Criteria: ${artifacts.userStories.reduce((sum, story) => sum + (story.acceptanceCriteria?.length || 0), 0)}` : ''}
${artifacts.userStories.length > 0 ? `### Total Subtasks: ${artifacts.userStories.reduce((sum, story) => sum + (story.subtasks?.length || 0), 0)}` : ''}
${artifacts.userStories.length > 0 ? `### Total Testcases: ${artifacts.userStories.reduce((sum, story) => sum + (story.testCases?.length || 0), 0)}` : ''}

### Sample User Story Detail (First Story):
${artifacts.userStories.length > 0 ? (() => {
  const firstStory = artifacts.userStories[0];
  let detail = `**${firstStory.title}**\n`;
  
  if (firstStory.acceptanceCriteria && firstStory.acceptanceCriteria.length > 0) {
    detail += `\nAcceptance Criteria:\n${firstStory.acceptanceCriteria.slice(0, 3).map((ac, i) => `  ${i + 1}. ${ac.title || ac}`).join('\n')}`;
  }
  
  if (firstStory.subtasks && firstStory.subtasks.length > 0) {
    detail += `\n\nSubtasks:\n${firstStory.subtasks.slice(0, 3).map((st, i) => `  ${i + 1}. ${st}`).join('\n')}`;
  }
  
  if (firstStory.testCases && firstStory.testCases.length > 0) {
    detail += `\n\nTestcases:\n${firstStory.testCases.slice(0, 2).map((tc, i) => `  ${i + 1}. ${tc.scenario || tc.title || 'Test case'}`).join('\n')}`;
  }
  
  return detail;
})() : 'No stories generated'}
`;

  return `
You are an expert business analyst and documentation specialist. Your task is to create a clear, concise executive summary of the generated agile artifacts including testcases.

## Input Artifacts:
${artifactDetails}

## Summary Requirements:

1. **Overview Section** - Provide a 2-3 sentence overview of what was generated and its purpose, including quality metrics

2. **Key Metrics** - Highlight important counts:
   - Total epics, features, stories
   - Total acceptance criteria
   - Total subtasks
   - Total testcases (QA coverage)

3. **Epic Summary** - List each epic with 1-2 sentence description of its business value and scope

4. **Feature Highlights** - Call out 3-5 most important features and their key capabilities

5. **Story Distribution** - Explain how user stories are distributed across epics/features, their complexity levels, and QA coverage through testcases

6. **Quality & Testing Coverage** - Analyze the testcase coverage:
   - Average testcases per story
   - Coverage of happy path, edge cases, and error scenarios
   - QA readiness assessment

7. **Completeness Assessment** - Note any gaps or areas that may need further refinement:
   - Stories that may need more testcases
   - Potential testing challenges
   - Areas requiring additional specification

8. **Next Steps** - Recommend 3-4 action items for the team:
   - Prioritization for sprint planning
   - QA resource allocation based on testcase volume
   - Areas for stakeholder review

## Output Format:

Create a comprehensive but concise executive summary (500-700 words) that a project manager or stakeholder could quickly review.
Use clear headers, bullet points where appropriate, and highlight key numbers (especially testcase counts for QA planning).
Make it business-focused, not technical jargon-heavy.
Include a "Testing Strategy" section that discusses the testcase coverage and QA approach.

Return ONLY the summary text, no additional commentary or JSON.
`;
};

export { promptArtifactSummary };
