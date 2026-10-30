/**
 * REST API. User-specific routes (tastings, saved wines, recommendations)
 * require a signed-in user (see src/auth/auth.ts; Google sign-in in src/auth/google.ts, Apple in src/auth/apple.ts); catalog and price
 * routes are public reads. Scans attach to the user when one is signed in.
 */
import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import type pg from 'pg';
import { createWine, getWine } from '../catalog/wines.js';
import { matchWine } from '../match/matcher.js';
import { per750 } from '../lib/listing.js';
import { ProviderUnavailableError, type LlmProvider } from '../llm/types.js';
import { createJev, createNoteProvider, createPickReaders } from '../llm/index.js';
import { jevNoteReader } from '../llm/jev.js';
import { MAX_LIST_CHARS, MAX_LIST_ENTRIES } from '../llm/prompts.js';
import {
  deletePick, inputSha, listRecentPicks, listSavedPicks, newMatchTimes, type PickJev, MAX_PICK_PHOTO_BYTES, MAX_PICK_PHOTOS, openPick, pickPhoto, pickWines, readListPages, readShelfPhoto, savePick, setPickPhotos, startMatching,
} from '../picks/picks.js';
import { FLAVOR_KEYS } from '../recs/flavors.js';
import { createNoteFlavorReader, type NoteFlavorReader } from '../tastings/noteFlavors.js';
import { confirmScan, scanLabel, scanLineup, ScanError } from '../scan/scan.js';
import { createInfoResearcher, getWineInfo, type InfoResearcher } from '../catalog/info.js';
import type { PoliteFetcher } from '../prices/fetcher.js';
import { refreshPrices } from '../prices/refresh.js';
import { aggregateWines } from '../prices/aggregate.js';
import { createAuthenticator, type AuthOptions } from '../auth/auth.js';
import { appleRoutes, type AppleOptions } from '../auth/apple.js';
import { googleRoutes, type GoogleOptions } from '../auth/google.js';
import { createTasting, deleteTasting, listTastings, removeFromCellar, updateTasting } from '../tastings/tastings.js';
import { maybeQueueWineImage } from '../catalog/images.js';
import { getPhoto } from '../catalog/photos.js';
import { importVivino } from '../imports/vivino.js';
import { CellarTrackerError, CT_PARTS, detectPart, fetchCellarTracker, importCellarTracker, type CtPart } from '../imports/cellartracker.js';
import { bestKinds, cellarPicks, recommend } from '../recs/recommend.js';
import { ARCHETYPE_KEYS, ARCHETYPES, loadPrefs, savePrefs, saveTasteEdits } from '../recs/archetypes.js';
import { jevReport } from '../recs/jevLog.js';
import { addFriend, cardByCode, cardCode, friendCard, listFriends, removeFriend, tasteCard, TasteError } from '../recs/tasteCard.js';
import {
  blockAuthor, CommunityError, deleteNote, unblockAll, deleteReply, listNotes, listReplies, MATURITIES, PUBLIC_NAME, REACTIONS, reply, report, setLike, shareNote, updateNote,
} from '../community/community.js';
import {
  acceptInvite, CellarError, createCellar, createInvite, createRack, deleteCellar, deleteRack, listCellars, listRacks, previewInvite, removeMember,
  renameCellar, setMemberRole, setPlaces, updateRack,
} from '../cellars/cellars.js';
import { deleteReceipt, getReceipt, listReceipts, readReceipt, receiptPhoto, saveReceipt, setReceiptPhoto, updateReceipt } from '../cellars/receipts.js';
import { createPlaces, parseNear, type Places } from '../places/places.js';

export interface AppDeps {
  db: pg.Pool;
  provider: LlmProvider;
  fetcher: PoliteFetcher;
  auth: AuthOptions;
  /** Google sign-in; off when absent. allowedOrigins comes from AppDeps. */
  google?: Omit<GoogleOptions, 'allowedOrigins' | 'sessionSecret'>;
  /** Sign in with Apple; off when absent. */
  apple?: Omit<AppleOptions, 'sessionSecret'>;
  allowedOrigins?: string[];
  /** Number of proxies in front of the app (Render: 1), so rate limits see the client IP. */
  trustProxy?: number;
  /** Wine background research (default: one using `provider`); tests pass their own to await it. */
  infoResearcher?: InfoResearcher;
  /** Where shops are and ship (default: researched with `provider`); tests pass their own to await it. */
  places?: Places;
  /** Reads flavors from tasting notes the phone couldn't (default: OpenRouter's free models, when a key is set). */
  noteReader?: NoteFlavorReader;
  /** Jev's uses in picks (default: as JEV_FEATURES says). */
  pickJev?: PickJev;
  /** Whether the server is ready for traffic (health check); always, when absent. */
  isReady?: () => boolean;
  /** The admin report's token (default: ADMIN_TOKEN); the report is off without one. */
  adminToken?: string;
  /** Tests: keep which reader read something, and Jev's scores, in responses. Never in production. */
  exposeInternals?: boolean;
  /** Fetches CellarTracker's export (tests pass a fake). */
  ctFetch?: typeof fetch;
  /** What reads wine lists and shelf photos, in order (default: OpenRouter's free models, then `provider`). */
  pickReaders?: LlmProvider[];
  /** Fetches shop images for /api/photo (tests pass a fake). */
  photoFetch?: typeof fetch;
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

/** A copy without `source` (the reader's name) and `jevScore` fields, at any depth. */
function stripInternals<T>(x: T): T {
  if (Array.isArray(x)) return x.map(stripInternals) as T;
  if (!x || typeof x !== 'object' || Buffer.isBuffer(x)) return x;
  return Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'source' && k !== 'jevScore').map(([k, v]) => [k, stripInternals(v)])) as T;
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
    `SELECT vintage_key, median_cents, p10_cents, p90_cents, n_observations, n_merchants, window_days, latest_observed_at, out_of_stock_only
       FROM wine_prices WHERE wine_id = $1 ORDER BY vintage_key = '*' DESC, vintage_key DESC`,
    [wineId]
  );
  return rows;
}

const tastingBody = z.object({
  vintage: vintageSchema,
  // 0.1 to 5 in tenths (4.3); checked on the tenths, since 0.1 isn't exact in binary.
  rating: z.number().min(0.1).max(5).refine((r) => Math.abs(r * 10 - Math.round(r * 10)) < 1e-6, 'rating: one decimal at most').nullable().optional(),
  notes: z.string().max(4000).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  pricePaid: z.number().positive().max(100000).nullable().optional(),
  priceContext: z.enum(['retail', 'restaurant']).nullable().optional(),
  bottleMl: z.number().int().min(50).max(30000).optional(),
  location: z.string().max(200).optional(),
  setting: z.enum(['home', 'restaurant', 'other']).nullable().optional(),
  tastedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kind: z.enum(['tasted', 'cellar']).optional(),
  bottles: z.number().int().min(1).max(9999).nullable().optional(),
  /** The cellar a cellar entry is (or moves) in; default: the person's first. */
  cellarId: z.number().int().positive().nullable().optional(),
  /** Flavors the phone read from the notes and tags (Apple Intelligence): family -> intensity 1-3. */
  noteFlavors: z.partialRecord(z.enum(FLAVOR_KEYS), z.number().int().min(1).max(3)).nullable().optional(),
  /** The phone will send noteFlavors once it has read the notes: the server needn't. */
  noteFlavorsPending: z.boolean().optional(),
});

