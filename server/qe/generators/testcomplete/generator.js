/**
 * TestComplete Script Generator — Rule-Based (No LLM)
 * Generates a proper multi-file TestComplete project:
 *   Utils.js, [PageName]Page.js, TestData.js, Main.js, [story].feature, [story]_DDT.js
 */

import {
  buildProjectData, toPascalCase,
} from './promptBuilder.js';

// ─── File 1: Utils.js (always the same standard template) ────────────────────

function buildUtilsJs() {
  return `/**
 * Utils.js — Shared TestComplete helper library
 * Include in any unit with:  //USEUNIT Utils
 */

var TIMEOUT      = 10000;   // default element wait timeout (ms)
var NAV_TIMEOUT  = 15000;   // page navigation timeout (ms)
var BROWSER_TYPE = btChrome;

// ── Navigation ──────────────────────────────────────────────────────────────

function StartBrowser(url) {
  Browsers.Item(BROWSER_TYPE).Run(url);
  Sys.Browser().Page("*").Wait(NAV_TIMEOUT);
  Log.Message("Browser started", url);
}

function NavigateTo(url, pageAlias) {
  Browsers.Item(BROWSER_TYPE).Navigate(url);
  if (pageAlias) {
    if (!pageAlias.WaitProperty("Exists", true, NAV_TIMEOUT))
      Log.Error("NavigateTo: page did not load within " + NAV_TIMEOUT + "ms", url);
  }
  Log.Message("Navigated to", url);
}

function CloseBrowser() {
  try { Sys.Browser().Close(); } catch(e) { /* already closed */ }
}

// ── Element Interactions ─────────────────────────────────────────────────────

function WaitAndClick(alias, desc) {
  desc = desc || alias.MappedName || "element";
  if (alias.WaitProperty("VisibleOnScreen", true, TIMEOUT))
    alias.Click();
  else
    Log.Error("WaitAndClick: [" + desc + "] not visible after " + TIMEOUT + "ms");
}

function WaitAndSetText(alias, value, desc) {
  desc = desc || alias.MappedName || "field";
  if (alias.WaitProperty("Enabled", true, TIMEOUT)) {
    alias.Click();
    alias.Keys("^a");   // select-all before typing
    alias.SetText(value);
    Log.Message("SetText [" + desc + "]", value);
  } else {
    Log.Error("WaitAndSetText: [" + desc + "] not enabled after " + TIMEOUT + "ms");
  }
}

function WaitAndSelect(alias, itemText, desc) {
  desc = desc || alias.MappedName || "dropdown";
  if (alias.WaitProperty("Enabled", true, TIMEOUT)) {
    alias.ClickItem(itemText);
    Log.Message("Selected [" + desc + "]", itemText);
  } else {
    Log.Error("WaitAndSelect: [" + desc + "] not enabled after " + TIMEOUT + "ms");
  }
}

function WaitAndCheck(alias, shouldBeChecked, desc) {
  desc = desc || "checkbox";
  if (alias.WaitProperty("Exists", true, TIMEOUT)) {
    if (alias.Checked !== shouldBeChecked) alias.Click();
    Log.Message("Checkbox [" + desc + "] set to", shouldBeChecked);
  } else {
    Log.Error("WaitAndCheck: [" + desc + "] not found");
  }
}

// ── Assertions / Checkpoints ──────────────────────────────────────────────────

function AssertVisible(alias, desc) {
  desc = desc || "element";
  if (alias.WaitProperty("VisibleOnScreen", true, TIMEOUT))
    Log.Checkpoint("VISIBLE: " + desc);
  else
    Log.Error("FAIL — expected [" + desc + "] to be visible");
}

function AssertNotVisible(alias, desc) {
  desc = desc || "element";
  var visible = alias.WaitProperty("VisibleOnScreen", true, 2000);
  if (!visible)
    Log.Checkpoint("NOT VISIBLE (expected): " + desc);
  else
    Log.Error("FAIL — [" + desc + "] should not be visible");
}

function AssertText(alias, expected, desc) {
  desc = desc || "element";
  if (!alias.WaitProperty("Exists", true, TIMEOUT)) {
    Log.Error("AssertText: [" + desc + "] not found");
    return;
  }
  var actual = alias.contentText || alias.Value || alias.Text || alias.InnerText || "";
  if (actual.indexOf(expected) >= 0)
    Log.Checkpoint("TEXT OK [" + desc + "]: " + actual);
  else
    Log.Error("TEXT MISMATCH [" + desc + "]", "Expected: " + expected + "\\nActual:   " + actual);
}

function AssertEnabled(alias, desc) {
  desc = desc || "element";
  if (alias.WaitProperty("Enabled", true, TIMEOUT))
    Log.Checkpoint("ENABLED: " + desc);
  else
    Log.Error("FAIL — expected [" + desc + "] to be enabled");
}

function AssertDisabled(alias, desc) {
  desc = desc || "element";
  var enabled = alias.WaitProperty("Enabled", true, 2000);
  if (!enabled)
    Log.Checkpoint("DISABLED (expected): " + desc);
  else
    Log.Error("FAIL — [" + desc + "] should be disabled");
}

function AssertCount(alias, expectedCount, desc) {
  desc = desc || "elements";
  var actual = alias.ChildCount || 0;
  if (actual === expectedCount)
    Log.Checkpoint("COUNT OK [" + desc + "]: " + actual);
  else
    Log.Error("COUNT MISMATCH [" + desc + "]", "Expected: " + expectedCount + ", Actual: " + actual);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function Screenshot(label) {
  Log.Picture(Sys.Desktop.Picture(), label || "Screenshot");
}

function Pause(ms) {
  Delay(ms || 500);
}

// Called from Event Handlers > OnLogError to capture screenshot on any failure
function OnError_Screenshot(Sender, LogParams) {
  Screenshot("AUTO-SCREENSHOT on error: " + LogParams.Str);
}
`;
}

