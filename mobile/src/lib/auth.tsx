/**
 * Sign-in state. With Supabase configured: email one-time-code sign-in, and
 * the Supabase access token is sent to the API as a Bearer token. Without it
 * (local development): a name is stored on the device and sent as
 * "Authorization: Dev <name>", which the API accepts when ALLOW_DEV_AUTH=true.
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadApiUrl, SUPABASE_ANON_KEY, SUPABASE_URL, USE_DEV_AUTH } from './config';
import { storage } from './storage';

// Keychain values are size-limited, so long values (Supabase sessions) are
// stored in chunks.
const CHUNK = 1800;
const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const n = await storage.get(`${key}.n`);
    if (!n) return storage.get(key);
    const parts = await Promise.all(Array.from({ length: Number(n) }, (_, i) => storage.get(`${key}.${i}`)));
    return parts.every((p) => p !== null) ? parts.join('') : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, 'g')) ?? [''];
    await Promise.all(parts.map((p, i) => storage.set(`${key}.${i}`, p)));
    await storage.set(`${key}.n`, String(parts.length));
  },
  async removeItem(key: string): Promise<void> {
    const n = Number((await storage.get(`${key}.n`)) ?? 0);
    await Promise.all(Array.from({ length: n }, (_, i) => storage.remove(`${key}.${i}`)));
    await storage.remove(`${key}.n`);
    await storage.remove(key);
  },
};

const supabase: SupabaseClient | null = USE_DEV_AUTH
  ? null
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    });

const DEV_KEY = 'wt.devUser';

interface AuthState {
  ready: boolean;
  signedIn: boolean;
  label: string;
  devMode: boolean;
  /** Authorization header value for API calls, or null when signed out. */
  authHeader: () => Promise<string | null>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signInDev: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [devUser, setDevUser] = useState<string | null>(null);

  useEffect(() => {
    // The saved API address must be loaded before any screen calls the API.
    if (supabase) {
      Promise.all([supabase.auth.getSession(), loadApiUrl()]).then(([{ data }]) => {
        setSession(data.session);
        setReady(true);
      });
      const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
      return () => data.subscription.unsubscribe();
    }
    Promise.all([storage.get(DEV_KEY), loadApiUrl()]).then(([v]) => {
      setDevUser(v);
      setReady(true);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      devMode: !supabase,
      signedIn: supabase ? Boolean(session) : Boolean(devUser),
      label: supabase ? session?.user.email ?? '' : devUser ?? '',
      async authHeader() {
        if (supabase) {
          const { data } = await supabase.auth.getSession();
          return data.session ? `Bearer ${data.session.access_token}` : null;
        }
        return devUser ? `Dev ${devUser}` : null;
      },
      async sendCode(email) {
        if (!supabase) throw new Error('Supabase is not configured');
        const { error } = await supabase.auth.signInWithOtp({ email });
        if (error) throw error;
      },
      async verifyCode(email, code) {
        if (!supabase) throw new Error('Supabase is not configured');
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) throw error;
      },
      async signInDev(name) {
        const clean = name.trim().replace(/[^\w.@-]/g, '').slice(0, 64);
        if (!clean) throw new Error('Enter a name');
        await storage.set(DEV_KEY, clean);
        setDevUser(clean);
      },
      async signOut() {
        if (supabase) await supabase.auth.signOut();
        else {
          await storage.remove(DEV_KEY);
          setDevUser(null);
        }
      },
    }),
    [ready, session, devUser]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
