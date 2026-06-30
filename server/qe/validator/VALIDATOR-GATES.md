# NAT 2.0 — Post-Generation Validator Gates

Runs automatically after every framework generation, before files are delivered.
All 10 gates execute in parallel. **Blockers** and **Majors** block delivery. **Warnings** are logged but allowed through.

---

## Gate 01 — TypeScript Compilation

**File:** `gates/gate-01-typescript.ts`
**Severity:** Blocker

Runs `npx tsc --noEmit` in the generated project directory.
Every compiler error becomes one `ValidationError`.

| Check | Rule Code | Detail |
|-------|-----------|--------|
| Zero TypeScript errors | `TS<code>` | Any tsc error blocks delivery |

**Notes:**
- Skipped if `tsconfig.json` is missing (Gate 05 handles that separately)
- Skipped without tsconfig to avoid falling back to parent tsconfig and generating thousands of false errors

---

## Gate 02 — POM Layer Purity

**File:** `gates/gate-02-pom-purity.ts`
**Checks:** All files under `pages/`

| Rule Code | Severity | What it catches | Pattern |
|-----------|----------|-----------------|---------|
| `NO_EXPECT_IN_POM` | Blocker | `expect()` calls or `expect` import inside a POM file | `await expect(` or `import { expect }` |
| `NO_HARDCODED_URL_IN_POM` | Blocker | Absolute URLs in `page.goto()` | `page.goto('https://...')` |
| `NO_ASSERT_VERB_IN_POM_METHOD` | Major | Method names starting with `assert` or `verify` | `async assertXxx(` or `async verifyXxx(` |

**Fix guidance:**
- Move all `expect()` calls to `actions/business/` using `verifyText()`, `verifyUrl()`, `verifyVisible()`
- Replace hardcoded URLs with relative paths — Playwright resolves against `baseURL` in config
- Rename `assertXxx` → `getXxx()` (returns value) or `waitForXxx()` (waits for state)

---

## Gate 03 — Locator Pattern Safety

**File:** `gates/gate-03-locator-patterns.ts`
**Checks:** All files under `locators/`

| Rule Code | Severity | What it catches | Pattern |
|-----------|----------|-----------------|---------|
| `NO_EXACT_TEXT_EQUALITY_XPATH` | Major | Exact text equality in XPath | `normalize-space(...)="text"` |
| `NO_EXACT_HREF_EQUALITY_XPATH` | Major | Exact `@href` attribute equality | `@href="some/path"` |

**Fix guidance:**
- Replace `normalize-space(text())="Submit"` → `contains(normalize-space(text()), "Submit")`
- Replace `@href="/exact/path"` → `contains(@href, "distinctive-segment")`
- Exact equality breaks with minor whitespace differences and environment URL changes

---

## Gate 04 — Method Contract Verification

**File:** `gates/gate-04-method-contracts.ts`
**Severity:** Blocker
**Implementation:** TypeScript AST (`ts.createSourceFile`) — not regex

Verifies every method called on a POM instance in business actions actually exists in that POM class.

**Algorithm:**
1. Parse all `pages/*.ts` files → build registry: `ClassName → Set<methodName>`
2. Scan all `actions/business/*.ts` files → find `new XxxPage(page)` instantiations
3. For every `await varName.methodName()` call → verify `registry[ClassName].has(methodName)`

| Rule Code | Severity | What it catches |
|-----------|----------|-----------------|
| `METHOD_NOT_IN_POM` | Blocker | Method call in business action that doesn't exist in the POM class |

**Fix guidance:**
- Error message lists all available methods on the class
- Either use one of the listed method names or add the missing method to the POM first

---

## Gate 05 — Required File Manifest

**File:** `gates/gate-05-file-manifest.ts`
**Severity:** Blocker

Checks every required file and directory exists and is non-empty.

**Required files:**

| File | Purpose |
|------|---------|
| `helpers/universal.ts` | `prepareSite()` — imported by every test |
| `playwright.config.ts` | Test runner configuration |
| `tsconfig.json` | TypeScript compiler configuration |
| `package.json` | Dependencies |
| `fixtures/test-data.ts` | Parameterised test data |
| `.env.example` | Environment variable template |

**Required directories** (must exist and contain at least one `.ts` file):

| Directory | Layer |
|-----------|-------|
| `locators/` | Object Repository |
| `pages/` | Page Object Models |
| `actions/generic/` | Generic action helpers |
| `actions/business/` | Business workflow actions |
| `tests/` | Test specifications |

| Rule Code | Severity |
|-----------|----------|
| `REQUIRED_FILE_MISSING` | Blocker |
| `REQUIRED_DIRECTORY_EMPTY` | Blocker |

---

## Gate 06 — Class and File Naming

**File:** `gates/gate-06-naming.ts`
**Checks:** All files under `pages/` and `locators/`
**Severity:** Blocker

Detects garbled class names generated from session IDs or recording artifacts.

| Rule Code | Severity | What it catches |
|-----------|----------|-----------------|
| `GARBLED_CLASS_NAME` | Blocker | Class names matching random/session-ID patterns |

