-- WineTracker initial schema.
-- Conventions:
--   * Prices are integer cents, USD only for now (currency kept on every row so
--     more markets can be added without a rewrite).
--   * vintage_key is the vintage as text: a year ('2015') or 'NV'. Rows whose
--     vintage is unknown use NULL and are excluded from per-vintage aggregates.
--   * *_norm columns hold text run through normalize() in src/lib/normalize.ts,
--     so SQL trigram search and TS scoring see the same strings.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Catalog ──────────────────────────────────────────────────────────────────
-- One row per wine (not per vintage). lwin is the 7-digit LWIN when known.
CREATE TABLE wines (
  wine_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lwin           TEXT UNIQUE,
  producer       TEXT NOT NULL DEFAULT '',
  name           TEXT NOT NULL DEFAULT '',     -- wine/cuvee name without producer
  display_name   TEXT NOT NULL,
  country        TEXT NOT NULL DEFAULT '',
  region         TEXT NOT NULL DEFAULT '',
  sub_region     TEXT NOT NULL DEFAULT '',
  colour         TEXT NOT NULL DEFAULT '',     -- red | white | rose | '' (unknown)
  wine_type      TEXT NOT NULL DEFAULT '',     -- still | sparkling | fortified | dessert | ''
  grape          TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL CHECK (source IN ('lwin', 'crawl', 'user', 'llm')),
  producer_norm  TEXT NOT NULL DEFAULT '',
  search_norm    TEXT NOT NULL DEFAULT '',     -- normalized producer + name + region
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wines_search_trgm   ON wines USING gin (search_norm gin_trgm_ops);
CREATE INDEX idx_wines_producer_trgm ON wines USING gin (producer_norm gin_trgm_ops);

-- Extra names a wine is known by: confirmed scans, matched retailer titles.
-- Matching against aliases is how the matcher gets better with use.
CREATE TABLE wine_aliases (
  wine_id    BIGINT NOT NULL REFERENCES wines (wine_id) ON DELETE CASCADE,
  alias_norm TEXT NOT NULL,
  source     TEXT NOT NULL,                    -- scan_confirm | listing | manual
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wine_id, alias_norm)
);
CREATE INDEX idx_wine_aliases_trgm ON wine_aliases USING gin (alias_norm gin_trgm_ops);

