import 'dotenv/config';

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://wt:wt@localhost:5432/winetracker',
  port: Number(process.env.PORT ?? 5000),
  llmProvider: (process.env.LLM_PROVIDER ?? 'gemini') as 'gemini' | 'none',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? '',
  crawlerUserAgent:
    process.env.CRAWLER_USER_AGENT ??
    'WineTrackerBot/0.1 (+https://github.com/rohanatstanford/WineTracker)',
};
