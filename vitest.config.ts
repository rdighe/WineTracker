import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // DB-backed test files share one database, so run files one at a time.
    fileParallelism: false,
    // Tests assume defaults, whatever a developer's .env says.
    env: { PRICE_WEB_SEARCH: 'true' },
  },
});
