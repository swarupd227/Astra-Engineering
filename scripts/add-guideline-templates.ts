import AdmZip from 'adm-zip';
import * as path from 'path';
import * as fs from 'fs';

const zipPath = path.join(process.cwd(), 'attached_assets', 'Golden_Insurance_Repo_1761897344922.zip');
const tempDir = path.join(process.cwd(), 'temp_golden_repo_update');

// Template contents
const epicGuideline = `# 🟣 Azure DevOps Epic — Base Template (Golden Repo Standard)

---

## 🏷️ Title
> Provide a concise, outcome-driven title that clearly summarizes the Epic.

---

## 🔢 Epic ID
\`[EPIC-XXXX]\`  
> (Auto-generated in Azure DevOps — placeholder for reference)

---

## 🎯 Business Goal / Objective
> Describe the strategic objective, business driver, or desired outcome this Epic supports.

---

## 🧩 Problem Statement
> Explain the problem, gap, or opportunity this Epic addresses.

---

## 💡 Proposed Solution / Approach
> Summarize the high-level concept, approach, or proposed solution to achieve the objective.

---

## 📦 Scope

**In Scope:**
- [List what's included in the Epic]

**Out of Scope:**
- [List what's excluded or deferred to other Epics]

---

## 📊 Success Metrics / KPIs

| Metric | Target | Measurement Method |
|--------|---------|---------------------|
| Example Metric | Target Value | How you'll measure it |

---

## ✅ Acceptance Criteria
> Define the conditions that must be met for this Epic to be considered complete.

- [ ] Criterion 1  
- [ ] Criterion 2  
- [ ] Criterion 3  

---

## 📄 Deliverables
> List tangible outputs, documents, or assets expected from this Epic.

- [ ] Deliverable 1  
- [ ] Deliverable 2  

---

## ⚠️ Dependencies / Risks

**Dependencies:**
- [List related Epics, Features, or external dependencies]

**Risks:**
- [Identify key risks or potential blockers]

---

## 👥 Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner |  |  |
| Technical Lead |  |  |
| QA Lead |  |  |
| DevOps Engineer |  |  |
| Other |  |  |

---

## 🕒 Timeline / Milestones

| Milestone | Target Date | Status |
|------------|--------------|--------|
| Planning Complete | YYYY-MM-DD | ☐ |
| Development Start | YYYY-MM-DD | ☐ |
| Testing Complete | YYYY-MM-DD | ☐ |
| Go-Live | YYYY-MM-DD | ☐ |

---

## 🔗 Linked Work Items

**Features:**
- \`[FEAT-XXXX]\`

**User Stories:**
- \`[US-XXXX]\`

**Tasks:**
- \`[TASK-XXXX]\`

**Bugs:**
- \`[BUG-XXXX]\`

---

## 📝 Notes / References
> Add any supporting links, documentation, or reference materials.

- [Document Name](URL)
- [Reference Link](URL)

---

> **Template Location:**  
> \`/.ado/templates/epic-base-template.md\`  
> **Maintained by:** [Team or Department Name]  
> **Last Updated:** YYYY-MM-DD
`;

