import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {MongoClient} from 'mongodb';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {createMongoService} from '../server/mongo-ledger.mjs';
import {createWebServer} from '../server/server.mjs';
import {applyAction,emptyBook} from '../server/runtime/finance.mjs';

const networkFetch=globalThis.fetch;
let mongo,client,cacheModule;
before(async()=>{
 mongo=await MongoMemoryServer.create({binary:{version:'7.0.35'}});client=await MongoClient.connect(mongo.getUri());
 const compiled=await build({entryPoints:['src/cache.ts'],bundle:true,write:false,format:'esm',platform:'browser',alias:{'@':process.cwd()}});
 cacheModule='data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64');
});
after(async()=>{globalThis.fetch=networkFetch;await client?.close();await mongo?.stop();});

async function setup(t,initial=emptyBook()){
 const db=client.db('asset_cache_http_test_'+randomUUID().replaceAll('-',''));t.after(()=>db.dropDatabase());
 const environment={APP_PASSWORD:'synthetic-password',SESSION_SECRET:'synthetic-session-secret-more-than-32-characters',LEDGER_INSTANCE_ID:'cache-http-test',LEDGER_ID:'main'};
 const service=await createMongoService({environment,database:db});await service.importBook(initial,{apply:true});
 const server=await createWebServer({environment,service,staticDir:new URL('../dist',import.meta.url).pathname});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;let cookie='';
 const wire=async(route,options={})=>{
  const headers=new Headers(options.headers);if(cookie)headers.set('Cookie',cookie);if(options.method==='POST')headers.set('Origin',origin);
  const response=await networkFetch(origin+route,{...options,headers});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;
 };
 const request=async(route,body)=>{const response=await wire(route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {response,data:await response.json()};};
 const login=await request('/api/login',{password:environment.APP_PASSWORD});assert.equal(login.response.status,200);
 globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;globalThis.window=new EventTarget();Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(_name,work)=>work()}},configurable:true});globalThis.fetch=wire;
 const cache=await import(cacheModule+'#'+randomUUID());cache.setAccount(login.data.accountId,login.data);
 const read=async()=>{const response=await cache.financeRequest('/api/book?refresh=1');assert.equal(response.status,200);return response.json();};
 const edit=async(action)=>{const state=await read(),response=await cache.financeRequest('/api/book',{method:'POST',body:JSON.stringify({version:state.version,action})});assert.equal(response.status,200);return response.json();};
 const upload=()=>cache.financeRequest('/api/ledger/upload',{method:'POST',body:'{}'});
 const reload=async()=>{const reopened=await import(cacheModule+'#'+randomUUID());reopened.setAccount(login.data.accountId,login.data);return reopened;};
 const commit=async(change)=>{
  const baseBook=(await request('/api/book?refresh=1')).data.book,book=structuredClone(baseBook);change(book);
  const prepared=await request('/api/ledger/prepare',{book,baseBook});assert.equal(prepared.response.status,200);
  const uploaded=await request('/api/ledger/upload',{journal:prepared.data.journal});assert.equal(uploaded.response.status,200);return uploaded.data.book;
 };
 return {cache,id:login.data.accountId,service,read,edit,upload,commit,reload};
}
const rates=usd=>({type:'rates',date:'2026-09-01',rates:{CNY:1,USD:usd,HKD:0.914321},source:'手动汇率'});
function addRemoteCash(book,id,value,note,{currency='CNY',date='2026-09-01'}={}){
 book.assets.push({id,name:id,category:'现金',classification:'现金',platform:'银行',market:'不适用',currency,date,value,cost:null,note});
 book.records.push({id:'opening-'+id,assetId:id,name:id,category:'现金',classification:'现金',platform:'银行',currency,date,type:'剩余',before:0,after:value,amount:value,note:'远端开户记录',order:book.records.length+1});
}

