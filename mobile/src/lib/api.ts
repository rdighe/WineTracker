/** Small typed client for the WineTracker API. */
import { getApiUrl } from './config';
import type { PricesResponse, Recommendation, ScanResult, Tasting, Wine, PriceSummary, Candidate, ImportSummary, TastingSetting, InfoResponse } from './types';

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
  const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

  return {
    scan(photo: { uri: string; base64?: string | null; mimeType?: string | null; ocrText?: string }) {
      // Sent as base64 JSON: Expo's fetch drops React Native {uri, name, type}
      // file parts from FormData, so the server never saw the photo.
      const imageBase64 = photo.base64 ?? (photo.uri.startsWith('data:') ? photo.uri : null);
      if (!imageBase64) throw new ApiError(0, 'could not read the photo');
      return request<ScanResult>('/api/scans', json('POST', { imageBase64, mimeType: photo.mimeType ?? 'image/jpeg', ocrText: photo.ocrText }));
    },
    /** A photo of several bottles: one scan per label, left to right. */
    scanLineup(photo: { base64: string; mimeType: string }) {
      return request<{ scans: ScanResult[] }>('/api/scans/lineup', json('POST', { imageBase64: photo.base64, mimeType: photo.mimeType }));
    },
    confirmScan: (scanId: number, choice: { wineId: number } | { newWine: { producer: string; name: string; region?: string } }) =>
      request<{ wineId: number; wine: Wine }>(`/api/scans/${scanId}/confirm`, json('POST', choice)),
    search: (q: string) => request<{ results: Candidate[] }>(`/api/wines/search?q=${encodeURIComponent(q)}`),
    wine: (id: number) => request<{ wine: Wine; prices: PriceSummary[] }>(`/api/wines/${id}`),
    prices: (id: number, vintage?: string | null) =>
      request<PricesResponse>(`/api/wines/${id}/prices${vintage ? `?vintage=${encodeURIComponent(vintage)}` : ''}`),
    refreshPrices: (id: number, vintage?: string | null) => request<{ prices: PriceSummary[] }>(`/api/wines/${id}/prices/refresh`, json('POST', { vintage: vintage ?? null })),
    tastings: () => request<{ tastings: Tasting[] }>('/api/tastings?limit=1000'),
    wineInfo: (id: number) => request<InfoResponse>(`/api/wines/${id}/info`),
    addTasting: (t: {
      wineId: number; vintage?: string | null; rating?: number | null; notes?: string; tags?: string[];
      pricePaid?: number | null; priceContext?: 'retail' | 'restaurant' | null; scanId?: number;
      kind?: 'tasted' | 'cellar'; bottles?: number | null; setting?: TastingSetting | null;
    }) => request<{ tastingId: number }>('/api/tastings', json('POST', t)),
    importVivino: (csv: string) => request<ImportSummary>('/api/import/vivino', json('POST', { csv })),
    updateTasting: (id: number, patch: { rating?: number | null; notes?: string; tags?: string[]; kind?: 'tasted' | 'cellar'; bottles?: number | null }) =>
      request<unknown>(`/api/tastings/${id}`, json('PATCH', patch)),
    deleteTasting: (id: number) => request<void>(`/api/tastings/${id}`, { method: 'DELETE' }),
    saveWine: (id: number) => request<void>(`/api/saved/${id}`, json('PUT', {})),
    recommendations: (opts: { bestValue?: boolean; colour?: string; maxPrice?: number } = {}) => {
      const q = new URLSearchParams();
      if (opts.bestValue) q.set('bestValue', 'true');
      if (opts.colour) q.set('colour', opts.colour);
      if (opts.maxPrice) q.set('maxPrice', String(opts.maxPrice));
      return request<{ mode: 'profile'; items: Recommendation[] } | { mode: 'locked'; rated: number; needed: number; items: [] }>(`/api/recommendations?${q}`);
    },
  };
}

export type Api = ReturnType<typeof createApi>;
