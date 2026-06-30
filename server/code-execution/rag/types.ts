export type DocStack = "dotnet" | "python";

export interface DocChunk {
  stack: DocStack;
  text: string;
  source?: string;
  keywords?: string[];
}
