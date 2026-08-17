export function fmtBRL(v: number | string | null | undefined): string {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtNum(v: number | string | null | undefined, dec = 2): string {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function fmtData(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtDataCurta(iso?: string | null): string {
  if (!iso) return '-';
  const parte = String(iso).slice(0, 10).split('-');
  return parte.length === 3 ? `${parte[2]}/${parte[1]}/${parte[0]}` : String(iso);
}

export function fmtHora(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('pt-BR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
}

export function diasAte(iso?: string | null): number | null {
  if (!iso) return null;
  const hoje = new Date(`${dataSaoPaulo()}T12:00:00-03:00`);
  const alvo = new Date(`${String(iso).slice(0, 10)}T12:00:00-03:00`);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
}

export function hojeLocal(): string {
  return dataSaoPaulo();
}

export function addDiasLocal(days: number): string {
  const [y, m, d] = dataSaoPaulo().split('-').map(Number);
  const alvo = new Date(Date.UTC(y, m - 1, d + days, 12));
  return alvo.toISOString().slice(0, 10);
}

export const FORMAS_PAGAMENTO = [
  { valor: 'dinheiro', label: 'Dinheiro', cor: '#16a34a' },
  { valor: 'pix', label: 'Pix', cor: '#7c3aed' },
  { valor: 'credito', label: 'Cartão Crédito', cor: '#2563eb' },
  { valor: 'debito', label: 'Cartão Débito', cor: '#0891b2' },
  { valor: 'vale', label: 'Vale', cor: '#d97706' },
];

export function formaLabel(f: string): string {
  return FORMAS_PAGAMENTO.find((x) => x.valor === f)?.label || f;
}
const TIME_ZONE = 'America/Sao_Paulo';

function dataSaoPaulo(date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
