/** Typed client for the WineTracker API (the same one the iPhone app uses). */
import { API_URL } from './config';
import { getAuthHeader, signOutLocally } from './session';
import type {
  Candidate, ImportSummary, InfoResponse, PickJob, PickResult, PriceSummary, PricesResponse, RecSearch, RecView,
  RecommendationsResponse, SavedPick, SavedWine, Tasting, TastingSetting, Wine,
} from './types';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
  const auth = getAuthHeader();
  if (auth) headers.Authorization = auth;
  if (init.body) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && auth) signOutLocally();
  if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

/** Shop photos go through the API, which fetches each one once and serves a resized copy. */
export const photoUrl = (uri: string | null | undefined) =>
  uri ? (/^https?:\/\//.test(uri) && !uri.startsWith(API_URL) ? `${API_URL}/api/photo?u=${encodeURIComponent(uri)}` : uri) : null;

export const api = {
  health: () => request<{ ok: boolean; provider: string; signIn?: string[] }>('/api/health'),
  me: () => request<{ user_id: number; email: string; display_name: string; created_at: string; tastings: number; saved: number }>('/api/me'),
  search: (q: string) => request<{ results: Candidate[] }>(`/api/wines/search?q=${encodeURIComponent(q)}`),
  wine: (id: number) => request<{ wine: Wine; prices: PriceSummary[] }>(`/api/wines/${id}`),
  prices: (id: number, vintage?: string | null) =>
    request<PricesResponse>(`/api/wines/${id}/prices${vintage && vintage !== '*' ? `?vintage=${encodeURIComponent(vintage)}` : ''}`),
  refreshPrices: (id: number, vintage?: string | null) =>
    request<{ prices: PriceSummary[] }>(`/api/wines/${id}/prices/refresh`, json('POST', { vintage: vintage && vintage !== '*' ? vintage : null })),
  wineInfo: (id: number) => request<InfoResponse>(`/api/wines/${id}/info`),

  tastings: () => request<{ tastings: Tasting[] }>('/api/tastings?limit=1000'),
  addTasting: (t: {
    wineId: number; vintage?: string | null; rating?: number | null; notes?: string; tags?: string[];
    pricePaid?: number | null; priceContext?: 'retail' | 'restaurant' | null; kind?: 'tasted' | 'cellar';
    bottles?: number | null; setting?: TastingSetting | null; tastedOn?: string;
  }) => request<{ tastingId: number }>('/api/tastings', json('POST', t)),
  updateTasting: (id: number, patch: { rating?: number | null; notes?: string; bottles?: number | null; pricePaid?: number | null; vintage?: string | null }) =>
    request<unknown>(`/api/tastings/${id}`, json('PATCH', patch)),
  deleteTasting: (id: number) => request<void>(`/api/tastings/${id}`, { method: 'DELETE' }),
  removeFromCellar: (id: number) => request<{ kept: boolean }>(`/api/tastings/${id}/remove-from-cellar`, json('POST', {})),

  saved: () => request<{ saved: SavedWine[] }>('/api/saved'),
  saveWine: (id: number) => request<void>(`/api/saved/${id}`, json('PUT', {})),
  unsaveWine: (id: number) => request<void>(`/api/saved/${id}`, { method: 'DELETE' }),

  recommendations: (opts: RecSearch & { bestValue?: boolean; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.bestValue) q.set('bestValue', 'true');
    if (opts.styles?.length) q.set('styles', opts.styles.join(','));
    if (opts.minPrice) q.set('minPrice', String(opts.minPrice));
    if (opts.maxPrice) q.set('maxPrice', String(opts.maxPrice));
    for (const k of ['region', 'notes', 'food'] as const) if (opts[k]?.trim()) q.set(k, opts[k].trim());
    return request<RecommendationsResponse>(`/api/recommendations?${q}`);
  },
  recViews: () => request<{ views: RecView[] }>('/api/rec-views'),
  saveRecView: (name: string, criteria: RecSearch) => request<RecView>('/api/rec-views', json('POST', { name, criteria })),
  deleteRecView: (id: number) => request<void>(`/api/rec-views/${id}`, { method: 'DELETE' }),

  /** Start ranking a wine list from its text, one string per page; collect it with job(ref). */
  pickFromList: (pages: string[], ref: string) => request<PickJob>('/api/picks', json('POST', { kind: 'list', pages, ref })),
  job: (ref: string) => request<{ status: 'pending' | 'done' | 'failed'; result?: unknown; error?: string }>(`/api/scans/jobs/${encodeURIComponent(ref)}`),
  savedPicks: () => request<{ saved: SavedPick[] }>('/api/picks'),
  openPick: (id: number) => request<PickResult & { name: string; saved: boolean; photos: number }>(`/api/picks/${id}`),
  savePick: (id: number, name: string) => request<unknown>(`/api/picks/${id}`, json('PATCH', { name })),
  deletePick: (id: number) => request<void>(`/api/picks/${id}`, { method: 'DELETE' }),

  importVivino: (csv: string) => request<ImportSummary>('/api/import/vivino', json('POST', { csv })),
};

/** Poll a server job (a wine list being read) until it's done. */
export async function waitForJob<T>(ref: string, onTick?: (seconds: number) => void): Promise<T> {
  const start = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    onTick?.(Math.round((Date.now() - start) / 1000));
    let j: Awaited<ReturnType<typeof api.job>>;
    try {
      j = await api.job(ref);
    } catch (e) {
      // The job row appears a moment after the 202; a brief 404 or a dropped poll is not the end.
      if (Date.now() - start < 15_000 || (e instanceof ApiError && e.status === 0)) continue;
      throw e;
    }
    if (j.status === 'done') return j.result as T;
    if (j.status === 'failed') throw new ApiError(500, j.error ?? 'Reading the list failed. Try again.');
    if (Date.now() - start > 6 * 60_000) throw new ApiError(504, 'This is taking too long. Try again with fewer pages.');
  }
}
