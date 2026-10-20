import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releasePaths = [
  'apps/erp/src', 'apps/erp/electron', 'apps/erp/public', 'apps/erp/docs',
  'apps/erp/index.html', 'apps/erp/package.json', 'apps/erp/vite.config.ts',
  'apps/erp/tsconfig.json', 'packages/domain', 'src/test/setup.ts',
  '.github/workflows/erp-release.yml', 'scripts/release-erp.mjs', 'scripts/release-erp.test.mjs',
  'package.json', 'package-lock.json', '.npmrc', 'patches',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'vitest.config.ts',
];

export function validateVersion(version) {
  if (typeof version !== 'string' || version !== version.trim() || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('La versión debe tener formato X.Y.Z, por ejemplo 0.1.1.');
  }
  return version;
}

function loadVersionFiles(root) {
  const packagePath = path.join(root, 'apps/erp/package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const packageText = readFileSync(packagePath, 'utf8');
  const lockText = readFileSync(lockPath, 'utf8');
  const manifest = JSON.parse(packageText);
  const lock = JSON.parse(lockText);
  if (!lock.packages?.['apps/erp']) {
    throw new Error('El lockfile no contiene el workspace apps/erp. Ejecutá npm install antes de preparar la versión.');
  }
  return { packagePath, lockPath, packageText, lockText, manifest, lock };
}

function serializeLike(original, value) {
  const indentation = original.match(/\n([\t ]+)"/)?.[1] ?? '  ';
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const trailing = original.endsWith('\n') ? eol : '';
  return JSON.stringify(value, null, indentation).replaceAll('\n', eol) + trailing;
}

export function setErpVersion(root, version) {
  validateVersion(version);
  const files = loadVersionFiles(root);
  files.manifest.version = version;
  files.lock.packages['apps/erp'].version = version;
  writeFileSync(files.packagePath, serializeLike(files.packageText, files.manifest));
  writeFileSync(files.lockPath, serializeLike(files.lockText, files.lock));
  return version;
}

function runGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  if (result.error) throw new Error(`No se pudo ejecutar Git: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function requireSuccess(result, message) {
  if (result.status !== 0) throw new Error(message);
  return result.stdout.trim();
}

export function publishErp(root, git = (args) => runGit(root, args)) {
  const files = loadVersionFiles(root);
  const version = validateVersion(files.manifest.version);
  if (files.lock.packages['apps/erp'].version !== version) {
    throw new Error('La versión del ERP difiere del lockfile. Ejecutá npm run version:erp -- X.Y.Z y guardá ambos archivos en un commit.');
  }
  const origin = requireSuccess(git(['remote', 'get-url', 'origin']), 'Falta configurar el remoto origin.');
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)tomygiordev\/nictech(?:\.git)?\/?$/i.test(origin)) {
    throw new Error('origin debe apuntar al repositorio GitHub tomygiordev/nictech. No se subió ningún cambio.');
  }
  const branch = requireSuccess(git(['branch', '--show-current']), 'No se pudo consultar la rama actual.');
  if (!branch) throw new Error('El repositorio está en detached HEAD. Cambiá a la rama que querés entregar.');
  const status = requireSuccess(git(['status', '--porcelain', '--untracked-files=all', '--', ...releasePaths]), 'No se pudo comprobar el estado de las fuentes de entrega.');
  if (status) {
    throw new Error(`Guardá las fuentes de la entrega en un commit antes de publicarla:\n${status}`);
  }
  const tag = `erp-v${version}`;
  const localTag = git(['show-ref', '--verify', '--quiet', `refs/tags/${tag}`]);
  if (localTag.status === 0) throw new Error(`Ya existe el tag local ${tag}. Usá una versión nueva o revisá la entrega pendiente; no se reemplazan tags.`);
  if (localTag.status !== 1) throw new Error('No se pudo comprobar si el tag ya existe localmente.');
  const remoteTag = git(['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`]);
  if (remoteTag.status === 0) throw new Error(`Ya existe el tag remoto ${tag}. Usá una versión nueva; no se reemplazan versiones.`);
  if (remoteTag.status !== 2) throw new Error('No se pudo consultar GitHub. Comprobá la conexión y la autenticación de Git antes de publicar.');
  requireSuccess(git(['push', 'origin', 'HEAD']), 'No se pudo subir la rama. No se creó el tag; revisá la conexión, los permisos y los cambios remotos.');
  requireSuccess(git(['tag', '-a', tag, '-m', `NicTech ERP ${version}`]), 'La rama se subió, pero no se pudo crear el tag local. Revisá la identidad y la firma configuradas en Git.');
  const pushedTag = git(['push', 'origin', `refs/tags/${tag}`]);
  if (pushedTag.status !== 0) {
    throw new Error(`La rama se subió y el tag local ${tag} se conservó, pero GitHub no recibió el tag. Revisá el error de conexión o permisos y reintentá con:\ngit push origin refs/tags/${tag}\nPara consultar si llegó: git ls-remote --tags origin refs/tags/${tag}`);
  }
  return { version, branch, tag };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, version, ...extra] = process.argv.slice(2);
    if (command === 'version' && version && extra.length === 0) {
      setErpVersion(repositoryRoot, version);
      console.log(`ERP actualizado a ${version}. Revisá package.json y package-lock.json y guardalos en un commit antes de entregar.`);
    } else if (command === 'publish' && !version && extra.length === 0) {
      const result = publishErp(repositoryRoot);
      console.log(`Subidos ${result.branch} y ${result.tag}. GitHub Actions preparará los instaladores y la Release en borrador.`);
      console.log('Seguí la ejecución en https://github.com/tomygiordev/nictech/actions/workflows/erp-release.yml');
    } else {
      throw new Error('Uso: npm run version:erp -- X.Y.Z | npm run release:erp');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
