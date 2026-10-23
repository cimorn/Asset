import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MongoClient} from '../../../website/node_modules/mongodb/lib/index.js';
import {MongoMemoryServer} from '../../../website/node_modules/mongodb-memory-server/index.js';
import {createMongoService} from '../../../website/server/mongo-ledger.mjs';
import {createWebServer} from '../../../website/server/server.mjs';
import {emptyBook,projectLedger,applyAction,recordEditContext} from '../runtime/finance.mjs';

let mongo,client;
before(async()=>{mongo=await MongoMemoryServer.create({binary:{version:'7.0.35'}});client=await MongoClient.connect(mongo.getUri());});
after(async()=>{await client?.close();await mongo?.stop();});
async function setup(t,{fetchImpl=fetch}={}){
 assert.ok(existsSync(new URL('../nas-service.mjs',import.meta.url)),'NAS transport module must exist');
 const {createNasService}=await import('../nas-service.mjs'),{startServer}=await import('../server.mjs');
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'nas-desktop-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
 const database=client.db('desktop_'+randomUUID().replaceAll('-',''));t.after(()=>database.dropDatabase());
 const environment={APP_PASSWORD:'test-only',SESSION_SECRET:'desktop-test-secret-longer-than-32-characters',LEDGER_INSTANCE_ID:'desktop-test',LEDGER_ID:'main'};
 const remote=await createMongoService({environment,database});await remote.importBook(emptyBook(),{apply:true});
 const nas=await createWebServer({environment,service:remote,staticDir:'.'});await new Promise(resolve=>nas.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>nas.close(resolve)));
 const origin='http://127.0.0.1:'+nas.address().port,credentialStore={load:async()=>({url:origin,password:environment.APP_PASSWORD}),status:async()=>({configured:true,error:''})};
 const transport=createNasService(dataDir,{credentialStore,fetchImpl,allowLocalHttp:true});
 const desktop=await startServer({dataDir,nasService:transport});t.after(()=>new Promise(resolve=>desktop.server.close(resolve)));
 const launch=await fetch(desktop.launchUrl,{redirect:'manual'}),cookie=launch.headers.get('set-cookie').split(';')[0];
 const request=async(route,{body,originHeader=desktop.url,useCookie=true}={})=>{const res=await fetch(desktop.url+route,{headers:{...(useCookie?{Cookie:cookie}:{}),...(body!==undefined?{Origin:originHeader,'Content-Type':'application/json'}:{})},...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{})});return {res,data:await res.json()};};
 return {dataDir,database,remote,nas,origin,credentialStore,transport,desktop,request,createNasService,startServer};
}
const ready=async f=>(await f.request('/api/book?refresh=1')).data;
const edit=async(f,state,action)=>(await f.request('/api/book',{body:{version:state.version,action}}));
async function restartDesktop(f,t){
 await new Promise(resolve=>f.desktop.server.close(resolve));f.desktop=await f.startServer({dataDir:f.dataDir,nasService:f.createNasService(f.dataDir,{credentialStore:f.credentialStore,allowLocalHttp:true})});t.after(()=>new Promise(resolve=>f.desktop.server.close(resolve)));
 const launch=await fetch(f.desktop.launchUrl,{redirect:'manual'}),cookie=launch.headers.get('set-cookie').split(';')[0];f.request=async(route,{body,originHeader=f.desktop.url,useCookie=true}={})=>{const res=await fetch(f.desktop.url+route,{headers:{...(useCookie?{Cookie:cookie}:{}),...(body!==undefined?{Origin:originHeader,'Content-Type':'application/json'}:{})},...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{})});return {res,data:await res.json()};};
}
const rateInput=async(f,draft)=>f.request('/api/rate-draft',{body:{draft,version:(await f.request('/api/book')).data.version}});
const confirmRates=(f,state)=>edit(f,state,{type:'rates',date:state.rateDraft.date,rates:Object.fromEntries(Object.entries(state.rateDraft.rates).map(([code,text])=>[code,Number(text)])),source:'手动汇率'});
test('desktop explicit confirmation saves dated classification and both transfer legs through NAS HTTP',async t=>{
 const f=await setup(t);await publishRates(f,{CNY:1,USD:7,HKD:.9});let state=await ready(f);
 const row=(id,classification,category,value,cost,currency='CNY')=>({id,name:id,platform:'test',classification,category,market:'不适用',currency,value,cost,date:'2026-10-01',note:''});
 let result=await edit(f,state,{type:'add',date:'2026-10-01',assets:[row('desktop-fund','基金','基金',200,150),row('desktop-crypto','虚拟币','其他',10,10,'USD')]});assert.equal(result.res.status,200);
 await publishRates(f,{CNY:1,USD:8,HKD:.9},'2026-10-03');state=await ready(f);
 result=await edit(f,state,{type:'classify',id:'desktop-fund',classification:'股市',date:'2026-10-03'});assert.equal(result.res.status,200);state=result.data;
 const before=(await f.remote.pull()).book,basis=before.capitalAccounts.reduce((sum,row)=>sum+row.costCny,0);
 result=await edit(f,state,{type:'transfer',id:'desktop-fund',targetId:'desktop-crypto',amount:200,sourceValue:0,targetAmount:24,date:'2026-10-03'});assert.equal(result.res.status,200);
 const official=(await f.remote.pull()).book,legs=official.records.filter(record=>record.transferId);
 assert.equal(legs.length,2);assert.equal(legs[0].transferId,legs[1].transferId);assert.equal(official.assets.length,2);assert.equal(official.assets.find(row=>row.id==='desktop-crypto').value,34);assert.equal(official.assets.find(row=>row.id==='desktop-fund').value,0);assert.equal(official.assets.find(row=>row.id==='desktop-fund').classification,'股市');assert.equal(official.capitalAccounts.reduce((sum,row)=>sum+row.costCny,0),basis);
 assert.equal(official.records.find(record=>record.assetId==='desktop-fund'&&record.type==='买入').classification,'基金');assert.equal(JSON.parse(await readFile(path.join(f.dataDir,'nas-cache.json'),'utf8')).draft,null);
 await restartDesktop(f,t);const restored=await ready(f);assert.equal(restored.book.assets.find(row=>row.id==='desktop-crypto').value,34);assert.equal(restored.book.records.filter(record=>record.transferId).length,2);
});
test('desktop retains an adjustment without writing when NAS still runs an older schema',async t=>{
 const writes=[];const f=await setup(t,{fetchImpl:async(url,options)=>{if(options?.method==='POST'&&/\/api\/ledger\/(prepare|upload)$/.test(new URL(url).pathname))writes.push(url);const response=await fetch(url,options);if(new URL(url).pathname==='/api/book'&&response.ok){const body=await response.json();delete body.sync.assetAdjustments;return new Response(JSON.stringify(body),{status:response.status,headers:response.headers});}return response;}});
 await publishRates(f,{CNY:1,USD:7,HKD:.9});let state=await ready(f);
 const asset={id:'old-schema-fund',name:'old schema fund',platform:'test',classification:'基金',category:'基金',market:'不适用',currency:'CNY',value:100,cost:100,date:'2026-10-01',note:''};
 const added=await edit(f,state,{type:'add',date:'2026-10-01',assets:[asset]});assert.equal(added.res.status,200);state=await ready(f);writes.length=0;
 const before=await f.remote.exportBackup(),result=await edit(f,state,{type:'classify',id:asset.id,classification:'股市',date:'2026-10-01'});
 assert.equal(result.res.status,409);assert.match(result.data.error,/NAS.*升级|升级.*NAS/);assert.equal(writes.length,0);const after=await f.remote.exportBackup();assert.deepEqual(after.ledger,before.ledger);assert.deepEqual(after.versions,before.versions);assert.equal(JSON.parse(await readFile(path.join(f.dataDir,'nas-cache.json'),'utf8')).saveAttempt.action.type,'classify');
});
async function publishRates(f,rates,date='2026-10-01'){
 const before=(await f.remote.pull()).book,book=applyAction(before,{type:'rates',date,rates,source:'手动汇率'}),prepared=await f.remote.sync(book,'',{baseBook:before,prepareOnly:true}),result=await f.remote.sync(book,'',{baseBook:before,recovery:prepared.prepared});await f.remote.accept(result.receipt);
}

