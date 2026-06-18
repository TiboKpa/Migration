-- Stores the distinct dimension lists for a project's role matrix
CREATE TABLE IF NOT EXISTS role_matrix_dimensions (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('function', 'role', 'info_key')),
  value       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, type, value)
);
