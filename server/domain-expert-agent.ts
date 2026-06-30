import { workflowAzureInstances, hasWorkflowInstances } from "./llm-config";
import { ai as sharedAiClient } from "./ai-client";

const openai = sharedAiClient;

const MANDATORY_ARCHITECTURAL_LAYERS = `
## MANDATORY ARCHITECTURAL LAYERS (MUST be addressed in generated artifacts)

### 1. Domain-Specific Operational Layers
Every generated artifact must model domain-specific operational workflows, not just generic CRUD. Stories must describe the actual business operation (e.g., claims adjudication, patient intake, loan underwriting), not abstract data manipulation.

### 2. Capability-Driven Modeling
User stories must describe WHAT the system does (capability), not just HOW it does it (workflow steps). Each feature must articulate a clear business capability (e.g., "Real-time Risk Assessment Engine", not "Submit Form and Process Data").

### 3. Business-Facing Configuration Depth
Artifacts must include user stories for business-rule-driven configurability: rule engines, configurable workflows, parameter-driven business logic, tenant-specific customization, and admin-facing configuration UIs — not hardcoded behavior.

### 4. Dashboard & Analytic UX Depth
Artifacts must include stories for:
- Executive/operational dashboards with KPI visualization
- Hierarchical data visualization (drill-down from org→region→branch→individual)
- Operational data rollups and aggregation views
- Real-time analytics, trend analysis, and comparative reporting
- Analytic UI modeling: chart types, filter systems, export capabilities, scheduled reports

### 5. Formal Security Architecture
Artifacts must include stories for:
- Role-based access control (RBAC) with fine-grained permissions
- Data encryption (at rest, in transit)
- Authentication flows (SSO, MFA, token management)
- Security audit logging and compliance reporting
- API security (rate limiting, input validation, CORS, CSRF protection)

### 6. Audit Modeling
Artifacts must include stories for:
- Complete audit trail (who, what, when, where for every state change)
- Immutable audit log storage
- Audit report generation and compliance export
- Data lineage tracking and change history
- Regulatory audit support (SOC2, SOX, HIPAA audit readiness)

### 7. Platform-Level Integration Strategy
Artifacts must include stories for:
- API gateway and service mesh patterns
- Third-party integration architecture (webhooks, event-driven, batch sync)
- Data import/export pipelines
- Integration monitoring, retry logic, and error handling
- Partner/vendor API management

### 8. Operational Resilience (Availability & Performance)
Artifacts must include stories for:
- Health monitoring and alerting
- Graceful degradation and circuit breaker patterns
- Performance benchmarks and SLA targets
- Caching strategy and data consistency
- Disaster recovery and backup procedures
- Load testing and capacity planning stories

### 9. Workflow System Architecture
Artifacts must include stories for:
- Multi-step workflow orchestration with state machine modeling
- Multi-actor approval chains (sequential, parallel, conditional)
- Escalation logic (time-based, threshold-based, authority-based)
- Workflow status tracking, notifications, and SLA enforcement
- Configurable workflow templates

### 10. Architecture Compatibility Layer
Artifacts must include stories for:
- API versioning and backward compatibility
- Data migration and schema evolution
- Multi-tenant architecture support
- Feature flagging and progressive rollout
- Cross-platform compatibility (mobile, web, API clients)
`;

