/** Light, dark, or follow the system (the app's Settings › Appearance), kept per browser. */
export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'fs.theme';

export function getTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref = getTheme()) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Not remembered; applies to this visit.
  }
}
