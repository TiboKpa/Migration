-- Migration 009: add additional_info JSONB to project_users for dynamic infoKeys
ALTER TABLE project_users
  ADD COLUMN IF NOT EXISTS additional_info JSONB NOT NULL DEFAULT '{}';
