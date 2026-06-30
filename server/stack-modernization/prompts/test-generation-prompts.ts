/**
 * Test Generation Agent Prompts
 * Comprehensive prompts for generating production-quality unit tests
 * Now with smart token management for large codebases
 */

import type { StackModernizationState, ExtractedFile } from "../types";
import { chunkFileContent, estimateTokens } from "../services/token-manager";
import * as path from "path";
import { DEFAULT_MODEL_ID, MODEL_TEST_FILE_BUDGET_MAP } from "../../llm-config-constants";

export const TEST_GENERATION_SYSTEM_PROMPT = `You are a **Principal Test Engineer** with 25+ years of experience in:
- Test-Driven Development (TDD) and Behavior-Driven Development (BDD)
- Unit testing across all major frameworks (Jest, JUnit, xUnit, pytest, Go testing)
- Test coverage optimization and mutation testing
- Edge case identification and boundary testing
- Mock/stub strategies for complex dependencies
- Integration and E2E testing patterns

**Important rules:**
1. **Use only real namespaces/imports**: Extract the namespace, package, module path from the source file content. Do not guess, hallucinate, or fabricate class names, namespace paths, interface names, or service names.
2. **Use only real types**: If the source file has \`IOrderFlowService\`, your test should reference \`IOrderFlowService\` — not \`IOrderService\`, not \`ICurrencyService\`, not any name you invented.
3. **Read the source carefully**: Before writing any import/using statement, scan the source file for its exact namespace declaration, class names, method signatures, and constructor parameters.
4. **Mock only real dependencies**: If a constructor takes \`IOrderFlowService\`, mock \`IOrderFlowService\`. Do not create mocks for interfaces that don't exist in the source.
5. **Compilable output only**: Your test code should compile against the provided source. If you reference a type, it must exist in the source file or be a standard framework type.

**Your Expertise:**
- **Test Coverage**: Achieved 90%+ coverage on 500+ production systems
- **Bug Prevention**: Tests you write catch 95%+ of bugs before production
- **Test Quality**: Your tests are:
  - **Readable**: Anyone can understand what's being tested
  - **Maintainable**: Easy to update when code changes
  - **Fast**: Run in milliseconds, not seconds
  - **Reliable**: No flaky tests, no race conditions
  - **Comprehensive**: Cover happy path, edge cases, errors

**Your Testing Philosophy:**
1. **Test Behavior, Not Implementation**: Tests shouldn't break when refactoring
2. **Arrange-Act-Assert**: Clear 3-part test structure
3. **One Assertion Per Test**: Each test verifies one thing
4. **Test Names Are Documentation**: Reading the name should tell you everything
5. **No Magic Values**: Use descriptive constants and fixtures

**Test Types You Generate:**
- **Functional Tests**: Does it do what it should?
- **Edge Case Tests**: What about empty/null/undefined/zero/negative?
- **Error Handling Tests**: Does it fail gracefully?
- **Integration Tests**: Do components work together?
- **Performance Tests**: Is it fast enough?

**Your Standards:**
- AAA pattern (Arrange-Act-Assert) always
- Clear, descriptive test names
- No commented-out tests
- No skipped tests without explanation
- Mocks for external dependencies
- Setup/teardown for clean state`;

/**
 * Compute the relative import path from a test file to its source file.
 */
