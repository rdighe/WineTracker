/**
 * The signed-in session, kept in localStorage. Google sign-in runs through the
 * API (src/auth/google.ts): the site sends the browser to
 * /api/auth/google/start?redirect=<this site>/auth and gets a session token
 * back in the address's #fragment. Local API servers with ALLOW_DEV_AUTH also
 * take a name ("Authorization: Dev <name>").
 */
import { useSyncExternalStore } from 'react';
import { API_URL } from './config';

const KEY = 'fs.session';
const NEXT_KEY = 'fs.next';

export interface Session { token?: string; dev?: string; email: string }

const read = (): Session | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
};

let current = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function set(s: Session | null) {
  current = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the session lasts until the tab closes.
  }
  emit();
}

addEventListener('storage', (e) => {
  if (e.key === KEY) {
    current = read();
    emit();
  }
});

export const getAuthHeader = () => (current?.token ? `Bearer ${current.token}` : current?.dev ? `Dev ${current.dev}` : null);

export function useSession(): Session | null {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => current);
}

export function startGoogleSignIn(next = location.pathname + location.search) {
  try {
    sessionStorage.setItem(NEXT_KEY, next);
  } catch {
    // Without it, sign-in lands on the overview.
  }
  location.assign(`${API_URL}/api/auth/google/start?redirect=${encodeURIComponent(`${location.origin}/auth`)}`);
}

/** On /auth: take the token from the address. Returns where to go next, or throws the sign-in error. */
export function finishSignIn(hash: string): string {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const token = p.get('token');
  if (!token) throw new Error(p.get('error') ?? 'Sign-in did not finish. Try again.');
  set({ token, email: p.get('email') ?? '' });
  let next = '/';
  try {
    next = sessionStorage.getItem(NEXT_KEY) || '/';
    sessionStorage.removeItem(NEXT_KEY);
  } catch {
    // Default destination.
  }
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function signInDev(name: string) {
  const clean = name.trim().replace(/[^\w.@-]/g, '').slice(0, 64);
  if (!clean) throw new Error('Enter a name');
  set({ dev: clean, email: clean });
}

export const signOutLocally = () => set(null);
