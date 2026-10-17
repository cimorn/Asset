import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {indexedDB,IDBKeyRange,IDBFactory} from 'fake-indexeddb';
import {randomUUID} from 'node:crypto';
import {emptyBook,projectLedger} from '../server/runtime/finance.mjs';

test('browser cache keeps old records, migrates draft only after NAS read, and uses generic routes',async()=>{
 globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;globalThis.window=new EventTarget();Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(_name,fn)=>fn()}},configurable:true});
 const compiled=await build({entryPoints:['src/cache.ts'],bundle:true,write:false,format:'esm',platform:'browser',alias:{'@':process.cwd()}});const cache=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('asset-compass-web-cache',1);r.onupgradeneeded=()=>r.result.createObjectStore('accounts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const legacy='old-account',id='nas-account',base=emptyBook(),draft=structuredClone(base);draft.base='USD';
 const old={cloud:base,draft:{base,book:projectLedger(draft)},rateDraft:null,pending:{payload:JSON.stringify({recovery:{source:'feishu'}}),signature:'old'},version:3,sync:{source:'feishu'}};
 await new Promise(resolve=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(old,legacy);tx.oncomplete=resolve;});
 const requests=[];let cloud=base;
 globalThis.fetch=async(url,options)=>{requests.push(url);if(url==='/api/ledger/prepare')return Response.json({journal:{payload:JSON.stringify({source:'nas'}),signature:'new'}});if(url==='/api/ledger/upload'){cloud=projectLedger(draft);}return Response.json({ready:true,book:cloud,sync:{source:'nas',configured:true,linked:true}});};
 cache.setAccount(id,{legacyAccountId:legacy,instanceId:'test',ledgerId:'main'});
 const read=await (await cache.financeRequest('/api/book?refresh=1')).json();assert.equal(read.book.base,'USD');assert.equal(read.sync.source,'nas');assert.equal(read.sync.archivedDrafts,1);
 const uploaded=await cache.financeRequest('/api/ledger/upload',{method:'POST',body:'{}'});assert.equal(uploaded.status,200);assert.ok(requests.includes('/api/ledger/prepare'));assert.ok(requests.includes('/api/ledger/upload'));
 assert.equal((await cache.exportBrowserCaches()).accounts[legacy].pending.signature,'old');
 const current=await (await cache.financeRequest('/api/book')).json();await cache.financeRequest('/api/book',{method:'POST',body:JSON.stringify({version:current.version,action:{type:'base',base:'HKD'}})});
 globalThis.fetch=async(url)=>url==='/api/ledger/prepare'?Response.json({journal:{payload:JSON.stringify({source:'nas'}),signature:'failed-upload'}}):Response.json({error:'conflicting fields',conflicts:['base']},{status:409});
 assert.equal((await cache.financeRequest('/api/ledger/upload',{method:'POST',body:'{}'})).status,409);
 const pendingState=await (await cache.financeRequest('/api/book')).json();assert.equal(pendingState.sync.canReprepare,true);
 const reset=await cache.financeRequest('/api/ledger/reprepare',{method:'POST',body:JSON.stringify({version:pendingState.version})});assert.equal(reset.status,200);const resetData=await reset.json();assert.equal(resetData.book.base,'HKD');assert.equal(resetData.sync.canRetrySave,false);assert.equal(resetData.sync.canReprepare,true,'preserved old draft still needs explicit recovery before direct save');assert.equal((await cache.exportBrowserCaches()).accounts[id].pending,null);
 const archived=await cache.exportBrowserCaches();assert.ok(Object.values(archived.accounts).some(s=>s.pending?.signature==='failed-upload'));
 globalThis.fetch=async()=>{throw Error('offline');};const offline=await (await cache.financeRequest('/api/book?refresh=1')).json();assert.equal(offline.book.base,'HKD');assert.match(offline.sync.error,/offline/);db.close();
});

