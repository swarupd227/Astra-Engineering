-- Migration: Create integrations table
-- Description: Stores tenant-level third-party integration configurations for Datadog and ServiceNow.

CREATE TABLE IF NOT EXISTS integrations (
  id VARCHAR(36) PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  integration_type VARCHAR(50) NOT NULL,
  api_key VARCHAR(255) NOT NULL,
  app_key VARCHAR(255) NULL,
  base_url VARCHAR(255) NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
