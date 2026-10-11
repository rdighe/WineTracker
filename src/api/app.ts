/**
 * REST API. Auth is not wired yet (Supabase Auth is the plan); until then
 * deploy this behind a private network or add an API key middleware.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type pg from 'pg';
import { createWine, getWine } from '../catalog/wines.js';
import { matchWine } from '../match/matcher.js';
import { per750 } from '../lib/listing.js';
import { ProviderUnavailableError, type LlmProvider } from '../llm/types.js';
import { confirmScan, scanLabel, ScanError } from '../scan/scan.js';
import type { PoliteFetcher } from '../prices/fetcher.js';
import { refreshPrices } from '../prices/refresh.js';
import { aggregateWines } from '../prices/aggregate.js';

export interface AppDeps {
  db: pg.Pool;
  provider: LlmProvider;
  fetcher: PoliteFetcher;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

const vintageSchema = z.string().regex(/^(1[89]\d\d|20\d\d|NV)$/).nullable().optional();
const idParam = z.coerce.number().int().positive();

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; '));
  return r.data;
}

async function priceSummary(db: pg.Pool, wineId: number) {
  const { rows } = await db.query(
    `SELECT vintage_key, median_cents, p10_cents, p90_cents, n_observations, n_merchants, window_days, latest_observed_at
       FROM wine_prices WHERE wine_id = $1 ORDER BY vintage_key = '*' DESC, vintage_key DESC`,
    [wineId]
  );
  return rows;
}

export function createApp({ db, provider, fetcher }: AppDeps) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, provider: provider.name });
  });

  // ── Label scans ──────────────────────────────────────────────────────────
  app.post('/api/scans', upload.single('image'), wrap(async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'multipart field "image" is required');
    if (!IMAGE_TYPES.has(file.mimetype)) throw new HttpError(415, `unsupported image type ${file.mimetype}`);
    res.status(201).json(await scanLabel(db, provider, file.buffer, file.mimetype));
  }));

  app.post('/api/scans/:id/confirm', wrap(async (req, res) => {
    const scanId = parse(idParam, req.params.id);
    const body = parse(
      z.union([
        z.object({ wineId: z.number().int().positive() }),
        z.object({
          newWine: z.object({
            producer: z.string().max(120).default(''),
            name: z.string().max(160).default(''),
            country: z.string().max(60).optional(),
            region: z.string().max(80).optional(),
            grape: z.string().max(80).optional(),
            colour: z.string().max(10).optional(),
          }),
        }),
      ]),
      req.body
    );
    const wineId = await confirmScan(db, scanId, body);
    res.json({ wineId, wine: await getWine(db, wineId) });
  }));

  // ── Catalog ──────────────────────────────────────────────────────────────
  app.get('/api/wines/search', wrap(async (req, res) => {
    const q = parse(z.string().trim().min(2).max(200), req.query.q);
    const r = await matchWine(db, { text: q });
    res.json({
      results: r.candidates.slice(0, 10).map((c) => ({ wineId: c.wine.wine_id, displayName: c.wine.display_name, region: c.wine.region, country: c.wine.country, score: Number(c.score.toFixed(3)) })),
    });
  }));

  app.post('/api/wines', wrap(async (req, res) => {
    const w = parse(
      z.object({
        producer: z.string().max(120).default(''),
        name: z.string().max(160).default(''),
        country: z.string().max(60).optional(),
        region: z.string().max(80).optional(),
        grape: z.string().max(80).optional(),
        colour: z.string().max(10).optional(),
      }).refine((v) => v.producer.trim() || v.name.trim(), 'producer or name is required'),
      req.body
    );
    const wineId = await createWine(db, { ...w, source: 'user' });
    res.status(201).json(await getWine(db, wineId));
  }));

  app.get('/api/wines/:id', wrap(async (req, res) => {
    const wineId = parse(idParam, req.params.id);
    const wine = await getWine(db, wineId);
    if (!wine) throw new HttpError(404, 'wine not found');
    res.json({ wine, prices: await priceSummary(db, wineId) });
  }));

  // ── Prices ───────────────────────────────────────────────────────────────
  app.get('/api/wines/:id/prices', wrap(async (req, res) => {
    const wineId = parse(idParam, req.params.id);
    const vintage = parse(vintageSchema, req.query.vintage ?? null) ?? null;
    if (!(await getWine(db, wineId))) throw new HttpError(404, 'wine not found');
    const key = vintage ?? '*';
    const [history, offers] = await Promise.all([
      db.query(`SELECT day, median_cents, n FROM wine_price_daily WHERE wine_id = $1 AND vintage_key = $2 ORDER BY day`, [wineId, key]),
      db.query(
        `SELECT DISTINCT ON (COALESCE(o.listing_id::text, o.url)) o.vintage_key, o.bottle_ml, o.pack_size, o.price_cents,
                o.unit_750_cents, o.in_stock, o.source_type, o.confidence, o.url, o.observed_at, m.name AS merchant
           FROM price_observations o LEFT JOIN merchants m USING (merchant_id)
          WHERE o.wine_id = $1 AND ($2::text IS NULL OR o.vintage_key = $2) AND o.source_type <> 'user'
            AND o.observed_at > NOW() - INTERVAL '90 days'
          ORDER BY COALESCE(o.listing_id::text, o.url), o.observed_at DESC`,
        [wineId, vintage]
      ),
    ]);
    const summary = (await priceSummary(db, wineId)).find((p) => p.vintage_key === key) ?? null;
    res.json({
      summary,
      history: history.rows,
      offers: offers.rows.sort((a, b) => a.unit_750_cents - b.unit_750_cents).slice(0, 50),
    });
  }));

  app.post('/api/wines/:id/prices/refresh', wrap(async (req, res) => {
    const wineId = parse(idParam, req.params.id);
    const { vintage } = parse(z.object({ vintage: vintageSchema }), req.body ?? {});
    if (!(await getWine(db, wineId))) throw new HttpError(404, 'wine not found');
    const outcome = await refreshPrices(db, fetcher, provider, wineId, vintage ?? null);
    res.json({ outcome, prices: await priceSummary(db, wineId) });
  }));

  // Price paid at tasting (or seen on a shelf/menu) reported by a user.
  app.post('/api/wines/:id/prices/report', wrap(async (req, res) => {
    const wineId = parse(idParam, req.params.id);
    const b = parse(
      z.object({
        price: z.number().positive().max(100000),
        vintage: vintageSchema,
        bottleMl: z.number().int().min(50).max(30000).default(750),
        context: z.enum(['retail', 'restaurant']).default('retail'),
        merchant: z.string().max(120).optional(),
        observedAt: z.coerce.date().optional(),
      }),
      req.body
    );
    if (!(await getWine(db, wineId))) throw new HttpError(404, 'wine not found');
    const cents = Math.round(b.price * 100);
    const { rows } = await db.query(
      `INSERT INTO price_observations (wine_id, vintage_key, bottle_ml, price_cents, unit_750_cents, context, source_type, url, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'user', $7, COALESCE($8, NOW())) RETURNING observation_id`,
      [wineId, b.vintage ?? null, b.bottleMl, cents, per750(cents, b.bottleMl, 1), b.context, b.merchant ?? '', b.observedAt ?? null]
    );
    await aggregateWines(db, [wineId]);
    res.status(201).json({ observationId: rows[0].observation_id });
  }));

  // ── Errors ───────────────────────────────────────────────────────────────
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError || err instanceof ScanError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof ProviderUnavailableError) return void res.status(503).json({ error: 'label reading is not configured (no LLM provider)' });
    if (err instanceof multer.MulterError) return void res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });
  return app;
}
