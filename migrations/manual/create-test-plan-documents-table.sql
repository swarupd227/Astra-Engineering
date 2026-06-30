-- Migration: Create test_plan_documents table
-- Description: Creates the test_plan_documents table for storing generated test plans from BRDs
-- Created: 2026-01-20

CREATE TABLE IF NOT EXISTS test_plan_documents (
  id VARCHAR(36) PRIMARY KEY,
  test_plan_name VARCHAR(255) NOT NULL,
  brd_id VARCHAR(36) NOT NULL,
  brd_title VARCHAR(255),
  project_id VARCHAR(36),
  organization_id VARCHAR(36),
  content LONGTEXT NOT NULL,
  created_by VARCHAR(36),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_test_plan_brd_id (brd_id),
  INDEX idx_test_plan_project_id (project_id),
  INDEX idx_test_plan_organization_id (organization_id),
  INDEX idx_test_plan_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
