/**
 * TestComplete Template Builder — Rule-Based (No LLM)
 * Parses story acceptance criteria into structured test data for script generation.
 */

/** Parse AC text into typed steps. Handles bullets, numbered lists, paragraphs, BDD keywords. */
export function parseAcceptanceCriteria(acText) {
  if (!acText) return [];
  return acText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const text = line
      .replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '')
      .replace(/^(Given|When|Then|And|But)\s+/i, '').trim();
    if (!text || text.length < 3) return null;
    const lower = text.toLowerCase();
    let type;
    if (lower.includes('precondition') || lower.includes('navigate to') ||
        lower.includes('log in') || lower.includes('login') ||
        lower.includes('open ') || lower.match(/^(given|setup|before)/)) {
      type = 'setup';
    } else if (lower.includes('should ') || lower.includes('verify') ||
               lower.includes('assert') || lower.includes(' display') ||
               lower.includes(' appear') || lower.includes('expect') ||
               lower.includes('confirm') || lower.includes(' shown')) {
      type = 'assertion';
    } else {
      type = 'action';
    }
    return { type, text };
  }).filter(Boolean);
}

export function toCamelCase(str) {
  return str.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('') || 'step';
}

export function toPascalCase(str) {
  return str.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('') || 'Page';
}

export function inferElementAlias(stepText) {
  const a = stepText.toLowerCase();
  if (a.includes('navigate') || a.includes('go to') || a.includes('open ') || a.includes('load ')) return null;
  if (a.includes('bind')) return 'btnBind';
  if (a.includes('submit')) return 'btnSubmit';
  if (a.includes('save')) return 'btnSave';
  if (a.includes('cancel')) return 'btnCancel';
  if (a.includes('delete') || a.includes('remove')) return 'btnDelete';
  if (a.includes('login') || a.includes('log in') || a.includes('sign in')) return 'btnLogin';
  if (a.includes('next') || a.includes('continue')) return 'btnNext';
  if (a.includes('search') && (a.includes('button') || a.includes('click'))) return 'btnSearch';
  if (a.includes('search')) return 'txtSearch';
  if (a.includes('username') || a.includes('user name')) return 'txtUsername';
  if (a.includes('password')) return 'txtPassword';
  if (a.includes('email')) return 'txtEmail';
  if (a.includes('first name')) return 'txtFirstName';
  if (a.includes('last name')) return 'txtLastName';
  if (a.includes('name')) return 'txtName';
  if (a.includes('amount') || a.includes('premium')) return 'txtAmount';
  if (a.includes('date')) return 'txtDate';
  if (a.includes('phone') || a.includes('mobile')) return 'txtPhone';
  if (a.includes('policy number') || a.includes('policy no') || a.includes('vin')) return 'txtPolicyNumber';
  if (a.includes('make') || a.includes('model') || a.includes('year')) return 'txtVehicleDetail';
  if (a.includes('coverage')) return a.includes('limit') ? 'ddlCoverageLimit' : 'ddlCoverage';
  if (a.includes('dropdown') || a.includes('select ') || a.includes('choose')) return 'ddlSelection';
  if (a.includes('checkbox')) return 'chkOption';
  if (a.includes('status') || a.includes('message') || a.includes('confirmation')) return 'lblStatus';
  if (a.includes('error') || a.includes('alert')) return 'lblError';
  if (a.includes('email') && (a.includes('sent') || a.includes('confirm'))) return 'lblEmailConfirmation';
  return 'element';
}

export function inferObjectType(stepText) {
  const a = stepText.toLowerCase();
  if (a.includes('button') || a.includes('click') || a.includes('btn')) return 'Button';
  if (a.includes('dropdown') || a.includes('select ') || a.includes('choose') || a.includes('coverage limit')) return 'ComboBox';
  if (a.includes('checkbox')) return 'CheckBox';
  if (a.includes('label') || a.includes('status') || a.includes('message') || a.includes('confirm') || a.includes('display')) return 'Label';
  if (a.includes('enter') || a.includes('fill') || a.includes('type') || a.includes('input')) return 'Edit';
  return 'Panel';
}

