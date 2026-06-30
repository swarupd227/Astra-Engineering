import type { StackType } from "../types";
import type { StackProfile } from "./types";
import { getDotNetProfile } from "./dotnet";
import { getPythonProfile } from "./python";
import { getJavaProfile } from "./java";
import { getNodeProfile } from "./node";

export type { StackProfile } from "./types.js";

export function getProfile(stack: StackType, runtimeVersion?: string): StackProfile {
  switch (stack) {
    case "dotnet":
      return getDotNetProfile(runtimeVersion);
    case "python":
      return getPythonProfile(runtimeVersion);
    case "java":
      return getJavaProfile(runtimeVersion);
    case "node":
      return getNodeProfile(runtimeVersion);
    default:
      throw new Error(`Unknown stack: ${stack}`);
  }
}
