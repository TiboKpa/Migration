-- Add dynamic additional_info JSON column to role_matrix.
-- Migrate existing fixed boolean columns into it for backward compatibility.
ALTER TABLE role_matrix
  ADD COLUMN IF NOT EXISTS additional_info JSONB NOT NULL DEFAULT '{}';

-- Backfill existing rows: convert the 5 fixed booleans into the JSON object.
UPDATE role_matrix
SET additional_info = jsonb_build_object(
  'PBOM Champion', pbom_champion,
  'BOC Admin',     boc_admin,
  'BOC Member',    boc_member,
  'ETO User',      eto_user,
  'Team Manager',  team_manager
)
WHERE additional_info = '{}';

-- Drop the unique constraint on concatenate so we can rebuild it after
-- the concatenate value changes to use additional_info keys.
ALTER TABLE role_matrix DROP CONSTRAINT IF EXISTS role_matrix_project_concat_key;
DROP INDEX IF EXISTS role_matrix_project_concat;

-- Add new fields that were missing from original schema
ALTER TABLE role_matrix
  ADD COLUMN IF NOT EXISTS tlg_primary TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tlg_addon   JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS recommended_training_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS complementary_items JSONB NOT NULL DEFAULT '[]';

-- Re-create index without uniqueness (concatenate is now best-effort)
CREATE INDEX IF NOT EXISTS role_matrix_project_func_role
  ON role_matrix (project_id, function, role);
