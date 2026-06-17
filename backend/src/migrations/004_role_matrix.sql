CREATE TABLE IF NOT EXISTS role_matrix (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  function VARCHAR(100) NOT NULL,
  role VARCHAR(100) NOT NULL,
  pbom_champion BOOLEAN NOT NULL DEFAULT false,
  boc_admin BOOLEAN NOT NULL DEFAULT false,
  boc_member BOOLEAN NOT NULL DEFAULT false,
  eto_user BOOLEAN NOT NULL DEFAULT false,
  team_manager BOOLEAN NOT NULL DEFAULT false,
  concatenate VARCHAR(500) NOT NULL,
  pdm_role TEXT NOT NULL,
  tlg_group TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, concatenate)
);

CREATE INDEX IF NOT EXISTS role_matrix_project_concat ON role_matrix (project_id, concatenate);
