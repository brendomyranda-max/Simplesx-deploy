// Aplica o estabelecimento em uma única fronteira, inclusive em consultas
// internas dos handlers. O ID é numérico e vem de uma sessão autenticada.
const TABELAS = [
  'categorias', 'fornecedores', 'produtos', 'produto_categorias',
  'produto_codigos_barras', 'produto_comentarios', 'ficha_tecnica',
  'estoque_movimentacoes', 'lotes', 'validade_controles', 'mesas', 'comandas',
  'comanda_pessoas', 'comanda_itens', 'vendas', 'venda_itens', 'pagamentos',
  'perdas', 'despesas', 'contas_pagar', 'contas_receber', 'lancamentos', 'caixa',
  'funcionarios', 'setores_impressao', 'impressora_agentes', 'impressora_etiquetas',
  'gestores', 'gestor_jobs',
];

const RESERVADAS = new Set([
  'where', 'join', 'left', 'right', 'inner', 'outer', 'cross', 'on', 'order',
  'group', 'limit', 'union', 'having', 'set', 'values', 'returning',
]);

function escaparRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function transformar(sql, estabelecimentoId) {
  let out = String(sql);
  const id = Number(estabelecimentoId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Estabelecimento inválido');

  for (const tabela of TABELAS) {
    const t = escaparRegex(tabela);
    const insert = new RegExp(`(INSERT(?:\\s+OR\\s+IGNORE)?\\s+INTO\\s+${t}\\s*\\()([^)]*)(\\)\\s*VALUES\\s*\\()`, 'i');
    if (insert.test(out) && !new RegExp(`INSERT(?:\\s+OR\\s+IGNORE)?\\s+INTO\\s+${t}\\s*\\([^)]*\\bestabelecimento_id\\b`, 'i').test(out)) {
      out = out.replace(insert, `$1estabelecimento_id, $2$3${id}, `);
    }

    const update = new RegExp(`^\\s*UPDATE\\s+${t}\\s+SET\\s+`, 'i');
    const del = new RegExp(`^\\s*DELETE\\s+FROM\\s+${t}\\b`, 'i');
    if (update.test(out) || del.test(out)) {
      out = /\bWHERE\b/i.test(out)
        ? out.replace(/\s*;?\s*$/, ` AND estabelecimento_id=${id}`)
        : out.replace(/\s*;?\s*$/, ` WHERE estabelecimento_id=${id}`);
      continue;
    }

    const selectRef = new RegExp(`\\b(FROM|JOIN)\\s+${t}(?:\\s+(?:AS\\s+)?([A-Za-z_][A-Za-z0-9_]*))?`, 'gi');
    out = out.replace(selectRef, (match, op, alias) => {
      if (alias && !RESERVADAS.has(String(alias).toLowerCase())) {
        return `${op} (SELECT * FROM ${tabela} WHERE estabelecimento_id=${id}) ${alias}`;
      }
      const preservado = alias ? ` ${alias}` : '';
      return `${op} (SELECT * FROM ${tabela} WHERE estabelecimento_id=${id}) AS ${tabela}${preservado}`;
    });
  }
  return out;
}

export class TenantDb {
  constructor(db, estabelecimentoId) {
    this.db = db;
    this.estabelecimentoId = estabelecimentoId;
  }
  prepare(sql) {
    return this.db.prepare(transformar(sql, this.estabelecimentoId));
  }
  batch(statements) {
    return this.db.batch(statements);
  }
}

export { transformar as transformarSqlTenant };
