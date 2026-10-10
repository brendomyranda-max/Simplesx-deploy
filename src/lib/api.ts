/**
 * Arquivo: api.ts
 * Responsabilidade: Centraliza as requisições HTTP e organiza os endpoints por domínio.
 */

import type {
  Categoria,
  Fornecedor,
  Produto,
  MovimentacaoEstoque,
  ValidadeControle,
  FechamentoCaixa,
  FechamentoCaixaResumo,
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
  OnlineCatalogProduct,
  OnlineOrder,
  PainelPedidos,
  PainelCozinha,
  OnlinePublicStore,
  OnlineStore,
  CategoriaLoja,
  CategoriaCardapio,
  RedePedidos,
  AreaEntrega,
} from './types';

export interface ApiError {
  error: string;
  status: number;
}

export interface OrderSubmission {
  chave: string;
  itens: { produto_id: number; quantidade: number; pessoa_id?: number; observacao?: string; acrescimos?: number[] }[];
}

// Somente operações protegidas no servidor podem repetir automaticamente.
export async function retryOrder<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await send(); } catch (error: any) {
      if (attempt >= 2 || (error?.status !== 0 && error?.status < 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

const BASE = '/api';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
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
      window.dispatchEvent(new CustomEvent('simplexsa:logout'));
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

export interface SignupPolicy {
  valor_centavos: number;
  moeda: string;
  periodicidade: 'unico';
  pagamento_disponivel: boolean;
}

export const authApi = {
  config: () => request<{ turnstile_site_key: string; cadastro: SignupPolicy }>('GET', '/auth/config'),
  me: () => request<{ id: number; nome: string; perfil: string; modulos?: string[] }>('GET', '/auth/me'),
  login: (token: string) =>
    request<{ ok: boolean; nome: string; token_id: number }>('POST', '/auth/login', { token }),
  funcionario: (cnpj: string, usuario: string, senha: string, turnstile_token: string) =>
    request<{ ok: boolean; nome: string; perfil: string; modulos?: string[]; id: number }>('POST', '/funcionarios/login', {
      cnpj,
      usuario,
      senha,
      turnstile_token,
    }),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),
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
  insumos: (q?: string) => api.get<Produto[]>(`/produtos?busca=${encodeURIComponent(q || '')}&tipo=ingrediente`),
  get: (id: number) => api.get<Produto>(`/produtos/${id}`),
  create: (b: Partial<Produto> & { nome: string; codigos_barras?: { codigo: string; principal?: number }[]; categoria_ids?: number[] }) =>
    api.post<Produto>('/produtos', b),
  update: (id: number, b: Partial<Produto> & { codigos_barras?: { codigo: string; principal?: number }[]; categoria_ids?: number[] }) =>
    api.put<Produto>(`/produtos/${id}`, b),
  remove: (id: number) => api.del<{ ok: boolean }>(`/produtos/${id}`),
  buscar: (codigo: string, local?: 'restaurante' | 'mercado') => api.post<Produto>('/produtos/buscar', { codigo, local }),
  adicionarCodigo: (id: number, codigo: string) => api.post<Produto>(`/produtos/${id}/codigos-barras`, { codigo }),
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
    codigo_barras?: string;
  }) => api.post<{ lote_id: number; novo_saldo: number; custo_medio: number; codigo_barras?: string | null }>('/estoque/entrada', b),
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
  reabrir: (id: number) => api.post<Venda>(`/vendas/${id}/reabrir`),
  ajustar: (id: number, b: { itens: { produto_id: number; quantidade: number }[]; pagamentos: { forma: string; valor: number }[]; desconto?: number; responsavel?: string; justificativa: string; reducoes: { produto_id: number; motivo: 'nao_pago' | 'duplicado_nao_vendido' }[] }) =>
    api.put<Venda>(`/vendas/${id}/ajustar`, b),
  cancelar: (id: number, b: { justificativa: string; destino: 'devolver_estoque' | 'perda'; responsavel?: string }) =>
    api.post<{ ok: boolean }>(`/vendas/${id}/cancelar`, b),
  emitirNfce: (id: number) => api.post<any>(`/vendas/${id}/nfce`),
  imprimir: (id: number) => api.post<{ impressao: string; venda_id: number; jobs: any[] }>(`/impressao/venda/${id}`),
};

