/**
 * Doc ingestion for RAG: static chunks for .NET and Python error resolution.
 * Can be extended with fetched docs (learn.microsoft.com, docs.python.org) later.
 */

import type { DocChunk, DocStack } from "./types";

const CHUNKS: DocChunk[] = [
  // .NET
  {
    stack: "dotnet",
    text: "CS0246: The type or namespace name could not be found. Add a using directive or assembly reference. Check that the namespace and type name are correct, and that the assembly containing the type is referenced.",
    source: "learn.microsoft.com",
    keywords: ["CS0246", "type or namespace", "could not be found", "using directive", "assembly reference"],
  },
  {
    stack: "dotnet",
    text: "CS1061: does not contain a definition for X. For method overloads, use the full signature. Update the call site to match the API available in the target framework version.",
    source: "learn.microsoft.com",
    keywords: ["CS1061", "does not contain a definition", "method overloads"],
  },
  {
    stack: "dotnet",
    text: "Obsolete APIs: Replace obsolete members with the recommended alternatives from the migration guide. Use [Obsolete] message and suggested replacement when fixing.",
    source: "learn.microsoft.com",
    keywords: ["obsolete", "deprecated", "ObsoleteAttribute", "replacement"],
  },
  {
    stack: "dotnet",
    text: "PackageReference and TargetFramework: In .NET Core/.NET 5+, use <TargetFramework>net8.0</TargetFramework> and <PackageReference Include=\"PackageName\" Version=\"X.Y.Z\" />. Run dotnet restore after changing .csproj.",
    source: "learn.microsoft.com",
    keywords: ["TargetFramework", "PackageReference", "csproj", "dotnet restore"],
  },
  {
    stack: "dotnet",
    text: "xUnit/NUnit/MSTest: Test methods must be public, return void or Task, and use [Fact] or [TestMethod]. Ensure test project references the main project and the correct test SDK.",
    source: "learn.microsoft.com",
    keywords: ["xUnit", "NUnit", "MSTest", "Fact", "TestMethod", "test project"],
  },
  // Python
  {
    stack: "python",
    text: "ModuleNotFoundError and ImportError: Ensure the module is installed (pip install), the package name matches (case-sensitive), and PYTHONPATH or sys.path includes the package root. Use python -m pytest when running tests from repo root.",
    source: "docs.python.org",
    keywords: ["ModuleNotFoundError", "ImportError", "No module named", "pip install", "PYTHONPATH"],
  },
  {
    stack: "python",
    text: "AttributeError: object has no attribute X. The API may have been renamed or moved in a newer version. Check the library changelog and use the new attribute or method name.",
    source: "docs.python.org",
    keywords: ["AttributeError", "has no attribute", "renamed", "moved"],
  },
  {
    stack: "python",
    text: "TypeError: function takes N positional arguments but M were given. Update the call to match the new signature; optional arguments may have been removed or made required.",
    source: "docs.python.org",
    keywords: ["TypeError", "positional arguments", "signature", "were given"],
  },
  {
    stack: "python",
    text: "pytest: Tests are discovered in files named test_*.py or *_test.py. Use assert for checks. For fixtures use @pytest.fixture. Run from project root: python -m pytest.",
    source: "docs.pytest.org",
    keywords: ["pytest", "test_", "assert", "fixture", "FAILED"],
  },
  {
    stack: "python",
    text: "DeprecationWarning and removal: Replace deprecated APIs with the recommended alternative from the library docs. Avoid suppressing warnings; fix the usage instead.",
    source: "docs.python.org",
    keywords: ["DeprecationWarning", "deprecated", "removed", "replacement"],
  },
];

let store: DocChunk[] = [...CHUNKS];

export function getDocChunks(): DocChunk[] {
  return store;
}

export function addDocChunks(chunks: DocChunk[]): void {
  store = store.concat(chunks);
}

export function clearDocChunks(): void {
  store = [...CHUNKS];
}

export function ingestStaticChunks(): void {
  // Already loaded above; call when you want to ensure baseline is present
  if (store.length === CHUNKS.length) return;
  store = [...CHUNKS];
}
