import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {emptyBook,projectLedger,ledgerInputs} from '../server/runtime/finance.mjs';
import {same} from '../shared/merge.mjs';

let mongo,client,createMongoService;
const environment={LEDGER_INSTANCE_ID:'test-instance',LEDGER_ID:'main'};
before(async()=>{
 const module=await import('../server/mongo-ledger.mjs').catch(()=>({}));
 assert.equal(typeof module.createMongoService,'function','Mongo ledger service must exist');
 createMongoService=module.createMongoService;
 mongo=await MongoMemoryServer.create({binary:{version:'7.0.35'},instance:{storageEngine:'wiredTiger'}});
 client=await MongoClient.connect(mongo.getUri());
});
after(async()=>{await client?.close();await mongo?.stop();});
export function fixture(){
 const book=emptyBook();Object.assign(book,{initialized:true,ledgerAuthority:true,statisticsStart:'2026-09-01',rateDate:'2026-09-01',rateSource:'手动汇率',rateHistory:[{date:'2026-09-01',rates:{CNY:1,USD:7.12345678,HKD:0.914321},source:'手动汇率'}]});
 book.records=[{id:'r1',assetId:'a1',name:'余额',category:'现金',classification:'现金',platform:'银行',currency:'CNY',date:'2026-09-01',type:'剩余',remainingMode:'更新市值',before:0,after:100,amount:100,note:'',order:1}];
 return projectLedger(book);
}
async function setup(t){const db=client.db('asset_test_'+randomUUID().replaceAll('-',''));t.after(()=>db.dropDatabase());return {db,service:await createMongoService({environment,database:db})};}
async function upload(service,book,baseBook){const p=await service.sync(book,'',{baseBook,prepareOnly:true});return service.sync(book,'',{baseBook,recovery:p.prepared});}

