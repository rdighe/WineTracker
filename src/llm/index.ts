import { config } from '../config.js';
import { GeminiProvider } from './gemini.js';
import { ProviderUnavailableError, type LlmProvider } from './types.js';

export * from './types.js';

/** Provider used when none is configured: every call fails, callers fall back. */
export class NullProvider implements LlmProvider {
  readonly name = 'none';
  async readLabel(): Promise<never> {
    throw new ProviderUnavailableError();
  }
  async searchPrices(): Promise<never> {
    throw new ProviderUnavailableError();
  }
}

export function createProvider(): LlmProvider {
  if (config.llmProvider === 'gemini' && config.geminiApiKey) {
    return new GeminiProvider({ apiKey: config.geminiApiKey, model: config.geminiModel || undefined });
  }
  return new NullProvider();
}
