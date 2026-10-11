export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5000').replace(/\/$/, '');
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
/** Without Supabase configured, the app signs in with the API's development auth. */
export const USE_DEV_AUTH = !SUPABASE_URL || !SUPABASE_ANON_KEY;
