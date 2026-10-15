import { storage } from './storage';

/** The API address baked in at build time (EXPO_PUBLIC_API_URL). */
export const DEFAULT_API_URL = clean(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5000');
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
/** Without Supabase configured, the app signs in with the API's development auth. */
export const USE_DEV_AUTH = !SUPABASE_URL || !SUPABASE_ANON_KEY;

// The API address can be changed in the app (sign-in screen), so one TestFlight
// build works with a tunnel to a laptop today and a deployed API later.
const API_URL_KEY = 'wt.apiUrl';
let apiUrl = DEFAULT_API_URL;

function clean(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export const getApiUrl = () => apiUrl;

export async function loadApiUrl(): Promise<void> {
  const saved = await storage.get(API_URL_KEY).catch(() => null);
  if (saved) apiUrl = saved;
}

/** Set (or with an empty value, reset to the built-in default) the API address. */
export async function setApiUrl(url: string): Promise<string> {
  const next = clean(url);
  if (!next) {
    await storage.remove(API_URL_KEY);
    apiUrl = DEFAULT_API_URL;
  } else {
    if (!/^https?:\/\/[^\s/]+/.test(next)) throw new Error('Enter an address like https://example.com');
    await storage.set(API_URL_KEY, next);
    apiUrl = next;
  }
  return apiUrl;
}
