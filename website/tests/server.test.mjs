import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {createMongoService,checkedInputs,digest} from '../server/mongo-ledger.mjs';
import {createWebServer} from '../server/server.mjs';
import {createJournalSigner} from '../server/journal.mjs';
import {emptyBook} from '../server/runtime/finance.mjs';
import {spawnSync} from 'node:child_process';
let mongo,client;
before(async()=>{mongo=await MongoMemoryServer.create({binary:{version:'7.0.35'}});client=await MongoClient.connect(mongo.getUri());});
after(async()=>{await client?.close();await mongo?.stop();});
async function setup(t,{empty=false}={}){
 const db=client.db('asset_http_test_'+randomUUID().replaceAll('-',''));t.after(()=>db.dropDatabase());
 const environment={APP_PASSWORD:'test-password',SESSION_SECRET:'test-session-secret-longer-than-32-characters',LEDGER_INSTANCE_ID:'http-test',LEDGER_ID:'main',LEGACY_ACCOUNT_ID:'1234567890abcdef12345678'};
 const service=await createMongoService({environment,database:db});if(!empty)await service.importBook(emptyBook(),{apply:true});
 const server=await createWebServer({environment,service,staticDir:new URL('../dist',import.meta.url).pathname});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;let cookie='';
 async function request(route,{method='GET',body,originHeader=origin,useCookie=true}={}){const res=await fetch(origin+route,{method,headers:{...(method==='POST'?{'Content-Type':'application/json',Origin:originHeader}:{}),...(useCookie&&cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {res,data:await res.json()};}
 const login=()=>request('/api/login',{method:'POST',body:{password:environment.APP_PASSWORD}});
 return {environment,service,request,login,db};
}
test('HTTP auth returns stable NAS cache identity, protects reads, and retains CSRF guard',async t=>{
 const {request,login,service}=await setup(t);assert.equal((await request('/api/book')).res.status,401);
 const result=await login();assert.equal(result.data.source,'nas');assert.equal(result.data.instanceId,'http-test');assert.equal(result.data.accountId,service.identity.accountId);assert.equal(result.data.legacyAccountId,'1234567890abcdef12345678');assert.match(result.res.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 assert.equal((await request('/api/ledger/connect',{method:'POST',body:{},originHeader:'https://evil.invalid'})).res.status,403);assert.equal((await request('/api/session')).data.cacheNamespace,service.identity.accountId);
});
test('generic two-stage HTTP upload reads NAS and compatibility routes do not need Feishu credentials',async t=>{
 const {request,login}=await setup(t);await login();const connected=await request('/api/ledger/connect',{method:'POST',body:{target:'ignored'}});assert.equal(connected.res.status,200);assert.equal(connected.data.sync.source,'nas');assert.equal(connected.data.ready,true);
 const baseBook=connected.data.book,book=structuredClone(baseBook);book.base='USD';const prepared=await request('/api/ledger/prepare',{method:'POST',body:{book,baseBook}});assert.equal(prepared.res.status,200);assert.equal((await request('/api/book?refresh=1')).data.book.base,'CNY');
 const uploaded=await request('/api/ledger/upload',{method:'POST',body:{journal:prepared.data.journal}});assert.equal(uploaded.res.status,200);assert.equal(uploaded.data.book.base,'USD');assert.equal((await request('/api/feishu/upload',{method:'POST',body:{journal:prepared.data.journal}})).data.book.base,'USD');assert.equal((await request('/api/feishu/connect',{method:'POST',body:{}})).res.status,200);
 assert.equal((await request('/api/ledger/backup')).data.format,'asset-mongo-backup');
});
test('signed journal rejects old source and tampering without publishing',async t=>{
 const {request,login,service,environment}=await setup(t);await login();const baseBook=(await service.pull()).book,book=structuredClone(baseBook);book.base='USD';
 const old=createJournalSigner(environment.SESSION_SECRET,service.identity.accountId).seal({recovery:{source:'feishu'},book,baseBook});
 assert.equal((await request('/api/ledger/upload',{method:'POST',body:{journal:old}})).res.status,409);
 const prepared=await request('/api/ledger/prepare',{method:'POST',body:{book,baseBook}});prepared.data.journal.payload+=' ';assert.equal((await request('/api/ledger/upload',{method:'POST',body:{journal:prepared.data.journal}})).res.status,400);assert.equal((await service.pull()).book.base,'CNY');
});
test('HTTP conflicts report field paths and retain official value',async t=>{
 const {request,login,service}=await setup(t);await login();const baseBook=(await service.pull()).book,a=structuredClone(baseBook),b=structuredClone(baseBook);a.base='USD';b.base='HKD';
 const first=await request('/api/ledger/prepare',{method:'POST',body:{book:a,baseBook}}),second=await request('/api/ledger/prepare',{method:'POST',body:{book:b,baseBook}});await request('/api/ledger/upload',{method:'POST',body:{journal:first.data.journal}});
 const conflict=await request('/api/ledger/upload',{method:'POST',body:{journal:second.data.journal}});assert.equal(conflict.res.status,409);assert.deepEqual(conflict.data.conflicts,['base']);assert.equal((await service.pull()).book.base,'USD');
});
test('read failures do not turn previous cloud snapshot into empty ready ledger',async t=>{
 const {request,login,service}=await setup(t);await login();assert.equal((await request('/api/book?refresh=1')).data.ready,true);
 service.pull=async()=>{throw Error('mongodb://password@host/body');};const result=await request('/api/book?refresh=1');assert.equal(result.data.ready,true);assert.equal(result.data.sync.source,'nas');assert.match(result.data.sync.error,/NAS/);assert.ok(!JSON.stringify(result.data).includes('password@host'));
});

test('authenticated import in the single runtime validates dry run, publishes verified empty target and refuses overwrite',async t=>{
 const {request,login,service,db}=await setup(t,{empty:true}),book=emptyBook();book.base='USD';
 const backup={format:'finance-atlas',version:1,exportedAt:'2026-10-11T00:00:00.000Z',book},body={backup,apply:true},hash=digest(checkedInputs(book));
 assert.equal((await request('/api/ledger/import',{method:'POST',body})).res.status,401);await login();
 assert.equal((await request('/api/ledger/import',{method:'POST',body,originHeader:'https://evil.invalid'})).res.status,403);
 const dry=await request('/api/ledger/import',{method:'POST',body:{backup}});assert.equal(dry.res.status,200);assert.equal(dry.data.applied,false);assert.equal(dry.data.hash,hash);assert.equal(await db.collection('ledgers').countDocuments(),0);assert.equal(await db.collection('ledger_versions').countDocuments(),0);
 const invalid=await request('/api/ledger/import',{method:'POST',body:{backup:{...backup,version:2},apply:true}});assert.equal(invalid.res.status,400);assert.equal(await db.collection('ledgers').countDocuments(),0);
 const imported=await request('/api/ledger/import',{method:'POST',body});assert.equal(imported.res.status,200);assert.equal(imported.data.verified,true);assert.equal(imported.data.ready,true);assert.equal(imported.data.sync.source,'nas');assert.equal(imported.data.hash,hash);assert.equal(digest(checkedInputs(imported.data.book)),hash);
 const version=await db.collection('ledger_versions').findOne({});assert.equal(version.migration.inputsHash,hash);assert.equal(version.migration.originalHash,digest(book));
 const before=await service.exportBackup();assert.equal((await request('/api/ledger/import',{method:'POST',body:{backup:{...backup,book:{...book,base:'HKD'}},apply:true}})).res.status,409);const after=await service.exportBackup();assert.deepEqual(after.ledger,before.ledger);assert.deepEqual(after.versions,before.versions);
 assert.equal((await request('/api/book?refresh=1')).data.book.base,'USD');
});
test('startup authentication configuration failure closes Mongo and exits safely',async()=>{
 await client.db('asset').command({createUser:'asset_app',pwd:'local-test-only',roles:[{role:'readWrite',db:'asset'}]});
 const host=new URL(mongo.getUri()).host;
 const result=spawnSync(process.execPath,['server/index.mjs'],{cwd:process.cwd(),encoding:'utf8',timeout:3000,env:{...process.env,NODE_ENV:'production',APP_ORIGIN:'https://example.test',APP_PASSWORD:'',SESSION_SECRET:'valid-test-session-secret-over-32-characters',LEDGER_INSTANCE_ID:'startup-test',MONGODB_DATABASE:'asset',MONGODB_URI:'mongodb://asset_app:local-test-only@'+host+'/asset?authSource=asset'}});
 assert.equal(result.status,1,'startup must exit instead of retaining database sockets');assert.match(result.stderr,/APP_PASSWORD/);assert.ok(!result.stderr.includes('local-test-only'));
});