test('explicit desktop save returns success only after NAS verified write and leaves raw rate typing local',async t=>{
 const calls=[];const f=await setup(t,{fetchImpl:async(url,options)=>{calls.push(new URL(url).pathname);return fetch(url,options);}});let state=await ready(f);await rateInput(f,{date:'2026-10-01',rates:{USD:'7.2'}});const before=(await f.remote.pull()).book;const saved=await edit(f,state,{type:'base',base:'USD'});assert.equal(saved.res.status,200);assert.equal((await f.remote.pull()).book.base,'USD');assert.equal((await f.remote.pull()).book.rates.USD,before.rates.USD);assert.equal(saved.data.rateDraft.rates.USD,'7.2');assert.ok(calls.includes('/api/ledger/prepare'));assert.ok(calls.includes('/api/ledger/upload'));assert.equal(JSON.parse(await readFile(path.join(f.dataDir,'nas-cache.json'),'utf8')).draft,null);
});

test('lost explicit save response retains one action and restart only replays on explicit retry',async t=>{
 let lose=true,uploads=0;const f=await setup(t,{fetchImpl:async(url,options)=>{const response=await fetch(url,options);if(new URL(url).pathname==='/api/ledger/upload'){uploads++;if(lose){lose=false;await response.arrayBuffer();throw Error('response lost');}}return response;}});await publishRates(f,{CNY:1,USD:7.1,HKD:0.91});const count=await f.database.collection('ledger_versions').countDocuments(),state=await ready(f),action={type:'add',date:'2026-10-01',assets:[{id:'saved-cash',name:'现金',platform:'银行',category:'现金',classification:'现金',market:'不适用',currency:'CNY',value:100,cost:100,date:'2026-10-01',note:''}]};
 const failed=await edit(f,state,action);assert.equal(failed.res.status,502);assert.equal(uploads,1);const persisted=JSON.parse(await readFile(path.join(f.dataDir,'nas-cache.json'),'utf8'));assert.deepEqual(persisted.saveAttempt.action,action);assert.ok(existsSync(path.join(f.dataDir,'nas-upload.json')));await restartDesktop(f,t);state.version=(await f.request('/api/book')).data.version;assert.equal(uploads,1,'startup must not replay');
 const retried=await f.request('/api/ledger/retry',{body:{version:state.version}});assert.equal(retried.res.status,200);assert.equal(retried.data.sync.canRetry,false);assert.equal((await f.remote.pull()).book.assets.filter(a=>a.id==='saved-cash').length,1);assert.equal(await f.database.collection('ledger_versions').countDocuments(),count+1);assert.equal(JSON.parse(await readFile(path.join(f.dataDir,'nas-cache.json'),'utf8')).saveAttempt,null);
});

