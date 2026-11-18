import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve('supabase');
const target = resolve('test-results/erp-supabase/supabase');
mkdirSync(resolve(target, 'migrations'), { recursive: true });

function copy(file, edit = (text) => text) {
  // pg_get_functiondef patches compare multiline literals against LF bodies.
  const text = readFileSync(resolve(source, file), 'utf8').replace(/\r\n/g, '\n');
  writeFileSync(resolve(target, file), edit(text));
}

for (const name of readdirSync(resolve(source, 'migrations')).filter((name) => name.endsWith('.sql'))) {
  copy(`migrations/${name}`);
}
copy('seed.sql');
copy('config.toml', (text) => text
  .replace(/^project_id = "nictech-local"$/m, 'project_id = "nictech-erp-e2e"')
  .replace(/^\[functions\.[^\]]+\]\n(?:(?!^\[)[\s\S])*/gm, ''));
