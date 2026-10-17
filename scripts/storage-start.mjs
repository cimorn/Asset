import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {MongoClient} from 'mongodb';
import {createMongoService,checkedInputs,digest} from '../server/mongo-ledger.mjs';
import {projectLedger} from '../server/runtime/finance.mjs';

const migrationId='asset-storage-20261014';
const writeOptions={writeConcern:{w:1,j:true}};
class StorageMigrationError extends Error {
 constructor(message){super(message);this.safe=true;}
}
const fail=message=>new StorageMigrationError(message);
const safeError=error=>error instanceof StorageMigrationError?error:fail('Asset storage preparation failed; application startup was stopped.');
const sameIdentity=(left,right)=>left?.instanceId===right?.instanceId&&left?.ledgerId===right?.ledgerId&&left?.accountId===right?.accountId;

/** Derive the isolated MongoDB address without changing ledger identity or credentials. */
export function storageTargetUri(environment=process.env){
 try{
  const uri=new URL(environment.MONGODB_URI);
  if((environment.MONGODB_DATABASE||'asset')!=='asset'||!['mongodb:','mongodb+srv:'].includes(uri.protocol)||decodeURIComponent(uri.username)!=='asset_app'||!uri.password||uri.pathname!=='/asset'||uri.searchParams.get('authSource')!=='asset'||[...uri.searchParams].some(([key,value])=>['tlsinsecure','tlsallowinvalidcertificates','tlsallowinvalidhostnames'].includes(key.toLowerCase())&&/^true$/i.test(value)))throw Error();
  const hostname=environment.ASSET_STORAGE_TARGET_HOST||'mongodb-asset';
  if(!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(hostname))throw Error();
  if(uri.hostname.toLowerCase()===hostname.toLowerCase())throw fail('Asset storage migration requires separate source and target hosts.');
  uri.hostname=hostname;return uri.href;
 }catch(error){throw error instanceof StorageMigrationError?error:fail('Asset storage requires the asset_app connection for asset with authSource=asset.');}
}

// Export timestamps change between reads. Everything else, including the complete
// pointer, receipts, historical metadata and immutable inputs, must match exactly.
function snapshotHash(backup,identity){
 try{
  const {hash,...data}=backup??{};
  if(data.format!=='asset-mongo-backup'||data.schemaVersion!==1||hash!==digest(data)||data.instanceId!==identity.instanceId||data.ledgerId!==identity.ledgerId||!Array.isArray(data.versions)||!data.versions.length)throw Error();
  const ids=new Set();
  for(const version of data.versions){
   if(version.ledgerId!==identity.ledgerId||version.schemaVersion!==1||version.hash!==digest(version.inputs)||version._id!==identity.ledgerId+':'+version.hash||ids.has(version._id)||digest(checkedInputs(projectLedger(structuredClone(version.inputs))))!==digest(version.inputs))throw Error();
   ids.add(version._id);
  }
  const ledger=data.ledger;
  if(ledger?._id!==identity.ledgerId||ledger.schemaVersion!==1||!Number.isInteger(ledger.revision)||ledger.revision<1||!data.versions.some(version=>version._id===ledger.versionId&&version.hash===ledger.hash)||!Array.isArray(ledger.receipts)||ledger.receipts.some(receipt=>!ids.has(receipt.versionId)||typeof receipt.requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(receipt.requestId)))throw Error();
  return digest({format:data.format,schemaVersion:data.schemaVersion,instanceId:data.instanceId,ledgerId:data.ledgerId,ledger,versions:[...data.versions].sort((left,right)=>left._id.localeCompare(right._id))});
 }catch{throw fail('Asset storage backup verification failed; application startup was stopped.');}
}

async function targetCounts(database){
 if(!database)throw fail('Asset storage target inspection is unavailable; application startup was stopped.');
 const collections=await database.listCollections({},{nameOnly:true}).toArray();
 for(const {name} of collections){
  if(name==='ledgers'||name==='ledger_versions'||name.startsWith('system.'))continue;
  if(await database.collection(name).countDocuments({}))throw fail('Asset storage contains unrecognized existing target data; application startup was stopped.');
 }
 return {ledgers:await database.collection('ledgers').countDocuments({}),versions:await database.collection('ledger_versions').countDocuments({})};
}

/**
 * Source is read-only and may be a lazy factory, so normal restarts never connect
 * to rollback storage. Target must expose its database for orphan-data checks.
 * A failed verification leaves the marker absent and never permits server start.
 */
