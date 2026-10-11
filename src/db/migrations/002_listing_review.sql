-- Keep the latest offer on the listing itself, so a listing that is matched
-- later (human/Claude review) can produce its price observation immediately,
-- and keep the matcher's candidates for review.
ALTER TABLE listings ADD COLUMN last_price_cents INTEGER;
ALTER TABLE listings ADD COLUMN last_currency TEXT;
ALTER TABLE listings ADD COLUMN last_in_stock BOOLEAN;
ALTER TABLE listings ADD COLUMN match_candidates JSONB NOT NULL DEFAULT '[]'::jsonb;
