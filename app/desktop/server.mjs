import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {emptyBook,applyAction} from './runtime/finance.mjs';
import {createNasService} from './nas-service.mjs';
import {openNasCache} from './nas-cache.mjs';
import {operationRateRequirement} from './rate-draft.mjs';
import {openNasRateDraft} from './nas-rate-draft.mjs';
import {same} from './nas-merge.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
export async function startServer({dataDir,port=0,preview=false,selectNasConfig,nasService,legacyReader}={}){
 const session=randomBytes(32).toString('hex'),nas=nasService??createNasService(dataDir),cache=await openNasCache(dataDir,{preview,legacyReader}),rateDraft=await openNasRateDraft(dataDir);
 let saving=false,refreshing=null,refreshError='',writeQueue=Promise.resolve();
 function serializeWrite(work){const next=writeQueue.then(work);writeQueue=next.catch(()=>{});return next;}
 async function receive(result,{uploaded=false}={}){
  // Only a verified cloud receipt can initialize/replace the cloud cache.
  if(result.receipt){await cache.receive(result.book,{uploaded,identity:result.receipt.identity});await nas.accept(result.receipt);}
  refreshError='';
 }
 async function refreshRemote(){
  if(preview||saving||(await nas.status()).canReprepare)return;if(refreshing)return refreshing;
  refreshing=(async()=>{
   try{const result=await nas.pull(structuredClone(cache.cloud??emptyBook()));await serializeWrite(()=>receive(result));}
   catch(error){refreshError=error.safe?error.message:'读取 NAS 失败，缓存与草稿已保留，请稍后重试。';}finally{refreshing=null;}
  })();return refreshing;
 }
 const syncState=async()=>{const status=await nas.status();return {...status,version:cache.version,dirty:cache.dirty||!!rateDraft.value||!!status.canReprepare,canRetry:!!cache.saveAttempt||!!status.canReprepare,hasHistoricalDraft:cache.dirty&&!cache.saveAttempt,cacheReady:cache.ready,source:'nas',error:refreshError||status.error||''};};
 const state=async()=>({book:cache.cloud??cache.book,version:cache.version,ready:cache.ready,rateDraft:rateDraft.value,sync:await syncState()});
 async function finishSave(){
  const action=cache.saveAttempt?.action,result=await nas.sync(structuredClone(cache.draft?.book??cache.cloud),'',{baseBook:structuredClone(cache.draft?.base??cache.cloud)});
  await receive(result,{uploaded:true});if(action?.type==='rates')await rateDraft.save(null);
 }
 async function savingError(res,error){refreshError=error.safe?error.message:'NAS 保存失败，本次操作和恢复记录已保留，请重试保存。';return json(res,error.safe&&error.status===409?409:502,{error:refreshError,sync:await syncState()});}
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 const server=http.createServer(async(req,res)=>{
  try{const address=server.address();const origin=`http://127.0.0.1:${address.port}`;if(req.headers.host!==`127.0.0.1:${address.port}`)return json(res,403,{error:'请求来源无效'});const url=new URL(req.url,origin);
   if(url.pathname==='/launch'&&url.searchParams.get('key')===session){res.writeHead(302,{'Set-Cookie':`atlas_session=${session}; HttpOnly; SameSite=Strict; Path=/`,'Location':'/','Referrer-Policy':'no-referrer'});return res.end();}
   const cookie=(req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith('atlas_session='))?.slice(14)??'';
   if(!preview&&(cookie.length!==session.length||!timingSafeEqual(Buffer.from(cookie),Buffer.from(session))))return json(res,401,{error:'请从资产罗盘 App 打开账本'});
   if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==origin))return json(res,403,{error:'请求来源无效'});
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
   if(req.method==='GET'&&url.pathname==='/api/book'){if(url.searchParams.get('refresh')==='1')await refreshRemote();return json(res,200,await state());}
   if(req.method==='GET'&&['/api/ledger/status','/api/feishu/status'].includes(url.pathname))return json(res,200,await syncState());
   if(req.method==='GET'&&url.pathname==='/api/ledger/backup'){if(preview)return json(res,403,{error:'请在桌面 App 中读取 NAS 完整备份。'});res.setHeader('Content-Disposition','attachment; filename="asset-mongo-backup.json"');return json(res,200,await nas.exportBackup());}
   if(req.method==='GET'&&url.pathname==='/api/ledger/drafts'){res.setHeader('Content-Disposition','attachment; filename="asset-desktop-drafts.json"');return serializeWrite(async()=>json(res,200,{format:'asset-desktop-drafts',exportedAt:new Date().toISOString(),cloud:cache.cloud,draft:cache.draft,saveAttempt:cache.saveAttempt,archivedDrafts:await cache.exportedArchives(),rateDraft:rateDraft.value,...rateDraft.export(),...await nas.exportDrafts(),legacy:legacyReader?.export?await legacyReader.export():null}));}
   if(req.method==='GET'&&url.pathname==='/api/rates')return json(res,410,{error:'请在设置与汇率中确认操作日期的汇率'});
   if(req.method==='POST'){
    if(!req.headers['content-type']?.includes('application/json'))return json(res,415,{error:'请求格式无效'});let body='';for await(const chunk of req){body+=chunk;if(body.length>500000)return json(res,413,{error:'一次数据过多'});}let input;try{input=JSON.parse(body);}catch{return json(res,400,{error:'请求格式无效'});}
    if(url.pathname==='/api/rate-draft')return await serializeWrite(async()=>{if(cache.saveAttempt||(await nas.status()).canReprepare)return json(res,409,{error:'请先恢复未完成的保存，再修改汇率。'});if(!cache.ready||input.version!==cache.version)return json(res,409,{error:'账本已更新，请刷新后核对汇率。当前输入保留。'});try{await rateDraft.save(input.draft,{book:cache.cloud,identity:cache.identity});return json(res,200,{rateDraft:rateDraft.value});}catch(error){return json(res,error.safe?error.status:400,{error:error.safe?error.message:'汇率输入缓存失败，原草稿已保留。'});}});
    if(url.pathname==='/api/book'){
     if(preview)return json(res,403,{error:'预览不会保存 NAS 正式账本。'});if(refreshing)await refreshing;
     return await serializeWrite(async()=>{
      if(saving)return json(res,409,{error:'正在保存，请稍后重试'});if(input.version!==cache.version)return json(res,409,{error:'账本已更新，请刷新后重试。当前表单内容保留。'});const pending=(await nas.status()).canReprepare;
      if(cache.saveAttempt&&!same(input.action,cache.saveAttempt.action)||!cache.saveAttempt&&(pending||cache.dirty))return json(res,409,{error:'请先恢复未完成的保存，或下载备份并归档本机草稿。'});if(!cache.ready&&!pending)return json(res,409,{error:'请先读取 NAS 正式账本，再保存。'});saving=true;
      try{
       if(!cache.saveAttempt){const required=operationRateRequirement(cache.cloud,input.action);if(required)return json(res,428,{error:`请先更新 ${required.date} 的汇率，再保存本次变动`,ratesRequired:required});let pair;try{pair=rateDraft.matches(input.action)?rateDraft.prepare(cache.cloud,cache.identity):{base:structuredClone(cache.cloud),book:applyAction(cache.cloud,input.action)};}catch(e){return json(res,400,{error:e.message});}await cache.stageSave(pair,input.action);}
       await finishSave();return json(res,200,await state());
      }catch(error){return savingError(res,error);}finally{saving=false;}
     });
    }
    if(['/api/ledger/configure','/api/feishu/configure'].includes(url.pathname)){
     if(preview||!selectNasConfig)return json(res,403,{error:'请在桌面 App 中选择 NAS 配置文件'});
     const target=await selectNasConfig();if(!target)return json(res,200,{cancelled:true});
     if(refreshing)await refreshing;
     return await serializeWrite(async()=>{saving=true;try{await nas.configure(target);await receive(await nas.pull(structuredClone(cache.cloud??emptyBook())));return json(res,200,await state());}catch(e){return json(res,400,{error:e.safe?e.message:'读取 NAS 配置失败'});}finally{saving=false;}});
    }
    if(url.pathname==='/api/ledger/reprepare'){
     if(preview)return json(res,403,{error:'请在桌面 App 中重新准备。'});if(refreshing)await refreshing;
     return serializeWrite(async()=>{if(input.version!==cache.version)return json(res,409,{error:'缓存已更新，请刷新后重试。'});await nas.reprepare();refreshError='';return json(res,200,await state());});
    }
    if(url.pathname==='/api/ledger/archive-drafts'){
     if(preview)return json(res,403,{error:'请在桌面 App 中归档草稿。'});if(refreshing)await refreshing;
     return serializeWrite(async()=>{if(input.version!==cache.version)return json(res,409,{error:'缓存已更新，请刷新后重试。'});saving=true;try{const uploads=await nas.exportDrafts();await cache.archiveDrafts({...rateDraft.export(),...uploads});await nas.reprepare();await rateDraft.save(null);refreshError='';return json(res,200,await state());}catch(error){return savingError(res,error);}finally{saving=false;}});
    }
    if(['/api/ledger/connect','/api/ledger/retry','/api/ledger/upload','/api/ledger/sync','/api/feishu/connect','/api/feishu/upload','/api/feishu/sync'].includes(url.pathname)){
     if(preview)return json(res,403,{error:'测试预览不会访问 NAS；请在桌面 App 中连接。'});
     if(refreshing)await refreshing;
     return await serializeWrite(async()=>{
      if(saving)return json(res,409,{error:'正在读取或上传，请稍后重试'});
      const upload=!url.pathname.endsWith('/connect'),pending=(await nas.status()).canReprepare;
      if(upload&&(!pending&&!cache.ready||input.version!==cache.version))return json(res,409,{error:'缓存已更新，请刷新后重试保存'});
      saving=true;
      try{
       if(upload){
        if(!cache.saveAttempt&&!pending)return json(res,409,{error:'请通过保存或确认更新提交操作。旧草稿请下载备份后归档。'});
        await finishSave();
       }else {if(pending)return json(res,409,{error:'上次上传尚未完成，请先续传或重新准备。'});await receive(await nas.pull(structuredClone(cache.cloud??emptyBook()),{connect:true}));}
       return json(res,200,await state());
      }catch(e){return savingError(res,e);}finally{saving=false;}
     });
    }

   }
   if(req.method!=='GET')return json(res,405,{error:'不支持的请求'});
   const root=path.join(here,'web-dist');const target=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!target.startsWith(root+path.sep))return json(res,403,{error:'路径无效'});try{const content=await readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(target)]??'application/octet-stream','Cache-Control':url.pathname.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache'});res.end(content);}catch{return json(res,404,{error:'文件不存在'});}
  }catch{json(res,500,{error:'操作失败，缓存已保留。请稍后重试。'});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});const timer=preview?null:setInterval(()=>void refreshRemote(),20000);timer?.unref();server.on('close',()=>{if(timer)clearInterval(timer);});if(!preview)void refreshRemote();const actual=server.address().port;return {server,url:`http://127.0.0.1:${actual}`,launchUrl:`http://127.0.0.1:${actual}/launch?key=${session}`};
}
if(process.argv.includes('--preview')){const result=await startServer({dataDir:path.join(here,'.test-data'),port:5188,preview:true});console.log(`Desktop preview: ${result.url}`);}
