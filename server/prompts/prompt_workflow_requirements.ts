const promptWorkflowRequirements = (requirement: string, personasToUse: any[] = [], domain: string = "Business") => ({
    role: "user",
    content: `Given a user story, acceptance criteria, testcase format to explain how each acceptance criterion was derived from the user story. 

${requirement}

Input Format (example):

User Story
As Product SME, I want to configure the approval workflow so that sensitive production changes are properly reviewed.


Acceptance Criteria

- Acceptance criteria count should be dynamic and determined by the complexity of the user story.There is NO fixed minimum or maximum number
  Every Acceptance Criterion must be:
  Independently testable,Clearly verifiable by QA, Written in outcome-focused, business-readable language,Traceable to one or more Test Cases

User Story
As Product SME, I want to configure the approval workflow so that sensitive production changes are properly reviewed.


Acceptance Criteria

- Each user story MUST have acceptance criteria that are independently testable and verifiable by QA
- ACs should be outcome-focused, business-readable statements (simple title format, no Given/When/Then required)
- Format example: '#1 Form validates all required fields correctly' 
- Generate 3-5 ACs per story based on complexity and story points
- Include ACs directly in the user story JSON object as an array
- NOTE: For individual story AC enhancement (separate from batch generation), use prompt_acceptance_criteria.ts
4. Optional: Performance/load scenario if relevant
5. Optional: Integration/API scenario if system interacts with external services
Return a JSON array of these objects and no additional text.

IMPORTANT REQUIREMENTS:
- Generate epics ,features, user stories based on user requirements whichmeans these fields should'nt be static it should be dynamic in the count based on user requirements.
${personasToUse.length > 0 ? `- USE ONLY the ${personasToUse.length} persona(s) specified above. DO NOT invent new personas.
- Set "personaSource": "From Persona Hub" on every story.
- CRITICAL: User story TITLES MUST follow the natural format: "As [persona name], I want to [direct verb phrase] so that [outcome]". DO NOT use the stilted "perform [noun]" pattern.
- Example: "As ${personasToUse[0]?.name || '[Persona]'}, I want to capture meeting notes by voice so that follow-ups are not lost"
- Selected personas available: ${personasToUse.map(p => p.name).join(', ')}
- If a chunk doesn't naturally fit any provided persona, choose the closest match — never create a new one.` : `- NO PERSONAS ARE PROVIDED - intelligently detect personas from the requirements, staying grounded in the project's domain context.
- CRITICAL: User story TITLES MUST follow the natural format: "As [detected persona], I want to [direct verb phrase] so that [outcome]". DO NOT use the stilted "perform [noun]" pattern.
- Look for role mentions in the chunk text and the project's domain context.
- Create appropriate persona names matching the project's industry — never default to insurance/banking/healthcare unless the chunk text invokes them.
- Example: "As Account Manager, I want to capture follow-up notes by voice so that meetings stay productive"
- Example: "As System Administrator, I want to grant role-based access so that only authorised users see sensitive data"
- NEVER use generic terms like "user" - always identify a specific role
- ALWAYS include "personaSource": "AI Suggested (Fallback)" in each user story`}
${personasToUse.length > 0 ? `- Distribute user stories across selected personas when appropriate, or use AI-suggested personas when selected ones don't fit` : `- Distribute user stories across the intelligently detected personas based on functionality`}
${personasToUse.length > 0 ? `- Return persona objects in the "personas" array with "personaSource" field indicating "From Persona Hub" or "AI Suggested"` : `- Return persona objects in the "personas" array with "personaSource": "AI Suggested" for all intelligently detected personas`}


*** CRITICAL: ACCEPTANCE CRITERIA REQUIREMENTS ***
- Each user story MUST have MINIMUM 3 and MAXIMUM 5 comprehensive acceptance criteria
- Follow the production-grade standards defined above - each component must meet minimum word counts
- Each AC must be independently testable by QA without additional clarification
- Include exact field names, button labels, data values, timing expectations, database updates


*** ACCEPTANCE CRITERIA EXAMPLES (Use as Reference) ***

Example 1 - Happy Path:
{
  "title": "User successfully submits \${domain.toLowerCase()} request with all required fields"
}

Example 2 - Validation/Error Scenario:
{
  "title": "System prevents submission with missing required fields"
}

Example 3 - Edge Case/Boundary Condition:
{
  "title": "System handles maximum file size upload gracefully"
}

- Each user story MUST have subtasks and subtasks count should be dynamic based on user requirements and it shouldcovering key categories 
  * Planning & Design 
  * Backend Development 
  * Frontend Development 
  * Database Changes 
  * Integration Work 
  * Testing 
  * Documentation 
  * Code Review & Deployment 
- Subtask hours should match story points: 1 point = 6-8 hours, 3 points = 18-24 hours, 5 points = 30-40 hours
- Ensure all IDs are properly linked (featureId references epicId, story's personaId and epicId reference correct IDs)
- Make the content specific to the requirement provided
- User story descriptions MUST be 300-600 words with ALL 7 SECTIONS clearly labeled
- Subtasks MUST include category prefix, technical details (API endpoints, component names, table names), and time estimates

Testcases

- For each acceptance criterion, generate corresponding testcases that verify the AC is met
- Each testcase MUST include: id, scenario (title), steps (array of action steps), expectedResult
- Testcases should cover: happy path, edge cases, error scenarios, validation rules
- Steps should be clear and actionable for QA to execute
- Expected results must be specific and measurable
- Return testcases in the JSON under each user story as a 'testCases' array
- Generate 2-3 testcases minimum per acceptance criterion

Example Testcase Format:
{
  "id": "TC1",
  "scenario": "User successfully submits form with all required fields",
  "steps": ["Navigate to form", "Fill all required fields with valid data", "Click Submit button"],
  "expectedResult": "Form submitted successfully and confirmation message displayed"
}

- Return ONLY the JSON object, no additional text,`
});

export { promptWorkflowRequirements };