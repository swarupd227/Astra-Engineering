-- Migration: Add design_guidelines table
-- Created: 2025-12-20

CREATE TABLE IF NOT EXISTS design_guidelines (
  id VARCHAR(36) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'Generated Design Guidelines',
  type VARCHAR(100) NOT NULL DEFAULT 'Design Guidelines',
  content LONGTEXT NOT NULL,
  figma_link TEXT NULL,
  user_prompt TEXT NULL,
  generated_prompt LONGTEXT NOT NULL COMMENT 'AI-generated base design guideline prompt used as immutable context for Phase-2',
  guidelines_content LONGTEXT NULL,
  ado_work_item_id INT NULL,
  ado_pushed_at TIMESTAMP NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_design_guidelines_project_id (project_id),
  INDEX idx_design_guidelines_type (type),
  INDEX idx_design_guidelines_status (status),
  INDEX idx_design_guidelines_created_at (created_at)
);