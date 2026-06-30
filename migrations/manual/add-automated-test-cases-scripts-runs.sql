-- Autonomous test cases, scripts, runs, and results tables
-- Run after add-automated-test-tables.sql

CREATE TABLE IF NOT EXISTS automated_test_cases (
  id CHAR(36) PRIMARY KEY,
  crawl_run_id CHAR(36) NOT NULL,
  page_id CHAR(36),
  case_code VARCHAR(64) NOT NULL,
  title VARCHAR(512) NOT NULL,
  test_type VARCHAR(64) NOT NULL DEFAULT 'ui',
  steps JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_automated_test_cases_crawl_run_id (crawl_run_id),
  INDEX idx_automated_test_cases_page_id (page_id)
);

CREATE TABLE IF NOT EXISTS automated_test_scripts (
  id CHAR(36) PRIMARY KEY,
  crawl_run_id CHAR(36) NOT NULL,
  file_name VARCHAR(255) NOT NULL DEFAULT 'autonomous.spec.ts',
  script_content LONGTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_automated_test_scripts_crawl_run_id (crawl_run_id)
);

CREATE TABLE IF NOT EXISTS automated_test_runs (
  id CHAR(36) PRIMARY KEY,
  crawl_run_id CHAR(36) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  total_tests INT NOT NULL DEFAULT 0,
  passed_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  finished_at TIMESTAMP NULL,
  error_message TEXT,
  INDEX idx_automated_test_runs_crawl_run_id (crawl_run_id)
);

CREATE TABLE IF NOT EXISTS automated_test_results (
  id CHAR(36) PRIMARY KEY,
  test_run_id CHAR(36) NOT NULL,
  test_case_id CHAR(36) NOT NULL,
  case_code VARCHAR(64),
  status VARCHAR(20) NOT NULL,
  severity VARCHAR(20),
  error_message TEXT,
  duration_ms INT,
  INDEX idx_automated_test_results_test_run_id (test_run_id),
  INDEX idx_automated_test_results_test_case_id (test_case_id)
);
