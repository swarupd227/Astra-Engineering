// Idempotent QE-database schema synchroniser.
// Connection is resolved from environment variables (same priority as server/qe/db.ts):
//   1. QE_DATABASE_URL              (full mysql:// URL)
//   2. NAT_MYSQL_HOST/USER/PASSWORD/DATABASE  (+ optional NAT_MYSQL_PORT)
//   3. MYSQL_HOST/USER/PASSWORD/DATABASE       (+ optional MYSQL_PORT)
//   4. AWS Secrets Manager (when DEVX_HOSTING=aws and AWS_ACCESS_KEY_ID is set
//      in .env). The MYSQL_* keys are then fetched from the AWS_SECRET_NAME
//      secret (default: "devx/platform/qa") and injected into process.env
//      before the resolution loop above runs.
//
// SSL is enabled by default for non-loopback hosts. To disable: MYSQL_DISABLE_SSL=true
// To allow self-signed certs:                                   MYSQL_SSL_REJECT_UNAUTHORIZED=false
//
// Usage:  node sync-schema.cjs

require('dotenv').config();
const mysql = require('mysql2/promise');

const tables = {
  users: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'username', type: 'TEXT', notNull: true },
    { name: 'password', type: 'TEXT', notNull: true },
  ],
  projects: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'user_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'description', type: 'TEXT' },
    { name: 'type', type: 'TEXT', notNull: true },
    { name: 'domain', type: 'TEXT', default: "'insurance'" },
    { name: 'product_description', type: 'TEXT' },
    { name: 'website_url', type: 'TEXT' },
    { name: 'application_type', type: 'TEXT', default: "'web_portal'" },
    { name: 'ado_enabled', type: 'INT', default: '0' },
    { name: 'ado_connection_id', type: 'VARCHAR(255)' },
    { name: 'ado_project_id', type: 'TEXT' },
    { name: 'ado_project_name', type: 'TEXT' },
    { name: 'devx_sdlc_project_id', type: 'VARCHAR(255)' },
    { name: 'devx_sdlc_project_name', type: 'VARCHAR(255)' },
    { name: 'devx_ado_organization', type: 'VARCHAR(255)' },
    { name: 'golden_repo_id', type: 'VARCHAR(255)' },
    { name: 'golden_repo_name', type: 'VARCHAR(255)' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  test_sessions: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'project_id', type: 'VARCHAR(255)' },
    { name: 'figma_url', type: 'TEXT', notNull: true },
    { name: 'website_url', type: 'TEXT', notNull: true },
    { name: 'test_scope', type: 'TEXT', notNull: true },
    { name: 'browser_target', type: 'TEXT', notNull: true },
    { name: 'status', type: 'TEXT', notNull: true, default: "'pending'" },
    { name: 'tasks', type: 'JSON' },
    { name: 'metrics', type: 'JSON' },
    { name: 'completed_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  test_results: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'session_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'completion_time', type: 'INT', notNull: true },
    { name: 'design_compliance', type: 'INT', notNull: true },
    { name: 'accessibility_warnings', type: 'INT', notNull: true },
    { name: 'test_cases_generated', type: 'INT', notNull: true },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  visual_diffs: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'result_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'area', type: 'TEXT', notNull: true },
    { name: 'count', type: 'INT', notNull: true },
    { name: 'severity', type: 'TEXT', notNull: true },
    { name: 'screenshot_url', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  auto_test_runs: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: false },
    { name: 'url', type: 'TEXT', notNull: true },
    { name: 'status', type: 'TEXT', notNull: true, default: "'crawling'" },
    { name: 'page_count', type: 'INT', default: '0' },
    { name: 'error_message', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'completed_at', type: 'TIMESTAMP', default: 'NULL' },
  ],
  auto_test_pages: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'run_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'url', type: 'TEXT', notNull: true },
    { name: 'title', type: 'TEXT' },
    { name: 'forms', type: 'INT', default: '0' },
    { name: 'buttons', type: 'INT', default: '0' },
    { name: 'inputs', type: 'INT', default: '0' },
    { name: 'links', type: 'INT', default: '0' },
    { name: 'dom_data', type: 'JSON' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  auto_test_cases: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: false },
    { name: 'run_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'title', type: 'TEXT', notNull: true },
    { name: 'priority', type: 'TEXT', notNull: true },
    { name: 'category', type: 'TEXT', notNull: true },
    { name: 'page_url', type: 'TEXT' },
    { name: 'description', type: 'TEXT' },
    { name: 'steps', type: 'JSON' },
    { name: 'expected_result', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  auto_test_scripts: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'run_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'content', type: 'TEXT', notNull: true },
    { name: 'test_case_ids', type: 'JSON' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  auto_test_executions: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'run_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'script_id', type: 'VARCHAR(255)' },
    { name: 'status', type: 'TEXT', notNull: true, default: "'running'" },
    { name: 'total', type: 'INT', default: '0' },
    { name: 'passed', type: 'INT', default: '0' },
    { name: 'failed', type: 'INT', default: '0' },
    { name: 'skipped', type: 'INT', default: '0' },
    { name: 'results', type: 'JSON' },
    { name: 'executed_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'completed_at', type: 'TIMESTAMP', default: 'NULL' },
  ],
  functional_test_sessions: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'project_id', type: 'VARCHAR(255)' },
    { name: 'url', type: 'TEXT', notNull: true },
    { name: 'test_focus', type: 'TEXT', notNull: true },
    { name: 'crawl_status', type: 'TEXT', notNull: true, default: "'pending'" },
    { name: 'pages_visited', type: 'INT', default: '0' },
    { name: 'workflows_discovered', type: 'INT', default: '0' },
    { name: 'test_cases_generated', type: 'INT', default: '0' },
    { name: 'test_cases_passed', type: 'INT', default: '0' },
    { name: 'test_cases_failed', type: 'INT', default: '0' },
    { name: 'crawl_progress', type: 'JSON' },
    { name: 'completed_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  workflows: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'session_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'workflow_id', type: 'TEXT', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'type', type: 'TEXT', notNull: true },
    { name: 'entry_point', type: 'TEXT', notNull: true },
    { name: 'steps', type: 'JSON', notNull: true },
    { name: 'confidence', type: 'INT', notNull: true },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  test_cases: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'workflow_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'test_id', type: 'TEXT', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'objective', type: 'TEXT', notNull: true },
    { name: 'given', type: 'TEXT', notNull: true },
    { name: '`when`', type: 'TEXT', notNull: true, rawName: true },
    { name: '`then`', type: 'TEXT', notNull: true, rawName: true },
    { name: 'selector', type: 'TEXT' },
    { name: 'preconditions', type: 'JSON' },
    { name: 'test_steps', type: 'JSON', notNull: true },
    { name: 'postconditions', type: 'JSON' },
    { name: 'test_data', type: 'JSON' },
    { name: 'test_type', type: 'TEXT', notNull: true, default: "'Functional'" },
    { name: 'status', type: 'TEXT', notNull: true, default: "'pending'" },
    { name: 'priority', type: 'TEXT', default: "'P2'" },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  execution_results: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'test_case_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'status', type: 'TEXT', notNull: true },
    { name: 'execution_time', type: 'INT', notNull: true },
    { name: 'screenshot_url', type: 'TEXT' },
    { name: 'error_log', type: 'TEXT' },
    { name: 'console_errors', type: 'JSON' },
    { name: 'network_errors', type: 'JSON' },
    { name: 'actual_result', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  requirements: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'project_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'description', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  sprints: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'project_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'description', type: 'TEXT' },
    { name: 'goal', type: 'TEXT' },
    { name: 'start_date', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'end_date', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'status', type: 'TEXT', default: "'planning'" },
    { name: 'ado_sync_enabled', type: 'INT', default: '0' },
    { name: 'ado_backlog_source', type: 'TEXT', default: "'sprint_backlog'" },
    { name: 'ado_iteration_path', type: 'TEXT' },
    { name: 'ado_area_path', type: 'TEXT' },
    { name: 'ado_wiql_query', type: 'TEXT' },
    { name: 'ado_work_item_types', type: 'JSON' },
    { name: 'ado_sync_frequency', type: 'TEXT', default: "'manual'" },
    { name: 'ado_last_sync_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'ado_sync_status', type: 'TEXT', default: "'not_synced'" },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  user_stories: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'requirement_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'ado_work_item_id', type: 'INT', unique: true },
    { name: 'title', type: 'TEXT', notNull: true },
    { name: 'description', type: 'TEXT' },
    { name: 'acceptance_criteria', type: 'TEXT' },
    { name: 'state', type: 'TEXT' },
    { name: 'assigned_to', type: 'TEXT' },
    { name: 'sprint', type: 'TEXT' },
    { name: 'area_path', type: 'TEXT' },
    { name: 'tags', type: 'JSON' },
    { name: 'ado_url', type: 'TEXT' },
    { name: 'synced_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  sprint_user_stories: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'sprint_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'ado_work_item_id', type: 'INT' },
    { name: 'title', type: 'TEXT', notNull: true },
    { name: 'description', type: 'TEXT' },
    { name: 'acceptance_criteria', type: 'TEXT' },
    { name: 'story_points', type: 'INT' },
    { name: 'priority', type: 'TEXT', default: "'medium'" },
    { name: 'status', type: 'TEXT', default: "'new'" },
    { name: 'source', type: 'TEXT', default: "'manual'" },
    { name: 'assigned_to', type: 'TEXT' },
    { name: 'tags', type: 'JSON' },
    { name: 'ado_url', type: 'TEXT' },
    { name: 'ado_sync_status', type: 'TEXT', default: "'not_synced'" },
    { name: 'ado_last_sync_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'attachments', type: 'JSON' },
    { name: 'additional_context', type: 'TEXT' },
    { name: 'context_documents', type: 'JSON' },
    { name: 'context_urls', type: 'JSON' },
    { name: 'generated_test_cases', type: 'JSON' },
    { name: 'test_case_count', type: 'INT', default: '0' },
    { name: 'generated_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  sprint_test_cases: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'sprint_id', type: 'VARCHAR(255)' },
    { name: 'sprint_user_story_id', type: 'VARCHAR(255)' },
    { name: 'user_story_id', type: 'VARCHAR(255)' },
    { name: 'test_case_id', type: 'TEXT', notNull: true },
    { name: 'title', type: 'TEXT', notNull: true },
    { name: 'description', type: 'TEXT' },
    { name: 'objective', type: 'TEXT' },
    { name: 'preconditions', type: 'JSON' },
    { name: 'test_steps', type: 'JSON', notNull: true },
    { name: 'expected_result', type: 'TEXT' },
    { name: 'postconditions', type: 'JSON' },
    { name: 'test_data', type: 'JSON' },
    { name: 'test_type', type: 'TEXT', default: "'functional'" },
    { name: 'category', type: 'TEXT', notNull: true, default: "'functional'" },
    { name: 'priority', type: 'TEXT', default: "'P2'" },
    { name: 'status', type: 'TEXT', default: "'draft'" },
    { name: 'edit_status', type: 'TEXT', default: "'original'" },
    { name: 'is_edited', type: 'INT', default: '0' },
    { name: 'linked_acceptance_criteria', type: 'JSON' },
    { name: 'tags', type: 'JSON' },
    { name: 'notes', type: 'TEXT' },
    { name: 'original_version', type: 'JSON' },
    { name: 'change_history', type: 'JSON' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  ado_configurations: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'organization', type: 'TEXT', notNull: true },
    { name: 'project', type: 'TEXT', notNull: true },
    { name: 'pat', type: 'TEXT', notNull: true },
    { name: 'is_active', type: 'INT', default: '1' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  functional_test_runs: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'project_id', type: 'VARCHAR(255)' },
    { name: 'website_url', type: 'TEXT', notNull: true },
    { name: 'test_focus', type: 'TEXT', notNull: true, default: "'all'" },
    { name: 'domain', type: 'TEXT', default: "'general'" },
    { name: 'product_context', type: 'TEXT' },
    { name: 'sample_mode', type: 'TEXT', default: "'comprehensive'" },
    { name: 'status', type: 'TEXT', notNull: true, default: "'running'" },
    { name: 'total_test_cases', type: 'INT', default: '0' },
    { name: 'workflow_cases', type: 'INT', default: '0' },
    { name: 'functional_cases', type: 'INT', default: '0' },
    { name: 'negative_cases', type: 'INT', default: '0' },
    { name: 'edge_cases', type: 'INT', default: '0' },
    { name: 'text_validation_cases', type: 'INT', default: '0' },
    { name: 'completed_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  functional_test_run_cases: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'run_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'test_id', type: 'TEXT', notNull: true },
    { name: 'category', type: 'TEXT', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'objective', type: 'TEXT' },
    { name: 'preconditions', type: 'JSON' },
    { name: 'test_steps', type: 'JSON', notNull: true },
    { name: 'expected_result', type: 'TEXT', notNull: true },
    { name: 'test_data', type: 'JSON' },
    { name: 'priority', type: 'TEXT', default: "'P2'" },
    { name: 'status', type: 'TEXT', default: "'generated'" },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  integration_configs: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'user_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'platform', type: 'TEXT', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'config', type: 'JSON', notNull: true },
    { name: 'status', type: 'TEXT', notNull: true, default: "'not_configured'" },
    { name: 'last_synced_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'last_error', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  execution_runs: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'project_id', type: 'VARCHAR(255)' },
    { name: 'run_name', type: 'TEXT', notNull: true },
    { name: 'browser', type: 'TEXT', notNull: true, default: "'chromium'" },
    { name: 'execution_mode', type: 'TEXT', notNull: true, default: "'headless'" },
    { name: 'status', type: 'TEXT', notNull: true, default: "'pending'" },
    { name: 'total_tests', type: 'INT', notNull: true, default: '0' },
    { name: 'passed_tests', type: 'INT', default: '0' },
    { name: 'failed_tests', type: 'INT', default: '0' },
    { name: 'skipped_tests', type: 'INT', default: '0' },
    { name: 'duration', type: 'INT', default: '0' },
    { name: 'video_path', type: 'TEXT' },
    { name: 'agent_logs', type: 'JSON' },
    { name: 'started_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'completed_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  execution_run_tests: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'run_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'test_case_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'test_case_source', type: 'TEXT', notNull: true, default: "'functional'" },
    { name: 'test_name', type: 'TEXT', notNull: true },
    { name: 'category', type: 'TEXT', notNull: true, default: "'functional'" },
    { name: 'status', type: 'TEXT', notNull: true, default: "'pending'" },
    { name: 'duration', type: 'INT', default: '0' },
    { name: 'step_results', type: 'JSON' },
    { name: 'final_screenshot_path', type: 'TEXT' },
    { name: 'error_message', type: 'TEXT' },
    { name: 'console_errors', type: 'JSON' },
    { name: 'started_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'completed_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  bdd_feature_files: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'project_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'test_case_id', type: 'VARCHAR(255)' },
    { name: 'test_case_source', type: 'TEXT', default: "'functional'" },
    { name: 'feature_name', type: 'TEXT', notNull: true },
    { name: 'file_name', type: 'TEXT', notNull: true },
    { name: 'content', type: 'TEXT', notNull: true },
    { name: 'language', type: 'TEXT', notNull: true, default: "'gherkin'" },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  bdd_step_definitions: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'project_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'feature_file_id', type: 'VARCHAR(255)' },
    { name: 'step_def_name', type: 'TEXT', notNull: true },
    { name: 'file_name', type: 'TEXT', notNull: true },
    { name: 'content', type: 'TEXT', notNull: true },
    { name: 'language', type: 'TEXT', notNull: true, default: "'typescript'" },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  synthetic_data_jobs: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'user_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'project_id', type: 'VARCHAR(255)' },
    { name: 'domain', type: 'TEXT', notNull: true },
    { name: 'sub_domain', type: 'TEXT', notNull: true },
    { name: 'record_count', type: 'INT', notNull: true, default: '100' },
    { name: 'data_prefix', type: 'TEXT' },
    { name: 'masking_enabled', type: 'INT', notNull: true, default: '0' },
    { name: 'selected_fields', type: 'JSON' },
    { name: 'generated_data', type: 'JSON' },
    { name: 'metadata', type: 'JSON' },
    { name: 'status', type: 'TEXT', notNull: true, default: "'pending'" },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'completed_at', type: 'TIMESTAMP', default: 'NULL' },
  ],
  visual_regression_baselines: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'project_id', type: 'VARCHAR(255)' },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'url', type: 'TEXT', notNull: true },
    { name: 'viewport', type: 'TEXT', notNull: true, default: "'desktop'" },
    { name: 'viewport_width', type: 'INT', default: '1920' },
    { name: 'viewport_height', type: 'INT', default: '1080' },
    { name: 'baseline_image_url', type: 'TEXT' },
    { name: 'baseline_image_data', type: 'TEXT' },
    { name: 'metadata', type: 'JSON' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  visual_regression_results: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'baseline_id', type: 'VARCHAR(255)' },
    { name: 'project_id', type: 'VARCHAR(255)' },
    { name: 'status', type: 'TEXT', notNull: true, default: "'pending'" },
    { name: 'diff_percentage', type: 'INT' },
    { name: 'ssim_score', type: 'INT' },
    { name: 'psnr_score', type: 'INT' },
    { name: 'mse_score', type: 'INT' },
    { name: 'pixels_different', type: 'INT' },
    { name: 'total_pixels', type: 'INT' },
    { name: 'current_image_data', type: 'TEXT' },
    { name: 'diff_image_data', type: 'TEXT' },
    { name: 'differences', type: 'JSON' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  accessibility_scan_results: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'project_id', type: 'VARCHAR(255)' },
    { name: 'url', type: 'TEXT', notNull: true },
    { name: 'status', type: 'TEXT', notNull: true, default: "'pending'" },
    { name: 'overall_score', type: 'INT' },
    { name: 'violations_count', type: 'INT', default: '0' },
    { name: 'passes_count', type: 'INT', default: '0' },
    { name: 'incomplete_count', type: 'INT', default: '0' },
    { name: 'inapplicable_count', type: 'INT', default: '0' },
    { name: 'critical_count', type: 'INT', default: '0' },
    { name: 'serious_count', type: 'INT', default: '0' },
    { name: 'moderate_count', type: 'INT', default: '0' },
    { name: 'minor_count', type: 'INT', default: '0' },
    { name: 'violations', type: 'JSON' },
    { name: 'passes', type: 'JSON' },
    { name: 'incomplete', type: 'JSON' },
    { name: 'wcag_criteria', type: 'JSON' },
    { name: 'metadata', type: 'JSON' },
    { name: 'screen_reader_result', type: 'JSON' },
    { name: 'visual_test_result', type: 'JSON' },
    { name: 'ai_analysis', type: 'JSON' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  responsive_test_results: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'project_id', type: 'VARCHAR(255)' },
    { name: 'url', type: 'TEXT', notNull: true },
    { name: 'status', type: 'TEXT', notNull: true, default: "'pending'" },
    { name: 'overall_score', type: 'INT' },
    { name: 'devices_tested_count', type: 'INT', default: '0' },
    { name: 'passed_devices_count', type: 'INT', default: '0' },
    { name: 'failed_devices_count', type: 'INT', default: '0' },
    { name: 'device_results', type: 'JSON' },
    { name: 'layout_issues', type: 'JSON' },
    { name: 'touch_target_issues', type: 'JSON' },
    { name: 'performance_metrics', type: 'JSON' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  report_validations: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'user_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'source_filename', type: 'TEXT', notNull: true },
    { name: 'target_filename', type: 'TEXT', notNull: true },
    { name: 'source_file_type', type: 'TEXT', notNull: true },
    { name: 'target_file_type', type: 'TEXT', notNull: true },
    { name: 'status', type: 'TEXT', notNull: true, default: "'pending'" },
    { name: 'result', type: 'TEXT' },
    { name: 'match_percentage', type: 'INT' },
    { name: 'config', type: 'JSON' },
    { name: 'summary', type: 'JSON' },
    { name: 'ai_analysis', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'completed_at', type: 'TIMESTAMP', default: 'NULL' },
  ],
  validation_results: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'validation_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'row_number', type: 'INT' },
    { name: 'column_name', type: 'TEXT' },
    { name: 'sheet_name', type: 'TEXT' },
    { name: 'source_value', type: 'TEXT' },
    { name: 'target_value', type: 'TEXT' },
    { name: 'difference', type: 'TEXT' },
    { name: 'percent_diff', type: 'TEXT' },
    { name: 'match_status', type: 'TEXT', notNull: true },
    { name: 'ai_analysis', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  api_baselines: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'description', type: 'TEXT' },
    { name: 'method', type: 'TEXT', notNull: true },
    { name: 'endpoint', type: 'TEXT', notNull: true },
    { name: 'request_headers', type: 'JSON' },
    { name: 'request_body', type: 'TEXT' },
    { name: 'baseline_response', type: 'JSON' },
    { name: 'baseline_status_code', type: 'INT' },
    { name: 'baseline_headers', type: 'JSON' },
    { name: 'response_schema', type: 'JSON' },
    { name: 'last_executed_at', type: 'TIMESTAMP', default: 'NULL' },
    { name: 'last_execution_status', type: 'TEXT' },
    { name: 'execution_count', type: 'INT', default: '0' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  api_baseline_executions: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'baseline_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'status', type: 'TEXT', notNull: true },
    { name: 'status_code', type: 'INT' },
    { name: 'response_time', type: 'INT' },
    { name: 'actual_response', type: 'JSON' },
    { name: 'differences', type: 'JSON' },
    { name: 'summary', type: 'JSON' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  jira_test_cases: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'jira_project_key', type: 'TEXT', notNull: true },
    { name: 'jira_board_id', type: 'INT' },
    { name: 'jira_sprint_id', type: 'INT' },
    { name: 'jira_story_id', type: 'TEXT', notNull: true },
    { name: 'jira_story_title', type: 'TEXT', notNull: true },
    { name: 'test_case_id', type: 'TEXT', notNull: true },
    { name: 'title', type: 'TEXT', notNull: true },
    { name: 'description', type: 'TEXT' },
    { name: 'objective', type: 'TEXT' },
    { name: 'preconditions', type: 'JSON' },
    { name: 'test_steps', type: 'JSON', notNull: true },
    { name: 'expected_result', type: 'TEXT' },
    { name: 'postconditions', type: 'JSON' },
    { name: 'test_data', type: 'JSON' },
    { name: 'test_type', type: 'TEXT', default: "'functional'" },
    { name: 'category', type: 'TEXT', notNull: true, default: "'functional'" },
    { name: 'priority', type: 'TEXT', default: "'P2'" },
    { name: 'playwright_script', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  automation_scripts: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'run_id', type: 'VARCHAR(255)' },
    { name: 'project_id', type: 'VARCHAR(255)' },
    { name: 'script_type', type: 'TEXT', notNull: true },
    { name: 'pattern', type: 'TEXT', notNull: true },
    { name: 'file_name', type: 'TEXT', notNull: true },
    { name: 'file_path', type: 'TEXT', notNull: true },
    { name: 'content', type: 'TEXT', notNull: true },
    { name: 'page_url', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  api_discovery_runs: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'run_id', type: 'VARCHAR(255)' },
    { name: 'project_id', type: 'VARCHAR(255)' },
    { name: 'discovery_type', type: 'TEXT', notNull: true },
    { name: 'source_url', type: 'TEXT' },
    { name: 'spec_content', type: 'JSON' },
    { name: 'endpoints', type: 'JSON' },
    { name: 'status', type: 'TEXT', notNull: true, default: "'pending'" },
    { name: 'created_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  har_captures: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: true },
    { name: 'discovery_run_id', type: 'VARCHAR(255)' },
    { name: 'url', type: 'TEXT', notNull: true },
    { name: 'method', type: 'TEXT', notNull: true },
    { name: 'request_headers', type: 'JSON' },
    { name: 'request_body', type: 'TEXT' },
    { name: 'status_code', type: 'INT' },
    { name: 'response_headers', type: 'JSON' },
    { name: 'response_body', type: 'TEXT' },
    { name: 'duration', type: 'INT' },
    { name: 'captured_at', type: 'TIMESTAMP', notNull: true, default: 'CURRENT_TIMESTAMP' },
  ],
  framework_configs: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: false },
    { name: 'project_id', type: 'VARCHAR(255)' },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'framework', type: 'TEXT', notNull: true },
    { name: 'language', type: 'TEXT', notNull: true },
    { name: 'description', type: 'TEXT' },
    { name: 'is_global', type: 'TINYINT(1)', default: '0' },
    { name: 'base_class', type: 'TEXT' },
    { name: 'sample_script', type: 'TEXT' },
    { name: 'detected_pattern', type: 'TEXT' },
    { name: 'detected_language', type: 'TEXT' },
    { name: 'detected_tool', type: 'TEXT' },
    { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
  ],
  framework_functions: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: false },
    { name: 'config_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'signature', type: 'TEXT', notNull: true },
    { name: 'description', type: 'TEXT' },
    { name: 'category', type: 'TEXT', notNull: true },
    { name: 'return_type', type: 'TEXT', default: "'void'" },
    { name: 'parameters', type: 'JSON' },
    { name: 'source_file', type: 'TEXT' },
    { name: 'class_name', type: 'TEXT' },
    { name: 'import_path', type: 'TEXT' },
    { name: 'is_custom', type: 'TINYINT(1)', default: '0' },
    { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
  ],
  framework_files: [
    { name: 'id', type: 'VARCHAR(255)', primaryKey: true, defaultUUID: false },
    { name: 'config_id', type: 'VARCHAR(255)', notNull: true },
    { name: 'filename', type: 'TEXT', notNull: true },
    { name: 'file_hash', type: 'TEXT' },
    { name: 'content', type: 'TEXT', notNull: true },
    { name: 'file_type', type: 'TEXT', notNull: true },
    { name: 'parsed_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
  ],
};

function getColName(col) {
  if (col.rawName) return col.name;
  return `\`${col.name}\``;
}

function getColumnDef(col, forCreate) {
  let def = `${getColName(col)} ${col.type}`;

  if (col.primaryKey && forCreate) {
    def += ' NOT NULL PRIMARY KEY';
    if (col.defaultUUID) def += ' DEFAULT (UUID())';
    return def;
  }

  if (col.notNull) def += ' NOT NULL';

  // MySQL forbids DEFAULT on BLOB / TEXT / GEOMETRY / JSON columns. The Drizzle
  // schema declares text().default("pending") on many status-like columns, but
  // Drizzle applies these defaults client-side at insert time — they aren't
  // required on the DB column itself. Silently drop the DEFAULT clause for
  // these column types so CREATE TABLE / ALTER TABLE ADD COLUMN don't fail.
  const upperType = (col.type || '').toUpperCase();
  const isTextLike =
    upperType === 'TEXT' ||
    upperType === 'LONGTEXT' ||
    upperType === 'MEDIUMTEXT' ||
    upperType === 'TINYTEXT' ||
    upperType === 'BLOB' ||
    upperType === 'LONGBLOB' ||
    upperType === 'MEDIUMBLOB' ||
    upperType === 'TINYBLOB' ||
    upperType === 'JSON' ||
    upperType === 'GEOMETRY';
  if (col.default !== undefined && !isTextLike) {
    def += ` DEFAULT ${col.default}`;
  }
  if (col.unique) def += ' UNIQUE';

  return def;
}

function buildSslConfig(host) {
  if (process.env.MYSQL_DISABLE_SSL === 'true' || process.env.MYSQL_DISABLE_SSL === '1') {
    return false;
  }
  if (!host || /^(localhost|127\.|::1)/.test(host)) {
    return false;
  }
  // AWS RDS / Aurora hosts use Amazon-issued root CAs that aren't in Node's
  // default trust store on dev machines. Auto-relax verification for these
  // hostnames; an explicit MYSQL_SSL_REJECT_UNAUTHORIZED setting always wins.
  if (process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === undefined && /\.rds\.amazonaws\.com$/i.test(host)) {
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== 'false' };
}

function resolveConfig() {
  if (process.env.QE_DATABASE_URL) {
    return { uri: process.env.QE_DATABASE_URL, _source: 'QE_DATABASE_URL' };
  }
  for (const { prefix, label } of [
    { prefix: 'NAT_MYSQL', label: 'NAT_MYSQL_*' },
    { prefix: 'MYSQL', label: 'MYSQL_*' },
  ]) {
    const host = process.env[`${prefix}_HOST`];
    const user = process.env[`${prefix}_USER`];
    const password = process.env[`${prefix}_PASSWORD`];
    const database = process.env[`${prefix}_DATABASE`];
    if (host && user && password && database) {
      return {
        host,
        port: parseInt(process.env[`${prefix}_PORT`] || '3306', 10),
        user,
        password,
        database,
        ssl: buildSslConfig(host),
        _source: label,
      };
    }
  }
  return null;
}

/**
 * When DEVX_HOSTING=aws and the .env carries only AWS bootstrap creds (no
 * MYSQL_*), fetch the MYSQL_* keys from AWS Secrets Manager and inject them
 * into process.env so resolveConfig() above succeeds. No-op when the user
 * has set MYSQL_* directly (Azure mode or anyone overriding).
 */
async function bootstrapFromSecretsManagerIfNeeded() {
  const hasMysqlEnv = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE']
    .every((k) => process.env[k]);
  const hasNatEnv = ['NAT_MYSQL_HOST', 'NAT_MYSQL_USER', 'NAT_MYSQL_PASSWORD', 'NAT_MYSQL_DATABASE']
    .every((k) => process.env[k]);
  const hasUrl = !!process.env.QE_DATABASE_URL;
  if (hasMysqlEnv || hasNatEnv || hasUrl) {
    return; // already configured — leave alone
  }

  const isAws = (process.env.DEVX_HOSTING || '').toLowerCase() === 'aws';
  const hasBootstrap = !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY;
  if (!isAws || !hasBootstrap) {
    return; // Azure mode or no bootstrap — let resolveConfig() report the missing creds
  }

  const secretName = process.env.AWS_SECRET_NAME || 'devx/platform/qa';
  const region = process.env.AWS_REGION || 'ap-south-1';
  console.log(`[sync-schema] No MYSQL_* in env — bootstrapping from Secrets Manager: secret="${secretName}", region="${region}"`);

  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({ region });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
  if (!response.SecretString) {
    throw new Error(`Secret "${secretName}" has no SecretString`);
  }
  const parsed = JSON.parse(response.SecretString);
  const required = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
  let injected = 0;
  for (const key of required) {
    if (parsed[key] !== undefined && parsed[key] !== null) {
      process.env[key] = String(parsed[key]);
      injected += 1;
    }
  }
  console.log(`[sync-schema] Injected ${injected}/${required.length} MYSQL_* keys from Secrets Manager.`);
}

async function main() {
  await bootstrapFromSecretsManagerIfNeeded();
  const config = resolveConfig();
  if (!config) {
    console.error('ERROR: No QE database connection configured.');
    console.error('Set one of:');
    console.error('  - QE_DATABASE_URL  (e.g. mysql://user:pass@host:3306/db?ssl={"rejectUnauthorized":true})');
    console.error('  - NAT_MYSQL_HOST + NAT_MYSQL_USER + NAT_MYSQL_PASSWORD + NAT_MYSQL_DATABASE  (+ optional NAT_MYSQL_PORT)');
    console.error('  - MYSQL_HOST + MYSQL_USER + MYSQL_PASSWORD + MYSQL_DATABASE  (+ optional MYSQL_PORT)');
    process.exit(1);
  }

  const { _source, ...poolConfig } = config;
  const pool = mysql.createPool({
    ...poolConfig,
    connectTimeout: 30000,
    waitForConnections: true,
    connectionLimit: 5,
  });

  console.log(`Using connection from: ${_source}`);

  const tablesCreated = [];
  const columnsAdded = [];
  const errors = [];

  try {
    console.log('Connecting to MySQL database...');
    const conn = await pool.getConnection();
    conn.release();
    console.log('Connected successfully!\n');

    for (const [tableName, columns] of Object.entries(tables)) {
      process.stdout.write(`Processing table: ${tableName} ... `);

      try {
        const [rows] = await pool.query(`SHOW TABLES LIKE ?`, [tableName]);

        if (rows.length === 0) {
          const colDefs = columns.map(col => getColumnDef(col, true));
          const createSQL = `CREATE TABLE \`${tableName}\` (\n  ${colDefs.join(',\n  ')}\n)`;
          await pool.query(createSQL);
          tablesCreated.push({ table: tableName, columnCount: columns.length });
          console.log(`CREATED (${columns.length} columns)`);
        } else {
          const [existingCols] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\``);
          const existingNames = new Set(existingCols.map(c => c.Field.toLowerCase()));

          let addedCount = 0;
          for (const col of columns) {
            if (col.primaryKey) continue;

            const colNameClean = col.name.replace(/`/g, '');
            if (!existingNames.has(colNameClean.toLowerCase())) {
              const colDef = getColumnDef(col, false);
              const alterSQL = `ALTER TABLE \`${tableName}\` ADD COLUMN ${colDef}`;
              await pool.query(alterSQL);
              columnsAdded.push({ table: tableName, column: colNameClean, type: col.type });
              addedCount++;
            }
          }

          if (addedCount > 0) {
            console.log(`added ${addedCount} column(s)`);
          } else {
            console.log('OK (up to date)');
          }
        }
      } catch (err) {
        console.log(`ERROR: ${err.message}`);
        errors.push({ table: tableName, error: err.message });
      }
    }

    console.log('\n========== SYNC REPORT ==========\n');

    if (tablesCreated.length > 0) {
      console.log(`TABLES CREATED (${tablesCreated.length}):`);
      for (const t of tablesCreated) {
        console.log(`  + ${t.table} (${t.columnCount} columns)`);
      }
      console.log('');
    } else {
      console.log('No new tables created.\n');
    }

    if (columnsAdded.length > 0) {
      console.log(`COLUMNS ADDED (${columnsAdded.length}):`);
      for (const c of columnsAdded) {
        console.log(`  + ${c.table}.${c.column} (${c.type})`);
      }
      console.log('');
    } else {
      console.log('No new columns added.\n');
    }

    if (errors.length > 0) {
      console.log(`ERRORS (${errors.length}):`);
      for (const e of errors) {
        console.log(`  ! ${e.table}: ${e.error}`);
      }
      console.log('');
    }

    console.log(`Total tables processed: ${Object.keys(tables).length}`);
    console.log('Schema sync complete!');
  } catch (err) {
    console.error('Fatal error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
