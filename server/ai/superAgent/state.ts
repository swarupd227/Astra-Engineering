export type StoryField = 
  | "organization"
  | "project"
  | "persona"
  | "goal"
  | "benefit"
  | "priority"
  | "storyPoints";

export type ACFlowStep = 
  | "not_started"
  | "asking_generate"
  | "generating"
  | "showing_ac"
  | "collecting_user_ac"
  | "ac_confirmed"
  | "ac_skipped";

export type AssigneeFlowStep =
  | "not_started"
  | "asking_assign"
  | "selecting_assignee"
  | "assignee_confirmed"
  | "assignee_skipped";

export type TestCasesFlowStep =
  | "not_started"
  | "asking_add_tests"
  | "collecting_tests"
  | "collecting_user_tests"
  | "tests_confirmed"
  | "tests_skipped";

export type AssigneeAction = 
  | "leave_unassigned"
  | "assign_resolved"
  | "assign_manual";

export interface ResolvedAssignee {
  displayName: string;
  uniqueName: string;
  mailAddress?: string;
}

export interface WorkItemPayload {
  organizationUrl: string;
  projectName: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  testCases: string[];
  priority: string;
  storyPoints: number;
  assigneeAction: AssigneeAction;
  assigneeQuery?: string;
  assigneeResolved?: ResolvedAssignee;
  userStory: string;
}

export interface StoryState {
  sessionId: string;
  userId: string;
  provided: Partial<Record<StoryField, string | number>>;
  missingFields: StoryField[];
  lastAsked: StoryField | null;
  lastMessageTimestamp: number;
  lastMessageContent: string;
  confirmationPending: boolean;
  agentLockActive: boolean;
  acFlowStep: ACFlowStep;
  testCasesFlowStep: TestCasesFlowStep;
  assigneeFlowStep: AssigneeFlowStep;
  generatedAcceptanceCriteria?: string[];
  generatedTestCases?: string[];
  selectedAssignee?: string;
  availableAssignees?: Array<{ displayName: string; email: string }>;
  assigneeAction?: AssigneeAction;
  assigneeQuery?: string;
  assigneeResolved?: ResolvedAssignee;
  assigneeCandidates?: ResolvedAssignee[];
  workItemCreated?: boolean;
  createdWorkItemId?: number;
  createdWorkItemUrl?: string;
  editingField?: StoryField | "acceptance_criteria" | null;
  completed?: boolean;
  completedAt?: number;
  interrupted?: boolean;
  interruptedBy?: string;
  generatedSummary?: {
    title: string;
    userStory: string;
    description: string;
    acceptanceCriteria: string[];
    testCases: string[];
    priority: string;
    storyPoints: number;
    assigneeAction: AssigneeAction;
    assigneeQuery?: string;
    assigneeResolved?: ResolvedAssignee;
  };
}

export interface SettingsAgentState {
  selectedOrganization?: {
    id: string;
    name: string;
    organizationUrl: string;
    projectName?: string;
    patConfigured: boolean;
  };
  selectedProject?: {
    id: string;
    name: string;
    description?: string;
  };
  selectedRepository?: {
    id: string;
    name: string;
    url?: string;
  };
  lastProjects?: Array<{ id: string; name: string; description?: string }>;
  lastRepositories?: Array<{ id: string; name: string; url?: string }>;
  projectsShown?: boolean;
  repositoriesShown?: boolean;
}

export interface SessionState {
  activeAgent?: 'story' | 'goldenRepo' | 'settings' | 'general' | 'ado' | 'jira' | 'modernization';
  storyState?: StoryState;
  settingsState?: SettingsAgentState;
  adoAgentState?: Record<string, any>;
  lastIntent?: string;
  lastCompletedAt?: number;
  lastCompletedWorkItemId?: number;
}

export const ALL_STORY_FIELDS: StoryField[] = [
  "organization",
  "project",
  "goal",      // Goal is asked BEFORE persona so persona suggestions can be context-aware
  "persona",
  "benefit",
  "priority",
  "storyPoints",
];

export const CORE_FIELDS: StoryField[] = [
  "organization",
  "project",
  "goal",      // Goal is asked BEFORE persona so persona suggestions can be context-aware
  "persona",
  "benefit",
  "priority",
  "storyPoints",
];

const stateMap = new Map<string, StoryState>();

