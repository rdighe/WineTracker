/**
 * REST API. User-specific routes (tastings, saved wines, recommendations)
 * require a Supabase access token (see src/auth/auth.ts); catalog and price
 * routes are public reads. Scans attach to the user when one is signed in.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
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
import { createAuthenticator, type AuthOptions } from '../auth/auth.js';
import { createTasting, deleteTasting, listTastings, updateTasting } from '../tastings/tastings.js';
import { maybeQueueWineImage } from '../catalog/images.js';
import { importVivino } from '../imports/vivino.js';
import { recommend } from '../recs/recommend.js';

export interface AppDeps {
  db: pg.Pool;
  provider: LlmProvider;
  fetcher: PoliteFetcher;
  auth: AuthOptions;
  allowedOrigins?: string[];
  /** Number of proxies in front of the app (Render: 1), so rate limits see the client IP. */
  trustProxy?: number;
  /** Override limits (tests). */
  limits?: { scansPerHour?: number; refreshesPerHour?: number; requestsPer15Min?: number };
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

const tastingBody = z.object({
  vintage: vintageSchema,
  rating: z.number().min(0.5).max(5).multipleOf(0.5).nullable().optional(),
  notes: z.string().max(4000).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  pricePaid: z.number().positive().max(100000).nullable().optional(),
  priceContext: z.enum(['retail', 'restaurant']).nullable().optional(),
  bottleMl: z.number().int().min(50).max(30000).optional(),
  location: z.string().max(200).optional(),
  tastedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kind: z.enum(['tasted', 'cellar']).optional(),
  bottles: z.number().int().min(1).max(9999).nullable().optional(),
});

