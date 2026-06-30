import type { StackType } from "../types";

export interface StackProfile {
  stack: StackType;
  image: string;
  installCommand: string;
  runCommand: string;
  testCommand: string;
  projectFile?: string;
}
