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
import {createMongoService} from '../server/mongo-ledger.mjs';
let mongo,client,finance;
const opening='2026-09-01',date='2026-09-02';
const environment={LEDGER_INSTANCE_ID:'record-edit-mongo-test',LEDGER_ID:'main'};
before(async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'record-edit-mongo-')),outfile=path.join(folder,'finance.mjs');
 try{await build({stdin:{contents:"export * from './lib/finance.ts';export * from './lib/ledger.ts';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},outfile,bundle:true,format:'esm',platform:'node'});finance=await import(pathToFileURL(outfile));}finally{await rm(folder,{recursive:true,force:true});}
 // Inject a disposable local database; never read application connection settings.
 mongo=await MongoMemoryServer.create({binary:{version:'7.0.35'},instance:{storageEngine:'wiredTiger'}});client=await MongoClient.connect(mongo.getUri());
});
after(async()=>{await client?.close();await mongo?.stop();});
function fixture(){
 const book=finance.emptyBook();Object.assign(book,{initialized:true,ledgerAuthority:true,statisticsStart:opening,rateDate:date,rates:{CNY:1,USD:8,HKD:1},rateHistory:[opening,date].map((date,index)=>({date,rates:{CNY:1,USD:7+index,HKD:1},source:'fixture'}))});
 book.records=[['cash','现金',1000,'CNY'],['fund','基金',200,'USD']].map(([id,category,value,currency],index)=>({id:'opening-'+id,assetId:id,name:id,platform:'fixture',classification:category,category,currency,date:opening,type:category==='现金'?'剩余':'买入',before:0,after:value,amount:value,...(category==='现金'?{}:{settlement:-150}),note:'original '+id,order:index+1}));return finance.projectLedger(book);
}
const plain=value=>JSON.parse(JSON.stringify(value));
const inputs=book=>plain(finance.ledgerInputs(book));
const row=(book,id)=>book.records.find(record=>record.id===id);
const asset=(book,id)=>book.assets.find(item=>item.id===id);
const ids=book=>book.records.map(record=>record.id).sort();
function edit(book,id,changes){const context=finance.recordEditContext(book,id);return finance.applyAction(book,{type:'recordEdit',id,expected:context.expected,expectedBefore:context.expectedBefore,date:context.source.date,...changes});}
async function setup(t){const db=client.db('record_edit_test_'+randomUUID().replaceAll('-',''));t.after(()=>db.dropDatabase());return {db,service:await createMongoService({environment,database:db})};}
async function upload(service,book,baseBook){const {prepared}=await service.sync(book,'',{baseBook,prepareOnly:true});return {prepared,result:await service.sync(book,'',{baseBook,recovery:prepared})};}

test('Mongo opening and valuation corrections preserve IDs and read back without extra records',async t=>{
 const {service,db}=await setup(t),original=finance.applyAction(fixture(),{type:'trade',id:'fund',kind:'value',value:250,date});await service.importBook(original,{apply:true});
 const base=(await service.pull()).book,valuation=base.records.find(record=>record.date===date),originalIds=ids(base);
 await upload(service,edit(base,'opening-fund',{amount:160,value:220,note:'corrected opening'}),base);
 const first=(await service.pull()).book;
 assert.deepEqual(ids(first),originalIds);assert.equal(row(first,'opening-fund').settlement,-160);assert.equal(row(first,'opening-fund').after,220);assert.equal(row(first,'opening-fund').investedCny,1120);assert.equal(asset(first,'fund').value,250);
 const revised=edit(first,valuation.id,{value:270,note:'corrected valuation'}),{prepared,result}=await upload(service,revised,first);
 const reconnected=await createMongoService({environment,database:db}),read=(await reconnected.pull()).book;
 assert.deepEqual(ids(read),originalIds);assert.equal(read.records.length,3);assert.equal(asset(read,'fund').value,270);assert.equal(row(read,valuation.id).note,'corrected valuation');assert.equal(row(read,valuation.id).before,220);assert.equal(result.receipt.revision,3);
 const replay=await service.sync(revised,'',{baseBook:first,recovery:prepared});assert.equal(replay.receipt.revision,3);assert.deepEqual(inputs(replay.book),inputs(read));assert.equal(await db.collection('ledger_versions').countDocuments(),3);
});

test('Mongo incoming transfer edit persists both legs atomically and updates funding basis',async t=>{
 const {service,db}=await setup(t),original=finance.applyAction(fixture(),{type:'transfer',id:'cash',targetId:'fund',amount:80,targetAmount:10,targetValue:210,date});await service.importBook(original,{apply:true});const base=(await service.pull()).book;
 const incoming=base.records.find(record=>record.transferLeg==='in'),out=base.records.find(record=>record.transferLeg==='out');
 const corrected=edit(base,incoming.id,{amount:160,targetAmount:20,targetValue:220,note:'corrected pair'}),{result}=await upload(service,corrected,base),read=(await service.pull()).book;
 assert.deepEqual(ids(read),ids(base));assert.equal(read.records.length,4);assert.equal(result.receipt.revision,2);assert.equal(asset(read,'cash').value,840);assert.equal(asset(read,'fund').value,220);
 assert.equal(row(read,out.id).settlement,-160);assert.equal(row(read,incoming.id).settlement,-20);assert.equal(row(read,incoming.id).fundingAmount,160);assert.equal(row(read,incoming.id).fundingCurrency,'CNY');assert.equal(row(read,incoming.id).settlementCny,-160);assert.equal(row(read,incoming.id).positionDelta,20);
 for(const id of [out.id,incoming.id]){assert.equal(row(read,id).note,'corrected pair');assert.equal(row(read,id).transferId,incoming.transferId);}
 const versions=await db.collection('ledger_versions').find().toArray();assert.equal(versions.length,2);
 for(const version of versions){const outgoing=row(version.inputs,out.id),target=row(version.inputs,incoming.id);assert.equal(target.fundingAmount,Math.abs(outgoing.settlement));assert.equal(Math.abs(outgoing.settlement),Math.abs(target.settlement)*8);}
});

test('Mongo stale concurrent correction rejects conflict without changing official pointer or history',async t=>{
 const {service,db}=await setup(t);await service.importBook(fixture(),{apply:true});const other=await createMongoService({environment,database:db}),base=(await service.pull()).book;
 const first=edit(base,'opening-fund',{amount:160,note:'first correction'}),stale=edit(base,'opening-fund',{amount:170,note:'stale correction'});
 const preparedFirst=(await service.sync(first,'',{baseBook:base,prepareOnly:true})).prepared,preparedStale=(await other.sync(stale,'',{baseBook:base,prepareOnly:true})).prepared;
 await service.sync(first,'',{baseBook:base,recovery:preparedFirst});
 const pointer=await db.collection('ledgers').findOne({_id:'main'}),versions=await db.collection('ledger_versions').find().sort({_id:1}).toArray(),official=inputs((await service.pull()).book);
 await assert.rejects(other.sync(stale,'',{baseBook:base,recovery:preparedStale}),error=>error.safe===true&&error.status===409);
 assert.deepEqual(await db.collection('ledgers').findOne({_id:'main'}),pointer);assert.deepEqual(await db.collection('ledger_versions').find().sort({_id:1}).toArray(),versions);assert.deepEqual(inputs((await service.pull()).book),official);assert.equal(pointer.revision,2);assert.equal(pointer.receipts.length,1);
});

test('Mongo backup retains original inputs and every correction revision and restores latest',async t=>{
 const {service,db}=await setup(t);await service.importBook(fixture(),{apply:true});const original=await service.pull(),initialVersion=await db.collection('ledger_versions').findOne({_id:original.receipt.versionId});
 await upload(service,edit(original.book,'opening-fund',{amount:160,value:220,note:'revision two'}),original.book);
 const secondBase=(await service.pull()).book;await upload(service,edit(secondBase,'opening-fund',{amount:170,value:230,note:'revision three'}),secondBase);
 assert.deepEqual(await db.collection('ledger_versions').findOne({_id:initialVersion._id}),initialVersion);
 const backup=await service.exportBackup();assert.equal(backup.ledger.revision,3);assert.equal(backup.versions.length,3);assert.deepEqual(backup.versions.find(version=>version._id===initialVersion._id),initialVersion);
 assert.deepEqual(backup.versions.map(version=>row(version.inputs,'opening-fund').settlement).sort((a,b)=>a-b),[-170,-160,-150]);
 const target=await setup(t);await target.service.restoreBackup(plain(backup),{apply:true});const restored=await target.service.pull();
 assert.equal(restored.receipt.revision,3);assert.equal(row(restored.book,'opening-fund').settlement,-170);assert.equal(asset(restored.book,'fund').value,230);assert.deepEqual(ids(restored.book),ids(original.book));assert.equal(await target.db.collection('ledger_versions').countDocuments(),3);assert.deepEqual(inputs(restored.book),inputs((await service.pull()).book));
});
