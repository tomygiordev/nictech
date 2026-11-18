import { configDefaults, defineConfig } from 'vitest/config';
import rootConfig from '../../vitest.config';

export default defineConfig({
  ...rootConfig,
  envDir: false,
  define: {
    'import.meta.env.VITE_SUPABASE_URL': 'undefined',
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': 'undefined',
  },
  test: {
    ...rootConfig.test,
    include: ['apps/erp/src/**/*.test.{ts,tsx}', 'e2e/erp/*.test.ts'],
    exclude: configDefaults.exclude,
  },
});
