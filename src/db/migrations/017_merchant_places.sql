-- Where each shop is and where it ships, so wines can be found near the
-- person: its physical stores (with approximate coordinates) and the US
-- states it delivers wine to. Researched once per shop from the web
-- (src/places/places.ts) and refreshed monthly.
CREATE TABLE IF NOT EXISTS merchant_places (
  merchant_id BIGINT PRIMARY KEY REFERENCES merchants (merchant_id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  stores      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{name, address, city, state, postal, lat, lng}]
  ships_to    TEXT[] NOT NULL DEFAULT '{}',          -- two-letter US state codes
  sources     JSONB NOT NULL DEFAULT '[]'::jsonb,
  error       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
