/**
 * Standalone test for rich-HTML -> Markdown paste conversion.
 * Run with: npx tsx scripts/test-markdown-paste.ts
 *
 * Sets up a jsdom DOM so the browser-only conversion logic (DOMParser,
 * TreeWalker, HTMLTableElement) runs under Node.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.DOMParser = dom.window.DOMParser;
g.NodeFilter = dom.window.NodeFilter;
g.Node = dom.window.Node;

const { richHtmlToMarkdown } = await import("../client/src/lib/markdown-paste.ts");

let passed = 0;
let failed = 0;
const fail = (name: string, msg: string, out?: string) => {
  failed++;
  console.error(`\u274c ${name}: ${msg}`);
  if (out !== undefined) console.error(`   ---- output ----\n${out}\n   ----------------`);
};
const pass = (name: string) => {
  passed++;
  console.log(`\u2705 ${name}`);
};
const assert = (name: string, cond: boolean, msg: string, out?: string) =>
  cond ? pass(name) : fail(name, msg, out);

// 1) Word/Office paste with a <style> block hidden in an HTML comment + a table.
const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head><meta charset="utf-8"><title>Doc</title>
<style><!-- /* Font Definitions */ @font-face {font-family:"Cambria Math";}
p.MsoNormal {mso-style-unhide:no; font-family:"Times New Roman";}
@page WordSection1 {size:612.0pt 792.0pt; mso-header-margin:36.0pt;}
--></style></head>
<body>
<!--StartFragment-->
<p class=MsoNormal><o:p>Risk register below:</o:p></p>
<table class=MsoTableGrid>
<tr><td>Risk</td><td>Impact</td><td>Probability</td><td>Mitigation Strategy</td></tr>
<tr><td>External APIs inconsistent</td><td>High</td><td>Medium</td><td>Define canonical contracts early</td></tr>
<tr><td>Rules not agreed early</td><td>High</td><td>Medium</td><td>Run discovery workshops</td></tr>
</table>
<!--EndFragment-->
</body></html>`;

{
  const out = richHtmlToMarkdown(wordHtml);
  const name = "Word style junk stripped + table converted";
  const noJunk = !/mso-|@font-face|@page|font-family|MsoNormal|Cambria/i.test(out);
  const hasTable =
    /\|\s*Risk\s*\|\s*Impact\s*\|\s*Probability\s*\|\s*Mitigation Strategy\s*\|/.test(out) &&
    /\|\s*---\s*\|/.test(out);
  const hasText = out.includes("Risk register below:");
  const noFragmentMarker = !/StartFragment|EndFragment/.test(out);
  assert(
    name,
    noJunk && hasTable && hasText && noFragmentMarker,
    `noJunk=${noJunk} hasTable=${hasTable} hasText=${hasText} noFragmentMarker=${noFragmentMarker}`,
    out,
  );
}

// 2) Confluence-style table with proper <th> header row.
{
  const html = `<table><thead><tr><th>Employee ID</th><th>Name</th><th>Dept</th></tr></thead>
<tbody><tr><td>EMP001</td><td>Arjun</td><td>Engineering</td></tr>
<tr><td>EMP002</td><td>Priya</td><td>HR</td></tr></tbody></table>`;
  const out = richHtmlToMarkdown(html);
  const ok =
    /\|\s*Employee ID\s*\|\s*Name\s*\|\s*Dept\s*\|/.test(out) &&
    /\|\s*EMP001\s*\|\s*Arjun\s*\|\s*Engineering\s*\|/.test(out) &&
    (out.match(/\n/g) || []).length >= 3;
  assert("Confluence table with <th> header", ok, "table not converted cleanly", out);
}

// 3) Table with no header row (all <td>) -> first row promoted, separator present.
{
  const html = `<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>`;
  const out = richHtmlToMarkdown(html);
  const ok = /\|\s*A\s*\|\s*B\s*\|/.test(out) && /\|\s*---\s*\|\s*---\s*\|/.test(out) && /\|\s*1\s*\|\s*2\s*\|/.test(out);
  assert("Headerless table promotes first row", ok, "missing header/separator", out);
}

// 4) colspan expansion + ragged rows padded to uniform width.
{
  const html = `<table><tr><th colspan="2">Merged</th><th>C</th></tr><tr><td>x</td><td>y</td><td>z</td></tr><tr><td>only</td></tr></table>`;
  const out = richHtmlToMarkdown(html);
  const lines = out.split("\n").filter((l) => l.trim().startsWith("|"));
  const colsConsistent = lines.every((l) => (l.match(/\|/g) || []).length === (lines[0].match(/\|/g) || []).length);
  assert("colspan expanded + rows padded uniformly", colsConsistent && lines.length === 4, "columns not uniform", out);
}

// 5) Non-table rich formatting (headings, bold, lists) converts to Markdown.
{
  const html = `<h2>Overview</h2><p>This is <strong>bold</strong> and <em>italic</em>.</p><ul><li>one</li><li>two</li></ul>`;
  const out = richHtmlToMarkdown(html);
  const ok = /(^|\n)##\s+Overview/.test(out) && /\*\*bold\*\*/.test(out) && /(^|\n)-\s+one/.test(out);
  assert("Headings/bold/lists convert", ok, "formatting not converted", out);
}

// 6) Pipe characters inside cells are escaped (don't break the table).
{
  const html = `<table><tr><th>Key</th><th>Value</th></tr><tr><td>range</td><td>a|b|c</td></tr></table>`;
  const out = richHtmlToMarkdown(html);
  const ok = out.includes("a\\|b\\|c");
  assert("Pipes inside cells are escaped", ok, "unescaped pipe would break table", out);
}

// 7) Pure <style> with no real content -> empty (nothing to insert).
{
  const html = `<html><head><style>.x{color:red}</style></head><body></body></html>`;
  const out = richHtmlToMarkdown(html);
  assert("Style-only paste yields empty output", out.trim() === "", `expected empty, got: "${out}"`, out);
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