function computeImportPath(sourceFilePath: string, testFilePath: string, framework: string, sourceContent?: string): string {
  const srcDir = path.dirname(sourceFilePath).replace(/\\/g, "/");
  const testDir = path.dirname(testFilePath).replace(/\\/g, "/");
  const srcBasename = path.basename(sourceFilePath, path.extname(sourceFilePath));

  if (framework === "Jest") {
    let rel = path.relative(testDir, srcDir).replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    return `${rel}/${srcBasename}`;
  }
  if (framework === "xUnit") {
    return srcBasename;
  }
  if (framework === "pytest") {
    return sourceFilePath.replace(/\\/g, "/").replace(/\//g, ".").replace(/\.py$/, "");
  }
  if (framework === "JUnit 5") {
    if (sourceContent) {
      const packageMatch = sourceContent.match(/^package\s+([\w.]+);/m);
      if (packageMatch) return packageMatch[1];
    }
    // Infer package from directory structure (e.g., src/main/java/com/example → com.example)
    const javaIdx = srcDir.indexOf("/java/");
    if (javaIdx !== -1) {
      return srcDir.slice(javaIdx + 6).replace(/\//g, ".");
    }
    return srcBasename;
  }
  return srcBasename;
}

/**
 * Build a summary of types, interfaces, methods, and constructor signatures
 * from the source file. Prevents LLM from hallucinating non-existent types.
 */
function buildSourceMap(content: string, filePath: string): string {
  const lines: string[] = [];
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".cs") {
    const nsMatch = content.match(/^\s*namespace\s+([\w.]+)/m);
    if (nsMatch) lines.push(`- Namespace: \`${nsMatch[1]}\``);
    for (const m of content.matchAll(/(?:public|internal)\s+(?:partial\s+|abstract\s+|sealed\s+|static\s+)*(?:class|record)\s+(\w+)(?:\s*:\s*([^\n{]+))?/g)) {
      lines.push(`- Class: \`${m[1]}\`${m[2] ? ` (base: ${m[2].trim()})` : ""}`);
    }
    for (const m of content.matchAll(/(?:public|internal)\s+interface\s+(I\w+)/g)) {
      lines.push(`- Interface: \`${m[1]}\``);
    }
    for (const m of content.matchAll(/(?:public|internal)\s+(\w+)\s*\(([^)]+)\)/g)) {
      const cn = m[1];
      if (!["if", "for", "while", "switch", "catch", "return"].includes(cn)) {
        lines.push(`- Constructor: \`${cn}(${m[2].trim()})\``);
      }
    }
    for (const m of content.matchAll(/(?:public|protected)\s+(?:static\s+|virtual\s+|override\s+|async\s+)*(?:Task<[^>]+>|Task|IActionResult|ActionResult<[^>]+>|void|string|int|bool|[\w<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)/g)) {
      if (!["class", "interface", "struct", "enum", "if", "for"].includes(m[1])) {
        lines.push(`- Method: \`${m[1]}(${m[2].trim() || ""})\``);
      }
    }
  } else if (ext === ".java") {
    const pkgMatch = content.match(/^package\s+([\w.]+);/m);
    if (pkgMatch) lines.push(`- Package: \`${pkgMatch[1]}\``);
    for (const m of content.matchAll(/(?:public|protected)\s+(?:abstract\s+)?class\s+(\w+)/g)) lines.push(`- Class: \`${m[1]}\``);
    for (const m of content.matchAll(/(?:public|protected)\s+interface\s+(\w+)/g)) lines.push(`- Interface: \`${m[1]}\``);
  } else if (ext === ".py") {
    for (const m of content.matchAll(/^class\s+(\w+)/gm)) lines.push(`- Class: \`${m[1]}\``);
    for (const m of content.matchAll(/^def\s+(\w+)\s*\(([^)]*)\)/gm)) lines.push(`- Function: \`${m[1]}(${m[2]})\``);
  } else if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    for (const m of content.matchAll(/(?:export\s+)?(?:class|interface)\s+(\w+)/g)) lines.push(`- Type: \`${m[1]}\``);
    for (const m of content.matchAll(/(?:export\s+)?(?:function|const|let)\s+(\w+)/g)) lines.push(`- Export: \`${m[1]}\``);
  }

  return lines.length > 0 ? lines.join("\n") : "- (No structured types detected)";
}

