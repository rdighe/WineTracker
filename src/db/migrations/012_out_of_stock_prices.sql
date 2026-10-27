-- The market price came from out-of-stock offers, because no shop had that vintage in stock (src/prices/aggregate.ts).
ALTER TABLE wine_prices ADD COLUMN IF NOT EXISTS out_of_stock_only BOOLEAN NOT NULL DEFAULT FALSE;
