import test from 'node:test';
import assert from 'node:assert/strict';
import { instaladorGestor, arquivoAtualizacaoGestor, GESTOR_RELEASE } from '../shared/gestor-releases.js';

test('downloads e feed apontam para a mesma release, sem aceitar arquivos arbitrários', () => {
  for (const [platform, file] of [['windows', 'servidor-doixp-windows-x64.exe'], ['linux', 'servidor-doixp-linux-x86_64.AppImage'], ['android', 'servidor-doixp-android.apk']]) {
    assert.equal(instaladorGestor(`gestor-${platform}`), GESTOR_RELEASE + file);
    assert.equal(arquivoAtualizacaoGestor(file), instaladorGestor(`gestor-${platform}`));
  }
  for (const file of ['latest.yml', 'latest-linux.yml', 'android.json', 'SHA256SUMS.txt', 'servidor-doixp-windows-x64.exe.blockmap']) assert.equal(arquivoAtualizacaoGestor(file), GESTOR_RELEASE + file);
  for (const file of ['../latest.yml', 'https://evil.test', 'android.json?redirect=evil', 'app.exe', '__proto__']) assert.equal(arquivoAtualizacaoGestor(file), null);
  assert.equal(instaladorGestor('unknown'), null);
});
