import { patternToRegex, modulosFromString, temModulo, sha256 } from './util.js';
import * as cat from './handlers-catalog.js';
import * as ven from './handlers-vendas.js';
import * as fin from './handlers-financeiro.js';
import * as cad from './handlers-cadastros.js';
import * as gestor from './handlers-gestor.js';
import { TenantDb } from './tenant-db.js';

// Módulos: 'gestor' (tudo), 'pdv_mercado', 'restaurante'
const routes = [
  // auth
  { m: 'POST', p: '/api/auth/login', h: cat.loginHandler, pub: true },
  // funcionários (login por senha/pin não usa token)
  { m: 'POST', p: '/api/funcionarios/login', h: cad.loginFuncionarioHandler, pub: true },
  { m: 'POST', p: '/api/funcionarios/pin', h: cad.loginPinHandler, pub: true },

  // config
  { m: 'GET', p: '/api/config', h: cat.getConfigHandler },
  { m: 'PUT', p: '/api/config', h: cat.putConfigHandler, mod: 'gestor' },

  // estado / dashboard
  { m: 'GET', p: '/api/estado', h: cat.estadoHandler },

  // categorias
  { m: 'GET', p: '/api/categorias', h: cat.listCategoriasHandler },
  { m: 'POST', p: '/api/categorias', h: cat.createCategoriaHandler, mod: 'gestor' },
  { m: 'PUT', p: '/api/categorias/:id', h: cat.updateCategoriaHandler, mod: 'gestor' },

  // fornecedores
  { m: 'GET', p: '/api/fornecedores', h: cat.listFornecedoresHandler },
  { m: 'POST', p: '/api/fornecedores', h: cat.createFornecedorHandler, mod: 'gestor' },
  { m: 'PUT', p: '/api/fornecedores/:id', h: cat.updateFornecedorHandler, mod: 'gestor' },

  // produtos
  { m: 'GET', p: '/api/produtos', h: cat.listProdutosHandler },
  { m: 'POST', p: '/api/produtos', h: cat.createProdutoHandler, mod: 'gestor' },
  { m: 'POST', p: '/api/produtos/buscar', h: cat.buscarProdutoHandler },
  { m: 'GET', p: '/api/produtos/:id', h: cat.getProdutoHandler },
  { m: 'PUT', p: '/api/produtos/:id', h: cat.updateProdutoHandler, mod: 'gestor' },
  { m: 'DELETE', p: '/api/produtos/:id', h: cat.deleteProdutoHandler, mod: 'gestor' },

  // estoque
  { m: 'GET', p: '/api/estoque/movimentacoes', h: cat.listMovimentacoesHandler },
  { m: 'POST', p: '/api/estoque/entrada', h: cat.entradaMercadoriaHandler, mod: 'gestor' },
  { m: 'POST', p: '/api/estoque/ajuste', h: cat.ajustarEstoqueHandler, mod: 'gestor' },

  // validade
  { m: 'GET', p: '/api/validade', h: ven.listValidadeHandler },
  { m: 'POST', p: '/api/validade', h: ven.criarValidadeHandler, mod: 'gestor' },
  { m: 'POST', p: '/api/validade/:id/concluir', h: ven.concluirValidadeHandler, mod: 'gestor' },
  { m: 'POST', p: '/api/validade/:id/descartar', h: ven.descartarValidadeHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/validade/:id/etiqueta', h: ven.etiquetaValidadeHandler },

  // vendas / PDV
  { m: 'POST', p: '/api/vendas', h: ven.criarVendaHandler },
  { m: 'GET', p: '/api/vendas', h: ven.listVendasHandler },
  { m: 'GET', p: '/api/vendas/:id', h: ven.getVendaHandler },
  { m: 'POST', p: '/api/vendas/:id/cancelar', h: ven.cancelarVendaHandler, mod: 'gestor' },

  // mesas
  { m: 'GET', p: '/api/mesas', h: ven.listMesasHandler },
  { m: 'POST', p: '/api/mesas', h: ven.createMesaHandler, mod: 'gestor' },
  { m: 'POST', p: '/api/mesas/:id/abrir', h: ven.abrirComandaHandler },
  { m: 'PUT', p: '/api/mesas/:id', h: ven.updateMesaHandler, mod: 'gestor' },
  { m: 'DELETE', p: '/api/mesas/:id', h: ven.deleteMesaHandler, mod: 'gestor' },

  // comandas
  { m: 'GET', p: '/api/comandas/:id', h: ven.getComandaHandler },
  { m: 'POST', p: '/api/comandas/:id/pessoas', h: ven.addPessoaHandler },
  { m: 'DELETE', p: '/api/comandas/:id/pessoas/:pid', h: ven.removePessoaHandler },
  { m: 'PUT', p: '/api/comandas/:id/pessoas/:pid', h: ven.updatePessoaComandaHandler },
  { m: 'POST', p: '/api/comandas/:id/itens', h: ven.addItemComandaHandler },
  { m: 'PUT', p: '/api/comandas/:id/itens/:item_id', h: ven.updateItemComandaHandler },
  { m: 'POST', p: '/api/comandas/:id/itens/:item_id/status', h: ven.updateItemStatusHandler },
  { m: 'POST', p: '/api/comandas/:id/fechar', h: ven.fecharComandaHandler },
  { m: 'POST', p: '/api/comandas/:id/reabrir', h: ven.reabrirComandaHandler },
  { m: 'POST', p: '/api/comandas/:id/baixar-pessoa', h: ven.baixarPessoaComandaHandler },

  // impressão
  { m: 'POST', p: '/api/impressao/comanda', h: cad.imprimirComandaHandler },
  { m: 'POST', p: '/api/impressao/pessoa', h: cad.imprimirPessoaComandaHandler },
  { m: 'GET', p: '/api/impressao/etiqueta/:id', h: cad.imprimirEtiquetaHandler },

  // gestor local (conexão direta com o deploy)
  { m: 'POST', p: '/api/gestor/register', h: gestor.registerGestorHandler, pub: true },
  { m: 'POST', p: '/api/gestor/pull', h: gestor.pullGestorJobsHandler, pub: true },
  { m: 'POST', p: '/api/gestor/jobs/:id/status', h: gestor.gestorJobStatusHandler, pub: true },
  { m: 'GET', p: '/api/gestores', h: gestor.listGestoresHandler },
  { m: 'POST', p: '/api/impressao/enviar', h: gestor.enviarImpressaoHandler },

  // perdas
  { m: 'GET', p: '/api/perdas', h: fin.listPerdasHandler },
  { m: 'POST', p: '/api/perdas', h: fin.createPerdaHandler, mod: 'gestor' },

  // financeiro
  { m: 'GET', p: '/api/despesas', h: fin.listDespesasHandler },
  { m: 'POST', p: '/api/despesas', h: fin.createDespesaHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/contas-pagar', h: fin.listContasPagarHandler },
  { m: 'POST', p: '/api/contas-pagar', h: fin.createContaPagarHandler, mod: 'gestor' },
  { m: 'POST', p: '/api/contas-pagar/:id/pagar', h: fin.pagarContaHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/contas-receber', h: fin.listContasReceberHandler },
  { m: 'POST', p: '/api/contas-receber', h: fin.createContaReceberHandler, mod: 'gestor' },
  { m: 'POST', p: '/api/contas-receber/:id/receber', h: fin.receberContaHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/lancamentos', h: fin.listLancamentosHandler },
  { m: 'POST', p: '/api/lancamentos', h: fin.createLancamentoHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/caixa', h: fin.listCaixaHandler },
  { m: 'POST', p: '/api/caixa', h: fin.createCaixaHandler, mod: 'gestor' },

  // relatórios
  { m: 'GET', p: '/api/relatorios/resumo', h: fin.resumoRelatorioHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/relatorios/mais-vendidos', h: fin.maisVendidosHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/relatorios/estoque-baixo', h: fin.estoqueBaixoHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/relatorios/vencimentos', h: fin.vencimentosRelatorioHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/relatorios/perdas', h: fin.perdasRelatorioHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/relatorios/vendas-por-dia', h: fin.vendasPorDiaHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/relatorios/lucro-categoria', h: fin.lucroPorCategoriaHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/relatorios/vendas-funcionario', h: fin.vendasPorFuncionarioHandler, mod: 'gestor' },

  // funcionários
  { m: 'GET', p: '/api/funcionarios', h: cad.listFuncionariosHandler },
  { m: 'POST', p: '/api/funcionarios', h: cad.createFuncionarioHandler, mod: 'gestor' },
  { m: 'PUT', p: '/api/funcionarios/:id', h: cad.updateFuncionarioHandler, mod: 'gestor' },
  { m: 'DELETE', p: '/api/funcionarios/:id', h: cad.deleteFuncionarioHandler, mod: 'gestor' },

  // impressoras / setores
  { m: 'GET', p: '/api/setores-impressao', h: cad.listSetoresHandler },
  { m: 'POST', p: '/api/setores-impressao', h: cad.createSetorHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/impressora-agentes', h: cad.listAgentesHandler },
  { m: 'POST', p: '/api/impressora-agentes', h: cad.createAgenteHandler, mod: 'gestor' },
  { m: 'PUT', p: '/api/impressora-agentes/:id', h: cad.updateAgenteHandler, mod: 'gestor' },
  { m: 'GET', p: '/api/impressora-etiquetas', h: cad.listEtiquetasHandler },
  { m: 'POST', p: '/api/impressora-etiquetas', h: cad.createEtiquetaHandler, mod: 'gestor' },
];

export async function authMiddleware(c, env) {
  const header = c.req.header('authorization') || c.req.header('x-token') || '';
  let tokenValue = '';
  if (header.startsWith('Bearer ')) tokenValue = header.slice(7).trim();
  else if (header) tokenValue = header.trim();
  else tokenValue = c.req.query('token') || '';
  if (!tokenValue) return null;

  const f = await env.DB.prepare(
    `SELECT f.id, f.nome, f.perfil, f.modulos, f.estabelecimento_id
     FROM sessoes s JOIN funcionarios f ON f.id=s.funcionario_id AND f.estabelecimento_id=s.estabelecimento_id
     JOIN estabelecimentos e ON e.id=s.estabelecimento_id
     WHERE s.token_hash=? AND s.expira_em>? AND f.ativo=1 AND e.ativo=1`
  )
    .bind(await sha256(tokenValue), new Date().toISOString())
    .first();
  if (!f) return null;
  return { id: f.id, nome: f.nome, perfil: f.perfil, modulos: modulosFromString(f.modulos), estabelecimento_id: f.estabelecimento_id };
}

export async function handle(c, env) {
  const path = c.req.path || '/';
  const method = (c.req.method || 'GET').toUpperCase();

  for (const route of routes) {
    if (route.m !== method) continue;
    const { re, names } = patternToRegex(route.p);
    const m = path.match(re);
    if (!m) continue;

    c.params = {};
    names.forEach((n, i) => (c.params[n] = decodeURIComponent(m[i + 1])));

    if (!route.pub) {
      const user = await authMiddleware(c, env);
      if (!user) return c.json({ error: 'Usuário ou senha inválidos' }, 401);
      if (route.mod && !temModulo(user, route.mod)) {
        return c.json({ error: 'Usuário ou senha inválidos' }, 403);
      }
      c.user = user;
      env = { ...env, rawDB: env.DB, DB: new TenantDb(env.DB, user.estabelecimento_id), estabelecimentoId: user.estabelecimento_id };
    }
    try {
      return await route.h(c, env);
    } catch (e) {
      const status = e && e.status ? e.status : 500;
      const msg = e && e.message ? e.message : 'Erro interno';
      if (status === 500) console.error('[handler error]', path, e);
      return c.json({ error: msg }, status);
    }
  }
  return c.json({ error: 'Rota não encontrada' }, 404);
}
