// server/constants/testing-constants.ts

export const testPlanSectionBatches = [
  {
    name: "Part 1: Strategy & Scope (Sections 1-3)",
    sections: "1.0, 2.0, 3.0",
    instructions: "Generate Section 1 (Executive Summary), Section 2 (Test Scope and Coverage), and Section 3 (Comprehensive Test Strategy). Provide deep detail for each subsection. Target 1000-1200 words. Return ONLY the markdown for these sections. No intros/outros."
  },
  {
    name: "Part 2: Environment & Schedule (Sections 4-7)",
    sections: "4.0, 5.0, 6.0, 7.0",
    instructions: "Generate Section 4 (Test Environment Architecture), Section 5 (Detailed Test Schedule and Milestones), Section 6 (Entry and Exit Criteria), and Section 7 (Team Structure and Responsibilities). Include detailed tables. Target 1200-1500 words. Return ONLY the markdown for these sections. No intros/outros."
  },
  {
    name: "Part 3: Risk & Defects (Sections 8-9)",
    sections: "8.0, 9.0",
    instructions: "Generate Section 8 (Risk Assessment and Mitigation) and Section 9 (Defect Management Framework). Provide specific risk matrices and defect lifecycle details. Target 800-1000 words. Return ONLY the markdown for these sections. No intros/outros."
  },
  {
    name: "Part 4: Metrics & Reporting (Section 10)",
    sections: "10.0",
    instructions: "Generate Section 10 (Test Metrics and Reporting). Detail all KPIs, reporting frequencies, and dashboard requirements. Target 600-800 words. Return ONLY the markdown for this section. No intros/outros."
  },
  {
    name: "Part 5: Tools & Best Practices (Sections 11-12)",
    sections: "11.0, 12.0",
    instructions: "Generate Section 11 (Tools and Technology Stack) and Section 12 (Quality Assurance and Best Practices). Focus on technical stack and QA standards. Target 800-1000 words. Return ONLY the markdown for these sections. No intros/outros."
  },
  {
    name: "Part 6: Assumptions & Dependencies (Section 13)",
    sections: "13.0",
    instructions: "Generate Section 13 (Assumptions and Dependencies). Provide a comprehensive list of project assumptions, technical dependencies, and external constraints. Target 500-800 words. Return ONLY the markdown for this section. No intros/outros."
  },
  {
    name: "Part 7: Approval & Sign-off (Section 14)",
    sections: "14.0",
    instructions: "Generate Section 14 (Approval and Sign-off Process). Include a complete sign-off table with columns for Name, Role, Date, and Signature. Ensure this is a definitive conclusion to the document. Target 500-800 words. Return ONLY the markdown for this section. No intros/outros."
  }
];
