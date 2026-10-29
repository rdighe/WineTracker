-- Wine lists and shelves run as jobs too (src/api/app.ts, /api/picks with a
-- ref): the app can leave while one is read, and collect the answer later.
ALTER TABLE scan_jobs DROP CONSTRAINT IF EXISTS scan_jobs_kind_check;
ALTER TABLE scan_jobs ADD CONSTRAINT scan_jobs_kind_check CHECK (kind IN ('single', 'lineup', 'picks'));
