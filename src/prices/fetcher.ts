/**
 * Polite HTTP fetcher for crawling retailer sites.
 *
 *  - Identifies itself honestly (CRAWLER_USER_AGENT), never a browser UA.
 *  - Obeys robots.txt, including Crawl-delay; one request at a time per host.
 *  - Backs off on 429/503 and gives up on a host that keeps refusing us
 *    (403/429). Bot protection is a "no" - we do not try to get around it.
 */
import { createRequire } from 'node:module';

interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
  getSitemaps(): string[];
}
// robots-parser is CommonJS with a default-export typing NodeNext can't call.
const robotsParser = createRequire(import.meta.url)('robots-parser') as (url: string, txt: string) => Robots;
type FetchFn = typeof fetch;

export interface FetcherOptions {
  userAgent: string;
  minDelayMs?: number;      // floor between requests to one host
  maxDelayMs?: number;      // cap on a robots.txt Crawl-delay we will honour by waiting
  timeoutMs?: number;
  maxBytes?: number;
  blockAfter?: number;      // consecutive refusals before a host is abandoned
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface FetchResult {
  url: string;              // final URL after redirects
  status: number;
  contentType: string;
  body: string;
  raw: Buffer;              // undecoded bytes (gzipped sitemaps)
}

export class DisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = 'DisallowedError';
  }
}

export class HostBlockedError extends Error {
  constructor(host: string) {
    super(`${host} is refusing our requests; stopped crawling it`);
    this.name = 'HostBlockedError';
  }
}

interface HostState {
  robots: Robots | 'allow-all' | 'deny-all' | null;
  robotsLoading: Promise<void> | null;
  nextAt: number;
  chain: Promise<unknown>;
  refusals: number;
  blocked: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PoliteFetcher {
  private readonly hosts = new Map<string, HostState>();
  private readonly o: Required<Omit<FetcherOptions, 'fetch' | 'sleep' | 'now'>> & { fetch: FetchFn; sleep: (ms: number) => Promise<void>; now: () => number };

  constructor(opts: FetcherOptions) {
    this.o = {
      minDelayMs: 2000,
      maxDelayMs: 30000,
      timeoutMs: 20000,
      maxBytes: 5 * 1024 * 1024,
      blockAfter: 5,
      fetch: fetch,
      sleep: defaultSleep,
      now: Date.now,
      ...opts,
    };
  }

  get userAgent(): string {
    return this.o.userAgent;
  }

  private state(host: string): HostState {
    let s = this.hosts.get(host);
    if (!s) {
      s = { robots: null, robotsLoading: null, nextAt: 0, chain: Promise.resolve(), refusals: 0, blocked: false };
      this.hosts.set(host, s);
    }
    return s;
  }

  private async loadRobots(origin: string, s: HostState): Promise<void> {
    if (s.robots) return;
    if (!s.robotsLoading) {
      s.robotsLoading = (async () => {
        const robotsUrl = `${origin}/robots.txt`;
        try {
          const r = await this.o.fetch(robotsUrl, {
            headers: { 'User-Agent': this.o.userAgent },
            signal: AbortSignal.timeout(this.o.timeoutMs),
          });
          if (r.ok) s.robots = robotsParser(robotsUrl, await r.text());
          // RFC 9309: a missing robots.txt (404/410) means no restrictions;
          // we treat any other refusal (401/403/5xx) as "keep out".
          else if (r.status === 404 || r.status === 410) s.robots = 'allow-all';
          else s.robots = 'deny-all';
        } catch {
          s.robots = 'deny-all';
        }
      })();
    }
    await s.robotsLoading;
  }

  /** robots.txt verdict for a URL (loads robots.txt on first use per host). */
  async isAllowed(url: string): Promise<boolean> {
    const u = new URL(url);
    const s = this.state(u.host);
    await this.loadRobots(u.origin, s);
    if (s.robots === 'allow-all') return true;
    if (s.robots === 'deny-all' || !s.robots) return false;
    return s.robots.isAllowed(url, this.o.userAgent) !== false;
  }

  async sitemaps(origin: string): Promise<string[]> {
    const s = this.state(new URL(origin).host);
    await this.loadRobots(new URL(origin).origin, s);
    return s.robots && typeof s.robots === 'object' ? s.robots.getSitemaps() : [];
  }

  private delayFor(host: string): number {
    const s = this.state(host);
    const cd = s.robots && typeof s.robots === 'object' ? s.robots.getCrawlDelay(this.o.userAgent) : undefined;
    return Math.max(this.o.minDelayMs, cd ? Math.min(cd * 1000, this.o.maxDelayMs) : 0);
  }

  isBlocked(host: string): boolean {
    return this.state(host).blocked;
  }

  /** GET a URL, serialized per host and spaced by the crawl delay. */
  async get(url: string, accept = 'text/html,application/xhtml+xml'): Promise<FetchResult> {
    const u = new URL(url);
    const s = this.state(u.host);
    if (!(await this.isAllowed(url))) throw new DisallowedError(url);
    const run = async (): Promise<FetchResult> => {
      if (s.blocked) throw new HostBlockedError(u.host);
      for (let attempt = 0; ; attempt++) {
        const wait = s.nextAt - this.o.now();
        if (wait > 0) await this.o.sleep(wait);
        s.nextAt = this.o.now() + this.delayFor(u.host);
        const r = await this.o.fetch(url, {
          headers: { 'User-Agent': this.o.userAgent, Accept: accept, 'Accept-Language': 'en-US' },
          redirect: 'follow',
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
        if (r.status === 429 || r.status === 503) {
          s.refusals++;
          const retryAfter = Number(r.headers.get('retry-after'));
          if (s.refusals >= this.o.blockAfter) s.blocked = true;
          if (attempt === 0 && !s.blocked) {
            s.nextAt = this.o.now() + Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 30000, 120000);
            continue;
          }
          return { url: r.url || url, status: r.status, contentType: '', body: '', raw: Buffer.alloc(0) };
        }
        if (r.status === 403) {
          s.refusals++;
          if (s.refusals >= this.o.blockAfter) s.blocked = true;
        } else if (r.ok) {
          s.refusals = 0;
        }
        const contentType = r.headers.get('content-type') ?? '';
        const len = Number(r.headers.get('content-length') ?? 0);
        const raw = r.ok && len <= this.o.maxBytes ? await readCapped(r, this.o.maxBytes) : Buffer.alloc(0);
        return { url: r.url || url, status: r.status, contentType, body: raw.toString('utf8'), raw };
      }
    };
    const p = s.chain.then(run, run);
    s.chain = p.catch(() => undefined);
    return p;
  }
}

async function readCapped(r: Response, maxBytes: number): Promise<Buffer> {
  if (!r.body) return Buffer.alloc(0);
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return Buffer.alloc(0);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
