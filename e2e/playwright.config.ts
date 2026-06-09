import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Testes ponta a ponta com navegadores reais.
 *
 * Pré-requisitos: `npm run build` (o servidor serve o client/dist) e
 * `npx playwright install chromium` na primeira execução.
 *
 * `workers: 1` é intencional: os testes compartilham um único servidor e o
 * matchmaking é global — execução serial evita que jogadores de testes
 * diferentes sejam pareados entre si.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8787',
    viewport: { width: 1280, height: 860 },
  },
  webServer: {
    command: 'npm start',
    cwd: resolve(__dirname, '..'),
    url: 'http://localhost:8787/api/health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
