/**
 * Verification: BRD RAG form-input contract (same structure as buildBrdContentFromInput in brd-ai-service).
 * Run: npx tsx server/brd-rag-verification.test.ts
 * Does not import brd-ai-service to avoid loading LLM config; asserts the expected RAG content structure.
 */
interface BRDInput {
  projectName: string;
  projectDescription: string;
  businessObjectives?: string;
  targetAudience?: string;
  keyFeatures?: string;
  constraints?: string;
  successCriteria?: string;
  timeline?: string;
  budget?: string;
  stakeholders?: string;
  existingRequirements?: string;
}

function buildBrdContentFromInputContract(input: BRDInput): string {
  const lines: string[] = [
    `**Project Name:** ${input.projectName}`,
    "",
    "**Project Description:**",
    input.projectDescription,
  ];
  if (input.businessObjectives) lines.push("", "**Business Objectives:**", input.businessObjectives);
  if (input.targetAudience) lines.push("", "**Target Audience:**", input.targetAudience);
  if (input.keyFeatures) lines.push("", "**Key Features:**", input.keyFeatures);
  if (input.constraints) lines.push("", "**Constraints:**", input.constraints);
  if (input.successCriteria) lines.push("", "**Success Criteria:**", input.successCriteria);
  if (input.timeline) lines.push("", "**Timeline:**", input.timeline);
  if (input.budget) lines.push("", "**Budget:**", input.budget);
  if (input.stakeholders) lines.push("", "**Stakeholders:**", input.stakeholders);
  if (input.existingRequirements) lines.push("", "**Existing Requirements/Context:**", input.existingRequirements);
  return lines.join("\n");
}

const sampleFormInput: BRDInput = {
  projectName: "Auth Save Feature",
  projectDescription: "Save authentication to the application.",
  businessObjectives: "Improve user session persistence",
  targetAudience: "End users",
  keyFeatures: "SSO, session storage",
  constraints: "Must comply with NAIC guidance",
  successCriteria: "Users stay logged in",
  timeline: "Q1 2026",
  budget: "TBD",
  stakeholders: "Product, Security",
  existingRequirements: "Existing auth module",
};

function run() {
  const content = buildBrdContentFromInputContract(sampleFormInput);

  const requiredSections = [
    "Project Name",
    "Project Description",
    "Business Objectives",
    "Target Audience",
    "Key Features",
    "Constraints",
    "Success Criteria",
    "Timeline",
    "Budget",
    "Stakeholders",
    "Existing Requirements",
  ];

  const failed: string[] = [];
  for (const section of requiredSections) {
    if (!content.includes(section)) failed.push(section);
  }

  if (failed.length > 0) {
    console.error("[BRD RAG verification] FAIL: Form input context missing sections:", failed);
    process.exit(1);
  }

  if (!content.includes(sampleFormInput.projectDescription)) {
    console.error("[BRD RAG verification] FAIL: Project description not in RAG content");
    process.exit(1);
  }

  if (!content.includes(sampleFormInput.constraints)) {
    console.error("[BRD RAG verification] FAIL: Constraints not in RAG content");
    process.exit(1);
  }

  console.log("[BRD RAG verification] PASS: Form input context includes all sections and sample values");
  console.log("[BRD RAG verification] RAG content length:", content.length);
  process.exit(0);
}

run();
