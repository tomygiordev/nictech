import { defineConfig } from '@playwright/test';

const remote = process.env.E2E_BASE_URL;
const baseURL = remote || 'http://127.0.0.1:4173';
const target = remote ? 'remoto' : 'preview';

export default defineConfig({
  testDir: './e2e/tienda',
  outputDir: `test-results/tienda-${target}`,
  reporter: [
    ['list'],
    ['json', { outputFile: `test-results/tienda-${target}.json` }],
    ['html', { outputFolder: `playwright-report/tienda-${target}`, open: 'never' }],
  ],
  workers: 1,
  retries: 1,
  timeout: 45_000,
  expect: { timeout: 6_000 },
  use: {
    baseURL,
    browserName: 'chromium',
    serviceWorkers: 'block',
    actionTimeout: 8_000,
    navigationTimeout: 20_000,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    } },
  ],
  webServer: remote ? undefined : {
    command: 'npm run preview -- --config e2e/tienda/vite.config.ts --host 127.0.0.1 --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 45_000,
  },
});
