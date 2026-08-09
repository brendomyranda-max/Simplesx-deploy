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
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtDataCurta(iso?: string | null): string {
  if (!iso) return '-';
  return String(iso).slice(0, 10);
}

export function fmtHora(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function diasAte(iso?: string | null): number | null {
  if (!iso) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(String(iso).slice(0, 10));
  alvo.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000);
}

export function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function hojeLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDiasLocal(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export const UNIDADES = ['UN', 'KG', 'G', 'L', 'ML', 'CX', 'PC', 'DZ', 'PCT', 'LT'];

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
