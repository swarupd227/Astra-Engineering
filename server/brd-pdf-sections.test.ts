/**
 * Test: BRD PDF export includes all sections and subsections (matches UI preview)
 * Run: npx vitest run server/brd-pdf-sections.test.ts
 */
import { describe, it, expect } from "vitest";
import { generatePDFBuffer } from "./helper/pdfKitGeneration";

describe("BRD PDF sections", () => {
  it("includes subsection content in PDF (matches UI preview)", async () => {
    // Simulate hierarchical sections as sent from client (buildHierarchicalSections output)
    const bodySections = [
      {
        title: "1. Executive Summary",
        content: "Overview of the project.",
        subsections: [
          { title: "Purpose", content: "Define project purpose.", originalIndex: 1 },
          { title: "Scope", content: "Define project scope.", originalIndex: 2 },
        ],
      },
      {
        title: "2. Business Objectives",
        content: "Key business goals.",
        subsections: [
          { title: "Goals", content: "Reduce costs by 20%.", originalIndex: 4 },
        ],
      },
      {
        title: "3. Appendix",
        content: "Supplementary information.",
        subsections: [],
      },
    ];

    // Server merges subsections into content (same logic as routes.ts)
    const sections = bodySections.map((s: any) => {
      let content = typeof s.content === "string" ? s.content : String(s.content ?? "");
      const subsections = Array.isArray(s.subsections) ? s.subsections : [];
      if (subsections.length > 0) {
        for (const sub of subsections) {
          const subTitle = typeof sub.title === "string" ? sub.title : String(sub.title ?? "");
          const subContent = typeof sub.content === "string" ? sub.content : String(sub.content ?? "");
          content = content ? `${content}\n\n### ${subTitle}\n\n${subContent}` : `### ${subTitle}\n\n${subContent}`;
        }
      }
      return { title: s.title, content };
    });

    const pdfBuffer = await generatePDFBuffer({
      title: "Test BRD",
      version: "1.0",
      sections,
    });

    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    const pdfText = pdfBuffer.toString("latin1");
    expect(pdfText).toContain("Executive Summary");
    expect(pdfText).toContain("Overview of the project");
    expect(pdfText).toContain("Purpose");
    expect(pdfText).toContain("Define project purpose");
    expect(pdfText).toContain("Scope");
    expect(pdfText).toContain("Define project scope");
    expect(pdfText).toContain("Business Objectives");
    expect(pdfText).toContain("Goals");
    expect(pdfText).toContain("Reduce costs by 20%");
    expect(pdfText).toContain("Appendix");
    expect(pdfText).toContain("Supplementary information");
  });
});