export function createApp({ db, provider, fetcher, auth: authOptions, google, apple, allowedOrigins = [], trustProxy = 0, limits = {}, infoResearcher, photoFetch, places: placesDep, noteReader: noteReaderDep, pickReaders: pickReadersDep, isReady, pickJev: pickJevDep, adminToken = config.adminToken, exposeInternals = false, ctFetch = fetch }: AppDeps) {
  /**
   * People never see which model or service read a label, a list or a receipt,
   * nor Jev's scores: `source` and `jevScore` are taken out of what's sent.
   */
  const publicBody = <T>(body: T): T => (exposeInternals ? body : stripInternals(body));
  const research = infoResearcher ?? createInfoResearcher(db, provider);
  const jevFlavors = createJev('flavors');
  const noteReader = noteReaderDep ?? createNoteFlavorReader(db, [jevFlavors && jevNoteReader(jevFlavors), createNoteProvider()]);
  const places = placesDep ?? createPlaces(db, provider);
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
  // A wine's photo, fetched from the shop once and kept (src/catalog/photos.ts). No sign-in: it's
  // only ever a catalog photo, and image views can't send one. Ahead of the request limit: a list of
  // wines asks for a photo per row, and the phone caches them.
  app.get('/api/photo', wrap(async (req, res) => {
    const url = parse(z.string().url().max(2000), req.query.u);
    const photo = await getPhoto(db, url, photoFetch);
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!photo) return void res.status(404).set('Cache-Control', 'public, max-age=3600').end();
    res.set('Content-Type', photo.contentType).set('Cache-Control', 'public, max-age=604800').send(photo.bytes);
  }));

  app.use('/api', limiter(15 * 60_000, limits.requestsPer15Min ?? 900));
  const scanLimit = limiter(60 * 60_000, limits.scansPerHour ?? 30);
  const refreshLimit = limiter(60 * 60_000, limits.refreshesPerHour ?? 30);
  // Scans may carry a base64 photo in JSON (React Native's fetch can't always
  // send a file part), so that one route gets a larger body limit.
  const smallJson = express.json({ limit: '100kb' });
  const bigBody = new Set(['/api/scans', '/api/scans/lineup', '/api/import/vivino', '/api/import/cellartracker', '/api/picks', '/api/receipts', '/api/receipts/read']);
  app.use((req, res, next) => (bigBody.has(req.path) || /^\/api\/(picks\/\d+\/photos|receipts\/\d+\/photo)$/.test(req.path) ? next() : smallJson(req, res, next)));
  const scanJson = express.json({ limit: '12mb' });
  const importJson = express.json({ limit: '8mb' });
  const importLimit = limiter(60 * 60_000, 20);

  // Sign-in methods this server offers, so the app shows the right sign-in screen.
  const signIn = [
    ...(google && authOptions.sessionSecret ? ['google'] : []),
    ...(apple && authOptions.sessionSecret ? ['apple'] : []),
    ...(authOptions.allowDev ? ['dev'] : []),
  ];
  // Not ready (503) until the server says so: Render keeps sending traffic to the old instance meanwhile.
  app.get('/api/health', (_req, res) => {
    if (isReady && !isReady()) return res.status(503).json({ ok: false, starting: true });
    // Whether labels can be read by a model here; never which one.
    res.json({ ok: true, reads: provider.name !== 'none', signIn });
  });

  if (google && authOptions.sessionSecret) {
    app.use('/api/auth/google', googleRoutes({ ...google, allowedOrigins, sessionSecret: authOptions.sessionSecret }, auth.userFor));
  }
  if (apple && authOptions.sessionSecret) {
    app.use('/api/auth/apple', appleRoutes({ ...apple, sessionSecret: authOptions.sessionSecret }, auth.userFor));
  }

  // ── Label scans ──────────────────────────────────────────────────────────
  // The photo comes as multipart field "image", or as JSON {imageBase64, mimeType}; optional "ocrText".
  // The photo comes as multipart field "image", or as JSON {imageBase64, mimeType}.
  function photo(req: Request): { buffer: Buffer; mimetype: string } {
    let file: { buffer: Buffer; mimetype: string } | undefined = req.file;
    if (!file && typeof req.body?.imageBase64 === 'string') {
      const m = /^data:([^;,]+);base64,/.exec(req.body.imageBase64);
      const buffer = Buffer.from(m ? req.body.imageBase64.slice(m[0].length) : req.body.imageBase64, 'base64');
      if (buffer.length > 8 * 1024 * 1024) throw new HttpError(413, 'image larger than 8 MB');
      if (buffer.length) file = { buffer, mimetype: String(req.body.mimeType ?? m?.[1] ?? 'image/jpeg') };
    }
    if (!file) throw new HttpError(400, 'an image is required (multipart field "image" or JSON "imageBase64")');
    if (!IMAGE_TYPES.has(file.mimetype)) throw new HttpError(415, `unsupported image type ${file.mimetype}`);
    return file;
  }

  /**
   * A scan tagged by the app with its own id ("ref"): the outcome is kept in
   * scan_jobs, so if the app was switched away and never got the answer, it
   * collects it from GET /api/scans/jobs/:ref. The same ref sent twice (an
   * upload retried by the phone) runs once. Without a ref, a plain request.
   */
  async function scanJob(req: Request, kind: 'single' | 'lineup', run: () => Promise<unknown>): Promise<unknown> {
    const ref = typeof req.body?.ref === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(req.body.ref) ? req.body.ref : null;
    if (!ref) return run();
    // Outcomes are only needed until the app has collected them; a week is plenty.
    await db.query(`DELETE FROM scan_jobs WHERE created_at < NOW() - INTERVAL '7 days'`);
    const { rows: [claimed] } = await db.query(
      `INSERT INTO scan_jobs (ref, user_id, kind) VALUES ($1, $2, $3) ON CONFLICT (ref) DO NOTHING RETURNING ref`,
      [ref, req.user?.userId ?? null, kind]
    );
    if (!claimed) {
      // Already running or finished: answer with what it came to (the app polls while it's pending).
      const { rows: [job] } = await db.query('SELECT status, result, error, http_status FROM scan_jobs WHERE ref = $1', [ref]);
      if (job?.status === 'done') return job.result;
      if (job?.status === 'failed') throw new HttpError(job.http_status ?? 500, job.error ?? 'scan failed');
      throw new HttpError(409, 'this scan is still being read');
    }
    try {
      const result = await run();
      await db.query(`UPDATE scan_jobs SET status = 'done', result = $2, updated_at = NOW() WHERE ref = $1`, [ref, JSON.stringify(result)]);
      return result;
    } catch (e) {
      const status = e instanceof HttpError || e instanceof ScanError ? e.status : e instanceof ProviderUnavailableError ? 503 : 500;
      const message = status === 500 ? 'internal error' : (e as Error).message;
      await db.query(`UPDATE scan_jobs SET status = 'failed', error = $2, http_status = $3, updated_at = NOW() WHERE ref = $1`, [ref, message, status]);
      throw e;
    }
  }

  /**
   * Start `run` as a job the app collects later (GET /api/scans/jobs/:ref)
   * and answer at once, so nothing is lost when the app goes to the
   * background or the connection drops while a wine list is read. The same
   * ref sent again doesn't start it twice. Returns the job as it stands.
   */
  async function startJob(ref: string, userId: number, kind: 'picks' | 'import', run: () => Promise<unknown>) {
    await db.query(`DELETE FROM scan_jobs WHERE created_at < NOW() - INTERVAL '7 days'`);
    const { rows: [claimed] } = await db.query(
      `INSERT INTO scan_jobs (ref, user_id, kind) VALUES ($1, $2, $3) ON CONFLICT (ref) DO NOTHING RETURNING ref`,
      [ref, userId, kind]
    );
    if (claimed) {
      void run().then(
        (result) => db.query(`UPDATE scan_jobs SET status = 'done', result = $2, updated_at = NOW() WHERE ref = $1`, [ref, JSON.stringify(result)]),
        (e) => {
          const status = e instanceof HttpError || e instanceof CellarTrackerError || e instanceof CellarError || e instanceof CommunityError ? e.status : e instanceof ProviderUnavailableError ? 503 : 500;
          if (status === 500) console.error(`job ${ref}:`, e);
          return db.query(`UPDATE scan_jobs SET status = 'failed', error = $2, http_status = $3, updated_at = NOW() WHERE ref = $1`, [ref, status === 500 ? 'internal error' : (e as Error).message, status]);
        }
      ).catch((e) => console.error(`job ${ref}: could not record the outcome:`, e));
    }
    const { rows: [job] } = await db.query('SELECT user_id, status, result, error, http_status FROM scan_jobs WHERE ref = $1', [ref]);
    if (Number(job.user_id) !== userId) throw new HttpError(409, 'ref in use');
    return { ref, status: job.status as string, result: job.result ?? undefined, error: job.error ?? undefined, httpStatus: job.http_status ?? undefined };
  }

  // Optional "ocrText": label text read on the phone. Optional "ref": see scanJob.
  app.post('/api/scans', auth.optionalUser, scanLimit, scanJson, upload.single('image'), wrap(async (req, res) => {
    const file = photo(req);
    // Text the phone's OCR read off the label: lets the server identify the wine without the LLM.
    const ocrText = typeof req.body?.ocrText === 'string' ? req.body.ocrText : undefined;
    const result = await scanJob(req, 'single', async () => {
      const r = await scanLabel(db, provider, file.buffer, file.mimetype, { ocrText });
      if (req.user) await db.query('UPDATE scans SET user_id = $1 WHERE scan_id = $2', [req.user.userId, r.scanId]);
      return r;
    });
    res.status(201).json(publicBody(result));
  }));

  // A photo of several bottles: one scan per label read, left to right.
  app.post('/api/scans/lineup', auth.optionalUser, scanLimit, scanJson, upload.single('image'), wrap(async (req, res) => {
    const file = photo(req);
    const result = await scanJob(req, 'lineup', async () => {
      const scans = await scanLineup(db, provider, file.buffer, file.mimetype);
      if (req.user && scans.length) await db.query('UPDATE scans SET user_id = $1 WHERE scan_id = ANY($2)', [req.user.userId, scans.map((x) => x.scanId)]);
      return { scans };
    });
    res.status(201).json(publicBody(result));
  }));

  // How a tagged scan came out: pending, done (with the same body the scan request would have answered), or failed.
  app.get('/api/scans/jobs/:ref', auth.optionalUser, wrap(async (req, res) => {
    const ref = parse(z.string().regex(/^[A-Za-z0-9-]{16,64}$/), req.params.ref);
    const { rows: [job] } = await db.query('SELECT user_id, status, result, error, http_status FROM scan_jobs WHERE ref = $1', [ref]);
    // Someone else's scan reads as not found.
    if (!job || (job.user_id !== null && Number(job.user_id) !== req.user?.userId)) throw new HttpError(404, 'scan not found');
    res.json({ status: job.status, result: publicBody(job.result ?? undefined), error: job.error ?? undefined, httpStatus: job.http_status ?? undefined });
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

  // Researched background: tasting notes, producer, specs. A signed-in visitor
  // starts the research if it hasn't been done; the app polls while 'pending'.
  app.get('/api/wines/:id/info', auth.optionalUser, wrap(async (req, res) => {
    const wineId = parse(idParam, req.params.id);
    if (!(await getWine(db, wineId))) throw new HttpError(404, 'wine not found');
    if (req.user) await research.request(wineId);
    const found = await getWineInfo(db, wineId);
    // Earlier research keeps showing while it's redone (refreshing) or if redoing it failed.
    res.json({
      status: found?.status ?? (research.available ? 'none' : 'unavailable'),
      info: found?.info ?? null,
      refreshing: found?.status === 'pending' && Boolean(found.info),
    });
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
                o.unit_750_cents, o.in_stock, o.source_type, o.confidence, o.url, o.observed_at, m.name AS merchant, o.merchant_id
           FROM price_observations o LEFT JOIN merchants m USING (merchant_id)
          WHERE o.wine_id = $1 AND ($2::text IS NULL OR o.vintage_key = $2) AND o.source_type <> 'user'
            AND o.observed_at > NOW() - INTERVAL '90 days'
          ORDER BY COALESCE(o.listing_id::text, o.url), o.observed_at DESC`,
        [wineId, vintage]
      ),
    ]);
    const summary = (await priceSummary(db, wineId)).find((p) => p.vintage_key === key) ?? null;
    let list = offers.rows.sort((a, b) => a.unit_750_cents - b.unit_750_cents).slice(0, 50);
    // near=lat,lng,ST: each offer says whether the shop is close by or ships there; those come first.
    const near = parseNear(req.query.near);
    let nearResult: { applied: boolean; state: string; pending: number } | undefined;
    if (near) {
      const ids = list.map((o) => Number(o.merchant_id)).filter(Boolean);
      void places.request(ids).catch(() => {});
      const { reach, pending } = await places.reach(ids, near);
      list = list.map((o) => {
        const r = reach.get(Number(o.merchant_id));
        return { ...o, nearby: r ? { local: r.local, miles: r.miles, city: r.city, ships: r.ships } : null };
      });
      const rank = (o: { nearby: { local: boolean; miles: number | null } | null }) => (!o.nearby ? 2 : o.nearby.local ? 0 : 1);
      list.sort((a, b) => rank(a) - rank(b) || (a.nearby?.miles ?? 0) - (b.nearby?.miles ?? 0) || a.unit_750_cents - b.unit_750_cents);
      nearResult = { applied: list.some((o) => o.nearby), state: near.state, pending };
    }
    res.json({
      summary,
      history: history.rows,
      offers: list.map(({ merchant_id: _m, ...o }) => o),
      ...(nearResult ? { near: nearResult } : {}),
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
      `SELECT u.user_id, u.email, u.display_name, u.public_name, ${PUBLIC_NAME} AS shown_as, u.pick_history_days, u.created_at,
              (SELECT COUNT(*)::int FROM tastings t WHERE t.user_id = u.user_id) AS tastings,
              (SELECT COUNT(*)::int FROM saved_wines s WHERE s.user_id = u.user_id) AS saved
         FROM users u WHERE u.user_id = $1`,
      [req.user!.userId]
    );
    res.json(rows[0]);
  }));

  // The name shown with community notes and on a shared taste card (never the email).
  // pickHistoryDays: how long wine lists and shelves not saved are kept (0: not at all).
  app.patch('/api/me', auth.requireUser, wrap(async (req, res) => {
    const b = parse(z.object({ publicName: z.string().trim().max(40).optional(), pickHistoryDays: z.number().int().min(0).max(365).optional() }), req.body);
    await db.query(
      'UPDATE users SET public_name = COALESCE($2, public_name), pick_history_days = COALESCE($3, pick_history_days) WHERE user_id = $1',
      [req.user!.userId, b.publicName ?? null, b.pickHistoryDays ?? null]
    );
    res.json({ ok: true });
  }));

  // ── Community notes: shared views on wines, no scores ───────────────────
  const noteBody = z.object({
    reaction: z.enum(REACTIONS),
    maturity: z.enum(MATURITIES).nullable().optional(),
    body: z.string().max(1500).optional(),
  });
  app.get('/api/community', auth.requireUser, wrap(async (req, res) => {
    const q = parse(z.object({
      wineId: z.coerce.number().int().positive().optional(),
      mine: z.enum(['true', 'false']).optional(),
      before: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }), req.query);
    res.json({ notes: await listNotes(db, req.user!.userId, { wineId: q.wineId, mine: q.mine === 'true', before: q.before, limit: q.limit }) });
  }));

  app.get('/api/community/:id', auth.requireUser, wrap(async (req, res) => {
    const noteId = parse(idParam, req.params.id);
    const [note] = await listNotes(db, req.user!.userId, { noteId, limit: 1 });
    if (!note) throw new HttpError(404, 'note not found');
    res.json({ note, replies: await listReplies(db, req.user!.userId, noteId) });
  }));

  app.post('/api/community', auth.requireUser, wrap(async (req, res) => {
    const b = parse(noteBody.extend({ wineId: z.number().int().positive().optional(), vintage: vintageSchema, tastingId: z.number().int().positive().optional() })
      .refine((x) => x.wineId || x.tastingId, 'wineId or tastingId required'), req.body);
    res.status(201).json({ noteId: await shareNote(db, req.user!.userId, { ...b, wineId: b.wineId ?? 0 }) });
  }));

  app.patch('/api/community/:id', auth.requireUser, wrap(async (req, res) => {
    await updateNote(db, req.user!.userId, parse(idParam, req.params.id), parse(noteBody.partial(), req.body));
    res.json({ ok: true });
  }));

  app.delete('/api/community/:id', auth.requireUser, wrap(async (req, res) => {
    await deleteNote(db, req.user!.userId, parse(idParam, req.params.id));
    res.status(204).end();
  }));

  app.put('/api/community/:id/like', auth.requireUser, wrap(async (req, res) => {
    await setLike(db, req.user!.userId, parse(idParam, req.params.id), true);
    res.status(204).end();
  }));

  app.delete('/api/community/:id/like', auth.requireUser, wrap(async (req, res) => {
    await setLike(db, req.user!.userId, parse(idParam, req.params.id), false);
    res.status(204).end();
  }));

  app.post('/api/community/:id/replies', auth.requireUser, wrap(async (req, res) => {
    const { body } = parse(z.object({ body: z.string().max(600) }), req.body);
    res.status(201).json({ replyId: await reply(db, req.user!.userId, parse(idParam, req.params.id), body) });
  }));

  app.delete('/api/community/replies/:id', auth.requireUser, wrap(async (req, res) => {
    await deleteReply(db, req.user!.userId, parse(idParam, req.params.id));
    res.status(204).end();
  }));

  app.post('/api/community/:id/report', auth.requireUser, wrap(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().max(200).default('') }), req.body ?? {});
    await report(db, req.user!.userId, { noteId: parse(idParam, req.params.id) }, reason);
    res.status(204).end();
  }));

  // Block whoever wrote a note or reply: nothing of theirs shows for you again.
  app.post('/api/community/:id/block', auth.requireUser, wrap(async (req, res) => {
    await blockAuthor(db, req.user!.userId, { noteId: parse(idParam, req.params.id) });
    res.status(204).end();
  }));

  app.post('/api/community/replies/:id/block', auth.requireUser, wrap(async (req, res) => {
    await blockAuthor(db, req.user!.userId, { replyId: parse(idParam, req.params.id) });
    res.status(204).end();
  }));

  app.delete('/api/community-blocks', auth.requireUser, wrap(async (req, res) => {
    res.json({ unblocked: await unblockAll(db, req.user!.userId) });
  }));

  app.post('/api/community/replies/:id/report', auth.requireUser, wrap(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().max(200).default('') }), req.body ?? {});
    await report(db, req.user!.userId, { replyId: parse(idParam, req.params.id) }, reason);
    res.status(204).end();
  }));

  // ── Welcome: Vivino import, then the 90-second taste quiz ────────────────
  // Offered once to someone new (done is null and they've logged nothing); Settings can bring it back.
  app.get('/api/onboarding', auth.requireUser, wrap(async (req, res) => {
    const userId = req.user!.userId;
    const [prefs, { rows: [n] }] = await Promise.all([
      loadPrefs(db, userId),
      db.query(`SELECT COUNT(*)::int AS tastings, COUNT(rating)::int AS rated FROM tastings WHERE user_id = $1`, [userId]),
    ]);
    res.json({
      ...prefs,
      tastings: n.tastings,
      rated: n.rated,
      archetypes: ARCHETYPES.map(({ key, title, detail, style }) => ({ key, title, detail, style })),
    });
  }));

  app.put('/api/onboarding', auth.requireUser, wrap(async (req, res) => {
    const b = parse(
      z.object({
        styles: z.array(z.enum(['red', 'white', 'rose', 'sparkling', 'orange', 'sweet'])).max(6).optional(),
        budget: z.enum(['under20', '20to40', '40to80', 'over80']).nullable().optional(),
        seeds: z.partialRecord(z.enum(ARCHETYPE_KEYS), z.enum(['love', 'fine', 'dislike', 'unknown'])).optional(),
        done: z.boolean().optional(),
        skipped: z.boolean().optional(),
      }),
      req.body
    );
    await savePrefs(db, req.user!.userId, b);
    res.json(await loadPrefs(db, req.user!.userId));
  }));

  // ── Your taste: the card, editing it, sharing it with friends ────────────
  app.get('/api/taste', auth.requireUser, wrap(async (req, res) => {
    res.json(await tasteCard(db, req.user!.userId));
  }));

  app.put('/api/taste', auth.requireUser, wrap(async (req, res) => {
    const b = parse(z.object({
      likedFlavors: z.array(z.enum(FLAVOR_KEYS)).max(20).optional(),
      dislikedFlavors: z.array(z.enum(FLAVOR_KEYS)).max(20).optional(),
      avoid: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      styles: z.array(z.enum(['red', 'white', 'rose', 'sparkling', 'orange', 'sweet'])).max(6).optional(),
      budget: z.enum(['under20', '20to40', '40to80', 'over80']).nullable().optional(),
      budgetFixed: z.boolean().optional(),
    }), req.body);
    await saveTasteEdits(db, req.user!.userId, b);
    res.json(await tasteCard(db, req.user!.userId));
  }));

  // The card's link (renew: a new one, so the old link stops working).
  app.post('/api/taste/link', auth.requireUser, wrap(async (req, res) => {
    const { renew } = parse(z.object({ renew: z.boolean().default(false) }), req.body ?? {});
    res.json({ code: await cardCode(db, req.user!.userId, renew) });
  }));

  const cardCodeParam = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/);
  app.get('/api/taste/cards/:code', auth.requireUser, wrap(async (req, res) => {
    res.json(await cardByCode(db, req.user!.userId, parse(cardCodeParam, req.params.code)));
  }));

  app.post('/api/taste/cards/:code/friend', auth.requireUser, wrap(async (req, res) => {
    res.json({ userId: await addFriend(db, req.user!.userId, parse(cardCodeParam, req.params.code)) });
  }));

  app.get('/api/taste/friends', auth.requireUser, wrap(async (req, res) => {
    res.json({ friends: await listFriends(db, req.user!.userId) });
  }));

  app.get('/api/taste/friends/:id', auth.requireUser, wrap(async (req, res) => {
    res.json(await friendCard(db, req.user!.userId, parse(idParam, req.params.id)));
  }));

  app.delete('/api/taste/friends/:id', auth.requireUser, wrap(async (req, res) => {
    await removeFriend(db, req.user!.userId, parse(idParam, req.params.id));
    res.status(204).end();
  }));

  // ── Tastings ─────────────────────────────────────────────────────────────
  app.get('/api/tastings', auth.requireUser, wrap(async (req, res) => {
    const limit = parse(z.coerce.number().int().min(1).max(1000).default(50), req.query.limit ?? undefined);
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
    // Notes the phone didn't read: read them on the server.
    if (tastingId && !b.noteFlavors && !b.noteFlavorsPending) void noteReader.request([tastingId]).catch(() => {});
    maybeQueueWineImage(db, wine, b.vintage);
    void research.request(wine.wine_id).catch((err) => console.error('wine info request failed:', err));
    res.status(201).json({ tastingId });
  }));

  app.patch('/api/tastings/:id', auth.requireUser, wrap(async (req, res) => {
    const id = parse(idParam, req.params.id);
    // wineId: move the entry to another wine (it was matched to the wrong one).
    const b = parse(tastingBody.partial().extend({ wineId: z.number().int().positive().optional() }), req.body);
    if (b.wineId && !(await getWine(db, b.wineId))) throw new HttpError(404, 'wine not found');
    if (!(await updateTasting(db, req.user!.userId, id, b))) throw new HttpError(404, 'tasting not found');
    if (!b.noteFlavors && !b.noteFlavorsPending) void noteReader.request([id]).catch(() => {});
    res.json({ ok: true });
  }));

  app.delete('/api/tastings/:id', auth.requireUser, wrap(async (req, res) => {
    const id = parse(idParam, req.params.id);
    if (!(await deleteTasting(db, req.user!.userId, id))) throw new HttpError(404, 'tasting not found');
    res.status(204).end();
  }));

  // Out of the cellar; ratings and notes stay as a tasting.
  app.post('/api/tastings/:id/remove-from-cellar', auth.requireUser, wrap(async (req, res) => {
    const id = parse(idParam, req.params.id);
    const r = await removeFromCellar(db, req.user!.userId, id);
    if (r === null) throw new HttpError(404, 'tasting not found');
    if (r === 'not_cellar') throw new HttpError(400, 'not a cellar entry');
    res.json(r);
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

  // CellarTracker: with the person's handle and password (sent to CellarTracker for this import only, never kept or
  // logged), or CSV files downloaded from it. A job (ref) the app collects, since a big cellar takes a while.
  app.post('/api/import/cellartracker', auth.requireUser, importLimit, importJson, wrap(async (req, res) => {
    const b = parse(
      z.object({
        handle: z.string().trim().max(80).optional(),
        password: z.string().max(200).optional(),
        parts: z.array(z.enum(CT_PARTS)).max(5).default(['collection', 'notes']),
        files: z.array(z.string().max(8_000_000)).max(5).optional(),
        cellarId: z.number().int().positive().nullable().optional(),
        ref: z.string().regex(/^[A-Za-z0-9-]{16,64}$/).optional(),
      }).refine((x) => (x.handle && x.password) || x.files?.length, 'handle and password, or files'),
      req.body
    );
    const userId = req.user!.userId;
    const run = async () => {
      const tables: Partial<Record<CtPart, string>> = {};
      if (b.handle && b.password) {
        for (const part of new Set(b.parts)) tables[part] = await fetchCellarTracker(b.handle, b.password, part, ctFetch);
      }
      for (const csv of b.files ?? []) {
        const part = detectPart(csv);
        if (!part) throw new HttpError(400, "That file doesn't look like a CellarTracker export. Export it as CSV from CellarTracker.");
        tables[part] = csv;
      }
      return importCellarTracker(db, userId, tables, { cellarId: b.cellarId });
    };
    if (b.ref) return res.status(202).json(await startJob(b.ref, userId, 'import', run));
    res.json(await run());
  }));

  // ── Saved wines (want to try / watch the price) ──────────────────────────
  app.get('/api/saved', auth.requireUser, wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT s.wine_id, s.vintage_key, w.display_name, w.producer, w.region, w.sub_region, w.country, w.colour, w.wine_type,
              w.image_url, p.median_cents, p.n_merchants, s.created_at
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

  // ── Picks: a wine list (or shelf) ranked for the person ──────────────────
  const pickReaders = pickReadersDep ?? createPickReaders(provider);
  const pickJev: PickJev = pickJevDep ?? { match: createJev('match'), predict: createJev('predict') };
  const cents = z.number().int().min(1).max(10_000_000).nullable().default(null);
  const listEntry = z.object({
    producer: z.string().max(120).default(''),
    name: z.string().max(160).default(''),
    vintage: z.string().regex(/^(1[89]\d\d|20\d\d|NV)?$/).default(''),
    region: z.string().max(80).default(''),
    country: z.string().max(60).default(''),
    grape: z.string().max(80).default(''),
    colour: z.enum(['red', 'white', 'rose', 'orange', '']).default(''),
    style: z.enum(['still', 'sparkling', 'sweet', 'fortified', '']).default(''),
    section: z.string().max(60).default(''),
    glassCents: cents,
    bottleCents: cents,
    bottleMl: z.number().int().min(50).max(30000).nullable().default(null),
    text: z.string().max(300).default(''),
  });

  // A wine list: each page's text as the phone read it off the photo (pages), read here.
  // A shelf: the photo (imageBase64), with the text the phone read off it as a hint.
  // entries: wines read on the phone by older app versions.
  app.post('/api/picks', auth.requireUser, scanLimit, scanJson, wrap(async (req, res) => {
    const b = parse(
      z.object({
        kind: z.enum(['list', 'shelf']),
        pages: z.array(z.string().max(MAX_LIST_CHARS)).max(MAX_PICK_PHOTOS).optional(),
        entries: z.array(listEntry).max(MAX_LIST_ENTRIES).optional(),
        text: z.string().max(MAX_LIST_CHARS).optional(),
        imageBase64: z.string().max(12_000_000).optional(),
        mimeType: z.string().max(40).optional(),
        ref: z.string().regex(/^[A-Za-z0-9-]{16,64}$/).optional(),
      }).refine((x) => x.pages?.some((p) => p.trim()) || x.entries?.length || x.text?.trim() || x.imageBase64, 'pages, entries, text or imageBase64 required'),
      req.body
    );
    const userId = req.user!.userId;
    // With a ref: a job, answered at once (202) and collected from GET /api/scans/jobs/:ref. Without: answered when done.
    const run = () => pickFromRequest(b, userId);
    if (b.ref) return res.status(202).json(await startJob(b.ref, userId, 'picks', run));
    res.json(publicBody(await run()));
  }));

  async function pickFromRequest(
    b: { kind: 'list' | 'shelf'; pages?: string[]; entries?: z.infer<typeof listEntry>[]; text?: string; imageBase64?: string; mimeType?: string },
    userId: number
  ) {
    if (b.kind === 'shelf' && b.imageBase64) {
      const mimeType = b.mimeType ?? 'image/jpeg';
      if (!IMAGE_TYPES.has(mimeType)) throw new HttpError(400, 'unsupported image type');
      const image = Buffer.from(b.imageBase64.replace(/^data:[^,]*,/, ''), 'base64');
      const read = await readShelfPhoto(db, image, mimeType, b.text, pickReaders).catch((err: unknown) => {
        if (err instanceof ProviderUnavailableError) throw new HttpError(503, err.message);
        console.error('shelf read failed:', err);
        throw new HttpError(502, "Couldn't read the shelf photo. Try again, a little closer.");
      });
      return pickWines(db, userId, 'shelf', read.entries, read.source, read.sha, pickJev);
    }
    const pages = [...(b.pages ?? []), ...(b.text?.trim() ? [b.text] : [])].filter((p) => p.trim());
    const device = (b.entries ?? []).filter((e) => e.producer || e.name);
    // Each part of the list is matched as soon as it is read, while the rest is still being read.
    const times = newMatchTimes();
    const read = pages.length ? await readListPages(db, pages, pickReaders, (part) => startMatching(db, part, pickJev, times)) : null;
    const entries = [...device, ...(read?.entries ?? [])];
    const source = [device.length ? 'apple' : '', read?.source ?? ''].filter(Boolean).join('+');
    return pickWines(db, userId, b.kind, entries, source, inputSha(pages.length ? pages.join('\f') : JSON.stringify(device)), pickJev, times);
  }

  // Saved lists and shelves: name one to keep it; its photos are sent separately.
  // Saved lists, and recent ones not saved (kept pick_history_days, Settings).
  app.get('/api/picks', auth.requireUser, wrap(async (req, res) => {
    const [saved, recent] = await Promise.all([listSavedPicks(db, req.user!.userId), listRecentPicks(db, req.user!.userId)]);
    res.json({ saved, recent: recent.recent, keepDays: recent.days });
  }));

  app.get('/api/picks/:id', auth.requireUser, wrap(async (req, res) => {
    const r = await openPick(db, req.user!.userId, parse(idParam, req.params.id), pickJev);
    if (!r) throw new HttpError(404, 'not found');
    res.json(publicBody(r));
  }));

  app.patch('/api/picks/:id', auth.requireUser, wrap(async (req, res) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
    if (!(await savePick(db, req.user!.userId, parse(idParam, req.params.id), name, pickJev))) throw new HttpError(404, 'not found');
    res.json({ ok: true });
  }));

  app.put('/api/picks/:id/photos', auth.requireUser, scanJson, wrap(async (req, res) => {
    const { photos } = parse(
      z.object({ photos: z.array(z.object({ base64: z.string().max(5_000_000), mimeType: z.string().max(40) })).max(MAX_PICK_PHOTOS) }),
      req.body
    );
    const decoded = photos.map((p) => {
      if (!IMAGE_TYPES.has(p.mimeType)) throw new HttpError(400, 'unsupported image type');
      const bytes = Buffer.from(p.base64.replace(/^data:[^,]*,/, ''), 'base64');
      if (bytes.length > MAX_PICK_PHOTO_BYTES) throw new HttpError(413, 'photo too large');
      return { contentType: p.mimeType, bytes };
    });
    if (!(await setPickPhotos(db, req.user!.userId, parse(idParam, req.params.id), decoded))) throw new HttpError(404, 'not found');
    res.json({ ok: true });
  }));

  app.get('/api/picks/:id/photos/:n', auth.requireUser, wrap(async (req, res) => {
    const ph = await pickPhoto(db, req.user!.userId, parse(idParam, req.params.id), parse(z.coerce.number().int().min(0).max(MAX_PICK_PHOTOS), req.params.n));
    if (!ph) throw new HttpError(404, 'not found');
    res.set('Content-Type', ph.contentType).set('Cache-Control', 'private, max-age=31536000, immutable').send(ph.bytes);
  }));

  app.delete('/api/picks/:id', auth.requireUser, wrap(async (req, res) => {
    if (!(await deletePick(db, req.user!.userId, parse(idParam, req.params.id)))) throw new HttpError(404, 'not found');
    res.status(204).end();
  }));

  // ── Cellars: several, shared, with racks and receipts ────────────────────
  const cellarName = z.string().trim().min(1).max(60);
  app.get('/api/cellars', auth.requireUser, wrap(async (req, res) => {
    res.json({ cellars: await listCellars(db, req.user!.userId) });
  }));

  app.post('/api/cellars', auth.requireUser, wrap(async (req, res) => {
    const { name } = parse(z.object({ name: cellarName }), req.body);
    res.status(201).json({ cellarId: await createCellar(db, req.user!.userId, name) });
  }));

  app.patch('/api/cellars/:id', auth.requireUser, wrap(async (req, res) => {
    const { name } = parse(z.object({ name: cellarName }), req.body);
    await renameCellar(db, req.user!.userId, parse(idParam, req.params.id), name);
    res.json({ ok: true });
  }));

  app.delete('/api/cellars/:id', auth.requireUser, wrap(async (req, res) => {
    await deleteCellar(db, req.user!.userId, parse(idParam, req.params.id));
    res.status(204).end();
  }));

  // Sharing: an owner makes a link; whoever opens it (signed in) joins.
  app.post('/api/cellars/:id/invites', auth.requireUser, wrap(async (req, res) => {
    const { role } = parse(z.object({ role: z.enum(['editor', 'viewer']).default('editor') }), req.body ?? {});
    res.status(201).json(await createInvite(db, req.user!.userId, parse(idParam, req.params.id), role));
  }));

  const inviteCode = z.string().trim().regex(/^[a-z0-9]{6,32}$/i);
  app.get('/api/cellar-invites/:code', auth.requireUser, wrap(async (req, res) => {
    res.json(await previewInvite(db, req.user!.userId, parse(inviteCode, req.params.code)));
  }));

  app.post('/api/cellar-invites/:code/accept', auth.requireUser, wrap(async (req, res) => {
    res.json(await acceptInvite(db, req.user!.userId, parse(inviteCode, req.params.code)));
  }));

  app.patch('/api/cellars/:id/members/:userId', auth.requireUser, wrap(async (req, res) => {
    const { role } = parse(z.object({ role: z.enum(['owner', 'editor', 'viewer']) }), req.body);
    await setMemberRole(db, req.user!.userId, parse(idParam, req.params.id), parse(idParam, req.params.userId), role);
    res.json({ ok: true });
  }));

  // Leave (your own id) or, owners, take someone out.
  app.delete('/api/cellars/:id/members/:userId', auth.requireUser, wrap(async (req, res) => {
    await removeMember(db, req.user!.userId, parse(idParam, req.params.id), parse(idParam, req.params.userId));
    res.status(204).end();
  }));

  // Racks, and where each bottle sits on them.
  const rackBody = z.object({ name: z.string().trim().min(1).max(40), rows: z.number().int().min(1).max(40), cols: z.number().int().min(1).max(40) });
  app.get('/api/cellars/:id/racks', auth.requireUser, wrap(async (req, res) => {
    res.json({ racks: await listRacks(db, req.user!.userId, parse(idParam, req.params.id)) });
  }));

  app.post('/api/cellars/:id/racks', auth.requireUser, wrap(async (req, res) => {
    const b = parse(rackBody, req.body);
    res.status(201).json({ rackId: await createRack(db, req.user!.userId, parse(idParam, req.params.id), b) });
  }));

  app.patch('/api/racks/:id', auth.requireUser, wrap(async (req, res) => {
    await updateRack(db, req.user!.userId, parse(idParam, req.params.id), parse(rackBody.partial(), req.body));
    res.json({ ok: true });
  }));

  app.delete('/api/racks/:id', auth.requireUser, wrap(async (req, res) => {
    await deleteRack(db, req.user!.userId, parse(idParam, req.params.id));
    res.status(204).end();
  }));

  app.put('/api/tastings/:id/places', auth.requireUser, wrap(async (req, res) => {
    const { places } = parse(
      z.object({ places: z.array(z.object({ rackId: z.number().int().positive(), row: z.number().int().min(0).max(39), col: z.number().int().min(0).max(39) })).max(200) }),
      req.body
    );
    await setPlaces(db, req.user!.userId, parse(idParam, req.params.id), places);
    res.json({ ok: true });
  }));

  // Receipts and invoices: read one (text from the phone, or its photo), check the lines, then file it.
  const receiptPhotoBody = z.object({ base64: z.string().max(6_000_000), mimeType: z.string().max(40) });
  const decodePhoto = (p: z.infer<typeof receiptPhotoBody>) => {
    if (!IMAGE_TYPES.has(p.mimeType)) throw new HttpError(400, 'unsupported image type');
    const bytes = Buffer.from(p.base64.replace(/^data:[^,]*,/, ''), 'base64');
    if (bytes.length > MAX_PICK_PHOTO_BYTES) throw new HttpError(413, 'photo too large');
    return { bytes, contentType: p.mimeType };
  };
  app.post('/api/receipts/read', auth.requireUser, scanLimit, scanJson, wrap(async (req, res) => {
    const b = parse(
      z.object({
        pages: z.array(z.string().max(MAX_LIST_CHARS)).max(MAX_PICK_PHOTOS).optional(),
        imageBase64: z.string().max(12_000_000).optional(),
        mimeType: z.string().max(40).optional(),
        ref: z.string().regex(/^[A-Za-z0-9-]{16,64}$/).optional(),
      }).refine((x) => x.pages?.some((p) => p.trim()) || x.imageBase64, 'pages or imageBase64 required'),
      req.body
    );
    const run = async () => {
      let image: { bytes: Buffer; mimeType: string } | undefined;
      if (!b.pages?.some((p) => p.trim()) && b.imageBase64) {
        const mimeType = b.mimeType ?? 'image/jpeg';
        if (!IMAGE_TYPES.has(mimeType)) throw new HttpError(400, 'unsupported image type');
        image = { bytes: Buffer.from(b.imageBase64.replace(/^data:[^,]*,/, ''), 'base64'), mimeType };
      }
      const read = await readReceipt(db, { pages: b.pages, image }, pickReaders, pickJev);
      if (!read.lines.length) throw new HttpError(422, "No wines found on that receipt. Try a sharper photo, or add the bottles by hand.");
      return read;
    };
    if (b.ref) return res.status(202).json(await startJob(b.ref, req.user!.userId, 'picks', run));
    res.json(publicBody(await run()));
  }));

  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  app.post('/api/receipts', auth.requireUser, scanJson, wrap(async (req, res) => {
    const b = parse(
      z.object({
        cellarId: z.number().int().positive().nullable().optional(),
        merchant: z.string().max(120).optional(),
        purchasedOn: day.nullable().optional(),
        totalCents: z.number().int().min(1).max(100_000_000).nullable().optional(),
        photo: receiptPhotoBody.nullable().optional(),
        lines: z.array(z.object({
          wineId: z.number().int().positive().nullable().optional(),
          producer: z.string().max(120).optional(),
          name: z.string().max(160).optional(),
          colour: z.enum(['red', 'white', 'rose', 'orange', '']).optional(),
          vintage: vintageSchema,
          qty: z.number().int().min(1).max(999),
          unitCents: z.number().int().min(1).max(10_000_000).nullable().optional(),
          bottleMl: z.number().int().min(50).max(30000).nullable().optional(),
        })).min(1).max(200),
      }),
      req.body
    );
    const saved = await saveReceipt(db, req.user!.userId, { ...b, photo: b.photo ? decodePhoto(b.photo) : null });
    res.status(201).json(saved);
  }));

  app.get('/api/receipts', auth.requireUser, wrap(async (req, res) => {
    const cellarId = req.query.cellarId === undefined ? undefined : parse(idParam, req.query.cellarId);
    res.json({ receipts: await listReceipts(db, req.user!.userId, cellarId) });
  }));

  app.get('/api/receipts/:id', auth.requireUser, wrap(async (req, res) => {
    res.json(await getReceipt(db, req.user!.userId, parse(idParam, req.params.id)));
  }));

  app.patch('/api/receipts/:id', auth.requireUser, wrap(async (req, res) => {
    const b = parse(z.object({ merchant: z.string().max(120).optional(), purchasedOn: day.nullable().optional(), totalCents: z.number().int().min(1).max(100_000_000).nullable().optional() }), req.body);
    await updateReceipt(db, req.user!.userId, parse(idParam, req.params.id), b);
    res.json({ ok: true });
  }));

  app.put('/api/receipts/:id/photo', auth.requireUser, scanJson, wrap(async (req, res) => {
    await setReceiptPhoto(db, req.user!.userId, parse(idParam, req.params.id), decodePhoto(parse(receiptPhotoBody, req.body)));
    res.json({ ok: true });
  }));

  app.get('/api/receipts/:id/photo', auth.requireUser, wrap(async (req, res) => {
    const ph = await receiptPhoto(db, req.user!.userId, parse(idParam, req.params.id));
    if (!ph) throw new HttpError(404, 'no photo');
    res.set('Content-Type', ph.contentType).set('Cache-Control', 'private, max-age=86400').send(ph.bytes);
  }));

  app.delete('/api/receipts/:id', auth.requireUser, wrap(async (req, res) => {
    await deleteReceipt(db, req.user!.userId, parse(idParam, req.params.id));
    res.status(204).end();
  }));

  // ── Recommendations ──────────────────────────────────────────────────────
  const recStyleSchema = z.enum(['red', 'white', 'rose', 'sparkling', 'orange', 'sweet']);
  /** "Find wines": what a search (and a saved view) can ask for. Prices in dollars. */
  const searchSchema = z.object({
    styles: z.array(recStyleSchema).max(6).optional(),
    minPrice: z.coerce.number().positive().max(100000).optional(),
    maxPrice: z.coerce.number().positive().max(100000).optional(),
    region: z.string().trim().max(80).optional(),
    notes: z.string().trim().max(200).optional(),
    food: z.string().trim().max(200).optional(),
  });

  // Find a bottle: the kinds of wine that best suit the occasion (an example kind, not a bottle).
  app.get('/api/occasion/kinds', auth.requireUser, wrap(async (req, res) => {
    const q = parse(
      z.object({
        occasion: z.enum(['dinner', 'guests', 'celebrate', 'new']).optional(),
        styles: z.string().max(80).optional().transform((s) => (s ? s.split(',').filter(Boolean) : undefined)).pipe(searchSchema.shape.styles),
        food: searchSchema.shape.food,
      }),
      req.query
    );
    res.json({ kinds: await bestKinds(db, req.user!.userId, q) });
  }));

  // Home › Find a bottle: the person's own bottles, best first for the occasion.
  app.get('/api/cellar/picks', auth.requireUser, wrap(async (req, res) => {
    const q = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(50).optional(),
        styles: z.string().max(80).optional().transform((s) => (s ? s.split(',').filter(Boolean) : undefined)).pipe(searchSchema.shape.styles),
        notes: searchSchema.shape.notes,
        food: searchSchema.shape.food,
      }),
      req.query
    );
    res.json(await cellarPicks(db, req.user!.userId, { limit: q.limit, styles: q.styles, notes: q.notes, food: q.food }));
  }));

  app.get('/api/recommendations', auth.requireUser, wrap(async (req, res) => {
    const q = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).optional(),
        // 'rose' is what older app versions send for rosé; it now means "other".
        colour: z.enum(['red', 'white', 'other', 'rose']).optional(),
        style: recStyleSchema.optional(),
        bestValue: z.enum(['true', 'false']).optional(),
        // A search: styles as a comma list ("red,white").
        styles: z.string().max(80).optional().transform((s) => (s ? s.split(',').filter(Boolean) : undefined)).pipe(searchSchema.shape.styles),
      }).merge(searchSchema.omit({ styles: true })),
      req.query
    );
    // Rated wines without researched notes: look them up, so their flavors sharpen the profile next time.
    const { rows: unresearched } = await db.query(
      `SELECT DISTINCT t.wine_id FROM tastings t LEFT JOIN wine_info i USING (wine_id)
        WHERE t.user_id = $1 AND t.rating IS NOT NULL AND i.wine_id IS NULL LIMIT 10`,
      [req.user!.userId]
    );
    for (const r of unresearched) void research.request(r.wine_id).catch(() => {});
    res.json(
      await recommend(db, req.user!.userId, {
        limit: q.limit,
        colour: q.colour === 'rose' ? 'other' : q.colour,
        style: q.style,
        maxPriceCents: q.maxPrice ? Math.round(q.maxPrice * 100) : undefined,
        minPriceCents: q.minPrice ? Math.round(q.minPrice * 100) : undefined,
        bestValue: q.bestValue === 'true',
        styles: q.styles,
        region: q.region,
        notes: q.notes,
        food: q.food,
        near: parseNear(req.query.near) ?? undefined,
        places,
        noteReader,
        jev: pickJev.predict,
      })
    );
  }));

  // Saved "Find wines" searches.
  app.get('/api/rec-views', auth.requireUser, wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT view_id AS "viewId", name, criteria, created_at AS "createdAt" FROM rec_views WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user!.userId]
    );
    res.json({ views: rows.map((r) => ({ ...r, viewId: Number(r.viewId) })) });
  }));

  app.post('/api/rec-views', auth.requireUser, wrap(async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(60), criteria: searchSchema }), req.body);
    const { rows: [n] } = await db.query('SELECT count(*)::int AS n FROM rec_views WHERE user_id = $1', [req.user!.userId]);
    if (n.n >= 50) throw new HttpError(400, 'You have 50 saved views; delete one first');
    const { rows: [v] } = await db.query(
      `INSERT INTO rec_views (user_id, name, criteria) VALUES ($1, $2, $3)
       RETURNING view_id AS "viewId", name, criteria, created_at AS "createdAt"`,
      [req.user!.userId, body.name, body.criteria]
    );
    res.status(201).json({ ...v, viewId: Number(v.viewId) });
  }));

  app.delete('/api/rec-views/:id', auth.requireUser, wrap(async (req, res) => {
    const id = parse(idParam, req.params.id);
    const { rowCount } = await db.query('DELETE FROM rec_views WHERE view_id = $1 AND user_id = $2', [id, req.user!.userId]);
    if (!rowCount) throw new HttpError(404, 'view not found');
    res.status(204).end();
  }));

  // ── Errors ───────────────────────────────────────────────────────────────
  // ── Admin: is Jev right? (X-Admin-Token; anyone else gets a plain 404) ──
  app.get('/api/admin/jev', wrap(async (req, res) => {
    const given = String(req.headers['x-admin-token'] ?? '');
    const ok = adminToken.length >= 16 && given.length === adminToken.length && timingSafeEqual(Buffer.from(given), Buffer.from(adminToken));
    if (!ok) throw new HttpError(404, 'not found');
    const q = parse(z.object({ user: z.coerce.number().int().positive().optional(), days: z.coerce.number().int().min(1).max(3650).optional(), limit: z.coerce.number().int().min(1).max(1000).optional() }), req.query);
    res.set('Cache-Control', 'no-store').json(await jevReport(db, { userId: q.user, days: q.days, limit: q.limit }));
  }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError || err instanceof ScanError || err instanceof CellarError || err instanceof CommunityError || err instanceof CellarTrackerError || err instanceof TasteError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof ProviderUnavailableError) return void res.status(503).json({ error: err.message });
    if (err instanceof multer.MulterError) return void res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });
  return app;
}
