export type ProjectApplicationType =
  | "web"
  | "mobile"
  | "desktop"
  | "api-service";

export type ProjectApplicationTypeCompatibility =
  | "unknown"
  | ProjectApplicationType
  | "mixed";

export const PROJECT_APPLICATION_TYPE_OPTIONS: Array<{
  value: ProjectApplicationType;
  label: string;
}> = [
  { value: "web", label: "Web" },
  { value: "mobile", label: "Mobile" },
  { value: "desktop", label: "Desktop" },
  { value: "api-service", label: "API/service" },
];

export function normalizeProjectApplicationTypes(
  value: unknown,
): ProjectApplicationType[] {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((part) => part.trim());
  const normalized = values
    .map((item) => String(item ?? "").trim().toLowerCase().replace("_", "-"))
    .map((item) =>
      item === "api" || item === "service" || item === "backend"
        ? "api-service"
        : item,
    )
    .filter((item): item is ProjectApplicationType =>
      PROJECT_APPLICATION_TYPE_OPTIONS.some((option) => option.value === item),
    );

  const ordered = PROJECT_APPLICATION_TYPE_OPTIONS.map((option) => option.value);
  return Array.from(new Set(normalized)).sort(
    (a, b) => ordered.indexOf(a) - ordered.indexOf(b),
  );
}

export function deriveProjectApplicationType(
  types: readonly ProjectApplicationType[],
): ProjectApplicationTypeCompatibility {
  if (types.length > 1) return "mixed";
  if (types.length === 1) return types[0];
  return "unknown";
}

export function formatProjectApplicationTypesLabel(
  types: readonly ProjectApplicationType[],
): string {
  if (types.length === 0) return "App type unknown";
  const labels = PROJECT_APPLICATION_TYPE_OPTIONS.filter((option) =>
    types.includes(option.value),
  ).map((option) => option.label);
  if (labels.length <= 2) return labels.join(" + ");
  return `${labels.length} app types`;
}

export function formatProjectApplicationTypesContext(
  types: readonly ProjectApplicationType[],
): string {
  if (types.length === 0) return "Project app type not set";
  return `Project app type: ${formatProjectApplicationTypesLabel(types)}`;
}
