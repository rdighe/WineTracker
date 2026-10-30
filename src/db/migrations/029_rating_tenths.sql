-- Ratings in tenths (0.1 to 5): 4.3, not only 4 or 4.5. NUMERIC(2,1) already keeps one decimal.
ALTER TABLE tastings DROP CONSTRAINT IF EXISTS tastings_rating_check;
ALTER TABLE tastings ADD CONSTRAINT tastings_rating_check CHECK (rating IS NULL OR (rating >= 0.1 AND rating <= 5));
