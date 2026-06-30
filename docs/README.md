# Documentation Index

Complete documentation for the DevX Application. All documentation is organized by category for easy navigation.

## 📁 Documentation Structure

### 🚀 [Deployment](deployment/)
Production deployment guides and environment setup.

- **[CLIENT_COMPLETE_SETUP_GUIDE.md](deployment/CLIENT_COMPLETE_SETUP_GUIDE.md)** - **Client handoff:** complete start-to-end install (source → DB → AWS → EKS → go-live)
- **[EKS_CLIENT_SETUP_GUIDE.md](deployment/EKS_CLIENT_SETUP_GUIDE.md)** - EKS deployment quick reference (condensed)
- **[DEPLOYMENT.md](deployment/DEPLOYMENT.md)** - Azure deployment guide with Static Web App and App Service configuration
- **[replit.md](deployment/replit.md)** - Replit environment setup and configuration
- **[../deploy/README.md](../deploy/README.md)** - AWS EC2 deployment (Secrets Manager, systemd)
- **[../docs/database/DATABASE_REFERENCE.md](database/DATABASE_REFERENCE.md)** - MySQL schema, migrations, seeding

### 📚 [Guides](guides/)
Step-by-step guides and best practices.

- **[ASK_DEVX_GUIDE.md](guides/ASK_DEVX_GUIDE.md)** - Ask DevX QnA agent guide and usage instructions
- **[MIGRATION_GUIDE.md](guides/MIGRATION_GUIDE.md)** - Database migration workflow and best practices
- **[GIT_FLOW_GUIDE.md](guides/GIT_FLOW_GUIDE.md)** - Git Flow branching strategy and workflow
- **[SETUP_GIT_FLOW.md](guides/SETUP_GIT_FLOW.md)** - Initial Git Flow setup instructions
- **[RAG_INTEGRATION_GUIDE.md](guides/RAG_INTEGRATION_GUIDE.md)** - RAG (Retrieval Augmented Generation) integration guide
- **[TESTING_GUIDE_SAVE_PUSH.md](guides/TESTING_GUIDE_SAVE_PUSH.md)** - Testing guide for save/push functionality
- **[UI_FLOW_GUIDE_SAVE_PUSH.md](guides/UI_FLOW_GUIDE_SAVE_PUSH.md)** - UI flow documentation for save/push features
- **[GUIDELINES_FLOW_REPORT.md](guides/GUIDELINES_FLOW_REPORT.md)** - Guidelines flow reporting documentation
- **[design_guidelines.md](guides/design_guidelines.md)** - UI/UX design guidelines and standards

### 🔧 [Implementation](implementation/)
Technical implementation details and architecture decisions.

- **[DUAL_MODE_IMPLEMENTATION.md](implementation/DUAL_MODE_IMPLEMENTATION.md)** - Dual mode feature implementation
- **[NO_FALLBACK_PERSONAS_IMPLEMENTATION.md](implementation/NO_FALLBACK_PERSONAS_IMPLEMENTATION.md)** - Personas implementation without fallback logic
- **[WORKFLOW_ARTIFACTS_GENERATION_IMPLEMENTATION.md](implementation/WORKFLOW_ARTIFACTS_GENERATION_IMPLEMENTATION.md)** - Workflow artifacts generation system
- **[BRD_DIRECT_LLM_CHANGES.md](implementation/BRD_DIRECT_LLM_CHANGES.md)** - BRD direct LLM integration changes

### 📊 [Summaries](summaries/)
Project summaries, changes logs, and implementation overviews.

- **[AC_UI_CODE_CHANGES_SUMMARY.md](summaries/AC_UI_CODE_CHANGES_SUMMARY.md)** - Acceptance Criteria UI code changes
- **[ARTIFACTS_GENERATION_SUMMARY.md](summaries/ARTIFACTS_GENERATION_SUMMARY.md)** - Artifacts generation feature summary
- **[ARTIFACT_SYNC_FIX_SUMMARY.md](summaries/ARTIFACT_SYNC_FIX_SUMMARY.md)** - Artifact synchronization fixes
- **[BRD_IMPLEMENTATION_SUMMARY.md](summaries/BRD_IMPLEMENTATION_SUMMARY.md)** - BRD feature implementation summary
- **[GIT_FLOW_SUMMARY.md](summaries/GIT_FLOW_SUMMARY.md)** - Git Flow implementation summary
- **[IMPLEMENTATION_SUMMARY_SAVE_PUSH_STORIES.md](summaries/IMPLEMENTATION_SUMMARY_SAVE_PUSH_STORIES.md)** - Save/Push stories implementation
- **[PERSONA_LOGIC_SUMMARY.md](summaries/PERSONA_LOGIC_SUMMARY.md)** - Persona logic implementation summary
- **[REQUIREMENTS_FIX_SUMMARY.md](summaries/REQUIREMENTS_FIX_SUMMARY.md)** - Requirements fixes and improvements
- **[WORKFLOW_INTEGRATION_SUMMARY.md](summaries/WORKFLOW_INTEGRATION_SUMMARY.md)** - Workflow integration overview

