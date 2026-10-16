-- Where a tasted wine was drunk: at home, at a restaurant, or elsewhere (NULL: not said, e.g. imported or cellar bottles).
ALTER TABLE tastings ADD COLUMN IF NOT EXISTS setting TEXT CHECK (setting IS NULL OR setting IN ('home', 'restaurant', 'other'));
