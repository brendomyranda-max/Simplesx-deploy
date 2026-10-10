/**
 * Arquivo: pda-plataforma.js
 * Responsabilidade: Identifica o sistema do PDA e explica a instalação em tela cheia.
 */

export const SISTEMAS_PDA = [
  { id: 'windows', nome: 'Windows', onde: 'Chrome ou Edge' },
  { id: 'linux', nome: 'Linux', onde: 'Chrome ou Edge' },
  { id: 'android', nome: 'Android', onde: 'Chrome' },
];

export function detectarPlataforma(ua) {
  const texto = String(ua || '');
  if (/android/i.test(texto)) return 'android';
  if (/iphone|ipad|ipod/i.test(texto)) return 'ios';
  if (/windows/i.test(texto)) return 'windows';
  if (/linux|x11/i.test(texto)) return 'linux';
  return 'outro';
}

export function navegadorCompativel(ua) {
  const texto = String(ua || '');
  if (/firefox|fxios/i.test(texto)) return false;
  if (/edg\//i.test(texto)) return true;
  if (/samsungbrowser/i.test(texto)) return true;
  if (/opr\/|opera/i.test(texto)) return true;
  if (/chrome|chromium|crios/i.test(texto)) return true;
  return false;
}

export function passosInstalacao(plataforma, ua) {
  const edge = /edg\//i.test(String(ua || ''));
  if (plataforma === 'android') {
    return [
      'Abra este site no Chrome do celular ou do tablet.',
      'Toque no menu e escolha Instalar app ou Adicionar à tela inicial.',
      'Confirme. O ícone da DoixP abre o sistema em tela cheia.',
    ];
  }
  if (plataforma === 'windows' || plataforma === 'linux') {
    const sistema = plataforma === 'windows' ? 'Windows' : 'Linux';
    if (edge) {
      return [
        `No Edge do ${sistema}, abra o menu e escolha Aplicativos.`,
        'Clique em Instalar este site como um aplicativo.',
        'O PDA abre em tela cheia, sem a barra do navegador.',
      ];
    }
    return [
      `No Chrome do ${sistema}, clique no ícone de instalar na barra de endereço.`,
      'Se o ícone não aparecer, abra o menu, depois Transmitir, salvar e compartilhar, e Instalar página como aplicativo.',
      'O PDA abre em tela cheia neste computador.',
    ];
  }
  if (plataforma === 'ios') {
    return [
      'No Safari, toque em Compartilhar.',
      'Escolha Adicionar à Tela de Início.',
      'Abra o ícone da DoixP para usar em tela cheia.',
    ];
  }
  return [
    'Abra este site no Chrome ou no Edge.',
    'No Windows e no Linux, use Chrome ou Edge. No Android, use o Chrome.',
    'Toque em Instalar PDA nesta tela.',
  ];
}
