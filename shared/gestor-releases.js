// Alterar somente quando os três instaladores e seus manifestos estiverem publicados.
export const GESTOR_VERSION = '1.5.20';
export const GESTOR_ANDROID_CODE = 33;
export const GESTOR_RELEASE = `https://github.com/brendomyranda-max/Simplesx-deploy/releases/download/gestor-v${GESTOR_VERSION}/`;

const instaladores = {
  'gestor-windows': 'servidor-doixp-windows-x64.exe',
  'gestor-linux': 'servidor-doixp-linux-x86_64.AppImage',
  'gestor-android': 'servidor-doixp-android.apk',
};
const arquivosAtualizacao = new Set([
  ...Object.values(instaladores),
  'servidor-doixp-windows-x64.exe.blockmap',
  'latest.yml', 'latest-linux.yml', 'android.json',
]);

export function instaladorGestor(sistema) {
  return Object.hasOwn(instaladores, sistema) ? GESTOR_RELEASE + instaladores[sistema] : null;
}

export function arquivoAtualizacaoGestor(arquivo) {
  return arquivosAtualizacao.has(arquivo) ? GESTOR_RELEASE + arquivo : null;
}
