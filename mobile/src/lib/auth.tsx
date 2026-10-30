/**
 * Sign-in state. Google sign-in runs through the API (src/auth/google.ts): the
 * app opens /api/auth/google/start in a browser and gets a WineTracker session
 * token back on its own URL, then sends it to the API as a Bearer token. For
 * local development, servers with ALLOW_DEV_AUTH=true also accept a name, sent
 * as "Authorization: Dev <name>".
 */
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getApiUrl } from './config';
import { storage } from './storage';

const SESSION_KEY = 'wt.session';
const EMAIL_KEY = 'wt.sessionEmail';
const DEV_KEY = 'wt.devUser';

interface AuthState {
  ready: boolean;
  signedIn: boolean;
  label: string;
  /** Authorization header value for API calls, or null when signed out. */
  authHeader: () => Promise<string | null>;
  /** Resolves signed in, or false if the user closed the sign-in window. */
  signInGoogle: () => Promise<boolean>;
  signInDev: (name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<{ token: string; email: string } | null>(null);
  const [devUser, setDevUser] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([storage.get(SESSION_KEY), storage.get(EMAIL_KEY), storage.get(DEV_KEY)]).then(([token, email, dev]) => {
      setSession(token ? { token, email: email ?? '' } : null);
      setDevUser(dev);
      setReady(true);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      signedIn: Boolean(session || devUser),
      label: session?.email ?? devUser ?? '',
      async authHeader() {
        if (session) return `Bearer ${session.token}`;
        return devUser ? `Dev ${devUser}` : null;
      },
      async signInGoogle() {
        // Expo Go: exp://<host>/--/auth; app builds: winetracker://auth; web: <origin>/auth.
        const returnUrl = Linking.createURL('auth');
        const start = `${getApiUrl()}/api/auth/google/start?redirect=${encodeURIComponent(returnUrl)}`;
        const result = await WebBrowser.openAuthSessionAsync(start, returnUrl);
        if (result.type !== 'success') return false;
        const params = new URLSearchParams(result.url.split('#')[1] ?? '');
        const token = params.get('token');
        if (!token) throw new Error(params.get('error') ?? 'Sign-in failed');
        const email = params.get('email') ?? '';
        await storage.set(SESSION_KEY, token);
        await storage.set(EMAIL_KEY, email);
        await storage.remove(DEV_KEY);
        setDevUser(null);
        setSession({ token, email });
        return true;
      },
      async signInDev(name) {
        const clean = name.trim().replace(/[^\w.@-]/g, '').slice(0, 64);
        if (!clean) throw new Error('Enter a name');
        await storage.set(DEV_KEY, clean);
        setDevUser(clean);
      },
      async signOut() {
        await Promise.all([storage.remove(SESSION_KEY), storage.remove(EMAIL_KEY), storage.remove(DEV_KEY)]);
        setSession(null);
        setDevUser(null);
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
