import type { StackProfile } from "./types";

export function getNodeProfile(runtimeVersion?: string): StackProfile {
  const nodeVersion = runtimeVersion || "20";
  const image = `node:${nodeVersion}`;
  return {
    stack: "node",
    image,
    installCommand: "npm install",
    runCommand: "node .",
    testCommand: "npm test",
    projectFile: undefined,
  };
}
