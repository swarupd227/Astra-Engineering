-- Create provisioning_instances table for Azure App Service instance management

CREATE TABLE IF NOT EXISTS provisioning_instances (
  id VARCHAR(36) PRIMARY KEY,
  instance_name VARCHAR(255) NOT NULL,
  status ENUM('provisioning', 'ready', 'failed', 'deleting', 'deleted') NOT NULL DEFAULT 'provisioning',
  environment VARCHAR(50) NOT NULL,
  region VARCHAR(50) NOT NULL,
  runtime VARCHAR(100) NOT NULL,
  plan_tier VARCHAR(100) NOT NULL,

  -- Azure-specific fields
  subscription_id VARCHAR(36),
  resource_group_name VARCHAR(255),
  app_service_name VARCHAR(255),
  app_service_plan_name VARCHAR(255),
  url VARCHAR(500),

  -- Advanced settings
  enable_logging BOOLEAN DEFAULT FALSE,
  auto_delete_days INT,
  tags JSON,

  -- Tracking fields
  error_message TEXT,
  provisioning_started_at TIMESTAMP,
  provisioning_completed_at TIMESTAMP,

  -- Audit fields
  user_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,

  -- Indexes for performance
  INDEX idx_user_id (user_id),
  INDEX idx_instance_name_user (instance_name, user_id),
  INDEX idx_subscription (subscription_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);
