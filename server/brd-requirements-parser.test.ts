/**
 * Test: BRD requirements parser for Quoting BRD document
 * Run: npx vitest run server/brd-requirements-parser.test.ts
 */
import { describe, it, expect } from "vitest";
import { parseRequirementsFromBrdJson } from "./routes";

describe("BRD requirements parser - Quoting BRD", () => {
  it("parses FR1-FR18, NFR1-NFR8, TR1-TR7, IR1-IR8 from Quoting BRD document structure", () => {
    // BRD JSON structure as stored by the system (sections with subsections)
    const brdJson = {
      sections: [
        { title: "1. Introduction", content: "Overview...", subsections: [] },
        { title: "2. Business Objectives", content: "Goals...", subsections: [] },
        { title: "3. Stakeholder Analysis", content: "Stakeholders...", subsections: [] },
        {
          title: "4. Requirements",
          content: "This section captures all detailed requirements.",
          subsections: [
            {
              title: "4.1 Functional Requirements",
              content: `| Req ID | Description |
| FR1 | Ability to initiate new quotes (NB or RC) from multiple channels including agent portal, internal PAS, APIs, and distribution partner systems. |
| FR2 | Capture applicant, risk, exposure, and account information necessary for quote generation. |
| FR3 | Integrate with Product Configurator, Rating Engine, and Rules Engine to apply product-specific rating and underwriting logic. |
| FR4 | Validate quote data for completeness, accuracy, and compliance with inline error correction. |
| FR5 | Support quote editing, deletion, copying (same or new quote number), and template creation. |
| FR6 | Generate quote proposal documents and rating worksheets via document generation service. |
| FR7 | Ability to decline, expire, or mark quote status such as Draft, In Review, Referred, Declined, Ready to Bind. |
| FR8 | Generate or input policy numbers linked to quotes. |
| FR9 | Enable quick policy pricing adjustments for underwriting flexibility. |
| FR10 | Create or update Account information directly from quote data. |
| FR11 | Invoke underwriting questions, referrals, approvals, and declinations based on rules engine outputs. |
| FR12 | Send quote data to Rating Engine and retrieve premium calculations in real time. |
| FR13 | Validate premiums using tenant-specific pricing models. |
| FR14 | Support quote comparison features to compare different versions or different quotes side-by-side with pre-defined comparison sets. |
| FR15 | Manage subjectivities: view, select, mark conditions, and automate document tracking related to subjectivities. |
| FR16 | Provide a non-binding quick quote option with simplified rating logic for rapid estimate generation. |
| FR17 | Emit quote-related events based on predefined business rules to support integration, audit, and traceability. |
| FR18 | Provide AI-driven assistance features including chatbots, document ingestion, quote option creation, comparison summarization, email assistance, anomaly detection, smart risk classification, guided data capture, and predictive underwriting triage. |`,
            },
            {
              title: "4.2 Non-Functional Requirements",
              content: `| Requirement | Description |
| NFR1 | System must support high throughput with minimal latency, capable of handling peak quote volumes without degradation. |
| NFR2 | User interface must be responsive and intuitive across supported devices and roles. |
| NFR3 | Compliance with all applicable state-level insurance regulations, product filings, and rating/rule restrictions. |
| NFR4 | Data privacy and security policies must be enforced, including encryption, access control, and audit logging. |
| NFR5 | System must maintain audit trails for all quote actions, versions, and events for regulatory and operational purposes. |
| NFR6 | Scalability to support growth in quote volume, distribution channels, and product lines. |
| NFR7 | Availability target of 99.9% during business hours with planned maintenance windows communicated in advance. |
| NFR8 | System must adhere to enterprise architecture standards and integration frameworks mandated by IT governance. |`,
            },
            {
              title: "4.3 Technical Requirements",
              content: `| Requirement | Description |
| TR1 | Use standardized API protocols (REST/JSON) for integration with external systems such as Product Configurator, Rating Engine, and Rules Engine. |
| TR2 | Support role-based access control integrated with enterprise identity management systems. |
| TR3 | Maintain versioned quote data in a secure, scalable database supporting ACID transactions. |
| TR4 | Implement asynchronous event messaging for quote event emission using enterprise message bus technologies. |
| TR5 | Leverage AI/ML platforms compatible with enterprise AI strategy for advanced analytics and automation features. |
| TR6 | Support multi-tenant data isolation and configuration per tenant requirements. |
| TR7 | Ensure compatibility with existing PAS infrastructure and deployment environments. |`,
            },
            {
              title: "4.4 Integration Requirements",
              content: `| Integration | Description |
| IR1 | Integration with Product Configurator for retrieving product definitions and options. |
| IR2 | Integration with Rating Engine for premium calculation based on quote data. |
| IR3 | Integration with Rules Engine to enforce underwriting and business rules. |
| IR4 | Integration with Document Generation Service for producing quote proposals and worksheets. |
| IR5 | Connectivity with external data providers for supplemental data such as property, credit, and loss history. |
| IR6 | APIs to support quote submission and retrieval by distribution partners and agent portals. |
| IR7 | Integration with Identity & Access Management for user authentication and authorization. |
| IR8 | Event integration with enterprise message bus for real-time quote event notifications. |`,
            },
          ],
        },
      ],
    };

    const results = parseRequirementsFromBrdJson(brdJson, "test-brd-id");

    // Expect FR1-FR18 (18), NFR1-NFR8 (8), TR1-TR7 (7), IR1-IR8 (8) = 41 total
    const names = results.map((r) => r.name);

    expect(results.length).toBeGreaterThanOrEqual(18); // At least FR1-FR18
    expect(names).toContain("FR1");
    expect(names).toContain("FR18");
    expect(names).toContain("NFR1");
    expect(names).toContain("NFR8");
    expect(names).toContain("TR1");
    expect(names).toContain("TR7");
    expect(names).toContain("IR1");
    expect(names).toContain("IR8");

    expect(results.length).toBe(41);

    // Verify FR1 description
    const fr1 = results.find((r) => r.name === "FR1");
    expect(fr1).toBeDefined();
    expect(fr1!.description).toContain("Ability to initiate new quotes");
  });
});
