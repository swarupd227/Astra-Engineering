/**
 * Central export for all workflow agent prompts.
 * Import from here for a single entry point: e.g. import { UNIVERSAL_AGENT_SYSTEM_PROMPT } from "./workflow_prompts_index";
 */

export {
  UNIVERSAL_AGENT_SYSTEM_PROMPT,
  default as universalAgentSystemPrompt,
} from "./prompt_workflow_universal_agent";

export {
  WORKFLOW_PATH_CLASSIFIER_SYSTEM_PROMPT,
  getWorkflowPathClassifierUserPrompt,
  default as workflowPathClassifierSystemPrompt,
} from "./prompt_workflow_path_classifier";

export {
  INTENT_CLASSIFIER_SYSTEM_PROMPT,
  getIntentClassifierUserPrompt,
  default as intentClassifierSystemPrompt,
} from "./prompt_workflow_intent_classifier";

export {
  REQUIREMENTS_CLASSIFIER_SYSTEM_PROMPT,
  getRequirementsClassifierUserPrompt,
  default as requirementsClassifierSystemPrompt,
} from "./prompt_workflow_requirements_classifier";

export {
  STARTER_QUESTION_SYSTEM_PROMPT,
  STARTER_QUESTION_USER_PROMPT,
  STARTER_QUESTION_FALLBACK,
  default as starterQuestionSystemPrompt,
} from "./prompt_workflow_starter_question";

export {
  BRD_CONVERSION_SYSTEM_PROMPT,
  getBRDConversionUserPrompt,
  default as brdConversionSystemPrompt,
} from "./prompt_workflow_brd_conversion";

export {
  BRD_DETECT_SYSTEM_PROMPT,
  getBRDDetectUserPrompt,
  default as brdDetectSystemPrompt,
} from "./prompt_workflow_brd_detect";

export {
  BRD_SUMMARIZE_SYSTEM_PROMPT,
  getBRDSummarizeUserPrompt,
  default as brdSummarizeSystemPrompt,
} from "./prompt_workflow_brd_summarize";

export {
  BRD_CONVERT_FORMAT_SYSTEM_PROMPT,
  getBRDConvertFormatUserPrompt,
  default as brdConvertFormatSystemPrompt,
} from "./prompt_workflow_brd_convert_format";

export {
  getConversationAgentSystemPrompt,
  CONVERSATION_AGENT_COUNTER_QUESTION_SYSTEM_APPEND,
  type ConversationAgentPromptOptions,
} from "./prompt_workflow_conversation_agent";
