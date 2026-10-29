export interface PrintJobResult {
  ok: boolean;
  impressora: string;
  error?: string;
}

export function confirmarImpressao(jobs: PrintJobResult[] = []): string {
  if (!jobs.length) throw new Error('Configure uma rota de Fechamento de conta em Impressoras para imprimir.');
  const enviados = jobs.filter(job => job.ok).length;
  const falhas = jobs.filter(job => !job.ok);
  if (falhas.length) {
    const detalhe = falhas.map(job => `${job.impressora}: ${job.error || 'falha no envio'}`).join('; ');
    throw new Error(`${enviados ? `${enviados} envio(s) confirmado(s). ` : ''}Falha ao enviar: ${detalhe}`);
  }
  return `Conta enviada à fila do servidor (${enviados} impressora(s)).`;
}
