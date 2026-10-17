import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {createMongoService,digest} from '../server/mongo-ledger.mjs';
import {emptyBook,projectLedger} from '../server/runtime/finance.mjs';

const migration=await import('../scripts/storage-start.mjs').catch(()=>({}));
const markerId='asset-storage-20261014';
const environment={LEDGER_INSTANCE_ID:'storage-migration-test',LEDGER_ID:'main'};
let mongo,client;
before(async()=>{
 mongo=await MongoMemoryServer.create({binary:{version:'7.0.35'},instance:{storageEngine:'wiredTiger'}});
 client=await MongoClient.connect(mongo.getUri());
});
after(async()=>{await client?.close();await mongo?.stop();});
function fixture(){
 const book=emptyBook();Object.assign(book,{initialized:true,ledgerAuthority:true,statisticsStart:'2026-09-01',rateDate:'2026-09-01',rateSource:'手动汇率',rateHistory:[{date:'2026-09-01',rates:{CNY:1,USD:7.12345678,HKD:0.914321},source:'手动汇率'}]});
 book.records=[{id:'r1',assetId:'a1',name:'余额',category:'现金',classification:'现金',platform:'银行',currency:'CNY',date:'2026-09-01',type:'剩余',remainingMode:'更新市值',before:0,after:100,amount:100,note:'',order:1}];
 return projectLedger(book);
}
function state(backup){return {instanceId:backup.instanceId,ledgerId:backup.ledgerId,ledger:backup.ledger,versions:backup.versions};}
async function edit(service,change){
 const base=(await service.pull()).book,local=structuredClone(base);change(local);
 const {prepared}=await service.sync(local,'',{baseBook:base,prepareOnly:true});
 return service.sync(local,'',{baseBook:base,recovery:prepared});
}
async function setup(t){
 assert.equal(typeof migration.migrateStorage,'function','the safe storage migration entry point must exist');
 const sourceDb=client.db('asset_storage_source_'+randomUUID().replaceAll('-',''));
 const targetDb=client.db('asset_storage_target_'+randomUUID().replaceAll('-',''));
 t.after(async()=>{await sourceDb.dropDatabase();await targetDb.dropDatabase();});
 const source=await createMongoService({environment,database:sourceDb});
 const target={...await createMongoService({environment,database:targetDb}),database:targetDb};
 await source.importBook(fixture(),{apply:true});
 await edit(source,book=>{book.base='USD';});
 await edit(source,book=>{book.records[0].note='historic revision';});
 const markerCollection=targetDb.collection('storage_migrations');
 return {source,target,sourceDb,targetDb,markerCollection,run:options=>migration.migrateStorage({source,target,markerCollection,...options})};
}

test('migration preserves all immutable history, the publication pointer, receipts and identity',async t=>{
 const {source,target,sourceDb,markerCollection,run}=await setup(t);
 const original=await source.exportBackup();assert.equal(original.versions.length,3);assert.equal(original.ledger.receipts.length,2);
 assert.deepEqual(await run(),{ready:true,migrated:true,resumed:false});
 assert.deepEqual(state(await target.exportBackup()),state(original));
 assert.deepEqual(state(await source.exportBackup()),state(original));
 assert.equal(await sourceDb.collection('storage_migrations').countDocuments(),0);
 const marker=await markerCollection.findOne({_id:markerId});assert.equal(marker.schemaVersion,1);assert.equal(marker.instanceId,environment.LEDGER_INSTANCE_ID);assert.equal(marker.ledgerId,'main');assert.equal(marker.versionCount,3);assert.match(marker.snapshotHash,/^[a-f0-9]{64}$/);
 assert.deepEqual((await target.pull()).book,(await source.pull()).book);
});

test('completed migration validates target and preserves later writes without contacting source',async t=>{
 const {target,run}=await setup(t);await run();
 await edit(target,book=>{book.records[0].note='new target-only edit';});
 const latest=await target.exportBackup();let contacted=0;
 assert.deepEqual(await run({source:async()=>{contacted++;throw Error('source is offline');}}),{ready:true,migrated:false,resumed:false});
 assert.equal(contacted,0);assert.deepEqual(state(await target.exportBackup()),state(latest));
});

test('an exact complete restore without a marker can safely resume',async t=>{
 const {source,target,run,markerCollection}=await setup(t);const original=await source.exportBackup();
 await target.restoreBackup(original,{apply:true});
 assert.deepEqual(await run(),{ready:true,migrated:true,resumed:true});
 assert.deepEqual(state(await target.exportBackup()),state(original));assert.ok(await markerCollection.findOne({_id:markerId}));
});