**Garbled name detection (`isGarbledName`):**

| Pattern | Example |
|---------|---------|
| 4+ consecutive consonants | `GvvvGdmiq`, `Qjccvc` |
| Mixed alphanumeric (letter-digit-letter-digit) | `Abc7cDef`, `a1b2c3` |
| 8+ consecutive lowercase characters | `gdmiqjcc` |

**Fix guidance:**
- Use page URL: take last 1–2 meaningful path segments → PascalCase → prepend brand name → append `Page`
- Example: `brand.com/contact-us` → `BrandContactUsPage`

---

## Gate 07 — Fixture PII Detection

**File:** `gates/gate-07-fixtures.ts`
**Checks:** `fixtures/test-data.ts`

Prevents personal data captured during recording from shipping as fixture defaults.

| Rule Code | Severity | What it catches | Example |
|-----------|----------|-----------------|---------|
| `NO_REAL_EMAIL_IN_FIXTURE` | Blocker | Real email address as default value | `\|\| "user@gmail.com"` |
| `NO_SHORT_PERSONAL_NAME` | Major | 2–12 char all-lowercase string not in safe-words list | `\|\| "chandra"` |
| `NO_NUMERIC_ONLY_SHORT_STRING` | Warning | All-digit string shorter than 5 chars | `\|\| "42"` |

**Safe email domains** (not flagged): `example.com`, `test.com`, `example.org`, `test.org`

**Safe words** (not flagged): `test`, `user`, `admin`, `guest`, `demo`, `sample`

**Fix guidance:**
- Email → `"test-user@example.com"`
- First name → `"Test"`, Last name → `"User"`
- Company → `"TestCo Inc."`, Phone → `"0000000000"`

---

## Gate 08 — Import Hygiene

**File:** `gates/gate-08-imports.ts`
**Checks:** All `.ts` files under `pages/`, `actions/generic/`, `actions/business/`, `tests/`
**Implementation:** TypeScript AST (`ts.createSourceFile`)
**Severity:** Major

Every named import must be referenced at least once in the file body.

| Rule Code | Severity | What it catches |
|-----------|----------|-----------------|
| `UNUSED_IMPORT` | Major | Imported symbol never called or referenced in the file |

**Notes:**
- Type-only imports (`import type { ... }` or `import { type X }`) are not flagged
- Catches the common pattern of importing the full `assert.actions` export list when only 2 functions are used

---

## Gate 09 — Test Structure Atomicity

**File:** `gates/gate-09-test-structure.ts`
**Checks:** All files under `tests/`
**Implementation:** TypeScript AST + regex

| Rule Code | Severity | What it catches |
|-----------|----------|-----------------|
| `MONOLITHIC_TEST` | Major | Single `test()` block with >2 business actions spanning >1 distinct URL path |
| `NO_UNUSED_CONTEXT` | Major | `context` destructured in test fixture but never called |

**Monolithic test detection:**
- Counts top-level business action calls in each `test()` block
- Extracts distinct URL paths from `verifyUrl()` calls in the same block
- Flags when: `businessActionCount > 2 AND distinctUrlPaths > 1`

**Fix guidance:**
- Split into one `test()` per user journey / URL destination
- Each block must start with `navigateTo(page, testData.baseUrl)` and `prepareSite(page)`
- Remove `context` from `async ({ page, context })` unless the test calls `context.newPage()` or `context.waitForEvent()`

---

## Gate 10 — Config Values

**File:** `gates/gate-10-config-values.ts`
**Checks:** `playwright.config.ts` and `package.json`

### playwright.config.ts

| Rule Code | Severity | Check |
|-----------|----------|-------|
| `FULLPARALLEL_MUST_BE_TRUE` | Major | `fullyParallel` must be `true` |
| `BASE_URL_MUST_USE_ENV_VAR` | Blocker | `baseURL` must reference `process.env.BASE_URL` |

### package.json

| Rule Code | Severity | Check |
|-----------|----------|-------|
| `PLAYWRIGHT_VERSION_MINIMUM` | Major | `@playwright/test` ≥ `1.50.0` (recommend `^1.52.0`) |
| `TYPESCRIPT_VERSION_MINIMUM` | Warning | `typescript` ≥ `5.5.0` |

---

## Severity Reference

| Severity | Blocks Delivery | Effect |
|----------|----------------|--------|
| **Blocker** | Yes | Project cannot compile or run correctly |
| **Major** | Yes | Project compiles but tests produce wrong results |
| **Warning** | No | Logged for awareness; delivery proceeds |

---

## Retry Loop

When validation fails, `runner.ts` injects the `promptForRetry` string back into the Claude generation prompt and retries up to **3 times**. Each retry only needs to fix the listed files — passing files are not regenerated.

```
generate → validate → [fail] → inject errors → generate → validate → [pass] → deliver
                                                         ↑
                                              promptForRetry string
```

After 3 failed attempts, `GenerationValidationError` is thrown with the full `ValidationResult` attached.

---

## Running the Self-Tests

```bash
npx tsx server/validator/validator.test.ts
```

Expected output: `10 passed, 0 failed`
