/**
 * .NET Version Registry Service
 * Production-grade version detection, validation, and upgrade path calculation
 * 
 * Handles:
 * - Version validation (detect invalid versions like .NET 15)
 * - Upgrade path calculation (.NET 7 → .NET 10)
 * - LTS vs Current channel recommendations
 * - Breaking change detection between versions
 */

export interface DotNetVersion {
  version: string; // e.g., "8.0", "7.0", "6.0"
  fullVersion: string; // e.g., "8.0.4"
  releaseDate: Date;
  endOfLife?: Date;
  isLTS: boolean;
  isCurrent: boolean;
  status: "active" | "maintenance" | "eol";
  channel: "LTS" | "STS"; // Long-Term Support or Standard Term Support
}

export interface UpgradePath {
  from: string;
  to: string;
  isValid: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  reasoning: string;
  breakingChanges: string[];
  requiredActions: string[];
  estimatedEffort: "trivial" | "low" | "medium" | "high" | "very-high";
}

/**
 * Official .NET Release Schedule
 * Source: https://dotnet.microsoft.com/platform/support/policy/dotnet-core
 * Updated: February 2026
 */
const DOTNET_VERSIONS: DotNetVersion[] = [
  // .NET Framework (Legacy - Windows only)
  {
    version: "4.8.1",
    fullVersion: "4.8.1",
    releaseDate: new Date("2022-08-09"),
    isLTS: true,
    isCurrent: false,
    status: "active",
    channel: "LTS"
  },
  {
    version: "4.8",
    fullVersion: "4.8.0",
    releaseDate: new Date("2019-04-18"),
    isLTS: true,
    isCurrent: false,
    status: "active",
    channel: "LTS"
  },
  {
    version: "4.7.2",
    fullVersion: "4.7.2",
    releaseDate: new Date("2018-04-30"),
    isLTS: true,
    isCurrent: false,
    status: "maintenance",
    channel: "LTS"
  },
  {
    version: "4.7.1",
    fullVersion: "4.7.1",
    releaseDate: new Date("2017-10-17"),
    isLTS: true,
    isCurrent: false,
    status: "maintenance",
    channel: "LTS"
  },
  {
    version: "4.7",
    fullVersion: "4.7.0",
    releaseDate: new Date("2017-04-05"),
    isLTS: true,
    isCurrent: false,
    status: "maintenance",
    channel: "LTS"
  },
  {
    version: "4.6.2",
    fullVersion: "4.6.2",
    releaseDate: new Date("2016-08-02"),
    isLTS: true,
    isCurrent: false,
    status: "eol",
    channel: "LTS"
  },
  {
    version: "4.6.1",
    fullVersion: "4.6.1",
    releaseDate: new Date("2015-11-30"),
    isLTS: true,
    isCurrent: false,
    status: "eol",
    channel: "LTS"
  },
  {
    version: "4.6",
    fullVersion: "4.6.0",
    releaseDate: new Date("2015-07-20"),
    isLTS: true,
    isCurrent: false,
    status: "eol",
    channel: "LTS"
  },
  {
    version: "4.5.2",
    fullVersion: "4.5.2",
    releaseDate: new Date("2014-05-05"),
    isLTS: true,
    isCurrent: false,
    status: "eol",
    channel: "LTS"
  },
  {
    version: "4.5.1",
    fullVersion: "4.5.1",
    releaseDate: new Date("2013-10-17"),
    isLTS: true,
    isCurrent: false,
    status: "eol",
    channel: "LTS"
  },
  {
    version: "4.5",
    fullVersion: "4.5.0",
    releaseDate: new Date("2012-08-15"),
    isLTS: true,
    isCurrent: false,
    status: "eol",
    channel: "LTS"
  },
  
  // .NET Core / .NET 5+ (Cross-platform)
  {
    version: "10.0",
    fullVersion: "10.0.0", // Hypothetical - if .NET 10 exists in 2026
    releaseDate: new Date("2025-11-12"),
    isLTS: false,
    isCurrent: true,
    status: "active",
    channel: "STS"
  },
  {
    version: "9.0",
    fullVersion: "9.0.2",
    releaseDate: new Date("2024-11-12"),
    isLTS: false,
    isCurrent: true,
    status: "active",
    channel: "STS"
  },
  {
    version: "8.0",
    fullVersion: "8.0.4",
    releaseDate: new Date("2023-11-14"),
    endOfLife: new Date("2026-11-10"),
    isLTS: true,
    isCurrent: true,
    status: "active",
    channel: "LTS"
  },
  {
    version: "7.0",
    fullVersion: "7.0.17",
    releaseDate: new Date("2022-11-08"),
    endOfLife: new Date("2024-05-14"),
    isLTS: false,
    isCurrent: false,
    status: "eol",
    channel: "STS"
  },
  {
    version: "6.0",
    fullVersion: "6.0.28",
    releaseDate: new Date("2021-11-08"),
    endOfLife: new Date("2024-11-12"),
    isLTS: true,
    isCurrent: false,
    status: "maintenance",
    channel: "LTS"
  },
  {
    version: "5.0",
    fullVersion: "5.0.17",
    releaseDate: new Date("2020-11-10"),
    endOfLife: new Date("2022-05-10"),
    isLTS: false,
    isCurrent: false,
    status: "eol",
    channel: "STS"
  }
];

