# TypeScript + Playwright + POM Framework

Production-ready Playwright test automation framework using the Page Object Model pattern.
Built for NAT2.0 autonomous testing.

## Stack
| Component | Version |
|---|---|
| TypeScript | ^5.4.0 |
| Playwright | 1.44.0 |
| Allure Reporter | ^3.0.0 |
| Faker | ^8.0.0 |

## Setup

```bash
npm install
npx playwright install
cp .env.example .env   # edit BASE_URL
```

## Running Tests

```bash
# All tests
npm test

# Smoke tests only
npm run test:smoke

# Functional tests only
npm run test:functional

# Headed mode (watch the browser)
npm run test:headed

# Debug mode (step through)
npm run test:debug

# Open last HTML report
npm run test:report
```

## Environment Variables
| Variable | Default | Description |
|---|---|---|
| `BASE_URL` | `https://example.com` | Application under test |
| `CI` | `false` | Enables retries, disables parallelism controls |
| `HEADLESS` | `true` | Run browser headlessly |

## Project Structure
```
src/
  base/
    BasePage.ts          <- Abstract base for all page objects
    BaseTest.ts          <- Extended Playwright test fixture
  pages/
    LoginPage.ts         <- Example page object
    HomePage.ts          <- Example page object
  helpers/
    FormHelper.ts        <- Form interaction + assertion utilities
    NavigationHelper.ts  <- Link checking + navigation assertions
    AccessibilityHelper.ts <- WCAG 2.1 AA baseline checks
    SecurityHelper.ts    <- XSS + DB error exposure checks
  data/
    TestData.ts          <- Static test data + Faker generators
  tests/
    smoke/
      login.smoke.spec.ts     <- Critical-path smoke tests
    functional/
      login.functional.spec.ts <- Detailed functional tests
  global-setup.ts        <- Pre-suite verification
  global-teardown.ts     <- Post-suite summary
```

## How to Add a New Page Object

1. Create `src/pages/YourPage.ts`
2. Extend `BasePage`
3. Define all locators as `readonly` class properties
4. Write action methods using `fillInput()`, `clickElement()`, `getText()`, `isVisible()`

```typescript
export class SearchPage extends BasePage {
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly resultsCount: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput  = page.locator('#search-input');
    this.searchButton = page.locator('button[type="submit"]');
    this.resultsCount = page.locator('.results-count');
  }

  async search(term: string): Promise<void> {
    await this.fillInput(this.searchInput, term);
    await this.clickElement(this.searchButton);
    await this.waitForNavigation();
  }
}
```

## How to Add a New Test

1. Create `src/tests/smoke/your-feature.smoke.spec.ts` or `.functional.spec.ts`
2. Import `test` and `expect` from `../../base/BaseTest`
3. Use the pre-built fixtures: `loginPage`, `homePage`

```typescript
import { test, expect } from '../../base/BaseTest';

test.describe('Search @smoke', () => {
  test.beforeEach(async ({ homePage }) => {
    await homePage.navigate('/search');
  });

  test('search returns results', async ({ homePage, page }) => {
    await homePage.search('playwright');
    await expect(page).toHaveURL(/results/);
  });
});
```
