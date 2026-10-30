/**
 * The WineTracker design system: light and dark tokens, the type scale, and
 * the person's display choices. Theme follows the phone (or the in-app
 * Light/Dark choice); glass is always tinted, except that Reduce Transparency
 * makes it solid and Increase Contrast makes it more frosted.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Appearance, Platform, useColorScheme, type TextStyle } from 'react-native';
import { storage } from '../lib/storage';

export type Scheme = 'light' | 'dark';
export type WineStyle = 'red' | 'white' | 'rose' | 'sparkling' | 'orange' | 'fortified';

export interface Palette {
  bg: string; surface: string; surfaceRaised: string; surfaceSunken: string; fillQuiet: string;
  hairline: string; borderControl: string;
  ink: string; ink2: string; ink3: string;
  accent: string; accentHover: string; onAccent: string; accentSoft: string; onAccentSoft: string;
  positive: string; negative: string; caution: string; focus: string;
  glassFill: string; glassFillTinted: string; glassStroke: string; glassSelected: string; glassTint: string; scrim: string;
  style: Record<WineStyle, string>;
}

export const palettes: Record<Scheme, Palette> = {
  light: {
    bg: '#f6f4f2', surface: '#ffffff', surfaceRaised: '#ffffff', surfaceSunken: '#efecea', fillQuiet: '#ebe7e5',
    hairline: '#e4dfdc', borderControl: '#8c8486',
    ink: '#1c1a1b', ink2: '#5c5657', ink3: '#6b6466',
    accent: '#7b1e3a', accentHover: '#62152d', onAccent: '#ffffff', accentSoft: '#f3e4e9', onAccentSoft: '#6a1832',
    positive: '#16664f', negative: '#b3261e', caution: '#8a5300', focus: '#1f5fd1',
    glassFill: 'rgba(250, 248, 247, 0.58)', glassFillTinted: 'rgba(250, 248, 247, 0.86)', glassStroke: 'rgba(255, 255, 255, 0.8)',
    glassSelected: 'rgba(28, 26, 27, 0.08)', glassTint: 'rgba(123, 30, 58, 0.88)', scrim: 'rgba(20, 12, 15, 0.32)',
    style: { red: '#8c2340', white: '#9a7a14', rose: '#c4506f', sparkling: '#3f7a8c', orange: '#b05a1c', fortified: '#5e3b28' },
  },
  dark: {
    bg: '#0e0c0d', surface: '#1a1718', surfaceRaised: '#252123', surfaceSunken: '#131011', fillQuiet: '#2b2628',
    hairline: '#2e292b', borderControl: '#7a7274',
    ink: '#f4f0ee', ink2: '#b3abab', ink3: '#9b9395',
    accent: '#e88ca3', accentHover: '#f2a9bb', onAccent: '#2a0a14', accentSoft: '#3b1b26', onAccentSoft: '#f4b9c7',
    positive: '#5fcca6', negative: '#ff8f86', caution: '#f2b85c', focus: '#86adff',
    glassFill: 'rgba(33, 29, 31, 0.66)', glassFillTinted: 'rgba(33, 29, 31, 0.86)', glassStroke: 'rgba(255, 255, 255, 0.14)',
    glassSelected: 'rgba(255, 255, 255, 0.12)', glassTint: 'rgba(232, 140, 163, 0.9)', scrim: 'rgba(0, 0, 0, 0.56)',
    style: { red: '#dc6a84', white: '#e3c76c', rose: '#f2a2b6', sparkling: '#8cc6d6', orange: '#ee9f62', fortified: '#c9a084' },
  },
};

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;
export const radius = { xs: 6, sm: 10, md: 16, lg: 24, xl: 40, pill: 999 } as const;
export const size = { controlSm: 34, controlMd: 44, controlLg: 50, tapMin: 44, row: 64, rowPhoto: 76, thumbW: 44, thumbH: 56, photoHero: 420 } as const;

/**
 * The wordmark on the opening animation: Perfect DOS VGA 437, the pixel face
 * of foodscape.wine's design (from foodscape.blog), loaded by SplashIntro.
 * Crisp at multiples of its 16 px grid. Everything else in the app is the
 * system font (San Francisco).
 */
export const WORDMARK_FONT = 'PerfectDOSVGA437';
export const wordmarkFont: TextStyle = { fontFamily: WORDMARK_FONT };

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/** Text styles. Sizes follow Apple's text styles; all of them are the system font. */
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.4 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 24 },
  callout: { fontSize: 16, lineHeight: 21 },
  subhead: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 11, lineHeight: 13, fontWeight: '600' },
  wineDisplay: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.4 },
  wineTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  figureLg: { ...tabular, fontSize: 34, lineHeight: 38, fontWeight: '700', letterSpacing: -0.3 },
  figure: { ...tabular, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  tabular,
} satisfies Record<string, TextStyle>;

