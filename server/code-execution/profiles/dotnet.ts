import type { StackProfile } from "./types";

export function getDotNetProfile(runtimeVersion?: string): StackProfile {
  const sdkVersion = runtimeVersion || "8.0";
  const image = `mcr.microsoft.com/dotnet/sdk:${sdkVersion}`;
  return {
    stack: "dotnet",
    image,
    installCommand: "dotnet restore",
    runCommand: "dotnet run",
    testCommand: "dotnet test",
    projectFile: undefined,
  };
}
