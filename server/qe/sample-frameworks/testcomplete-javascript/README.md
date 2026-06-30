# TestComplete + JavaScript Framework

Production-ready TestComplete test automation framework using page-object-style scripting with JavaScript and NameMapping.
Built for NAT2.0 autonomous testing.

## How to Import into TestComplete

1. Open TestComplete and create a new **Web** project
2. In the **Project Explorer**, right-click **Script** → **Add Existing Item**
3. Import the following in order:
   - `Script/Base/BaseHelper.js`
   - `Script/Base/BaseTest.js`
   - `Script/Pages/LoginPage.js`
   - `Script/Tests/LoginTests.js`
   - `Script/Tests/SuiteRunner.js`
4. Import test data:
   - `TestData/Config.js`
   - `TestData/LoginData.js`
5. Set up NameMapping (see `NameMapping/General.md` and `NameMapping/Login.md`)
6. Right-click the project → **Properties** → set **Default Browser** to Chrome

## How NameMapping Works

TestComplete's NameMapping creates a persistent alias tree that maps friendly names
to browser UI elements. Instead of using raw CSS/XPath selectors in scripts,
you reference elements like `Aliases.browser.pageLogin.usernameField`.

This makes your tests:
- **Resilient** — change the selector in one place, fixes all tests
- **Readable** — `clickElement(getLoginButton())` vs XPath soup
- **Maintainable** — NameMapping editor provides a visual element tree

## How to Run Tests

### Run the full suite
```
TestComplete → Test Engine → Run Routine → SuiteRunner.RunAllTests
```

### Run smoke tests only
```
TestComplete → Test Engine → Run Routine → SuiteRunner.RunSmoke
```

### Run a single test
```
TestComplete → Test Engine → Run Routine → LoginTests.testValidLogin
```

### From command line (TestComplete CLI)
```bash
TestComplete.exe "YourProject.pjs" /run /routine:"SuiteRunner.RunAllTests" /exit
```

## Project Structure
```
Script/
  Base/
    BaseHelper.js   ← Core interaction helpers (fill, click, assert, screenshot)
    BaseTest.js     ← Test lifecycle (setUp, tearDown, runTest wrapper)
  Pages/
    LoginPage.js    ← Page object for the Login page
  Tests/
    LoginTests.js   ← Login test cases
    SuiteRunner.js  ← Orchestrates all test files
TestData/
  Config.js         ← URLs, timeouts, global settings
  LoginData.js      ← Test credentials and user fixtures
NameMapping/
  General.md        ← NameMapping best practices and setup guide
  Login.md          ← Step-by-step NameMapping for the Login page
```

## Coding Conventions

- **One file per page** in `Script/Pages/` — named `<PageName>Page.js`
- **One file per feature** in `Script/Tests/` — named `<Feature>Tests.js`
- **All helper functions** go in `Script/Base/BaseHelper.js`
- **All test functions** must start with `test` (e.g. `testValidLogin`)
- **Use `runTest()`** wrapper for all tests — it handles setup, teardown, and logging automatically
- **Never hardcode URLs** — always use `BASE_URL` from `TestData/Config.js`
- **Use `//USEUNIT`** directives at the top of every script file to declare dependencies