test('cache preserves genuine remote conflict after a second independent edit over real Mongo HTTP',async t=>{
 const {cache,id,service,read,edit,upload,commit}=await setup(t);
 await edit({type:'base',base:'USD'});await commit(book=>{book.base='HKD';});
 assert.equal((await read()).book.base,'USD');assert.equal((await upload()).status,409);
 await edit(rates(7.12345678));const conflict=await upload();assert.equal(conflict.status,409,'unrelated rates edit must not rebase away the currency conflict');
 const official=(await service.pull()).book,state=(await cache.exportBrowserCaches()).accounts[id],visible=await read();
 assert.equal(official.base,'HKD');assert.equal(official.rateDate,'');assert.equal(state.draft.base.base,'CNY');assert.equal(state.draft.book.base,'USD');assert.equal(state.draft.book.rateHistory[0].rates.USD,7.12345678);assert.equal(visible.sync.dirty,true);assert.equal(state.pending,null);
});

test('cache action delta leaves successive remote-only edits to merge from latest Mongo data',async t=>{
 const {cache,id,service,read,edit,upload,commit}=await setup(t);
 await edit(rates(7.12345678));await commit(book=>{book.base='USD';});assert.equal((await read()).book.base,'USD');
 await edit(rates(7.23456789));const local=(await cache.exportBrowserCaches()).accounts[id].draft;
 assert.equal(local.base.base,'USD');assert.equal(local.book.base,local.base.base,'observed remote currency must be identical in baseline and local intent');
 await commit(book=>{book.base='HKD';});
 const uploaded=await upload();assert.equal(uploaded.status,200,'remote-only currency must not become a local edit');
 const official=(await service.pull()).book,state=(await cache.exportBrowserCaches()).accounts[id];assert.equal(official.base,'HKD');assert.equal(official.rateHistory[0].rates.USD,7.23456789);assert.equal(state.draft,null);assert.equal(state.pending,null);assert.equal((await read()).sync.dirty,false);
});

test('cache valuation of newly observed remote cash preserves opening history and later remote metadata',async t=>{
 const {cache,id,service,read,edit,upload,commit}=await setup(t);await edit(rates(7.12345678));
 await commit(book=>addRemoteCash(book,'remote-cash',100,'远端账户备注'));assert.equal((await read()).book.assets[0].value,100);
 await edit({type:'cash',id:'remote-cash',kind:'更新市值',value:120,date:'2026-09-01'});
 assert.equal((await read()).book.assets[0].value,120);assert.equal((await service.pull()).book.assets[0].value,100);
 await commit(book=>{book.assets[0].note='远端再次修改备注';});
 const uploaded=await upload();assert.equal(uploaded.status,200,'unchanged remote note is not a local conflict');
 const official=(await service.pull()).book,state=(await cache.exportBrowserCaches()).accounts[id];
 assert.equal(official.assets[0].value,120,'valuation replaces the total instead of adding to it');assert.equal(official.assets[0].note,'远端再次修改备注');assert.equal(official.records.length,2);assert.equal(official.records.find(row=>row.id==='opening-remote-cash').after,100);assert.equal(official.rateHistory[0].rates.USD,7.12345678);assert.equal(state.draft,null);
});

for(const kind of ['消费','转账'])test('cache '+kind+' uses newly observed remote cash opening balance and rejects overspending',async t=>{
 const {cache,id,service,read,edit,upload,commit}=await setup(t);await edit(rates(7.12345678));
 await commit(book=>{addRemoteCash(book,'remote-cash',100,'源账户备注');addRemoteCash(book,'remote-target',30,'目标账户备注');});
 const before=await read(),stored=(await cache.exportBrowserCaches()).accounts[id],action={type:'cash',id:'remote-cash',kind,targetId:kind==='转账'?'remote-target':undefined,date:'2026-09-01'};
 const invalid=await cache.financeRequest('/api/book',{method:'POST',body:JSON.stringify({version:before.version,action:{...action,amount:101}})});assert.equal(invalid.status,400);assert.match((await invalid.json()).error,/余额不足/);assert.deepEqual((await cache.exportBrowserCaches()).accounts[id],stored);
 await edit({...action,amount:20});assert.equal((await upload()).status,200,'valid spending requires the remote opening history in local projection');
 const official=(await service.pull()).book;assert.equal(official.assets.find(asset=>asset.id==='remote-cash').value,80);assert.equal(official.assets.find(asset=>asset.id==='remote-target').value,kind==='转账'?50:30);assert.equal(official.assets.find(asset=>asset.id==='remote-cash').note,'源账户备注');assert.equal(official.records.filter(row=>row.id.startsWith('opening-')).length,2);assert.equal((await read()).sync.dirty,false);
});

