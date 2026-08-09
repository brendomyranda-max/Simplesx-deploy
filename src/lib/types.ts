export interface Categoria {
  id: number;
  nome: string;
  cor: string;
  ativo: number;
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
  custo: number;
  preco: number | null;
  fornecedor_id: number | null;
  fornecedor_nome?: string | null;
  marca: string | null;
  validade_fabricacao_dias: number | null;
  validade_aberto_dias: number | null;
  temperatura: string | null;
  ativo: number;
  exibir_restaurante: number;
  exibir_mercado: number;
  observacoes: string | null;
  comentarios?: string[];
  categorias: Categoria[];
  codigos_barras: CodigoBarras[];
  ficha?: FichaIngrediente[];
  ficha_count?: number;
  estoque_possivel?: number | null;
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
  id: number;
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
  itens?: VendaItem[];
  pagamentos?: Pagamento[];
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
  pin: string | null;
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