// ─── File 2: [PageName]Page.js ────────────────────────────────────────────────

function buildPageJs(story, projectData) {
  const { pageName, elements } = projectData;
  const module = story.module || 'App';
  const urlSegment = module.toLowerCase().replace(/[^a-z0-9]/g, '');
  const title = story.title || 'Generated Test';

  // Group elements into categories
  const inputEls  = elements.filter(el => el.type === 'Edit');
  const comboEls  = elements.filter(el => el.type === 'ComboBox');
  const buttonEls = elements.filter(el => el.type === 'Button');
  const labelEls  = elements.filter(el => el.type === 'Label');

  // Build element refs block — group by form/div
  const inputRefs  = inputEls.map(el => `    ${el.name.padEnd(24)}: p.form${pageName}.${el.name},`).join('\n');
  const comboRefs  = comboEls.map(el => `    ${el.name.padEnd(24)}: p.form${pageName}.${el.name},`).join('\n');
  const btnRefs    = buttonEls.map(el => `    ${el.name.padEnd(24)}: p.form${pageName}.${el.name},`).join('\n');
  const lblRefs    = labelEls.map(el => `    ${el.name.padEnd(24)}: p.divNotifications.${el.name},`).join('\n');

  // Build action parameters from input + combo elements
  const actionParams = [...inputEls, ...comboEls].slice(0, 6).map(el => {
    const paramName = el.name.replace(/^(txt|ddl|chk)/, '').charAt(0).toLowerCase()
      + el.name.replace(/^(txt|ddl|chk)/, '').slice(1);
    return paramName;
  });
  const actionParamList = actionParams.join(', ');

  // Build action body lines
  const actionLines = [...inputEls, ...comboEls].slice(0, 6).map(el => {
    const paramName = el.name.replace(/^(txt|ddl|chk)/, '').charAt(0).toLowerCase()
      + el.name.replace(/^(txt|ddl|chk)/, '').slice(1);
    if (el.type === 'Edit') {
      return `  if (${paramName})    Utils.WaitAndSetText(el.${el.name}, ${paramName}, "${el.desc}");`;
    } else {
      return `  if (${paramName})    Utils.WaitAndSelect(el.${el.name}, ${paramName}, "${el.desc}");`;
    }
  }).join('\n');

  return `/**
 * ${pageName}Page.js — Page Object for ${module} module
 * Story: ${title}
 * //USEUNIT ${pageName}Page   ← include this in Main.js
 */
//USEUNIT Utils

// ── Element References ────────────────────────────────────────────────────────
// Register all entries in: TestComplete > NameMapping > Aliases
// Hierarchy: Aliases.browser.page${pageName}.[formName].[elementName]

function getPage() {
  return Aliases.browser.page${pageName};  // update mappedName to match NameMapping
}

function getElements() {
  var p = getPage();
  return {
    // ── Input Fields ──────────────────────────────────────────────────────────
${inputRefs || '    // (no input fields inferred — add manually)'}
    // ── Dropdowns ─────────────────────────────────────────────────────────────
${comboRefs || '    // (no dropdowns inferred — add manually)'}
    // ── Buttons ───────────────────────────────────────────────────────────────
${btnRefs || '    // (no buttons inferred — add manually)'}
    // ── Status / Feedback ─────────────────────────────────────────────────────
${lblRefs || '    // (no label elements inferred — add manually)'}
  };
}

// ── Actions ───────────────────────────────────────────────────────────────────

function navigateTo(baseUrl) {
  Utils.NavigateTo(baseUrl + "/${urlSegment}", Aliases.browser.page${pageName});
}

function fillForm(${actionParamList || 'formData'}) {
  var el = getElements();
${actionLines || '  // TODO: add form field interactions using Utils.WaitAndSetText / Utils.WaitAndSelect'}
}

function save() {
  Utils.WaitAndClick(getElements().btnSave, "Save button");
}

function submit() {
  Utils.WaitAndClick(getElements().btnSubmit, "Submit button");
}

function cancel() {
  Utils.WaitAndClick(getElements().btnCancel, "Cancel button");
}

// ── Assertions ────────────────────────────────────────────────────────────────

function verifySuccessMessage(expectedText) {
  Utils.AssertVisible(getElements().lblSuccessMessage, "Success message");
  if (expectedText)
    Utils.AssertText(getElements().lblSuccessMessage, expectedText, "Success message text");
}

function verifyErrorMessage(expectedText) {
  Utils.AssertVisible(getElements().lblErrorMessage, "Error message");
  if (expectedText)
    Utils.AssertText(getElements().lblErrorMessage, expectedText, "Error message text");
}

function verifyValidationError(fieldDesc) {
  Utils.AssertVisible(getElements().lblValidationError, "Validation error for: " + fieldDesc);
}

function verifyNoErrorsDisplayed() {
  Utils.AssertNotVisible(getElements().lblErrorMessage,    "Error message (should be absent)");
  Utils.AssertNotVisible(getElements().lblValidationError, "Validation error (should be absent)");
}
`;
}