export function buildTestGenerationPrompt(
  file: ExtractedFile,
  testFramework: string,
  state: StackModernizationState,
  model: string = DEFAULT_MODEL_ID
): string {
  const fileContent = file.content || "";
  const fileName = file.relativePath || file.fullPath || "unknown";
  const fileExt = fileName.split('.').pop()?.toLowerCase() || "";
  
  const functions = extractFunctions(fileContent, fileExt);
  const classes = extractClasses(fileContent, fileExt);
  const exports = extractExports(fileContent, fileExt);

  const modelBudgets: Record<string, number> = MODEL_TEST_FILE_BUDGET_MAP;
  const maxFileChars = modelBudgets[model] || 20000;
  const chunkedContent = chunkFileContent(fileContent, maxFileChars, fileName);
  const wasChunked = chunkedContent.length < fileContent.length;

  // Compute test output path and import path
  const DEVX_TEST_SCRIPTS_DIR = "DevX_testScripts";
  const ext = path.extname(fileName);
  const basename = path.basename(fileName, ext);
  const dirname = path.dirname(fileName);
  let testFilePath: string;
  if (testFramework === "Jest") {
    testFilePath = path.join(DEVX_TEST_SCRIPTS_DIR, dirname, `${basename}.test${ext}`).replace(/\\/g, "/");
  } else if (testFramework === "JUnit 5") {
    testFilePath = path.join(DEVX_TEST_SCRIPTS_DIR, fileName.replace("/main/", "/test/").replace(".java", "Test.java")).replace(/\\/g, "/");
  } else if (testFramework === "xUnit") {
    testFilePath = path.join(DEVX_TEST_SCRIPTS_DIR, dirname, "..", "Tests", `${basename}Tests${ext}`).replace(/\\/g, "/");
  } else if (testFramework === "pytest") {
    testFilePath = path.join(DEVX_TEST_SCRIPTS_DIR, dirname, `test_${basename}${ext}`).replace(/\\/g, "/");
  } else {
    testFilePath = path.join(DEVX_TEST_SCRIPTS_DIR, dirname, `${basename}.test${ext}`).replace(/\\/g, "/");
  }

  const importPath = computeImportPath(fileName, testFilePath, testFramework, fileContent);

  // Framework-specific import guidance
  let frameworkImportGuide = "";
  if (testFramework === "Jest") {
    frameworkImportGuide = `\n**IMPORT PATH**: Your test file will be saved at: \`${testFilePath}\`
Import the source file using: \`import { ... } from '${importPath}';\`
If the project uses path aliases (e.g., \`@/\`), use the relative path above instead.\n`;
  } else if (testFramework === "xUnit") {
    // Extract the real namespace from the source file content
    const nsMatch = fileContent.match(/^\s*namespace\s+([\w.]+)/m);
    let xunitNamespace = "";
    if (nsMatch) {
      xunitNamespace = nsMatch[1];
    } else {
      // Fallback: infer from directory path (e.g., Controllers/HomeController.cs → ProjectName.Controllers)
      const dirParts = dirname.replace(/\\/g, "/").split("/").filter(p => p && p !== ".");
      xunitNamespace = dirParts.length > 0 ? dirParts.join(".") : basename;
    }
    frameworkImportGuide = `\n**TEST FILE LOCATION**: \`${testFilePath}\`
Use \`using ${xunitNamespace};\` for the namespace. The test project references the source project.
**IMPORTANT**: The namespace above was extracted from the source file. Use it exactly as shown — do NOT guess or fabricate namespace names.\n`;
  } else if (testFramework === "pytest") {
    frameworkImportGuide = `\n**TEST FILE LOCATION**: \`${testFilePath}\`
Import using: \`from ${importPath} import ...\`
The project root is added to sys.path, so imports resolve from the project root.\n`;
  } else if (testFramework === "JUnit 5") {
    frameworkImportGuide = `\n**TEST FILE LOCATION**: \`${testFilePath}\`
Use the same package declaration as the source file. Import the class under test directly.\n`;
  }


  return `# Test Generation Task

## Your Mission
Generate **comprehensive, production-quality unit tests** for the file below. Your tests will be used in a real production system that just underwent a stack upgrade, so quality is critical. These tests must catch regressions and validate the upgraded code works correctly.

---

## 📁 File to Test

**Path**: \`${fileName}\`  
**Size**: ${file.size} bytes  
**Test Framework**: **${testFramework}**
${frameworkImportGuide}
${wasChunked ? `**Note**: File was chunked from ${fileContent.length} chars to ${chunkedContent.length} chars. Key sections (imports, signatures, code body) are preserved.` : ""}

### File Content
\`\`\`${fileExt}
${chunkedContent}
\`\`\`

### Detected Functions/Methods
${functions.length > 0 ? functions.map(f => `- \`${f}\``).join("\n") : "- No functions detected"}

