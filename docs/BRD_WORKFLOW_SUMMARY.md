**BRD → Summarize → Attach → Artifact Generation**

Summary: This document explains the end-to-end flow implemented for handling an uploaded Business Requirements Document (BRD), summarizing it, attaching the summary to the workflow context, and ensuring subsequent artifact generation uses the summarized BRD (not the full DOCX). It lists the exact files and line numbers where logic was added or edited.

Important files changed
- `server/routes.ts`
  - `import JSZip from 'jszip';` — import added (around line 40)
  - `extractTextFromDocxBuffer(buffer: Buffer): Promise<string>` — new helper to extract plaintext from a `.docx` buffer by reading `word/document.xml` and extracting `<w:t>` nodes. (starts at line 112)
  - `POST /api/workflow/brd/attach` — updated attach handler: after inserting attachment row, extracts DOCX text, calls the summarizer helper `generateConversationSummaryWithLLM`, and returns `summary` in the JSON response. (route starts at line 1180, extraction + summarization occurs ~line 1223, response including `summary` around line 1240)

- `client/src/components/workflow/step2-generated-content.tsx`
  - Added `setRequirement` and `setUserRequirementSummary` to the `useWorkflow()` destructuring so the UI can apply the summary to the workflow state. (destructuring at line 125)
  - The BRD action button calls `handleAttachBrdToWorkflow` (button `onClick` at line 841).
  - `handleAttachBrdToWorkflow` implementation: downloads the latest BRD, posts to `/api/workflow/brd/attach`, receives `summary` in the response, and — if present — sets `userRequirementSummary` and `requirement` to the summarized text so subsequent artifact generation uses the summary. (handler defined at line ~208; summary application at line 255)

- `server/ai-service.ts`
  - `generateAgileArtifacts(requirement, ...)` consumes the `requirement` string used for artifact generation and logs a snippet of the requirement for debugging. This is the endpoint used by `/api/workflow/generate-artifacts` to create epics/features/stories. (function begins at line 2313)

End-to-end flow (step-by-step)
1. User triggers BRD attach from the workflow UI
   - UI button (Step 2 generated content): `client/src/components/workflow/step2-generated-content.tsx`
     - Button `onClick={handleAttachBrdToWorkflow}` at line 841.
   - The button downloads the latest BRD version from the server using `GET /api/brd/:id/download`.

2. Client posts attachment request to the server
   - After downloading the file, the client calls the server endpoint `POST /api/workflow/brd/attach` with payload `{ workflowId, brdVersionId, attachedBy }`.
   - Client code: `handleAttachBrdToWorkflow` function in `step2-generated-content.tsx` (definition starts at line 208). The POST call is made around lines 236–244.

3. Server attaches BRD and attempts summarization
   - Route: `server/routes.ts`, `app.post("/api/workflow/brd/attach")` (route handler starts at line 1180).
   - The route validates input and inserts a row into `workflow_brd_attachments` (existing schema table). See insert at lines ~1199–1206.
   - The server then reads the binary for the attached BRD version from `brd_file_versions.file_blob` and calls the helper `extractTextFromDocxBuffer(fileBuffer)` to extract text from the `.docx`:
     - `extractTextFromDocxBuffer` was added in `server/routes.ts` (starts at line 112). It uses `JSZip` to open the DOCX (which is a ZIP archive), extracts `word/document.xml`, and concatenates text nodes found in `<w:t>` elements.
     - The extracted text is sliced to the first 20,000 characters and sent to `generateConversationSummaryWithLLM` to produce a concise summary (summarizer helper already present in `routes.ts`). The extraction and summarization call occur around line 1223.
   - The attach route returns JSON including the `summary` field, e.g.:
     {
       "success": true,
       "attachmentId": "...",
       "brdId": "...",
       "version": 3,
       "summary": "Short BRD summary text..."
     }
     (Response code added around lines 1240–1248.)

4. Client receives summarized BRD and attaches it to the workflow context
   - Client receives the attach response in `handleAttachBrdToWorkflow` and checks `attachJson.summary` (client code at line 236–256).
   - If `summary` exists, client applies it to the in-memory workflow context by calling `setUserRequirementSummary(attachJson.summary)` and `setRequirement(attachJson.summary)` (applied at line 249–252). This ensures subsequent calls to `POST /api/workflow/generate-artifacts` will send the summarized BRD text as `requirement`.

5. Artifact generation uses the summarized BRD
   - When the user clicks to generate artifacts, the client posts to `POST /api/workflow/generate-artifacts` with `{ requirement }`. Since `requirement` was set to the BRD summary, the server receives the summarized BRD.
   - The server route for `/api/workflow/generate-artifacts` is in `server/routes.ts` and calls `generateAgileArtifacts(requirement, ...)` (the route handler is just after the BRD attach code — see around line 1260 onward).
   - `generateAgileArtifacts` in `server/ai-service.ts` (starts at line 2313) logs the requirement snippet and builds the LLM prompt using the `requirement` string. The artifact generation therefore uses the summarized BRD content as the authoritative source.

Notes, caveats, and rationale
- DOCX extraction is intentionally lightweight: it extracts text nodes from `word/document.xml`. This works well for typical textual BRDs but may not capture text in headers/footers, comments, tracked changes, or embedded objects. If you need higher fidelity, we can integrate a robust DOCX parser (e.g., `mammoth`, `docx` or server-side conversion to markdown/html). The current approach avoids heavy dependencies and keeps memory use small.
- Summarization uses `generateConversationSummaryWithLLM` already present in `server/routes.ts`. That helper will fall back to a simpler concatenation if Azure OpenAI config is not available, so the system degrades gracefully when LLM config is missing.
- The summary is returned in the attach route response but is not persisted to a new DB column. If you want the summary persisted with the attachment record, I can add a `summary` column to `workflow_brd_attachments` (requires a DB migration) and store the generated summary.

File reference table (quick)
- `server/routes.ts`
  - `import JSZip from 'jszip';` — line ~40
  - `extractTextFromDocxBuffer(...)` — lines 112–132
  - `app.post('/api/workflow/brd/attach', ...)` — lines 1180–1300 (summary generation block ~1223, response with `summary` ~1240)
  - `app.post('/api/workflow/generate-artifacts', ...)` — lines ~1260–1288

- `client/src/components/workflow/step2-generated-content.tsx`
  - `useWorkflow()` destructuring includes `setRequirement` and `setUserRequirementSummary` — line 125
  - BRD attach button `onClick={handleAttachBrdToWorkflow}` — line 841
  - `handleAttachBrdToWorkflow` — definition starts ~line 208; attach request + response handling around lines 236–256 (summary application lines 249–252)

Next steps I can take (pick one)
- Persist the generated BRD summary in the DB (add `summary` column to `workflow_brd_attachments` and a migration). I can implement the migration and store the summary on attach.
- Improve DOCX extraction to include headers/footers/tables and optionally fallback to running a conversion tool for richer extraction.
- Add an automated endpoint test (or unit test) that uploads a sample `.docx` and validates a non-empty `summary` is returned.

If you want the DB persistence and a migration, tell me which migration approach to use (drizzle-kit migration script or raw SQL), and I'll add it next.

---
Generated: automated summary by modifications made in the workspace on December 11, 2025.