const initialFx=()=>applyAction(emptyBook(),rates(7.12345678));
test('cache merges independent first currency dictionaries and new date context before further financial actions',async t=>{
 const {cache,id,service,read,edit,upload,commit}=await setup(t,initialFx());
 await edit({type:'currency',code:'EUR',name:'欧元',rate:8.12345678,date:'2026-09-02'});
 await commit(book=>{Object.assign(book,applyAction(book,{type:'currency',code:'JPY',name:'日元',rate:0.04876543,date:'2026-09-02'}));addRemoteCash(book,'jpy-cash',100,'远端日元备注',{currency:'JPY',date:'2026-09-02'});});
 const observed=await read();assert.equal(observed.book.customCurrencies.EUR,'欧元');assert.equal(observed.book.customCurrencies.JPY,'日元');assert.equal(observed.book.assets[0].value,100);
 await edit({type:'base',base:'USD'});
 const context=(await cache.exportBrowserCaches()).accounts[id].draft,baselinePoint=context.base.rateHistory.find(point=>point.date==='2026-09-02');
 assert.equal(baselinePoint.date,'2026-09-02');assert.equal(baselinePoint.rates.CNY,1);assert.equal(baselinePoint.rates.JPY,0.04876543);assert.equal(baselinePoint.rates.EUR,undefined,'local EUR remains outside the observed baseline');
 await edit({type:'cash',id:'jpy-cash',kind:'消费',amount:20,date:'2026-09-02'});
 await edit({type:'add',date:'2026-09-02',assets:[{id:'eur-cash',name:'欧元账户',category:'现金',classification:'现金',platform:'银行',market:'不适用',currency:'EUR',date:'2026-09-02',value:25,cost:null,note:'本地欧元账户'}]});
 assert.equal((await upload()).status,200);
 const official=(await service.pull()).book;assert.equal(official.customCurrencies.EUR,'欧元');assert.equal(official.customCurrencies.JPY,'日元');assert.equal(official.assets.find(asset=>asset.id==='jpy-cash').value,80);assert.equal(official.assets.find(asset=>asset.id==='eur-cash').value,25);assert.equal(official.rateHistory.find(point=>point.date==='2026-09-02').rates.EUR,8.12345678);assert.equal(official.rateHistory.find(point=>point.date==='2026-09-02').rates.JPY,0.04876543);assert.equal((await read()).sync.dirty,false);
});

test('cache does not rebase divergent rates of the same newly added currency child',async t=>{
 const {cache,id,service,edit,upload,commit}=await setup(t,initialFx());
 await edit({type:'currency',code:'EUR',name:'欧元',rate:8.12345678,date:'2026-09-02'});
 await commit(book=>Object.assign(book,applyAction(book,{type:'currency',code:'EUR',name:'欧元',rate:9.23456789,date:'2026-09-02'})));
 await edit({type:'base',base:'USD'});assert.equal((await upload()).status,409);
 const official=(await service.pull()).book,state=(await cache.exportBrowserCaches()).accounts[id];assert.equal(official.base,'CNY');assert.equal(official.rates.EUR,9.23456789);assert.equal(state.draft.book.rates.EUR,8.12345678);assert.equal(state.draft.base.rates.EUR,undefined);assert.equal(state.pending,null);
});

test('cache preserves a bracket-containing record ID jointly introduced through actual Mongo HTTP',async t=>{
 const {cache,id,service,read,edit,upload,commit}=await setup(t,initialFx()),recordId='opening[cash]',uuid=globalThis.crypto.randomUUID;
 try{
  globalThis.crypto.randomUUID=()=>recordId;
  await edit({type:'add',date:'2026-09-01',assets:[{id:'cash',name:'现金账户',category:'现金',classification:'现金',platform:'银行',market:'不适用',currency:'CNY',date:'2026-09-01',value:100,cost:null,note:'账户备注'}]});
 }finally{globalThis.crypto.randomUUID=uuid;}
 await edit(rates(7.23456789));const local=(await cache.exportBrowserCaches()).accounts[id].draft.book;assert.equal(local.records[0].id,recordId);
 await commit(book=>{book.assets=structuredClone(local.assets);book.records=structuredClone(local.records);book.initialized=true;});await read();
 await edit({type:'base',base:'USD'});const draft=(await cache.exportBrowserCaches()).accounts[id].draft;
 assert.deepEqual(draft.base.records,[],'joint local addition must not create an empty baseline row');assert.equal(draft.book.records[0].id,recordId);assert.ok(draft.book.records.every(row=>row.id&&row.assetId&&row.date));
 assert.equal((await upload()).status,200);const official=(await service.pull()).book;assert.equal(official.records[0].id,recordId);assert.equal(official.assets[0].value,100);assert.equal(official.rates.USD,7.23456789);assert.equal(official.base,'USD');
});

