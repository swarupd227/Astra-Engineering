# Generate Artifacts — AI + UI Summary

This document summarizes the `generate-artifacts` workflow: server endpoint, AI prompts used, where prompts are invoked, normalization logic for test cases, and the frontend UI hooks.

## Endpoint
- POST `/api/workflow/generate-artifacts` — route handler: [server/routes.ts](server/routes.ts#L2031-L2059)
  - Validates `requirement` and calls `generateAgileArtifacts(...)`.

## Backend: Main Orchestrator
- Function: `generateAgileArtifacts(requirement, complianceGuidelines, backlogContext, selectedPersonaIds)`
  - File & range: [server/ai-service.ts](server/ai-service.ts#L2347-L3050)
  - Responsibilities:
    - Build context sections: compliance, backlog, personas (lines ~2364–2540).
    - Assemble runtime `system` + `user` messages and call the LLM (calls `promptWorkflowRequirements` and `openai.chat.completions.create`). Prompt assembly: [server/ai-service.ts](server/ai-service.ts#L2543-L2543).
    - LLM call: deterministic settings (temperature 0.2, large `max_tokens`) and optional `response_format` when using GPT-style deployments (see call at lines ~2776–2792).
    - Parse JSON robustly; fallback extraction from code blocks and truncation detection (lines ~2810–2880).
    - Validate epics/features/userStories and apply fallbacks (lines ~2885–2960).
    - Normalize `userStories[].testCases` into canonical shape (lines [server/ai-service.ts](server/ai-service.ts#L2970-L3004)).
    - Auto-generate missing test cases by calling `generateTestCasesForStory` for stories with none or fewer than 2 test cases (lines [server/ai-service.ts](server/ai-service.ts#L3005-L3019)).

## Test case generation helper
- `generateTestCasesForStory(story, acceptanceCriteriaText)` — top of `server/ai-service.ts` (approx lines 22–70): builds a test-case prompt and calls the LLM, expecting a JSON object with `testCases` array.
- Uses prompt from: [server/prompts/prompt_test_cases.ts](server/prompts/prompt_test_cases.ts#L1-L120)
  - The prompt enforces strict JSON-only output with exact schema:
    ```json
    {"testCases": [{"title":"...","testCaseSteps":[{"Steps":1,"Action":"...","Expected Results":"..."}]}]}
    ```

## Prompt files (source of truth)
- Workflow prompt adapter: [server/prompts/prompt_workflow_requirements.ts](server/prompts/prompt_workflow_requirements.ts#L1-L220)
  - Export: `promptWorkflowRequirements` — used by `generateAgileArtifacts` to provide the user message content.
- Acceptance criteria prompt: [server/prompts/prompt_acceptance_criteria.ts](server/prompts/prompt_acceptance_criteria.ts#L1-L200)
  - Export: `promptenhanceAcceptanceCriteria` — used for AC-focused generation/enhancement in separate flows.
- Test cases prompt: [server/prompts/prompt_test_cases.ts](server/prompts/prompt_test_cases.ts#L1-L120)
  - Export: `promptGenerateTestCases` — used by `generateTestCasesForStory`.

## Frontend UI integration
- Workflow context provider: [client/src/context/workflow-context.tsx](client/src/context/workflow-context.tsx#L198-L272)
  - Holds `userStories`, `setUserStories`, etc.
- Main generated content UI: [client/src/components/workflow/step2-generated-content.tsx](client/src/components/workflow/step2-generated-content.tsx#L128-L1430)
  - Triggers generation, receives artifacts and calls `setEpics`, `setFeatures`, `setUserStories`.
  - Renders lists and story detail dialogs where `testCases` (if present) would be accessible via the `userStories` objects.
- Artifacts hub page: [client/src/pages/hub-artifacts.tsx](client/src/pages/hub-artifacts.tsx#L1035-L1461)
  - Consumes `latestWorkflowArtifact.userStories` for hub UI and exports.

## Current status & limitations
- Server-side: `generateAgileArtifacts` runs and returns `epics`, `features`, `userStories` reliably.
- Test cases:
  - Normalization logic exists and converts various shapes into canonical `testCases` with `testCaseSteps` (see [server/ai-service.ts](server/ai-service.ts#L2970-L3004)).
  - Auto-generation is attempted for stories with <2 test cases via `generateTestCasesForStory` (lines [server/ai-service.ts](server/ai-service.ts#L3005-L3019)).
  - In practice, earlier runs showed `testCases` arrays empty — likely due to LLM responses that are not strictly parseable JSON. The helper currently attempts JSON.parse and returns [] on parse failures.
- Frontend: no dedicated UI component yet to render `testCases` in story details. Documentation TODO exists: [ARTIFACTS_GENERATION_SUMMARY.md](ARTIFACTS_GENERATION_SUMMARY.md#L651-L652).

## Recommended next steps
1. Add raw LLM-response logging in `generateTestCasesForStory` before `JSON.parse` to capture provider output for debugging.
2. If parse failures continue: implement a fallback placeholder test-case generator (e.g., generate 2 minimal structured test cases per story) so UX shows test cases even when the LLM fails.
3. Optionally enforce provider `response_format` (structured output) if using Azure/OpenAI deployments that support it.
4. Implement a small UI renderer for `testCases` inside story detail dialog in [client/src/components/workflow/step2-generated-content.tsx](client/src/components/workflow/step2-generated-content.tsx#L1430-L1433).

---
Generated: December 18, 2025
Saved by: DevX assistant
