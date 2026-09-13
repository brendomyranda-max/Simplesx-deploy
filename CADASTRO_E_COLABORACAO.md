# Cadastro e colaboração

Na tela de acesso, escolha **Criar minha conta** e informe CNPJ, telefone com DDD, nome do restaurante e senha (8 a 128 caracteres). Após criar a conta, entre usando o mesmo CNPJ, usuário **admin** e a senha cadastrada. Funcionários existentes continuam entrando com seus próprios usuários.

O cadastro cria um estabelecimento separado, administrador, configurações iniciais e mesa de pagamentos individuais em uma única transação. Usa as tabelas existentes, sem migração nova. A verificação Turnstile usa as mesmas configurações do login.

A contribuição é voluntária e aparece no acesso e na tela inicial. A pessoa informa o valor e escolhe **Gerar QR Code Pix**. O código é montado a partir de `COLABORACAO_PIX_CHAVE`, `COLABORACAO_PIX_NOME` e `COLABORACAO_PIX_CIDADE` no ambiente do servidor, usando o padrão BR Code e CRC16 do Banco Central. Defina esses valores no `.env` para Express, `.dev.vars` para Wrangler local ou Secrets do Cloudflare no deploy. Sem os três valores, a API informa que a contribuição está indisponível. O nome no payload é limitado a 25 caracteres e a cidade a 15; o aplicativo bancário identifica o titular pela chave.

Os dados do recebedor não ficam no código-fonte. A chave e o nome continuam visíveis no Pix gerado, pois são necessários ao pagamento. Para evitar divulgar CPF ou telefone, prefira uma chave Pix aleatória. Não coloque esses valores em variáveis `VITE_*`.

O QR Code é renderizado no navegador, sem serviço externo. Alterar o valor apaga o código anterior, evitando copiar um Pix com o valor antigo. Aceita de R$ 0,01 a R$ 999.999,99. A aplicação não consulta o cadastro da chave, não confirma pagamentos nem condiciona o acesso a contribuições. A configuração antiga `COLABORACAO_PIX_COPIA_COLA` deixou de ser utilizada.

Referência: https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf

Validação: `npm test` e `npm run build`.
