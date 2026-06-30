-- Autonomous Automated Test Generation tables
-- Run this migration to create crawl_runs, automated_test_pages, page_dom_versions, page_forms, page_dom_elements

CREATE TABLE IF NOT EXISTS crawl_runs (
  id CHAR(36) PRIMARY KEY,
  base_url VARCHAR(2048) NOT NULL,
  environment VARCHAR(100) DEFAULT 'default',
  user_role VARCHAR(100) DEFAULT 'default',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  pages_discovered INT NOT NULL DEFAULT 0,
  dom_versions_created INT NOT NULL DEFAULT 0,
  config JSON,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  finished_at TIMESTAMP NULL,
  error_message TEXT,
  project_id VARCHAR(36),
  organization_id VARCHAR(36),
  INDEX idx_crawl_runs_status (status),
  INDEX idx_crawl_runs_started_at (started_at)
);

CREATE TABLE IF NOT EXISTS automated_test_pages (
  id CHAR(36) PRIMARY KEY,
  crawl_run_id CHAR(36) NOT NULL,
  page_type VARCHAR(100) DEFAULT 'page',
  route_pattern VARCHAR(512) NOT NULL,
  sample_url VARCHAR(2048) NOT NULL,
  user_role VARCHAR(100) DEFAULT 'default',
  page_signature_hash VARCHAR(64),
  title VARCHAR(512),
  depth INT NOT NULL DEFAULT 0,
  parent_page_id VARCHAR(36),
  link_count INT NOT NULL DEFAULT 0,
  form_count INT NOT NULL DEFAULT 0,
  element_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  UNIQUE KEY automated_test_pages_run_route_role (crawl_run_id, route_pattern, user_role),
  INDEX idx_automated_test_pages_crawl_run_id (crawl_run_id)
);

CREATE TABLE IF NOT EXISTS page_dom_versions (
  id CHAR(36) PRIMARY KEY,
  page_id CHAR(36) NOT NULL,
  version_number INT NOT NULL DEFAULT 1,
  dom_hash VARCHAR(64),
  dom_contract JSON NOT NULL,
  extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_page_dom_versions_page_id (page_id)
);

CREATE TABLE IF NOT EXISTS page_forms (
  id CHAR(36) PRIMARY KEY,
  page_id CHAR(36) NOT NULL,
  form_name VARCHAR(255),
  form_index INT NOT NULL DEFAULT 0,
  xpath VARCHAR(2048),
  css_selector VARCHAR(2048),
  action_url VARCHAR(2048),
  method VARCHAR(16) DEFAULT 'GET',
  field_count INT NOT NULL DEFAULT 0,
  INDEX idx_page_forms_page_id (page_id)
);

CREATE TABLE IF NOT EXISTS page_dom_elements (
  id CHAR(36) PRIMARY KEY,
  page_id CHAR(36) NOT NULL,
  element_category VARCHAR(50) NOT NULL,
  element_type VARCHAR(100),
  xpath VARCHAR(2048) NOT NULL,
  css_selector VARCHAR(2048) NOT NULL,
  element_id VARCHAR(255),
  element_name VARCHAR(255),
  label_text VARCHAR(512),
  is_required TINYINT(1) DEFAULT 0,
  form_id VARCHAR(36),
  parent_element_xpath VARCHAR(2048),
  element_tag VARCHAR(64),
  attributes JSON,
  INDEX idx_page_dom_elements_page_id (page_id)
);
