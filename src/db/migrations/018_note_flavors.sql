-- Flavors read from what the person wrote about a wine (their notes and
-- tags), by a language model rather than keyword matching, so "not oaky at
-- all" isn't read as oak. Read on the phone (Apple Intelligence) when it can,
-- else by an OpenRouter free model on the server (src/tastings/noteFlavors.ts).
--   note_flavors         {flavor: intensity 1-3}; NULL = not read yet
--   note_flavors_source  'apple' | 'openrouter'
--   note_flavors_for     hash of the notes and tags they were read from; an edit makes them stale
--   note_flavors_tried_at last server attempt, so a failure is retried later, not on every request
ALTER TABLE tastings
  ADD COLUMN IF NOT EXISTS note_flavors JSONB,
  ADD COLUMN IF NOT EXISTS note_flavors_source TEXT,
  ADD COLUMN IF NOT EXISTS note_flavors_for TEXT,
  ADD COLUMN IF NOT EXISTS note_flavors_tried_at TIMESTAMPTZ;