### Detected Classes
${classes.length > 0 ? classes.map(c => `- \`${c}\``).join("\n") : "- No classes detected"}

### Detected Exports
${exports.length > 0 ? exports.map(e => `- \`${e}\``).join("\n") : "- No exports detected"}

### Source File Map (ONLY use these types — do NOT invent others)
${buildSourceMap(fileContent, fileName)}

---

## 🎯 Test Requirements

### 1. **Comprehensive Coverage**
Test EVERY:
- Public function/method
- Exported function/class
- Component render (if React/Vue)
- API endpoint (if controller)
- Data transformation
- Error handling path

### 2. **Test Categories**

#### Functional Tests (Happy Path)
Test normal operation with valid inputs:
- Function returns expected output
- Component renders correctly
- Data is transformed correctly
- API returns success

#### Edge Case Tests
Test boundary conditions:
- Empty inputs ([], "", 0, null, undefined)
- Very large inputs (long strings, big arrays)
- Boundary values (min, max, -1, 0, 1)
- Special characters (unicode, whitespace)

#### Error Handling Tests
Test failure scenarios:
- Invalid inputs (wrong type, out of range)
- Missing required parameters
- Network failures (if applicable)
- External service failures
- Exceptions are caught and handled

#### Integration Tests (if applicable)
Test interactions:
- Component uses child components correctly
- Functions call other functions correctly
- Data flows between layers

### 3. **Framework-Specific Requirements**

**${testFramework} Best Practices:**

${testFramework === 'Jest' ? `
- Use \`describe\` blocks for grouping related tests
- Use \`beforeEach\` / \`afterEach\` for setup/teardown
- Use \`jest.fn()\` for mocks
- Use \`expect(x).toBe(y)\` for primitives, \`.toEqual()\` for objects
- Use \`async/await\` for async tests
- Use \`.mockResolvedValue()\` for mocking promises
` : testFramework === 'JUnit 5' ? `
- Use \`@Test\` annotation for test methods
- Use \`@BeforeEach\` / \`@AfterEach\` for setup/teardown
- Use \`@DisplayName\` for readable test names
- Use \`assertEquals\`, \`assertTrue\`, \`assertThrows\`
- Use \`@Mock\` and \`@InjectMocks\` for mocking
- Use \`@Nested\` for test organization
` : testFramework === 'xUnit' ? `
- Use \`[Fact]\` for simple tests
- Use \`[Theory]\` with \`[InlineData]\` for parameterized tests
- Use constructor for setup, \`IDisposable\` for teardown
- Use \`Assert.Equal\`, \`Assert.True\`, \`Assert.Throws\`
- Use \`Moq\` library for mocking
` : testFramework === 'pytest' ? `
- Use \`test_*\` naming convention
- Use \`@pytest.fixture\` for setup
- Use \`assert\` statements (no special assert methods)
- Use \`pytest.raises\` for exception testing
- Use \`unittest.mock\` or \`pytest-mock\` for mocking
- Use \`@pytest.mark.parametrize\` for multiple inputs
` : `
- Follow framework conventions
- Use appropriate assertion methods
- Mock external dependencies
- Clear test names
`}

### 4. **Test Structure (AAA Pattern)**

