import type {
  Categoria,
  Fornecedor,
  Produto,
  MovimentacaoEstoque,
  ValidadeControle,
  Mesa,
  Comanda,
  ComandaPessoa,
  Venda,
  Perda,
  Lancamento,
  CaixaMov,
  Conta,
  Funcionario,
  ResumoRelatorio,
  EstadoSistema,
  ConfigEmpresa,
} from './types';

export interface ApiError {
  error: string;
  status: number;
}

const BASE = '/api';

function getToken(): string {
  return localStorage.getItem('simplesx_token') || '';
}

export function setToken(t: string) {
  if (t) localStorage.setItem('simplesx_token', t);
  else localStorage.removeItem('simplesx_token');
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw { error: 'Sem conexão com o servidor', status: 0 } as ApiError;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const data = await res.json();
      msg = data.error || msg;
    } catch {
      /* ignore */
    }
    const err: ApiError = { error: msg, status: res.status };
    if (res.status === 401) {
      setToken('');
      window.dispatchEvent(new CustomEvent('simplesx:logout'));
    }
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export const authApi = {
  login: (token: string) =>
    request<{ ok: boolean; nome: string; token_id: number }>('POST', '/auth/login', { token }),
  funcionario: (estabelecimento_token: string, usuario: string, senha: string) =>
    request<{ ok: boolean; token: string; nome: string; perfil: string; modulos?: string[]; id: number }>('POST', '/funcionarios/login', {
      estabelecimento_token,
      usuario,
      senha,
    }),
};

export const configApi = {
  get: () => api.get<ConfigEmpresa>('/config'),
  update: (body: Record<string, string | number>) => api.put('/config', body),
};

export const estadoApi = {
  get: () => api.get<EstadoSistema>('/estado'),
};

export const categoriaApi = {
  list: () => api.get<Categoria[]>('/categorias'),
  create: (b: { nome: string; cor?: string; categoria_pai_id?: number | null; impressora_agente_id?: number | null }) => api.post<Categoria>('/categorias', b),
  update: (id: number, b: Partial<Categoria>) => api.put<{ ok: boolean }>(`/categorias/${id}`, b),
};

export const fornecedorApi = {
  list: () => api.get<Fornecedor[]>('/fornecedores'),
  create: (b: Partial<Fornecedor>) => api.post<Fornecedor>('/fornecedores', b),
  update: (id: number, b: Partial<Fornecedor>) => api.put<{ ok: boolean }>(`/fornecedores/${id}`, b),
};

export const produtoApi = {
  list: (q?: string, local?: 'restaurante' | 'mercado', tipo?: string) =>
    api.get<Produto[]>(`/produtos?busca=${encodeURIComponent(q || '')}${local ? `&local=${local}` : ''}${tipo ? `&tipo=${tipo}` : ''}`),
  insumos: (q?: string) => api.get<Produto[]>(`/produtos?busca=${encodeURIComponent(q || '')}&tipo=insumo`),
  get: (id: number) => api.get<Produto>(`/produtos/${id}`),
  create: (b: Partial<Produto> & { nome: string; codigos_barras?: { codigo: string; principal?: number }[]; categoria_ids?: number[] }) =>
    api.post<Produto>('/produtos', b),
  update: (id: number, b: Partial<Produto> & { codigos_barras?: { codigo: string; principal?: number }[]; categoria_ids?: number[] }) =>
    api.put<Produto>(`/produtos/${id}`, b),
  remove: (id: number) => api.del<{ ok: boolean }>(`/produtos/${id}`),
  buscar: (codigo: string, local?: 'restaurante' | 'mercado') => api.post<Produto>('/produtos/buscar', { codigo, local }),
};

