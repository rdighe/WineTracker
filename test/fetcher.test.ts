import { describe, expect, it, vi } from 'vitest';
import { DisallowedError, HostBlockedError, PoliteFetcher } from '../src/prices/fetcher.js';

function fakeSite(robots: string | number, pages: Record<string, number> = {}) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = new URL(url instanceof Request ? url.url : String(url));
    if (u.pathname === '/robots.txt') {
      return typeof robots === 'number' ? new Response('', { status: robots }) : new Response(robots);
    }
    const status = pages[u.pathname] ?? 200;
    return new Response(status === 200 ? `<p>${u.pathname}</p>` : '', { status });
  });
}

function clock() {
  let t = 0;
  return { now: () => t, sleep: vi.fn(async (ms: number) => void (t += ms)) };
}

const UA = 'WineTrackerBot/0.1';

describe('PoliteFetcher', () => {
  it('obeys robots.txt disallow rules for its user agent', async () => {
    const f = new PoliteFetcher({ userAgent: UA, fetch: fakeSite('User-agent: *\nDisallow: /cart\n\nUser-agent: WineTrackerBot\nDisallow: /private'), ...clock() });
    expect(await f.isAllowed('https://shop.test/wine/1')).toBe(true);
    expect(await f.isAllowed('https://shop.test/private/x')).toBe(false);
    await expect(f.get('https://shop.test/private/x')).rejects.toBeInstanceOf(DisallowedError);
  });

  it('treats missing robots.txt as allowed and refused robots.txt as disallowed', async () => {
    expect(await new PoliteFetcher({ userAgent: UA, fetch: fakeSite(404), ...clock() }).isAllowed('https://a.test/x')).toBe(true);
    expect(await new PoliteFetcher({ userAgent: UA, fetch: fakeSite(403), ...clock() }).isAllowed('https://b.test/x')).toBe(false);
  });

  it('spaces requests by the larger of minDelay and Crawl-delay', async () => {
    const c = clock();
    const f = new PoliteFetcher({ userAgent: UA, minDelayMs: 1000, fetch: fakeSite('User-agent: *\nCrawl-delay: 5'), ...c });
    await f.get('https://shop.test/a');
    await f.get('https://shop.test/b');
    await f.get('https://shop.test/c');
    expect(c.sleep.mock.calls.map((x) => x[0])).toEqual([5000, 5000]);
  });

  it('gives up on a host that keeps refusing', async () => {
    const f = new PoliteFetcher({ userAgent: UA, blockAfter: 3, fetch: fakeSite('', { '/p': 403 }), ...clock() });
    for (let i = 0; i < 3; i++) expect((await f.get('https://shop.test/p')).status).toBe(403);
    await expect(f.get('https://shop.test/p')).rejects.toBeInstanceOf(HostBlockedError);
  });
});
