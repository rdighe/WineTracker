-- ── The 90-second taste quiz (src/recs/archetypes.ts) ───────────────────────
-- What someone said they usually drink and spend, and when they finished (or
-- skipped) the quiz, so it's offered once.
CREATE TABLE taste_prefs (
  user_id    BIGINT PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  styles     TEXT[] NOT NULL DEFAULT '{}',
  budget     TEXT CHECK (budget IS NULL OR budget IN ('under20', '20to40', '40to80', 'over80')),
  done_at    TIMESTAMPTZ,
  skipped    BOOLEAN NOT NULL DEFAULT FALSE
);

-- Their answer for each kind of wine in the quiz; until they've rated real
-- wines, each counts as a rating of a typical wine of that kind.
CREATE TABLE taste_seeds (
  user_id    BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  archetype  TEXT NOT NULL,
  reaction   TEXT NOT NULL CHECK (reaction IN ('love', 'fine', 'dislike', 'unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, archetype)
);
