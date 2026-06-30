import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useSearch } from "wouter";
import { useJiraOnlyWorkItems } from "@/hooks/use-hosting-config";
import type {
  Epic,
  Feature,
  UserStory,
  Persona,
  WikiPage,
  ConversationMessage,
  ConversationPhase,
  CapturedRequirements,
  ExportFormat,
} from "@shared/schema";

interface AzureConfig {
  organization: string;
  project: string;
  repository: string;
  branch: string;
  pat?: string;
}

interface RepositoryConfig {
  repositoryId: string | null;
  organization: string;
  projectName: string;
  patToken: string;
  provider?: "ado" | "github" | "gitlab";
  url?: string;
  defaultBranch?: string;
}

export interface ComplianceGuideline {
  id: string;
  name: string;
  path: string;
  content: string;
}

interface WorkflowContextType {
  currentStep: number;
  setCurrentStep: (step: number) => void;
  
  sessionId: string;
  setSessionId: (id: string) => void;
  sdlcProjectId: string | null;
  setSdlcProjectId: (projectId: string | null) => void;
  projectName: string;
  setProjectName: (name: string) => void;
  
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  
  brdId: string | null;
  setBrdId: (id: string | null) => void;
  
  // BRD requirement selection used for artifact generation & traceability
  selectedRequirementIds: string[];
  setSelectedRequirementIds: (ids: string[]) => void;
  
  requirement: string;
  setRequirement: (req: string) => void;
  
  userRequirementSummary: string;
  setUserRequirementSummary: (summary: string) => void;
  
  originalRequirement: string;
  setOriginalRequirement: (req: string) => void;
  
  isRegenerating: boolean;
  setIsRegenerating: (regenerating: boolean) => void;
  
  guidelines: string | null;
  setGuidelines: (guidelines: string) => void;
  
  complianceGuidelines: ComplianceGuideline[];
  setComplianceGuidelines: (guidelines: ComplianceGuideline[]) => void;
  addComplianceGuideline: (guideline: ComplianceGuideline) => void;
  removeComplianceGuideline: (id: string) => void;
  clearComplianceGuidelines: () => void;
  
  // AI enhancement setting for artifact generation
  aiEnhanceEnabled: boolean;
  setAiEnhanceEnabled: (enabled: boolean) => void;
  
  // LLM temperature setting
  llmTemperature: number;
  setLlmTemperature: (temperature: number) => void;
  
  epics: Epic[];
  setEpics: (epics: Epic[]) => void;
  
  features: Feature[];
  setFeatures: (features: Feature[]) => void;
  
  userStories: UserStory[];
  setUserStories: (stories: UserStory[]) => void;
  
  personas: Persona[];
  setPersonas: (personas: Persona[]) => void;
  
  selectedPersonaIds: string[];
  setSelectedPersonaIds: (ids: string[]) => void;
  
  wikiPages: WikiPage[];
  setWikiPages: (pages: WikiPage[]) => void;
  
  azureConfig: AzureConfig;
  setAzureConfig: (config: AzureConfig) => void;
  
  repositoryConfig: RepositoryConfig | null;
  setRepositoryConfig: (config: RepositoryConfig | null) => void;
  
  selectedEpics: Set<string>;
  setSelectedEpics: (ids: Set<string>) => void;
  toggleEpic: (id: string) => void;
  
  selectedFeatures: Set<string>;
  setSelectedFeatures: (ids: Set<string>) => void;
  toggleFeature: (id: string) => void;
  
  selectedStories: Set<string>;
  setSelectedStories: (ids: Set<string>) => void;
  toggleStory: (id: string) => void;
  
  selectedWikiPages: Set<string>;
  setSelectedWikiPages: (ids: Set<string>) => void;
  toggleWikiPage: (id: string) => void;
  
