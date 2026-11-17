import { defineConfig } from 'vitest/config';

// Testes do Site (vitest, como nos demais sistemas). Rodam o TypeScript direto de src/.
// Os dois arquivos que usam subtestes e Postgres embutido (eliminacao-comercial e integracao-feed) continuam em node:test (script test:db).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/eliminacao-comercial.test.ts', 'src/integracao-feed.test.ts', '**/node_modules/**', 'dist/**'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
