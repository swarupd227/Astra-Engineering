export type AgentIntent =
  | "goldenRepo"
  | "settings"
  | "general"
  | "ado"
  | "jira"
  | "modernization";

export interface Repository {
  id: string;
  name: string;
  description?: string;
  url?: string;
  defaultBranch?: string;
}

export interface Organization {
  id: string;
  name: string;
  organizationUrl: string;
  projectName: string;
  repositoryName?: string;
  patConfigured: boolean;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
}

export interface Persona {
  id: string;
  name: string;
  role: string;
  description?: string;
}

/* ⬇ NEW FIELDS ADDED HERE: conversationId + summary */
export interface ConversationContext {
  sessionId: string;
  userId?: string;
  conversationId?: string;
  summary?: string;
  selectedOrganization?: Organization;
  // Project the UI is currently viewing (set on every chat request from the
  // client's sessionStorage). May be overwritten on each turn.
  selectedProject?: Project;
  // Project the agent itself selected during conversation (e.g. via the
  // "Use Jira project: <KEY>" chip). Persists across turns until a new
  // selection is made or the session is reset, since route handlers do not
  // touch this field. Agent code should prefer this over `selectedProject`
  // when resolving the active project for Jira intents.
  agentSelectedProject?: Project;
  selectedRepository?: Repository;
  selectedPersonas?: Persona[];
  storyDetails?: {
    title?: string;
    description?: string;
    priority?: string;
    storyPoints?: number;
    acceptanceCriteria?: string[];
    assignee?: string;
  };
  conversationHistory: ChatMessage[];
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  agentUsed?: AgentIntent;
  metadata?: AgentMetadata;
}

export interface WorkItemPayload {
  organizationUrl: string;
  projectName: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: string;
  storyPoints: number;
  assignee?: string;
  userStory: string;
}

export interface AgentMetadata {
  quickReplies: string[];
  missingFields?: string[];
  repositories?: Repository[];
  selectedRepository?: Repository;
  organizations?: Organization[];
  projects?: Project[];
  personas?: Persona[];
  users?: { displayName: string; id?: string; email?: string }[];
  generatedStory?: {
    title: string;
    userStory?: string;
    description: string;
    acceptanceCriteria: string[];
    priority: string;
    storyPoints: number;
    assignee?: string;
  };
  workItemId?: number;
  workItemUrl?: string;
  error?: string;
  canCreateInADO?: boolean;
  workItemPayload?: WorkItemPayload;
}

export interface AgentResponse {
  reply: string;
  usedAgent: AgentIntent;
  metadata: AgentMetadata;
}

/* ⬇ AgentRequest stays same — summary will be inside context */
export interface AgentRequest {
  message: string;
  context: ConversationContext;
}

export interface ClassificationResult {
  intent: AgentIntent;
  confidence: number;
  reasoning?: string;
}

export interface Agent {
  name: string;
  description: string;
  process(request: AgentRequest): Promise<AgentResponse>;
}
