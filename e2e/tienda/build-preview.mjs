import { spawnSync } from 'node:child_process';

const site = 'https://www.nictech.com.ar';
const ref = 'qatkzvlomuaoaxlfgjfa';
const supabase = `https://${ref}.supabase.co`;

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

function isPublicKey(key) {
  if (key.startsWith('sb_publishable_')) return true;
  try {
    const info = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    return info.role === 'anon' && info.ref === ref;
  } catch {
    return false;
  }
}

const html = await read(site);
const asset = html.match(/["'](\/assets\/index-[^"'\s/]+\.js)["']/)?.[1];
if (!asset) throw new Error('No se encontró el bundle principal publicado.');
const bundle = await read(new URL(asset, site));
if (!bundle.includes(supabase)) throw new Error('El bundle no usa el proyecto Supabase esperado.');
const keyPattern = /sb_publishable_[\w-]+|eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g;
const candidates = [...new Set([...bundle.matchAll(keyPattern)].map(([key]) => key).filter(isPublicKey))];
if (candidates.length !== 1) throw new Error('No se pudo identificar una única key pública de Supabase.');

const key = candidates[0];
const preflight = await fetch(`${supabase}/rest/v1/products?select=id&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(20_000),
});
if (!preflight.ok) throw new Error(`La key del bundle publicado no pudo leer el catálogo (HTTP ${preflight.status}).`);
await preflight.body?.cancel();

const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^VITE_/i.test(name))),
  VITE_SUPABASE_URL: supabase,
  VITE_SUPABASE_PUBLISHABLE_KEY: key,
};
const child = spawnSync('npm run build -- --config e2e/tienda/vite.config.ts', {
  shell: true, stdio: 'inherit', env,
});
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
