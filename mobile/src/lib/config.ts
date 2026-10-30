/**
 * The API address, fixed at build time: EXPO_PUBLIC_API_URL (mobile/.env for local
 * development, eas.json for TestFlight builds), else the production API.
 */
const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.foodscape.wine').trim().replace(/\/+$/, '');

export const getApiUrl = () => API_URL;
