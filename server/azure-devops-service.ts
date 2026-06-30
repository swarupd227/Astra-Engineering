import { Epic, Feature, UserStory, Persona } from "@shared/schema";

export interface AzureConfig {
  organization: string;
  project: string;
  pat: string;
}

interface WorkItemCreateRequest {
  op: string;
  path: string;
  value: any;
}

export interface ResolvedIdentity {
  displayName: string;
  uniqueName: string;
  descriptor?: string;
  mailAddress?: string;
  id?: string;
}

interface IdentityCacheEntry {
  identity: ResolvedIdentity | null;
  timestamp: number;
}

const IDENTITY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class AzureDevOpsService {
  private baseUrl: string;
  private headers: Record<string, string>;
  private organization: string;
  private project: string;
  private static readonly MAX_TITLE_LENGTH = 255;
  private static identityCache: Map<string, IdentityCacheEntry> = new Map();

  // Default placeholder persona for stories without persona assignment
  private static readonly DEFAULT_PERSONA: Persona = {
    id: 'default-persona',
    name: 'System User',
    role: 'End User',
    color: '#6B7280',
    focus: 'General system usage',
    goals: ['Complete tasks efficiently'],
    painPoints: ['None specified']
  };

  constructor(config: AzureConfig) {
    // Extract organization name from URL if a full URL was provided
    let orgName = config.organization;
    if (orgName.includes('dev.azure.com')) {
      const match = orgName.match(/dev\.azure\.com\/([^\/]+)/);
      if (match) {
        orgName = match[1];
        console.log('[Azure DevOps] Extracted organization name from URL:', orgName);
      }
    } else if (orgName.includes('visualstudio.com')) {
      const match = orgName.match(/([^\.]+)\.visualstudio\.com/);
      if (match) {
        orgName = match[1];
        console.log('[Azure DevOps] Extracted organization name from URL:', orgName);
      }
    }
    // Remove any trailing slashes
    orgName = orgName.replace(/\/+$/, '');

    this.organization = orgName;
    this.project = config.project;
    this.baseUrl = `https://dev.azure.com/${orgName}/${config.project}/_apis`;

    // Azure DevOps uses Basic authentication with PAT
    // The username part should be empty, followed by colon and PAT
    const authToken = Buffer.from(`:${config.pat}`).toString('base64');
    this.headers = {
      'Content-Type': 'application/json-patch+json',
      'Authorization': `Basic ${authToken}`,
      'Accept': 'application/json'
    };

    console.log('[Azure DevOps] Initializing service for org:', this.organization, 'project:', config.project);
    console.log('[Azure DevOps] PAT token configured:', !!config.pat);
    console.log('[Azure DevOps] Base URL:', this.baseUrl);
  }

  /**
 * Resolve a display name or partial name to a proper Azure DevOps identity
 * Uses caching to avoid repeated API calls for the same names
 */

  /**
   * Truncates a title to Azure DevOps maximum length (255 characters)
   * Adds ellipsis if truncated
   */
  public truncateTitle(title: string): string {
    if (!title) return '';
    if (title.length <= AzureDevOpsService.MAX_TITLE_LENGTH) return title;

    const truncated = title.substring(0, AzureDevOpsService.MAX_TITLE_LENGTH - 3) + '...';
    console.warn(`[Azure DevOps] Title truncated from ${title.length} to ${truncated.length} characters`);
    return truncated;
  }

  /**
   * Formats text content to convert bullet points and numbered lists to HTML
   * Handles both line-by-line lists and inline lists (on same line)
   */
  private formatListsInText(text: string): string {
    if (!text) return '';

    // First, handle inline lists (bullets/numbers on the same line separated by spaces)
    // Pattern: "• item1 • item2 • item3" or "1. item1 2. item2 3. item3"
    
    // Check for inline bullet lists (•, -, or * separated by spaces)
    // Match pattern: bullet marker followed by text, repeated multiple times
    const inlineBulletPattern = /((?:[•\-\*]\s+[^•\-\*\n\d]+(?:\s+[•\-\*]\s+[^•\-\*\n\d]+)+))/g;
    text = text.replace(inlineBulletPattern, (match) => {
      // Split by bullet markers, keeping the markers to identify items
      const parts = match.split(/([•\-\*]\s+)/);
      const items: string[] = [];
      let currentItem = '';
      
      for (let i = 0; i < parts.length; i++) {
        if (/^[•\-\*]\s+$/.test(parts[i])) {
          // This is a bullet marker - save previous item and start new one
          if (currentItem.trim()) {
            items.push(currentItem.trim());
          }
          currentItem = '';
        } else if (parts[i].trim()) {
          currentItem += parts[i];
        }
      }
      if (currentItem.trim()) {
        items.push(currentItem.trim());
      }
      
      if (items.length > 1) {
        return '<ul>' + items.map(item => `<li>${item}</li>`).join('') + '</ul>';
      }
      return match;
    });

    // Check for inline numbered lists (1. item1 2. item2 3. item3)
    // Find sequences of "number. text" patterns and convert to ordered list
    // Pattern: matches sequences like "1. text 2. text 3. text"
    const inlineNumberedPattern = /((?:\d+\.\s+[^\d\n]+(?:\s+\d+\.\s+[^\d\n]+){1,}))/g;
    text = text.replace(inlineNumberedPattern, (match) => {
      // Extract all numbered items from the match
      const items: string[] = [];
      const itemPattern = /(\d+)\.\s+([^\d\n]+?)(?=\s+\d+\.\s+|$)/g;
      let itemMatch;
      
      while ((itemMatch = itemPattern.exec(match)) !== null) {
        items.push(itemMatch[2].trim());
      }
      
      // Also check for the last item if pattern didn't capture it
      const lastItemMatch = match.match(/(\d+)\.\s+([^\d\n]+)$/);
      if (lastItemMatch && items.length > 0) {
        const lastItemText = lastItemMatch[2].trim();
        // Only add if it's different from the last item we already have
        if (items[items.length - 1] !== lastItemText) {
          items.push(lastItemText);
        }
      }
      
      if (items.length > 1) {
        return '<ol>' + items.map(item => `<li>${item}</li>`).join('') + '</ol>';
      }
      return match;
    });

    // Now handle line-by-line lists
    const lines = text.split(/\n/);
    const formattedLines: string[] = [];
    let inBulletList = false;
    let inNumberedList = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) {
        // Empty line - close any open lists
        if (inBulletList) {
          formattedLines.push('</ul>');
          inBulletList = false;
        }
        if (inNumberedList) {
          formattedLines.push('</ol>');
          inNumberedList = false;
        }
        continue;
      }

      // Skip if line already contains HTML list tags (from inline processing)
      if (line.includes('<ul>') || line.includes('<ol>')) {
        // Close any open lists before adding new list
        if (inBulletList) {
          formattedLines.push('</ul>');
          inBulletList = false;
        }
        if (inNumberedList) {
          formattedLines.push('</ol>');
          inNumberedList = false;
        }
        formattedLines.push(line);
        continue;
      }

      // Check for bullet point (• or - at start of line)
      const bulletMatch = line.match(/^[•\-\*]\s+(.+)$/);
      if (bulletMatch) {
        if (inNumberedList) {
          formattedLines.push('</ol>');
          inNumberedList = false;
        }
        if (!inBulletList) {
          formattedLines.push('<ul>');
          inBulletList = true;
        }
        formattedLines.push(`<li>${bulletMatch[1]}</li>`);
        continue;
      }

      // Check for numbered list (1., 2., 3., etc. at start of line)
      const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
      if (numberedMatch) {
        if (inBulletList) {
          formattedLines.push('</ul>');
          inBulletList = false;
        }
        if (!inNumberedList) {
          formattedLines.push('<ol>');
          inNumberedList = true;
        }
        formattedLines.push(`<li>${numberedMatch[2]}</li>`);
        continue;
      }

      // Regular text line
      // Close any open lists before adding regular text
      if (inBulletList) {
        formattedLines.push('</ul>');
        inBulletList = false;
      }
      if (inNumberedList) {
        formattedLines.push('</ol>');
        inNumberedList = false;
      }
      formattedLines.push(line);
    }

    // Close any remaining open lists
    if (inBulletList) {
      formattedLines.push('</ul>');
    }
    if (inNumberedList) {
      formattedLines.push('</ol>');
    }

    return formattedLines.join('');
  }

  /**
   * Formats description text for Azure DevOps by making capitalized headings bold,
   * placing them on new lines, adding gaps before their content, and formatting lists
   */
  private formatDescriptionForADO(description: string): string {
    if (!description) return '';

    // Split by common heading patterns first to handle the text better
    // Pattern to match capitalized headings (all caps text ending with colon)
    // Examples: "CONTEXT & BACKGROUND:", "CURRENT STATE:", "KEY FUNCTIONALITY:"
    const headingPattern = /([A-Z][A-Z\s&]{2,}:)/g;
    
    const parts: Array<{ type: 'text' | 'heading'; content: string; heading?: string }> = [];
    let lastIndex = 0;
    let match;
    
    // Find all headings and split the text
    while ((match = headingPattern.exec(description)) !== null) {
      const index = match.index;
      const heading = match[1].trim();
      
      // Verify it's a standalone heading
      const beforeChar = index > 0 ? description[index - 1] : '';
      const isValidHeading = index === 0 || /\s/.test(beforeChar) || beforeChar === '\n';
      
      if (isValidHeading && heading.length >= 3) {
        // Add text before heading
        if (index > lastIndex) {
          const textBefore = description.substring(lastIndex, index).trim();
          if (textBefore) {
            parts.push({ type: 'text', content: textBefore });
          }
        }
        
        // Add heading
        parts.push({ type: 'heading', content: heading, heading: heading });
        lastIndex = match.index + match[0].length;
      }
    }
    
    // Add remaining text after last heading
    if (lastIndex < description.length) {
      const remainingText = description.substring(lastIndex).trim();
      if (remainingText) {
        parts.push({ type: 'text', content: remainingText });
      }
    }
    
    // If no headings found, return original with list formatting
    if (parts.length === 0 || parts.every(p => p.type === 'text')) {
      return this.formatListsInText(description);
    }
    
    // Build formatted HTML
    const formattedParts: string[] = [];
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      
      if (part.type === 'heading') {
        // Add blank line before every heading (after content or after another heading)
        if (i > 0) {
          formattedParts.push('<br/>');
          formattedParts.push('<br/>');
        }
        
        // Bold heading, then blank line before content (line gap between heading and content)
        formattedParts.push(`<strong>${part.heading}</strong><br/>`);
        formattedParts.push('<br/>');
      } else {
        // Format text content (including lists); gap after content is added before next heading
        const textContent = part.content.trim();
        if (textContent) {
          const formattedText = this.formatListsInText(textContent);
          formattedParts.push(formattedText);
        }
      }
    }
    
    return formattedParts.join('');
  }

  /**
   * Converts test case steps to Azure DevOps XML format for the Steps field
   * ADO uses a specific XML schema for test case steps
   */
  public formatTestCaseStepsXml(steps: any[]): string {
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      console.warn(`[Azure DevOps] No steps provided for test case, creating empty step`);
      return '<steps id="0" last="1"><step id="1" type="ActionStep"><parameterizedString isformatted="true"></parameterizedString><parameterizedString isformatted="true"></parameterizedString></step></steps>';
    }

    console.log(`[Azure DevOps] Formatting ${steps.length} steps for test case XML`);

    const stepElements = steps.map((step: any, idx: number) => {
      let action = '';
      let expected = '';

      if (typeof step === 'string') {
        action = step;
        expected = '';
        console.log(`[Azure DevOps] Step ${idx + 1}: String format - action="${action.substring(0, 50)}..."`);
      } else if (typeof step === 'object' && step !== null) {
        // Support new format: step, action, result (from prompt_professional_artifacts.ts)
        // Priority: action > Action > step > Steps > description
        action = step.action || step.Action || step.step || step.Steps || step.description || '';
        // Priority: result > expectedResult > expectedResults > expected > Expected Results > Expected Result
        expected = step.result || step.expectedResult || step.expectedResults || step.expected || step['Expected Results'] || step['Expected Result'] || '';

        console.log(`[Azure DevOps] Step ${idx + 1}: Object format - action="${action.substring(0, 50)}..." expected="${expected.substring(0, 50)}..."`);

        // Debug log if we couldn't extract action/expected
        if (!action && !expected) {
          console.warn(`[Azure DevOps] ⚠️ Could not extract action/result from step:`, JSON.stringify(step, null, 2));
        } else if (!action) {
          console.warn(`[Azure DevOps] ⚠️ Step ${idx + 1} has expected result but no action`);
        } else if (!expected) {
          console.warn(`[Azure DevOps] ⚠️ Step ${idx + 1} has action but no expected result`);
        }
      } else {
        console.warn(`[Azure DevOps] ⚠️ Step ${idx + 1} is neither string nor object:`, typeof step, step);
      }

      // Escape HTML entities for XML (with defensive String cast)
      const escapeXml = (str: any) => String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

      const escapedAction = escapeXml(action);
      const escapedExpected = escapeXml(expected);

      // Azure DevOps expects text directly in parameterizedString, not wrapped in <p> tags
      // Format: <step id="N" type="ActionStep">
      //          <parameterizedString isformatted="true">Action text</parameterizedString>
      //          <parameterizedString isformatted="true">Expected result text</parameterizedString>
      //        </step>
      const stepXml = `<step id="${idx + 1}" type="ActionStep"><parameterizedString isformatted="true">${escapedAction}</parameterizedString><parameterizedString isformatted="true">${escapedExpected}</parameterizedString></step>`;

      // Log each step for debugging
      if (idx < 2) { // Log first 2 steps for debugging
        console.log(`[Azure DevOps] Step ${idx + 1} XML:`, stepXml);
        console.log(`[Azure DevOps] Step ${idx + 1} - Action: "${action}" (${action.length} chars), Expected: "${expected}" (${expected.length} chars)`);
      }

      return stepXml;
    }).join('');

    const xml = `<steps id="0" last="${steps.length}">${stepElements}</steps>`;
    console.log(`[Azure DevOps] Generated steps XML (first 500 chars):`, xml.substring(0, 500));
    return xml;
  }

  /**
   * Creates a Test Case work item and links it to a User Story
   */
  async createTestCase(testCase: any, storyId: number, storyTitle: string, assignedTo?: string): Promise<number> {
    const title = testCase.title || testCase.scenario || 'Test Case';
    // Support multiple field name variations for steps
    const steps = testCase.steps || testCase.testCaseSteps || [];

    // Debug logging to trace step data
    console.log(`[Azure DevOps] ===== Creating Test Case =====`);
    console.log(`[Azure DevOps] Test Case title: ${title}`);
    console.log(`[Azure DevOps] Test Case raw object:`, JSON.stringify(testCase, null, 2));
    console.log(`[Azure DevOps] Test Case steps raw data:`, JSON.stringify(steps, null, 2));
    console.log(`[Azure DevOps] Test Case steps count: ${steps.length}`);
    console.log(`[Azure DevOps] Test Case steps type: ${Array.isArray(steps) ? 'array' : typeof steps}`);

    if (!Array.isArray(steps)) {
      console.error(`[Azure DevOps] ❌ Steps is not an array! Type: ${typeof steps}, Value:`, steps);
      throw new Error(`Test case steps must be an array, got ${typeof steps}`);
    }

    const stepsXml = this.formatTestCaseStepsXml(steps);
    console.log(`[Azure DevOps] Generated steps XML length: ${stepsXml.length} characters`);
    console.log(`[Azure DevOps] Generated steps XML (full):`, stepsXml);

    // Build description including any top-level expectedResult
    let description = `<div>Test case for: ${storyTitle}</div>`;
    if (testCase.expectedResult) {
      description += `<br/><div><strong>Expected Result:</strong> ${testCase.expectedResult}</div>`;
    }

    console.log(`[Azure DevOps] Creating Test Case: ${title}`);
    console.log(`[Azure DevOps] Sending to Azure DevOps API:`, {
      title: this.truncateTitle(title),
      stepsXmlPreview: stepsXml.substring(0, 300) + '...',
      stepsXmlLength: stepsXml.length
    });

    const testCaseId = await this.createWorkItem('Test Case', {
      'System.Title': this.truncateTitle(title),
      'System.Description': description,
      'Microsoft.VSTS.TCM.Steps': stepsXml,
      'System.AssignedTo': null, // Explicitly leave unassigned
    });

    // Link test case as child to user story using Hierarchy-Reverse relationship
    // Link from test case to story using Hierarchy-Reverse to make test case a child of the story
    await this.linkWorkItems(testCaseId, storyId, 'System.LinkTypes.Hierarchy-Reverse');

    console.log(`[Azure DevOps] ✅ Test Case ${testCaseId} created and linked as child to User Story ${storyId}`);
    return testCaseId;
  }

  public async createWorkItem(type: string, fields: Record<string, any>): Promise<number> {
    const url = `${this.baseUrl}/wit/workitems/$${type}?api-version=7.0`;

    // Filter out null values to avoid setting fields we want to leave unassigned
    const operations: WorkItemCreateRequest[] = Object.entries(fields)
      .filter(([_, value]) => value !== null && value !== undefined)
      .map(([key, value]) => ({
        op: 'add',
        path: `/fields/${key}`,
        value
      }));

    console.log(`[Azure DevOps] Creating ${type} with URL:`, url);
    console.log(`[Azure DevOps] Operations:`, JSON.stringify(operations, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(operations)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to create ${type}:`, response.status, errorText);

      // Parse error response to check for specific error codes
      let errorMessage = '';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorText;
      } catch {
        errorMessage = errorText;
      }

      // Provide helpful error messages
      if (response.status === 401) {
        throw new Error(`Authentication failed (401). Please verify:
1. Your PAT token is valid and not expired
2. The token has "Work Items (Read, Write & Manage)" permissions
3. The organization name "${this.organization}" is correct
4. You have access to the project "${this.project}"`);
      } else if (response.status === 404) {
        // Check if it's a work item type issue vs project not found
        if (errorMessage.includes('WorkItemTypeNotFoundException') ||
          errorMessage.includes('Work item type') && errorMessage.includes('does not exist')) {
          throw new Error(`Work item type "${type}" does not exist in project "${this.project}" (${this.organization}). 

This usually means:
1. The project uses a process template that doesn't include "${type}" work items
2. The work item type hasn't been enabled in the project settings
3. Your process template (e.g., Basic, Agile, Scrum) may not support this work item type

Please verify in Azure DevOps:
- Go to Project Settings > Work Items > Process
- Check if "${type}" is available in your process template
- If not, you may need to use a different work item type or switch to a process template that supports "${type}"`);
        } else {
          throw new Error(`Project not found (404). Please verify:
1. Organization "${this.organization}" exists
2. Project "${this.project}" exists
3. You have access to this project`);
        }
      } else if (response.status === 203) {
        throw new Error(`Non-authoritative information (203). The organization or project may not exist or PAT doesn't have access.`);
      }

      throw new Error(`Failed to create ${type}: ${response.status} - ${errorMessage}`);
    }

    const result = await response.json();
    console.log(`[Azure DevOps] Full response for ${type}:`, JSON.stringify(result, null, 2));
    console.log(`[Azure DevOps] Successfully created ${type} with ID:`, result.id, 'URL:', result.url);

    // Verify the item was actually created by checking it exists
    if (result.id) {
      console.log(`[Azure DevOps] ✅ Confirmed ${type} created - ID: ${result.id}, URL: ${result.url}`);
    } else {
      console.error(`[Azure DevOps] ❌ ERROR: ${type} response missing ID!`, result);
    }

    return result.id;
  }

  async createEpic(epic: Epic): Promise<number> {
    return this.createWorkItem('Epic', {
      'System.Title': this.truncateTitle(epic.title),
      'System.Description': epic.description,
    });
  }

  async createFeature(feature: Feature, epicId?: number): Promise<number> {
    const featureId = await this.createWorkItem('Feature', {
      'System.Title': this.truncateTitle(feature.title),
      'System.Description': feature.description,
    });

    // Link feature to epic only if epicId is provided
    if (epicId) {
      await this.linkWorkItems(featureId, epicId, 'System.LinkTypes.Hierarchy-Reverse');
    }

    return featureId;
  }

  async createUserStory(
    story: UserStory,
    featureId: number | undefined,
    persona: Persona,
    createSubtasks: boolean = true
  ): Promise<{ storyId: number; testCasesCreated: number; subtasksCreated: number; testCaseIds: number[]; subtaskIds: number[] }> {
    // Build acceptance criteria text for the AC field (HTML format for Azure DevOps)
    // Format as simple descriptive text without Given/When/Then structure
    const acceptanceCriteriaHtml = story.acceptanceCriteria
      .map((ac, i) => {
        // If it's a string, use it directly
        if (typeof ac === 'string') {
          return `<div><strong>Criteria ${i + 1}:</strong> ${ac}</div><br/>`;
        }

        // If it's an object, use title or description, or combine all text fields
        let description = '';
        const acObj = ac as any;
        if (acObj.title && typeof acObj.title === 'string' && acObj.title.trim() && acObj.title !== 'undefined') {
          description = acObj.title;
        } else if (acObj.description && typeof acObj.description === 'string' && acObj.description.trim() && acObj.description !== 'undefined') {
          description = acObj.description;
        } else {
          // Fallback: combine all text fields (excluding given/when/then/and structure)
          const textParts = [];
          if (acObj.title && typeof acObj.title === 'string' && acObj.title.trim() && acObj.title !== 'undefined') textParts.push(acObj.title);
          if (acObj.description && typeof acObj.description === 'string' && acObj.description.trim() && acObj.description !== 'undefined') textParts.push(acObj.description);
          description = textParts.join(' ') || `Acceptance Criterion ${i + 1}`;
        }

        return `<div><strong>Criteria ${i + 1}:</strong> ${description}</div><br/>`;
      })
      .join('');

    // Build description - story description and persona info only (test cases created separately)
    // Format the description to make capitalized headings bold with proper spacing
    const formattedDescription = this.formatDescriptionForADO(story.description);
    const description = `<div>${formattedDescription}</div><br/><div><strong>Persona:</strong> ${persona.name} (${persona.role})</div>`;

    const storyId = await this.createWorkItem('User Story', {
      'System.Title': this.truncateTitle(story.title),
      'System.Description': description,
      'Microsoft.VSTS.Common.AcceptanceCriteria': acceptanceCriteriaHtml,
      'Microsoft.VSTS.Scheduling.StoryPoints': story.storyPoints,
      'Microsoft.VSTS.Common.Priority': story.priority === 'High' ? 1 : story.priority === 'Medium' ? 2 : 3,
    });

    // Link story to feature only if featureId is provided
    if (featureId) {
      await this.linkWorkItems(storyId, featureId, 'System.LinkTypes.Hierarchy-Reverse');
    }

    let subtasksCreated = 0;
    const subtaskIds: number[] = [];
    // Create subtasks as Task work items and link them as children
    const storyAny = story as any;
    const subtasks = storyAny.subtasks || story.subtasks || [];

    console.log(`[Azure DevOps] Checking for subtasks in user story "${story.title}"...`);
    console.log(`[Azure DevOps] Subtasks found:`, subtasks ? (Array.isArray(subtasks) ? `${subtasks.length} items` : `Not an array (type: ${typeof subtasks})`) : 'null/undefined');
    console.log(`[Azure DevOps] Subtasks data:`, JSON.stringify(subtasks, null, 2));

    if (createSubtasks && subtasks && Array.isArray(subtasks) && subtasks.length > 0) {
      console.log(`[Azure DevOps] ✅ Creating ${subtasks.length} subtasks for User Story ${storyId}`);

      for (let i = 0; i < subtasks.length; i++) {
        const subtask = subtasks[i];
        // Handle both string and object formats
        const subtaskTitle = typeof subtask === 'string' ? subtask : (subtask.title || subtask.description || `Subtask ${i + 1}`);

        try {
          console.log(`[Azure DevOps] Processing subtask ${i + 1}/${subtasks.length}: ${subtaskTitle.substring(0, 50)}...`);
          // Create Task work item for each subtask - with truncated title
          const taskId = await this.createWorkItem('Task', {
            'System.Title': this.truncateTitle(subtaskTitle),
            'System.Description': typeof subtask === 'object' && subtask.description
              ? subtask.description
              : `Subtask for: ${story.title}`,
            'Microsoft.VSTS.Common.Priority': story.priority === 'High' ? 1 : story.priority === 'Medium' ? 2 : 3,
          });

          // Link task as child to user story
          // Using System.LinkTypes.Hierarchy-Reverse to make the task a child of the user story
          await this.linkWorkItems(taskId, storyId, 'System.LinkTypes.Hierarchy-Reverse');

          subtasksCreated++;
          subtaskIds.push(taskId);
          console.log(`[Azure DevOps] ✅ Created and linked subtask ${taskId} to story ${storyId}: ${subtaskTitle.substring(0, 50)}...`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[Azure DevOps] ❌ Failed to create subtask ${i + 1}/${subtasks.length}: ${subtaskTitle}`, errorMsg);
          // Continue with other subtasks even if one fails
        }
      }
    } else {
      console.log(`[Azure DevOps] ⚠️ No subtasks to create for User Story ${storyId}`);
      if (subtasks && !Array.isArray(subtasks)) {
        console.error(`[Azure DevOps] ⚠️ Subtasks is not an array! Type: ${typeof subtasks}, Value:`, subtasks);
      }
    }

    let testCasesCreated = 0;
    const testCaseIds: number[] = [];
    // Create Test Cases as separate work items and link them to the story
    const testCases = (story as any).testCases;
    console.log(`[Azure DevOps] Checking for test cases in user story "${story.title}"...`);
    console.log(`[Azure DevOps] Test cases found:`, testCases ? (Array.isArray(testCases) ? `${testCases.length} items` : `Not an array (type: ${typeof testCases})`) : 'null/undefined');

    if (testCases && Array.isArray(testCases) && testCases.length > 0) {
      console.log(`[Azure DevOps] ✅ Creating ${testCases.length} test cases for User Story ${storyId}`);
      console.log(`[Azure DevOps] Test cases data:`, JSON.stringify(testCases, null, 2));

      for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        try {
          console.log(`[Azure DevOps] Processing test case ${i + 1}/${testCases.length}:`, testCase.title || testCase.scenario || 'Untitled');
          const testCaseId = await this.createTestCase(testCase, storyId, story.title);
          testCasesCreated++;
          testCaseIds.push(testCaseId);
          console.log(`[Azure DevOps] ✅ Successfully created test case ${i + 1}/${testCases.length}`);
        } catch (error) {
          console.error(`[Azure DevOps] ❌ Failed to create test case ${i + 1}/${testCases.length}: ${testCase.title || testCase.scenario}`, error);
          // Continue with other test cases even if one fails
        }
      }
    } else {
      console.log(`[Azure DevOps] ⚠️ No test cases to create for User Story ${storyId}`);
      if (testCases && !Array.isArray(testCases)) {
        console.error(`[Azure DevOps] ⚠️ Test cases is not an array! Type: ${typeof testCases}, Value:`, testCases);
      }
    }

    return { storyId, testCasesCreated, subtasksCreated, testCaseIds, subtaskIds };
  }

  async createTaskForStory(
    title: string,
    description: string,
    priority: number,
    parentStoryId: number
  ): Promise<number> {
    const taskId = await this.createWorkItem('Task', {
      'System.Title': this.truncateTitle(title),
      'System.Description': description,
      'Microsoft.VSTS.Common.Priority': priority,
    });

    await this.linkWorkItems(taskId, parentStoryId, 'System.LinkTypes.Hierarchy-Reverse');
    return taskId;
  }

  private async linkWorkItems(sourceId: number, targetId: number, linkType: string): Promise<void> {
    const url = `${this.baseUrl}/wit/workitems/${sourceId}?api-version=7.0`;

    const operation = [{
      op: 'add',
      path: '/relations/-',
      value: {
        rel: linkType,
        url: `${this.baseUrl.replace('/_apis', '')}/_apis/wit/workitems/${targetId}`,
      }
    }];

    console.log(`[Azure DevOps] Linking work items: ${sourceId} -> ${targetId} with type: ${linkType}`);

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(operation)
    });

    if (!response.ok) {
      const errorText = await response.text();
      const errorMsg = `Failed to link work items ${sourceId} -> ${targetId} (${linkType}): ${response.status} - ${errorText}`;
      console.error(`[Azure DevOps] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    console.log(`[Azure DevOps] ✅ Successfully linked work items ${sourceId} -> ${targetId} with type: ${linkType}`);
  }

  private parseTestCaseToStep(testCase: string): { action: string; expectedResult: string } {
    const givenMatch = testCase.match(/GIVEN\s+(.+?)(?:\s+WHEN|$)/i);
    const whenMatch = testCase.match(/WHEN\s+(.+?)(?:\s+THEN|$)/i);
    const thenMatch = testCase.match(/THEN\s+(.+?)$/i);

    let action = "";
    let expectedResult = "";

    if (givenMatch && givenMatch[1]) {
      action += `GIVEN ${givenMatch[1].trim()}`;
    }
    if (whenMatch && whenMatch[1]) {
      action += action ? ` WHEN ${whenMatch[1].trim()}` : `WHEN ${whenMatch[1].trim()}`;
    }
    if (thenMatch && thenMatch[1]) {
      expectedResult = thenMatch[1].trim();
    }

    // Fallback if parsing fails
    if (!action) {
      action = testCase;
    }
    if (!expectedResult) {
      expectedResult = "Verify expected behavior";
    }

    return { action, expectedResult };
  }

  /**
   * Escape special XML characters for Azure DevOps Steps field
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Build the XML steps format required by Azure DevOps Test Case
   * Format: <steps id="0" last="N"><step id="i" type="ValidateStep"><parameterizedString>Action</parameterizedString><parameterizedString>Expected</parameterizedString></step>...</steps>
   */
  private buildTestStepsXml(testCases: string[]): string {
    const lastStepId = testCases.length;
    let stepsXml = `<steps id="0" last="${lastStepId}">`;

    for (let i = 0; i < testCases.length; i++) {
      const { action, expectedResult } = this.parseTestCaseToStep(testCases[i]);
      const stepId = i + 1; // Step IDs are 1-based

      stepsXml += `<step id="${stepId}" type="ValidateStep">`;
      stepsXml += `<parameterizedString isformatted="true">${this.escapeXml(action)}</parameterizedString>`;
      stepsXml += `<parameterizedString isformatted="true">${this.escapeXml(expectedResult)}</parameterizedString>`;
      stepsXml += `</step>`;
    }

    stepsXml += `</steps>`;
    return stepsXml;
  }

  /**
   * Create a SINGLE consolidated Test Case work item containing all test cases as steps
   * @param testCases - Array of test cases in "Given, When, Then" format
   * @param userStoryId - The ID of the User Story to link to
   * @param storyTitle - Optional title of the story for naming the test case
   * @returns The ID of the created Test Case work item and any errors
   */
  async createTestCasesForStory(
    testCases: string[],
    userStoryId: number,
    storyTitle?: string
  ): Promise<{ testCaseIds: number[]; errors: string[] }> {
    const errors: string[] = [];

    if (!testCases || testCases.length === 0) {
      console.log(`[Azure DevOps] No test cases to create for User Story ${userStoryId}`);
      return { testCaseIds: [], errors: [] };
    }

    console.log(`[Azure DevOps] Creating consolidated Test Case with ${testCases.length} steps for User Story ${userStoryId}`);

    try {
      // Build title: "Test cases for [feature] or work item #[id]"
      const title = storyTitle
        ? `Test cases for ${storyTitle.substring(0, 80)} or work item #${userStoryId}`
        : `Test cases for work item #${userStoryId}`;

      // Build the XML steps structure
      const stepsXml = this.buildTestStepsXml(testCases);

      // Build description listing all test cases
      const descriptionHtml = `<div><strong>Test Cases (${testCases.length} total):</strong><ol>${testCases.map(tc => `<li>${this.escapeXml(tc)}</li>`).join('')}</ol></div>`;

      // Create the Test Case with steps
      const testCaseId = await this.createWorkItem('Test Case', {
        'System.Title': this.truncateTitle(title),
        'System.Description': descriptionHtml,
        'Microsoft.VSTS.TCM.Steps': stepsXml,
        'System.AssignedTo': null, // Explicitly leave unassigned
      });

      // Link Test Case as child to User Story using Hierarchy-Reverse relationship
      await this.linkWorkItems(testCaseId, userStoryId, 'System.LinkTypes.Hierarchy-Reverse');

      console.log(`[Azure DevOps] Created consolidated Test Case ${testCaseId} with ${testCases.length} steps, linked as child to User Story ${userStoryId}`);
      return { testCaseIds: [testCaseId], errors: [] };

    } catch (error) {
      const errorMsg = `Failed to create consolidated Test Case: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Azure DevOps] ${errorMsg}`);
      errors.push(errorMsg);
      return { testCaseIds: [], errors };
    }
  }

  /**
   * Create INDIVIDUAL test cases from structured data with category organization
   * Each test case becomes a separate Test Case work item linked as child to User Story
   * Supports parallel processing for performance
   * 
   * @param testCasesByCategory - Test cases grouped by category (core + extended types)
   * @param userStoryAdoId - Azure DevOps work item ID of parent user story
   * @param userStoryTitle - Title of user story (for logging and description)
   * @returns Results with ADO IDs and summary statistics by category
   */
  async createCategorizedTestCasesForStory(
    testCasesByCategory: {
      // Core test types
      functional?: Array<{
        id: string;
        title: string;
        priority: string;
        preconditions?: string[];
        steps?: Array<{ step: number; action: string; expectedResult: string }>;
        postconditions?: string[];
      }>;
      negative?: Array<{
        id: string;
        title: string;
        priority: string;
        preconditions?: string[];
        steps?: Array<{ step: number; action: string; expectedResult: string }>;
        postconditions?: string[];
      }>;
      edgeCases?: Array<{
        id: string;
        title: string;
        priority: string;
        preconditions?: string[];
        steps?: Array<{ step: number; action: string; expectedResult: string }>;
        postconditions?: string[];
      }>;
      accessibility?: Array<{
        id: string;
        title: string;
        priority: string;
        preconditions?: string[];
        steps?: Array<{ step: number; action: string; expectedResult: string }>;
        postconditions?: string[];
      }>;
      // Extended test types
      performance?: Array<{
        id: string;
        title: string;
        priority: string;
        preconditions?: string[];
        steps?: Array<{ step: number; action: string; expectedResult: string }>;
        postconditions?: string[];
      }>;
      security?: Array<{
        id: string;
        title: string;
        priority: string;
        preconditions?: string[];
        steps?: Array<{ step: number; action: string; expectedResult: string }>;
        postconditions?: string[];
      }>;
      usability?: Array<{
        id: string;
        title: string;
        priority: string;
        preconditions?: string[];
        steps?: Array<{ step: number; action: string; expectedResult: string }>;
        postconditions?: string[];
      }>;
      reliability?: Array<{
        id: string;
        title: string;
        priority: string;
        preconditions?: string[];
        steps?: Array<{ step: number; action: string; expectedResult: string }>;
        postconditions?: string[];
      }>;
    },
    userStoryAdoId: number,
    userStoryTitle: string
  ): Promise<{
    results: Array<{
      id: string;
      category: string;
      adoId: number | null;
      adoUrl: string | null;
      status: 'success' | 'failed';
      error?: string;
    }>;
    summary: {
      total: number;
      succeeded: number;
      failed: number;
      byCategory: {
        // Core test types
        functional: number;
        negative: number;
        edgeCases: number;
        accessibility: number;
        // Extended test types
        performance: number;
        security: number;
        usability: number;
        reliability: number;
      };
    };
  }> {
    console.log(`[ADO Test Cases] 🚀 Starting categorized test case creation for User Story #${userStoryAdoId}: "${userStoryTitle}"`);
    
    const results: Array<{
      id: string;
      category: string;
      adoId: number | null;
      adoUrl: string | null;
      status: 'success' | 'failed';
      error?: string;
    }> = [];
    
    const summary = {
      total: 0,
      succeeded: 0,
      failed: 0,
      byCategory: {
        // Core test types
        functional: 0,
        negative: 0,
        edgeCases: 0,
        accessibility: 0,
        // Extended test types
        performance: 0,
        security: 0,
        usability: 0,
        reliability: 0
      }
    };

    // Category configuration (core + extended)
    const categoryConfig = {
      // Core test types
      functional: { displayName: 'Functional', prefix: '[Functional]', tag: 'Functional' },
      negative: { displayName: 'Negative', prefix: '[Negative]', tag: 'Negative' },
      edgeCases: { displayName: 'Edge Cases', prefix: '[Edge Cases]', tag: 'Edge Cases' },
      accessibility: { displayName: 'Accessibility', prefix: '[Accessibility]', tag: 'Accessibility' },
      // Extended test types
      performance: { displayName: 'Performance', prefix: '[Performance]', tag: 'Performance' },
      security: { displayName: 'Security', prefix: '[Security]', tag: 'Security' },
      usability: { displayName: 'Usability', prefix: '[Usability]', tag: 'Usability' },
      reliability: { displayName: 'Reliability', prefix: '[Reliability]', tag: 'Reliability' }
    };

    // Helper function to process a single test case
    const processTestCase = async (testCase: any, config: any, categoryKey: string) => {
      try {
        console.log(`[ADO Test Cases] Processing ${config.displayName} test case: "${testCase.title}"`);
        
        // 1. Build title with category prefix
        const title = `${config.prefix} ${testCase.title}`;
        
        // 2. Build steps XML from structured steps
        const steps = testCase.steps || [];
        const stepsXml = this.buildStructuredTestStepsXml(steps);
        
        // 3. Build description with preconditions and postconditions
        const description = this.buildTestCaseDescriptionWithDetails(testCase, userStoryTitle);
        
        // 4. Build tags: Category + "Manual Test"
        const tags = `${config.tag}; Manual Test`;
        
        // 5. Map priority to ADO format (1=High, 2=Medium, 3=Low)
        const priority = this.mapPriorityToAdoFormat(testCase.priority);
        
        console.log(`[ADO Test Cases] Creating Test Case work item:`, {
          title: title.substring(0, 100),
          stepsCount: steps.length,
          priority,
          tags
        });
        
        // 6. Create Test Case work item
        const testCaseAdoId = await this.createWorkItem('Test Case', {
          'System.Title': this.truncateTitle(title),
          'System.Description': description,
          'Microsoft.VSTS.TCM.Steps': stepsXml,
          'Microsoft.VSTS.Common.Priority': priority,
          'System.Tags': tags,
        });
        
        console.log(`[ADO Test Cases] ✅ Test Case work item created: #${testCaseAdoId}`);
        
        // 7. Link to User Story as child
        await this.linkWorkItems(
          testCaseAdoId,
          userStoryAdoId,
          'System.LinkTypes.Hierarchy-Reverse'
        );
        
        console.log(`[ADO Test Cases] ✅ Test Case #${testCaseAdoId} linked as child to User Story #${userStoryAdoId}`);
        
        // 8. Build ADO URL
        const adoUrl = `https://dev.azure.com/${this.organization}/${this.project}/_workitems/edit/${testCaseAdoId}`;
        
        return {
          id: testCase.id,
          category: config.displayName,
          adoId: testCaseAdoId,
          adoUrl,
          status: 'success' as const
        };
        
      } catch (error) {
        console.error(`[ADO Test Cases] ❌ Failed to create ${config.displayName} test case: "${testCase.title}"`, error);
        return {
          id: testCase.id,
          category: config.displayName,
          adoId: null,
          adoUrl: null,
          status: 'failed' as const,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    };

    // Process each category
    for (const [categoryKey, categoryTestCases] of Object.entries(testCasesByCategory)) {
      if (!categoryTestCases || !Array.isArray(categoryTestCases) || categoryTestCases.length === 0) {
        console.log(`[ADO Test Cases] Skipping ${categoryKey} - no test cases`);
        continue;
      }

      const config = categoryConfig[categoryKey as keyof typeof categoryConfig];
      if (!config) {
        console.warn(`[ADO Test Cases] Unknown category: ${categoryKey}`);
        continue;
      }

      console.log(`[ADO Test Cases] 📋 Processing ${categoryTestCases.length} ${config.displayName} test cases`);

      // Process test cases in parallel with concurrency limit (5 concurrent requests)
      const concurrencyLimit = 5;
      const chunks: any[][] = [];
      
      for (let i = 0; i < categoryTestCases.length; i += concurrencyLimit) {
        chunks.push(categoryTestCases.slice(i, i + concurrencyLimit));
      }

      for (const chunk of chunks) {
        const chunkResults = await Promise.all(
          chunk.map(testCase => processTestCase(testCase, config, categoryKey))
        );
        
        // Collect results and update summary
        chunkResults.forEach((result) => {
          results.push(result);
          summary.total++;
          
          if (result.status === 'success') {
            summary.succeeded++;
            summary.byCategory[categoryKey as keyof typeof summary.byCategory]++;
          } else {
            summary.failed++;
          }
        });
      }
    }

    console.log(`[ADO Test Cases] 🎯 Completion Summary:`);
    console.log(`[ADO Test Cases]   Total: ${summary.total}`);
    console.log(`[ADO Test Cases]   Succeeded: ${summary.succeeded}`);
    console.log(`[ADO Test Cases]   Failed: ${summary.failed}`);
    console.log(`[ADO Test Cases]   By Category:`, summary.byCategory);
    
    return { results, summary };
  }

  /**
   * Build XML steps for structured test case with proper formatting
   * Handles the steps array format from manual test case generator
   */
  private buildStructuredTestStepsXml(
    steps: Array<{ step: number; action: string; expectedResult: string }>
  ): string {
    if (!steps || steps.length === 0) {
      console.warn('[ADO Test Cases] No steps provided, creating empty steps XML');
      return '<steps id="0" last="0"></steps>';
    }

    const lastStepId = steps.length;
    let stepsXml = `<steps id="0" last="${lastStepId}">`;
    
    for (const step of steps) {
      const stepId = step.step || 1;
      const action = step.action || 'No action';
      const expectedResult = step.expectedResult || 'No expected result';
      
      // Escape XML and wrap in <P> tags for HTML formatting in ADO
      const escapedAction = this.escapeXml(action);
      const escapedExpected = this.escapeXml(expectedResult);
      
      stepsXml += `<step id="${stepId}" type="ActionStep">`;
      stepsXml += `<parameterizedString isformatted="true">&lt;P&gt;${escapedAction}&lt;/P&gt;</parameterizedString>`;
      stepsXml += `<parameterizedString isformatted="true">&lt;P&gt;${escapedExpected}&lt;/P&gt;</parameterizedString>`;
      stepsXml += `<description/>`; // Empty description element required by ADO
      stepsXml += `</step>`;
    }
    
    stepsXml += `</steps>`;
    
    console.log(`[ADO Test Cases] Generated steps XML for ${steps.length} steps (${stepsXml.length} chars)`);
    return stepsXml;
  }

  /**
   * Build comprehensive description with preconditions and postconditions
   */
  private buildTestCaseDescriptionWithDetails(
    testCase: {
      title?: string;
      preconditions?: string[];
      postconditions?: string[];
    },
    userStoryTitle: string
  ): string {
    let description = `<div><strong>User Story:</strong> ${this.escapeXml(userStoryTitle)}</div><br/>`;
    
    // Add preconditions if available
    if (testCase.preconditions && Array.isArray(testCase.preconditions) && testCase.preconditions.length > 0) {
      description += '<div><strong>Preconditions:</strong><ul>';
      testCase.preconditions.forEach(pre => {
        description += `<li>${this.escapeXml(pre)}</li>`;
      });
      description += '</ul></div><br/>';
    }
    
    // Add postconditions if available
    if (testCase.postconditions && Array.isArray(testCase.postconditions) && testCase.postconditions.length > 0) {
      description += '<div><strong>Postconditions:</strong><ul>';
      testCase.postconditions.forEach(post => {
        description += `<li>${this.escapeXml(post)}</li>`;
      });
      description += '</ul></div>';
    }
    
    // Fallback if no conditions provided
    if (!description.includes('Preconditions') && !description.includes('Postconditions')) {
      description += '<div><em>No preconditions or postconditions specified</em></div>';
    }
    
    return description;
  }

  /**
   * Map priority from DevX format (High, Medium, Low) to ADO format (1, 2, 3)
   */
  private mapPriorityToAdoFormat(priority: string): number {
    const priorityMap: Record<string, number> = {
      'High': 1,
      'Medium': 2,
      'Low': 3
    };
    
    return priorityMap[priority] || 2; // Default to Medium if unknown
  }


  async pushWorkItems(
    selectedItems: Array<{ type: string; id: string }>,
    epics: Epic[],
    features: Feature[],
    userStories: UserStory[],
    personas: Persona[],
    options?: { createSubtasks?: boolean; skipDuplicateCheck?: boolean; brdId?: string | null; requirementIds?: string[] }
  ): Promise<{ workItemIds: number[]; url: string; createdItems: any[]; skippedItems: any[]; testCasesCreated: number; subtasksCreated: number; failedItems: any[]; errors: string[] }> {
    console.log(`[Azure DevOps] 🚀 Starting pushWorkItems for org: ${this.organization}, project: ${this.project}`);
    console.log(`[Azure DevOps] Base URL: ${this.baseUrl}`);
    console.log(`[Azure DevOps] Selected items:`, JSON.stringify(selectedItems));

    const { createSubtasks = true, skipDuplicateCheck = false, brdId, requirementIds = [] } = options || {};

    console.log("[Azure DevOps] Traceability:", { brdId, requirementIds });

    if (skipDuplicateCheck) {
      console.log(`[Azure DevOps] ⚠️  DUPLICATE CHECK DISABLED - All items will be pushed regardless of existing ADO IDs or duplicate titles`);
    }

    const workItemIds: number[] = [];
    const createdItems: any[] = [];
    const skippedItems: any[] = [];
    const failedItems: any[] = [];
    const errors: string[] = [];
    const epicIdMap = new Map<string, number>();
    const featureIdMap = new Map<string, number>();
    let testCasesCreated = 0;
    let subtasksCreated = 0;

    // Helper function to add delay for rate limiting
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // STEP 0: Build maps for ALL epics/features (not just selected) so we can reference existing ADO IDs
    console.log(`[Azure DevOps] 📋 Building ADO ID maps from existing work items...`);
    for (const epic of epics) {
      if (epic.adoWorkItemId) {
        epicIdMap.set(epic.id, epic.adoWorkItemId);
        console.log(`[Azure DevOps] 🔗 Found existing Epic ADO ID: "${epic.title}" (DB ID: ${epic.id}) -> ADO ID: ${epic.adoWorkItemId}`);
      }
    }
    for (const feature of features) {
      if (feature.adoWorkItemId) {
        featureIdMap.set(feature.id, feature.adoWorkItemId);
        console.log(`[Azure DevOps] 🔗 Found existing Feature ADO ID: "${feature.title}" (DB ID: ${feature.id}) -> ADO ID: ${feature.adoWorkItemId}`);
      }
    }

    // STEP 1: Create/skip epics
    const selectedEpicIds = selectedItems
      .filter(item => item.type === 'epic')
      .map(item => item.id);

    console.log(`[Azure DevOps] Processing ${selectedEpicIds.length} epic(s)...`);

    for (const epicId of selectedEpicIds) {
      const epic = epics.find(e => e.id === epicId);
      if (epic) {
        // Check for duplicates only if skipDuplicateCheck is false
        if (!skipDuplicateCheck) {
          // Check if epic already exists in Azure DevOps
          if (epic.adoWorkItemId) {
            console.log(`[Azure DevOps] ⏭️  Skipping Epic "${epic.title}" (already exists in ADO with ID: ${epic.adoWorkItemId})`);
            skippedItems.push({ type: 'epic', id: epic.id, title: epic.title, adoWorkItemId: epic.adoWorkItemId, reason: 'already_exists' });
            epicIdMap.set(epicId, epic.adoWorkItemId);
            continue;
          }

          // Check if an epic with the same title already exists in ADO
          const existingEpicId = await this.findWorkItemByTitle(epic.title, 'Epic');
          if (existingEpicId) {
            console.log(`[Azure DevOps] ⏭️  Skipping Epic "${epic.title}" (found existing in ADO with ID: ${existingEpicId})`);
            skippedItems.push({ type: 'epic', id: epic.id, title: epic.title, adoWorkItemId: existingEpicId, reason: 'already_exists' });
            epicIdMap.set(epicId, existingEpicId);
            continue;
          }
        }

        try {
          console.log(`[Azure DevOps] Creating epic: "${epic.title}" (${selectedEpicIds.indexOf(epicId) + 1}/${selectedEpicIds.length})`);
          const azureEpicId = await this.createEpic(epic);
          epicIdMap.set(epicId, azureEpicId);
          workItemIds.push(azureEpicId);
          createdItems.push({ type: 'epic', id: epic.id, title: epic.title, adoWorkItemId: azureEpicId });
          console.log(`[Azure DevOps] ✅ Created Epic: "${epic.title}" (ID: ${azureEpicId})`);
          // Small delay to avoid rate limiting
          await delay(100);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[Azure DevOps] ❌ Failed to create epic "${epic.title}":`, errorMsg);
          failedItems.push({ type: 'epic', id: epic.id, title: epic.title, error: errorMsg });
          errors.push(`Epic "${epic.title}": ${errorMsg}`);
          // Continue processing other items instead of throwing
        }
      }
    }

    // STEP 2: Create/skip features
    const selectedFeatureIds = selectedItems
      .filter(item => item.type === 'feature')
      .map(item => item.id);

    console.log(`[Azure DevOps] Processing ${selectedFeatureIds.length} feature(s)...`);

    for (const featureId of selectedFeatureIds) {
      const feature = features.find(f => f.id === featureId);
      if (feature) {
        // Check for duplicates only if skipDuplicateCheck is false
        if (!skipDuplicateCheck) {
          // Check if feature already exists in Azure DevOps
          if (feature.adoWorkItemId) {
            console.log(`[Azure DevOps] ⏭️  Skipping Feature "${feature.title}" (already exists in ADO with ID: ${feature.adoWorkItemId})`);
            skippedItems.push({ type: 'feature', id: feature.id, title: feature.title, adoWorkItemId: feature.adoWorkItemId, reason: 'already_exists' });
            featureIdMap.set(featureId, feature.adoWorkItemId);
            continue;
          }

          // Check if a feature with the same title already exists in ADO
          const existingFeatureId = await this.findWorkItemByTitle(feature.title, 'Feature');
          if (existingFeatureId) {
            console.log(`[Azure DevOps] ⏭️  Skipping Feature "${feature.title}" (found existing in ADO with ID: ${existingFeatureId})`);
            skippedItems.push({ type: 'feature', id: feature.id, title: feature.title, adoWorkItemId: existingFeatureId, reason: 'already_exists' });
            featureIdMap.set(featureId, existingFeatureId);
            continue;
          }
        }

        // Try to get parent epic ADO ID from map first, then from feature's stored parent ADO ID
        let epicAzureId = epicIdMap.get(feature.epicId);
        if (!epicAzureId && (feature as any).adoParentEpicId) {
          epicAzureId = (feature as any).adoParentEpicId;
          console.log(`[Azure DevOps] Using stored parent epic ADO ID for feature "${feature.title}": ${epicAzureId}`);
        }

        try {
          if (epicAzureId) {
            console.log(`[Azure DevOps] Creating feature: "${feature.title}" under epic ID ${epicAzureId} (${selectedFeatureIds.indexOf(featureId) + 1}/${selectedFeatureIds.length})`);
          } else {
            console.log(`[Azure DevOps] Creating feature: "${feature.title}" without parent epic (${selectedFeatureIds.indexOf(featureId) + 1}/${selectedFeatureIds.length})`);
          }
          const azureFeatureId = await this.createFeature(feature, epicAzureId);
          featureIdMap.set(featureId, azureFeatureId);
          workItemIds.push(azureFeatureId);
          createdItems.push({ type: 'feature', id: feature.id, title: feature.title, adoWorkItemId: azureFeatureId });
          console.log(`[Azure DevOps] ✅ Created Feature: "${feature.title}" (ID: ${azureFeatureId})`);
          // Small delay to avoid rate limiting
          await delay(100);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[Azure DevOps] ❌ Failed to create feature "${feature.title}":`, errorMsg);
          failedItems.push({ type: 'feature', id: feature.id, title: feature.title, error: errorMsg });
          errors.push(`Feature "${feature.title}": ${errorMsg}`);
          // Continue processing other items instead of throwing
        }
      }
    }

    // STEP 3: Create/skip user stories
    const selectedStoryIds = selectedItems
      .filter(item => item.type === 'story')
      .map(item => item.id);

    console.log(`[Azure DevOps] Processing ${selectedStoryIds.length} story(ies)...`);

    for (const storyId of selectedStoryIds) {
      const story = userStories.find(s => s.id === storyId);
      if (story) {
        // Check for duplicates only if skipDuplicateCheck is false
        if (!skipDuplicateCheck) {
          // Check if user story already exists in Azure DevOps
          if (story.adoWorkItemId) {
            console.log(`[Azure DevOps] ⏭️  Skipping User Story "${story.title}" (already exists in ADO with ID: ${story.adoWorkItemId})`);
            skippedItems.push({ type: 'story', id: story.id, title: story.title, adoWorkItemId: story.adoWorkItemId, reason: 'already_exists' });
            continue;
          }

          // Check if a user story with the same title already exists in ADO
          const existingStoryId = await this.findWorkItemByTitle(story.title, 'User Story');
          if (existingStoryId) {
            console.log(`[Azure DevOps] ⏭️  Skipping User Story "${story.title}" (found existing in ADO with ID: ${existingStoryId})`);
            skippedItems.push({ type: 'story', id: story.id, title: story.title, adoWorkItemId: existingStoryId, reason: 'already_exists' });
            continue;
          }
        }

        // Try to get parent feature ADO ID from map first, then from story's stored parent ADO ID
        let featureAzureId = featureIdMap.get(story.featureId);
        if (!featureAzureId && (story as any).adoParentFeatureId) {
          featureAzureId = (story as any).adoParentFeatureId;
          console.log(`[Azure DevOps] Using stored parent feature ADO ID for user story "${story.title}": ${featureAzureId}`);
        }

        // First, try to find persona by personaId
        let persona = personas.find(p => p.id === story.personaId);

        // If not found, try to find persona by name from LLM output (story.persona field)
        if (!persona && (story as any).persona) {
          const personaName = (story as any).persona;
          persona = personas.find(p => p.name === personaName || p.name.toLowerCase() === personaName.toLowerCase());
          if (persona) {
            console.log(`[Azure DevOps] ✅ Found persona by name from LLM output for story "${story.title}": ${persona.name} (${persona.id})`);
          }
        }

        // If still not found, create a persona object from the LLM output
        if (!persona && (story as any).persona) {
          const personaName = (story as any).persona;
          // Create a persona object from the LLM output
          persona = {
            id: `ai-persona-${personaName.toLowerCase().replace(/\s+/g, '-')}`,
            name: personaName,
            role: personaName, // Use persona name as role if not specified
            color: 'blue', // Default color
            focus: `User stories for ${personaName}`,
            goals: [`Complete tasks as ${personaName}`],
            painPoints: ['None specified']
          };
          console.log(`[Azure DevOps] ✅ Created persona from LLM output for story "${story.title}": ${persona.name}`);
        }

        if (!persona) {
          if (personas.length > 0) {
            // Fallback to the first available persona so we can still push the story
            const fallbackPersona = personas[0];
            console.warn(`[Azure DevOps] ⚠️  Persona not found for story "${story.title}" (personaId: ${story.personaId}). Using fallback persona: ${fallbackPersona.name} (${fallbackPersona.id}).`);
            persona = fallbackPersona;
          } else {
            // Use default placeholder persona instead of skipping - push ALL items
            console.warn(`[Azure DevOps] ⚠️  No personas available for story "${story.title}". Using default placeholder persona: ${AzureDevOpsService.DEFAULT_PERSONA.name}`);
            persona = AzureDevOpsService.DEFAULT_PERSONA;
          }
        }

        try {
          if (featureAzureId) {
            console.log(`[Azure DevOps] Creating user story: "${story.title}" under feature ID ${featureAzureId} (${selectedStoryIds.indexOf(storyId) + 1}/${selectedStoryIds.length})`);
          } else {
            console.log(`[Azure DevOps] Creating user story: "${story.title}" without parent feature (${selectedStoryIds.indexOf(storyId) + 1}/${selectedStoryIds.length})`);
          }
          const result = await this.createUserStory(story, featureAzureId, persona, createSubtasks);
          const azureStoryId = result.storyId;
          workItemIds.push(azureStoryId);
          // Add test case IDs to workItemIds
          workItemIds.push(...result.testCaseIds);
          // Add subtask IDs to workItemIds
          workItemIds.push(...result.subtaskIds);
          createdItems.push({ type: 'story', id: story.id, title: story.title, adoWorkItemId: azureStoryId });
          testCasesCreated += result.testCasesCreated;
          subtasksCreated += result.subtasksCreated;
          console.log(`[Azure DevOps] ✅ Created User Story: "${story.title}" (ID: ${azureStoryId}) with ${result.testCasesCreated} test cases and ${result.subtasksCreated} subtasks`);
          // Small delay to avoid rate limiting
          await delay(100);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[Azure DevOps] ❌ Failed to create story "${story.title}":`, errorMsg);
          failedItems.push({ type: 'story', id: story.id, title: story.title, error: errorMsg });
          errors.push(`User Story "${story.title}": ${errorMsg}`);
          // Continue processing other items instead of throwing
        }
      }
    }

    const config = this.getConfig();
    const totalCreated = workItemIds.length + testCasesCreated + subtasksCreated;
    console.log(`[Azure DevOps] ✅ Completed pushWorkItems`);
    console.log(`[Azure DevOps] Created: ${createdItems.length} work items, ${testCasesCreated} test cases, ${subtasksCreated} subtasks (Total: ${totalCreated} items)`);
    console.log(`[Azure DevOps] Skipped: ${skippedItems.length} items`);
    console.log(`[Azure DevOps] Failed: ${failedItems.length} items`);
    console.log(`[Azure DevOps] Work Item IDs created:`, workItemIds);

    if (skippedItems.length > 0) {
      console.log(`[Azure DevOps] ⚠️  Skipped items:`, skippedItems.map(i => `${i.type}: "${i.title}" (reason: ${i.reason})`));
    }

    if (failedItems.length > 0) {
      console.error(`[Azure DevOps] ❌ Failed items (${failedItems.length}):`, failedItems.map(i => `${i.type}: "${i.title}" - ${i.error}`));
      console.error(`[Azure DevOps] ❌ First 10 errors:`, errors.slice(0, 10));
    }

    console.log(`[Azure DevOps] 📊 Summary: ${totalCreated} items created, ${skippedItems.length} skipped, ${failedItems.length} failed`);

    return {
      workItemIds,
      url: `https://dev.azure.com/${config.organization}/${config.project}/_workitems`,
      createdItems,
      skippedItems,
      testCasesCreated,
      subtasksCreated,
      failedItems,
      errors
    };
  }

  /**
   * Ensures that the project wiki is initialized in Azure DevOps.
   * If the wiki doesn't exist, it will be created.
   * Returns the wiki ID and name if successful.
   */
  private async ensureWikiInitialized(): Promise<{ wikiId: string; wikiName: string }> {
    const config = this.getConfig();
    
    // First, check if project wiki exists
    const wikiListUrl = `https://dev.azure.com/${config.organization}/${config.project}/_apis/wiki/wikis?api-version=7.1`;

    console.log(`[Azure DevOps] Checking if wiki exists for project: ${config.project}`);

    let wikiListResponse = await fetch(wikiListUrl, {
      method: 'GET',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json'
      }
    });

    let projectWiki = null;
    let wikiId = null;
    let wikiName = null;

    if (wikiListResponse.ok) {
      let wikiListData;
      try {
        const contentType = wikiListResponse.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const text = await wikiListResponse.text();
          throw new Error(`Expected JSON but got ${contentType}. Response: ${text.substring(0, 200)}`);
        }
        wikiListData = await wikiListResponse.json();
      } catch (parseError) {
        const errorText = await wikiListResponse.text().catch(() => 'Unable to read response');
        console.error(`[Azure DevOps] Failed to parse wiki list response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        throw new Error(`Failed to retrieve wikis: Invalid response format. ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }
      const wikis = wikiListData.value || [];
      projectWiki = wikis.find((w: any) => w.type === 'projectWiki');

      if (projectWiki) {
        wikiId = projectWiki.id;
        wikiName = projectWiki.name;
        console.log(`[Azure DevOps] ✅ Wiki already exists: ${wikiName} (ID: ${wikiId})`);
        return { wikiId, wikiName };
      }
    } else {
      const errorText = await wikiListResponse.text();
      console.warn(`[Azure DevOps] Failed to fetch wiki list: ${wikiListResponse.status} - ${errorText}`);
    }

    // If wiki doesn't exist, create it
    if (!projectWiki) {
      console.log(`[Azure DevOps] Wiki not found. Initializing wiki for project: ${config.project}`);

      // Try to get the project ID and verify project exists
      let projectId: string | null = null;
      try {
        const getProjectUrl = `https://dev.azure.com/${config.organization}/_apis/projects/${encodeURIComponent(config.project)}?api-version=7.0`;
        const getProjectResponse = await fetch(getProjectUrl, {
          method: 'GET',
          headers: {
            ...this.headers,
            'Content-Type': 'application/json'
          }
        });
        if (getProjectResponse.ok) {
          let projectData;
          try {
            const contentType = getProjectResponse.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
              const text = await getProjectResponse.text();
              throw new Error(`Expected JSON but got ${contentType}. Response: ${text.substring(0, 200)}`);
            }
            projectData = await getProjectResponse.json();
          } catch (parseError) {
            console.error(`[Azure DevOps] Failed to parse project response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
            throw new Error(`Project exists but response format is invalid. Please verify the project "${config.project}" exists in organization "${config.organization}".`);
          }
          projectId = projectData.id;
          console.log(`[Azure DevOps] Verified project exists: ${config.project} (ID: ${projectId})`);
        } else if (getProjectResponse.status === 404) {
          const errorText = await getProjectResponse.text().catch(() => 'Unable to read response');
          throw new Error(`Project "${config.project}" not found in organization "${config.organization}". Please verify the project name is correct and exists. Status: ${getProjectResponse.status}`);
        } else {
          const errorText = await getProjectResponse.text().catch(() => 'Unable to read response');
          console.warn(`[Azure DevOps] Failed to fetch project: ${getProjectResponse.status} - ${errorText}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          throw error; // Re-throw project not found errors
        }
        console.warn(`[Azure DevOps] Could not fetch project ID: ${error instanceof Error ? error.message : String(error)}`);
      }

      const createWikiUrl = `https://dev.azure.com/${config.organization}/${config.project}/_apis/wiki/wikis?api-version=7.1`;
      const createWikiPayload: any = {
        name: "Project Wiki",
        type: "projectWiki"
      };

      // Add projectId if available
      if (projectId) {
        createWikiPayload.projectId = projectId;
      }

      const createWikiResponse = await fetch(createWikiUrl, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(createWikiPayload)
      });

      if (createWikiResponse.ok) {
        let createdWiki;
        try {
          const contentType = createWikiResponse.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) {
            const text = await createWikiResponse.text();
            throw new Error(`Expected JSON but got ${contentType}. Response: ${text.substring(0, 200)}`);
          }
          createdWiki = await createWikiResponse.json();
        } catch (parseError) {
          const errorText = await createWikiResponse.text().catch(() => 'Unable to read response');
          console.error(`[Azure DevOps] Failed to parse wiki creation response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
          throw new Error(`Wiki creation failed: Invalid response format. ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        }
        wikiId = createdWiki.id;
        wikiName = createdWiki.name;
        console.log(`[Azure DevOps] ✅ Successfully created wiki: ${wikiName} (ID: ${wikiId})`);

        // Wait a bit for the wiki to be fully initialized
        console.log(`[Azure DevOps] Waiting 3 seconds for wiki to be fully initialized...`);
        await new Promise(resolve => setTimeout(resolve, 3000));

        return { wikiId, wikiName };
      } else {
        const errorText = await createWikiResponse.text();
        console.error(`[Azure DevOps] Failed to create project wiki: ${createWikiResponse.status} - ${errorText}`);
        
        // Provide more helpful error messages for common issues
        if (createWikiResponse.status === 404) {
          throw new Error(
            `Wiki creation failed: Project "${config.project}" not found in organization "${config.organization}". ` +
            `Please verify the project exists and you have permissions to create wikis. ` +
            `Original error: ${errorText.substring(0, 200)}`
          );
        } else if (createWikiResponse.status === 403) {
          throw new Error(
            `Wiki creation failed: Insufficient permissions to create wiki in project "${config.project}". ` +
            `Please ensure your PAT has 'Wiki (Read & Write)' permissions. ` +
            `Original error: ${errorText.substring(0, 200)}`
          );
        } else {
          throw new Error(`Wiki creation failed: ${createWikiResponse.status} - ${errorText.substring(0, 200)}`);
        }
      }
    }

    if (!wikiId || !wikiName) {
      throw new Error(`Failed to initialize wiki for project: ${config.project}`);
    }

    return { wikiId, wikiName };
  }
  async pushWikiPages(
    wikiPages: Array<{ id: string; title: string; content: string; pageType: string; order: number }>
  ): Promise<{ pagesCreated: number; wikiUrl?: string; errors: string[]; pageUrls: string[] }> {
    const config = this.getConfig();
    let pagesCreated = 0;
    const errors: string[] = [];
    const pageUrls: string[] = [];

    try {
      // First, try to get the project wiki
      const wikiListUrl = `https://dev.azure.com/${config.organization}/${config.project}/_apis/wiki/wikis?api-version=7.0`;

      console.log(`[Azure DevOps] Fetching wikis for project: ${config.project}`);

      const wikiListResponse = await fetch(wikiListUrl, {
        method: 'GET',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json'
        }
      });

      if (!wikiListResponse.ok) {
        const errorText = await wikiListResponse.text();
        throw new Error(`Failed to retrieve wikis: ${wikiListResponse.status} - ${errorText}`);
      }

      const wikiListData = await wikiListResponse.json();
      const wikis = wikiListData.value || [];

      // Find the project wiki (usually named after the project)
      let projectWiki = wikis.find((w: any) => w.type === 'projectWiki');

      let wikiId: string;
      let wikiName: string;

      // If wiki doesn't exist, create it (same logic as project creation)
      if (!projectWiki) {
        console.log(`[Azure DevOps] No project wiki found for ${config.project}. Creating wiki...`);

        // Get project ID first
        const projectUrl = `https://dev.azure.com/${config.organization}/_apis/projects/${config.project}?api-version=7.1`;
        const projectResponse = await fetch(projectUrl, {
          method: 'GET',
          headers: {
            ...this.headers,
            'Content-Type': 'application/json'
          }
        });

        if (!projectResponse.ok) {
          throw new Error(`Failed to fetch project details: ${projectResponse.status}`);
        }

        const projectData = await projectResponse.json();
        const projectId = projectData.id;

        // Create the wiki
        const createWikiUrl = `https://dev.azure.com/${config.organization}/${config.project}/_apis/wiki/wikis?api-version=7.1`;
        const createWikiPayload = {
          name: "Project Wiki",
          type: "projectWiki",
          projectId: projectId
        };

        const createWikiResponse = await fetch(createWikiUrl, {
          method: 'POST',
          headers: {
            ...this.headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(createWikiPayload)
        });

        if (!createWikiResponse.ok) {
          const errorText = await createWikiResponse.text();
          throw new Error(`Failed to create project wiki: ${createWikiResponse.status} - ${errorText}`);
        }

        const createdWiki = await createWikiResponse.json();
        wikiId = createdWiki.id;
        wikiName = createdWiki.name;

        console.log(`[Azure DevOps] ✅ Successfully created project wiki: ${wikiName} (ID: ${wikiId})`);

        // Wait a bit for the wiki to be fully initialized
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        wikiId = projectWiki.id;
        wikiName = projectWiki.name;
      }
      console.log(`[Azure DevOps] Using wiki: ${wikiName} (ID: ${wikiId})`);
      console.log(`[Azure DevOps] Wiki home URL: https://dev.azure.com/${config.organization}/${config.project}/_wiki/wikis/${wikiName}`);

      // Create or update each wiki page
      for (const page of wikiPages) {
        try {
          // Sanitize page path (remove special characters, replace spaces with hyphens)
          const pagePath = `/${page.title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-')}`;

          const pageUrl = `https://dev.azure.com/${config.organization}/${config.project}/_apis/wiki/wikis/${wikiId}/pages?path=${encodeURIComponent(pagePath)}&api-version=7.0`;

          const pageContent = {
            content: page.content
          };

          console.log(`[Azure DevOps] Attempting to create/update wiki page: ${page.title} at path: ${pagePath}`);

          // First, try to create the page
          let response = await fetch(pageUrl, {
            method: 'PUT',
            headers: {
              ...this.headers,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(pageContent)
          });

          // If page already exists (status 500 with WikiPageAlreadyExistsException), update it instead
          if (!response.ok && response.status === 500) {
            const errorText = await response.text();

            // Check if it's a "page already exists" error
            if (errorText.includes('WikiPageAlreadyExistsException') || errorText.includes('already exists')) {
              console.log(`[Azure DevOps] Page "${page.title}" already exists, fetching eTag for update...`);

              // Fetch the existing page to get its eTag
              const getResponse = await fetch(pageUrl, {
                method: 'GET',
                headers: {
                  ...this.headers,
                  'Content-Type': 'application/json'
                }
              });

              if (getResponse.ok) {
                let existingPage;
                try {
                  const contentType = getResponse.headers.get('content-type') || '';
                  if (!contentType.includes('application/json')) {
                    const text = await getResponse.text();
                    throw new Error(`Expected JSON but got ${contentType}. Response: ${text.substring(0, 200)}`);
                  }
                  existingPage = await getResponse.json();
                } catch (parseError) {
                  const errorMsg = `Failed to parse response for page "${page.title}": ${parseError instanceof Error ? parseError.message : String(parseError)}`;
                  errors.push(errorMsg);
                  console.error(`[Azure DevOps] ${errorMsg}`);
                  continue;
                }
                // Try JSON body first (existingPage.eTag), then fall back to header
                let eTag = existingPage.eTag || getResponse.headers.get('ETag');

                // Strip surrounding quotes if present (ADO sometimes returns "10" format)
                if (eTag && typeof eTag === 'string') {
                  eTag = eTag.replace(/^"|"$/g, '');
                }

                console.log(`[Azure DevOps] Updating existing page "${page.title}" with eTag: ${eTag}`);

                if (!eTag) {
                  const errorMsg = `Failed to get eTag for page "${page.title}" - cannot update`;
                  errors.push(errorMsg);
                  console.error(`[Azure DevOps] ${errorMsg}`);
                  continue;
                }

                // Update the page with the eTag
                response = await fetch(pageUrl, {
                  method: 'PUT',
                  headers: {
                    ...this.headers,
                    'Content-Type': 'application/json',
                    'If-Match': eTag
                  },
                  body: JSON.stringify(pageContent)
                });
              } else {
                const getErrorText = await getResponse.text();
                const errorMsg = `Failed to fetch existing page "${page.title}" for update: ${getResponse.status} - ${getErrorText}`;
                errors.push(errorMsg);
                console.error(`[Azure DevOps] ${errorMsg}`);
                continue;
              }
            }
          }

          if (response.ok) {
            let pageData;
            try {
              const contentType = response.headers.get('content-type') || '';
              if (!contentType.includes('application/json')) {
                const text = await response.text();
                throw new Error(`Expected JSON but got ${contentType}. Response: ${text.substring(0, 200)}`);
              }
              pageData = await response.json();
            } catch (parseError) {
              const errorMsg = `Failed to parse response for page "${page.title}": ${parseError instanceof Error ? parseError.message : String(parseError)}`;
              errors.push(errorMsg);
              console.error(`[Azure DevOps] ${errorMsg}`);
              continue;
            }
            pagesCreated++;

            // Construct the browser-accessible URL for the wiki page
            const pageId = pageData.id;
            const browserUrl = `https://dev.azure.com/${config.organization}/${config.project}/_wiki/wikis/${wikiName}/${pageId}`;
            pageUrls.push(browserUrl);

            console.log(`[Azure DevOps] ✅ Successfully created/updated wiki page: ${page.title}`);
            console.log(`[Azure DevOps] Page URL: ${browserUrl}`);
            console.log(`[Azure DevOps] Page Path: ${pagePath}`);
          } else {
            const errorText = await response.text();
            const errorMsg = `Failed to create/update wiki page "${page.title}": ${response.status} - ${errorText}`;
            errors.push(errorMsg);
            console.error(`[Azure DevOps] ❌ ${errorMsg}`);
          }
        } catch (error) {
          const errorMsg = `Error creating/updating wiki page "${page.title}": ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMsg);
          console.error(`[Azure DevOps] ❌ ${errorMsg}`);
        }
      }

      const wikiHomeUrl = `https://dev.azure.com/${config.organization}/${config.project}/_wiki/wikis/${wikiName}`;
      console.log(`[Azure DevOps] ✅ Wiki push complete. ${pagesCreated} pages created/updated successfully.`);
      console.log(`[Azure DevOps] 📚 Access all pages at: ${wikiHomeUrl}`);

      if (errors.length > 0) {
        console.log(`[Azure DevOps] ⚠️  ${errors.length} errors occurred during wiki push`);
      }

      return {
        pagesCreated,
        wikiUrl: wikiHomeUrl,
        errors,
        pageUrls
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Azure DevOps] Error pushing wiki pages:', errorMsg);
      throw new Error(`Wiki push failed: ${errorMsg}`);
    }
  }

  async resolveIdentity(nameOrEmail: string): Promise<ResolvedIdentity | null> {
    if (!nameOrEmail || nameOrEmail.trim() === '') {
      return null;
    }

    const searchTerm = nameOrEmail.trim().toLowerCase();
    const cacheKey = `${this.organization}:${searchTerm}`;

    // Check cache first
    const cached = AzureDevOpsService.identityCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < IDENTITY_CACHE_TTL_MS) {
      console.log(`[Azure DevOps] Identity cache hit for: ${nameOrEmail}`);
      return cached.identity;
    }


    try {
      // Fetch all organization users
      const users = await this.getOrganizationUsers();

      // Try exact match first (email or display name)
      let matchedUser = users.find((user: any) =>
        user.mailAddress?.toLowerCase() === searchTerm ||
        user.displayName?.toLowerCase() === searchTerm ||
        user.principalName?.toLowerCase() === searchTerm
      );

      // If no exact match, try partial match on display name
      if (!matchedUser) {
        matchedUser = users.find((user: any) =>
          user.displayName?.toLowerCase().includes(searchTerm) ||
          user.mailAddress?.toLowerCase().includes(searchTerm)
        );
      }

      if (matchedUser) {
        const resolvedIdentity: ResolvedIdentity = {
          displayName: matchedUser.displayName,
          uniqueName: matchedUser.mailAddress || matchedUser.principalName,
          descriptor: matchedUser.descriptor,
          mailAddress: matchedUser.mailAddress,
          id: matchedUser.originId
        };

        // Cache the result
        AzureDevOpsService.identityCache.set(cacheKey, {
          identity: resolvedIdentity,
          timestamp: Date.now()
        });

        return resolvedIdentity;
      }

      // Cache negative result to avoid repeated lookups
      AzureDevOpsService.identityCache.set(cacheKey, {
        identity: null,
        timestamp: Date.now()
      });

      return null;
    } catch (error) {
      console.error(`[Azure DevOps] Error resolving identity:`, error);
      return null;
    }
  }

  /**
   * Clear the identity cache (useful for testing or when user list changes)
   */
  static clearIdentityCache(): void {
    AzureDevOpsService.identityCache.clear();
    console.log('[Azure DevOps] Identity cache cleared');
  }

  /**
   * Get all users in the Azure DevOps organization using Graph API
   */
  async getOrganizationUsers(): Promise<any[]> {
    try {
      // Use Azure DevOps Graph API to get organization users
      const url = `https://vssps.dev.azure.com/${this.organization}/_apis/graph/users?api-version=7.1-preview.1`;

      console.log(`[Azure DevOps] Fetching organization users from: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers
      });

      if (!response.ok) {
        // Try alternative API endpoint if Graph API fails
        const altUrl = `https://vsaex.dev.azure.com/${this.organization}/_apis/userentitlements?api-version=6.0-preview.3&top=1000`;
        console.log(`[Azure DevOps] Graph API failed, trying user entitlements: ${altUrl}`);

        const altResponse = await fetch(altUrl, {
          method: 'GET',
          headers: this.headers
        });

        if (!altResponse.ok) {
          console.error(`[Azure DevOps] Failed to fetch organization users: ${response.status}`);
          return [];
        }

        const altResult = await altResponse.json();
        // Map user entitlements to expected format
        return (altResult.value || []).map((entry: any) => ({
          displayName: entry.user?.displayName || '',
          mailAddress: entry.user?.mailAddress || '',
          principalName: entry.user?.principalName || '',
          descriptor: entry.user?.descriptor || '',
          originId: entry.id || entry.user?.id || ''
        }));
      }

      const result = await response.json();
      const users = result.value || [];
      console.log(`[Azure DevOps] Successfully fetched ${users.length} organization users`);
      return users;
    } catch (error) {
      console.error(`[Azure DevOps] Error fetching organization users:`, error);
      return [];
    }
  }

  private getConfig(): { organization: string; project: string } {
    const match = this.baseUrl.match(/https:\/\/dev\.azure\.com\/([^\/]+)\/([^\/]+)/);
    return {
      organization: match?.[1] || '',
      project: match?.[2] || ''
    };
  }

  async getProjects(): Promise<any[]> {
    const url = `https://dev.azure.com/${this.organization}/_apis/projects?api-version=7.0`;

    console.log(`[Azure DevOps] Fetching projects from URL:`, url);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch projects:`, response.status, errorText);
      throw new Error(`Failed to fetch projects: ${response.status} - ${errorText}`);
    }

    // Guard against cases where Azure DevOps returns HTML (e.g. sign-in page)
    // with a 200 status. This would otherwise cause "Unexpected token '<'" on JSON.parse.
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      const textBody = await response.text();
      console.error(
        '[Azure DevOps] Non-JSON response while fetching projects. This often indicates an invalid/expired PAT or missing permissions. Body snippet:',
        textBody.slice(0, 200)
      );
      throw new Error(
        'Azure DevOps returned an unexpected response when fetching projects. The PAT may be invalid or expired, or the organization may require additional permissions.'
      );
    }

    const result = await response.json();
    const projects = result.value || [];
    console.log(`[Azure DevOps] Successfully fetched ${projects.length} projects`);
    return projects;
  }

  /**
   * Update/Edit a project in Azure DevOps
   * @param projectId - The GUID of the project to update
   * @param updates - Object containing name and/or description to update
   */
  async updateProject(projectId: string, updates: { name?: string; description?: string }): Promise<void> {
    const url = `https://dev.azure.com/${this.organization}/_apis/projects/${projectId}?api-version=7.1-preview.4`;

    console.log(`[Azure DevOps] Updating project ${projectId} with:`, updates);

    // Build the request body with only provided fields
    const body: any = {};
    if (updates.name !== undefined) {
      body.name = updates.name;
    }
    if (updates.description !== undefined) {
      body.description = updates.description;
    }

    // Use PATCH headers (not json-patch+json for project updates)
    const patchHeaders = {
      ...this.headers,
      'Content-Type': 'application/json'
    };

    const response = await fetch(url, {
      method: 'PATCH',
      headers: patchHeaders,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to update project:`, response.status, errorText);

      if (response.status === 401) {
        throw new Error('Authentication failed. Please verify your PAT token has "Project (Read & Write)" permissions.');
      } else if (response.status === 403) {
        throw new Error('Permission denied. You need "Project Collection Administrator" permissions to update projects.');
      } else if (response.status === 404) {
        throw new Error(`Project with ID ${projectId} not found.`);
      }

      throw new Error(`Failed to update project: ${response.status} - ${errorText}`);
    }

    console.log(`[Azure DevOps] Successfully updated project ${projectId}`);
  }

  /**
   * Delete a project from Azure DevOps
   * @param projectId - The GUID of the project to delete
   */
  async deleteProject(projectId: string): Promise<void> {
    const url = `https://dev.azure.com/${this.organization}/_apis/projects/${projectId}?api-version=7.1-preview.4`;

    console.log(`[Azure DevOps] Deleting project ${projectId}`);

    // Use DELETE method with standard headers
    const deleteHeaders = {
      ...this.headers,
      'Content-Type': 'application/json'
    };

    const response = await fetch(url, {
      method: 'DELETE',
      headers: deleteHeaders
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to delete project:`, response.status, errorText);

      if (response.status === 401) {
        throw new Error('Authentication failed. Please verify your PAT token has "Project (Read & Write)" permissions.');
      } else if (response.status === 403) {
        throw new Error('Permission denied. You need "Project Collection Administrator" permissions to delete projects.');
      } else if (response.status === 404) {
        throw new Error(`Project with ID ${projectId} not found.`);
      }

      throw new Error(`Failed to delete project: ${response.status} - ${errorText}`);
    }

    console.log(`[Azure DevOps] Successfully deleted project ${projectId}`);
  }

  async getWorkItems(projectName?: string, limit?: number): Promise<any[]> {
    const targetProject = projectName || this.project;
    // Add $top parameter to URL if limit is specified (Azure DevOps WIQL API supports this)
    let url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/wiql?api-version=7.0`;
    if (limit && limit > 0) {
      url += `&$top=${limit}`;
    }

    // Query to get work items from the project
    const wiqlQuery = {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${targetProject}' ORDER BY [System.ChangedDate] DESC`
    };

    console.log(`[Azure DevOps] Fetching work items for project: ${targetProject}${limit ? ` (limit: ${limit})` : ''}`);

    // WIQL queries require Content-Type: application/json (not json-patch+json)
    const wiqlHeaders = {
      ...this.headers,
      'Content-Type': 'application/json'
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: wiqlHeaders,
      body: JSON.stringify(wiqlQuery)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch work items:`, response.status, errorText);
      throw new Error(`Failed to fetch work items: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    let workItemIds = result.workItems?.map((item: any) => item.id) || [];

    // Apply limit as fallback if not applied by API (shouldn't be needed but safety check)
    if (limit && limit > 0 && workItemIds.length > limit) {
      workItemIds = workItemIds.slice(0, limit);
    }

    if (workItemIds.length === 0) {
      console.log('[Azure DevOps] No work items found');
      return [];
    }

    // Get work item details in batches (Azure DevOps supports up to 200 items per batch)
    // Optimize by fetching batches in parallel for better performance
    const batchSize = 200;
    const batches: number[][] = [];

    for (let i = 0; i < workItemIds.length; i += batchSize) {
      batches.push(workItemIds.slice(i, i + batchSize));
    }

    // Fetch all batches in parallel for better performance
    // Use $expand=relations instead of $expand=all to significantly reduce response size
    // This only expands relations (for hierarchy) without fetching all related work item details
    const batchPromises = batches.map(async (batch) => {
      const detailsUrl = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems?ids=${batch.join(',')}&api-version=7.0&$expand=relations`;

      try {
        const detailsResponse = await fetch(detailsUrl, {
          method: 'GET',
          headers: this.headers
        });

        if (detailsResponse.ok) {
          const detailsResult = await detailsResponse.json();
          return detailsResult.value || [];
        } else {
          console.error(`[Azure DevOps] Failed to fetch batch:`, detailsResponse.status);
          return [];
        }
      } catch (error) {
        console.error(`[Azure DevOps] Error fetching batch:`, error);
        return [];
      }
    });

    // Wait for all batches to complete
    const batchResults = await Promise.all(batchPromises);
    const allWorkItems = batchResults.flat();

    console.log(`[Azure DevOps] Successfully fetched ${allWorkItems.length} work items`);
    return allWorkItems;
  }

  async getWorkItemById(workItemId: number, projectName?: string): Promise<any> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems/${workItemId}?api-version=7.0&$expand=all`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch work item ${workItemId}:`, response.status, errorText);
      throw new Error(`Failed to fetch work item: ${response.status} - ${errorText}`);
    }

    const workItem = await response.json();
    console.log(`[Azure DevOps] Successfully fetched work item: ${workItem.fields['System.Title']}`);
    return workItem;
  }

  /**
   * Fetches work item comments and extracts the first Figma link found in comment text.
   * Uses Azure DevOps WIT Comments API (7.1-preview.4).
   */
  async getWorkItemComments(workItemId: number, projectName?: string): Promise<{ comments: string[]; figmaLink: string | null }> {
    const targetProject = projectName || this.project;
    const comments: string[] = [];
    let continuationToken: string | undefined;
    const figmaUrlRegex = /https?:\/\/(www\.)?figma\.com\/[^\s<>"']+/gi;

    do {
      const queryParams = new URLSearchParams({ 'api-version': '7.1-preview.4', '$top': '100' });
      if (continuationToken) queryParams.set('continuationToken', continuationToken);
      const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workItems/${workItemId}/comments?${queryParams.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { ...this.headers, 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        if (response.status === 404 || response.status === 403) {
          return { comments: [], figmaLink: null };
        }
        const errorText = await response.text();
        console.error(`[Azure DevOps] Failed to fetch work item comments ${workItemId}:`, response.status, errorText);
        return { comments: [], figmaLink: null };
      }

      const data = await response.json();
      const batch = data.comments || [];
      for (const c of batch) {
        if (c.text && !c.isDeleted) {
          comments.push(c.text);
        }
      }
      continuationToken = data.continuationToken;
    } while (continuationToken);

    let figmaLink: string | null = null;
    const combinedText = comments.join(' ');
    const match = combinedText.match(figmaUrlRegex);
    if (match && match[0]) {
      figmaLink = match[0].replace(/[)\]}>'"\s]+$/, '');
    }

    return { comments, figmaLink };
  }

  async linkWorkItemsPublic(sourceWorkItemId: number, targetWorkItemId: number, linkType: string = 'System.LinkTypes.Hierarchy-Reverse', projectName?: string): Promise<void> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems/${sourceWorkItemId}?api-version=7.0`;

    const operation = [{
      op: 'add',
      path: '/relations/-',
      value: {
        rel: linkType,
        url: `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems/${targetWorkItemId}`,
        attributes: {
          comment: 'Linked via DevPlatform'
        }
      }
    }];

    console.log(`[Azure DevOps] Linking work items: ${sourceWorkItemId} -> ${targetWorkItemId} with type: ${linkType}`);

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(operation)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to link work items:`, response.status, errorText);
      throw new Error(`Failed to link work items: ${response.status} - ${errorText}`);
    }

    console.log(`[Azure DevOps] Successfully linked work items`);
  }

  /**
   * Unlink work items by removing a relation
   * Since links can be bidirectional, we check both work items
   */
  async unlinkWorkItems(sourceWorkItemId: number, targetWorkItemId: number, projectName?: string): Promise<void> {
    const targetProject = projectName || this.project;

    // Try to find the relation on the source work item first
    let workItemToUpdate = sourceWorkItemId;
    let relationIndex = -1;

    const sourceWorkItemUrl = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems/${sourceWorkItemId}?$expand=relations&api-version=7.0`;
    console.log(`[Azure DevOps] Fetching work item ${sourceWorkItemId} to find relation to ${targetWorkItemId}`);

    const sourceResponse = await fetch(sourceWorkItemUrl, {
      method: 'GET',
      headers: this.headers
    });

    if (sourceResponse.ok) {
      const sourceWorkItem = await sourceResponse.json();
      console.log(`[Azure DevOps] Source work item ${sourceWorkItemId} has ${sourceWorkItem.relations?.length || 0} relations`);

      // Log all relations for debugging
      if (sourceWorkItem.relations) {
        sourceWorkItem.relations.forEach((rel: any, idx: number) => {
          const match = rel.url.match(/workitems\/(\d+)/);
          const relId = match ? parseInt(match[1]) : null;
          console.log(`[Azure DevOps] Source relation ${idx}: type=${rel.rel}, url=${rel.url}, extractedId=${relId}`);
        });
      }

      // Check for any relation pointing to target (check all relation types)
      relationIndex = sourceWorkItem.relations?.findIndex((rel: any, idx: number) => {
        // Try multiple URL matching patterns
        const patterns = [
          /workitems\/(\d+)/,
          /\/_apis\/wit\/workitems\/(\d+)/,
          /workitems\/(\d+)(?:\?|$)/,
        ];

        for (const pattern of patterns) {
          const match = rel.url.match(pattern);
          if (match) {
            const extractedId = parseInt(match[1]);
            if (extractedId === targetWorkItemId) {
              console.log(`[Azure DevOps] Found relation on source: index=${idx}, type=${rel.rel}, url=${rel.url}`);
              return true;
            }
          }
        }

        // Also try extracting from end of URL
        const urlParts = rel.url.split('/');
        const lastPart = urlParts[urlParts.length - 1];
        const idFromEnd = parseInt(lastPart.split('?')[0]);
        if (!isNaN(idFromEnd) && idFromEnd === targetWorkItemId) {
          console.log(`[Azure DevOps] Found relation on source (from URL end): index=${idx}, type=${rel.rel}`);
          return true;
        }

        return false;
      }) ?? -1;
    }

    // If not found on source, check the target work item (for reverse hierarchy links)
    if (relationIndex === -1) {
      const targetWorkItemUrl = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems/${targetWorkItemId}?$expand=relations&api-version=7.0`;
      console.log(`[Azure DevOps] Relation not found on source, checking target work item ${targetWorkItemId}`);

      const targetResponse = await fetch(targetWorkItemUrl, {
        method: 'GET',
        headers: this.headers
      });

      if (!targetResponse.ok) {
        const errorText = await targetResponse.text();
        console.error(`[Azure DevOps] Failed to fetch target work item:`, targetResponse.status, errorText);
        throw new Error(`Failed to fetch target work item: ${targetResponse.status} - ${errorText}`);
      }

      const targetWorkItem = await targetResponse.json();
      console.log(`[Azure DevOps] Target work item ${targetWorkItemId} has ${targetWorkItem.relations?.length || 0} relations`);

      // Log all relations for debugging
      if (targetWorkItem.relations) {
        targetWorkItem.relations.forEach((rel: any, idx: number) => {
          const match = rel.url.match(/workitems\/(\d+)/);
          const relId = match ? parseInt(match[1]) : null;
          console.log(`[Azure DevOps] Target relation ${idx}: type=${rel.rel}, url=${rel.url}, extractedId=${relId}`);
        });
      }

      // Check for any relation pointing to source (check all relation types)
      relationIndex = targetWorkItem.relations?.findIndex((rel: any, idx: number) => {
        // Try multiple URL matching patterns
        const patterns = [
          /workitems\/(\d+)/,
          /\/_apis\/wit\/workitems\/(\d+)/,
          /workitems\/(\d+)(?:\?|$)/,
        ];

        for (const pattern of patterns) {
          const match = rel.url.match(pattern);
          if (match) {
            const extractedId = parseInt(match[1]);
            if (extractedId === sourceWorkItemId) {
              console.log(`[Azure DevOps] Found relation on target: index=${idx}, type=${rel.rel}, url=${rel.url}`);
              return true;
            }
          }
        }

        // Also try extracting from end of URL
        const urlParts = rel.url.split('/');
        const lastPart = urlParts[urlParts.length - 1];
        const idFromEnd = parseInt(lastPart.split('?')[0]);
        if (!isNaN(idFromEnd) && idFromEnd === sourceWorkItemId) {
          console.log(`[Azure DevOps] Found relation on target (from URL end): index=${idx}, type=${rel.rel}`);
          return true;
        }

        return false;
      }) ?? -1;

      if (relationIndex !== -1) {
        workItemToUpdate = targetWorkItemId;
      }
    }

    if (relationIndex === -1) {
      console.error(`[Azure DevOps] No relation found between work items ${sourceWorkItemId} and ${targetWorkItemId}`);
      throw new Error(`No relation found between work items ${sourceWorkItemId} and ${targetWorkItemId}`);
    }

    // Remove the relation using PATCH (use index in path)
    const patchUrl = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems/${workItemToUpdate}?api-version=7.0`;

    const patchBody = [
      {
        op: "remove",
        path: `/relations/${relationIndex}`
      }
    ];

    console.log(`[Azure DevOps] Unlinking work items: ${sourceWorkItemId} <-> ${targetWorkItemId} (removing from ${workItemToUpdate})`);

    const patchResponse = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json-patch+json'
      },
      body: JSON.stringify(patchBody)
    });

    if (!patchResponse.ok) {
      const errorText = await patchResponse.text();
      console.error(`[Azure DevOps] Failed to unlink work items:`, patchResponse.status, errorText);
      throw new Error(`Failed to unlink work items: ${patchResponse.status} - ${errorText}`);
    }

    console.log(`[Azure DevOps] Successfully unlinked work items`);
  }

  /**
   * Fetch all repositories in the organization
   */
  async getBuilds(startDate?: Date, endDate?: Date): Promise<any> {
    // Fetch more builds when date range is provided to ensure we capture all builds in the range
    // Azure DevOps API doesn't reliably support date filtering via query params, so we fetch more and filter client-side
    const limit = (startDate && endDate) ? 1000 : 500; // Fetch more when filtering by date
    const url = `${this.baseUrl}/build/builds?api-version=7.0&$top=${limit}`;

    if (startDate && endDate) {
      console.log(`[Azure DevOps] Fetching builds (will filter by date range: ${startDate.toISOString()} to ${endDate.toISOString()})`);
    } else {
      console.log(`[Azure DevOps] Fetching all builds (no date filter)`);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch builds:`, response.status, errorText);
      throw new Error(`Failed to fetch builds: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[Azure DevOps] Fetched ${data.value?.length || 0} builds from API`);
    return data;
  }

  async getRecentDeployments(): Promise<any> {
    const url = `https://vsrm.dev.azure.com/${this.organization}/${this.project}/_apis/release/deployments?api-version=7.0&$top=50`;

    console.log(`[Azure DevOps] Fetching recent deployments`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch deployments:`, response.status, errorText);
      throw new Error(`Failed to fetch deployments: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  }

  async getRepositories(projectName?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/git/repositories?api-version=7.0`;

    console.log(`[Azure DevOps] Fetching repositories for project: ${targetProject}`);
    console.log(`[Azure DevOps] Request URL: ${url}`);
    console.log(`[Azure DevOps] Request headers:`, { ...this.headers, Authorization: 'Basic [REDACTED]' });

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch repositories:`, response.status, errorText);
      console.error(`[Azure DevOps] Response headers:`, Object.fromEntries(response.headers.entries()));

      if (response.status === 401) {
        throw new Error(`Authentication failed (401). Please verify:
1. Your PAT token is valid and not expired
2. The token has "Code (Read)" permissions
3. The organization "${this.organization}" is correct
4. The project "${targetProject}" exists and you have access to it
5. You're using the RAW PAT token, not base64 encoded

URL attempted: ${url}`);
      }

      throw new Error(`Failed to fetch repositories: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const repositories = result.value || [];
    console.log(`[Azure DevOps] Successfully fetched ${repositories.length} repositories`);
    return repositories;
  }

  /**
   * List all branches in a Git repository.
   */
  async listBranches(repositoryId: string): Promise<Array<{ name: string; objectId: string }>> {
    const url = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/&api-version=7.0`;
    const response = await fetch(url, { method: 'GET', headers: this.headers });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list branches: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    return (data.value || []).map((r: any) => ({
      name: r.name.replace('refs/heads/', ''),
      objectId: r.objectId,
    }));
  }

  /**
   * Create an ADO environment if it doesn't already exist.
   */
  async createEnvironmentIfNotExists(name: string): Promise<void> {
    const base = `https://dev.azure.com/${this.organization}/${this.project}/_apis/distributedtask/environments`;
    // Check if it already exists
    const listRes = await fetch(`${base}?api-version=7.0`, { headers: this.headers });
    if (listRes.ok) {
      const data = await listRes.json();
      const exists = (data.value || []).some((e: any) => e.name === name);
      if (exists) return;
    }
    // Create it
    const createRes = await fetch(`${base}?api-version=7.0`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: "Created by Astra Platform" }),
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      console.error(`[ADO] Failed to create environment "${name}":`, err);
    }
  }

  /**
   * Create a new branch from an existing branch (pure ref creation, no file changes).
   */
  async createBranch(repositoryId: string, newBranch: string, sourceBranch: string): Promise<void> {
    // Get source branch SHA
    const branches = await this.listBranches(repositoryId);
    const source = branches.find(b => b.name === sourceBranch);
    if (!source) throw new Error(`Source branch "${sourceBranch}" not found in repository`);

    const url = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repositoryId}/refs?api-version=7.0`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        name: `refs/heads/${newBranch}`,
        newObjectId: source.objectId,
        oldObjectId: '0000000000000000000000000000000000000000',
      }]),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create branch "${newBranch}": ${response.status} - ${errorText}`);
    }
    console.log(`[Azure DevOps] Created branch "${newBranch}" from "${sourceBranch}"`);
  }

  /**
   * Fetch all pipelines (build definitions) in the project
   */
  async getPipelines(projectName?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/build/definitions?api-version=7.0`;

    console.log(`[Azure DevOps] Fetching pipelines for project: ${targetProject}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch pipelines:`, response.status, errorText);
      throw new Error(`Failed to fetch pipelines: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const pipelines = result.value || [];
    console.log(`[Azure DevOps] Successfully fetched ${pipelines.length} pipelines`);
    return pipelines;
  }

  /**
   * Queue (run) a build for a given pipeline definition
   */
  async queueBuild(pipelineId: number, branchName: string, projectName?: string): Promise<any> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/build/builds?api-version=7.0`;
    const body = {
      definition: { id: pipelineId },
      sourceBranch: branchName.startsWith('refs/') ? branchName : `refs/heads/${branchName}`,
    };
    console.log(`[Azure DevOps] Queuing build for pipeline ${pipelineId} on branch ${branchName}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Failed to queue build: ${response.status} - ${err}`);
    }
    const result = await response.json();
    console.log(`[Azure DevOps] Build queued successfully, build ID: ${result.id}`);
    return result;
  }

  /**
   * Create a new YAML-based pipeline definition
   */
  async createPipelineDefinition(
    name: string,
    repositoryId: string,
    repositoryName: string,
    branchName: string,
    yamlPath: string,
    projectName?: string
  ): Promise<any> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/build/definitions?api-version=7.0`;
    const body = {
      name,
      type: 'build',
      quality: 'definition',
      process: { type: 2, yamlFilename: yamlPath },
      repository: {
        id: repositoryId,
        name: repositoryName,
        type: 'TfsGit',
        defaultBranch: branchName.startsWith('refs/') ? branchName : `refs/heads/${branchName}`,
        clean: null,
        checkoutSubmodules: false,
      },
      queue: { name: 'Azure Pipelines' },
    };
    console.log(`[Azure DevOps] Creating pipeline definition "${name}" for repo ${repositoryName}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Failed to create pipeline: ${response.status} - ${err}`);
    }
    const result = await response.json();
    console.log(`[Azure DevOps] Pipeline created successfully, ID: ${result.id}`);
    return result;
  }

  /**
   * Fetch pull requests for a repository
   */
  async getPullRequests(repositoryId: string, status: string = 'all'): Promise<any[]> {
    const url = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repositoryId}/pullrequests?searchCriteria.status=${status}&api-version=7.0`;

    console.log(`[Azure DevOps] Fetching pull requests for repository: ${repositoryId}, status: ${status}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch pull requests:`, response.status, errorText);
      throw new Error(`Failed to fetch pull requests: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const pullRequests = result.value || [];
    console.log(`[Azure DevOps] Successfully fetched ${pullRequests.length} pull requests`);
    return pullRequests;
  }

  /**
   * Fetch commits for a repository
   */
  async getCommits(repositoryId: string, limit: number = 50): Promise<any[]> {
    const url = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repositoryId}/commits?$top=${limit}&api-version=7.0`;

    console.log(`[Azure DevOps] Fetching commits for repository: ${repositoryId}, limit: ${limit}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch commits:`, response.status, errorText);
      throw new Error(`Failed to fetch commits: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const commits = result.value || [];
    console.log(`[Azure DevOps] Successfully fetched ${commits.length} commits`);
    return commits;
  }

  /**
   * Get work item type definitions to fetch all possible states
   */
  async getWorkItemTypeStates(workItemType: string, projectName?: string): Promise<string[]> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitemtypes/${workItemType}?api-version=7.0`;

    console.log(`[Azure DevOps] Fetching work item type states for: ${workItemType}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers
      });

      if (!response.ok) {
        console.warn(`[Azure DevOps] Failed to fetch work item type states for ${workItemType}: ${response.status}`);
        return [];
      }

      const workItemTypeDef = await response.json();
      const states = workItemTypeDef.states?.map((state: any) => state.name) || [];
      console.log(`[Azure DevOps] Found ${states.length} states for ${workItemType}:`, states);
      return states;
    } catch (error) {
      console.error(`[Azure DevOps] Error fetching work item type states for ${workItemType}:`, error);
      return [];
    }
  }

  /**
   * Fetch work items with specific types (e.g., User Story, Task, Bug)
   */
  async getWorkItemsByType(workItemType: string, projectName?: string, limit: number = 100, search?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/wiql?api-version=7.0`;

    // Optional server-side title filter (escape single quotes for WIQL).
    const sanitizedSearch = (search || '').trim().replace(/'/g, "''");
    const searchClause = sanitizedSearch ? ` AND [System.Title] CONTAINS '${sanitizedSearch}'` : '';

    const wiqlQuery = {
      query: `SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo] FROM WorkItems WHERE [System.TeamProject] = '${targetProject}' AND [System.WorkItemType] = '${workItemType}'${searchClause} ORDER BY [System.ChangedDate] DESC`
    };

    console.log(`[Azure DevOps] Fetching work items of type: ${workItemType}`);

    const wiqlHeaders = {
      ...this.headers,
      'Content-Type': 'application/json'
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: wiqlHeaders,
      body: JSON.stringify(wiqlQuery)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch work items by type:`, response.status, errorText);
      throw new Error(`Failed to fetch work items by type: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const totalFound = result.workItems?.length || 0;
    const workItemIds = result.workItems?.map((item: any) => item.id).slice(0, limit) || [];

    console.log(`[Azure DevOps] WIQL query for '${workItemType}' returned ${totalFound} items, taking first ${workItemIds.length} (limit: ${limit})`);

    if (workItemIds.length === 0) {
      console.warn(`[Azure DevOps] ⚠️ No work items found for type '${workItemType}' in project '${targetProject}'`);
      console.warn(`[Azure DevOps] ℹ️ Check if:`);
      console.warn(`  1. Work items of this type exist in the project`);
      console.warn(`  2. Work item type name is correct (case-sensitive)`);
      console.warn(`  3. PAT has sufficient permissions`);
      return [];
    }

    // **CRITICAL: Fetch work items in batches to avoid URL length limits**
    // ADO API supports max 200 IDs per request
    const BATCH_SIZE = 200;
    const allWorkItems: any[] = [];
    
    console.log(`[Azure DevOps] Fetching details for ${workItemIds.length} work items in batches of ${BATCH_SIZE}...`);
    
    for (let i = 0; i < workItemIds.length; i += BATCH_SIZE) {
      const batchIds = workItemIds.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(workItemIds.length / BATCH_SIZE);
      
      console.log(`[Azure DevOps] Fetching batch ${batchNum}/${totalBatches}: ${batchIds.length} items (IDs: ${batchIds[0]} to ${batchIds[batchIds.length-1]})`);
      
      const detailsUrl = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems?ids=${batchIds.join(',')}&api-version=7.0&$expand=all`;
      
      const detailsResponse = await fetch(detailsUrl, {
        method: 'GET',
        headers: this.headers
      });

      if (!detailsResponse.ok) {
        const errorText = await detailsResponse.text();
        console.error(`[Azure DevOps] ❌ Failed to fetch batch ${batchNum}:`, detailsResponse.status, errorText);
        console.error(`[Azure DevOps] Details URL (first 200 chars):`, detailsUrl.substring(0, 200));
        throw new Error(`Failed to fetch work item details (batch ${batchNum}): ${detailsResponse.status} - ${errorText}`);
      }

      const detailsResult = await detailsResponse.json();
      const batchWorkItems = detailsResult.value || [];
      
      console.log(`[Azure DevOps] ✅ Batch ${batchNum}/${totalBatches}: fetched ${batchWorkItems.length}/${batchIds.length} items`);
      
      if (batchWorkItems.length === 0 && batchIds.length > 0) {
        console.error(`[Azure DevOps] ⚠️ Batch ${batchNum} returned 0 items for ${batchIds.length} IDs!`);
        console.error(`[Azure DevOps] Response structure:`, JSON.stringify(detailsResult).substring(0, 500));
      }
      
      allWorkItems.push(...batchWorkItems);
    }
    
    console.log(`[Azure DevOps] ✅ Successfully fetched ${allWorkItems.length}/${workItemIds.length} work items of type ${workItemType} across ${Math.ceil(workItemIds.length / BATCH_SIZE)} batches`);
    
    return allWorkItems;
  }

  /**
   * Fetch user stories specifically for code generation
   */
  async getUserStories(organization: string, projectName: string): Promise<any[]> {
    return this.getWorkItemsByType('User Story', projectName);
  }

  /**
   * Fetch a work item with all its children (subtasks, etc.)
   */
  async getWorkItemWithChildren(workItemId: number, projectName?: string): Promise<any> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems/${workItemId}?$expand=all&api-version=7.0`;

    console.log(`[Azure DevOps] Fetching work item with children: ${workItemId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch work item:`, response.status, errorText);
      throw new Error(`Failed to fetch work item: ${response.status} - ${errorText}`);
    }

    const workItem = await response.json();

    // Get child work items if they exist
    const childLinks = workItem.relations?.filter((rel: any) =>
      rel.rel === 'System.LinkTypes.Hierarchy-Forward'
    ) || [];

    if (childLinks.length > 0) {
      const childIds = childLinks.map((link: any) => {
        const match = link.url.match(/workitems\/(\d+)/);
        return match ? match[1] : null;
      }).filter(Boolean);

      if (childIds.length > 0) {
        const childrenUrl = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems?ids=${childIds.join(',')}&api-version=7.0&$expand=all`;

        const childrenResponse = await fetch(childrenUrl, {
          method: 'GET',
          headers: this.headers
        });

        if (childrenResponse.ok) {
          const childrenResult = await childrenResponse.json();
          workItem.children = childrenResult.value || [];
        }
      }
    }

    console.log(`[Azure DevOps] Successfully fetched work item ${workItemId} with ${workItem.children?.length || 0} children`);
    return workItem;
  }

  /**
   * Search work items by title or description
   */
  async getBacklogContext(projectName?: string, limit: number = 1000): Promise<{
    epics: any[];
    features: any[];
    userStories: any[];
    tasks: any[];
    bugs: any[];
  }> {
    const targetProject = projectName || this.project;

    console.log(`[Azure DevOps] Fetching backlog context for project: ${targetProject} (limit ${limit} per type)`);

    try {
      // Fetch Epics, Features, User Stories with higher limits to get all states
      // Increased limits to ensure we capture all work items and their states.
      // Callers that only need a sample (e.g. design-prompt enrichment) can pass
      // a small limit to avoid pulling the entire backlog.
      const [epics, features, userStories, tasks, bugs] = await Promise.all([
        this.getWorkItemsByType('Epic', targetProject, limit),
        this.getWorkItemsByType('Feature', targetProject, limit),
        this.getWorkItemsByType('User Story', targetProject, limit),
        this.getWorkItemsByType('Task', targetProject, limit),
        this.getWorkItemsByType('Bug', targetProject, limit),
      ]);

      console.log(`[Azure DevOps] Fetched backlog context - Epics: ${epics.length}, Features: ${features.length}, User Stories: ${userStories.length}, Tasks: ${tasks.length}, Bugs: ${bugs.length}`);

      return {
        epics,
        features,
        userStories,
        tasks,
        bugs,
      };
    } catch (error) {
      console.error('[Azure DevOps] Error fetching backlog context:', error);
      throw error;
    }
  }

  async searchWorkItems(searchTerm: string, projectName?: string, limit?: number): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/wiql?api-version=7.0`;

    const wiqlQuery = {
      query: `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State] FROM WorkItems WHERE [System.TeamProject] = '${targetProject}' AND ([System.Title] CONTAINS '${searchTerm}' OR [System.Description] CONTAINS '${searchTerm}') ORDER BY [System.ChangedDate] DESC`
    };

    console.log(`[Azure DevOps] Searching work items with term: ${searchTerm}`);

    const wiqlHeaders = {
      ...this.headers,
      'Content-Type': 'application/json'
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: wiqlHeaders,
      body: JSON.stringify(wiqlQuery)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to search work items:`, response.status, errorText);
      throw new Error(`Failed to search work items: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    let workItemIds = result.workItems?.map((item: any) => item.id) || [];

    // Apply limit only when explicitly provided
    if (limit && limit > 0 && workItemIds.length > limit) {
      workItemIds = workItemIds.slice(0, limit);
    }

    if (workItemIds.length === 0) {
      return [];
    }

    // Get work item details
    const detailsUrl = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems?ids=${workItemIds.join(',')}&api-version=7.0`;

    const detailsResponse = await fetch(detailsUrl, {
      method: 'GET',
      headers: this.headers
    });

    if (detailsResponse.ok) {
      const detailsResult = await detailsResponse.json();
      const workItems = detailsResult.value || [];
      console.log(`[Azure DevOps] Found ${workItems.length} work items matching '${searchTerm}'`);
      return workItems;
    }

    return [];
  }

  /**
   * Get recent builds/pipeline runs
   */
  async getRecentBuilds(pipelineId?: number, limit: number = 10): Promise<any[]> {
    let url = `https://dev.azure.com/${this.organization}/${this.project}/_apis/build/builds?api-version=7.0&$top=${limit}`;

    if (pipelineId) {
      url += `&definitions=${pipelineId}`;
    }

    console.log(`[Azure DevOps] Fetching recent builds${pipelineId ? ` for pipeline ${pipelineId}` : ''}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch builds:`, response.status, errorText);
      throw new Error(`Failed to fetch builds: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const builds = result.value || [];
    console.log(`[Azure DevOps] Successfully fetched ${builds.length} builds`);
    return builds;
  }

  /**
   * Create a work item from chatbot - public method for ADO integration
   */
  async createWorkItemFromChat(
    workItemType: string,
    title: string,
    description: string,
    acceptanceCriteria?: string,
    assignedTo?: string,
    storyPoints?: number,
    priority?: number,
    tags?: string,
    projectName?: string
  ): Promise<any> {
    console.log(`[Azure DevOps] Creating ${workItemType} from chatbot:`, title);

    // Build fields object - truncate title to avoid API errors
    const fields: Record<string, any> = {
      'System.Title': this.truncateTitle(title),
      'System.Description': description,
    };

    // Add optional fields
    if (acceptanceCriteria) {
      fields['Microsoft.VSTS.Common.AcceptanceCriteria'] = acceptanceCriteria;
    }

    if (assignedTo) {
      // Resolve the assignee to a proper Azure DevOps identity
      const resolvedIdentity = await this.resolveIdentity(assignedTo);
      if (resolvedIdentity && resolvedIdentity.uniqueName) {
        // Use uniqueName (email) which is the most reliable format for System.AssignedTo
        fields['System.AssignedTo'] = resolvedIdentity.uniqueName;
        console.log(`[Azure DevOps] Resolved assignee "${assignedTo}" to "${resolvedIdentity.uniqueName}"`);
      } else {
        // Fallback: try using the original value (might work if it's already an email)
        console.warn(`[Azure DevOps] Could not resolve assignee "${assignedTo}", using original value`);
        fields['System.AssignedTo'] = assignedTo;
      }
    }

    if (storyPoints !== undefined && workItemType === 'User Story') {
      fields['Microsoft.VSTS.Scheduling.StoryPoints'] = storyPoints;
    }

    if (priority !== undefined) {
      fields['Microsoft.VSTS.Common.Priority'] = priority;
    }

    if (tags) {
      fields['System.Tags'] = tags;
    }

    // Create the work item
    const workItemId = await this.createWorkItem(workItemType, fields);

    // Fetch and return the created work item details
    const url = `${this.baseUrl}/wit/workitems/${workItemId}?api-version=7.0`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch created work item: ${response.status}`);
    }

    const workItem = await response.json();
    console.log(`[Azure DevOps] Successfully created and fetched work item #${workItemId}`);

    return workItem;
  }

  /**
   * Update a work item - public method for ADO integration
   */
  async updateWorkItem(workItemId: number, fields: Record<string, any>, projectName?: string): Promise<any> {
    const targetProject = projectName || this.project;
    // Add bypassRules=true to skip workflow validation when only updating description
    const url = `${this.baseUrl}/wit/workitems/${workItemId}?bypassRules=true&api-version=7.0`;

    const operations: WorkItemCreateRequest[] = Object.entries(fields).map(([key, value]) => ({
      op: 'add',
      path: `/fields/${key}`,
      value
    }));

    console.log(`[Azure DevOps] Updating work item ${workItemId} with URL:`, url);
    console.log(`[Azure DevOps] Operations:`, JSON.stringify(operations, null, 2));

    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(operations)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to update work item ${workItemId}:`, response.status, errorText);
      throw new Error(`Failed to update work item: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`[Azure DevOps] Successfully updated work item #${workItemId}`);

    return result;
  }

  /**
   * Add tags to a work item (appends to existing tags)
   * @param workItemId - Work item ID to tag
   * @param tagsToAdd - Array of tags to add (e.g., ['TestCases-Generated', 'DevX'])
   * @param projectName - Optional project name
   */
  async addTagsToWorkItem(workItemId: number, tagsToAdd: string[], projectName?: string): Promise<any> {
    try {
      console.log(`[ADO Tags] Adding tags to work item #${workItemId}:`, tagsToAdd);
      
      // First, fetch the work item to get existing tags
      const workItem = await this.getWorkItemById(workItemId, projectName);
      const existingTags = workItem.fields['System.Tags'] || '';
      
      // Parse existing tags (semicolon-separated)
      const existingTagsArray = existingTags
        .split(';')
        .map((t: string) => t.trim())
        .filter((t: string) => t.length > 0);
      
      console.log(`[ADO Tags] Existing tags:`, existingTagsArray);
      
      // Merge with new tags (avoid duplicates)
      const allTags = [...new Set([...existingTagsArray, ...tagsToAdd])];
      const newTagsString = allTags.join('; ');
      
      console.log(`[ADO Tags] New tags string:`, newTagsString);
      
      // Update the work item with merged tags
      await this.updateWorkItem(workItemId, {
        'System.Tags': newTagsString
      }, projectName);
      
      console.log(`[ADO Tags] ✅ Successfully added tags to work item #${workItemId}`);
      
      return { success: true, tags: allTags };
    } catch (error) {
      console.error(`[ADO Tags] ❌ Error adding tags to work item #${workItemId}:`, error);
      throw error;
    }
  }

  /**
   * Create a work item with custom fields - public method for ADO integration
   */
  async createWorkItemPublic(workItemType: string, fields: Record<string, any>, projectName?: string): Promise<any> {
    const targetProject = projectName || this.project;
    const workItemId = await this.createWorkItem(workItemType, fields);

    // Fetch and return the created work item details
    const url = `${this.baseUrl}/wit/workitems/${workItemId}?api-version=7.0`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch created work item: ${response.status}`);
    }

    const workItem = await response.json();
    console.log(`[Azure DevOps] Successfully created and fetched work item #${workItemId}`);

    return workItem;
  }

  /**
   * Fetch repository tree structure
   * @param repositoryId - The ADO repository ID
   * @param scopePath - The path to start from (default: /)
   * @param recursionLevel - How deep to recurse (default: Full)
   */
  async getRepositoryTree(
    repositoryId: string,
    scopePath: string = '/',
    recursionLevel: string = 'Full',
    branchName?: string
  ): Promise<any> {
    const versionParam = branchName
      ? `&versionDescriptor.version=${encodeURIComponent(branchName)}&versionDescriptor.versionType=branch`
      : "";
    const url = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repositoryId}/items?scopePath=${encodeURIComponent(scopePath)}&recursionLevel=${recursionLevel}${versionParam}&api-version=7.0`;

    console.log(`[Azure DevOps] Fetching repository tree:`, url);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch repository tree:`, response.status, errorText);

      if (response.status === 401) {
        throw new Error('Invalid PAT token or insufficient permissions');
      } else if (response.status === 404) {
        throw new Error('Repository not found');
      } else if (response.status === 403) {
        throw new Error('PAT token needs Code (Read) permission');
      }

      throw new Error(`Failed to fetch repository tree: ${response.status}`);
    }

    const result = await response.json();
    console.log(`[Azure DevOps] Successfully fetched repository tree, item count:`, result.count);

    return result;
  }

  /**
   * Fetch file content from repository
   * @param repositoryId - The ADO repository ID
   * @param filePath - The path to the file
   */
  async getFileContent(
    repositoryId: string,
    filePath: string,
    branchName?: string
  ): Promise<string> {
    const branchParam = branchName ? `&versionDescriptor.version=${encodeURIComponent(branchName)}&versionDescriptor.versionType=branch` : "";
    const url = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent(filePath)}${branchParam}&api-version=7.0`;

    console.log(`[Azure DevOps] Fetching file content:`, url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...this.headers,
        'Accept': 'text/plain'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch file content:`, response.status, errorText);

      if (response.status === 401) {
        throw new Error('Invalid PAT token or insufficient permissions');
      } else if (response.status === 404) {
        throw new Error('File not found');
      }

      throw new Error(`Failed to fetch file content: ${response.status}`);
    }

    const content = await response.text();
    console.log(`[Azure DevOps] Successfully fetched file content, size:`, content.length);

    return content;
  }

  /**
   * List directory contents (one level) in a Git repository.
   * @param repositoryId - The ADO repository ID
   * @param dirPath - The path to the directory (e.g. /AutomationScript/org-proj)
   * @param version - Optional branch name (default: main)
   */
  async listDirectoryContents(
    repositoryId: string,
    dirPath: string,
    version?: string
  ): Promise<Array<{ name: string; type: "file" | "dir"; path: string }>> {
    const normalizedPath = dirPath.startsWith("/") ? dirPath : `/${dirPath}`;
    const versionParam = version ? `&versionDescriptor.version=${encodeURIComponent(version)}&versionDescriptor.versionType=branch` : "";
    const url = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repositoryId}/items?scopePath=${encodeURIComponent(normalizedPath)}&recursionLevel=OneLevel&api-version=7.0${versionParam}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { ...this.headers, Accept: "application/json" },
    });

    if (!response.ok) {
      if (response.status === 404) return [];
      const errorText = await response.text();
      console.error(`[Azure DevOps] listDirectoryContents failed:`, response.status, errorText);
      throw new Error(`Failed to list directory: ${response.status}`);
    }

    const data = await response.json();
    const items = data.value as Array<{ path: string; gitObjectType?: string }> | undefined;
    if (!Array.isArray(items)) return [];

    return items
      .filter((item) => item.path !== normalizedPath) // exclude the folder itself
      .map((item) => {
        const name = item.path.split("/").pop() || item.path;
        const type = item.gitObjectType === "tree" ? "dir" : "file";
        return { name, type, path: item.path };
      });
  }

  /**
   * Categorize work item based on title, description, and tags
   * Returns one of the 7 design categories
   */
  private categorizeWorkItem(workItem: any): string | null {
    const title = (workItem.fields?.['System.Title'] || '').toLowerCase();
    const description = (workItem.fields?.['System.Description'] || '').toLowerCase();
    const tags = (workItem.fields?.['System.Tags'] || '').toLowerCase();
    const combined = `${title} ${description} ${tags}`;

    // Category keywords mapping
    const categoryKeywords = {
      'system-architecture': ['system architecture', 'architecture', 'infrastructure', 'system design', 'technical architecture', 'solution architecture'],
      'database-design': ['database', 'schema', 'data model', 'erd', 'entity relationship', 'db design', 'database structure', 'table design'],
      'ui-ux-design': ['ui', 'ux', 'user interface', 'user experience', 'figma', 'wireframe', 'mockup', 'prototype', 'design'],
      'component-design': ['component', 'module design', 'component architecture', 'ui component', 'reusable component'],
      'data-flow-design': ['data flow', 'workflow', 'process flow', 'data pipeline', 'data movement', 'flow diagram'],
      'interface-design': ['api', 'interface', 'api design', 'endpoint', 'rest api', 'graphql', 'integration'],
      'security-design': ['security', 'authentication', 'authorization', 'encryption', 'security design', 'access control', 'security architecture']
    };

    // Check each category
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      for (const keyword of keywords) {
        if (combined.includes(keyword)) {
          return category;
        }
      }
    }

    return null;
  }

  /**
   * Fetch design-related work items from Requirement & Analysis phase
   * Categorizes them into the 7 design element types
   */
  async getDesignWorkItems(projectName?: string): Promise<{
    systemArchitecture: any[];
    databaseDesign: any[];
    uiUxDesign: any[];
    componentDesign: any[];
    dataFlowDesign: any[];
    interfaceDesign: any[];
    securityDesign: any[];
  }> {
    const targetProject = projectName || this.project;

    console.log(`[Azure DevOps] Fetching design-related work items for project: ${targetProject}`);

    try {
      // Fetch all work items that could be design-related
      // We'll search for Requirements, User Stories, and Tasks that mention design
      const workItems = await Promise.all([
        this.getWorkItemsByType('Requirement', targetProject, 100),
        this.getWorkItemsByType('User Story', targetProject, 100),
        this.getWorkItemsByType('Epic', targetProject, 50),
      ]);

      const allWorkItems = workItems.flat();

      console.log(`[Azure DevOps] Fetched ${allWorkItems.length} total work items for categorization`);

      // Categorize work items
      const categorized = {
        systemArchitecture: [] as any[],
        databaseDesign: [] as any[],
        uiUxDesign: [] as any[],
        componentDesign: [] as any[],
        dataFlowDesign: [] as any[],
        interfaceDesign: [] as any[],
        securityDesign: [] as any[],
      };

      for (const workItem of allWorkItems) {
        const category = this.categorizeWorkItem(workItem);

        if (category) {
          const categoryKey = category.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
          if (categorized[categoryKey as keyof typeof categorized]) {
            categorized[categoryKey as keyof typeof categorized].push(workItem);
          }
        }
      }

      console.log(`[Azure DevOps] Categorized work items:`, {
        systemArchitecture: categorized.systemArchitecture.length,
        databaseDesign: categorized.databaseDesign.length,
        uiUxDesign: categorized.uiUxDesign.length,
        componentDesign: categorized.componentDesign.length,
        dataFlowDesign: categorized.dataFlowDesign.length,
        interfaceDesign: categorized.interfaceDesign.length,
        securityDesign: categorized.securityDesign.length,
      });

      return categorized;
    } catch (error) {
      console.error('[Azure DevOps] Error fetching design work items:', error);
      throw error;
    }
  }

  /**
   * Push a commit to an Azure DevOps Git repository
   * Creates a new file with the generated code in the specified branch
   */
  async pushCommit(params: {
    repositoryName: string;
    branchName: string;
    fileName: string;
    fileContent: string;
    commitMessage: string;
    authorName: string;
  }): Promise<{
    commitId: string;
    url: string;
  }> {
    const { repositoryName, branchName, fileName, fileContent, commitMessage, authorName } = params;

    console.log(`[Azure DevOps] Pushing commit to repository: ${repositoryName}, branch: ${branchName}`);

    try {
      // First, get the repository ID
      const reposUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories?api-version=7.0`;
      const reposResponse = await fetch(reposUrl, {
        method: 'GET',
        headers: {
          'Authorization': this.headers['Authorization'],
          'Accept': 'application/json'
        }
      });

      if (!reposResponse.ok) {
        throw new Error(`Failed to fetch repositories: ${reposResponse.statusText}`);
      }

      const reposData = await reposResponse.json();
      const repository = reposData.value.find((repo: any) => repo.name === repositoryName);

      if (!repository) {
        throw new Error(`Repository "${repositoryName}" not found`);
      }

      // Get the latest commit on the branch to get the old object ID
      const branchUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repository.id}/refs?filter=heads/${branchName}&api-version=7.0`;
      const branchResponse = await fetch(branchUrl, {
        method: 'GET',
        headers: {
          'Authorization': this.headers['Authorization'],
          'Accept': 'application/json'
        }
      });

      if (!branchResponse.ok) {
        throw new Error(`Failed to fetch branch: ${branchResponse.statusText}`);
      }

      const branchData = await branchResponse.json();
      const oldObjectId = branchData.value[0]?.objectId;

      if (!oldObjectId) {
        throw new Error(`Branch "${branchName}" not found`);
      }

      // Create the push request
      const pushUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repository.id}/pushes?api-version=7.0`;

      const pushData = {
        refUpdates: [
          {
            name: `refs/heads/${branchName}`,
            oldObjectId: oldObjectId
          }
        ],
        commits: [
          {
            comment: commitMessage,
            author: {
              name: authorName,
              email: `${authorName.toLowerCase().replace(/\s+/g, '.')}@devplatform.local`,
              date: new Date().toISOString()
            },
            changes: [
              {
                changeType: "add",
                item: {
                  path: `/${fileName}`
                },
                newContent: {
                  content: fileContent,
                  contentType: "rawtext"
                }
              }
            ]
          }
        ]
      };

      const pushResponse = await fetch(pushUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.headers['Authorization'],
          'Accept': 'application/json'
        },
        body: JSON.stringify(pushData)
      });

      if (!pushResponse.ok) {
        const errorText = await pushResponse.text();
        console.error(`[Azure DevOps] Failed to push commit:`, pushResponse.status, errorText);
        throw new Error(`Failed to push commit: ${pushResponse.statusText}`);
      }

      const pushResult = await pushResponse.json();
      const commitId = pushResult.commits[0].commitId;
      const url = `https://dev.azure.com/${this.organization}/${this.project}/_git/${repositoryName}/commit/${commitId}`;

      console.log(`[Azure DevOps] Successfully pushed commit: ${commitId}`);
      console.log(`[Azure DevOps] Commit URL: ${url}`);

      return {
        commitId,
        url
      };
    } catch (error) {
      console.error('[Azure DevOps] Error pushing commit:', error);
      throw error;
    }
  }

  /**
   * Push multiple files to an Azure DevOps Git repository in a single commit
   */
  async pushMultipleFiles(params: {
    repositoryId?: string;
    repositoryName?: string;
    branchName: string;
    files: Array<{ path: string; content: string }>;
    commitMessage: string;
    authorName: string;
  }): Promise<{
    commitId: string;
    url: string;
  }> {
    const { repositoryId, repositoryName, branchName, files, commitMessage, authorName } = params;

    console.log(`[Azure DevOps] Pushing ${files.length} file(s) to repository: ${repositoryId || repositoryName}, branch: ${branchName}`);

    try {
      let repository: any;

      // If repository ID is provided, use it directly
      if (repositoryId) {
        // Get repository details by ID
        const repoUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repositoryId}?api-version=7.0`;
        const repoResponse = await fetch(repoUrl, {
          method: 'GET',
          headers: {
            'Authorization': this.headers['Authorization'],
            'Accept': 'application/json'
          }
        });

        if (!repoResponse.ok) {
          throw new Error(`Failed to fetch repository: ${repoResponse.statusText}`);
        }

        repository = await repoResponse.json();
      } else if (repositoryName) {
        // Fallback to name lookup if ID not provided
        const reposUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories?api-version=7.0`;
        const reposResponse = await fetch(reposUrl, {
          method: 'GET',
          headers: {
            'Authorization': this.headers['Authorization'],
            'Accept': 'application/json'
          }
        });

        if (!reposResponse.ok) {
          throw new Error(`Failed to fetch repositories: ${reposResponse.statusText}`);
        }

        const reposData = await reposResponse.json();
        repository = reposData.value.find((repo: any) => repo.name === repositoryName);

        if (!repository) {
          throw new Error(`Repository "${repositoryName}" not found`);
        }
      } else {
        throw new Error("Either repositoryId or repositoryName must be provided");
      }

      // Get the latest commit on the branch to get the old object ID
      // For new repositories, the branch might not exist yet
      const branchUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repository.id}/refs?filter=heads/${branchName}&api-version=7.0`;
      console.log(`[Azure DevOps] Checking branch: ${branchUrl}`);
      
      const branchResponse = await fetch(branchUrl, {
        method: 'GET',
        headers: {
          'Authorization': this.headers['Authorization'],
          'Accept': 'application/json'
        }
      });

      if (!branchResponse.ok) {
        console.error(`[Azure DevOps] Failed to fetch branch ${branchName}:`, branchResponse.status, branchResponse.statusText);
        // Don't throw here - this is expected for new repositories
      }

      const branchData = branchResponse.ok ? await branchResponse.json() : { value: [] };
      const oldObjectId = branchData.value[0]?.objectId;
      
      console.log(`[Azure DevOps] Branch ${branchName} exists:`, !!oldObjectId);
      console.log(`[Azure DevOps] Old object ID:`, oldObjectId || 'null (new branch)');

      // For new repositories, oldObjectId will be null/undefined, which is expected
      // Azure DevOps will automatically create the branch if oldObjectId is "0000000000000000000000000000000000000000"
      const finalOldObjectId = oldObjectId || "0000000000000000000000000000000000000000";

      // Create the push request with multiple file changes
      const pushUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repository.id}/pushes?api-version=7.0`;

      // For each file, normalize the path and decide whether to ADD (new file) or EDIT (existing file)
      const changes = [];
      for (const [index, file] of files.entries()) {
        // Normalize path: use forward slashes and ensure it starts with /
        let normalizedPath = file.path.replace(/\\/g, '/');
        if (!normalizedPath.startsWith('/')) {
          normalizedPath = `/${normalizedPath}`;
        }

        console.log(`[Azure DevOps] File ${index + 1}: ${normalizedPath} (${file.content.length} chars)`);

        let changeType: "add" | "edit" = "add";
        if (oldObjectId) {
          try {
            const itemUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repository.id}/items?path=${encodeURIComponent(normalizedPath)}&versionDescriptor.version=${encodeURIComponent(branchName)}&versionDescriptor.versionType=branch&api-version=7.0`;
            const itemResponse = await fetch(itemUrl, {
              method: 'GET',
              headers: {
                'Authorization': this.headers['Authorization'],
                'Accept': 'application/json'
              }
            });

            if (itemResponse.ok) {
              changeType = "edit";
            }
          } catch (e) {
            // File doesn't exist on this branch — use add
          }
        }

        changes.push({
          changeType,
          item: {
            path: normalizedPath
          },
          newContent: {
            content: file.content,
            contentType: "rawtext" as const
          }
        } as const);
      }

      const pushData = {
        refUpdates: [
          {
            name: `refs/heads/${branchName}`,
            oldObjectId: finalOldObjectId
          }
        ],
        commits: [
          {
            comment: commitMessage,
            author: {
              name: authorName,
              email: `${authorName.toLowerCase().replace(/\s+/g, '.')}@devplatform.local`,
              date: new Date().toISOString()
            },
            changes: changes
          }
        ]
      };

      let pushResponse = await fetch(pushUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.headers['Authorization'],
          'Accept': 'application/json'
        },
        body: JSON.stringify(pushData)
      });

      let cachedErrorText: string | null = null;

      // Safety retry: if ADO reports an "add path already exists" conflict, retry as edit.
      if (!pushResponse.ok) {
        const firstErrorText = await pushResponse.text();
        cachedErrorText = firstErrorText;
        const addExistsConflict =
          pushResponse.status === 400 &&
          (firstErrorText.includes("add operation already exists") ||
            firstErrorText.includes("specified in the add operation already exists"));

        if (addExistsConflict) {
          console.warn("[Azure DevOps] Detected add-vs-existing-path conflict. Retrying push with edit operations.");
          const retryPushData = {
            ...pushData,
            commits: pushData.commits.map((commit) => ({
              ...commit,
              changes: commit.changes.map((change) => ({
                ...change,
                changeType: "edit" as const,
              })),
            })),
          };

          pushResponse = await fetch(pushUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': this.headers['Authorization'],
              'Accept': 'application/json'
            },
            body: JSON.stringify(retryPushData)
          });
          if (!pushResponse.ok) {
            cachedErrorText = await pushResponse.text();
          } else {
            cachedErrorText = null;
          }
        }
      }

      if (!pushResponse.ok) {
        const errorText = cachedErrorText ?? await pushResponse.text();
        console.error(`[Azure DevOps] Failed to push files:`);
        console.error(`  Status: ${pushResponse.status} ${pushResponse.statusText}`);
        console.error(`  Response:`, errorText);
        console.error(`  Request body:`, JSON.stringify(pushData, null, 2));
        
        // Try to parse error details
        let detailedError = `${pushResponse.status}: ${pushResponse.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.message) {
            detailedError += ` - ${errorJson.message}`;
          }
        } catch (e) {
          detailedError += ` - ${errorText}`;
        }
        
        throw new Error(`Failed to push files: ${detailedError}`);
      }

      const pushResult = await pushResponse.json();
      const commitId = pushResult.commits[0].commitId;
      const repoNameForUrl = repository.name || repositoryName || repositoryId;
      const url = `https://dev.azure.com/${this.organization}/${this.project}/_git/${repoNameForUrl}/commit/${commitId}`;

      console.log(`[Azure DevOps] Successfully pushed ${files.length} file(s) in commit: ${commitId}`);
      console.log(`[Azure DevOps] Commit URL: ${url}`);

      return {
        commitId,
        url
      };
    } catch (error) {
      console.error('[Azure DevOps] Error pushing files:', error);
      throw error;
    }
  }

  /**
   * Delete files from a repository using the same Push API
   * Similar to pushMultipleFiles but with changeType: "delete"
   */
  async deleteFiles(params: {
    repositoryId?: string;
    repositoryName?: string;
    branchName: string;
    filePaths: string[];
    commitMessage: string;
    authorName: string;
  }): Promise<{
    commitId: string;
    url: string;
  }> {
    const { repositoryId, repositoryName, branchName, filePaths, commitMessage, authorName } = params;

    console.log(`[Azure DevOps] Deleting ${filePaths.length} file(s) from repository: ${repositoryId || repositoryName}, branch: ${branchName}`);

    try {
      let repository: any;

      // If repository ID is provided, use it directly
      if (repositoryId) {
        // Get repository details by ID
        const repoUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repositoryId}?api-version=7.0`;
        const repoResponse = await fetch(repoUrl, {
          method: 'GET',
          headers: {
            'Authorization': this.headers['Authorization'],
            'Accept': 'application/json'
          }
        });

        if (!repoResponse.ok) {
          throw new Error(`Failed to fetch repository: ${repoResponse.statusText}`);
        }

        repository = await repoResponse.json();
      } else if (repositoryName) {
        // Fallback to name lookup if ID not provided
        const reposUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories?api-version=7.0`;
        const reposResponse = await fetch(reposUrl, {
          method: 'GET',
          headers: {
            'Authorization': this.headers['Authorization'],
            'Accept': 'application/json'
          }
        });

        if (!reposResponse.ok) {
          throw new Error(`Failed to fetch repositories: ${reposResponse.statusText}`);
        }

        const reposData = await reposResponse.json();
        repository = reposData.value.find((repo: any) => repo.name === repositoryName);

        if (!repository) {
          throw new Error(`Repository "${repositoryName}" not found`);
        }
      } else {
        throw new Error("Either repositoryId or repositoryName must be provided");
      }

      // Get the latest commit on the branch to get the old object ID
      const branchUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repository.id}/refs?filter=heads/${branchName}&api-version=7.0`;
      const branchResponse = await fetch(branchUrl, {
        method: 'GET',
        headers: {
          'Authorization': this.headers['Authorization'],
          'Accept': 'application/json'
        }
      });

      if (!branchResponse.ok) {
        throw new Error(`Failed to fetch branch: ${branchResponse.statusText}`);
      }

      const branchData = await branchResponse.json();
      const oldObjectId = branchData.value[0]?.objectId;

      if (!oldObjectId) {
        throw new Error(`Branch "${branchName}" not found`);
      }

      // Create the push request with delete changes
      const pushUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis/git/repositories/${repository.id}/pushes?api-version=7.0`;

      const changes = filePaths.map((filePath) => ({
        changeType: "delete" as const,
        item: {
          path: filePath.startsWith('/') ? filePath : `/${filePath}`
        }
      }));

      const pushData = {
        refUpdates: [
          {
            name: `refs/heads/${branchName}`,
            oldObjectId: oldObjectId
          }
        ],
        commits: [
          {
            comment: commitMessage,
            author: {
              name: authorName,
              email: `${authorName.toLowerCase().replace(/\s+/g, '.')}@devplatform.local`,
              date: new Date().toISOString()
            },
            changes: changes
          }
        ]
      };

      const pushResponse = await fetch(pushUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.headers['Authorization'],
          'Accept': 'application/json'
        },
        body: JSON.stringify(pushData)
      });

      if (!pushResponse.ok) {
        const errorText = await pushResponse.text();
        console.error(`[Azure DevOps] Failed to delete files:`, pushResponse.status, errorText);
        throw new Error(`Failed to delete files: ${pushResponse.statusText}`);
      }

      const pushResult = await pushResponse.json();
      const commitId = pushResult.commits[0].commitId;
      const repoNameForUrl = repository.name || repositoryName || repositoryId;
      const url = `https://dev.azure.com/${this.organization}/${this.project}/_git/${repoNameForUrl}/commit/${commitId}`;

      console.log(`[Azure DevOps] Successfully deleted ${filePaths.length} file(s) in commit: ${commitId}`);
      console.log(`[Azure DevOps] Commit URL: ${url}`);

      return {
        commitId,
        url
      };
    } catch (error) {
      console.error('[Azure DevOps] Error deleting files:', error);
      throw error;
    }
  }

  /**
   * ========================================
   * RELEASE MANAGEMENT & DEPLOYMENT METHODS
   * ========================================
   */

  /**
   * Fetch all release definitions (release pipelines) in the project
   */
  async getReleaseDefinitions(projectName?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    // Release Management uses vsrm.dev.azure.com instead of dev.azure.com
    const url = `https://vsrm.dev.azure.com/${this.organization}/${targetProject}/_apis/release/definitions?api-version=7.0`;

    console.log(`[Azure DevOps] Fetching release definitions for project: ${targetProject}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch release definitions:`, response.status, errorText);

      // Provide helpful error messages for common errors
      if (response.status === 401) {
        throw new Error(`Authentication failed (401). Please verify:
1. Your PAT token is valid and not expired
2. The token has "Release (Read)" permissions
3. The organization "${this.organization}" is correct
4. The project "${targetProject}" exists and you have access to it
5. You're using the RAW PAT token, not base64 encoded

URL attempted: ${url}`);
      } else if (response.status === 404) {
        throw new Error(`Project not found (404). Please verify:
1. Organization "${this.organization}" exists
2. Project "${targetProject}" exists
3. You have access to this project`);
      } else if (response.status === 203) {
        throw new Error(`Non-authoritative information (203). The organization or project may not exist or PAT doesn't have access.`);
      }

      // Check if error text contains HTML
      if (errorText.includes("<!DOCTYPE") || errorText.includes("<html")) {
        throw new Error(`Azure DevOps API returned an HTML error page (${response.status}). This usually means authentication failed or the project/organization is incorrect.`);
      }

      throw new Error(`Failed to fetch release definitions: ${response.status} - ${errorText.substring(0, 200)}`);
    }

    const result = await response.json();
    const definitions = result.value || [];
    console.log(`[Azure DevOps] Successfully fetched ${definitions.length} release definitions`);
    return definitions;
  }

  /**
   * Fetch releases for a specific release definition
   */
  async getReleases(definitionId?: number, top: number = 50, projectName?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    let url = `https://vsrm.dev.azure.com/${this.organization}/${targetProject}/_apis/release/releases?api-version=7.0&$top=${top}&$expand=environments`;

    if (definitionId) {
      url += `&definitionId=${definitionId}`;
    }

    console.log(`[Azure DevOps] Fetching releases${definitionId ? ` for definition ${definitionId}` : ''}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch releases:`, response.status, errorText);

      // Provide helpful error messages for common errors
      if (response.status === 401) {
        throw new Error(`Authentication failed (401). Please verify:
1. Your PAT token is valid and not expired
2. The token has "Release (Read)" permissions
3. The organization "${this.organization}" is correct
4. The project "${targetProject}" exists and you have access to it
5. You're using the RAW PAT token, not base64 encoded

URL attempted: ${url}`);
      } else if (response.status === 404) {
        throw new Error(`Project not found (404). Please verify:
1. Organization "${this.organization}" exists
2. Project "${targetProject}" exists
3. You have access to this project`);
      } else if (response.status === 203) {
        throw new Error(`Non-authoritative information (203). The organization or project may not exist or PAT doesn't have access.`);
      }

      // Check if error text contains HTML
      if (errorText.includes("<!DOCTYPE") || errorText.includes("<html")) {
        throw new Error(`Azure DevOps API returned an HTML error page (${response.status}). This usually means authentication failed or the project/organization is incorrect.`);
      }

      throw new Error(`Failed to fetch releases: ${response.status} - ${errorText.substring(0, 200)}`);
    }

    const result = await response.json();
    const releases = result.value || [];
    console.log(`[Azure DevOps] Successfully fetched ${releases.length} releases`);
    return releases;
  }

  /**
   * Get a specific release by ID with detailed information
   */
  async getRelease(releaseId: number, projectName?: string): Promise<any> {
    const targetProject = projectName || this.project;
    // Expand environments to get deploySteps, gates, and conditions
    const url = `https://vsrm.dev.azure.com/${this.organization}/${targetProject}/_apis/release/releases/${releaseId}?api-version=7.0&$expand=environments`;

    console.log(`[Azure DevOps] Fetching release ${releaseId} with environments expanded`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch release:`, response.status, errorText);
      throw new Error(`Failed to fetch release: ${response.status} - ${errorText}`);
    }

    const release = await response.json();
    console.log(`[Azure DevOps] Successfully fetched release: ${release.name}`);
    return release;
  }

  /**
   * Create a new release
   */
  async createRelease(definitionId: number, description: string = 'Release created via DevPlatform', projectName?: string): Promise<any> {
    const targetProject = projectName || this.project;
    const url = `https://vsrm.dev.azure.com/${this.organization}/${targetProject}/_apis/release/releases?api-version=7.0`;

    const releaseData = {
      definitionId: definitionId,
      description: description,
      isDraft: false,
      reason: 'manual'
    };

    console.log(`[Azure DevOps] Creating release for definition ${definitionId}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(releaseData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to create release:`, response.status, errorText);
      throw new Error(`Failed to create release: ${response.status} - ${errorText}`);
    }

    const release = await response.json();
    console.log(`[Azure DevOps] Successfully created release: ${release.name}`);
    return release;
  }

  /**
   * Deploy a release to a specific environment
   */
  async deployRelease(releaseId: number, environmentId: number, comment: string = 'Deployment triggered via DevPlatform', projectName?: string): Promise<any> {
    const targetProject = projectName || this.project;
    const url = `https://vsrm.dev.azure.com/${this.organization}/${targetProject}/_apis/release/releases/${releaseId}/environments/${environmentId}?api-version=7.0`;

    const deploymentData = {
      status: 'inProgress',
      comment: comment
    };

    console.log(`[Azure DevOps] Deploying release ${releaseId} to environment ${environmentId}`);

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(deploymentData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to deploy release:`, response.status, errorText);
      throw new Error(`Failed to deploy release: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`[Azure DevOps] Successfully triggered deployment`);
    return result;
  }

  /**
   * Get work items associated with a release
   */
  async getReleaseWorkItems(releaseId: number, projectName?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://vsrm.dev.azure.com/${this.organization}/${targetProject}/_apis/release/releases/${releaseId}/workitems?api-version=7.0`;

    console.log(`[Azure DevOps] Fetching work items for release ${releaseId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Check if response is HTML
      if (errorText.includes("<!DOCTYPE") || errorText.includes("<html")) {
        console.error(`[Azure DevOps] Release ${releaseId} work items API returned HTML instead of JSON`);
        throw new Error("Azure DevOps API returned an HTML error page. Please check your PAT token and organization/project configuration.");
      }
      // If 404, return empty array (release might not have work items endpoint)
      if (response.status === 404) {
        console.log(`[Azure DevOps] Release ${releaseId} work items endpoint not found, returning empty array`);
        return [];
      }
      console.error(`[Azure DevOps] Failed to fetch release work items:`, response.status, errorText);
      throw new Error(`Failed to fetch release work items: ${response.status} - ${errorText}`);
    }

    // Check if response is HTML before parsing JSON
    const contentType = response.headers.get("content-type");
    const responseText = await response.text();
    if (!contentType?.includes("application/json") || responseText.trim().startsWith("<")) {
      console.error(`[Azure DevOps] Release ${releaseId} work items API returned HTML instead of JSON`);
      throw new Error("Azure DevOps API returned an HTML error page. Please check your PAT token and organization/project configuration.");
    }

    const result = JSON.parse(responseText);
    const workItemRefs = result.value || [];

    if (workItemRefs.length === 0) {
      return [];
    }

    // Get full work item details
    const workItemIds = workItemRefs.map((ref: any) => ref.id || ref.workItem?.id).filter(Boolean);
    if (workItemIds.length === 0) {
      return [];
    }

    const detailsUrl = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems?ids=${workItemIds.join(',')}&$expand=all&api-version=7.0`;
    const detailsResponse = await fetch(detailsUrl, {
      method: 'GET',
      headers: this.headers
    });

    if (detailsResponse.ok) {
      // Check if response is HTML before parsing JSON
      const contentType = detailsResponse.headers.get("content-type");
      const responseText = await detailsResponse.text();
      if (!contentType?.includes("application/json") || responseText.trim().startsWith("<")) {
        console.error(`[Azure DevOps] Work items details API returned HTML instead of JSON`);
        return []; // Return empty array instead of throwing to allow partial results
      }
      const detailsResult = JSON.parse(responseText);
      return detailsResult.value || [];
    }

    return [];
  }

  /**
   * Get work items associated with a build
   */
  async getBuildWorkItems(buildId: number, projectName?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/build/builds/${buildId}/workitems?api-version=7.0`;

    console.log(`[Azure DevOps] Fetching work items for build ${buildId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Check if response is HTML
      if (errorText.includes("<!DOCTYPE") || errorText.includes("<html")) {
        console.error(`[Azure DevOps] Build ${buildId} work items API returned HTML instead of JSON`);
        throw new Error("Azure DevOps API returned an HTML error page. Please check your PAT token and organization/project configuration.");
      }
      // If 404, return empty array
      if (response.status === 404) {
        console.log(`[Azure DevOps] Build ${buildId} work items endpoint not found, returning empty array`);
        return [];
      }
      console.error(`[Azure DevOps] Failed to fetch build work items:`, response.status, errorText);
      throw new Error(`Failed to fetch build work items: ${response.status} - ${errorText}`);
    }

    // Check if response is HTML before parsing JSON
    const contentType = response.headers.get("content-type");
    const responseText = await response.text();
    if (!contentType?.includes("application/json") || responseText.trim().startsWith("<")) {
      console.error(`[Azure DevOps] Build ${buildId} work items API returned HTML instead of JSON`);
      throw new Error("Azure DevOps API returned an HTML error page. Please check your PAT token and organization/project configuration.");
    }

    const result = JSON.parse(responseText);
    const workItemRefs = result.value || [];

    if (workItemRefs.length === 0) {
      return [];
    }

    // Get full work item details
    const workItemIds = workItemRefs.map((ref: any) => ref.id || ref.workItem?.id).filter(Boolean);
    if (workItemIds.length === 0) {
      return [];
    }

    const detailsUrl = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems?ids=${workItemIds.join(',')}&$expand=all&api-version=7.0`;
    const detailsResponse = await fetch(detailsUrl, {
      method: 'GET',
      headers: this.headers
    });

    if (detailsResponse.ok) {
      // Check if response is HTML before parsing JSON
      const contentType = detailsResponse.headers.get("content-type");
      const responseText = await detailsResponse.text();
      if (!contentType?.includes("application/json") || responseText.trim().startsWith("<")) {
        console.error(`[Azure DevOps] Work items details API returned HTML instead of JSON`);
        return []; // Return empty array instead of throwing to allow partial results
      }
      const detailsResult = JSON.parse(responseText);
      return detailsResult.value || [];
    }

    return [];
  }

  /**
   * Get commits associated with a build
   */
  async getBuildCommits(buildId: number, projectName?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/build/builds/${buildId}/changes?api-version=7.0`;

    console.log(`[Azure DevOps] Fetching commits for build ${buildId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Check if response is HTML
      if (errorText.includes("<!DOCTYPE") || errorText.includes("<html")) {
        console.error(`[Azure DevOps] Build ${buildId} commits API returned HTML instead of JSON`);
        throw new Error("Azure DevOps API returned an HTML error page. Please check your PAT token and organization/project configuration.");
      }
      // If 404, return empty array
      if (response.status === 404) {
        console.log(`[Azure DevOps] Build ${buildId} commits endpoint not found, returning empty array`);
        return [];
      }
      console.error(`[Azure DevOps] Failed to fetch build commits:`, response.status, errorText);
      throw new Error(`Failed to fetch build commits: ${response.status} - ${errorText}`);
    }

    // Check if response is HTML before parsing JSON
    const contentType = response.headers.get("content-type");
    const responseText = await response.text();
    if (!contentType?.includes("application/json") || responseText.trim().startsWith("<")) {
      console.error(`[Azure DevOps] Build ${buildId} commits API returned HTML instead of JSON`);
      throw new Error("Azure DevOps API returned an HTML error page. Please check your PAT token and organization/project configuration.");
    }

    const result = JSON.parse(responseText);
    const changes = result.value || [];

    // Format commits
    return changes.map((change: any) => ({
      commitId: change.id || change.commitId,
      author: change.author?.name || change.author?.displayName || 'Unknown',
      comment: change.message || change.comment || '',
      url: change.location || change.url || '',
      timestamp: change.timestamp || change.date || '',
      workItems: change.workItems || []
    }));
  }

  /**
   * Get deployments for a specific release
   */
  async getDeployments(releaseId: number, projectName?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://vsrm.dev.azure.com/${this.organization}/${targetProject}/_apis/release/releases/${releaseId}/environments?api-version=7.0`;

    console.log(`[Azure DevOps] Fetching deployments for release ${releaseId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch deployments:`, response.status, errorText);
      throw new Error(`Failed to fetch deployments: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const deployments = result.value || [];
    console.log(`[Azure DevOps] Successfully fetched ${deployments.length} deployments`);
    return deployments;
  }

  /**
   * Get approval requests for a release
   */
  async getApprovals(projectName?: string, status: string = 'pending'): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://vsrm.dev.azure.com/${this.organization}/${targetProject}/_apis/release/approvals?api-version=7.0&statusFilter=${status}`;

    console.log(`[Azure DevOps] Fetching ${status} approvals`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch approvals:`, response.status, errorText);
      throw new Error(`Failed to fetch approvals: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const approvals = result.value || [];
    console.log(`[Azure DevOps] Successfully fetched ${approvals.length} approvals`);
    return approvals;
  }

  /**
   * Approve or reject a release approval
   */
  async updateApproval(approvalId: number, status: 'approved' | 'rejected', comments: string = '', projectName?: string): Promise<any> {
    const targetProject = projectName || this.project;
    const url = `https://vsrm.dev.azure.com/${this.organization}/${targetProject}/_apis/release/approvals/${approvalId}?api-version=7.0`;

    const approvalData = {
      status: status,
      comments: comments
    };

    console.log(`[Azure DevOps] Updating approval ${approvalId} to ${status}`);

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(approvalData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to update approval:`, response.status, errorText);
      throw new Error(`Failed to update approval: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`[Azure DevOps] Successfully updated approval`);
    return result;
  }

  /**
   * Get deployment summary for dashboards
   */
  async getDeploymentSummary(projectName?: string, daysBack: number = 30): Promise<{
    totalReleases: number;
    successfulReleases: number;
    failedReleases: number;
    pendingReleases: number;
    recentReleases: any[];
  }> {
    const targetProject = projectName || this.project;

    console.log(`[Azure DevOps] Fetching deployment summary for last ${daysBack} days`);

    try {
      const releases = await this.getReleases(undefined, 100, targetProject);

      // Filter releases from last N days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);

      const recentReleases = releases.filter((release: any) => {
        const releaseDate = new Date(release.createdOn);
        return releaseDate >= cutoffDate;
      });

      const summary = {
        totalReleases: recentReleases.length,
        successfulReleases: recentReleases.filter((r: any) => r.status === 'succeeded' || r.status === 'active').length,
        failedReleases: recentReleases.filter((r: any) => r.status === 'rejected' || r.status === 'abandoned').length,
        pendingReleases: recentReleases.filter((r: any) => r.status === 'undefined' || r.status === 'notStarted').length,
        recentReleases: recentReleases.slice(0, 10)
      };

      console.log(`[Azure DevOps] Deployment summary:`, summary);
      return summary;
    } catch (error) {
      console.error('[Azure DevOps] Error fetching deployment summary:', error);
      throw error;
    }
  }

  /**
   * Fetch test runs for the project
   */
  async getTestRuns(projectName?: string, limit: number = 50): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/test/runs?api-version=7.0&$top=${limit}`;

    console.log(`[Azure DevOps] Fetching test runs for project: ${targetProject}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch test runs:`, response.status, errorText);
      throw new Error(`Failed to fetch test runs: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const testRuns = result.value || [];

    // Enhance test runs with calculated statistics if not present
    const enhancedRuns = testRuns.map((run: any) => {
      // If runStatistics is available, calculate counts from it
      if (run.runStatistics && Array.isArray(run.runStatistics) && run.runStatistics.length > 0) {
        const stats = run.runStatistics;
        const total = stats.reduce((sum: number, s: any) => sum + (s.count || 0), 0);
        const passed = stats.find((s: any) => s.outcome === 'Passed' || s.outcome === 'passed')?.count || 0;
        const failed = stats.find((s: any) => s.outcome === 'Failed' || s.outcome === 'failed')?.count || 0;
        const skipped = stats.find((s: any) =>
          s.outcome === 'NotExecuted' ||
          s.outcome === 'notExecuted' ||
          s.outcome === 'Skipped' ||
          s.outcome === 'skipped'
        )?.count || 0;

        return {
          ...run,
          totalTests: run.totalTests || total,
          passedTests: run.passedTests || passed,
          failedTests: run.failedTests || failed,
          skippedTests: run.skippedTests || skipped,
        };
      }

      // If statistics are in a different format, try to extract them
      if (run.statistics) {
        const stats = run.statistics;
        return {
          ...run,
          totalTests: run.totalTests || (stats.total || 0),
          passedTests: run.passedTests || (stats.passed || 0),
          failedTests: run.failedTests || (stats.failed || 0),
          skippedTests: run.skippedTests || (stats.skipped || 0),
        };
      }

      return run;
    });

    console.log(`[Azure DevOps] Successfully fetched ${enhancedRuns.length} test runs`);
    return enhancedRuns;
  }

  /**
   * Fetch test results for a specific test run
   */
  async getTestResults(testRunId: number, projectName?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/test/runs/${testRunId}/results?api-version=7.0`;

    console.log(`[Azure DevOps] Fetching test results for test run: ${testRunId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch test results:`, response.status, errorText);
      throw new Error(`Failed to fetch test results: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const testResults = result.value || [];
    console.log(`[Azure DevOps] Successfully fetched ${testResults.length} test results`);
    return testResults;
  }

  /**
   * Fetch code coverage for a build
   */
  async getCodeCoverage(buildId: number, projectName?: string): Promise<any> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/test/codecoverage?buildId=${buildId}&api-version=7.0`;

    console.log(`[Azure DevOps] Fetching code coverage for build: ${buildId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      // Code coverage might not be available for all builds
      if (response.status === 404) {
        console.log(`[Azure DevOps] Code coverage not available for build: ${buildId}`);
        return null;
      }
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch code coverage:`, response.status, errorText);
      throw new Error(`Failed to fetch code coverage: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`[Azure DevOps] Successfully fetched code coverage`);
    return result;
  }

  /**
   * Fetch build artifacts for a specific build
   */
  async getBuildArtifacts(buildId?: number, projectName?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    let url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/build/artifacts?api-version=7.0`;

    if (buildId) {
      url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/build/builds/${buildId}/artifacts?api-version=7.0`;
    }

    console.log(`[Azure DevOps] Fetching build artifacts${buildId ? ` for build: ${buildId}` : ''}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      // Artifacts might not be available
      if (response.status === 404) {
        console.log(`[Azure DevOps] No artifacts found${buildId ? ` for build: ${buildId}` : ''}`);
        return [];
      }
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch artifacts:`, response.status, errorText);
      throw new Error(`Failed to fetch artifacts: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const artifacts = result.value || [];
    console.log(`[Azure DevOps] Successfully fetched ${artifacts.length} artifacts`);
    return artifacts;
  }

  /**
   * Summarize published pipeline artifacts and build outcomes from recent runs.
   * Artifact totals are summed across the most recent `maxArtifactBuilds` runs (parallel API calls).
   * Success metrics use up to `maxMetricBuilds` recent builds from the same feed.
   */
  async getBuildPublishSummary(
    projectName?: string,
    options?: { maxArtifactBuilds?: number; maxMetricBuilds?: number },
  ): Promise<{
    publishedArtifacts: number;
    buildsCheckedForArtifacts: number;
    buildsWithArtifacts: number;
    completedBuilds: number;
    succeededBuilds: number;
    failedBuilds: number;
    successRatePercent: number;
  }> {
    const maxArtifactBuilds = Math.min(30, options?.maxArtifactBuilds ?? 20);
    const maxMetricBuilds = Math.min(100, options?.maxMetricBuilds ?? 50);
    const targetProject = projectName || this.project;

    const data = await this.getBuilds(undefined, undefined);
    const allBuilds: any[] = data.value || data || [];
    const sample = Array.isArray(allBuilds) ? allBuilds.slice(0, maxMetricBuilds) : [];
    const artifactBuilds = sample.slice(0, maxArtifactBuilds);

    const completed = sample.filter((b: any) => b.result && String(b.result).trim() !== "");
    const succeeded = completed.filter((b: any) => {
      const r = String(b.result).toLowerCase();
      return r === "succeeded" || r === "success";
    });
    const failed = completed.filter((b: any) => {
      const r = String(b.result).toLowerCase();
      return r === "failed" || r === "failure";
    });
    const successRatePercent = completed.length
      ? Math.round((succeeded.length / completed.length) * 100)
      : 0;

    let publishedArtifacts = 0;
    let buildsWithArtifacts = 0;
    const artifactResults = await Promise.all(
      artifactBuilds.map(async (b: any) => {
        try {
          const arts = await this.getBuildArtifacts(b.id, targetProject);
          const n = Array.isArray(arts) ? arts.length : 0;
          if (n > 0) buildsWithArtifacts++;
          return n;
        } catch {
          return 0;
        }
      }),
    );
    publishedArtifacts = artifactResults.reduce((a, b) => a + b, 0);

    return {
      publishedArtifacts,
      buildsCheckedForArtifacts: artifactBuilds.length,
      buildsWithArtifacts,
      completedBuilds: completed.length,
      succeededBuilds: succeeded.length,
      failedBuilds: failed.length,
      successRatePercent,
    };
  }

  /**
   * Fetch detailed build information including stages and jobs
   */
  async getBuildDetails(buildId: number, projectName?: string): Promise<any> {
    const targetProject = projectName || this.project;
    // Include timeline in build details by using $expand parameter
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/build/builds/${buildId}?api-version=7.0&$expand=timeline`;

    console.log(`[Azure DevOps] Fetching build details for build: ${buildId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch build details:`, response.status, errorText);
      throw new Error(`Failed to fetch build details: ${response.status} - ${errorText}`);
    }

    const build = await response.json();
    console.log(`[Azure DevOps] Successfully fetched build details`);
    return build;
  }

  /**
   * Fetch build timeline which contains stages and jobs
   */
  async getBuildTimeline(buildId: number, projectName?: string): Promise<any> {
    const targetProject = projectName || this.project;
    // Try with different API versions and parameters
    const urls = [
      `https://dev.azure.com/${this.organization}/${targetProject}/_apis/build/builds/${buildId}/timeline?api-version=7.0`,
      `https://dev.azure.com/${this.organization}/${targetProject}/_apis/build/builds/${buildId}/timeline?api-version=6.0`,
      `https://dev.azure.com/${this.organization}/${targetProject}/_apis/build/builds/${buildId}/timeline?api-version=7.0&changeId=1`,
    ];

    for (const url of urls) {
      try {
        console.log(`[Azure DevOps] Fetching build timeline for build: ${buildId} in project: ${targetProject} using: ${url}`);

        const response = await fetch(url, {
          method: 'GET',
          headers: this.headers
        });

        if (response.ok) {
          const timeline = await response.json();
          const recordCount = timeline.records?.length || 0;
          console.log(`[Azure DevOps] Successfully fetched build timeline with ${recordCount} records for build ${buildId}`);

          // Log timeline structure for debugging
          if (recordCount > 0) {
            const types = [...new Set(timeline.records.map((r: any) => r.type))];
            console.log(`[Azure DevOps] Timeline record types:`, types);
            return timeline;
          } else {
            console.log(`[Azure DevOps] Timeline is empty for build ${buildId}, trying next URL...`);
            continue;
          }
        } else {
          const errorText = await response.text();
          console.error(`[Azure DevOps] Failed to fetch build timeline for ${buildId}:`, response.status);
          console.error(`[Azure DevOps] Error response (first 500 chars):`, errorText.substring(0, 500));

          // If 404, timeline might not be available yet (build still running)
          if (response.status === 404) {
            console.log(`[Azure DevOps] Timeline not available for build ${buildId} (404 - might still be running or not started)`);
            continue; // Try next URL
          } else if (response.status === 403) {
            console.error(`[Azure DevOps] Timeline access forbidden (403) for build ${buildId} - check PAT permissions`);
            continue; // Try next URL
          } else if (response.status === 401) {
            console.error(`[Azure DevOps] Timeline unauthorized (401) for build ${buildId} - check PAT token`);
            // Don't try other URLs if unauthorized
            break;
          }
        }
      } catch (err: any) {
        console.error(`[Azure DevOps] Error fetching timeline from ${url}:`, err.message);
        continue; // Try next URL
      }
    }

    // If all URLs failed, return empty timeline
    console.warn(`[Azure DevOps] All timeline fetch attempts failed for build ${buildId}, returning empty timeline`);
    return { records: [] };
  }

  /**
   * Check if a work item exists in Azure DevOps by title and type
   * Returns the work item ID if found, null otherwise
   */
  async findWorkItemByTitle(title: string, workItemType: string, projectName?: string): Promise<number | null> {
    const targetProject = projectName || this.project;

    // Use WIQL to search for work item by title
    const wiqlQuery = {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${targetProject}' AND [System.WorkItemType] = '${workItemType}' AND [System.Title] = '${title.replace(/'/g, "''")}' ORDER BY [System.CreatedDate] DESC`
    };

    const wiqlUrl = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/wiql?api-version=7.0`;

    console.log(`[Azure DevOps] Searching for ${workItemType} with title: "${title}"`);

    try {
      const response = await fetch(wiqlUrl, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(wiqlQuery)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Azure DevOps] Failed to search for work item:`, response.status, errorText);
        return null;
      }

      const result = await response.json();
      const workItems = result.workItems || [];

      if (workItems.length > 0) {
        const workItemId = workItems[0].id;
        console.log(`[Azure DevOps] Found existing ${workItemType} with ID: ${workItemId}`);
        return workItemId;
      } else {
        console.log(`[Azure DevOps] No existing ${workItemType} found with title: "${title}"`);
        return null;
      }
    } catch (error) {
      console.error(`[Azure DevOps] Error searching for work item:`, error);
      return null;
    }
  }

  /**
   * Update an existing work item in Azure DevOps
   */
  // async updateWorkItem(
  //   workItemId: number,
  //   updates: Record<string, any>,
  //   projectName?: string
  // ): Promise<any> {
  //   const targetProject = projectName || this.project;
  //   const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems/${workItemId}?api-version=7.0`;

  //   // Convert updates to JSON Patch format
  //   const operations: WorkItemCreateRequest[] = Object.entries(updates).map(([key, value]) => ({
  //     op: 'replace',
  //     path: `/fields/${key}`,
  //     value
  //   }));

  //   console.log(`[Azure DevOps] Updating work item ${workItemId}`);
  //   console.log(`[Azure DevOps] Operations:`, JSON.stringify(operations, null, 2));

  //   const response = await fetch(url, {
  //     method: 'PATCH',
  //     headers: {
  //       ...this.headers,
  //       'Content-Type': 'application/json-patch+json'
  //     },
  //     body: JSON.stringify(operations)
  //   });

  //   if (!response.ok) {
  //     const errorText = await response.text();
  //     console.error(`[Azure DevOps] Failed to update work item ${workItemId}:`, response.status, errorText);
  //     throw new Error(`Failed to update work item: ${response.status} - ${errorText}`);
  //   }

  //   const workItem = await response.json();
  //   console.log(`[Azure DevOps] Successfully updated work item ${workItemId}`);
  //   return workItem;
  // }

  /**
   * Check if a parent work item exists in Azure DevOps
   * Used for hierarchy validation before creating child items
   */
  async checkParentExists(parentId: number, projectName?: string): Promise<boolean> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems/${parentId}?api-version=7.0`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers
      });

      if (response.ok) {
        console.log(`[Azure DevOps] Parent work item ${parentId} exists`);
        return true;
      } else {
        console.log(`[Azure DevOps] Parent work item ${parentId} does not exist`);
        return false;
      }
    } catch (error) {
      console.error(`[Azure DevOps] Error checking parent existence:`, error);
      return false;
    }
  }

  /**
   * Get work item by ID
   */
  // async getWorkItemById(workItemId: number, projectName?: string): Promise<any | null> {
  //   const targetProject = projectName || this.project;
  //   const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems/${workItemId}?api-version=7.0&$expand=all`;

  //   try {
  //     const response = await fetch(url, {
  //       method: 'GET',
  //       headers: this.headers
  //     });

  //     if (!response.ok) {
  //       const errorText = await response.text();
  //       console.error(`[Azure DevOps] Failed to fetch work item ${workItemId}:`, response.status, errorText);
  //       return null;
  //     }

  //     const workItem = await response.json();
  //     console.log(`[Azure DevOps] Successfully fetched work item ${workItemId}`);
  //     return workItem;
  //   } catch (error) {
  //     console.error(`[Azure DevOps] Error fetching work item:`, error);
  //     return null;
  //   }
  // }

  /**
   * Delete a work item from Azure DevOps
   */
  async deleteWorkItem(workItemId: number, projectName?: string): Promise<void> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems/${workItemId}?api-version=7.0`;

    console.log(`[Azure DevOps] Deleting work item ${workItemId} from project: ${targetProject}`);
    console.log(`[Azure DevOps] Delete URL: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Azure DevOps] Failed to delete work item ${workItemId}:`, response.status, errorText);

        // Provide more specific error messages
        if (response.status === 404) {
          throw new Error(`Work item ${workItemId} not found in Azure DevOps. It may have already been deleted.`);
        } else if (response.status === 401) {
          throw new Error(`Authentication failed. Please verify your PAT token has the correct permissions.`);
        } else if (response.status === 403) {
          throw new Error(`Access denied. You do not have permission to delete work items in this project.`);
        } else {
          throw new Error(`Failed to delete work item: ${response.status} - ${errorText}`);
        }
      }

      console.log(`[Azure DevOps] Successfully deleted work item ${workItemId}`);
    } catch (error) {
      console.error(`[Azure DevOps] Error deleting work item:`, error);
      throw error;
    }
  }

  /**
   * Get all iterations (sprints) for a project
   * @param projectName - Optional project name override
   * @returns Array of iterations with id, name, path, startDate, endDate
   */
  async getAllIterations(projectName?: string): Promise<Array<{
    id: number;
    name: string;
    path: string;
    startDate?: string;
    endDate?: string;
    timeFrame?: string;
  }>> {
    const targetProject = projectName || this.project;
    // Use depth=3 to ensure we get all nested iterations
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/classificationnodes/iterations?$depth=3&api-version=7.0`;

    console.log(`[Azure DevOps] Fetching all iterations for project: ${targetProject}`);
    console.log(`[Azure DevOps] URL: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Azure DevOps] Failed to fetch iterations: ${response.status}`, errorText);
        throw new Error(`Failed to fetch iterations: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      console.log(`[Azure DevOps] Raw iterations response structure:`, JSON.stringify(data, null, 2).substring(0, 500));

      // Extract all iterations from the tree structure
      const iterations: Array<{
        id: number;
        name: string;
        path: string;
        startDate?: string;
        endDate?: string;
        timeFrame?: string;
      }> = [];

      const extractIterations = (node: any, depth: number = 0) => {
        const indent = '  '.repeat(depth);
        console.log(`${indent}[Azure DevOps] Processing node:`, {
          id: node.id,
          name: node.name,
          path: node.path,
          hasChildren: !!node.children,
          childrenCount: node.children?.length || 0
        });

        if (node.id && node.name && node.path) {
          // Skip root iteration node - check if it's the root by path pattern
          // Root iteration path is typically: \\ProjectName\\Iteration
          // Child iterations are: \\ProjectName\\Iteration\\IterationName
          const pathParts = node.path.split('\\').filter((p: string) => p.length > 0);
          const isRootNode = pathParts.length <= 2 ||
            (pathParts.length === 2 && pathParts[1] === 'Iteration') ||
            node.path === `\\${targetProject}\\Iteration` ||
            node.path === `\\${targetProject}\\Iteration\\`;

          if (!isRootNode) {
            console.log(`${indent}[Azure DevOps] Adding iteration:`, {
              id: node.id,
              name: node.name,
              path: node.path,
              pathParts: pathParts,
              startDate: node.attributes?.startDate,
              endDate: node.attributes?.finishDate
            });
            iterations.push({
              id: node.id,
              name: node.name,
              path: node.path,
              startDate: node.attributes?.startDate,
              endDate: node.attributes?.finishDate,
              timeFrame: node.attributes?.timeFrame
            });
          } else {
            console.log(`${indent}[Azure DevOps] Skipping root iteration node:`, node.path, `(pathParts: ${pathParts.length})`);
          }
        }

        if (node.children && Array.isArray(node.children)) {
          node.children.forEach((child: any) => extractIterations(child, depth + 1));
        }
      };

      extractIterations(data);

      console.log(`[Azure DevOps] Successfully extracted ${iterations.length} iterations from tree`);
      if (iterations.length === 0) {
        console.warn(`[Azure DevOps] No iterations found! Raw data structure:`, JSON.stringify(data, null, 2).substring(0, 1000));
      }
      return iterations;
    } catch (error) {
      console.error(`[Azure DevOps] Error fetching iterations:`, error);
      throw error;
    }
  }

  /**
   * Get work items for a specific iteration (sprint) path
   * @param iterationPath - The iteration path (e.g., "\\ProjectName\\Iteration\\Iteration 1")
   * @param projectName - Optional project name override
   * @returns Array of work items in the iteration
   */
  async getWorkItemsByIteration(iterationPath: string, projectName?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/wiql?api-version=7.0`;

    console.log(`[Azure DevOps] Fetching work items for iteration: ${iterationPath}`);
    console.log(`[Azure DevOps] Original path: ${iterationPath}`);

    // Normalize the iteration path for comparison
    const normalizedIterationPath = iterationPath.toLowerCase().trim();

    // Strategy: Fetch all work items for the project and filter by iteration path
    // This is more reliable than trying to format the path correctly for WIQL
    const wiqlQuery = {
      query: `SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.IterationPath], [System.AssignedTo], [Microsoft.VSTS.Scheduling.StoryPoints] FROM WorkItems WHERE [System.TeamProject] = '${targetProject}' ORDER BY [System.ChangedDate] DESC`
    };

    console.log(`[Azure DevOps] Fetching all work items for project and filtering by iteration path`);

    // WIQL queries require Content-Type: application/json
    const wiqlHeaders = {
      ...this.headers,
      'Content-Type': 'application/json'
    };

    let workItemIds: number[] = [];

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: wiqlHeaders,
        body: JSON.stringify(wiqlQuery)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Azure DevOps] Failed to fetch work items: ${response.status}`, errorText.substring(0, 200));
        throw new Error(`Failed to fetch work items: ${response.status} - ${errorText.substring(0, 200)}`);
      }

      const result = await response.json();
      workItemIds = result.workItems?.map((item: any) => item.id) || [];

      console.log(`[Azure DevOps] Found ${workItemIds.length} total work items in project, will filter by iteration path`);
    } catch (err) {
      console.error(`[Azure DevOps] Error fetching work items:`, err);
      throw err;
    }

    if (workItemIds.length === 0) {
      console.warn(`[Azure DevOps] No work items found in project: ${targetProject}`);
      return [];
    }

    // Get work item details in batches
    const batchSize = 200;
    const batches: number[][] = [];

    for (let i = 0; i < workItemIds.length; i += batchSize) {
      batches.push(workItemIds.slice(i, i + batchSize));
    }

    // Fetch all batches in parallel
    const batchPromises = batches.map(async (batch) => {
      const detailsUrl = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems?ids=${batch.join(',')}&api-version=7.0&$expand=relations`;

      try {
        const detailsResponse = await fetch(detailsUrl, {
          method: 'GET',
          headers: this.headers
        });

        if (detailsResponse.ok) {
          const detailsResult = await detailsResponse.json();
          return detailsResult.value || [];
        } else {
          console.error(`[Azure DevOps] Failed to fetch batch:`, detailsResponse.status);
          return [];
        }
      } catch (error) {
        console.error(`[Azure DevOps] Error fetching batch:`, error);
        return [];
      }
    });

    // Wait for all batches to complete
    const batchResults = await Promise.all(batchPromises);
    let allWorkItems = batchResults.flat();

    // Log all iteration paths found in work items for debugging
    const allIterationPaths = allWorkItems.map((wi: any) => wi.fields?.['System.IterationPath']).filter(Boolean);
    const uniquePaths = [...new Set(allIterationPaths)];
    console.log(`[Azure DevOps] Found ${allWorkItems.length} work items with ${uniquePaths.length} unique iteration paths`);
    if (uniquePaths.length > 0 && uniquePaths.length <= 10) {
      console.log(`[Azure DevOps] Unique iteration paths:`, uniquePaths);
    }
    console.log(`[Azure DevOps] Expected iteration path: ${iterationPath}`);

    // Filter work items to ensure they match the iteration path
    // Try multiple matching strategies:
    // 1. Exact match (case-insensitive, normalized)
    // 2. Match by iteration name (last part of path)
    // 3. Match if path ends with iteration name
    const iterationName = iterationPath.split('\\').pop()?.toLowerCase() || '';

    const filteredWorkItems = allWorkItems.filter((wi: any) => {
      const wiIterationPath = (wi.fields?.['System.IterationPath'] || '').trim();
      if (!wiIterationPath) {
        return false;
      }

      const wiIterationPathNormalized = wiIterationPath.toLowerCase();

      // Exact match (case-insensitive)
      if (wiIterationPathNormalized === normalizedIterationPath) {
        return true;
      }

      // Match by iteration name (last part) - case insensitive
      const wiIterationName = wiIterationPath.split('\\').pop()?.toLowerCase() || '';
      if (wiIterationName && iterationName && wiIterationName === iterationName) {
        return true;
      }

      // Match if path ends with iteration name (case insensitive)
      if (iterationName && wiIterationPathNormalized.endsWith(iterationName.toLowerCase())) {
        return true;
      }

      return false;
    });

    if (filteredWorkItems.length !== allWorkItems.length) {
      console.log(`[Azure DevOps] Filtered ${allWorkItems.length} work items down to ${filteredWorkItems.length} that match iteration`);
    }

    console.log(`[Azure DevOps] Successfully fetched ${filteredWorkItems.length} work items for iteration: ${iterationPath}`);

    // Log sample work items for debugging
    if (filteredWorkItems.length > 0) {
      const sample = filteredWorkItems[0];
      console.log(`[Azure DevOps] Sample work item:`, {
        id: sample.id,
        title: sample.fields?.['System.Title']?.substring(0, 50),
        type: sample.fields?.['System.WorkItemType'],
        state: sample.fields?.['System.State'],
        iterationPath: sample.fields?.['System.IterationPath']
      });
    } else if (allWorkItems.length > 0) {
      console.warn(`[Azure DevOps] Work items found but none match iteration. Sample work item:`, {
        id: allWorkItems[0].id,
        title: allWorkItems[0].fields?.['System.Title']?.substring(0, 50),
        iterationPath: allWorkItems[0].fields?.['System.IterationPath']
      });
      console.warn(`[Azure DevOps] Expected: "${iterationPath}"`);
      console.warn(`[Azure DevOps] Found paths:`, uniquePaths.slice(0, 5));
    }

    return filteredWorkItems;
  }

  /**
   * Fetch attachments from a work item
   * Returns array of attachment metadata
   */
  async getWorkItemAttachments(workItemId: number, projectName?: string): Promise<any[]> {
    const targetProject = projectName || this.project;
    const url = `https://dev.azure.com/${this.organization}/${targetProject}/_apis/wit/workitems/${workItemId}?$expand=relations&api-version=7.0`;

    console.log(`[Azure DevOps] Fetching attachments for work item ${workItemId}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Azure DevOps] Failed to fetch work item:`, response.status, errorText);
      throw new Error(`Failed to fetch work item: ${response.status} - ${errorText}`);
    }

    const workItem = await response.json();

    // Filter relations to get only attachments
    const attachmentRelations = workItem.relations?.filter((rel: any) =>
      rel.rel === 'AttachedFile'
    ) || [];

    const attachments = attachmentRelations.map((rel: any) => ({
      id: rel.url.split('/').pop(),
      url: rel.url,
      name: rel.attributes?.name || 'Unknown',
      comment: rel.attributes?.comment || ''
    }));

    console.log(`[Azure DevOps] Found ${attachments.length} attachments for work item ${workItemId}`);
    return attachments;
  }
}