async function freshCache(){
 globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;globalThis.window=new EventTarget();Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(_name,fn)=>fn()}},configurable:true});
 const compiled=await build({entryPoints:['src/cache.ts'],bundle:true,write:false,format:'esm',platform:'browser',alias:{'@':process.cwd()}});
 const cache=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64')+'#'+randomUUID());
 const db=await new Promise((resolve,reject)=>{const r=globalThis.indexedDB.open('asset-compass-web-cache',1);r.onupgradeneeded=()=>r.result.createObjectStore('accounts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const seed=(key,value)=>new Promise(resolve=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(value,key);tx.oncomplete=resolve;});
 return {cache,db,seed};
}
test('ready stale snapshot with sync error cannot replace cloud or clear financial drafts',async()=>{
 const {cache,db,seed}=await freshCache(),id='nas-error-test',cloud=projectLedger({...emptyBook(),base:'USD'}),draft=projectLedger({...cloud,base:'HKD'}),rateDraft={date:'2026-10-01',rates:{CNY:'1',USD:'7.1234',HKD:'0.91'}};
 await seed(id,{cloud,draft:{base:cloud,book:draft},rateDraft,pending:null,version:4,sync:{source:'nas'}});
 const requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,method:options?.method??'GET'});return Response.json({book:draft,ready:true,sync:{source:'nas',linked:true,error:'database unavailable'}});};
 cache.setAccount(id);const result=await (await cache.financeRequest('/api/book?refresh=1')).json(),state=(await cache.exportBrowserCaches()).accounts[id];
 assert.equal(state.cloud.base,'USD');assert.equal(state.draft.book.base,'HKD');assert.deepEqual(state.rateDraft,rateDraft);assert.equal(state.version,4);assert.equal(result.sync.dirty,true);assert.equal(result.sync.error,'database unavailable');assert.equal(result.book.base,'HKD');assert.deepEqual(requests,[{url:'/api/book?refresh=1',method:'GET'}]);db.close();
});
test('legacy drafts migrate only on a clean NAS read after thrown and stale snapshot failures',async()=>{
 const {cache,db,seed}=await freshCache(),id='nas-deferred-migration',legacyId='legacy-deferred',cloud=projectLedger({...emptyBook(),base:'USD'}),draft=projectLedger({...cloud,base:'HKD'}),rateDraft={date:'2026-10-01',rates:{CNY:'1',USD:'7.1234',HKD:'0.91'}};
 const legacy={cloud,draft:{base:cloud,book:draft},rateDraft,pending:{payload:'old-feishu-payload',signature:'old-signature'},version:3,sync:{source:'feishu'}};await seed(legacyId,legacy);cache.setAccount(id,{legacyAccountId:legacyId});
 globalThis.fetch=async()=>{throw Error('offline');};await cache.financeRequest('/api/book?refresh=1');
 let state=(await cache.exportBrowserCaches()).accounts[id];assert.equal(state.cloud,null);assert.equal(state.draft,null);assert.equal(state.rateDraft,null);assert.equal(state.pending,null);
 globalThis.fetch=async()=>Response.json({book:draft,ready:true,sync:{source:'nas',error:'stale snapshot'}});await cache.financeRequest('/api/book?refresh=1');
 state=(await cache.exportBrowserCaches()).accounts[id];assert.equal(state.cloud,null);assert.equal(state.draft,null);assert.equal(state.rateDraft,null);assert.equal(state.pending,null);
 globalThis.fetch=async()=>Response.json({book:cloud,ready:true,sync:{source:'nas',linked:true,error:''}});const result=await (await cache.financeRequest('/api/book?refresh=1')).json(),archive=await cache.exportBrowserCaches();state=archive.accounts[id];
 assert.equal(state.cloud.base,'USD');assert.equal(state.draft.book.base,'HKD');assert.deepEqual(state.rateDraft,rateDraft);assert.equal(state.pending,null);assert.equal(result.sync.dirty,true);assert.deepEqual(archive.accounts[legacyId],legacy);db.close();
});

test('unbound legacy rate form stays exportable and never automatically prepares an upload',async()=>{
 const {cache,db,seed}=await freshCache(),id='nas-unbound-form',cloud=projectLedger(emptyBook()),rateDraft={date:'2026-09-01',rates:{CNY:'1',USD:'7.2',HKD:'0.91'}};
 await seed(id,{cloud,draft:null,rateDraft,pending:null,version:4,sync:{source:'nas'}});cache.setAccount(id);
 const requests=[];globalThis.fetch=async url=>{requests.push(url);return Response.json({journal:{payload:'unexpected',signature:'unexpected'},book:cloud,ready:true,sync:{source:'nas'}});};
 const response=await cache.financeRequest('/api/ledger/upload',{method:'POST',body:'{}'});assert.equal(response.status,409);assert.deepEqual(requests,[]);assert.deepEqual((await cache.exportBrowserCaches()).accounts[id].rateDraft,rateDraft);
 const reset=await cache.financeRequest('/api/ledger/reprepare',{method:'POST',body:JSON.stringify({version:4})});assert.equal(reset.status,200);
 const archive=await cache.exportBrowserCaches();assert.equal(archive.accounts[id].rateDraft,null);assert.ok(Object.entries(archive.accounts).some(([key,value])=>key!==id&&JSON.stringify(value.rateDraft)===JSON.stringify(rateDraft)));db.close();
});