const bugsDefectGuideline = `# 🛑 Azure DevOps Bug / Defect — Base Template (Golden Repo Standard)

---

## 🏷️ Title
> Provide a short, descriptive title for the bug.

**Example:** Login button fails to respond on mobile devices

---

## 🔢 Bug ID
\`[BUG-XXXX]\`  
> (Auto-generated in Azure DevOps — placeholder for reference)

---

## 👤 Reported By
> Name of the person reporting the bug.

---

## 🎯 Business Impact / Priority
> Describe the impact of the bug and its priority level.

**Example:** High priority — prevents users from logging in, affecting revenue.

| Priority | Description |
|----------|-------------|
| High | Critical functionality blocked |
| Medium | Partial functionality impacted |
| Low | Minor issue, workaround exists |

---

## 🧩 Description / Steps to Reproduce
> Provide a clear description and exact steps to reproduce the bug.

**Example:**  
1. Open the login page on a mobile device  
2. Enter valid credentials  
3. Tap the "Login" button  
4. Observe no response

---

## 📄 Expected vs Actual Behavior

| Aspect | Expected | Actual |
|--------|---------|--------|
| Login | User should be redirected to dashboard | No response on button click |
| UI | Button should be clickable | Button appears disabled |

---

## ⚠️ Environment / Configuration
> Specify relevant environment details.

- Application / Service: [App Name / Version]  
- OS / Browser / Device: [Details]  
- Build / Release Version: [Version]  
- Other Relevant Info: [Database, API, Configurations]

---

## ✅ Acceptance Criteria / Resolution
> Define what must be done to resolve the bug.

- [ ] Bug is reproducible as described  
- [ ] Code fix applied  
- [ ] Functionality validated by QA  
- [ ] Regression testing completed  
- [ ] Documentation updated (if required)  

---

## 📦 Deliverables
> List outputs or artifacts from resolving the bug.

- [ ] Fixed code / configuration  
- [ ] Test case or regression scripts  
- [ ] Updated documentation  

---

## ⚠️ Dependencies / Risks

**Dependencies:**
- [Link to related User Story, Feature, or Task]

**Risks:**
- [Potential impact on other functionality, timelines, or releases]

---

## 👥 Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Reporter |  | Reports bug |
| Developer |  | Fixes bug |
| QA / Tester |  | Verifies fix |
| Product Owner |  | Prioritizes and approves |

---

## 🕒 Estimation / Effort
> Optional: Time required to fix the bug.

| Metric | Value |
|--------|-------|
| Estimated Hours | X |
| Severity | Critical / Major / Minor |

---

## 🔗 Linked Work Items

**Parent User Story / Feature:**  
- \`[US-XXXX]\` or \`[FEAT-XXXX]\`  

**Related Tasks:**  
- \`[TASK-XXXX]\`  

**Other Bugs:**  
- \`[BUG-XXXX]\`  

---

## 📝 Notes / References
> Include screenshots, logs, or other supporting documentation.

- [Screenshot or Video]  
- [Error Log / Stack Trace]  
- [Document Link]

---

> **Template Location:**  
> \`/.ado/templates/bug-base-template.md\`  
> **Maintained by:** [Team or Department Name]  
> **Last Updated:** YYYY-MM-DD
`;

const userStoryGuideline = `# 🔵 Azure DevOps User Story / PBI — Base Template (Golden Repo Standard)

---

## 🏷️ Title
> Provide a short, descriptive title for the user story.

---

## 🔢 Story ID
\`[US-XXXX]\`  
> (Auto-generated in Azure DevOps — placeholder for reference)

---

## 👤 User Story Statement
> Use the standard format:

**As a** [type of user]  
**I want** [goal or action]  
**So that** [business value or benefit]

---

## 🎯 Business Value / Objective
> Describe the business outcome or value this user story delivers.

---

## 🧩 Description / Details
> Provide functional details, expected behavior, or user flows.

---

## ✅ Acceptance Criteria
> Define testable conditions that must be met for completion.

- [ ] Criterion 1  
- [ ] Criterion 2  
- [ ] Criterion 3  

---

## 🧪 Test Scenarios / Validation
> Optional: Outline how QA will validate the story.

| Test Case | Expected Result |
|-----------|-----------------|
| [Description] | [Expected Outcome] |

---

## 📄 Deliverables
> List the tangible outputs when the story is complete.

- [ ] Deliverable 1  
- [ ] Deliverable 2  

---

## 📦 Scope

**In Scope:**
- [List what's included]

**Out of Scope:**
- [List what's excluded]

---

## ⚠️ Dependencies / Risks

**Dependencies:**
- [Related Features, Tasks, or Epics]

**Risks:**
- [Potential risks or blockers]

---

## 👥 Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner |  |  |
| Developer |  |  |
| QA / Tester |  |  |
| UX / Designer |  |  |
| Other |  |  |

---

## 🕒 Estimation
> Provide story points or estimated effort.

| Metric | Value |
|--------|-------|
| Story Points | X |
| Estimated Effort (hrs) | X |

---

## 🔗 Linked Work Items

**Parent Feature:**  
- \`[FEAT-XXXX]\`

**Related Tasks:**  
- \`[TASK-XXXX]\`

**Related Bugs:**  
- \`[BUG-XXXX]\`

---

## 🧾 Definition of Done (DoD)
> Ensure story completion meets quality standards.

- [ ] All acceptance criteria met  
- [ ] Code reviewed and merged  
- [ ] Unit/integration tests passed  
- [ ] Documentation updated  
- [ ] QA sign-off completed  

---

## 📝 Notes / References
> Include supporting documents, mockups, or links.

- [Document or Link]  

---

> **Template Location:**  
> \`/.ado/templates/user-story-base-template.md\`  
> **Maintained by:** [Team or Department Name]  
> **Last Updated:** YYYY-MM-DD
`;