export const estoqueApi = {
  movimentacoes: (q?: Record<string, string>) => {
    const params = new URLSearchParams(q || {}).toString();
    return api.get<MovimentacaoEstoque[]>(`/estoque/movimentacoes?${params}`);
  },
  entrada: (b: {
    produto_id: number;
    quantidade: number;
    custo_unitario?: number;
    data_fabricacao?: string;
    data_validade?: string;
    temperatura?: string;
    fornecedor_id?: number;
    nota_fiscal?: string;
    responsavel?: string;
  }) => api.post<{ lote_id: number; novo_saldo: number }>('/estoque/entrada', b),
  ajuste: (b: { produto_id: number; quantidade_nova: number; motivo?: string; responsavel?: string }) =>
    api.post<{ ok: boolean }>('/estoque/ajuste', b),
};

export const validadeApi = {
  list: (q?: Record<string, string>) => {
    const params = new URLSearchParams(q || {}).toString();
    return api.get<ValidadeControle[]>(`/validade?${params}`);
  },
  criar: (b: {
    produto_id: number;
    quantidade?: number;
    tipo?: string;
    data_abertura?: string;
    data_fabricacao?: string;
    data_vencimento?: string;
    validade_aberto_dias?: number;
    temperatura?: string;
    responsavel?: string;
    observacoes?: string;
  }) => api.post<ValidadeControle>('/validade', b),
  concluir: (id: number) => api.post<{ ok: boolean }>(`/validade/${id}/concluir`),
  descartar: (id: number) => api.post<{ ok: boolean }>(`/validade/${id}/descartar`),
  etiqueta: (id: number) => api.get<any>(`/validade/${id}/etiqueta`),
};

export const vendaApi = {
  criar: (b: {
    itens: { produto_id: number; quantidade: number }[];
    pagamentos?: { forma: string; valor: number }[];
    forma?: string;
    desconto?: number;
    responsavel?: string;
    observacoes?: string;
  }) =>
    api.post<{ venda_id: number; numero: string; subtotal: number; desconto: number; total: number; pagamentos: { forma: string; valor: number }[]; itens: any[] }>('/vendas', b),
  list: (q?: Record<string, string>) => {
    const params = new URLSearchParams(q || {}).toString();
    return api.get<Venda[]>(`/vendas?${params}`);
  },
  get: (id: number) => api.get<Venda>(`/vendas/${id}`),
  cancelar: (id: number) => api.post<{ ok: boolean }>(`/vendas/${id}/cancelar`),
};

export const mesaApi = {
  list: () => api.get<{ mesas: Mesa[]; comandas: (Comanda & { mesa_numero: number; total: number; itens_count: number })[] }>('/mesas'),
  create: (b: { numero: number; nome?: string; capacidade?: number; setor?: string }) => api.post<Mesa>('/mesas', b),
  update: (id: number, b: Partial<Mesa>) => api.put<{ ok: boolean }>(`/mesas/${id}`, b),
  remove: (id: number) => api.del<{ ok: boolean }>(`/mesas/${id}`),
  abrir: (id: number, b: { garcom_nome?: string; cliente_nome?: string; pessoas_count?: number }) =>
    api.post<Comanda>(`/mesas/${id}/abrir`, b),
};

export const comandaApi = {
  get: (id: number) => api.get<Comanda>(`/comandas/${id}`),
  addPessoa: (id: number, b: { nome?: string; cor?: string }) => api.post<{ id: number }>(`/comandas/${id}/pessoas`, b),
  removePessoa: (id: number, pid: number) => api.del<{ ok: boolean }>(`/comandas/${id}/pessoas/${pid}`),
  renamePessoa: (id: number, pid: number, nome: string) =>
    api.put<{ id: number; nome: string; cor: string }>(`/comandas/${id}/pessoas/${pid}`, { nome }),
  addItem: (id: number, b: { produto_id?: number; codigo?: string; nome?: string; quantidade?: number; preco_unitario?: number; pessoa_id?: number; observacao?: string; responsavel?: string }) =>
    api.post<Comanda['itens'][0]>(`/comandas/${id}/itens`, b),
  updateItem: (id: number, itemId: number, b: { observacao?: string }) =>
    api.put<Comanda['itens'][0]>(`/comandas/${id}/itens/${itemId}`, b),
  itemStatus: (id: number, itemId: number, status: string, responsavel?: string) =>
    api.post<{ ok: boolean }>(`/comandas/${id}/itens/${itemId}/status`, { status, responsavel }),
  fechar: (id: number, b: { tipo: 'unica' | 'divisao' | 'individual'; taxa_garcom_pct?: number; forma?: string; pagamentos?: { forma: string; valor: number }[]; responsavel?: string; pessoas_valores?: { pessoa_id: number | null; valor: number }[]; pre_fechar?: boolean }) =>
    api.post<{ ok: boolean; comanda_id: number; vendas: { id: number; numero: string; total: number }[]; total: number; pre_fechamento?: boolean; comanda_pagamentos_id?: number; pessoas?: number; mensagem?: string }>(`/comandas/${id}/fechar`, b),
  reabrir: (id: number) => api.post<{ ok: boolean }>(`/comandas/${id}/reabrir`),
  baixarPessoa: (id: number, b: { pessoa_id: number; forma?: string; responsavel?: string }) =>
    api.post<{ ok: boolean; venda: { id: number; numero: string; total: number }; fechou: boolean; comanda: Comanda }>(`/comandas/${id}/baixar-pessoa`, b),
};

