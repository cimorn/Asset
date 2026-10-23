import {createHash,randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {ledgerInputs,projectLedger,hasConfirmedRates} from './runtime/finance.mjs';
import {validateBook} from './feishu-ledger.mjs';
import {canonical,mergeBooks,same} from '../shared/merge.mjs';

export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const fail=(message,status=400,extra={})=>Object.assign(new Error(message),{safe:true,status,...extra});
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
// Existing finance actions emit these display types before ledgerInputs normalizes
// them. Accept their established meanings, then validate the projected inputs.
const recordTypes=new Set(['分类调整','买入','卖出','更新','剩余','转入','消费','存入','取出','买入扣款','卖出到账','转账转入','转账转出','收入','支出','期初余额','新增资产','移除资产','部分卖出','全部卖出','更新市值','更新净值','估值更新','转入或转出','数据修正','月度估值','月度修正','月度更新','月度起点','补录持仓']);
export function ledgerIdentity(environment=process.env){
 const instanceId=environment.LEDGER_INSTANCE_ID||(environment.NODE_ENV==='production'?'':'asset-local');
 const ledgerId=environment.LEDGER_ID||'main';
 if(!validId(instanceId)||!validId(ledgerId))throw fail('请设置稳定的 LEDGER_INSTANCE_ID 和有效的 LEDGER_ID。');
 const accountId=digest({instanceId,ledgerId}).slice(0,24);
 const legacyAccountId=environment.LEGACY_ACCOUNT_ID||'';
 if(legacyAccountId&&!/^[a-f0-9]{24}$/.test(legacyAccountId))throw fail('请检查 LEGACY_ACCOUNT_ID。');
 return {instanceId,ledgerId,accountId,cacheNamespace:accountId,source:'nas',...(legacyAccountId?{legacyAccountId}:{})};
}
function checkAdjustments(book){
 const pairs=new Map(),positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1e12;
 for(const r of book.records){
  if(r.balanceKind!==undefined&&typeof r.balanceKind!=='boolean')throw Error();
  if(r.classificationChange!==undefined&&typeof r.classificationChange!=='boolean')throw Error();
  if(r.previousAccountClassification!==undefined&&(typeof r.previousAccountClassification!=='string'||!r.previousAccountClassification.trim()||r.previousAccountClassification.length>40))throw Error();
  if(r.type==='分类调整'||r.classificationChange){
   if(r.type!=='分类调整'||r.classificationChange!==true||typeof r.previousClassification!=='string'||!r.previousClassification.trim()||r.previousClassification.length>40||!r.classification?.trim()||r.settlement!==undefined||r.transferId!==undefined||!hasConfirmedRates(book,r.date))throw Error();
  }
  if(r.positionDelta!==undefined&&(!Number.isFinite(r.positionDelta)||Math.abs(r.positionDelta)>1e12||!r.transferId||r.category==='现金'))throw Error();
  if(!r.transferId){if(r.transferLeg!==undefined||r.counterpartyId!==undefined||r.fundingAmount!==undefined||r.fundingCurrency!==undefined)throw Error();continue;}
  if(!validId(r.transferId)||!['out','in'].includes(r.transferLeg)||!validId(r.counterpartyId)||!hasConfirmedRates(book,r.date)||!positive(Math.abs(r.settlement)))throw Error();
  const pair=pairs.get(r.transferId)??[];pair.push(r);pairs.set(r.transferId,pair);
 }
 for(const pair of pairs.values()){
  const out=pair.find(r=>r.transferLeg==='out'),incoming=pair.find(r=>r.transferLeg==='in');
  if(pair.length!==2||!out||!incoming||out.assetId===incoming.assetId||out.counterpartyId!==incoming.assetId||incoming.counterpartyId!==out.assetId||out.date!==incoming.date)throw Error();
  if(incoming.fundingCurrency!==out.currency||incoming.fundingAmount!==Math.abs(out.settlement)||!positive(incoming.fundingAmount)||out.fundingAmount!==undefined||out.fundingCurrency!==undefined)throw Error();
  for(const r of pair){
   const outgoing=r.transferLeg==='out',cash=r.category==='现金'||r.balanceKind;
   if(cash){if(r.type!=='剩余'||r.remainingMode!==(outgoing?'转出':'转入')||Math.sign(r.settlement)!==(outgoing?-1:1)||r.positionDelta!==undefined)throw Error();}
   else if(r.type!==(outgoing?'卖出':'买入')||Math.sign(r.settlement)!==(outgoing?1:-1)||!Number.isFinite(r.positionDelta))throw Error();
  }
 }
}
export function checkedInputs(book){
 try{
  validateBook(book);
  for(const r of book.records){
   if(typeof r.assetId!=='string'||!r.assetId||typeof r.name!=='string'||!r.name.trim()||typeof r.platform!=='string'||!r.platform.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||new Date(r.date+'T00:00:00Z').toISOString().slice(0,10)!==r.date||!recordTypes.has(r.type))throw Error();
   if(!Number.isFinite(r.after)||r.after<0||r.after>1e12||r.order!==undefined&&!Number.isFinite(r.order)||r.settlement!==undefined&&(!Number.isFinite(r.settlement)||Math.abs(r.settlement)>1e12))throw Error();
  }
  checkAdjustments(book);
  // JSON is also the wire and backup representation. Remove optional undefined keys
  // before hashing so BSON cannot turn them into null and change the digest.
  const inputs=JSON.parse(JSON.stringify(ledgerInputs(projectLedger(structuredClone(book)))));
  validateBook(projectLedger(structuredClone(inputs)));
  if(Buffer.byteLength(canonical(inputs))>12*1024*1024)throw Error();
  return inputs;
 }catch{throw fail('账本输入无效，请核对流水、分类、余额和历史汇率；草稿已保留。');}
}
export function localMigrationBackup(value){
 if(value?.format!=='finance-atlas'||value.version!==1||typeof value.exportedAt!=='string')throw fail('本机账本备份格式无效。');
 const inputs=checkedInputs(value.book);
 return {book:projectLedger(structuredClone(inputs)),migration:{format:value.format,exportedAt:value.exportedAt,originalHash:digest(value.book),inputsHash:digest(inputs)}};
}

/** Immutable version writes precede a single-document CAS publication; no replica set required. */
export async function createMongoService({environment=process.env,database}={}){
 const identity=ledgerIdentity(environment);let client,lastPulledAt=null,lastError='';
 if(!database){
  if((environment.MONGODB_DATABASE||'asset')!=='asset')throw fail('请使用 asset 数据库。');
  if(!environment.MONGODB_URI)throw fail('请设置 NAS 的 MONGODB_URI。');
  try{const uri=new URL(environment.MONGODB_URI);if(!['mongodb:','mongodb+srv:'].includes(uri.protocol)||decodeURIComponent(uri.username)!=='asset_app'||!uri.password||uri.pathname!=='/asset'||uri.searchParams.get('authSource')!=='asset'||[...uri.searchParams].some(([key,value])=>['tlsinsecure','tlsallowinvalidcertificates','tlsallowinvalidhostnames'].includes(key.toLowerCase())&&/^true$/i.test(value)))throw Error();}
  catch{throw fail('请使用 asset_app 的 asset 专用连接串和 authSource=asset；运行容器不能使用管理员凭据或跳过 TLS 校验。');}
  try{client=new MongoClient(environment.MONGODB_URI,{serverSelectionTimeoutMS:10000,connectTimeoutMS:10000,socketTimeoutMS:30000,retryWrites:false});await client.connect();database=client.db('asset');}
  catch{await client?.close().catch(()=>{});throw fail('NAS 数据库连接失败，请检查服务端配置。',503);}
 }
 const ledgers=database.collection('ledgers'),versions=database.collection('ledger_versions');
 const options={writeConcern:{w:1,j:true}};
 async function guarded(work){try{const result=await work();lastError='';return result;}catch(e){const safe=e.safe?e:fail('NAS 数据库暂时不可用；正式账本与草稿已保留。',503);lastError=safe.message;throw safe;}}
 const pointer=()=>ledgers.findOne({_id:identity.ledgerId});
 async function current(){const ledger=await pointer();if(!ledger)throw fail('NAS 尚未导入正式账本，请先完成空账本迁移。',503);return {ledger,...await readVersion(ledger.versionId,ledger.hash)};}
 async function readVersion(id,hash){
  const version=await versions.findOne({_id:id,ledgerId:identity.ledgerId});
  if(!version||version.schemaVersion!==1||version.hash!==hash||digest(version.inputs)!==hash)throw fail('NAS 账本版本摘要校验失败，请保留缓存并检查备份。',503);
  return {version,book:projectLedger(structuredClone(version.inputs))};
 }
 async function saveVersion(inputs,migration){
  const hash=digest(inputs),versionId=identity.ledgerId+':'+hash;
  const version={_id:versionId,ledgerId:identity.ledgerId,schemaVersion:1,hash,inputs,createdAt:new Date().toISOString(),...(migration?{migration}:{})};
  try{await versions.insertOne(version,options);}catch(e){if(e.code!==11000)throw e;await readVersion(versionId,hash);}
  return {hash,versionId};
 }
 const receipt=(ledger,uploaded=false,requestId)=>({hash:ledger.hash,versionId:ledger.versionId,revision:ledger.revision,uploaded,at:new Date().toISOString(),...(requestId?{requestId}:{}),...identity});
 async function status(){return guarded(async()=>{const ledger=await pointer();return {...identity,assetAdjustments:1,portfolioClassifications:2,desktop:false,configured:true,linked:!!ledger,target:'asset/'+identity.ledgerId,url:null,lastSyncedAt:ledger?.updatedAt??null,lastPulledAt,dirty:false,syncing:false,error:lastError,warning:''};});}
 async function pull(){return guarded(async()=>{const {ledger,book}=await current();return {book,receipt:receipt(ledger),status:await status()};});}
 async function accept(value){if(value&&value.instanceId===identity.instanceId&&value.ledgerId===identity.ledgerId){lastPulledAt=value.at;lastError='';}}
 function merge(base,local,remote){const result=mergeBooks(base,local,remote);if(result.conflicts.length)throw fail('正式账本已有相同字段的改动，上传已停止；请保留草稿并核对冲突。',409,{conflicts:result.conflicts});try{return checkedInputs(projectLedger(result.book));}catch(error){if(error.safe)throw error;throw fail('合并后的余额或持仓不足，保存已停止；请重新读取并核对操作。',409);}}
 async function sync(book,_target='',{baseBook,prepareOnly=false,recovery}={}){return guarded(async()=>{
  const local=checkedInputs(book),base=checkedInputs(baseBook),inputHash=digest({base,local});
  if(prepareOnly){const latest=await current();merge(base,local,latest.version.inputs);return {prepared:{schemaVersion:1,...identity,baseRevision:latest.ledger.revision,requestId:randomUUID(),inputHash,createdAt:new Date().toISOString()}};}
  if(recovery?.schemaVersion!==1||recovery.source!=='nas'||recovery.instanceId!==identity.instanceId||recovery.ledgerId!==identity.ledgerId||recovery.inputHash!==inputHash||!Number.isInteger(recovery.baseRevision)||!validId(recovery.requestId)||!Number.isFinite(Date.parse(recovery.createdAt))||Date.now()-Date.parse(recovery.createdAt)>7*24*60*60*1000||Date.parse(recovery.createdAt)>Date.now()+60000)throw fail('上传恢复记录与 NAS 账本不一致或已过期，请保留草稿后重新准备上传。',409);
  for(let attempt=0;attempt<8;attempt++){
   const latest=await current(),prior=latest.ledger.receipts?.find(r=>r.requestId===recovery.requestId);
   if(prior){if(prior.inputHash!==inputHash)throw fail('上传恢复记录校验失败。',409);return {book:latest.book,receipt:receipt(latest.ledger,true,recovery.requestId),status:await status()};}
   if(latest.ledger.revision-recovery.baseRevision>=1024)throw fail('上传恢复记录过旧，无法安全续传；请保留草稿备份后重新准备上传。',409);
   const merged=merge(base,local,latest.version.inputs),saved=await saveVersion(merged),at=new Date().toISOString();
   const result=await ledgers.updateOne({_id:identity.ledgerId,revision:latest.ledger.revision,versionId:latest.ledger.versionId},{$set:{...saved,updatedAt:at},$inc:{revision:1},$push:{receipts:{$each:[{requestId:recovery.requestId,inputHash,...saved,at}],$slice:-1024}}},options);
   if(result.modifiedCount===1){const published=await current();return {book:published.book,receipt:receipt(published.ledger,true,recovery.requestId),status:await status()};}
  }
  throw fail('其他设备正在上传，请保留草稿并稍后续传。',409);
 });}
 async function requireEmpty(){if(await pointer())throw fail('恢复导入只允许空账本，已有正式数据不会覆盖。',409);}
 async function importBook(book,{apply=false,migration={format:'local-book'}}={}){return guarded(async()=>{
  const inputs=checkedInputs(book);await requireEmpty();const report={applied:apply,hash:digest(inputs),assetCount:projectLedger(structuredClone(inputs)).assets.length,recordCount:inputs.records.length};
  if(apply){const saved=await saveVersion(inputs,migration);try{await ledgers.insertOne({_id:identity.ledgerId,schemaVersion:1,revision:1,...saved,updatedAt:new Date().toISOString(),receipts:[]},options);}catch(e){if(e.code===11000)throw fail('恢复导入只允许空账本，已有正式数据不会覆盖。',409);throw e;}await current();}
  return report;
 });}
 async function exportBackup(){return guarded(async()=>{
  // Read the pointer first. All referenced immutable versions remain valid even if an upload follows.
  const {ledger}=await current();const history=await versions.find({ledgerId:identity.ledgerId}).sort({_id:1}).toArray();
  const data={format:'asset-mongo-backup',schemaVersion:1,exportedAt:new Date().toISOString(),instanceId:identity.instanceId,ledgerId:identity.ledgerId,ledger,versions:history};
  return {...data,hash:digest(data)};
 });}
 async function restoreBackup(backup,{apply=false}={}){return guarded(async()=>{
  const {hash,...data}=backup??{};
  if(data.format!=='asset-mongo-backup'||data.schemaVersion!==1||hash!==digest(data))throw fail('完整备份摘要或格式无效。');
  if(data.ledgerId!==identity.ledgerId||data.ledger?._id!==identity.ledgerId||!Array.isArray(data.versions)||!data.versions.length)throw fail('完整备份账本标识无效。');
  const ids=new Set();for(const version of data.versions){if(version.ledgerId!==identity.ledgerId||version.schemaVersion!==1||version.hash!==digest(version.inputs)||version._id!==identity.ledgerId+':'+version.hash||ids.has(version._id)||!same(checkedInputs(projectLedger(structuredClone(version.inputs))),version.inputs))throw fail('完整备份版本摘要或输入无效。');ids.add(version._id);}
  if(!data.versions.some(v=>v._id===data.ledger.versionId&&v.hash===data.ledger.hash)||data.ledger.schemaVersion!==1||!Number.isInteger(data.ledger.revision)||data.ledger.revision<1||!Array.isArray(data.ledger.receipts)||data.ledger.receipts.some(r=>!ids.has(r.versionId)||!validId(r.requestId)))throw fail('完整备份发布指针或回执无效。');
  await requireEmpty();
  if(apply){for(const version of data.versions){try{await versions.insertOne(version,options);}catch(e){if(e.code!==11000)throw e;await readVersion(version._id,version.hash);}}try{await ledgers.insertOne(data.ledger,options);}catch(e){if(e.code===11000)throw fail('恢复导入只允许空账本，已有正式数据不会覆盖。',409);throw e;}await current();}
  return {applied:apply,hash,versionCount:data.versions.length};
 });}
 return {identity,status,pull,accept,sync,importBook,exportBackup,restoreBackup,close:async()=>{await client?.close();}};
}
