-- A scan the app may not be around to hear the answer to: it tags each scan
-- with its own id, the server keeps the outcome here, and the app collects it
-- when it's back in the foreground (or relaunched) - so switching apps
-- mid-scan loses nothing.
CREATE TABLE IF NOT EXISTS scan_jobs (
  ref        TEXT PRIMARY KEY,
  user_id    BIGINT REFERENCES users (user_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('single', 'lineup')),
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  result     JSONB,
  error      TEXT,
  http_status INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS scan_jobs_created ON scan_jobs (created_at);
