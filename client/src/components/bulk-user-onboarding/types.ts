export type RowStatus = "valid" | "error" | "duplicate";

export interface RowError {
  field: string;
  message: string;
}

export interface PreviewRowData {
  userName: string;
  email: string;
  role: string;
  scope: string;
  organization: string;
  project: string;
}

export interface PreviewRow {
  rowNumber: number;
  data: PreviewRowData;
  status: RowStatus;
  errors: RowError[];
}

export interface PreviewSummary {
  total: number;
  valid: number;
  errors: number;
  duplicates: number;
}

export interface PreviewResponse {
  summary: PreviewSummary;
  rows: PreviewRow[];
}

export interface CommitResultRow {
  rowNumber: number;
  email: string;
  status: "created" | "failed" | "skipped";
  userId?: string;
  reactivated?: boolean;
  error?: string;
}

export interface CommitResponse {
  created: number;
  failed: number;
  skipped: number;
  results: CommitResultRow[];
}
