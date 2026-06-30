import type { StackProfile } from "./types";

export function getJavaProfile(runtimeVersion?: string): StackProfile {
  const jdkVersion = runtimeVersion || "17";
  const image = `maven:3-eclipse-temurin-${jdkVersion}`;
  return {
    stack: "java",
    image,
    installCommand: "mvn dependency:resolve -DskipTests -q",
    runCommand: "mvn exec:java -q",
    testCommand: "mvn test",
    projectFile: undefined,
  };
}
