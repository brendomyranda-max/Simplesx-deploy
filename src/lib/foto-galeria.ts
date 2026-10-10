/** Reduz uma foto da galeria para caber no catálogo do delivery. */

const LIMITE = 220_000;

export function fotoDaGaleria(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Escolha uma foto da galeria'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a foto'));
    reader.onload = () => {
      const imagem = new Image();
      imagem.onload = () => {
        const maior = Math.max(imagem.width, imagem.height) || 1;
        const escala = Math.min(1, 960 / maior);
        const tela = document.createElement('canvas');
        tela.width = Math.max(1, Math.round(imagem.width * escala));
        tela.height = Math.max(1, Math.round(imagem.height * escala));
        const contexto = tela.getContext('2d');
        if (!contexto) {
          reject(new Error('Não foi possível preparar a foto'));
          return;
        }
        contexto.drawImage(imagem, 0, 0, tela.width, tela.height);
        let qualidade = 0.72;
        let foto = tela.toDataURL('image/jpeg', qualidade);
        while (foto.length > LIMITE && qualidade > 0.42) {
          qualidade -= 0.08;
          foto = tela.toDataURL('image/jpeg', qualidade);
        }
        if (foto.length > LIMITE) {
          reject(new Error('A foto é grande demais. Escolha outra da galeria.'));
          return;
        }
        resolve(foto);
      };
      imagem.onerror = () => reject(new Error('Não foi possível abrir a foto'));
      imagem.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}
