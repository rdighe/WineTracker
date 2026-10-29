-- What Jev decided (src/llm/jev.ts), so the same question isn't asked twice:
-- which wine an uncertain wine-list entry is (given the same candidates), and
-- how much someone will enjoy a wine (given the same ratings). Keys are
-- hashes of the inputs; a changed input is simply a new key.
CREATE TABLE IF NOT EXISTS jev_cache (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jev_cache_created ON jev_cache (created_at);
