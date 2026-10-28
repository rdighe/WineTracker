import { config } from '../config.js';
import { GeminiProvider } from './gemini.js';
import { OpenRouterProvider } from './openrouter.js';
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

/**
 * What reads flavors from people's own tasting notes on the server, when the
 * phone can't: OpenRouter's free models whenever its key is set (whatever
 * LLM_PROVIDER says), else nothing - the profile then uses keywords.
 */
export function createNoteProvider(): LlmProvider | null {
  return config.openrouterApiKey ? new OpenRouterProvider({ apiKey: config.openrouterApiKey, model: config.openrouterModel || undefined }) : null;
}

export function createProvider(): LlmProvider {
  const gemini = () => new GeminiProvider({ apiKey: config.geminiApiKey, model: config.geminiModel || undefined });
  const openrouter = () =>
    new OpenRouterProvider({ apiKey: config.openrouterApiKey, model: config.openrouterModel || undefined });
  if (config.llmProvider === 'none') return new NullProvider();
  // The chosen provider if its key is set, otherwise whichever key is set (Gemini first), so switching
  // LLM_PROVIDER before its key is added keeps the other provider working.
  if (config.llmProvider === 'openrouter' && config.openrouterApiKey) return openrouter();
  if (config.geminiApiKey) return gemini();
  if (config.openrouterApiKey) return openrouter();
  return new NullProvider();
}
