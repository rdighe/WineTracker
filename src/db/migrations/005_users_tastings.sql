-- ── Users ────────────────────────────────────────────────────────────────────
-- auth_sub is the identity provider's subject (Supabase user id).
CREATE TABLE users (
  user_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auth_sub     TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Tastings ─────────────────────────────────────────────────────────────────
-- One row per time a user tastes a wine. Rating is 0.5-5 in half steps.
-- price_paid_cents is what the user paid (bottle or glass-equivalent), with
-- price_context saying where; it is also recorded as a 'user' price
-- observation (observation_id), which never moves the market price.
CREATE TABLE tastings (
  tasting_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  wine_id          BIGINT NOT NULL REFERENCES wines (wine_id) ON DELETE CASCADE,
  vintage_key      TEXT,
  rating           NUMERIC(2, 1) CHECK (rating IS NULL OR (rating >= 0.5 AND rating <= 5 AND rating * 2 = floor(rating * 2))),
  notes            TEXT NOT NULL DEFAULT '',
  tags             JSONB NOT NULL DEFAULT '[]'::jsonb,
  price_paid_cents INTEGER CHECK (price_paid_cents IS NULL OR price_paid_cents > 0),
  price_context    TEXT CHECK (price_context IS NULL OR price_context IN ('retail', 'restaurant')),
  bottle_ml        INTEGER NOT NULL DEFAULT 750,
  location         TEXT NOT NULL DEFAULT '',
  tasted_on        DATE NOT NULL DEFAULT CURRENT_DATE,
  scan_id          BIGINT REFERENCES scans (scan_id) ON DELETE SET NULL,
  observation_id   BIGINT REFERENCES price_observations (observation_id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tastings_user ON tastings (user_id, tasted_on DESC);
CREATE INDEX idx_tastings_wine ON tastings (wine_id);

-- Wines a user wants to try / track the price of.
CREATE TABLE saved_wines (
  user_id     BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  wine_id     BIGINT NOT NULL REFERENCES wines (wine_id) ON DELETE CASCADE,
  vintage_key TEXT NOT NULL DEFAULT '*',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, wine_id, vintage_key)
);

ALTER TABLE scans ADD COLUMN user_id BIGINT REFERENCES users (user_id) ON DELETE SET NULL;
