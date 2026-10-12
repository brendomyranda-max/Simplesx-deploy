import assert from 'node:assert/strict';
import test from 'node:test';
import SqliteDb from '../server/sqlite-db.js';
import { handle } from '../shared/router.js';
import { emitirNfceVenda } from '../shared/handlers-fiscal.js';
import { sha256 } from '../shared/util.js';

test('módulo fiscal em breve bloqueia configurações e emissão mesmo para sessão autorizada',async t=>{
  const DB=new SqliteDb(':memory:');t.after(()=>DB.close());
  DB.prepare("INSERT INTO estabelecimentos (id,nome) VALUES (1,'Restaurante')").run();
  DB.prepare("INSERT INTO funcionarios (id,estabelecimento_id,nome,usuario,senha_hash,modulos) VALUES (1,1,'Admin','admin','hash','gestor,area:vendas')").run();
  DB.prepare("INSERT INTO sessoes (estabelecimento_id,funcionario_id,token_hash,expira_em) VALUES (1,1,?,'2099-01-01')").bind(await sha256('fiscal-test')).run();
  const request=(path,method,login=true)=>handle({req:{path,method,json:async()=>({ativo:1,emitir_automaticamente:1}),query:()=>undefined,header:()=>login?'Bearer fiscal-test':undefined},json:(data,status=200)=>({data,status})},{DB});
  for(const[path,method]of [['/api/fiscal/config','GET'],['/api/fiscal/config','PUT'],['/api/fiscal/produtos','GET'],['/api/fiscal/produtos/1','PUT'],['/api/fiscal/documentos','GET'],['/api/fiscal/documentos/1','GET'],['/api/fiscal/documentos/1/cancelar','POST'],['/api/vendas/1/nfce','POST']]) {
    const result=await request(path,method);
    assert.equal(result.status,501,path);assert.equal(result.data.code,'FISCAL_EM_BREVE');assert.equal(result.data.disponivel,false);
    assert.equal((await request(path,method,false)).status,401);
  }
  for(const table of ['fiscal_config','documentos_fiscais','documento_fiscal_itens','documento_fiscal_eventos']) assert.equal(DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first().n,0);
});

test('emissão automática permanece desligada sem consultar configuração antiga nem interromper a venda',async()=>{
  const env={DB:{prepare(){throw new Error('Não deve acessar configurações nem documentos');}}};
  assert.equal(await emitirNfceVenda(env,1,{automatico:true}),null);
  await assert.rejects(emitirNfceVenda(env,1),error=>error.status===501 && /em breve/.test(error.message));
});