const DOMAIN_KNOWLEDGE_BASE: Record<string, {
  entities: string;
  regulations: string;
  businessRules: string;
  relationships: string;
  operationalLayers: string;
}> = {
  insurance: {
    entities: `CORE ENTITIES:
• Policyholder → Policy → Coverage → Endorsement → Premium → Billing
• Policyholder → Claim → Claim Line Item → Claim Payment → Subrogation
• Agent → Quote → Application → Underwriting Decision → Policy Issuance
• Underwriter → Risk Assessment → Risk Score → Coverage Terms → Rating Factor
• Policy Admin → Policy Lifecycle (New Business, Renewal, Endorsement, Cancellation, Reinstatement)
• Adjuster → Claim Investigation → Reserve Setting → Claim Settlement → Recovery`,
    regulations: `REGULATORY FRAMEWORK:
• State-specific insurance regulations (DOI compliance per jurisdiction)
• NAIC model laws and regulations (Market Conduct, Solvency, Consumer Protection)
• Rate filing requirements (prior approval, file-and-use, use-and-file by state)
• Claims handling regulations (prompt payment laws, unfair claims practices)
• Producer licensing requirements (resident/non-resident, continuing education)
• Privacy regulations (GLBA, state privacy laws, data breach notification)
• Anti-fraud statutes (SIU reporting, NICB referrals, fraud indicators)
• Financial reporting (statutory accounting STAT, GAAP reconciliation, RBC ratios)`,
    businessRules: `BUSINESS RULES:
• Underwriting rules: risk selection criteria, binding authority limits, referral triggers
• Rating algorithms: base rate × territory factor × class factor × experience mod × schedule mod
• Claims authority limits: adjuster settlement authority tiers, supervisor escalation thresholds
• Policy lifecycle rules: grace periods, cancellation notice requirements, reinstatement eligibility
• Commission structures: new business vs renewal rates, contingency bonuses, override schedules
• Reinsurance triggers: treaty attachment points, facultative referral criteria, catastrophe thresholds`,
    relationships: `ENTITY RELATIONSHIPS:
• Policyholder (1) → Policies (N) → Coverages (N) → Limits/Deductibles (1:1)
• Policy (1) → Claims (N) → Claimants (N) → Payments (N)
• Agent/Broker (1) → Quotes (N) → Applications (N) → Policies (N)
• Underwriter (1) → Risk Assessments (N) → Decisions (N) → Referrals (N)
• Policy (1) → Endorsements (N) → Premium Adjustments (N)
• Claim (1) → Reserves (N) → Payments (N) → Recoveries (N)
• Location (1) → Policies (N) → Coverages (N) → Inspections (N)
• LOB (Line of Business) → Products (N) → Forms (N) → Rating Tables (N)`,
    operationalLayers: `OPERATIONAL LAYERS:
• Policy Administration: issuance, endorsement, renewal, cancellation, reinstatement workflows
• Claims Processing: FNOL, investigation, evaluation, settlement, recovery, litigation management
• Underwriting Workbench: risk scoring, referral queues, approval chains, binding authority
• Billing & Collections: installment plans, payment processing, commission accounting, premium audit
• Producer Management: licensing, appointment, commission tracking, production reporting
• Reinsurance Administration: treaty management, cession processing, bordereau reporting
• Analytics & Reporting: loss ratio analysis, combined ratio, frequency/severity trending, predictive modeling
• Cross-sell Intelligence: policy bundle opportunities, coverage gap analysis, retention risk scoring
• Dashboard Operations: hierarchical rollups (agent→branch→region→company), KPI tracking, operational dashboards`
  },
  healthcare: {
    entities: `CORE ENTITIES:
• Patient → Encounter → Diagnosis → Treatment Plan → Medication → Lab Order
• Provider → Schedule → Appointment → Clinical Note → Referral → Follow-up
• Payer → Plan → Benefit → Authorization → Claim → Payment (EOB/ERA)
• Facility → Department → Bed Management → Census → Discharge Planning
• Pharmacy → Formulary → Prescription → Dispensing → Medication Reconciliation`,
    regulations: `REGULATORY FRAMEWORK:
• HIPAA (Privacy Rule, Security Rule, Transaction Standards, Breach Notification)
• CMS regulations (Medicare/Medicaid conditions of participation, MIPS/APM)
• FDA regulations (drug safety, device reporting, clinical trials)
• State licensure requirements (facility, provider, pharmacy)
• Meaningful Use / Promoting Interoperability requirements
• EMTALA (Emergency Medical Treatment and Labor Act)
• Stark Law and Anti-Kickback Statute compliance
• 21st Century Cures Act (information blocking, interoperability)`,
    businessRules: `BUSINESS RULES:
• Clinical decision support rules (evidence-based care pathways, drug interaction alerts)
• Prior authorization requirements by payer/procedure/diagnosis
• Coding rules (ICD-10, CPT, HCPCS) with medical necessity validation
• Revenue cycle rules: charge capture, claim scrubbing, denial management workflows
• Patient scheduling rules: provider availability, room/resource allocation, wait time management
• Quality measure calculations (HEDIS, CMS Star Ratings, Leapfrog)`,
    relationships: `ENTITY RELATIONSHIPS:
• Patient (1) → Encounters (N) → Orders (N) → Results (N)
• Provider (1) → Patients (N) → Encounters (N) → Notes (N)
• Encounter (1) → Diagnoses (N) → Procedures (N) → Charges (N) → Claims (N)
• Payer (1) → Plans (N) → Members (N) → Authorizations (N) → Claims (N)
• Facility (1) → Departments (N) → Providers (N) → Schedules (N)`,
    operationalLayers: `OPERATIONAL LAYERS:
• Electronic Health Records: clinical documentation, order entry, results management
• Revenue Cycle Management: registration, coding, billing, collections, denial management
• Population Health: care management, risk stratification, quality reporting
• Telehealth/Virtual Care: video visits, remote monitoring, asynchronous messaging
• Analytics: clinical outcomes, financial performance, operational efficiency dashboards`
  },
  banking: {
    entities: `CORE ENTITIES:
• Customer → Account → Transaction → Statement → Alert
• Loan Application → Credit Assessment → Approval → Disbursement → Repayment
• Branch → ATM → Digital Channel → Contact Center
• Compliance Officer → SAR → CTR → KYC/AML Record
• Treasury → Investment → Portfolio → Risk Position → Regulatory Capital`,
    regulations: `REGULATORY FRAMEWORK:
• BSA/AML (Bank Secrecy Act / Anti-Money Laundering)
• KYC/CDD (Know Your Customer / Customer Due Diligence)
• Dodd-Frank Act (consumer protection, systemic risk, Volcker Rule)
• Basel III/IV (capital adequacy, liquidity, leverage ratios)
• FDIC regulations (deposit insurance, resolution planning)
• TILA/RESPA (Truth in Lending, Real Estate Settlement)
• FCRA/ECOA (Fair Credit Reporting, Equal Credit Opportunity)
• PCI-DSS (Payment Card Industry Data Security Standard)`,
    businessRules: `BUSINESS RULES:
• Credit scoring models and decisioning rules
• Transaction monitoring rules (velocity checks, pattern detection, threshold alerts)
• Interest rate calculations (APR, APY, variable rate adjustments)
• Fee structures (overdraft, maintenance, wire transfer, ATM surcharges)
• Account lifecycle rules (opening, dormancy, closure, escheatment)
• Lending limits and concentration rules`,
    relationships: `ENTITY RELATIONSHIPS:
• Customer (1) → Accounts (N) → Transactions (N) → Statements (N)
• Loan (1) → Collateral (N) → Payments (N) → Covenants (N)
• Branch (1) → Employees (N) → Customers (N) → Transactions (N)`,
    operationalLayers: `OPERATIONAL LAYERS:
• Core Banking: account management, transaction processing, interest calculation
• Lending: origination, underwriting, servicing, collections
• Payments: ACH, wire, card processing, real-time payments
• Risk Management: credit risk, market risk, operational risk, liquidity risk
• Compliance: AML screening, regulatory reporting, audit trail
• Digital Banking: mobile/web apps, API banking, open banking`
  },
  automotive: {
    entities: `CORE ENTITIES:
• Vehicle → VIN → Make/Model/Trim → Warranty → Service History → Recall
• Customer → Ownership → Registration → Insurance → Financing (Loan/Lease)
• Dealer → Inventory → Quote → Sale → Trade-in → F&I (Finance & Insurance)
• OEM → Parts Catalog → Supply Chain → Distribution → After-Sales
• Fleet → Asset → Maintenance Schedule → Fuel/EV Charging → Utilization
• Workshop → Job Order → Technician → Labor → Parts → Invoice`,
    regulations: `REGULATORY FRAMEWORK:
• NHTSA (safety, recalls, VIN standards)
• EPA (emissions, fuel economy)
• State DMV (registration, titling, plates)
• FTC (dealer advertising, consumer protection)
• State lemon laws and warranty regulations
• GDPR/CCPA for customer and vehicle data
• OBD-II and emissions compliance`,
    businessRules: `BUSINESS RULES:
• Pricing rules: MSRP, incentives, dealer margin, trade-in valuation
• F&I rules: loan eligibility, lease residuals, gap insurance, extended warranty
• Service rules: warranty coverage, recall campaigns, labor rates, parts markup
• Inventory rules: aging, floor plan, allocation, ordering thresholds
• Fleet rules: maintenance intervals, utilization caps, fuel/charge tracking`,
    relationships: `ENTITY RELATIONSHIPS:
• Customer (1) → Vehicles (N) → Service History (N) → Invoices (N)
• Dealer (1) → Inventory (N) → Sales (N) → Trade-ins (N)
• Vehicle (1) → VIN (1) → Warranty (1) → Recalls (N)
• Fleet (1) → Assets (N) → Maintenance (N) → Fuel/Charging (N)
• OEM (1) → Parts (N) → Dealers (N) → Orders (N)`,
    operationalLayers: `OPERATIONAL LAYERS:
• Dealer Management: inventory, CRM, sales, F&I, DMS integration
• After-Sales: service scheduling, work orders, parts, warranty claims
• Fleet Management: asset tracking, maintenance, fuel, utilization, reporting
• Supply Chain: parts catalog, ordering, distribution, returns
• Analytics: sales pipeline, inventory turn, service retention, fleet KPIs`
  },
  education: {
    entities: `CORE ENTITIES:
• Student → Enrollment → Course → Grade → Transcript → Degree/Certificate
• Instructor → Course Offering → Assignment → Assessment → Feedback
• Institution → Program → Curriculum → Academic Calendar → Department
• LMS (Learning Management) → Module → Content → Quiz → Discussion
• Admin → Registration → Billing → Financial Aid → Compliance
• Parent/Guardian → Student Profile → Progress → Communications`,
    regulations: `REGULATORY FRAMEWORK:
• FERPA (Family Educational Rights and Privacy Act)
• ADA/Section 508 (accessibility for learning platforms)
• State education agency requirements (licensure, reporting)
• Accreditation standards (regional, programmatic)
• Title IV (federal financial aid compliance)
• COPPA (children’s privacy where applicable)
• State data privacy (student data handling)`,
    businessRules: `BUSINESS RULES:
• Enrollment rules: prerequisites, capacity, waitlists, add/drop deadlines
• Grading rules: scale, weighting, pass/fail, incomplete, academic standing
• Financial aid rules: eligibility, disbursement, satisfactory progress
• Curriculum rules: credit hours, program requirements, transfer credit
• Attendance and participation tracking rules
• Plagiarism and integrity checks`,
    relationships: `ENTITY RELATIONSHIPS:
• Student (1) → Enrollments (N) → Courses (N) → Grades (N)
• Instructor (1) → Courses (N) → Assignments (N) → Assessments (N)
• Institution (1) → Programs (N) → Courses (N) → Sections (N)
• LMS (1) → Modules (N) → Content (N) → Quizzes (N)
• Student (1) → Transcript (1) → Degrees/Certificates (N)`,
    operationalLayers: `OPERATIONAL LAYERS:
• Learning Management: content, assignments, grades, discussions, analytics
• Student Information (SIS): enrollment, registration, billing, transcripts
• Assessment & Accreditation: outcomes, reporting, compliance
• Communication: announcements, messaging, parent portal
• Analytics: engagement, completion, at-risk, learning analytics`
  },
  "e-governance": {
    entities: `CORE ENTITIES:
• Citizen → Application → Document → Verification → Status → Certificate
• Department → Service → Workflow → Queue → Officer → Approval
• Immigration (User Immigration) → Visa/Residency → Application → Biometric → Decision
• Portal → e-Service → Payment Gateway → Receipt → Notification
• Back Office → Case → SLA → Escalation → Audit Trail
• Master Data → Location → Fee Schedule → Eligibility Rule → Document Checklist`,
    regulations: `REGULATORY FRAMEWORK:
• Data localization and sovereignty (citizen data in-country)
• Right to Information (RTI) and transparency
• Digital signature and e-governance acts (e.g. IT Act, eSign)
• Privacy and consent (citizen data handling)
• Accessibility (WCAG, national accessibility standards)
• Audit and accountability (CAG, internal audit)
• Immigration-specific: visa rules, residency, border control compliance`,
    businessRules: `BUSINESS RULES:
• Eligibility rules: residency, documents, fee category, age
• Workflow rules: routing, delegation, SLA tiers, escalation
• Document rules: mandatory attachments, verification, expiry
• Fee rules: category-based, concessions, refunds, payment channels
• Immigration rules: visa type, quota, eligibility, appeal
• Notification and status update rules`,
    relationships: `ENTITY RELATIONSHIPS:
• Citizen (1) → Applications (N) → Documents (N) → Status (1)
• Department (1) → Services (N) → Workflows (N) → Cases (N)
• Application (1) → Verifications (N) → Approvals (N) → Certificate (1)
• Portal (1) → e-Services (N) → Payments (N) → Receipts (N)
• Immigration Case (1) → Biometric (1) → Decision (1) → Appeal (N)`,
    operationalLayers: `OPERATIONAL LAYERS:
• Citizen Portal: e-services, applications, status tracking, payments
• Case Management: queue, workflow, SLA, escalation, audit
• Document & Verification: upload, validation, KYC, biometric
• Immigration: visa/residency application, eligibility, decision, appeals
• Analytics: throughput, turnaround time, citizen satisfaction, compliance`
  },
  finance: {
    entities: `CORE ENTITIES:
• Customer → Account → Transaction → Statement → Product (Savings, Current, FD)
• Loan → Application → Disbursement → EMI → Collateral → Recovery
• Card → Issuance → Transaction → Billing → Reward → Limit
• Treasury → Liquidity → FX → Investment → Regulatory Capital
• Compliance → KYC → AML → SAR → CTR → Sanctions Screening
• Channel → Branch → ATM → Digital → Agent → Customer Service`,
    regulations: `REGULATORY FRAMEWORK:
• BSA/AML (Bank Secrecy Act / Anti-Money Laundering)
• KYC/CDD and customer due diligence
• Basel III/IV (capital, liquidity, leverage)
• PCI-DSS (card data security)
• Dodd-Frank, TILA, RESPA (consumer protection, lending)
• FCRA, ECOA (credit reporting, fair lending)
• Local banking regulator (RBI, FCA, etc.) and reporting`,
    businessRules: `BUSINESS RULES:
• Credit scoring and loan decisioning rules
• Transaction monitoring (velocity, patterns, thresholds)
• Interest and fee calculation (APR, APY, penalties)
• Account lifecycle (opening, dormancy, closure, escheatment)
• Limit and concentration rules (exposure, single borrower)
• Sanctions and PEP screening rules`,
    relationships: `ENTITY RELATIONSHIPS:
• Customer (1) → Accounts (N) → Transactions (N) → Statements (N)
• Loan (1) → Collateral (N) → EMIs (N) → Recovery (N)
• Branch (1) → Accounts (N) → Customers (N) → Transactions (N)
• Treasury (1) → Positions (N) → FX (N) → Regulatory Report (N)`,
    operationalLayers: `OPERATIONAL LAYERS:
• Core Banking: accounts, transactions, statements, products
• Lending: origination, underwriting, servicing, collections
• Cards: issuance, authorizations, billing, rewards
• Treasury & Risk: liquidity, FX, capital, ALM
• Compliance: KYC, AML, reporting, audit trail
• Channels: branch, ATM, digital, open banking`
  },
  manufacturing: {
    entities: `CORE ENTITIES:
• Product → BOM (Bill of Materials) → Routing → Work Order → Lot/Batch
• Plant → Production Line → Work Center → Machine → Downtime
• Inventory → Raw Material → WIP → Finished Good → Warehouse → Stock
• Supplier → PO → Receipt → Quality Check → Invoice → Payment
• Quality → Inspection → Non-Conformance → CAPA → Certificate
• Maintenance → Asset → Schedule → Work Order → Spare → History`,
    regulations: `REGULATORY FRAMEWORK:
• ISO 9001 (quality management), ISO 14001 (environmental)
• FDA/cGMP (if pharma/life sciences)
• OSHA (safety), EPA (emissions, waste)
• Traceability and recall (serialization, batch tracking)
• Export control and customs
• Labor and wage regulations`,
    businessRules: `BUSINESS RULES:
• BOM and routing rules: yield, scrap, alternate materials
• Planning rules: lead time, safety stock, reorder point, lot sizing
• Quality rules: AQL, sampling, hold/release, quarantine
• Maintenance rules: preventive intervals, calibration, spare stock
• Costing rules: standard cost, variance, absorption
• Traceability rules: batch genealogy, recall scope`,
    relationships: `ENTITY RELATIONSHIPS:
• Product (1) → BOM (1) → Routings (N) → Work Orders (N)
• Plant (1) → Lines (N) → Work Centers (N) → Machines (N)
• Inventory (1) → Items (N) → Lots (N) → Movements (N)
• Supplier (1) → POs (N) → Receipts (N) → Invoices (N)
• Work Order (1) → Quality (N) → CAPA (N)`,
    operationalLayers: `OPERATIONAL LAYERS:
• Production: scheduling, execution, labor, machine, downtime
• Inventory: raw, WIP, FG, warehouses, movements, cycle count
• Procurement: PO, receipt, quality, invoice matching
• Quality: inspection, NCR, CAPA, certificates, traceability
• Maintenance: assets, PM, work orders, spares, history
• Analytics: OEE, yield, delivery, cost, quality KPIs`
  },
  retail: {
    entities: `CORE ENTITIES:
• Product → SKU → Category → Price → Promotion → Inventory
• Customer → Profile → Order → Cart → Payment → Loyalty
• Store → POS → Register → Associate → Shift → Transaction
• Channel → E-commerce → Marketplace → Omnichannel → Fulfillment
• Supplier → Purchase Order → Receipt → Invoice → Vendor
• 365/Dynamics Retail: Store Operations → Client Book → HQ → Commerce`,
    regulations: `REGULATORY FRAMEWORK:
• PCI-DSS (payment card data)
• GDPR/CCPA (customer and employee data)
• Consumer protection (returns, warranties, labeling)
• Tax (VAT/GST, sales tax, reporting)
• Weights and measures, product safety
• Labor (scheduling, wages, breaks)`,
    businessRules: `BUSINESS RULES:
• Pricing: base price, promotions, markdowns, multi-currency
• Inventory: reorder point, safety stock, allocation, fulfillment rules
• Order: min order, credit limit, shipping, returns, refunds
• Loyalty: points, tiers, rewards, redemption
• Omnichannel: ship-from-store, BOPIS, returns anywhere
• 365 Retail: store sync, client book, HQ config, commerce integration`,
    relationships: `ENTITY RELATIONSHIPS:
• Product (1) → SKUs (N) → Inventory (N) → Locations (N)
• Customer (1) → Orders (N) → Line Items (N) → Payments (N)
• Store (1) → POS (N) → Transactions (N) → Associates (N)
• Order (1) → Fulfillment (N) → Shipment (N) → Return (N)
• Channel (1) → Catalog (1) → Cart (1) → Checkout (1)`,
    operationalLayers: `OPERATIONAL LAYERS:
• Merchandising: catalog, pricing, promotions, assortment
• Order Management: cart, checkout, payment, fulfillment, returns
• Store Operations: POS, inventory, client book, HQ sync (365 Retail)
• Inventory: stock, allocation, replenishment, multi-location
• Customer: profile, loyalty, preferences, analytics
• Analytics: sales, margin, sell-through, traffic, conversion`
  }
};