/**
 * Parse .NET version string (handles multiple formats)
 */
export function parseDotNetVersion(versionString: string): string | null {
  if (!versionString) return null;
  
  // Handle formats: "net8.0", "net80", ".NET 8.0", "8.0", "netcoreapp3.1", "net472"
  const cleanVersion = versionString.toLowerCase().trim();
  
  // Extract version number
  let match = cleanVersion.match(/(\d+)\.(\d+)/); // Match "8.0", "4.7.2"
  if (match) {
    return `${match[1]}.${match[2]}`;
  }
  
  // Handle "net80" → "8.0"
  match = cleanVersion.match(/net(\d)(\d)/);
  if (match) {
    return `${match[1]}.${match[2]}`;
  }
  
  // Handle "net472" → "4.7.2"
  match = cleanVersion.match(/net(\d)(\d)(\d)/);
  if (match) {
    return `${match[1]}.${match[2]}.${match[3]}`;
  }
  
  return null;
}

/**
 * Validate if a .NET version exists
 */
export function isValidDotNetVersion(versionString: string): boolean {
  const parsed = parseDotNetVersion(versionString);
  if (!parsed) return false;
  
  return DOTNET_VERSIONS.some(v => 
    v.version === parsed || 
    v.version.startsWith(parsed)
  );
}

/**
 * Get .NET version details
 */
export function getDotNetVersionDetails(versionString: string): DotNetVersion | null {
  const parsed = parseDotNetVersion(versionString);
  if (!parsed) return null;
  
  return DOTNET_VERSIONS.find(v => 
    v.version === parsed || 
    v.version.startsWith(parsed)
  ) || null;
}

/**
 * Get all available .NET versions
 */
export function getAvailableDotNetVersions(): DotNetVersion[] {
  return DOTNET_VERSIONS.filter(v => v.status === "active");
}

/**
 * Get recommended upgrade target
 */
export function getRecommendedUpgradeTarget(currentVersion: string): DotNetVersion | null {
  const current = getDotNetVersionDetails(currentVersion);
  if (!current) return null;
  
  // Recommend LTS versions for stability
  const ltsVersions = DOTNET_VERSIONS.filter(v => 
    v.isLTS && 
    v.status === "active" &&
    parseFloat(v.version) > parseFloat(current.version)
  );
  
  if (ltsVersions.length > 0) {
    // Return newest LTS version
    return ltsVersions.sort((a, b) => parseFloat(b.version) - parseFloat(a.version))[0];
  }
  
  // Fallback: newest active version
  const activeVersions = DOTNET_VERSIONS.filter(v => 
    v.status === "active" &&
    parseFloat(v.version) > parseFloat(current.version)
  );
  
  if (activeVersions.length > 0) {
    return activeVersions.sort((a, b) => parseFloat(b.version) - parseFloat(a.version))[0];
  }
  
  return null;
}

