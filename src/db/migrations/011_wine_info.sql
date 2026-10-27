-- Researched background per wine (src/catalog/info.ts): tasting notes,
-- producer history, specs. One row per wine, shared by all its vintages.
CREATE TABLE wine_info (
  wine_id     BIGINT PRIMARY KEY REFERENCES wines (wine_id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  info        JSONB,
  provider    TEXT NOT NULL DEFAULT '',
  error       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