  // Pushed to ADO status tracking
  pushedEpics: Set<string>;
  pushedFeatures: Set<string>;
  pushedStories: Set<string>;
  pushedWikiPages: Set<string>;
  setPushedEpics: (ids: Set<string>) => void;
  setPushedFeatures: (ids: Set<string>) => void;
  setPushedStories: (ids: Set<string>) => void;
  setPushedWikiPages: (ids: Set<string>) => void;
  
  selectAll: () => void;
  selectAllUnpushed: () => void;
  deselectAll: () => void;
  
  isGenerating: boolean;
  setIsGenerating: (loading: boolean) => void;
  
  // Per-section loading states for progressive artifact generation
  epicsLoading: boolean;
  setEpicsLoading: (loading: boolean) => void;
  featuresLoading: boolean;
  setFeaturesLoading: (loading: boolean) => void;
  storiesLoading: boolean;
  setStoriesLoading: (loading: boolean) => void;
  personasLoading: boolean;
  setPersonasLoading: (loading: boolean) => void;
  
  isPushing: boolean;
  setIsPushing: (pushing: boolean) => void;
  
  isSaving: boolean;
  setIsSaving: (saving: boolean) => void;
  
  savedArtifactId: string | null;
  setSavedArtifactId: (id: string | null) => void;
  
  step1Complete: boolean;
  setStep1Complete: (complete: boolean) => void;
  
  step3Complete: boolean;
  setStep3Complete: (complete: boolean) => void;
  
  // Conversational workflow state
  conversationMessages: ConversationMessage[];
  setConversationMessages: (messages: ConversationMessage[]) => void;
  addConversationMessage: (message: ConversationMessage) => void;
  
  conversationPhase: ConversationPhase;
  setConversationPhase: (phase: ConversationPhase) => void;
  
  capturedRequirements: CapturedRequirements;
  setCapturedRequirements: (requirements: CapturedRequirements) => void;
  updateCapturedRequirements: (updates: Partial<CapturedRequirements>) => void;
  
  exportFormat: ExportFormat;
  setExportFormat: (format: ExportFormat) => void;
  
  isConversationLoading: boolean;
  setIsConversationLoading: (loading: boolean) => void;
  
  summaryConfirmed: boolean;
  setSummaryConfirmed: (confirmed: boolean) => void;
  
  uploadedFiles: File[];
  setUploadedFiles: (files: File[]) => void;
  addUploadedFile: (file: File) => void;
  removeUploadedFile: (fileName: string) => void;
  clearUploadedFiles: () => void;
  
  askedQuestions: string[];
  setAskedQuestions: (questions: string[]) => void;
  addAskedQuestion: (question: string) => void;
  
  processedFileRequirements: string | null;
  setProcessedFileRequirements: (requirements: string | null) => void;
  
  resetWorkflow: () => void;
  regenerateArtifacts: () => void;
  
  // Cancel generation function - set by step1, can be called from step2
  cancelGeneration: (() => void) | null;
  setCancelGeneration: (fn: (() => void) | null) => void;
  
  // Generation Activity Log state
  isGeneratingArtifacts: boolean;
  setIsGeneratingArtifacts: (generating: boolean) => void;
  generationLogs: { message: string; timestamp: Date }[];
  setGenerationLogs: (logs: { message: string; timestamp: Date }[]) => void;
  addGenerationLog: (log: string) => void;
  generationCancelled: boolean;
  setGenerationCancelled: (cancelled: boolean) => void;
  qualityReport: any | null;
  setQualityReport: (report: any | null) => void;
  domainExpertAnalysis: { domain: string; domainAnalysis: string } | null;
  setDomainExpertAnalysis: (analysis: { domain: string; domainAnalysis: string } | null) => void;
  useGoldenRepo: boolean;
  setUseGoldenRepo: (enabled: boolean) => void;
  integrationType: "ado" | "jira";
  setIntegrationType: (type: "ado" | "jira") => void;
}


const WorkflowContext = createContext<WorkflowContextType | undefined>(undefined);

const DEFAULT_AZURE_CONFIG: AzureConfig = {
  organization: "",
  project: "",
  repository: "",
  branch: "",
};