Every test must follow:
\`\`\`
// Arrange: Set up test data and preconditions
const input = { id: 1, name: "test" };
const expected = { success: true, data: input };

// Act: Execute the function/method being tested
const result = myFunction(input);

// Assert: Verify the outcome
expect(result).toEqual(expected);
\`\`\`

### 5. **Test Naming Convention**

Use descriptive names that explain:
- What is being tested
- Under what conditions
- What is the expected outcome

**Examples:**
- ✅ \`test_getUserById_withValidId_returnsUser\`
- ✅ \`shouldRenderLoadingSpinner_whenDataIsLoading\`
- ✅ \`calculateTotal_withEmptyCart_returnsZero\`
- ❌ \`testFunction\` (too vague)
- ❌ \`test1\` (meaningless)

### 6. **Mocking Strategy**

Mock external dependencies:
- HTTP requests (use mock fetch/axios)
- Database calls (mock repository/DAO)
- File system operations
- External services (APIs, auth)
- Date/time (for deterministic tests)
- Random number generation

**Don't mock:**
- The thing you're testing
- Simple utility functions
- Standard library functions

### 7. **Strict type fidelity**
- Only reference types, interfaces, classes, and methods from the **Source File Map** above
- Do not invent service names (e.g., don't create \`ICurrencyService\` if only \`IOrderFlowService\` exists)
- Do not assume naming conventions — read the actual source code
- For constructor dependencies, mock ONLY the parameters listed in the Source File Map
- If the source file has a single service handling multiple operations, test through THAT service — do NOT split it into imagined separate services

---

## 📝 Output Format

Return **ONLY the complete test file code**. No explanations, no markdown wrapper (unless it's a code fence).

### File Structure
\`\`\`${fileExt}
${testFramework === 'Jest' ? `// Import the functions/classes to test
import { functionName, ClassName } from '../path/to/source';

// Mock external dependencies if needed
jest.mock('../path/to/dependency');

describe('ClassName or functionName', () => {
  // Setup/teardown
  beforeEach(() => {
    // Reset mocks, clear state
  });

  describe('functionName', () => {
    describe('with valid input', () => {
      it('should return expected result', () => {
        // Arrange
        const input = 'test';
        
        // Act
        const result = functionName(input);
        
        // Assert
        expect(result).toBe('TEST');
      });
    });

    describe('with invalid input', () => {
      it('should throw error for null input', () => {
        expect(() => functionName(null)).toThrow('Input cannot be null');
      });
    });
  });
});` : testFramework === 'JUnit 5' ? `import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

@DisplayName("ClassName Tests")
class ClassNameTest {
    
    private ClassName instance;
    
    @BeforeEach
    void setUp() {
        instance = new ClassName();
    }
    
    @Nested
    @DisplayName("methodName tests")
    class MethodNameTests {
        
        @Test
        @DisplayName("should return expected result with valid input")
        void shouldReturnExpectedResultWithValidInput() {
            // Arrange
            String input = "test";
            
            // Act
            String result = instance.methodName(input);
            
            // Assert
            assertEquals("TEST", result);
        }
        
        @Test
        @DisplayName("should throw exception for null input")
        void shouldThrowExceptionForNullInput() {
            assertThrows(IllegalArgumentException.class, () -> {
                instance.methodName(null);
            });
        }
    }
}` : `// Import testing framework
// Import functions/classes to test
// Import mocking libraries if needed

// Setup test fixtures

// Test cases
// - Happy path tests
// - Edge case tests
// - Error handling tests

// Each test follows AAA pattern`}
\`\`\`

---

## ⚠️ Critical Requirements

1. **Analyze the actual code**: Generate tests based on what the code actually does, not what you think it might do
2. **Executable**: Tests must run without modification
3. **No placeholders**: No TODO comments, no "add test here", no skeleton tests
4. **COMPLETE IMPORTS**: Include all necessary imports (testing framework, mocks, source files)
5. **REALISTIC DATA**: Use realistic test data, not just "test" or "foo"
6. **COVER EDGE CASES**: Don't just test happy path - test nulls, empties, errors
7. **PROPER MOCKING**: Mock external dependencies correctly
8. **CLEAR ASSERTIONS**: Use appropriate assertion methods
9. **NO FLAKY TESTS**: No random data, no timing dependencies, no shared state
10. **RETURN ONLY CODE**: No explanations before or after the code

**Generate the complete test file now. Make it production-ready.**`;
}

