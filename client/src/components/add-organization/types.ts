export type AlmType = "ado" | "jira";

export type TestStatus = "idle" | "testing" | "success" | "error";

export interface ToolCatalogField {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "email";
  required: boolean;
}

export interface ToolCatalogItem {
  id: string;
  categoryKey: string;
  providerKey: string;
  displayName: string;
  requiredFields: ToolCatalogField[];
  supportsTesting: number;
}

export interface ToolConfigState {
  providerId: string;
  values: Record<string, string>;
}
