import { defineConfig } from '@playwright/test';

/**
 * E2E smoke (README §7): boots the real API (in-memory DB) and the Vite dev
 * server, then walks registro → lección → práctica → progreso in Chromium.
 * The CV pipeline runs against the injected fake detector (no camera in CI).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5199',
  },
  webServer: [
    {
      // Puertos propios (D50): las pruebas corren aunque `npm run dev` esté abierto.
      command: 'npm run start -w @enlaza/api',
      url: 'http://localhost:3101/api/health',
      reuseExistingServer: false,
      env: { ENLAZA_DB_PATH: ':memory:', PORT: '3101' },
      timeout: 30_000,
    },
    {
      command: 'npm run dev -w @enlaza/web -- --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: false,
      env: { VITE_API_PROXY: 'http://localhost:3101' },
      timeout: 30_000,
    },
  ],
});