test('different existing official target data is refused and preserved',async t=>{
 const {target,run,markerCollection}=await setup(t);await target.importBook(fixture(),{apply:true});const original=await target.exportBackup();
 await assert.rejects(run(),/existing target data/);assert.deepEqual(state(await target.exportBackup()),state(original));assert.equal(await markerCollection.countDocuments(),0);
});

test('a partial restore with orphan versions is refused without overwriting anything',async t=>{
 const {source,targetDb,run,markerCollection}=await setup(t);const original=await source.exportBackup();
 await targetDb.collection('ledger_versions').insertOne(original.versions[0]);
 await assert.rejects(run(),/existing target data/);assert.equal(await targetDb.collection('ledger_versions').countDocuments(),1);assert.equal(await targetDb.collection('ledgers').countDocuments(),0);assert.equal(await markerCollection.countDocuments(),0);
});

test('unknown populated target collections are refused',async t=>{
 const {targetDb,run,markerCollection}=await setup(t);await targetDb.collection('unrecognized').insertOne({_id:'keep'});
 await assert.rejects(run(),/existing target data/);assert.deepEqual(await targetDb.collection('unrecognized').findOne(),{_id:'keep'});assert.equal(await targetDb.collection('ledgers').countDocuments(),0);assert.equal(await markerCollection.countDocuments(),0);
});

test('source changes detected before restore prevent pointer publication',async t=>{
 const {source,targetDb,run,markerCollection}=await setup(t);let exports=0;
 const racing={...source,async exportBackup(){exports++;if(exports===2)await edit(source,book=>{book.records[0].note='source changed before restore';});return source.exportBackup();}};
 await assert.rejects(run({source:racing}),/source changed/);assert.equal(await targetDb.collection('ledgers').countDocuments(),0);assert.equal(await targetDb.collection('ledger_versions').countDocuments(),0);assert.equal(await markerCollection.countDocuments(),0);
});

test('source changes during restore prevent the readiness marker even after pointer restoration',async t=>{
 const {source,target,targetDb,run,markerCollection}=await setup(t);
 const racing={...target,async restoreBackup(backup,options){const result=await target.restoreBackup(backup,options);if(options?.apply)await edit(source,book=>{book.records[0].note='source changed during restore';});return result;}};
 await assert.rejects(run({target:racing}),/source changed/);assert.equal(await targetDb.collection('ledgers').countDocuments(),1);assert.equal(await markerCollection.countDocuments(),0);assert.equal((await source.pull()).book.records[0].note,'source changed during restore');
});

test('every restored historical version is verified before the readiness marker',async t=>{
 const {source,target,targetDb,run,markerCollection}=await setup(t);const original=await source.exportBackup();
 const corrupting={...target,async restoreBackup(backup,options){const result=await target.restoreBackup(backup,options);if(options?.apply)await targetDb.collection('ledger_versions').updateOne({_id:original.versions.find(v=>v._id!==original.ledger.versionId)._id},{$set:{'inputs.base':'HKD'}});return result;}};
 await assert.rejects(run({target:corrupting}),/verification/);assert.equal(await markerCollection.countDocuments(),0);assert.deepEqual(state(await source.exportBackup()),state(original));
});

test('an interrupted marker write can resume from the exact complete restore',async t=>{
 const {source,target,run,markerCollection}=await setup(t);const original=await source.exportBackup();
 const failingMarker=new Proxy(markerCollection,{get(collection,key){if(key==='insertOne')return async()=>{throw Error('mongodb://asset_app:private-password@mongodb-asset/asset');};const value=collection[key];return typeof value==='function'?value.bind(collection):value;}});
 await assert.rejects(run({markerCollection:failingMarker}),error=>error.safe&&!error.message.includes('private-password'));
 assert.equal(await markerCollection.countDocuments(),0);assert.deepEqual(state(await target.exportBackup()),state(original));assert.equal((await run()).resumed,true);
});

test('a marker from a different ledger identity fails without contacting source',async t=>{
 const {run,markerCollection}=await setup(t);await markerCollection.insertOne({_id:markerId,schemaVersion:1,instanceId:'wrong-instance',ledgerId:'main',snapshotHash:digest({}),versionCount:3});let contacted=0;
 await assert.rejects(run({source:async()=>{contacted++;throw Error('must not connect');}}),/marker/);assert.equal(contacted,0);
});

test('a completed marker still requires the current target pointer to be readable',async t=>{
 const {targetDb,run}=await setup(t);await run();await targetDb.collection('ledgers').deleteMany({});
 await assert.rejects(run({source:async()=>{throw Error('must not connect');}}),error=>error.safe&&!error.message.includes('must not connect'));
});