test('failed prepare keeps proposed save and blocks unrelated action until explicit retry or archive',async t=>{
 let failPrepare=true;const f=await setup(t,{fetchImpl:async(url,options)=>{if(failPrepare&&new URL(url).pathname==='/api/ledger/prepare')throw Error('offline');return fetch(url,options);}});let state=await ready(f);const failed=await edit(f,state,{type:'base',base:'USD'});assert.equal(failed.res.status,502);state=await ready(f);assert.equal(state.book.base,'CNY');assert.equal(state.sync.canRetry,true);assert.equal((await f.remote.pull()).book.base,'CNY');const blocked=await edit(f,state,{type:'currency',code:'EUR',name:'欧元',rate:8});assert.equal(blocked.res.status,409);assert.equal((await f.remote.pull()).book.customCurrencies?.EUR,undefined);
 failPrepare=false;const retried=await f.request('/api/ledger/retry',{body:{version:state.version}});assert.equal(retried.res.status,200);assert.equal((await f.remote.pull()).book.base,'USD');assert.equal(retried.data.sync.canRetry,false);
});

test('historical draft is export-only and never bundled into a new save after explicit archive',async t=>{
 const f=await setup(t);let state=await ready(f);const {openNasCache}=await import('../nas-cache.mjs'),saved=JSON.parse(await readFile(path.join(f.dataDir,'nas-cache.json'),'utf8')),cache=await openNasCache(f.dataDir);await cache.receive(state.book,{identity:saved.identity});await cache.edit(applyAction(state.book,{type:'base',base:'USD'}));await restartDesktop(f,t);state=await ready(f);assert.equal(state.book.base,'CNY');assert.equal(state.sync.hasHistoricalDraft,true);
 const blocked=await edit(f,state,{type:'currency',code:'EUR',name:'欧元',rate:8});assert.equal(blocked.res.status,409);assert.equal((await f.remote.pull()).book.base,'CNY');assert.equal((await f.request('/api/ledger/drafts')).data.draft.book.base,'USD');
 const archived=await f.request('/api/ledger/archive-drafts',{body:{version:state.version}});assert.equal(archived.res.status,200);assert.equal(archived.data.sync.hasHistoricalDraft,false);const savedNew=await edit(f,archived.data,{type:'currency',code:'EUR',name:'欧元',rate:8});assert.equal(savedNew.res.status,200);assert.equal((await f.remote.pull()).book.base,'CNY');assert.equal((await f.remote.pull()).book.customCurrencies.EUR,'欧元');assert.equal((await f.request('/api/ledger/drafts')).data.archivedDrafts.length,1);
});

test('explicit rate confirmation saves only owned fields and conflict leaves raw form for retry',async t=>{
 const f=await setup(t);await publishRates(f,{CNY:1,USD:7.1,HKD:0.91});await ready(f);await rateInput(f,{date:'2026-10-01',rates:{CNY:'1',USD:'7.2',HKD:'0.91'}});await publishRates(f,{CNY:1,USD:7.1,HKD:0.95});let state=await ready(f);const saved=await edit(f,state,{type:'rates',date:'2026-10-01',rates:{CNY:1,USD:7.2,HKD:0.91},source:'手动汇率'});assert.equal(saved.res.status,200);assert.equal((await f.remote.pull()).book.rates.USD,7.2);assert.equal((await f.remote.pull()).book.rates.HKD,0.95);assert.equal(saved.data.rateDraft,null);
 await rateInput(f,{date:'2026-10-01',rates:{CNY:'1',USD:'7.25',HKD:'0.95'}});await publishRates(f,{CNY:1,USD:7.3,HKD:0.95});state=await ready(f);const failed=await edit(f,state,{type:'rates',date:'2026-10-01',rates:{CNY:1,USD:7.25,HKD:0.95},source:'手动汇率'});assert.equal(failed.res.status,409);assert.equal((await f.request('/api/book')).data.rateDraft.rates.USD,'7.25');assert.equal((await f.remote.pull()).book.rates.USD,7.3);
});

test('explicit cash confirmation and asset metadata update save immediately while retaining prior history',async t=>{
 const f=await setup(t);await publishRates(f,{CNY:1,USD:7.1,HKD:0.91});let state=await ready(f);const cash={id:'cash-confirm',name:'现金',platform:'银行',category:'现金',classification:'现金',market:'不适用',currency:'CNY',value:100,cost:100,date:'2026-10-01',note:''};let saved=await edit(f,state,{type:'add',date:'2026-10-01',assets:[cash]});assert.equal(saved.res.status,200);assert.equal((await f.remote.pull()).book.assets.find(a=>a.id===cash.id).value,100);const originalRecords=structuredClone((await f.remote.pull()).book.records);
 saved=await edit(f,saved.data,{type:'cash',id:cash.id,kind:'收入',amount:20,date:'2026-10-01'});assert.equal(saved.res.status,200);let official=(await f.remote.pull()).book;assert.equal(official.assets.find(a=>a.id===cash.id).value,120);assert.equal(official.records.length,originalRecords.length+1);for(const record of originalRecords)assert.deepEqual(official.records.find(r=>r.id===record.id),record);
 const before=structuredClone(official.records);saved=await edit(f,saved.data,{type:'update',asset:{...official.assets.find(a=>a.id===cash.id),name:'备用现金'}});assert.equal(saved.res.status,200);official=(await f.remote.pull()).book;assert.equal(official.assets.find(a=>a.id===cash.id).name,'备用现金');assert.equal(official.assets.find(a=>a.id===cash.id).classification,'现金');const financialRecord=({name,...record})=>record;assert.deepEqual(official.records.map(financialRecord),before.map(financialRecord),'existing projection may follow asset display name; all historical financial fields must stay identical');assert.equal(saved.data.sync.canRetry,false);
});