const formFx=()=>applyAction(emptyBook(),{type:'rates',date:'2026-09-01',rates:{CNY:1,USD:7.1,HKD:0.91},source:'手动汇率'});
async function saveForm(cache,version){const draft={date:'2026-09-01',rates:{CNY:'1',USD:'7.2',HKD:'0.91'}},response=await cache.financeRequest('/api/rate-draft',{method:'POST',body:JSON.stringify({version,draft})});assert.equal(response.status,200);return draft;}
test('separate rate form keeps original USD baseline across refresh and cache restart; conflict never writes',async t=>{
 const {cache,id,service,read,commit,reload}=await setup(t,formFx()),shown=await read(),draft=await saveForm(cache,shown.version);
 await commit(book=>Object.assign(book,applyAction(book,{type:'rates',date:'2026-09-01',rates:{CNY:1,USD:7.3,HKD:0.91},source:'手动汇率'})));await read();
 const reopened=await reload();await reopened.financeRequest('/api/book?refresh=1');const upload=await reopened.financeRequest('/api/ledger/upload',{method:'POST',body:'{}'});assert.equal(upload.status,409);
 const official=(await service.pull()).book,state=(await reopened.exportBrowserCaches()).accounts[id];assert.equal(official.rates.USD,7.3);assert.deepEqual(state.rateDraft,draft);assert.equal(state.rateDraftContext.book.rates.USD,7.1);assert.deepEqual(state.rateDraftContext.intent,{USD:'7.2'});assert.equal(state.pending,null);assert.equal((await (await reopened.financeRequest('/api/book')).json()).sync.dirty,true);
});
test('separate USD rate form merges independent remote HKD after refresh and cache restart',async t=>{
 const {cache,id,service,read,commit,reload}=await setup(t,formFx()),shown=await read();await saveForm(cache,shown.version);
 await commit(book=>Object.assign(book,applyAction(book,{type:'rates',date:'2026-09-01',rates:{CNY:1,USD:7.1,HKD:0.95},source:'手动汇率'})));await read();
 const reopened=await reload();await reopened.financeRequest('/api/book?refresh=1');assert.equal((await reopened.financeRequest('/api/ledger/upload',{method:'POST',body:'{}'})).status,200);
 const official=(await service.pull()).book,state=(await reopened.exportBrowserCaches()).accounts[id];assert.equal(official.rates.USD,7.2);assert.equal(official.rates.HKD,0.95);assert.equal(state.rateDraft,null);assert.equal(state.rateDraftContext,null);assert.equal(state.draft,null);
});
test('first form write binds the rendered version even if background read already saw a remote USD edit',async t=>{
 const {cache,id,service,read,upload,commit}=await setup(t,formFx()),shown=await read();
 await commit(book=>Object.assign(book,applyAction(book,{type:'rates',date:'2026-09-01',rates:{CNY:1,USD:7.3,HKD:0.91},source:'手动汇率'})));await read();
 await saveForm(cache,shown.version);assert.equal((await upload()).status,409);assert.equal((await service.pull()).book.rates.USD,7.3);assert.equal((await cache.exportBrowserCaches()).accounts[id].rateDraftContext.book.rates.USD,7.1);
});

for(const conflict of [false,true])test('rate form confirmation '+(conflict?'retains a real conflict':'merges only its changed field')+' over actual Mongo HTTP',async t=>{
 const {cache,id,service,read,upload,commit}=await setup(t,formFx()),shown=await read(),draft=await saveForm(cache,shown.version);
 await commit(book=>Object.assign(book,applyAction(book,{type:'rates',date:'2026-09-01',rates:{CNY:1,USD:conflict?7.3:7.1,HKD:conflict?0.91:0.95},source:'手动汇率'})));
 const current=await read(),response=await cache.financeRequest('/api/book',{method:'POST',body:JSON.stringify({version:current.version,action:{type:'rates',date:draft.date,rates:Object.fromEntries(Object.entries(draft.rates).map(([code,value])=>[code,Number(value)])),source:'手动汇率'}})});
 assert.equal(response.status,conflict?409:200);
 if(conflict){assert.deepEqual((await cache.exportBrowserCaches()).accounts[id].rateDraft,draft);assert.equal((await service.pull()).book.rates.USD,7.3);}
 else{assert.equal((await upload()).status,200);const official=(await service.pull()).book;assert.equal(official.rates.USD,7.2);assert.equal(official.rates.HKD,0.95);}
});

