// Modelo comercial da DoixP. O valor mensal ainda não foi definido aqui.
// O cadastro público permanece fechado até a implantação do fluxo de adesão.
export const SIGNUP_POLICY = Object.freeze({
  valor_centavos: null,
  moeda: 'BRL',
  periodicidade: 'mensal',
  comissao_vendas_pct: 0,
  pagamento_disponivel: false,
});

export function cadastroHandler(c) {
  return c.json({
    error: 'A abertura de novas contas pelo site está em preparação. A proposta da DoixP é uma mensalidade fixa, sem comissão sobre as vendas.',
    code: 'CADASTRO_INDISPONIVEL',
    cadastro: SIGNUP_POLICY,
  }, 403);
}
