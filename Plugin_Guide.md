# Using the Nous.AI VSIX Extension

This guide explains how to install the extension from a VSIX file and use it inside VS Code.

## 1. Download the Extension VSIX

1. Download the compiled `.vsix` file for the Nous.AI extension.
2. Save it to a known location on your machine.

## 2. Open VS Code

1. Start Visual Studio Code.
2. Make sure you have the `Extensions` sidebar visible.

## 3. Install from VSIX

1. Click the Extensions icon in the Activity Bar on the left side of VS Code.
2. Click the three-dot menu button at the top right of the Extensions pane.
3. Choose `Install from VSIX...` from the dropdown menu.
4. In the file picker, browse to the location where you saved the downloaded `.vsix` file.
5. Select the file and click `Open`.
6. Wait for VS Code to install the extension.

## 4. Open the Nous.AI Sidebar

1. After installation, look for the Nous.AI icon in the Activity Bar on the left side of VS Code.
2. Click the Nous.AI icon to open the extension sidebar.
3. The sidebar name should be `Nous AI`.

## 5. Start the Generation Wizard

1. In the Nous.AI sidebar, click the command or button to open the generation wizard.
2. If the sidebar does not show the wizard immediately, run the command palette with `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS).
3. Search for `Nous.AI: Open Generation Wizard` and execute it.

## 6. Configure Your Project

Follow the wizard steps to configure your project:

1. **Project Setup**
   - Enter the project name.
   - Choose the project type: Green Field, Brown Field, or Migration.

2. **ALM Board**
   - Connect to your issue tracker.
   - Enter the provider, base URL, and access token.

3. **Source Repository**
   - Provide the repository provider and repository URL.
   - Enter your SCM token and branch strategy.

4. **Repository Workspace**
   - Choose whether to clone the repo or use an existing local folder.
   - Browse to select the destination or workspace folder.

5. **Work Items**
   - Load work items from your issue tracker.
   - Select the epics, stories, and tasks to include.

6. **Golden Repository**
   - Browse and attach a golden repository path.
   - This golden repository is used as the authoritative reference for generated specs.

7. **Tech Stack & Approach**
   - Choose the generation targets and technology stack.
   - Select whether to use `NORMAL` flow or `TDD` flow.

## 7. Generate the Specification

1. Review your configuration on the final wizard page.
2. Confirm the target folder and additional instructions.
3. Click `Generate Specification`.
4. The extension generates a `.nous/specifications.md` file inside your target folder.

## 8. What the Extension Produces

- A `specifications.md` file with the full Claude Code prompt.
- A `.nous/session-config.json` file containing the session config.
- If a golden repository is attached, the generated specification will include strict golden repo analysis instructions.

## 9. Best Practices for New Users

- Use the golden repository path if you want the generated output to follow an existing reference implementation strictly.
- Always verify the selected work items and tech stack before generation.
- Keep your PAT tokens secure; the extension stores them in VS Code SecretStorage.
- If you are using Brown Field or Migration, make sure the local workspace is the correct repository root.
- After generation, inspect `.nous/specifications.md` before launching the AI generation workflow.

## 10. Troubleshooting

- If the extension does not appear after installation, reload VS Code.
- If `Install from VSIX...` is not available, make sure you are using a recent version of VS Code.
- If the wizard fails to connect to your tracker or repository, verify the URL and token permissions.
- If the golden repository is not applied correctly, ensure you selected a valid folder path and regenerate the spec.

## 11. Notes

- The extension is intended to work with Claude Code via the generated `specifications.md`.
- The golden repository is a mandatory reference when provided; the generated prompt will enforce its use.
- For the best experience, use the extension when the repository and workspace paths are set correctly.
