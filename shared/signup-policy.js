// Taxa de abertura de conta definida no servidor, em centavos.
// O cadastro público permanece fechado até existir confirmação de pagamento
// pelo recebedor. Nunca liberar uma conta com base em dados enviados pelo cliente.
export const SIGNUP_POLICY = Object.freeze({
  valor_centavos: 5000,
  moeda: 'BRL',
  periodicidade: 'unico',
  pagamento_disponivel: false,
});

export function cadastroHandler(c) {
  return c.json({
    error: 'A criação da conta exige o pagamento único de R$ 50,00. O pagamento para novos cadastros ainda está em preparação.',
    code: 'PAGAMENTO_CADASTRO_INDISPONIVEL',
    cadastro: SIGNUP_POLICY,
  }, 402);
}