/**
 * Calculate upgrade path and assess risk
 * This is the CRITICAL function that handles user's custom upgrade requests
 */
export function calculateUpgradePath(
  fromVersion: string, 
  toVersion: string
): UpgradePath {
  const from = getDotNetVersionDetails(fromVersion);
  const to = getDotNetVersionDetails(toVersion);
  
  // Validation: Check if versions exist
  if (!from) {
    return {
      from: fromVersion,
      to: toVersion,
      isValid: false,
      riskLevel: "critical",
      reasoning: `Invalid source version: ${fromVersion} does not exist. Available versions: ${getAvailableDotNetVersions().map(v => v.version).join(", ")}`,
      breakingChanges: [],
      requiredActions: ["Select a valid .NET version"],
      estimatedEffort: "trivial"
    };
  }
  
  if (!to) {
    // Target version not in our registry — but the user selected it, so treat it as valid
    const parsedTo = parseDotNetVersion(toVersion);
    return {
      from: fromVersion,
      to: toVersion,
      isValid: true,
      riskLevel: "medium",
      reasoning: `Upgrading to .NET ${parsedTo || toVersion} as requested by the user. This version is not in the local registry but will be used as specified.`,
      breakingChanges: [],
      requiredActions: [`Upgrade all project files to target .NET ${parsedTo || toVersion}`],
      estimatedEffort: from ? (parseFloat(parsedTo || toVersion) - parseFloat(from.version) > 2 ? "large" : "medium") : "medium"
    };
  }
  
  // Check if downgrade
  if (parseFloat(to.version) < parseFloat(from.version)) {
    return {
      from: fromVersion,
      to: toVersion,
      isValid: false,
      riskLevel: "critical",
      reasoning: `Downgrade detected: ${from.version} → ${to.version}. Downgrades are not supported. Current version is newer than target.`,
      breakingChanges: [],
      requiredActions: ["Select a target version newer than current version"],
      estimatedEffort: "trivial"
    };
  }
  
  // Check if already at target
  if (from.version === to.version) {
    return {
      from: fromVersion,
      to: toVersion,
      isValid: true,
      riskLevel: "low",
      reasoning: `Already at target version ${to.version}. No upgrade needed.`,
      breakingChanges: [],
      requiredActions: [],
      estimatedEffort: "trivial"
    };
  }
  
  // Check if target is EOL — warn but still allow (user's choice is source of truth)
  if (to.status === "eol") {
    return {
      from: fromVersion,
      to: toVersion,
      isValid: true,
      riskLevel: "high",
      reasoning: `Target version ${to.version} reached End of Life on ${to.endOfLife?.toDateString()}. Proceeding as requested by the user. Note: consider upgrading to an active version for long-term support.`,
      breakingChanges: [],
      requiredActions: [`Upgrade to .NET ${to.version} as requested`],
      estimatedEffort: "medium"
    };
  }
  
  // Calculate risk and breaking changes based on version jump
  const fromMajor = parseFloat(from.version);
  const toMajor = parseFloat(to.version);
  const versionJump = toMajor - fromMajor;
  
  let riskLevel: "low" | "medium" | "high" | "critical";
  let breakingChanges: string[] = [];
  let requiredActions: string[] = [];
  let estimatedEffort: "trivial" | "low" | "medium" | "high" | "very-high";
  
  // .NET Framework → .NET Core/5+ (MASSIVE CHANGE)
  if (from.version.startsWith("4.") && parseFloat(to.version) >= 5.0) {
    riskLevel = "critical";
    estimatedEffort = "very-high";
    breakingChanges = [
      "Complete platform change: .NET Framework (Windows-only) → .NET (cross-platform)",
      "Package changes: All System.* assemblies → NuGet packages",
      "API removals: Windows-specific APIs not available",
      "Configuration: web.config/app.config → appsettings.json",
      "Hosting: IIS-only → Kestrel (cross-platform)",
      "WCF removed (use gRPC or REST)",
      "ASP.NET MVC → ASP.NET Core MVC (complete rewrite)",
      "Entity Framework 6 → Entity Framework Core (breaking changes)"
    ];
    requiredActions = [
      "Install .NET SDK (not just runtime)",
      "Convert .csproj to SDK-style project format",
      "Migrate web.config to appsettings.json",
      "Replace incompatible NuGet packages",
      "Update API calls (many System.* APIs changed)",
      "Test on Linux/macOS if targeting cross-platform",
      "Update deployment configuration (Kestrel vs IIS)"
    ];
  }
  // .NET 5 → .NET 6+ (Major version upgrade)
  else if (versionJump >= 2) {
    riskLevel = "high";
    estimatedEffort = "high";
    breakingChanges = [
      `Skipping intermediate versions (${from.version} → ${to.version})`,
      "Multiple breaking changes accumulated across versions",
      "API surface area changes",
      "Behavior changes in runtime and libraries"
    ];
    requiredActions = [
      `Review breaking changes for EACH intermediate version`,
      `Update NuGet packages to compatible versions`,
      `Test thoroughly - multiple version jumps increase risk`
    ];
    
    // Add version-specific breaking changes
    if (fromMajor < 6 && toMajor >= 6) {
      breakingChanges.push(
        ".NET 6: Minimal APIs introduced",
        ".NET 6: DateOnly and TimeOnly types added",
        ".NET 6: LINQ improvements (may affect existing queries)"
      );
    }
    if (fromMajor < 7 && toMajor >= 7) {
      breakingChanges.push(
        ".NET 7: Required members feature",
        ".NET 7: Generic math interfaces",
        ".NET 7: Regex improvements (source generators)"
      );
    }
    if (fromMajor < 8 && toMajor >= 8) {
      breakingChanges.push(
        ".NET 8: Native AOT improvements",
        ".NET 8: System.Text.Json improvements (may affect serialization)",
        ".NET 8: ASP.NET Core identity changes"
      );
    }
  }
  // Next major version (e.g., .NET 7 → .NET 8)
  else if (versionJump === 1) {
    riskLevel = "medium";
    estimatedEffort = "medium";
    breakingChanges = [
      "Some API changes expected",
      "Library behavior changes possible",
      "Performance characteristics may differ"
    ];
    requiredActions = [
      `Review .NET ${to.version} breaking changes documentation`,
      "Update NuGet packages to compatible versions",
      "Run full test suite",
      "Monitor for deprecation warnings"
    ];
  }
  // Patch/minor version (e.g., .NET 8.0 → .NET 8.1)
  else {
    riskLevel = "low";
    estimatedEffort = "low";
    breakingChanges = [
      "Minimal breaking changes expected",
      "Mostly bug fixes and performance improvements"
    ];
    requiredActions = [
      "Update .NET SDK",
      "Run regression tests",
      "Check release notes for any breaking fixes"
    ];
  }
  
  return {
    from: from.version,
    to: to.version,
    isValid: true,
    riskLevel,
    reasoning: `Upgrading from ${from.version} (${from.channel}, ${from.status}) to ${to.version} (${to.channel}, ${to.status}). Version jump: ${versionJump.toFixed(1)} major versions.`,
    breakingChanges,
    requiredActions,
    estimatedEffort
  };
}