test('empty database requires migration and dry-run never writes',async t=>{
 const {service,db}=await setup(t);await assert.rejects(service.pull(),/尚未导入/);
 const report=await service.importBook(fixture());assert.equal(report.applied,false);assert.equal(await db.collection('ledgers').countDocuments(),0);
 await service.importBook(fixture(),{apply:true});assert.equal((await service.pull()).book.assets[0].value,100);
 await assert.rejects(service.importBook(fixture(),{apply:true}),/空账本/);
});
test('prepare is read-only; retry after response loss never duplicates receipts or records',async t=>{
 const {service,db}=await setup(t);await service.importBook(fixture(),{apply:true});
 const base=(await service.pull()).book,local=structuredClone(base);local.records.push({...local.records[0],id:'r2',date:'2026-09-02',after:125,order:2});
 const p=await service.sync(local,'',{baseBook:base,prepareOnly:true});assert.equal((await service.pull()).book.records.length,1);
 const first=await service.sync(local,'',{baseBook:base,recovery:p.prepared});const second=await service.sync(local,'',{baseBook:base,recovery:p.prepared});
 assert.equal(second.book.records.length,2);assert.equal(second.receipt.requestId,first.receipt.requestId);assert.equal((await db.collection('ledgers').findOne()).receipts.length,1);
});
test('independent stale edits merge while truly conflicting fields preserve official data',async t=>{
 const {service}=await setup(t);await service.importBook(fixture(),{apply:true});const base=(await service.pull()).book;
 const left=structuredClone(base),right=structuredClone(base);left.records[0].note='left';right.base='USD';
 await upload(service,left,base);const merged=await upload(service,right,base);assert.equal(merged.book.records[0].note,'left');assert.equal(merged.book.base,'USD');
 const conflicting=structuredClone(base);conflicting.records[0].note='right';await assert.rejects(upload(service,conflicting,base),e=>e.status===409&&e.conflicts.includes('records[r1].note'));
 assert.equal((await service.pull()).book.records[0].note,'left');
});
test('simultaneous clients use CAS and retain independently added records',async t=>{
 const {service,db}=await setup(t);await service.importBook(fixture(),{apply:true});const other=await createMongoService({environment,database:db}),base=(await service.pull()).book;
 const a=structuredClone(base),b=structuredClone(base);a.records.push({...a.records[0],id:'r2',date:'2026-09-02',after:130,order:2});b.records.push({...b.records[0],id:'r3',date:'2026-09-03',after:180,order:3});
 const pa=await service.sync(a,'',{baseBook:base,prepareOnly:true}),pb=await other.sync(b,'',{baseBook:base,prepareOnly:true});
 await Promise.all([service.sync(a,'',{baseBook:base,recovery:pa.prepared}),other.sync(b,'',{baseBook:base,recovery:pb.prepared})]);assert.equal((await service.pull()).book.records.length,3);
});
test('balance valuation replaces total and preserves dated FX precision and snapshots',async t=>{
 const {service}=await setup(t);const base=fixture();await service.importBook(base,{apply:true});const local=structuredClone(base);local.records.push({...local.records[0],id:'r2',date:'2026-09-02',after:130,order:2});
 const result=await upload(service,local,base);assert.equal(result.book.assets[0].value,130);assert.equal(result.book.rateHistory[0].rates.USD,7.12345678);assert.equal(result.book.rateDate,'2026-09-01');assert.deepEqual(result.book.snapshots,projectLedger(local).snapshots);
});
test('interruption before pointer publish exposes only previous complete version',async t=>{
 const {service,db}=await setup(t);await service.importBook(fixture(),{apply:true});const base=(await service.pull()).book,local=structuredClone(base);local.base='USD';const p=await service.sync(local,'',{baseBook:base,prepareOnly:true});
 const faultyDb={databaseName:db.databaseName,collection(name){const c=db.collection(name);return name==='ledgers'?new Proxy(c,{get(target,key){if(key==='updateOne')return async()=>{throw Error('simulated outage mongodb://secret');};const v=target[key];return typeof v==='function'?v.bind(target):v;}}):c;}};
 const faulty=await createMongoService({environment,database:faultyDb});await assert.rejects(faulty.sync(local,'',{baseBook:base,recovery:p.prepared}),e=>e.safe&&!e.message.includes('secret'));
 assert.equal((await service.pull()).book.base,'CNY');await service.sync(local,'',{baseBook:base,recovery:p.prepared});assert.equal((await service.pull()).book.base,'USD');
});
test('full export restores all history and receipts only into empty target; tampering rejected',async t=>{
 const {service}=await setup(t);await service.importBook(fixture(),{apply:true});const base=(await service.pull()).book,local=structuredClone(base);local.base='USD';await upload(service,local,base);
 const backup=await service.exportBackup(),target=await setup(t);assert.equal((await target.service.restoreBackup(backup)).applied,false);await target.service.restoreBackup(backup,{apply:true});
 const restored=await target.service.exportBackup();assert.ok(same(backup.ledger,restored.ledger));assert.ok(same(backup.versions,restored.versions));assert.ok(same(ledgerInputs((await service.pull()).book),ledgerInputs((await target.service.pull()).book)));
 await assert.rejects(target.service.restoreBackup(backup,{apply:true}),/空账本/);const corrupt=structuredClone(backup);corrupt.versions[0].inputs.base='HKD';await assert.rejects(service.restoreBackup(corrupt),/摘要/);
});
test('journal identity and payload mismatch are rejected',async t=>{
 const {service}=await setup(t);await service.importBook(fixture(),{apply:true});const base=(await service.pull()).book,p=await service.sync(base,'',{baseBook:base,prepareOnly:true});
 await assert.rejects(service.sync(base,'',{baseBook:base,recovery:{...p.prepared,instanceId:'wrong'}}),/恢复记录/);
 const altered=structuredClone(base);altered.base='USD';await assert.rejects(service.sync(altered,'',{baseBook:base,recovery:p.prepared}),/恢复记录/);
});
test('old request cannot replay after its receipt retention window has passed',async t=>{
 const {service,db}=await setup(t);await service.importBook(fixture(),{apply:true});const base=(await service.pull()).book,p=await service.sync(base,'',{baseBook:base,prepareOnly:true});
 await db.collection('ledgers').updateOne({_id:'main'},{$set:{revision:1025,receipts:[]}});
 await assert.rejects(service.sync(base,'',{baseBook:base,recovery:p.prepared}),e=>e.status===409&&/过旧/.test(e.message));
});
