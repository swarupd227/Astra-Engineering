export type FeatureKey = "sdlc" | "quick_workflow" | "stack_modernization" | "jira_onboarding_wizard";

function getEnvFlag(name: string): boolean {
  const raw = (import.meta as any).env?.[name] as string | undefined;
  if (raw == null) return false;
  const normalized = raw.toString().trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export function isFeatureEnabled(key: FeatureKey): boolean {
  switch (key) {
    case "sdlc":
      return getEnvFlag("VITE_FEATURE_SDLC");
    case "quick_workflow":
      return getEnvFlag("VITE_FEATURE_QUICK_WORKFLOW");
    case "stack_modernization":
      return getEnvFlag("VITE_FEATURE_STACK_MODERNIZATION");
    case "jira_onboarding_wizard":
      return getEnvFlag("VITE_FEATURE_JIRA_ONBOARDING_WIZARD");
    default:
      return false;
  }
}