/**
 * Get upgrade suggestions for user prompt
 * Example: User says "upgrade to .NET 10" → We analyze and give detailed plan
 */
export function analyzeUserUpgradeIntent(
  currentVersion: string,
  userPrompt: string
): {
  suggestedTarget: string | null;
  alternatives: string[];
  warnings: string[];
  reasoning: string;
} {
  // Parse user intent (extract version numbers from prompt)
  const versionMatches = userPrompt.match(/\.?net\s*(\d+\.?\d*)/gi) || [];
  const requestedVersions = versionMatches
    .map(m => parseDotNetVersion(m))
    .filter(v => v !== null) as string[];
  
  // Check if user specified a version
  if (requestedVersions.length > 0 && requestedVersions[0] !== currentVersion) {
    const requestedVersion = requestedVersions[requestedVersions.length - 1]; // Take last mentioned version
    const isValid = isValidDotNetVersion(requestedVersion);
    
    if (isValid) {
      const upgradePath = calculateUpgradePath(currentVersion, requestedVersion);
      return {
        suggestedTarget: requestedVersion,
        alternatives: getAlternativeTargets(currentVersion, requestedVersion),
        warnings: upgradePath.isValid ? [] : [upgradePath.reasoning],
        reasoning: `User requested upgrade to .NET ${requestedVersion}. ${upgradePath.reasoning}`
      };
    } else {
      // Version not in our registry — but the USER selected it, so respect it
      return {
        suggestedTarget: requestedVersion,
        alternatives: getAvailableDotNetVersions().map(v => v.version),
        warnings: [
          `Note: .NET ${requestedVersion} is not in the local version registry but will be used as requested by the user.`
        ],
        reasoning: `User requested upgrade to .NET ${requestedVersion}. Using the user-selected version as the sole source of truth.`
      };
    }
  }
  
  // No specific version mentioned - recommend based on best practices
  const recommended = getRecommendedUpgradeTarget(currentVersion);
  return {
    suggestedTarget: recommended?.version || null,
    alternatives: getAvailableDotNetVersions().map(v => v.version),
    warnings: [],
    reasoning: `No specific target version mentioned. Recommending ${recommended?.version || "latest LTS"} (${recommended?.channel}) for stability and long-term support.`
  };
}