test('raw rate input keeps original USD conflict baseline after refresh and restart',async t=>{
 const f=await setup(t);await publishRates(f,{CNY:1,USD:7.1,HKD:0.91});await ready(f);
 assert.equal((await rateInput(f,{date:'2026-10-01',rates:{CNY:'1',USD:'7.2',HKD:'0.91'}})).res.status,200);
 await publishRates(f,{CNY:1,USD:7.3,HKD:0.91});let state=await ready(f);assert.equal(state.rateDraft.rates.USD,'7.2');
 const failed=await confirmRates(f,state);assert.equal(failed.res.status,409);assert.ok(failed.data.sync.conflicts.some(p=>p.includes('USD')));assert.equal((await f.remote.pull()).book.rates.USD,7.3);
 await new Promise(resolve=>f.desktop.server.close(resolve));const transport=f.createNasService(f.dataDir,{credentialStore:f.credentialStore,allowLocalHttp:true}),desktop=await f.startServer({dataDir:f.dataDir,nasService:transport});t.after(()=>new Promise(resolve=>desktop.server.close(resolve)));
 const launch=await fetch(desktop.launchUrl,{redirect:'manual'}),cookie=launch.headers.get('set-cookie').split(';')[0];state=await fetch(desktop.url+'/api/book?refresh=1',{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(state.rateDraft.rates.USD,'7.2');
 const retry=await fetch(desktop.url+'/api/ledger/upload',{method:'POST',headers:{Cookie:cookie,Origin:desktop.url,'Content-Type':'application/json'},body:JSON.stringify({version:state.version})});assert.equal(retry.status,409);assert.equal((await f.remote.pull()).book.rates.USD,7.3);
});

test('raw rate input owns only changed currency and preserves remote HKD plus newly observed currency',async t=>{
 const f=await setup(t);await publishRates(f,{CNY:1,USD:7.1,HKD:0.91});await ready(f);await rateInput(f,{date:'2026-10-01',rates:{CNY:'1',USD:'7.2',HKD:'0.91'}});
 await publishRates(f,{CNY:1,USD:7.1,HKD:0.95});let state=await ready(f);
 // Further USD typing must not acquire ownership of the stale untouched HKD form field.
 await rateInput(f,{date:'2026-10-01',rates:{CNY:'1',USD:'7.25',HKD:'0.91'}});
 const before=(await f.remote.pull()).book,book=applyAction(before,{type:'currency',code:'EUR',name:'欧元',rate:8,date:'2026-10-01'}),prepared=await f.remote.sync(book,'',{baseBook:before,prepareOnly:true});await f.remote.sync(book,'',{baseBook:before,recovery:prepared.prepared});state=await ready(f);
 const uploaded=await confirmRates(f,state);assert.equal(uploaded.res.status,200);const official=(await f.remote.pull()).book;assert.equal(official.rates.USD,7.25);assert.equal(official.rates.HKD,0.95);assert.equal(official.rates.EUR,8);assert.equal(official.customCurrencies.EUR,'欧元');assert.equal(uploaded.data.rateDraft,null);
});

test('failed rate confirmation retains the original rate conflict baseline and latest remote sibling',async t=>{
 const f=await setup(t);await publishRates(f,{CNY:1,USD:7.1,HKD:0.91});let state=await ready(f);await rateInput(f,{date:'2026-10-01',rates:{CNY:'1',USD:'7.2',HKD:'0.91'}});await publishRates(f,{CNY:1,USD:7.3,HKD:0.95});state=await ready(f);
 const failed=await confirmRates(f,state);assert.equal(failed.res.status,409);assert.ok(failed.data.sync.conflicts.some(p=>p.includes('USD')));const cache=JSON.parse(await readFile(path.join(f.dataDir,'nas-cache.json'),'utf8'));assert.equal(cache.draft.base.rates.USD,7.1);assert.equal(cache.draft.book.rates.HKD,0.95);assert.equal((await f.remote.pull()).book.rates.HKD,0.95);
});

test('stale renderer rate input cannot acquire a newer verified baseline',async t=>{
 const f=await setup(t);await publishRates(f,{CNY:1,USD:7.1,HKD:0.91});const viewed=await ready(f);await publishRates(f,{CNY:1,USD:7.3,HKD:0.91});await ready(f);
 const response=await f.request('/api/rate-draft',{body:{version:viewed.version,draft:{date:'2026-10-01',rates:{USD:'7.2'}}}});assert.equal(response.res.status,409);assert.equal((await f.request('/api/book')).data.rateDraft,null);assert.ok(!existsSync(path.join(f.dataDir,'nas-rate-draft.json')));
});

test('changing only rate effective date carries owned USD intent and adopts untouched remote HKD',async t=>{
 const f=await setup(t);await publishRates(f,{CNY:1,USD:7.1,HKD:0.91});await ready(f);await rateInput(f,{date:'2026-10-01',rates:{CNY:'1',USD:'7.2',HKD:'0.91'}});await publishRates(f,{CNY:1,USD:7.1,HKD:0.95});await ready(f);
 await rateInput(f,{date:'2026-10-02',rates:{CNY:'1',USD:'7.2',HKD:'0.91'}});const state=await ready(f),uploaded=await confirmRates(f,state);assert.equal(uploaded.res.status,200);const official=(await f.remote.pull()).book;assert.equal(official.rateHistory.find(p=>p.date==='2026-10-02').rates.USD,7.2);assert.equal(official.rateHistory.find(p=>p.date==='2026-10-02').rates.HKD,0.95);assert.equal(official.rates.HKD,0.95);
});

test('rate date switch retains its observed new-date USD baseline through later remote conflict',async t=>{
 const f=await setup(t);await publishRates(f,{CNY:1,USD:7.1,HKD:0.91});await ready(f);await rateInput(f,{date:'2026-10-01',rates:{CNY:'1',USD:'7.2',HKD:'0.91'}});await publishRates(f,{CNY:1,USD:7.15,HKD:0.95},'2026-10-02');await ready(f);await rateInput(f,{date:'2026-10-02',rates:{CNY:'1',USD:'7.2',HKD:'0.91'}});await publishRates(f,{CNY:1,USD:7.3,HKD:0.95},'2026-10-02');const state=await ready(f);
 const failed=await confirmRates(f,state);assert.equal(failed.res.status,409);assert.ok(failed.data.sync.conflicts.some(p=>p.includes('USD')));assert.equal((await f.remote.pull()).book.rates.USD,7.3);
});

test('unbound legacy NAS rate input remains export-only across a clean read and unrelated save',async t=>{
 const f=await setup(t);await ready(f);await new Promise(resolve=>f.desktop.server.close(resolve));const original='{"date":"2026-10-01","rates":{"CNY":"1","USD":"7.2","HKD":"0.91"}}';await writeFile(path.join(f.dataDir,'nas-rate-draft.json'),original);
 const desktop=await f.startServer({dataDir:f.dataDir,nasService:f.createNasService(f.dataDir,{credentialStore:f.credentialStore,allowLocalHttp:true})});t.after(()=>new Promise(resolve=>desktop.server.close(resolve)));const launch=await fetch(desktop.launchUrl,{redirect:'manual'}),cookie=launch.headers.get('set-cookie').split(';')[0];const request=async(route,body)=>{const res=await fetch(desktop.url+route,{headers:{Cookie:cookie,...(body?{Origin:desktop.url,'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});return {res,data:await res.json()};};
 const state=(await request('/api/book?refresh=1')).data;assert.equal(state.rateDraft,null);const uploaded=await request('/api/book',{version:state.version,action:{type:'base',base:'USD'}});assert.equal(uploaded.res.status,200);assert.notEqual((await f.remote.pull()).book.rates.USD,7.2);assert.equal(await readFile(path.join(f.dataDir,'nas-rate-draft.json'),'utf8'),original);const exported=await request('/api/ledger/drafts');assert.deepEqual(exported.data.unboundRateDrafts,[JSON.parse(original)]);
});

test('desktop actual HTTP transport saves to NAS and protects backup plus loopback origin',async t=>{
 const calls=[];const f=await setup(t,{fetchImpl:async(url,options)=>{calls.push({route:new URL(url).pathname,origin:options.headers.Origin,body:options.body&&JSON.parse(options.body)});return fetch(url,options);}});
 const state=await ready(f);assert.equal(state.ready,true);assert.equal(state.sync.source,'nas');const changed=await edit(f,state,{type:'base',base:'USD'});assert.equal(changed.res.status,200);assert.equal(changed.data.book.base,'USD');assert.equal((await f.remote.pull()).book.base,'USD');assert.equal(changed.data.sync.dirty,false);
 assert.ok(calls.some(c=>c.route==='/api/login'&&c.origin===f.origin));assert.ok(calls.some(c=>c.route==='/api/ledger/prepare'));assert.ok(!calls.some(c=>c.route.includes('feishu')));
 const backup=await f.request('/api/ledger/backup');assert.equal(backup.data.format,'asset-mongo-backup');assert.ok(backup.data.ledgers||backup.data.ledger);
 assert.equal((await f.request('/api/ledger/connect',{body:{},originHeader:'https://evil.invalid'})).res.status,403);assert.equal((await f.request('/api/book',{useCookie:false})).res.status,401);
});

test('lost save response keeps signed journal and unconfirmed raw rates through restart recovery',async t=>{
 let lose=true;const f=await setup(t,{fetchImpl:async(url,options)=>{const res=await fetch(url,options);if(new URL(url).pathname==='/api/ledger/upload'&&lose){lose=false;await res.arrayBuffer();throw Error('mongodb://secret@host/private');}return res;}});
 const initial=await ready(f);await rateInput(f,{date:'2026-10-01',rates:{CNY:'1',USD:'7.1',HKD:'0.91'}});const failed=await edit(f,initial,{type:'base',base:'USD'});assert.equal(failed.res.status,502);assert.ok(!JSON.stringify(failed.data).includes('secret@host'));
 const pending=JSON.parse(await readFile(path.join(f.dataDir,'nas-upload.json'),'utf8'));assert.equal(pending.source,'nas');assert.ok(pending.journal.signature);assert.ok(!JSON.stringify(pending).includes('test-only'));
 const preserved=JSON.parse(await readFile(path.join(f.dataDir,'nas-cache.json'),'utf8'));assert.ok(preserved.draft);assert.ok(existsSync(path.join(f.dataDir,'nas-rate-draft.json')));
 await new Promise(resolve=>f.desktop.server.close(resolve));const restarted=f.createNasService(f.dataDir,{credentialStore:f.credentialStore,allowLocalHttp:true}),desktop=await f.startServer({dataDir:f.dataDir,nasService:restarted});t.after(()=>new Promise(resolve=>desktop.server.close(resolve)));
 const launch=await fetch(desktop.launchUrl,{redirect:'manual'}),cookie=launch.headers.get('set-cookie').split(';')[0];const state=await fetch(desktop.url+'/api/book',{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(state.ready,false);assert.equal(state.sync.canReprepare,true);assert.equal(state.rateDraft.rates.USD,'7.1');
 const uploaded=await fetch(desktop.url+'/api/ledger/retry',{method:'POST',headers:{Cookie:cookie,Origin:desktop.url,'Content-Type':'application/json'},body:JSON.stringify({version:state.version})});assert.equal(uploaded.status,200);const result=await uploaded.json();assert.equal(result.book.base,'USD');assert.equal(result.rateDraft.rates.USD,'7.1');assert.equal(result.sync.canRetry,false);assert.ok(!existsSync(path.join(f.dataDir,'nas-upload.json')));
 assert.equal((await f.database.collection('ledger_versions').countDocuments()),2);const cache=JSON.parse(await readFile(path.join(f.dataDir,'nas-cache.json'),'utf8'));assert.equal(cache.draft,null);assert.ok(existsSync(path.join(f.dataDir,'nas-rate-draft.json')),'unconfirmed raw typing must not clear on unrelated save');
});

test('401 relogin occurs once and financial plus rate drafts survive errors and unready snapshots',async t=>{
 let invalidate=false,loginCount=0,mode='good';const f=await setup(t,{fetchImpl:async(url,options)=>{const route=new URL(url).pathname;if(route==='/api/login')loginCount++;if(invalidate&&route==='/api/book'){invalidate=false;return new Response('{}',{status:401});}const res=await fetch(url,options);if(route==='/api/book'&&mode!=='good'){const body=await res.json();body.book.base='HKD';if(mode==='error')body.sync.error='database unavailable';else body.ready=false;return Response.json(body);}return res;}});
 const changed=await edit(f,await ready(f),{type:'base',base:'USD'});await rateInput(f,{date:'2026-10-01',rates:{USD:'7.2'}});invalidate=true;const refreshed=await ready(f);assert.equal(refreshed.book.base,'USD');assert.equal(refreshed.rateDraft.rates.USD,'7.2');assert.equal(loginCount,2);
 for(mode of ['error','unready']){const state=await ready(f);assert.equal(state.book.base,'USD');assert.equal(state.rateDraft.rates.USD,'7.2');assert.equal(state.sync.dirty,true);}
 assert.equal(JSON.parse(await readFile(path.join(f.dataDir,'nas-cache.json'),'utf8')).cloud.base,'USD');assert.equal(changed.data.sync.dirty,false);
});

test('identity change rejects remote data and never replays old Feishu journal',async t=>{
 let change=false,uploads=0;const f=await setup(t,{fetchImpl:async(url,options)=>{const route=new URL(url).pathname;if(route==='/api/ledger/upload')uploads++;const res=await fetch(url,options);if(change&&route==='/api/book'){const data=await res.json();data.sync.accountId='foreign-account';return Response.json(data);}return res;}});
 const changed=await edit(f,await ready(f),{type:'base',base:'USD'});const old='{"book":{"base":"HKD"},"appToken":"old"}';await writeFile(path.join(f.dataDir,'feishu-upload.json'),old);change=true;const state=await ready(f);assert.equal(state.book.base,'USD');assert.match(state.sync.error,/身份/);assert.equal(uploads,1,'only the explicitly saved action reached NAS');assert.equal(await readFile(path.join(f.dataDir,'feishu-upload.json'),'utf8'),old);assert.equal(changed.data.sync.dirty,false);
});

test('failed save conflict baseline survives refresh and blocks later unrelated edit',async t=>{
 let offline=true;const f=await setup(t,{fetchImpl:async(url,options)=>{if(offline&&new URL(url).pathname==='/api/ledger/prepare')throw Error('offline');return fetch(url,options);}});let state=await ready(f);assert.equal((await edit(f,state,{type:'base',base:'USD'})).res.status,502);
 const before=(await f.remote.pull()).book,remote=structuredClone(before);remote.base='HKD';const prepared=await f.remote.sync(remote,'',{baseBook:before,prepareOnly:true}),committed=await f.remote.sync(remote,'',{baseBook:before,recovery:prepared.prepared});await f.remote.accept(committed.receipt);
 state=await ready(f);assert.equal((await edit(f,state,{type:'currency',code:'EUR',name:'欧元',rate:8})).res.status,409);
 const cache=JSON.parse(await readFile(path.join(f.dataDir,'nas-cache.json'),'utf8'));assert.equal(cache.draft.base.base,'CNY');assert.equal(cache.draft.book.base,'USD');
 offline=false;const rejected=await f.request('/api/ledger/retry',{body:{version:state.version}});assert.equal(rejected.res.status,409);assert.deepEqual(rejected.data.sync.conflicts,['base']);assert.equal((await f.remote.pull()).book.base,'HKD');assert.equal((await ready(f)).sync.dirty,true);
});

test('reprepare archives signed journal while retaining financial and rate drafts',async t=>{
 const f=await setup(t,{fetchImpl:async(url,options)=>{if(new URL(url).pathname==='/api/ledger/upload')throw Error('offline');return fetch(url,options);}});let state=await ready(f);await rateInput(f,{date:'2026-10-01',rates:{CNY:'1',USD:'7.2',HKD:'0.91'}});await edit(f,state,{type:'base',base:'USD'});state=await ready(f);assert.equal(state.sync.canReprepare,true);
 assert.equal((await edit(f,state,{type:'base',base:'HKD'})).res.status,409);const reset=await f.request('/api/ledger/reprepare',{body:{version:state.version}});assert.equal(reset.res.status,200);assert.equal(reset.data.book.base,'CNY');assert.equal(reset.data.rateDraft.rates.USD,'7.2');assert.equal(reset.data.sync.canReprepare,false);assert.equal(reset.data.sync.canRetry,true);assert.equal((await f.request('/api/ledger/drafts')).data.draft.book.base,'USD');assert.ok((await readdir(f.dataDir)).some(n=>n.startsWith('nas-upload-archive-')));
});

test('local draft export includes NAS recovery journal and its archives without credentials',async t=>{
 const f=await setup(t,{fetchImpl:async(url,options)=>{if(new URL(url).pathname==='/api/ledger/upload')throw Error('offline');return fetch(url,options);}});let state=(await edit(f,await ready(f),{type:'base',base:'USD'})).data;await f.request('/api/ledger/upload',{body:{version:state.version}});
 let exported=await f.request('/api/ledger/drafts');assert.equal(exported.res.status,200);assert.ok(exported.data.pending,'draft export must contain pending NAS recovery');assert.equal(exported.data.pending.source,'nas');assert.ok(exported.data.pending.journal.signature);assert.ok(!JSON.stringify(exported.data).includes('test-only'));
 state=await ready(f);await f.request('/api/ledger/reprepare',{body:{version:state.version}});exported=await f.request('/api/ledger/drafts');assert.equal(exported.data.pending,null);assert.equal(exported.data.archivedUploads.length,1);assert.equal(exported.data.draft.book.base,'USD');
});

test('compatibility recovery uses only pending NAS journal and ignores old Feishu recovery file',async t=>{
 let offline=true;const sent=[];const f=await setup(t,{fetchImpl:async(url,options)=>{sent.push({route:new URL(url).pathname,body:options.body&&JSON.parse(options.body)});if(offline&&new URL(url).pathname==='/api/ledger/upload')throw Error('offline');return fetch(url,options);}});const old='{"appToken":"old","book":{"base":"HKD"}}';await writeFile(path.join(f.dataDir,'feishu-upload.json'),old);await edit(f,await ready(f),{type:'base',base:'USD'});const state=await ready(f);offline=false;
 const uploaded=await f.request('/api/feishu/upload',{body:{version:state.version,target:'https://evil.invalid'}});assert.equal(uploaded.res.status,200);assert.equal(uploaded.data.book.base,'USD');assert.equal(uploaded.data.sync.source,'nas');assert.equal(sent.find(call=>call.route==='/api/ledger/prepare').body.book.base,'USD');assert.ok(!sent.some(call=>call.route.includes('feishu')));assert.equal(await readFile(path.join(f.dataDir,'feishu-upload.json'),'utf8'),old);
});

test('foreign source in new NAS journal file is rejected before upload and retained for export',async t=>{
 let uploads=0;const f=await setup(t,{fetchImpl:async(url,options)=>{if(new URL(url).pathname==='/api/ledger/upload')uploads++;return fetch(url,options);}});const state=await ready(f);const old=JSON.stringify({format:'feishu-upload-v1',source:'feishu',journal:{payload:'old',signature:'old'}});await writeFile(path.join(f.dataDir,'nas-upload.json'),old);
 const result=await f.request('/api/ledger/retry',{body:{version:state.version}});assert.equal(result.res.status,409);assert.equal(uploads,0);assert.equal((await f.remote.pull()).book.base,'CNY');assert.equal(await readFile(path.join(f.dataDir,'nas-upload.json'),'utf8'),old);assert.equal((await f.request('/api/book')).data.book.base,'CNY');
});

test('repeated unauthorized read retries authentication once and retains drafts',async t=>{
 let expire=false,loginCount=0;const f=await setup(t,{fetchImpl:async(url,options)=>{const route=new URL(url).pathname;if(route==='/api/login')loginCount++;if(expire&&route==='/api/book')return Response.json({error:'登录已过期，请重新登录。'},{status:401});return fetch(url,options);}});await edit(f,await ready(f),{type:'base',base:'USD'});await rateInput(f,{date:'2026-10-01',rates:{USD:'7.2'}});expire=true;const state=await ready(f);assert.equal(loginCount,2);assert.equal(state.book.base,'USD');assert.equal(state.rateDraft.rates.USD,'7.2');assert.match(state.sync.error,/登录/);assert.equal(state.sync.dirty,true);
});

test('remote error text containing NAS credentials is sanitized before reaching desktop UI',async t=>{
 let leak=false;const f=await setup(t,{fetchImpl:async(url,options)=>{if(leak&&new URL(url).pathname==='/api/ledger/prepare')return Response.json({error:'上传发生冲突',conflicts:['test-only','base']},{status:409});const res=await fetch(url,options);if(leak&&new URL(url).pathname==='/api/book'){const data=await res.json();data.sync.error='密码 test-only 无效';return Response.json(data);}return res;}});await ready(f);await rateInput(f,{date:'2026-10-01',rates:{USD:'7.2'}});leak=true;const state=await ready(f);assert.equal(state.book.base,'CNY');assert.equal(state.sync.dirty,true);assert.ok(!JSON.stringify(state).includes('test-only'),'remote error cannot expose the NAS password');
 const failed=await edit(f,state,{type:'base',base:'USD'});assert.ok(!JSON.stringify(failed.data).includes('test-only'),'remote conflict context cannot expose the NAS password');assert.deepEqual(failed.data.sync.conflicts,['base']);
});

test('filesystem errors during verified read keep old draft and return sanitized status',async t=>{
 const f=await setup(t);await edit(f,await ready(f),{type:'base',base:'USD'});await rateInput(f,{date:'2026-10-01',rates:{USD:'7.2'}});const base=(await f.remote.pull()).book,remote={...base,base:'HKD'},prepared=await f.remote.sync(remote,'',{baseBook:base,prepareOnly:true});await f.remote.sync(remote,'',{baseBook:base,recovery:prepared.prepared});await mkdir(path.join(f.dataDir,'nas-cache.json.tmp'));
 const state=await ready(f);assert.equal(state.book.base,'USD');assert.equal(state.sync.dirty,true);assert.ok(state.sync.error);assert.ok(!JSON.stringify(state).includes(f.dataDir),'unknown storage error must not reveal filesystem details');assert.ok(!state.sync.error.includes('EISDIR'));
});

function recordCorrection(book,id,changes){const context=recordEditContext(book,id);return {type:'recordEdit',id,date:context.source.date,expected:context.expected,expectedBefore:context.expectedBefore,...changes};}
async function editableDesktopFixture(t){
 const f=await setup(t);await publishRates(f,{CNY:1,USD:7,HKD:.9});
 const result=await edit(f,await ready(f),{type:'add',date:'2026-10-01',assets:[{id:'editable-fund',name:'Editable fund',platform:'test',classification:'基金',category:'基金',market:'不适用',currency:'CNY',value:200,cost:150,date:'2026-10-01',note:'original'}]});
 assert.equal(result.res.status,200);return f;
}

test('desktop recordEdit saves corrections through remote HTTP and restart preserves IDs and repeated note',async t=>{
 const f=await editableDesktopFixture(t);let state=await ready(f);
 const originalIds=state.book.records.map(row=>row.id).sort(),id=state.book.records.find(row=>row.assetId==='editable-fund').id;
 let result=await edit(f,state,recordCorrection(state.book,id,{amount:160,value:220,note:'corrected note'}));
 assert.equal(result.res.status,200,JSON.stringify(result.data));
 const official=await f.remote.pull();assert.equal(official.book.assets.find(row=>row.id==='editable-fund').value,220);assert.equal(official.book.records.find(row=>row.id===id).settlement,-160);assert.deepEqual(official.book.records.map(row=>row.id).sort(),originalIds);
 await restartDesktop(f,t);state=await ready(f);
 assert.deepEqual(state.book.records.map(row=>row.id).sort(),originalIds);assert.equal(state.book.records.find(row=>row.id===id).note,'corrected note');assert.equal(state.book.assets.find(row=>row.id==='editable-fund').value,220);
 result=await edit(f,state,recordCorrection(state.book,id,{note:'corrected note'}));
 assert.equal(result.res.status,200,JSON.stringify(result.data));const repeated=(await f.remote.pull()).book;
 assert.deepEqual(repeated.records.map(row=>row.id).sort(),originalIds);assert.equal(repeated.records.find(row=>row.id===id).note,'corrected note');assert.equal(repeated.records.find(row=>row.id===id).settlement,-160);
});

test('desktop recordEdit rejects stale expectedBefore without publishing a remote version',async t=>{
 const f=await editableDesktopFixture(t);await publishRates(f,{CNY:1,USD:8,HKD:.9},'2026-10-03');
 let state=await ready(f),result=await edit(f,state,{type:'trade',id:'editable-fund',kind:'value',value:250,date:'2026-10-03'});assert.equal(result.res.status,200);
 state=await ready(f);const target=state.book.records.find(row=>row.assetId==='editable-fund'&&row.date==='2026-10-03');
 const stale=recordCorrection(state.book,target.id,{value:270,note:'stale form'}),base=(await f.remote.pull()).book,opening=base.records.find(row=>row.assetId==='editable-fund'&&row.date==='2026-10-01');
 const changed=applyAction(base,recordCorrection(base,opening.id,{value:220})),prepared=(await f.remote.sync(changed,'',{baseBook:base,prepareOnly:true})).prepared;
 await f.remote.sync(changed,'',{baseBook:base,recovery:prepared});state=await ready(f);
 assert.equal(recordEditContext(state.book,target.id).expectedBefore.source,220);assert.equal(stale.expectedBefore.source,200);
 const before=await f.remote.exportBackup();result=await edit(f,state,stale);
 assert.equal(result.res.status,400);assert.match(result.data.error,/前序流水|操作前余额/);
 const after=await f.remote.exportBackup();assert.deepEqual(after.ledger,before.ledger);assert.deepEqual(after.versions,before.versions);
 const official=(await f.remote.pull()).book;assert.equal(official.records.find(row=>row.id===target.id).after,250);assert.equal(official.records.length,state.book.records.length);
 assert.equal(JSON.parse(await readFile(path.join(f.dataDir,'nas-cache.json'),'utf8')).saveAttempt,null);
});
