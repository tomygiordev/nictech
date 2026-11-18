import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4181';
const label = process.env.ERP_E2E_RUN_LABEL;
if (label && !/^[a-z0-9-]+$/.test(label)) throw new Error('ERP_E2E_RUN_LABEL no es válido.');
const artifactName = label ? `erp-${label}` : 'erp';

export default defineConfig({
  testDir: './e2e/erp',
  testMatch: '**/*.spec.ts',
  outputDir: `test-results/${artifactName}-artifacts`,
  globalSetup: './e2e/erp/global-setup.ts',
  reporter: [
    ['list'],
    ['json', { outputFile: `test-results/${artifactName}.json` }],
  ],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 70_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1366, height: 768 },
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    actionTimeout: 10_000,
    navigationTimeout: 50_000,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev --workspace @nictech/erp -- --config vite.e2e.config.ts --host 127.0.0.1 --port 4181 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_SUPABASE_URL: process.env.ERP_E2E_API ?? '',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.ERP_E2E_ANON ?? '',
      ERP_E2E_DB: '',
      ERP_E2E_SERVICE: '',
    },
  },
});