-- ── Merchants & crawled listings ─────────────────────────────────────────────
CREATE TABLE merchants (
  merchant_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  domain        TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  country       TEXT NOT NULL DEFAULT 'US',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per retailer product page. A listing is matched to a wine once and
-- re-priced on every crawl.
CREATE TABLE listings (
  listing_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merchant_id   BIGINT NOT NULL REFERENCES merchants (merchant_id) ON DELETE CASCADE,
  url           TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  brand         TEXT NOT NULL DEFAULT '',
  sku           TEXT NOT NULL DEFAULT '',
  gtin          TEXT NOT NULL DEFAULT '',
  attributes    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- region/grape/etc. when the page has them
  wine_id       BIGINT REFERENCES wines (wine_id) ON DELETE SET NULL,
  vintage_key   TEXT,
  bottle_ml     INTEGER,
  pack_size     INTEGER NOT NULL DEFAULT 1,
  match_score   REAL,
  match_status  TEXT NOT NULL DEFAULT 'unmatched'
                CHECK (match_status IN ('auto', 'review', 'unmatched', 'manual', 'not_wine')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_listings_wine ON listings (wine_id, vintage_key);
CREATE INDEX idx_listings_status ON listings (match_status);

-- Crawl frontier/state so a large crawl can stop and resume.
CREATE TABLE crawl_pages (
  url          TEXT PRIMARY KEY,
  merchant_id  BIGINT NOT NULL REFERENCES merchants (merchant_id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'done', 'skipped', 'error', 'disallowed')),
  http_status  INTEGER,
  found_product BOOLEAN,
  error        TEXT,
  queued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetched_at   TIMESTAMPTZ
);
CREATE INDEX idx_crawl_pages_queue ON crawl_pages (merchant_id, status);

-- ── Prices ───────────────────────────────────────────────────────────────────
CREATE TABLE price_observations (
  observation_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wine_id          BIGINT NOT NULL REFERENCES wines (wine_id) ON DELETE CASCADE,
  vintage_key      TEXT,
  bottle_ml        INTEGER NOT NULL DEFAULT 750,
  pack_size        INTEGER NOT NULL DEFAULT 1,
  price_cents      INTEGER NOT NULL CHECK (price_cents > 0),   -- as listed, for the whole pack
  unit_750_cents   INTEGER NOT NULL CHECK (unit_750_cents > 0), -- per bottle, scaled to 750 ml
  currency         TEXT NOT NULL DEFAULT 'USD',
  in_stock         BOOLEAN,
  context          TEXT NOT NULL DEFAULT 'retail' CHECK (context IN ('retail', 'restaurant', 'auction')),
  source_type      TEXT NOT NULL CHECK (source_type IN ('crawl', 'web_search', 'user', 'feed')),
  merchant_id      BIGINT REFERENCES merchants (merchant_id) ON DELETE SET NULL,
  listing_id       BIGINT REFERENCES listings (listing_id) ON DELETE SET NULL,
  url              TEXT NOT NULL DEFAULT '',
  confidence       REAL NOT NULL DEFAULT 1.0,
  observed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_obs_wine ON price_observations (wine_id, vintage_key, observed_at DESC);
-- A listing re-crawled the same day at the same price is one observation, not two.
CREATE UNIQUE INDEX idx_obs_listing_day
  ON price_observations (listing_id, ((observed_at AT TIME ZONE 'UTC')::date), price_cents)
  WHERE listing_id IS NOT NULL;

-- Current market price per wine + vintage, recomputed from observations.
-- vintage_key '*' is the all-vintages summary.
CREATE TABLE wine_prices (
  wine_id         BIGINT NOT NULL REFERENCES wines (wine_id) ON DELETE CASCADE,
  vintage_key     TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  median_cents    INTEGER NOT NULL,
  p10_cents       INTEGER NOT NULL,
  p90_cents       INTEGER NOT NULL,
  n_observations  INTEGER NOT NULL,
  n_merchants     INTEGER NOT NULL,
  window_days     INTEGER NOT NULL,
  latest_observed_at TIMESTAMPTZ NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wine_id, vintage_key, currency)
);

-- Daily median for price-history charts.
CREATE TABLE wine_price_daily (
  wine_id      BIGINT NOT NULL REFERENCES wines (wine_id) ON DELETE CASCADE,
  vintage_key  TEXT NOT NULL,
  day          DATE NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  median_cents INTEGER NOT NULL,
  n            INTEGER NOT NULL,
  PRIMARY KEY (wine_id, vintage_key, day, currency)
);

-- On-demand refreshes, so repeated user requests for the same wine are
-- throttled instead of each triggering a fresh web lookup.
CREATE TABLE price_refreshes (
  refresh_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wine_id      BIGINT NOT NULL REFERENCES wines (wine_id) ON DELETE CASCADE,
  vintage_key  TEXT,
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'error')),
  found        INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);
CREATE INDEX idx_price_refreshes_wine ON price_refreshes (wine_id, started_at DESC);

-- ── Label scans ──────────────────────────────────────────────────────────────
CREATE TABLE scans (
  scan_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  image_sha256   TEXT NOT NULL,
  extracted      JSONB NOT NULL,          -- fields the vision model read off the label
  candidates     JSONB NOT NULL,          -- ranked matches with scores
  outcome        TEXT NOT NULL CHECK (outcome IN ('auto', 'choose', 'new')),
  chosen_wine_id BIGINT REFERENCES wines (wine_id) ON DELETE SET NULL,
  confirmed_at   TIMESTAMPTZ,
  provider       TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
