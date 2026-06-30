import type { StoryField, StoryState } from "./state";
import type { Organization, Project } from "./types";

export interface QuickReplyMeta {
  field: StoryField;
  value: string;
  label: string;
}

export interface ParsedQuickReply {
  isQuickReply: boolean;
  field?: StoryField;
  value?: string | number;
  rawLabel?: string;
}

const QUICK_REPLY_PATTERNS: Record<string, { field: StoryField; extractValue: (match: string) => string | number }> = {
  "^Use:\\s*(.+)$": { field: "organization", extractValue: (m) => m },
  "^Organization:\\s*(.+)$": { field: "organization", extractValue: (m) => m },
  "^Project:\\s*(.+)$": { field: "project", extractValue: (m) => m },
  "^(High|Medium|Low)$": { field: "priority", extractValue: (m) => m },
  "^(\\d+)\\s*point": { field: "storyPoints", extractValue: (m) => parseInt(m, 10) },
  "^(End User|Administrator|Developer|Product Owner|Customer|System)$": { field: "persona", extractValue: (m) => m },
};

export function parseQuickReply(message: string): ParsedQuickReply {
  const trimmed = message.trim();
  
  for (const [pattern, config] of Object.entries(QUICK_REPLY_PATTERNS)) {
    const regex = new RegExp(pattern, "i");
    const match = trimmed.match(regex);
    if (match) {
      return {
        isQuickReply: true,
        field: config.field,
        value: config.extractValue(match[1] || match[0]),
        rawLabel: trimmed,
      };
    }
  }
  
  return { isQuickReply: false };
}

export interface ExtractedFields {
  [key: string]: string | number | undefined;
}

export function tryExtractFieldsFromText(
  message: string, 
  currentField: StoryField | null
): ExtractedFields {
  const extracted: ExtractedFields = {};
  const trimmedMessage = message.trim();
  
  // Strip acknowledgement prefixes for cleaner extraction
  const ACK_PREFIX_PATTERN = /^(ok|okay|k|yes|no|yep|nope|sure|alright|fine|maybe|later|yeah|yea|ya|i guess|i think|got it|sounds good|makes sense|understood|cool|great|nice|right)[,.\s]+/i;
  const strippedMessage = trimmedMessage.replace(ACK_PREFIX_PATTERN, '').trim();
  const textToExtract = strippedMessage || trimmedMessage; // Use stripped version if available
  const lowerTextToExtract = textToExtract.toLowerCase();
  
  // Priority extraction - STRICT match only (whole word at start or standalone)
  if (currentField === "priority") {
    if (/^high$/i.test(lowerTextToExtract) || /^high\b/i.test(lowerTextToExtract)) extracted.priority = "High";
    else if (/^medium$/i.test(lowerTextToExtract) || /^medium\b/i.test(lowerTextToExtract)) extracted.priority = "Medium";
    else if (/^low$/i.test(lowerTextToExtract) || /^low\b/i.test(lowerTextToExtract)) extracted.priority = "Low";
    else if (/^critical$/i.test(lowerTextToExtract)) extracted.priority = "Critical";
    else if (/^urgent$/i.test(lowerTextToExtract)) extracted.priority = "Urgent";
    // Don't extract if no valid priority keyword found
  }
  
  // Story points extraction - STRICT numeric match only
  if (currentField === "storyPoints") {
    // Only accept if message is primarily a number (after stripping acknowledgement)
    const pointsMatch = textToExtract.match(/^(\d+)\s*(?:point|pts?)?$/i);
    if (pointsMatch) {
      const points = parseInt(pointsMatch[1], 10);
      if ([1, 2, 3, 5, 8, 13, 21].includes(points)) {
        extracted.storyPoints = points;
      }
    }
  }
  
  // Persona extraction - REQUIRE role keyword present (no fallback)
  if (currentField === "persona") {
    // Full-word patterns to avoid false matches like "friend" matching "end"
    const personaPatterns = [
      /\buser\b/i, /\badmin(istrator)?\b/i, /\bdeveloper\b/i, /\bcustomer\b/i, 
      /\bowner\b/i, /\bsystem\b/i, /\bmanager\b/i, /\banalyst\b/i, 
      /\bstakeholder\b/i, /\bengineer\b/i, /\bproduct\b/i, /\bend user\b/i,
      /\bclient\b/i, /\bmember\b/i, /\bstaff\b/i, /\bemployee\b/i, /\bteam\b/i, /\blead\b/i
    ];
    for (const pattern of personaPatterns) {
      if (pattern.test(textToExtract)) {
        // Return the stripped text as the persona value
        extracted.persona = textToExtract;
        break;
      }
    }
    // NO FALLBACK - if no role keyword found, don't extract persona
    // This ensures "maybe later" is NOT extracted as a persona
  }
  
  // Goal/benefit extraction - still use length-based heuristics 
  // (semantic validation is done separately in validateFieldResponse)
  if (currentField === "goal" || currentField === "benefit") {
    if (trimmedMessage.length > 5 && trimmedMessage.length < 500) {
      extracted[currentField] = trimmedMessage; // Use original for goal/benefit to preserve context
    }
  }
  
  return extracted;
}