### 🛠️ [Troubleshooting](troubleshooting/)
Debug guides, issue resolutions, and fixes.

- **[TROUBLESHOOTING.md](troubleshooting/TROUBLESHOOTING.md)** - General troubleshooting guide
- **[ARTIFACT_GENERATION_FIX.md](troubleshooting/ARTIFACT_GENERATION_FIX.md)** - Artifact generation issue fixes
- **[ARTIFACT_GENERATION_QUICK_FIX.md](troubleshooting/ARTIFACT_GENERATION_QUICK_FIX.md)** - Quick fixes for artifact generation
- **[ARTIFACT_GENERATION_RESOLUTION.md](troubleshooting/ARTIFACT_GENERATION_RESOLUTION.md)** - Complete artifact generation resolution
- **[DEBUG_REQUIREMENTS_AND_AI.md](troubleshooting/DEBUG_REQUIREMENTS_AND_AI.md)** - Requirements and AI debugging guide
- **[DEBUG_STORY_HIERARCHY.md](troubleshooting/DEBUG_STORY_HIERARCHY.md)** - Story hierarchy debugging

### 🔄 [Workflow](workflow/)
Workflow architecture and API documentation.

- **[WORKFLOW_ARCHITECTURE_REFERENCE.md](workflow/WORKFLOW_ARCHITECTURE_REFERENCE.md)** - Complete workflow architecture reference
- **[WORKFLOW_ARTIFACTS_API.md](workflow/WORKFLOW_ARTIFACTS_API.md)** - Workflow artifacts API documentation

## 🔍 Quick Links

### Getting Started
1. Read the main [README.md](../README.md) in the project root
2. Set up your environment: [DEPLOYMENT.md](deployment/DEPLOYMENT.md)
3. Configure Git Flow: [SETUP_GIT_FLOW.md](guides/SETUP_GIT_FLOW.md)
4. Learn about Ask DevX: [ASK_DEVX_GUIDE.md](guides/ASK_DEVX_GUIDE.md)
5. Review design guidelines: [design_guidelines.md](guides/design_guidelines.md)

### For Developers
- **Database Changes**: [MIGRATION_GUIDE.md](guides/MIGRATION_GUIDE.md)
- **Git Workflow**: [GIT_FLOW_GUIDE.md](guides/GIT_FLOW_GUIDE.md)
- **Testing**: [TESTING_GUIDE_SAVE_PUSH.md](guides/TESTING_GUIDE_SAVE_PUSH.md)
- **Troubleshooting**: [TROUBLESHOOTING.md](troubleshooting/TROUBLESHOOTING.md)

### Architecture & Implementation
- **Workflow System**: [WORKFLOW_ARCHITECTURE_REFERENCE.md](workflow/WORKFLOW_ARCHITECTURE_REFERENCE.md)
- **Artifacts API**: [WORKFLOW_ARTIFACTS_API.md](workflow/WORKFLOW_ARTIFACTS_API.md)
- **Implementation Details**: Browse [implementation/](implementation/) directory

## 📝 Documentation Standards

When adding new documentation:
1. Place files in the appropriate category folder
2. Use descriptive filenames in UPPERCASE for visibility
3. Add an entry to this index
4. Include clear headings and table of contents for long documents
5. Link to related documentation where relevant

## 🔄 Migrations Documentation

For database migrations specifically, see:
- [MIGRATION_GUIDE.md](guides/MIGRATION_GUIDE.md) - Complete migration workflow
- [migrations/docs/](../migrations/docs/) - Migration-specific documentation

## 🤝 Contributing

When updating documentation:
1. Keep this index up to date
2. Follow the existing structure
3. Use relative links for internal references
4. Test all links before committing
