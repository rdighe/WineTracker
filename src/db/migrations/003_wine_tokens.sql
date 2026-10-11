-- Identity tokens per wine (computed in TypeScript by wineTokens() in
-- src/catalog/wines.ts) with a GIN index, so candidate lookup is an index
-- scan on shared words instead of a full-table similarity scan.
-- Existing rows are filled by `tsx scripts/backfill-tokens.ts`.
ALTER TABLE wines ADD COLUMN tokens TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX idx_wines_tokens ON wines USING gin (tokens);
