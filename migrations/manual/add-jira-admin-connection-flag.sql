-- Adds is_admin_connection flag to jira_connections.
-- When marked admin, stored email/api_token are used for global Jira admin operations.
-- At most one row per instance_url should be flagged (enforced by the toggle endpoint).
-- Bootstrap: workspace-owner row marked admin so project creation works after deploy.

ALTER TABLE jira_connections
  ADD COLUMN is_admin_connection TINYINT NOT NULL DEFAULT 0;

UPDATE jira_connections
   SET is_admin_connection = 1
 WHERE id = '1f0016c1-2731-48e4-8ba9-1812702fcf69';