test('form retry retains baseline, raw fields and independent financial edits after prepare transport failure',async t=>{
 const {cache,id,service,read,edit,upload,commit,reload}=await setup(t,formFx()),shown=await read(),draft=await saveForm(cache,shown.version);await edit({type:'base',base:'USD'});
 const wire=globalThis.fetch;globalThis.fetch=(url,options)=>{if(url==='/api/ledger/prepare')throw Error('synthetic prepare offline');return wire(url,options);};assert.equal((await upload()).status,400);globalThis.fetch=wire;
 const saved=(await cache.exportBrowserCaches()).accounts[id];assert.deepEqual(saved.rateDraft,draft);assert.equal(saved.rateDraftContext.book.rates.USD,7.1);assert.equal(saved.draft.book.base,'USD');assert.equal(saved.pending,null);assert.equal((await service.pull()).book.rates.USD,7.1);
 await commit(book=>Object.assign(book,applyAction(book,{type:'rates',date:'2026-09-01',rates:{CNY:1,USD:7.1,HKD:0.95},source:'手动汇率'})));
 const reopened=await reload();await reopened.financeRequest('/api/book?refresh=1');assert.equal((await reopened.financeRequest('/api/ledger/upload',{method:'POST',body:'{}'})).status,200);
 const official=(await service.pull()).book;assert.equal(official.base,'USD');assert.equal(official.rates.USD,7.2);assert.equal(official.rates.HKD,0.95);assert.equal((await reopened.exportBrowserCaches()).accounts[id].rateDraft,null);
});

test('confirmed save publishes immediately without a separate upload and keeps unrelated unfinished rate input',async t=>{
 const {cache,id,service,read}=await setup(t,formFx()),shown=await read(),draft=await saveForm(cache,shown.version);
 const response=await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:shown.version,action:{type:'base',base:'USD'}})});assert.equal(response.status,200);
 const official=(await service.pull()).book,state=(await cache.exportBrowserCaches()).accounts[id];assert.equal(official.base,'USD');assert.equal(official.rates.USD,7.1,'unconfirmed form must not be submitted by a different action');assert.deepEqual(state.rateDraft,draft);assert.equal(state.rateDraftContext.book.rates.USD,7.1);assert.equal(state.draft,null);assert.equal(state.pending,null);assert.equal(state.confirmedSave,null);
});

test('confirmed cash addition resumes a lost successful response after cache restart without duplicate records',async t=>{
 const {cache,id,service,read,reload}=await setup(t,formFx()),shown=await read(),action={type:'add',date:'2026-09-01',assets:[{id:'direct-cash',name:'现金账户',category:'现金',classification:'现金',platform:'银行',market:'不适用',currency:'CNY',date:'2026-09-01',value:100,cost:null,note:'确认保存'}]};
 const wire=globalThis.fetch;globalThis.fetch=async(url,options)=>{const response=await wire(url,options);if(url==='/api/ledger/upload')throw Error('synthetic lost successful response');return response;};
 const failed=await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:shown.version,action})});assert.notEqual(failed.status,200);assert.match((await failed.json()).error,/synthetic lost successful response/);globalThis.fetch=wire;
 let state=(await cache.exportBrowserCaches()).accounts[id];assert.deepEqual(state.confirmedSave.action,action);assert.ok(state.pending);assert.equal(state.draft.book.assets[0].value,100);assert.equal((await service.pull()).book.records.length,1);
 const reopened=await reload(),retry=await reopened.financeRequest('/api/ledger/save',{method:'POST',body:'{}'});assert.equal(retry.status,200);const official=(await service.pull()).book,backup=await service.exportBackup();state=(await reopened.exportBrowserCaches()).accounts[id];assert.equal(official.records.length,1);assert.equal(official.assets[0].value,100);assert.equal(backup.ledger.receipts.length,1);assert.equal(state.draft,null);assert.equal(state.pending,null);assert.equal(state.confirmedSave,null);
});