const taskGuideline = `# ⚪ Azure DevOps Task — Base Template (Golden Repo Standard)

---

## 🏷️ Title
> Provide a short, descriptive title for the task.

---

## 🔢 Task ID
\`[TASK-XXXX]\`  
> (Auto-generated in Azure DevOps — placeholder for reference)

---

## 👤 Task Owner / Assignee
> Name of the person responsible for completing the task.

---

## 🎯 Objective
> Explain the purpose of the task and how it contributes to the parent User Story or Feature.

---

## 🧩 Description / Details
> Provide clear instructions, steps, or technical details needed to complete the task.

---

## ✅ Acceptance Criteria / Definition of Done
> Define measurable conditions for task completion.

- [ ] Step or action 1  
- [ ] Step or action 2  
- [ ] Step or action 3  

---

## 📄 Deliverables
> List outputs or artifacts expected from this task.

- [ ] Deliverable 1  
- [ ] Deliverable 2  

---

## 📦 Scope

**In Scope:**
- [Specify what this task covers]

**Out of Scope:**
- [Specify what is excluded]

---

## ⚠️ Dependencies / Risks

**Dependencies:**
- [Link parent User Story, Feature, or other tasks]

**Risks:**
- [Potential blockers or issues]

---

## 👥 Stakeholders
> List people involved or impacted by this task.

| Role | Name | Responsibility |
|------|------|----------------|
| Owner / Assignee |  | Execute task |
| Reviewer / QA |  | Verify completion |
| Other |  |  |

---

## 🕒 Estimation
> Provide estimated effort or duration.

| Metric | Value |
|--------|-------|
| Hours / Days | X |
| Priority | High / Medium / Low |

---

## 🔗 Linked Work Items

**Parent User Story / PBI:**  
- \`[US-XXXX]\`  

**Related Tasks:**  
- \`[TASK-XXXX]\`  

**Related Bugs:**  
- \`[BUG-XXXX]\`  

---

## 📝 Notes / References
> Include supporting documentation, scripts, or links.

- [Document or Link]  

---

> **Template Location:**  
> \`/.ado/templates/task-base-template.md\`  
> **Maintained by:** [Team or Department Name]  
> **Last Updated:** YYYY-MM-DD
`;

const featureGuideline = `# 🟢 Azure DevOps Feature — Base Template (Golden Repo Standard)

---

## 🏷️ Title
> Short, descriptive title for the Feature.

---

## 🔢 Feature ID
\`[FEAT-XXXX]\`  
> (Auto-generated in Azure DevOps)

---

## 🎯 Objective / Business Value
> Describe the purpose of this Feature and the value it delivers to the business or end user.

---

## 🧩 Background / Context
> Provide any background information, assumptions, or related Epics.

---

## 💡 Description / Proposed Solution
> Summarize what this Feature will deliver and how.  
> Include high-level functional or technical details as needed.

---

## 📦 Scope

**In Scope:**
- [List items included]

**Out of Scope:**
- [List items excluded]

---

## 📊 Success Metrics / KPIs

| Metric | Target | Measurement Method |
|--------|---------|---------------------|
| Example Metric | Target Value | How you'll measure it |

---

## ✅ Acceptance Criteria
> Define the measurable conditions that must be met for this Feature to be considered complete.

- [ ] Criterion 1  
- [ ] Criterion 2  
- [ ] Criterion 3  

---

## 📄 Deliverables
> List tangible outputs or artifacts expected from this Feature.

- [ ] Deliverable 1  
- [ ] Deliverable 2  

---

## ⚠️ Dependencies / Risks

**Dependencies:**
- [List related Epics, Features, or systems]

**Risks:**
- [Identify potential risks or blockers]

---

## 👥 Stakeholders

| Role | Name | Responsibility |
|------|------|----------------|
| Product Owner |  |  |
| Technical Lead |  |  |
| Developer(s) |  |  |
| QA / Tester |  |  |
| DevOps / Ops |  |  |

---

## 🕒 Timeline / Milestones

| Milestone | Target Date | Status |
|------------|--------------|--------|
| Planning Complete | YYYY-MM-DD | ☐ |
| Development Done | YYYY-MM-DD | ☐ |
| QA / UAT Sign-off | YYYY-MM-DD | ☐ |
| Release | YYYY-MM-DD | ☐ |

---

## 🔗 Linked Work Items

**Parent Epic:**  
- \`[EPIC-XXXX]\`

**Child Stories:**  
- \`[US-XXXX]\`

**Tasks:**  
- \`[TASK-XXXX]\`

**Bugs:**  
- \`[BUG-XXXX]\`

---

## 🧪 Test Plan / Validation
> Briefly describe how testing and validation will be performed.

---

## 📝 Notes / References
> Add any supporting documentation links or notes.

---

> **Template Location:**  
> \`/.ado/templates/feature-base-template.md\`  
> **Maintained by:** [Team or Department]  
> **Last Updated:** YYYY-MM-DD
`;

