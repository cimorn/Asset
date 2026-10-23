import {readFile,writeFile,mkdir,rename,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createNasCredentialStore,normalizeNasUrl} from './nas-credentials.mjs';
import {validateBook} from './feishu-ledger.mjs';
import {digest,same} from './feishu-merge.mjs';

const fail=(message,status=502,extra={})=>Object.assign(new Error(message),{safe:true,status,...extra});
const keys=['accountId','cacheNamespace','instanceId','ledgerId','source'];
export function checkedNasIdentity(value){
 if(value?.source!=='nas'||!['instanceId','ledgerId'].every(k=>typeof value[k]==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value[k]))||value.accountId!==digest({instanceId:value.instanceId,ledgerId:value.ledgerId}).slice(0,24)||value.cacheNamespace!==value.accountId)throw fail('NAS 账本身份无效，缓存已保留。');
 if(value.legacyAccountId!==undefined&&!/^[a-f0-9]{24}$/.test(value.legacyAccountId))throw fail('NAS 旧账本身份无效，缓存已保留。');
 return Object.fromEntries([...keys,'legacyAccountId'].filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
}
export const sameNasIdentity=(a,b)=>!!a&&!!b&&keys.every(k=>a[k]===b[k]);
export function safeNasMessage(value,fallback='NAS 请求失败，缓存和上传恢复记录已保留，请稍后重试。',sensitive=[]){
 return typeof value==='string'&&value.length<=300&&/[\u3400-\u9fff]/.test(value)&&!sensitive.some(secret=>typeof secret==='string'&&secret.length&&value.includes(secret))&&!/(?:https?:|mongodb|password|secret|token|cookie|authorization|@|[\r\n])/i.test(value)?value:fallback;
}
export function createNasService(dataDir,{credentialStore=createNasCredentialStore(),fetchImpl=fetch,allowLocalHttp=false}={}){
 const file=name=>path.join(dataDir,name);let cookie='',config=null,identity=null,bound=null,active=false,error='',remoteStatus={},loaded=false,loginPromise=null;
 async function read(name){try{return JSON.parse(await readFile(file(name),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw fail('NAS 本机恢复记录无法读取，缓存已保留。');}}
 async function persist(name,value){await mkdir(dataDir,{recursive:true});const temp=file(name)+'.tmp';await writeFile(temp,JSON.stringify(value),'utf8');await rename(temp,file(name));}
 async function loadBound(){if(loaded)return;const saved=await read('nas-connection.json');if(saved){bound=checkedNasIdentity(saved.identity);remoteStatus={lastPulledAt:saved.lastPulledAt,lastSyncedAt:saved.lastSyncedAt};}loaded=true;}
 async function configuration(){const next=await credentialStore.load();normalizeNasUrl(next.url,{allowLocalHttp});if(!same(next,config)){cookie='';identity=null;config=next;}return config;}
 async function raw(route,body){
  const c=await configuration();let response;
  try{response=await fetchImpl(c.url+route,{method:body===undefined?'GET':'POST',headers:{Origin:c.url,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(180000),cache:'no-store'});}catch{throw fail('无法连接 NAS，缓存和上传恢复记录已保留，请稍后重试。');}
  let result;try{result=await response.json();}catch{throw fail('NAS 返回内容无效，缓存已保留。');}
  const sensitive=[c.password,cookie.slice(18)];
  if(!response.ok)throw fail(safeNasMessage(result.error,undefined,sensitive),response.status,{conflicts:Array.isArray(result.conflicts)?result.conflicts.filter(v=>typeof v==='string'&&v.length<300&&!sensitive.some(secret=>secret&&v.includes(secret))):[]});
  return {response,result};
 }
 async function login(){
  if(loginPromise)return loginPromise;
  loginPromise=(async()=>{await loadBound();cookie='';const c=await configuration(),{response,result}=await raw('/api/login',{password:c.password});if(result.authenticated!==true)throw fail('NAS 登录失败，请检查 NAS 配置。');
   const issued=response.headers.get('set-cookie')?.split(';')[0];if(!issued||!/^atlas_web_session=[A-Za-z0-9_.-]+$/.test(issued))throw fail('NAS 登录会话无效。');cookie=issued;
   const session=(await raw('/api/session')).result;if(session.authenticated!==true)throw fail('NAS 登录会话无效。');const next=checkedNasIdentity(session);if(bound&&!sameNasIdentity(bound,next)){cookie='';throw fail('NAS 账本身份发生变化，缓存与旧草稿已保留。',409);}identity=next;
  })();try{return await loginPromise;}finally{loginPromise=null;}
 }
 async function request(route,body){await configuration();if(!cookie||!identity)await login();try{return (await raw(route,body)).result;}catch(e){if(e.status!==401)throw e;cookie='';identity=null;await login();return (await raw(route,body)).result;}}
 function snapshot(result,{uploaded=false}={}){
  const received=checkedNasIdentity(result.sync);if(!sameNasIdentity(identity,received))throw fail('NAS 回读账本身份发生变化，缓存已保留。',409);
  if(result.ready!==true||result.sync.error||result.sync.warning)throw fail(safeNasMessage(result.sync.error||result.sync.warning,'NAS 未返回可验证的正式账本，缓存与草稿已保留。',[config.password,cookie.slice(18)]));
  let book;try{book=validateBook(result.book);}catch{throw fail('NAS 账本校验失败，缓存已保留。');}
  const stamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)?value:null;
  remoteStatus={assetAdjustments:result.sync.assetAdjustments===1?1:0,lastPulledAt:stamp(result.sync.lastPulledAt),lastSyncedAt:stamp(result.sync.lastSyncedAt),conflicts:[],error:'',warning:''};return {book,receipt:{book,hash:digest(book),identity:structuredClone(identity),uploaded,at:new Date().toISOString()},status:remoteStatus};
 }
 async function run(work){if(active)throw fail('正在读取或上传 NAS，请稍后重试。',409);active=true;try{const result=await work();error='';return result;}catch(e){error=e.safe?e.message:'NAS 操作失败，缓存已保留。';if(e.conflicts)remoteStatus.conflicts=e.conflicts;throw e.safe?e:fail(error);}finally{active=false;}}
 async function pending(){const p=await read('nas-upload.json');if(!p)return null;if(p.format!=='nas-upload-v1'||p.source!=='nas'||!sameNasIdentity(checkedNasIdentity(p.identity),identity)||p.origin!==config.url)throw fail('上传恢复记录来自其他来源或 NAS 账本，请保留备份后重新准备。',409);checkedJournal(p.journal);return p;}
 function checkedJournal(journal){
  let value;try{if(typeof journal?.payload!=='string'||journal.payload.length>40*1024*1024||typeof journal.signature!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(journal.signature))throw Error();value=JSON.parse(journal.payload);}catch{throw fail('NAS 上传恢复记录无效，草稿已保留。');}
  if(value.source!=='nas'||value.instanceId!==identity.instanceId||value.ledgerId!==identity.ledgerId)throw fail('上传恢复记录来自旧来源或其他 NAS 账本，草稿已保留。',409);
 }
 async function pull(_cached,{connect=false}={}){return run(async()=>snapshot(await request(connect?'/api/ledger/connect':'/api/book?refresh=1',connect?{}:undefined)));}
 async function sync(book,_target='',{baseBook}={}){return run(async()=>{
  await configuration();if(!cookie||!identity)await login();
  if(book.records.some(record=>record.transferId||record.classificationChange)&&remoteStatus.assetAdjustments!==1)throw fail('请先将 NAS 升级至新版程序，再保存分类调整或资金转移；本次输入已保留。',409);
  let p=await pending();
  if(!p){if(!baseBook)throw fail('请先读取 NAS 正式账本再准备上传。',409);const result=await request('/api/ledger/prepare',{book,baseBook});checkedJournal(result.journal);p={format:'nas-upload-v1',source:'nas',origin:config.url,identity:structuredClone(identity),journal:result.journal,createdAt:new Date().toISOString()};await persist('nas-upload.json',p);}
  return snapshot(await request('/api/ledger/upload',{journal:p.journal}),{uploaded:true});
 });}
 async function accept(receipt){
  if(!receipt||!sameNasIdentity(identity,receipt.identity)||digest(receipt.book)!==receipt.hash)throw fail('NAS 回读凭据无效，缓存已保留。');
  bound=structuredClone(identity);remoteStatus.lastPulledAt=receipt.at;if(receipt.uploaded)remoteStatus.lastSyncedAt=receipt.at;
  await persist('nas-connection.json',{identity:bound,lastPulledAt:remoteStatus.lastPulledAt,lastSyncedAt:remoteStatus.lastSyncedAt});
  if(receipt.uploaded)await rm(file('nas-upload.json'),{force:true});
 }
 async function status(){await loadBound();const state=await credentialStore.status();const hasPending=!!await read('nas-upload.json');return {...remoteStatus,desktop:true,configured:state.configured,linked:!!bound,url:config?.url??null,target:'',source:'nas',syncing:active,error:state.error||error,warning:hasPending?'上次保存尚未完成，请明确重试保存。':'',canReprepare:hasPending};}
 async function configure(target){if(active)throw fail('正在读取或上传，请稍后配置。',409);await credentialStore.configure(target);config=null;cookie='';identity=null;error='';}
 async function reprepare(){if(active)throw fail('正在上传，请稍后重试。',409);const p=await read('nas-upload.json');if(p){await persist('nas-upload-archive-'+randomUUID()+'.json',p);await rm(file('nas-upload.json'),{force:true});}error='';remoteStatus.conflicts=[];}
 async function exportBackup(){return run(async()=>{const result=await request('/api/ledger/backup');if(result.format!=='asset-mongo-backup')throw fail('NAS 完整备份格式无效。');return result;});}
 async function exportDrafts(){const names=await readdir(dataDir).catch(e=>{if(e.code==='ENOENT')return [];throw fail('本机上传恢复备份无法读取。');});return {pending:await read('nas-upload.json'),archivedUploads:await Promise.all(names.filter(name=>/^nas-upload-archive-[a-f0-9-]+\.json$/.test(name)).map(read))};}
 return {pull,status,sync,accept,configure,reprepare,exportBackup,exportDrafts};
}
