-- Wine lists and store shelves read for picks (src/picks/): what was read,
-- by what, and for whom. Reading the same list text again reuses the entries
-- instead of asking a model; misreads kept here can become test cases.
CREATE TABLE IF NOT EXISTS pick_scans (
  pick_id    BIGSERIAL PRIMARY KEY,
  user_id    BIGINT REFERENCES users (user_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('list', 'shelf')),
  source     TEXT NOT NULL,          -- apple | gemini | openrouter | rules (lists); the provider (shelves)
  input_sha  TEXT NOT NULL,          -- hash of the list text or the shelf photo
  entries    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pick_scans_input ON pick_scans (input_sha, kind);
