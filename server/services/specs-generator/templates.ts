// Primary templates embedded in code so specs generation works in all environments
// (e.g. Azure App Service) without relying on filesystem. These mirror the contents of
// server/specs_format/spec.md and server/specs_format/checklists/requirements.md.

export const SPEC_TEMPLATE = `# Feature: Claims Portal
Status: NEW
Owner: DevX
Last Updated: 2026-02-10

## Summary
Create a modern, premium-feeling insurance claim portal that guides policyholders through claim submission step-by-step with smart forms, secure document uploads, clear status tracking, and near-real-time updates. The product must prioritize security, accessibility (WCAG AA), performance, and a human, trust-building tone.

## Actors
- Policyholder (end user)
- Agent / Broker (optional delegate)
- Claims Adjuster (internal)
- Customer Support (internal)
- System (background processors, notification service)

## Goals
- Make submitting a claim simple and fast (fewest possible steps).
- Provide clear progress and status updates.
- Enable secure, easy document upload and validation.
- Reduce support contacts via clarity and proactive notifications.

## Key Features
- Guided multi-step claim submission with smart field suggestions and validation.
- Robust document upload (drag/drop, mobile camera capture, resumable uploads).
- Claim status dashboard with history and messaging thread.
- Real-time notifications and activity feed for status changes.
- Secure authentication, role-based access, and audit trails.

## Data & Constraints
- Claim: id, policy_id, claimant, incident_date, type, description, estimated_loss, status
- Document: id, claim_id, filename, type, size, content_type, checksum
- StatusUpdate: id, claim_id, actor, timestamp, state, notes
- Constraints: max upload size, allowed file types, GDPR/PII handling, encryption-at-rest/in-transit

## User Scenarios & Testing

Scenario 1 — Submit a new claim (happy path)
1. Policyholder clicks "Start Claim" and completes guided questions.
2. Policyholder uploads required documents via drag/drop or camera.
3. System validates uploads, shows previews, and allows re-ordering/removal.
4. Policyholder reviews and confirms submission; receives confirmation with claim ID.

Acceptance criteria (testable):
- A user can submit a complete claim end-to-end in one session without JS failing critical flows.
- Uploaded documents appear in the claim record within 10 seconds of completion.
- Confirmation contains a persistent claim identifier and next-steps copy.

Scenario 2 — Continue partial claim (resumable)
- Users returning with saved progress can resume and complete the claim within 30 days.

Scenario 3 — Agent submits on behalf
- Agent may start/submit claims for assigned policyholders with an audit trail.

Scenario 4 — Track claim status
- Policyholders see clear status labels (Received, Under Review, More Info Requested, Approved, Closed) and a chronological activity feed.

## Functional Requirements (testable)

1. Guided submission flow
   - Users can complete a multi-step form that validates inputs before advancing.
   - Form preserves progress locally and server-side for resumability.

2. Document uploads
   - Support drag/drop, file chooser, and mobile camera capture.
   - Accept common document types (PDF, JPG, PNG, HEIC) and reject disallowed types with clear messages.
   - Failures during upload show actionable errors and allow retry.

3. Claim dashboard
   - Users see list of their claims with key metadata and can drill into details.
   - Each claim shows an activity feed with timestamps and actor labels.

4. Notifications & real-time updates [NEEDS CLARIFICATION: real-time mechanism]
   - Users receive near-real-time updates when claim status changes (in-app and optionally email/SMS).

5. Authentication & Authorization [NEEDS CLARIFICATION: auth method]
   - Users must authenticate to access personal claims. Support for account linking and agent delegation.

6. Security & privacy
   - All sensitive data must be encrypted in transit and at rest. Access must be audited and logged.

7. Accessibility
   - UI components meet WCAG 2.1 AA. Automated accessibility checks run in CI.

8. Performance
   - Critical pages (dashboard, submission start) load usable content within performance budgets; 95% of users start submission within 3s on mobile/3G-equivalent.

9. Resilience
   - Partial uploads and form state persist and allow resume after transient failures.

10. Data retention & compliance [NEEDS CLARIFICATION: retention policy]
   - Claims and uploaded documents follow project retention policy and deletion workflows for PII.

## Success Criteria (measurable & verifiable)
- User task completion: 90% of users can submit a claim end-to-end without contacting support.
- Time to submit: median time from start → confirmation under 6 minutes for first-time users.
- Upload reliability: 99% of uploads complete without manual retry.
- Performance: 95% of first contentful paint under 2.5s in typical broadband environments; Lighthouse performance score ≥ 90 for production builds.
- Accessibility: WCAG 2.1 AA conformance for critical user flows.
- Security: Zero high-severity dependency vulnerabilities in production builds; audit logs capture claim access events.

## Key Entities
- User (policyholder, agent, adjuster)
- Policy (policy references and entitlements)
- Claim (core record)
- Document (attachments)
- StatusUpdate (timeline events)
- Notification (email/SMS/in-app)

## Assumptions
- Primary users have modern browsers; progressive enhancement required for baseline functionality.
- Email is available for notifications; optional SMS integrations require third-party providers.
- Storage and processing for documents will be separated from client builds (not embedded in the frontend bundle).

## Milestones (high-level)
1. M1 — Core submission flow + uploads + basic dashboard
2. M2 — Resumable sessions, agent delegation, extended validations
3. M3 — Real-time updates, messaging, advanced analytics, and hardening

---

Notes:
- Replace placeholders for retention windows and authentication with the project's decisions.
- See checklists/requirements.md for spec quality validation.
`;

