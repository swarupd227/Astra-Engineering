export const EDIT_PROJECT_WIZARD_STEPS = [
  "Project details",
  "Golden repository",
  "Tools & integrations",
  "Review",
] as const;

export const EDIT_PROJECT_STEP_SHORT = [
  "Details",
  "Golden repo",
  "Tools",
  "Review",
] as const;

export const EDIT_PROJECT_WIZARD_STEP_COPY: {
  title: string;
  subtitle: string;
}[] = [
  {
    title: "Project details",
    subtitle: "Update the display name, description, application type, and Jira project key.",
  },
  {
    title: "Golden repository",
    subtitle:
      "Link an optional golden repository and choose whether to use all files or a custom path list.",
  },
  {
    title: "Tools & integrations",
    subtitle:
      "Inherit organization defaults or configure DevX integrations category by category.",
  },
  {
    title: "Review",
    subtitle:
      "Confirm your changes before saving the project and integration settings.",
  },
];

export function normalizeOrgUrl(url: string): string {
  return (url || "").replace(/\/$/, "").trim().toLowerCase();
}
