-- For you: a person's saved searches ("Find wines" criteria), to open again later.
CREATE TABLE rec_views (
  view_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  criteria   JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX rec_views_user ON rec_views (user_id, created_at DESC);
