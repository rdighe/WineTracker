/** Wines this browser opened lately, for the price explorer (a per-viewer convenience). */
export interface Viewed { id: number; name: string; image: string | null; colour: string }

const KEY = 'fs.recent';

export function recentlyViewed(): Viewed[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Viewed[];
  } catch {
    return [];
  }
}

export function rememberViewed(v: Viewed) {
  try {
    localStorage.setItem(KEY, JSON.stringify([v, ...recentlyViewed().filter((x) => x.id !== v.id)].slice(0, 12)));
  } catch {
    // Storage blocked: nothing to remember.
  }
}
