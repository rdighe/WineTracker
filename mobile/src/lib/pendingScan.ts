/**
 * A scan that may outlive the screen that started it. Each scan gets an id
 * (ref) the server files its answer under; the ref is remembered on the phone
 * until the answer is in, so a scan started before switching apps - even one
 * iOS closed the app during - is picked up again when Add wine is next open.
 */
import { ApiError, type Api } from './api';
import { storage } from './storage';

export type ScanMode = 'single' | 'lineup';
export interface PendingScan { ref: string; uri: string; mode: ScanMode; startedAt: number }

const KEY = 'pending-scan';
/** Older than this, a remembered scan is let go. */
const MAX_AGE_MS = 30 * 60_000;

export function newScanRef(): string {
  const hex = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `scan-${Date.now().toString(36)}-${hex()}${hex()}${hex()}`;
}

export const rememberScan = (p: PendingScan) => storage.set(KEY, JSON.stringify(p)).catch(() => {});
export const forgetScan = () => storage.remove(KEY).catch(() => {});

export async function pendingScan(): Promise<PendingScan | null> {
  try {
    const p = JSON.parse((await storage.get(KEY)) ?? 'null') as PendingScan | null;
    if (p && Date.now() - p.startedAt < MAX_AGE_MS) return p;
  } catch {
    // Nothing usable remembered.
  }
  await forgetScan();
  return null;
}

/** Answers from between the app and the server, not from the job. */
const GATEWAY = new Set([502, 503, 504]);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The answer to a scan (or a wine list, a shelf) sent with `ref`, once the
 * server has it. Throws what the request itself would have (an ApiError with
 * its status), or a plain error when it never reached the server. `wanted`:
 * checked before each look; once false, it stops (Superseded).
 */
export async function scanAnswer<T>(
  api: Api, ref: string, opts: { tooLong?: string; wanted?: () => boolean } = {}
): Promise<T> {
  let missing = 0;
  let gateway = 0;
  for (let i = 0; i < 150; i++) {
    // Replaced by a newer request: stop asking.
    if (opts.wanted && !opts.wanted()) throw new Superseded();
    try {
      const job = await api.scanJob(ref);
      if (job.status === 'done') return job.result as T;
      if (job.status === 'failed') throw new ApiError(job.httpStatus ?? 500, job.error ?? 'scan failed');
    } catch (e) {
      if (!(e instanceof ApiError)) {
        // Offline for a moment (just back from the background): keep trying.
      } else if (GATEWAY.has(e.status)) {
        // The way to the server failed for a moment (a restart, a dropped connection): the job is still there.
        if (++gateway >= 20) throw e;
      } else if (e.status === 404) {
        // The upload may still be on its way; after ~45 s it isn't coming.
        if (++missing >= 30) throw new Error("The photo didn't reach the server. Try the scan again.");
      } else {
        throw e;
      }
    }
    await wait(1500);
  }
  throw new Error(opts.tooLong ?? 'Reading the label is taking too long. Try the scan again.');
}

/** scanAnswer stopped because a newer request replaced this one. */
export class Superseded extends Error {
  constructor() {
    super('superseded');
  }
}
