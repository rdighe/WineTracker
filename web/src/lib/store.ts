/** The signed-in person's tastings, cellar and saved wines, loaded once and shared by every page. */
import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import { getAuthHeader } from './session';
import type { SavedWine, Tasting } from './types';

interface State { tastings: Tasting[] | null; saved: SavedWine[] | null; error: unknown; loading: boolean; key: string | null }

let state: State = { tastings: null, saved: null, error: null, loading: false, key: null };
const listeners = new Set<() => void>();
const setState = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export async function reloadMine(): Promise<void> {
  const key = getAuthHeader();
  if (!key) return setState({ tastings: null, saved: null, error: null, loading: false, key: null });
  setState({ loading: true, key });
  try {
    const [t, s] = await Promise.all([api.tastings(), api.saved()]);
    if (getAuthHeader() === key) setState({ tastings: t.tastings, saved: s.saved, error: null, loading: false });
  } catch (error) {
    if (getAuthHeader() === key) setState({ error, loading: false });
  }
}

/** Tastings (kind tasted or cellar) and saved wines; loads on first use and when the account changes. */
export function useMine() {
  const s = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);
  const key = getAuthHeader();
  useEffect(() => {
    if (key !== state.key && !state.loading) void reloadMine();
  }, [key]);
  return { ...s, reload: reloadMine };
}

export const cellarOf = (t: Tasting[] | null) => (t ?? []).filter((x) => x.kind === 'cellar');
export const tastedOf = (t: Tasting[] | null) => (t ?? []).filter((x) => x.kind === 'tasted');
