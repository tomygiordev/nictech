import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishErp, setErpVersion, validateVersion } from './release-erp.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'nictech-release-'));
  t.after(() => {
    const resolvedRoot = path.resolve(root);
    const resolvedTemp = path.resolve(tmpdir());
    assert.equal(path.dirname(resolvedRoot), resolvedTemp);
    assert.equal(path.basename(resolvedRoot).startsWith('nictech-release-'), true);
    rmSync(resolvedRoot, { recursive: true, force: true });
  });
  mkdirSync(path.join(root, 'apps/erp'), { recursive: true });
  const manifest = { name: '@nictech/erp', version: '0.1.0', private: true };
  const lock = { version: '0.0.0', packages: { '': { version: '0.0.0' }, 'apps/erp': { version: '0.1.0' }, 'packages/domain': { version: '9.0.0' } } };
  writeFileSync(path.join(root, 'apps/erp/package.json'), JSON.stringify(manifest, null, 2).replaceAll('\n', '\r\n') + '\r\n');
  writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  return root;
}

function fakeGit(overrides = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    const command = args[0];
    const defaults = {
      remote: { status: 0, stdout: 'https://github.com/tomygiordev/nictech.git\n' },
      branch: { status: 0, stdout: 'dev/erp\n' },
      status: { status: 0, stdout: '' },
      'show-ref': { status: 1, stdout: '' },
      'ls-remote': { status: 2, stdout: '' },
      push: { status: 0, stdout: '' },
      tag: { status: 0, stdout: '' },
    };
    return typeof overrides[command] === 'function' ? overrides[command](args) : (overrides[command] ?? defaults[command]);
  };
  return { git, calls };
}

test('la versión modifica solamente el ERP y preserva el formato de cada JSON', (t) => {
  const root = fixture(t);
  setErpVersion(root, '1.2.3');
  const manifestText = readFileSync(path.join(root, 'apps/erp/package.json'), 'utf8');
  const lockText = readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  assert.deepEqual(JSON.parse(manifestText), { name: '@nictech/erp', version: '1.2.3', private: true });
  assert.deepEqual(JSON.parse(lockText), { version: '0.0.0', packages: { '': { version: '0.0.0' }, 'apps/erp': { version: '1.2.3' }, 'packages/domain': { version: '9.0.0' } } });
  assert.equal(manifestText.replaceAll('\r\n', '').includes('\n'), false);
  assert.equal(lockText.includes('\r'), false);
});

test('rechaza versiones ambiguas o con argumentos de shell', () => {
  for (const version of ['01.2.3', '1.2', '1.2.3-beta', '1.2.3\n', '1.2.3; git push', undefined]) {
    assert.throws(() => validateVersion(version));
  }
});

test('publica la rama antes de crear y subir un tag anotado, sin fuerza ni commits', (t) => {
  const fake = fakeGit();
  assert.deepEqual(publishErp(fixture(t), fake.git), { version: '0.1.0', branch: 'dev/erp', tag: 'erp-v0.1.0' });
  assert.deepEqual(fake.calls.slice(-3), [
    ['push', 'origin', 'HEAD'],
    ['tag', '-a', 'erp-v0.1.0', '-m', 'NicTech ERP 0.1.0'],
    ['push', 'origin', 'refs/tags/erp-v0.1.0'],
  ]);
});

test('las guardas rechazan origen ajeno, fuentes sucias, detached HEAD y tags existentes antes de subir', (t) => {
  const root = fixture(t);
  for (const overrides of [
    { remote: { status: 0, stdout: 'https://github.com/other/repo.git' } },
    { branch: { status: 0, stdout: '' } },
    { status: { status: 0, stdout: ' M apps/erp/package.json' } },
    { 'show-ref': { status: 0, stdout: '' } },
    { 'ls-remote': { status: 0, stdout: 'abc refs/tags/erp-v0.1.0' } },
    { 'ls-remote': { status: 128, stdout: '' } },
  ]) {
    const fake = fakeGit(overrides);
    assert.throws(() => publishErp(root, fake.git));
    assert.equal(fake.calls.some(([command]) => command === 'push' || command === 'tag'), false);
  }
});

test('no etiqueta si falla el push de rama y conserva instrucciones para recuperar un push de tag fallido', (t) => {
  const root = fixture(t);
  const failedBranch = fakeGit({ push: { status: 1, stdout: '' } });
  assert.throws(() => publishErp(root, failedBranch.git), /No se creó el tag/);
  assert.equal(failedBranch.calls.some(([command]) => command === 'tag'), false);
  const failedTag = fakeGit({ push: (args) => ({ status: args[2] === 'HEAD' ? 0 : 1, stdout: '' }) });
  assert.throws(() => publishErp(root, failedTag.git), /tag local erp-v0\.1\.0 se conservó[\s\S]*git push origin refs\/tags\/erp-v0\.1\.0/);
});
