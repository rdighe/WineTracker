-- Label text read on the phone (OCR) for each scan, and what confirmed scans
-- taught us: the words of a label, tied to the wine it turned out to be. The
-- next photo of that label - garbled the same way - matches without an LLM.
ALTER TABLE scans ADD COLUMN IF NOT EXISTS ocr_text TEXT;

CREATE TABLE IF NOT EXISTS label_texts (
  label_text_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wine_id       BIGINT NOT NULL REFERENCES wines (wine_id) ON DELETE CASCADE,
  tokens        TEXT[] NOT NULL,
  scan_id       BIGINT REFERENCES scans (scan_id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS label_texts_tokens_idx ON label_texts USING gin (tokens);
CREATE INDEX IF NOT EXISTS label_texts_wine_idx ON label_texts (wine_id);