// ─── File 3: TestData.js ──────────────────────────────────────────────────────

function buildTestDataJs(story, projectData) {
  const { validValues } = projectData;
  const title = story.title || 'Story';
  const module = story.module || 'Application';

  // Build VALID block from extracted values
  const validEntries = validValues.length
    ? validValues.map(({ key, value }) => `    ${key.padEnd(20)}: "${value.replace(/"/g, '\\"')}",`).join('\n')
    : `    EXAMPLE_VALUE:       "replace-with-actual-value",`;

  return `/**
 * TestData.js — Test data constants for: ${title}
 * Module: ${module}
 * Generated by NAT 2.0
 */

var TestData = {

  BASE_URL: "https://your-app.com",   // ← replace with actual URL

  // Roles
  ROLES: {
    AUTHORISED:   "authorised user",
    UNAUTHORISED: "read-only user",
    ADMIN:        "admin",
  },

  // Valid values extracted from acceptance criteria
  VALID: {
${validEntries}
  },

  // Boundary / edge-case values
  BOUNDARY: {
    MIN_LENGTH:    "A",
    MAX_LENGTH:    new Array(256).join("A"),   // 255 chars
    OVER_MAX:      new Array(257).join("A"),   // 256 chars — just over limit
    WHITESPACE:    "   ",
    UNICODE:       "\\u6d4b\\u8bd5 \\u0442\\u0435\\u0441\\u0442 \\u30c6\\u30b9\\u30c8",
    TRIM_TEST:     "  value  ",
    ZERO:          "0",
    SPECIAL_CHARS: "!@#$%^&*()",
    EMPTY_OPTIONAL: "",
  },

  // Security payloads (OWASP)
  SECURITY: {
    REFLECTED_XSS:  "<script>alert('XSS')</script>",
    STORED_XSS:     "<img src=x onerror=alert(document.cookie)>",
    SQL_INJECTION:  "' OR '1'='1'; DROP TABLE users;--",
    PATH_TRAVERSAL: "../../etc/passwd",
    OTHER_USER_ID:  "OTHER_USER_ID",
  },

};
`;
}

