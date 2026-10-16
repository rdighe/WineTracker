import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FREE_MODELS, OpenRouterProvider } from '../src/llm/openrouter.js';
import { ProviderUnavailableError } from '../src/llm/types.js';

function reply(content: string, status = 200) {
  return new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content } }] } : { error: { message: content } }), { status });
}
const modelOf = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body).model;

describe('OpenRouterProvider', () => {
  it('sends the label as an image to the first free model and sanitizes the reply', async () => {
    const fetch = vi.fn().mockResolvedValue(reply('{"producer":"Ridge","name":"Monte Bello","vintage":"2019","colour":"Red","confidence":0.9}'));
    const p = new OpenRouterProvider({ apiKey: 'k', fetch });
    const r = await p.readLabel(Buffer.from('img'), 'image/jpeg');
    expect(r).toMatchObject({ producer: 'Ridge', name: 'Monte Bello', vintage: '2019', colour: 'red' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body);
    expect(body.model).toBe(DEFAULT_FREE_MODELS[0]);
    expect(body.messages[0].content[1].image_url.url).toBe(`data:image/jpeg;base64,${Buffer.from('img').toString('base64')}`);
  });

  it('moves on when a free model is rate limited or replies with junk, then remembers the one that worked', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply('Rate limit exceeded', 429))
      .mockResolvedValueOnce(reply('sorry, I cannot read this'))
      .mockImplementation(async () => reply('{"producer":"Ridge","confidence":0.8}'));
    const p = new OpenRouterProvider({ apiKey: 'k', fetch, model: 'my/model:free' });
    expect((await p.readLabel(Buffer.from('img'), 'image/png')).producer).toBe('Ridge');
    expect(fetch.mock.calls.map(modelOf)).toEqual(['my/model:free', DEFAULT_FREE_MODELS[0], DEFAULT_FREE_MODELS[1]]);
    await p.readLabel(Buffer.from('img'), 'image/png');
    expect(modelOf(fetch.mock.calls[3]!)).toBe(DEFAULT_FREE_MODELS[1]);
  });

  it('stops at once on a bad key', async () => {
    const fetch = vi.fn().mockResolvedValue(reply('No auth credentials found', 401));
    const p = new OpenRouterProvider({ apiKey: 'bad', fetch });
    await expect(p.readLabel(Buffer.from('img'), 'image/jpeg')).rejects.toThrow(/401: No auth credentials/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('has no price search', async () => {
    await expect(new OpenRouterProvider({ apiKey: 'k', fetch: vi.fn() }).searchPrices()).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
