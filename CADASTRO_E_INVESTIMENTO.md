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

**Invista na SimplexS.A — Faça parte da nossa empresa** aparece no acesso e na
página inicial. O link **Conhecer a proposta** abre `/investidores`, uma página
pública que pode ser compartilhada e não depende de autenticação ou da API de
sessão. O conteúdo foi adaptado de `Simplex_Apresentacao_Investidores.docx`,
fornecido pelo fundador, mantendo a marca SimplexS.A usada no sistema.

A apresentação cobre a proposta, o problema, o público inicial, os cinco pilares
atuais, os diferenciais propostos, as quatro etapas de evolução, a expansão,
o modelo de receita e as prioridades do aporte. Os módulos futuros estão
identificados, assim como os dados e termos ainda em definição. Não foram
acrescentados clientes, resultados, valores de aporte ou retornos estimados.

O documento descreve a assinatura mensal como modelo de receita proposto,
com preço e escopo ainda em definição. Isso não altera a taxa única de abertura
da conta nem implementa cobrança recorrente. A aplicação do aporte é apresentada
por prioridade; orçamento, prazos, modalidade e condições continuam em definição.

O conteúdo editorial está em `src/content/investidores.ts`; sua apresentação
está em `src/pages/InvestidoresPage.tsx`. A página é carregada separadamente
para não acrescentar todo o conteúdo ao carregamento inicial do sistema.

O botão **Quero investir**, nas condições da proposta e no encerramento da página,
abre o WhatsApp de Brendo Myranda, **+55 (11) 93941-7895**, com uma mensagem de
interesse preenchida. O visitante decide quando enviar a mensagem. O contato e
o texto estão centralizados em `src/content/investidores.ts`.

O formulário de contribuição, a rota `/api/colaboracao`, o gerador de Pix estático
e as configurações `COLABORACAO_PIX_*` foram removidos.

Validação: `npm test`, `npm run build` e revisão da interface em desktop/celular.