export const fiscalApi = {
  config: () => api.get<any>('/fiscal/config'),
  salvarConfig: (b: Record<string, unknown>) => api.put<any>('/fiscal/config', b),
  produtos: () => api.get<any[]>('/fiscal/produtos'),
  salvarProduto: (id: number, b: Record<string, unknown>) => api.put<{ ok: boolean }>(`/fiscal/produtos/${id}`, b),
  documentos: () => api.get<any[]>('/fiscal/documentos'),
  documento: (id: number) => api.get<any>(`/fiscal/documentos/${id}`),
  cancelar: (id: number, justificativa: string) => api.post<{ ok: boolean; status: string }>(`/fiscal/documentos/${id}/cancelar`, { justificativa }),
};

export interface CartaoUso {
  cartao: string;
  mesa_id: number;
  mesa_numero: number;
  comanda_id: number;
  comanda_status: string;
  cozinha: { itens: number; sem_rota?: string[]; falhas?: { impressora: string; erro: string }[] } | null;
}

export const cartaoApi = {
  usar: (b: {
    acao: 'abrir' | 'lancar' | 'fechar';
    uid: string;
    payload?: string;
    garcom_nome?: string;
    chave?: string;
    itens?: { produto_id: number; quantidade: number; observacao?: string }[];
  }) => api.post<CartaoUso>('/cartoes/usar', b),
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
  addItems: (id: number, body: OrderSubmission) => retryOrder(() => api.post<{ itens: Comanda['itens']; repetido: boolean }>(`/comandas/${id}/itens/lote`, body)),
  get: (id: number) => api.get<Comanda>(`/comandas/${id}`),
  addPessoa: (id: number, b: { nome?: string; cor?: string }) => api.post<{ id: number }>(`/comandas/${id}/pessoas`, b),
  removePessoa: (id: number, pid: number) => api.del<{ ok: boolean }>(`/comandas/${id}/pessoas/${pid}`),
  renamePessoa: (id: number, pid: number, nome: string) =>
    api.put<{ id: number; nome: string; cor: string }>(`/comandas/${id}/pessoas/${pid}`, { nome }),
  addItem: (id: number, b: { produto_id?: number; codigo?: string; nome?: string; quantidade?: number; preco_unitario?: number; pessoa_id?: number; observacao?: string; responsavel?: string }) =>
    api.post<Comanda['itens'][0]>(`/comandas/${id}/itens`, b),
  updateItem: (id: number, itemId: number, b: { observacao?: string; acrescimos?: number[] }) =>
    api.put<Comanda['itens'][0]>(`/comandas/${id}/itens/${itemId}`, b),
  transferirItem: (id: number, itemId: number, b: { mesa_destino_id: number; comanda_destino_id: number | null; pessoa_destino_id: number | null; versao: number }) =>
    api.post<{ ok: boolean; transferencia_id: string; comanda_destino_id: number; abriu_comanda: number }>(`/comandas/${id}/itens/${itemId}/transferir`, b),
  itemStatus: (id: number, itemId: number, status: string, responsavel?: string) =>
    api.post<{ ok: boolean }>(`/comandas/${id}/itens/${itemId}/status`, { status, responsavel }),
  fechar: (id: number, b: { tipo: 'unica' | 'divisao' | 'individual'; taxa_garcom_pct?: number; forma?: string; pagamentos?: { forma: string; valor: number }[]; responsavel?: string; pessoas_valores?: { pessoa_id: number | null; valor: number }[]; pre_fechar?: boolean }) =>
    api.post<{ ok: boolean; comanda_id: number; vendas: { id: number; numero: string; total: number }[]; total: number; pre_fechamento?: boolean; comanda_pagamentos_id?: number; pessoas?: number; mensagem?: string }>(`/comandas/${id}/fechar`, b),
  reabrir: (id: number) => api.post<{ ok: boolean }>(`/comandas/${id}/reabrir`),
  baixarPessoa: (id: number, b: { pessoa_id: number; forma?: string; responsavel?: string }) =>
    api.post<{ ok: boolean; venda: { id: number; numero: string; total: number }; fechou: boolean; comanda: Comanda }>(`/comandas/${id}/baixar-pessoa`, b),
};