export function inferIdentifyValue(stepText) {
  return stepText.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 4).join('-');
}

export function inferDDTColumn(stepText) {
  const a = stepText.toLowerCase();
  if (a.includes('email')) return 'Email';
  if (a.includes('first name')) return 'FirstName';
  if (a.includes('last name')) return 'LastName';
  if (a.includes('insured name') || a.includes('name')) return 'InsuredName';
  if (a.includes('amount') || a.includes('premium')) return 'Amount';
  if (a.includes('date of birth') || a.includes('dob')) return 'DateOfBirth';
  if (a.includes('date')) return 'Date';
  if (a.includes('vin')) return 'VIN';
  if (/\bvehicle\s+make\b|\bcar\s+make\b/.test(a)) return 'VehicleMake';
  if (/\bvehicle\s+model\b|\bcar\s+model\b/.test(a)) return 'VehicleModel';
  if (/\bvehicle\s+year\b|\bcar\s+year\b/.test(a)) return 'VehicleYear';
  if (a.includes('coverage limit') || a.includes('coverage')) return 'CoverageLimit';
  if (a.includes('phone') || a.includes('mobile')) return 'Phone';
  if (a.includes('policy')) return 'PolicyNumber';
  if (a.includes('password')) return 'Password';
  if (a.includes('username') || a.includes('user name')) return 'Username';
  if (a.includes('address')) return 'Address';
  return null;
}

/**
 * Infer element references from a story's acceptance criteria text.
 * Returns array of { name, alias, type, desc } objects.
 */
