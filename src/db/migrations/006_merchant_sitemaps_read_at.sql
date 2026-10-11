-- When a merchant's sitemaps were last read for product URLs (crawl.ts re-reads them weekly).
ALTER TABLE merchants ADD COLUMN sitemaps_read_at TIMESTAMPTZ;
UPDATE merchants m SET sitemaps_read_at = (SELECT MIN(queued_at) FROM crawl_pages c WHERE c.merchant_id = m.merchant_id);
