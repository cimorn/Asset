import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebServer} from '../server/server.mjs';
import {ledgerIdentity} from '../server/mongo-ledger.mjs';
import {emptyBook} from '../server/runtime/finance.mjs';

test('HTTP layer binds authentication and compatibility endpoints to NAS identity',async t=>{
 const environment={APP_PASSWORD:'test',SESSION_SECRET:'a-long-test-session-secret-over-32-characters',LEDGER_INSTANCE_ID:'unit-http'};
 const identity=ledgerIdentity(environment),book=emptyBook();
 // This contract test isolates routing; server.test.mjs uses a real disposable MongoDB.
 const service={identity,status:async()=>({...identity,configured:true,linked:true}),pull:async()=>({book}),accept:async()=>{}};
 const server=await createWebServer({environment,service,staticDir:'.'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'test'})});
 const result=await login.json();assert.equal(result.source,'nas');assert.equal(result.accountId,identity.accountId);
 const res=await fetch(origin+'/api/ledger/connect',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0]},body:'{}'});assert.equal(res.status,200);assert.equal((await res.json()).sync.source,'nas');
});