export const REQUIREMENTS_TEMPLATE = `# Specification Quality Checklist: Claims Portal

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-02-10
**Feature**: Spec file (specs/1-claims-portal/spec.md)

## Content Quality

- [ ] No implementation details (languages, frameworks, APIs)
- [ ] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous
- [ ] Success criteria are measurable
- [ ] Success criteria are technology-agnostic (no implementation details)
- [ ] All acceptance scenarios are defined
- [ ] Edge cases are identified
- [ ] Scope is clearly bounded
- [ ] Dependencies and assumptions identified

## Feature Readiness

- [ ] All functional requirements have clear acceptance criteria
- [ ] User scenarios cover primary flows
- [ ] Feature meets measurable outcomes defined in Success Criteria
- [ ] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before /speckit.clarify or /speckit.plan

## Validation Results (initial)

- No [NEEDS CLARIFICATION] markers remain: FAIL — 3 markers present in spec.md
- Requirements are testable: PASS — most requirements include acceptance criteria; some need detail (uploads, auth)
- Success criteria measurable: PASS — includes quantitative targets
- Technology-agnostic: PASS — targets described in user-facing terms
- All mandatory sections completed: PASS

Remaining issues:

- [NEEDS CLARIFICATION: auth method] — impacts user onboarding and integration scope.
- [NEEDS CLARIFICATION: real-time mechanism] — impacts architecture and cost (WebSockets vs polling vs server-sent events).
- [NEEDS CLARIFICATION: retention policy] — compliance and storage sizing impact.

Proceed to /speckit.clarify with the three questions below to resolve scope-critical choices.
`;

let cachedSpecTemplate: string | null = null;
let cachedRequirementsTemplate: string | null = null;

export async function loadTemplates(): Promise<{
  specTemplate: string;
  requirementsTemplate: string;
}> {
  if (cachedSpecTemplate && cachedRequirementsTemplate) {
    return {
      specTemplate: cachedSpecTemplate,
      requirementsTemplate: cachedRequirementsTemplate,
    };
  }

  cachedSpecTemplate = SPEC_TEMPLATE;
  cachedRequirementsTemplate = REQUIREMENTS_TEMPLATE;

  return {
    specTemplate: cachedSpecTemplate,
    requirementsTemplate: cachedRequirementsTemplate,
  };
}