/**
 * Get alternative upgrade targets
 */
function getAlternativeTargets(currentVersion: string, requestedVersion: string): string[] {
  const current = getDotNetVersionDetails(currentVersion);
  if (!current) return [];
  
  const alternatives = DOTNET_VERSIONS
    .filter(v => 
      v.status === "active" &&
      parseFloat(v.version) > parseFloat(current.version) &&
      v.version !== requestedVersion
    )
    .sort((a, b) => parseFloat(b.version) - parseFloat(a.version))
    .map(v => v.version);
  
  return alternatives;
}

/**
 * Format upgrade path for display to user
 */
export function formatUpgradePathForUser(upgradePath: UpgradePath): string {
  if (!upgradePath.isValid) {
    return `❌ **Invalid Upgrade**: ${upgradePath.reasoning}\n\n**Required Actions:**\n${upgradePath.requiredActions.map(a => `- ${a}`).join('\n')}`;
  }
  
  const riskEmoji = {
    low: "✅",
    medium: "⚠️",
    high: "🔴",
    critical: "🚨"
  }[upgradePath.riskLevel];
  
  return `${riskEmoji} **Upgrade Plan: .NET ${upgradePath.from} → .NET ${upgradePath.to}**

**Risk Level:** ${upgradePath.riskLevel.toUpperCase()}
**Estimated Effort:** ${upgradePath.estimatedEffort}

**Breaking Changes:**
${upgradePath.breakingChanges.map(c => `- ${c}`).join('\n')}

**Required Actions:**
${upgradePath.requiredActions.map(a => `- ${a}`).join('\n')}

**Analysis:** ${upgradePath.reasoning}`;
}