/** The wine's style for its color dot and placeholder bottle. */
export function wineStyleOf(colour?: string | null, wineType?: string | null): WineStyle {
  const k = `${wineType ?? ''} ${colour ?? ''}`.toLowerCase();
  if (/sparkl|champagne/.test(k)) return 'sparkling';
  if (/fortif|port|sherry|madeira|dessert|sweet/.test(k)) return 'fortified';
  if (/ros/.test(k)) return 'rose';
  if (/orange|amber/.test(k)) return 'orange';
  if (/white/.test(k)) return 'white';
  return 'red';
}

export type ThemePref = 'system' | 'light' | 'dark';
/** What glass actually renders as, after the phone's accessibility settings. */
export type GlassMode = 'tinted' | 'solid' | 'contrast';

interface A11y { reduceTransparency: boolean; increaseContrast: boolean; reduceMotion: boolean }

/** The phone's Reduce Transparency, Increase Contrast and Reduce Motion settings, kept current. */
function useA11y(): A11y {
  const [a, setA] = useState<A11y>({ reduceTransparency: false, increaseContrast: false, reduceMotion: false });
  useEffect(() => {
    if (Platform.OS === 'web') {
      const mq = (q: string) => globalThis.matchMedia?.(q);
      const queries = { reduceTransparency: mq('(prefers-reduced-transparency: reduce)'), increaseContrast: mq('(prefers-contrast: more)'), reduceMotion: mq('(prefers-reduced-motion: reduce)') };
      const read = () => setA({ reduceTransparency: Boolean(queries.reduceTransparency?.matches), increaseContrast: Boolean(queries.increaseContrast?.matches), reduceMotion: Boolean(queries.reduceMotion?.matches) });
      read();
      Object.values(queries).forEach((q) => q?.addEventListener?.('change', read));
      return () => Object.values(queries).forEach((q) => q?.removeEventListener?.('change', read));
    }
    let cancelled = false;
    const contrast = Platform.OS === 'ios' ? AccessibilityInfo.isDarkerSystemColorsEnabled : AccessibilityInfo.isHighTextContrastEnabled;
    Promise.all([
      Platform.OS === 'ios' ? AccessibilityInfo.isReduceTransparencyEnabled() : Promise.resolve(false),
      contrast().catch(() => false),
      AccessibilityInfo.isReduceMotionEnabled(),
    ]).then(([reduceTransparency, increaseContrast, reduceMotion]) => !cancelled && setA({ reduceTransparency, increaseContrast, reduceMotion }));
    const subs = [
      AccessibilityInfo.addEventListener('reduceTransparencyChanged', (v) => setA((p) => ({ ...p, reduceTransparency: v }))),
      AccessibilityInfo.addEventListener('darkerSystemColorsChanged', (v) => setA((p) => ({ ...p, increaseContrast: v }))),
      AccessibilityInfo.addEventListener('highTextContrastChanged', (v) => setA((p) => ({ ...p, increaseContrast: v }))),
      AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setA((p) => ({ ...p, reduceMotion: v }))),
    ];
    return () => {
      cancelled = true;
      subs.forEach((s) => s.remove());
    };
  }, []);
  return a;
}

export interface Theme {
  scheme: Scheme;
  c: Palette;
  glass: GlassMode;
  reduceMotion: boolean;
  prefs: { theme: ThemePref };
  setPrefs: (p: Partial<{ theme: ThemePref }>) => void;
}

const PREFS_KEY = 'display-prefs';
const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const a11y = useA11y();
  const [prefs, setPrefsState] = useState<Theme['prefs']>({ theme: 'system' });

  useEffect(() => {
    storage.get(PREFS_KEY).then((raw) => {
      if (!raw) return;
      try {
        // Older builds also saved a glass choice; only the theme is kept now.
        const saved = JSON.parse(raw) as Partial<Theme['prefs']>;
        if (saved.theme) setPrefsState({ theme: saved.theme });
      } catch {
        // A bad saved value just means the defaults.
      }
    });
  }, []);
  // Native controls (date picker, alerts, keyboard) follow the in-app theme too.
  useEffect(() => {
    if (Platform.OS !== 'web') Appearance.setColorScheme(prefs.theme === 'system' ? 'unspecified' : prefs.theme);
  }, [prefs.theme]);

  const setPrefs = useCallback((p: Partial<Theme['prefs']>) => {
    setPrefsState((old) => {
      const next = { ...old, ...p };
      void storage.set(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<Theme>(() => {
    const scheme: Scheme = prefs.theme === 'system' ? (system === 'dark' ? 'dark' : 'light') : prefs.theme;
    const glass: GlassMode = a11y.reduceTransparency ? 'solid' : a11y.increaseContrast ? 'contrast' : 'tinted';
    return { scheme, c: palettes[scheme], glass, reduceMotion: a11y.reduceMotion, prefs, setPrefs };
  }, [system, a11y, prefs, setPrefs]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme outside ThemeProvider');
  return t;
}
