import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openNasCache} from '../nas-cache.mjs';
import {emptyBook,applyAction,projectLedger,ledgerInputs} from '../runtime/finance.mjs';
import {digest} from '../feishu-merge.mjs';

const identity={instanceId:'cache-test',ledgerId:'main',source:'nas'};identity.accountId=digest({instanceId:identity.instanceId,ledgerId:identity.ledgerId}).slice(0,24);identity.cacheNamespace=identity.accountId;
async function cache(t,options){const dir=await mkdtemp(path.join(os.tmpdir(),'nas-cache-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {dir,cache:await openNasCache(dir,options)};}
const cash=id=>({id,name:'现金',platform:'银行',category:'现金',classification:'现金',market:'不适用',currency:'CNY',value:100,cost:100,date:'2026-10-01',note:''});
test('cache keeps newly observed remote cash context outside local intent through edit and restart',async t=>{
 const f=await cache(t);await f.cache.receive(projectLedger({...emptyBook(),initialized:true,rateDate:'2026-10-01',rateHistory:[{date:'2026-10-01',rates:{CNY:1,USD:7.1,HKD:.91},source:'test fixture'}]}),{identity});await f.cache.edit(applyAction(f.cache.book,{type:'base',base:'USD'}));
 const remote=applyAction(f.cache.cloud,{type:'add',assets:[cash('remote-cash')],date:'2026-10-01'});await f.cache.receive(remote,{identity});await f.cache.edit(applyAction(f.cache.book,{type:'icon',id:'remote-cash',value:'data:image/png;base64,aGVsbG8='}));
 assert.equal(f.cache.draft.base.base,'CNY');assert.equal(f.cache.draft.book.base,'USD');assert.equal(f.cache.draft.base.records.length,remote.records.length);assert.equal(f.cache.draft.book.records.length,remote.records.length);assert.equal(f.cache.draft.base.assets[0].value,100);
 const restarted=await openNasCache(f.dir);assert.equal(restarted.ready,false);assert.equal(restarted.book.base,'USD');await restarted.receive(remote,{identity});assert.equal(restarted.ready,true);assert.deepEqual(ledgerInputs(restarted.book),ledgerInputs(f.cache.book));
});
test('new remote custom currency is usable in later local rate input without changing owned baseline',async t=>{
 const f=await cache(t),base=projectLedger({...emptyBook(),initialized:true,rateHistory:[{date:'2026-10-01',rates:{CNY:1,USD:7.1,HKD:0.91},source:'手动汇率'}],rateDate:'2026-10-01'});await f.cache.receive(base,{identity});await f.cache.edit(applyAction(f.cache.book,{type:'base',base:'USD'}));
 const remote=applyAction(base,{type:'currency',code:'EUR',name:'欧元',rate:8,date:'2026-10-01'});await f.cache.receive(remote,{identity});const changed=applyAction(f.cache.book,{type:'rates',date:'2026-10-02',rates:{CNY:1,USD:7.2,HKD:0.92,EUR:8.2},source:'手动汇率'});await f.cache.edit(changed);
 assert.equal(f.cache.draft.base.base,'CNY');assert.equal(f.cache.draft.base.customCurrencies.EUR,'欧元');assert.equal(f.cache.draft.base.rates.EUR,8);assert.equal(f.cache.draft.book.rateHistory.at(-1).rates.EUR,8.2);
});
test('legacy state imports only after matching verified NAS alias and old files stay byte identical',async t=>{
 assert.ok(existsSync(new URL('../nas-legacy.mjs',import.meta.url)),'read-only legacy identity module must exist');const {createLegacyReader}=await import('../nas-legacy.mjs');
 const f=await cache(t),appId='cli_testlegacy',wiki='wikiroot1234567890',url='https://test.feishu.cn/wiki/ledger1234567890',configRoot=f.dir;
 const legacyAccountId=createHash('sha256').update([appId,wiki,url].join('\n')).digest('hex').slice(0,24),env=`FEISHU_APP_ID=${appId}\nFEISHU_APP_SECRET=test-secret\nFEISHU_WIKI_ROOT_TOKEN=${wiki}\nFEISHU_DRIVE_ROOT_TOKEN=drive1234567890\nFEISHU_WEB_BASE_URL=https://test.feishu.cn\n`;
 const base=emptyBook(),local={...base,base:'USD'},saved={format:'feishu-cache-v1',version:3,cloud:base,draft:{base,book:local}},oldPending='{"appToken":"old","book":{"base":"HKD"}}',rate={date:'2026-10-01',rates:{USD:'7.2'}};
 await writeFile(path.join(f.dir,'.env'),env);await writeFile(path.join(f.dir,'feishu-connection.json'),JSON.stringify({url,appFingerprint:createHash('sha256').update(appId).digest('hex').slice(0,12)}));await writeFile(path.join(f.dir,'feishu-cache.json'),JSON.stringify(saved));await writeFile(path.join(f.dir,'feishu-upload.json'),oldPending);await writeFile(path.join(f.dir,'rate-draft.json'),JSON.stringify(rate));
 const reader=createLegacyReader({dataDir:f.dir,configRoot,expectedFingerprint:createHash('sha256').update(appId).digest('hex').slice(0,12)});
 const migrated=await openNasCache(f.dir,{legacyReader:reader});assert.equal(migrated.ready,false);assert.equal(migrated.draft,null);const wrong=await migrated.receive(base,{identity:{...identity,legacyAccountId:'000000000000000000000000'}});assert.equal(migrated.draft,null);assert.equal(wrong.legacyRateDraft,null);
 const anotherDir=await mkdtemp(path.join(os.tmpdir(),'nas-alias-'));t.after(()=>rm(anotherDir,{recursive:true,force:true}));const correct=await openNasCache(anotherDir,{legacyReader:reader}),imported=await correct.receive(base,{identity:{...identity,legacyAccountId}});assert.equal(correct.book.base,'USD');assert.equal(imported.legacyRateDraft,null,'legacy raw rates have no verified conflict context and must not replay');assert.equal(await readFile(path.join(f.dir,'.env'),'utf8'),env);assert.equal(await readFile(path.join(f.dir,'feishu-upload.json'),'utf8'),oldPending);assert.deepEqual(JSON.parse(await readFile(path.join(f.dir,'feishu-cache.json'),'utf8')),saved);
 const exported=await reader.export();assert.equal(exported.pending.appToken,'old');assert.deepEqual(exported.rateDraft,rate);assert.ok(!JSON.stringify(exported).includes('test-secret'));
 const corrupt=structuredClone(saved);corrupt.draft.book.assets=null;await writeFile(path.join(f.dir,'feishu-cache.json'),JSON.stringify(corrupt));assert.equal(await reader(),null,'invalid legacy drafts must remain export-only');assert.deepEqual((await reader.export()).cache,corrupt);
});
test('Electron external destinations permit only canonical NAS origin and needed rate site',async()=>{
 assert.ok(existsSync(new URL('../nas-security.mjs',import.meta.url)),'NAS desktop external URL policy must exist');const {allowedExternalUrl,isLocalNavigation}=await import('../nas-security.mjs');
 const origin='https://asset.example.test';for(const url of [origin,origin+'/ledger','https://frankfurter.dev/'])assert.equal(allowedExternalUrl(url,origin),true);
 for(const url of ['https://evil.invalid','https://asset.example.test.evil.invalid','https://u:p@asset.example.test','https://ASSET.example.test','https://test.feishu.cn/wiki/x','http://asset.example.test','https://asset.example.test:443'])assert.equal(allowedExternalUrl(url,origin),false);
 assert.equal(isLocalNavigation('http://127.0.0.1:1234/','http://127.0.0.1:1234'),true);assert.equal(isLocalNavigation('http://127.0.0.1:1234@evil.invalid/','http://127.0.0.1:1234'),false);
});

test('cache rejects a save attempt bound to a different identity and keeps its original file',async t=>{
 const f=await cache(t);await f.cache.receive(emptyBook(),{identity});const file=path.join(f.dir,'nas-cache.json'),saved=JSON.parse(await readFile(file,'utf8'));saved.draft={base:emptyBook(),book:{...emptyBook(),base:'USD'}};const other={...identity,instanceId:'other'};other.accountId=digest({instanceId:other.instanceId,ledgerId:other.ledgerId}).slice(0,24);other.cacheNamespace=other.accountId;saved.saveAttempt={format:'nas-save-v1',identity:other,action:{type:'base',base:'USD'}};const original=JSON.stringify(saved);await writeFile(file,original);await assert.rejects(()=>openNasCache(f.dir),/缓存无法读取/);assert.equal(await readFile(file,'utf8'),original);
});
