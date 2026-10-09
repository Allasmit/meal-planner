-- 0007_user_token_version.sql
-- Bumped on password reset and role change so previously issued session tokens stop working.
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
