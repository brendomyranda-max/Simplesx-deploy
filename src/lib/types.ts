/**
 * Arquivo: types.ts
 * Responsabilidade: Declara os contratos TypeScript compartilhados pelas telas e pela API.
 */

export interface Categoria {
  id: number;
  nome: string;
  cor: string;
  ativo: number;
  categoria_pai_id?: number | null;
  categoria_pai_nome?: string | null;
  impressora_agente_id?: number | null;
  impressora_nome?: string | null;
  impressora_herdada_id?: number | null;
  impressora_herdada_nome?: string | null;
}

export interface Fornecedor {
  id: number;
  nome: string;
  contato?: string | null;
  telefone?: string | null;
  email?: string | null;
  ativo: number;
}

export interface CodigoBarras {
  id?: number;
  codigo: string;
  principal: number;
}

export type ProdutoTipo = 'produto' | 'insumo' | 'composto';

export interface FichaIngrediente {
  id?: number;
  insumo_id: number;
  quantidade: number;
  unidade: string;
  insumo_nome?: string;
  insumo_unidade?: string;
  insumo_custo?: number;
  insumo_estoque?: number;
  conteudo_quantidade?: number | null;
  conteudo_unidade?: string | null;
  custo_linha?: number;
}

export interface Produto {
  id: number;
  nome: string;
  codigo_interno: string;
  unidade: string;
  tipo?: ProdutoTipo;
  estoque_atual: number;
  estoque_minimo: number;
  conteudo_quantidade?: number | null;
  conteudo_unidade?: string | null;
  custo: number;
  preco: number | null;
  produto_balanca?: number;
  balanca_plu?: string | null;
  fornecedor_id: number | null;
  fornecedor_nome?: string | null;
  marca: string | null;
  sem_vencimento?: number;
  validade_fabricacao_dias: number | null;
  validade_aberto_dias: number | null;
  data_fabricacao?: string | null;
  data_vencimento?: string | null;
  temperatura: string | null;
  ativo: number;
  exibir_restaurante: number;
  exibir_mercado: number;
  observacoes: string | null;
  comentarios?: string[];
  acrescimos?: ProdutoAcrescimo[];
  categorias: Categoria[];
  codigos_barras: CodigoBarras[];
  ficha?: FichaIngrediente[];
  ficha_count?: number;
  estoque_possivel?: number | null;
}

export interface ProdutoAcrescimo {
  insumo_id: number;
  insumo_nome?: string;
  valor: number;
}

export interface OnlineCatalogOption {
  id: number;
  nome: string;
  tipo: 'removivel' | 'adicional';
  preco_adicional: number;
  insumo_id?: number | null;
  ordem?: number;
  ativo?: number;
}

export interface OnlineCatalogProduct {
  id: number;
  produto_id: number;
  categoria_id: number | null;
  cardapio_categoria_id?: number | null;
  categoria_nome: string | null;
  nome: string;
  descricao: string;
  foto_url: string | null;
  preco: number | null;
  ordem: number;
  disponivel: number;
  ativo: number;
  vendidos?: number;
  opcoes: OnlineCatalogOption[];
}

export interface OnlineStore {
  estabelecimento_id?: number;
  slug: string;
  nome: string;
  descricao: string | null;
  logo_url: string | null;
  capa_url: string | null;
  cor_capa?: string | null;
  taxa_entrega: number;
  tempo_min_entrega: number | null;
  tempo_max_entrega: number | null;
  aceita_entrega: number;
  aceita_retirada: number;
  ativo: number;
  endereco?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  raio_entrega_km?: number | null;
  valor_por_km?: number | null;
  modo_entrega?: ModoEntrega | null;
  valor_entrega?: number | null;
  taxa_cliente?: number | null;
  taxa_estabelecimento?: number | null;
  distancia_km?: number | null;
  entrega_na_regiao?: number | null;
  entrega_gratis?: number | null;
  pix_chave?: string | null;
  pix_cidade?: string | null;
  pix_disponivel?: number | null;
  modo_publicacao?: 'marketplace' | 'cardapio';
  site_url?: string;
  segmentos?: string[];
}

