-- Jev's read on a wine for a person, beside the fit the app gave it
-- (src/recs/jevLog.ts): never shown to people; the admin report compares
-- both with what the person later rated the wine.
CREATE TABLE jev_checks (
  user_id    BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  wine_id    BIGINT NOT NULL REFERENCES wines (wine_id) ON DELETE CASCADE,
  context    TEXT NOT NULL CHECK (context IN ('suggestions', 'list', 'shelf')),
  fit_p      REAL NOT NULL,
  jev_score  REAL NOT NULL,
  basis      INT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, wine_id, context)
);
CREATE INDEX jev_checks_checked ON jev_checks (checked_at DESC);
