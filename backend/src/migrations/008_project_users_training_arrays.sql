-- Add complementary training names and TLG addon groups to project_users
ALTER TABLE project_users
  ADD COLUMN IF NOT EXISTS complementary_names TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tlg_addon           TEXT[] NOT NULL DEFAULT '{}';