test('confirmed save failure retains intent and requires explicit resolution before another action',async t=>{
 const {cache,id,service,read}=await setup(t,formFx()),shown=await read(),action={type:'base',base:'USD'},wire=globalThis.fetch;
 globalThis.fetch=(url,options)=>{if(url==='/api/ledger/prepare')throw Error('synthetic prepare offline');return wire(url,options);};
 assert.notEqual((await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:shown.version,action})})).status,200);globalThis.fetch=wire;
 assert.equal((await service.pull()).book.base,'CNY');let state=(await cache.exportBrowserCaches()).accounts[id];assert.equal(state.draft.book.base,'USD');assert.deepEqual(state.confirmedSave.action,action);
 const changed=await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:state.version,action:{type:'base',base:'HKD'}})});assert.equal(changed.status,409);assert.equal((await service.pull()).book.base,'CNY');assert.deepEqual((await cache.exportBrowserCaches()).accounts[id].confirmedSave.action,action);
 assert.equal((await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:shown.version,action})})).status,200);assert.equal((await service.pull()).book.base,'USD');
});

test('direct save never implicitly replays an old financial draft and archives it only after explicit recovery',async t=>{
 const {cache,id,service,read,edit}=await setup(t,formFx());await edit({type:'base',base:'USD'});const shown=await read(),before=(await cache.exportBrowserCaches()).accounts[id];
 assert.equal((await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:shown.version,action:rates(7.2)})})).status,409);assert.equal((await service.pull()).book.base,'CNY');assert.deepEqual((await cache.exportBrowserCaches()).accounts[id].draft,before.draft);
 assert.equal((await cache.financeRequest('/api/ledger/reprepare',{method:'POST',body:JSON.stringify({version:shown.version,discardDraft:true})})).status,200);
 const archive=await cache.exportBrowserCaches();assert.equal(archive.accounts[id].draft,null);assert.ok(Object.entries(archive.accounts).some(([key,state])=>key!==id&&state.draft?.book.base==='USD'));
});

for(const conflict of [false,true])test('direct rate confirmation '+(conflict?'rejects original-field divergence':'merges remote sibling')+' without separate upload',async t=>{
 const {cache,id,service,read,commit}=await setup(t,formFx()),shown=await read(),draft=await saveForm(cache,shown.version);
 await commit(book=>Object.assign(book,applyAction(book,{type:'rates',date:'2026-09-01',rates:{CNY:1,USD:conflict?7.3:7.1,HKD:conflict?0.91:0.95},source:'手动汇率'})));const current=await read();
 const response=await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:current.version,action:{type:'rates',date:draft.date,rates:Object.fromEntries(Object.entries(draft.rates).map(([code,value])=>[code,Number(value)])),source:'手动汇率'}})});assert.equal(response.status,conflict?409:200);
 const official=(await service.pull()).book,state=(await cache.exportBrowserCaches()).accounts[id];assert.equal(official.rates.USD,conflict?7.3:7.2);assert.equal(official.rates.HKD,conflict?0.91:0.95);assert.deepEqual(state.rateDraft,conflict?draft:null);assert.equal(state.pending,null);
});

for(const direct of [false,true])test('changing form effective date '+(direct?'before direct confirmation':'before compatibility upload')+' carries only owned USD and verified effective HKD',async t=>{
 const {cache,id,service,read,upload,commit}=await setup(t,formFx()),shown=await read(),draft=await saveForm(cache,shown.version);
 await commit(book=>Object.assign(book,applyAction(book,{type:'rates',date:'2026-09-01',rates:{CNY:1,USD:7.1,HKD:0.95},source:'手动汇率'})));
 const refreshed=await read(),changed={...draft,date:'2026-09-02'};assert.equal((await cache.financeRequest('/api/rate-draft',{method:'POST',body:JSON.stringify({version:refreshed.version,draft:changed})})).status,200);
 const response=direct?await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:refreshed.version,action:{type:'rates',date:changed.date,rates:{CNY:1,USD:7.2,HKD:0.91},source:'手动汇率'}})}):await upload();assert.equal(response.status,200);
 const official=(await service.pull()).book;assert.equal(official.rateHistory.find(point=>point.date==='2026-09-01').rates.HKD,0.95);assert.equal(official.rateHistory.find(point=>point.date==='2026-09-02').rates.USD,7.2);assert.equal(official.rateHistory.find(point=>point.date==='2026-09-02').rates.HKD,0.95);assert.equal((await cache.exportBrowserCaches()).accounts[id].rateDraft,null);
});

