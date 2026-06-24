-- Campaign communications: individual emails generated per role/part within a campaign
CREATE TABLE IF NOT EXISTS campaign_communications (
  id           SERIAL PRIMARY KEY,
  campaign_id  INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  wave         INTEGER NOT NULL,
  total_parts  INTEGER NOT NULL,
  subject      TEXT,
  to_list      JSONB DEFAULT '[]',
  cc_list      JSONB DEFAULT '[]',
  html_body    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_communications_campaign_id
  ON campaign_communications(campaign_id);
