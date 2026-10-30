-- CellarTracker imports run as jobs the app collects (src/api/app.ts), like wine lists.
ALTER TABLE scan_jobs DROP CONSTRAINT IF EXISTS scan_jobs_kind_check;
ALTER TABLE scan_jobs ADD CONSTRAINT scan_jobs_kind_check CHECK (kind IN ('single', 'lineup', 'picks', 'import'));

-- Wine lists and shelves not saved are kept this many days (Settings), then forgotten; 0 keeps none.
ALTER TABLE users ADD COLUMN pick_history_days INT NOT NULL DEFAULT 14 CHECK (pick_history_days BETWEEN 0 AND 365);
CREATE INDEX IF NOT EXISTS pick_scans_user_recent ON pick_scans (user_id, created_at DESC);