export const onlineApi = {
  store: () => api.get<OnlineStore>('/online/loja'),
  updateStore: (body: Partial<OnlineStore>) => api.put<OnlineStore>('/online/loja', body),
  categories: () => api.get<CategoriaLoja[]>('/online/categorias'),
  addCategory: (nome: string) => api.post<CategoriaLoja[]>('/online/categorias', { nome }),
  removeCategory: (id: number) => api.del<CategoriaLoja[]>(`/online/categorias/${id}`),
  menuCategories: () => api.get<CategoriaCardapio[]>('/online/cardapio-categorias'),
  addMenuCategory: (nome: string) => api.post<CategoriaCardapio[]>('/online/cardapio-categorias', { nome }),
  updateMenuCategory: (id: number, body: { nome?: string; ordem?: number }) => api.put<CategoriaCardapio[]>(`/online/cardapio-categorias/${id}`, body),
  removeMenuCategory: (id: number) => api.del<CategoriaCardapio[]>(`/online/cardapio-categorias/${id}`),
  organizeMenu: (body: { categorias: { id: number; ordem: number }[]; produtos: { id: number; cardapio_categoria_id: number | null; ordem: number }[] }) =>
    api.put<{ ok: boolean; categorias: CategoriaCardapio[] }>('/online/cardapio/organizar', body),
  products: () => api.get<OnlineCatalogProduct[]>('/online/produtos'),
  addProduct: (body: {
    produto_id: number;
    opcoes?: { nome: string; tipo: 'removivel' | 'adicional'; preco_adicional: number; insumo_id?: number | null; ordem?: number; ativo?: number }[];
  } & Partial<Omit<OnlineCatalogProduct, 'opcoes'>>) => api.post<OnlineCatalogProduct>('/online/produtos', body),
  updateProduct: (id: number, body: {
    opcoes?: { nome: string; tipo: 'removivel' | 'adicional'; preco_adicional: number; insumo_id?: number | null; ordem?: number; ativo?: number }[];
  } & Partial<Omit<OnlineCatalogProduct, 'opcoes'>>) => api.put<OnlineCatalogProduct>(`/online/produtos/${id}`, body),
  removeProduct: (id: number) => api.del<{ ok: boolean }>(`/online/produtos/${id}`),
  orders: (status?: string) => api.get<OnlineOrder[]>(`/online/pedidos${status ? `?status=${encodeURIComponent(status)}` : ''}`),
};

export const pedidosApi = {
  painel: () => api.get<PainelPedidos>('/pedidos/painel'),
  cozinha: () => api.get<PainelCozinha>('/pedidos/cozinha'),
  statusOnline: (id: number, status: 'confirmado' | 'cancelado' | 'saiu_entrega' | 'pronto_retirada' | 'entregue' | 'pix_recebido') =>
    api.post<{ ok: boolean; id: number; status: string; etapa: string }>(`/pedidos/online/${id}/status`, { status }),
  etiqueta: (body: { item_id?: number; comanda_id?: number }) =>
    api.post<{ impressao: string; jobs: { impressora: string; ok?: boolean; error?: string }[] }>('/pedidos/etiqueta', body),
};

