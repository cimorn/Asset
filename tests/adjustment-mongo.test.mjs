import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createMongoService,checkedInputs,digest} from '../server/mongo-ledger.mjs';

let mongo,client,finance;
const opening='2026-09-01',date='2026-10-03';
const environment={LEDGER_INSTANCE_ID:'adjustment-mongo-test',LEDGER_ID:'main'};
before(async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'adjustment-mongo-finance-')),outfile=path.join(folder,'finance.mjs');
 try{
  await build({stdin:{contents:"export * from './lib/finance.ts';export * from './lib/ledger.ts';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},outfile,bundle:true,format:'esm',platform:'node'});
  finance=await import(pathToFileURL(outfile));
 }finally{await rm(folder,{recursive:true,force:true});}
 // An injected, disposable local database never uses application connection settings.
 mongo=await MongoMemoryServer.create({binary:{version:'7.0.35'},instance:{storageEngine:'wiredTiger'}});
 client=await MongoClient.connect(mongo.getUri());
});
after(async()=>{await client?.close();await mongo?.stop();});
function fixture(){
 const book=finance.emptyBook();Object.assign(book,{initialized:true,ledgerAuthority:true,statisticsStart:opening,rateDate:date,rates:{CNY:1,USD:8,HKD:.9},rateHistory:[{date:opening,rates:{CNY:1,USD:7,HKD:.9},source:'fixture'},{date,rates:{CNY:1,USD:8,HKD:.9},source:'fixture'}]});
 const row=(id,platform,classification,category,value,cost,currency='CNY')=>({id,name:id,platform,classification,category,currency,value,cost,market:'不适用',date:opening,note:'fixture '+id});
 book.assets=[row('cash','Bank','现金','现金',1000,null),row('fund','Broker','基金','基金',200,150),row('crypto','Exchange','虚拟币','其他',10,10,'USD')];
 book.records=book.assets.map((asset,index)=>({id:'opening-'+asset.id,assetId:asset.id,name:asset.name,platform:asset.platform,classification:asset.classification,category:asset.category,currency:asset.currency,date:opening,type:asset.category==='现金'?'剩余':'买入',before:0,after:asset.value,amount:asset.value,note:'original '+asset.id,order:index+1,...(asset.category==='现金'?{}:{settlement:-asset.cost})}));
 return finance.projectLedger(book);
}
const classify=book=>finance.applyAction(book,{type:'classify',id:'fund',classification:'黄金',date});
const transfer=book=>finance.applyAction(book,{type:'transfer',id:'fund',targetId:'crypto',amount:200,sourceValue:0,targetAmount:24,date,note:'cross currency with fee'});
const adjusted=()=>transfer(classify(fixture()));
const plain=value=>JSON.parse(JSON.stringify(value));
const principal=book=>finance.capitalAccounts(book).reduce((sum,row)=>sum+row.costCny,0);
const legs=book=>({out:book.records.find(row=>row.transferLeg==='out'),incoming:book.records.find(row=>row.transferLeg==='in')});
async function setup(t){
 const db=client.db('asset_adjustment_test_'+randomUUID().replaceAll('-',''));
 t.after(()=>db.dropDatabase());return {db,service:await createMongoService({environment,database:db})};
}
async function upload(service,book,baseBook){
 const {prepared}=await service.sync(book,'',{baseBook,prepareOnly:true});
 return {prepared,result:await service.sync(book,'',{baseBook,recovery:prepared})};
}
test('Mongo accepts cash allocation of an existing holding and preserves original history',async t=>{
 const {service}=await setup(t),original=fixture();await service.importBook(original,{apply:true});
 const base=(await service.pull()).book,local=finance.applyAction(base,{type:'classify',id:'fund',classification:'现金',date});
 await upload(service,local,base);
 const read=(await service.pull()).book;
 assert.equal(read.assets.find(asset=>asset.id==='fund').classification,'现金');
 assert.equal(read.assets.find(asset=>asset.id==='fund').value,200);
 assert.equal(principal(read),1220);
 assert.equal(finance.investmentRows(read).find(row=>row.assetId==='fund').gain,50);
 const backup=await service.exportBackup();assert.equal(backup.versions.length,2);
 const first=backup.versions.find(version=>version.hash===digest(checkedInputs(original)));
 assert.ok(first);assert.deepEqual(first.inputs,checkedInputs(original));
});
function assertAdjusted(book){
 assert.equal(book.assets.length,3);assert.equal(new Set(book.records.map(row=>row.id)).size,book.records.length);
 const fund=book.assets.find(row=>row.id==='fund'),crypto=book.assets.find(row=>row.id==='crypto');
 assert.equal(fund.classification,'黄金');assert.equal(fund.value,0);assert.equal(crypto.value,34);
 assert.equal(book.records.filter(row=>row.classificationChange).length,1);
 const marker=book.records.find(row=>row.classificationChange);assert.equal(marker.previousClassification,'基金');assert.equal(marker.classification,'黄金');
 const {out,incoming}=legs(book);assert.ok(out.transferId);assert.equal(out.transferId,incoming.transferId);assert.equal(out.counterpartyId,'crypto');assert.equal(incoming.counterpartyId,'fund');
 assert.equal(out.positionDelta,-200);assert.equal(incoming.positionDelta,24);assert.equal(incoming.fundingCurrency,'CNY');assert.equal(incoming.fundingAmount,200);assert.equal(incoming.settlement,-24);assert.equal(incoming.settlementCny,-200);
 assert.equal(principal(book),1220);assert.equal(finance.investmentRows(book).find(row=>row.assetId==='fund').gain,50);assert.equal(finance.investmentRows(book).find(row=>row.assetId==='crypto').investedCny,270);
}

test('Mongo persists dated classification and paired transfer; recovered upload never duplicates events',async t=>{
 const {service,db}=await setup(t),original=fixture();await service.importBook(original,{apply:true});
 const base=(await service.pull()).book,classified=classify(base),first=await upload(service,classified,base);
 const classRead=(await service.pull()).book;assert.equal(classRead.records.length,4);assert.equal(classRead.assets.find(row=>row.id==='fund').classification,'黄金');assert.equal(principal(classRead),1220);
 assert.equal(finance.ledgerAtDate(classRead,opening).assets.find(row=>row.id==='fund').classification,'基金');
 const local=transfer(classRead),{prepared,result}=await upload(service,local,classRead);assertAdjusted(result.book);
 const frozen=plain(finance.ledgerInputs(result.book)),revision=result.receipt.revision;
 for(let attempt=0;attempt<3;attempt++){
  const retried=await service.sync(local,'',{baseBook:classRead,recovery:prepared});assertAdjusted(retried.book);
  assert.equal(retried.receipt.revision,revision);assert.equal(retried.receipt.requestId,result.receipt.requestId);assert.deepEqual(plain(finance.ledgerInputs(retried.book)),frozen);
 }
 const reconnected=await createMongoService({environment,database:db}),pulled=await reconnected.pull();assertAdjusted(pulled.book);
 assert.equal(pulled.book.records.length,6);assert.equal((await db.collection('ledgers').findOne()).receipts.length,2);
 assert.equal(await db.collection('ledger_versions').countDocuments(),3);
 for(const row of plain(finance.ledgerInputs(original)).records)assert.deepEqual(frozen.records.find(record=>record.id===row.id),row);
 assert.ok(first.result.receipt.uploaded);
});

test('Mongo full backup restores adjustment metadata and the original recovery receipt',async t=>{
 const {service}=await setup(t),original=fixture();await service.importBook(original,{apply:true});
 const base=(await service.pull()).book,local=adjusted(),{prepared,result}=await upload(service,local,base),backup=await service.exportBackup();
 const target=await setup(t);await target.service.restoreBackup(backup,{apply:true});const restored=await target.service.pull();assertAdjusted(restored.book);
 assert.deepEqual(plain(finance.ledgerInputs(restored.book)),plain(finance.ledgerInputs(result.book)));
 const replay=await target.service.sync(local,'',{baseBook:base,recovery:prepared});assertAdjusted(replay.book);assert.equal(replay.receipt.revision,result.receipt.revision);
 assert.equal(replay.receipt.requestId,result.receipt.requestId);assert.equal(replay.book.records.length,6);
 const counts={versions:await target.db.collection('ledger_versions').countDocuments(),records:replay.book.records.length};
 await assert.rejects(target.service.restoreBackup(backup,{apply:true}),/空账本/);
 assert.equal(await target.db.collection('ledger_versions').countDocuments(),counts.versions);assert.equal((await target.service.pull()).book.records.length,counts.records);
});

test('checkedInputs preserves classification, transfer links, funding and replay deltas in canonical storage',()=>{
 const book=adjusted(),frozen=structuredClone(book),inputs=checkedInputs(book),restored=finance.projectLedger(structuredClone(inputs));assertAdjusted(restored);assert.deepEqual(book,frozen);
 assert.equal(digest(checkedInputs(restored)),digest(inputs));assert.deepEqual(checkedInputs(restored),inputs);
 for(const row of book.records.filter(record=>record.transferId||record.classificationChange)){
  const saved=inputs.records.find(record=>record.id===row.id);
  for(const key of ['classificationChange','previousClassification','transferId','transferLeg','counterpartyId','fundingCurrency','fundingAmount','positionDelta'])assert.equal(saved[key],row[key],key);
 }
});

const corruptions=[
 ['a transfer with only its outgoing leg',book=>{book.records=book.records.filter(row=>row.transferLeg!=='in');}],
 ['a transfer with only its incoming leg',book=>{book.records=book.records.filter(row=>row.transferLeg!=='out');}],
 ['an incoming leg with incorrect funding amount',book=>{legs(book).incoming.fundingAmount=201;}],
 ['an incoming leg with incorrect funding currency',book=>{legs(book).incoming.fundingCurrency='USD';}],
 ['an incoming leg missing its funding basis',book=>{delete legs(book).incoming.fundingAmount;delete legs(book).incoming.fundingCurrency;}],
 ['duplicate incoming transfer legs',book=>{const incoming=legs(book).incoming;book.records.push({...incoming,id:'duplicate-leg',order:20});}],
 ['two outgoing legs sharing one transfer ID',book=>{legs(book).incoming.transferLeg='out';}],
 ['an inconsistent counterparty link',book=>{legs(book).incoming.counterpartyId='cash';}],
 ['a pair carrying mismatched transfer IDs',book=>{legs(book).incoming.transferId='different-transfer';}],
 ['transfer legs recorded on different dates',book=>{legs(book).incoming.date=opening;}],
 ['an unsaved transfer FX date',book=>{for(const row of book.records.filter(record=>record.transferId))row.date='2026-10-04';}],
 ['an impossible transfer calendar date',book=>{for(const row of book.records.filter(record=>record.transferId))row.date='2026-02-30';}],
];
for(const [name,mutate] of corruptions)test(`checkedInputs rejects ${name} without changing the submitted object`,()=>{
 const valid=transfer(fixture());assert.doesNotThrow(()=>checkedInputs(valid),'the intact transfer must be accepted before testing a corrupt variant');
 const invalid=structuredClone(valid);mutate(invalid);const frozen=structuredClone(invalid);
 assert.throws(()=>checkedInputs(invalid),error=>error.safe===true&&error.status===400&&/输入无效/.test(error.message));assert.deepEqual(invalid,frozen);
});

test('invalid paired transfer cannot prepare or publish a Mongo version',async t=>{
 const {service,db}=await setup(t);await service.importBook(fixture(),{apply:true});const base=(await service.pull()).book,invalid=transfer(base);
 legs(invalid).incoming.fundingAmount=201;
 await assert.rejects(service.sync(invalid,'',{baseBook:base,prepareOnly:true}),error=>error.status===400&&error.safe);
 assert.equal((await service.pull()).receipt.revision,1);assert.equal((await service.pull()).book.records.length,3);
 assert.equal(await db.collection('ledger_versions').countDocuments(),1);assert.equal((await db.collection('ledgers').findOne()).receipts.length,0);
});

test('Mongo rejects concurrent old trade sales that oversell the same baseline without publishing a version or receipt',async t=>{
 const {service,db}=await setup(t),other=await createMongoService({environment,database:db});
 await service.importBook(fixture(),{apply:true});const base=(await service.pull()).book;
 const first=finance.applyAction(base,{type:'trade',id:'fund',kind:'sell',amount:100,value:80,newCash:{balance:0},date});
 const second=finance.applyAction(base,{type:'trade',id:'fund',kind:'sell',amount:110,value:70,newCash:{balance:0},date});
 assert.equal(first.assets.find(row=>row.id==='fund').value,80);assert.equal(second.assets.find(row=>row.id==='fund').value,70);
 const preparedFirst=await service.sync(first,'',{baseBook:base,prepareOnly:true}),preparedSecond=await other.sync(second,'',{baseBook:base,prepareOnly:true});
 const accepted=await service.sync(first,'',{baseBook:base,recovery:preparedFirst.prepared});
 assert.equal(accepted.book.assets.find(row=>row.id==='fund').value,80);
 const pointer=await db.collection('ledgers').findOne({_id:'main'}),versions=await db.collection('ledger_versions').countDocuments(),official=plain(finance.ledgerInputs(accepted.book));
 assert.equal(pointer.revision,2);assert.equal(pointer.receipts.length,1);
 let rejected;
 await assert.rejects(other.sync(second,'',{baseBook:base,recovery:preparedSecond.prepared}),error=>{rejected=error;return error.safe===true;});
 assert.deepEqual(await db.collection('ledgers').findOne({_id:'main'}),pointer);
 assert.equal(await db.collection('ledger_versions').countDocuments(),versions);
 const pulled=await service.pull();assert.equal(pulled.receipt.revision,2);assert.deepEqual(plain(finance.ledgerInputs(pulled.book)),official);
 assert.equal(pulled.book.assets.find(row=>row.id==='fund').value,80);
 assert.equal(pulled.book.assets.filter(row=>row.category==='现金'&&row.platform==='Broker').length,1);
 assert.ok(rejected.status===400||rejected.status===409,'overselling is an invalid/conflicting transaction, not a database outage');
});
