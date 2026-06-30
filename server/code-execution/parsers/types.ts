export interface ParsedIssue {
  type: "build" | "test_failure" | "runtime";
  severity?: "error" | "warning";
  file?: string;
  line?: number;
  column?: number;
  errorCode?: string;
  message: string;
  snippet?: string;
  testName?: string;
}
