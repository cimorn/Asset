import {applyAction,emptyBook,hasConfirmedRates,ledgerInputs,projectLedger,ratesAt,today,validateAsset,type Book,type Action,type Asset} from '@/lib/finance';
import type {RateDraft} from '@/lib/exchange';
import type {FeishuStatus} from '@/components/finance-connections';
import {advanceDraft,mergeBooks,same} from '../shared/merge.mjs';

type Journal={payload:string;signature:string};
type RateDraftContext={accountId:string;book:Book;intent:Record<string,string>};
type State={cloud:Book|null;draft:{base:Book;book:Book}|null;rateDraft:RateDraft|null;rateDraftContext?:RateDraftContext|null;confirmedSave?:{accountId:string;action:Action;fromForm:boolean}|null;pending:Journal|null;version:number;sync:FeishuStatus;archivedDrafts?:number;legacyCandidate?:string};
let accountId='',legacyAccountId='',dbPromise:Promise<IDBDatabase>|undefined,inflight:Promise<void>|null=null,lastRead=0,cacheReady:Promise<void>|undefined;
const observations=new Map<string,Map<number,Book>>();
const initial=():State=>({cloud:null,draft:null,rateDraft:null,pending:null,version:0,sync:{}});
export function setAccount(id:string,metadata:{legacyAccountId?:string;instanceId?:string;ledgerId?:string}={}){accountId=id;legacyAccountId=metadata.legacyAccountId??'';lastRead=0;inflight=null;cacheReady=undefined;}
const fail=(message:string,status=400)=>Object.assign(new Error(message),{status});
function database(){
 return dbPromise??=new Promise<IDBDatabase>((resolve,reject)=>{
  const req=indexedDB.open('asset-compass-web-cache',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('accounts');
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(fail('浏览器缓存不可用，请允许本站使用存储。'));
 });
}
async function read(id:string){const db=await database();return new Promise<State>((resolve,reject)=>{const req=db.transaction('accounts').objectStore('accounts').get(id);req.onsuccess=()=>resolve(req.result??initial());req.onerror=()=>reject(fail('读取浏览器缓存失败。'));});}
async function write(id:string,state:State){const db=await database();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(state,id);tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(fail('浏览器空间不足或缓存写入失败；修改尚未保存。'));});}
export async function exportBrowserCaches(){
 const db=await database();return new Promise<{format:string;exportedAt:string;accounts:Record<string,State>}>((resolve,reject)=>{
  const tx=db.transaction('accounts'),store=tx.objectStore('accounts'),keys=store.getAllKeys(),values=store.getAll();
  tx.oncomplete=()=>resolve({format:'asset-browser-caches',exportedAt:new Date().toISOString(),accounts:Object.fromEntries(keys.result.map((key,index)=>[String(key),values.result[index]]))});tx.onerror=()=>reject(fail('旧草稿备份读取失败。'));
 });
}
async function ensureCache(id:string){
 const alias=legacyAccountId;
 return cacheReady??=locked(id,async()=>{
  const archive=await exportBrowserCaches(),existing=archive.accounts[id],legacy=archive.accounts[alias];
  const s=existing??initial();
  // Explicit server alias maps this ledger only. Keep old records and journals for export.
  // Defer draft recovery until a clean NAS snapshot establishes the new cloud base.
  if(!s.cloud&&!s.draft&&!s.rateDraft&&!s.pending&&legacy)s.legacyCandidate=alias;
  s.archivedDrafts=Object.entries(archive.accounts).filter(([key,state])=>key!==id&&!!(state.draft||state.rateDraft||state.pending)).length;
  await write(id,s);
 });
}
async function locked<T>(id:string,work:()=>Promise<T>):Promise<T>{
 if(!navigator.locks)throw fail('请使用支持安全存储的新版 Chrome、Edge、Firefox 或 Safari，并通过 HTTPS 访问。');
 return navigator.locks.request('asset-compass:'+id,work);
}
function visible(s:State):Book{return s.draft&&s.cloud?projectLedger(mergeBooks(ledgerInputs(s.draft.base),ledgerInputs(s.draft.book),ledgerInputs(s.cloud)).book as Book):s.cloud??emptyBook();}
function unboundRateDraft(id:string,s:State){return !!s.rateDraft&&s.rateDraftContext?.accountId!==id;}
function canRetrySave(id:string,s:State){return s.confirmedSave?.accountId===id;}
function output(id:string,s:State){
 const book=visible(s);
 // Bind a first form write to the version actually returned to its renderer,
 // even when a background refresh has since advanced the cache.
 if(s.cloud&&s.sync.source==='nas'){
  const seen=observations.get(id)??new Map<number,Book>();seen.set(s.version,structuredClone(book));observations.set(id,seen);
  if(seen.size>16)seen.delete(seen.keys().next().value!);
 }
 const legacyDraft=!!(s.draft||s.pending)&&!canRetrySave(id,s);
 return {book,version:s.version,ready:!!s.cloud,rateDraft:s.rateDraft,sync:{...s.sync,source:'nas',archivedDrafts:s.archivedDrafts??0,canReprepare:!!s.pending||!!s.draft||!!s.confirmedSave||unboundRateDraft(id,s),canRetrySave:canRetrySave(id,s),desktop:false,dirty:!!(s.draft||s.rateDraft||s.pending||s.confirmedSave),warning:unboundRateDraft(id,s)?'旧汇率表单缺少原始账本上下文，请先备份并重新填写。':legacyDraft?'旧草稿尚未保存，请先备份并读取正式账本，再核对重填。':canRetrySave(id,s)?'上次确认的保存尚未完成，输入已保留；可继续上次保存。':s.sync.warning,syncing:false}};
}
function edit(s:State,before:Book,after:Book){
 if(!s.cloud)throw fail('请先读取 NAS 正式账本。');
 // Untouched paths may adopt verified remote context in both documents, including
 // new assets and their opening history. Locally changed paths keep the old base.
 const draft=s.draft?advanceDraft(ledgerInputs(s.draft.base),ledgerInputs(s.draft.book),ledgerInputs(s.cloud)):null;
 const base=draft?projectLedger(draft.base as Book):s.cloud;
 // Apply only this action's input delta; remote context never becomes local intent.
 const book=draft?projectLedger(mergeBooks(ledgerInputs(before),ledgerInputs(after),draft.local).book as Book):projectLedger(after);
 s.draft=same(ledgerInputs(book),ledgerInputs(base))?null:{base:structuredClone(base),book};
}
async function remote(url:string,body?:unknown){
 const response=await fetch(url,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(180000)});
 if(response.status===401){window.dispatchEvent(new Event('atlas-session-expired'));throw fail('登录已过期，请重新登录。',401);}
 let result;try{result=await response.json();}catch{throw fail('服务器暂时不可用，浏览器缓存已保留。',503);}
 if(!response.ok)throw fail(result.error||'请求失败，缓存已保留。',response.status);
 return result;
}
const verified=(result:{book?:Book;ready?:boolean;sync?:FeishuStatus})=>!!(result.ready&&result.book&&result.sync?.source==='nas'&&!result.sync.error&&!result.sync.warning);
async function receive(id:string,result:{book:Book;ready:boolean;sync:FeishuStatus},uploaded=false,clearRateDraft=true){
 const s=await read(id),before=structuredClone(s);
 if(verified(result)){
  if(!s.cloud&&s.legacyCandidate){
   const legacy=await read(s.legacyCandidate);
   if(!s.draft)s.draft=structuredClone(legacy.draft);
   if(!s.rateDraft)s.rateDraft=structuredClone(legacy.rateDraft);
  }
  delete s.legacyCandidate;
  s.cloud=result.book;
  if(uploaded){s.draft=null;s.confirmedSave=null;if(clearRateDraft){s.rateDraft=null;s.rateDraftContext=null;}s.pending=null;}else if(s.draft&&same(ledgerInputs(visible(s)),ledgerInputs(s.cloud)))s.draft=null;
 }
 s.sync=result.sync;
 if(!same({...before,sync:null},{...s,sync:null}))s.version++;
 await write(id,s);return s;
}
async function refresh(id:string,force=false){
 if(inflight)return inflight;
 if(!force&&Date.now()-lastRead<30000)return;
 lastRead=Date.now();
 inflight=(async()=>{
  try{const before=await read(id),result=await remote('/api/book'+(force?'?refresh=1':''));await locked(id,async()=>{const now=await read(id);if(now.version===before.version&&!now.pending)await receive(id,result);});}
  catch(error){if((error as {status?:number}).status===401)throw error;await locked(id,async()=>{const s=await read(id);s.sync.error=(error as Error).message;await write(id,s);});}
 })();try{await inflight;}finally{inflight=null;}
}
function checkedRateDraft(value:RateDraft){
 if(!value||typeof value.date!=='string'||value.date.length>10||!value.rates||typeof value.rates!=='object'||Array.isArray(value.rates)||Object.keys(value.rates).length>100)throw fail('汇率输入格式无效。');
 for(const [code,rate]of Object.entries(value.rates))if(!/^[A-Z]{3}$/.test(code)||typeof rate!=='string'||rate.length>40)throw fail('汇率输入格式无效。');
 return {date:value.date,rates:{...value.rates}};
}
function rateIntent(book:Book,draft:RateDraft){
 let original:Record<string,number>={};try{original=ratesAt(book,draft.date);}catch{}
 return Object.fromEntries(Object.entries(draft.rates).filter(([code,value])=>!value.trim()||!Number.isFinite(Number(value))||Number(value)!==original[code]));
}
function applyRateDraft(id:string,s:State){
 if(!s.rateDraft||!s.rateDraftContext||s.rateDraftContext.accountId!==id)throw fail('汇率草稿缺少原始账本上下文，请先备份并重新填写。',409);
 const {book:original,intent}=s.rateDraftContext,current=visible(s),baseline=ratesAt(original,s.rateDraft.date),rates=ratesAt(current,s.rateDraft.date);
 // Carry ownership across a date change, while inherited siblings come from
 // verified context effective on that date. A later FX row must not leak back.
 for(const [code,value]of Object.entries(s.rateDraft.rates))if(!value.trim())throw fail('请填写完整汇率后保存。');
 for(const [code,value]of Object.entries(intent)){
  const local=Number(value);
  if(rates[code]!==baseline[code]&&rates[code]!==local)throw fail('汇率已被其他修改更新，请保留草稿并核对冲突后重新填写。',409);
  rates[code]=local;
 }
 edit(s,current,applyAction(current,{type:'rates',date:s.rateDraft.date,rates,source:'手动汇率'}));
}
function applyConfirmedAction(id:string,s:State,action:Action,assetBase?:Asset){
 const book=visible(s);
 if(action.type==='update'){
  const submitted=action.asset;
  if(!assetBase||assetBase.id!==submitted.id)throw fail('资产表单缺少原始上下文，请保留输入并重新打开表单。',409);
  const current=book.assets.find(asset=>asset.id===submitted.id);if(!current)throw fail('该资产已被移除，请保留输入并核对正式账本。',409);
  const normalized=(asset:Asset)=>validateAsset({...asset,accountClassification:asset.accountClassification??'现金'},book);
  const merged=mergeBooks(normalized(assetBase),normalized(submitted),normalized(current));
  if(merged.conflicts.length)throw fail('资产相同字段已被其他修改更新，请保留输入并核对冲突。',409);
  action={...action,asset:merged.book as Asset};
 }
 if(['trade','cash','position','add','transfer','classify','recordEdit'].includes(action.type)){
  const date=action.date??(action.type==='add'?action.assets?.[0]?.date:undefined)??today();
  if(!hasConfirmedRates(book,date))throw fail(`请先在设置中确认 ${date} 的汇率，再更新资产。`,428);
 }
 const fromForm=action.type==='rates'&&s.rateDraft?.date===action.date&&Object.entries(s.rateDraft.rates).every(([code,value])=>value.trim()!==''&&Number(value)===action.rates[code]);
 if(fromForm)applyRateDraft(id,s);else edit(s,book,applyAction(book,action));
 return !!fromForm;
}
export async function financeRequest(url:string,options:RequestInit={}):Promise<Response>{
 const id=accountId;
 try{
  if(!id)throw fail('请先登录。',401);
  await ensureCache(id);
  if(url.startsWith('/api/book')&&options.method!=='POST'){
   const cached=await read(id),force=url.includes('refresh=1');
   if(force||!cached.cloud)await refresh(id,force);else void refresh(id).catch(()=>{});
   return Response.json(output(id,await read(id)));
  }
  return await locked(id,async()=>{
   let s=await read(id);const input=JSON.parse(String(options.body??'{}'));
   if(url==='/api/book'){
    if(s.pending)throw fail('上次保存尚未完成，请先继续保存或备份后重新填写。',409);
    if(input.version!==s.version)throw fail('其他页面已更新缓存，请重新打开表单。',409);
    if(s.confirmedSave)throw fail('上次确认的保存尚未完成，请先继续保存或备份后重新填写。',409);
    if(applyConfirmedAction(id,s,input.action as Action,input.assetBase)){s.rateDraft=null;s.rateDraftContext=null;}s.version++;
    await write(id,s);
   }else if(url==='/api/rate-draft'){
    if(s.pending||s.confirmedSave)throw fail('请先完成待恢复的保存，或备份后重新填写，再修改汇率。',409);
    const draft=checkedRateDraft(input.draft),existing=s.rateDraft;
    if(!existing){
     const original=observations.get(id)?.get(input.version);
     s.rateDraftContext=original?{accountId:id,book:structuredClone(original),intent:rateIntent(original,draft)}:null;
    }else if(s.rateDraftContext?.accountId===id){
     const intent={...s.rateDraftContext.intent},changed=rateIntent(s.rateDraftContext.book,draft);
     // Later writes change ownership only for the fields the user changed. A
     // new date keeps those same owned fields instead of owning stale siblings.
     for(const [code,value]of Object.entries(draft.rates))if(value!==existing.rates[code]){if(Object.hasOwn(changed,code))intent[code]=value;else delete intent[code];}
     s.rateDraftContext.intent=intent;
    }
    s.rateDraft=draft;await write(id,s);
   }else if(url==='/api/ledger/reprepare'){
    if(input.version!==s.version)throw fail('其他页面已更新缓存，请重新读取。',409);
    if(s.pending||unboundRateDraft(id,s)||input.discardDraft===true&&(s.draft||s.rateDraft||s.confirmedSave)){await write(id+':saved-journal:'+crypto.randomUUID(),structuredClone(s));s.pending=null;s.confirmedSave=null;if(input.discardDraft===true)s.draft=null;if(unboundRateDraft(id,s)||input.discardDraft===true){s.rateDraft=null;s.rateDraftContext=null;}s.version++;s.archivedDrafts=(s.archivedDrafts??0)+1;s.sync.error='';await write(id,s);}
   }else if(url==='/api/ledger/save'){
    if(!s.cloud)throw fail('请先读取 NAS 正式账本。');
    if(canRetrySave(id,s)){
     if(input.action&&!same(input.action,s.confirmedSave!.action))throw fail('上次确认的保存尚未完成；请继续该保存，或先备份并读取正式账本后重填。',409);
    }else{
     if(s.draft||s.pending||s.confirmedSave)throw fail('旧草稿或恢复记录不能自动提交；请先备份并读取正式账本，再核对重填。',409);
     if(input.version!==s.version)throw fail('其他页面已更新缓存，请重新打开表单。',409);
     const fromForm=applyConfirmedAction(id,s,input.action as Action,input.assetBase);
     s.confirmedSave={accountId:id,action:structuredClone(input.action),fromForm};s.version++;await write(id,s);
    }
    try{
     if(!s.pending){const prepared=await remote('/api/ledger/prepare',{book:s.draft?.book??s.cloud,baseBook:s.draft?.base??s.cloud});s.pending=prepared.journal;s.version++;await write(id,s);}
     const result=await remote('/api/ledger/upload',{journal:s.pending});
     if(!verified(result))throw fail('NAS 保存后的回读尚未验证成功，输入已保留，请继续上次保存。',503);
     s=await receive(id,result,true,s.confirmedSave!.fromForm);lastRead=Date.now();
    }catch(error){s.sync.error=(error as Error).message;await write(id,s);throw error;}
   }else if(url==='/api/ledger/connect'||url==='/api/feishu/connect'){
    s=await receive(id,await remote('/api/ledger/connect',{}));
   }else if(url==='/api/ledger/upload'||url==='/api/feishu/upload'){
    if(!s.cloud)throw fail('请先读取 NAS 正式账本。');
    if(!s.pending){
     if(s.rateDraft){applyRateDraft(id,s);s.version++;await write(id,s);}
     const prepared=await remote('/api/ledger/prepare',{book:s.draft?.book??s.cloud,baseBook:s.draft?.base??s.cloud});
     s.pending=prepared.journal;s.version++;await write(id,s);
    }
    const result=await remote('/api/ledger/upload',{journal:s.pending});
    s=await receive(id,result,true);lastRead=Date.now();
   }else throw fail('接口不存在。',404);
   return Response.json(output(id,s));
  });
 }catch(error){return Response.json({error:(error as Error).message||'操作失败，缓存已保留。'},{status:(error as {status?:number}).status??400});}
}
