// Executado depois de receber todos os artefatos, antes de publicar a release.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { GESTOR_VERSION, GESTOR_ANDROID_CODE, GESTOR_RELEASE } from '../shared/gestor-releases.js';

const directory = process.argv[2];
if (!directory) throw new Error('Informe o diretório dos instaladores');
const desktop = JSON.parse(await fs.readFile(new URL('../gestor-impressora/package.json', import.meta.url), 'utf8'));
const android = await fs.readFile(new URL('../gestor-android/app/build.gradle.kts', import.meta.url), 'utf8');
if (desktop.version !== GESTOR_VERSION || !android.includes(`versionName = "${GESTOR_VERSION}"`) || !android.includes(`versionCode = ${GESTOR_ANDROID_CODE}\n`)) {
  throw new Error('As versões do site, desktop e Android precisam coincidir');
}
for (const [metadata, filename] of [
  ['latest.yml', 'servidor-doixp-windows-x64.exe'],
  ['latest-linux.yml', 'servidor-doixp-linux-x86_64.AppImage'],
]) {
  const content = await fs.readFile(path.join(directory, metadata), 'utf8');
  const binary = await fs.readFile(path.join(directory, filename));
  const checksum = crypto.createHash('sha512').update(binary).digest('base64');
  if (!content.includes(`version: ${GESTOR_VERSION}`) || !content.includes(filename) || !content.includes(checksum)) {
    throw new Error(`Metadados de atualização inválidos: ${metadata}`);
  }
}
await fs.access(path.join(directory, 'servidor-doixp-windows-x64.exe.blockmap'));
const apk = await fs.readFile(path.join(directory, 'servidor-doixp-android.apk'));
await fs.writeFile(path.join(directory, 'android.json'), JSON.stringify({
  version: GESTOR_VERSION, versionCode: GESTOR_ANDROID_CODE,
  url: `${GESTOR_RELEASE}servidor-doixp-android.apk`,
  sha256: crypto.createHash('sha256').update(apk).digest('hex'), size: apk.length,
}, null, 2) + '\n');
console.log(`Instaladores ${GESTOR_VERSION} validados e manifesto Android preparado.`);
