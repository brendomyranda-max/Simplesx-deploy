# Cadastro pago e investimento

O cadastro feito diretamente pela tela de acesso passa a exigir **R$ 50,00 uma
única vez**. O preço é definido em centavos no servidor (`shared/signup-policy.js`)
e publicado por `GET /api/auth/config`; o navegador apenas o apresenta.

## Estado atual

O meio de recebimento ainda aguarda definição e credenciais. A tela informa
**Pagamento em preparação**, sem coletar dados de um novo cadastro nem oferecer
um pagamento que ainda não pode ser confirmado. `POST /api/auth/cadastro` retorna
HTTP 402 e não cria estabelecimento, funcionário, sessão ou configurações.
Chamadas de versões antigas e valores/status de pagamento enviados pelo cliente
também não liberam contas. Não existe opção de cadastro público gratuito.

As contas existentes continuam entrando normalmente. A criação administrativa
pela CLI continua disponível ao operador com acesso ao ambiente.

Esta etapa não implementa cobrança real, cadastro pendente, webhook ou aprovação
manual. Não há migração de banco necessária. A configuração PagBank existente
para pagamentos do restaurante também não habilita o pagamento de cadastro.

## Próxima etapa após definir o recebimento

- Confirmar o recebedor/provedor e configurar suas credenciais no servidor.
- Criar uma solicitação pendente com senha protegida e referência de cobrança
  única, sem conceder acesso antes da confirmação.
- Validar no servidor a origem da confirmação, moeda, valor de 5.000 centavos e
  vínculo com o cadastro; retornos do navegador não comprovam pagamento.
- Liberar o estabelecimento, administrador e configurações em uma transação
  idempotente; validar repetição, falha, expiração e retomada do pagamento.
- Testar o fluxo no ambiente do provedor antes de habilitar recebimentos reais.

## Apresentação da empresa

**Invista na SimplesX — Faça parte da nossa empresa** substitui a colaboração
no acesso e na página inicial. A apresentação informa **Proposta em preparação**
até o responsável fornecer a trajetória, o momento atual, os objetivos e as
condições de participação. Não há termos de investimento ou valores prometidos.

O formulário de contribuição, a rota `/api/colaboracao`, o gerador de Pix estático
e as configurações `COLABORACAO_PIX_*` foram removidos.

Validação: `npm test`, `npm run build` e revisão da interface em desktop/celular.
