import {defineConfig} from 'vitest/config';

// Only this project's tests; vendor/tm ships its own suite. The setup stops early, with instructions, when the
// card and board data have not been fetched (npm run fetch-data).
export default defineConfig({
  test: {include: ['tests/**/*.test.ts'], globalSetup: ['tests/setup-data.ts']},
});