const DEFAULT_CAPTURED_REQUIREMENTS: CapturedRequirements = {
  businessGoals: [],
  targetUsers: [],
  keyFeatures: [],
  technicalConstraints: [],
  functionalRequirements: [],
  nonFunctionalRequirements: [],
  edgeCases: [],
  priorityItems: [],
  excludedTopics: [],
  impliedNeeds: [],
};

export function WorkflowProvider({ children }: { children: ReactNode }) {
  // Start empty; set when session is created (Step 1 generate) or resumed from My Sessions.
  // Avoids calling GET workflow-steps with a client-only UUID that doesn't exist on the server (403).
  const [sessionId, setSessionId] = useState<string>("");
  const [sdlcProjectId, setSdlcProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [currentStep, setCurrentStep] = useState(1);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [brdId, setBrdId] = useState<string | null>(null);
  const [selectedRequirementIds, setSelectedRequirementIds] = useState<string[]>([]);
  const [requirement, setRequirement] = useState("");
  const [userRequirementSummary, setUserRequirementSummary] = useState("");
  const [originalRequirement, setOriginalRequirement] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [guidelines, setGuidelines] = useState<string | null>(null);
  const [complianceGuidelines, setComplianceGuidelines] = useState<ComplianceGuideline[]>([]);
  const [aiEnhanceEnabled, setAiEnhanceEnabled] = useState(false); // Default to false (off)
  const [llmTemperature, setLlmTemperature] = useState(0.7); // Default temperature 0.7
  const [useGoldenRepo, setUseGoldenRepo] = useState(true); // Default to true (on)
  const jiraOnly = useJiraOnlyWorkItems();
  const [integrationType, setIntegrationType] = useState<"ado" | "jira">(jiraOnly ? "jira" : "ado");

  useEffect(() => {
    if (jiraOnly) setIntegrationType("jira");
  }, [jiraOnly]);

  const [epics, setEpics] = useState<Epic[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [userStories, setUserStories] = useState<UserStory[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [wikiPages, setWikiPages] = useState<WikiPage[]>([]);
  const [azureConfig, setAzureConfig] = useState<AzureConfig>(DEFAULT_AZURE_CONFIG);
  const [repositoryConfig, setRepositoryConfig] = useState<RepositoryConfig | null>(null);
  const [selectedEpics, setSelectedEpics] = useState<Set<string>>(new Set());
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set());
  const [selectedStories, setSelectedStories] = useState<Set<string>>(new Set());
  const [selectedWikiPages, setSelectedWikiPages] = useState<Set<string>>(new Set());
  
  // Pushed to ADO status tracking
  const [pushedEpics, setPushedEpics] = useState<Set<string>>(new Set());
  const [pushedFeatures, setPushedFeatures] = useState<Set<string>>(new Set());
  const [pushedStories, setPushedStories] = useState<Set<string>>(new Set());
  const [pushedWikiPages, setPushedWikiPages] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [epicsLoading, setEpicsLoading] = useState(false);
  const [featuresLoading, setFeaturesLoading] = useState(false);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [personasLoading, setPersonasLoading] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedArtifactId, setSavedArtifactId] = useState<string | null>(null);
  const [step1Complete, setStep1Complete] = useState(false);
  const [step3Complete, setStep3Complete] = useState(false);
  
  // Generation Activity Log state
  const [isGeneratingArtifacts, setIsGeneratingArtifacts] = useState(false);
  const [generationLogs, setGenerationLogs] = useState<{ message: string; timestamp: Date }[]>([]);
  const [generationCancelled, setGenerationCancelled] = useState(false);
  const [qualityReport, setQualityReport] = useState<any | null>(null);
  const [domainExpertAnalysis, setDomainExpertAnalysis] = useState<{ domain: string; domainAnalysis: string } | null>(null);
  
  // Conversational workflow state
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [conversationPhase, setConversationPhase] = useState<ConversationPhase>("understanding");
  const [capturedRequirements, setCapturedRequirements] = useState<CapturedRequirements>(DEFAULT_CAPTURED_REQUIREMENTS);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("none");
  const [isConversationLoading, setIsConversationLoading] = useState(false);
  const [summaryConfirmed, setSummaryConfirmed] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [askedQuestions, setAskedQuestions] = useState<string[]>([]);
  const [processedFileRequirements, setProcessedFileRequirements] = useState<string | null>(null);
  
  // Cancel generation callback - set by step1, can be called from step2
  const [cancelGeneration, setCancelGeneration] = useState<(() => void) | null>(null);

  // Get search params for URL parameter reading
  const search = useSearch();

  // Read URL parameters on mount and when search changes
  useEffect(() => {
    const params = new URLSearchParams(search);
    const urlBrdId = params.get("brdId");
    const urlProjectId = params.get("projectId");
    const urlProjectName = params.get("projectName");
    const urlOrganizationName = params.get("organizationName");

    // Set brdId from URL if available and different
    if (urlBrdId !== null && urlBrdId !== brdId) {
      console.log("[Workflow Context] Setting brdId from URL:", urlBrdId);
      setBrdId(urlBrdId);
    } else if (urlBrdId === null && brdId !== null) {
      // Only clear if URL explicitly has no brdId and we had one before
      setBrdId(null);
    }

    // Set projectId from URL if available and different
    if (urlProjectId !== null && urlProjectId !== projectId) {
      console.log("[Workflow Context] Setting projectId from URL:", urlProjectId);
      setProjectId(urlProjectId);
    } else if (urlProjectId === null && projectId !== null) {
      // Only clear if URL explicitly has no projectId and we had one before
      setProjectId(null);
    }

    // Set projectName from URL if available and different
    if (urlProjectName !== null && urlProjectName !== projectName) {
      console.log("[Workflow Context] Setting projectName from URL:", urlProjectName);
      setProjectName(urlProjectName);
    } else if (urlProjectName === null && projectName !== "") {
      // Only clear if URL explicitly has no projectName and we had one before
      setProjectName("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]); // Only depend on search to prevent flicker from state changes

  const toggleEpic = (id: string) => {
    setSelectedEpics(prev => {
      const next = new Set(prev);
      const isSelected = next.has(id);
      if (isSelected) {
        next.delete(id);

        // When an epic is deselected, also deselect its features and stories
        const removedFeatureIds = features
          .filter((f) => f.epicId === id)
          .map((f) => f.id);

        if (removedFeatureIds.length > 0) {
          setSelectedFeatures((prevFeatures) => {
            const updated = new Set(prevFeatures);
            removedFeatureIds.forEach((fid) => updated.delete(fid));
            return updated;
          });
        }

        setSelectedStories((prevStories) => {
          const updated = new Set(prevStories);
          userStories.forEach((story) => {
            const storyFeatureId = (story as any).featureId;
            if (story.epicId === id || (storyFeatureId && removedFeatureIds.includes(storyFeatureId))) {
              updated.delete(story.id);
            }
          });
          return updated;
        });
      } else {
        next.add(id);

        // When an epic is selected, also select its features and stories
        const epicFeatureIds = features
          .filter((f) => f.epicId === id)
          .map((f) => f.id);

        if (epicFeatureIds.length > 0) {
          setSelectedFeatures((prevFeatures) => {
            const updated = new Set(prevFeatures);
            epicFeatureIds.forEach((fid) => updated.add(fid));
            return updated;
          });
        }

        if (epicFeatureIds.length > 0) {
          setSelectedStories((prevStories) => {
            const updated = new Set(prevStories);
            userStories.forEach((story) => {
              const storyFeatureId = (story as any).featureId;
              if (story.epicId === id || (storyFeatureId && epicFeatureIds.includes(storyFeatureId))) {
                updated.add(story.id);
              }
            });
            return updated;
          });
        } else {
          // Fallback: select stories directly linked to the epic
          setSelectedStories((prevStories) => {
            const updated = new Set(prevStories);
            userStories.forEach((story) => {
              if (story.epicId === id) {
                updated.add(story.id);
              }
            });
            return updated;
          });
        }
      }
      return next;
    });
  };

  const toggleFeature = (id: string) => {
    setSelectedFeatures(prev => {
      const next = new Set(prev);
      const isSelected = next.has(id);
      if (isSelected) {
        next.delete(id);

        // When a feature is deselected, also deselect its stories
        setSelectedStories((prevStories) => {
          const updated = new Set(prevStories);
          userStories.forEach((story) => {
            const storyFeatureId = (story as any).featureId;
            if (storyFeatureId === id) {
              updated.delete(story.id);
            }
          });
          return updated;
        });
      } else {
        next.add(id);

        // When a feature is selected, also select its stories
        setSelectedStories((prevStories) => {
          const updated = new Set(prevStories);
          userStories.forEach((story) => {
            const storyFeatureId = (story as any).featureId;
            if (storyFeatureId === id) {
              updated.add(story.id);
            }
          });
          return updated;
        });
      }
      return next;
    });
  };

  const toggleStory = (id: string) => {
    setSelectedStories(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleWikiPage = (id: string) => {
    setSelectedWikiPages(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedEpics(new Set(epics.map(e => e.id)));
    setSelectedFeatures(new Set(features.map(f => f.id)));
    setSelectedStories(new Set(userStories.map(s => s.id)));
    setSelectedWikiPages(new Set(wikiPages.map(w => w.id)));
  };

  /** Select only artifacts that are not already pushed to ADO (for Step 3 when resuming completed session). */
  const selectAllUnpushed = () => {
    setSelectedEpics(new Set(epics.filter(e => !pushedEpics.has(e.id)).map(e => e.id)));
    setSelectedFeatures(new Set(features.filter(f => !pushedFeatures.has(f.id)).map(f => f.id)));
    setSelectedStories(new Set(userStories.filter(s => !pushedStories.has(s.id)).map(s => s.id)));
    setSelectedWikiPages(new Set(wikiPages.filter(w => !pushedWikiPages.has(w.id)).map(w => w.id)));
  };

  const deselectAll = () => {
    setSelectedEpics(new Set());
    setSelectedFeatures(new Set());
    setSelectedStories(new Set());
    setSelectedWikiPages(new Set());
  };

  const addConversationMessage = (message: ConversationMessage) => {
    setConversationMessages(prev => [...prev, message]);
  };

  const updateCapturedRequirements = (updates: Partial<CapturedRequirements>) => {
    setCapturedRequirements(prev => ({ ...prev, ...updates }));
  };

  const addUploadedFile = (file: File) => {
    setUploadedFiles(prev => [...prev, file]);
  };

  const removeUploadedFile = (fileName: string) => {
    setUploadedFiles((prev) => prev.filter((file) => file.name !== fileName));
  };

  const clearUploadedFiles = () => setUploadedFiles([]);
  
  const addAskedQuestion = (question: string) => {
    setAskedQuestions(prev => [...prev, question]);
  };
  
  const addGenerationLog = (log: string) => {
    setGenerationLogs(prev => [...prev, { message: log, timestamp: new Date() }]);
  };

  const regenerateArtifacts = () => {
    // Save current user requirement summary as original for context
    if (userRequirementSummary && !originalRequirement) {
      setOriginalRequirement(userRequirementSummary);
    }
    
    // Mark as regeneration scenario
    setIsRegenerating(true);
    
    // Reset generation-related state but keep original requirement
    setRequirement("");
    setUserRequirementSummary("");
    setGuidelines(null);
    setEpics([]);
    setFeatures([]);
    setUserStories([]);
    setWikiPages([]);
    setSelectedEpics(new Set());
    setSelectedFeatures(new Set());
    setSelectedStories(new Set());
    setSelectedWikiPages(new Set());
    setStep1Complete(false);
    setConversationMessages([]);
    setConversationPhase("understanding");
    setCapturedRequirements(DEFAULT_CAPTURED_REQUIREMENTS);
    setExportFormat("none");
    setSummaryConfirmed(false);
    setAskedQuestions([]);
    setProcessedFileRequirements(null);
    
    // Navigate back to Step 1
    setCurrentStep(1);
  };

  const addComplianceGuideline = (guideline: ComplianceGuideline) => {
    setComplianceGuidelines(prev => [...prev, guideline]);
  };

  const removeComplianceGuideline = (id: string) => {
    setComplianceGuidelines(prev => prev.filter(g => g.id !== id));
  };

  const clearComplianceGuidelines = () => {
    setComplianceGuidelines([]);
  };

  const resetWorkflow = () => {
    setSessionId("");
    setCurrentStep(1);
    setRequirement("");
    setUserRequirementSummary("");
    setOriginalRequirement("");
    setIsRegenerating(false);
    setGuidelines(null);
    setComplianceGuidelines([]);
    setAiEnhanceEnabled(false); // Reset to default (off)
    setUseGoldenRepo(true); // Reset to default (on)

    setEpics([]);
    setFeatures([]);
    setUserStories([]);
    setPersonas([]);
    setSelectedPersonaIds([]);
    setWikiPages([]);
    setAzureConfig(DEFAULT_AZURE_CONFIG);
    setRepositoryConfig(null);
    setSelectedEpics(new Set());
    setSelectedFeatures(new Set());
    setSelectedStories(new Set());
        setSelectedWikiPages(new Set());
    // Clear pushed status on reset
    setPushedEpics(new Set());
    setPushedFeatures(new Set());
    setPushedStories(new Set());
    setPushedWikiPages(new Set());
    setIsGenerating(false);
    setEpicsLoading(false);
    setFeaturesLoading(false);
    setStoriesLoading(false);
    setPersonasLoading(false);
    setIsPushing(false);
    setStep1Complete(false);
    setStep3Complete(false);
    setConversationMessages([]);
    setConversationPhase("understanding");
    setCapturedRequirements(DEFAULT_CAPTURED_REQUIREMENTS);
    setExportFormat("none");
    setIsConversationLoading(false);
    setSummaryConfirmed(false);
    setUploadedFiles([]);
    setAskedQuestions([]);
    setProcessedFileRequirements(null);
    setBrdId(null);
    setIsGeneratingArtifacts(false);
    setGenerationLogs([]);
    setGenerationCancelled(false);
    setQualityReport(null);
    setDomainExpertAnalysis(null);
  };
  
  // Track whether localStorage restore has run for the current session to avoid the
  // save effect overwriting stored data with empty sets before restore completes.
  const [pushedRestored, setPushedRestored] = useState(false);

  // Restore pushed status from localStorage (must run before the save effect)
  useEffect(() => {
    setPushedRestored(false);
    if (sessionId) {
      const saved = localStorage.getItem(`workflowPushedStatus_${sessionId}`);
      if (saved) {
        try {
          const pushedData = JSON.parse(saved);
          if (pushedData.epics?.length || pushedData.features?.length || pushedData.stories?.length || pushedData.wikiPages?.length) {
            setPushedEpics(new Set(pushedData.epics || []));
            setPushedFeatures(new Set(pushedData.features || []));
            setPushedStories(new Set(pushedData.stories || []));
            setPushedWikiPages(new Set(pushedData.wikiPages || []));
          }
        } catch (error) {
          console.error('Failed to restore pushed status:', error);
        }
      }
    }
    setPushedRestored(true);
  }, [sessionId]);

  // Persist pushed status to localStorage (only after initial restore is done)
  useEffect(() => {
    if (sessionId && pushedRestored) {
      const pushedData = {
        epics: Array.from(pushedEpics),
        features: Array.from(pushedFeatures),
        stories: Array.from(pushedStories),
        wikiPages: Array.from(pushedWikiPages),
      };
      localStorage.setItem(`workflowPushedStatus_${sessionId}`, JSON.stringify(pushedData));
    }
  }, [pushedEpics, pushedFeatures, pushedStories, pushedWikiPages, sessionId, pushedRestored]);

  return (
    <WorkflowContext.Provider
      value={{
        sessionId,
        setSessionId,
        sdlcProjectId,
        setSdlcProjectId,
        projectName,
        setProjectName,
        currentStep,
        setCurrentStep,
        projectId,
        setProjectId,
        brdId,
        setBrdId,
        selectedRequirementIds,
        setSelectedRequirementIds,
        requirement,
        setRequirement,
        userRequirementSummary,
        setUserRequirementSummary,
        originalRequirement,
        setOriginalRequirement,
        isRegenerating,
        setIsRegenerating,
        guidelines,
        setGuidelines,
        complianceGuidelines,
        setComplianceGuidelines,
        addComplianceGuideline,
        removeComplianceGuideline,
        clearComplianceGuidelines,
        aiEnhanceEnabled,
        setAiEnhanceEnabled,
        llmTemperature,
        setLlmTemperature,
        epics,
        setEpics,
        features,
        setFeatures,
        userStories,
        setUserStories,
        personas,
        setPersonas,
        selectedPersonaIds,
        setSelectedPersonaIds,
        wikiPages,
        setWikiPages,
        azureConfig,
        setAzureConfig,
        repositoryConfig,
        setRepositoryConfig,
        selectedEpics,
        setSelectedEpics,
        toggleEpic,
        selectedFeatures,
        setSelectedFeatures,
        toggleFeature,
        selectedStories,
        setSelectedStories,
        toggleStory,
        selectedWikiPages,
        setSelectedWikiPages,
        toggleWikiPage,
        pushedEpics,
        pushedFeatures,
        pushedStories,
        pushedWikiPages,
        setPushedEpics,
        setPushedFeatures,
        setPushedStories,
        setPushedWikiPages,
        selectAll,
        selectAllUnpushed,
        deselectAll,
        isGenerating,
        setIsGenerating,
        epicsLoading,
        setEpicsLoading,
        featuresLoading,
        setFeaturesLoading,
        storiesLoading,
        setStoriesLoading,
        personasLoading,
        setPersonasLoading,
        isPushing,
        setIsPushing,
        isSaving,
        setIsSaving,
        savedArtifactId,
        setSavedArtifactId,
        step1Complete,
        setStep1Complete,
        step3Complete,
        setStep3Complete,
        conversationMessages,
        setConversationMessages,
        addConversationMessage,
        conversationPhase,
        setConversationPhase,
        capturedRequirements,
        setCapturedRequirements,
        updateCapturedRequirements,
        exportFormat,
        setExportFormat,
        isConversationLoading,
        setIsConversationLoading,
        summaryConfirmed,
        setSummaryConfirmed,
        uploadedFiles,
        setUploadedFiles,
        addUploadedFile,
        removeUploadedFile,
        clearUploadedFiles,
        askedQuestions,
        setAskedQuestions,
        addAskedQuestion,
        processedFileRequirements,
        setProcessedFileRequirements,
        resetWorkflow,
        regenerateArtifacts,
        cancelGeneration: cancelGeneration,
        setCancelGeneration: setCancelGeneration,
        isGeneratingArtifacts,
        setIsGeneratingArtifacts,
        generationLogs,
        setGenerationLogs,
        addGenerationLog,
        integrationType,
        setIntegrationType,
        generationCancelled,
        setGenerationCancelled,
        qualityReport,
        setQualityReport,
        domainExpertAnalysis,
        setDomainExpertAnalysis,
        useGoldenRepo,
        setUseGoldenRepo,
      }}

    >
      {children}
    </WorkflowContext.Provider>
  );
}

export function useWorkflow() {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error("useWorkflow must be used within a WorkflowProvider");
  }
  return context;
}
