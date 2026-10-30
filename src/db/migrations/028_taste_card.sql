-- ── Your taste, edited and shared (src/recs/tasteCard.ts) ──────────────────────
-- Changes someone makes to their own taste profile: flavors they like or
-- don't, grapes and places to keep away from, and a budget to always use.
ALTER TABLE taste_prefs ADD COLUMN liked_flavors TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE taste_prefs ADD COLUMN disliked_flavors TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE taste_prefs ADD COLUMN avoid TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE taste_prefs ADD COLUMN budget_fixed BOOLEAN NOT NULL DEFAULT FALSE;

-- A link to someone's taste card: one per person, made when they first share, replaced to revoke it.
CREATE TABLE taste_cards (
  user_id    BIGINT PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Friends: both see each other's card and how alike they are. Made by opening a card's link and adding.
CREATE TABLE taste_friends (
  user_id    BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  friend_id  BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);