/** Map golden repo display name to DOMAIN_KNOWLEDGE_BASE key. Check repo first; if not linked or no match, LLM analyzes input. */
const GOLDEN_REPO_DOMAIN_MAP: Array<{ patterns: string[]; domain: string }> = [
  { patterns: ['insurance'], domain: 'insurance' },
  { patterns: ['healthcare', 'health'], domain: 'healthcare' },
  { patterns: ['retail', '365retail', '365 retail'], domain: 'retail' },
  { patterns: ['manufacturing'], domain: 'manufacturing' },
  { patterns: ['automotive'], domain: 'automotive' },
  { patterns: ['education'], domain: 'education' },
  { patterns: ['e-governance', 'egovernance', 'user immigration', 'immigration'], domain: 'e-governance' },
  { patterns: ['finance'], domain: 'finance' },
  { patterns: ['bank', 'banking', 'lending', 'loan'], domain: 'banking' },
];

function detectDomainFromGoldenRepo(repoName: string): string {
  const repoLower = (repoName || '').toLowerCase().trim();
  if (!repoLower) return 'general';
  for (const { patterns, domain } of GOLDEN_REPO_DOMAIN_MAP) {
    if (patterns.some((p) => repoLower.includes(p))) return domain;
  }
  return 'general';
}

const ALL_DOMAIN_KEYS = ['insurance', 'healthcare', 'banking', 'automotive', 'education', 'e-governance', 'finance', 'manufacturing', 'retail'] as const;
const KEYWORD_SCORES: Record<string, string[]> = {
  insurance: ['policy', 'claim', 'premium', 'underwriting', 'coverage', 'endorsement', 'adjuster', 'insured', 'deductible', 'policyholder', 'agent', 'broker', 'loss ratio', 'reinsurance', 'subrogation'],
  healthcare: ['patient', 'diagnosis', 'treatment', 'clinical', 'ehr', 'hipaa', 'provider', 'encounter', 'prescription', 'pharmacy', 'medical', 'hospital', 'health', 'telehealth'],
  banking: ['account', 'transaction', 'loan', 'deposit', 'withdrawal', 'credit', 'debit', 'banking', 'mortgage', 'kyc', 'aml', 'treasury', 'payment', 'interest rate'],
  finance: ['portfolio', 'investment', 'capital', 'trading', 'compliance', 'kyc', 'aml', 'treasury', 'finance', 'securities'],
  automotive: ['vehicle', 'vin', 'dealer', 'fleet', 'warranty', 'recall', 'parts', 'service', 'inventory', 'oem'],
  education: ['student', 'enrollment', 'course', 'grade', 'lms', 'instructor', 'curriculum', 'academic', 'transcript'],
  'e-governance': ['citizen', 'application', 'visa', 'immigration', 'residency', 'government', 'portal', 'e-service', 'document verification'],
  manufacturing: ['bom', 'work order', 'production', 'inventory', 'supplier', 'quality', 'maintenance', 'plant', 'batch'],
  retail: ['sku', 'pos', 'store', 'inventory', 'merchandise', 'customer', 'order', 'ecommerce', 'omnichannel', 'retail'],
};

