import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { localUrl } from './local-url.mjs';

const require = createRequire(import.meta.url);
const env = { ...process.env };
delete env.DOCKER_HOST;
delete env.NODE_OPTIONS;

if (!process.argv.includes('--list')) {
  const stack = resolve(env.ERP_E2E_SUPABASE_WORKDIR || 'test-results/erp-supabase');
  const config = readFileSync(resolve(stack, 'supabase/config.toml'), 'utf8');
  if (!/^project_id\s*=\s*"nictech-erp-e2e"\s*$/m.test(config)) {
    throw new Error('El E2E sólo puede ejecutarse con el proyecto descartable nictech-erp-e2e.');
  }
  const status = spawnSync(process.execPath, [
    require.resolve('supabase/dist/supabase.js'), 'status', '-o', 'env',
    '--workdir', stack,
  ], {
    encoding: 'utf8', env, timeout: 60_000,
  });
  if (status.status !== 0) {
    throw new Error('No se pudo obtener el estado de Supabase local. Ejecutá npx supabase start primero.');
  }
  const variables = new Map(Array.from(status.stdout.matchAll(/^([A-Z_]+)="([^"\r\n]*)"\r?$/gm),
    ([, name, value]) => [name, value]));
  const api = localUrl(variables.get('API_URL'), 'Supabase API');
  const db = localUrl(variables.get('DB_URL'), 'Postgres', ['postgres:', 'postgresql:']);
  if (api.protocol !== 'http:' || api.port !== '55421' || db.port !== '55422') {
    throw new Error('El ERP E2E sólo acepta los puertos locales 55421 (API) y 55422 (Postgres).');
  }
  const anon = variables.get('ANON_KEY') || variables.get('PUBLISHABLE_KEY');
  const service = variables.get('SERVICE_ROLE_KEY') || variables.get('SECRET_KEY');
  if (!anon || !service) throw new Error('Supabase local no devolvió claves pública y de servicio.');
  Object.assign(env, {
    ERP_E2E_API: api.origin, ERP_E2E_DB: db.href,
    ERP_E2E_ANON: anon, ERP_E2E_SERVICE: service,
  });
}

const result = spawnSync(process.execPath, [
  require.resolve('@playwright/test/cli'), 'test', '--config=playwright.erp.config.ts',
  ...process.argv.slice(2),
], { stdio: 'inherit', env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
