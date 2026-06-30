-- Migration: add-provisioning-instances-table
-- Created: 2026-03-04T00:00:00.000Z
-- Author: GitHub Copilot
-- Description: Create provisioning_instances table for Azure App Service instance management

CREATE TABLE IF NOT EXISTS `provisioning_instances` (
  `id` varchar(36) NOT NULL PRIMARY KEY,
  `instance_name` varchar(255) NOT NULL,
  `status` enum('provisioning', 'ready', 'failed', 'deleting', 'deleted') NOT NULL DEFAULT 'provisioning',
  `environment` varchar(50) NOT NULL,
  `region` varchar(50) NOT NULL,
  `runtime` varchar(100) NOT NULL,
  `plan_tier` varchar(100) NOT NULL,
  `subscription_id` varchar(36),
  `resource_group_name` varchar(255),
  `app_service_name` varchar(255),
  `app_service_plan_name` varchar(255),
  `url` varchar(500),
  `enable_logging` boolean DEFAULT false,
  `auto_delete_days` int,
  `tags` json,
  `error_message` text,
  `provisioning_started_at` timestamp,
  `provisioning_completed_at` timestamp,
  `user_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS `idx_provisioning_instances_user_id` ON `provisioning_instances` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_provisioning_instances_status` ON `provisioning_instances` (`status`);
CREATE INDEX IF NOT EXISTS `idx_provisioning_instances_instance_name` ON `provisioning_instances` (`instance_name`);
