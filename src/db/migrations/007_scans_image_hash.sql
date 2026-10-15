-- Look up earlier reads of the same photo, so a retry or re-upload doesn't call the vision model again.
CREATE INDEX IF NOT EXISTS scans_image_sha256_idx ON scans (image_sha256, created_at DESC);