async function addGuidelineTemplates() {
  try {
    console.log('📝 Adding Epic and Bug/Defect guideline templates to Golden Repository...\n');
    
    // 1. Extract the zip file
    console.log('📦 Extracting zip file...');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tempDir, true);
    console.log('✓ Extraction complete\n');
    
    // 2. Ensure artifacts folder exists
    const artifactsPath = path.join(tempDir, 'requirements', 'artifacts');
    if (!fs.existsSync(artifactsPath)) {
      fs.mkdirSync(artifactsPath, { recursive: true });
      console.log('✓ Created artifacts folder\n');
    }
    
    // 3. Update all guideline files with full content
    const templates = [
      { filename: 'epic_guideline.md', content: epicGuideline, emoji: '🟣' },
      { filename: 'bugs_defect_guideline.md', content: bugsDefectGuideline, emoji: '🛑' },
      { filename: 'user_story_guideline.md', content: userStoryGuideline, emoji: '🔵' },
      { filename: 'task_guideline.md', content: taskGuideline, emoji: '⚪' },
      { filename: 'feature_guideline.md', content: featureGuideline, emoji: '🟢' },
    ];
    
    console.log('📄 Adding/updating guideline templates:\n');
    for (const template of templates) {
      const filePath = path.join(artifactsPath, template.filename);
      fs.writeFileSync(filePath, template.content);
      console.log(`${template.emoji} ${template.filename}`);
    }
    
    // 4. Display final structure
    console.log('\n📁 Updated requirements/artifacts/ folder structure:\n');
    const files = fs.readdirSync(artifactsPath).sort();
    files.forEach((file, index) => {
      const isLast = index === files.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      console.log(`${connector}${file}`);
    });
    
    // 5. Create new zip file
    console.log('\n📦 Creating updated zip file...');
    const newZip = new AdmZip();
    
    function addDirectoryToZip(zip: AdmZip, dirPath: string, zipPath: string = '') {
      const items = fs.readdirSync(dirPath);
      items.forEach(item => {
        const itemPath = path.join(dirPath, item);
        const itemZipPath = zipPath ? `${zipPath}/${item}` : item;
        
        if (fs.statSync(itemPath).isDirectory()) {
          addDirectoryToZip(zip, itemPath, itemZipPath);
        } else {
          zip.addLocalFile(itemPath, zipPath);
        }
      });
    }
    
    addDirectoryToZip(newZip, tempDir);
    
    // Backup original (if not already backed up)
    const backupPath = zipPath.replace('.zip', '_backup.zip');
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(zipPath, backupPath);
      console.log(`✓ Backed up original: ${path.basename(backupPath)}`);
    }
    
    // Write new zip
    newZip.writeZip(zipPath);
    console.log('✓ Updated zip file created successfully\n');
    
    // 6. Cleanup
    console.log('🧹 Cleaning up temporary files...');
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('✓ Cleanup complete\n');
    
    console.log('✅ Golden Repository enhanced successfully!\n');
    console.log('📋 Summary:');
    console.log('   • Total guideline templates: 5');
    console.log('   • New templates added: 2 (Epic, Bugs/Defect)');
    console.log('   • Updated templates: 3 (User Story, Task, Feature)');
    
  } catch (error) {
    console.error('❌ Error:', error);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw error;
  }
}

addGuidelineTemplates();
