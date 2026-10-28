/** Small typed client for the WineTracker API. */
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { getApiUrl } from './config';
import type { PricesResponse, RecStyle, RecSearch, RecView, RecommendationsResponse, SavedWine, ScanResult, Tasting, Wine, PriceSummary, Candidate, ImportSummary, TastingSetting, InfoResponse } from './types';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type AuthHeader = () => Promise<string | null>;

export interface ServerInfo {
  /** LLM provider for label reading ("none" = off). */
  provider: string;
  /** Sign-in methods the server offers: "google", "dev". */
  signIn: string[];
}

/** Is there a WineTracker API at this address, and how does it sign people in? */
export async function checkServer(url: string): Promise<ServerInfo> {
  const res = await fetch(`${url.replace(/\/+$/, '')}/api/health`, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(`No WineTracker API at ${url} (HTTP ${res.status})`);
  // Servers from before Google sign-in only offered development sign-in.
  return { provider: String(body.provider ?? ''), signIn: Array.isArray(body.signIn) ? body.signIn.map(String) : ['dev'] };
}

export function createApi(authHeader: AuthHeader) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
    const auth = await authHeader();
    if (auth) headers.Authorization = auth;
    if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${getApiUrl()}${path}`, { ...init, headers });
    if (res.status === 204) return undefined as T;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
    return body as T;
  }
  /**
   * A label photo, sent through an iOS background upload session: if the
   * person switches apps mid-scan, the upload still finishes and the server
   * reads the label; the app collects the answer when it's back (scanJob).
   * On the web, a plain JSON request.
   */
  async function sendPhoto<T>(path: string, photo: { uri: string; base64?: string | null; mimeType?: string | null }, fields: Record<string, string>): Promise<T> {
    const mimeType = photo.mimeType ?? 'image/jpeg';
    if (Platform.OS === 'web' || !photo.uri.startsWith('file:')) {
      const imageBase64 = photo.base64 ?? (photo.uri.startsWith('data:') ? photo.uri : null);
      if (!imageBase64) throw new ApiError(0, 'could not read the photo');
      return request<T>(path, json('POST', { imageBase64, mimeType, ...fields }));
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    const auth = await authHeader();
    if (auth) headers.Authorization = auth;
    const res = await FileSystem.uploadAsync(`${getApiUrl()}${path}`, photo.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'image',
      mimeType,
      parameters: fields,
      headers,
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
    });
    let body: { error?: string } = {};
    try {
      body = JSON.parse(res.body);
    } catch {
      // Not JSON: the status says what happened.
    }
    if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
    return body as T;
  }

  const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

  return {
    /** ref: the app's id for this scan, to collect the answer later with scanJob if the app was away. */
    scan(photo: { uri: string; base64?: string | null; mimeType?: string | null; ocrText?: string }, ref: string) {
      return sendPhoto<ScanResult>('/api/scans', photo, { ref, ...(photo.ocrText ? { ocrText: photo.ocrText } : {}) });
    },
    /** A photo of several bottles: one scan per label, left to right. */
    scanLineup(photo: { uri: string; base64: string; mimeType: string }, ref: string) {
      return sendPhoto<{ scans: ScanResult[] }>('/api/scans/lineup', photo, { ref });
    },
    /** How a scan sent with `ref` came out (pending, done with its answer, or failed). */
    scanJob: (ref: string) => request<{ status: 'pending' | 'done' | 'failed'; result?: unknown; error?: string; httpStatus?: number }>(`/api/scans/jobs/${encodeURIComponent(ref)}`),
    confirmScan: (scanId: number, choice: { wineId: number } | { newWine: { producer: string; name: string; region?: string } }) =>
      request<{ wineId: number; wine: Wine }>(`/api/scans/${scanId}/confirm`, json('POST', choice)),
    search: (q: string) => request<{ results: Candidate[] }>(`/api/wines/search?q=${encodeURIComponent(q)}`),
    /** A wine that isn't in the catalog, added by hand. */
    createWine: (w: { producer: string; name: string; region?: string; country?: string }) => request<Wine>('/api/wines', json('POST', w)),
    wine: (id: number) => request<{ wine: Wine; prices: PriceSummary[] }>(`/api/wines/${id}`),
    prices: (id: number, vintage?: string | null) =>
      request<PricesResponse>(`/api/wines/${id}/prices${vintage ? `?vintage=${encodeURIComponent(vintage)}` : ''}`),
    refreshPrices: (id: number, vintage?: string | null) => request<{ prices: PriceSummary[] }>(`/api/wines/${id}/prices/refresh`, json('POST', { vintage: vintage ?? null })),
    tastings: () => request<{ tastings: Tasting[] }>('/api/tastings?limit=1000'),
    wineInfo: (id: number) => request<InfoResponse>(`/api/wines/${id}/info`),
    addTasting: (t: {
      wineId: number; vintage?: string | null; rating?: number | null; notes?: string; tags?: string[];
      pricePaid?: number | null; priceContext?: 'retail' | 'restaurant' | null; scanId?: number;
      kind?: 'tasted' | 'cellar'; bottles?: number | null; setting?: TastingSetting | null; tastedOn?: string;
    }) => request<{ tastingId: number }>('/api/tastings', json('POST', t)),
    importVivino: (csv: string) => request<ImportSummary>('/api/import/vivino', json('POST', { csv })),
    updateTasting: (id: number, patch: { rating?: number | null; notes?: string; tags?: string[]; kind?: 'tasted' | 'cellar'; bottles?: number | null; tastedOn?: string; vintage?: string | null }) =>
      request<unknown>(`/api/tastings/${id}`, json('PATCH', patch)),
    deleteTasting: (id: number) => request<void>(`/api/tastings/${id}`, { method: 'DELETE' }),
    /** Out of the cellar; a rating or notes on it stay, as a tasting. */
    removeFromCellar: (id: number) => request<{ kept: boolean }>(`/api/tastings/${id}/remove-from-cellar`, json('POST', {})),
    /** Bookmarked wines, newest first (My wines › Saved). */
    saved: () => request<{ saved: SavedWine[] }>('/api/saved'),
    saveWine: (id: number) => request<void>(`/api/saved/${id}`, json('PUT', {})),
    unsaveWine: (id: number) => request<void>(`/api/saved/${id}`, { method: 'DELETE' }),
    recommendations: (opts: RecSearch & { bestValue?: boolean; style?: RecStyle } = {}) => {
      const q = new URLSearchParams();
      if (opts.bestValue) q.set('bestValue', 'true');
      if (opts.style) q.set('style', opts.style);
      if (opts.styles?.length) q.set('styles', opts.styles.join(','));
      if (opts.minPrice) q.set('minPrice', String(opts.minPrice));
      if (opts.maxPrice) q.set('maxPrice', String(opts.maxPrice));
      for (const k of ['region', 'notes', 'food'] as const) if (opts[k]?.trim()) q.set(k, opts[k].trim());
      return request<RecommendationsResponse>(`/api/recommendations?${q}`);
    },
    recViews: () => request<{ views: RecView[] }>('/api/rec-views'),
    saveRecView: (name: string, criteria: RecSearch) => request<RecView>('/api/rec-views', json('POST', { name, criteria })),
    deleteRecView: (id: number) => request<void>(`/api/rec-views/${id}`, { method: 'DELETE' }),
  };
}

export type Api = ReturnType<typeof createApi>;
