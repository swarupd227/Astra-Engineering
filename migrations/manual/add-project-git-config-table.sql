-- Per-project Git storage config for test artifacts (manual test cases, BDD).
-- When no row exists for a project, backend falls back to GitHub env (GITHUB_*).

CREATE TABLE IF NOT EXISTS project_git_config (
  id CHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  provider ENUM('github', 'ado') NOT NULL DEFAULT 'ado',
  branch VARCHAR(255) NOT NULL DEFAULT 'main',
  base_path VARCHAR(512),
  ado_repository_id VARCHAR(36),
  ado_repository_name VARCHAR(255),
  token TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_project_git_config_project_id ON project_git_config(project_id);