export type ModoEntrega = 'cliente' | 'dividido' | 'gratis';

export interface CategoriaLoja {
  id: number;
  nome: string;
  busca: string;
}

export interface CategoriaCardapio {
  id: number;
  nome: string;
  ordem: number;
}

export interface LojaRede {
  slug: string;
  nome: string;
  descricao: string;
  logo_url: string | null;
  capa_url: string | null;
  cor_capa?: string | null;
  taxa_entrega: number;
  tempo_min_entrega: number | null;
  tempo_max_entrega: number | null;
  aceita_entrega: number;
  aceita_retirada: number;
  distancia_km: number | null;
  entrega_na_regiao: number | null;
  raio_entrega_km: number | null;
  valor_por_km?: number | null;
  modo_entrega?: ModoEntrega | null;
  valor_entrega?: number | null;
  taxa_cliente?: number | null;
  taxa_estabelecimento?: number | null;
  entrega_gratis?: number | null;
  segmentos: string[];
}

export interface AreaEntrega {
  distancia_km: number | null;
  entrega_na_regiao: number | null;
  raio_entrega_km: number | null;
  endereco?: string;
  valor_por_km?: number | null;
  modo_entrega?: ModoEntrega | null;
  valor_entrega?: number | null;
  taxa_cliente?: number | null;
  taxa_estabelecimento?: number | null;
  entrega_gratis?: number | null;
}

export interface RedePedidos {
  categorias: { nome: string; busca: string; lojas: number }[];
  lojas: LojaRede[];
}

export interface OnlinePublicStore {
  loja: OnlineStore;
  categorias: { id: number; nome: string }[];
  produtos: OnlineCatalogProduct[];
}

export interface OnlineOrder {
  id: number;
  comanda_id: number | null;
  mesa_id?: number | null;
  cliente_nome: string;
  telefone: string;
  tipo_entrega: 'entrega' | 'retirada';
  endereco: string | null;
  forma_pagamento: string;
  troco_para?: number | null;
  status: 'recebido' | 'confirmado' | 'cancelado' | 'finalizado';
  subtotal: number;
  taxa_entrega: number;
  valor_entrega?: number | null;
  distancia_km?: number | null;
  modo_entrega?: ModoEntrega | null;
  entrega_gratis?: number | null;
  total: number;
  criado_em: string;
  itens_count?: number;
}

export interface ItemPedido {
  id: number;
  nome: string;
  quantidade: number;
  observacao: string;
  status?: string;
  preco_unitario: number;
  total: number;
  criado_em?: string;
}

export interface PedidoDelivery {
  id: number;
  comanda_id: number | null;
  mesa_id: number | null;
  cliente_nome: string;
  telefone: string;
  tipo_entrega: 'entrega' | 'retirada';
  endereco: string | null;
  forma_pagamento: string;
  troco_para?: number | null;
  observacao: string;
  status: 'recebido' | 'confirmado' | 'cancelado' | 'finalizado';
  etapa: 'aguardando_pix' | 'recebido' | 'preparando' | 'saiu_entrega' | 'pronto_retirada' | 'entregue' | 'cancelado';
  comanda_status: string | null;
  subtotal: number;
  taxa_entrega: number;
  valor_entrega?: number | null;
  distancia_km?: number | null;
  modo_entrega?: ModoEntrega | null;
  entrega_gratis?: number | null;
  total: number;
  criado_em: string;
  espera_min: number;
  itens: ItemPedido[];
}

export interface PedidoRestaurante {
  id: number;
  mesa_id: number;
  cliente_nome: string;
  garcom_nome: string;
  status: string;
  criado_em: string;
  espera_min: number;
  mesa_numero: number;
  mesa_nome: string;
  mesa_tipo: string;
  nfc_uid: string | null;
  total: number;
  pendentes: number;
  itens: ItemPedido[];
}