export function inferElementsFromStory(story) {
  const acText = story.acceptanceCriteria || '';
  const steps = parseAcceptanceCriteria(acText);
  const elements = [];
  const seen = new Set();

  // Field-keyword → element descriptor mapping
  const fieldPatterns = [
    // Input fields
    { keywords: ['product name', 'name field', 'name input'], name: 'txtProductName',     type: 'Edit',     desc: 'Product Name input' },
    { keywords: ['product type', 'type field', 'type dropdown'], name: 'ddlProductType',  type: 'ComboBox', desc: 'Product Type dropdown' },
    { keywords: ['category', 'product category'],   name: 'ddlProductCategory',           type: 'ComboBox', desc: 'Product Category dropdown' },
    { keywords: ['classification'],                 name: 'ddlClassification',             type: 'ComboBox', desc: 'Classification dropdown' },
    { keywords: ['status'],                         name: 'ddlStatus',                     type: 'ComboBox', desc: 'Status dropdown' },
    { keywords: ['description', 'desc field'],      name: 'txtDescription',                type: 'Edit',     desc: 'Description textarea' },
    { keywords: ['amount', 'premium'],              name: 'txtAmount',                     type: 'Edit',     desc: 'Amount input' },
    { keywords: ['date of birth', 'dob'],           name: 'txtDateOfBirth',                type: 'Edit',     desc: 'Date of Birth input' },
    { keywords: ['effective date', 'start date'],   name: 'txtEffectiveDate',              type: 'Edit',     desc: 'Effective Date input' },
    { keywords: ['expiry date', 'end date'],        name: 'txtExpiryDate',                 type: 'Edit',     desc: 'Expiry Date input' },
    { keywords: [' date'],                          name: 'txtDate',                       type: 'Edit',     desc: 'Date input' },
    { keywords: ['email'],                          name: 'txtEmail',                      type: 'Edit',     desc: 'Email input' },
    { keywords: ['phone', 'mobile'],                name: 'txtPhone',                      type: 'Edit',     desc: 'Phone input' },
    { keywords: ['username', 'user name'],          name: 'txtUsername',                   type: 'Edit',     desc: 'Username input' },
    { keywords: ['password'],                       name: 'txtPassword',                   type: 'Edit',     desc: 'Password input' },
    { keywords: ['address'],                        name: 'txtAddress',                    type: 'Edit',     desc: 'Address input' },
    { keywords: ['first name'],                     name: 'txtFirstName',                  type: 'Edit',     desc: 'First Name input' },
    { keywords: ['last name'],                      name: 'txtLastName',                   type: 'Edit',     desc: 'Last Name input' },
    { keywords: ['coverage limit'],                 name: 'ddlCoverageLimit',              type: 'ComboBox', desc: 'Coverage Limit dropdown' },
    { keywords: ['coverage'],                       name: 'ddlCoverage',                   type: 'ComboBox', desc: 'Coverage dropdown' },
    { keywords: ['select', 'dropdown', 'choose'],   name: 'ddlSelection',                  type: 'ComboBox', desc: 'Generic dropdown' },
    // Buttons
    { keywords: ['save'],           name: 'btnSave',    type: 'Button', desc: 'Save button' },
    { keywords: ['submit'],         name: 'btnSubmit',  type: 'Button', desc: 'Submit button' },
    { keywords: ['cancel'],         name: 'btnCancel',  type: 'Button', desc: 'Cancel button' },
    { keywords: ['delete', 'remove'], name: 'btnDelete', type: 'Button', desc: 'Delete button' },
    { keywords: ['add', 'create'],  name: 'btnAdd',     type: 'Button', desc: 'Add/Create button' },
    { keywords: ['search button'],  name: 'btnSearch',  type: 'Button', desc: 'Search button' },
    // Labels/Status
    { keywords: ['success', 'saved successfully', 'created successfully'], name: 'lblSuccessMessage', type: 'Label', desc: 'Success message label' },
    { keywords: ['error message', 'error displayed'],                       name: 'lblErrorMessage',   type: 'Label', desc: 'Error message label' },
    { keywords: ['validation', 'required field', 'mandatory'],              name: 'lblValidationError', type: 'Label', desc: 'Validation error label' },
    { keywords: ['confirmation', 'confirm'],                                name: 'lblConfirmation',   type: 'Label', desc: 'Confirmation label' },
  ];

  for (const step of steps) {
    const lower = step.text.toLowerCase();
    for (const pattern of fieldPatterns) {
      if (pattern.keywords.some(kw => lower.includes(kw))) {
        if (!seen.has(pattern.name)) {
          seen.add(pattern.name);
          elements.push({ name: pattern.name, type: pattern.type, desc: pattern.desc });
        }
      }
    }
  }

  // Always include core elements if we have any content
  const coreElements = [
    { name: 'btnSave',           type: 'Button', desc: 'Save button' },
    { name: 'btnSubmit',         type: 'Button', desc: 'Submit button' },
    { name: 'btnCancel',         type: 'Button', desc: 'Cancel button' },
    { name: 'lblSuccessMessage', type: 'Label',  desc: 'Success message label' },
    { name: 'lblErrorMessage',   type: 'Label',  desc: 'Error message label' },
    { name: 'lblValidationError', type: 'Label', desc: 'Validation error label' },
  ];
  for (const el of coreElements) {
    if (!seen.has(el.name)) {
      seen.add(el.name);
      elements.push(el);
    }
  }

  return elements;
}

/**
 * Extract domain-specific quoted/significant values from AC text.
 * Returns array of { key, value } where key is a VALID.* constant name.
 */
