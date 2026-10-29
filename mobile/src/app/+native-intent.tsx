/**
 * Links the app is opened with. A share from another app's share sheet
 * (expo-share-intent) arrives as winetracker://dataUrl=winetrackerShareKey…:
 * it goes to the screen that reads it; every other link as it is.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return path.includes('dataUrl=') ? '/shared' : path;
  } catch {
    return '/';
  }
}