export interface PedidoPrioridade {
  posicao: number;
  id: number;
  comanda_id: number;
  pedido_online_id: number | null;
  canal: 'delivery' | 'restaurante';
  nome: string;
  quantidade: number;
  observacao: string;
  status: string;
  criado_em: string;
  espera_min: number;
  cliente_nome: string;
  garcom_nome: string;
  telefone: string;
  tipo_entrega: 'entrega' | 'retirada' | null;
  endereco: string | null;
  mesa_numero: number;
  mesa_nome: string;
  mesa_tipo: string;
  nfc_uid: string | null;
}

export interface PainelPedidos {
  delivery: PedidoDelivery[];
  restaurante: PedidoRestaurante[];
  prioridade: PedidoPrioridade[];
}

export interface LancamentoCozinha {
  id: string;
  comanda_id: number;
  lugar: string;
  canal: 'delivery' | 'restaurante';
  cliente_nome: string;
  garcom_nome: string;
  status: 'novo' | 'enviado';
  criado_em: string;
  espera_min: number;
  itens: { id: number; nome: string; quantidade: number; observacao: string; status: string }[];
}

export interface EstacaoCozinha {
  id: string;
  nome: string;
  lancamentos: LancamentoCozinha[];
}

export interface PainelCozinha {
  estacoes: EstacaoCozinha[];
}

export interface MovimentacaoEstoque {
  id: number;
  produto_id: number;
  produto_nome?: string;
  tipo: string;
  quantidade: number;
  saldo_apos: number;
  custo_unitario: number | null;
  preco_unitario: number | null;
  origem: string | null;
  ref_id: number | null;
  responsavel: string | null;
  observacoes: string | null;
  criado_em: string;
}

export interface ValidadeControle {
  id: number;
  produto_id: number;
  produto_nome?: string;
  unidade?: string;
  tipo: string;
  quantidade: number;
  data_fabricacao: string | null;
  data_abertura: string | null;
  data_vencimento: string;
  temperatura: string | null;
  responsavel: string | null;
  observacoes: string | null;
  status: string;
  produto_tipo?: ProdutoTipo;
  categorias_nomes?: string | null;
  validade_aberto_dias?: number | null;
}

export interface Mesa {
  id: number;
  numero: number;
  nome: string;
  capacidade: number;
  setor: string | null;
  status: string;
  ativo: number;
  aberta_em: string | null;
  tipo?: string;
  nfc_uid?: string | null;
}

export interface Comanda {
  id: number;
  mesa_id: number;
  mesa: Mesa | null;
  cliente_nome: string | null;
  garcom_nome: string | null;
  status: string;
  taxa_garcom_pct: number;
  fechamento_tipo: string | null;
  pessoas_count: number;
  pessoas: ComandaPessoa[];
  itens: ComandaItem[];
  subtotal: number;
  comanda_origem_id?: number | null;
  pre_fechamento_em?: string | null;
  baixada_em?: string | null;
  individual_valores?: string | null;
  transfer_comanda_id?: number | null;
  transfer_comanda_status?: string | null;
}

export interface ComandaPessoa {
  id: number;
  comanda_id: number;
  nome: string | null;
  cor: string;
  status?: string;
  baixada_em?: string | null;
}

export interface ComandaItem {
  funcionario_id?: number | null;
  impressoes?: { impressora_id: number; status: string; erro: string | null }[];
  id: number;
  versao: number;
  comanda_id: number;
  pessoa_id: number | null;
  produto_id: number | null;
  nome: string;
  quantidade: number;
  preco_unitario: number;
  observacao: string | null;
  status: string;
  enviado_em: string | null;
  responsavel: string | null;
  criado_em: string;
}

