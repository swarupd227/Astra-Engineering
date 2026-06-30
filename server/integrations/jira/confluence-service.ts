/**
 * Confluence Service
 * Handles Confluence page creation and management for Jira projects
 * Similar to ADO Wiki pages but using Confluence REST API
 */

export interface ConfluenceConfig {
  instanceUrl: string; // e.g., https://company.atlassian.net
  email: string;
  apiToken: string;
  spaceKey: string; // Confluence space key (usually same as Jira project key)
}

export interface ConfluencePage {
  id: string;
  title: string;
  content: string;
  pageType: string;
  order: number;
}

export interface ConfluencePageResult {
  id: string;
  title: string;
  url: string;
  spaceKey: string;
}

export class ConfluenceService {
  private config: ConfluenceConfig;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: ConfluenceConfig) {
    this.config = config;

    // Validate config
    if (!config.instanceUrl || !config.email || !config.apiToken || !config.spaceKey) {
      throw new Error('Confluence configuration is incomplete: instanceUrl, email, apiToken, and spaceKey are required');
    }

    // Ensure instanceUrl doesn't have trailing slash
    const cleanInstanceUrl = config.instanceUrl.replace(/\/$/, '');
    this.config.instanceUrl = cleanInstanceUrl;

    // Confluence API base URL
    this.baseUrl = `${cleanInstanceUrl}/wiki/rest/api`;

    // Create Basic Auth token: email:apiToken
    const authToken = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    this.headers = {
      'Authorization': `Basic ${authToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    console.log(`[ConfluenceService] Initialized with instance: ${cleanInstanceUrl}, space: ${config.spaceKey}`);
  }

  /**
   * Make a request to Confluence API
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;

    console.log(`[ConfluenceService] Making request to: ${url}`);
    console.log(`[ConfluenceService] Method: ${options.method || 'GET'}`);

    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = `Confluence API error: ${response.status} ${response.statusText}`;

      // Check if response is HTML (likely a redirect to login page)
      const isHtml = errorBody.trim().startsWith('<') || errorBody.includes('<html>');

      try {
        if (!isHtml) {
          const errorJson = JSON.parse(errorBody);
          if (errorJson.message) {
            errorMessage += ` - ${errorJson.message}`;
          } else if (errorJson.errorMessages && errorJson.errorMessages.length > 0) {
            errorMessage += ` - ${errorJson.errorMessages.join(', ')}`;
          } else {
            errorMessage += ` - ${errorBody.substring(0, 200)}`;
          }
        } else {
          // HTML response usually means authentication failed or Confluence not available
          errorMessage += ` - Received HTML response (likely authentication issue or Confluence not available)`;
        }
      } catch {
        if (!isHtml) {
          errorMessage += ` - ${errorBody.substring(0, 200)}`;
        }
      }

      console.error(`[ConfluenceService] Request failed: ${errorMessage}`);

      if (response.status === 401) {
        throw new Error(`${errorMessage}\n\nPossible causes:\n- Confluence may not be enabled for this Jira instance\n- Invalid or expired API token\n- Incorrect email address\n- API token does not have Confluence permissions\n- The space key "${this.config.spaceKey}" may not exist in Confluence\n\nPlease verify:\n1. Confluence is enabled and accessible for your Jira instance\n2. Your API token has Confluence permissions\n3. The space key exists in Confluence (it may differ from your Jira project key)`);
      }

      if (response.status === 404) {
        throw new Error(`${errorMessage}\n\nThe Confluence space "${this.config.spaceKey}" was not found. Please ensure:\n1. The space exists in Confluence\n2. The space key is correct (it may differ from your Jira project key)\n3. You have access to the space`);
      }

      throw new Error(errorMessage);
    }

    return response.json();
  }

  /**
   * Get a space
   */
  async getSpace(spaceKey: string): Promise<any> {
    try {
      const space = await this.request<any>(`/space/${spaceKey}`);
      return space;
    } catch (error: any) {
      // Check if it's a 401 error - this means authentication failed, not that space doesn't exist
      if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
        throw new Error(`Confluence authentication failed. The API token may not have access to Confluence, or Confluence may not be enabled for this Jira instance. Please verify your credentials and ensure Confluence is available.`);
      }
      if (error.message?.includes('404')) {
        // Space doesn't exist - this is expected, we'll create it
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a Confluence space
   */
  async createSpace(spaceKey: string, spaceName?: string, description?: string): Promise<any> {
    try {
      const payload: any = {
        key: spaceKey,
        name: spaceName || spaceKey,
      };

      if (description) {
        payload.description = {
          plain: {
            value: description,
            representation: 'plain'
          }
        };
      }

      console.log(`[ConfluenceService] Creating space: ${spaceKey} (${spaceName || spaceKey})`);

      const space = await this.request<any>('/space', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      console.log(`[ConfluenceService] ✅ Created space: ${spaceKey} (ID: ${space.id})`);
      return space;
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ConfluenceService] ❌ Failed to create space "${spaceKey}":`, errorMsg);

      // Check if space already exists (409 Conflict)
      if (error.message?.includes('409') || error.message?.includes('already exists')) {
        console.log(`[ConfluenceService] Space "${spaceKey}" already exists, fetching it...`);
        try {
          return await this.getSpace(spaceKey);
        } catch (getError) {
          throw new Error(`Space "${spaceKey}" appears to exist but cannot be accessed: ${errorMsg}`);
        }
      }

      throw new Error(`Failed to create Confluence space "${spaceKey}": ${errorMsg}`);
    }
  }

  /**
   * Ensure space exists, creating it if necessary
   */
  async ensureSpaceExists(spaceKey: string, spaceName?: string): Promise<any> {
    try {
      // Try to get the space first - don't create automatically (similar to ADO)
      const space = await this.getSpace(spaceKey);
      if (space) {
        console.log(`[ConfluenceService] ✅ Space "${spaceKey}" exists and is accessible`);
        return space;
      }
      // If getSpace returns null/undefined, space doesn't exist
      throw new Error(`Confluence space "${spaceKey}" does not exist. Please create the space in Confluence first.`);
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // If it's a 404, space doesn't exist
      if (errorMsg.includes('404') || errorMsg.includes('not found')) {
        throw new Error(`Confluence space "${spaceKey}" does not exist. Please create the space in Confluence first, or use an existing space key.`);
      }

      // If it's a 401/403, authentication/authorization issue
      if (errorMsg.includes('401') || errorMsg.includes('Unauthorized') || errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
        throw new Error(`Cannot access Confluence space "${spaceKey}". Please verify:\n1. The space exists in Confluence\n2. Your API token has access to this space\n3. Your credentials are correct`);
      }

      // For other errors, re-throw
      throw error;
    }
  }

  /**
   * Get space home page ID
   */
  async getSpaceHomePageId(spaceKey: string): Promise<string | null> {
    try {
      const space = await this.getSpace(spaceKey);
      return space.homepage?.id || null;
    } catch (error) {
      console.error(`[ConfluenceService] Failed to get space home page:`, error);
      return null;
    }
  }

  /**
   * Convert markdown/HTML content to Confluence Storage Format (HTML)
   * Confluence Storage Format uses HTML with specific tags
   * IMPORTANT: Converts Mermaid diagrams to SVG before processing
   *
   * NEW FLOW:
   * 1. Extract Mermaid blocks with metadata (file, position)
   * 2. Convert each Mermaid block to SVG → Data URI → HTML
   * 3. Replace Mermaid blocks with HTML in content
   */
  /**
   * Convert markdown table to Confluence table format
   */
  private convertTableToConfluence(rows: string[][]): string {
    if (rows.length === 0) return '';

    let html = '<table><tbody>';

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      html += '<tr>';
      for (const cell of row) {
        const tag = i === 0 ? 'th' : 'td';
        html += `<${tag}>${this.processInlineMarkdown(cell)}</${tag}>`;
      }
      html += '</tr>';
    }

    html += '</tbody></table>';
    return html;
  }

  /**
   * Close a list and return HTML
   */
  private closeList(type: 'ul' | 'ol', items: string[]): string {
    if (items.length === 0) return '';

    const tag = type === 'ul' ? 'ul' : 'ol';
    const html = items.map(item => `<li>${item}</li>`).join('');
    return `<${tag}>${html}</${tag}>`;
  }

  /**
   * Process inline markdown (bold, italic, code, links, images)
   * Preserves existing HTML tags
   */
  private processInlineMarkdown(text: string): string {
    // Extract existing HTML tags to preserve them
    const htmlTags: Array<{ tag: string; index: number }> = [];
    let tagIndex = 0;

    // Replace HTML tags with placeholders
    let processedText = text.replace(/<[^>]+>/g, (match) => {
      const placeholder = `@@HTMLTAG${tagIndex}@@`;
      htmlTags.push({ tag: match, index: tagIndex });
      tagIndex++;
      return placeholder;
    });

    // Now escape HTML in the remaining text
    processedText = this.escapeHtml(processedText);

    // Process inline code (backticks)
    processedText = processedText.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Process images ![alt](url)
    processedText = processedText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

    // Process bold (**text**)
    processedText = processedText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Process italic (*text* or _text_) - but not if it's part of **
    processedText = processedText.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    processedText = processedText.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Process links [text](url)
    processedText = processedText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Restore HTML tags
    htmlTags.forEach(({ tag, index }) => {
      const placeholder = `@@HTMLTAG${index}@@`;
      processedText = processedText.replaceAll(placeholder, tag);
    });

    return processedText;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Maximum inline SVG size (bytes) before we switch to uploading the diagram
   * as a page attachment. Confluence Storage Format silently truncates / 400s
   * on pages with single attributes that exceed ~1MB, so we cap embedded
   * data-URIs at a safe margin and offload anything bigger to attachments.
   * Override via env: CONFLUENCE_INLINE_SVG_MAX_BYTES.
   */
  private static readonly INLINE_SVG_MAX_BYTES =
    Number(process.env.CONFLUENCE_INLINE_SVG_MAX_BYTES) || 150_000;

  private async convertToConfluenceFormat(
    content: string,
    pageTitle: string = 'Wiki Page',
    pendingAttachments?: Array<{ id: string; filename: string; svg: string }>
  ): Promise<string> {
    if (!content || content.trim().length === 0) {
      return '<p>No content</p>';
    }

    // Convert markdown/HTML to Confluence Storage Format (HTML)
    let htmlContent = content;

    // Support Confluence attachment-style image references like !filename.svg!
    // These are converted to a storage-format attachment image macro.
    htmlContent = htmlContent.replace(/!\s*([^\s!]+\.(png|jpe?g|gif|svg|bmp|webp))\s*!/gi, '<ac:image><ri:attachment ri:filename="$1" /></ac:image>');

    // STEP 1: Extract all Mermaid blocks with metadata
    try {
      const { extractMermaidBlocks } = await import('./mermaid-extractor');
      const { mermaidToSvg, svgToConfluenceHtml } = await import('./mermaid-to-svg-service');

      const mermaidBlocks = extractMermaidBlocks(content, pageTitle);

      if (mermaidBlocks.length > 0) {
        console.log(`[ConfluenceService] Found ${mermaidBlocks.length} Mermaid diagram(s) in "${pageTitle}"`);

        // STEP 2: Convert each Mermaid block to SVG → Data URI → HTML
        // Process in reverse order to preserve indices
        for (let i = mermaidBlocks.length - 1; i >= 0; i--) {
          const block = mermaidBlocks[i];

          try {
            console.log(`[ConfluenceService] Converting Mermaid diagram ${i + 1}/${mermaidBlocks.length} from "${block.sourceFile}"...`);

            // Convert Mermaid → SVG, then decide inline vs attachment based on size.
            const svg = await mermaidToSvg(block.syntax);
            const svgBytes = Buffer.byteLength(svg, 'utf8');
            let html: string;
            if (
              pendingAttachments !== undefined &&
              svgBytes > ConfluenceService.INLINE_SVG_MAX_BYTES
            ) {
              // Too large to safely inline as a data-URI — emit a placeholder
              // that the caller will swap for an <ac:image><ri:attachment/></ac:image>
              // reference after the page is created and the attachment uploaded.
              const attId = `mermaid-${pendingAttachments.length}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const filename = `${attId}.svg`;
              pendingAttachments.push({ id: attId, filename, svg });
              html =
                `<p style="text-align: center; padding: 20px;">` +
                `<!--CONFLUENCE_ATTACH:${attId}:${filename}-->` +
                `</p>`;
              console.log(`[ConfluenceService] 📎 Diagram ${i + 1} (${svgBytes} bytes) deferred to attachment upload`);
            } else {
              html = svgToConfluenceHtml(svg, `Diagram ${block.blockIndex}`);
            }

            // STEP 3: Replace Mermaid block with HTML
            // Ensure we're replacing the exact block including any trailing whitespace/newlines
            const beforeBlock = htmlContent.substring(0, block.startIndex);
            let afterBlock = htmlContent.substring(block.endIndex);

            // Remove any trailing newlines/whitespace after the block to prevent extra text
            // Also remove any leftover Mermaid syntax or encoded content that might appear
            afterBlock = afterBlock.replace(/^\s*\n\s*/g, '');

            // Remove any leftover data URI or base64 content that might be on the same line
            afterBlock = afterBlock.replace(/^\s*(data:image\/svg\+xml[^\s<>]+|[A-Za-z0-9+/]{200,}={0,2})\s*/g, '');

            htmlContent = beforeBlock + html + afterBlock;

            console.log(`[ConfluenceService] ✅ Converted Mermaid diagram ${i + 1} to SVG and HTML`);
          } catch (error) {
            console.error(`[ConfluenceService] ❌ Failed to convert Mermaid diagram ${i + 1}:`, error);
            // Replace the failed Mermaid block with a visible error placeholder + original
            // source code. Previously we left the original ```mermaid fence in place, but
            // the markdown→HTML walker below silently strips mermaid fences, so the
            // diagram would vanish from the page with no trace. We now substitute it
            // immediately with HTML so the next pass leaves it alone.
            const errorMsg = error instanceof Error ? error.message : String(error);
            const escapedSource = this.escapeHtml(block.syntax);
            const escapedError = this.escapeHtml(errorMsg).slice(0, 300);
            const fallbackHtml = `
<div style="border: 1px solid #d04437; background: #fff5f5; padding: 12px; border-radius: 4px; margin: 16px 0;">
  <p style="margin: 0 0 8px 0; color: #d04437; font-weight: bold;">⚠️ Diagram failed to render</p>
  <p style="margin: 0 0 8px 0; color: #555; font-size: 12px;">${escapedError}</p>
  <details>
    <summary style="cursor: pointer; color: #555;">Show original Mermaid source</summary>
    <pre style="background: #f4f5f7; padding: 8px; overflow-x: auto; margin-top: 8px;"><code>${escapedSource}</code></pre>
  </details>
</div>
`.trim();
            const beforeBlock = htmlContent.substring(0, block.startIndex);
            const afterBlock = htmlContent.substring(block.endIndex).replace(/^\s*\n\s*/g, '');
            htmlContent = beforeBlock + fallbackHtml + afterBlock;
          }
        }

        console.log(`[ConfluenceService] ✅ Converted ${mermaidBlocks.length} Mermaid diagram(s) to SVG`);
      }
    } catch (error) {
      console.warn('[ConfluenceService] Failed to convert Mermaid to SVG, continuing with original content:', error);
      // Continue with original content if Mermaid conversion fails
    }

    // Reconstruct any stray `data:image/...` data URIs that appear as plain text
    // (this can happen if an earlier conversion stage emitted them outside an <img>
    // tag). We intentionally do NOT do a "delete any long alphanumeric run" pass:
    // the previous implementation had a regex whose rescue condition could never
    // match (its character class excluded ':', ';' and ',') and therefore silently
    // deleted any 200+ char alphanumeric string in the page, occasionally
    // corrupting valid wiki content. Wrap real data URIs in <img>, leave the rest
    // alone.
    htmlContent = htmlContent.replace(
      /(?<!src=["'])data:image\/([a-zA-Z0-9.+-]+);([a-zA-Z0-9=;-]+),([A-Za-z0-9+/=]+)/gi,
      '<img src="data:image/$1;$2,$3" alt="Embedded image" />'
    );

    // Now process markdown formatting line by line for proper structure
    const lines = htmlContent.split('\n');
    const result: string[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    let inList = false;
    let listType: 'ul' | 'ol' | null = null;
    let listItems: string[] = [];
    let listIndent = 0;
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockContent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Handle code blocks
      if (trimmed.startsWith('```')) {
        if (inCodeBlock) {
          // End code block
          const lang = codeBlockLang || '';
          const code = codeBlockContent.join('\n');
          if (lang.toLowerCase() === 'mermaid') {
            // A mermaid fence reaching this point means SVG conversion was not
            // performed (extractor missed the block, or Puppeteer failed without
            // being caught earlier). Render the source visibly instead of dropping
            // it — losing diagrams silently was the #1 cause of "missing diagram"
            // reports in Confluence.
            result.push(
              `<div style="border: 1px solid #d04437; background: #fff5f5; padding: 12px; border-radius: 4px; margin: 16px 0;">` +
              `<p style="margin: 0 0 8px 0; color: #d04437; font-weight: bold;">⚠️ Diagram source preserved (could not be rendered)</p>` +
              `<pre style="background: #f4f5f7; padding: 8px; overflow-x: auto;"><code>${this.escapeHtml(code)}</code></pre>` +
              `</div>`
            );
          } else {
            result.push(`<pre><code>${this.escapeHtml(code)}</code></pre>`);
          }
          inCodeBlock = false;
          codeBlockContent = [];
          codeBlockLang = '';
        } else {
          // Start code block
          inCodeBlock = true;
          codeBlockLang = trimmed.replace(/```/g, '').trim();
          codeBlockContent = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockContent.push(line);
        continue;
      }

      // Handle markdown tables
      if (trimmed.includes('|') && trimmed.split('|').length >= 3) {
        // Check if it's a table separator line (|---|---|)
        if (/^[\|\s\-:]+$/.test(trimmed)) {
          // Skip separator lines
          continue;
        }

        if (!inTable) {
          // Start new table
          inTable = true;
          tableRows = [];
        }

        // Parse table row
        const cells: string[] = trimmed.split('|').map((c: string) => c.trim()).filter((c: string) => c.length > 0);
        tableRows.push(cells);
        continue;
      } else {
        // End table if we were in one
        if (inTable) {
          result.push(this.convertTableToConfluence(tableRows));
          tableRows = [];
          inTable = false;
        }
      }

      // Handle headings
      if (trimmed.startsWith('#')) {
        // Close any open lists
        if (inList) {
          result.push(this.closeList(listType!, listItems));
          inList = false;
          listItems = [];
          listType = null;
        }

        const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (match) {
          const level = match[1].length;
          const text = match[2];
          result.push(`<h${level}>${this.processInlineMarkdown(text)}</h${level}>`);
          continue;
        }
      }

      // Handle horizontal rules
      if (/^[-*_]{3,}$/.test(trimmed)) {
        result.push('<hr/>');
        continue;
      }

      // Handle lists (bullet and numbered)
      const listMatch = trimmed.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
      if (listMatch) {
        const indent = listMatch[1].length;
        const marker = listMatch[2];
        const content = listMatch[3];
        const currentListType = /^\d+\./.test(marker) ? 'ol' : 'ul';

        if (inList) {
          if (currentListType !== listType || indent !== listIndent) {
            // Different list type or indent level - close current list
            result.push(this.closeList(listType!, listItems));
            listItems = [];
            listType = currentListType;
            listIndent = indent;
          }
        } else {
          // Start new list
          inList = true;
          listType = currentListType;
          listIndent = indent;
          listItems = [];
        }

        listItems.push(this.processInlineMarkdown(content));
        continue;
      } else {
        // Not a list item - close any open list
        if (inList) {
          result.push(this.closeList(listType!, listItems));
          inList = false;
          listItems = [];
          listType = null;
        }
      }

      // Preserve raw HTML lines to avoid adding extra paragraph wrappers
      if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        result.push(trimmed);
        continue;
      }

      // Handle regular paragraphs
      if (trimmed.length > 0) {
        result.push(`<p>${this.processInlineMarkdown(trimmed)}</p>`);
      } else if (result.length > 0 && !result[result.length - 1].endsWith('</p>') &&
                 !result[result.length - 1].endsWith('</h1>') &&
                 !result[result.length - 1].endsWith('</h2>') &&
                 !result[result.length - 1].endsWith('</h3>') &&
                 !result[result.length - 1].endsWith('</h4>') &&
                 !result[result.length - 1].endsWith('</h5>') &&
                 !result[result.length - 1].endsWith('</h6>') &&
                 !result[result.length - 1].endsWith('</ul>') &&
                 !result[result.length - 1].endsWith('</ol>') &&
                 !result[result.length - 1].endsWith('</table>') &&
                 !result[result.length - 1].endsWith('</pre>') &&
                 !result[result.length - 1].endsWith('<hr/>')) {
        // Empty line - add spacing if needed
        result.push('<br/>');
      }
    }

    // Close any remaining open structures
    if (inTable && tableRows.length > 0) {
      result.push(this.convertTableToConfluence(tableRows));
    }
    if (inList) {
      result.push(this.closeList(listType!, listItems));
    }
    if (inCodeBlock && codeBlockContent.length > 0) {
      const code = codeBlockContent.join('\n');
      if (codeBlockLang.toLowerCase() === 'mermaid') {
        result.push(
          `<div style="border: 1px solid #d04437; background: #fff5f5; padding: 12px; border-radius: 4px; margin: 16px 0;">` +
          `<p style="margin: 0 0 8px 0; color: #d04437; font-weight: bold;">⚠️ Diagram source preserved (could not be rendered)</p>` +
          `<pre style="background: #f4f5f7; padding: 8px; overflow-x: auto;"><code>${this.escapeHtml(code)}</code></pre>` +
          `</div>`
        );
      } else {
        result.push(`<pre><code>${this.escapeHtml(code)}</code></pre>`);
      }
    }

    htmlContent = result.join('\n');

    // If no content was generated, wrap in paragraph
    if (!htmlContent.trim()) {
      htmlContent = '<p>No content</p>';
    }

    return htmlContent;
  }

  /**
   * Upload an SVG (or any text) file as an attachment to a Confluence page.
   * Used by the large-diagram path: diagrams whose SVG would exceed the
   * inline-data-URI size cap are uploaded here and then referenced from page
   * content via <ac:image><ri:attachment ri:filename="..."/></ac:image>.
   */
  async uploadAttachment(
    pageId: string,
    filename: string,
    content: string,
    mimeType: string = 'image/svg+xml'
  ): Promise<void> {
    // Use Node's built-in FormData/Blob (Node 18+). Confluence requires the
    // X-Atlassian-Token: no-check header to bypass XSRF for attachment endpoints.
    const form = new FormData();
    const blob = new Blob([content], { type: mimeType });
    form.append('file', blob, filename);
    form.append('minorEdit', 'true');

    const url = `${this.baseUrl}/content/${pageId}/child/attachment`;
    const headers: Record<string, string> = {
      Authorization: this.headers.Authorization,
      'X-Atlassian-Token': 'no-check',
      // NB: don't set Content-Type — fetch/FormData picks the right multipart boundary.
    };

    const res = await fetch(url, { method: 'POST', headers, body: form as any });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to upload attachment "${filename}" to page ${pageId}: ${res.status} ${res.statusText} — ${body.substring(0, 200)}`);
    }
    console.log(`[ConfluenceService] 📎 Uploaded attachment "${filename}" to page ${pageId} (${content.length} bytes)`);
  }

  /**
   * Upload all collected attachments and swap the placeholders for proper
   * Confluence storage-format attachment references.
   */
  private async finalizePageAttachments(
    pageId: string,
    contentWithPlaceholders: string,
    pendingAttachments: Array<{ id: string; filename: string; svg: string }>
  ): Promise<string> {
    if (pendingAttachments.length === 0) return contentWithPlaceholders;

    for (const att of pendingAttachments) {
      try {
        await this.uploadAttachment(pageId, att.filename, att.svg, 'image/svg+xml');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ConfluenceService] ❌ Attachment upload failed for "${att.filename}": ${msg}`);
        // Replace the placeholder with a visible error block so the user knows.
        const safe = this.escapeHtml(msg).slice(0, 300);
        contentWithPlaceholders = contentWithPlaceholders.replace(
          `<!--CONFLUENCE_ATTACH:${att.id}:${att.filename}-->`,
          `<span style="color:#d04437;">⚠️ Diagram attachment upload failed: ${safe}</span>`
        );
        continue;
      }
      contentWithPlaceholders = contentWithPlaceholders.replace(
        `<!--CONFLUENCE_ATTACH:${att.id}:${att.filename}-->`,
        `<ac:image ac:alt="Diagram"><ri:attachment ri:filename="${att.filename}" /></ac:image>`
      );
    }
    return contentWithPlaceholders;
  }

  /**
   * Create a Confluence page
   */
  async createPage(
    title: string,
    content: string,
    parentPageId?: string
  ): Promise<ConfluencePageResult> {
    const spaceKey = this.config.spaceKey;

    // Get space home page as parent if not provided
    let parentId = parentPageId;
    if (!parentId) {
      parentId = await this.getSpaceHomePageId(spaceKey) || undefined;
    }

    // Convert content to Confluence Storage Format (HTML).
    // `pendingAttachments` collects any oversized SVGs that will be uploaded
    // separately after the page is created (Confluence won't accept giant
    // data-URI <img> attributes on large diagrams).
    const pendingAttachments: Array<{ id: string; filename: string; svg: string }> = [];
    const confluenceContent = await this.convertToConfluenceFormat(content, title, pendingAttachments);

    const payload: any = {
      type: 'page',
      title: title,
      space: {
        key: spaceKey
      },
      body: {
        storage: {
          value: confluenceContent,
          representation: 'storage'
        }
      }
    };

    console.log(`[ConfluenceService] Page payload preview:`, {
      title,
      spaceKey,
      contentLength: confluenceContent.length,
      pendingAttachments: pendingAttachments.length,
      contentPreview: confluenceContent.substring(0, 200) + '...'
    });

    // Add parent if available
    if (parentId) {
      payload.ancestors = [{ id: parentId }];
    }

    console.log(`[ConfluenceService] Creating page: "${title}" in space: ${spaceKey}`);

    const created = await this.request<any>('/content', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const pageUrl = `${this.config.instanceUrl}/wiki${created._links.webui}`;

    console.log(`[ConfluenceService] ✅ Created page: "${title}" (ID: ${created.id})`);
    console.log(`[ConfluenceService] Page URL: ${pageUrl}`);

    // If we had oversized diagrams, upload them now and patch the page body
    // to reference the attachments.
    if (pendingAttachments.length > 0) {
      const finalContent = await this.finalizePageAttachments(created.id, confluenceContent, pendingAttachments);
      try {
        await this.updatePageRaw(created.id, title, finalContent, created.version?.number || 1);
        console.log(`[ConfluenceService] ✅ Patched page "${title}" with ${pendingAttachments.length} attachment reference(s)`);
      } catch (err) {
        console.error(`[ConfluenceService] ⚠️ Failed to patch page with attachment references:`, err);
      }
    }

    return {
      id: created.id,
      title: created.title,
      url: pageUrl,
      spaceKey: spaceKey
    };
  }

  /**
   * Low-level page-body update used when we need to write already-converted
   * storage-format content (e.g. after swapping in attachment references).
   * Does NOT run the markdown→storage conversion again.
   */
  private async updatePageRaw(
    pageId: string,
    title: string,
    storageContent: string,
    currentVersion: number
  ): Promise<void> {
    const payload = {
      type: 'page',
      title,
      version: { number: currentVersion + 1 },
      body: { storage: { value: storageContent, representation: 'storage' } },
    };
    await this.request<any>(`/content/${pageId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Update an existing Confluence page
   */
  async updatePage(
    pageId: string,
    title: string,
    content: string,
    version: number
  ): Promise<ConfluencePageResult> {
    // Convert content to Confluence Storage Format (HTML)
    // This will also convert Mermaid diagrams to SVG
    const pendingAttachments: Array<{ id: string; filename: string; svg: string }> = [];
    let confluenceContent = await this.convertToConfluenceFormat(content, title, pendingAttachments);

    // Upload attachments BEFORE the page update so references resolve correctly.
    if (pendingAttachments.length > 0) {
      confluenceContent = await this.finalizePageAttachments(pageId, confluenceContent, pendingAttachments);
    }

    const payload = {
      type: 'page',
      title: title,
      version: {
        number: version + 1
      },
      body: {
        storage: {
          value: confluenceContent,
          representation: 'storage'
        }
      }
    };

    console.log(`[ConfluenceService] Updating page: "${title}" (ID: ${pageId})`);

    const updated = await this.request<any>(`/content/${pageId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    const pageUrl = `${this.config.instanceUrl}/wiki${updated._links.webui}`;

    console.log(`[ConfluenceService] ✅ Updated page: "${title}" (ID: ${pageId})`);

    return {
      id: updated.id,
      title: updated.title,
      url: pageUrl,
      spaceKey: this.config.spaceKey
    };
  }

  /**
   * Check if a page exists by title
   */
  async findPageByTitle(title: string): Promise<ConfluencePageResult | null> {
    try {
      const spaceKey = this.config.spaceKey;
      const response = await this.request<{ results: any[] }>(
        `/content?spaceKey=${spaceKey}&title=${encodeURIComponent(title)}&expand=version`
      );

      if (response.results && response.results.length > 0) {
        const page = response.results[0];
        return {
          id: page.id,
          title: page.title,
          url: `${this.config.instanceUrl}/wiki${page._links.webui}`,
          spaceKey: spaceKey
        };
      }

      return null;
    } catch (error) {
      console.error(`[ConfluenceService] Error finding page by title:`, error);
      return null;
    }
  }

  /**
   * Push multiple wiki pages to Confluence
   * Similar to ADO's pushWikiPages but for Confluence
   */
  async pushPages(pages: ConfluencePage[], onProgress?: (step: string, progress: number) => void): Promise<{ pagesCreated: number; pagesUpdated: number; pagesSucceeded: number; confluenceUrl?: string; errors: string[]; pageUrls: string[]; succeededWikiIds: string[] }> {
    console.log(`[ConfluenceService] 🚀 Starting pushPages for space: ${this.config.spaceKey}`);
    console.log(`[ConfluenceService] Total pages to push: ${pages.length}`);

    if (!this.config.spaceKey || this.config.spaceKey.trim() === '') {
      throw new Error('Confluence space key is missing or invalid');
    }

    const pageUrls: string[] = [];
    const errors: string[] = [];
    let pagesCreated = 0;
    let pagesUpdated = 0;
    const succeededWikiIds: string[] = [];

    // Ensure space exists - create if it doesn't exist
    try {
      await this.ensureSpaceExists(this.config.spaceKey, this.config.spaceKey);
      console.log(`[ConfluenceService] ✅ Space "${this.config.spaceKey}" is ready`);
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[ConfluenceService] ⚠️ Cannot access space "${this.config.spaceKey}": ${errorMsg}`);
      console.log(`[ConfluenceService] Attempting to create space "${this.config.spaceKey}"...`);

      try {
        // Try to create the space
        await this.createSpace(this.config.spaceKey, this.config.spaceKey, `Space created automatically for project`);
        console.log(`[ConfluenceService] ✅ Successfully created space "${this.config.spaceKey}"`);
      } catch (createError: any) {
        const createErrorMsg = createError instanceof Error ? createError.message : String(createError);
        console.error(`[ConfluenceService] ❌ Failed to create space "${this.config.spaceKey}":`, createErrorMsg);

        // Check if space already exists (409 Conflict)
        if (createErrorMsg.includes('409') || createErrorMsg.includes('already exists')) {
          console.log(`[ConfluenceService] Space "${this.config.spaceKey}" already exists, continuing...`);
          // Try to access it again
          try {
            await this.ensureSpaceExists(this.config.spaceKey, this.config.spaceKey);
            console.log(`[ConfluenceService] ✅ Space "${this.config.spaceKey}" is now accessible`);
          } catch (retryError) {
            throw new Error(`Cannot access Confluence space "${this.config.spaceKey}" even after creation attempt. Please verify:\n1. Confluence is enabled for your Jira instance\n2. Your API token has Confluence permissions\n3. Your credentials are correct`);
          }
        } else {
          throw new Error(`Cannot access or create Confluence space "${this.config.spaceKey}": ${createErrorMsg}\n\nPlease verify:\n1. Confluence is enabled for your Jira instance\n2. Your API token has Confluence permissions to create spaces\n3. Your credentials are correct`);
        }
      }
    }

    // Get space home page as parent
    const parentPageId = await this.getSpaceHomePageId(this.config.spaceKey);
    if (parentPageId) {
      console.log(`[ConfluenceService] Using space home page as parent: ${parentPageId}`);
    }

    // Helper function to add delay for rate limiting
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Process pages in order
    for (let i = 0; i < pages.length; i++) {
        if (onProgress) {
          onProgress("Pushing Confluence Page " + (i + 1) + " of " + pages.length + " (" + pages[i].title + ")...", Math.floor(((i + 1) / Math.max(1, pages.length)) * 100));
        }
      const page = pages[i];

      try {
        // Space should already be verified at the start, but double-check for first page
        if (i === 0) {
          try {
            await this.ensureSpaceExists(this.config.spaceKey, this.config.spaceKey);
          } catch (spaceError: any) {
            // If space access fails, we can't proceed
            const errorMsg = spaceError instanceof Error ? spaceError.message : String(spaceError);
            throw new Error(`Cannot access Confluence space "${this.config.spaceKey}": ${errorMsg}`);
          }
        }

        // Check if page already exists
        const existingPage = await this.findPageByTitle(page.title);

        if (existingPage) {
          // Update existing page
          // First, get current version
          const currentPage = await this.request<any>(`/content/${existingPage.id}?expand=version`);
          const updated = await this.updatePage(
            existingPage.id,
            page.title,
            page.content,
            currentPage.version.number
          );

          pageUrls.push(updated.url);
          pagesUpdated++;
          if (page.id) succeededWikiIds.push(page.id);
          console.log(`[ConfluenceService] ✅ Updated existing page: "${page.title}"`);
        } else {
          // Create new page
          const created = await this.createPage(
            page.title,
            page.content,
            parentPageId || undefined
          );

          pageUrls.push(created.url);
          pagesCreated++;
          if (page.id) succeededWikiIds.push(page.id);
          console.log(`[ConfluenceService] ✅ Created new page: "${page.title}"`);
        }

        // Small delay to avoid rate limiting
        if (i < pages.length - 1) {
          await delay(200);
        }
      } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[ConfluenceService] ❌ Failed to push page "${page.title}":`, errorMsg);

        // If it's a 401/403, it's an authentication/authorization issue - can't proceed
        // Don't try to create space automatically (similar to ADO - use existing spaces only)
        if (errorMsg.includes('401') || errorMsg.includes('Unauthorized') || errorMsg.includes('403') || errorMsg.includes('Forbidden')) {
          errors.push(`Page "${page.title}": Cannot access Confluence space "${this.config.spaceKey}". Please verify:\n1. The space exists in Confluence\n2. Your API token has access to this space\n3. Your credentials are correct`);
        } else {
          errors.push(`Page "${page.title}": ${errorMsg}`);
        }
      }
    }

    const pagesSucceeded = pagesCreated + pagesUpdated;
    const confluenceUrl = `${this.config.instanceUrl}/wiki/spaces/${this.config.spaceKey}`;

    console.log(`[ConfluenceService] ✅ Completed pushPages: ${pagesCreated} created, ${pagesUpdated} updated, ${errors.length} errors`);

    return {
      pagesCreated,
      pagesUpdated,
      pagesSucceeded,
      confluenceUrl,
      errors,
      pageUrls,
      succeededWikiIds,
    };
  }
}

