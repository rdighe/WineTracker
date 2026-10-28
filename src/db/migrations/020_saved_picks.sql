-- Saved wine lists and shelves (src/picks/): a pick scan the person keeps,
-- with a name, its photos and its top pick at the time it was saved. The
-- suggestions themselves are worked out afresh when it is opened, so they
-- follow the person's palate as it changes.
ALTER TABLE pick_scans
  ADD COLUMN IF NOT EXISTS saved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS top_pick TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS pick_scans_saved ON pick_scans (user_id, saved_at DESC) WHERE saved;

CREATE TABLE IF NOT EXISTS pick_photos (
  pick_id      BIGINT NOT NULL REFERENCES pick_scans (pick_id) ON DELETE CASCADE,
  n            INT NOT NULL,
  content_type TEXT NOT NULL,
  bytes        BYTEA NOT NULL,
  PRIMARY KEY (pick_id, n)
);

-- What a model read from one part of a list's text (or one shelf photo), so
-- the same text or photo is never read twice: adding a page to a list only
-- reads the new page.
CREATE TABLE IF NOT EXISTS list_reads (
  input_sha  TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('list', 'shelf')),
  source     TEXT NOT NULL,
  entries    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