test('raw driver errors never reveal credentials, connection strings or financial payloads',async t=>{
 const {source,run}=await setup(t);
 await assert.rejects(run({source:{...source,exportBackup:async()=>{throw Object.assign(Error('mongodb://asset_app:private-password@mongodb/asset balance=123.45'),{safe:true});}}}),error=>error.safe&&!/mongodb:|private-password|123\.45/.test(error.message));
});

test('runtime target URI retains credentials and stable environment while changing only hostname',()=>{
 assert.equal(typeof migration.storageTargetUri,'function','target URI derivation must be testable');
 const original={MONGODB_URI:'mongodb://asset_app:private-password@mongodb:27017/asset?authSource=asset&retryWrites=false',LEDGER_INSTANCE_ID:'stable-instance',LEDGER_ID:'main'};
 const target=new URL(migration.storageTargetUri(original));assert.equal(target.hostname,'mongodb-asset');assert.equal(target.port,'27017');assert.equal(target.username,'asset_app');assert.equal(target.password,'private-password');assert.equal(target.pathname,'/asset');assert.equal(target.searchParams.get('authSource'),'asset');assert.equal(original.LEDGER_INSTANCE_ID,'stable-instance');assert.equal(new URL(original.MONGODB_URI).hostname,'mongodb');
 assert.equal(new URL(migration.storageTargetUri({...original,ASSET_STORAGE_TARGET_HOST:'mongodb-other'})).hostname,'mongodb-other');
 assert.throws(()=>migration.storageTargetUri({...original,ASSET_STORAGE_TARGET_HOST:'mongodb'}),/separate/);
 assert.throws(()=>migration.storageTargetUri({...original,MONGODB_URI:'mongodb://root:private-password@mongodb/asset?authSource=admin'}),error=>error.safe&&!error.message.includes('private-password'));
});

test('startup sets the target connection before importing server and closes migration clients',async t=>{
 const {source,target,sourceDb,targetDb}=await setup(t);assert.equal(typeof migration.startStorage,'function','the runtime startup wrapper must exist');
 const runtime={...environment,MONGODB_URI:'mongodb://asset_app:private-password@mongodb:27017/asset?authSource=asset'};
 let started=0,closed=0;const hosts=[];
 const createClient=uri=>{const hostname=new URL(uri).hostname;hosts.push(hostname);return {connect:async()=>{},db:()=>hostname==='mongodb-asset'?targetDb:sourceDb,close:async()=>{closed++;}};};
 const createService=async({database})=>({...database===targetDb?target:source,close:async()=>{}});
 await migration.startStorage({environment:runtime,createClient,createService,startServer:async()=>{started++;assert.equal(new URL(runtime.MONGODB_URI).hostname,'mongodb-asset');assert.equal(runtime.LEDGER_INSTANCE_ID,environment.LEDGER_INSTANCE_ID);assert.equal(closed,2);}});
 assert.equal(started,1);assert.deepEqual(hosts,['mongodb-asset','mongodb']);assert.equal(closed,2);
});

test('startup after completed migration opens only the target connection',async t=>{
 const {target,targetDb,run}=await setup(t);await run();assert.equal(typeof migration.startStorage,'function','the runtime startup wrapper must exist');
 const runtime={...environment,MONGODB_URI:'mongodb://asset_app:private-password@mongodb:27017/asset?authSource=asset'};const hosts=[];let started=0;
 const createClient=uri=>{hosts.push(new URL(uri).hostname);return {connect:async()=>{},db:()=>targetDb,close:async()=>{}};};
 await migration.startStorage({environment:runtime,createClient,createService:async()=>({...target,close:async()=>{}}),startServer:async()=>{started++;}});
 assert.deepEqual(hosts,['mongodb-asset']);assert.equal(started,1);
});

test('startup never imports the application when migration detects a source race',async t=>{
 const {source,target,sourceDb,targetDb}=await setup(t);assert.equal(typeof migration.startStorage,'function','the runtime startup wrapper must exist');
 const runtime={...environment,MONGODB_URI:'mongodb://asset_app:private-password@mongodb:27017/asset?authSource=asset'};let started=0;
 const createClient=uri=>({connect:async()=>{},db:()=>new URL(uri).hostname==='mongodb-asset'?targetDb:sourceDb,close:async()=>{}});
 const createService=async({database})=>database===sourceDb?source:{...target,async restoreBackup(backup,options){const result=await target.restoreBackup(backup,options);if(options?.apply)await edit(source,book=>{book.records[0].note='race';});return result;}};
 await assert.rejects(migration.startStorage({environment:runtime,createClient,createService,startServer:async()=>{started++;}}),/source changed/);assert.equal(started,0);assert.equal(new URL(runtime.MONGODB_URI).hostname,'mongodb-asset');
});
