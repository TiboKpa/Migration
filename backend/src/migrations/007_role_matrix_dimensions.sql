-- Stores the distinct dimension lists (functions, roles, info keys) per project.
CREATE TABLE IF NOT EXISTS role_matrix_dimensions (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('function', 'role', 'info_key')),
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, type, value)
);

-- Required for ON CONFLICT upsert in generateMatrixRows.
ALTER TABLE role_matrix
  ADD CONSTRAINT role_matrix_project_concatenate_key
  UNIQUE (project_id, concatenate);
