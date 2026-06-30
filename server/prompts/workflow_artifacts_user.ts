import { promptWorkflowRequirements } from "./prompt_workflow_requirements";

// Re-export the user-level prompt template for workflow artifact generation
export const workflowArtifactsUser: string = promptWorkflowRequirements.content;

export default workflowArtifactsUser;