function getStateKey(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`;
}

export function getState(userId: string, sessionId: string): StoryState {
  const key = getStateKey(userId, sessionId);
  let state = stateMap.get(key);
  
  if (!state) {
    state = {
      sessionId,
      userId,
      provided: {},
      missingFields: [...CORE_FIELDS],
      lastAsked: null,
      lastMessageTimestamp: 0,
      lastMessageContent: "",
      confirmationPending: false,
      agentLockActive: false,
      acFlowStep: "not_started",
      testCasesFlowStep: "not_started",
      assigneeFlowStep: "not_started",
    };
    stateMap.set(key, state);
  }
  
  return state;
}

export function saveState(state: StoryState): void {
  const key = getStateKey(state.userId, state.sessionId);
  stateMap.set(key, state);
}

export function resetState(userId: string, sessionId: string): void {
  const key = getStateKey(userId, sessionId);
  stateMap.delete(key);
}

export function isDuplicateMessage(
  state: StoryState, 
  message: string, 
  thresholdMs: number = 1500
): boolean {
  const now = Date.now();
  const timeDiff = now - state.lastMessageTimestamp;
  const isSameMessage = state.lastMessageContent.toLowerCase().trim() === message.toLowerCase().trim();
  
  return isSameMessage && timeDiff < thresholdMs;
}

export function updateMessageTracking(state: StoryState, message: string): void {
  state.lastMessageTimestamp = Date.now();
  state.lastMessageContent = message;
}

export function markFieldProvided(state: StoryState, field: StoryField, value: string | number): void {
  state.provided[field] = value;
  state.missingFields = state.missingFields.filter(f => f !== field);
}

export function isAllFieldsProvided(state: StoryState): boolean {
  return state.missingFields.length === 0;
}

export function getProvidedFieldsCount(state: StoryState): number {
  return Object.keys(state.provided).length;
}

export function clearAllSessions(): void {
  stateMap.clear();
}

export function activateStoryLock(state: StoryState): void {
  state.agentLockActive = true;
  saveState(state);
}

export function deactivateStoryLock(state: StoryState): void {
  state.agentLockActive = false;
  saveState(state);
}

export function isStoryLockActive(userId: string, sessionId: string): boolean {
  const key = getStateKey(userId, sessionId);
  const state = stateMap.get(key);
  return state?.agentLockActive === true;
}

export function shouldRouteToStoryAgent(userId: string, sessionId: string): boolean {
  const key = getStateKey(userId, sessionId);
  const state = stateMap.get(key);
  
  if (!state) return false;
  
  // If story is completed, don't force routing to story agent
  if (state.completed || state.workItemCreated) {
    return false;
  }
  
  // Check if story lock is active
  if (state.agentLockActive) {
    // Still collecting core fields
    if (state.missingFields.length > 0 || state.confirmationPending) {
      return true;
    }
    
    // In the middle of acceptance criteria flow (not yet complete)
    if (state.acFlowStep !== "not_started" && 
        state.acFlowStep !== "ac_confirmed" && 
        state.acFlowStep !== "ac_skipped") {
      return true;
    }
    
    // AC flow just confirmed/skipped but assignee flow not complete
    if ((state.acFlowStep === "ac_confirmed" || state.acFlowStep === "ac_skipped") &&
        state.assigneeFlowStep !== "assignee_confirmed" && 
        state.assigneeFlowStep !== "assignee_skipped") {
      return true;
    }
    
    // Assignee flow in progress
    if (state.assigneeFlowStep !== "not_started" &&
        state.assigneeFlowStep !== "assignee_confirmed" &&
        state.assigneeFlowStep !== "assignee_skipped") {
      return true;
    }
    
    // Summary generated but not yet created in ADO
    if (state.generatedSummary && !state.workItemCreated) {
      return true;
    }
  }
  
  return false;
}

const sessionStateMap = new Map<string, SessionState>();
const SESSION_TTL_MS = 30 * 60 * 1000;

export function getSessionState(sessionId: string): SessionState {
  let session = sessionStateMap.get(sessionId);
  if (!session) {
    session = {};
    sessionStateMap.set(sessionId, session);
  }
  return session;
}

export function saveSessionState(sessionId: string, session: SessionState): void {
  sessionStateMap.set(sessionId, session);
}

export function clearFullSessionState(sessionId: string): void {
  // Clear from sessionStateMap (activeAgent, settingsState, adoAgentState, etc.)
  sessionStateMap.delete(sessionId);
  
  // Also clear story state for this session
  // Need to check all keys since we don't know the userId
  const keysToDelete: string[] = [];
  stateMap.forEach((state, key) => {
    if (state.sessionId === sessionId) {
      keysToDelete.push(key);
    }
  });
  
  keysToDelete.forEach(key => {
    stateMap.delete(key);
    console.log(`[State] Cleared story state for session: ${sessionId}`);
  });
  
  console.log(`[State] Full session state cleared for: ${sessionId}`);
}

export function markStoryCompleted(state: StoryState): void {
  state.completed = true;
  state.completedAt = Date.now();
  state.agentLockActive = false;
  saveState(state);
  
  const session = getSessionState(state.sessionId);
  session.lastCompletedAt = state.completedAt;
  session.lastCompletedWorkItemId = state.createdWorkItemId;
  session.activeAgent = undefined;
  saveSessionState(state.sessionId, session);
}

export function interruptStoryFlow(state: StoryState, newIntent: string): void {
  state.interrupted = true;
  state.interruptedBy = newIntent;
  state.agentLockActive = false;
  saveState(state);
  console.log(`[State] Story flow interrupted by intent: ${newIntent}`);
}

export function canResumeStory(userId: string, sessionId: string): boolean {
  const state = stateMap.get(getStateKey(userId, sessionId));
  if (!state) return false;
  
  if (state.completed || state.workItemCreated) return false;
  
  if (state.interrupted) {
    console.log(`[State] canResumeStory check: interrupted=${state.interrupted}, providedFields=${Object.keys(state.provided).length}`);
    return true;
  }
  
  if (state.missingFields.length > 0 && Object.keys(state.provided).length > 0) {
    return true;
  }
  
  return false;
}

export function resumeStoryFlow(state: StoryState): void {
  state.interrupted = false;
  state.interruptedBy = undefined;
  state.agentLockActive = true;
  saveState(state);
  console.log(`[State] Resuming story flow with ${Object.keys(state.provided).length} fields already provided`);
}

export function isStorySessionExpired(state: StoryState): boolean {
  if (!state.completedAt) return false;
  return Date.now() - state.completedAt > SESSION_TTL_MS;
}

export function shouldAllowInterruption(
  userId: string, 
  sessionId: string, 
  newIntent: string, 
  confidence: number
): boolean {
  const state = stateMap.get(getStateKey(userId, sessionId));
  if (!state) return true;
  
  if (state.completed || state.workItemCreated) return true;
  
  if (state.agentLockActive && confidence >= 0.7 && newIntent !== 'story') {
    console.log(`[State] Intent interruption allowed: ${newIntent} (confidence: ${confidence})`);
    return true;
  }
  
  if (!state.agentLockActive) return true;
  
  return false;
}

export function getSettingsState(sessionId: string): SettingsAgentState {
  const session = getSessionState(sessionId);
  if (!session.settingsState) {
    session.settingsState = {};
    saveSessionState(sessionId, session);
  }
  return session.settingsState;
}

export function setSettingsSelectedOrganization(
  sessionId: string, 
  org: SettingsAgentState['selectedOrganization']
): void {
  const session = getSessionState(sessionId);
  if (!session.settingsState) {
    session.settingsState = {};
  }
  session.settingsState.selectedOrganization = org;
  session.settingsState.selectedProject = undefined;
  session.settingsState.selectedRepository = undefined;
  session.settingsState.projectsShown = false;
  session.settingsState.repositoriesShown = false;
  saveSessionState(sessionId, session);
  console.log(`[SettingsState] Organization selected: ${org?.name}`);
}

export function setSettingsSelectedProject(
  sessionId: string, 
  project: SettingsAgentState['selectedProject']
): void {
  const session = getSessionState(sessionId);
  if (!session.settingsState) {
    session.settingsState = {};
  }
  session.settingsState.selectedProject = project;
  session.settingsState.projectsShown = true;
  session.settingsState.repositoriesShown = false;
  saveSessionState(sessionId, session);
  console.log(`[SettingsState] Project selected: ${project?.name}`);
}

export function setSettingsSelectedRepository(
  sessionId: string, 
  repo: SettingsAgentState['selectedRepository']
): void {
  const session = getSessionState(sessionId);
  if (!session.settingsState) {
    session.settingsState = {};
  }
  session.settingsState.selectedRepository = repo;
  session.settingsState.repositoriesShown = true;
  saveSessionState(sessionId, session);
  console.log(`[SettingsState] Repository selected: ${repo?.name}`);
}

export function setSettingsLastProjects(
  sessionId: string,
  projects: SettingsAgentState['lastProjects']
): void {
  const session = getSessionState(sessionId);
  if (!session.settingsState) {
    session.settingsState = {};
  }
  session.settingsState.lastProjects = projects;
  saveSessionState(sessionId, session);
}

export function setSettingsLastRepositories(
  sessionId: string,
  repositories: SettingsAgentState['lastRepositories']
): void {
  const session = getSessionState(sessionId);
  if (!session.settingsState) {
    session.settingsState = {};
  }
  session.settingsState.lastRepositories = repositories;
  saveSessionState(sessionId, session);
}

export function clearSettingsState(sessionId: string): void {
  const session = getSessionState(sessionId);
  session.settingsState = {};
  saveSessionState(sessionId, session);
}
