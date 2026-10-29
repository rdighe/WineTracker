/** The WineTracker API this site talks to, set at build time (VITE_API_URL). */
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:5050').trim().replace(/\/+$/, '');

/** The brand on this site. The iPhone app is still called WineTracker. */
export const BRAND = 'Foodscape';
export const APP_NAME = 'WineTracker';
