-- Legacy auth used provider='azure' on user_roles; MSAL/Cognito use 'microsoft'/'cognito'.
-- Provider-scoped checks missed TenantAdmin rows after the switch, and ensureViewerRole
-- could add OrgAdmin. Align existing rows (idempotent).

UPDATE `user_roles`
SET `provider` = 'microsoft'
WHERE `provider` = 'azure';
