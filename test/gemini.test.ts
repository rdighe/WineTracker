import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../src/llm/gemini.js';

function reply(text: string, status = 200) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });
}

describe('GeminiProvider', () => {
  it('reads a label and sanitizes fields', async () => {
    const fetch = vi.fn().mockResolvedValue(
      reply('```json\n{"producer":"Château Lynch-Bages","name":"","vintage":"2015 ","region":"Pauillac","country":"France","grape":"","colour":"Red","bottle_ml":"750","raw_text":"Grand Cru Classé","confidence":0.92}\n```')
    );
    const p = new GeminiProvider({ apiKey: 'k', fetch });
    const r = await p.readLabel(Buffer.from('img'), 'image/jpeg');
    expect(r).toMatchObject({ producer: 'Château Lynch-Bages', vintage: '2015', colour: 'red', bottleMl: 750, confidence: 0.92 });
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.contents[0].parts[0].inline_data.mime_type).toBe('image/jpeg');
    expect(body.tools).toBeUndefined();
  });

  it('falls through to the next model on HTTP errors and remembers the working one', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply('', 404))
      .mockImplementation(async () => reply('[{"merchant":"Shop","url":"https://shop.example/w","price":"$59.99","vintage":"2019","in_stock":true}]'));
    const p = new GeminiProvider({ apiKey: 'k', fetch });
    const hits = await p.searchPrices({ displayName: 'Opus One', vintage: '2019' });
    expect(hits).toEqual([
      expect.objectContaining({ merchant: 'Shop', priceCents: 5999, vintage: '2019', packSize: 1, inStock: true, currency: 'USD' }),
    ]);
    expect(JSON.parse(fetch.mock.calls[1]![1].body).tools).toEqual([{ google_search: {} }]);
    await p.searchPrices({ displayName: 'Opus One', vintage: '2019' });
    expect(fetch.mock.calls[2]![0]).toBe(fetch.mock.calls[1]![0]);
  });

  it('retries a busy or rate-limited model once, then gives up without trying the others', async () => {
    const sleep = vi.fn(async () => {});
    const busyThenOk = vi.fn().mockResolvedValueOnce(reply('', 503)).mockResolvedValue(reply('{"producer":"Ridge","confidence":0.9}'));
    const p = new GeminiProvider({ apiKey: 'k', fetch: busyThenOk, sleep });
    expect((await p.readLabel(Buffer.from('img'), 'image/jpeg')).producer).toBe('Ridge');
    expect(busyThenOk).toHaveBeenCalledTimes(2);
    expect(busyThenOk.mock.calls[1]![0]).toBe(busyThenOk.mock.calls[0]![0]);

    const limited = vi.fn().mockResolvedValue(reply('', 429));
    await expect(new GeminiProvider({ apiKey: 'k', fetch: limited, sleep }).readLabel(Buffer.from('img'), 'image/jpeg')).rejects.toThrow('HTTP 429');
    expect(limited).toHaveBeenCalledTimes(2);

    const badKey = vi.fn().mockResolvedValue(reply('', 403));
    await expect(new GeminiProvider({ apiKey: 'k', fetch: badKey, sleep }).readLabel(Buffer.from('img'), 'image/jpeg')).rejects.toThrow('HTTP 403');
    expect(badKey).toHaveBeenCalledTimes(1);
  });

  it('drops invalid offers', async () => {
    const fetch = vi.fn().mockResolvedValue(
      reply('[{"merchant":"A","url":"not a url","price":10},{"merchant":"B","url":"https://b.example/x","price":0},{"merchant":"C","url":"javascript:alert(1)","price":20}]')
    );
    const p = new GeminiProvider({ apiKey: 'k', fetch });
    expect(await p.searchPrices({ displayName: 'X', vintage: null })).toEqual([]);
  });
});
