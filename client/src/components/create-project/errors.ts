type ApiErrorData = {
  error?: unknown;
  message?: unknown;
};

function getResponseData(error: unknown): ApiErrorData | undefined {
  const err = error as any;
  return err?.response?.data ?? err?.details?.response?.data;
}

function getHttpStatus(error: unknown): number | undefined {
  const err = error as any;
  return err?.httpStatus ?? err?.response?.status ?? err?.details?.response?.status;
}

export function formatJiraCreateProjectError(error: unknown): string {
  const data = getResponseData(error);
  const status = getHttpStatus(error);
  const serverError = typeof data?.error === "string" ? data.error : "";
  const serverMessage = typeof data?.message === "string" ? data.message : "";

  if (status === 412 && serverError === "No admin Jira connection configured") {
    return [
      serverMessage || "No admin Jira connection is configured for this Jira instance.",
      'Open Settings > Client Settings, choose the Jira connection, and click "Set as Admin".',
      'The Jira account behind that token must have the global "Administer Jira" permission.',
    ].join(" ");
  }

  return (
    serverMessage ||
    serverError ||
    (error instanceof Error ? error.message : "") ||
    "Failed to create Jira project."
  );
}