test('historical form confirmation uses latest verified rates effective on its date without leaking a future FX row',async t=>{
 const {cache,service,read,commit}=await setup(t,formFx()),shown=await read(),draft=await saveForm(cache,shown.version);
 await commit(book=>{Object.assign(book,applyAction(book,{type:'rates',date:'2026-09-01',rates:{CNY:1,USD:7.1,HKD:0.95},source:'手动汇率'}));Object.assign(book,applyAction(book,{type:'rates',date:'2026-09-03',rates:{CNY:1,USD:7.4,HKD:0.99},source:'手动汇率'}));});
 const refreshed=await read();assert.equal((await cache.financeRequest('/api/rate-draft',{method:'POST',body:JSON.stringify({version:refreshed.version,draft:{...draft,date:'2026-09-02'}})})).status,200);
 const saved=await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:refreshed.version,action:{type:'rates',date:'2026-09-02',rates:{CNY:1,USD:7.2,HKD:0.91},source:'手动汇率'}})});assert.equal(saved.status,200);
 const official=(await service.pull()).book;assert.deepEqual(official.rateHistory.find(point=>point.date==='2026-09-02').rates,{CNY:1,USD:7.2,HKD:0.95});assert.deepEqual(official.rateHistory.find(point=>point.date==='2026-09-03').rates,{CNY:1,USD:7.4,HKD:0.99});assert.equal(official.rateDate,'2026-09-03');
});

test('direct save refuses a stale ready snapshot with status error and retries its persisted journal safely',async t=>{
 const {cache,id,service,read}=await setup(t,formFx()),shown=await read(),status=service.status;
 service.status=async()=>({...await status(),error:'synthetic unavailable readback'});
 const failed=await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:shown.version,action:{type:'base',base:'USD'}})});assert.equal(failed.status,503);
 let state=(await cache.exportBrowserCaches()).accounts[id];assert.equal(state.cloud.base,'CNY');assert.equal(state.draft.book.base,'USD');assert.ok(state.pending);assert.ok(state.confirmedSave);assert.equal((await service.pull()).book.base,'USD');
 service.status=status;assert.equal((await cache.financeRequest('/api/ledger/save',{method:'POST',body:'{}'})).status,200);state=(await cache.exportBrowserCaches()).accounts[id];assert.equal(state.cloud.base,'USD');assert.equal(state.draft,null);assert.equal(state.pending,null);assert.equal((await service.exportBackup()).ledger.receipts.length,1);
});

test('direct confirmations add, spend, replace valuation and remove cash through existing financial rules',async t=>{
 const {cache,service,read}=await setup(t,formFx());
 const save=async action=>{const shown=await read(),response=await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:shown.version,action})});assert.equal(response.status,200,(await response.clone().text()));return response.json();};
 await save({type:'add',date:'2026-09-01',assets:[{id:'direct-cycle',name:'现金账户',category:'现金',classification:'现金',platform:'银行',market:'不适用',currency:'CNY',date:'2026-09-01',value:100,cost:null,note:'保留备注'}]});assert.equal((await service.pull()).book.assets[0].value,100);
 await save({type:'cash',id:'direct-cycle',kind:'消费',amount:20,date:'2026-09-01'});assert.equal((await service.pull()).book.assets[0].value,80);
 await save({type:'cash',id:'direct-cycle',kind:'更新市值',value:120,date:'2026-09-01'});assert.equal((await service.pull()).book.assets[0].value,120);assert.equal((await service.pull()).book.assets[0].note,'保留备注');
 await save({type:'remove',id:'direct-cycle',date:'2026-09-01'});const official=(await service.pull()).book;assert.equal(official.assets.length,0);assert.equal(official.closedAssets[0].note,'保留备注');assert.equal(official.records.length,4);assert.equal(official.rateHistory[0].rates.USD,7.1);
});

