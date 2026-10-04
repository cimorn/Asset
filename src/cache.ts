import {applyAction,emptyBook,hasConfirmedRates,ledgerInputs,projectLedger,today,type Book,type Action} from '@/lib/finance';
import type {RateDraft} from '@/lib/exchange';
import type {FeishuStatus} from '@/components/finance-connections';
import {mergeBooks,same} from '../shared/merge.mjs';

type Journal={payload:string;signature:string};
type State={cloud:Book|null;draft:{base:Book;book:Book}|null;rateDraft:RateDraft|null;pending:Journal|null;version:number;sync:FeishuStatus};
let accountId='',dbPromise:Promise<IDBDatabase>|undefined,inflight:Promise<void>|null=null,lastRead=0;
const initial=():State=>({cloud:null,draft:null,rateDraft:null,pending:null,version:0,sync:{}});
export function setAccount(id:string){accountId=id;lastRead=0;inflight=null;}
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
async function locked<T>(id:string,work:()=>Promise<T>):Promise<T>{
 if(!navigator.locks)throw fail('请使用支持安全存储的新版 Chrome、Edge、Firefox 或 Safari，并通过 HTTPS 访问。');
 return navigator.locks.request('asset-compass:'+id,work);
}
function visible(s:State):Book{return s.draft&&s.cloud?projectLedger(mergeBooks(ledgerInputs(s.draft.base),ledgerInputs(s.draft.book),ledgerInputs(s.cloud)).book as Book):s.cloud??emptyBook();}
function output(s:State){return {book:visible(s),version:s.version,ready:!!s.cloud,rateDraft:s.rateDraft,sync:{...s.sync,desktop:false,dirty:!!(s.draft||s.rateDraft||s.pending),warning:s.pending?'上次上传尚未完成，请点击上传继续。':s.sync.warning,syncing:false}};}
function edit(s:State,book:Book){
 if(!s.cloud)throw fail('请先读取飞书账本。');
 s.draft=same(ledgerInputs(book),ledgerInputs(s.cloud))?null:{base:structuredClone(s.cloud),book:projectLedger(book)};
}
async function remote(url:string,body?:unknown){
 const response=await fetch(url,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(180000)});
 if(response.status===401){window.dispatchEvent(new Event('atlas-session-expired'));throw fail('登录已过期，请重新登录。',401);}
 let result;try{result=await response.json();}catch{throw fail('服务器暂时不可用，浏览器缓存已保留。',503);}
 if(!response.ok)throw fail(result.error||'请求失败，缓存已保留。',response.status);
 return result;
}
async function receive(id:string,result:{book:Book;ready:boolean;sync:FeishuStatus},uploaded=false){
 const s=await read(id),before=structuredClone(s);
 if(result.ready){s.cloud=result.book;if(uploaded){s.draft=null;s.rateDraft=null;s.pending=null;}else if(s.draft&&same(ledgerInputs(visible(s)),ledgerInputs(s.cloud)))s.draft=null;}
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
export async function financeRequest(url:string,options:RequestInit={}):Promise<Response>{
 const id=accountId;
 try{
  if(!id)throw fail('请先登录。',401);
  if(url.startsWith('/api/book')&&options.method!=='POST'){
   const cached=await read(id),force=url.includes('refresh=1');
   if(force||!cached.cloud)await refresh(id,force);else void refresh(id).catch(()=>{});
   return Response.json(output(await read(id)));
  }
  return await locked(id,async()=>{
   let s=await read(id);const input=JSON.parse(String(options.body??'{}'));
   if(url==='/api/book'){
    if(s.pending)throw fail('上次上传尚未完成，请先点击上传续传，再继续修改。',409);
    if(input.version!==s.version)throw fail('其他页面已更新缓存，请重新打开表单。',409);
    const book=visible(s),action=input.action as Action;
    if(['trade','cash','position','add'].includes(action.type)){
     const date=action.date??(action.type==='add'?action.assets?.[0]?.date:undefined)??today();
     if(!hasConfirmedRates(book,date))throw fail(`请先在设置中确认 ${date} 的汇率，再更新资产。`,428);
    }
    edit(s,applyAction(book,action));s.version++;
    if(action.type==='rates'&&s.rateDraft?.date===action.date&&Object.entries(s.rateDraft.rates).every(([code,value])=>value.trim()!==''&&Number(value)===action.rates[code]))s.rateDraft=null;
    await write(id,s);
   }else if(url==='/api/rate-draft'){
    if(s.pending)throw fail('请先完成待恢复的上传，再修改汇率。',409);
    s.rateDraft=checkedRateDraft(input.draft);await write(id,s);
   }else if(url==='/api/feishu/connect'){
    s=await receive(id,await remote(url,{}));
   }else if(url==='/api/feishu/upload'){
    if(!s.cloud)throw fail('请先读取飞书账本。');
    if(!s.pending){
     if(s.rateDraft){const rates:Record<string,number>={};for(const [c,v]of Object.entries(s.rateDraft.rates)){if(!v.trim())throw fail('请填写完整汇率后上传。');rates[c]=Number(v);}edit(s,applyAction(visible(s),{type:'rates',date:s.rateDraft.date,rates,source:'手动汇率'}));s.rateDraft=null;s.version++;await write(id,s);}
     const prepared=await remote('/api/feishu/prepare',{book:visible(s),baseBook:s.draft?.base??s.cloud});
     s.pending=prepared.journal;s.version++;await write(id,s);
    }
    const result=await remote('/api/feishu/upload',{journal:s.pending});
    s=await receive(id,result,true);lastRead=Date.now();
   }else throw fail('接口不存在。',404);
   return Response.json(output(s));
  });
 }catch(error){return Response.json({error:(error as Error).message||'操作失败，缓存已保留。'},{status:(error as {status?:number}).status??400});}
}