// Helper functions to extract code structure
function extractFunctions(code: string, ext: string): string[] {
  const functions: string[] = [];
  
  // JavaScript/TypeScript
  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
    const patterns = [
      /function\s+(\w+)/g,
      /const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
      /(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/g,
      /export\s+(?:async\s+)?function\s+(\w+)/g,
    ];
    
    for (const pattern of patterns) {
      const matches = code.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && !functions.includes(match[1])) {
          functions.push(match[1]);
        }
      }
    }
  }
  
  // C#
  if (ext === 'cs') {
    const reserved = new Set(["class", "interface", "enum", "struct", "if", "for", "while", "switch", "catch", "return", "new", "namespace"]);
    const pattern = /(?:public|private|protected|internal)\s+(?:static\s+|virtual\s+|override\s+|async\s+|abstract\s+)*(?:[\w<>\[\]?,\s]+?)\s+(\w+)\s*\(/g;
    const matches = code.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && !reserved.has(match[1]) && !functions.includes(match[1])) {
        functions.push(match[1]);
      }
    }
  }

  // Java
  if (ext === 'java') {
    const pattern = /(?:public|private|protected)\s+(?:static\s+)?[\w<>[\]]+\s+(\w+)\s*\(/g;
    const matches = code.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1] !== 'class' && !functions.includes(match[1])) {
        functions.push(match[1]);
      }
    }
  }

  // Python
  if (ext === 'py') {
    const pattern = /def\s+(\w+)\s*\(/g;
    const matches = code.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && !functions.includes(match[1])) {
        functions.push(match[1]);
      }
    }
  }

  return functions.slice(0, 20);
}

function extractClasses(code: string, ext: string): string[] {
  const classes: string[] = [];

  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
    const pattern = /class\s+(\w+)/g;
    for (const match of code.matchAll(pattern)) {
      if (match[1] && !classes.includes(match[1])) classes.push(match[1]);
    }
  }

  if (ext === 'cs') {
    // C# classes, interfaces, enums, records
    for (const m of code.matchAll(/(?:public|internal|private)\s+(?:partial\s+|abstract\s+|sealed\s+|static\s+)*(?:class|record)\s+(\w+)/g)) {
      if (m[1] && !classes.includes(m[1])) classes.push(m[1]);
    }
    for (const m of code.matchAll(/(?:public|internal)\s+interface\s+(I\w+)/g)) {
      if (m[1] && !classes.includes(m[1])) classes.push(m[1]);
    }
    for (const m of code.matchAll(/(?:public|internal)\s+enum\s+(\w+)/g)) {
      if (m[1] && !classes.includes(m[1])) classes.push(m[1]);
    }
  }

  if (ext === 'java') {
    const pattern = /(?:public|private|protected)?\s*class\s+(\w+)/g;
    for (const match of code.matchAll(pattern)) {
      if (match[1] && !classes.includes(match[1])) classes.push(match[1]);
    }
    for (const m of code.matchAll(/(?:public|protected)?\s*interface\s+(\w+)/g)) {
      if (m[1] && !classes.includes(m[1])) classes.push(m[1]);
    }
  }

  if (ext === 'py') {
    const pattern = /class\s+(\w+)/g;
    for (const match of code.matchAll(pattern)) {
      if (match[1] && !classes.includes(match[1])) classes.push(match[1]);
    }
  }

  return classes;
}

function extractExports(code: string, ext: string): string[] {
  const exports: string[] = [];

  if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
    const patterns = [
      /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g,
      /export\s*{\s*([^}]+)\s*}/g,
    ];
    for (const pattern of patterns) {
      for (const match of code.matchAll(pattern)) {
        if (match[1]) {
          const items = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]);
          exports.push(...items);
        }
      }
    }
  }

  if (ext === 'cs') {
    // C# public types are effectively exports
    for (const m of code.matchAll(/(?:public|internal)\s+(?:partial\s+|abstract\s+|sealed\s+|static\s+)*(?:class|record|struct|interface|enum)\s+(\w+)/g)) {
      if (m[1]) exports.push(m[1]);
    }
  }

  if (ext === 'java') {
    for (const m of code.matchAll(/(?:public)\s+(?:abstract\s+)?(?:class|interface|enum)\s+(\w+)/g)) {
      if (m[1]) exports.push(m[1]);
    }
  }

  if (ext === 'py') {
    for (const m of code.matchAll(/^class\s+(\w+)/gm)) {
      if (m[1]) exports.push(m[1]);
    }
    for (const m of code.matchAll(/^def\s+(\w+)/gm)) {
      if (m[1] && !m[1].startsWith('_')) exports.push(m[1]);
    }
  }

  return [...new Set(exports)];
}
