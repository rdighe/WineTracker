-- ── Community notes (src/community/community.ts) ─────────────────────────────
-- What someone thought of a wine, shared with everyone: how they liked it and
-- whether it was ready to drink, in words - never a score. A tasting stays
-- private unless its note is shared.
ALTER TABLE users ADD COLUMN public_name TEXT NOT NULL DEFAULT '';

CREATE TABLE community_notes (
  note_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  wine_id     BIGINT NOT NULL REFERENCES wines (wine_id) ON DELETE CASCADE,
  vintage_key TEXT,
  tasting_id  BIGINT UNIQUE REFERENCES tastings (tasting_id) ON DELETE SET NULL,
  reaction    TEXT NOT NULL CHECK (reaction IN ('loved', 'liked', 'okay', 'not_for_me')),
  maturity    TEXT CHECK (maturity IS NULL OR maturity IN ('too_young', 'ready', 'peak', 'past_prime')),
  body        TEXT NOT NULL DEFAULT '',
  hidden      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX community_notes_recent ON community_notes (created_at DESC) WHERE NOT hidden;
CREATE INDEX community_notes_wine ON community_notes (wine_id, created_at DESC) WHERE NOT hidden;
CREATE INDEX community_notes_user ON community_notes (user_id, created_at DESC);

CREATE TABLE community_likes (
  note_id    BIGINT NOT NULL REFERENCES community_notes (note_id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, user_id)
);

CREATE TABLE community_replies (
  reply_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note_id    BIGINT NOT NULL REFERENCES community_notes (note_id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  hidden     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX community_replies_note ON community_replies (note_id, created_at);

-- Reports of a note or a reply; enough of them hides it until looked at.
CREATE TABLE community_reports (
  report_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note_id    BIGINT REFERENCES community_notes (note_id) ON DELETE CASCADE,
  reply_id   BIGINT REFERENCES community_replies (reply_id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  reason     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((note_id IS NULL) <> (reply_id IS NULL))
);
CREATE UNIQUE INDEX community_reports_once_note ON community_reports (note_id, user_id) WHERE note_id IS NOT NULL;
CREATE UNIQUE INDEX community_reports_once_reply ON community_reports (reply_id, user_id) WHERE reply_id IS NOT NULL;

-- People someone never wants to see notes or replies from.
CREATE TABLE community_blocks (
  user_id    BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  blocked_id BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, blocked_id)
);
