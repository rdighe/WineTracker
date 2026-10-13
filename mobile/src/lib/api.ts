/** Small typed client for the WineTracker API. */
import { API_URL } from './config';
import type { PricesResponse, Recommendation, ScanResult, Tasting, Wine, PriceSummary, Candidate } from './types';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type AuthHeader = () => Promise<string | null>;

export function createApi(authHeader: AuthHeader) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
    const auth = await authHeader();
    if (auth) headers.Authorization = auth;
    if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API_URL}${path}`, { ...init, headers });
    if (res.status === 204) return undefined as T;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
    return body as T;
  }
  const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

  return {
    scan(photo: { uri: string; base64?: string | null; mimeType?: string | null }) {
      // Sent as base64 JSON: Expo's fetch drops React Native {uri, name, type}
      // file parts from FormData, so the server never saw the photo.
      const imageBase64 = photo.base64 ?? (photo.uri.startsWith('data:') ? photo.uri : null);
      if (!imageBase64) throw new ApiError(0, 'could not read the photo');
      return request<ScanResult>('/api/scans', json('POST', { imageBase64, mimeType: photo.mimeType ?? 'image/jpeg' }));
    },
    confirmScan: (scanId: number, choice: { wineId: number } | { newWine: { producer: string; name: string; region?: string } }) =>
      request<{ wineId: number; wine: Wine }>(`/api/scans/${scanId}/confirm`, json('POST', choice)),
    search: (q: string) => request<{ results: Candidate[] }>(`/api/wines/search?q=${encodeURIComponent(q)}`),
    wine: (id: number) => request<{ wine: Wine; prices: PriceSummary[] }>(`/api/wines/${id}`),
    prices: (id: number, vintage?: string | null) =>
      request<PricesResponse>(`/api/wines/${id}/prices${vintage ? `?vintage=${encodeURIComponent(vintage)}` : ''}`),
    refreshPrices: (id: number, vintage?: string | null) => request<{ prices: PriceSummary[] }>(`/api/wines/${id}/prices/refresh`, json('POST', { vintage: vintage ?? null })),
    tastings: () => request<{ tastings: Tasting[] }>('/api/tastings'),
    addTasting: (t: {
      wineId: number; vintage?: string | null; rating?: number | null; notes?: string; tags?: string[];
      pricePaid?: number | null; priceContext?: 'retail' | 'restaurant' | null; scanId?: number;
    }) => request<{ tastingId: number }>('/api/tastings', json('POST', t)),
    deleteTasting: (id: number) => request<void>(`/api/tastings/${id}`, { method: 'DELETE' }),
    saveWine: (id: number) => request<void>(`/api/saved/${id}`, json('PUT', {})),
    recommendations: (opts: { bestValue?: boolean; colour?: string; maxPrice?: number } = {}) => {
      const q = new URLSearchParams();
      if (opts.bestValue) q.set('bestValue', 'true');
      if (opts.colour) q.set('colour', opts.colour);
      if (opts.maxPrice) q.set('maxPrice', String(opts.maxPrice));
      return request<{ mode: 'profile' | 'popular'; items: Recommendation[] }>(`/api/recommendations?${q}`);
    },
  };
}

export type Api = ReturnType<typeof createApi>;