export const onlinePublicApi = {
  network: (filtro?: { categoria?: string; q?: string; lat?: number; lng?: number; regiao?: boolean }) => {
    const params = new URLSearchParams();
    if (filtro?.categoria) params.set('categoria', filtro.categoria);
    if (filtro?.q) params.set('q', filtro.q);
    if (filtro?.lat != null && filtro?.lng != null) {
      params.set('lat', String(filtro.lat));
      params.set('lng', String(filtro.lng));
      if (filtro.regiao === false) params.set('regiao', '0');
    }
    const query = params.toString();
    return api.get<RedePedidos>(`/public/lojas${query ? `?${query}` : ''}`);
  },
  locate: (consulta: { q?: string; lat?: number; lng?: number }) => {
    const params = new URLSearchParams();
    if (consulta.q) params.set('q', consulta.q);
    if (consulta.lat != null) params.set('lat', String(consulta.lat));
    if (consulta.lng != null) params.set('lng', String(consulta.lng));
    return api.get<{ latitude: number; longitude: number; endereco: string }>(`/public/localizar?${params.toString()}`);
  },
  distance: (slug: string, consulta: { q?: string; lat?: number; lng?: number }) => {
    const params = new URLSearchParams();
    if (consulta.q) params.set('q', consulta.q);
    if (consulta.lat != null) params.set('lat', String(consulta.lat));
    if (consulta.lng != null) params.set('lng', String(consulta.lng));
    return api.get<AreaEntrega>(`/public/lojas/${encodeURIComponent(slug)}/distancia?${params.toString()}`);
  },
  store: (slug: string, ponto?: { lat?: number; lng?: number }) => {
    const params = new URLSearchParams();
    if (ponto?.lat != null && ponto?.lng != null) {
      params.set('lat', String(ponto.lat));
      params.set('lng', String(ponto.lng));
    }
    const query = params.toString();
    return api.get<OnlinePublicStore>(`/public/lojas/${encodeURIComponent(slug)}${query ? `?${query}` : ''}`);
  },
  order: (slug: string, body: {
    chave: string; cliente_nome: string; telefone: string; tipo_entrega: 'entrega' | 'retirada'; endereco?: string;
    forma_pagamento: 'pix' | 'dinheiro' | 'maquininha'; troco_para?: number | null; observacao?: string;
    itens: { cardapio_produto_id: number; quantidade: number; opcoes_ids?: number[]; observacao?: string }[];
  }) => api.post<{ id: number; comanda_id: number | null; status: string; total: number; forma_pagamento: string; pix_copia_cola: string | null; repetido: boolean }>(`/public/lojas/${encodeURIComponent(slug)}/pedidos`, body),
  track: (slug: string, chave: string) => api.get<{
    id: number;
    etapa: 'aguardando_pix' | 'recebido' | 'preparando' | 'saiu_entrega' | 'pronto_retirada' | 'entregue' | 'cancelado';
    tipo_entrega: 'entrega' | 'retirada';
    forma_pagamento: string;
    pix_copia_cola: string | null;
    total: number;
    taxa_entrega?: number;
    valor_entrega?: number | null;
    distancia_km?: number | null;
    modo_entrega?: 'cliente' | 'dividido' | 'gratis' | null;
    entrega_gratis?: number | null;
    criado_em: string;
    atualizado_em: string;
    loja: string;
    itens: { nome: string; quantidade: number }[];
  }>(`/public/lojas/${encodeURIComponent(slug)}/pedidos/${encodeURIComponent(chave)}`),
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

export const fechamentoCaixaApi = {
  resumo: (data: string) => api.get<FechamentoCaixaResumo>(`/fechamento-caixa/resumo?data=${data}`),
  list: () => api.get<FechamentoCaixa[]>('/fechamento-caixa'),
  create: (b: { data: string; valores: Record<string, number>; vendas_confirmadas?: number[]; justificativa?: string; responsavel?: string }) =>
    api.post<{ id: number; diferenca: number; status: string }>('/fechamento-caixa', b),
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

export interface NfcEvento {
  id: number;
  origem: string;
  leitor: string;
  uid: string;
  payload: string;
  criado_em: string;
  consumido_em?: string | null;
}

export const nfcApi = {
  pendentes: () => api.get<NfcEvento[]>('/nfc/eventos'),
  historico: () => api.get<NfcEvento[]>('/nfc/eventos?historico=1'),
  consumir: (id: number) => api.post<NfcEvento>(`/nfc/eventos/${id}/consumir`),
};

export const impressoraApi = {
  setores: () => api.get<any[]>('/setores-impressao'),
  criarSetor: (b: { nome: string; padrao_impressora?: string }) => api.post<any>('/setores-impressao', b),
  agentes: () => api.get<any[]>('/impressora-agentes'),
  criarAgente: (b: { nome: string; ip?: string; porta?: number; tipo?: string; protocolo?: string; categorias?: number[]; imprime_pedidos?: boolean; imprime_conta?: boolean; imprime_venda?: boolean; imprime_validade?: boolean; largura_mm?: number; servidor_tipo?: string | null; servidor_id?: string | null; impressora_destino?: string | null }) => api.post<any>('/impressora-agentes', b),
  atualizarAgente: (id: number, b: { nome: string; ip?: string; porta?: number; tipo?: string; protocolo?: string; categorias?: number[]; imprime_pedidos?: boolean; imprime_conta?: boolean; imprime_venda?: boolean; imprime_validade?: boolean; largura_mm?: number; servidor_tipo?: string | null; servidor_id?: string | null; impressora_destino?: string | null; ativo?: boolean }) => api.put<{ ok: boolean }>(`/impressora-agentes/${id}`, b),
  etiquetas: () => api.get<any[]>('/impressora-etiquetas'),
  excluirAgente: (id: number) => api.del<{ ok: boolean }>(`/impressora-agentes/${id}`),
  atualizarEtiqueta: (id: number, b: { nome: string; largura_mm: number; altura_mm: number }) => api.put<{ ok: boolean }>(`/impressora-etiquetas/${id}`, b),
  excluirEtiqueta: (id: number) => api.del<{ ok: boolean }>(`/impressora-etiquetas/${id}`),
  criarEtiqueta: (b: { nome: string; largura_mm?: number; altura_mm?: number }) => api.post<any>('/impressora-etiquetas', b),
  imprimirComanda: (comanda_id: number, b?: { setor?: string; agente?: string; tipo?: 'cozinha' | 'conta'; itens_ids?: number[] }) =>
    api.post<{ impressao: string; itens: number; setor: string; tipo?: string; jobs?: any[]; sem_rota?: string[]; falhas?: { impressora: string; erro: string }[] }>(`/impressao/comanda?empresa=${encodeURIComponent(localStorage.getItem('simplesx_empresa') || '')}`, { comanda_id, ...b }),
  imprimirPessoa: (comanda_id: number, pessoa_id: number) =>
    api.post<{ impressao: string; pessoa: ComandaPessoa; total: number }>(`/impressao/pessoa?empresa=${encodeURIComponent(localStorage.getItem('simplesx_empresa') || '')}`, { comanda_id, pessoa_id }),
  imprimirEtiqueta: (id: number) => api.post<{ impressao: string; etiqueta: any; jobs: any[] }>(`/impressao/etiqueta/${id}`),
};

export const gestorApi = {
  list: () => api.get<any[]>('/gestores'),
  update: (id: number, nome: string) => api.put<{ ok: boolean }>(`/gestores/${id}`, { nome }),
  remove: (id: number) => api.del<{ ok: boolean }>(`/gestores/${id}`),
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

export interface DevicePrinter {
  name: string;
  connection?: string;
  protocol?: string;
  width_mm?: number;
}

export interface PrintDevice {
  id: string;
  nome: string;
  plataforma: string;
  versao?: string;
  status: string;
  online: boolean;
  ultima_conexao?: string;
  ultimo_erro?: string;
  printers: DevicePrinter[];
}

export interface DeviceTask {
  id: string;
  device_id: string;
  status: 'pending' | 'sent' | 'processing' | 'success' | 'failed' | 'cancelled';
  erro_codigo?: string | null;
  erro_mensagem?: string | null;
}

export const deviceApi = {
  update: (id: string, nome: string) => api.put<{ ok: boolean }>(`/devices/${encodeURIComponent(id)}`, { nome }),
  pairingCode: () => api.post<{ pairing_id: string; code: string; expires_at: string }>('/devices/pairing-codes'),
  list: () => api.get<PrintDevice[]>('/devices'),
  task: (id: string) => api.get<DeviceTask>(`/device-tasks/${encodeURIComponent(id)}`),
  test: (deviceId: string, printer: DevicePrinter, idempotencyKey: string) => api.post<{ task: DeviceTask }>('/device-tasks', {
    device_id: deviceId,
    type: 'TEST_PRINTER',
    payload: {
      content: `DOIXP - TESTE ANDROID\nImpressora: ${printer.name}\n${new Date().toLocaleString('pt-BR')}\nConexao com o Servidor Android OK`,
      printer: printer.name, width_mm: printer.width_mm || 80, cut: true, feed: 3,
    },
    idempotency_key: idempotencyKey,
  }),
  remove: (deviceId: string) => api.del<{ ok: boolean }>(`/devices/${encodeURIComponent(deviceId)}`),
};

export const tokenApi = {
  list: () => api.get<any[]>('/tokens'),
  create: (nome: string) => api.post<{ id: number; token: string; nome: string }>('/tokens', { nome }),
  remove: (id: number) => api.del<{ ok: boolean }>(`/tokens/${id}`),
  toggle: (id: number) => api.post<{ ok: boolean; ativo: number }>(`/tokens/${id}/toggle`),
};