const assetFormBook=()=>applyAction(formFx(),{type:'add',date:'2026-09-01',assets:[{id:'form-cash',name:'原名称',category:'现金',classification:'现金',platform:'银行',market:'不适用',currency:'CNY',date:'2026-09-01',value:100,cost:null,note:'原备注'}]});
test('asset form retry keeps its opened baseline and merges independent remote note through actual Mongo HTTP',async t=>{
 const {cache,id,service,read,commit}=await setup(t,assetFormBook()),shown=await read(),assetBase=structuredClone(shown.book.assets[0]),action={type:'update',asset:{...assetBase,name:'本地名称'},reason:'数据修正'};
 await commit(book=>{book.assets[0].note='远端备注';});const refreshed=await read();assert.notEqual(refreshed.version,shown.version);
 const stale=await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:shown.version,action,assetBase})});assert.equal(stale.status,409);assert.equal((await service.pull()).book.assets[0].note,'远端备注');
 const retry=await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:refreshed.version,action,assetBase})});assert.equal(retry.status,200);const official=(await service.pull()).book;assert.equal(official.assets[0].name,'本地名称');assert.equal(official.assets[0].note,'远端备注');assert.equal(official.assets[0].value,100);assert.equal(official.records.length,1);assert.equal((await cache.exportBrowserCaches()).accounts[id].draft,null);
});

test('asset form repeated stale saves never rebase a genuinely conflicting name',async t=>{
 const {cache,id,service,read,commit}=await setup(t,assetFormBook()),shown=await read(),assetBase=structuredClone(shown.book.assets[0]),action={type:'update',asset:{...assetBase,name:'本地名称'},reason:'数据修正'};
 await commit(book=>Object.assign(book,applyAction(book,{type:'update',asset:{...book.assets[0],name:'远端名称'},reason:'数据修正'})));const refreshed=await read();
 assert.equal((await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:shown.version,action,assetBase})})).status,409);
 for(let attempt=0;attempt<2;attempt++)assert.equal((await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:refreshed.version,action,assetBase})})).status,409);
 assert.equal((await service.pull()).book.assets[0].name,'远端名称');const state=(await cache.exportBrowserCaches()).accounts[id];assert.equal(state.draft,null);assert.equal(state.pending,null);assert.equal(state.confirmedSave??null,null);
});

test('asset form applies owned metadata to current remote history and keeps subsequent untouched remote note',async t=>{
 const {cache,service,read,commit}=await setup(t,assetFormBook()),shown=await read(),assetBase=structuredClone(shown.book.assets[0]),action={type:'update',asset:{...assetBase,name:'本地名称'},reason:'数据修正'};
 await commit(book=>{const dated=applyAction(book,{type:'rates',rates:{...book.rates},date:'2026-09-02',source:'synthetic test'});Object.assign(book,applyAction(dated,{type:'cash',id:'form-cash',kind:'转入',amount:20,date:'2026-09-02'}));book.assets[0].note='远端备注';});const refreshed=await read(),wire=globalThis.fetch;
 globalThis.fetch=(url,options)=>{if(url==='/api/ledger/prepare')throw Error('synthetic asset prepare offline');return wire(url,options);};assert.notEqual((await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:refreshed.version,action,assetBase})})).status,200);globalThis.fetch=wire;
 await commit(book=>{book.assets[0].note='远端再次修改备注';});await read();assert.equal((await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:refreshed.version,action,assetBase})})).status,200);
 const official=(await service.pull()).book;assert.equal(official.assets[0].name,'本地名称');assert.equal(official.assets[0].note,'远端再次修改备注');assert.equal(official.assets[0].value,120);assert.equal(official.records.length,2);assert.equal(official.records.find(record=>record.date==='2026-09-02').name,'本地名称');
});

test('an asset confirmation without an opened form baseline cannot promote stale whole-asset fields',async t=>{
 const {cache,service,read}=await setup(t,assetFormBook()),shown=await read(),action={type:'update',asset:{...shown.book.assets[0],name:'未绑定名称'},reason:'数据修正'};
 const response=await cache.financeRequest('/api/ledger/save',{method:'POST',body:JSON.stringify({version:shown.version,action})});assert.equal(response.status,409);assert.equal((await service.pull()).book.assets[0].name,'原名称');
});
