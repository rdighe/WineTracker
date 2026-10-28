-- Wine photos served through the API (GET /api/photo): each shop image is
-- fetched once, resized, and kept here, so the phone never has to load a shop's
-- URL itself (plain-http links, hotlink blocking and slow shop servers all
-- left blank photos).
CREATE TABLE IF NOT EXISTS photos (
  url_md5      TEXT PRIMARY KEY,
  url          TEXT NOT NULL,
  bytes        BYTEA,                 -- NULL: the shop didn't give us an image (retried after a day)
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only URLs that are some wine's photo are served; look them up quickly.
CREATE INDEX IF NOT EXISTS wines_image_url_md5 ON wines (md5(image_url)) WHERE image_url IS NOT NULL;

-- Wines are now also given their own shop photo when no white-background
-- packshot exists: look again at the ones that have none.
UPDATE wines SET image_checked_at = NULL WHERE image_url IS NULL AND image_checked_at IS NOT NULL;
