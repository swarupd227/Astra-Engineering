import type { DOMStructure } from './enhanced-crawler';

export interface DiagramPage {
  url: string;
  title: string;
  links: string[];
}

export interface DiagramWorkflow {
  id: string;
  name: string;
  type: string;
  entryPoint: string;
}

export function generateMermaidFlowDiagram(
  pages: DiagramPage[],
  workflows: DiagramWorkflow[]
): string {
  const lines: string[] = ['flowchart TD'];
  const pageIds = new Map<string, string>();

  // Limit to meaningful pages
  const meaningfulPages = pages.slice(0, 30);

  // Create node for each page
  meaningfulPages.forEach((page, i) => {
    const id = `P${i}`;
    const rawLabel = page.title || getPathLabel(page.url);
    const label = escapeLabel(rawLabel);
    pageIds.set(page.url, id);

    // Use different shapes based on page type
    if (isLoginPage(page.url)) {
      lines.push(`  ${id}([" 🔐 ${label}"])`);
    } else if (isDashboard(page.url)) {
      lines.push(`  ${id}[["📊 ${label}"]]`);
    } else if (isFormPage(page.url)) {
      lines.push(`  ${id}["📝 ${label}"]`);
    } else {
      lines.push(`  ${id}["${label}"]`);
    }
  });

  // Add edges from inter-page links (deduplicated, max 3 links per page)
  const addedEdges = new Set<string>();
  meaningfulPages.forEach(page => {
    const fromId = pageIds.get(page.url);
    if (!fromId) return;

    const linksToAdd = page.links.slice(0, 4);
    for (const link of linksToAdd) {
      const toId = pageIds.get(link);
      if (!toId || toId === fromId) continue;

      const edgeKey = `${fromId}->${toId}`;
      const reverseKey = `${toId}->${fromId}`;

      if (!addedEdges.has(edgeKey) && !addedEdges.has(reverseKey)) {
        addedEdges.add(edgeKey);
        lines.push(`  ${fromId} --> ${toId}`);
      }
    }
  });

  // Add workflow nodes
  const formWorkflows = workflows.filter(wf => wf.type === 'form_submission').slice(0, 8);
  formWorkflows.forEach((wf, i) => {
    const pageId = pageIds.get(wf.entryPoint);
    if (!pageId) return;

    const wfLabel = escapeLabel(wf.name);
    const wfId = `W${i}`;
    lines.push(`  ${wfId}(["⚡ ${wfLabel}"])`);
    lines.push(`  ${pageId} -.->|workflow| ${wfId}`);
  });

  const ctaWorkflows = workflows.filter(wf => wf.type === 'cta_flow').slice(0, 5);
  ctaWorkflows.forEach((wf, i) => {
    const pageId = pageIds.get(wf.entryPoint);
    if (!pageId) return;

    const wfLabel = escapeLabel(wf.name);
    const wfId = `C${i}`;
    lines.push(`  ${wfId}(["🎯 ${wfLabel}"])`);
    lines.push(`  ${pageId} -.->|cta| ${wfId}`);
  });

  // Add styling
  lines.push('');
  lines.push('  classDef loginNode fill:#fee2e2,stroke:#ef4444,color:#991b1b');
  lines.push('  classDef dashNode fill:#dbeafe,stroke:#3b82f6,color:#1e40af');
  lines.push('  classDef workflowNode fill:#d1fae5,stroke:#10b981,color:#065f46');
  lines.push('  classDef ctaNode fill:#fef3c7,stroke:#f59e0b,color:#92400e');
  lines.push('');

  const loginIds = meaningfulPages
    .filter(p => isLoginPage(p.url))
    .map(p => pageIds.get(p.url))
    .filter(Boolean);
  const dashIds = meaningfulPages
    .filter(p => isDashboard(p.url))
    .map(p => pageIds.get(p.url))
    .filter(Boolean);

  if (loginIds.length) lines.push(`  class ${loginIds.join(',')} loginNode`);
  if (dashIds.length) lines.push(`  class ${dashIds.join(',')} dashNode`);

  const formWfIds = formWorkflows.map((_, i) => `W${i}`);
  const ctaWfIds = ctaWorkflows.map((_, i) => `C${i}`);
  if (formWfIds.length) lines.push(`  class ${formWfIds.join(',')} workflowNode`);
  if (ctaWfIds.length) lines.push(`  class ${ctaWfIds.join(',')} ctaNode`);

  return lines.join('\n');
}

function getPathLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (path === '/' || path === '') return 'Home';
    const parts = path.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || 'Home';
    return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ');
  } catch {
    return url.slice(0, 20);
  }
}

function escapeLabel(text: string): string {
  return text
    .replace(/"/g, "'")
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .slice(0, 35);
}

function isLoginPage(url: string): boolean {
  return /\/(login|signin|sign-in|auth|authenticate)/i.test(url);
}

function isDashboard(url: string): boolean {
  return /\/(dashboard|home|portal|overview|main)/i.test(url);
}

function isFormPage(url: string): boolean {
  return /\/(register|signup|form|checkout|apply|create|edit|new)/i.test(url);
}