/**
 * Golden-file-grounded domain analysis. The LLM is told the golden file is
 * authoritative and that it MUST NOT introduce any regulation, framework,
 * entity, persona, or business rule that is not explicitly present in the
 * golden file or the requirements text. This is the anti-hallucination path.
 *
 * Output shape matches `runDomainExpertAgent`'s return so the call site is
 * a drop-in replacement.
 */
async function runGoldenFileGroundedAnalysis(
  requirementsContent: string,
  goldenRepoName: string,
  goldenDomainFileContent: string,
  chatInput: string | undefined,
  progressCallback: ((message: string) => void) | undefined,
  startTime: number,
): Promise<{ domain: string; domainContext: string; domainAnalysis: string }> {
  // Domain name = goldenRepoName (already resolved upstream from the file's
  // own classification). Don't override; this is the source of truth.
  const domainLabel = (goldenRepoName || 'Business').trim();

  // Build the domainContext directly from the golden file content. The file
  // already contains structured sections (Primary Domain / Industry / Subdomains
  // / Personas / Integrations / Classification Rules) — no need for our static
  // DOMAIN_KNOWLEDGE_BASE template here.
  let domainContext = `## DOMAIN CONTEXT — ${domainLabel.toUpperCase()} (from golden domain file)\n\n${goldenDomainFileContent.trim()}\n\n## DOMAIN-SPECIFIC GENERATION RULES:\n1. Every artifact MUST be grounded in the golden domain file's entities, personas, subdomains, and classification rules.\n2. NEVER add regulations, frameworks (e.g. GDPR, HIPAA, SOC 2, ISO standards), or compliance requirements that are NOT explicitly named in the golden domain file or the requirements text.\n3. NEVER introduce entities or personas that are not present in the golden domain file.\n4. Acceptance criteria and test cases MUST trace to the golden file's stated capabilities and the requirements text — not to inferred industry assumptions.\n${MANDATORY_ARCHITECTURAL_LAYERS}\n`;

  // Optional small LLM call: produce a 2-3 sentence summary that aligns the
  // BRD to the golden file. We extract entities/regulations/rules ONLY from
  // the file or the BRD text — the prompt forbids invention.
  let domainAnalysis = `Domain: ${domainLabel} (from golden domain file)`;
  try {
    const useInstance = hasWorkflowInstances && workflowAzureInstances.length > 0;
    const instance = useInstance ? workflowAzureInstances[0] : null;
    const client = instance ? instance.client : openai;
    const model = instance ? instance.deployment : (process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4');

    if (client) {
      progressCallback?.(`🧠 Domain Expert Agent: Aligning BRD to golden domain file (no hallucinated regulations)...`);
      const sysPrompt = `You are a domain analyst. The GOLDEN DOMAIN FILE provided below is AUTHORITATIVE. Your output MUST be grounded ONLY in:
(a) entities, personas, subdomains, integrations, regulations, or rules EXPLICITLY stated in the GOLDEN DOMAIN FILE, OR
(b) entities, regulations, or rules EXPLICITLY named verbatim in the REQUIREMENTS text.

ABSOLUTE PROHIBITIONS:
- DO NOT invent regulations or compliance frameworks. If GDPR / HIPAA / SOC 2 / ISO 27001 / ePrivacy / NAIC / PCI / etc. is not literally written in the GOLDEN DOMAIN FILE or the REQUIREMENTS, do NOT mention it.
- DO NOT introduce entities, personas, or workflows that are not in the GOLDEN DOMAIN FILE or the REQUIREMENTS.
- DO NOT speculate about risks beyond what the GOLDEN DOMAIN FILE or REQUIREMENTS imply.
- If a JSON array has no grounded source content, return an empty array. Empty arrays are CORRECT and PREFERRED over invented entries.

Return STRICT JSON with this exact shape: {"summary": "2-3 sentence alignment of BRD to golden domain file", "domainEntities": ["..."], "personasFromFile": ["..."], "applicableRegulations": ["..."], "businessRules": ["..."], "workflowPatterns": ["..."], "domainRisks": ["..."]}

CRITICAL: every string in every array must quote a phrase from the GOLDEN DOMAIN FILE or REQUIREMENTS. Do NOT paraphrase a regulation name unless it appears verbatim in one of those two sources.`;

      const userPrompt = `GOLDEN DOMAIN FILE:\n\n${goldenDomainFileContent.trim().substring(0, 6000)}\n\n---\n\nREQUIREMENTS:\n\n${(requirementsContent || '').substring(0, 4000)}${chatInput ? `\n\n---\n\nADDITIONAL CONTEXT:\n${chatInput.substring(0, 800)}` : ''}`;

      const analysisResponse = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 1500,
        response_format: { type: 'json_object' as const },
      });

      let raw = analysisResponse.choices[0]?.message?.content || '{}';
      const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) raw = codeBlockMatch[1].trim();
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      }

      if (parsed && typeof parsed === 'object') {
        // Verify every reported entry actually appears in the file or the BRD.
        // This is a defense-in-depth check — even with the strict prompt, a
        // belt-and-braces filter catches LLM slip-ups.
        const sourceText = (goldenDomainFileContent + '\n' + requirementsContent + '\n' + (chatInput || '')).toLowerCase();
        const verify = (arr: any): string[] => {
          if (!Array.isArray(arr)) return [];
          return arr
            .map((s) => String(s ?? '').trim())
            .filter((s) => {
              if (!s) return false;
              // The phrase (or a 4-char-plus token from it) must appear in source.
              const lower = s.toLowerCase();
              if (sourceText.includes(lower)) return true;
              // Token match: at least one token of length > 4 from the phrase
              // must exist in source. Filters out pure inventions while allowing
              // case/spacing differences.
              const tokens = lower.split(/[^a-z0-9]+/).filter((t) => t.length > 4);
              return tokens.length > 0 && tokens.some((t) => sourceText.includes(t));
            });
        };

        const entities = verify(parsed.domainEntities);
        const personas = verify(parsed.personasFromFile);
        const regs = verify(parsed.applicableRegulations);
        const rules = verify(parsed.businessRules);
        const flows = verify(parsed.workflowPatterns);
        const risks = verify(parsed.domainRisks);

        domainAnalysis = `Domain Analysis Summary: ${typeof parsed.summary === 'string' ? parsed.summary : 'Aligned to golden domain file'}\nIdentified Entities: ${entities.join(', ') || '(none beyond golden file)'}\nPersonas (from golden file): ${personas.join(', ') || '(see golden file)'}\nApplicable Regulations: ${regs.join(', ') || '(none stated in golden file or BRD)'}\nKey Business Rules: ${rules.join(', ') || '(see golden file)'}\nWorkflow Patterns: ${flows.join(', ') || '(see golden file)'}\nDomain Risks: ${risks.join(', ') || '(none stated)'}`;

        // Surface the analysis into the prompt header too, so chunks get
        // the BRD-aligned summary in addition to the raw golden file body.
        domainContext += `\n## REQUIREMENT-SPECIFIC DOMAIN ANALYSIS (grounded in golden file + BRD):\n${domainAnalysis}\n`;
      }
    }
  } catch (err) {
    console.warn('[Domain Expert Agent] Golden-file grounded analysis failed (using golden file as-is):', err instanceof Error ? err.message : String(err));
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  progressCallback?.(`✅ Domain Expert Agent: Golden-file grounded context ready (${duration}s) — no hallucinated regulations`);
  console.log(`[Domain Expert Agent] (golden-file path) Completed in ${duration}s — Domain: ${domainLabel}, Context length: ${domainContext.length} chars`);

  return { domain: domainLabel, domainContext, domainAnalysis };
}

