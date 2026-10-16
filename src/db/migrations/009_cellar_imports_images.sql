-- A bottle in your cellar vs a wine you tasted elsewhere; how many bottles.
ALTER TABLE tastings ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'tasted' CHECK (kind IN ('tasted', 'cellar'));
ALTER TABLE tastings ADD COLUMN IF NOT EXISTS bottles INTEGER CHECK (bottles IS NULL OR bottles > 0);

-- Imported entries (e.g. a Vivino export) remember where they came from, so importing the same file twice adds nothing.
ALTER TABLE tastings ADD COLUMN IF NOT EXISTS external_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS tastings_user_external_ref_key ON tastings (user_id, external_ref) WHERE external_ref IS NOT NULL;

-- Product photos: the image a shop shows for a listing, and the reference photo chosen for a wine.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE wines ADD COLUMN IF NOT EXISTS image_match TEXT;          -- 'vintage' | 'wine' | 'producer'
ALTER TABLE wines ADD COLUMN IF NOT EXISTS image_checked_at TIMESTAMPTZ;
-- Finding a producer's other wines (reference photos).
CREATE INDEX IF NOT EXISTS idx_wines_producer_norm ON wines (producer_norm);