export interface Venda {
  id: number;
  numero: string;
  tipo: string;
  comanda_id: number | null;
  mesa_id: number | null;
  subtotal: number;
  desconto: number;
  taxa_servico: number;
  total: number;
  status: string;
  funcionario: string | null;
  responsavel: string | null;
  observacoes: string | null;
  criado_em: string;
  ajustes?: VendaAjuste[];
  itens?: VendaItem[];
  pagamentos?: Pagamento[];
}

export interface VendaAjuste {
  id: number;
  venda_id: number;
  produto_id: number | null;
  item_id: number | null;
  tipo: 'nao_pago' | 'duplicado_nao_vendido' | 'alteracao_venda' | 'cancelamento_perda' | 'cancelamento_devolucao';
  quantidade: number;
  justificativa: string;
  responsavel: string | null;
  criado_em: string;
}

export interface VendaItem {
  id: number;
  venda_id: number;
  produto_id: number | null;
  nome: string;
  quantidade: number;
  custo_unitario: number;
  preco_unitario: number;
  total: number;
}

export interface Pagamento {
  id: number;
  venda_id: number;
  forma: string;
  valor: number;
}

export interface Perda {
  id: number;
  produto_id: number | null;
  produto_nome?: string;
  quantidade: number;
  valor_unitario: number;
  motivo: string;
  origem: string;
  responsavel: string | null;
  criado_em: string;
  codigo_interno?: string | null;
  unidade?: string | null;
  venda_id?: number | null;
  venda_numero?: string | null;
  venda_tipo?: string | null;
}

export interface Lancamento {
  id: number;
  data: string;
  tipo: string;
  categoria: string | null;
  descricao: string;
  valor: number;
  metodo: string | null;
}

export interface CaixaMov {
  id: number;
  data: string;
  tipo: string;
  valor: number;
  metodo: string | null;
  observacao: string | null;
  funcionario: string | null;
}

export interface FechamentoCaixaResumo {
  data: string;
  vendas_mercado: number;
  total_mercado: number;
  vendas_restaurante: number;
  total_restaurante: number;
  vendas_canceladas: number;
  total_vendas: number;
  formas: Record<string, number>;
  entradas: number;
  saidas: number;
  saldo_caixa: number;
  vendas: { id: number; numero: string; tipo: string; status: string; total: number; criado_em: string; pagamentos?: { forma: string; valor: number }[] }[];
}

export interface FechamentoCaixa {
  id: number;
  data: string;
  vendas_mercado: number;
  total_mercado: number;
  vendas_restaurante: number;
  total_restaurante: number;
  vendas_canceladas: number;
  total_esperado: number;
  total_informado: number;
  diferenca: number;
  status: string;
  justificativa: string | null;
  responsavel: string | null;
  criado_em: string;
}

export interface Conta {
  id: number;
  descricao: string;
  fornecedor?: string | null;
  cliente?: string | null;
  valor: number;
  data_vencimento: string;
  status: string;
}

export interface Funcionario {
  id: number;
  nome: string;
  usuario: string;
  perfil: string;
  pin_configurado?: number;
  modulos: string[];
  ativo: number;
}

export interface ResumoRelatorio {
  vendas_count: number;
  faturamento: number;
  custo_vendido: number;
  despesas: number;
  perdas: number;
  outras_receitas: number;
  cmv: number;
  cmv_pct: number;
  lucro_bruto: number;
  lucro_liquido: number;
  margem_pct: number;
  ticket_medio: number;
}

export interface EstadoSistema {
  produtos: number;
  estoque_baixo: number;
  vendas_hoje: number;
  faturamento_hoje: number;
  mesas_ocupadas: number;
  comandas_abertas: number;
  validade_vencendo: number;
  perdas_hoje: number;
}

export interface ConfigEmpresa {
  config: Record<string, string>;
  modo: 'mercado' | 'estoque';
  taxa_garcom_pct: number;
  perda_timeout_min: number;
  empresa_nome: string;
  empresa_cnpj: string;
  dias_vencimento_aviso: number;
}
