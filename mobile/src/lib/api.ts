/** Small typed client for the WineTracker API. */
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { getApiUrl } from './config';
import { canReadNotesOnDevice, noteText, readNoteFlavorsOnDevice } from './noteFlavors';
import type { PricesResponse, RecStyle, RecSearch, RecView, RecommendationsResponse, SavedWine, ScanResult, Tasting, Wine, PriceSummary, Candidate, ImportSummary, TastingSetting, InfoResponse, PickJob, PickResult, SavedPick, CellarPick, Cellar, CellarRole, InvitePreview, Rack, Receipt, ReceiptDetail, Onboarding, TastePrefs, Budget, Reaction, CommunityNote, NoteReply, NoteReaction, NoteMaturity, CtPart, TasteCard, SharedTaste } from './types';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type AuthHeader = () => Promise<string | null>;

export interface ServerInfo {
  /** Whether the server can read labels with a model. */
  reads: boolean;
  /** Sign-in methods the server offers: "google", "dev". */
  signIn: string[];
}

/** Is there a WineTracker API at this address, and how does it sign people in? */
export async function checkServer(url: string): Promise<ServerInfo> {
  const res = await fetch(`${url.replace(/\/+$/, '')}/api/health`, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(`No WineTracker API at ${url} (HTTP ${res.status})`);
  // Servers from before Google sign-in only offered development sign-in.
  return { reads: Boolean(body.reads ?? body.provider !== 'none'), signIn: Array.isArray(body.signIn) ? body.signIn.map(String) : ['dev'] };
}

/** Longest wait for an answer; long work (scans, wine lists) runs as jobs the app collects instead. */
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createApi(authHeader: AuthHeader) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
    const auth = await authHeader();
    if (auth) headers.Authorization = auth;
    if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    // Reading (GET) is tried once more when the connection drops or the server is slow to answer
    // (just back from the background, a server restarting); writing isn't, so nothing happens twice.
    const reading = !init.method || init.method === 'GET';
    let res: Response;
    for (let attempt = 1; ; attempt++) {
      try {
        res = await fetchWithTimeout(`${getApiUrl()}${path}`, { ...init, headers }, REQUEST_TIMEOUT_MS);
        break;
      } catch (e) {
        // Not an ApiError: callers that keep trying through dropped connections (scanAnswer) keep trying through this too.
        if (!reading || attempt >= 2) throw e instanceof Error && e.name === 'AbortError' ? new Error('The server took too long to answer. Pull to try again.') : e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
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

  /**
   * After a save, read its notes on the phone and send the flavors. Saving
   * never waits on the model; if it can't read them, the server will.
   */
  async function readNotesOnDevice(tastingId: number, text: string): Promise<void> {
    const noteFlavors = await readNoteFlavorsOnDevice(text);
    if (noteFlavors) await request(`/api/tastings/${tastingId}`, json('PATCH', { noteFlavors })).catch(() => {});
  }

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
    /** near: "lat,lng,ST" (lib/location.tsx) - each offer then says if the shop is close by or ships there. */
    prices: (id: number, vintage?: string | null, near?: string) => {
      const q = new URLSearchParams();
      if (vintage) q.set('vintage', vintage);
      if (near) q.set('near', near);
      const qs = q.toString();
      return request<PricesResponse>(`/api/wines/${id}/prices${qs ? `?${qs}` : ''}`);
    },
    refreshPrices: (id: number, vintage?: string | null) => request<{ prices: PriceSummary[] }>(`/api/wines/${id}/prices/refresh`, json('POST', { vintage: vintage ?? null })),
    tastings: () => request<{ tastings: Tasting[] }>('/api/tastings?limit=1000'),
    wineInfo: (id: number) => request<InfoResponse>(`/api/wines/${id}/info`),
    addTasting: async (t: {
      wineId: number; vintage?: string | null; rating?: number | null; notes?: string; tags?: string[];
      pricePaid?: number | null; priceContext?: 'retail' | 'restaurant' | null; scanId?: number;
      kind?: 'tasted' | 'cellar'; bottles?: number | null; setting?: TastingSetting | null; tastedOn?: string; bottleMl?: number; cellarId?: number | null;
    }) => {
      const text = noteText(t.notes, t.tags);
      const onDevice = Boolean(text) && (await canReadNotesOnDevice());
      const res = await request<{ tastingId: number }>('/api/tastings', json('POST', onDevice ? { ...t, noteFlavorsPending: true } : t));
      if (onDevice) void readNotesOnDevice(res.tastingId, text);
      return res;
    },
    /**
     * Start ranking a wine list for the palate (each page's text, as read off
     * its photo). It runs on the server as a job: collect it with scanAnswer(ref).
     */
    pickFromList: (pages: string[], ref: string) => request<PickJob>('/api/picks', json('POST', { kind: 'list', pages, ref })),
    /** Start ranking a store shelf: the photo, with the text read off it to help. Collect it with scanAnswer(ref). */
    pickFromShelf: (photo: { base64: string; mimeType: string }, text: string, ref: string) =>
      request<PickJob>('/api/picks', json('POST', { kind: 'shelf', imageBase64: photo.base64, mimeType: photo.mimeType, ref, ...(text.trim() ? { text: text.slice(0, 6000) } : {}) })),
    /** Saved lists and shelves, newest first. */
    /** Saved lists and shelves, and recent ones not saved (kept keepDays). */
    savedPicks: () => request<{ saved: SavedPick[]; recent?: { pickId: number; kind: 'list' | 'shelf'; readAt: string; wines: number; topPick: string }[]; keepDays?: number }>('/api/picks'),
    /** How long wine lists and shelves not saved are kept (0: not at all). */
    setPickHistoryDays: (pickHistoryDays: number) => request<unknown>('/api/me', json('PATCH', { pickHistoryDays })),
    /** A saved list, ranked for the palate as it is now. */
    openPick: (id: number) => request<PickResult & { name: string; saved: boolean; photos: number }>(`/api/picks/${id}`),
    /** Save (or rename) a list, then keep its photos. */
    savePick: async (id: number, name: string, photos?: { base64: string; mimeType: string }[]) => {
      await request<unknown>(`/api/picks/${id}`, json('PATCH', { name }));
      if (photos?.length) await request<unknown>(`/api/picks/${id}/photos`, json('PUT', { photos }));
    },
    deletePick: (id: number) => request<void>(`/api/picks/${id}`, { method: 'DELETE' }),
    /** A saved list's photo, with what it takes to load it (it's private). */
    pickPhoto: async (id: number, n: number) => ({ uri: `${getApiUrl()}/api/picks/${id}/photos/${n}`, headers: { Authorization: (await authHeader()) ?? '' } }),
    /**
     * Start a CellarTracker import (handle and password, sent on to CellarTracker once and never kept; or exported
     * CSV files). Collect it with scanAnswer(ref).
     */
    importCellarTracker: (input: { handle?: string; password?: string; parts?: CtPart[]; files?: string[]; cellarId?: number | null }, ref: string) =>
      request<PickJob>('/api/import/cellartracker', json('POST', { ...input, ref })),
    importVivino: (csv: string) => request<ImportSummary>('/api/import/vivino', json('POST', { csv })),
    /** wineId: move the entry to another wine (it was matched to the wrong one). pricePaid: per bottle, in dollars. */
    /** Notes and tags sent together are read on the phone when it can; notes alone are left to the server, which knows the tags. */
    updateTasting: async (id: number, patch: { rating?: number | null; notes?: string; tags?: string[]; kind?: 'tasted' | 'cellar'; bottles?: number | null; tastedOn?: string; vintage?: string | null; pricePaid?: number | null; wineId?: number; cellarId?: number }) => {
      const text = patch.notes !== undefined && patch.tags !== undefined ? noteText(patch.notes, patch.tags) : '';
      const onDevice = Boolean(text) && (await canReadNotesOnDevice());
      const res = await request<unknown>(`/api/tastings/${id}`, json('PATCH', onDevice ? { ...patch, noteFlavorsPending: true } : patch));
      if (onDevice) void readNotesOnDevice(id, text);
      return res;
    },
    deleteTasting: (id: number) => request<void>(`/api/tastings/${id}`, { method: 'DELETE' }),
    /** Out of the cellar; a rating or notes on it stay, as a tasting. */
    removeFromCellar: (id: number) => request<{ kept: boolean }>(`/api/tastings/${id}/remove-from-cellar`, json('POST', {})),
    /** Bookmarked wines, newest first (My wines › Saved). */
    saved: () => request<{ saved: SavedWine[] }>('/api/saved'),
    saveWine: (id: number) => request<void>(`/api/saved/${id}`, json('PUT', {})),
    unsaveWine: (id: number) => request<void>(`/api/saved/${id}`, { method: 'DELETE' }),
    recommendations: (opts: RecSearch & { bestValue?: boolean; style?: RecStyle; near?: string } = {}) => {
      const q = new URLSearchParams();
      if (opts.near) q.set('near', opts.near);
      if (opts.bestValue) q.set('bestValue', 'true');
      if (opts.style) q.set('style', opts.style);
      if (opts.styles?.length) q.set('styles', opts.styles.join(','));
      if (opts.minPrice) q.set('minPrice', String(opts.minPrice));
      if (opts.maxPrice) q.set('maxPrice', String(opts.maxPrice));
      for (const k of ['region', 'notes', 'food'] as const) if (opts[k]?.trim()) q.set(k, opts[k].trim());
      return request<RecommendationsResponse>(`/api/recommendations?${q}`);
    },
    /** Home › Find a bottle: the person's own bottles, best first for the occasion. */
    cellarPicks: (opts: { food?: string; notes?: string; styles?: RecStyle[] } = {}) => {
      const q = new URLSearchParams();
      if (opts.styles?.length) q.set('styles', opts.styles.join(','));
      for (const k of ['notes', 'food'] as const) if (opts[k]?.trim()) q.set(k, opts[k].trim());
      return request<{ items: CellarPick[] }>(`/api/cellar/picks?${q}`);
    },
    me: () => request<{ user_id: number; email: string; display_name: string; public_name: string; shown_as: string; pick_history_days: number; tastings: number }>('/api/me'),
    /** The name shown with community notes and a shared taste card ('' = first name and initial). */
    setPublicName: (publicName: string) => request<unknown>('/api/me', json('PATCH', { publicName })),
    // ── Your taste ──
    taste: () => request<TasteCard>('/api/taste'),
    editTaste: (e: { likedFlavors?: string[]; dislikedFlavors?: string[]; avoid?: string[]; styles?: RecStyle[]; budget?: Budget | null; budgetFixed?: boolean }) =>
      request<TasteCard>('/api/taste', json('PUT', e)),
    tasteLink: (renew = false) => request<{ code: string }>('/api/taste/link', json('POST', { renew })),
    tasteCardByCode: (code: string) => request<SharedTaste>(`/api/taste/cards/${encodeURIComponent(code)}`),
    addTasteFriend: (code: string) => request<{ userId: number }>(`/api/taste/cards/${encodeURIComponent(code)}/friend`, json('POST', {})),
    tasteFriends: () => request<{ friends: { userId: number; name: string; similarity: number | null }[] }>('/api/taste/friends'),
    tasteFriend: (id: number) => request<SharedTaste>(`/api/taste/friends/${id}`),
    removeTasteFriend: (id: number) => request<void>(`/api/taste/friends/${id}`, { method: 'DELETE' }),
    // ── Community notes ──
    community: (opts: { wineId?: number; mine?: boolean; before?: number; limit?: number } = {}) => {
      const q = new URLSearchParams();
      if (opts.wineId) q.set('wineId', String(opts.wineId));
      if (opts.mine) q.set('mine', 'true');
      if (opts.before) q.set('before', String(opts.before));
      if (opts.limit) q.set('limit', String(opts.limit));
      return request<{ notes: CommunityNote[] }>(`/api/community?${q}`);
    },
    communityNote: (id: number) => request<{ note: CommunityNote; replies: NoteReply[] }>(`/api/community/${id}`),
    shareNote: (n: { tastingId?: number; wineId?: number; vintage?: string | null; reaction: NoteReaction; maturity?: NoteMaturity | null; body?: string }) =>
      request<{ noteId: number }>('/api/community', json('POST', n)),
    updateNote: (id: number, p: { reaction?: NoteReaction; maturity?: NoteMaturity | null; body?: string }) => request<unknown>(`/api/community/${id}`, json('PATCH', p)),
    deleteNote: (id: number) => request<void>(`/api/community/${id}`, { method: 'DELETE' }),
    likeNote: (id: number, like: boolean) => request<void>(`/api/community/${id}/like`, { method: like ? 'PUT' : 'DELETE' }),
    replyToNote: (id: number, body: string) => request<{ replyId: number }>(`/api/community/${id}/replies`, json('POST', { body })),
    deleteReply: (id: number) => request<void>(`/api/community/replies/${id}`, { method: 'DELETE' }),
    reportNote: (id: number, reason = '') => request<void>(`/api/community/${id}/report`, json('POST', { reason })),
    blockNoteAuthor: (id: number) => request<void>(`/api/community/${id}/block`, json('POST', {})),
    blockReplyAuthor: (id: number) => request<void>(`/api/community/replies/${id}/block`, json('POST', {})),
    unblockAll: () => request<{ unblocked: number }>('/api/community-blocks', { method: 'DELETE' }),
    reportReply: (id: number, reason = '') => request<void>(`/api/community/replies/${id}/report`, json('POST', { reason })),
    /** Welcome: the taste quiz, and whether it's been done. */
    onboarding: () => request<Onboarding>('/api/onboarding'),
    saveOnboarding: (p: { styles?: RecStyle[]; budget?: Budget | null; seeds?: Partial<Record<string, Reaction>>; done?: boolean; skipped?: boolean }) =>
      request<TastePrefs>('/api/onboarding', json('PUT', p)),
    // ── Cellars, sharing, racks, receipts ──
    cellars: () => request<{ cellars: Cellar[] }>('/api/cellars'),
    createCellar: (name: string) => request<{ cellarId: number }>('/api/cellars', json('POST', { name })),
    renameCellar: (id: number, name: string) => request<unknown>(`/api/cellars/${id}`, json('PATCH', { name })),
    deleteCellar: (id: number) => request<void>(`/api/cellars/${id}`, { method: 'DELETE' }),
    invite: (id: number, role: 'editor' | 'viewer') => request<{ code: string; expiresAt: string }>(`/api/cellars/${id}/invites`, json('POST', { role })),
    previewInvite: (code: string) => request<InvitePreview>(`/api/cellar-invites/${encodeURIComponent(code)}`),
    acceptInvite: (code: string) => request<{ cellarId: number }>(`/api/cellar-invites/${encodeURIComponent(code)}/accept`, json('POST', {})),
    setMemberRole: (id: number, userId: number, role: CellarRole) => request<unknown>(`/api/cellars/${id}/members/${userId}`, json('PATCH', { role })),
    removeMember: (id: number, userId: number) => request<void>(`/api/cellars/${id}/members/${userId}`, { method: 'DELETE' }),
    racks: (cellarId: number) => request<{ racks: Rack[] }>(`/api/cellars/${cellarId}/racks`),
    createRack: (cellarId: number, r: { name: string; rows: number; cols: number }) => request<{ rackId: number }>(`/api/cellars/${cellarId}/racks`, json('POST', r)),
    updateRack: (id: number, r: { name?: string; rows?: number; cols?: number }) => request<unknown>(`/api/racks/${id}`, json('PATCH', r)),
    deleteRack: (id: number) => request<void>(`/api/racks/${id}`, { method: 'DELETE' }),
    /** Where an entry's bottles sit (replaces its places). */
    setPlaces: (tastingId: number, places: { rackId: number; row: number; col: number }[]) => request<unknown>(`/api/tastings/${tastingId}/places`, json('PUT', { places })),
    /** Start reading a receipt (its pages' text, or its photo where the phone can't read text). Collect it with scanAnswer(ref). */
    readReceipt: (input: { pages?: string[]; imageBase64?: string; mimeType?: string }, ref: string) => request<PickJob>('/api/receipts/read', json('POST', { ...input, ref })),
    saveReceipt: (r: {
      cellarId?: number | null; merchant?: string; purchasedOn?: string | null; totalCents?: number | null; photo?: { base64: string; mimeType: string } | null;
      lines: { wineId?: number | null; producer?: string; name?: string; vintage?: string | null; qty: number; unitCents?: number | null; bottleMl?: number | null }[];
    }) => request<{ receiptId: number; cellarId: number; tastingIds: number[] }>('/api/receipts', json('POST', r)),
    receipts: () => request<{ receipts: Receipt[] }>('/api/receipts'),
    receipt: (id: number) => request<ReceiptDetail>(`/api/receipts/${id}`),
    deleteReceipt: (id: number) => request<void>(`/api/receipts/${id}`, { method: 'DELETE' }),
    receiptPhoto: async (id: number) => ({ uri: `${getApiUrl()}/api/receipts/${id}/photo`, headers: { Authorization: (await authHeader()) ?? '' } }),
    recViews: () => request<{ views: RecView[] }>('/api/rec-views'),
    saveRecView: (name: string, criteria: RecSearch) => request<RecView>('/api/rec-views', json('POST', { name, criteria })),
    deleteRecView: (id: number) => request<void>(`/api/rec-views/${id}`, { method: 'DELETE' }),
  };
}

export type Api = ReturnType<typeof createApi>;