export async function migrateStorage({source,target,markerCollection}){
 try{
  const marker=await markerCollection.findOne({_id:migrationId});
  if(marker){
   if(marker.schemaVersion!==1||marker.instanceId!==target.identity.instanceId||marker.ledgerId!==target.identity.ledgerId||!Number.isInteger(marker.versionCount)||marker.versionCount<1||!/^[a-f0-9]{64}$/.test(marker.snapshotHash))throw fail('Asset storage migration marker is invalid for this ledger; application startup was stopped.');
   await target.pull();return {ready:true,migrated:false,resumed:false};
  }
  const original=typeof source==='function'?await source():source;
  if(!sameIdentity(original?.identity,target?.identity))throw fail('Asset storage ledger identity verification failed; application startup was stopped.');
  const backup=await original.exportBackup(),expected=snapshotHash(backup,target.identity);
  const counts=await targetCounts(target.database),resumed=counts.ledgers!==0||counts.versions!==0;
  if(resumed){
   if(counts.ledgers!==1||counts.versions!==backup.versions.length)throw fail('Asset storage contains unrecognized existing target data; application startup was stopped.');
   let actual;
   try{actual=snapshotHash(await target.exportBackup(),target.identity);}catch{throw fail('Asset storage contains unrecognized existing target data; application startup was stopped.');}
   if(actual!==expected)throw fail('Asset storage contains unrecognized existing target data; application startup was stopped.');
  }else await target.restoreBackup(backup);
  // Catch a still-running old application before writing whenever possible.
  if(snapshotHash(await original.exportBackup(),target.identity)!==expected)throw fail('Asset storage source changed during migration; application startup was stopped.');
  if(!resumed)await target.restoreBackup(backup,{apply:true});
  if(snapshotHash(await target.exportBackup(),target.identity)!==expected)throw fail('Asset storage target verification failed; application startup was stopped.');
  await target.pull();
  // This catches writes racing with restore, including changes to old versions.
  if(snapshotHash(await original.exportBackup(),target.identity)!==expected)throw fail('Asset storage source changed during migration; application startup was stopped.');
  if(snapshotHash(await target.exportBackup(),target.identity)!==expected)throw fail('Asset storage target verification failed; application startup was stopped.');
  const verifiedCounts=await targetCounts(target.database);
  if(verifiedCounts.ledgers!==1||verifiedCounts.versions!==backup.versions.length)throw fail('Asset storage target verification failed; application startup was stopped.');
  // The marker is the final write. Once present, later target writes are never
  // compared with, or replaced from, the original rollback database.
  await markerCollection.insertOne({_id:migrationId,schemaVersion:1,instanceId:target.identity.instanceId,ledgerId:target.identity.ledgerId,snapshotHash:expected,versionCount:backup.versions.length,completedAt:new Date().toISOString()},writeOptions);
  return {ready:true,migrated:true,resumed};
 }catch(error){throw safeError(error);}
}

/** Wait for Mongo initialization for at most one minute, then start the app. */
export async function startStorage({environment=process.env,createClient=(uri,options)=>new MongoClient(uri,options),createService=createMongoService,startServer=()=>import(new URL('../server/index.mjs',import.meta.url))}={}){
 const sourceEnvironment={...environment},targetUri=storageTargetUri(sourceEnvironment);
 environment.MONGODB_URI=targetUri;
 const deadline=Date.now()+60000,clients=[],services=[];
 async function connect(uri){
  while(Date.now()<deadline){
   const remaining=deadline-Date.now(),timeout=Math.max(1,Math.min(1000,remaining));
   const client=createClient(uri,{serverSelectionTimeoutMS:timeout,connectTimeoutMS:timeout,socketTimeoutMS:Math.min(5000,remaining),retryWrites:false});
   try{await client.connect();const database=client.db('asset');await database.command({ping:1},{maxTimeMS:timeout});clients.push(client);return database;}
   catch{await client.close().catch(()=>{});await delay(Math.max(0,Math.min(1000,deadline-Date.now())));}
  }
  throw fail('Asset storage database initialization timed out; application startup was stopped.');
 }
 let result;
 try{
  const database=await connect(targetUri),target={...await createService({environment,database}),database};services.push(target);
  const source=async()=>{const sourceDatabase=await connect(sourceEnvironment.MONGODB_URI),service=await createService({environment:sourceEnvironment,database:sourceDatabase});services.push(service);return service;};
  result=await migrateStorage({source,target,markerCollection:database.collection('storage_migrations')});
 }catch(error){throw safeError(error);}
 finally{
  for(const service of services)await service.close().catch(()=>{});
  for(const client of clients)await client.close().catch(()=>{});
 }
 await startServer();return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await startStorage();}
 catch(error){console.error(safeError(error).message);process.exitCode=1;}
}
