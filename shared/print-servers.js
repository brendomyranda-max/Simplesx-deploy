import { now } from './util.js';

export const SERVER_TIMEOUT_MS = 90_000;
export const serverCutoff = () => new Date(Date.now() - SERVER_TIMEOUT_MS).toISOString();
export const SESSION_CONFLICT = 'Servidor em uso. Desconecte a sessão atual no aplicativo antes de conectar novamente ou excluir.';

// Executadas no mesmo batch da alteração de propriedade/revogação. A condição
// identifica a alteração vencedora, inclusive quando duas requisições competem.
export function cleanupServerStatements(db, tenantId, type, id, token, guard = '1=1', guardArgs = []) {
  const statement = (sql, args) => db.prepare(`${sql} AND (${guard})`).bind(...args, ...guardArgs);
  const routeFilter = 'estabelecimento_id=? AND servidor_tipo=? AND servidor_id=?';
  const routeArgs = [tenantId, type, String(id)];
  const statements = [
    statement(`UPDATE categorias SET impressora_agente_id=NULL WHERE estabelecimento_id=?
      AND impressora_agente_id IN (SELECT id FROM impressora_agentes WHERE ${routeFilter})`, [tenantId, ...routeArgs]),
    statement(`DELETE FROM impressora_agentes WHERE ${routeFilter}`, routeArgs),
    statement('DELETE FROM empresa_config WHERE estabelecimento_id=? AND chave=? AND valor=?',
      [tenantId, type === 'desktop' ? 'gestor_token' : 'gestor_device_id', type === 'desktop' ? token : String(id)]),
  ];
  const current = now();
  statements.push(type === 'desktop'
    ? statement(`UPDATE gestor_jobs SET status='erro', erro='Servidor desvinculado', executado_em=?
        WHERE estabelecimento_id=? AND gestor_token=? AND status IN ('pendente','enviado')`, [current, tenantId, token])
    : statement(`UPDATE device_tasks SET status='cancelled', cancelado_em=?, atualizado_em=?, lease_id=NULL, lease_expira_em=NULL
        WHERE estabelecimento_id=? AND device_id=? AND status IN ('pending','sent','processing')`, [current, current, tenantId, String(id)]));
  return statements;
}
