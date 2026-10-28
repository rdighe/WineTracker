/**
 * "Near you": the person's choice (off, their current location, or a state
 * they pick) and, when on, where they are - rounded to about a kilometer and
 * sent only with the requests that use it (?near=lat,lng,ST); never stored on
 * the server. Off, or no permission: For you and Where to buy show everything.
 */
import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { storage } from './storage';

export type LocationMode = 'off' | 'device' | 'state';
export interface Here { lat: number | null; lng: number | null; state: string; label: string }

const KEY = 'location-prefs';

export const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** "CA", "ca", "California" -> "CA"; '' when it isn't a US state. */
export function stateCode(s: string | null | undefined): string {
  const t = (s ?? '').trim();
  if (!t) return '';
  const up = t.toUpperCase();
  if (STATES[up]) return up;
  return Object.entries(STATES).find(([, name]) => name.toLowerCase() === t.toLowerCase())?.[0] ?? '';
}

interface LocationState {
  mode: LocationMode;
  /** Where the person is, when known. */
  here: Here | null;
  /** Finding the location now. */
  locating: boolean;
  /** Why it couldn't (permission refused, no fix). */
  problem: string | null;
  /** The ?near= value, or undefined when off or unknown. */
  near: string | undefined;
  useDevice: () => Promise<boolean>;
  chooseState: (code: string) => void;
  turnOff: () => void;
}

const Ctx = createContext<LocationState | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LocationMode>('off');
  const [here, setHere] = useState<Here | null>(null);
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = (p: { mode: LocationMode; state?: string }) => void storage.set(KEY, JSON.stringify(p)).catch(() => {});

  /** Ask (or re-check) permission, then where the phone is. */
  const locate = useCallback(async (ask: boolean): Promise<boolean> => {
    setLocating(true);
    setProblem(null);
    try {
      const perm = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        setProblem('Location is off for WineTracker. Allow it in Settings, or pick your state instead.');
        return false;
      }
      const pos = (await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 })) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const lat = Math.round(pos.coords.latitude * 100) / 100;
      const lng = Math.round(pos.coords.longitude * 100) / 100;
      let state = '';
      let label = '';
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        state = stateCode(place?.region);
        label = [place?.city, state || place?.region].filter(Boolean).join(', ');
      } catch {
        // No reverse geocoding (the web): distance still works; shipping needs the state.
      }
      setHere({ lat, lng, state, label: label || 'your location' });
      return true;
    } catch {
      setProblem("Couldn't find your location. Try again, or pick your state instead.");
      return false;
    } finally {
      setLocating(false);
    }
  }, []);

  // The saved choice, at launch.
  useEffect(() => {
    void storage.get(KEY).then(async (raw) => {
      try {
        const p = JSON.parse(raw ?? 'null') as { mode?: LocationMode; state?: string } | null;
        if (p?.mode === 'state' && stateCode(p.state)) {
          setMode('state');
          setHere({ lat: null, lng: null, state: stateCode(p.state), label: STATES[stateCode(p.state)]! });
        } else if (p?.mode === 'device') {
          setMode('device');
          await locate(false);
        }
      } catch {
        // Nothing saved: off.
      }
    });
  }, [locate]);

  const value = useMemo<LocationState>(() => ({
    mode,
    here,
    locating,
    problem,
    near: here ? `${here.lat ?? ''},${here.lng ?? ''},${here.state}` : undefined,
    useDevice: async () => {
      const ok = await locate(true);
      if (ok) {
        setMode('device');
        save({ mode: 'device' });
      }
      return ok;
    },
    chooseState: (code: string) => {
      const s = stateCode(code);
      if (!s) return;
      setMode('state');
      setProblem(null);
      setHere({ lat: null, lng: null, state: s, label: STATES[s]! });
      save({ mode: 'state', state: s });
    },
    turnOff: () => {
      setMode('off');
      setHere(null);
      setProblem(null);
      save({ mode: 'off' });
    },
  }), [mode, here, locating, problem, locate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocation(): LocationState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLocation outside LocationProvider');
  return v;
}
