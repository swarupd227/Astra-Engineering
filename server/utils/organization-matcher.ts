export function normalizeOrganizationValue(value: string | null | undefined): string {
  const rawValue = (value ?? "").trim();
  if (!rawValue) {
    return "";
  }

  const lowerValue = rawValue.toLowerCase();

  if (lowerValue.includes("dev.azure.com")) {
    const match = lowerValue.match(/https?:\/\/dev\.azure\.com\/([^\/\?]+)/i);
    return (match?.[1] ?? lowerValue).trim();
  }

  if (lowerValue.includes("visualstudio.com")) {
    const match = lowerValue.match(/https?:\/\/([^\.]+)\.visualstudio\.com/i);
    return (match?.[1] ?? lowerValue).trim();
  }

  if (lowerValue.startsWith("http://") || lowerValue.startsWith("https://")) {
    try {
      const parsedUrl = new URL(rawValue);
      const host = parsedUrl.hostname.toLowerCase();
      const [subdomain] = host.split(".");
      return (subdomain || host).trim();
    } catch {
      return lowerValue.replace(/\/+$/, "");
    }
  }

  return lowerValue.replace(/\/+$/, "");
}

export function matchesOrganizationValue(
  candidate: string | null | undefined,
  selectedOrganization: string | null | undefined
) {
  const normalizedCandidate = normalizeOrganizationValue(candidate);
  const normalizedSelected = normalizeOrganizationValue(selectedOrganization);

  return !!normalizedCandidate && !!normalizedSelected && normalizedCandidate === normalizedSelected;
}