export function buildOrganizationSuggestions(organizations: Organization[]): string[] {
  return organizations.slice(0, 5).map(org => `Use: ${org.name}`);
}

export function buildProjectSuggestions(projects: Project[]): string[] {
  return projects.slice(0, 5).map(proj => `Project: ${proj.name}`);
}

export function formatFieldValue(field: StoryField, value: string | number | undefined): string {
  if (value === undefined) return "Not set";
  
  if (field === "storyPoints") {
    return `${value} point${value !== 1 ? "s" : ""}`;
  }
  
  return String(value);
}

export function generateUserStoryStatement(state: StoryState): string {
  const { persona, goal, benefit } = state.provided;
  
  if (!persona || !goal) {
    return "";
  }
  
  const benefitPart = benefit ? ` so that ${benefit}` : "";
  return `As a ${persona}, I want ${goal}${benefitPart}.`;
}

export function generateStoryTitle(goal: string): string {
  const cleanGoal = goal.replace(/^(to\s+|i want to\s+|i need to\s+)/i, "").trim();
  
  const words = cleanGoal.split(/\s+/).slice(0, 8);
  let title = words.join(" ");
  
  if (title.length > 60) {
    title = title.substring(0, 57) + "...";
  }
  
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function generateAcceptanceCriteria(goal: string, benefit: string | undefined): string[] {
  const criteria: string[] = [];
  
  criteria.push(`Given the feature is implemented, the user can ${goal.toLowerCase()}`);
  
  if (benefit) {
    criteria.push(`The solution achieves ${benefit.toLowerCase()}`);
  }
  
  criteria.push("The implementation follows project coding standards");
  criteria.push("All relevant tests pass successfully");
  criteria.push("The feature is documented appropriately");
  
  return criteria;
}

export function isSkipMessage(message: string): boolean {
  const skipPatterns = [
    /^skip/i,
    /^skip for now/i,
    /^leave (it )?(blank|empty)/i,
    /^n\/a$/i,
    /^none$/i,
    /^-$/,
  ];
  
  return skipPatterns.some(pattern => pattern.test(message.trim()));
}

export function isConfirmationMessage(message: string): boolean {
  const confirmPatterns = [
    /^(yes|yeah|yep|yup|sure|ok|okay|confirm|approved?|create|do it|go ahead)/i,
    /^create (the |this )?story/i,
    /^confirm story/i,
  ];
  
  return confirmPatterns.some(pattern => pattern.test(message.trim()));
}

export function isEditRequestMessage(message: string): boolean {
  const editPatterns = [
    /^(edit|change|modify|update)/i,
    /^(i want to )?(edit|change|modify)/i,
    /^edit details/i,
  ];
  
  return editPatterns.some(pattern => pattern.test(message.trim()));
}

export function detectEditField(message: string): string | null {
  const msg = message.toLowerCase().trim();
  
  if (/edit (the )?persona/i.test(msg)) return "persona";
  if (/edit (the )?goal/i.test(msg)) return "goal";
  if (/edit (the )?benefit/i.test(msg)) return "benefit";
  if (/edit (the )?priority/i.test(msg)) return "priority";
  if (/edit (the )?(story )?points/i.test(msg)) return "storyPoints";
  if (/edit (the )?acceptance criteria/i.test(msg)) return "acceptance_criteria";
  
  return null;
}

export function isCancelEditsMessage(message: string): boolean {
  const cancelPatterns = [
    /^cancel/i,
    /^cancel edit/i,
    /^done edit/i,
    /^never ?mind/i,
    /^go back/i,
  ];
  return cancelPatterns.some(pattern => pattern.test(message.trim()));
}

export function isStartOverMessage(message: string): boolean {
  // Note: "cancel", "stop", "exit", "quit" are handled by isCancelRequest in storyAgent
  // IMPORTANT: Only match EXPLICIT restart commands, not "create a user story to..." which is goal input
  const trimmed = message.trim();
  
  // Only match explicit restart phrases (not combined with other content)
  // The $ anchor ensures we only match when the phrase is the ENTIRE message
  const explicitRestartPatterns = [
    /^(start over|reset|nevermind|never mind)$/i,
    /^(let'?s? )?(start|begin) (over|again|fresh)$/i,
    /^create (a )?(new |another )?(user )?story$/i,  // "create a new user story" alone - NOT "create a user story to [goal]"
  ];
  
  return explicitRestartPatterns.some(pattern => pattern.test(trimmed));
}

export function isYesGenerateACMessage(message: string): boolean {
  const yesPatterns = [
    /^yes/i,
    /^generate/i,
    /^yes.*generate/i,
    /^please generate/i,
    /^sure/i,
    /^ok/i,
    /^okay/i,
    /^yeah/i,
    /^yep/i,
  ];
  return yesPatterns.some(pattern => pattern.test(message.trim()));
}

export function isNoSkipACMessage(message: string): boolean {
  const noPatterns = [
    /^no/i,
    /^i'?ll add/i,
    /^skip/i,
    /^i'?ll write/i,
    /^write my own/i,
    /^add my own/i,
    /^don'?t add/i,
  ];
  return noPatterns.some(pattern => pattern.test(message.trim()));
}

export function isAcceptACMessage(message: string): boolean {
  const acceptPatterns = [
    /^accept/i,
    /^looks good/i,
    /^approve/i,
    /^confirmed?/i,
    /^yes/i,
    /^ok/i,
    /^okay/i,
  ];
  return acceptPatterns.some(pattern => pattern.test(message.trim()));
}

export function isRejectACMessage(message: string): boolean {
  const rejectPatterns = [
    /^reject/i,
    /^no/i,
    /^don'?t use/i,
    /^discard/i,
  ];
  return rejectPatterns.some(pattern => pattern.test(message.trim()));
}

export function isYesAddTestsMessage(message: string): boolean {
  const yesPatterns = [
    /^yes/i,
    /^add test/i,
    /^sure/i,
    /^ok/i,
    /^okay/i,
    /^yeah/i,
    /^yep/i,
    /want.*test/i,
    /add.*test/i,
  ];
  return yesPatterns.some(pattern => pattern.test(message.trim()));
}

export function isNoSkipTestsMessage(message: string): boolean {
  const noPatterns = [
    /^no/i,
    /^skip/i,
    /^don'?t/i,
    /^nope/i,
    /no test/i,
    /without test/i,
  ];
  return noPatterns.some(pattern => pattern.test(message.trim()));
}

export function isAcceptTestsMessage(message: string): boolean {
  const acceptPatterns = [
    /^looks?\s*good/i,
    /^accept/i,
    /^confirm/i,
    /^yes/i,
    /^ok/i,
    /^okay/i,
    /^great/i,
    /^perfect/i,
    /these are good/i,
    /use these/i,
    /approve/i,
  ];
  return acceptPatterns.some(pattern => pattern.test(message.trim()));
}

export function isRejectTestsMessage(message: string): boolean {
  const rejectPatterns = [
    /^no/i,
    /^reject/i,
    /^skip/i,
    /don'?t use/i,
    /try again/i,
    /regenerate/i,
  ];
  return rejectPatterns.some(pattern => pattern.test(message.trim()));
}

export function isDoneAddingTestsMessage(message: string): boolean {
  const donePatterns = [
    /^done/i,
    /^that'?s?\s*(all|it)/i,
    /^finish/i,
    /^complete/i,
    /^no\s*more/i,
    /^i'?m?\s*done/i,
  ];
  return donePatterns.some(pattern => pattern.test(message.trim()));
}

export function isYesAssignMessage(message: string): boolean {
  const yesPatterns = [
    /^yes/i,
    /^assign/i,
    /^sure/i,
    /^ok/i,
    /^okay/i,
    /^yeah/i,
    /^yep/i,
  ];
  return yesPatterns.some(pattern => pattern.test(message.trim()));
}

export function isNoAssignMessage(message: string): boolean {
  const noPatterns = [
    /^no/i,
    /^leave unassigned/i,
    /^skip/i,
    /^unassigned/i,
  ];
  return noPatterns.some(pattern => pattern.test(message.trim()));
}

export function isCreateInADOMessage(message: string): boolean {
  const createPatterns = [
    /^create/i,
    /^create in ado/i,
    /^create in azure/i,
    /^create story/i,
    /^create work item/i,
    /^submit/i,
  ];
  return createPatterns.some(pattern => pattern.test(message.trim()));
}

export function extractAssigneeName(message: string, availableAssignees: Array<{ displayName: string; email: string }>): string | null {
  const trimmed = message.trim();
  
  const assigneeMatch = availableAssignees.find(a => 
    a.displayName.toLowerCase() === trimmed.toLowerCase() ||
    a.email.toLowerCase() === trimmed.toLowerCase() ||
    trimmed.toLowerCase().includes(a.displayName.toLowerCase())
  );
  
  if (assigneeMatch) {
    return assigneeMatch.displayName;
  }
  
  if (trimmed.length > 0 && trimmed.length < 100) {
    return trimmed;
  }
  
  return null;
}

// Response validation types
export type ValidationResult = {
  isValid: boolean;
  reason?: string;
  suggestion?: string;
};

// Patterns that indicate the user pasted menu/conversation content
const MENU_PATTERNS = [
  /create a user story/i,
  /show golden repos/i,
  /view (my )?settings/i,
  /^help$/im,
  /what would you like to do\?/i,
  /i'm ready to help/i,
  /which organization/i,
  /which project/i,
  /story agent/i,
  /general agent/i,
  /golden repo agent/i,
  /quick repl(y|ies)/i,
  /\d+:\d+:\d+\s*(AM|PM)/i, // Timestamps like "3:40:13 AM"
];

// Patterns that indicate the user pasted UI elements
const UI_ELEMENT_PATTERNS = [
  /^use:/i,
  /^project:/i,
  /^PAT$/m,
  /organizations?:/i,
  /skip for now/i,
  /describe your goal/i,
];

// Patterns that indicate placeholder/lorem ipsum text
const PLACEHOLDER_PATTERNS = [
  /lorem\s*ipsum/i,
  /dolor\s*sit\s*amet/i,
  /consectetur\s*adipiscing/i,
  /sed\s*do\s*eiusmod/i,
  /tempor\s*incididunt/i,
  /ut\s*labore\s*et\s*dolore/i,
  /magna\s*aliqua/i,
  /dummy\s*(or\s+)?placeholder\s*text/i,
  /placeholder\s*text\s*(commonly|used|goes|here)?/i,
  /sample\s*text\s*(for|used|commonly|goes|here)?/i,
  /filler\s*text/i,
  /typesetting\s*industry/i,
  /graphic\s*design.*publishing/i,
  /publishing.*web\s*development/i,
  /demonstrat(e|ing)\s*(various\s+)?fonts/i,
  /^placeholder$/i,
  /placeholder\s*goes?\s*here/i,
  /text\s*goes?\s*here/i,
  /this\s*(is\s+)?(a\s+)?(dummy|sample|test|placeholder|filler)/i,
  /insert\s+(text|content|description)\s*here/i,
  /to\s*be\s*(completed|filled|added|determined)/i,
  /tbd|tba|n\/a|xxx+|\.{3,}$/i,
  /blah\s*blah/i,
  /foo\s*bar/i,
  /asdf+|qwerty/i,
  /test\s*test\s*test/i,
  /^test$/i,
  /^testing$/i,
  /^(hello|hi|hey)\s*(world|there)?$/i,
  /^soon$/i,
  /^later$/i,
  /^idk$/i,
  /^will\s*(do|fill)(\s+(it|this|that|later))?\s*$/i,
  /^to\s*(do|fill)(\s+(later|soon))?\s*$/i,
  /^not\s*sure\.?$/i,
  /^dunno\.?$/i,
  /^whatever\.?$/i,
  /^stuff\.?$/i,
  /^things?\.?$/i,
  /^etc\.?$/i,
  /^tbd\s*(soon|later)?\.?$/i,
  /^ok\.?$/i,
  /^okay\.?$/i,
  /^meh\.?$/i,
  /^nah\.?$/i,
  /^sure\.?$/i,
  /^fine\.?$/i,
];

// Semantic keywords that should appear in a valid goal description
const GOAL_SEMANTIC_KEYWORDS = [
  /want/i, /need/i, /able\s*to/i, /can/i, /should/i, /must/i, /will/i,
  /to\s+(view|see|create|edit|delete|manage|access|update|submit|search|find|filter|sort|export|import|download|upload|configure|set|add|remove|display|show|hide|enable|disable|select|track|monitor)/i,
  /allow/i, /enable/i, /provide/i, /support/i, /implement/i,
  /feature/i, /functionality/i, /capability/i, /option/i,
  /user|admin|customer|developer|manager|system/i,
];

// Semantic keywords that should appear in a valid benefit description
// NOTE: Avoid overlap with GOAL_SEMANTIC_KEYWORDS (don't include manage, track, control, etc.)
const BENEFIT_SEMANTIC_KEYWORDS = [
  /because/i, /so\s*that/i, /in\s*order\s*to/i, /to\s*(be\s+able|help|ensure|make)/i,
  /improve/i, /reduce/i, /increase/i, /decrease/i, /enhance/i, /optimize/i,
  /better/i, /easier/i, /faster/i, /more\s+efficient/i, /simpler/i, /quicker/i,
  /save\s+(time|money|effort|resources)/i, /efficiency/i, /productivity/i, /performance/i,
  /avoid/i, /prevent/i, /minimize/i, /eliminate/i, /streamline/i,
  /informed\s*decision/i, /visibility/i, /insight/i, /awareness/i,
  /cost/i, /time/i, /effort/i, /compliance/i, /quality/i,
  /value/i, /benefit/i, /advantage/i, /outcome/i, /result/i,
];

// Patterns that indicate the user pasted code content
const CODE_PATTERNS = [
  /^export\s+(type|interface|const|function|class|enum|default)/m,
  /^import\s+[\{\*\w]/m,
  /^(const|let|var)\s+\w+\s*[:=]/m,
  /^function\s+\w+\s*\(/m,
  /^(public|private|protected)\s+\w+/m,
  /^(async\s+)?function\s*\(/m,
  /=>\s*\{/,
  /:\s*(string|number|boolean|void|any|never|unknown)\b/,
  /:\s*(Array|Record|Map|Set|Promise)<[^>]+>/,
  /\?\s*:\s*\w+/,
  /\[\s*\.\.\.\w+/,
  /\{\s*\n\s+\w+:/,
  /^\s*(if|else|for|while|switch|try|catch)\s*\(/m,
  /^\s*return\s+[^\s;]/m,
  /console\.(log|error|warn|info)\s*\(/,
  /<\w+(\s+\w+=|>)/,
  /className\s*=/,
  /useState|useEffect|useCallback|useMemo/,
  /\.map\s*\(\s*\(/,
  /\.filter\s*\(\s*\(/,
  /\.reduce\s*\(\s*\(/,
  /def\s+\w+\s*\(/,
  /class\s+\w+:/,
  /^\s*#\s*(include|define|pragma)/m,
  /^\s*@(Component|Injectable|Module|Controller)/m,
];

// Count how many code patterns match
function countCodePatternMatches(text: string): number {
  let matches = 0;
  for (const pattern of CODE_PATTERNS) {
    if (pattern.test(text)) {
      matches++;
    }
  }
  return matches;
}

// Check for structural code indicators
function hasCodeStructure(text: string): boolean {
  const lines = text.split('\n');
  
  if (lines.length >= 5) {
    const indentedLines = lines.filter(l => /^\s{2,}/.test(l)).length;
    if (indentedLines / lines.length > 0.5) {
      return true;
    }
  }
  
  const braceCount = (text.match(/[{}]/g) || []).length;
  const semicolonCount = (text.match(/;/g) || []).length;
  if (braceCount >= 4 && semicolonCount >= 2) {
    return true;
  }
  
  const typeAnnotations = (text.match(/:\s*(string|number|boolean|void|any)/gi) || []).length;
  if (typeAnnotations >= 3) {
    return true;
  }
  
  return false;
}

// Field-specific validation
const FIELD_VALIDATORS: Record<string, {
  minLength: number;
  maxLength: number;
  keywords?: RegExp[];
  requireKeywords?: boolean;  // If true, at least one keyword MUST match
  invalidPatterns?: RegExp[];
  guidance: string;
}> = {
  persona: {
    minLength: 2,
    maxLength: 100,
    // Keywords are used as positive signals but NOT required
    // LLM generates context-aware suggestions, so we trust any reasonable input
    keywords: [],
    requireKeywords: false,  // Accept any persona - LLM handles context-aware validation
    guidance: "Please provide a role name describing who will use this feature.",
  },
  goal: {
    minLength: 5,
    maxLength: 500,
    keywords: [/want/i, /need/i, /able/i, /can/i, /should/i, /must/i, /will/i, /to\s+\w+/i],
    requireKeywords: false,  // goal validation is done separately with GOAL_SEMANTIC_KEYWORDS
    guidance: "Please describe what the user wants to accomplish. For example: 'view my order history' or 'manage user permissions'.",
  },
  benefit: {
    minLength: 5,
    maxLength: 500,
    keywords: [/because/i, /so that/i, /improve/i, /reduce/i, /increase/i, /better/i, /easier/i, /faster/i, /save/i, /efficiency/i],
    requireKeywords: false,  // benefit validation is done separately with BENEFIT_SEMANTIC_KEYWORDS
    guidance: "Please describe the benefit or value. For example: 'to track my spending' or 'so I can make informed decisions'.",
  },
  storyPoints: {
    minLength: 1,
    maxLength: 10,
    keywords: [/^\d+$/, /^(1|2|3|5|8|13|21)$/],
    requireKeywords: true,  // storyPoints MUST be a number
    guidance: "Please provide a number for story points (commonly 1, 2, 3, 5, 8, 13, or 21).",
  },
  priority: {
    minLength: 1,
    maxLength: 50,
    keywords: [/^high$/i, /^medium$/i, /^low$/i, /^critical$/i, /^urgent$/i, /^normal$/i, /^[1-4]$/],
    requireKeywords: true,  // priority MUST match a valid priority value
    guidance: "Please provide a priority level like 'high', 'medium', 'low', or a number 1-4.",
  },
};

/**
 * Validates if a user's response is relevant and appropriate for the current field.
 * Returns validation result with reason and suggestion if invalid.
 */
export function validateFieldResponse(field: string, response: string): ValidationResult {
  const trimmed = response.trim();
  const validator = FIELD_VALIDATORS[field];
  
  // Skip validation for fields we don't have validators for
  if (!validator) {
    return { isValid: true };
  }
  
  // Check for placeholder/lorem ipsum text (highest priority)
  const placeholderMatches = PLACEHOLDER_PATTERNS.filter(p => p.test(trimmed)).length;
  if (placeholderMatches >= 1) {
    console.log(`[Validation] Detected placeholder/lorem ipsum text for field: ${field} (matches: ${placeholderMatches})`);
    const fieldMessages: Record<string, string> = {
      goal: "It looks like you've pasted some placeholder text (like Lorem Ipsum). Could you describe your actual goal instead?",
      benefit: "It looks like you've pasted some placeholder text. Could you describe the actual benefit or value instead?",
      persona: "It looks like you've pasted some placeholder text. Could you provide the actual user role instead?",
    };
    return {
      isValid: false,
      reason: fieldMessages[field] || "It looks like you've pasted some placeholder text. Could you provide a real response?",
      suggestion: validator.guidance,
    };
  }
  
  // Check for code content (high priority - likely paste error)
  const codePatternCount = countCodePatternMatches(trimmed);
  const hasCodeIndicators = hasCodeStructure(trimmed);
  
  if (codePatternCount >= 3 || (codePatternCount >= 2 && hasCodeIndicators)) {
    console.log(`[Validation] Detected pasted code content for field: ${field} (patterns: ${codePatternCount}, structure: ${hasCodeIndicators})`);
    const codeFieldMessages: Record<string, string> = {
      goal: "I notice you've pasted some code instead of describing your goal. Let's try again!",
      benefit: "I notice you've pasted some code instead of describing the benefit. Let's try again!",
      persona: "I notice you've pasted some code instead of providing a user role. Let's try again!",
    };
    return {
      isValid: false,
      reason: codeFieldMessages[field] || "I notice you've pasted some code. Could you provide the appropriate response?",
      suggestion: validator.guidance,
    };
  }
  
  // Check if response contains menu/conversation content (strong indicator of paste error)
  const menuMatches = MENU_PATTERNS.filter(p => p.test(trimmed));
  if (menuMatches.length >= 2) {
    console.log(`[Validation] Detected pasted menu/conversation content for field: ${field}`);
    return {
      isValid: false,
      reason: "It looks like you may have accidentally pasted some conversation content.",
      suggestion: validator.guidance,
    };
  }
  
  // Check for UI element patterns
  const uiMatches = UI_ELEMENT_PATTERNS.filter(p => p.test(trimmed));
  if (uiMatches.length >= 2) {
    console.log(`[Validation] Detected pasted UI elements for field: ${field}`);
    return {
      isValid: false,
      reason: "It looks like you may have accidentally pasted some interface elements.",
      suggestion: validator.guidance,
    };
  }
  
  // Reject PURE acknowledgement/filler tokens that contain no meaningful content
  // IMPORTANT: Don't reject legitimate answers that happen to start with acknowledgements
  // e.g., "Okay I want to view reports" is valid, but "okay" or "okay fine" are not
  
  // Helper function to check if text contains semantic content beyond acknowledgements
  const ACK_PREFIXES = /^(ok|okay|k|yes|no|yep|nope|sure|alright|fine|maybe|later|yeah|yea|ya|i guess|i think|got it|sounds good|makes sense|understood|cool|great|nice|right)[,.\s]*/i;
  const textWithoutAck = trimmed.replace(ACK_PREFIXES, '').trim();
  
  // Only reject if after removing acknowledgement prefix, remaining text is:
  // 1. Empty or very short (< 5 chars)
  // 2. Another filler/acknowledgement
  // 3. Pure deferral phrase
  const PURE_FILLER_PATTERNS = [
    // Exact matches for pure fillers
    /^(ok|okay|k|yes|no|yep|nope|sure|alright|fine|maybe|later|idk|dunno|hmm|hm|uh|um|huh|meh|nah|yeah|yea|ya)$/i,
    /^(i guess|i think|i don't know|not sure|whatever|nevermind|never mind)$/i,
    /^(got it|sounds good|makes sense|understood|copy|roger|cool|great|nice|right)$/i,
    // Filler + short meaningless suffix
    /^(ok|okay|yes|sure|fine|alright|yeah)\s+(then|now|that'?s fine|that'?s good|that works|good|great|cool)$/i,
    // Pure deferral phrases
    /^(we'?ll\s+see|let me think|let'?s see|i'?ll think|not now|not yet|some\s*other\s*time|maybe later)$/i,
    /^(later|afterwards?|eventually|sometime|whenever|no idea)$/i,
  ];
  
  // Check if the original trimmed message is a pure filler
  for (const pattern of PURE_FILLER_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.log(`[Validation] Detected pure filler/acknowledgement for field: ${field} (input: "${trimmed}")`);
      return {
        isValid: false,
        reason: "That seems like an acknowledgement rather than an answer. Could you provide more detail?",
        suggestion: validator.guidance,
      };
    }
  }
  
  // If message starts with acknowledgement but remaining content is too short, also reject
  // EXCEPTION: For short-value fields (priority, storyPoints, persona), validate the STRIPPED content
  const SHORT_VALUE_FIELDS = ["priority", "storyPoints", "persona"];
  const isShortValueField = SHORT_VALUE_FIELDS.includes(field);
  
  // Determine which text to validate (stripped or original)
  let textToValidate = trimmed;
  
  if (ACK_PREFIXES.test(trimmed)) {
    if (textWithoutAck.length === 0) {
      // Pure acknowledgement with nothing after - always reject
      console.log(`[Validation] Pure acknowledgement for field: ${field}`);
      return {
        isValid: false,
        reason: "That seems like an acknowledgement. Could you provide your answer?",
        suggestion: validator.guidance,
      };
    }
    
    if (isShortValueField) {
      // For short-value fields, validate the STRIPPED content (after removing acknowledgement)
      // This allows "Ok high", "Sure 5", "Ok admin" to pass keyword validation
      textToValidate = textWithoutAck;
      console.log(`[Validation] Short-value field "${field}" - validating stripped content: "${textToValidate}"`);
    } else if (textWithoutAck.length < 5) {
      // For other fields (goal, benefit), require more content after acknowledgement
      console.log(`[Validation] Acknowledgement with insufficient content for field: ${field} (remaining: "${textWithoutAck}")`);
      return {
        isValid: false,
        reason: "Could you provide more detail about what you need?",
        suggestion: validator.guidance,
      };
    }
  }
  
  // Check length constraints
  if (trimmed.length < validator.minLength) {
    return {
      isValid: false,
      reason: "Your response seems too short.",
      suggestion: validator.guidance,
    };
  }
  
  if (trimmed.length > validator.maxLength) {
    console.log(`[Validation] Response too long (${trimmed.length} chars) for field: ${field}`);
    return {
      isValid: false,
      reason: "Your response seems quite long for this field.",
      suggestion: validator.guidance,
    };
  }
  
  // MANDATORY KEYWORD MATCHING for fields that require it
  // This ensures ambiguous responses like "maybe", "later", "idk" are rejected
  // Use textToValidate which may be stripped of acknowledgement prefix for short-value fields
  if (validator.requireKeywords && validator.keywords) {
    const keywordMatches = validator.keywords.filter(p => p.test(textToValidate)).length;
    if (keywordMatches === 0) {
      console.log(`[Validation] No required keywords matched for field: ${field} (input: "${textToValidate}")`);
      const fieldMessages: Record<string, string> = {
        persona: "That doesn't look like a user role. Please provide a role name like 'end user', 'developer', or 'administrator'.",
        storyPoints: "Please provide a number for story points (commonly 1, 2, 3, 5, 8, 13, or 21).",
        priority: "Please select a priority level: high, medium, low, or a number 1-4.",
      };
      return {
        isValid: false,
        reason: fieldMessages[field] || "Your response doesn't match what I'm looking for.",
        suggestion: validator.guidance,
      };
    }
  }
  
  // Check for multiple lines with timestamps (conversation paste)
  const timestampCount = (trimmed.match(/\d+:\d+:\d+\s*(AM|PM)/gi) || []).length;
  if (timestampCount >= 2) {
    console.log(`[Validation] Multiple timestamps detected in response for field: ${field}`);
    return {
      isValid: false,
      reason: "It looks like you may have pasted a conversation with timestamps.",
      suggestion: validator.guidance,
    };
  }
  
  // For goal and benefit, check if response looks like pasted chat transcript
  // Only flag if there are specific chat transcript patterns, not just the word "agent"
  const chatTranscriptPatterns = [
    /^(story agent|general agent|golden repo agent|settings agent|ado agent):/im,
    /^(user|assistant|system):/im,
    /^\d+:\d+\s*(AM|PM)?.*agent/im,
  ];
  const chatTranscriptMatches = chatTranscriptPatterns.filter(p => p.test(trimmed)).length;
  if ((field === "goal" || field === "benefit") && chatTranscriptMatches >= 1) {
    console.log(`[Validation] Chat transcript pattern detected for field: ${field}`);
    return {
      isValid: false,
      reason: "It looks like you may have pasted some conversation content.",
      suggestion: validator.guidance,
    };
  }
  
  // For goal/benefit, detect deferral language that signals non-commitment
  // This rejects hedged responses like "Maybe later we provide details"
  if ((field === "goal" || field === "benefit") && trimmed.length >= 5) {
    const DEFERRAL_PATTERNS = [
      /^(maybe|perhaps)\s+(later|we|i|we'll|i'll|can|could|will|should)/i,
      /\b(later|sometime|eventually|soon|when\s+ready|when\s+we)\b.*$/i,
      /\b(we'll\s+see|let'?s\s+see|i'll\s+think|not\s+now|not\s+sure|idk|don't\s+know)\b/i,
      /\b(might|could\s+be|would\s+be|probably)\s+(nice|good|fine|ok|okay)\b/i,
    ];
    for (const pattern of DEFERRAL_PATTERNS) {
      if (pattern.test(trimmed)) {
        console.log(`[Validation] Detected deferral language in ${field}: "${trimmed}"`);
        return {
          isValid: false,
          reason: "That sounds like you're deferring to later. Could you describe what you specifically need right now?",
          suggestion: validator.guidance,
        };
      }
    }
  }
  
  // Goal validation is now done via LLM in storyAgent.ts (validateGoalWithLLM)
  // This allows natural language goal descriptions without requiring specific keywords
  // The LLM uses context-aware validation to accept reasonable goals
  // Old hardcoded keyword check disabled - LLM handles this more intelligently
  
  // For benefit field, check for semantic relevance (should contain benefit-related keywords)
  // Apply to all inputs with 3+ characters (catches short meaningless responses)
  if (field === "benefit" && trimmed.length >= 3) {
    const benefitKeywordMatches = BENEFIT_SEMANTIC_KEYWORDS.filter(p => p.test(trimmed)).length;
    if (benefitKeywordMatches === 0) {
      console.log(`[Validation] No benefit-related keywords found for field: ${field}`);
      return {
        isValid: false,
        reason: "I'm not sure that describes a benefit or value. Could you explain why this feature is important or what it helps achieve?",
        suggestion: validator.guidance,
      };
    }
  }
  
  // All heuristic checks passed
  return { isValid: true };
}