export function createApp({ db, provider, fetcher, auth: authOptions, allowedOrigins = [], trustProxy = 0, limits = {} }: AppDeps) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(helmet());
  // CORS for listed browser origins only (native apps send no Origin).
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') return void res.status(204).end();
    }
    next();
  });
  const auth = createAuthenticator(db, authOptions);

  // Rate limits: a general one per IP, and tighter per-user limits on the two
  // routes that cost money (vision model / web search).
  const limiter = (windowMs: number, limit: number) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => (req.user ? `u:${req.user.userId}` : ipKeyGenerator(req.ip ?? '')),
      message: { error: 'too many requests; try again later' },
    });
  app.use('/api', limiter(15 * 60_000, limits.requestsPer15Min ?? 900));
  const scanLimit = limiter(60 * 60_000, limits.scansPerHour ?? 30);
  const refreshLimit = limiter(60 * 60_000, limits.refreshesPerHour ?? 30);
  // Scans may carry a base64 photo in JSON (React Native's fetch can't always
  // send a file part), so that one route gets a larger body limit.
  const smallJson = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.path === '/api/scans' || req.path === '/api/import/vivino' ? next() : smallJson(req, res, next)));
  const scanJson = express.json({ limit: '12mb' });
  const importJson = express.json({ limit: '8mb' });
  const importLimit = limiter(60 * 60_000, 20);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, provider: provider.name });
  });

  // ── Label scans ──────────────────────────────────────────────────────────
  // The photo comes as multipart field "image", or as JSON {imageBase64, mimeType}; optional "ocrText".
  app.post('/api/scans', auth.optionalUser, scanLimit, scanJson, upload.single('image'), wrap(async (req, res) => {
    let file: { buffer: Buffer; mimetype: string } | undefined = req.file;
    if (!file && typeof req.body?.imageBase64 === 'string') {
      const m = /^data:([^;,]+);base64,/.exec(req.body.imageBase64);
      const buffer = Buffer.from(m ? req.body.imageBase64.slice(m[0].length) : req.body.imageBase64, 'base64');
      if (buffer.length > 8 * 1024 * 1024) throw new HttpError(413, 'image larger than 8 MB');
      if (buffer.length) file = { buffer, mimetype: String(req.body.mimeType ?? m?.[1] ?? 'image/jpeg') };
    }
    if (!file) throw new HttpError(400, 'an image is required (multipart field "image" or JSON "imageBase64")');
    if (!IMAGE_TYPES.has(file.mimetype)) throw new HttpError(415, `unsupported image type ${file.mimetype}`);
    // Text the phone's OCR read off the label: lets the server identify the wine without the LLM.
    const ocrText = typeof req.body?.ocrText === 'string' ? req.body.ocrText : undefined;
    const result = await scanLabel(db, provider, file.buffer, file.mimetype, { ocrText });
    if (req.user) await db.query('UPDATE scans SET user_id = $1 WHERE scan_id = $2', [req.user.userId, result.scanId]);
    res.status(201).json(result);
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
    const top = r.candidates.slice(0, 20);
    const { rows } = await db.query(
      `SELECT wine_id, n_merchants FROM wine_prices WHERE vintage_key = '*' AND wine_id = ANY($1)`,
      [top.map((c) => c.wine.wine_id)]
    );
    const shops = new Map<number, number>(rows.map((x) => [x.wine_id, x.n_merchants]));
    // Near-equal matches: prefer the entry that has a current price.
    top.sort((a, b) => Math.round((b.score - a.score) * 20) || (shops.get(b.wine.wine_id) ?? 0) - (shops.get(a.wine.wine_id) ?? 0));
    res.json({
      results: top.slice(0, 10).map((c) => ({
        wineId: c.wine.wine_id, displayName: c.wine.display_name, region: c.wine.region, country: c.wine.country,
        score: Number(c.score.toFixed(3)), shops: shops.get(c.wine.wine_id) ?? 0,
      })),
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
    maybeQueueWineImage(db, wine);
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

  app.post('/api/wines/:id/prices/refresh', auth.optionalUser, refreshLimit, wrap(async (req, res) => {
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
    res.status(201).json({ observationId: rows[0].observation_id });
  }));

  // ── Me ───────────────────────────────────────────────────────────────────
  app.get('/api/me', auth.requireUser, wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT u.user_id, u.email, u.display_name, u.created_at,
              (SELECT COUNT(*)::int FROM tastings t WHERE t.user_id = u.user_id) AS tastings,
              (SELECT COUNT(*)::int FROM saved_wines s WHERE s.user_id = u.user_id) AS saved
         FROM users u WHERE u.user_id = $1`,
      [req.user!.userId]
    );
    res.json(rows[0]);
  }));

  // ── Tastings ─────────────────────────────────────────────────────────────
  app.get('/api/tastings', auth.requireUser, wrap(async (req, res) => {
    const limit = parse(z.coerce.number().int().min(1).max(200).default(50), req.query.limit ?? undefined);
    const before = req.query.before === undefined ? undefined : parse(idParam, req.query.before);
    res.json({ tastings: await listTastings(db, req.user!.userId, { limit, before }) });
  }));

  app.post('/api/tastings', auth.requireUser, wrap(async (req, res) => {
    const b = parse(tastingBody.extend({ wineId: z.number().int().positive(), scanId: z.number().int().positive().optional() }), req.body);
    const wine = await getWine(db, b.wineId);
    if (!wine) throw new HttpError(404, 'wine not found');
    if (b.scanId) {
      const { rows } = await db.query('SELECT user_id FROM scans WHERE scan_id = $1', [b.scanId]);
      if (!rows[0] || (rows[0].user_id !== null && rows[0].user_id !== req.user!.userId)) throw new HttpError(404, 'scan not found');
    }
    // The price paid is stored as a 'user' observation, which never moves the
    // market price, so there is nothing to re-aggregate.
    const tastingId = await createTasting(db, req.user!.userId, b);
    maybeQueueWineImage(db, wine, b.vintage);
    res.status(201).json({ tastingId });
  }));

  app.patch('/api/tastings/:id', auth.requireUser, wrap(async (req, res) => {
    const id = parse(idParam, req.params.id);
    const b = parse(tastingBody.partial(), req.body);
    if (!(await updateTasting(db, req.user!.userId, id, b))) throw new HttpError(404, 'tasting not found');
    res.json({ ok: true });
  }));

  app.delete('/api/tastings/:id', auth.requireUser, wrap(async (req, res) => {
    const id = parse(idParam, req.params.id);
    if (!(await deleteTasting(db, req.user!.userId, id))) throw new HttpError(404, 'tasting not found');
    res.status(204).end();
  }));

  // ── Imports ──────────────────────────────────────────────────────────────
  app.post('/api/import/vivino', auth.requireUser, importLimit, importJson, wrap(async (req, res) => {
    const { csv } = parse(z.object({ csv: z.string().min(1).max(8_000_000) }), req.body);
    const summary = await importVivino(db, req.user!.userId, csv);
    if (summary.missingColumns.includes('producer') && summary.missingColumns.includes('name')) {
      throw new HttpError(400, "This doesn't look like a Vivino wine list: no Winery or Wine name column.");
    }
    res.json(summary);
  }));

  // ── Saved wines (want to try / watch the price) ──────────────────────────
  app.get('/api/saved', auth.requireUser, wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT s.wine_id, s.vintage_key, w.display_name, w.region, w.country, p.median_cents, p.n_merchants, s.created_at
         FROM saved_wines s JOIN wines w USING (wine_id)
         LEFT JOIN wine_prices p ON p.wine_id = s.wine_id AND p.vintage_key = s.vintage_key AND p.currency = 'USD'
        WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
      [req.user!.userId]
    );
    res.json({ saved: rows });
  }));

  app.put('/api/saved/:wineId', auth.requireUser, wrap(async (req, res) => {
    const wineId = parse(idParam, req.params.wineId);
    const { vintage } = parse(z.object({ vintage: vintageSchema }), req.body ?? {});
    if (!(await getWine(db, wineId))) throw new HttpError(404, 'wine not found');
    await db.query(`INSERT INTO saved_wines (user_id, wine_id, vintage_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
      req.user!.userId, wineId, vintage ?? '*',
    ]);
    res.status(204).end();
  }));

  app.delete('/api/saved/:wineId', auth.requireUser, wrap(async (req, res) => {
    const wineId = parse(idParam, req.params.wineId);
    await db.query('DELETE FROM saved_wines WHERE user_id = $1 AND wine_id = $2', [req.user!.userId, wineId]);
    res.status(204).end();
  }));

  // ── Recommendations ──────────────────────────────────────────────────────
  app.get('/api/recommendations', auth.requireUser, wrap(async (req, res) => {
    const q = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).optional(),
        colour: z.enum(['red', 'white', 'rose']).optional(),
        maxPrice: z.coerce.number().positive().max(100000).optional(),
        bestValue: z.enum(['true', 'false']).optional(),
      }),
      req.query
    );
    res.json(
      await recommend(db, req.user!.userId, {
        limit: q.limit,
        colour: q.colour,
        maxPriceCents: q.maxPrice ? Math.round(q.maxPrice * 100) : undefined,
        bestValue: q.bestValue === 'true',
      })
    );
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
