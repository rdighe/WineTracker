/**
 * Shops near the person: which shops have a store close by, and which ship
 * wine to their state. Each shop's stores and shipping states are researched
 * from the web once (merchant_places) and refreshed monthly; a shop is looked
 * up the first time a location-aware request meets it, in the background.
 *
 * The person's location arrives with each request ("near": rounded latitude,
 * longitude and state) and is never stored.
 */
import type { Db } from '../db/pool.js';
import type { LlmProvider } from '../llm/types.js';
import { US_STATES } from '../llm/sanitize.js';

/** A store this close counts as near. */
export const LOCAL_MILES = 30;
const READY_DAYS = 30;
const RETRY_FAILED_HOURS = 24;
const PENDING_STALE_MINUTES = 10;
const CACHE_MS = 60_000;

export interface Near {
  lat: number | null;
  lng: number | null;
  /** Two-letter US state, '' when unknown. */
  state: string;
}

/** How a shop reaches the person: a store nearby (miles, or just "in your state"), and/or shipping to them. */
export interface Reach {
  merchantId: number;
  shop: string;
  local: boolean;
  miles: number | null;
  city: string;
  ships: boolean;
}

interface Place {
  name: string;
  status: 'pending' | 'ready' | 'failed' | 'none';
  stores: { lat: number | null; lng: number | null; city: string; state: string }[];
  shipsTo: Set<string>;
}

/** "37.44,-122.16,CA", "37.44,-122.16" or ",,CA". Null when it says nothing usable. */
export function parseNear(raw: unknown): Near | null {
  if (typeof raw !== 'string' || raw.length > 60) return null;
  const [a, b, c] = raw.split(',');
  const lat = a?.trim() ? Number(a) : NaN;
  const lng = b?.trim() ? Number(b) : NaN;
  const okCoords = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const state = (c ?? '').trim().toUpperCase();
  const near: Near = { lat: okCoords ? lat : null, lng: okCoords ? lng : null, state: US_STATES.has(state) ? state : '' };
  return near.lat !== null || near.state ? near : null;
}

export function miles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export function createPlaces(db: Db, provider: LlmProvider, log: (msg: string) => void = console.error) {
  let cache: { at: number; map: Promise<Map<number, Place>> } | null = null;
  const queue: number[] = [];
  let running = false;
  let idle: Array<() => void> = [];

  function load(): Promise<Map<number, Place>> {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;
    const map = db
      .query(`SELECT m.merchant_id, m.name, p.status, p.stores, p.ships_to FROM merchants m LEFT JOIN merchant_places p USING (merchant_id)`)
      .then(({ rows }) => new Map(rows.map((r) => [Number(r.merchant_id), {
        name: r.name,
        status: r.status ?? 'none',
        stores: Array.isArray(r.stores) ? r.stores : [],
        shipsTo: new Set<string>(r.ships_to ?? []),
      } satisfies Place])));
    cache = { at: Date.now(), map };
    map.catch(() => (cache = null));
    return map;
  }

  function reachOf(id: number, p: Place | undefined, near: Near): Reach | null {
    if (!p || p.status !== 'ready') return null;
    let best: { miles: number | null; city: string } | null = null;
    for (const s of p.stores) {
      if (near.lat !== null && near.lng !== null && s.lat !== null && s.lng !== null) {
        const d = miles(near.lat, near.lng, s.lat, s.lng);
        if (d <= LOCAL_MILES && (!best || best.miles === null || d < best.miles)) best = { miles: Math.round(d * 10) / 10, city: s.city };
      } else if (!best && near.state && s.state === near.state && (near.lat === null || s.lat === null)) {
        // Without coordinates on one side, a store in the same state is the best we can say.
        best = { miles: null, city: s.city };
      }
    }
    const ships = Boolean(near.state && p.shipsTo.has(near.state));
    if (!best && !ships) return null;
    return { merchantId: id, shop: p.name, local: Boolean(best), miles: best?.miles ?? null, city: best?.city ?? '', ships };
  }

  async function research(merchantId: number): Promise<void> {
    try {
      const { rows: [m] } = await db.query('SELECT name, domain FROM merchants WHERE merchant_id = $1', [merchantId]);
      if (!m || !provider.researchMerchant) throw new Error('nothing to research');
      const found = await provider.researchMerchant({ name: m.name, domain: m.domain });
      await db.query(
        `UPDATE merchant_places SET status = 'ready', stores = $2, ships_to = $3, sources = $4, error = '', updated_at = NOW() WHERE merchant_id = $1`,
        [merchantId, JSON.stringify(found.stores), found.shipsTo, JSON.stringify(found.sources)]
      );
    } catch (err) {
      log(`shop places ${merchantId}: ${err instanceof Error ? err.message : String(err)}`);
      await db.query(`UPDATE merchant_places SET status = 'failed', error = $2, updated_at = NOW() WHERE merchant_id = $1`, [merchantId, String(err instanceof Error ? err.message : err).slice(0, 300)]).catch(() => {});
    }
    cache = null;
  }

  async function drain(): Promise<void> {
    running = true;
    while (queue.length) await research(queue.shift()!);
    running = false;
    for (const done of idle) done();
    idle = [];
  }

  return {
    available: Boolean(provider.researchMerchant),

    /**
     * How each shop reaches someone `near`, for the shops given (null: not near
     * and doesn't ship there, or not looked up yet). `pending` counts shops
     * still being looked up, so the app can say results may grow.
     */
    async reach(merchantIds: Iterable<number>, near: Near): Promise<{ reach: Map<number, Reach>; pending: number }> {
      const map = await load();
      const reach = new Map<number, Reach>();
      let pending = 0;
      for (const id of new Set(merchantIds)) {
        const p = map.get(id);
        if (!p || p.status === 'pending' || p.status === 'none') pending++;
        const r = reachOf(id, p, near);
        if (r) reach.set(id, r);
      }
      return { reach, pending };
    },

    /** Look up the shops not known yet (or due a refresh), one at a time in the background. */
    async request(merchantIds: Iterable<number>): Promise<void> {
      if (!provider.researchMerchant) return;
      const ids = [...new Set(merchantIds)].filter((id) => !queue.includes(id));
      if (!ids.length) return;
      const { rows } = await db.query(
        `INSERT INTO merchant_places (merchant_id) SELECT unnest($1::bigint[])
         ON CONFLICT (merchant_id) DO UPDATE SET status = 'pending', updated_at = NOW()
          WHERE (merchant_places.status = 'ready' AND merchant_places.updated_at < NOW() - make_interval(days => $2))
             OR (merchant_places.status = 'failed' AND merchant_places.updated_at < NOW() - make_interval(hours => $3))
             OR (merchant_places.status = 'pending' AND merchant_places.updated_at < NOW() - make_interval(mins => $4))
         RETURNING merchant_id`,
        [ids, READY_DAYS, RETRY_FAILED_HOURS, PENDING_STALE_MINUTES]
      );
      if (!rows.length) return;
      queue.push(...rows.map((r) => Number(r.merchant_id)));
      cache = null;
      if (!running) void drain();
    },

    /** Resolves when nothing is queued (tests). */
    drained(): Promise<void> {
      if (!running && !queue.length) return Promise.resolve();
      return new Promise((resolve) => idle.push(resolve));
    },
  };
}

export type Places = ReturnType<typeof createPlaces>;
