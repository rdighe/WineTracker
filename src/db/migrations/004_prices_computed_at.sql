-- When prices were last aggregated for a wine, so wines whose offers are all
-- out of stock (no wine_prices row) aren't re-aggregated on every run.
ALTER TABLE wines ADD COLUMN prices_computed_at TIMESTAMPTZ;
