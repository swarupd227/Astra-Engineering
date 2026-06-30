const breakDownUserstory  = (
    storyPoints: number, 
    storyTitle: string,
    criteriaText: String
): string => 
`
You are a technical lead breaking down user stories into actionable development tasks.

Story Title: ${storyTitle}
Story Points: ${storyPoints}

Acceptance Criteria:
${criteriaText}

Based on the acceptance criteria above, generate a list of specific, actionable subtasks that a developer would need to complete to implement this user story.

Guidelines:
- Generate subtasks depending on story complexity (${storyPoints} story points)
- Each subtask should be clear, specific, and actionable
- Focus on implementation tasks (UI components, API endpoints, validation, testing, etc.)
- Include frontend and backend tasks where applicable
- Include data model/database tasks if needed
- Include unit test tasks for critical functionality
- Keep subtasks concise (one line each)
- Order subtasks logically (setup → implementation → testing)

Return ONLY the subtasks as a simple list, one per line, without numbers or bullets.

Example output format:
Create user authentication API endpoint
Design and implement login form UI component
Add input validation for email and password fields
Implement JWT token generation and storage
Add unit tests for authentication logic
Update user profile schema in database`;

 export { breakDownUserstory}