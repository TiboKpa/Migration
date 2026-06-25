-- Migration 012: store per-project info-key -> complementary training links
CREATE TABLE IF NOT EXISTS role_matrix_info_key_links (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  info_key    TEXT    NOT NULL,
  complementary_items JSONB NOT NULL DEFAULT '[]',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, info_key)
);