export function extractValidValues(story) {
  const acText = story.acceptanceCriteria || '';
  const result = [];
  const seen = new Set();

  // Extract quoted strings
  const quotedMatches = [...acText.matchAll(/"([^"]+)"|'([^']+)'/g)];
  for (const m of quotedMatches) {
    const val = (m[1] || m[2] || '').trim();
    if (val && val.length > 1 && val.length < 80 && !seen.has(val)) {
      seen.add(val);
      const key = val.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/__+/g, '_').replace(/^_|_$/g, '');
      result.push({ key, value: val });
    }
  }

  // Extract values following "as a", "define ... as", "classify ... as" patterns
  const defineMatches = [...acText.matchAll(/(?:as\s+(?:a\s+)?|define[d]?\s+\w+\s+as\s+|classify\s+\w+\s+as\s+)([\w][\w\s\-]+)/gi)];
  for (const m of defineMatches) {
    const val = m[1].trim().replace(/\s+/g, ' ');
    if (val && val.length > 2 && val.length < 60 && !seen.has(val)) {
      seen.add(val);
      const key = val.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/__+/g, '_').replace(/^_|_$/g, '');
      result.push({ key, value: val });
    }
  }

  return result.slice(0, 12); // cap at 12 valid values
}

/**
 * Build formatted test items tree comment for Main.js header.
 */
export function buildTestItemsTree(storyTitle) {
  return `* TEST ITEMS STRUCTURE:
 * ├── ${storyTitle}
 * │   ├── Happy Path        → Main.TC_HappyPath
 * │   ├── Alternative Data  → Main.TC_AlternativeData
 * │   ├── Persistence       → Main.TC_Persistence
 * │   ├── Downstream        → Main.TC_DownstreamEffects
 * │   ├── Validation        → Main.TC_ValidationErrors
 * │   ├── Edge Cases        → Main.TC_EdgeCases
 * │   ├── Security          → Main.TC_Security
 * │   └── Accessibility     → Main.TC_Accessibility`;
}

/**
 * Build full project data for all 4 JS files + BDD + DDT.
 * Replaces old buildTestData().
 */
export function buildProjectData(story) {
  const pageName = toPascalCase(story.module || 'App');
  const steps = parseAcceptanceCriteria(story.acceptanceCriteria);
  const setupSteps    = steps.filter(s => s.type === 'setup');
  const actionSteps   = steps.filter(s => s.type === 'action');
  const assertionSteps = steps.filter(s => s.type === 'assertion');

  const elements = inferElementsFromStory(story);
  const validValues = extractValidValues(story);
  const testItemsTree = buildTestItemsTree(story.title || 'Story');

  // DDT columns derived from action steps
  const colSet = new Set();
  for (const s of actionSteps) {
    const a = s.text.toLowerCase();
    if (a.includes('enter') || a.includes('fill') || a.includes('type') || a.includes('input') || a.includes('select')) {
      const col = inferDDTColumn(s.text);
      if (col) colSet.add(col);
    }
  }
  if (!colSet.size) colSet.add('TestData');

  // BDD sub-functions (for BDD feature generation)
  const subFunctions = [];
  subFunctions.push({
    name: 'navigateTo' + pageName,
    label: 'Navigate to ' + (story.module || 'Application'),
    steps: setupSteps.length ? setupSteps : [{ type: 'setup', text: 'Navigate to the ' + (story.module || 'application') + ' module' }],
    fnType: 'setup',
  });
  for (let i = 0; i < actionSteps.length; i += 3) {
    const chunk = actionSteps.slice(i, i + 3);
    const fnName = toCamelCase(chunk[0].text.slice(0, 35));
    subFunctions.push({ name: fnName, label: chunk[0].text, steps: chunk, fnType: 'action' });
  }
  subFunctions.push({
    name: 'verify' + pageName + 'Result',
    label: 'Verify result',
    steps: assertionSteps.length ? assertionSteps : [{ type: 'assertion', text: 'Verify the operation completed successfully' }],
    fnType: 'assertion',
  });

  return {
    pageName,
    elements,
    validValues,
    testItemsTree,
    subFunctions,
    ddtColumns: [...colSet],
    setupSteps,
    actionSteps,
    assertionSteps,
  };
}

/** @deprecated Use buildProjectData instead */
export function buildTestData(story) {
  const data = buildProjectData(story);
  return {
    pageName: data.pageName,
    subFunctions: data.subFunctions,
    ddtColumns: data.ddtColumns,
  };
}
