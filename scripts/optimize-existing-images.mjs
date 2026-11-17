/**
 * Optimiza in situ las imágenes pesadas del bucket `product_images`.
 *
 * Para cada objeto > MIN_KB (PNG/JPG): lo descarga, hace un backup local,
 * lo redimensiona a 1200px, lo convierte a WebP y lo sube pisando el MISMO
 * path (así no hay que tocar ninguna URL guardada en la base). El
 * content-type queda en image/webp y el cache en 1 año.
 *
 * Uso (dry-run por defecto, no modifica nada):
 *   npm i -D sharp
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/optimize-existing-images.mjs
 *
 * Para aplicar de verdad, agregar --apply. Los originales quedan en
 * ./image-backup/ (no se suben a git).
 */
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BUCKET = 'product_images';
const MIN_KB = 300;
const MAX_DIM = 1200;
const QUALITY = 82;
const APPLY = process.argv.includes('--apply');
const BACKUP_DIR = 'image-backup';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function listAll() {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage.from(BUCKET).list('', { limit: 100, offset });
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data.filter((o) => o.id));
  }
  return out;
}

const objects = await listAll();
const heavy = objects.filter(
  (o) => (o.metadata?.size ?? 0) > MIN_KB * 1024 && /^image\/(png|jpe?g)$/.test(o.metadata?.mimetype ?? ''),
);
console.log(`${heavy.length} imágenes > ${MIN_KB} KB de ${objects.length} en total. Modo: ${APPLY ? 'APLICAR' : 'dry-run'}`);

let savedBytes = 0;
await mkdir(BACKUP_DIR, { recursive: true });

for (const obj of heavy) {
  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(obj.name);
  if (dlErr) { console.error('download', obj.name, dlErr.message); continue; }

  const original = Buffer.from(await blob.arrayBuffer());
  const maxDim = obj.name.startsWith('banner_') ? 1920 : MAX_DIM;
  const webp = await sharp(original)
    .rotate()
    .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();

  if (webp.length >= original.length) { console.log('skip (no mejora)', obj.name); continue; }

  const saved = original.length - webp.length;
  savedBytes += saved;
  console.log(`${obj.name}: ${(original.length / 1048576).toFixed(2)} MB -> ${(webp.length / 1048576).toFixed(2)} MB`);
  if (!APPLY) continue;

  await writeFile(path.join(BACKUP_DIR, obj.name.replace(/[\\/]/g, '_')), original);
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(obj.name, webp, { upsert: true, contentType: 'image/webp', cacheControl: '31536000' });
  if (upErr) console.error('upload', obj.name, upErr.message);
}

console.log(`Ahorro total: ${(savedBytes / 1048576).toFixed(1)} MB por descarga completa del catálogo.`);
