/** Whether the tour (components/Tour.tsx) has been shown on this phone; Settings › Show the tour clears it. */
import { storage } from './storage';

const KEY = 'tour-done';

export const tour = {
  done: async () => Boolean(await storage.get(KEY)),
  finish: () => storage.set(KEY, new Date().toISOString()),
  reset: () => storage.remove(KEY),
};