export async function runDomainExpertAgent(
  requirementsContent: string,
  goldenRepoName: string,
  chatInput?: string,
  progressCallback?: (message: string) => void,
  goldenDomainFileContent?: string,
): Promise<{ domain: string; domainContext: string; domainAnalysis: string }> {
  const startTime = Date.now();
  progressCallback?.("🔍 Domain Expert Agent: Checking golden repo and input...");

  const repoLower = (goldenRepoName || '').toLowerCase().trim();
  const contentLower = (requirementsContent + ' ' + (chatInput || '')).toLowerCase();
  const goldenRepoLinked = repoLower.length > 0;

  // ── Authoritative golden domain file path ──
  // When the project's golden repo provides a domain.* file, we trust it
  // completely. We DO NOT fall back to DOMAIN_KNOWLEDGE_BASE templates and
  // we DO NOT let the LLM invent regulations / frameworks / entities that
  // are not present in the file or the BRD. The downstream routes.ts already
  // uses goldenMetadata.goldenDomainContext as the prompt header — this
  // branch keeps the agent's `domainAnalysis` honest too.
  const hasGoldenFile = typeof goldenDomainFileContent === 'string'
    && goldenDomainFileContent.trim().length > 50;

  if (hasGoldenFile) {
    progressCallback?.("📄 Domain Expert Agent: Golden domain file present — grounding analysis to its content (no hallucinated regulations).");
    return await runGoldenFileGroundedAnalysis(
      requirementsContent,
      goldenRepoName,
      goldenDomainFileContent!,
      chatInput,
      progressCallback,
      startTime,
    );
  }

  // 1) First check golden repo: if linked, try to resolve domain from repo name (e.g. "Insurance Standard", "Healthcare Standard")
  let detectedDomain = goldenRepoLinked ? detectDomainFromGoldenRepo(goldenRepoName) : 'general';
  // Track where the domain actually came from so the progress log is accurate.
  // (A repo can be linked but not match any known domain, in which case the
  // domain is resolved by LLM / keyword analysis — not "from golden repo".)
  let domainSourceLabel: 'golden repo' | 'LLM analysis' | 'keyword analysis' =
    detectedDomain !== 'general' ? 'golden repo' : 'keyword analysis';

  // 2) If no golden repo or repo didn’t match a known domain, use LLM to analyze input and detect domain
  if (detectedDomain === 'general') {
    progressCallback?.("🔍 Domain Expert Agent: No golden repo match — analyzing requirements with LLM to detect domain...");
    try {
      const useInstance = hasWorkflowInstances && workflowAzureInstances.length > 0;
      const instance = useInstance ? workflowAzureInstances[0] : null;
      const client = instance ? instance.client : openai;
      const model = instance ? instance.deployment : (process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4");
      if (client) {
        const llmResponse = await client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: `You are a domain classifier. Given requirements or user input, choose exactly ONE domain from this list: insurance, healthcare, banking, finance, automotive, education, e-governance, manufacturing, retail. If the content clearly fits one domain, return that. If it is generic or unclear, return "general". Reply with only the single word (lowercase), no explanation.`
            },
            {
              role: "user",
              content: `Classify the domain for this content:\n\n${(requirementsContent || '').substring(0, 3000)}${chatInput ? '\n\nAdditional context:\n' + (chatInput || '').substring(0, 800) : ''}`
            }
          ],
          temperature: 0.1,
          max_tokens: 50,
        });
        const llmDomain = (llmResponse.choices[0]?.message?.content || 'general').toLowerCase().trim().replace(/\.$/, '');
        if (ALL_DOMAIN_KEYS.includes(llmDomain as typeof ALL_DOMAIN_KEYS[number])) {
          detectedDomain = llmDomain;
          domainSourceLabel = 'LLM analysis';
        }
      }
    } catch (err) {
      console.warn('[Domain Expert Agent] LLM domain detection failed, falling back to keyword scoring:', err instanceof Error ? err.message : String(err));
    }
  }

  // 3) If still general, fall back to keyword scoring over content
  if (detectedDomain === 'general') {
    const domainScores: Record<string, number> = {} as Record<string, number>;
    for (const d of ALL_DOMAIN_KEYS) domainScores[d] = 0;
    for (const [domain, keywords] of Object.entries(KEYWORD_SCORES)) {
      for (const kw of keywords) if (contentLower.includes(kw)) domainScores[domain] = (domainScores[domain] ?? 0) + 1;
    }
    const top = Object.entries(domainScores).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) {
      detectedDomain = top[0];
      domainSourceLabel = 'keyword analysis';
    }
  }

  const sourceSuffix =
    detectedDomain === 'general'
      ? ' (no specific domain detected)'
      : ` (from ${domainSourceLabel})`;
  progressCallback?.(`🏢 Domain Expert Agent: Detected domain — ${detectedDomain.toUpperCase()}${sourceSuffix}`);

  const domainKnowledge = DOMAIN_KNOWLEDGE_BASE[detectedDomain];
  let domainContext = '';
  let domainAnalysis = '';

  if (domainKnowledge) {
    domainContext = `
## DOMAIN CONTEXT — ${detectedDomain.toUpperCase()} INDUSTRY

${domainKnowledge.entities}

${domainKnowledge.relationships}

${domainKnowledge.regulations}

${domainKnowledge.businessRules}

${domainKnowledge.operationalLayers}

## DOMAIN-SPECIFIC GENERATION RULES:
1. Every user story MUST reference domain-specific entities (not generic "user" or "data")
2. Acceptance criteria MUST include domain regulatory compliance checks where applicable
3. Test cases MUST cover domain-specific business rules and edge cases
4. Subtasks MUST include domain compliance validation tasks
5. Description sections MUST reference relevant domain regulations and business rules
6. Technical considerations MUST address domain-specific security and compliance requirements
7. Entity relationships MUST be modeled correctly per the domain hierarchy above
8. Operational workflows MUST follow industry-standard processes

${MANDATORY_ARCHITECTURAL_LAYERS}
`;

    try {
      const useInstance = hasWorkflowInstances && workflowAzureInstances.length > 0;
      const instance = useInstance ? workflowAzureInstances[0] : null;
      const client = instance ? instance.client : openai;
      const model = instance ? instance.deployment : (process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4");

      if (client) {
        progressCallback?.(`🧠 Domain Expert Agent: Generating ${detectedDomain} domain analysis with LLM...`);
        const analysisResponse = await client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: `You are a ${detectedDomain} industry domain analyst. Analyze the provided REQUIREMENTS and output a concise domain analysis in JSON format.

ANTI-HALLUCINATION RULES (NON-NEGOTIABLE):
- Every entity, regulation, business rule, workflow pattern, and risk you list MUST be grounded in a phrase that appears in the REQUIREMENTS text.
- DO NOT invent regulations or compliance frameworks. If GDPR / HIPAA / SOC 2 / ISO 27001 / ePrivacy / NAIC / PCI / etc. is not literally written in the REQUIREMENTS, do NOT mention it.
- If a JSON array has no grounded source content, return an empty array. Empty arrays are CORRECT and PREFERRED over invented entries.
- Do NOT speculate about risks or workflow patterns beyond what the REQUIREMENTS imply.

Focus on:
1. Specific entities referenced verbatim in the requirements
2. Regulations explicitly named in the requirements
3. Business rules stated or directly implied by the requirements
4. Entity relationships relevant to the requirements text
5. Operational workflow patterns described by the requirements

Return JSON: {"domainEntities": ["entity1", ...], "applicableRegulations": ["reg1", ...], "businessRules": ["rule1", ...], "workflowPatterns": ["pattern1", ...], "domainRisks": ["risk1", ...], "summary": "2-3 sentence domain analysis grounded in the requirements"}`
            },
            {
              role: "user",
              content: `Analyze these ${detectedDomain} requirements:\n\n${requirementsContent.substring(0, 4000)}${chatInput ? '\n\nAdditional context:\n' + chatInput.substring(0, 1000) : ''}`
            }
          ],
          temperature: 0,
          max_tokens: 2000,
          response_format: { type: "json_object" as const }
        });

        let analysisContent = analysisResponse.choices[0]?.message?.content || '{}';
        try {
          // Bedrock/Claude may wrap JSON in markdown code blocks since response_format is not supported
          const codeBlockMatch = analysisContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (codeBlockMatch && codeBlockMatch[1]) {
            analysisContent = codeBlockMatch[1].trim();
          }
          // Fallback: find first { ... } block if direct parse fails
          let parsed: any;
          try {
            parsed = JSON.parse(analysisContent);
          } catch {
            const jsonMatch = analysisContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsed = JSON.parse(jsonMatch[0]);
            } else {
              throw new Error('No JSON found in response');
            }
          }
          domainAnalysis = `Domain Analysis Summary: ${parsed.summary || 'N/A'}
Identified Entities: ${(parsed.domainEntities || []).join(', ')}
Applicable Regulations: ${(parsed.applicableRegulations || []).join(', ')}
Key Business Rules: ${(parsed.businessRules || []).join(', ')}
Workflow Patterns: ${(parsed.workflowPatterns || []).join(', ')}
Domain Risks: ${(parsed.domainRisks || []).join(', ')}`;

          domainContext += `\n## REQUIREMENT-SPECIFIC DOMAIN ANALYSIS:\n${domainAnalysis}\n`;
        } catch (parseErr) {
          console.warn('[Domain Expert Agent] Failed to parse domain analysis JSON:', parseErr instanceof Error ? parseErr.message : String(parseErr));
          console.warn('[Domain Expert Agent] Raw response (first 500 chars):', analysisContent.substring(0, 500));
        }
      }
    } catch (err) {
      console.warn('[Domain Expert Agent] LLM analysis failed, using static domain knowledge:', err instanceof Error ? err.message : String(err));
    }
  } else {
    domainContext = `
## DOMAIN CONTEXT — GENERAL BUSINESS
Generate artifacts using standard business domain patterns. Identify specific business entities, 
roles, and processes from the requirements. Apply general software engineering best practices 
for security, compliance, and operational considerations.

${MANDATORY_ARCHITECTURAL_LAYERS}
`;
    domainAnalysis = `Domain: General Business (no specific industry domain detected from golden repo "${goldenRepoName}")`;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  progressCallback?.(`✅ Domain Expert Agent: ${detectedDomain.toUpperCase()} domain context ready (${duration}s) — injecting into all chunks`);
  console.log(`[Domain Expert Agent] Completed in ${duration}s — Domain: ${detectedDomain}, Context length: ${domainContext.length} chars`);

  return { domain: detectedDomain, domainContext, domainAnalysis };
}