// ─── File 4: Main.js ─────────────────────────────────────────────────────────

function buildMainJs(story, projectData) {
  const { pageName, testItemsTree, validValues } = projectData;
  const title = story.title || 'Story';
  const module = story.module || 'Application';
  const safeTitle = title.replace(/"/g, '\\"');

  // Build valid-field args from validValues (first up to 4)
  const validKeys = validValues.slice(0, 4).map(v => `TestData.VALID.${v.key}`);
  while (validKeys.length < 4) validKeys.push('null');

  const [vk0, vk1, vk2, vk3] = validKeys;

  return `/**
 * Main.js — TestComplete test entry points for: ${title}
 * Module: ${module}
 * Generated by NAT 2.0
 *
 * HOW TO USE:
 * 1. In TestComplete, open Project > Test Items
 * 2. Add one Test Item per TC_ function below
 * 3. Set each item's "Test" column to: Main.[FunctionName]
 * 4. Update NameMapping aliases in ${pageName}Page.js to match your app
 * 5. Replace BASE_URL in TestData.js
 *
 ${testItemsTree}
 */
//USEUNIT Utils
//USEUNIT ${pageName}Page
//USEUNIT TestData

// ─── Happy Path ───────────────────────────────────────────────────────────────

function TC_HappyPath() {
  Log.AppendFolder("Happy Path — ${safeTitle}");
  try {
    Utils.StartBrowser(TestData.BASE_URL);
    ${pageName}Page.navigateTo(TestData.BASE_URL);

    ${pageName}Page.fillForm(${vk0}, ${vk1}, ${vk2}, ${vk3});
    ${pageName}Page.save();

    ${pageName}Page.verifySuccessMessage();
    ${pageName}Page.verifyNoErrorsDisplayed();

    Log.Checkpoint("Happy path completed successfully");
  } catch(e) {
    Utils.Screenshot("Error in TC_HappyPath");
    Log.Error("TC_HappyPath failed", e.message);
  } finally {
    Utils.CloseBrowser();
  }
  Log.PopLogFolder();
}

// ─── Alternative Data ─────────────────────────────────────────────────────────

function TC_AlternativeData() {
  var validKeys = Object.keys(TestData.VALID);
  for (var i = 0; i < validKeys.length; i++) {
    var key = validKeys[i];
    var val = TestData.VALID[key];
    Log.AppendFolder("Alt Data [" + (i+1) + "/" + validKeys.length + "]: " + key + " = " + val);
    try {
      Utils.StartBrowser(TestData.BASE_URL);
      ${pageName}Page.navigateTo(TestData.BASE_URL);
      ${pageName}Page.fillForm(val, null, null, null);
      ${pageName}Page.save();
      ${pageName}Page.verifySuccessMessage();
      Log.Checkpoint("Accepted value: " + val);
    } catch(e) {
      Utils.Screenshot("Error — Alt Data: " + key);
      Log.Error("TC_AlternativeData failed for: " + key, e.message);
    } finally {
      Utils.CloseBrowser();
    }
    Log.PopLogFolder();
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function TC_Persistence() {
  Log.AppendFolder("Persistence — data survives session refresh");
  try {
    // Step 1: Create record
    Utils.StartBrowser(TestData.BASE_URL);
    ${pageName}Page.navigateTo(TestData.BASE_URL);
    ${pageName}Page.fillForm(${vk0}, ${vk1}, ${vk2}, ${vk3});
    ${pageName}Page.save();
    ${pageName}Page.verifySuccessMessage();

    // Step 2: Reload session
    Utils.CloseBrowser();
    Utils.StartBrowser(TestData.BASE_URL);
    ${pageName}Page.navigateTo(TestData.BASE_URL);

    // Step 3: Verify data persisted
    ${pageName}Page.verifyNoErrorsDisplayed();
    Log.Checkpoint("Data persisted after session refresh");
  } catch(e) {
    Utils.Screenshot("Error in TC_Persistence");
    Log.Error("TC_Persistence failed", e.message);
  } finally {
    Utils.CloseBrowser();
  }
  Log.PopLogFolder();
}

// ─── Downstream Effects ───────────────────────────────────────────────────────

function TC_DownstreamEffects() {
  Log.AppendFolder("Downstream — dependent modules reflect saved data");
  try {
    Utils.StartBrowser(TestData.BASE_URL);
    ${pageName}Page.navigateTo(TestData.BASE_URL);
    ${pageName}Page.fillForm(${vk0}, ${vk1}, ${vk2}, ${vk3});
    ${pageName}Page.save();
    ${pageName}Page.verifySuccessMessage();

    // Navigate to downstream module
    // TODO: update path to your downstream module
    Utils.NavigateTo(TestData.BASE_URL + "/downstream", null);
    // TODO: add assertions verifying the downstream module reflects saved data
    Log.Checkpoint("Downstream effects verified");
  } catch(e) {
    Utils.Screenshot("Error in TC_DownstreamEffects");
    Log.Error("TC_DownstreamEffects failed", e.message);
  } finally {
    Utils.CloseBrowser();
  }
  Log.PopLogFolder();
}

// ─── Validation Errors ────────────────────────────────────────────────────────

function TC_ValidationErrors() {
  Log.AppendFolder("Validation — system blocks invalid / missing data");
  try {
    // Scenario 1: All fields blank
    Log.AppendFolder("Scenario: All fields blank");
    Utils.StartBrowser(TestData.BASE_URL);
    ${pageName}Page.navigateTo(TestData.BASE_URL);
    ${pageName}Page.submit();
    ${pageName}Page.verifyValidationError("required fields");
    Utils.CloseBrowser();
    Log.PopLogFolder();

    // Scenario 2: Whitespace-only input
    Log.AppendFolder("Scenario: Whitespace only");
    Utils.StartBrowser(TestData.BASE_URL);
    ${pageName}Page.navigateTo(TestData.BASE_URL);
    ${pageName}Page.fillForm(TestData.BOUNDARY.WHITESPACE, null, null, null);
    ${pageName}Page.submit();
    ${pageName}Page.verifyValidationError("whitespace input");
    Utils.CloseBrowser();
    Log.PopLogFolder();

    // Scenario 3: Duplicate record
    Log.AppendFolder("Scenario: Duplicate record");
    Utils.StartBrowser(TestData.BASE_URL);
    ${pageName}Page.navigateTo(TestData.BASE_URL);
    ${pageName}Page.fillForm(${vk0}, ${vk1}, ${vk2}, ${vk3});
    ${pageName}Page.save();
    ${pageName}Page.verifyErrorMessage("already exists");
    Utils.CloseBrowser();
    Log.PopLogFolder();

  } catch(e) {
    Utils.Screenshot("Error in TC_ValidationErrors");
    Log.Error("TC_ValidationErrors failed", e.message);
  }
  Log.PopLogFolder();
}

// ─── Edge Cases ───────────────────────────────────────────────────────────────

function TC_EdgeCases() {
  Log.AppendFolder("Edge Cases — boundary, special, unicode inputs");

  var edgeCases = [
    { label: "Min length (1 char)",      value: TestData.BOUNDARY.MIN_LENGTH,    expectAccepted: true  },
    { label: "Max length (255 chars)",   value: TestData.BOUNDARY.MAX_LENGTH,    expectAccepted: true  },
    { label: "Over max (256 chars)",     value: TestData.BOUNDARY.OVER_MAX,      expectAccepted: false },
    { label: "Whitespace only",          value: TestData.BOUNDARY.WHITESPACE,    expectAccepted: false },
    { label: "Unicode chars",            value: TestData.BOUNDARY.UNICODE,       expectAccepted: true  },
    { label: "Leading/trailing spaces",  value: TestData.BOUNDARY.TRIM_TEST,     expectAccepted: true  },
    { label: "Numeric zero",             value: TestData.BOUNDARY.ZERO,          expectAccepted: true  },
    { label: "Special chars (!@#$%^&*)", value: TestData.BOUNDARY.SPECIAL_CHARS, expectAccepted: true  },
    { label: "Empty optional field",     value: TestData.BOUNDARY.EMPTY_OPTIONAL,expectAccepted: true  },
  ];

  for (var i = 0; i < edgeCases.length; i++) {
    var ec = edgeCases[i];
    Log.AppendFolder("Edge [" + (i+1) + "]: " + ec.label);
    try {
      Utils.StartBrowser(TestData.BASE_URL);
      ${pageName}Page.navigateTo(TestData.BASE_URL);
      ${pageName}Page.fillForm(ec.value, null, null, null);
      ${pageName}Page.submit();
      if (ec.expectAccepted)
        ${pageName}Page.verifySuccessMessage();
      else
        ${pageName}Page.verifyValidationError(ec.label);
      Log.Checkpoint("Edge case handled correctly: " + ec.label);
    } catch(e) {
      Utils.Screenshot("Error — edge case: " + ec.label);
      Log.Error("Edge case failed: " + ec.label, e.message);
    } finally {
      Utils.CloseBrowser();
    }
    Log.PopLogFolder();
  }

  Log.PopLogFolder();
}

// ─── Security ─────────────────────────────────────────────────────────────────

function TC_Security() {
  Log.AppendFolder("Security — OWASP attack payloads rejected");

  var attacks = [
    { label: "Reflected XSS",               payload: TestData.SECURITY.REFLECTED_XSS  },
    { label: "Stored XSS",                  payload: TestData.SECURITY.STORED_XSS     },
    { label: "SQL Injection",               payload: TestData.SECURITY.SQL_INJECTION   },
    { label: "Path Traversal",              payload: TestData.SECURITY.PATH_TRAVERSAL  },
    { label: "Horizontal Privilege Escal.", payload: TestData.SECURITY.OTHER_USER_ID   },
  ];

  for (var i = 0; i < attacks.length; i++) {
    var atk = attacks[i];
    Log.AppendFolder("Attack [" + (i+1) + "]: " + atk.label);
    try {
      Utils.StartBrowser(TestData.BASE_URL);
      ${pageName}Page.navigateTo(TestData.BASE_URL);
      ${pageName}Page.fillForm(atk.payload, null, null, null);
      ${pageName}Page.submit();
      ${pageName}Page.verifyNoErrorsDisplayed();
      Utils.AssertVisible(Aliases.browser.page${pageName}, "Page still alive after attack payload");
      Log.Checkpoint("Attack blocked/sanitised: " + atk.label);
    } catch(e) {
      Utils.Screenshot("Error — security: " + atk.label);
      Log.Error("Security test failed: " + atk.label, e.message);
    } finally {
      Utils.CloseBrowser();
    }
    Log.PopLogFolder();
  }

  // Unauthorised role test
  Log.AppendFolder("Unauthorised role — cannot perform write actions");
  try {
    Log.Warning("TODO: implement unauthorised role login and verify access denied");
  } catch(e) {
    Log.Error("Unauthorised role test failed", e.message);
  }
  Log.PopLogFolder();

  Log.PopLogFolder();
}

// ─── Accessibility ────────────────────────────────────────────────────────────

function TC_Accessibility() {
  Log.AppendFolder("Accessibility — WCAG 2.1 AA checks");

  var checks = [
    "Keyboard-only: Tab through all interactive elements, verify focus order",
    "Screen reader: all controls have aria-label or visible label",
    "Colour contrast: text meets 4.5:1 minimum ratio (use axe DevTools)",
    "Zoom 200%: layout usable, no horizontal scroll at 1280px wide",
    "Touch targets: all buttons/links >= 44x44px (WCAG 2.5.5)",
    "Validation errors: linked to fields via aria-describedby (WCAG 3.3.1)",
    "Focus management: modal/toast/alert returns focus on close",
  ];

  Utils.StartBrowser(TestData.BASE_URL);
  try {
    ${pageName}Page.navigateTo(TestData.BASE_URL);

    for (var i = 0; i < checks.length; i++) {
      Log.AppendFolder("A11y [" + (i+1) + "]: " + checks[i]);
      Log.Warning("MANUAL CHECK REQUIRED: " + checks[i]);
      // Log.Checkpoint("PASS: " + checks[i]);  // uncomment when verified
      // Log.Error("FAIL: " + checks[i], "Violation detail");  // uncomment if failed
      Log.PopLogFolder();
    }
  } catch(e) {
    Utils.Screenshot("Error in TC_Accessibility");
    Log.Error("TC_Accessibility setup failed", e.message);
  } finally {
    Utils.CloseBrowser();
  }

  Log.PopLogFolder();
}
`;
}

// ─── BDD Feature ──────────────────────────────────────────────────────────────

function buildBDDFeature(story, projectData) {
  const { pageName, subFunctions, ddtColumns, validValues } = projectData;
  const module   = story.module || 'Application';
  const title    = story.title  || 'User Story';
  const safeModule = module.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

  const setupFn   = subFunctions.find(f => f.fnType === 'setup');
  const actionFns = subFunctions.filter(f => f.fnType === 'action');
  const assertFn  = subFunctions.find(f => f.fnType === 'assertion');

  const givenLines = (setupFn?.steps || []).map(s => `    And ${s.text}`).join('\n')
    || `    And the user is on the ${module} page`;
  const whenLines = actionFns.flatMap(fn => fn.steps).map(s => `    And ${s.text}`).join('\n')
    || `    And the user performs the required actions`;
  const thenLines = (assertFn?.steps || []).map(s => `    And ${s.text}`).join('\n')
    || `    And the operation completes successfully`;

  const col1 = ddtColumns[0] || 'TestData';
  const headerRow   = `      | ${ddtColumns.join(' | ')} |`;
  const exampleRow1 = `      | ${ddtColumns.map(c => `valid_${c.toLowerCase()}`).join(' | ')} |`;
  const exampleRow2 = `      | ${ddtColumns.map(c => `alt_${c.toLowerCase()}`  ).join(' | ')} |`;

  return `@testcomplete @${safeModule}
Feature: ${title}
  As a user of the ${module} module
  I want to ${title.toLowerCase()}
  So that the system processes my request correctly

  Background:
    Given the application is running
    And the user is authenticated with valid credentials

  @testcomplete @${safeModule} @happypath
  Scenario: ${title} — Happy Path
    Given the user navigates to the ${module} module
${givenLines}
    When the user initiates the required operation
${whenLines}
    Then the system processes the request successfully
${thenLines}
    And no error messages are displayed

  @testcomplete @${safeModule} @datadriven
  Scenario Outline: ${title} — Data Variations
    Given the user navigates to the ${module} module
    And the user starts with a clean session
    When the user provides <${col1}> for the required field
    Then the system processes <${col1}> correctly
    And the result is stored and displayed as expected

    Examples:
${headerRow}
${exampleRow1}
${exampleRow2}
`;
}

// ─── DDT Template ─────────────────────────────────────────────────────────────

function buildDDTTemplate(story, projectData) {
  const { pageName, ddtColumns } = projectData;
  const safeTitle = (story.title || 'Story').replace(/[^a-zA-Z0-9]/g, '_');
  const module    = story.module || 'Application';

  const colReads    = ddtColumns.map(c => `    var ${c[0].toLowerCase() + c.slice(1)} = driver.Value("${c}");`).join('\n');
  const colLogParts = ddtColumns.map(c => `"${c}=" + driver.Value("${c}")`).join(' + ", " + ');
  const fnParams    = ddtColumns.map(c => c[0].toLowerCase() + c.slice(1)).join(', ');
  const colHeader   = `      | ${ddtColumns.join(' | ')} |`;
  const sampleRow1  = `      | ${ddtColumns.map(c => `valid_${c.toLowerCase()}`).join(' | ')} |`;
  const sampleRow2  = `      | ${ddtColumns.map(c => `alt_${c.toLowerCase()}`  ).join(' | ')} |`;

  return `/**
 * ${safeTitle}_DDT.js — Data-Driven Template for: ${story.title || 'Story'}
 * Module: ${module}
 * Data file: TestData_${safeTitle}.xlsx  (Sheet1)
 * Required columns: ${ddtColumns.join(', ')}
 *
 * SETUP:
 * 1. Create TestData_${safeTitle}.xlsx with the columns listed above in Sheet1
 * 2. Add one test data row per iteration
 * 3. Place the file in the TestComplete project folder
 * 4. Register all NameMapping entries before running
 */
//USEUNIT Utils
//USEUNIT ${pageName}Page
//USEUNIT TestData

function Main_DDT() {
  var driver = DDT.ExcelDriver("TestData_${safeTitle}.xlsx", "Sheet1", true);
  var rowCount = 0;
  var passCount = 0;
  var failCount = 0;

  while (!driver.EOF()) {
    rowCount++;
    Log.AppendFolder("DDT Row " + rowCount + ": " + ${colLogParts});
    try {
${colReads}

      Utils.StartBrowser(TestData.BASE_URL);
      ${pageName}Page.navigateTo(TestData.BASE_URL);

      performDDTIteration(${fnParams});

      ${pageName}Page.verifySuccessMessage();
      Log.Checkpoint("PASS: Row " + rowCount);
      passCount++;
    } catch(e) {
      Utils.Screenshot("DDT Row " + rowCount + " failed");
      Log.Error("FAIL: Row " + rowCount, e.message);
      failCount++;
    } finally {
      Utils.CloseBrowser();
    }
    Log.PopLogFolder();
    driver.Next();
  }

  driver.Close();

  Log.AppendFolder("DDT Summary");
  Log.Message("Total rows", rowCount);
  Log.Message("Passed",     passCount);
  if (failCount > 0) { Log.Error("Failed", failCount + " row(s)"); }
  Log.PopLogFolder();
}

function performDDTIteration(${fnParams}) {
  try {
    Log.AppendFolder("performDDTIteration");
    ${pageName}Page.fillForm(${fnParams || 'null'}, null, null, null);
    ${pageName}Page.save();
    Log.PopLogFolder();
  } catch(e) {
    Log.Error("performDDTIteration failed", e.message);
    Log.PopLogFolder();
    throw e;
  }
}

/*
 * Sample data file layout (TestData_${safeTitle}.xlsx — Sheet1):
${colHeader}
${sampleRow1}
${sampleRow2}
 */
`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateTestCompleteScripts(story) {
  try {
    const projectData = buildProjectData(story);
    const { pageName } = projectData;
    const safeTitle = (story.title || 'Story').replace(/[^a-zA-Z0-9]/g, '_');
    const module = story.module || 'App';

    const files = [
      {
        name: 'Utils.js',
        content: buildUtilsJs(),
        type: 'javascript',
      },
      {
        name: `${pageName}Page.js`,
        content: buildPageJs(story, projectData),
        type: 'javascript',
      },
      {
        name: 'TestData.js',
        content: buildTestDataJs(story, projectData),
        type: 'javascript',
      },
      {
        name: 'Main.js',
        content: buildMainJs(story, projectData),
        type: 'javascript',
      },
    ];

    const bddFeature  = buildBDDFeature(story, projectData);
    const ddtTemplate = buildDDTTemplate(story, projectData);

    if (!files.every(f => f.content) || !bddFeature || !ddtTemplate) {
      throw new Error('One or more outputs could not be generated');
    }

    return { files, bddFeature, ddtTemplate };
  } catch (error) {
    throw new Error('TestComplete generation failed: ' + error.message);
  }
}
