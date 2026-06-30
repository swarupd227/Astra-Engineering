-- Create dev_brd_documents table (idempotent).
CREATE TABLE IF NOT EXISTS dev_brd_documents (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  created_by VARCHAR(36) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  project_description LONGTEXT NULL,
  business_objectives LONGTEXT NULL,
  success_criteria LONGTEXT NULL,
  target_audience LONGTEXT NULL,
  key_stakeholders LONGTEXT NULL,
  key_features LONGTEXT NULL,
  existing_requirements LONGTEXT NULL,
  constraints LONGTEXT NULL,
  timeline LONGTEXT NULL,
  budget LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_id (project_id),
  INDEX idx_status (status),
  INDEX idx_updated_at (updated_at)
);
