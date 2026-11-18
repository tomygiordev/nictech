import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import type { ErpDatabase } from '../../apps/erp/src/lib/supabase';
import type { Database as StorefrontDatabase } from '../../src/integrations/supabase/types';
import { localUrl } from './local-url.mjs';

export const organizationId = '10000000-0000-0000-0000-000000000001';

export const apiUrl = () => localUrl(process.env.ERP_E2E_API, 'Supabase API');

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}; usá npm run test:e2e:erp.`);
  return value;
}

const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: ((input, init) => {
    const target = localUrl(input instanceof Request ? input.url : String(input), 'Petición Supabase');
    if (target.origin !== apiUrl().origin) throw new Error('Origen Supabase no coincide con la API local.');
    return fetch(input, { ...init, redirect: 'error' });
  }) satisfies typeof fetch },
};

export const localClient = (key: 'ERP_E2E_ANON' | 'ERP_E2E_SERVICE' = 'ERP_E2E_ANON') =>
  createClient<ErpDatabase>(apiUrl().origin, env(key), options);

export const publicClient = () => createClient<StorefrontDatabase>(apiUrl().origin, env('ERP_E2E_ANON'), options);

export function sqlRows<T>(select: string): T[] {
  return JSON.parse(sql(`select coalesce(json_agg(row_to_json(q)), '[]') from (${select}) q;`)) as T[];
}

export function sql(statement: string): string {
  const db = localUrl(process.env.ERP_E2E_DB, 'Postgres', ['postgres:', 'postgresql:']);
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  const result = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8', timeout: 25_000,
    env: {
      ...childEnv,
      PGHOST: db.hostname,
      PGPORT: db.port,
      PGUSER: decodeURIComponent(db.username),
      PGPASSWORD: decodeURIComponent(db.password),
      PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
      PGCLIENTENCODING: 'UTF8',
      PGSSLMODE: 'disable',
      PGCONNECT_TIMEOUT: '5',
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Consulta SQL local: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";

export function account(kind: 'OWNER' | 'NOROLE') {
  return {
    email: `e2e-${kind.toLowerCase()}@nictech.test`,
    password: env(`ERP_E2E_${kind}_PASSWORD`),
    id: env(`ERP_E2E_${kind}_ID`),
  };
}

export async function ownerClient() {
  const client = localClient();
  const { email, password } = account('OWNER');
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Auth owner local: ${error.message}`);
  return client;
}
