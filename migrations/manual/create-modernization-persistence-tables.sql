-- Stack Modernization Persistence Tables
-- Run this in QA DB first, then UAT, then Prod

CREATE TABLE IF NOT EXISTS modernization_analyses (
  id CHAR(36) PRIMARY KEY,
  session_id VARCHAR(36),
  user_id VARCHAR(36),
  tenant_id VARCHAR(36),
  ado_org VARCHAR(255),
  ado_project_id VARCHAR(255),
  ado_project_name VARCHAR(255),
  modernization_type VARCHAR(50) NOT NULL DEFAULT 'tech_upgrade',
  llm_provider VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'initiated',
  current_stage VARCHAR(100),
  progress INT NOT NULL DEFAULT 0,
  selected_phases JSON,
  stack_summary VARCHAR(500),
  git_branch VARCHAR(255),
  git_file_count INT DEFAULT 0,
  errors JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NULL,
  INDEX idx_mod_analyses_project (ado_org, ado_project_id),
  INDEX idx_mod_analyses_user (user_id)
);

CREATE TABLE IF NOT EXISTS modernization_phase_outputs (
  id CHAR(36) PRIMARY KEY,
  analysis_id CHAR(36) NOT NULL,
  phase VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  metadata JSON,
  report_markdown LONGTEXT,
  activity_log JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_mod_phase_analysis (analysis_id),
  UNIQUE KEY uq_mod_phase_per_analysis (analysis_id, phase)
);

CREATE TABLE IF NOT EXISTS modernization_version_changes (
  id CHAR(36) PRIMARY KEY,
  analysis_id CHAR(36) NOT NULL,
  phase_reset VARCHAR(50) NOT NULL,
  previous_selections JSON,
  new_selections JSON,
  previous_plan_summary TEXT,
  downstream_phases_cleared JSON,
  changed_by VARCHAR(36),
  change_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_verchange_analysis (analysis_id)
);
