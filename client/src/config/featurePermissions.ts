/**
 * Feature-based permission structure for RBAC.
 * Each feature can have: Read, Write, Update, Delete, Create-only, Viewer-only.
 * Used by Admin Activity Configuration screen.
 */
export const PERMISSION_TYPES = [
  { key: "read", label: "Read" },
  { key: "write", label: "Write" },
  { key: "update", label: "Update" },
  { key: "delete", label: "Delete" },
  { key: "create_only", label: "Create-only" },
  { key: "viewer_only", label: "Viewer-only" },
] as const;

export type PermissionKey = (typeof PERMISSION_TYPES)[number]["key"];

export type FeaturePermissionState = Record<PermissionKey, boolean>;

/** Default: full access (all permissions true). Viewer-only overrides to read-only when set. */
export const DEFAULT_FULL_ACCESS: FeaturePermissionState = {
  read: true,
  write: true,
  update: true,
  delete: true,
  create_only: false,
  viewer_only: false,
};

export type FeatureEntry = {
  id: string;
  name: string;
  description: string;
};

export const FEATURE_REGISTRY: FeatureEntry[] = [
  // Organization
  {
    id: "artifact_org",
    name: "Organization",
    description: "Organization CRUD and ADO test",
  },
  // Projects
  { id: "sdlc", name: "SDLC", description: "Projects, backlog, epics, features, requirements, design" },
  { id: "ado", name: "Azure DevOps", description: "ADO projects, repos, work items, releases" },
  // Rest
  { id: "brd", name: "BRD", description: "Business Requirements Document generation and export" },
  { id: "dev_brd", name: "Dev BRD", description: "Development BRD drafts, status, and requirements" },
  { id: "workflow", name: "Workflow", description: "Workflow artifacts, guidelines, and DevOps push" },
  { id: "wiki", name: "Wiki", description: "Wiki generation, export, and page management" },
  { id: "testing", name: "Testing", description: "Test plan generation and save" },
  { id: "ai", name: "AI", description: "AI enhance and mappings" },
  { id: "admin", name: "Admin", description: "User access and role management" },
  { id: "hub", name: "Hub", description: "Hub artifacts and work items" },
  { id: "golden_repos", name: "Golden Repos", description: "Golden repo create, seed, fork" },
  { id: "design_mapping", name: "Design Mapping", description: "Design mapping save and delete" },
  { id: "personas", name: "Personas", description: "Persona initialize and CRUD" },
  { id: "super_agent", name: "Super Agent / RAG", description: "Super Agent chat, context, RAG" },
  { id: "auth", name: "Auth", description: "User bootstrap and auth" },
];