export const perdaApi = {
  list: (q?: Record<string, string>) => {
    const params = new URLSearchParams(q || {}).toString();
    return api.get<Perda[]>(`/perdas?${params}`);
  },
  create: (b: { produto_id: number; quantidade: number; valor_unitario?: number; motivo: string; origem?: string; responsavel?: string }) =>
    api.post<{ id: number }>('/perdas', b),
};

export const financeiroApi = {
  lancamentos: (q?: Record<string, string>) => {
    const params = new URLSearchParams(q || {}).toString();
    return api.get<Lancamento[]>(`/lancamentos?${params}`);
  },
  despesas: () => api.get<Lancamento[]>('/despesas'),
  criarDespesa: (b: { descricao: string; categoria?: string; valor: number; data?: string; forma_pagamento?: string; funcionario?: string }) =>
    api.post<{ id: number }>('/despesas', b),
  caixa: (data?: string) => api.get<CaixaMov[]>(`/caixa?data=${data || ''}`),
  criarCaixa: (b: { tipo: string; valor: number; metodo?: string; observacao?: string; funcionario?: string }) =>
    api.post<{ id: number }>('/caixa', b),
  contasPagar: () => api.get<Conta[]>('/contas-pagar'),
  criarContaPagar: (b: { descricao: string; fornecedor?: string; valor: number; data_vencimento?: string }) =>
    api.post<{ id: number }>('/contas-pagar', b),
  pagarConta: (id: number, metodo?: string) => api.post<{ ok: boolean }>(`/contas-pagar/${id}/pagar?metodo=${metodo || ''}`),
  contasReceber: () => api.get<Conta[]>('/contas-receber'),
  criarContaReceber: (b: { descricao: string; cliente?: string; valor: number; data_vencimento?: string }) =>
    api.post<{ id: number }>('/contas-receber', b),
  receberConta: (id: number, metodo?: string) => api.post<{ ok: boolean }>(`/contas-receber/${id}/receber?metodo=${metodo || ''}`),
};

export const relatorioApi = {
  resumo: (de?: string, ate?: string) => api.get<ResumoRelatorio>(`/relatorios/resumo?de=${de || ''}&ate=${ate || ''}`),
  maisVendidos: (de?: string, ate?: string) =>
    api.get<{ produto_id: number; nome: string; qtd: number; total: number }[]>(`/relatorios/mais-vendidos?de=${de || ''}&ate=${ate || ''}`),
  estoqueBaixo: () => api.get<Produto[]>('/relatorios/estoque-baixo'),
  vencimentos: (dias?: number) => api.get<ValidadeControle[]>(`/relatorios/vencimentos?dias=${dias || ''}`),
  perdas: (de?: string, ate?: string) => api.get<any[]>(`/relatorios/perdas?de=${de || ''}&ate=${ate || ''}`),
  vendasPorDia: (de?: string, ate?: string) => api.get<{ dia: string; vendas: number; total: number }[]>(`/relatorios/vendas-por-dia?de=${de || ''}&ate=${ate || ''}`),
  lucroCategoria: (de?: string, ate?: string) =>
    api.get<{ categoria: string; faturamento: number; custo: number; lucro: number; vendas: number }[]>(`/relatorios/lucro-categoria?de=${de || ''}&ate=${ate || ''}`),
  vendasFuncionario: (de?: string, ate?: string) =>
    api.get<{ funcionario: string; vendas: number; faturamento: number; ticket: number }[]>(`/relatorios/vendas-funcionario?de=${de || ''}&ate=${ate || ''}`),
};

