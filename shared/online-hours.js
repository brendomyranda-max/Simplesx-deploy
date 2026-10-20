import { httpError } from './util.js';

const HORA = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const FUSOS = ['America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco', 'America/Noronha'];
const SEMANA = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function diasDaLoja(store) {
  try { return JSON.parse(store.horario_dias || '[0,1,2,3,4,5,6]'); }
  catch { return []; }
}

export function configurarHorario(body, current) {
  const abertura = body.horario_abertura ?? current.horario_abertura ?? '18:00';
  const fechamento = body.horario_fechamento ?? current.horario_fechamento ?? '23:00';
  const fuso = body.horario_fuso ?? current.horario_fuso ?? 'America/Sao_Paulo';
  const dias = body.horario_dias === undefined ? diasDaLoja(current) : body.horario_dias;
  if (!HORA.test(abertura) || !HORA.test(fechamento) || abertura === fechamento) {
    throw httpError(400, 'Informe horários de abertura e fechamento diferentes, no formato HH:MM.');
  }
  if (!FUSOS.includes(fuso)) throw httpError(400, 'Escolha um fuso horário válido.');
  if (!Array.isArray(dias) || !dias.length || dias.some((dia) => !Number.isInteger(dia) || dia < 0 || dia > 6)) {
    throw httpError(400, 'Selecione pelo menos um dia da semana.');
  }
  return { abertura, fechamento, fuso, dias: JSON.stringify([...new Set(dias)].sort()) };
}

// Calculado no servidor em cada consulta/pedido: funciona sem navegador aberto
// e não modifica a pausa manual (ativo=0).
export function funcionamentoLoja(store, date = new Date()) {
  if (Number(store.ativo) === 0) return { aberta_agora: 0, motivo_fechado: 'Loja pausada.' };
  if (Number(store.horario_automatico) !== 1) return { aberta_agora: 1, motivo_fechado: null };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: store.horario_fuso || 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  const dia = SEMANA.indexOf(parts.weekday);
  const hora = `${parts.hour}:${parts.minute}`;
  const dias = diasDaLoja(store);
  const inicio = store.horario_abertura;
  const fim = store.horario_fechamento;
  const aberta = inicio < fim
    ? dias.includes(dia) && hora >= inicio && hora < fim
    : (dias.includes(dia) && hora >= inicio) || (dias.includes((dia + 6) % 7) && hora < fim);
  return { aberta_agora: aberta ? 1 : 0, motivo_fechado: aberta ? null : 'Loja fechada neste horário.' };
}
