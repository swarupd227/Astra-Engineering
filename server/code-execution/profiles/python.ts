import type { StackProfile } from "./types";

const DEFAULT_IMAGE = "python:3.11";
const IMAGE_312 = "python:3.12";

export function getPythonProfile(runtimeVersion?: string): StackProfile {
  const image = runtimeVersion === "3.12" ? IMAGE_312 : DEFAULT_IMAGE;
  return {
    stack: "python",
    image,
    installCommand: "pip install -r requirements.txt || pip install .",
    runCommand: "python main.py || python -m app",
    testCommand: "python -m pytest || pytest",
    projectFile: undefined,
  };
}
