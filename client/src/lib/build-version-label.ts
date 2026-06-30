/**
 * Azure DevOps build number from pipeline `name: MAJOR.MINOR.$(Date:yyyyMMdd).$(Rev:r)`
 * (e.g. 2.0.20260415.1). When present, the version string already embeds the build date.
 */
export function isAdoPipelineBuildNumber(version: string): boolean {
  return /^\d+\.\d+\.\d{8}\.\d+$/.test(version.trim());
}

/** Footer line: manual apiVersion includes DDMMYYYY build date; auto/build-number avoids duplicate date. */
export function getBuildVersionFooterLabel(): string {
  if (typeof __APP_VERSION__ === "undefined") {
    return "v1.0.0 dev";
  }
  const ver = String(__APP_VERSION__).trim();
  if (!ver) {
    return "v1.0.0 dev";
  }
  if (isAdoPipelineBuildNumber(ver)) {
    return `v${ver}`;
  }
  const date =
    typeof __BUILD_DATE__ !== "undefined" && String(__BUILD_DATE__).trim()
      ? String(__BUILD_DATE__).trim()
      : "";
  return date ? `v${ver} ${date}` : `v${ver}`;
}