export const funcionarioApi = {
  list: () => api.get<Funcionario[]>('/funcionarios'),
  create: (b: { nome: string; usuario: string; senha_hash: string; perfil?: string; pin?: string; modulos?: string[] | string }) =>
    api.post<Funcionario>('/funcionarios', b),
  update: (id: number, b: Partial<Funcionario> & { senha_hash?: string; modulos?: string[] | string }) =>
    api.put<{ ok: boolean }>(`/funcionarios/${id}`, b),
  remove: (id: number) => api.del<{ ok: boolean }>(`/funcionarios/${id}`),
};

export const impressoraApi = {
  setores: () => api.get<any[]>('/setores-impressao'),
  criarSetor: (b: { nome: string; padrao_impressora?: string }) => api.post<any>('/setores-impressao', b),
  agentes: () => api.get<any[]>('/impressora-agentes'),
  criarAgente: (b: { nome: string; ip?: string; porta?: number; tipo?: string; protocolo?: string; categorias?: number[]; imprime_pedidos?: boolean; imprime_conta?: boolean; largura_mm?: number }) => api.post<any>('/impressora-agentes', b),
  atualizarAgente: (id: number, b: { nome: string; ip?: string; porta?: number; tipo?: string; protocolo?: string; categorias?: number[]; imprime_pedidos?: boolean; imprime_conta?: boolean; largura_mm?: number; ativo?: boolean }) => api.put<{ ok: boolean }>(`/impressora-agentes/${id}`, b),
  etiquetas: () => api.get<any[]>('/impressora-etiquetas'),
  criarEtiqueta: (b: { nome: string; largura_mm?: number; altura_mm?: number }) => api.post<any>('/impressora-etiquetas', b),
  imprimirComanda: (comanda_id: number, b?: { setor?: string; agente?: string; tipo?: 'cozinha' | 'conta' }) =>
    api.post<{ impressao: string; itens: number; setor: string; tipo?: string; jobs?: any[]; sem_rota?: string[]; falhas?: { impressora: string; erro: string }[] }>(`/impressao/comanda?empresa=${encodeURIComponent(localStorage.getItem('simplesx_empresa') || '')}`, { comanda_id, ...b }),
  imprimirPessoa: (comanda_id: number, pessoa_id: number) =>
    api.post<{ impressao: string; pessoa: ComandaPessoa; total: number }>(`/impressao/pessoa?empresa=${encodeURIComponent(localStorage.getItem('simplesx_empresa') || '')}`, { comanda_id, pessoa_id }),
  imprimirEtiqueta: (id: number) => api.get<{ impressao: string; etiqueta: any }>(`/impressao/etiqueta/${id}`),
};

export const gestorApi = {
  list: () => api.get<any[]>('/gestores'),
  enviar: (b: {
    tipo?: 'texto' | 'html';
    conteudo: string;
    impressora?: string;
    largura_mm?: number;
    copias?: number;
    cortar?: boolean;
    alimentar?: number;
    gestor_token?: string;
    title?: string;
  }) => api.post<{ ok: boolean; job_id?: number }>('/impressao/enviar', b),
};

export const tokenApi = {
  list: () => api.get<any[]>('/tokens'),
  create: (nome: string) => api.post<{ id: number; token: string; nome: string }>('/tokens', { nome }),
  remove: (id: number) => api.del<{ ok: boolean }>(`/tokens/${id}`),
  toggle: (id: number) => api.post<{ ok: boolean; ativo: number }>(`/tokens/${id}/toggle`),
};
